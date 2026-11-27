// SPDX-License-Identifier: MIT

/** The part of a press a resize handle needs, from a mouse or a pointer event. */
export interface ResizeDragStart {
  readonly button: number
  readonly clientX: number
  preventDefault: () => void
}

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
 * The drag listens to plain mouse events, not only to pointer events. WSLg and
 * a few Wayland sessions deliver the press but not the `pointermove` that
 * follows it, or retarget it to a different pointer id, so a drag built on
 * pointer events alone never leaves the six-pixel handle. Mouse moves reach the
 * window on those sessions, and both kinds are followed here: the window sees
 * every move and release, and the drag ends on whichever release arrives first.
 * The window keeps its own mouse capture while the button is down, so the split
 * still follows a cursor that leaves the window.
 */
export function followResizeDrag(
  event: ResizeDragStart,
  handlers: ResizeDragHandlers
): (() => void) | null {
  if (event.button !== 0) return null
  event.preventDefault()

  let ended = false

  const stop = (): void => {
    if (ended) return
    ended = true
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('mousemove', move, true)
    window.removeEventListener('pointerup', end, true)
    window.removeEventListener('mouseup', end, true)
    window.removeEventListener('pointercancel', end, true)
    window.removeEventListener('blur', stop)
    document.body.classList.remove('resize-drag')
    handlers.onEnd()
  }

  const move = (moveEvent: MouseEvent | PointerEvent): void => {
    handlers.onMove(moveEvent.clientX)
  }

  const end = (): void => {
    stop()
  }

  window.addEventListener('pointermove', move, true)
  window.addEventListener('mousemove', move, true)
  window.addEventListener('pointerup', end, true)
  window.addEventListener('mouseup', end, true)
  window.addEventListener('pointercancel', end, true)
  // A window that loses focus never sees the release, so the drag ends here.
  window.addEventListener('blur', stop)
  document.body.classList.add('resize-drag')
  return stop
}
