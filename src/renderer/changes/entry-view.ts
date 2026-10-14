// SPDX-License-Identifier: MIT

import type { StatusEntry } from '../../shared/git'

/** One row of a changes list: a short status badge and the path to show. */
export interface EntryView {
  key: string
  badge: string
  label: string
}

/**
 * Turns a status entry into a row. The badges are Git's own letters (porcelain
 * `X`/`Y` for ordinary and renamed entries, the conflict code for unmerged
 * ones), so nothing here needs translation. A rename shows both paths.
 */
export function entryView(entry: StatusEntry): EntryView {
  switch (entry.kind) {
    case 'untracked':
      return { key: entry.path, badge: '?', label: entry.path }
    case 'unmerged':
      return { key: entry.path, badge: entry.xy, label: entry.path }
    case 'renamed':
      return {
        key: entry.path,
        badge: `${entry.x}${entry.y}`,
        label: `${entry.origPath} → ${entry.path}`
      }
    case 'ordinary':
      return { key: entry.path, badge: `${entry.x}${entry.y}`, label: entry.path }
  }
}
