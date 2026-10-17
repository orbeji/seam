// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { buildFileModel } from '../../core/diff'
import type { TextLines } from '../../core/text'
import { markerLines, type MarkerLine } from './staging-markers'

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
