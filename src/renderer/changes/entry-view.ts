// SPDX-License-Identifier: MIT

import type { StatusEntry } from '../../shared/git'

/** One row of a changes list: a short status badge and the path to show. */
export interface EntryView {
  key: string
  badge: string
  label: string
}

/** The colour family of a file's badge in the sidebar. */
export type BadgeTone = 'modified' | 'added' | 'deleted' | 'untracked' | 'conflict'

/** A file row's one-letter badge and the colour it uses. */
export interface FileBadge {
  letter: string
  tone: BadgeTone
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

/**
 * The compact badge the sidebar shows. Git's two porcelain letters are useful
 * in a table but too wide for a 18px square, so a row is reduced to the one
 * letter that best describes it: added, deleted, renamed, modified or a
 * conflict. The badge still carries colour, so a modified file reads as blue
 * and a conflict as red even when both say `M`/`U`.
 */
export function fileBadge(entry: StatusEntry): FileBadge {
  switch (entry.kind) {
    case 'untracked':
      return { letter: '?', tone: 'untracked' }
    case 'unmerged':
      return { letter: 'U', tone: 'conflict' }
    case 'renamed':
      return { letter: 'R', tone: 'modified' }
    case 'ordinary': {
      const letters = `${entry.x}${entry.y}`
      if (letters.includes('U')) return { letter: 'U', tone: 'conflict' }
      if (letters.includes('A')) return { letter: 'A', tone: 'added' }
      if (letters.includes('D')) return { letter: 'D', tone: 'deleted' }
      if (letters.includes('R')) return { letter: 'R', tone: 'modified' }
      if (letters.includes('C')) return { letter: 'C', tone: 'modified' }
      if (letters.includes('T')) return { letter: 'T', tone: 'modified' }
      return { letter: 'M', tone: 'modified' }
    }
  }
}
