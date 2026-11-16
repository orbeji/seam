// SPDX-License-Identifier: MIT

import type { PointerEvent as ReactPointerEvent } from 'react'

/** What a drag from a resize handle does while the pointer moves, and when it ends. */
export interface ResizeDragHandlers {
  /** Follows the pointer, in window pixels. */
  readonly onMove: (clientX: number) => void
  /** Runs once, however the drag ends. */
  readonly onEnd: () => void
}

/**
 * Follows a drag that starts with a primary press on a resize handle until the
 * button is released, wherever the pointer goes. Returns a function that ends
 * the drag early, or null when the press was not the primary button and the
 * handle must ignore it.
 *
 * Pointer capture alone is not enough. Some Linux sessions, WSLg and a few
 * Wayland compositors among them, either raise on `setPointerCapture` or do not
 * keep the capture, and then the handle stops hearing `pointermove` as soon as
 * the cursor leaves its six pixels: the panel cannot be dragged. The window
 * follows every move and release instead, with the capture kept only as a hint
 * for the default cursor.
 */
export function followResizeDrag(
  event: ReactPointerEvent<HTMLElement>,
  handlers: ResizeDragHandlers
): (() => void) | null {
  if (event.button !== 0) return null
  event.preventDefault()

  const handle = event.currentTarget
  const pointerId = event.pointerId
  try {
    handle.setPointerCapture(pointerId)
  } catch {
    // The window listeners below carry the drag on their own.
  }

  let ended = false

  const stop = (): void => {
    if (ended) return
    ended = true
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    window.removeEventListener('blur', stop)
    document.body.classList.remove('resize-drag')
    if (handle.hasPointerCapture?.(pointerId) === true) {
      try {
        handle.releasePointerCapture(pointerId)
      } catch {
        // The capture was already gone, which is what this drag assumes anyway.
      }
    }
    handlers.onEnd()
  }

  const move = (moveEvent: PointerEvent): void => {
    if (moveEvent.pointerId !== pointerId) return
    handlers.onMove(moveEvent.clientX)
  }

  const end = (endEvent: PointerEvent): void => {
    if (endEvent.pointerId !== pointerId) return
    stop()
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
  // A window that loses focus never sees the release, so the drag ends here.
  window.addEventListener('blur', stop)
  document.body.classList.add('resize-drag')
  return stop
}
