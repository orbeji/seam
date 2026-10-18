// SPDX-License-Identifier: MIT

import { joinText, type TextLines } from '../text'
import { reverseHunks } from './file-model'
import { applyHunks, type LineHunk } from './lines'

/**
 * Turning a hunk into index text. Preparing a change and removing it are the
 * same operation on two different pairs of versions: the working copy's lines
 * replace the index's inside an unstaged hunk, and HEAD's lines come back where
 * a prepared change had replaced them.
 *
 * Pure: it runs in the main process (which writes the index) and in the tests,
 * so it stays free of Node and of the browser.
 */

/** How many lines a version has, with an absent one counting as none. */
function lineCount(version: TextLines | null): number {
  return version?.lines.length ?? 0
}

/**
 * The new index text after preparing `hunks`. Everything outside a hunk keeps
 * the index's text; inside it, the working copy's lines take over.
 *
 * The final terminator follows the working copy only when a hunk reaches the
 * end of the index, because that is the one place where the end of the file is
 * part of the change. Without that, an edit above the last line would drag the
 * working copy's ending into the index.
 */
export function stageHunks(
  index: TextLines | null,
  worktree: TextLines | null,
  hunks: readonly LineHunk[]
): string {
  const lines = applyHunks(index?.lines ?? [], worktree?.lines ?? [], hunks)
  const reachesEnd = hunks.some((hunk) => hunk.aStart + hunk.aLines >= lineCount(index))
  return joinText({
    lines,
    finalNewline: reachesEnd ? (worktree?.finalNewline ?? false) : (index?.finalNewline ?? false)
  })
}

/**
 * The new index text after taking only `selected` lines of one hunk.
 *
 * The selection is by patch line, the way a `-`/`+` patch lists a hunk: first
 * the hunk's index-side lines, then its working-copy lines. An index line that
 * is not selected stays, and a working-copy line that is selected is inserted
 * after it. So choosing only the addition of a modified line leaves the old
 * line before the new one, choosing only the deletion drops the old line, and
 * choosing both replaces it - which is what Git does with the same partial
 * patch.
 */
export function stageSelection(
  index: TextLines | null,
  worktree: TextLines | null,
  hunk: LineHunk,
  selected: ReadonlySet<number>
): string {
  const indexLines = index?.lines ?? []
  const workLines = worktree?.lines ?? []
  const lines: string[] = []

  for (let line = 0; line < hunk.aStart; line += 1) lines.push(indexLines[line] as string)
  for (let line = 0; line < hunk.aLines; line += 1) {
    if (!selected.has(line)) lines.push(indexLines[hunk.aStart + line] as string)
  }
  for (let line = 0; line < hunk.bLines; line += 1) {
    if (selected.has(hunk.aLines + line)) lines.push(workLines[hunk.bStart + line] as string)
  }
  for (let line = hunk.aStart + hunk.aLines; line < indexLines.length; line += 1) {
    lines.push(indexLines[line] as string)
  }

  const reachesEnd = hunk.aStart + hunk.aLines >= lineCount(index)
  return joinText({
    lines,
    finalNewline: reachesEnd ? (worktree?.finalNewline ?? false) : (index?.finalNewline ?? false)
  })
}

/**
 * The new working-copy text after reverting `hunks` to the index's lines.
 *
 * Reverting is preparing read the other way: where the working copy's lines
 * replaced the index's inside an unstaged hunk, the index's lines come back, so
 * the file matches what is prepared. The hunks point at the index against the
 * working copy, so they are read reversed, exactly as removing a prepared hunk
 * reads a HEAD-against-index hunk reversed.
 *
 * The final terminator follows the index only when a hunk reaches the end of the
 * working copy, because that is where the end of the file is part of the change.
 */
export function revertHunks(
  index: TextLines | null,
  worktree: TextLines | null,
  hunks: readonly LineHunk[]
): string {
  const reversed = reverseHunks(hunks)
  const lines = applyHunks(worktree?.lines ?? [], index?.lines ?? [], reversed)
  const reachesEnd = reversed.some((hunk) => hunk.aStart + hunk.aLines >= lineCount(worktree))
  return joinText({
    lines,
    finalNewline: reachesEnd ? (index?.finalNewline ?? false) : (worktree?.finalNewline ?? false)
  })
}

/**
 * The index text after removing `hunks`: HEAD's lines return where a prepared
 * change had replaced them.
 *
 * Null when the path must leave the index instead. That is the case of a hunk
 * that was the whole of a path HEAD does not have: writing the empty text would
 * leave an empty file staged, where removing the change must take the path out
 * of the index.
 */
export function unstageHunks(
  head: TextLines | null,
  index: TextLines | null,
  hunks: readonly LineHunk[]
): string | null {
  const reversed = reverseHunks(hunks)
  const lines = applyHunks(index?.lines ?? [], head?.lines ?? [], reversed)
  const reachesEnd = reversed.some((hunk) => hunk.aStart + hunk.aLines >= lineCount(index))
  const finalNewline = reachesEnd ? (head?.finalNewline ?? false) : (index?.finalNewline ?? false)

  if (head === null && lines.length === 0 && !finalNewline) return null
  return joinText({ lines, finalNewline })
}
