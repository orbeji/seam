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
