// SPDX-License-Identifier: MIT

import type { GitVersion } from './runner'

/** Base class for every error the Git layer raises. */
export class GitError extends Error {
  override name = 'GitError'
}

/** The `git` executable could not be started. */
export class GitNotFoundError extends GitError {
  override name = 'GitNotFoundError'

  constructor(
    readonly gitPath: string,
    options?: ErrorOptions
  ) {
    super(`Git executable not found: ${gitPath}`, options)
  }
}

/** A Git command was cancelled by the caller. */
export class GitAbortError extends GitError {
  override name = 'GitAbortError'

  constructor(options?: ErrorOptions) {
    super('Git command aborted', options)
  }
}

/** A Git command did not finish within its timeout and was killed. */
export class GitTimeoutError extends GitError {
  override name = 'GitTimeoutError'

  constructor(readonly timeoutMs: number) {
    super(`Git command timed out after ${timeoutMs} ms`)
  }
}

/** A Git command exited with a non-zero status. */
export class GitCommandError extends GitError {
  override name = 'GitCommandError'

  constructor(
    readonly args: readonly string[],
    readonly exitCode: number,
    readonly stderr: string,
    readonly stdout: string
  ) {
    const detail = stderr.trim()
    super(`git ${args.join(' ')} exited with code ${exitCode}${detail ? `: ${detail}` : ''}`)
  }
}

/** The installed Git is older than the version Seam requires. */
export class GitVersionError extends GitError {
  override name = 'GitVersionError'

  constructor(
    readonly found: GitVersion,
    readonly required: GitVersion
  ) {
    super(`Git ${required.major}.${required.minor} or newer is required, found ${found.raw}`)
  }
}
