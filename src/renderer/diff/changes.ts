// SPDX-License-Identifier: MIT

import { diffInline, diffLines, type LineHunk, type WhitespaceMode } from '../../core/diff'
import { splitText } from '../../core/text'

/**
 * Turns our own diff engine into the shape CodeMirror's merge view consumes, so
 * the viewer's alignment, folding and highlighting all follow the engine instead
 * of a second diff implementation.
 *
 * This module is deliberately free of CodeMirror imports: it returns plain
 * ranges, and the viewer wraps them in CodeMirror's `Change`. That keeps it
 * testable under Node, where the CodeMirror view package cannot be imported.
 */

/** How finely a change is highlighted, matching the viewer's menu. */
export type HighlightGranularity = 'words' | 'lines' | 'split' | 'characters' | 'none'

export interface ChangeOptions {
  whitespace: WhitespaceMode
  granularity: HighlightGranularity
}

/** A changed range, in the shape CodeMirror's `Change` uses. */
export interface DiffChange {
  readonly fromA: number
  readonly toA: number
  readonly fromB: number
  readonly toB: number
}

/**
 * Marks a line that is the last of its file and has no closing newline. The
 * engine compares lines without their terminator, so without this the two files
 * would look the same at the end when one of them is missing the final newline.
 * A NUL byte cannot appear here: a file containing one is handled as binary.
 */
const NO_NEWLINE = '\u0000'

function diffLinesOf(lines: readonly string[], finalNewline: boolean): string[] {
  if (finalNewline || lines.length === 0) return lines.slice()
  const marked = lines.slice()
  marked[marked.length - 1] = `${marked[marked.length - 1] as string}${NO_NEWLINE}`
  return marked
}

/**
 * The character offset of the start of each line, plus the end of the document.
 * A line's span reaches to where the next line starts, so it includes the line's
 * terminator, except on the last line when the file has no closing newline.
 */
function lineOffsets(lines: readonly string[], textLength: number): number[] {
  const offsets = new Array<number>(lines.length + 1)
  let position = 0
  for (let index = 0; index < lines.length; index += 1) {
    offsets[index] = position
    position += (lines[index] as string).length + 1
  }
  // Without a final newline the naive sum overshoots by one.
  offsets[lines.length] = Math.min(position, textLength)
  return offsets
}

/** The text a single line covers, its terminator included when it has one. */
function lineText(text: string, offsets: readonly number[], index: number): string {
  const from = offsets[index] ?? 0
  return text.slice(from, offsets[index + 1] ?? from)
}

/** The character range a run of lines covers, terminators included. */
function lineSpan(
  offsets: readonly number[],
  start: number,
  count: number
): { from: number; to: number } {
  const from = offsets[start] ?? 0
  const to = count > 0 ? (offsets[start + count] ?? from) : from
  return { from, to }
}

/** One change covering the whole block, used by the line and none granularities. */
function wholeHunk(
  changes: DiffChange[],
  offA: readonly number[],
  offB: readonly number[],
  hunk: LineHunk
): void {
  const a = lineSpan(offA, hunk.aStart, hunk.aLines)
  const b = lineSpan(offB, hunk.bStart, hunk.bLines)
  changes.push({ fromA: a.from, toA: a.to, fromB: b.from, toB: b.to })
}

/** One change per line of a changed block, so a large change reads as lines. */
function splitHunk(
  changes: DiffChange[],
  offA: readonly number[],
  offB: readonly number[],
  hunk: LineHunk
): void {
  if (hunk.aLines !== hunk.bLines) {
    wholeHunk(changes, offA, offB, hunk)
    return
  }

  for (let index = 0; index < hunk.aLines; index += 1) {
    const a = lineSpan(offA, hunk.aStart + index, 1)
    const b = lineSpan(offB, hunk.bStart + index, 1)
    changes.push({ fromA: a.from, toA: a.to, fromB: b.from, toB: b.to })
  }
}

/**
 * Words or characters: pair the lines of a balanced hunk and diff inside each.
 * The two line spans are compared whole, terminator included, so a difference in
 * the final newline is part of the change rather than left behind.
 */
function inlineHunk(
  changes: DiffChange[],
  aText: string,
  bText: string,
  offA: readonly number[],
  offB: readonly number[],
  hunk: LineHunk,
  unit: 'word' | 'char'
): void {
  if (hunk.aLines !== hunk.bLines) {
    wholeHunk(changes, offA, offB, hunk)
    return
  }

  for (let index = 0; index < hunk.aLines; index += 1) {
    const aIndex = hunk.aStart + index
    const bIndex = hunk.bStart + index
    const aFrom = offA[aIndex] ?? 0
    const bFrom = offB[bIndex] ?? 0
    const inline = diffInline(lineText(aText, offA, aIndex), lineText(bText, offB, bIndex), unit)

    if (inline.length === 0) {
      const a = lineSpan(offA, aIndex, 1)
      const b = lineSpan(offB, bIndex, 1)
      changes.push({ fromA: a.from, toA: a.to, fromB: b.from, toB: b.to })
      continue
    }
    for (const change of inline) {
      changes.push({
        fromA: aFrom + change.aFrom,
        toA: aFrom + change.aTo,
        fromB: bFrom + change.bFrom,
        toB: bFrom + change.bTo
      })
    }
  }
}

/**
 * The changed ranges between two documents, following the whitespace mode and
 * the highlight granularity the user picked.
 */
export function computeChanges(aText: string, bText: string, options: ChangeOptions): DiffChange[] {
  const a = splitText(aText)
  const b = splitText(bText)
  const offA = lineOffsets(a.lines, aText.length)
  const offB = lineOffsets(b.lines, bText.length)

  const changes: DiffChange[] = []
  for (const hunk of diffLines(
    diffLinesOf(a.lines, a.finalNewline),
    diffLinesOf(b.lines, b.finalNewline),
    options.whitespace
  )) {
    if (options.granularity === 'words' || options.granularity === 'characters') {
      inlineHunk(
        changes,
        aText,
        bText,
        offA,
        offB,
        hunk,
        options.granularity === 'words' ? 'word' : 'char'
      )
    } else if (options.granularity === 'split') {
      splitHunk(changes, offA, offB, hunk)
    } else {
      wholeHunk(changes, offA, offB, hunk)
    }
  }
  return changes
}
