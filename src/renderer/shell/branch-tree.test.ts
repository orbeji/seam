// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { buildBranchTree, type BranchGroup, type BranchLeaf, type BranchNode } from './branch-tree'

interface Item {
  readonly name: string
}

function leafLabels<T>(nodes: readonly BranchNode<T>[]): string[] {
  return nodes.filter((node) => node.kind === 'leaf').map((node) => node.label)
}

function folderOf<T>(nodes: readonly BranchNode<T>[], name: string): BranchGroup<T> {
  const group = nodes.find(
    (node): node is BranchGroup<T> => node.kind === 'group' && node.name === name
  )
  if (group === undefined) throw new Error(`no folder named ${name}`)
  return group
}

describe('buildBranchTree', () => {
  it('groups branches sharing a first-segment prefix under one folder', () => {
    const nodes = buildBranchTree(
      [{ name: 'feature/fun-1234' }, { name: 'feature/fun-2345' }] satisfies Item[],
      (item) => item.name
    )

    expect(nodes).toHaveLength(1)
    expect(folderOf(nodes, 'feature').children).toEqual([
      { kind: 'leaf', label: 'fun-1234', item: { name: 'feature/fun-1234' } },
      { kind: 'leaf', label: 'fun-2345', item: { name: 'feature/fun-2345' } }
    ])
  })

  it('nests one folder deeper per extra "/"', () => {
    const nodes = buildBranchTree(
      [{ name: 'fork/depth/nested' }] satisfies Item[],
      (item) => item.name
    )

    expect(leafLabels(folderOf(folderOf(nodes, 'fork').children, 'depth').children)).toEqual([
      'nested'
    ])
  })

  it('keeps a branch without "/" as a top-level leaf', () => {
    const nodes = buildBranchTree([{ name: 'main' }] satisfies Item[], (item) => item.name)

    expect(nodes).toEqual([{ kind: 'leaf', label: 'main', item: { name: 'main' } }])
  })

  it('sorts folders and branches together by segment', () => {
    const nodes = buildBranchTree(
      [{ name: 'zeta' }, { name: 'alpha/one' }, { name: 'beta' }] satisfies Item[],
      (item) => item.name
    )

    expect(nodes.map((node) => (node.kind === 'group' ? node.name : node.label))).toEqual([
      'alpha',
      'beta',
      'zeta'
    ])
  })

  it("lets the caller strip a prefix, e.g. a remote branch's remote name", () => {
    const remotes = [
      { fullname: 'origin/feature/fun-1234', remote: 'origin' },
      { fullname: 'origin/tool', remote: 'origin' }
    ]
    const nodes = buildBranchTree(remotes, (item) => item.fullname.slice(item.remote.length + 1))

    // The leaf keeps the full checkout name even though it is shown under "feature".
    const feature = folderOf(nodes, 'feature')
    expect((feature.children[0] as BranchLeaf<(typeof remotes)[number]>).item.fullname).toBe(
      'origin/feature/fun-1234'
    )
    expect(leafLabels(nodes)).toEqual(['tool'])
  })

  it('merges the same folder from different branches into one group', () => {
    const nodes = buildBranchTree(
      [{ name: 'feature/a' }, { name: 'feature/b' }, { name: 'main' }] satisfies Item[],
      (item) => item.name
    )

    expect(nodes).toHaveLength(2)
    expect(folderOf(nodes, 'feature').children).toHaveLength(2)
    expect(leafLabels(nodes)).toEqual(['main'])
  })
})
