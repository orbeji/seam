// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { layoutGraph, type GraphEdge, type GraphRow } from './graph'

interface Commit {
  readonly oid: string
  readonly parents: readonly string[]
}

/** A commit with no parents, so the tests only spell out the links that matter. */
function commit(oid: string, ...parents: string[]): Commit {
  return { oid, parents }
}

function edge(row: GraphRow, side: GraphEdge['side'], to: number): GraphEdge {
  const found = row.edges.find((candidate) => candidate.side === side && candidate.to === to)
  if (found === undefined) throw new Error(`no ${side} edge to lane ${to}`)
  return found
}

describe('layoutGraph', () => {
  it('keeps a linear history in one lane', () => {
    const layout = layoutGraph([commit('c', 'b'), commit('b', 'a'), commit('a')])

    expect(layout.lanes).toBe(1)
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 0])
    expect(layout.rows[0]?.edges).toEqual([{ from: 0, to: 0, color: 0, side: 'bottom' }])
    expect(layout.rows[1]?.edges).toEqual([
      { from: 0, to: 0, color: 0, side: 'top' },
      { from: 0, to: 0, color: 0, side: 'bottom' }
    ])
    expect(layout.rows[2]?.edges).toEqual([{ from: 0, to: 0, color: 0, side: 'top' }])
  })

  it('opens a second lane for a merge and joins the branches at their parent', () => {
    const layout = layoutGraph([
      commit('merge', 'a', 'b'),
      commit('a', 'base'),
      commit('b', 'base'),
      commit('base')
    ])

    expect(layout.lanes).toBe(2)
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 1, 0])
    expect(edge(layout.rows[0]!, 'bottom', 1).color).toBe(1)
    expect(edge(layout.rows[2]!, 'bottom', 0).color).toBe(0)
    expect(layout.rows[3]?.edges.filter((candidate) => candidate.side === 'top')).toHaveLength(1)
  })

  it('gives a tip that no child points at a lane of its own', () => {
    const layout = layoutGraph([commit('tip-two'), commit('tip-one', 'base'), commit('base')])

    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 0])
    // The first tip has no top edge: nothing above it expected the commit.
    expect(layout.rows[0]?.edges.some((candidate) => candidate.side === 'top')).toBe(false)
    expect(layout.rows[1]?.edges.some((candidate) => candidate.side === 'top')).toBe(false)
  })

  it('returns an empty layout for a repository with no commits', () => {
    expect(layoutGraph([])).toEqual({ rows: [], lanes: 0 })
  })
})
