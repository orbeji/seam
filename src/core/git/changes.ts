// SPDX-License-Identifier: MIT

import type { RepoStatus, StatusEntry, UnmergedEntry, UntrackedEntry } from './status'

/**
 * The four lists the changes screen shows. An entry can be both staged and
 * unstaged (porcelain `MM`), in which case it appears in both, like the reference client.
 * Unmerged entries are kept apart so the conflict dialog can own them.
 */
export interface ChangeSummary {
  staged: StatusEntry[]
  unstaged: StatusEntry[]
  untracked: UntrackedEntry[]
  conflicts: UnmergedEntry[]
}

export function summarizeChanges(status: RepoStatus): ChangeSummary {
  const staged: StatusEntry[] = []
  const unstaged: StatusEntry[] = []
  const untracked: UntrackedEntry[] = []
  const conflicts: UnmergedEntry[] = []

  for (const entry of status.entries) {
    switch (entry.kind) {
      case 'untracked':
        untracked.push(entry)
        break
      case 'unmerged':
        conflicts.push(entry)
        break
      case 'ordinary':
      case 'renamed':
        if (entry.x !== '.') staged.push(entry)
        if (entry.y !== '.') unstaged.push(entry)
        break
    }
  }

  return { staged, unstaged, untracked, conflicts }
}
