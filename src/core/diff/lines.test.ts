// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { applyHunks, diffLines, lineKey, type WhitespaceMode } from './lines'

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

/** The alphabet the property test draws lines from, mixing plain and whitespace. */
const ALPHABET = ['', ' ', '  ', 'a', 'b', 'a ', ' a', 'a\t', 'ab', ' a b ', 'café', '🙂']

function randomLines(next: () => number): string[] {
  const count = Math.floor(next() * 9)
  const lines: string[] = []
  for (let i = 0; i < count; i += 1) {
    lines.push(ALPHABET[Math.floor(next() * ALPHABET.length)] as string)
  }
  return lines
}

describe('diffLines edge cases', () => {
  it('reports nothing for equal files', () => {
    expect(diffLines(['a', 'b'], ['a', 'b'], 'none')).toEqual([])
  })

  it('reports nothing for two empty files', () => {
    expect(diffLines([], [], 'none')).toEqual([])
  })

  it('reports one insertion when the left side is empty', () => {
    expect(diffLines([], ['a', 'b'], 'none')).toEqual([
      { aStart: 0, aLines: 0, bStart: 0, bLines: 2 }
    ])
  })

  it('reports one deletion when the right side is empty', () => {
    expect(diffLines(['a', 'b'], [], 'none')).toEqual([
      { aStart: 0, aLines: 2, bStart: 0, bLines: 0 }
    ])
  })

  it('separates changes that are far apart', () => {
    const hunks = diffLines(['a', 'b', 'c', 'd', 'e'], ['a', 'B', 'c', 'd', 'E'], 'none')
    expect(hunks).toEqual([
      { aStart: 1, aLines: 1, bStart: 1, bLines: 1 },
      { aStart: 4, aLines: 1, bStart: 4, bLines: 1 }
    ])
  })

  it('handles a missing final newline through the line arrays', () => {
    // splitText turns "a\nb" and "a\nb\n" into the same lines, so the engine sees
    // no change; the difference lives in `finalNewline`, not in the line diff.
    expect(diffLines(['a', 'b'], ['a', 'b'], 'none')).toEqual([])
  })

  it('keeps Unicode lines whole', () => {
    const hunks = diffLines(['café', '🙂', 'niño'], ['café', '🙃', 'niño'], 'none')
    expect(hunks).toEqual([{ aStart: 1, aLines: 1, bStart: 1, bLines: 1 }])
  })
})

describe('whitespace modes', () => {
  it('none sees trailing spaces as a change', () => {
    expect(diffLines(['a'], ['a '], 'none')).toEqual([
      { aStart: 0, aLines: 1, bStart: 0, bLines: 1 }
    ])
  })

  it('trim ignores leading and trailing spaces', () => {
    expect(diffLines(['  a  '], ['a'], 'trim')).toEqual([])
    expect(diffLines(['a'], ['\ta\t'], 'trim')).toEqual([])
  })

  it('ignore drops spaces and tabs anywhere', () => {
    expect(diffLines(['a b'], ['ab'], 'ignore')).toEqual([])
    expect(diffLines(['a\tb'], ['a b'], 'ignore')).toEqual([])
  })

  it('ignore-and-blank does not count added or removed blank lines', () => {
    expect(diffLines(['a', '', 'b'], ['a', 'b'], 'ignore-and-blank')).toEqual([])
    expect(diffLines(['a', 'b'], ['a', ' ', 'b'], 'ignore-and-blank')).toEqual([])
    expect(diffLines(['a', 'b'], ['a', 'x', 'b'], 'ignore-and-blank')).toEqual([
      { aStart: 1, aLines: 0, bStart: 1, bLines: 1 }
    ])
  })

  it('ignore-and-blank still points its ranges at the original lines', () => {
    const a = ['', 'a', ' ', 'b', '']
    const b = ['a', '', 'x', 'b']
    const hunks = diffLines(a, b, 'ignore-and-blank')
    expect(hunks).toEqual([{ aStart: 3, aLines: 0, bStart: 2, bLines: 1 }])
    expect(applyHunks(a, b, hunks).filter((line) => line.trim() !== '')).toEqual(['a', 'x', 'b'])
  })
})

describe('lineKey', () => {
  it('matches each mode', () => {
    expect(lineKey('  a  ', 'none')).toBe('  a  ')
    expect(lineKey('  a  ', 'trim')).toBe('a')
    expect(lineKey(' a b ', 'ignore')).toBe('ab')
    expect(lineKey('   ', 'ignore-and-blank')).toBe('')
  })
})

describe('the diff is a valid edit script', () => {
  const modes: WhitespaceMode[] = ['none', 'trim', 'ignore', 'ignore-and-blank']

  /** For ignore-and-blank, comparing the keys after dropping blank lines is the contract. */
  function signature(lines: string[], mode: WhitespaceMode): string[] {
    const keys = lines.map((line) => lineKey(line, mode))
    return mode === 'ignore-and-blank' ? keys.filter((key) => key !== '') : keys
  }

  it('reconstructs the right side exactly with mode none', () => {
    const next = random(1)
    for (let trial = 0; trial < 4000; trial += 1) {
      const a = randomLines(next)
      const b = randomLines(next)
      const hunks = diffLines(a, b, 'none')
      expect(applyHunks(a, b, hunks)).toEqual(b)
    }
  })

  it('reconstructs the right keys in every whitespace mode', () => {
    const next = random(2)
    for (const mode of modes) {
      for (let trial = 0; trial < 2000; trial += 1) {
        const a = randomLines(next)
        const b = randomLines(next)
        const hunks = diffLines(a, b, mode)
        expect(signature(applyHunks(a, b, hunks), mode)).toEqual(signature(b, mode))
      }
    }
  })

  it('never overlaps and stays in order', () => {
    const next = random(3)
    for (let trial = 0; trial < 2000; trial += 1) {
      const a = randomLines(next)
      const b = randomLines(next)
      const hunks = diffLines(a, b, 'none')
      let aCursor = 0
      let bCursor = 0
      for (const hunk of hunks) {
        expect(hunk.aStart).toBeGreaterThanOrEqual(aCursor)
        expect(hunk.bStart).toBeGreaterThanOrEqual(bCursor)
        expect(hunk.aLines).toBeGreaterThanOrEqual(0)
        expect(hunk.bLines).toBeGreaterThanOrEqual(0)
        aCursor = hunk.aStart + hunk.aLines
        bCursor = hunk.bStart + hunk.bLines
      }
    }
  })
})
