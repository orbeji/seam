// SPDX-License-Identifier: MIT

import { myersOps, type Op } from './myers'

/**
 * The line diff. It compares two versions of a file and returns the smallest
 * set of ranges that turns one into the other. Pure (no Node, no DOM) so the
 * interface can run it, including inside a worker for large files.
 *
 * It builds on the Myers engine in `./myers`. It keeps an edit-script budget:
 * past it the engine reports the whole differing middle as a single hunk, which
 * is still correct, only coarser, and bounds the memory the trace needs.
 */

/** How the engine compares lines, mirroring the reference client's whitespace options. */
export type WhitespaceMode = 'none' | 'trim' | 'ignore' | 'ignore-and-blank'

/** The whitespace modes in the order the viewer lists them. */
export const WHITESPACE_MODES: readonly WhitespaceMode[] = [
  'none',
  'trim',
  'ignore',
  'ignore-and-blank'
]

/**
 * A changed region: `a`'s lines `[aStart, aStart + aLines)` become `b`'s lines
 * `[bStart, bStart + bLines)`. A pure insertion has `aLines === 0`, a pure
 * deletion has `bLines === 0`.
 */
export interface LineHunk {
  aStart: number
  aLines: number
  bStart: number
  bLines: number
}

/**
 * How many edits Myers may make before the engine gives up. The trace it keeps
 * grows with the square of this, so the cap bounds memory; a middle that changes
 * in more places than this is rare, and the coarse hunk is still correct.
 */
const MAX_EDITS = 3000

/** The string two lines are compared by, according to the whitespace mode. */
export function lineKey(line: string, mode: WhitespaceMode): string {
  switch (mode) {
    case 'none':
      return line
    case 'trim':
      return line.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '')
    case 'ignore':
    case 'ignore-and-blank':
      return line.replace(/[ \t]+/g, '')
  }
}

/** Groups a run of deletes and inserts between equal lines into one hunk. */
function opsToHunks(ops: readonly Op[]): LineHunk[] {
  const hunks: LineHunk[] = []
  let aIndex = 0
  let bIndex = 0
  let current: LineHunk | null = null

  for (const op of ops) {
    if (op === 'equal') {
      if (current) {
        hunks.push(current)
        current = null
      }
      aIndex += 1
      bIndex += 1
    } else if (op === 'delete') {
      current ??= { aStart: aIndex, aLines: 0, bStart: bIndex, bLines: 0 }
      current.aLines += 1
      aIndex += 1
    } else {
      current ??= { aStart: aIndex, aLines: 0, bStart: bIndex, bLines: 0 }
      current.bLines += 1
      bIndex += 1
    }
  }

  if (current) hunks.push(current)
  return hunks
}

/**
 * Moves a hunk from key-space (the sequences after dropping ignored lines) to
 * line numbers in the original arrays.
 */
function mapHunk(
  hunk: LineHunk,
  mapA: readonly number[],
  mapB: readonly number[],
  aLength: number,
  bLength: number
): LineHunk {
  const aStart =
    hunk.aLines > 0
      ? (mapA[hunk.aStart] as number)
      : hunk.aStart < mapA.length
        ? (mapA[hunk.aStart] as number)
        : aLength
  const aEnd = hunk.aLines > 0 ? (mapA[hunk.aStart + hunk.aLines - 1] as number) + 1 : aStart
  const bStart =
    hunk.bLines > 0
      ? (mapB[hunk.bStart] as number)
      : hunk.bStart < mapB.length
        ? (mapB[hunk.bStart] as number)
        : bLength
  const bEnd = hunk.bLines > 0 ? (mapB[hunk.bStart + hunk.bLines - 1] as number) + 1 : bStart
  return { aStart, aLines: aEnd - aStart, bStart, bLines: bEnd - bStart }
}

/**
 * The changed regions between two files. With `ignore-and-blank` the lines that
 * hold only spaces are left out of the comparison, so adding or removing them is
 * not a change; the returned ranges still point at the original lines.
 */
export function diffLines(
  a: readonly string[],
  b: readonly string[],
  mode: WhitespaceMode
): LineHunk[] {
  const dropBlank = mode === 'ignore-and-blank'
  const keysA: string[] = []
  const mapA: number[] = []
  const keysB: string[] = []
  const mapB: number[] = []

  for (let i = 0; i < a.length; i += 1) {
    const key = lineKey(a[i] as string, mode)
    if (dropBlank && key === '') continue
    keysA.push(key)
    mapA.push(i)
  }
  for (let i = 0; i < b.length; i += 1) {
    const key = lineKey(b[i] as string, mode)
    if (dropBlank && key === '') continue
    keysB.push(key)
    mapB.push(i)
  }

  let prefix = 0
  while (prefix < keysA.length && prefix < keysB.length && keysA[prefix] === keysB[prefix]) {
    prefix += 1
  }
  const available = Math.min(keysA.length - prefix, keysB.length - prefix)
  let suffix = 0
  while (
    suffix < available &&
    keysA[keysA.length - 1 - suffix] === keysB[keysB.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const midA = keysA.slice(prefix, keysA.length - suffix)
  const midB = keysB.slice(prefix, keysB.length - suffix)
  if (midA.length === 0 && midB.length === 0) return []

  const ops = myersOps(midA, midB, MAX_EDITS)
  const keyHunks: LineHunk[] = ops
    ? opsToHunks(ops)
    : [{ aStart: 0, aLines: midA.length, bStart: 0, bLines: midB.length }]

  return keyHunks.map((hunk) =>
    mapHunk(
      {
        aStart: hunk.aStart + prefix,
        aLines: hunk.aLines,
        bStart: hunk.bStart + prefix,
        bLines: hunk.bLines
      },
      mapA,
      mapB,
      a.length,
      b.length
    )
  )
}

/**
 * Rebuilds `b` from `a` by taking `b`'s lines wherever a hunk says so. With mode
 * `none` the result is exactly `b`; with a whitespace mode the lines the mode
 * ignored keep `a`'s text, which is the point of ignoring them.
 */
export function applyHunks(
  a: readonly string[],
  b: readonly string[],
  hunks: readonly LineHunk[]
): string[] {
  const out: string[] = []
  let cursor = 0
  for (const hunk of hunks) {
    for (let i = cursor; i < hunk.aStart; i += 1) out.push(a[i] as string)
    for (let i = hunk.bStart; i < hunk.bStart + hunk.bLines; i += 1) out.push(b[i] as string)
    cursor = hunk.aStart + hunk.aLines
  }
  for (let i = cursor; i < a.length; i += 1) out.push(a[i] as string)
  return out
}
