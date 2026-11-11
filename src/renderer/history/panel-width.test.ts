// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { DEFAULT_HISTORY_WIDTH, MAX_HISTORY_WIDTH, MIN_HISTORY_WIDTH } from '../../shared/ipc'
import { clampHistoryWidth, maxHistoryWidth } from './panel-width'

describe('clampHistoryWidth', () => {
  it('keeps a width the window has room for', () => {
    expect(clampHistoryWidth(420, 1280)).toBe(420)
  })

  it('never goes narrower than a readable panel', () => {
    expect(clampHistoryWidth(40, 1280)).toBe(MIN_HISTORY_WIDTH)
  })

  it('stops growing at its own limit in a wide window', () => {
    expect(clampHistoryWidth(2000, 1920)).toBe(MAX_HISTORY_WIDTH)
  })

  it('leaves the file sidebar and the work area their room in a narrow window', () => {
    expect(clampHistoryWidth(600, 900)).toBe(440)
    expect(maxHistoryWidth(900)).toBe(440)
  })

  it('uses the default width when the stored value is unusable', () => {
    expect(clampHistoryWidth(Number.NaN, 1280)).toBe(DEFAULT_HISTORY_WIDTH)
  })

  it('rounds a fractional drag to whole pixels', () => {
    expect(clampHistoryWidth(333.6, 1280)).toBe(334)
  })
})
