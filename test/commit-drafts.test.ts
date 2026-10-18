// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CommitDrafts } from '../src/main/session/commit-drafts'

const directories: string[] = []

function tempFile(name = 'drafts.json'): string {
  const dir = mkdtempSync(join(tmpdir(), 'seam-drafts-'))
  directories.push(dir)
  return join(dir, name)
}

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop() ?? '', { recursive: true, force: true })
})

describe('CommitDrafts', () => {
  it('reads an empty string when the file does not exist', () => {
    expect(new CommitDrafts(tempFile()).read('/repo')).toBe('')
  })

  it('reads back a message it wrote', () => {
    const drafts = new CommitDrafts(tempFile())
    drafts.write('/repo', 'Fix the parser')
    expect(drafts.read('/repo')).toBe('Fix the parser')
  })

  it('keeps one draft per repository', () => {
    const drafts = new CommitDrafts(tempFile())
    drafts.write('/a', 'first')
    drafts.write('/b', 'second')
    expect(drafts.read('/a')).toBe('first')
    expect(drafts.read('/b')).toBe('second')
  })

  it('forgets a repository when the message is emptied', () => {
    const drafts = new CommitDrafts(tempFile())
    drafts.write('/repo', 'Fix the parser')
    drafts.write('/repo', '')
    expect(drafts.read('/repo')).toBe('')
  })

  it('reads back what a previous instance wrote', () => {
    const file = tempFile()
    new CommitDrafts(file).write('/repo', 'Fix the parser')
    expect(new CommitDrafts(file).read('/repo')).toBe('Fix the parser')
  })

  it('starts empty when the file holds unusable JSON', () => {
    const file = tempFile()
    writeFileSync(file, 'not json')
    expect(new CommitDrafts(file).read('/repo')).toBe('')
  })

  it('ignores entries that are not strings', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({ '/a': 'kept', '/b': 3, '/c': null }))
    const drafts = new CommitDrafts(file)
    expect(drafts.read('/a')).toBe('kept')
    expect(drafts.read('/b')).toBe('')
    expect(drafts.read('/c')).toBe('')
  })
})
