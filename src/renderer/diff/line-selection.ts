// SPDX-License-Identifier: MIT

import type { EditorState } from '@codemirror/state'

/**
 * The working-copy lines a CodeMirror selection touches, 0-based and from the
 * first to the last. A bare caret selects nothing, because a cursor is not a
 * selection. A selection that ends exactly at the start of the following line
 * does not reach into it, which is what selecting a whole line looks like.
 *
 * Pure: it reads an editor state but touches no DOM, so it is tested on its own.
 */
export function selectedLines(state: EditorState): number[] {
  const range = state.selection.main
  if (range.empty) return []

  const first = state.doc.lineAt(range.from).number - 1
  const endsAtLineStart = range.to > range.from && state.doc.lineAt(range.to).from === range.to
  const last = state.doc.lineAt(range.to - (endsAtLineStart ? 1 : 0)).number - 1

  const lines: number[] = []
  for (let line = first; line <= last; line += 1) lines.push(line)
  return lines
}
