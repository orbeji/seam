// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RecentRepositories } from '../src/main/session/recent-repositories'

const directories: string[] = []

function tempFile(name = 'recent.json'): string {
  const dir = mkdtempSync(join(tmpdir(), 'seam-recent-'))
  directories.push(dir)
  return join(dir, name)
}

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop() ?? '', { recursive: true, force: true })
})

describe('RecentRepositories', () => {
  it('starts empty when the file does not exist', () => {
    expect(new RecentRepositories(tempFile()).list()).toEqual([])
  })

  it('keeps the most recent repository first', () => {
    const recent = new RecentRepositories(tempFile())
    recent.remember('/a')
    recent.remember('/b')
    expect(recent.list()).toEqual(['/b', '/a'])
  })

  it('moves a repeated repository to the front without duplicating it', () => {
    const recent = new RecentRepositories(tempFile())
    recent.remember('/a')
    recent.remember('/b')
    recent.remember('/a')
    expect(recent.list()).toEqual(['/a', '/b'])
  })

  it('keeps at most ten repositories', () => {
    const recent = new RecentRepositories(tempFile())
    for (let i = 0; i < 12; i += 1) recent.remember(`/repo-${i}`)
    const list = recent.list()
    expect(list).toHaveLength(10)
    expect(list[0]).toBe('/repo-11')
    expect(list).not.toContain('/repo-0')
  })

  it('reads back what a previous instance wrote', () => {
    const file = tempFile()
    new RecentRepositories(file).remember('/a')
    expect(new RecentRepositories(file).list()).toEqual(['/a'])
  })

  it('starts empty when the file holds unusable JSON', () => {
    const file = tempFile()
    writeFileSync(file, 'not json')
    expect(new RecentRepositories(file).list()).toEqual([])
  })

  it('ignores non-string entries in the file', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify(['/a', 3, null, '/b']))
    expect(new RecentRepositories(file).list()).toEqual(['/a', '/b'])
  })
})
