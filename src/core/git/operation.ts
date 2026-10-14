// SPDX-License-Identifier: MIT

import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { GitOperation } from '../../shared/git'
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
 * Asks Git where a marker lives instead of assuming `.git/`, so the check also
 * works in worktrees and submodules where the git directory is elsewhere.
 */
async function markerExists(runner: GitRunner, repo: string, marker: string): Promise<boolean> {
  const result = await runner.runOrThrow(['rev-parse', '--git-path', marker], {
    cwd: repo,
    readOnly: true
  })
  const raw = result.stdout.toString('utf8').trim()
  if (raw === '') return false
  return existsSync(isAbsolute(raw) ? raw : resolve(repo, raw))
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
