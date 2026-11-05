// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { normalizeRepositoryUrl } from './git-url'

describe('normalizeRepositoryUrl', () => {
  it('reduces a GitHub branch or file page to its repository', () => {
    expect(normalizeRepositoryUrl('https://github.com/orbeji/test/tree/main/src')).toBe(
      'https://github.com/orbeji/test'
    )
    expect(normalizeRepositoryUrl('https://github.com/orbeji/test/blob/main/README.md')).toBe(
      'https://github.com/orbeji/test'
    )
    expect(normalizeRepositoryUrl('https://github.com/orbeji/test/issues/12')).toBe(
      'https://github.com/orbeji/test'
    )
    expect(normalizeRepositoryUrl('https://github.com/orbeji/test/releases')).toBe(
      'https://github.com/orbeji/test'
    )
  })

  it('leaves a repository address in the form Git can use', () => {
    expect(normalizeRepositoryUrl('https://github.com/orbeji/test')).toBe(
      'https://github.com/orbeji/test'
    )
    expect(normalizeRepositoryUrl('https://github.com/orbeji/test.git')).toBe(
      'https://github.com/orbeji/test'
    )
    expect(normalizeRepositoryUrl('https://github.com/orbeji/test/')).toBe(
      'https://github.com/orbeji/test'
    )
    expect(normalizeRepositoryUrl('https://www.github.com/orbeji/test?tab=readme')).toBe(
      'https://www.github.com/orbeji/test'
    )
  })

  it('does not guess at addresses that are not a GitHub repository page', () => {
    expect(normalizeRepositoryUrl('https://github.com/orgs/orbeji/repositories')).toBe(
      'https://github.com/orgs/orbeji/repositories'
    )
    expect(normalizeRepositoryUrl('https://gitlab.com/group/repo/-/tree/main')).toBe(
      'https://gitlab.com/group/repo/-/tree/main'
    )
    expect(normalizeRepositoryUrl('git@github.com:orbeji/test.git')).toBe(
      'git@github.com:orbeji/test.git'
    )
    expect(normalizeRepositoryUrl('  ')).toBe('')
  })
})
