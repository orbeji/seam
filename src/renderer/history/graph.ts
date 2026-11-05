// SPDX-License-Identifier: MIT

/** The part of a commit the graph layout needs. */
export interface GraphCommit {
  readonly oid: string
  readonly parents: readonly string[]
}

/** Which half of a row an edge crosses. */
export type GraphEdgeSide = 'through' | 'top' | 'bottom'

/** One line of the graph drawn in a row. Lane numbers count from the left. */
export interface GraphEdge {
  /** The lane at the edge's starting point. */
  readonly from: number
  /** The lane at the edge's ending point. */
  readonly to: number
  /** The colour of the branch the edge belongs to. */
  readonly color: number
  /**
   * `through` crosses the whole row without touching the node, `top` comes down
   * from the previous row into the node, and `bottom` leaves the node towards a
   * parent below.
   */
  readonly side: GraphEdgeSide
}

/** One commit's place in the graph and the lines around it. */
export interface GraphRow {
  /** The lane the commit's node sits in. */
  readonly lane: number
  readonly color: number
  /** The row's lane count, so pass-through lines can shift after a lane closes. */
  readonly width: number
  readonly edges: readonly GraphEdge[]
}

export interface GraphLayout {
  readonly rows: readonly GraphRow[]
  /** How many lanes the widest row uses, for sizing the gutter. */
  readonly lanes: number
}

interface Lane {
  readonly oid: string
  readonly color: number
}

/**
 * Places the commits on lanes, newest first, the way `git log --graph` does:
 * every branch keeps a lane while it has a commit below it, a merge opens a
 * second lane for its other parent, and two branches that meet at a shared
 * parent converge into one lane there.
 *
 * The commits must arrive in topological order, as `git log --topo-order`
 * prints them, so a parent is never placed before all of its children.
 */
export function layoutGraph(commits: readonly GraphCommit[]): GraphLayout {
  let lanes: Lane[] = []
  let nextColor = 0
  let widest = 0
  const rows: GraphRow[] = []

  for (const commit of commits) {
    // A commit is usually already expected by the lane of one of its children.
    // A tip that nothing below points at (a branch's newest commit) opens a new
    // lane at the right.
    let before = lanes
    let nodeLane = before.findIndex((lane) => lane.oid === commit.oid)
    // Only the lanes that already existed expected this commit. A tip that has
    // to open its own lane must not draw a line down from an empty row above it.
    const matched =
      nodeLane === -1
        ? []
        : before.flatMap((lane, index) => (lane.oid === commit.oid ? [index] : []))
    if (nodeLane === -1) {
      nodeLane = before.length
      before = [...before, { oid: commit.oid, color: nextColor }]
      nextColor += 1
    }

    const nodeColor = before[nodeLane]!.color

    // The commit itself stops expecting its oid; its parents take over the lane.
    const next: Array<Lane | null> = before.map((lane) =>
      lane.oid === commit.oid ? null : { ...lane }
    )
    const parentColors = new Map<string, number>()

    for (const [index, parent] of commit.parents.entries()) {
      let target = next.findIndex((lane) => lane?.oid === parent)
      if (target === -1) {
        // The first parent continues in the commit's lane; another parent opens
        // the first free lane, or one at the right when there is none.
        target =
          index === 0 && next[nodeLane] === null
            ? nodeLane
            : next.findIndex((lane) => lane === null)
        if (target === -1) {
          target = next.length
          next.push(null)
        }
        const color = index === 0 ? nodeColor : nextColor
        if (index !== 0) nextColor += 1
        next[target] = { oid: parent, color }
      }
      parentColors.set(parent, next[target]!.color)
    }

    const after: Lane[] = next.filter((lane): lane is Lane => lane !== null)
    const edges: GraphEdge[] = []

    // A lane that carries another branch through this row keeps its colour. It
    // may move left when lanes above it close, which the renderer draws as a
    // gentle curve.
    for (const [index, lane] of before.entries()) {
      if (lane.oid === commit.oid) continue
      const target = after.findIndex((candidate) => candidate.oid === lane.oid)
      if (target !== -1) {
        edges.push({ from: index, to: target, color: lane.color, side: 'through' })
      }
    }

    // Several children can point at the same commit; each line converges on the
    // node from the row's top edge.
    for (const index of matched) {
      edges.push({ from: index, to: nodeLane, color: nodeColor, side: 'top' })
    }

    for (const parent of commit.parents) {
      const target = after.findIndex((lane) => lane.oid === parent)
      if (target !== -1) {
        edges.push({
          from: nodeLane,
          to: target,
          color: parentColors.get(parent) ?? nodeColor,
          side: 'bottom'
        })
      }
    }

    const width = Math.max(before.length, after.length)
    widest = Math.max(widest, width)
    rows.push({ lane: nodeLane, color: nodeColor, width, edges })
    lanes = after
  }

  return { rows, lanes: widest }
}
