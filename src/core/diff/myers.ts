// SPDX-License-Identifier: MIT

/**
 * Myers' O(ND) diff over two sequences of strings. The line diff and the inline
 * diff both build on it, so it lives on its own. Pure, no Node, no DOM.
 *
 * It returns an edit script or null when more than `maxEdit` edits are needed.
 * The script has no positions: the caller walks it to place them, which is where
 * the line and inline shapes differ.
 */

export type Op = 'equal' | 'delete' | 'insert'

/**
 * The trace backtracking reads grows with the square of the edit count, so this
 * is the caller's memory guard, not the engine's.
 */
export function myersOps(a: readonly string[], b: readonly string[], maxEdit: number): Op[] | null {
  const n = a.length
  const m = b.length
  const max = n + m
  const offset = max
  const v = new Int32Array(2 * max + 1)
  const trace: Int32Array[] = []

  // The window backtracking later reads from, copied out of the reused array.
  const snapshot = (d: number): Int32Array => {
    const radius = d + 1
    const out = new Int32Array(2 * radius + 1)
    for (let k = -radius; k <= radius; k += 1) {
      const index = offset + k
      out[k + radius] = index >= 0 && index < v.length ? (v[index] as number) : 0
    }
    return out
  }

  for (let d = 0; d <= max; d += 1) {
    if (d > maxEdit) return null
    trace.push(snapshot(d))

    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number))) {
        x = v[offset + k + 1] as number
      } else {
        x = (v[offset + k - 1] as number) + 1
      }

      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x += 1
        y += 1
      }

      v[offset + k] = x
      if (x >= n && y >= m) return backtrack(trace, d, n, m)
    }
  }

  return null
}

function backtrack(trace: readonly Int32Array[], finalD: number, n: number, m: number): Op[] {
  const ops: Op[] = []
  let x = n
  let y = m

  for (let d = finalD; d >= 0; d -= 1) {
    const v = trace[d] as Int32Array
    const radius = d + 1
    const at = (k: number): number => {
      const index = k + radius
      return index >= 0 && index < v.length ? (v[index] as number) : 0
    }

    const k = x - y
    let prevK: number
    if (k === -d || (k !== d && at(k - 1) < at(k + 1))) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }

    const prevX = at(prevK)
    const prevY = prevX - prevK

    while (x > prevX && y > prevY) {
      ops.push('equal')
      x -= 1
      y -= 1
    }

    if (d > 0) {
      ops.push(x === prevX ? 'insert' : 'delete')
    }

    x = prevX
    y = prevY
  }

  ops.reverse()
  return ops
}
