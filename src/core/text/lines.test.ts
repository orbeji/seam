// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { joinText, normaliseLineEndings, splitText } from './lines'

describe('splitText', () => {
  it('gives no lines for the empty file', () => {
    expect(splitText('')).toEqual({ lines: [], finalNewline: false })
  })

  it('keeps the final newline apart from the lines', () => {
    expect(splitText('a\nb\n')).toEqual({ lines: ['a', 'b'], finalNewline: true })
  })

  it('marks a missing final newline', () => {
    expect(splitText('a\nb')).toEqual({ lines: ['a', 'b'], finalNewline: false })
  })

  it('reads a file of only a newline as one empty line', () => {
    expect(splitText('\n')).toEqual({ lines: [''], finalNewline: true })
  })

  it('keeps interior empty lines', () => {
    expect(splitText('a\n\nb\n')).toEqual({ lines: ['a', '', 'b'], finalNewline: true })
  })

  it('keeps the carriage return of a CRLF file', () => {
    expect(splitText('a\r\nb\r\n')).toEqual({ lines: ['a\r', 'b\r'], finalNewline: true })
  })

  it('keeps a lone carriage return as content', () => {
    expect(splitText('a\rb\n')).toEqual({ lines: ['a\rb'], finalNewline: true })
  })
})

describe('joinText', () => {
  it('is the inverse of splitText', () => {
    for (const text of ['', 'a', 'a\n', 'a\nb', 'a\nb\n', '\n', 'a\n\nb\n', 'café\nüber\n']) {
      expect(joinText(splitText(text))).toBe(text)
    }
  })

  it('round-trips CRLF text unchanged', () => {
    expect(joinText(splitText('a\r\nb\r\n'))).toBe('a\r\nb\r\n')
  })
})

describe('normaliseLineEndings', () => {
  it('turns CRLF into LF and leaves a lone CR alone', () => {
    expect(normaliseLineEndings('a\r\nb\r\n')).toBe('a\nb\n')
    expect(normaliseLineEndings('a\rb\n')).toBe('a\rb\n')
  })

  it('makes the lines of a CRLF and an LF file match', () => {
    expect(splitText(normaliseLineEndings('a\r\nb\r\n'))).toEqual(splitText('a\nb\n'))
  })
})
