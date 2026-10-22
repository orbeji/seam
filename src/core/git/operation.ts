// SPDX-License-Identifier: MIT

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { GitOperation, RebaseProgress } from '../../shared/git'
import type { GitRunner } from './runner'

/**
 * Markers in the order they are checked. `rebase` has two: `rebase-merge` for
 * the interactive and merge backends, `rebase-apply` for the am backend. A
 * `stash pop` leaves conflicts but no marker, so it is not listed here and is
 * recognised in phase 5 from the unmerged entries alone.
 */
const MARKERS: ReadonlyArray<readonly [GitOperation, string]> = [
  ['merge', 'MERGE_HEAD'],
  ['cherry-pick', 'CHERRY_PICK_HEAD'],
  ['revert', 'REVERT_HEAD'],
  ['rebase', 'rebase-merge'],
  ['rebase', 'rebase-apply']
]

/**
 * Asks Git where a state file lives instead of assuming `.git/`, so the check
 * also works in worktrees and submodules where the git directory is elsewhere.
 */
export async function gitStatePath(runner: GitRunner, repo: string, name: string): Promise<string> {
  const result = await runner.runOrThrow(['rev-parse', '--git-path', name], {
    cwd: repo,
    readOnly: true
  })
  const raw = result.stdout.toString('utf8').trim()
  return isAbsolute(raw) ? raw : resolve(repo, raw)
}

/** Reads a state file, or null when it does not exist or is empty. */
export async function readGitStateFile(
  runner: GitRunner,
  repo: string,
  name: string
): Promise<string | null> {
  try {
    const text = await readFile(await gitStatePath(runner, repo, name), 'utf8')
    const value = text.trim()
    return value === '' ? null : value
  } catch {
    return null
  }
}

async function markerExists(runner: GitRunner, repo: string, marker: string): Promise<boolean> {
  const path = await gitStatePath(runner, repo, marker)
  return existsSync(path)
}

/** Returns the operation currently in progress, or null for an idle repository. */
export async function detectOperation(
  runner: GitRunner,
  repo: string
): Promise<GitOperation | null> {
  for (const [operation, marker] of MARKERS) {
    if (await markerExists(runner, repo, marker)) return operation
  }
  return null
}

/** A positive integer from a state file, or null when it is missing or odd. */
function stepNumber(value: string | null): number | null {
  if (value === null) return null
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

/**
 * How far a rebase has got. The merge backend writes `rebase-merge/msgnum` and
 * `end`; the am backend writes `rebase-apply/next` and `last`. Both count from
 * one, which is what the dialog shows as «commit 3 of 7».
 */
export async function readRebaseProgress(
  runner: GitRunner,
  repo: string
): Promise<RebaseProgress | null> {
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ['rebase-merge/msgnum', 'rebase-merge/end'],
    ['rebase-apply/next', 'rebase-apply/last']
  ]

  for (const [currentFile, totalFile] of pairs) {
    const [current, total] = await Promise.all([
      readGitStateFile(runner, repo, currentFile),
      readGitStateFile(runner, repo, totalFile)
    ])
    const step = stepNumber(current)
    const steps = stepNumber(total)
    if (step !== null && steps !== null) return { current: step, total: steps }
  }
  return null
}
