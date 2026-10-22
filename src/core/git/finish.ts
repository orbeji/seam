// SPDX-License-Identifier: MIT

import { readFile } from 'node:fs/promises'
import type { GitOperation, OperationOutcome } from '../../shared/git'
import { COMMIT_TIMEOUT_MS, createCommit, type CommitOptions } from './commit'
import { readResolveUndo } from './conflicts'
import { GitError } from './errors'
import { detectOperation, gitStatePath } from './operation'
import type { GitRunner } from './runner'
import { abortStash, readStashCandidate } from './stash'
import { readStatus } from './status'

/**
 * The commands that close an operation. Every one of them runs with
 * `GIT_EDITOR=true` so Git never waits for an editor, and with the commit
 * timeout because `--continue` runs the hooks again.
 */
const CONTINUE_TIMEOUT_MS = COMMIT_TIMEOUT_MS

function combine(stdout: string, stderr: string): string {
  return [stdout.trimEnd(), stderr.trimEnd()].filter((part) => part !== '').join('\n')
}

/** What is left after a command: the marker, if any, and the unmerged files. */
async function remaining(
  runner: GitRunner,
  repo: string
): Promise<{ operation: GitOperation | null; conflicts: number }> {
  const [operation, status] = await Promise.all([
    detectOperation(runner, repo),
    readStatus(runner, repo)
  ])
  const conflicts = status.entries.filter((entry) => entry.kind === 'unmerged').length
  return { operation, conflicts }
}

/**
 * Runs one closing command and reads what Git left behind. The exit code alone
 * is not enough: a rebase stops on the next conflict, which is a normal step,
 * while a hook refusal leaves the same operation in place with no conflict.
 */
async function runClosing(
  runner: GitRunner,
  repo: string,
  args: readonly string[]
): Promise<OperationOutcome> {
  const result = await runner.run(args, {
    cwd: repo,
    noEditor: true,
    timeoutMs: CONTINUE_TIMEOUT_MS,
    env: { GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' }
  })
  const state = await remaining(runner, repo)
  return {
    finished: state.operation === null,
    failed: result.code !== 0,
    operation: state.operation,
    conflicts: state.conflicts,
    output: combine(result.stdout.toString('utf8'), result.stderr)
  }
}

/**
 * The message Git prepared for a merge commit, with its comment lines removed.
 * `git commit -F -` keeps comments, so they are stripped here before the box
 * shows the text.
 */
export async function readMergeMessage(runner: GitRunner, repo: string): Promise<string> {
  if ((await detectOperation(runner, repo)) !== 'merge') {
    throw new GitError('This repository has no merge in progress.')
  }

  let text: string
  try {
    text = await readFile(await gitStatePath(runner, repo, 'MERGE_MSG'), 'utf8')
  } catch {
    return ''
  }

  const configured = await runner.run(['config', '--get', 'core.commentChar'], {
    cwd: repo,
    readOnly: true
  })
  const raw = configured.stdout.toString('utf8').trim()
  const comment = configured.code === 0 && raw.length === 1 ? raw : '#'

  return text
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(comment))
    .join('\n')
    .trim()
}

/**
 * Finishes the operation in progress.
 *
 * A merge is not continued: the phase's decision is that Accept and finish
 * opens the commit box with `MERGE_MSG` filled in, and the commit is made from
 * there. When a message is passed, though, this closes the merge with it, which
 * is what the integration tests compare against the terminal.
 */
export async function finishOperation(
  runner: GitRunner,
  repo: string,
  options: CommitOptions & { readonly message?: string } = {}
): Promise<OperationOutcome> {
  const operation = await detectOperation(runner, repo)
  if (operation === null) {
    // A stash pop has no marker: its conflicts are closed by dropping the
    // stash entry once every file is resolved.
    return finishStash(runner, repo)
  }

  if (operation === 'merge') {
    const message = options.message ?? (await readMergeMessage(runner, repo))
    const outcome = await createCommit(runner, repo, message, {
      ...(options.amend === undefined ? {} : { amend: options.amend }),
      ...(options.author === undefined ? {} : { author: options.author }),
      ...(options.signoff === undefined ? {} : { signoff: options.signoff }),
      ...(options.noVerify === undefined ? {} : { noVerify: options.noVerify }),
      ...(options.checkCrlf === undefined ? {} : { checkCrlf: options.checkCrlf }),
      ...(options.fixCrlf === undefined ? {} : { fixCrlf: options.fixCrlf }),
      ...(options.signal === undefined ? {} : { signal: options.signal })
    })
    const state = await remaining(runner, repo)
    return {
      finished: outcome.created && state.operation === null,
      failed: !outcome.created,
      operation: state.operation,
      conflicts: state.conflicts,
      output: outcome.output
    }
  }

  return runClosing(runner, repo, [operation, '--continue'])
}

/** Skips the commit that stopped a rebase, cherry-pick or revert. */
export async function skipOperation(runner: GitRunner, repo: string): Promise<OperationOutcome> {
  const operation = await detectOperation(runner, repo)
  if (operation === null) {
    throw new GitError('This repository has no operation to skip a commit in.')
  }
  if (operation === 'merge') {
    throw new GitError('A merge has no commit to skip.')
  }
  return runClosing(runner, repo, [operation, '--skip'])
}

/**
 * Drops the stash a finished pop left behind. It runs once every conflict is
 * resolved; an unresolved file means the pop is not finished yet.
 */
export async function finishStash(runner: GitRunner, repo: string): Promise<OperationOutcome> {
  const status = await readStatus(runner, repo)
  const conflicts = status.entries.filter((entry) => entry.kind === 'unmerged').length
  if (conflicts > 0) {
    throw new GitError('The stash pop still has unresolved conflicts.')
  }

  const undo = await readResolveUndo(runner, repo)
  const stash = await readStashCandidate(runner, repo, undo.keys())
  if (stash === null) {
    throw new GitError('This repository has no finished stash pop to drop.')
  }

  const result = await runner.run(['stash', 'drop', stash], { cwd: repo })
  return {
    finished: result.code === 0,
    failed: result.code !== 0,
    operation: null,
    conflicts: 0,
    output: combine(result.stdout.toString('utf8'), result.stderr)
  }
}

/**
 * Aborts the operation in progress. A stash pop has no command of its own, so
 * `abortStash` puts back only the files the stash touched and keeps the entry.
 */
export async function abortOperation(runner: GitRunner, repo: string): Promise<OperationOutcome> {
  const operation = await detectOperation(runner, repo)
  if (operation === null) {
    // A resolved file leaves the status but stays in resolve-undo; those paths
    // are what let an abort after every conflict was resolved find the pop.
    const undo = await readResolveUndo(runner, repo)
    await abortStash(runner, repo, undo.keys())
    return { finished: true, failed: false, operation: null, conflicts: 0, output: '' }
  }

  return runClosing(runner, repo, [operation, '--abort'])
}
