// SPDX-License-Identifier: MIT

import { existsSync, statSync } from 'node:fs'
import { stageHunks, unstageHunks } from '../../core/diff'
import {
  detectOperation,
  GitCommandError,
  GitError,
  GitNotFoundError,
  GitRunner,
  GitVersionError,
  readComparison,
  readFileModel,
  readStatus,
  removeIndexPaths,
  stagePaths,
  summarizeChanges,
  unstagePaths,
  writeIndexEntry,
  type VersionSource
} from '../../core/git'
import type {
  FileComparison,
  HunkRange,
  IpcErrorCode,
  IpcResult,
  RepositorySnapshot,
  StagingModel
} from '../../shared/ipc'
import { GitWatcher } from './git-watcher'

type Failure = { readonly ok: false; readonly code: IpcErrorCode; readonly message: string }

function failure(code: IpcErrorCode, message: string): Failure {
  return { ok: false, code, message }
}

/** Whether two hunks cover the same lines, so a stale request can be refused. */
function sameHunk(left: HunkRange, right: HunkRange): boolean {
  return (
    left.aStart === right.aStart &&
    left.aLines === right.aLines &&
    left.bStart === right.bStart &&
    left.bLines === right.bLines
  )
}

function failureFrom(error: unknown): Failure {
  if (error instanceof GitNotFoundError) return failure('git-not-found', error.message)
  if (error instanceof GitVersionError) return failure('git-too-old', error.message)
  if (error instanceof GitCommandError) {
    return failure('command-failed', error.stderr.trim() || error.message)
  }
  if (error instanceof GitError) return failure('unknown', error.message)
  return failure('unknown', error instanceof Error ? error.message : String(error))
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    // The folder disappeared between the two checks, or is not readable.
    return false
  }
}

/**
 * Reads everything the interface needs from a repository. It owns one Git runner
 * and checks the Git version once, so the interface gets a clear error instead of
 * a failed command when Git is missing or too old.
 */
export class RepositoryService {
  private versionChecked: Promise<unknown> | null = null

  constructor(private readonly runner: GitRunner = new GitRunner()) {}

  async snapshot(repo: string): Promise<IpcResult<RepositorySnapshot>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      const status = await readStatus(this.runner, repo)
      const operation = await detectOperation(this.runner, repo)
      return {
        ok: true,
        value: { repo, status, summary: summarizeChanges(status), operation }
      }
    } catch (error) {
      return failureFrom(error)
    }
  }

  async readFileComparison(
    repo: string,
    path: string,
    from: VersionSource,
    to: VersionSource
  ): Promise<IpcResult<FileComparison>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      const comparison = await readComparison(this.runner, repo, path, from, to)
      return {
        ok: true,
        value: {
          from: comparison.from,
          to: comparison.to,
          fromSize: comparison.fromSize,
          toSize: comparison.toSize,
          binary: comparison.binary,
          normalised: comparison.normalised
        }
      }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /**
   * Reads the three versions of a file and the changes between them, for the
   * viewer's staging markers. Null when the file is binary and has no lines.
   */
  async readStagingModel(repo: string, path: string): Promise<IpcResult<StagingModel | null>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await readFileModel(this.runner, repo, path) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Stages the given paths: one file, several or a whole section, in one write. */
  stage(repo: string, paths: readonly string[]): Promise<IpcResult<null>> {
    return this.write(repo, () => stagePaths(this.runner, repo, paths))
  }

  /** Removes the given paths from the index, leaving the working tree alone. */
  unstage(repo: string, paths: readonly string[]): Promise<IpcResult<null>> {
    return this.write(repo, () => unstagePaths(this.runner, repo, paths))
  }

  /**
   * Prepares the given hunks of a file or removes them, rebuilding the index's
   * text and writing it without touching the working copy.
   *
   * The model is read again first, so the hunks are applied to the index as it
   * is now. A hunk the file no longer has - because it changed after the viewer
   * read it - is refused rather than applied at coordinates that have moved.
   */
  async writeHunks(
    repo: string,
    path: string,
    action: 'stage' | 'unstage',
    hunks: readonly HunkRange[]
  ): Promise<IpcResult<null>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      const model = await readFileModel(this.runner, repo, path)
      if (model === null) {
        return failure('command-failed', `${path} is binary, so it cannot be prepared by hunk.`)
      }

      const known = action === 'stage' ? model.unstaged : model.staged
      if (!hunks.every((hunk) => known.some((candidate) => sameHunk(candidate, hunk)))) {
        return failure('command-failed', `${path} changed since it was read. Open it again.`)
      }

      if (action === 'stage') {
        const content = stageHunks(model.index, model.worktree, hunks)
        await writeIndexEntry(this.runner, repo, path, content)
      } else {
        const content = unstageHunks(model.head, model.index, hunks)
        if (content === null) await removeIndexPaths(this.runner, repo, [path])
        else await writeIndexEntry(this.runner, repo, path, content)
      }
      return { ok: true, value: null }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Opens the repository, runs one write and maps any failure to a result. */
  private async write(repo: string, action: () => Promise<unknown>): Promise<IpcResult<null>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      await action()
      return { ok: true, value: null }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /**
   * Starts watching the files Git writes, so the interface can refresh when a
   * `git add` or `commit` happens outside Seam. Returns null when the path is
   * not a repository this Git version can read.
   */
  async watch(repo: string, onChange: () => void): Promise<GitWatcher | null> {
    const gitDir = await this.gitDirectory(repo)
    if (gitDir === null) return null
    return new GitWatcher(gitDir, onChange)
  }

  /** Absolute path of the repository's git folder, or null when it is not one. */
  async gitDirectory(repo: string): Promise<string | null> {
    const opened = await this.open(repo)
    if (!opened.ok) return null

    try {
      const result = await this.runner.run(['rev-parse', '--absolute-git-dir'], {
        cwd: repo,
        readOnly: true
      })
      if (result.code !== 0) return null
      const path = result.stdout.toString('utf8').trim()
      return path === '' ? null : path
    } catch {
      return null
    }
  }

  /** Checks that the path is a repository that this Git version can read. */
  private async open(repo: string): Promise<{ ok: true; value: null } | Failure> {
    if (!isDirectory(repo)) {
      return failure('not-a-repository', `Not a folder: ${repo}`)
    }

    try {
      this.versionChecked ??= this.runner.ensureVersion(repo)
      await this.versionChecked
      const probe = await this.runner.run(['rev-parse', '--git-dir'], { cwd: repo, readOnly: true })
      if (probe.code !== 0) {
        return failure('not-a-repository', probe.stderr.trim() || repo)
      }
      return { ok: true, value: null }
    } catch (error) {
      return failureFrom(error)
    }
  }
}
