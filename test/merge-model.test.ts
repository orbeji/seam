// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import {
  applyNonConflicting,
  createMerge,
  mapResultRanges,
  type MergeRegion,
  type ResultEdit
} from '../src/core/merge'
import {
  describeCase,
  mulberry32,
  randomLines,
  randomMergeCase,
  reconstructSide
} from './fixtures/merge-cases'

/**
 * The engine's invariants over thousands of random cases. They do not depend on
 * Git: the sides must be reconstructible from the regions, and the result
 * ranges must stay sound after any sequence of edits.
 */

const COVERAGE_CASES = 3000
const EDIT_CASES = 2000

/** Replays edits over a text, the way an editor would. */
function applyEdits(lines: readonly string[], edits: readonly ResultEdit[]): string[] {
  const out = [...lines]
  for (const edit of edits) out.splice(edit.from, edit.to - edit.from, ...edit.insertedLines)
  return out
}

/** A few valid edits for a text of `length` lines, in order. */
function randomEdits(random: () => number, length: number): ResultEdit[] {
  const edits: ResultEdit[] = []
  const count = Math.floor(random() * 4)
  let size = length
  for (let index = 0; index < count; index += 1) {
    const from = Math.floor(random() * (size + 1))
    const to = Math.min(size, from + Math.floor(random() * 3))
    const insertedLines = randomLines(random, ['x', 'y'], 3)
    edits.push({ from, to, insertedLines })
    size += insertedLines.length - (to - from)
  }
  return edits
}

function expectSound(regions: readonly MergeRegion[], length: number): void {
  let previousEnd = 0
  for (const region of regions) {
    expect(region.result.start).toBeGreaterThanOrEqual(previousEnd)
    expect(region.result.end).toBeGreaterThanOrEqual(region.result.start)
    expect(region.result.end).toBeLessThanOrEqual(length)
    previousEnd = region.result.end
  }
}

describe('merge model invariants', () => {
  it(`rebuilds each side from the regions over ${COVERAGE_CASES} random cases`, () => {
    const random = mulberry32(0x5ea53eed)
    for (let index = 0; index < COVERAGE_CASES; index += 1) {
      const mergeCase = randomMergeCase(random)
      const label = describeCase(index, mergeCase)
      const state = createMerge(mergeCase.base, mergeCase.left, mergeCase.right)

      expect(
        reconstructSide(
          mergeCase.base,
          mergeCase.left,
          state.model.regions,
          (region) => region.left
        ),
        label
      ).toEqual(mergeCase.left)
      expect(
        reconstructSide(
          mergeCase.base,
          mergeCase.right,
          state.model.regions,
          (region) => region.right
        ),
        label
      ).toEqual(mergeCase.right)
      expect(state.result, label).toEqual(mergeCase.base)
      expectSound(state.model.regions, state.result.length)
    }
  })

  it(`keeps the ranges sound after ${EDIT_CASES} sequences of edits`, () => {
    const random = mulberry32(0xed17)
    for (let index = 0; index < EDIT_CASES; index += 1) {
      const mergeCase = randomMergeCase(random)
      const label = describeCase(index, mergeCase)
      const state = createMerge(mergeCase.base, mergeCase.left, mergeCase.right)
      const edits = randomEdits(random, state.result.length)
      const result = applyEdits(state.result, edits)
      const regions = mapResultRanges(state.model.regions, edits)

      expect(regions.length, label).toBe(state.model.regions.length)
      expectSound(regions, result.length)
    }
  })

  it('processes a 5 000-line file well under a second', () => {
    const base = Array.from({ length: 5000 }, (_, index) => `line ${index}`)
    const left = [...base]
    const right = [...base]
    for (let index = 0; index < 5000; index += 50) left[index] = `left ${index}`
    for (let index = 25; index < 5000; index += 50) right[index] = `right ${index}`

    const started = performance.now()
    const state = createMerge(base, left, right)
    const patch = applyNonConflicting(state)
    const elapsed = performance.now() - started

    expect(patch.state.result.length).toBe(5000)
    // The chapter allows confirming the threshold with the measurement.
    expect(elapsed).toBeLessThan(1000)
  })
})
