// SPDX-License-Identifier: MIT

import type {
  ChangeSummary,
  RepoStatus,
  StatusEntry,
  UnmergedEntry,
  UntrackedEntry
} from '../../shared/git'

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
