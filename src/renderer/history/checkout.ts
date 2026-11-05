// SPDX-License-Identifier: MIT

import type { HistoryRef } from '../../shared/git'
import type { GraphCommit } from './graph'

/** Where a commit the user picked sits relative to the current HEAD. */
export type CheckoutRelation =
  /** The commit HEAD already points at, so checking it out changes nothing. */
  | 'current'
  /** An ancestor of HEAD: checking it out moves the working tree back in time. */
  | 'past'
  /** Any other commit, such as one on another branch or a detached tip. */
  | 'other'

/** The part of a history commit a checkout decision needs. */
export interface CheckoutCandidate extends GraphCommit {
  readonly refs: readonly HistoryRef[]
}

/**
 * What double-clicking a node does. A branch tip checks out the branch, so HEAD
 * stays attached; only a node no branch points at checks out the commit itself.
 */
export type CheckoutTarget =
  | { readonly kind: 'current' }
  | {
      readonly kind: 'branch'
      /** The ref to hand to Git: `main` or `origin/feature/x`. */
      readonly branch: string
      /** The local branch the checkout ends up on. */
      readonly localBranch: string
      readonly remote: boolean
    }
  | { readonly kind: 'commit'; readonly relation: Exclude<CheckoutRelation, 'current'> }

/**
 * Chooses how to move to a commit. A local branch wins over a remote one, so a
 * commit that is the tip of both checks out the branch already on disk. A
 * remote tip creates or switches to its local tracking branch, and a tag or an
 * untipped commit is checked out detached.
 */
export function checkoutTarget(
  commits: readonly GraphCommit[],
  headOid: string | null,
  commit: CheckoutCandidate
): CheckoutTarget {
  const relation = checkoutRelation(commits, headOid, commit.oid)
  if (relation === 'current') return { kind: 'current' }

  const local = commit.refs.find((reference) => reference.kind === 'branch')
  if (local !== undefined) {
    return { kind: 'branch', branch: local.name, localBranch: local.name, remote: false }
  }

  const remote = commit.refs.find((reference) => reference.kind === 'remote')
  if (remote !== undefined) {
    const slash = remote.name.indexOf('/')
    const localBranch = slash === -1 ? remote.name : remote.name.slice(slash + 1)
    return {
      kind: 'branch',
      branch: remote.name,
      localBranch: localBranch === '' ? remote.name : localBranch,
      remote: true
    }
  }

  return { kind: 'commit', relation }
}

/**
 * Says whether a commit is the current HEAD, an ancestor of it, or somewhere
 * else. The history view only reads a window of commits, so a parent that is not
 * in it stops the walk: the commit is then reported as `other`, which still
 * gets the detached-HEAD warning rather than a wrong claim about the branch.
 */
export function checkoutRelation(
  commits: readonly GraphCommit[],
  headOid: string | null,
  oid: string
): CheckoutRelation {
  if (headOid === null) return 'other'
  if (headOid === oid) return 'current'

  const parents = new Map(commits.map((commit) => [commit.oid, commit.parents]))
  const seen = new Set<string>([headOid])
  const queue = [headOid]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current === oid) return 'past'
    for (const parent of parents.get(current) ?? []) {
      if (seen.has(parent)) continue
      seen.add(parent)
      queue.push(parent)
    }
  }

  return 'other'
}

