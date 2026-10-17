// SPDX-License-Identifier: MIT

import type { StagingModel } from '../../shared/ipc'

/**
 * The margin markers of the staging viewer. A prepared change (HEAD against the
 * index) is drawn hollow on the working copy, and a change still to prepare (the
 * index against the working copy) is drawn solid. The viewer shows the working
 * copy, so a prepared hunk, whose lines belong to the index, is placed on the
 * working copy by the model before it gets here.
 *
 * Pure: it runs in the renderer but touches nothing of the DOM, so it is tested
 * on its own.
 */

/** One working-copy line that carries a marker. */
export interface MarkerLine {
  /** The 0-based line of the working copy. */
  readonly line: number
  /** A prepared change covers this line: a hollow marker. */
  readonly staged: boolean
  /** A change still to prepare covers this line: a solid marker. */
  readonly unstaged: boolean
}

interface Flags {
  staged: boolean
  unstaged: boolean
}

/**
 * The working-copy lines that carry a marker, in order. When a prepared and a
 * pending change cover the same line, one marker carries both flags rather than
 * two markers fighting for the same slot.
 */
export function markerLines(model: StagingModel): MarkerLine[] {
  const total = model.worktree?.lines.length ?? 0
  const byLine = new Map<number, Flags>()

  const mark = (line: number, staged: boolean): void => {
    if (line < 0 || line >= total) return
    const flags = byLine.get(line) ?? { staged: false, unstaged: false }
    if (staged) flags.staged = true
    else flags.unstaged = true
    byLine.set(line, flags)
  }

  // A hunk with lines covers them; a pure deletion has none, so it becomes the
  // point between two lines and is drawn on the line that follows it.
  const cover = (start: number, count: number, staged: boolean): void => {
    if (count > 0) {
      for (let line = start; line < start + count; line += 1) mark(line, staged)
    } else if (total > 0) {
      mark(Math.min(Math.max(start, 0), total - 1), staged)
    }
  }

  for (const hunk of model.unstaged) cover(hunk.bStart, hunk.bLines, false)
  for (const placed of model.stagedInWorktree) cover(placed.start, placed.lines, true)

  return [...byLine.entries()]
    .sort(([left], [right]) => left - right)
    .map(([line, flags]) => ({ line, staged: flags.staged, unstaged: flags.unstaged }))
}
