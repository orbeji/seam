// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { createMerge } from '../src/core/merge'
import {
  acceptRegion,
  applyNonConflictingRegions,
  buildMergeRows,
  canApplyMerge,
  conflictRegions,
  editResultLine,
  hasNonConflicting,
  ignoreRegion,
  mergeResultText,
  mergeStats,
  resolveRegion,
  resolveSimpleRegions,
  revertRegion
} from '../src/renderer/merge/model'

/** A merge state with one conflicting line in the middle. */
function conflict(): ReturnType<typeof createMerge> {
  return createMerge(['one', 'two', 'three'], ['one', 'left', 'three'], ['one', 'right', 'three'])
}

describe('buildMergeRows', () => {
  it('aligns every side and pads the shorter ones with empty cells', () => {
    const state = createMerge(
      ['one', 'two', 'three'],
      ['one', 'left', 'three', 'four'],
      ['one', 'right']
    )
    const rows = buildMergeRows(state)
    const region = rows.filter((row) => row.regionId !== null)

    expect(region.map((row) => row.leftText)).toEqual(['left', 'three', 'four'])
    expect(region.map((row) => row.rightText)).toEqual(['right', null, null])
    expect(region.map((row) => row.resultText)).toEqual(['two', 'three', null])
    expect(region.map((row) => row.leftLine)).toEqual([2, 3, 4])
    expect(region.map((row) => row.rightLine)).toEqual([2, null, null])
  })

  it('keeps line numbers of each version independent after a region grows', () => {
    const state = createMerge(['a', 'b', 'c'], ['a', 'B1', 'B2', 'c'], ['a', 'b', 'c'])
    const rows = buildMergeRows(state)
    const left = rows.filter((row) => row.leftText !== null)
    const right = rows.filter((row) => row.rightText !== null)

    expect(left.map((row) => row.leftLine)).toEqual([1, 2, 3, 4])
    expect(right.map((row) => row.rightLine)).toEqual([1, 2, 3])
    expect(rows.at(-1)?.leftText).toBe('c')
    expect(rows.at(-1)?.rightText).toBe('c')
  })
})

describe('merge actions', () => {
  it('accepts and ignores the two sides of a conflict', () => {
    const state = conflict()
    const region = conflictRegions(state)[0]
    expect(region).toBeDefined()
    if (region === undefined) return

    const withLeft = acceptRegion(state, region.id, 'left')
    const current = withLeft.model.regions.find((candidate) => candidate.id === region.id)
    expect(current?.leftState).toBe('applied')
    expect(current?.rightState).toBe('pending')
    expect(withLeft.result).toEqual(['one', 'left', 'three'])
    expect(canApplyMerge(withLeft)).toBe(false)

    const withIgnore = ignoreRegion(withLeft, region.id, 'right')
    expect(canApplyMerge(withIgnore)).toBe(true)
    expect(withIgnore.result).toEqual(['one', 'left', 'three'])
  })

  it('resolves a conflict with one side in a single action', () => {
    const state = conflict()
    const region = conflictRegions(state)[0]
    if (region === undefined) throw new Error('no conflict region')

    const next = resolveRegion(state, region.id, 'right')
    const current = next.model.regions.find((candidate) => candidate.id === region.id)
    expect(current?.rightState).toBe('applied')
    expect(current?.leftState).toBe('ignored')
    expect(next.result).toEqual(['one', 'right', 'three'])
    expect(canApplyMerge(next)).toBe(true)
  })

  it('reverts a region to the common ancestor and marks it pending again', () => {
    const state = conflict()
    const region = conflictRegions(state)[0]
    if (region === undefined) throw new Error('no conflict region')
    const resolved = resolveRegion(state, region.id, 'left')
    const reverted = revertRegion(resolved, region.id)
    const current = reverted.model.regions.find((candidate) => candidate.id === region.id)
    expect(current?.leftState).toBe('pending')
    expect(current?.rightState).toBe('pending')
    expect(reverted.result).toEqual(['one', 'two', 'three'])
  })

  it('applies the non-conflicting regions from both sides', () => {
    const state = createMerge(
      ['a', 'b', 'c', 'd', 'e'],
      ['a', 'B', 'c', 'd', 'e'],
      ['a', 'b', 'c', 'D', 'e']
    )
    expect(hasNonConflicting(state, 'all')).toBe(true)
    expect(hasNonConflicting(state, 'left')).toBe(true)
    expect(mergeStats(state).nonConflicting).toBe(2)

    const next = applyNonConflictingRegions(state, 'all')
    expect(next.result).toEqual(['a', 'B', 'c', 'D', 'e'])
    expect(mergeStats(next).resolved).toBe(2)
    expect(hasNonConflicting(next, 'all')).toBe(false)
  })

  it('has nothing simple to resolve in a normal conflict', () => {
    const state = conflict()
    expect(resolveSimpleRegions(state)).toBe(state)
  })
})

describe('editing the result', () => {
  it('replaces a line, marks its region edited and keeps the ranges in step', () => {
    const state = conflict()
    const region = conflictRegions(state)[0]
    if (region === undefined) throw new Error('no conflict region')
    const line = region.result.start

    const next = editResultLine(state, line, 'hand')
    const current = next.model.regions.find((candidate) => candidate.id === region.id)
    expect(next.result[line]).toBe('hand')
    expect(current?.edited).toBe(true)
    expect(next.result).toEqual(['one', 'hand', 'three'])
    expect(buildMergeRows(next).find((row) => row.regionId === region.id)?.resultText).toBe('hand')
  })

  it('sends a region back to pending when its line is emptied', () => {
    const state = conflict()
    const region = conflictRegions(state)[0]
    if (region === undefined) throw new Error('no conflict region')
    const line = region.result.start
    const edited = editResultLine(state, line, 'hand')
    const emptied = editResultLine(edited, line, '')
    const current = emptied.model.regions.find((candidate) => candidate.id === region.id)

    expect(emptied.result[line]).toBe('three')
    expect(current?.edited).toBe(false)
    expect(current?.leftState).toBe('pending')
    expect(current?.rightState).toBe('pending')
    expect(canApplyMerge(emptied)).toBe(false)
  })

  it('lets a paste bring several lines and shifts the regions after it', () => {
    const state = createMerge(['a', 'b', 'c'], ['a', 'B', 'c'], ['a', 'b', 'c'])
    const next = editResultLine(state, 1, 'first\nsecond')
    expect(next.result).toEqual(['a', 'first', 'second', 'c'])
    const last = buildMergeRows(next).at(-1)
    expect(last?.resultLine).toBe(4)
  })

  it('writes the result with the file final newline', () => {
    const state = conflict()
    expect(mergeResultText(state, true)).toBe('one\ntwo\nthree\n')
    expect(mergeResultText(state, false)).toBe('one\ntwo\nthree')
    expect(mergeResultText({ model: state.model, result: [] }, true)).toBe('')
  })
})
