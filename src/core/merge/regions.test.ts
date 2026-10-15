// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { createMerge } from './regions'
import type { MergeRegion } from './types'

/** A compact view of a region, for readable expectations. */
function shape(region: MergeRegion): [number, string, number[], number[], number[]] {
  return [
    region.id,
    region.kind,
    [region.base.start, region.base.end],
    [region.left.start, region.left.end],
    [region.right.start, region.right.end]
  ]
}

describe('createMerge', () => {
  it('starts the result as the base', () => {
    const state = createMerge(['a', 'b', 'c'], ['a', 'B', 'c'], ['a', 'b', 'C'])
    expect(state.result).toEqual(['a', 'b', 'c'])
    expect(state.model.regions.map((region) => region.result)).toEqual(
      state.model.regions.map((region) => region.base)
    )
  })

  it('keeps two changes apart when a line separates them', () => {
    const state = createMerge(
      ['a', 'b', 'c', 'd', 'e'],
      ['A', 'b', 'c', 'd', 'e'],
      ['a', 'b', 'c', 'd', 'E']
    )
    expect(state.model.regions.map(shape)).toEqual([
      [0, 'left-only', [0, 1], [0, 1], [0, 1]],
      [1, 'right-only', [4, 5], [4, 5], [4, 5]]
    ])
  })

  it('joins hunks that touch, because Git treats contiguous changes as one', () => {
    const state = createMerge(['a', 'b', 'c', 'd'], ['a', 'B', 'c', 'd'], ['a', 'b', 'C', 'd'])
    expect(state.model.regions.map(shape)).toEqual([[0, 'conflict', [1, 3], [1, 3], [1, 3]]])
    expect(state.model.regions[0]?.leftState).toBe('pending')
    expect(state.model.regions[0]?.rightState).toBe('pending')
  })

  it('classifies a change both sides made the same way as same', () => {
    const state = createMerge(['a', 'b', 'c'], ['a', 'B', 'c'], ['a', 'B', 'c'])
    expect(state.model.regions.map(shape)).toEqual([[0, 'same', [1, 2], [1, 2], [1, 2]]])
    expect(state.model.regions[0]?.leftState).toBe('pending')
    expect(state.model.regions[0]?.rightState).toBe('pending')
  })

  it('classifies two different changes over the same lines as a conflict', () => {
    const state = createMerge(['a', 'b', 'c'], ['a', 'B', 'c'], ['a', 'C', 'c'])
    expect(state.model.regions.map(shape)).toEqual([[0, 'conflict', [1, 2], [1, 2], [1, 2]]])
  })

  it('gives an empty base range to an insertion both sides made in place', () => {
    const state = createMerge(['a', 'b'], ['a', 'x', 'b'], ['a', 'y', 'b'])
    expect(state.model.regions.map(shape)).toEqual([[0, 'conflict', [1, 1], [1, 2], [1, 2]]])
    expect(state.model.regions[0]?.result).toEqual({ start: 1, end: 1 })
  })

  it('handles adding a file on both sides (empty base)', () => {
    const state = createMerge([], ['x'], ['y'])
    expect(state.model.regions.map(shape)).toEqual([[0, 'conflict', [0, 0], [0, 1], [0, 1]]])
    expect(state.model.regions[0]?.simple).toBe(false)
  })

  it('handles a delete against a modify', () => {
    const state = createMerge(['a', 'b', 'c'], [], ['a', 'B', 'c'])
    expect(state.model.regions.map(shape)).toEqual([[0, 'conflict', [0, 3], [0, 0], [0, 3]]])
    expect(state.model.regions[0]?.simple).toBe(false)
  })

  it('shrinks the side range when a side deletes more than it keeps', () => {
    const state = createMerge(['a', 'b', 'c'], ['a'], ['a', 'b', 'c'])
    expect(state.model.regions.map(shape)).toEqual([[0, 'left-only', [1, 3], [1, 1], [1, 3]]])
  })

  it('keeps the side offsets straight for a later region', () => {
    const state = createMerge(['a', 'b', 'c', 'd'], ['a', 'x', 'y', 'c', 'd'], ['a', 'b', 'c', 'D'])
    // The left side inserted a line before the second region, so its range for
    // the region is shifted by one; the right side is not.
    expect(state.model.regions.map(shape)).toEqual([
      [0, 'left-only', [1, 2], [1, 3], [1, 2]],
      [1, 'right-only', [3, 4], [4, 5], [3, 4]]
    ])
  })

  it('covers the first and last lines', () => {
    const state = createMerge(['a', 'b', 'c'], ['A', 'b', 'c'], ['a', 'b', 'C'])
    expect(state.model.regions.map(shape)).toEqual([
      [0, 'left-only', [0, 1], [0, 1], [0, 1]],
      [1, 'right-only', [2, 3], [2, 3], [2, 3]]
    ])
  })

  it('marks a conflict as simple when the sides changed different words', () => {
    const state = createMerge(
      ['hello world', 'next'],
      ['HELLO world', 'next'],
      ['hello there', 'next']
    )
    expect(state.model.regions).toHaveLength(1)
    expect(state.model.regions[0]?.kind).toBe('conflict')
    expect(state.model.regions[0]?.simple).toBe(true)
  })

  it('does not mark a conflict as simple when both sides changed the same word', () => {
    const state = createMerge(['hello', 'next'], ['HELLO', 'next'], ['heLLO', 'next'])
    expect(state.model.regions[0]?.kind).toBe('conflict')
    expect(state.model.regions[0]?.simple).toBe(false)
  })

  it('has no regions when the three versions are equal', () => {
    const state = createMerge(['a', 'b'], ['a', 'b'], ['a', 'b'])
    expect(state.model.regions).toEqual([])
    expect(state.result).toEqual(['a', 'b'])
  })
})
