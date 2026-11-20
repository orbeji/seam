// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { AUTO_FETCH_INTERVAL_MS, autoFetchDue } from './auto-fetch'

describe('auto fetch', () => {
  it('is due for a repository that has never been fetched', () => {
    expect(autoFetchDue(null, '/repo', 1_000)).toBe(true)
  })

  it('is due again for another repository, even right after a fetch', () => {
    expect(autoFetchDue({ repo: '/one', at: 1_000 }, '/two', 1_001)).toBe(true)
  })

  it('waits out the interval for the same repository', () => {
    const last = { repo: '/repo', at: 1_000 }
    expect(autoFetchDue(last, '/repo', 1_001)).toBe(false)
    expect(autoFetchDue(last, '/repo', 1_000 + AUTO_FETCH_INTERVAL_MS - 1)).toBe(false)
    expect(autoFetchDue(last, '/repo', 1_000 + AUTO_FETCH_INTERVAL_MS)).toBe(true)
  })
})
