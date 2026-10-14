// SPDX-License-Identifier: MIT

/**
 * Reading the bytes of a file version: deciding whether it is binary and
 * turning it into text. Pure, so the interface can use it in a worker.
 */

/** How many bytes from the start are searched for a NUL before calling a file binary. */
export const BINARY_SNIFF_BYTES = 8000

/**
 * Git's own rule: a NUL byte near the start marks the file as binary. Binary
 * files get no line diff, only "differs" and the size of each side, so this runs
 * before any decoding.
 */
export function isBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < limit; i += 1) {
    if (bytes[i] === 0) return true
  }
  return false
}

const UTF8_BOM = [0xef, 0xbb, 0xbf]
const UTF16LE_BOM = [0xff, 0xfe]
const UTF16BE_BOM = [0xfe, 0xff]

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false
  return prefix.every((byte, index) => bytes[index] === byte)
}

/**
 * Decodes a file version to text, honouring a byte-order mark. Git normalises
 * the bytes it stores but a file on disk may carry a BOM or be UTF-16, and the
 * viewer should show it, not a line of replacement characters.
 */
export function decodeText(bytes: Uint8Array): string {
  if (startsWith(bytes, UTF16LE_BOM)) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(UTF16LE_BOM.length))
  }
  if (startsWith(bytes, UTF16BE_BOM)) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(UTF16BE_BOM.length))
  }
  if (startsWith(bytes, UTF8_BOM)) {
    return new TextDecoder('utf-8').decode(bytes.subarray(UTF8_BOM.length))
  }
  return new TextDecoder('utf-8').decode(bytes)
}
