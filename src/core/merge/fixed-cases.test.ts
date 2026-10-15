// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { accept, applyNonConflicting, ignore, isMergeResolved } from './operations'
import { createMerge } from './regions'

/**
 * The fixed cases the phase names one by one: a block moved inside a side,
 * whitespace-only changes, different line endings, the first and the last line,
 * and a round trip through the operations. They are the shapes that broke the
 * naive line merge, so they stay pinned.
 */

/** The file after the non-conflicting regions are applied. */
function merged(
  base: readonly string[],
  left: readonly string[],
  right: readonly string[]
): string[] {
  return applyNonConflicting(createMerge(base, left, right), 'all').state.result
}

describe('fixed cases', () => {
  it('follows a block moved inside one side when the other is unchanged', () => {
    const base = ['a', 'b', 'c', 'd', 'e', 'f']
    const left = ['a', 'c', 'd', 'b', 'e', 'f']
    expect(merged(base, left, base)).toEqual(left)
  })

  it('keeps a moved block against an edit elsewhere on the other side', () => {
    const base = ['a', 'b', 'c', 'd', 'e', 'f']
    const left = ['a', 'c', 'd', 'b', 'e', 'f']
    const right = ['a', 'b', 'c', 'd', 'e', 'F']
    const state = createMerge(base, left, right)
    expect(state.model.regions.every((region) => region.kind !== 'conflict')).toBe(true)
    expect(merged(base, left, right)).toEqual(['a', 'c', 'd', 'b', 'e', 'F'])
  })

  it('takes a whitespace-only change on either side', () => {
    const base = ['let x = 1', 'let y = 2', 'let z = 3']
    const left = ['let x = 1 ', 'let y = 2', 'let z = 3']
    const right = ['let x = 1', 'let y = 2', 'let z = 3 ']
    expect(merged(base, left, right)).toEqual(['let x = 1 ', 'let y = 2', 'let z = 3 '])
  })

  it('treats a line ending change as a change to that line', () => {
    const state = createMerge(['a\r', 'b'], ['a\r', 'b'], ['a', 'b'])
    expect(state.model.regions).toHaveLength(1)
    expect(state.model.regions[0]?.kind).toBe('right-only')
    expect(state.model.regions[0]?.base).toEqual({ start: 0, end: 1 })
    expect(applyNonConflicting(state, 'all').state.result).toEqual(['a', 'b'])
  })

  it('covers the first line, the last line and nothing else', () => {
    const state = createMerge(['a', 'b', 'c'], ['A', 'b', 'c'], ['a', 'b', 'C'])
    expect(state.model.regions.map((region) => region.kind)).toEqual(['left-only', 'right-only'])
    expect(applyNonConflicting(state, 'all').state.result).toEqual(['A', 'b', 'C'])
  })

  it('becomes resolved after the non-conflicting regions are applied', () => {
    const state = createMerge(['a', 'b', 'c'], ['A', 'b', 'c'], ['a', 'b', 'C'])
    expect(isMergeResolved(state)).toBe(false)
    expect(isMergeResolved(applyNonConflicting(state, 'all').state)).toBe(true)
  })

  it('round-trips a conflict through accept and ignore', () => {
    const state = createMerge(['a', 'b', 'c'], ['a', 'L', 'c'], ['a', 'R', 'c'])
    const conflict = state.model.regions[0]
    expect(conflict?.kind).toBe('conflict')
    expect(isMergeResolved(state)).toBe(false)

    // Accepting one side leaves the other pending, so the conflict is only
    // resolved once that side is dealt with too.
    const accepted = accept(state, conflict!.id, 'left').state
    expect(accepted.result).toEqual(['a', 'L', 'c'])
    expect(isMergeResolved(accepted)).toBe(false)
    expect(isMergeResolved(ignore(accepted, conflict!.id, 'right').state)).toBe(true)
  })

  it('keeps both sides when both are accepted', () => {
    const state = createMerge(['a', 'b', 'c'], ['a', 'L', 'c'], ['a', 'R', 'c'])
    const conflict = state.model.regions[0]!
    const both = accept(accept(state, conflict.id, 'left').state, conflict.id, 'right').state
    expect(both.result).toEqual(['a', 'L', 'R', 'c'])
    expect(isMergeResolved(both)).toBe(true)
  })
})
