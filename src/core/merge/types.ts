// SPDX-License-Identifier: MIT

/**
 * The shapes the three-way merge works with. Pure types, shared by the builder
 * (`./regions`), the word-level resolver (`./simple`), the range tracker
 * (`./map-result`) and the operations (`./operations`).
 */

/** A half-open range of lines, `[start, end)`. */
export interface LineRange {
  start: number
  end: number
}

/** How the two sides of a region relate to the base. */
export type RegionKind = 'left-only' | 'right-only' | 'same' | 'conflict'

/** What has happened to one side of a region. */
export type SideState = 'none' | 'pending' | 'applied' | 'ignored'

/** The side of a region an operation works on. */
export type MergeSide = 'left' | 'right'

/** One merged region: the same stretch of the three versions and its result. */
export interface MergeRegion {
  id: number
  kind: RegionKind
  base: LineRange
  left: LineRange
  right: LineRange
  /** The region's range in the text of the result. */
  result: LineRange
  /** `none` when that side did not change the region at all. */
  leftState: SideState
  rightState: SideState
  /** The user changed the region's text by hand. */
  edited: boolean
  /** A conflict the word-level merge resolves on its own. */
  simple: boolean
}

/** The three versions and the regions between them. */
export interface MergeModel {
  base: string[]
  left: string[]
  right: string[]
  regions: MergeRegion[]
}

/** A model plus the text of the result, which starts as the base. */
export interface MergeState {
  model: MergeModel
  result: string[]
}

/** A replacement of the result's lines `[from, to)` by `insertedLines`. */
export interface ResultEdit {
  from: number
  to: number
  insertedLines: readonly string[]
}

/**
 * What an operation changed: the edits to replay over the result, in order, and
 * the state that follows them, so the interface can apply both in one
 * transaction of the editor.
 */
export interface MergePatch {
  edits: ResultEdit[]
  state: MergeState
}
