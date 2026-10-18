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

  it('replaces the button while an operation is in progress', () => {
    expect(commitAvailability({ ...base, staged: 3, operation: 'rebase' })).toEqual({
      kind: 'replaced',
      operation: 'rebase'
    })
  })

  it('lets the operation rule win over conflicts', () => {
    expect(commitAvailability({ ...base, conflicts: 1, operation: 'merge' })).toEqual({
      kind: 'replaced',
      operation: 'merge'
    })
  })
})
