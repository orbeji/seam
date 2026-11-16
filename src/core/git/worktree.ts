// SPDX-License-Identifier: MIT

import { existsSync, realpathSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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
 * Decodes the C-style quoting Git applies to a path that holds a quote, a
 * backslash or a control character. The runner sets `core.quotePath=false`, so
 * any other byte arrives as plain UTF-8 and needs no decoding.
 */
function unquoteGitPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value
  const bytes: number[] = []
  for (let index = 1; index < value.length - 1; index += 1) {
    const char = value[index] as string
    if (char !== '\\') {
      bytes.push(...Buffer.from(char, 'utf8'))
      continue
    }
    index += 1
    const escape = value[index]
    switch (escape) {
      case 'a':
        bytes.push(0x07)
        break
      case 'b':
        bytes.push(0x08)
        break
      case 'f':
        bytes.push(0x0c)
        break
      case 'n':
        bytes.push(0x0a)
        break
      case 'r':
        bytes.push(0x0d)
        break
      case 't':
        bytes.push(0x09)
        break
      case 'v':
        bytes.push(0x0b)
        break
      case '\\':
        bytes.push(0x5c)
        break
      case '"':
        bytes.push(0x22)
        break
      default: {
        if (escape !== undefined && escape >= '0' && escape <= '7') {
          // Git escapes any other control byte as three octal digits.
          let octal = escape
          while (octal.length < 3) {
            const next = value[index + 1]
            if (next === undefined || next < '0' || next > '7') break
            octal += next
            index += 1
          }
          bytes.push(Number.parseInt(octal, 8))
        } else if (escape !== undefined) {
          bytes.push(...Buffer.from(escape, 'utf8'))
        }
      }
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

/**
 * Parses `git worktree list --porcelain`. Each worktree is a block of
 * `key value` lines and a block ends with an empty line. The first block is the
 * main worktree. `-z` is not used because `git worktree list` only learned it
 * in 2.36, while Seam supports 2.30; the path is unquoted here instead.
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

  for (const record of output.split(/\r?\n/)) {
    if (record === '') {
      flush()
      continue
    }

    const space = record.indexOf(' ')
    const key = space === -1 ? record : record.slice(0, space)
    const raw = space === -1 ? '' : record.slice(space + 1)
    // A path or a lock reason can arrive C-quoted; the other values are plain.
    const value = key === 'worktree' || key === 'locked' ? unquoteGitPath(raw) : raw

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

/** The lock and prune facts the porcelain output only gained in Git 2.31. */
interface WorktreeAdminDetails {
  locked: string | null
  prunable: string | null
}

/** Reads one of a worktree's admin files, or null when it does not exist. */
async function readAdminFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * Reads the lock reason and the prune reason from `.git/worktrees/<name>`.
 * `git worktree list --porcelain` only prints those from Git 2.31 onwards, so
 * on 2.30 they have to come from the admin folder Git keeps for each worktree.
 */
async function readAdminDetails(
  runner: GitRunner,
  repo: string
): Promise<Map<string, WorktreeAdminDetails>> {
  const details = new Map<string, WorktreeAdminDetails>()
  const common = await runner.run(['rev-parse', '--git-common-dir'], {
    cwd: repo,
    readOnly: true
  })
  if (common.code !== 0) return details

  const commonDir = resolve(repo, common.stdout.toString('utf8').trim())
  let names: string[]
  try {
    const entries = await readdir(join(commonDir, 'worktrees'), { withFileTypes: true })
    names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    // A repository without linked worktrees has no worktrees folder.
    return details
  }

  for (const name of names) {
    const adminDir = join(commonDir, 'worktrees', name)
    const pointer = await readAdminFile(join(adminDir, 'gitdir'))
    if (pointer === null) continue
    // The gitdir file holds the path of the worktree's own `.git` pointer.
    const gitFile = pointer.replace(/\r?\n$/, '')
    if (gitFile === '') continue

    const locked = await readAdminFile(join(adminDir, 'locked'))
    // A locked worktree is left alone even when its folder was deleted.
    const prunable =
      locked === null && !existsSync(gitFile) ? 'gitdir file points to non-existent location' : null
    details.set(canonicalFolder(dirname(gitFile)), {
      locked: locked === null ? null : locked.replace(/\r?\n$/, ''),
      prunable
    })
  }
  return details
}

/** Lists the worktrees Git knows about, the main one first. */
export async function listWorktrees(runner: GitRunner, repo: string): Promise<WorktreeInfo[]> {
  const result = await runner.runOrThrow(['worktree', 'list', '--porcelain'], {
    cwd: repo,
    readOnly: true
  })
  const worktrees = parseWorktrees(result.stdout.toString('utf8'))
  // Only linked worktrees can be locked or pruned, so a lone main worktree
  // needs no second look at Git's admin folders.
  if (worktrees.every((worktree) => worktree.main)) return worktrees

  const details = await readAdminDetails(runner, repo)
  if (details.size === 0) return worktrees

  return worktrees.map((worktree) => {
    if (worktree.main) return worktree
    for (const [path, admin] of details) {
      if (!sameWorktreeFolder(path, worktree.path)) continue
      return {
        ...worktree,
        locked: worktree.locked ?? admin.locked,
        prunable: worktree.prunable ?? admin.prunable
      }
    }
    return worktree
  })
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

/** The absolute path with symlinks and Windows short names resolved. */
function canonicalFolder(path: string): string {
  const absolute = resolve(path)
  try {
    return realpathSync.native(absolute)
  } catch {
    // A prunable worktree has no folder left to resolve, so its absolute path
    // is the best identity Git and the caller can agree on.
    return absolute
  }
}

/**
 * Whether two folder paths point at the same place. Git reports worktree paths
 * with forward slashes, and Windows may use a short name or different letter
 * case for the same folder, so the paths are canonicalised before comparing.
 */
export function sameWorktreeFolder(a: string, b: string): boolean {
  const left = canonicalFolder(a)
  const right = canonicalFolder(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
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
  const source = worktrees.find((worktree) => sameWorktreeFolder(worktree.path, options.sourcePath))
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
