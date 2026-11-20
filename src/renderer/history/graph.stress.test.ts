// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { layoutGraph, type GraphCommit, type GraphRef } from './graph'

/** Deterministic pseudo-random generator so a failure can be replayed. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

/** A random topological history with trunk, integration and side branches. */
function makeHistory(seed: number): GraphCommit[] {
  const next = random(seed)
  const count = 1 + Math.floor(next() * 60)
  const commits: GraphCommit[] = []
  const names = ['main', 'master', 'develop', 'dev', 'feature/a', 'feature/b', 'fix/c']
  for (let index = 0; index < count; index += 1) {
    const parents: string[] = []
    if (index > 0) {
      const first = Math.floor(next() * index)
      parents.push(`c${first}`)
      if (next() < 0.25) {
        const second = Math.floor(next() * index)
        if (second !== first) parents.push(`c${second}`)
      }
    }
    const refs: GraphRef[] = []
    if (next() < 0.2) {
      refs.push({ name: names[Math.floor(next() * names.length)]!, kind: 'branch' })
    }
    commits.push({ oid: `c${index}`, parents, refs })
  }
  return commits
}

/**
 * The layout used to leave sparse holes in its lane arrays when it trimmed a
 * reserved column, which made the renderer read `undefined.oid` and blanked
 * the window. Random histories keep that regression covered.
 */
describe('layoutGraph on arbitrary histories', () => {
  it('always returns whole lane numbers and never throws', () => {
    const problems: string[] = []
    for (let seed = 1; seed <= 500; seed += 1) {
      const commits = makeHistory(seed)
      const layout = layoutGraph(commits)
      if (layout.rows.length !== commits.length) problems.push(`seed ${seed}: row count`)
      for (const [index, row] of layout.rows.entries()) {
        if (!Number.isInteger(row.lane) || row.lane < 0)
          problems.push(`seed ${seed}: row ${index} lane`)
        if (row.color === undefined) problems.push(`seed ${seed}: row ${index} colour`)
        for (const edge of row.edges) {
          if (!Number.isInteger(edge.from) || !Number.isInteger(edge.to)) {
            problems.push(`seed ${seed}: row ${index} edge`)
          }
          if (edge.color === undefined) problems.push(`seed ${seed}: row ${index} edge colour`)
        }
      }
      if (!Number.isInteger(layout.lanes)) problems.push(`seed ${seed}: lane count`)
    }
    expect(problems).toEqual([])
  })
})
