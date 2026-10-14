// SPDX-License-Identifier: MIT

import { existsSync, statSync } from 'node:fs'
import {
  detectOperation,
  GitCommandError,
  GitError,
  GitNotFoundError,
  GitRunner,
  GitVersionError,
  readStatus,
  summarizeChanges
} from '../../core/git'
import type { IpcErrorCode, IpcResult, RepositorySnapshot } from '../../shared/ipc'

type Failure = Extract<IpcResult<RepositorySnapshot>, { readonly ok: false }>

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
 * Reads everything the changes screen needs from a repository. It owns one Git
 * runner and checks the Git version once, so the interface gets a clear error
 * instead of a failed command when Git is missing or too old.
 */
export class RepositoryService {
  private versionChecked: Promise<unknown> | null = null

  constructor(private readonly runner: GitRunner = new GitRunner()) {}

  async snapshot(repo: string): Promise<IpcResult<RepositorySnapshot>> {
    if (!isDirectory(repo)) {
      return failure('not-a-repository', `Not a folder: ${repo}`)
    }

    try {
      await this.ensureGit(repo)
      const probe = await this.runner.run(['rev-parse', '--git-dir'], { cwd: repo, readOnly: true })
      if (probe.code !== 0) {
        return failure('not-a-repository', probe.stderr.trim() || repo)
      }

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

  private async ensureGit(repo: string): Promise<void> {
    this.versionChecked ??= this.runner.ensureVersion(repo)
    await this.versionChecked
  }
}
