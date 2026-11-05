// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest'
import {
  abortOperation,
  createBranch,
  deleteBranch,
  GitRunner,
  listBranches,
  mergeBranch,
  readMergeState,
  readStatus,
  renameBranch
} from '../src/core/git'
import { createRepository, type SampleRepository } from './fixtures/repository'

const runner = new GitRunner()
const repositories: SampleRepository[] = []

async function repository(): Promise<SampleRepository> {
  const repo = await createRepository()
  repositories.push(repo)
  repo.write('file.txt', 'base\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'base'])
  return repo
}

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

describe('branch operations', () => {
  it('creates, renames and deletes a branch', async () => {
    const repo = await repository()

    await createBranch(runner, repo.path, { name: 'feature/one', checkout: true })
    expect((await readStatus(runner, repo.path)).branch.head).toBe('feature/one')

    await renameBranch(runner, repo.path, 'feature/one', 'feature/two')
    expect((await listBranches(runner, repo.path)).local.map((branch) => branch.name)).toContain(
      'feature/two'
    )

    await repo.git(['checkout', '-q', 'main'])
    await deleteBranch(runner, repo.path, 'feature/two')
    expect(
      (await listBranches(runner, repo.path)).local.map((branch) => branch.name)
    ).not.toContain('feature/two')
  })

  it('refuses a branch name Git would refuse', async () => {
    const repo = await repository()

    await expect(
      createBranch(runner, repo.path, { name: 'bad..name', checkout: true })
    ).rejects.toThrow()
    expect((await listBranches(runner, repo.path)).local.map((branch) => branch.name)).toEqual([
      'main'
    ])
  })
})

describe('mergeBranch', () => {
  it('creates a merge commit for a diverged branch', async () => {
    const repo = await repository()
    await repo.git(['checkout', '-qb', 'feature'])
    repo.write('feature.txt', 'feature\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'feature work'])
    await repo.git(['checkout', '-q', 'main'])
    repo.write('main.txt', 'main\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'main work'])

    const outcome = await mergeBranch(runner, repo.path, 'feature', 'merge-commit', 'Merge feature')

    expect(outcome.ok).toBe(true)
    expect(outcome.operation).toBeNull()
    expect((await repo.git(['log', '-1', '--format=%s'])).trim()).toBe('Merge feature')
    expect((await readStatus(runner, repo.path)).branch.head).toBe('main')
  })

  it('stops on a conflict and leaves the merge in progress', async () => {
    const repo = await repository()
    await repo.git(['checkout', '-qb', 'feature'])
    repo.write('file.txt', 'feature\n')
    await repo.git(['commit', '-qam', 'feature edit'])
    await repo.git(['checkout', '-q', 'main'])
    repo.write('file.txt', 'main\n')
    await repo.git(['commit', '-qam', 'main edit'])

    const outcome = await mergeBranch(runner, repo.path, 'feature', 'merge-commit', 'Merge feature')

    expect(outcome.ok).toBe(false)
    expect(outcome.operation).toBe('merge')
    expect(outcome.conflicts).toBe(1)
    expect((await readMergeState(runner, repo.path)).conflicts).toBe(1)

    await abortOperation(runner, repo.path)
    expect((await readStatus(runner, repo.path)).entries).toEqual([])
  })

  it('squashes a branch into staged changes without a merge commit', async () => {
    const repo = await repository()
    await repo.git(['checkout', '-qb', 'feature'])
    repo.write('feature.txt', 'feature\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'feature work'])
    await repo.git(['checkout', '-q', 'main'])

    const outcome = await mergeBranch(runner, repo.path, 'feature', 'squash')

    expect(outcome.ok).toBe(true)
    expect(outcome.operation).toBeNull()
    const status = await readStatus(runner, repo.path)
    expect(status.entries.map((entry) => [entry.path, entry.kind])).toEqual([
      ['feature.txt', 'ordinary']
    ])
    const entry = status.entries[0]
    expect(entry !== undefined && entry.kind === 'ordinary' ? entry.x : null).toBe('A')
  })
})
