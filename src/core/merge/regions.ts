// SPDX-License-Identifier: MIT

import { diffLines } from '../diff'
import { compactHunks } from './compact'
import { groupHunks } from './group'
import { simpleMergeText } from './simple'
import type { LineRange, MergeRegion, MergeState, RegionKind } from './types'

/**
 * Building the merge model: one line diff of the base against each side, a
 * sweep that groups the hunks into regions, each region's range on both sides,
 * and its classification. Pure: no Node, no DOM, so the interface can run it in
 * a worker for large files.
 *
 * The result starts as the base, which is the middle pane the reference client shows.
 */

/** The lines of a range. */
function slice(lines: readonly string[], range: LineRange): string[] {
  return lines.slice(range.start, range.end)
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index])
}

/** Where a base region `[start, end)` lands on a side, and the shift after it. */
interface SidePlacement {
  range: LineRange
  delta: number
}

/**
 * The side's range for a base region. A side with no hunks in the region copies
 * the base's lines; a side with hunks replaces them, so its range grows or
 * shrinks by the difference. `delta` is the accumulated shift of the hunks
 * before the region on that side.
 */
function placeSide(
  start: number,
  end: number,
  hunks: readonly { aLines: number; bLines: number }[],
  delta: number
): SidePlacement {
  let removed = 0
  let added = 0
  for (const hunk of hunks) {
    removed += hunk.aLines
    added += hunk.bLines
  }
  const sideStart = start + delta
  return {
    range: { start: sideStart, end: sideStart + (end - start) - removed + added },
    delta: delta + added - removed
  }
}

function classify(
  leftChanged: boolean,
  rightChanged: boolean,
  left: string[],
  right: string[]
): RegionKind {
  if (leftChanged && rightChanged) return sameLines(left, right) ? 'same' : 'conflict'
  return leftChanged ? 'left-only' : 'right-only'
}

/** Builds the model and the initial result, which is the base. */
export function createMerge(
  base: readonly string[],
  left: readonly string[],
  right: readonly string[]
): MergeState {
  const baseLines = [...base]
  const leftLines = [...left]
  const rightLines = [...right]

  // Slide each side's hunks down before grouping them, which moves the
  // alignment closer to Git's when the lines around a change repeat.
  const groups = groupHunks(
    compactHunks(diffLines(baseLines, leftLines, 'none'), baseLines, leftLines),
    compactHunks(diffLines(baseLines, rightLines, 'none'), baseLines, rightLines)
  )

  const regions: MergeRegion[] = []
  let leftDelta = 0
  let rightDelta = 0

  for (const group of groups) {
    const leftPlacement = placeSide(group.start, group.end, group.left, leftDelta)
    const rightPlacement = placeSide(group.start, group.end, group.right, rightDelta)
    leftDelta = leftPlacement.delta
    rightDelta = rightPlacement.delta

    const baseRange: LineRange = { start: group.start, end: group.end }
    const leftRange = leftPlacement.range
    const rightRange = rightPlacement.range
    const kind = classify(
      group.left.length > 0,
      group.right.length > 0,
      slice(leftLines, leftRange),
      slice(rightLines, rightRange)
    )

    regions.push({
      id: regions.length,
      kind,
      base: baseRange,
      left: leftRange,
      right: rightRange,
      result: { ...baseRange },
      leftState: group.left.length > 0 ? 'pending' : 'none',
      rightState: group.right.length > 0 ? 'pending' : 'none',
      edited: false,
      simple:
        kind === 'conflict' &&
        simpleMergeText(
          slice(baseLines, baseRange).join('\n'),
          slice(leftLines, leftRange).join('\n'),
          slice(rightLines, rightRange).join('\n')
        ) !== null
    })
  }

  return {
    model: { base: baseLines, left: leftLines, right: rightLines, regions },
    result: [...baseLines]
  }
}
