// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CommitHistory } from '../src/main/session/commit-history'

const directories: string[] = []

function tempFile(name = 'commit-history.json'): string {
  const dir = mkdtempSync(join(tmpdir(), 'seam-history-'))
  directories.push(dir)
  return join(dir, name)
}

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop() ?? '', { recursive: true, force: true })
})

describe('CommitHistory', () => {
  it('reads nothing when the file does not exist', () => {
    expect(new CommitHistory(tempFile()).read('/repo')).toEqual([])
  })

  it('remembers messages newest first, one list per repository', () => {
    const history = new CommitHistory(tempFile())
    history.remember('/repo', 'first')
    history.remember('/repo', 'second')
    history.remember('/other', 'elsewhere')

    expect(history.read('/repo')).toEqual(['second', 'first'])
    expect(history.read('/other')).toEqual(['elsewhere'])
  })

  it('keeps a repeated message only once, at the front', () => {
    const history = new CommitHistory(tempFile())
    history.remember('/repo', 'first')
    history.remember('/repo', 'second')
    history.remember('/repo', 'first')

    expect(history.read('/repo')).toEqual(['first', 'second'])
  })

  it('ignores an empty message', () => {
    const history = new CommitHistory(tempFile())
    history.remember('/repo', '   ')
    expect(history.read('/repo')).toEqual([])
  })

  it('keeps only the last twenty messages', () => {
    const history = new CommitHistory(tempFile())
    for (let index = 0; index < 25; index += 1) history.remember('/repo', `message ${index}`)

    const entries = history.read('/repo')
    expect(entries).toHaveLength(20)
    expect(entries[0]).toBe('message 24')
    expect(entries).not.toContain('message 0')
  })

  it('reads back what it wrote in another instance', () => {
    const file = tempFile()
    const history = new CommitHistory(file)
    history.remember('/repo', 'kept across runs')

    expect(new CommitHistory(file).read('/repo')).toEqual(['kept across runs'])
  })

  it('starts from nothing when the file holds unusable JSON', () => {
    const file = tempFile()
    writeFileSync(file, 'not json')
    expect(new CommitHistory(file).read('/repo')).toEqual([])
  })

  it('ignores an entry of the wrong shape', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({ '/repo': 'a single message', '/ok': ['fine'] }))
    const history = new CommitHistory(file)
    expect(history.read('/repo')).toEqual([])
    expect(history.read('/ok')).toEqual(['fine'])
  })
})
