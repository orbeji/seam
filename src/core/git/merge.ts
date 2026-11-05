// SPDX-License-Identifier: MIT

import type { MergeOutcome, MergeState, MergeStrategy } from '../../shared/git'
import { listBranches } from './branch'
import { COMMIT_TIMEOUT_MS } from './commit'
import { GitError } from './errors'
import { detectOperation } from './operation'
import type { GitRunner } from './runner'
import { readStatus } from './status'

function combine(stdout: string, stderr: string): string {
  return [stdout.trimEnd(), stderr.trimEnd()].filter((part) => part !== '').join('\n')
}

/**
 * Everything the merge dialog needs: the checked-out branch, what can be merged
 * into it, and whether Git is free to start. The dirty flag only counts tracked
 * changes; untracked files are left to Git's own checkout checks.
 */
export async function readMergeState(runner: GitRunner, repo: string): Promise<MergeState> {
  const [status, operation, branches] = await Promise.all([
    readStatus(runner, repo),
    detectOperation(runner, repo),
    listBranches(runner, repo)
  ])
  const conflicts = status.entries.filter((entry) => entry.kind === 'unmerged').length
  return {
    currentBranch: status.branch.head,
    headOid: status.branch.oid,
    local: branches.local.map((branch) => branch.name),
    remote: branches.remote.map((branch) => branch.name),
    operation,
    conflicts,
    dirty: status.entries.some((entry) => entry.kind !== 'untracked')
  }
}

/** The arguments one merge strategy adds, in the order Git expects them. */
function strategyArgs(strategy: MergeStrategy): string[] {
  if (strategy === 'merge-commit') return ['--no-ff']
  if (strategy === 'fast-forward') return ['--ff-only']
  return ['--squash']
}

/**
 * Starts `git merge` from the dialog. A conflict is not an error: Git leaves the
 * merge in progress, and the result says how many files are unmerged so the
 * conflicts screen can take over. A squash merge leaves its changes staged and
 * finishes without an operation, exactly as the terminal does.
 */
export async function mergeBranch(
  runner: GitRunner,
  repo: string,
  source: string,
  strategy: MergeStrategy,
  message?: string
): Promise<MergeOutcome> {
  const branch = source.trim()
  if (branch === '') throw new GitError('Choose a branch to merge.')

  const operation = await detectOperation(runner, repo)
  if (operation !== null) {
    throw new GitError(`A ${operation} is already in progress. Finish or abort it first.`)
  }

  const args = ['merge', ...strategyArgs(strategy)]
  const text = message?.trim() ?? ''
  // A fast-forward cannot carry a merge message, and a squash leaves the
  // message to the commit that follows it.
  if (strategy === 'merge-commit' && text !== '') args.push('-m', text)
  args.push('--', branch)

  const result = await runner.run(args, {
    cwd: repo,
    noEditor: true,
    timeoutMs: COMMIT_TIMEOUT_MS,
    env: { GIT_EDITOR: 'true' }
  })
  const [after, conflicts] = await Promise.all([
    detectOperation(runner, repo),
    readStatus(runner, repo)
  ])
  const unmerged = conflicts.entries.filter((entry) => entry.kind === 'unmerged').length
  return {
    ok: result.code === 0 && after === null && unmerged === 0,
    conflicts: unmerged,
    operation: after,
    output: combine(result.stdout.toString('utf8'), result.stderr)
  }
}
