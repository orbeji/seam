// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest'
import { GitError, GitRunner, writeIndexEntry } from '../src/core/git'
import { createRepository, type SampleRepository } from './fixtures/repository'

const runner = new GitRunner()
const repositories: SampleRepository[] = []

async function repository(): Promise<SampleRepository> {
  const repo = await createRepository()
  repositories.push(repo)
  return repo
}

async function committed(): Promise<SampleRepository> {
  const repo = await repository()
  repo.write('tracked.txt', 'base\n')
  await repo.git(['add', 'tracked.txt'])
  await repo.git(['commit', '-qm', 'base'])
  return repo
}

/** The index entry of one path, exactly as `ls-files -s` prints it. */
async function entry(repo: SampleRepository, path: string): Promise<string> {
  return (await repo.git(['ls-files', '-s', '--', path])).trim()
}

/**
 * The oracle: reset the index to HEAD and let `git add` stage the working copy,
 * so the entry it leaves can be compared with the one Seam wrote.
 */
async function stageWithGit(repo: SampleRepository, path: string): Promise<string> {
  await repo.git(['read-tree', 'HEAD'])
  await repo.git(['add', '--', path])
  return entry(repo, path)
}

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

describe('writeIndexEntry', () => {
  it('writes the index entry git add would have written', async () => {
    const repo = await committed()
    const content = 'base\nsecond line\nthird line\n'
    repo.write('tracked.txt', content)

    await writeIndexEntry(runner, repo.path, 'tracked.txt', content)
    const written = await entry(repo, 'tracked.txt')

    expect(written).not.toBe('')
    expect(written).toBe(await stageWithGit(repo, 'tracked.txt'))
  })

  it('leaves the same tree as staging the same content with git add', async () => {
    const repo = await committed()
    const contents = new Map([
      ['tracked.txt', 'base\nchanged\n'],
      ['fresh.txt', 'new file\n'],
      ['third.txt', 'another\n']
    ])
    for (const [path, text] of contents) {
      repo.write(path, text)
      await writeIndexEntry(runner, repo.path, path, text)
    }
    const seamTree = (await repo.git(['write-tree'])).trim()

    await repo.git(['read-tree', 'HEAD'])
    for (const path of contents.keys()) await repo.git(['add', '--', path])
    const gitTree = (await repo.git(['write-tree'])).trim()

    expect(seamTree).toBe(gitTree)
  })

  it('adds a path that is not in the index yet', async () => {
    const repo = await committed()
    repo.write('fresh.txt', 'fresh content\n')

    await writeIndexEntry(runner, repo.path, 'fresh.txt', 'fresh content\n')
    expect(await entry(repo, 'fresh.txt')).toBe(await stageWithGit(repo, 'fresh.txt'))
  })

  it('keeps the executable bit already recorded in the index', async () => {
    const repo = await committed()
    repo.write('run.sh', '#!/bin/sh\necho one\n')
    await repo.git(['add', 'run.sh'])
    await repo.git(['update-index', '--chmod=+x', 'run.sh'])

    await writeIndexEntry(runner, repo.path, 'run.sh', '#!/bin/sh\necho two\n')

    expect(await entry(repo, 'run.sh')).toMatch(/^100755 /)
  })

  it('stores the normalised blob under core.autocrlf=true', async () => {
    const repo = await committed()
    await repo.git(['config', 'core.autocrlf', 'true'])
    const crlf = 'one\r\ntwo\r\nthree\r\n'
    repo.write('tracked.txt', crlf)

    await writeIndexEntry(runner, repo.path, 'tracked.txt', crlf)
    const written = await entry(repo, 'tracked.txt')

    // The same entry git add leaves, and the blob is the LF text.
    expect(written).toBe(await stageWithGit(repo, 'tracked.txt'))
    const id = written.split(' ')[1] ?? ''
    expect(await repo.git(['cat-file', '-p', id])).toBe('one\ntwo\nthree\n')
  })

  it('runs an external clean filter like `git add` does', async () => {
    const repo = await committed()
    // The kind of filter Git LFS installs: the clean side rewrites the working
    // copy before Git turns it into a blob.
    repo.write('.gitattributes', 'tracked.txt filter=demo\n')
    await repo.git(['config', 'filter.demo.clean', 'tr a-z A-Z'])
    await repo.git(['add', '.gitattributes'])
    await repo.git(['commit', '-qm', 'attributes'])

    repo.write('tracked.txt', 'one\ntwo\nthree\n')
    await writeIndexEntry(runner, repo.path, 'tracked.txt', 'one\ntwo\nthree\n')
    const written = await entry(repo, 'tracked.txt')

    // `--path` ran the filter, so the entry is the one git add leaves and the
    // blob holds the cleaned text, not what the working copy reads.
    expect(written).toBe(await stageWithGit(repo, 'tracked.txt'))
    const id = written.split(' ')[1] ?? ''
    expect(await repo.git(['cat-file', '-p', id])).toBe('ONE\nTWO\nTHREE\n')
  })

  it('refuses a path with merge conflicts', async () => {
    const repo = await committed()
    repo.write('tracked.txt', 'ours\n')
    await repo.git(['add', 'tracked.txt'])
    await repo.git(['commit', '-qm', 'ours'])

    await repo.git(['checkout', '-q', '-b', 'side', 'HEAD~1'])
    repo.write('tracked.txt', 'theirs\n')
    await repo.git(['add', 'tracked.txt'])
    await repo.git(['commit', '-qm', 'theirs'])

    await repo.git(['checkout', '-q', 'main'])
    await repo.gitExpectingFailure(['merge', '--no-edit', 'side'])

    await expect(
      writeIndexEntry(runner, repo.path, 'tracked.txt', 'resolved\n')
    ).rejects.toBeInstanceOf(GitError)
  })
})
