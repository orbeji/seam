// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { decodeText, encodeText, isBinary } from './bytes'

const encoder = new TextEncoder()

describe('isBinary', () => {
  it('reads text as text', () => {
    expect(isBinary(encoder.encode('hello\nworld\n'))).toBe(false)
  })

  it('reads an empty file as text', () => {
    expect(isBinary(new Uint8Array(0))).toBe(false)
  })

  it('calls a file with a NUL binary', () => {
    expect(isBinary(new Uint8Array([0x68, 0x00, 0x69]))).toBe(true)
  })

  it('only looks near the start', () => {
    const bytes = new Uint8Array(9000).fill(0x61)
    bytes[8500] = 0
    expect(isBinary(bytes)).toBe(false)
  })
})

describe('decodeText', () => {
  it('decodes UTF-8', () => {
    expect(decodeText(encoder.encode('café'))).toBe('café')
  })

  it('strips a UTF-8 byte-order mark', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode('hola')])
    expect(decodeText(bytes)).toBe('hola')
  })

  it('decodes UTF-16 little-endian', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x62, 0x00])
    expect(decodeText(bytes)).toBe('ab')
  })

  it('decodes UTF-16 big-endian', () => {
    const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x61, 0x00, 0x62])
    expect(decodeText(bytes)).toBe('ab')
  })
})

describe('encodeText', () => {
  it('writes plain UTF-8 when there is no file to follow', () => {
    expect(encodeText('café', null)).toEqual(encoder.encode('café'))
  })

  it('round-trips UTF-8', () => {
    expect(decodeText(encodeText('hola', encoder.encode('x')))).toBe('hola')
  })

  it('keeps the byte-order mark of the file it follows', () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode('hola')])
    expect(encodeText('adios', utf8)).toEqual(
      new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode('adios')])
    )
  })

  it('keeps UTF-16 little-endian and its mark', () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x61, 0x00])
    expect(encodeText('ab', utf16)).toEqual(new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x62, 0x00]))
    expect(decodeText(encodeText('café', utf16))).toBe('café')
  })

  it('keeps UTF-16 big-endian and its mark', () => {
    const utf16 = new Uint8Array([0xfe, 0xff, 0x00, 0x61])
    expect(encodeText('ab', utf16)).toEqual(new Uint8Array([0xfe, 0xff, 0x00, 0x61, 0x00, 0x62]))
    expect(decodeText(encodeText('café', utf16))).toBe('café')
  })
})
