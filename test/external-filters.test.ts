// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { LineHunk } from '../src/core/diff'
import { GitRunner, readComparison, readFileModel } from '../src/core/git'
import { RepositoryService } from '../src/main/session/repository-service'
import { createRepository, type SampleRepository } from './fixtures/repository'

const runner = new GitRunner()
const repositories: SampleRepository[] = []

async function repository(): Promise<SampleRepository> {
  const created = await createRepository()
  repositories.push(created)
  return created
}

/**
 * A repository whose `f.txt` goes through a clean filter on the way into the
 * index and the matching smudge filter on the way out, the way Git LFS or a
 * keyword expander sets one up. The stored form is not the text on disk: the
 * index holds the upper case, the working copy the lower case, so a comparison
 * that read the file raw would see every line as changed.
 */
async function filtered(): Promise<SampleRepository> {
  const repo = await repository()
  repo.write('.gitattributes', 'f.txt filter=demo\n')
  await repo.git(['config', 'filter.demo.clean', 'tr a-z A-Z'])
  await repo.git(['config', 'filter.demo.smudge', 'tr A-Z a-z'])
  repo.write('f.txt', 'one\ntwo\nthree\n')
  await repo.git(['add', '.gitattributes', 'f.txt'])
  await repo.git(['commit', '-qm', 'base'])
  return repo
}

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

describe('an external filter', () => {
  it('reads the working copy as Git stores it, not as it lies on disk', async () => {
    const repo = await filtered()
    repo.write('f.txt', 'one\ntwo\nthree\nfour\n')

    const comparison = await readComparison(runner, repo.path, 'f.txt', 'index', 'worktree')

    // The clean filter ran, so the raw lower case does not read as a change:
    // only the added line is one, exactly as `git diff` shows.
    expect(comparison.from?.lines).toEqual(['ONE', 'TWO', 'THREE'])
    expect(comparison.to?.lines).toEqual(['ONE', 'TWO', 'THREE', 'FOUR'])
    expect(comparison.normalised).toBe(true)
  })

  it('stages the file to the tree `git add` leaves', async () => {
    const repo = await filtered()
    repo.write('f.txt', 'one\ntwo\nthree\nfour\n')
    const service = new RepositoryService()

    const model = await readFileModel(runner, repo.path, 'f.txt')
    const hunks = (model?.unstaged ?? []) as LineHunk[]
    expect(hunks).toHaveLength(1)
    await service.writeHunks(repo.path, 'f.txt', 'stage', hunks)
    const seam = (await repo.git(['write-tree'])).trim()

    await repo.git(['read-tree', 'HEAD'])
    await repo.git(['add', '--', 'f.txt'])
    const git = (await repo.git(['write-tree'])).trim()

    expect(seam).toBe(git)
  })

  it('reverts through the smudge filter, so the file on disk reads as before', async () => {
    const repo = await filtered()
    repo.write('f.txt', 'one\ntwo\nthree\nfour\n')
    const service = new RepositoryService()

    const model = await readFileModel(runner, repo.path, 'f.txt')
    const result = await service.revert(repo.path, 'f.txt', (model?.unstaged ?? []) as LineHunk[])
    expect(result.ok).toBe(true)

    // The index form went back through the smudge filter: the file holds the
    // text Git would have checked out, not the upper case of the blob.
    expect(readFileSync(join(repo.path, 'f.txt'), 'utf8')).toBe('one\ntwo\nthree\n')
    expect(await repo.git(['diff', '--', 'f.txt'])).toBe('')
  })
})
