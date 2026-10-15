// SPDX-License-Identifier: MIT

import { myersOps } from './myers'

/**
 * The inline diff: inside one line, which parts changed. It shares the engine
 * with the line diff but works on words or characters. Pure, like the rest of
 * `core/diff`.
 */

/** A granularity for inline highlighting. */
export type InlineUnit = 'word' | 'char'

/**
 * A changed run inside a line. `[aFrom, aTo)` and `[bFrom, bTo)` are offsets in
 * the line's own text, so the viewer can decorate both sides without recomputing
 * anything.
 */
export interface InlineChange {
  aFrom: number
  aTo: number
  bFrom: number
  bTo: number
}

/** Inline diffs run on single lines, so the budget only guards against long ones. */
const MAX_EDITS = 2048

/** One token inside a line: its text and its offset in the line. */
export interface InlineToken {
  text: string
  start: number
}

/** A run of letters, numbers and underscores, a run of spaces, or a run of other. */
const WORD_PATTERN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]+/gu

/**
 * Splits a line into the units the inline diff compares. The tokens cover the
 * whole text in order, so concatenating their texts returns the original. The
 * merge engine reuses it to look at a whole region word by word.
 */
export function tokenizeInline(text: string, unit: InlineUnit): InlineToken[] {
  const tokens: InlineToken[] = []

  if (unit === 'char') {
    let start = 0
    // Iterating a string yields code points, so a surrogate pair stays whole.
    for (const char of text) {
      tokens.push({ text: char, start })
      start += char.length
    }
    return tokens
  }

  for (const match of text.matchAll(WORD_PATTERN)) {
    tokens.push({ text: match[0], start: match.index })
  }
  return tokens
}

/**
 * The changed runs inside one line. An empty result means the lines are equal at
 * this granularity; a single change spanning both whole lines means the budget
 * was hit and the caller should highlight the line as a whole.
 */
export function diffInline(a: string, b: string, unit: InlineUnit): InlineChange[] {
  if (a === b) return []

  const aTokens = tokenizeInline(a, unit)
  const bTokens = tokenizeInline(b, unit)
  const ops = myersOps(
    aTokens.map((token) => token.text),
    bTokens.map((token) => token.text),
    MAX_EDITS
  )
  if (!ops) return [{ aFrom: 0, aTo: a.length, bFrom: 0, bTo: b.length }]

  const aOffset = (index: number): number =>
    index < aTokens.length ? (aTokens[index] as InlineToken).start : a.length
  const bOffset = (index: number): number =>
    index < bTokens.length ? (bTokens[index] as InlineToken).start : b.length

  const changes: InlineChange[] = []
  let aIndex = 0
  let bIndex = 0
  let current: InlineChange | null = null

  for (const op of ops) {
    if (op === 'equal') {
      if (current) {
        changes.push(current)
        current = null
      }
      aIndex += 1
      bIndex += 1
    } else if (op === 'delete') {
      if (current) {
        current.aTo = aOffset(aIndex + 1)
      } else {
        current = {
          aFrom: aOffset(aIndex),
          aTo: aOffset(aIndex + 1),
          bFrom: bOffset(bIndex),
          bTo: bOffset(bIndex)
        }
      }
      aIndex += 1
    } else {
      if (current) {
        current.bTo = bOffset(bIndex + 1)
      } else {
        current = {
          aFrom: aOffset(aIndex),
          aTo: aOffset(aIndex),
          bFrom: bOffset(bIndex),
          bTo: bOffset(bIndex + 1)
        }
      }
      bIndex += 1
    }
  }

  if (current) changes.push(current)
  return changes
}
