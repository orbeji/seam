// SPDX-License-Identifier: MIT

import {
  accept as acceptMerge,
  applyNonConflicting,
  ignore as ignoreMerge,
  isMergeResolved,
  isRegionResolved,
  mapResultRanges,
  resolveSimple as resolveSimpleMerge,
  revert as revertMerge,
  type MergeRegion,
  type MergeSide,
  type MergeState,
  type NonConflictingSelection,
  type RegionKind,
  type SideState
} from '../../core/merge'

/**
 * The row model and the actions of the merge editor. It turns the merge state
 * from the engine into the rows the three panes draw, so every line of Yours,
 * Result and Theirs keeps the same vertical position while a region grows or
 * shrinks, and it wraps the engine's operations so the interface only deals in
 * whole states.
 *
 * It is pure: no DOM, no Node, so the alignment and the actions are tested on
 * their own.
 */

/** The kind of a row: a region of the merge, or the unchanged gap around it. */
export type MergeRowKind = RegionKind | 'gap'

/** One visual row, with the text and line number of each of the three panes. */
export interface MergeRow {
  readonly key: string
  readonly regionId: number | null
  readonly kind: MergeRowKind
  /** The row's offset inside its region or gap. */
  readonly offset: number
  /** Whether this is the first row of its region, where the arrows sit. */
  readonly first: boolean
  readonly baseLine: number | null
  readonly leftLine: number | null
  readonly rightLine: number | null
  readonly resultLine: number | null
  readonly baseText: string | null
  readonly leftText: string | null
  readonly rightText: string | null
  readonly resultText: string | null
  readonly leftState: SideState
  readonly rightState: SideState
  readonly edited: boolean
  readonly simple: boolean
}

function textAt(lines: readonly string[], line: number | null): string | null {
  return line === null ? null : (lines[line] ?? null)
}

function lineNumber(line: number | null): number | null {
  return line === null ? null : line + 1
}

/**
 * Builds the rows from the current state. Every region spans as many rows as
 * its longest side, padded with hatching on the shorter ones, so the panes stay
 * aligned. The gaps between regions are copied from the three versions at their
 * own cursors, because earlier regions may have changed one side's length.
 */
export function buildMergeRows(state: MergeState): MergeRow[] {
  const { model } = state
  const rows: MergeRow[] = []
  let baseAt = 0
  let leftAt = 0
  let rightAt = 0
  let resultAt = 0
  let gap = 0

  function pushGap(baseEnd: number, leftEnd: number, rightEnd: number, resultEnd: number): void {
    const height = Math.max(
      baseEnd - baseAt,
      leftEnd - leftAt,
      rightEnd - rightAt,
      resultEnd - resultAt
    )
    for (let offset = 0; offset < height; offset += 1) {
      const baseLine = baseAt + offset < baseEnd ? baseAt + offset : null
      const leftLine = leftAt + offset < leftEnd ? leftAt + offset : null
      const rightLine = rightAt + offset < rightEnd ? rightAt + offset : null
      const resultLine = resultAt + offset < resultEnd ? resultAt + offset : null
      rows.push({
        key: `gap-${gap}-${offset}`,
        regionId: null,
        kind: 'gap',
        offset,
        first: offset === 0,
        baseLine: lineNumber(baseLine),
        leftLine: lineNumber(leftLine),
        rightLine: lineNumber(rightLine),
        resultLine: lineNumber(resultLine),
        baseText: textAt(model.base, baseLine),
        leftText: textAt(model.left, leftLine),
        rightText: textAt(model.right, rightLine),
        resultText: textAt(state.result, resultLine),
        leftState: 'none',
        rightState: 'none',
        edited: false,
        simple: false
      })
    }
    baseAt = baseEnd
    leftAt = leftEnd
    rightAt = rightEnd
    resultAt = resultEnd
    gap += 1
  }

  for (const region of model.regions) {
    pushGap(region.base.start, region.left.start, region.right.start, region.result.start)

    const leftLength = region.left.end - region.left.start
    const rightLength = region.right.end - region.right.start
    const resultLength = region.result.end - region.result.start
    // An empty region still gets one row, so its arrows and status stay usable.
    const height = Math.max(1, leftLength, rightLength, resultLength)

    for (let offset = 0; offset < height; offset += 1) {
      const baseLine =
        offset < region.base.end - region.base.start ? region.base.start + offset : null
      const leftLine = offset < leftLength ? region.left.start + offset : null
      const rightLine = offset < rightLength ? region.right.start + offset : null
      const resultLine = offset < resultLength ? region.result.start + offset : null
      rows.push({
        key: `region-${region.id}-${offset}`,
        regionId: region.id,
        kind: region.kind,
        offset,
        first: offset === 0,
        baseLine: lineNumber(baseLine),
        leftLine: lineNumber(leftLine),
        rightLine: lineNumber(rightLine),
        resultLine: lineNumber(resultLine),
        baseText: textAt(model.base, baseLine),
        leftText: textAt(model.left, leftLine),
        rightText: textAt(model.right, rightLine),
        resultText: textAt(state.result, resultLine),
        leftState: region.leftState,
        rightState: region.rightState,
        edited: region.edited,
        simple: region.simple
      })
    }

    baseAt = region.base.end
    leftAt = region.left.end
    rightAt = region.right.end
    resultAt = region.result.end
  }

  pushGap(model.base.length, model.left.length, model.right.length, state.result.length)
  return rows
}

function regionOf(state: MergeState, id: number): MergeRegion | undefined {
  return state.model.regions.find((region) => region.id === id)
}

function sideState(region: MergeRegion, side: MergeSide): SideState {
  return side === 'left' ? region.leftState : region.rightState
}

function otherSide(side: MergeSide): MergeSide {
  return side === 'left' ? 'right' : 'left'
}

/** Accepts one side of a region. A `same` region resolves both sides at once. */
export function acceptRegion(state: MergeState, id: number, side: MergeSide): MergeState {
  const region = regionOf(state, id)
  if (region === undefined || region.edited) return state
  let next = acceptMerge(state, id, side).state
  if (region.kind === 'same' && sideState(region, otherSide(side)) === 'pending') {
    next = acceptMerge(next, id, otherSide(side)).state
  }
  return next
}

/** Ignores one side of a region, leaving the result text alone. */
export function ignoreRegion(state: MergeState, id: number, side: MergeSide): MergeState {
  const region = regionOf(state, id)
  if (region === undefined || region.edited) return state
  return ignoreMerge(state, id, side).state
}

/**
 * Settles a conflict with one side: its text goes into the result and the
 * other side is ignored, which is what the context menu's "Resolve using"
 * means. The gutter's single arrows stay per side.
 */
export function resolveRegion(state: MergeState, id: number, side: MergeSide): MergeState {
  const region = regionOf(state, id)
  if (region === undefined || region.edited) return state
  let next = acceptMerge(state, id, side).state
  const current = regionOf(next, id)
  if (current !== undefined && sideState(current, otherSide(side)) === 'pending') {
    next = ignoreMerge(next, id, otherSide(side)).state
  }
  return next
}

/** Sends a region back to the common ancestor and marks its sides pending. */
export function revertRegion(state: MergeState, id: number): MergeState {
  const region = regionOf(state, id)
  if (region === undefined) return state
  return revertMerge(state, id, 'base').state
}

/** Applies every simple conflict the word-level merge can settle. */
export function resolveSimpleRegions(state: MergeState): MergeState {
  let next = state
  for (const region of state.model.regions) {
    if (region.kind !== 'conflict' || !region.simple) continue
    const current = regionOf(next, region.id)
    if (current === undefined || current.edited || isRegionResolved(current)) continue
    next = resolveSimpleMerge(next, region.id).state
  }
  return next
}

/** Applies the pending non-conflicting regions, from all or from one side. */
export function applyNonConflictingRegions(
  state: MergeState,
  selection: NonConflictingSelection
): MergeState {
  return applyNonConflicting(state, selection).state
}

/** Whether there is a non-conflicting region a bulk action would still apply. */
export function hasNonConflicting(state: MergeState, selection: NonConflictingSelection): boolean {
  return state.model.regions.some((region) => {
    if (region.kind === 'conflict' || region.edited) return false
    if (selection === 'left') return region.leftState === 'pending'
    if (selection === 'right') return region.rightState === 'pending'
    return region.leftState === 'pending' || region.rightState === 'pending'
  })
}

/**
 * Replaces one result line with the text typed in it. A paste or an Enter that
 * brings several lines inserts them all; the engine's range mapper then moves
 * every region the edit reaches and marks it as hand-edited.
 */
export function editResultLine(state: MergeState, line: number, text: string): MergeState {
  if (line < 0 || line >= state.result.length) return state
  const owner = state.model.regions.find(
    (region) => line >= region.result.start && line < region.result.end
  )
  // Emptying a region's line deletes it and sends the region back to pending,
  // so Apply changes waits until a side or an ignore settles it again.
  const removed = text === '' && owner !== undefined
  const insertedLines = removed ? [] : text.split('\n')
  const result = [...state.result.slice(0, line), ...insertedLines, ...state.result.slice(line + 1)]
  let regions = mapResultRanges(state.model.regions, [{ from: line, to: line + 1, insertedLines }])
  if (removed && owner !== undefined) {
    regions = regions.map((region) =>
      region.id === owner.id
        ? {
            ...region,
            edited: false,
            leftState: region.leftState === 'none' ? 'none' : 'pending',
            rightState: region.rightState === 'none' ? 'none' : 'pending'
          }
        : region
    )
  }
  return { model: { ...state.model, regions }, result }
}

/** The text the editor writes, with the file's original final newline. */
export function mergeResultText(state: MergeState, finalNewline: boolean): string {
  const body = state.result.join('\n')
  return finalNewline && state.result.length > 0 ? `${body}\n` : body
}

/** How the toolbar describes the regions: conflicts, the rest, and resolved. */
export function mergeStats(state: MergeState): {
  conflicts: number
  nonConflicting: number
  resolved: number
} {
  let conflicts = 0
  let nonConflicting = 0
  let resolved = 0
  for (const region of state.model.regions) {
    if (region.kind === 'conflict') conflicts += 1
    else nonConflicting += 1
    if (isRegionResolved(region)) resolved += 1
  }
  return { conflicts, nonConflicting, resolved }
}

/** Every conflict region, in file order, for the header's navigation. */
export function conflictRegions(state: MergeState): MergeRegion[] {
  return state.model.regions.filter((region) => region.kind === 'conflict')
}

/** Whether every region is settled, which is what Apply changes waits for. */
export function canApplyMerge(state: MergeState): boolean {
  return isMergeResolved(state)
}
