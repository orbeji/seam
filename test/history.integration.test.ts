// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest'
import { GitRunner, checkoutCommit, readRepositoryHistory } from '../src/core/git'
import { createRepository, SampleRepository } from './fixtures/repository'

/**
 * The history view against a real repository: the log's parents, authors,
 * dates and the tags and branches each commit carries.
 */

const runner = new GitRunner()
const repositories: SampleRepository[] = []

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

describe('readRepositoryHistory', () => {
  it('reads the commits, the merge parents and the refs pointing at them', async () => {
    const repo = await createRepository()
    repositories.push(repo)

    repo.write('a.txt', 'a\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'Base'])
    await repo.git(['tag', 'v1'])

    await repo.git(['checkout', '-qb', 'feature'])
    repo.write('b.txt', 'b\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'Feature work'])
    await repo.git(['tag', '-a', 'v2', '-m', 'second'])

    await repo.git(['checkout', '-q', 'main'])
    repo.write('c.txt', 'c\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'Main work'])
    await repo.git(['merge', '--no-ff', '-qm', 'Merge feature', 'feature'])

    const headOid = (await repo.git(['rev-parse', 'HEAD'])).trim()
    const history = await readRepositoryHistory(runner, repo.path)
    const subjects = history.commits.map((commit) => commit.subject)

    expect(history.head).toBe('main')
    expect(history.headOid).toBe(headOid)
    expect(history.truncated).toBe(false)
    expect(subjects).toEqual(
      expect.arrayContaining(['Merge feature', 'Main work', 'Feature work', 'Base'])
    )

    const merge = history.commits.find((commit) => commit.subject === 'Merge feature')
    expect(merge?.parents).toHaveLength(2)
    expect(merge?.authorName).toBe('Seam')
    expect(merge?.authorDate).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(merge?.refs).toContainEqual({ name: 'main', kind: 'head' })

    const feature = history.commits.find((commit) => commit.subject === 'Feature work')
    expect(feature?.refs).toContainEqual({ name: 'feature', kind: 'branch' })
    expect(feature?.refs).toContainEqual({ name: 'v2', kind: 'tag' })

    const base = history.commits.find((commit) => commit.subject === 'Base')
    expect(base?.parents).toEqual([])
    expect(base?.refs).toContainEqual({ name: 'v1', kind: 'tag' })
  })

  it('folds an in-sync remote branch into the local one', async () => {
    const repo = await createRepository()
    repositories.push(repo)

    repo.write('a.txt', 'a\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'Base'])
    await repo.git(['update-ref', 'refs/remotes/origin/main', 'HEAD'])
    await repo.git(['update-ref', 'refs/remotes/origin/other', 'HEAD'])

    const history = await readRepositoryHistory(runner, repo.path)

    expect(history.commits[0]?.refs).toEqual([
      { name: 'main', kind: 'head', remotes: ['origin/main'] },
      { name: 'origin/other', kind: 'remote' }
    ])
  })

  it('returns an empty history for a repository without commits', async () => {
    const repo = await createRepository()
    repositories.push(repo)

    await expect(readRepositoryHistory(runner, repo.path)).resolves.toEqual({
      commits: [],
      truncated: false,
      head: 'main',
      headOid: null
    })
  })
})

describe('checkoutCommit', () => {
  it('detaches HEAD at an older commit and leaves the branch where it was', async () => {
    const repo = await createRepository()
    repositories.push(repo)

    repo.write('a.txt', 'first\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'First'])
    const first = (await repo.git(['rev-parse', 'HEAD'])).trim()

    repo.write('b.txt', 'second\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'Second'])
    const second = (await repo.git(['rev-parse', 'HEAD'])).trim()

    await checkoutCommit(runner, repo.path, first)

    await expect(repo.git(['rev-parse', 'HEAD'])).resolves.toBe(`${first}\n`)
    await expect(repo.git(['rev-parse', 'main'])).resolves.toBe(`${second}\n`)
    // A detached HEAD is not a branch, which is what the warning promises.
    expect((await repo.run(['symbolic-ref', '--quiet', '--short', 'HEAD'])).code).not.toBe(0)
    expect(repo.read('a.txt')).toBe('first\n')
    expect(() => repo.read('b.txt')).toThrow()
  })
})
