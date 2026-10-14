// SPDX-License-Identifier: MIT

import { existsSync, statSync } from 'node:fs'
import {
  detectOperation,
  GitCommandError,
  GitError,
  GitNotFoundError,
  GitRunner,
  GitVersionError,
  readComparison,
  readStatus,
  summarizeChanges,
  type VersionSource
} from '../../core/git'
import type { FileComparison, IpcErrorCode, IpcResult, RepositorySnapshot } from '../../shared/ipc'

type Failure = { readonly ok: false; readonly code: IpcErrorCode; readonly message: string }

function failure(code: IpcErrorCode, message: string): Failure {
  return { ok: false, code, message }
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
