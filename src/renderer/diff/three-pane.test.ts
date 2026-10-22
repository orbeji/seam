// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { buildFileModel } from '../../core/diff'
import type { TextLines } from '../../core/text'
import {
  buildThreePane,
  editLine,
  middleText,
  takeAll,
  takeHunk,
  takeLine,
  type ThreePaneState
} from './three-pane'

function lines(contents: readonly string[]): TextLines {
  return { lines: [...contents], finalNewline: false }
}

function pane(head: string[], index: string[], worktree: string[]): ThreePaneState {
  const model = buildFileModel(lines(head), lines(index), lines(worktree))
  return buildThreePane(model.head, model.index, model.worktree, model.staged, model.unstaged)
}

/** The row that holds the given index line. */
function rowOfIndex(state: ThreePaneState, line: number): number {
  return state.rows.findIndex((row) => row.aligned.index === line)
}

/** The row that holds the given working-copy line. */
function rowOfWorktree(state: ThreePaneState, line: number): number {
  return state.rows.findIndex((row) => row.aligned.worktree === line)
}

describe('the three-pane model', () => {
  it('opens with the index in the centre', () => {
    const state = pane(['a', 'b'], ['a', 'b'], ['a', 'B'])
    expect(middleText(state)).toBe('a\nb')
    expect(state.originalText).toBe('a\nb')
  })

  it('flags the rows each change touches', () => {
    const pending = pane(['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'B', 'c'])
    const pendingRow = pending.rows[rowOfIndex(pending, 1)] as (typeof pending.rows)[number]
    expect(pendingRow.staged).toBe(false)
    expect(pendingRow.unstaged).toBe(true)

    const prepared = pane(['a', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c'])
    const preparedRow = prepared.rows[rowOfIndex(prepared, 1)] as (typeof prepared.rows)[number]
    expect(preparedRow.staged).toBe(true)
    expect(preparedRow.unstaged).toBe(false)
  })

  it('takes a changed line from the working copy', () => {
    const state = pane(['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'B', 'c'])
    expect(middleText(takeLine(state, rowOfIndex(state, 1), 'worktree'))).toBe('a\nB\nc')
  })

  it('puts a line back from HEAD', () => {
    const state = pane(['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'B', 'c'])
    const taken = takeLine(state, rowOfIndex(state, 1), 'worktree')
    expect(middleText(takeLine(taken, rowOfIndex(taken, 1), 'head'))).toBe('a\nb\nc')
  })

  it('removes a line HEAD does not have when taken from HEAD', () => {
    const state = pane(['a', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c'])
    expect(middleText(takeLine(state, rowOfIndex(state, 1), 'head'))).toBe('a\nc')
  })

  it('adds a line the index lacks when taken from the working copy', () => {
    const state = pane(['a', 'b'], ['a', 'b'], ['a', 'x', 'b'])
    expect(middleText(takeLine(state, rowOfWorktree(state, 1), 'worktree'))).toBe('a\nx\nb')
  })

  it('removes a line the working copy deleted', () => {
    const state = pane(['a', 'b'], ['a', 'b'], ['a'])
    expect(middleText(takeLine(state, rowOfIndex(state, 1), 'worktree'))).toBe('a')
  })

  it('takes a whole change from the working copy', () => {
    const state = pane(['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'B', 'C'])
    expect(middleText(takeHunk(state, rowOfIndex(state, 1), 'worktree'))).toBe('a\nB\nC')
  })

  it('marks a line taken from the working copy as prepared at once', () => {
    const state = pane(['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'B', 'c'])
    const taken = takeLine(state, rowOfIndex(state, 1), 'worktree')
    const row = taken.rows[rowOfIndex(taken, 1)] as (typeof taken.rows)[number]
    expect(row.staged).toBe(true)
    expect(row.unstaged).toBe(false)
  })

  it('takes every remaining change from the working copy at once', () => {
    const state = pane(['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'B', 'C'])
    expect(middleText(takeAll(state, 'worktree'))).toBe('a\nB\nC')
  })

  it('resets every prepared change to HEAD at once', () => {
    const state = pane(['a', 'b', 'c'], ['a', 'B', 'C'], ['a', 'B', 'C'])
    expect(middleText(takeAll(state, 'head'))).toBe('a\nb\nc')
  })

  it('takes a whole prepared change back from HEAD', () => {
    const state = pane(['a', 'b', 'c'], ['a', 'B', 'C'], ['a', 'B', 'C'])
    expect(middleText(takeHunk(state, rowOfIndex(state, 1), 'head'))).toBe('a\nb\nc')
  })

  it('edits a centre line directly', () => {
    const state = pane(['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'B', 'c'])
    expect(middleText(editLine(state, rowOfIndex(state, 1), 'rewritten'))).toBe('a\nrewritten\nc')
  })

  it('turns a blank row into an index line when it is typed into', () => {
    const state = pane(['a', 'b'], ['a', 'b'], ['a', 'x', 'b'])
    const row = rowOfWorktree(state, 1)
    expect(middleText(editLine(state, row, 'x'))).toBe('a\nx\nb')
  })
})
