// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { diffLines } from './lines'
import { alignThree, type AlignedRow } from './three-way'

function align(head: string[], index: string[], worktree: string[]): AlignedRow[] {
  return alignThree(
    head,
    index,
    worktree,
    diffLines(head, index, 'none'),
    diffLines(index, worktree, 'none')
  )
}

/** The lines one column of the rows stands for, in order. */
function column(rows: readonly AlignedRow[], side: keyof AlignedRow, lines: string[]): string[] {
  return rows.filter((row) => row[side] !== null).map((row) => lines[row[side] as number] as string)
}

describe('the three-way alignment', () => {
  it('aligns three equal versions line by line', () => {
    expect(align(['a', 'b'], ['a', 'b'], ['a', 'b'])).toEqual([
      { head: 0, index: 0, worktree: 0 },
      { head: 1, index: 1, worktree: 1 }
    ])
  })

  it('reconstructs each version from its column, in order', () => {
    const cases: Array<[string[], string[], string[]]> = [
      [
        ['a', 'b'],
        ['a', 'b'],
        ['a', 'b']
      ],
      [
        ['a', 'b', 'c'],
        ['a', 'B', 'c'],
        ['a', 'B', 'C']
      ],
      [
        ['a', 'b', 'c'],
        ['a', 'c'],
        ['a', 'c']
      ],
      [
        ['a', 'c'],
        ['a', 'b', 'c'],
        ['a', 'b', 'c']
      ],
      [
        ['a', 'b'],
        ['a', 'b'],
        ['a', 'x', 'b']
      ],
      [
        ['a', 'b', 'c'],
        ['a', 'c'],
        ['a', 'x', 'c']
      ],
      [['x'], ['x', 'y'], ['x', 'y', 'z']],
      [
        ['a', 'b', 'c', 'd'],
        ['a', 'b', 'c'],
        ['a', 'c']
      ]
    ]

    for (const [head, index, worktree] of cases) {
      const rows = align(head, index, worktree)
      expect(column(rows, 'head', head)).toEqual(head)
      expect(column(rows, 'index', index)).toEqual(index)
      expect(column(rows, 'worktree', worktree)).toEqual(worktree)
    }
  })

  it('lines a pending change up with the index it rewrites', () => {
    expect(align(['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'B', 'c'])).toEqual([
      { head: 0, index: 0, worktree: 0 },
      { head: 1, index: 1, worktree: 1 },
      { head: 2, index: 2, worktree: 2 }
    ])
  })

  it('leaves the HEAD column empty on a line added to the index', () => {
    expect(align(['a', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([
      { head: 0, index: 0, worktree: 0 },
      { head: null, index: 1, worktree: 1 },
      { head: 1, index: 2, worktree: 2 }
    ])
  })

  it('gives a line deleted from the index its own row on the HEAD side', () => {
    expect(align(['a', 'b', 'c'], ['a', 'c'], ['a', 'c'])).toEqual([
      { head: 0, index: 0, worktree: 0 },
      { head: 1, index: null, worktree: null },
      { head: 2, index: 1, worktree: 1 }
    ])
  })

  it('gives a line only the working copy has its own row', () => {
    expect(align(['a', 'b'], ['a', 'b'], ['a', 'x', 'b'])).toEqual([
      { head: 0, index: 0, worktree: 0 },
      { head: null, index: null, worktree: 1 },
      { head: 1, index: 1, worktree: 2 }
    ])
  })

  it('keeps a prepared deletion beside a pending insertion', () => {
    expect(align(['a', 'b', 'c'], ['a', 'c'], ['a', 'x', 'c'])).toEqual([
      { head: 0, index: 0, worktree: 0 },
      { head: 1, index: null, worktree: null },
      { head: null, index: null, worktree: 1 },
      { head: 2, index: 1, worktree: 2 }
    ])
  })
})
