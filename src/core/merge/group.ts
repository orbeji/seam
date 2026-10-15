// SPDX-License-Identifier: MIT

import type { LineHunk } from '../diff'

/**
 * The sweep that turns the two hunk lists (base against each side) into the
 * regions of the merge. It is shared by the line-level builder in `./regions`
 * and by the word-level resolver in `./simple`, which runs the same algorithm
 * over the words of a conflict.
 *
 * Hunks that overlap or merely touch belong to the same group, because Git
 * treats changes on contiguous lines as one conflict.
 */

export interface HunkGroup {
  /** The base lines the group covers, `[start, end)`. */
  start: number
  end: number
  /** The left side's hunks inside the group, in base order. */
  left: LineHunk[]
  right: LineHunk[]
}

/** Whether a hunk overlaps or touches the group. */
function touches(group: HunkGroup, hunk: LineHunk): boolean {
  const end = hunk.aStart + hunk.aLines
  return hunk.aStart <= group.end && group.start <= end
}

/** Both hunk lists must be sorted by `aStart`, as `diffLines` returns them. */
export function groupHunks(
  leftHunks: readonly LineHunk[],
  rightHunks: readonly LineHunk[]
): HunkGroup[] {
  const groups: HunkGroup[] = []
  let i = 0
  let j = 0
  let current: HunkGroup | null = null

  while (i < leftHunks.length || j < rightHunks.length) {
    // Take the hunk that starts earliest; on a tie the left one goes first.
    const fromLeft =
      j >= rightHunks.length ||
      (i < leftHunks.length &&
        (leftHunks[i] as LineHunk).aStart <= (rightHunks[j] as LineHunk).aStart)
    const hunk = (fromLeft ? leftHunks[i] : rightHunks[j]) as LineHunk
    const end = hunk.aStart + hunk.aLines

    if (current !== null && touches(current, hunk)) {
      if (end > current.end) current.end = end
    } else {
      if (current !== null) groups.push(current)
      current = { start: hunk.aStart, end, left: [], right: [] }
    }

    if (fromLeft) {
      current.left.push(hunk)
      i += 1
    } else {
      current.right.push(hunk)
      j += 1
    }
  }

  if (current !== null) groups.push(current)
  return groups
}
