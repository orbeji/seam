// SPDX-License-Identifier: MIT

/** The part of a commit the graph layout needs. */
export interface GraphCommit {
  readonly oid: string
  readonly parents: readonly string[]
  /**
   * The refs pointing at the commit. The layout only needs their names to give
   * the long-lived branches a permanent colour.
   */
  readonly refs?: readonly GraphRef[]
}

/** The part of a ref the layout reads. */
export interface GraphRef {
  /** The short name Git shows: `main`, `origin/main` or `v1.0.0`. */
  readonly name: string
  readonly kind: string
}

/**
 * The branches that keep a fixed colour of their own, whatever the palette:
 * the main trunk and the integration branch.
 */
export type GraphBranchRole = 'main' | 'develop'

/**
 * A lane's colour: a role for the long-lived branches, or an index into the
 * palette for the rest.
 */
export type GraphColor = number | GraphBranchRole

/** Which half of a row an edge crosses. */
export type GraphEdgeSide = 'through' | 'top' | 'bottom'

/** One line of the graph drawn in a row. Lane numbers count from the left. */
export interface GraphEdge {
  /** The lane at the edge's starting point. */
  readonly from: number
  /** The lane at the edge's ending point. */
  readonly to: number
  /** The colour of the branch the edge belongs to. */
  readonly color: GraphColor
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
  readonly color: GraphColor
  /** The row's lane count, for sizing the gutter before the next row. */
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
  readonly color: GraphColor
}

/** The names that always wear the trunk colour. */
const MAIN_BRANCH_NAMES = new Set(['main', 'master', 'trunk', 'default'])
/** The names that always wear the integration colour. */
const DEVELOP_BRANCH_NAMES = new Set(['develop', 'dev', 'development', 'integration'])

/**
 * The branch name a ref points at, without the remote's own name. A local
 * branch keeps its whole name, so `feature/main` is not mistaken for `main`.
 */
function branchName(ref: GraphRef): string | null {
  if (ref.kind === 'tag') return null
  const name = ref.name.toLowerCase()
  if (ref.kind === 'remote') {
    const slash = name.indexOf('/')
    return slash === -1 ? null : name.slice(slash + 1)
  }
  return name
}

/**
 * The fixed role of a commit's refs, if any. A trunk branch wins over an
 * integration branch when both point at the same commit.
 */
export function graphBranchRole(refs: readonly GraphRef[]): GraphBranchRole | null {
  let develop = false
  for (const ref of refs) {
    const name = branchName(ref)
    if (name === null) continue
    if (MAIN_BRANCH_NAMES.has(name)) return 'main'
    if (DEVELOP_BRANCH_NAMES.has(name)) develop = true
  }
  return develop ? 'develop' : null
}

/** How strongly a colour claims a shared stretch of history. */
function colorRank(color: GraphColor): number {
  if (color === 'main') return 2
  if (color === 'develop') return 1
  return 0
}

/**
 * Places the commits on lanes, newest first, the way `git log --graph` does:
 * every branch keeps a lane while it has a commit below it, a merge opens a
 * second lane for its other parent, and two branches that meet at a shared
 * parent converge into one lane there.
 *
 * Unlike `git log --graph`, lanes never move sideways: a lane keeps its column
 * until the branch ends, so the trunk stays perfectly vertical and a feature
 * is seen leaving it and joining it again. The trunk is also given the leftmost
 * column and the integration branch the one beside it, so a branch is drawn to
 * the side even when its tip is newer than the trunk's. The long-lived branches
 * keep a fixed colour (`main`/`master` reddish, `develop`/`dev` bluish)
 * whatever the graph palette is.
 *
 * The commits must arrive in topological order, as `git log --topo-order`
 * prints them, so a parent is never placed before all of its children.
 */
export function layoutGraph(commits: readonly GraphCommit[]): GraphLayout {
  // The refs are only present on a branch's tip, but knowing every tip's role
  // beforehand gives its lane the right colour even when another branch opens
  // it as a parent first.
  const roleOf = new Map<string, GraphBranchRole>()
  for (const commit of commits) {
    const role = graphBranchRole(commit.refs ?? [])
    if (role !== null) roleOf.set(commit.oid, role)
  }

  // The trunk keeps the leftmost column and the integration branch sits beside
  // it, so a feature is always drawn to the side even when its tip is newer
  // than the branch it grew from. Remote-only or diverged copies of a role fall
  // back to the next free column when their reserved one is already taken.
  const roles = new Set(roleOf.values())
  const roleLane = new Map<GraphBranchRole, number>()
  if (roles.has('main')) roleLane.set('main', 0)
  if (roles.has('develop')) roleLane.set('develop', roleLane.size)
  const reserved = new Set(roleLane.values())
  const reservedWidth = reserved.size === 0 ? 0 : Math.max(...reserved) + 1

  let lanes: Array<Lane | null> = Array.from({ length: reservedWidth }, () => null)
  let nextColor = 0
  let widest = 0
  const rows: GraphRow[] = []

  /** The next palette colour for a branch that has no fixed role. */
  const allocateColor = (): number => {
    const color = nextColor
    nextColor += 1
    return color
  }

  /**
   * The first free column. A branch with a role prefers its reserved column;
   * the others never take a reserved column before its branch has appeared.
   */
  const freeLane = (
    slots: readonly (Lane | null)[],
    role: GraphBranchRole | null = null
  ): number => {
    const preferred = role === null ? undefined : roleLane.get(role)
    if (preferred !== undefined && (slots[preferred] ?? null) === null) return preferred
    const index = slots.findIndex((lane, slot) => lane === null && !reserved.has(slot))
    return index === -1 ? Math.max(slots.length, reservedWidth) : index
  }

  for (const commit of commits) {
    // A hole at the right is not a column: trimming it lets the next tip take
    // the first free place without leaving an empty lane beside the graph. The
    // reserved trunk columns stay even before their branch's newest commit.
    while (lanes.length > reservedWidth && lanes[lanes.length - 1] === null) lanes.pop()

    // A commit is usually already expected by the lane of one of its children.
    // A tip that nothing below points at (a branch's newest commit) opens a new
    // lane at the first free place. Normalising keeps every slot an explicit
    // `null`: a sparse array would make the renderer read `undefined.oid`.
    const before: Array<Lane | null> = Array.from(lanes, (lane) => lane ?? null)
    const matched = before.flatMap((lane, index) =>
      lane !== null && lane.oid === commit.oid ? [index] : []
    )
    const role = roleOf.get(commit.oid) ?? null
    let nodeLane: number

    if (matched.length > 0) {
      // Several children can point at the same commit. When one of those lanes
      // belongs to a trunk or integration branch, the commit stays in that
      // column, so that branch keeps a straight line and the others curve into
      // it. A branch whose tip this is also keeps its own column when possible.
      const reservedLane = role === null ? undefined : roleLane.get(role)
      if (reservedLane !== undefined && (before[reservedLane] ?? null) === null) {
        // The role's own column is free: move the node there even if its
        // children had opened lanes elsewhere. Every child then joins the same
        // trunk node instead of one of them looking like the trunk's line.
        nodeLane = reservedLane
      } else {
        const exact =
          reservedLane === undefined
            ? undefined
            : (matched.find((index) => index === reservedLane) ??
              matched.find((index) => before[index]!.color === role))
        const spine =
          matched.find((index) => before[index]!.color === 'main') ??
          matched.find((index) => typeof before[index]!.color === 'string')
        nodeLane = exact ?? spine ?? matched[0]!
      }
    } else {
      nodeLane = freeLane(before, role)
      const lane: Lane = { oid: commit.oid, color: role ?? allocateColor() }
      while (before.length < nodeLane) before.push(null)
      if (nodeLane === before.length) before.push(lane)
      else before[nodeLane] = lane
    }

    // A node moved into its reserved column still needs to occupy it for this
    // row; a matched lane already carries it, and a new tip was inserted above.
    while (before.length < nodeLane) before.push(null)
    if ((before[nodeLane] ?? null) === null) {
      before[nodeLane] = { oid: commit.oid, color: role ?? allocateColor() }
    }

    // A trunk or integration commit always wears its role's colour, even when
    // another branch opened its lane before this ref was seen. A lane that
    // already belongs to a role keeps that role's colour: a merge never moves
    // the trunk to another colour.
    const laneColor = before[nodeLane]!.color
    const nodeColor = role === null || typeof laneColor === 'string' ? laneColor : role
    if (nodeColor !== laneColor) before[nodeLane] = { oid: commit.oid, color: nodeColor }

    // The commit itself stops expecting its oid; its parents take over the lane.
    const next: Array<Lane | null> = before.map((lane) =>
      lane !== null && lane.oid === commit.oid ? null : lane
    )
    // A line leading down to a parent takes the colour of the branch it leaves
    // from, so a branch keeps its own colour until it joins another one. Only a
    // lane this commit opens is drawn with the new branch's colour.
    const parentColors = new Map<string, GraphColor>()
    // The lane each parent was just put in. Without this, a line would join the
    // first lane carrying the same parent, so several branches leaving the same
    // trunk node would collapse into one column before reaching it.
    const parentLanes = new Map<string, number>()

    for (const [index, parent] of commit.parents.entries()) {
      const parentRole = roleOf.get(parent) ?? null
      // A side branch that grows from a trunk keeps the tip's line in its own
      // lane until the trunk node is drawn: several branches leaving the same
      // node then stay separate and converge exactly there. A trunk's own
      // parent, and every extra parent of a merge, still go to the reserved
      // column straight away.
      const waitsInChildLane = parentRole !== null && role === null && index === 0
      // The first parent continues this commit's column even when another lane
      // already expects it. Joining that lane would free this column for a
      // merged-in branch, making the side branch look like the trunk. Waiting
      // also means the line curves into the shared commit at that commit's own
      // node instead of ending one row early against the middle of a line.
      const keepsOwnLane = index === 0 && parentRole === null
      const existing =
        waitsInChildLane || keepsOwnLane ? -1 : next.findIndex((lane) => lane?.oid === parent)
      if (existing !== -1) {
        // Another lane already carries this parent: this line joins it rather
        // than opening a lane of its own.
        parentColors.set(parent, nodeColor)
        parentLanes.set(parent, existing)

        // A trunk or integration branch that reaches a parent another lane
        // already expected takes that parent into its own column instead of
        // bending into the other lane. The other line curves into the trunk at
        // this row, so the trunk keeps the same straight column below the
        // branch point too.
        const carried = next[existing]
        if (
          index === 0 &&
          carried !== null &&
          carried !== undefined &&
          typeof nodeColor === 'string' &&
          colorRank(nodeColor) >= colorRank(carried.color)
        ) {
          // The role lane takes the shared commit without changing its own
          // colour; the other line ends here.
          next[existing] = null
          next[nodeLane] = { oid: parent, color: nodeColor }
          parentColors.set(parent, nodeColor)
          parentLanes.set(parent, nodeLane)
          continue
        }

        continue
      }

      // The first parent continues in the commit's lane; another parent opens
      // the first free lane, or one at the right when there is none. A parent
      // with a role prefers its reserved column, except the trunk a side branch
      // grew from: that one waits in the child lane so that the branches stay
      // apart until they meet at the trunk node.
      const preferred = parentRole === null ? undefined : roleLane.get(parentRole)
      let target: number
      if (
        parentRole !== null &&
        !waitsInChildLane &&
        preferred !== undefined &&
        (next[preferred] ?? null) === null
      ) {
        target = preferred
      } else if (index === 0 && next[nodeLane] === null) {
        target = nodeLane
      } else {
        target = freeLane(next)
      }
      while (next.length < target) next.push(null)
      if (target === next.length) next.push(null)
      const color =
        parentRole !== null && !waitsInChildLane
          ? parentRole
          : index === 0
            ? nodeColor
            : allocateColor()
      next[target] = { oid: parent, color }
      parentLanes.set(parent, target)
      // A branch keeps its own colour on the line that leaves its node; only a
      // merge's extra parent takes the colour of the lane it opens.
      parentColors.set(parent, index === 0 ? nodeColor : color)
    }

    const width = Math.max(before.length, next.length)
    while (next.length > reservedWidth && next[next.length - 1] === null) next.pop()
    widest = Math.max(widest, width)
    const edges: GraphEdge[] = []

    // A lane that carries another branch through this row keeps its colour. Its
    // column never changes, so the line stays straight all the way down.
    for (const [index, lane] of before.entries()) {
      if (lane === null || lane === undefined || lane.oid === commit.oid) continue
      const target =
        next[index]?.oid === lane.oid
          ? index
          : next.findIndex((candidate) => candidate?.oid === lane.oid)
      if (target !== -1) {
        edges.push({ from: index, to: target, color: lane.color, side: 'through' })
      }
    }

    // Several children can point at the same commit; each line converges on the
    // node from the row's top edge, keeping the colour of the child it comes
    // from instead of taking the colour of the lane that owns the node.
    for (const index of matched) {
      edges.push({ from: index, to: nodeLane, color: before[index]!.color, side: 'top' })
    }

    for (const parent of commit.parents) {
      const target = parentLanes.get(parent) ?? next.findIndex((lane) => lane?.oid === parent)
      if (target !== -1) {
        edges.push({
          from: nodeLane,
          to: target,
          color: parentColors.get(parent) ?? nodeColor,
          side: 'bottom'
        })
      }
    }

    rows.push({ lane: nodeLane, color: nodeColor, width, edges })
    lanes = next
  }

  return { rows, lanes: widest }
}
