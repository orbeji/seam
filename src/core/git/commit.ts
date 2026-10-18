// SPDX-License-Identifier: MIT

import type { HeadCommit } from '../../shared/git'
import type { GitRunner } from './runner'

/** The options the commit box can pass to `git commit`. */
export interface CommitOptions {
  /** Rewrite the last commit with the index and the message instead of adding one. */
  readonly amend?: boolean
  /** Signs the commit as someone else, written `Name <email>`. */
  readonly author?: string
  /** Adds Git's `Signed-off-by` trailer with the committer's identity. */
  readonly signoff?: boolean
}

/** The flags for a commit, in the order the phase's table lists them. */
function commitArgs(options: CommitOptions): string[] {
  const args: string[] = []
  if (options.amend === true) args.push('--amend')
  const author = options.author?.trim()
  if (author !== undefined && author !== '') args.push(`--author=${author}`)
  if (options.signoff === true) args.push('--signoff')
  return args
}

/**
 * Creates a commit from the index with the given message.
 *
 * The message goes over stdin, encoded as UTF-8, so Unicode survives intact and
 * no command-line limit or shell quoting is involved. `GIT_EDITOR=true` keeps
 * Git from opening an editor for a message it already has; hooks, attributes
 * and configuration still run exactly as they do in a terminal.
 */
export async function createCommit(
  runner: GitRunner,
  repo: string,
  message: string,
  options: CommitOptions = {}
): Promise<void> {
  await runner.runOrThrow(['commit', '-F', '-', ...commitArgs(options)], {
    cwd: repo,
    stdin: Buffer.from(message, 'utf8'),
    noEditor: true
  })
}

/**
 * Reads the last commit, which is what Amend would rewrite: its short id, its
 * subject, its whole message and whether a remote branch already contains it.
 * `%h`, `%s` and `%B` arrive in one call, separated by NUL.
 */
export async function readHeadCommit(runner: GitRunner, repo: string): Promise<HeadCommit> {
  const log = await runner.runOrThrow(['log', '-1', '--format=%h%x00%s%x00%B'], { cwd: repo })
  const [shortId = '', subject = '', body = ''] = log.stdout.toString('utf8').split('\0')
  const contains = await runner.runOrThrow(['branch', '-r', '--contains', 'HEAD'], { cwd: repo })

  return {
    shortId,
    subject,
    // `%B` prints the stored body, which already ends with a newline, and `log`
    // adds another; the box wants the message as it was typed.
    message: body.trimEnd(),
    published: contains.stdout.toString('utf8').trim() !== ''
  }
}
