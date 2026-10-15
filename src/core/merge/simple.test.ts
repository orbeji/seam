// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { simpleMergeText } from './simple'

describe('simpleMergeText', () => {
  it('merges changes at the start and the end of the same line', () => {
    expect(simpleMergeText('hello world', 'HELLO world', 'hello there')).toBe('HELLO there')
  })

  it('merges changes separated by punctuation', () => {
    expect(simpleMergeText('a.b', 'A.b', 'a.B')).toBe('A.B')
  })

  it('refuses two changes inside the same word', () => {
    expect(simpleMergeText('hello', 'HELLO', 'heLLO')).toBeNull()
  })

  it('refuses two changes to the same word separated only by nothing', () => {
    expect(simpleMergeText('a b', 'X b', 'Y b')).toBeNull()
  })

  it('takes the left side when the sides differ only in spaces', () => {
    expect(simpleMergeText('a b', 'a  b', 'a\tb')).toBe('a  b')
    expect(simpleMergeText('a', 'a ', 'a')).toBe('a ')
  })

  it('returns the text itself when the sides are equal', () => {
    expect(simpleMergeText('base', 'same', 'same')).toBe('same')
  })

  it('refuses adding the same position on both sides (add/add)', () => {
    expect(simpleMergeText('', 'x', 'y')).toBeNull()
  })

  it('refuses a delete against a modify', () => {
    expect(simpleMergeText('a\nb\nc', '', 'a\nB\nc')).toBeNull()
  })

  it('merges edits on different lines of a multi-line region', () => {
    expect(
      simpleMergeText('one two\nthree four', 'one TWO\nthree four', 'one two\nthree FOUR')
    ).toBe('one TWO\nthree FOUR')
  })

  it('refuses edits on touching words of a region', () => {
    expect(simpleMergeText('alpha beta', 'ALPHA beta', 'alpha BETA')).toBe('ALPHA BETA')
    expect(simpleMergeText('alphabeta', 'ALPHABETA', 'alphaBETA')).toBeNull()
  })
})
