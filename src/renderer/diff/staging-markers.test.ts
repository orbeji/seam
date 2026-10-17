// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { buildFileModel } from '../../core/diff'
import type { TextLines } from '../../core/text'
import { hunkPatchLines, markerLines, selectionAt, type MarkerLine } from './staging-markers'

function lines(contents: readonly string[]): TextLines {
  return { lines: [...contents], finalNewline: false }
}

/** The markers of a file, built from its three versions the way the viewer does. */
function markers(
  head: string[] | null,
  index: string[] | null,
  worktree: string[] | null
): MarkerLine[] {
  return markerLines(
    buildFileModel(
      head === null ? null : lines(head),
      index === null ? null : lines(index),
      worktree === null ? null : lines(worktree)
    )
  )
}

describe('the staging margin markers', () => {
  it('draws nothing when the three versions agree', () => {
    expect(markers(['a', 'b'], ['a', 'b'], ['a', 'b'])).toEqual([])
  })

  it('draws a solid marker on a change still to prepare', () => {
    expect(markers(['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'B', 'c'])).toEqual([
      { line: 1, staged: false, unstaged: true }
    ])
  })

  it('draws a hollow marker on a prepared insertion', () => {
    expect(markers(['a', 'b', 'c'], ['a', 'b', 'x', 'c'], ['a', 'b', 'x', 'c'])).toEqual([
      { line: 2, staged: true, unstaged: false }
    ])
  })

  it('draws a prepared deletion as a point on the following line', () => {
    expect(markers(['a', 'b', 'c'], ['a', 'c'], ['a', 'c'])).toEqual([
      { line: 1, staged: true, unstaged: false }
    ])
  })

  it('draws a deletion at the very top on the first line', () => {
    expect(markers(['a', 'b'], ['b'], ['b'])).toEqual([{ line: 0, staged: true, unstaged: false }])
  })

  it('draws a pending deletion at the end on the last line', () => {
    expect(markers(['a', 'b'], ['a', 'b'], ['a'])).toEqual([
      { line: 0, staged: false, unstaged: true }
    ])
  })

  it('covers every line of a multi-line change', () => {
    expect(markers(['a', 'b', 'c', 'd'], ['a', 'X', 'Y', 'd'], ['a', 'X', 'Y', 'd'])).toEqual([
      { line: 1, staged: true, unstaged: false },
      { line: 2, staged: true, unstaged: false }
    ])
  })

  it('marks a line both ways when a prepared change was rewritten afterwards', () => {
    expect(markers(['a', 'b', 'c'], ['a', 'b!', 'c'], ['a', 'b?', 'c'])).toEqual([
      { line: 1, staged: true, unstaged: true }
    ])
  })

  it('draws a new file as a solid marker on every line', () => {
    expect(markers(null, null, ['x', 'y'])).toEqual([
      { line: 0, staged: false, unstaged: true },
      { line: 1, staged: false, unstaged: true }
    ])
  })

  it('draws a fully prepared file as hollow markers only', () => {
    expect(markers(['a'], ['a', 'b'], ['a', 'b'])).toEqual([
      { line: 1, staged: true, unstaged: false }
    ])
  })
})

describe('the selected lines of an unstaged hunk', () => {
  it('turns selected working-copy lines into patch lines', () => {
    const insertion = { aStart: 2, aLines: 0, bStart: 2, bLines: 3 }

    // With no index lines to list first, the first working-copy line is 0.
    expect(hunkPatchLines(insertion, [2])).toEqual([0])
    expect(hunkPatchLines(insertion, [3])).toEqual([1])
    expect(hunkPatchLines(insertion, [2, 3])).toEqual([0, 1])
    // A selection outside the hunk, or a repeated line, contributes nothing.
    expect(hunkPatchLines(insertion, [0, 1, 9])).toEqual([])
    expect(hunkPatchLines(insertion, [2, 2])).toEqual([0])
  })

  it('lists a modified line after the index line it replaces', () => {
    const modified = { aStart: 1, aLines: 1, bStart: 1, bLines: 1 }

    expect(hunkPatchLines(modified, [1])).toEqual([1])
  })

  it('finds the hunk under the marker and the selected working-copy lines it holds', () => {
    const model = buildFileModel(
      lines(['one', 'five']),
      lines(['one', 'five']),
      lines(['one', 'A', 'B', 'C', 'five'])
    )
    const hunk = model.unstaged[0]
    expect(hunk).toBeDefined()

    expect(selectionAt(model, 1, [1])).toEqual({ hunk, lines: [0] })
    expect(selectionAt(model, 1, [3])).toEqual({ hunk, lines: [2] })
    // A line outside the hunk under the marker selects nothing.
    expect(selectionAt(model, 1, [0, 4])).toBeNull()
  })
})
