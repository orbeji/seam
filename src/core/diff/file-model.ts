// SPDX-License-Identifier: MIT

import type { TextLines } from '../text'
import { diffLines, type LineHunk } from './lines'

/**
 * The three versions of one file and the changes between them. HEAD is the last
 * commit, the index is what a commit would record and the working copy is what
 * is on disk. The viewer shows the working copy, so the prepared change, which
 * is written on the index's lines, is carried over to the working copy as well.
 *
 * Pure: it runs in the main process and in the interface, so it stays free of
 * Node and of the browser.
 */

/** A prepared hunk placed on the working copy, ready to draw. */
export interface PlacedHunk {
  /** The prepared hunk, in HEAD and index line numbers. */
  hunk: LineHunk
  /** First working-copy line the marker covers. */
  start: number
  /** How many working-copy lines it covers; 0 marks a point between two lines. */
  lines: number
}

/** The three versions of a file and the two changes between them. */
export interface FileModel {
  /** HEAD, the committed version, or null when the file is not committed. */
  head: TextLines | null
  /** The index, the version a commit would record, or null when it is absent. */
  index: TextLines | null
  /** The working copy, or null when the file is not on disk. */
  worktree: TextLines | null
  /** HEAD against the index: the prepared change, drawn with a hollow marker. */
  staged: LineHunk[]
  /** The index against the working copy: the change not prepared, a solid marker. */
  unstaged: LineHunk[]
  /** The prepared hunks placed on the working copy's lines. */
  stagedInWorktree: PlacedHunk[]
}

/**
 * The hunks that turn `b` back into `a`, by swapping each hunk's two sides. It
 * is what unstage and revert apply: the same change read the other way.
 */
export function reverseHunks(hunks: readonly LineHunk[]): LineHunk[] {
  return hunks.map((hunk) => ({
    aStart: hunk.bStart,
    aLines: hunk.bLines,
    bStart: hunk.aStart,
    bLines: hunk.aLines
  }))
}

/**
 * For every index line, the working-copy line the index line survives as, or -1
 * when the unstaged change rewrote it. The lines between two unstaged hunks are
 * untouched and map one to one; a hunk's index lines have no single surviving
 * line, so they stay -1.
 */
function survivingLines(unstaged: readonly LineHunk[], indexLength: number): number[] {
  const survived = new Array<number>(indexLength).fill(-1)
  let index = 0
  let worktree = 0

  for (const hunk of unstaged) {
    while (index < hunk.aStart) {
      survived[index] = worktree
      index += 1
      worktree += 1
    }
    index = hunk.aStart + hunk.aLines
    worktree = hunk.bStart + hunk.bLines
  }
  while (index < indexLength) {
    survived[index] = worktree
    index += 1
    worktree += 1
  }
  return survived
}

/**
 * Places one prepared hunk on the working copy. The prepared lines are the index
 * side of the hunk, so they are looked up among the lines that survive into the
 * working copy. When every one of them was rewritten afterwards, the hunk is
 * drawn as a point next to the nearest surviving line, which is where the change
 * would be.
 */
function place(hunk: LineHunk, survived: readonly number[]): PlacedHunk {
  const from = hunk.bStart
  const to = hunk.bStart + hunk.bLines

  let first = -1
  let last = -1
  for (let line = from; line < to; line += 1) {
    const at = survived[line] as number
    if (at < 0) continue
    if (first < 0) first = at
    last = at
  }
  if (first >= 0) return { hunk, start: first, lines: last - first + 1 }

  let before = -1
  for (let line = from - 1; line >= 0; line -= 1) {
    const at = survived[line] as number
    if (at >= 0) {
      before = at
      break
    }
  }
  if (before >= 0) return { hunk, start: before + 1, lines: 0 }

  let after = -1
  for (let line = to; line < survived.length; line += 1) {
    const at = survived[line] as number
    if (at >= 0) {
      after = at
      break
    }
  }
  return { hunk, start: after >= 0 ? after : 0, lines: 0 }
}

/**
 * Places every prepared hunk on the working copy's lines, in the same order, so
 * the viewer can draw a hollow marker where the prepared change would be. An
 * unstaged hunk that rewrote the prepared lines makes the marker a point.
 */
export function placeInWorktree(
  staged: readonly LineHunk[],
  unstaged: readonly LineHunk[],
  indexLength: number
): PlacedHunk[] {
  const survived = survivingLines(unstaged, indexLength)
  return staged.map((hunk) => place(hunk, survived))
}

/**
 * Builds the model of a file from its three versions. A version that is absent
 * counts as no lines, which is what makes a new file one big insertion and a
 * deleted one one big deletion.
 *
 * The comparisons are exact: what is prepared and what is not does not depend on
 * how the viewer chooses to display whitespace.
 */
export function buildFileModel(
  head: TextLines | null,
  index: TextLines | null,
  worktree: TextLines | null
): FileModel {
  const headLines = head?.lines ?? []
  const indexLines = index?.lines ?? []
  const worktreeLines = worktree?.lines ?? []

  const staged = diffLines(headLines, indexLines, 'none')
  const unstaged = diffLines(indexLines, worktreeLines, 'none')

  return {
    head,
    index,
    worktree,
    staged,
    unstaged,
    stagedInWorktree: placeInWorktree(staged, unstaged, indexLines.length)
  }
}
