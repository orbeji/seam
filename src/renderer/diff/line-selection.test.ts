// SPDX-License-Identifier: MIT

import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { selectedLines } from './line-selection'

/** A state whose selection runs from `anchor` to `head`, in either direction. */
function state(doc: string, anchor: number, head: number): EditorState {
  return EditorState.create({ doc }).update({ selection: { anchor, head } }).state
}

describe('the lines a selection covers', () => {
  it('covers nothing for a bare caret', () => {
    expect(selectedLines(EditorState.create({ doc: 'ab\ncd' }))).toEqual([])
    expect(selectedLines(state('ab\ncd', 2, 2))).toEqual([])
  })

  it('covers the line a selection sits on', () => {
    expect(selectedLines(state('ab\ncd', 0, 1))).toEqual([0])
    expect(selectedLines(state('ab\ncd', 4, 3))).toEqual([1])
  })

  it('covers every line a selection reaches into', () => {
    expect(selectedLines(state('ab\ncd\nef', 1, 4))).toEqual([0, 1])
    expect(selectedLines(state('ab\ncd\nef', 0, 7))).toEqual([0, 1, 2])
  })

  it('does not reach into the next line when the selection stops at its start', () => {
    // Selecting `ab\n` stops where `cd` begins, so `cd` is not covered.
    expect(selectedLines(state('ab\ncd', 0, 3))).toEqual([0])
    expect(selectedLines(state('ab\ncd\nef', 0, 6))).toEqual([0, 1])
  })

  it('covers the last line when the selection reaches the end of the text', () => {
    expect(selectedLines(state('ab\ncd', 0, 5))).toEqual([0, 1])
  })
})
