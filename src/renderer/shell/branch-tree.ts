// SPDX-License-Identifier: MIT

/** A folder grouping branches that share a path prefix before a "/". */
export interface BranchGroup<T> {
  readonly kind: 'group'
  /** The folder's own segment, as shown in the menu (e.g. "feature"). */
  readonly name: string
  /** The folder's full path, unique across the tree (e.g. "feature/fix"). */
  readonly path: string
  /** Folders and branches inside this folder. */
  readonly children: readonly BranchNode<T>[]
}

/** A branch shown under the folder it belongs to. */
export interface BranchLeaf<T> {
  readonly kind: 'leaf'
  /** The segment shown inside its folder (e.g. "fun-1234" for feature/fun-1234). */
  readonly label: string
  /** The branch itself, carrying whatever the caller needs (checkout name, badge…). */
  readonly item: T
}

export type BranchNode<T> = BranchGroup<T> | BranchLeaf<T>

interface MutableGroup<T> {
  readonly folders: Map<string, MutableGroup<T>>
  readonly leaves: Map<string, T>
}

/** Sorts folders and branches together by their segment, like Git's order. */
function compareNodes<T>(a: BranchNode<T>, b: BranchNode<T>): number {
  const aName = a.kind === 'group' ? a.name : a.label
  const bName = b.kind === 'group' ? b.name : b.label
  if (aName < bName) return -1
  if (aName > bName) return 1
  return 0
}

function finishGroup<T>(group: MutableGroup<T>, prefix: string): BranchNode<T>[] {
  const nodes: BranchNode<T>[] = []
  for (const [name, folder] of group.folders) {
    const path = prefix === '' ? name : `${prefix}/${name}`
    nodes.push({ kind: 'group', name, path, children: finishGroup(folder, path) })
  }
  for (const [label, item] of group.leaves) {
    nodes.push({ kind: 'leaf', label, item })
  }
  return nodes.sort(compareNodes)
}

/**
 * Builds the folder tree the branch menu shows. "feature/fun-1234" and
 * "feature/fun-2345" group under one "feature" folder whose leaves are labeled
 * "fun-1234" and "fun-2345", and every extra "/" nests one folder deeper.
 *
 * The caller decides what a branch's display path is — a remote branch can
 * strip its remote prefix so "origin/feature/x" groups under "feature" — while
 * the leaf's `item` keeps the full information, typically the checkout name.
 */
export function buildBranchTree<T>(
  items: readonly T[],
  pathOf: (item: T) => string
): readonly BranchNode<T>[] {
  const root: MutableGroup<T> = { folders: new Map(), leaves: new Map() }
  for (const item of items) {
    const parts = pathOf(item).split('/')
    let folder = root
    for (const name of parts.slice(0, -1)) {
      if (name === '') continue
      let child = folder.folders.get(name)
      if (child === undefined) {
        child = { folders: new Map(), leaves: new Map() }
        folder.folders.set(name, child)
      }
      folder = child
    }
    const label = parts[parts.length - 1] ?? ''
    if (label !== '') folder.leaves.set(label, item)
  }
  return finishGroup(root, '')
}
