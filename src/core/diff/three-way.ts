// SPDX-License-Identifier: MIT

import type { LineHunk } from './lines'

/**
 * The three-way alignment of a file's versions, the row model the three-pane
 * staging view is drawn from. HEAD is on the left, the index in the editable
 * centre and the working copy on the right, so lines that only one version has
 * still sit on the row where they belong, padded on the other sides.
 *
 * The index is the axis: HEAD is aligned to it with the prepared change and the
 * working copy with the pending one, and the two alignments are merged. Pure: it
 * runs in the renderer but touches nothing of the DOM, so it is tested on its
 * own.
 */

/**
 * One row of the three-pane view: the HEAD line, the index line and the
 * working-copy line that belong together. A column is null where that version
 * has no line for the row, so it is drawn as blank padding.
 */
export interface AlignedRow {
  /** HEAD's cc line number, or null when HEAD has no line for the row. */
  readonly head: number | null
  /** The index line number, or null when the index has no line for the row. */
  readonly index: number | null
  /** The working-copy line number, or null when it has no line for the row. */
  readonly worktree: number | null
}

interface Pair {
  readonly from: number | null
  readonly to: number | null
}

/**
 * Pairs the lines of two versions the way their hunks align them. Lines outside
 * the hunks advance together; inside a hunk the two sides are paired in order,
 * so the first `a` line matches the first `b` line, and the lines a side has
 * over become single-sided pairs.
 */
function pairsFor(hunks: readonly LineHunk[], fromLength: number, toLength: number): Pair[] {
  const pairs: Pair[] = []
  let from = 0
  let to = 0

  for (const hunk of hunks) {
    while (from < hunk.aStart) {
      pairs.push({ from, to })
      from += 1
      to += 1
    }
    const count = Math.max(hunk.aLines, hunk.bLines)
    for (let offset = 0; offset < count; offset += 1) {
      pairs.push({
        from: offset < hunk.aLines ? hunk.aStart + offset : null,
        to: offset < hunk.bLines ? hunk.bStart + offset : null
      })
    }
    from = hunk.aStart + hunk.aLines
    to = hunk.bStart + hunk.bLines
  }
  while (from < fromLength && to < toLength) {
    pairs.push({ from, to })
    from += 1
    to += 1
  }
  return pairs
}

interface Side {
  /** For every index line, the line it is paired with, or -1 when it has none. */
  readonly partner: number[]
  /** Lines with no index partner, keyed by the index boundary they sit before. */
  readonly orphans: Map<number, number[]>
}

/**
 * Reads pairs whose `to` side is the index: the index's partner line in the
 * other version and the lines of the other version that the index does not have.
 */
function split(pairs: readonly Pair[], indexLength: number): Side {
  const partner = new Array<number>(indexLength).fill(-1)
  const orphans = new Map<number, number[]>()
  let boundary = 0

  for (const pair of pairs) {
    if (pair.to === null) {
      const line = pair.from as number
      const list = orphans.get(boundary)
      if (list === undefined) orphans.set(boundary, [line])
      else list.push(line)
    } else {
      if (pair.from !== null) partner[pair.to] = pair.from
      boundary = pair.to + 1
    }
  }
  return { partner, orphans }
}

/**
 * The rows of the three-pane view: every line of HEAD, the index and the working
 * copy appears exactly once, in order, and the three are aligned on the lines
 * that match. `staged` is HEAD against the index and `unstaged` the index
 * against the working copy, both as `buildFileModel` reads them.
 */
export function alignThree(
  head: readonly string[],
  index: readonly string[],
  worktree: readonly string[],
  staged: readonly LineHunk[],
  unstaged: readonly LineHunk[]
): AlignedRow[] {
  // Both sides are read with the index as their `to`, so one splitter serves.
  const headSide = split(pairsFor(staged, head.length, index.length), index.length)
  const worktreeSide = split(
    pairsFor(unstaged, index.length, worktree.length).map((pair) => ({
      from: pair.to,
      to: pair.from
    })),
    index.length
  )

  const rows: AlignedRow[] = []
  for (let at = 0; at <= index.length; at += 1) {
    for (const line of headSide.orphans.get(at) ?? []) {
      rows.push({ head: line, index: null, worktree: null })
    }
    for (const line of worktreeSide.orphans.get(at) ?? []) {
      rows.push({ head: null, index: null, worktree: line })
    }
    if (at < index.length) {
      rows.push({
        head: headSide.partner[at] === -1 ? null : (headSide.partner[at] as number),
        index: at,
        worktree: worktreeSide.partner[at] === -1 ? null : (worktreeSide.partner[at] as number)
      })
    }
  }
  return rows
}
