// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { isSecondaryPress } from './secondary-click'

function press(type: string, button: number): ReactMouseEvent {
  return { type, button } as unknown as ReactMouseEvent
}

describe('isSecondaryPress', () => {
  it('opens the menu on a right-button press even without a contextmenu event', () => {
    expect(isSecondaryPress(press('mousedown', 2))).toBe(true)
  })

  it('opens the menu on a contextmenu event, including the keyboard one', () => {
    expect(isSecondaryPress(press('contextmenu', 0))).toBe(true)
  })

  it('ignores a left-button press', () => {
    expect(isSecondaryPress(press('mousedown', 0))).toBe(false)
  })
})
