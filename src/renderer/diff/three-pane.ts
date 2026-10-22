// SPDX-License-Identifier: MIT

import { alignThree, type AlignedRow } from '../../core/diff'
import type { DiffSide, HunkRange } from '../../shared/ipc'

/**
 * The editing model of the three-pane view. The centre holds the index, and the
 * arrows take a line from HEAD or from the working copy into it; nothing is
 * written until the view is done. It is pure and touches nothing of the DOM, so
 * it is tested on its own.
 */

/** A row of the three-pane view with the text of each version and its changes. */
export interface ThreeRow {
  /** Which line of each version the row holds. */
  readonly aligned: AlignedRow
  readonly headText: string | null
  readonly indexText: string | null
  readonly worktreeText: string | null
  /** HEAD differs from the index here, so the row is part of a prepared hunk. */
  readonly staged: boolean
  /** The working copy differs from the index here: a hunk still to prepare. */
  readonly unstaged: boolean
}

/** The index line a row holds, which may have been taken from either side. */
export interface ThreeMiddle {
  /** Whether the index text holds a line here at all. */
  readonly present: boolean
  readonly text: string
  /** The version the text was last taken from, for the closing newline. */
  readonly source: 'head' | 'index' | 'worktree'
}

/** The whole state of the three-pane view: the rows and the editable centre. */
export interface ThreePaneState {
  readonly rows: readonly ThreeRow[]
  readonly middle: readonly ThreeMiddle[]
  /** Whether each version ends with a newline. */
  readonly finalNewlines: {
    readonly head: boolean
    readonly index: boolean
    readonly worktree: boolean
  }
  /** The index text the view was opened with, so an unchanged Done writes nothing. */
  readonly originalText: string
}

/** Which side an arrow takes a line from. */
export type ThreeSource = 'head' | 'worktree'

function textOf(
  middle: readonly ThreeMiddle[],
  finalNewlines: ThreePaneState['finalNewlines']
): string {
  const present = middle.filter((entry) => entry.present)
  if (present.length === 0) return ''
  const last = present[present.length - 1] as ThreeMiddle
  const newline = finalNewlines[last.source] ? '\n' : ''
  return present.map((entry) => entry.text).join('\n') + newline
}

/** Builds the rows and the starting centre from the three versions of a file. */
export function buildThreePane(
  head: DiffSide | null,
  index: DiffSide | null,
  worktree: DiffSide | null,
  staged: readonly HunkRange[],
  unstaged: readonly HunkRange[]
): ThreePaneState {
  const headLines = head?.lines ?? []
  const indexLines = index?.lines ?? []
  const worktreeLines = worktree?.lines ?? []

  const rows = alignThree(headLines, indexLines, worktreeLines, staged, unstaged).map(
    (aligned): ThreeRow => {
      const headText = aligned.head === null ? null : (headLines[aligned.head] as string)
      const indexText = aligned.index === null ? null : (indexLines[aligned.index] as string)
      const worktreeText =
        aligned.worktree === null ? null : (worktreeLines[aligned.worktree] as string)
      return {
        aligned,
        headText,
        indexText,
        worktreeText,
        staged: headText !== indexText,
        unstaged: worktreeText !== indexText
      }
    }
  )

  const middle = rows.map((row): ThreeMiddle => ({
    present: row.indexText !== null,
    text: row.indexText ?? '',
    source: 'index'
  }))
  const finalNewlines = {
    head: head?.finalNewline ?? false,
    index: index?.finalNewline ?? false,
    worktree: worktree?.finalNewline ?? false
  }

  return { rows, middle, finalNewlines, originalText: textOf(middle, finalNewlines) }
}

/** The index line taking a row from `from` produces, or none when it removes it. */
function contribution(row: ThreeRow, from: ThreeSource): { present: boolean; text: string } {
  const text = from === 'head' ? row.headText : row.worktreeText
  return text === null ? { present: false, text: '' } : { present: true, text }
}

/**
 * Recomputes what is prepared and what is still pending. The middle is the
 * index the view is preparing, so the flags follow every take and edit rather
 * than the index the view opened with.
 */
function withFlags(state: ThreePaneState): ThreePaneState {
  const rows = state.rows.map((row, at): ThreeRow => {
    const middle = state.middle[at]
    const text = middle?.present === true ? middle.text : null
    return {
      ...row,
      staged: row.headText !== text,
      unstaged: row.worktreeText !== text
    }
  })
  return { ...state, rows }
}

function replaceMiddle(state: ThreePaneState, row: number, next: ThreeMiddle): ThreePaneState {
  const middle = state.middle.map((entry, at) => (at === row ? next : entry))
  return withFlags({ ...state, middle })
}

/** Takes one row's line from HEAD (`head`) or the working copy (`worktree`). */
export function takeLine(state: ThreePaneState, row: number, from: ThreeSource): ThreePaneState {
  const target = state.rows[row]
  if (target === undefined) return state
  return replaceMiddle(state, row, { ...contribution(target, from), source: from })
}

/** Takes the whole change around a row from HEAD or the working copy. */
export function takeHunk(state: ThreePaneState, row: number, from: ThreeSource): ThreePaneState {
  const flag = from === 'head' ? 'staged' : 'unstaged'
  const target = state.rows[row]
  if (target === undefined || !target[flag]) return state

  let first = row
  while (first > 0 && (state.rows[first - 1] as ThreeRow)[flag]) first -= 1
  let last = row
  while (last + 1 < state.rows.length && (state.rows[last + 1] as ThreeRow)[flag]) last += 1

  const middle = state.middle.map((entry, at) => {
    const source = state.rows[at]
    if (source === undefined || at < first || at > last) return entry
    return { ...contribution(source, from), source: from }
  })
  return withFlags({ ...state, middle })
}

/** Takes every change still pending on one side, leaving the other side alone. */
export function takeAll(state: ThreePaneState, from: ThreeSource): ThreePaneState {
  const flag = from === 'head' ? 'staged' : 'unstaged'
  if (!state.rows.some((row) => row[flag])) return state

  const middle = state.middle.map((entry, at) => {
    const source = state.rows[at]
    if (source === undefined || !source[flag]) return entry
    return { ...contribution(source, from), source: from }
  })
  return withFlags({ ...state, middle })
}

/** Replaces the text of one centre line, which becomes part of the index. */
export function editLine(state: ThreePaneState, row: number, text: string): ThreePaneState {
  const entry = state.middle[row]
  if (entry === undefined) return state
  return replaceMiddle(state, row, { ...entry, text, present: entry.present || text !== '' })
}

/** The index text the centre holds, ready to be written on Done. */
export function middleText(state: ThreePaneState): string {
  return textOf(state.middle, state.finalNewlines)
}
