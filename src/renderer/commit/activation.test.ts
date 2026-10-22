// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { commitAvailability, type CommitContext } from './activation'

const base: CommitContext = { staged: 0, conflicts: 0, operation: null, amend: false }

describe('commitAvailability', () => {
  it('is ready when a file is staged', () => {
    expect(commitAvailability({ ...base, staged: 1 })).toEqual({ kind: 'ready' })
  })

  it('is ready with Amend alone, to rewrite the last message', () => {
    expect(commitAvailability({ ...base, amend: true })).toEqual({ kind: 'ready' })
  })

  it('is disabled with nothing staged and no Amend', () => {
    expect(commitAvailability(base)).toEqual({ kind: 'disabled', reason: 'nothing-staged' })
  })

  it('is disabled while conflicts are unresolved', () => {
    expect(commitAvailability({ ...base, staged: 2, conflicts: 1 })).toEqual({
      kind: 'disabled',
      reason: 'conflicts'
    })
  })

  it('replaces the button while a rebase, cherry-pick or revert is in progress', () => {
    for (const operation of ['rebase', 'cherry-pick', 'revert'] as const) {
      expect(commitAvailability({ ...base, staged: 3, operation })).toEqual({
        kind: 'replaced',
        operation
      })
    }
  })

  it('lets a merge be finished with a commit once its conflicts are resolved', () => {
    expect(commitAvailability({ ...base, staged: 3, operation: 'merge' })).toEqual({
      kind: 'ready'
    })
  })

  it('keeps the merge ready even when resolving to ours left nothing staged', () => {
    expect(commitAvailability({ ...base, operation: 'merge' })).toEqual({ kind: 'ready' })
  })

  it('blocks the merge commit while conflicts are unresolved', () => {
    expect(commitAvailability({ ...base, staged: 3, conflicts: 1, operation: 'merge' })).toEqual({
      kind: 'disabled',
      reason: 'conflicts'
    })
  })
})
