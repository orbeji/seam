// SPDX-License-Identifier: MIT

/**
 * Turning a file's text into lines and back. Pure: it runs both in the main
 * process and in the interface (and in a worker), so it stays free of Node and
 * of the browser.
 *
 * Splitting keeps the `CR` at the end of a line on purpose. Whether a `CRLF`
 * working copy over an `LF` index is a change depends on `core.autocrlf` and the
 * attributes, which Git decides; {@link normaliseLineEndings} applies that
 * decision explicitly instead of hiding it here.
 */

export interface TextLines {
  /** The lines, without their terminators but keeping a trailing `CR`. */
  lines: string[]
  /** Whether the text ended with a line terminator. */
  finalNewline: boolean
}

/**
 * Splits text on `LF`. A trailing terminator does not add an extra empty line;
 * the empty file has no lines at all. A lone `CR` is content, which is what Git
 * does.
 */
export function splitText(text: string): TextLines {
  const finalNewline = text.endsWith('\n')
  const body = finalNewline ? text.slice(0, -1) : text
  const lines = body === '' ? (finalNewline ? [''] : []) : body.split('\n')
  return { lines, finalNewline }
}

/** The inverse of {@link splitText}. */
export function joinText({ lines, finalNewline }: TextLines): string {
  const body = lines.join('\n')
  return finalNewline ? `${body}\n` : body
}

/**
 * Turns `CRLF` into `LF`. Callers use it only when Git would too, so a stray
 * `CRLF` that Git reports as a change keeps being a change.
 */
export function normaliseLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n')
}
