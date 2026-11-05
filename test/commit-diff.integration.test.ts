// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest'
import { GitRunner, readCommitChanges, readCommitComparison } from '../src/core/git'
import { createRepository, SampleRepository } from './fixtures/repository'

/**
 * A commit's own change against a real repository: the file list with its
 * statuses, and the two versions of any one of those files.
 */

const runner = new GitRunner()
const repositories: SampleRepository[] = []

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

async function baseRepository(): Promise<SampleRepository> {
  const repo = await createRepository()
  repositories.push(repo)
  repo.write('a.txt', 'one\n')
  repo.write('b.txt', 'two\n')
  repo.write('old.txt', 'same\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Base'])
  return repo
}

describe('readCommitChanges', () => {
  it('lists the files a commit changed and leaves a root commit without a parent', async () => {
    const repo = await baseRepository()
    repo.write('a.txt', 'one changed\n')
    repo.remove('b.txt')
    repo.write('c.txt', 'new\n')
    await repo.git(['add', '-A'])
    await repo.git(['commit', '-qm', 'Change files'])
    const head = (await repo.git(['rev-parse', 'HEAD'])).trim()

    const changes = await readCommitChanges(runner, repo.path, head)
    const byPath = new Map(changes.files.map((file) => [file.path, file]))

    expect(changes.oid).toBe(head)
    expect(changes.parent).not.toBeNull()
    expect(byPath.get('a.txt')?.status).toBe('modified')
    expect(byPath.get('b.txt')?.status).toBe('deleted')
    expect(byPath.get('c.txt')?.status).toBe('added')

    const root = await readCommitChanges(runner, repo.path, `${head}~1`)
    expect(root.parent).toBeNull()
    expect(root.files.map((file) => file.status)).toEqual(['added', 'added', 'added'])
    expect(root.files.map((file) => file.path).sort()).toEqual(['a.txt', 'b.txt', 'old.txt'])
  })

  it('labels a rename and carries the path it had in the parent', async () => {
    const repo = await baseRepository()
    await repo.git(['mv', 'old.txt', 'renamed.txt'])
    await repo.git(['commit', '-qm', 'Rename'])
    const head = (await repo.git(['rev-parse', 'HEAD'])).trim()

    const changes = await readCommitChanges(runner, repo.path, head)

    expect(changes.files).toEqual([
      { path: 'renamed.txt', previousPath: 'old.txt', status: 'renamed' }
    ])
  })
})

describe('readCommitComparison', () => {
  it('reads both versions of a modified file', async () => {
    const repo = await baseRepository()
    repo.write('a.txt', 'one changed\n')
    await repo.git(['add', 'a.txt'])
    await repo.git(['commit', '-qm', 'Modify'])
    const head = (await repo.git(['rev-parse', 'HEAD'])).trim()

    const comparison = await readCommitComparison(runner, repo.path, head, 'a.txt', null)

    expect(comparison.from?.lines).toEqual(['one'])
    expect(comparison.to?.lines).toEqual(['one changed'])
    expect(comparison.fromSize).toBe(4)
    expect(comparison.toSize).toBe(12)
    expect(comparison.binary).toBe(false)
  })

  it('returns no parent side for a root commit and no commit side for a deletion', async () => {
    const repo = await baseRepository()
    repo.remove('b.txt')
    await repo.git(['add', '-A'])
    await repo.git(['commit', '-qm', 'Delete b'])
    const head = (await repo.git(['rev-parse', 'HEAD'])).trim()

    const root = await readCommitComparison(runner, repo.path, `${head}~1`, 'a.txt', null)
    expect(root.from).toBeNull()
    expect(root.to?.lines).toEqual(['one'])

    const deletion = await readCommitComparison(runner, repo.path, head, 'b.txt', null)
    expect(deletion.from?.lines).toEqual(['two'])
    expect(deletion.to).toBeNull()
  })

  it('reads a rename from its old path in the parent', async () => {
    const repo = await baseRepository()
    await repo.git(['mv', 'old.txt', 'renamed.txt'])
    await repo.git(['commit', '-qm', 'Rename'])
    const head = (await repo.git(['rev-parse', 'HEAD'])).trim()

    const comparison = await readCommitComparison(runner, repo.path, head, 'renamed.txt', 'old.txt')

    expect(comparison.from?.lines).toEqual(['same'])
    expect(comparison.to?.lines).toEqual(['same'])
  })
})
