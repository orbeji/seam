// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { graphBranchRole, layoutGraph, type GraphEdge, type GraphRef, type GraphRow } from './graph'

interface Commit {
  readonly oid: string
  readonly parents: readonly string[]
  readonly refs?: readonly GraphRef[]
}

/** A commit with no parents, so the tests only spell out the links that matter. */
function commit(oid: string, ...parents: string[]): Commit {
  return { oid, parents }
}

/** A commit that a branch tip points at. */
function tip(oid: string, parents: readonly string[], refs: readonly GraphRef[]): Commit {
  return { oid, parents, refs }
}

function branch(name: string): GraphRef {
  return { name, kind: 'branch' }
}

function head(name: string): GraphRef {
  return { name, kind: 'head' }
}

function remote(name: string): GraphRef {
  return { name, kind: 'remote' }
}

function edge(row: GraphRow, side: GraphEdge['side'], to: number): GraphEdge {
  const found = row.edges.find((candidate) => candidate.side === side && candidate.to === to)
  if (found === undefined) throw new Error(`no ${side} edge to lane ${to}`)
  return found
}

describe('graphBranchRole', () => {
  it('recognises the trunk and integration branches', () => {
    expect(graphBranchRole([head('main')])).toBe('main')
    expect(graphBranchRole([branch('master')])).toBe('main')
    expect(graphBranchRole([branch('trunk')])).toBe('main')
    expect(graphBranchRole([branch('develop')])).toBe('develop')
    expect(graphBranchRole([branch('dev')])).toBe('develop')
    expect(graphBranchRole([remote('origin/main')])).toBe('main')
    expect(graphBranchRole([remote('upstream/develop')])).toBe('develop')
  })

  it('does not mistake a feature or tag with a trunk name for the trunk', () => {
    expect(graphBranchRole([branch('feature/main')])).toBeNull()
    expect(graphBranchRole([{ name: 'main', kind: 'tag' }])).toBeNull()
  })

  it('prefers the trunk when both roles point at one commit', () => {
    expect(graphBranchRole([branch('develop'), branch('main')])).toBe('main')
  })
})

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
    // The second branch stays in its lane and keeps its colour until the shared
    // parent, where both lines curve into the one node.
    expect(edge(layout.rows[2]!, 'bottom', 1)).toMatchObject({ from: 1, to: 1, color: 1 })
    expect(layout.rows[3]!.edges.filter((candidate) => candidate.side === 'top')).toEqual([
      { from: 0, to: 0, color: 0, side: 'top' },
      { from: 1, to: 0, color: 1, side: 'top' }
    ])
  })

  it('keeps the new branch colour where it joins the branch it grew from', () => {
    const layout = layoutGraph([commit('main', 'base'), commit('feature', 'base'), commit('base')])

    expect(layout.rows.map((row) => row.lane)).toEqual([0, 1, 0])
    expect(layout.rows[1]?.color).toBe(1)
    expect(edge(layout.rows[1]!, 'through', 0).color).toBe(0)
    expect(edge(layout.rows[1]!, 'bottom', 1)).toMatchObject({ from: 1, to: 1, color: 1 })
    // The new branch colour is kept on the line that joins the shared node.
    expect(layout.rows[2]!.edges.filter((candidate) => candidate.side === 'top')).toEqual([
      { from: 0, to: 0, color: 0, side: 'top' },
      { from: 1, to: 0, color: 1, side: 'top' }
    ])
  })

  it('keeps a merge first parent on its own lane when another branch expects it', () => {
    const layout = layoutGraph([
      commit('merge-a', 'merge-b', 'side'),
      tip('side', ['shared'], [branch('side')]),
      commit('merge-b', 'shared', 'incoming'),
      tip('incoming', ['shared'], [branch('incoming')]),
      commit('shared', 'base'),
      commit('base')
    ])

    // `merge-b` continues its own lane to `shared`; the merged-in branch opens
    // a lane on the right instead of taking the merge's freed column. If it took
    // it, the side branch would look like the trunk below the merge.
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 1, 0, 2, 0, 0])
    expect(edge(layout.rows[2]!, 'bottom', 0)).toMatchObject({ from: 0, to: 0 })
    expect(edge(layout.rows[2]!, 'bottom', 2)).toMatchObject({ from: 0, to: 2 })
    const bottoms = layout.rows[2]!.edges.filter((edge) => edge.side === 'bottom')
    expect(bottoms.some((edge) => edge.to === 1)).toBe(false)
    expect(layout.rows[3]?.lane).toBe(2)
  })

  it('gives a tip that no child points at a lane of its own', () => {
    const layout = layoutGraph([commit('tip-two'), commit('tip-one', 'base'), commit('base')])

    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 0])
    // The first tip has no top edge: nothing above it expected the commit.
    expect(layout.rows[0]?.edges.some((candidate) => candidate.side === 'top')).toBe(false)
    expect(layout.rows[1]?.edges.some((candidate) => candidate.side === 'top')).toBe(false)
  })

  it('never shifts a lane sideways when a branch to its left ends', () => {
    const layout = layoutGraph([
      commit('merge', 'left', 'main-tip'),
      commit('left'),
      tip('main-tip', ['base'], [branch('main')]),
      commit('base')
    ])

    // The left branch opens beside the reserved trunk column and closes on its
    // root; the trunk stays in lane 0 the whole way down.
    expect(layout.rows.map((row) => row.lane)).toEqual([1, 1, 0, 0])
    expect(edge(layout.rows[1]!, 'through', 0)).toMatchObject({ from: 0, to: 0 })
    // The trunk wears its fixed colour all the way down its first-parent chain.
    expect(layout.rows[2]?.color).toBe('main')
    expect(layout.rows[3]?.color).toBe('main')
  })

  it('gives the trunk and integration branches their permanent colours', () => {
    const layout = layoutGraph([
      tip('main-tip', ['main-parent'], [head('main'), remote('origin/main')]),
      tip('develop-tip', ['develop-parent'], [branch('develop')]),
      commit('main-parent'),
      commit('develop-parent')
    ])

    expect(layout.rows[0]?.color).toBe('main')
    expect(layout.rows[1]?.color).toBe('develop')
    expect(edge(layout.rows[0]!, 'bottom', 0).color).toBe('main')
    expect(edge(layout.rows[1]!, 'bottom', 1).color).toBe('develop')
  })

  it('keeps the trunk and integration lanes and colours through merges', () => {
    const layout = layoutGraph([
      tip('develop-merge', ['develop-prev', 'feature-tip'], [branch('develop')]),
      tip('feature-tip', ['develop-prev'], [branch('feature/x')]),
      tip('develop-prev', ['main-tip'], [branch('develop')]),
      tip('main-tip', ['root'], [branch('main')]),
      commit('root')
    ])

    // The merge on develop does not move or recolour its lane, and the feature
    // that joins it is opened and closed on the side.
    expect(layout.rows.map((row) => row.lane)).toEqual([1, 2, 1, 0, 0])
    expect(layout.rows.map((row) => row.color)).toEqual(['develop', 0, 'develop', 'main', 'main'])
    expect(edge(layout.rows[0]!, 'bottom', 2).color).toBe(0)
    // develop grew from the trunk tip and is still drawn to the side, joining
    // the trunk without taking its column or colour.
    expect(edge(layout.rows[2]!, 'bottom', 0).color).toBe('develop')
    expect(layout.rows[1]?.lane).toBe(2)
  })

  it('joins several branches that leave the trunk tip to the same trunk node', () => {
    const layout = layoutGraph([
      tip('feat-3', ['develop-tip'], [branch('feature/feat-0003')]),
      tip('feat-2', ['develop-tip'], [branch('feature/feat-0002')]),
      tip('feat-1', ['develop-tip'], [branch('feature/feat-0001')]),
      tip('develop-tip', ['develop-prev'], [branch('develop')]),
      tip('develop-prev', ['main-tip'], [branch('develop')]),
      tip('main-tip', ['root'], [branch('main')]),
      commit('root')
    ])

    // The three features open their own lanes, but develop moves to its
    // reserved column instead of continuing the lane of the first feature.
    expect(layout.rows.map((row) => row.lane)).toEqual([2, 3, 4, 1, 1, 0, 0])
    expect(layout.rows.map((row) => row.color)).toEqual([
      0,
      1,
      2,
      'develop',
      'develop',
      'main',
      'main'
    ])
    const tops = layout.rows[3]?.edges.filter((edge) => edge.side === 'top')
    expect(tops).toEqual([
      { from: 2, to: 1, color: 0, side: 'top' },
      { from: 3, to: 1, color: 1, side: 'top' },
      { from: 4, to: 1, color: 2, side: 'top' }
    ])
    // Each feature line leaves its own node straight down its own lane; it must
    // not bend into another feature's lane on the way to develop.
    expect(edge(layout.rows[0]!, 'bottom', 2)).toMatchObject({ from: 2, to: 2, color: 0 })
    expect(edge(layout.rows[1]!, 'bottom', 3)).toMatchObject({ from: 3, to: 3, color: 1 })
    expect(edge(layout.rows[2]!, 'bottom', 4)).toMatchObject({ from: 4, to: 4, color: 2 })
    expect(edge(layout.rows[4]!, 'bottom', 0).color).toBe('develop')
  })

  it('draws develop to the side even when it grows from the trunk tip', () => {
    const layout = layoutGraph([
      tip('develop-tip', ['master-tip'], [branch('develop')]),
      tip('master-tip', ['root'], [branch('master')]),
      commit('root')
    ])

    // `develop` is the newest commit, but the trunk keeps the left column and
    // the branch is drawn beside it, joining it at the commit they share.
    expect(layout.rows.map((row) => row.lane)).toEqual([1, 0, 0])
    expect(layout.rows[0]?.color).toBe('develop')
    expect(layout.rows[1]?.color).toBe('main')
    expect(edge(layout.rows[0]!, 'bottom', 0).color).toBe('develop')
    expect(layout.rows[2]?.color).toBe('main')
  })

  it('draws a feature leaving the trunk and joining it again', () => {
    const layout = layoutGraph([
      tip('feature', ['base'], [branch('feature/x')]),
      tip('main', ['base'], [head('main')]),
      commit('base')
    ])

    // The feature opens a lane beside the reserved trunk column; the trunk
    // takes its own column even though its tip is the older commit, and stays
    // there below the point where the feature rejoins.
    expect(layout.rows.map((row) => row.lane)).toEqual([1, 0, 0])
    expect(layout.rows[0]?.color).toBe(0)
    expect(layout.rows[1]?.color).toBe('main')
    // The feature stays in its lane and the trunk stays vertical; both lines
    // meet at the shared node, where the feature takes the trunk's colour.
    expect(edge(layout.rows[1]!, 'through', 1)).toMatchObject({ from: 1, to: 1, color: 0 })
    expect(edge(layout.rows[1]!, 'bottom', 0)).toMatchObject({ from: 0, to: 0, color: 'main' })
    expect(layout.rows[2]!.edges.filter((candidate) => candidate.side === 'top')).toEqual([
      { from: 0, to: 0, color: 'main', side: 'top' },
      { from: 1, to: 0, color: 0, side: 'top' }
    ])
    // The shared history below the branch point keeps the trunk colour.
    expect(layout.rows[2]?.color).toBe('main')
  })

  it('returns an empty layout for a repository with no commits', () => {
    expect(layoutGraph([])).toEqual({ rows: [], lanes: 0 })
  })
})
