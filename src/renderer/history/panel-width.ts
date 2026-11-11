// SPDX-License-Identifier: MIT

import { DEFAULT_HISTORY_WIDTH, MAX_HISTORY_WIDTH, MIN_HISTORY_WIDTH } from '../../shared/ipc'

/**
 * The room the file sidebar and the work area need beside the history panel.
 * A dragged panel stops growing here so the diff never loses its window.
 */
const BESIDE_THE_PANEL = 460

/** The widest the panel can be in a window of this width. */
export function maxHistoryWidth(viewportWidth: number): number {
  return Math.max(MIN_HISTORY_WIDTH, Math.min(MAX_HISTORY_WIDTH, viewportWidth - BESIDE_THE_PANEL))
}

/** Keeps a dragged or stored width inside the panel's limits for the window. */
export function clampHistoryWidth(width: number, viewportWidth: number): number {
  const maximum = maxHistoryWidth(viewportWidth)
  if (!Number.isFinite(width)) return Math.min(DEFAULT_HISTORY_WIDTH, maximum)
  return Math.min(Math.max(Math.round(width), MIN_HISTORY_WIDTH), maximum)
}
