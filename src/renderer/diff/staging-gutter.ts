// SPDX-License-Identifier: MIT

import { RangeSet, type Extension, type Range } from '@codemirror/state'
import { GutterMarker, gutter, type EditorView } from '@codemirror/view'
import type { MarkerLine } from './staging-markers'

/**
 * The staging gutter of the viewer. It is attached to the working-copy side, so
 * a prepared change shows as a hollow dot next to its line and a change still to
 * prepare as a solid one. Clicking a marker asks for the hunk menu.
 */

/** A dot in the staging gutter, hollow, solid, or both at once. */
class StagingMarker extends GutterMarker {
  constructor(private readonly marker: MarkerLine | null) {
    super()
  }

  override toDOM(): HTMLElement {
    const dot = document.createElement('span')
    dot.className = markerClass(this.marker)
    return dot
  }
}

function markerClass(marker: MarkerLine | null): string {
  if (marker === null) return 'staging-marker staging-marker--spacer'
  const classes = ['staging-marker']
  if (marker.staged) classes.push('staging-marker--staged')
  if (marker.unstaged) classes.push('staging-marker--unstaged')
  return classes.join(' ')
}

/** Called with the marker under a click and the event that opened the menu. */
export type MarkerSelect = (marker: MarkerLine, event: MouseEvent) => void

/**
 * A gutter that draws the staging markers next to the working copy. `lines` are
 * the working-copy lines that carry a marker, from `markerLines`.
 */
export function stagingGutter(lines: readonly MarkerLine[], onSelect?: MarkerSelect): Extension {
  return gutter({
    class: 'staging-gutter',
    markers: (view: EditorView) => {
      const ranges = lines
        .filter((line) => line.line < view.state.doc.lines)
        .map((line): Range<GutterMarker> => {
          const marker: GutterMarker = new StagingMarker(line)
          return marker.range(view.state.doc.line(line.line + 1).from)
        })
      return RangeSet.of(ranges, true)
    },
    initialSpacer: () => new StagingMarker(null),
    domEventHandlers: {
      mousedown: (view, block, event) => {
        if (onSelect === undefined) return false
        const line = view.state.doc.lineAt(block.from).number - 1
        const marker = lines.find((candidate) => candidate.line === line)
        if (marker === undefined) return false
        onSelect(marker, event as MouseEvent)
        return true
      }
    }
  })
}
