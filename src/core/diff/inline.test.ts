// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { diffInline, type InlineChange } from './inline'

/** The slices a change points at, which is what the viewer will decorate. */
function slices(text: string, ranges: Array<[number, number]>): string[] {
  return ranges.map(([from, to]) => text.slice(from, to))
}

function aRanges(changes: InlineChange[]): Array<[number, number]> {
  return changes.map((change) => [change.aFrom, change.aTo])
}

function bRanges(changes: InlineChange[]): Array<[number, number]> {
  return changes.map((change) => [change.bFrom, change.bTo])
}

describe('diffInline by character', () => {
  it('reports nothing for equal lines', () => {
    expect(diffInline('same', 'same', 'char')).toEqual([])
  })

  it('finds the middle character', () => {
    const changes = diffInline('abc', 'axc', 'char')
    expect(slices('abc', aRanges(changes))).toEqual(['b'])
    expect(slices('axc', bRanges(changes))).toEqual(['x'])
  })

  it('finds an insertion', () => {
    const changes = diffInline('ac', 'abc', 'char')
    expect(slices('ac', aRanges(changes))).toEqual([''])
    expect(slices('abc', bRanges(changes))).toEqual(['b'])
  })

  it('finds a deletion', () => {
    const changes = diffInline('abc', 'ac', 'char')
    expect(slices('abc', aRanges(changes))).toEqual(['b'])
    expect(slices('ac', bRanges(changes))).toEqual([''])
  })

  it('keeps a surrogate pair whole', () => {
    const changes = diffInline('a🙂b', 'a🙃b', 'char')
    expect(slices('a🙂b', aRanges(changes))).toEqual(['🙂'])
    expect(slices('a🙃b', bRanges(changes))).toEqual(['🙃'])
  })

  it('handles the whole line changing', () => {
    const changes = diffInline('abc', 'xyz', 'char')
    expect(slices('abc', aRanges(changes))).toEqual(['abc'])
    expect(slices('xyz', bRanges(changes))).toEqual(['xyz'])
  })
})

describe('diffInline by word', () => {
  it('reports nothing for equal lines', () => {
    expect(diffInline('const a = 1', 'const a = 1', 'word')).toEqual([])
  })

  it('highlights only the changed word', () => {
    const changes = diffInline('const a = 1', 'const b = 1', 'word')
    expect(slices('const a = 1', aRanges(changes))).toEqual(['a'])
    expect(slices('const b = 1', bRanges(changes))).toEqual(['b'])
  })

  it('keeps punctuation apart from the word', () => {
    const changes = diffInline('foo(a)', 'foo(b)', 'word')
    expect(slices('foo(a)', aRanges(changes))).toEqual(['a'])
    expect(slices('foo(b)', bRanges(changes))).toEqual(['b'])
  })

  it('highlights an added word', () => {
    const changes = diffInline('a b', 'a c b', 'word')
    expect(slices('a c b', bRanges(changes))).toEqual(['c '])
  })

  it('handles a long run of words', () => {
    const changes = diffInline('one two three four', 'one TWO three four', 'word')
    expect(slices('one two three four', aRanges(changes))).toEqual(['two'])
    expect(slices('one TWO three four', bRanges(changes))).toEqual(['TWO'])
  })
})
