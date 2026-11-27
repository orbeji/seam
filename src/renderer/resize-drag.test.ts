// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest'
import { followResizeDrag } from './resize-drag'

type Listener = (event: { clientX: number }) => void

interface FakeWindow {
  readonly target: {
    addEventListener: (type: string, listener: Listener) => void
    removeEventListener: (type: string, listener: Listener) => void
  }
  readonly classList: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }
  readonly listeners: Map<string, Set<Listener>>
  dispatch: (type: string, clientX: number) => void
}

/** A window and a body that only keep the listeners a drag registers. */
function stubEnvironment(): FakeWindow {
  const listeners = new Map<string, Set<Listener>>()
  const classList = { add: vi.fn(), remove: vi.fn() }

  const target = {
    addEventListener: (type: string, listener: Listener): void => {
      const registered = listeners.get(type) ?? new Set<Listener>()
      registered.add(listener)
      listeners.set(type, registered)
    },
    removeEventListener: (type: string, listener: Listener): void => {
      listeners.get(type)?.delete(listener)
    }
  }

  vi.stubGlobal('window', target)
  vi.stubGlobal('document', { body: { classList } })

  return {
    target,
    classList,
    listeners,
    dispatch: (type, clientX) => {
      for (const listener of listeners.get(type) ?? []) listener({ clientX })
    }
  }
}

function handlers(): {
  onMove: ReturnType<typeof vi.fn<(clientX: number) => void>>
  onEnd: ReturnType<typeof vi.fn<() => void>>
} {
  return { onMove: vi.fn<(clientX: number) => void>(), onEnd: vi.fn<() => void>() }
}

const press = { button: 0, clientX: 100, preventDefault: vi.fn() }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('followResizeDrag', () => {
  it('follows plain mouse moves after a press', () => {
    const environment = stubEnvironment()
    const callbacks = handlers()

    expect(followResizeDrag(press, callbacks)).not.toBeNull()
    environment.dispatch('mousemove', 140)

    expect(callbacks.onMove).toHaveBeenCalledWith(140)
    expect(environment.classList.add).toHaveBeenCalledWith('resize-drag')
  })

  it('also follows pointer moves, so either event family drives the drag', () => {
    const environment = stubEnvironment()
    const callbacks = handlers()

    followResizeDrag(press, callbacks)
    environment.dispatch('pointermove', 160)

    expect(callbacks.onMove).toHaveBeenCalledWith(160)
  })

  it('ends once on release, whichever event arrives first', () => {
    const environment = stubEnvironment()
    const callbacks = handlers()

    followResizeDrag(press, callbacks)
    environment.dispatch('mouseup', 140)
    environment.dispatch('pointerup', 140)

    expect(callbacks.onEnd).toHaveBeenCalledTimes(1)
    expect(environment.classList.remove).toHaveBeenCalledWith('resize-drag')
    expect(environment.listeners.get('mousemove')?.size).toBe(0)
  })

  it('can be ended early by the function it returns', () => {
    const environment = stubEnvironment()
    const callbacks = handlers()

    const stop = followResizeDrag(press, callbacks)
    stop?.()
    environment.dispatch('mousemove', 200)

    expect(callbacks.onMove).not.toHaveBeenCalled()
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1)
  })

  it('ignores a press that is not the primary button', () => {
    const environment = stubEnvironment()
    const callbacks = handlers()

    expect(followResizeDrag({ ...press, button: 2 }, callbacks)).toBeNull()
    expect(environment.listeners.size).toBe(0)
    expect(callbacks.onEnd).not.toHaveBeenCalled()
  })
})
