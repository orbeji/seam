// SPDX-License-Identifier: MIT

import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { diffLines } from '../src/core/diff'
import {
  GitRunner,
  readComparison,
  readEol,
  readVersion,
  shouldNormaliseWorktree,
  type EolInfo
} from '../src/core/git'
import { decodeText } from '../src/core/text'
import { createRepository, type SampleRepository } from './fixtures/repository'

const runner = new GitRunner()
const repositories: SampleRepository[] = []

async function repository(): Promise<SampleRepository> {
  const created = await createRepository()
  repositories.push(created)
  return created
}

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

describe('readVersion', () => {
  it('reads HEAD, the index and the working copy', async () => {
    const repo = await repository()
    repo.write('file.txt', 'one\ntwo\n')
    await repo.git(['add', 'file.txt'])
    await repo.git(['commit', '-qm', 'one'])
    repo.write('file.txt', 'one\ntwo\nthree\n')

    const head = await readVersion(runner, repo.path, 'file.txt', 'head')
    const index = await readVersion(runner, repo.path, 'file.txt', 'index')
    const worktree = await readVersion(runner, repo.path, 'file.txt', 'worktree')

    expect(decodeText(head.bytes as Uint8Array)).toBe('one\ntwo\n')
    expect(decodeText(index.bytes as Uint8Array)).toBe('one\ntwo\n')
    expect(decodeText(worktree.bytes as Uint8Array)).toBe('one\ntwo\nthree\n')
    expect(head.mode).toBe('100644')
    expect(worktree.mode).toBe('100644')
  })

  it('keeps the executable bit in the mode', async () => {
    const repo = await repository()
    repo.write('run.sh', '#!/bin/sh\necho hi\n')
    chmodSync(join(repo.path, 'run.sh'), 0o755)
    await repo.git(['add', 'run.sh'])
    // Windows has no executable bit on disk and `core.filemode` is false there,
    // so the mode has to be forced in the index for the commit to record 100755.
    await repo.git(['update-index', '--chmod=+x', 'run.sh'])
    await repo.git(['commit', '-qm', 'one'])

    expect((await readVersion(runner, repo.path, 'run.sh', 'head')).mode).toBe('100755')
    if (process.platform !== 'win32') {
      // On Windows the working copy has no mode to report; Git ignores it too.
      expect((await readVersion(runner, repo.path, 'run.sh', 'worktree')).mode).toBe('100755')
    }
  })

  it('returns null for a version that does not exist', async () => {
    const repo = await repository()
    repo.write('untracked.txt', 'hello\n')

    const head = await readVersion(runner, repo.path, 'untracked.txt', 'head')
    const index = await readVersion(runner, repo.path, 'untracked.txt', 'index')
    const worktree = await readVersion(runner, repo.path, 'untracked.txt', 'worktree')

    expect(head.bytes).toBeNull()
    expect(index.bytes).toBeNull()
    expect(decodeText(worktree.bytes as Uint8Array)).toBe('hello\n')
  })

  it('reads the three sides of a conflict', async () => {
    const repo = await repository()
    repo.write('f.txt', 'base\n')
    await repo.git(['add', 'f.txt'])
    await repo.git(['commit', '-qm', 'base'])
    await repo.git(['checkout', '-q', '-b', 'other'])
    repo.write('f.txt', 'theirs\n')
    await repo.git(['commit', '-qam', 'theirs'])
    await repo.git(['checkout', '-q', 'main'])
    repo.write('f.txt', 'ours\n')
    await repo.git(['commit', '-qam', 'ours'])

    const merge = await repo.run(['merge', 'other'])
    expect(merge.code).not.toBe(0)

    expect(
      decodeText((await readVersion(runner, repo.path, 'f.txt', 'stage1')).bytes as Uint8Array)
    ).toBe('base\n')
    expect(
      decodeText((await readVersion(runner, repo.path, 'f.txt', 'stage2')).bytes as Uint8Array)
    ).toBe('ours\n')
    expect(
      decodeText((await readVersion(runner, repo.path, 'f.txt', 'stage3')).bytes as Uint8Array)
    ).toBe('theirs\n')
    expect((await readVersion(runner, repo.path, 'f.txt', 'index')).bytes).toBeNull()
  })
})

describe('line-ending normalisation', () => {
  it('does not read a CRLF file as changed when core.autocrlf=true', async () => {
    const repo = await repository()
    await repo.git(['config', 'core.autocrlf', 'true'])
    repo.write('crlf.txt', 'a\r\nb\r\n')
    await repo.git(['add', 'crlf.txt'])
    await repo.git(['commit', '-qm', 'one'])

    // Git stored LF in the index but left the CRLF working copy alone.
    const index = await readVersion(runner, repo.path, 'crlf.txt', 'index')
    expect(decodeText(index.bytes as Uint8Array)).toBe('a\nb\n')

    const comparison = await readComparison(runner, repo.path, 'crlf.txt', 'index', 'worktree')
    expect(comparison.normalised).toBe(true)
    expect(comparison.to?.lines).toEqual(['a', 'b'])
    expect(diffLines(comparison.from?.lines ?? [], comparison.to?.lines ?? [], 'none')).toEqual([])
  })

  it('keeps a stray CRLF as a change when core.autocrlf=false', async () => {
    const repo = await repository()
    repo.write('f.txt', 'a\nb\n')
    await repo.git(['add', 'f.txt'])
    await repo.git(['commit', '-qm', 'one'])
    repo.write('f.txt', 'a\r\nb\r\n')

    const comparison = await readComparison(runner, repo.path, 'f.txt', 'index', 'worktree')
    expect(comparison.normalised).toBe(false)
    const hunks = diffLines(comparison.from?.lines ?? [], comparison.to?.lines ?? [], 'none')
    expect(hunks).not.toEqual([])
  })

  it('reads the end-of-line facts Git reports', async () => {
    const repo = await repository()
    repo.write('f.txt', 'a\nb\n')
    await repo.git(['add', 'f.txt'])
    await repo.git(['commit', '-qm', 'one'])

    expect(await readEol(runner, repo.path, 'f.txt')).toEqual({
      index: 'lf',
      worktree: 'lf',
      attr: ''
    })
    expect(await readEol(runner, repo.path, 'missing.txt')).toBeNull()
  })

  it('decides for itself when Git would normalise', () => {
    const base: EolInfo = { index: 'lf', worktree: 'crlf', attr: '' }
    expect(shouldNormaliseWorktree(base, 'true')).toBe(true)
    expect(shouldNormaliseWorktree(base, 'input')).toBe(true)
    expect(shouldNormaliseWorktree(base, 'false')).toBe(false)
    expect(shouldNormaliseWorktree({ ...base, attr: 'text' }, 'false')).toBe(true)
    expect(shouldNormaliseWorktree({ ...base, attr: 'eol=crlf' }, 'false')).toBe(true)
    expect(shouldNormaliseWorktree({ ...base, attr: '-text' }, 'true')).toBe(false)
  })
})

describe('binaries', () => {
  it('marks a file with a NUL byte as binary', async () => {
    const repo = await repository()
    writeFileSync(join(repo.path, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0x03]))
    await repo.git(['add', 'bin.dat'])
    await repo.git(['commit', '-qm', 'one'])

    const comparison = await readComparison(runner, repo.path, 'bin.dat', 'index', 'worktree')
    expect(comparison.binary).toBe(true)
    expect(comparison.from).toBeNull()
    expect(comparison.to).toBeNull()
  })
})
