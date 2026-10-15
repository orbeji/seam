// SPDX-License-Identifier: MIT

import { simpleMergeText } from './simple'
import type {
  LineRange,
  MergeModel,
  MergePatch,
  MergeRegion,
  MergeSide,
  MergeState,
  ResultEdit,
  SideState
} from './types'

/**
 * The operations that build the result: applying the non-conflicting regions,
 * accepting, ignoring and reverting a region, resolving a simple conflict, and
 * checking whether the whole file is resolved.
 *
 * Every operation returns a {@link MergePatch}: the edits to replay over the
 * result text, in order, and the state after them. The result ranges are
 * recomputed from the regions' lengths, so the gaps between regions (the lines
 * the operations never touch) stay exactly as they were.
 */

/** Which pending regions `applyNonConflicting` applies. */
export type NonConflictingSelection = 'all' | 'left' | 'right'

/** Where `revert` sends a region's text back to. */
export type RevertTarget = 'base' | 'left' | 'right'

/** One region an operation wants to change, with its new text and states. */
interface Change {
  region: MergeRegion
  /** Absent when the operation only changes the states, like `ignore`. */
  text?: readonly string[] | undefined
  leftState?: SideState | undefined
  rightState?: SideState | undefined
  edited?: boolean | undefined
}

function slice(lines: readonly string[], range: LineRange): string[] {
  return lines.slice(range.start, range.end)
}

function regionText(model: MergeModel, region: MergeRegion, side: MergeSide): string[] {
  return side === 'left' ? slice(model.left, region.left) : slice(model.right, region.right)
}

function baseText(model: MergeModel, region: MergeRegion): string[] {
  return slice(model.base, region.base)
}

function resultText(state: MergeState, region: MergeRegion): string[] {
  return slice(state.result, region.result)
}

/** The word-level merge of a region, as lines, or null when it is not simple. */
function simpleText(model: MergeModel, region: MergeRegion): string[] | null {
  const merged = simpleMergeText(
    baseText(model, region).join('\n'),
    regionText(model, region, 'left').join('\n'),
    regionText(model, region, 'right').join('\n')
  )
  if (merged === null) return null
  return merged === '' ? [] : merged.split('\n')
}

function requireRegion(state: MergeState, id: number): MergeRegion {
  const region = state.model.regions.find((candidate) => candidate.id === id)
  if (region === undefined) throw new Error(`Unknown merge region: ${id}`)
  return region
}

/** Replays edits over the result text; their coordinates assume this order. */
function applyResultEdits(lines: readonly string[], edits: readonly ResultEdit[]): string[] {
  const out = [...lines]
  for (const edit of edits) out.splice(edit.from, edit.to - edit.from, ...edit.insertedLines)
  return out
}

/**
 * Recomputes every region's result range from the running text length. The gaps
 * between regions keep their size, because no operation writes outside a region.
 */
function relayout(
  regions: readonly MergeRegion[],
  lengths: ReadonlyMap<number, number>
): MergeRegion[] {
  const out: MergeRegion[] = []
  let cursor = 0
  let previousEnd = 0
  for (const region of regions) {
    const length = lengths.get(region.id) ?? region.result.end - region.result.start
    const start = cursor + (region.result.start - previousEnd)
    const end = start + length
    out.push({ ...region, result: { start, end } })
    cursor = end
    previousEnd = region.result.end
  }
  return out
}

function applyChanges(state: MergeState, changes: readonly Change[]): MergePatch {
  const byId = new Map<number, Change>()
  for (const change of changes) byId.set(change.region.id, change)

  const edits: ResultEdit[] = []
  const lengths = new Map<number, number>()
  let shift = 0
  for (const region of state.model.regions) {
    const text = byId.get(region.id)?.text
    if (text === undefined) continue
    const from = region.result.start + shift
    const to = region.result.end + shift
    edits.push({ from, to, insertedLines: text })
    shift += text.length - (to - from)
    lengths.set(region.id, text.length)
  }

  const result = applyResultEdits(state.result, edits)
  const regions = relayout(state.model.regions, lengths).map((region) => {
    const change = byId.get(region.id)
    if (change === undefined) return region
    return {
      ...region,
      leftState: change.leftState ?? region.leftState,
      rightState: change.rightState ?? region.rightState,
      edited: change.edited ?? region.edited
    }
  })

  return { edits, state: { model: { ...state.model, regions }, result } }
}

/** The side `applyNonConflicting` uses for a region, or null to leave it alone. */
function nonConflictingSide(
  region: MergeRegion,
  selection: NonConflictingSelection
): MergeSide | null {
  // A hand-edited region is already resolved: applying text over it would undo
  // the user's work.
  if (region.edited) return null

  switch (region.kind) {
    case 'left-only':
      return selection !== 'right' && region.leftState === 'pending' ? 'left' : null
    case 'right-only':
      return selection !== 'left' && region.rightState === 'pending' ? 'right' : null
    case 'same':
      if (selection === 'left') return region.leftState === 'pending' ? 'left' : null
      if (selection === 'right') return region.rightState === 'pending' ? 'right' : null
      return region.leftState === 'pending' || region.rightState === 'pending' ? 'left' : null
    case 'conflict':
      return null
  }
}

/**
 * Applies the `left-only`, `right-only` and `same` regions that are still
 * pending. A `same` region has the same text on both sides, so applying it
 * resolves both sides at once. Conflicts, simple or not, are never touched.
 */
export function applyNonConflicting(
  state: MergeState,
  selection: NonConflictingSelection = 'all'
): MergePatch {
  const changes: Change[] = []
  for (const region of state.model.regions) {
    const side = nonConflictingSide(region, selection)
    if (side === null) continue
    changes.push(
      side === 'left'
        ? {
            region,
            text: regionText(state.model, region, 'left'),
            leftState: 'applied',
            rightState: region.kind === 'same' ? 'applied' : undefined
          }
        : {
            region,
            text: regionText(state.model, region, 'right'),
            rightState: 'applied',
            leftState: region.kind === 'same' ? 'applied' : undefined
          }
    )
  }
  return applyChanges(state, changes)
}

/**
 * Replaces a region's text with a side's. On a conflict whose other side is
 * already applied, the side's lines are added behind the current text instead
 * of replacing it, so accepting both keeps both.
 */
export function accept(state: MergeState, regionId: number, side: MergeSide): MergePatch {
  const region = requireRegion(state, regionId)
  const sideLines = regionText(state.model, region, side)
  const otherApplied =
    region.kind === 'conflict' &&
    (side === 'left' ? region.rightState : region.leftState) === 'applied'
  const text = otherApplied ? [...resultText(state, region), ...sideLines] : sideLines

  return applyChanges(state, [
    side === 'left'
      ? { region, text, leftState: 'applied' }
      : { region, text, rightState: 'applied' }
  ])
}

/** Marks a side as dealt with without changing the text. */
export function ignore(state: MergeState, regionId: number, side: MergeSide): MergePatch {
  const region = requireRegion(state, regionId)
  return applyChanges(state, [
    side === 'left' ? { region, leftState: 'ignored' } : { region, rightState: 'ignored' }
  ])
}

/**
 * Sends a region's text back to the base or to one side, and returns the sides
 * that changed it to pending. A hand edit is undone along with the text.
 */
export function revert(state: MergeState, regionId: number, to: RevertTarget): MergePatch {
  const region = requireRegion(state, regionId)
  const text = to === 'base' ? baseText(state.model, region) : regionText(state.model, region, to)
  return applyChanges(state, [
    {
      region,
      text,
      leftState: region.leftState === 'none' ? 'none' : 'pending',
      rightState: region.rightState === 'none' ? 'none' : 'pending',
      edited: false
    }
  ])
}

/** Applies the word-level merge of a simple conflict; a no-op otherwise. */
export function resolveSimple(state: MergeState, regionId: number): MergePatch {
  const region = requireRegion(state, regionId)
  const text = simpleText(state.model, region)
  if (text === null) return { edits: [], state }
  return applyChanges(state, [{ region, text, leftState: 'applied', rightState: 'applied' }])
}

/** The text a region contributes to a fully resolved file, or null if it has none. */
function resolvedText(model: MergeModel, region: MergeRegion): string[] | null {
  switch (region.kind) {
    case 'left-only':
      return regionText(model, region, 'left')
    case 'right-only':
      return regionText(model, region, 'right')
    case 'same':
      return regionText(model, region, 'left')
    case 'conflict':
      return region.simple ? simpleText(model, region) : null
  }
}

/**
 * The whole file when every region is non-conflicting or a simple conflict, and
 * null when any region needs the user. It is what Resolve all simple conflicts
 * uses: the simple conflicts are merged but stay marked for review.
 */
export function autoResolve(state: MergeState): string[] | null {
  const out: string[] = []
  let cursor = 0
  for (const region of state.model.regions) {
    const text = resolvedText(state.model, region)
    if (text === null) return null
    out.push(...state.model.base.slice(cursor, region.base.start))
    out.push(...text)
    cursor = region.base.end
  }
  out.push(...state.model.base.slice(cursor))
  return out
}

/** Whether no side of a region is still waiting. A hand edit resolves it. */
export function isRegionResolved(region: MergeRegion): boolean {
  if (region.edited) return true
  return region.leftState !== 'pending' && region.rightState !== 'pending'
}

/** Whether every region of the file is resolved. */
export function isMergeResolved(state: MergeState): boolean {
  return state.model.regions.every(isRegionResolved)
}
