// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { entryView } from '../src/renderer/changes/entry-view'
import type { StatusEntry } from '../src/shared/git'

const modes = { head: '100644', index: '100644', worktree: '100644' }

describe('entryView', () => {
  it('shows the XY letters of an ordinary entry', () => {
    const entry: StatusEntry = { kind: 'ordinary', x: 'M', y: '.', path: 'a.txt', modes }
    expect(entryView(entry)).toEqual({ key: 'a.txt', badge: 'M.', label: 'a.txt' })
  })

  it('shows both paths of a rename', () => {
    const entry: StatusEntry = {
      kind: 'renamed',
      x: 'R',
      y: '.',
      path: 'new.txt',
      origPath: 'old.txt',
      score: 100
    }
    expect(entryView(entry)).toEqual({ key: 'new.txt', badge: 'R.', label: 'old.txt → new.txt' })
  })

  it('shows the conflict code of an unmerged entry', () => {
    const entry: StatusEntry = { kind: 'unmerged', xy: 'UU', path: 'both.txt', modes }
    expect(entryView(entry)).toEqual({ key: 'both.txt', badge: 'UU', label: 'both.txt' })
  })

  it('uses a question mark for an untracked entry', () => {
    const entry: StatusEntry = { kind: 'untracked', path: 'new.txt' }
    expect(entryView(entry)).toEqual({ key: 'new.txt', badge: '?', label: 'new.txt' })
  })
})
