// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import {
  GitError,
  GitRunner,
  GitVersionError,
  isAtLeast,
  MINIMUM_GIT_VERSION,
  parseGitVersion,
  type GitVersion
} from './index'

// ensureVersion only hands this to the overridden version lookup below.
const cwd = 'unused'

/** A runner that reports an older Git version than the machine has. */
class OldGitRunner extends GitRunner {
  override async version(): Promise<GitVersion> {
    return { major: 2, minor: 29, patch: 0, raw: 'git version 2.29.0' }
  }
}

describe('parseGitVersion', () => {
  it('reads a plain version', () => {
    expect(parseGitVersion('git version 2.53.0\n')).toEqual({
      major: 2,
      minor: 53,
      patch: 0,
      raw: 'git version 2.53.0'
    })
  })

  it('reads the Windows build suffix', () => {
    const version = parseGitVersion('git version 2.30.0.windows.1')
    expect([version.major, version.minor, version.patch]).toEqual([2, 30, 0])
  })

  it('tolerates a missing patch number', () => {
    const version = parseGitVersion('git version 2.39')
    expect([version.major, version.minor, version.patch]).toEqual([2, 39, 0])
  })

  it('rejects output that is not a Git version', () => {
    expect(() => parseGitVersion('v24.14.1')).toThrow(GitError)
  })
})

describe('isAtLeast', () => {
  const minimum = MINIMUM_GIT_VERSION

  it('compares major, minor and patch in order', () => {
    expect(isAtLeast({ major: 2, minor: 30, patch: 0, raw: '2.30.0' }, minimum)).toBe(true)
    expect(isAtLeast({ major: 2, minor: 29, patch: 9, raw: '2.29.9' }, minimum)).toBe(false)
    expect(isAtLeast({ major: 3, minor: 0, patch: 0, raw: '3.0.0' }, minimum)).toBe(true)
    expect(isAtLeast({ major: 2, minor: 30, patch: 0, raw: '2.30.0' }, minimum)).toBe(true)
  })
})

describe('ensureVersion', () => {
  it('rejects a Git older than the minimum with a clear message', async () => {
    const promise = new OldGitRunner().ensureVersion(cwd)
    await expect(promise).rejects.toBeInstanceOf(GitVersionError)
    await expect(promise).rejects.toThrow(/2\.30 or newer is required, found git version 2\.29\.0/)
  })
})
