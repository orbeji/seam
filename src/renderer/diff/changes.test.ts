// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { computeChanges, type DiffChange, type HighlightGranularity } from './changes'

const GRANULARITIES: readonly HighlightGranularity[] = [
  'words',
  'lines',
  'split',
  'characters',
  'none'
]

/** A small deterministic generator so a failing case can be reproduced. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Lines chosen to exercise spaces, tabs and non-ASCII text. */
const WORDS = ['', 'a', 'b', 'a b', '  a', 'a  ', 'x y z'] as const

function pick(next: () => number): string {
  return WORDS[Math.floor(next() * WORDS.length)] as string
}

/** Applies the changes to the first document; the result must be the second. */
function reconstruct(aText: string, bText: string, changes: readonly DiffChange[]): string {
  let result = ''
  let position = 0
  for (const change of changes) {
    result += aText.slice(position, change.fromA)
    result += bText.slice(change.fromB, change.toB)
    position = change.toA
  }
  return result + aText.slice(position)
}

describe('computeChanges', () => {
  it('reconstructs the second document from the first at every granularity', () => {
    const next = random(0x5ea3)
    for (let round = 0; round < 600; round += 1) {
      const aLines = Array.from({ length: Math.floor(next() * 6) }, () => pick(next))
      const bLines = aLines.map((line) => (next() < 0.5 ? pick(next) : line))
      if (next() < 0.3) bLines.push(pick(next))
      if (next() < 0.3 && bLines.length > 0) {
        bLines.splice(Math.floor(next() * bLines.length), 1)
      }

      const aText = aLines.join('\n') + (next() < 0.5 ? '\n' : '')
      const bText = bLines.join('\n') + (next() < 0.5 ? '\n' : '')

      for (const granularity of GRANULARITIES) {
        const changes = computeChanges(aText, bText, { whitespace: 'none', granularity })
        expect(
          reconstruct(aText, bText, changes),
          `${granularity} round ${round} a=${JSON.stringify(aText)} b=${JSON.stringify(bText)}`
        ).toBe(bText)
      }
    }
  })

  it('covers the whole changed line at line granularity', () => {
    const changes = computeChanges('a\nb\nc\n', 'a\nX\nc\n', {
      whitespace: 'none',
      granularity: 'lines'
    })
    expect(changes).toEqual([{ fromA: 2, toA: 4, fromB: 2, toB: 4 }])
  })

  it('collapses to a single insertion point when a line is added', () => {
    const changes = computeChanges('a\nc\n', 'a\nb\nc\n', {
      whitespace: 'none',
      granularity: 'lines'
    })
    expect(changes).toEqual([{ fromA: 2, toA: 2, fromB: 2, toB: 4 }])
  })

  it('marks the differing characters inside a changed line', () => {
    const changes: DiffChange[] = computeChanges('one\ntwo\n', 'one\nTWO!\n', {
      whitespace: 'none',
      granularity: 'characters'
    })
    expect(changes).toEqual([{ fromA: 4, toA: 7, fromB: 4, toB: 8 }])
  })
})

describe('the final newline', () => {
  const options = { whitespace: 'none' as const }

  it('is a change when one side has it and the other does not', () => {
    for (const granularity of GRANULARITIES) {
      const removed = computeChanges('a\nb\n', 'a\nb', { ...options, granularity })
      const added = computeChanges('a\nb', 'a\nb\n', { ...options, granularity })

      expect(removed, granularity).not.toEqual([])
      expect(added, granularity).not.toEqual([])
      expect(reconstruct('a\nb\n', 'a\nb', removed)).toBe('a\nb')
      expect(reconstruct('a\nb', 'a\nb\n', added)).toBe('a\nb\n')
    }
  })

  it('is nothing when both sides lack it', () => {
    expect(computeChanges('a\nb', 'a\nb', { ...options, granularity: 'words' })).toEqual([])
  })

  it('is kept when a line at the end also changed', () => {
    const changes = computeChanges('x\ny\n', 'x\nz', { ...options, granularity: 'words' })
    expect(reconstruct('x\ny\n', 'x\nz', changes)).toBe('x\nz')
  })

  it('does not swallow the separator before an appended line', () => {
    const changes = computeChanges('a\nb', 'a\nb\nc', { ...options, granularity: 'words' })
    expect(reconstruct('a\nb', 'a\nb\nc', changes)).toBe('a\nb\nc')
  })
})

describe('whitespace modes', () => {
  const options = { granularity: 'words' as const }

  it('shows a whitespace-only change when everything is shown', () => {
    expect(computeChanges('a b\n', 'a  b\n', { ...options, whitespace: 'none' })).not.toEqual([])
  })

  it('hides a whitespace-only change when whitespace is ignored', () => {
    expect(computeChanges('a b\n', 'a  b\n', { ...options, whitespace: 'ignore' })).toEqual([])
  })

  it('hides leading and trailing whitespace when only the ends are ignored', () => {
    expect(computeChanges('a \n', 'a\n', { ...options, whitespace: 'trim' })).toEqual([])
    expect(computeChanges('a\n', 'a b\n', { ...options, whitespace: 'trim' })).not.toEqual([])
  })

  it('drops added blank lines when they are ignored', () => {
    const before = computeChanges('a\nb\n', 'a\n\nb\n', {
      ...options,
      whitespace: 'ignore-and-blank'
    })
    const after = computeChanges('a\nb\n', 'a\n\nb\n', { ...options, whitespace: 'none' })
    expect(before).toEqual([])
    expect(after).not.toEqual([])
  })
})
