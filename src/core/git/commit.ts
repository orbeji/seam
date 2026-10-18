// SPDX-License-Identifier: MIT

import type { CommitFailure, CommitOutcome, HeadCommit } from '../../shared/git'
import { findCrlfProblems, fixCrlf } from './eol'
import { GitAbortError, GitTimeoutError } from './errors'
import type { GitRunner } from './runner'

/**
 * A hook that asks for input Seam cannot give will wait forever. Five minutes is
 * long enough for a slow hook and short enough that nobody waits on it blindly;
 * the interface also offers to cancel.
 */
export const COMMIT_TIMEOUT_MS = 5 * 60 * 1000

/** The options the commit box can pass to `git commit`. */
export interface CommitOptions {
  /** Rewrite the last commit with the index and the message instead of adding one. */
  readonly amend?: boolean
  /** Signs the commit as someone else, written `Name <email>`. */
  readonly author?: string
  /** Adds Git's `Signed-off-by` trailer with the committer's identity. */
  readonly signoff?: boolean
  /** Skips the `pre-commit` and `commit-msg` hooks. */
  readonly noVerify?: boolean
  /**
   * Runs the CRLF check before committing: a file that would commit CRLF into
   * the index without attributes comes back as a warning outcome instead of a
   * commit, so the interface can ask what to do.
   */
  readonly checkCrlf?: boolean
  /**
   * Runs the same check but fixes what it finds first, with `core.autocrlf` on
   * the repository and `add --renormalize`, and commits only when the index
   * comes back clean. It is the answer "Fix and Commit".
   */
  readonly fixCrlf?: boolean
  /** Kills the commit when the caller cancels, for a hook that will not end. */
  readonly signal?: AbortSignal
}

/** The flags for a commit, in the order the phase's table lists them. */
function commitArgs(options: CommitOptions): string[] {
  const args: string[] = []
  if (options.amend === true) args.push('--amend')
  const author = options.author?.trim()
  if (author !== undefined && author !== '') args.push(`--author=${author}`)
  if (options.signoff === true) args.push('--signoff')
  if (options.noVerify === true) args.push('--no-verify')
  return args
}

function combine(stdout: string, stderr: string): string {
  return [stdout.trimEnd(), stderr.trimEnd()].filter((part) => part !== '').join('\n')
}

/** The abbreviated id of `HEAD`, read once the commit exists. Empty when unreadable. */
async function readShortId(runner: GitRunner, repo: string): Promise<string> {
  const result = await runner.run(['rev-parse', '--short', 'HEAD'], {
    cwd: repo,
    readOnly: true
  })
  if (result.code !== 0) return ''
  return result.stdout.toString('utf8').trim()
}

/**
 * Recognises, from Git's own wording under `LC_ALL=C`, the refusals the
 * interface does something about: a missing identity opens the identity dialog,
 * and the other two explain a disabled button that was pressed anyway.
 */
export function commitFailure(text: string): CommitFailure | null {
  if (
    /Please tell me who you are|unable to auto-detect email address|empty ident name|no email was given|no name was given/i.test(
      text
    )
  ) {
    return 'identity'
  }
  if (/nothing to commit|no changes added to commit|nothing added to commit/i.test(text)) {
    return 'nothing-staged'
  }
  if (/unmerged files|not possible because you have unmerged/i.test(text)) return 'conflicts'
  return null
}

/**
 * Creates a commit from the index with the given message.
 *
 * The message goes over stdin, encoded as UTF-8, so Unicode survives intact and
 * no command-line limit or shell quoting is involved. `GIT_EDITOR=true` keeps
 * Git from opening an editor for a message it already has; hooks, attributes
 * and configuration still run exactly as they do in a terminal, and their
 * output comes back in the outcome so the interface can show it.
 */
export async function createCommit(
  runner: GitRunner,
  repo: string,
  message: string,
  options: CommitOptions = {}
): Promise<CommitOutcome> {
  // The CRLF check is Seam's own and runs before Git does: with nothing to fix
  // it says nothing, and a warning comes back as an outcome the interface
  // answers by committing as they are, fixing the endings, or cancelling.
  if (options.checkCrlf === true || options.fixCrlf === true) {
    const problems = await findCrlfProblems(runner, repo)
    const remaining =
      options.fixCrlf === true && problems.length > 0
        ? await fixCrlf(runner, repo, problems)
        : problems
    if (remaining.length > 0) {
      return {
        created: false,
        output: '',
        message: '',
        reason: null,
        timedOut: false,
        cancelled: false,
        shortId: '',
        crlf: remaining
      }
    }
  }

  const runOptions = {
    cwd: repo,
    stdin: Buffer.from(message, 'utf8'),
    noEditor: true,
    timeoutMs: COMMIT_TIMEOUT_MS,
    ...(options.signal === undefined ? {} : { signal: options.signal })
  }

  try {
    const result = await runner.run(['commit', '-F', '-', ...commitArgs(options)], runOptions)
    const stdout = result.stdout.toString('utf8').trimEnd()
    const stderr = result.stderr.trimEnd()
    const created = result.code === 0
    // Git writes most refusals to stderr, but "nothing to commit" to stdout.
    const output = combine(stdout, stderr)
    // The short id the notification shows is read only once Git reports the
    // commit; a failed read leaves it empty rather than failing the commit.
    const shortId = created ? await readShortId(runner, repo) : ''
    return {
      created,
      output,
      shortId,
      message: created
        ? ''
        : stderr !== ''
          ? stderr
          : stdout !== ''
            ? stdout
            : 'Git refused the commit.',
      reason: created ? null : commitFailure(output),
      timedOut: false,
      cancelled: false,
      crlf: []
    }
  } catch (error) {
    // A cancelled or timed-out commit is a plain outcome, not a failure: the
    // message is kept and the interface says what happened.
    if (error instanceof GitAbortError) {
      return {
        created: false,
        output: combine(error.stdout, error.stderr),
        message: '',
        reason: null,
        timedOut: false,
        cancelled: true,
        shortId: '',
        crlf: []
      }
    }
    if (error instanceof GitTimeoutError) {
      return {
        created: false,
        output: combine(error.stdout, error.stderr),
        message: '',
        reason: null,
        timedOut: true,
        cancelled: false,
        shortId: '',
        crlf: []
      }
    }
    throw error
  }
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
