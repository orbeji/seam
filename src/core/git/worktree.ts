// SPDX-License-Identifier: MIT

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type {
  MergeOutcome,
  MergeStrategy,
  MergeWorktreeOutcome,
  WorktreeInfo
} from '../../shared/git'
import { validateBranchName } from './branch'
import { GitError } from './errors'
import { mergeBranch } from './merge'
import type { GitRunner } from './runner'

/**
 * Parses `git worktree list --porcelain -z`. Each worktree is a block of
 * `key value` records whose lines are NUL-terminated, and a block ends with an
 * empty record. The first block is the main worktree.
 */
export function parseWorktrees(output: string): WorktreeInfo[] {
  interface MutableWorktree {
    path: string
    head: string | null
    branch: string | null
    detached: boolean
    bare: boolean
    locked: string | null
    prunable: string | null
    main: boolean
  }

  const worktrees: WorktreeInfo[] = []
  let current: MutableWorktree | null = null

  const flush = (): void => {
    if (current !== null) worktrees.push(current)
    current = null
  }

  for (const record of output.split('\0')) {
    if (record === '') {
      flush()
      continue
    }

    const space = record.indexOf(' ')
    const key = space === -1 ? record : record.slice(0, space)
    const value = space === -1 ? '' : record.slice(space + 1)

    if (key === 'worktree') {
      flush()
      current = {
        path: value,
        head: null,
        branch: null,
        detached: false,
        bare: false,
        locked: null,
        prunable: null,
        main: worktrees.length === 0
      }
      continue
    }
    if (current === null) continue

    switch (key) {
      case 'HEAD':
        current.head = value === '' ? null : value
        break
      case 'branch':
        current.branch = value.startsWith('refs/heads/') ? value.slice('refs/heads/'.length) : value
        break
      case 'detached':
        current.detached = true
        break
      case 'bare':
        current.bare = true
        break
      case 'locked':
        current.locked = value === '' ? '' : value
        break
      case 'prunable':
        current.prunable = value === '' ? '' : value
        break
      default:
        break
    }
  }
  flush()

  return worktrees
}

/** Lists the worktrees Git knows about, the main one first. */
export async function listWorktrees(runner: GitRunner, repo: string): Promise<WorktreeInfo[]> {
  const result = await runner.runOrThrow(['worktree', 'list', '--porcelain', '-z'], {
    cwd: repo,
    readOnly: true
  })
  return parseWorktrees(result.stdout.toString('utf8'))
}

/**
 * Rejects a path or revision Git would read as an option. Both are passed as
 * positional arguments, so a leading dash would change the command instead.
 */
function positional(value: string, what: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new GitError(`A worktree ${what} cannot be empty.`)
  if (trimmed.startsWith('-')) throw new GitError(`A worktree ${what} cannot start with "-".`)
  return trimmed
}

/** How a new worktree is created. */
export interface AddWorktreeOptions {
  /** Where Git checks the worktree out. */
  readonly path: string
  /** The branch to check out, or the name of the new one. */
  readonly branch: string
  /** Whether `branch` is created first (`-b`) instead of reused. */
  readonly newBranch: boolean
  /** The branch, tag or commit a new branch starts from; null uses HEAD. */
  readonly startPoint: string | null
  /** Whether the worktree is left with a detached HEAD. */
  readonly detach: boolean
}

/**
 * Adds a worktree. Git refuses a branch that is already checked out elsewhere,
 * so every worktree keeps its own branch, which is what the interface expects.
 */
export async function addWorktree(
  runner: GitRunner,
  repo: string,
  options: AddWorktreeOptions
): Promise<void> {
  const path = positional(options.path, 'path')
  const branch = options.branch.trim()
  const startPoint =
    options.startPoint === null ? '' : positional(options.startPoint, 'start point')

  if (options.detach) {
    await runner.runOrThrow(
      ['worktree', 'add', '--detach', path, ...(startPoint === '' ? [] : [startPoint])],
      { cwd: repo }
    )
    return
  }

  if (branch === '') {
    await runner.runOrThrow(['worktree', 'add', path, ...(startPoint === '' ? [] : [startPoint])], {
      cwd: repo
    })
    return
  }

  if (options.newBranch) {
    await validateBranchName(runner, repo, branch)
    await runner.runOrThrow(
      ['worktree', 'add', '-b', branch, path, ...(startPoint === '' ? [] : [startPoint])],
      { cwd: repo }
    )
    return
  }

  await runner.runOrThrow(['worktree', 'add', path, positional(branch, 'branch')], { cwd: repo })
}

/**
 * Removes a worktree. Git refuses a working tree with changes unless `force`
 * is set, so the interface asks before throwing them away.
 */
export async function removeWorktree(
  runner: GitRunner,
  repo: string,
  path: string,
  force = false
): Promise<void> {
  const target = positional(path, 'path')
  await runner.runOrThrow(['worktree', 'remove', ...(force ? ['--force'] : []), target], {
    cwd: repo
  })
}

/** Moves a linked worktree to a new folder; Git refuses to move the main one. */
export async function moveWorktree(
  runner: GitRunner,
  repo: string,
  path: string,
  destination: string
): Promise<void> {
  await runner.runOrThrow(
    ['worktree', 'move', positional(path, 'path'), positional(destination, 'destination')],
    { cwd: repo }
  )
}

/** Locks a worktree, optionally with the reason Git keeps in its record. */
export async function lockWorktree(
  runner: GitRunner,
  repo: string,
  path: string,
  reason: string | null
): Promise<void> {
  const message = reason?.trim() ?? ''
  await runner.runOrThrow(
    [
      'worktree',
      'lock',
      ...(message === '' ? [] : ['--reason', message]),
      positional(path, 'path')
    ],
    { cwd: repo }
  )
}

/** Unlocks a worktree that was locked by hand or by a portable drive. */
export async function unlockWorktree(runner: GitRunner, repo: string, path: string): Promise<void> {
  await runner.runOrThrow(['worktree', 'unlock', positional(path, 'path')], { cwd: repo })
}

/** Drops the records of worktrees whose folders no longer exist. */
export async function pruneWorktrees(runner: GitRunner, repo: string): Promise<void> {
  await runner.runOrThrow(['worktree', 'prune'], { cwd: repo })
}

/**
 * Repairs the administrative files of a moved worktree, or of every registered
 * one when no path is given.
 */
export async function repairWorktrees(
  runner: GitRunner,
  repo: string,
  path: string | null
): Promise<void> {
  const target = path === null || path.trim() === '' ? [] : [positional(path, 'path')]
  await runner.runOrThrow(['worktree', 'repair', ...target], { cwd: repo })
}

/** How one worktree's changes are merged into another branch. */
export interface MergeWorktreeOptions {
  /** The worktree whose branch or commit is merged. */
  readonly sourcePath: string
  /** The local branch that receives the merge. */
  readonly target: string
  readonly strategy: MergeStrategy
  /** The merge commit's message for `merge-commit`; empty uses Git's default. */
  readonly message: string
}

/** Whether two folder paths point at the same place. */
function sameFolder(a: string, b: string): boolean {
  return resolve(a) === resolve(b)
}

/**
 * Whether the merge left something for the user to finish: unresolved
 * conflicts, or a squash whose changes still need a commit. Any other failure
 * has no state to open, so the interface can show Git's output instead.
 */
function needsAttention(outcome: MergeOutcome, strategy: MergeStrategy): boolean {
  if (outcome.conflicts > 0) return true
  return strategy === 'squash' && outcome.ok
}

/**
 * Merges a worktree's branch into a local branch, whichever worktree has that
 * branch checked out. When no worktree does, a temporary one is created for the
 * merge and removed again if it left nothing for the user to finish. A detached
 * source merges its commit instead of a branch name.
 */
export async function mergeWorktree(
  runner: GitRunner,
  repo: string,
  options: MergeWorktreeOptions
): Promise<MergeWorktreeOutcome> {
  const worktrees = await listWorktrees(runner, repo)
  const source = worktrees.find((worktree) => sameFolder(worktree.path, options.sourcePath))
  if (source === undefined) {
    throw new GitError(`The worktree at ${options.sourcePath} is not registered.`)
  }

  const sourceRef = source.branch ?? source.head
  if (sourceRef === null) throw new GitError('The worktree has no commit to merge.')

  const target = worktrees.find((worktree) => worktree.branch === options.target)
  if (target !== undefined) {
    const outcome = await mergeBranch(
      runner,
      target.path,
      sourceRef,
      options.strategy,
      options.message
    )
    // The target's worktree is opened either way, so the interface lands on the
    // branch that received the merge.
    return { outcome, worktreePath: target.path }
  }

  return mergeInTemporaryWorktree(runner, repo, sourceRef, options)
}

/** Runs the merge in a throwaway worktree when the target is not checked out. */
async function mergeInTemporaryWorktree(
  runner: GitRunner,
  repo: string,
  sourceRef: string,
  options: MergeWorktreeOptions
): Promise<MergeWorktreeOutcome> {
  const directory = await mkdtemp(join(tmpdir(), 'seam-merge-'))
  try {
    await runner.runOrThrow(['worktree', 'add', directory, '--', options.target], { cwd: repo })
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }

  try {
    const outcome = await mergeBranch(
      runner,
      directory,
      sourceRef,
      options.strategy,
      options.message
    )
    const keep = needsAttention(outcome, options.strategy)
    if (!keep) {
      // The merge commit is already on the target branch, so the throwaway
      // worktree can go. A failed removal is left to `worktree prune`.
      await runner
        .runOrThrow(['worktree', 'remove', '--force', directory], { cwd: repo })
        .catch(() => undefined)
    }
    return { outcome, worktreePath: keep ? directory : null }
  } catch (error) {
    await runner
      .runOrThrow(['worktree', 'remove', '--force', directory], { cwd: repo })
      .catch(() => undefined)
    throw error
  }
}
