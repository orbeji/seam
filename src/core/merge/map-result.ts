// SPDX-License-Identifier: MIT

import type { LineRange, MergeRegion, ResultEdit } from './types'

/**
 * Keeping each region's range in the result in step with the text the user
 * edits. The result is a plain text the editor owns, so the ranges are the only
 * thing tying the model to it.
 *
 * The rule, fixed and tested here: an edit that overlaps a region, or merely
 * touches one of its borders, belongs to that region. Text typed at the edge of
 * a region joins the region, the same way a change on a line next to a hunk
 * joins the hunk in the line diff. When an edit reaches several regions (a
 * paste that spans a gap), the earlier one takes the inserted text and the
 * others keep only the part of their text that survives after the edit. An
 * edit that stays clear of every region just shifts the ones that follow it.
 */

/** Whether an edit over `[from, to)` overlaps or touches a range. */
function touches(range: LineRange, from: number, to: number): boolean {
  return from <= range.end && to >= range.start
}

function shift(range: LineRange, delta: number): LineRange {
  return { start: range.start + delta, end: range.end + delta }
}

function withRange(region: MergeRegion, result: LineRange, markEdited: boolean): MergeRegion {
  return { ...region, result, edited: region.edited || markEdited }
}

/**
 * Applies one edit to the ranges. `markEdited` is false for the edits an
 * operation makes on its own, which set a side's state instead of marking the
 * region as hand-edited.
 */
export function applyEdit(
  regions: readonly MergeRegion[],
  edit: ResultEdit,
  markEdited: boolean
): MergeRegion[] {
  const { from, to } = edit
  const inserted = edit.insertedLines.length
  const delta = inserted - (to - from)

  const first = regions.find((region) => touches(region.result, from, to))

  return regions.map((region) => {
    const range = region.result

    if (!touches(range, from, to)) {
      // A region the edit leaves behind does not move; one it precedes shifts.
      return to < range.start ? withRange(region, shift(range, delta), false) : region
    }

    if (region.id === first?.id) {
      return withRange(
        region,
        {
          start: Math.min(range.start, from),
          end: range.end > to ? range.end + delta : from + inserted
        },
        markEdited
      )
    }

    // A later region loses the part of its text the edit replaced; what is left
    // of it starts right after the inserted text.
    const start = from + inserted
    return withRange(region, { start, end: Math.max(start, range.end + delta) }, markEdited)
  })
}

/**
 * The regions after a list of user edits, in order. Each edit's coordinates are
 * in the text as the previous edits left it, which is how an editor reports
 * them. Regions the edits touch are marked `edited`.
 */
export function mapResultRanges(
  regions: readonly MergeRegion[],
  edits: readonly ResultEdit[]
): MergeRegion[] {
  let current = regions.map((region) => ({ ...region, result: { ...region.result } }))
  for (const edit of edits) current = applyEdit(current, edit, true)
  return current
}
