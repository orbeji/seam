// SPDX-License-Identifier: MIT

import { GitError } from './errors'
import type { GitRunner } from './runner'

/** A local or remote branch. */
export interface BranchInfo {
  /** The branch name (e.g., "main", "feature/x"). */
  readonly name: string
  /** The commit OID the branch points to. */
  readonly oid: string
  /** Whether this is the currently checked-out branch. */
  readonly current: boolean
  /** For remote branches: the remote name (e.g., "origin"). */
  readonly remote?: string
}

/** The list of branches, split into local and remote. */
export interface BranchList {
  readonly local: readonly BranchInfo[]
  readonly remote: readonly BranchInfo[]
}

/**
 * Parses `git for-each-ref` output for local branches.
 * Refs are line-separated; each line's fields are NUL-separated.
 * Format: %(refname:short)%00%(objectname)%00%(HEAD)
 */
function parseLocalBranches(output: string): BranchInfo[] {
  const branches: BranchInfo[] = []
  for (const line of output.split('\n')) {
    if (line === '') continue
    const [name, oid, head] = line.split('\0')
    if (name === undefined || oid === undefined) continue
    branches.push({
      name,
      oid,
      current: head === '*'
    })
  }
  return branches
}

/**
 * Parses `git for-each-ref` output for remote branches.
 * Refs are line-separated; each line's fields are NUL-separated.
 * Format: %(refname:short)%00%(objectname)%00%(upstream:short)
 */
function parseRemoteBranches(output: string): BranchInfo[] {
  const branches: BranchInfo[] = []
  for (const line of output.split('\n')) {
    if (line === '') continue
    const [name, oid] = line.split('\0')
    if (name === undefined || oid === undefined) continue
    // Extract remote name from refname (e.g., "origin/main" -> remote="origin")
    const slashIndex = name.indexOf('/')
    const remote = slashIndex > 0 ? name.slice(0, slashIndex) : ''
    if (remote === '') continue
    // The bare "<remote>" ref is the commit the remote's HEAD points to and
    // "<remote>/HEAD" repeats it symbolically; neither is a branch to check out.
    if (name === `${remote}/HEAD`) continue
    branches.push({
      name,
      oid,
      current: false,
      remote
    })
  }
  return branches
}

/**
 * Lists all local and remote branches.
 */
export async function listBranches(runner: GitRunner, repo: string): Promise<BranchList> {
  const [localResult, remoteResult] = await Promise.all([
    runner.run(
      ['for-each-ref', '--format=%(refname:short)%00%(objectname)%00%(HEAD)', 'refs/heads/'],
      { cwd: repo, readOnly: true }
    ),
    runner.run(
      [
        'for-each-ref',
        '--format=%(refname:short)%00%(objectname)%00%(upstream:short)',
        'refs/remotes/'
      ],
      { cwd: repo, readOnly: true }
    )
  ])

  const local =
    localResult.code === 0 ? parseLocalBranches(localResult.stdout.toString('utf8')) : []
  const remote =
    remoteResult.code === 0 ? parseRemoteBranches(remoteResult.stdout.toString('utf8')) : []

  return { local, remote }
}

/** How a branch is created, and what it starts from. */
export interface CreateBranchOptions {
  /** The new branch's name, such as `feature/login`. */
  readonly name: string
  /** The branch, tag or commit to start from; empty starts at HEAD. */
  readonly startPoint?: string | null
  /** Whether to check the branch out after creating it. Defaults to true. */
  readonly checkout?: boolean
}

/**
 * Asks Git whether a branch name is valid, so the interface can show the same
 * refusal a terminal would instead of a half-made ref. `git check-ref-format
 * --branch` also rejects names that would be read as options.
 */
export async function validateBranchName(
  runner: GitRunner,
  repo: string,
  name: string
): Promise<void> {
  if (name.trim() === '') throw new GitError('A branch name cannot be empty.')
  await runner.runOrThrow(['check-ref-format', '--branch', name], { cwd: repo, readOnly: true })
}

/** Creates a branch from HEAD or from a chosen start point. */
export async function createBranch(
  runner: GitRunner,
  repo: string,
  options: CreateBranchOptions
): Promise<void> {
  await validateBranchName(runner, repo, options.name)
  const startPoint = options.startPoint?.trim() ?? ''
  const base = startPoint === '' ? [] : [startPoint]
  const args =
    options.checkout === false
      ? ['branch', options.name, ...base]
      : ['checkout', '-b', options.name, ...base]
  await runner.runOrThrow(args, { cwd: repo })
}

/** Renames a local branch, including the checked-out one. */
export async function renameBranch(
  runner: GitRunner,
  repo: string,
  oldName: string,
  newName: string
): Promise<void> {
  await validateBranchName(runner, repo, newName)
  await runner.runOrThrow(['branch', '-m', oldName, newName], { cwd: repo })
}

/**
 * Deletes a local branch. Git refuses the checked-out branch; `force` maps to
 * `-D` and throws away the commits that were not merged.
 */
export async function deleteBranch(
  runner: GitRunner,
  repo: string,
  name: string,
  force = false
): Promise<void> {
  if (name.trim() === '') throw new GitError('A branch name cannot be empty.')
  await runner.runOrThrow(['branch', force ? '-D' : '-d', name], { cwd: repo })
}

/**
 * Checks out one commit, leaving HEAD detached at it. It is what the history
 * view does when a commit is opened as a working point.
 *
 * The id must look like a commit id: a branch name would check out the branch
 * and keep HEAD attached, which is a different operation. Git still decides
 * whether the checkout is safe; uncommitted changes that would be overwritten
 * make it refuse instead of losing them.
 */
export async function checkoutCommit(runner: GitRunner, repo: string, oid: string): Promise<void> {
  if (!/^[0-9a-f]{4,64}$/i.test(oid)) {
    throw new GitError('A commit id is needed to check out a commit.')
  }
  await runner.runOrThrow(['checkout', '--detach', oid], { cwd: repo })
}

/**
 * Checks out a branch. If the branch is a remote branch (contains '/'), fetches first
 * and creates a local tracking branch.
 */
export async function checkoutBranch(
  runner: GitRunner,
  repo: string,
  branch: string,
  createTracking = true
): Promise<void> {
  const isRemote = branch.includes('/')

  if (isRemote && createTracking) {
    // For remote branches, fetch first then create local tracking branch
    const parts = branch.split('/')
    const remoteName = parts[0]!
    const remoteBranch = parts.slice(1).join('/')
    const localBranch = remoteBranch

    // Fetch the remote
    await runner.runOrThrow(['fetch', remoteName], { cwd: repo })

    // Create local branch tracking the remote
    try {
      await runner.runOrThrow(['checkout', '-b', localBranch, `${remoteName}/${remoteBranch}`], {
        cwd: repo
      })
    } catch {
      // A local branch with that name already exists: switch to it instead, so
      // picking a remote branch the repo already tracks is not an error.
      await runner.runOrThrow(['checkout', localBranch], { cwd: repo })
    }
  } else {
    // Local branch checkout
    await runner.runOrThrow(['checkout', branch], { cwd: repo })
  }
}
