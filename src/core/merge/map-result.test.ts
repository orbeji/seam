// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { mapResultRanges } from './map-result'
import { createMerge } from './regions'
import type { MergeRegion } from './types'

function regions(base: string[], left: string[], right: string[]): MergeRegion[] {
  return createMerge(base, left, right).model.regions
}

/** The regions' result ranges as plain arrays, for readable expectations. */
function ranges(list: readonly MergeRegion[]): number[][] {
  return list.map((region) => [region.result.start, region.result.end])
}

describe('mapResultRanges', () => {
  const two = regions(
    ['a', 'b', 'c', 'd', 'e'],
    ['A', 'b', 'c', 'd', 'e'],
    ['a', 'b', 'c', 'd', 'E']
  )

  it('shifts a region that follows an edit', () => {
    const moved = mapResultRanges(two, [{ from: 2, to: 3, insertedLines: ['x', 'y'] }])
    expect(ranges(moved)).toEqual([
      [0, 1],
      [5, 6]
    ])
    expect(moved.every((region) => region.edited)).toBe(false)
  })

  it('leaves a region before the edit where it is', () => {
    const moved = mapResultRanges(two, [{ from: 6, to: 7, insertedLines: [] }])
    expect(ranges(moved)).toEqual([
      [0, 1],
      [4, 5]
    ])
  })

  it('grows and marks edited a region an edit falls inside', () => {
    const moved = mapResultRanges(regions(['a', 'b', 'c'], ['a', 'B', 'c'], ['a', 'C', 'c']), [
      { from: 1, to: 2, insertedLines: ['B1', 'B2'] }
    ])
    expect(ranges(moved)).toEqual([[1, 3]])
    expect(moved[0]?.edited).toBe(true)
  })

  it('grows a region when an edit ends at its start border', () => {
    const moved = mapResultRanges(two, [{ from: 3, to: 4, insertedLines: ['x', 'y'] }])
    expect(ranges(moved)).toEqual([
      [0, 1],
      [3, 6]
    ])
    expect(moved[1]?.edited).toBe(true)
  })

  it('joins a region when text is typed at its start border', () => {
    const moved = mapResultRanges(two, [{ from: 4, to: 4, insertedLines: ['x'] }])
    expect(ranges(moved)).toEqual([
      [0, 1],
      [4, 6]
    ])
    expect(moved[1]?.edited).toBe(true)
  })

  it('joins a region when text is typed at its end border', () => {
    const moved = mapResultRanges(two, [{ from: 1, to: 1, insertedLines: ['x'] }])
    expect(ranges(moved)).toEqual([
      [0, 2],
      [5, 6]
    ])
  })

  it('leaves the regions alone when text is typed in a gap', () => {
    const moved = mapResultRanges(two, [{ from: 2, to: 2, insertedLines: ['x'] }])
    expect(ranges(moved)).toEqual([
      [0, 1],
      [5, 6]
    ])
    expect(moved.every((region) => region.edited)).toBe(false)
  })

  it('gives the inserted text to the first region an edit reaches', () => {
    const adjacent = regions(['a', 'b', 'c'], ['a', 'b', 'c'], ['A', 'b', 'C'])
    // Replace the single unchanged line between the two regions.
    const moved = mapResultRanges(adjacent, [{ from: 1, to: 2, insertedLines: ['x'] }])
    expect(ranges(moved)).toEqual([
      [0, 2],
      [2, 3]
    ])
    expect(moved.every((region) => region.edited)).toBe(true)
  })

  it('applies several edits in the order the editor reported them', () => {
    // The second edit's coordinates are the text as the first edit left it.
    const moved = mapResultRanges(two, [
      { from: 0, to: 1, insertedLines: ['A', 'B'] },
      { from: 1, to: 2, insertedLines: ['C'] }
    ])
    expect(ranges(moved)).toEqual([
      [0, 2],
      [5, 6]
    ])
  })
})
