// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { repositoryFromArgv } from '../src/main/session/launch-arguments'

describe('repositoryFromArgv', () => {
  it('reads the path after --repo', () => {
    expect(repositoryFromArgv(['electron', 'main.js', '--repo', '/work/repo'])).toBe('/work/repo')
  })

  it('returns null when the flag is absent', () => {
    expect(repositoryFromArgv(['electron', 'main.js'])).toBeNull()
  })

  it('returns null when the flag has no value', () => {
    expect(repositoryFromArgv(['electron', 'main.js', '--repo'])).toBeNull()
  })

  it('returns null when the next argument is another flag', () => {
    expect(repositoryFromArgv(['electron', 'main.js', '--repo', '--no-sandbox'])).toBeNull()
  })
})
