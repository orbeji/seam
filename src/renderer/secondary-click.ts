// SPDX-License-Identifier: MIT

import type { MouseEvent as ReactMouseEvent } from 'react'

/**
 * Whether a mouse event should open a row's secondary menu.
 *
 * A right click normally arrives as a `contextmenu` event, but WSLg and some
 * Wayland sessions deliver the right-button press and drop the `contextmenu`
 * that should follow it. Rows therefore open their menu from the press as well
 * as from the event, and this guard keeps a left click out of the menu.
 */
export function isSecondaryPress(event: ReactMouseEvent): boolean {
  return event.type === 'contextmenu' || event.button === 2
}
