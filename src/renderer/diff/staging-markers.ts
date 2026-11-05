// SPDX-License-Identifier: MIT

import type { HunkRange, StagingModel } from '../../shared/ipc'

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

/** The line a point marker, the one a pure deletion becomes, sits on. */
function pointLine(start: number, total: number): number {
  return Math.min(Math.max(start, 0), total - 1)
}

/** The hunks a marker stands for, in both directions, for the hunk menu. */
export interface MarkerHunks {
  /** The prepared hunks under the marker, in HEAD and index lines. */
  readonly staged: readonly HunkRange[]
  /** The hunks still to prepare, in index and working-copy lines. */
  readonly unstaged: readonly HunkRange[]
}

/** Whether a hunk at `start`, covering `count` lines, sits on `line`. */
function covers(start: number, count: number, line: number, total: number): boolean {
  if (count > 0) return line >= start && line < start + count
  // A pure deletion is a point between two lines. An empty side has only one
  // point, the first line of the empty document, which is where the viewer
  // draws the change.
  return (total === 0 ? 0 : pointLine(start, total)) === line
}

/** One unstaged hunk with the lines of it a partial preparation takes. */
export interface HunkSelection {
  /** The hunk, in index and working-copy lines. */
  readonly hunk: HunkRange
  /** Patch-line indices within the hunk, its index lines first. */
  readonly lines: readonly number[]
}

/**
 * The patch lines of `hunk` the selected working-copy lines stand for. The
 * hunk's index lines come first in a patch, so a working-copy line at `bStart`
 * is the patch line after all the hunk's index lines.
 */
export function hunkPatchLines(hunk: HunkRange, selected: readonly number[]): number[] {
  const lines = new Set<number>()
  for (const line of selected) {
    if (line < hunk.bStart || line >= hunk.bStart + hunk.bLines) continue
    lines.add(hunk.aLines + (line - hunk.bStart))
  }
  return [...lines].sort((left, right) => left - right)
}

/**
 * The unstaged hunk under a marker together with the selected working-copy
 * lines it holds, for the menu's partial preparation. Null when the selection
 * reaches none of the hunks under the marker.
 */
export function selectionAt(
  model: StagingModel,
  line: number,
  selected: readonly number[]
): HunkSelection | null {
  for (const hunk of hunksAt(model, line).unstaged) {
    const lines = hunkPatchLines(hunk, selected)
    if (lines.length > 0) return { hunk, lines }
  }
  return null
}

/**
 * The hunks a marker line stands for. The menu acts on what the dot beside a
 * line means, so it needs the hunk the marker was drawn from, not just the line:
 * a prepared hunk comes back in HEAD and index numbers, as the model has it.
 */
export function hunksAt(model: StagingModel, line: number): MarkerHunks {
  const total = model.worktree?.lines.length ?? 0
  return {
    unstaged: model.unstaged.filter((hunk) => covers(hunk.bStart, hunk.bLines, line, total)),
    staged: model.stagedInWorktree
      .filter((placed) => covers(placed.start, placed.lines, line, total))
      .map((placed) => placed.hunk)
  }
}

/**
 * The prepared hunks under a line of the index side. It is the staged view's
 * counterpart to hunksAt: that side shows HEAD against the index, so the hunk's
 * index lines are the ones the viewer draws and the button can reach.
 */
export function stagedHunksAt(model: StagingModel, line: number): HunkRange[] {
  const total = model.index?.lines.length ?? 0
  return model.staged.filter((hunk) => covers(hunk.bStart, hunk.bLines, line, total))
}

/** One line that carries a marker, with the flags the renderer draws. */
interface MarkerEntry {
  readonly start: number
  readonly lines: number
  readonly staged: boolean
}

/** Builds the markers of one side from the hunks that sit on its lines. */
function collectMarkers(total: number, entries: readonly MarkerEntry[]): MarkerLine[] {
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
      mark(pointLine(start, total), staged)
    }
  }

  for (const entry of entries) cover(entry.start, entry.lines, entry.staged)

  return [...byLine.entries()]
    .sort(([left], [right]) => left - right)
    .map(([line, flags]) => ({ line, staged: flags.staged, unstaged: flags.unstaged }))
}

/**
 * The working-copy lines that carry a marker, in order. When a prepared and a
 * pending change cover the same line, one marker carries both flags rather than
 * two markers fighting for the same slot.
 */
export function markerLines(model: StagingModel): MarkerLine[] {
  const total = model.worktree?.lines.length ?? 0
  return collectMarkers(total, [
    ...model.unstaged.map((hunk) => ({
      start: hunk.bStart,
      lines: hunk.bLines,
      staged: false
    })),
    ...model.stagedInWorktree.map((placed) => ({
      start: placed.start,
      lines: placed.lines,
      staged: true
    }))
  ])
}

/**
 * The index lines that hold a prepared change, for the staged view. Only hollow
 * prepared markers appear there: the viewer is showing what the next commit
 * would record, so every change on screen can be taken back out of the index.
 */
export function stagedMarkerLines(model: StagingModel): MarkerLine[] {
  const total = model.index?.lines.length ?? 0
  return collectMarkers(
    total,
    model.staged.map((hunk) => ({ start: hunk.bStart, lines: hunk.bLines, staged: true }))
  )
}
