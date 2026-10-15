// SPDX-License-Identifier: MIT

import type { LineHunk } from '../diff'

/**
 * Aligning hunks the way Git does. When the lines around a change repeat, the
 * change can be encoded in more than one place: inserting a line equal to its
 * neighbour, or deleting one that repeats, can slide. Myers picks one place,
 * Git picks another after compacting its change groups, and two sides that Git
 * merges cleanly can end up looking like they touch.
 *
 * Sliding every hunk as far down as it goes moves the engine's alignment much
 * closer to Git's. The slide is the classic one: a hunk can move down by one
 * while the base line it leaves behind at the top equals the side line it
 * leaves behind, and while there is a line left on both sides to take its place
 * at the bottom. The encodings before and after describe the same edit, so the
 * coverage invariant is untouched; which hunks touch, and therefore which
 * regions conflict, is what changes. It is not exact: Git also slides a group
 * back up when that aligns it with the other side's changes, which this does
 * not, so a few repeated-line cases still differ.
 * `test/merge-git.integration.test.ts` measures it against `git merge-file`.
 */

/** Moves one hunk down while that keeps it a valid encoding of the same edit. */
function slideDown(hunk: LineHunk, base: readonly string[], side: readonly string[]): LineHunk {
  let { aStart, bStart } = hunk
  while (
    aStart + hunk.aLines < base.length &&
    bStart + hunk.bLines < side.length &&
    base[aStart] === side[bStart]
  ) {
    aStart += 1
    bStart += 1
  }
  return { aStart, aLines: hunk.aLines, bStart, bLines: hunk.bLines }
}

/** The hunks, each slid as far down as it can go. */
export function compactHunks(
  hunks: readonly LineHunk[],
  base: readonly string[],
  side: readonly string[]
): LineHunk[] {
  return hunks.map((hunk) => slideDown(hunk, base, side))
}
