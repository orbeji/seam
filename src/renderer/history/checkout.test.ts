// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { checkoutRelation, checkoutTarget, type CheckoutCandidate } from './checkout'
import type { GraphCommit } from './graph'

const commits: GraphCommit[] = [
  { oid: 'merge', parents: ['main', 'feature'] },
  { oid: 'main', parents: ['base'] },
  { oid: 'feature', parents: ['base'] },
  { oid: 'base', parents: [] }
]

function candidate(
  oid: string,
  refs: CheckoutCandidate['refs'] = [],
  parents: readonly string[] = []
): CheckoutCandidate {
  return { oid, parents, refs }
}

describe('checkoutTarget', () => {
  it('does nothing when the node is already HEAD', () => {
    expect(checkoutTarget(commits, 'merge', candidate('merge'))).toEqual({ kind: 'current' })
  })

  it('checks out a local branch that points at the node', () => {
    const commit = candidate('feature', [
      { name: 'v2', kind: 'tag' },
      { name: 'feature/pitagoras', kind: 'branch' },
      { name: 'origin/feature/pitagoras', kind: 'remote' }
    ])
    expect(checkoutTarget(commits, 'main', commit)).toEqual({
      kind: 'branch',
      branch: 'feature/pitagoras',
      localBranch: 'feature/pitagoras',
      remote: false
    })
  })

  it('checks out a remote branch and names the local tracking branch', () => {
    const commit = candidate('feature', [
      { name: 'origin/feature/pitagoras', kind: 'remote' }
    ])
    expect(checkoutTarget(commits, 'main', commit)).toEqual({
      kind: 'branch',
      branch: 'origin/feature/pitagoras',
      localBranch: 'feature/pitagoras',
      remote: true
    })
  })

  it('checks out the commit when only tags point at it', () => {
    const commit = candidate('base', [{ name: 'v1', kind: 'tag' }])
    expect(checkoutTarget(commits, 'main', commit)).toEqual({
      kind: 'commit',
      relation: 'past'
    })
  })

  it('checks out an untipped commit outside the current branch detached', () => {
    expect(checkoutTarget(commits, 'main', candidate('feature'))).toEqual({
      kind: 'commit',
      relation: 'other'
    })
  })
})

describe('checkoutRelation', () => {
  it('recognises the commit HEAD already points at', () => {
    expect(checkoutRelation(commits, 'merge', 'merge')).toBe('current')
  })

  it('recognises an ancestor reached through either side of a merge', () => {
    expect(checkoutRelation(commits, 'merge', 'main')).toBe('past')
    expect(checkoutRelation(commits, 'merge', 'feature')).toBe('past')
    expect(checkoutRelation(commits, 'merge', 'base')).toBe('past')
  })

  it('reports a commit outside the walked history as other', () => {
    expect(checkoutRelation(commits, 'main', 'feature')).toBe('other')
    expect(checkoutRelation(commits, 'main', 'not-shown')).toBe('other')
  })

  it('reports every commit as other when HEAD is detached from the shown graph', () => {
    expect(checkoutRelation(commits, null, 'base')).toBe('other')
  })

  it('follows a parent id even when that commit is not shown in the window', () => {
    const truncated: GraphCommit[] = [{ oid: 'tip', parents: ['older'] }]
    expect(checkoutRelation(truncated, 'tip', 'older')).toBe('past')
  })
})
