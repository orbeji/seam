// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest'
import { detectOperation, GitRunner } from '../src/core/git'
import { createRepository, type SampleRepository } from './fixtures/repository'

const runner = new GitRunner()
const repositories: SampleRepository[] = []

async function repository(): Promise<SampleRepository> {
  const created = await createRepository()
  repositories.push(created)
  return created
}

afterEach(() => {
  while (repositories.length > 0) {
    repositories.pop()?.cleanup()
  }
})

/** A base commit on main with one file, ready to be changed on two branches. */
async function conflictingBranches(
  repo: SampleRepository,
  base: string
): Promise<{ ours: string; theirs: string }> {
  repo.write('f.txt', `${base}\n`)
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'base'])

  await repo.git(['checkout', '-q', '-b', 'side'])
  repo.write('f.txt', `${base} theirs\n`)
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'side'])
  const theirs = (await repo.git(['rev-parse', 'HEAD'])).trim()

  await repo.git(['checkout', '-q', 'main'])
  repo.write('f.txt', `${base} ours\n`)
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'main'])
  const ours = (await repo.git(['rev-parse', 'HEAD'])).trim()

  return { ours, theirs }
}

describe('detectOperation', () => {
  it('returns null for an idle repository', async () => {
    const repo = await repository()
    repo.write('a.txt', 'one\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'base'])
    expect(await detectOperation(runner, repo.path)).toBeNull()
  })

  it('detects a stopped merge', async () => {
    const repo = await repository()
    await conflictingBranches(repo, 'base')
    await repo.gitExpectingFailure(['merge', '--no-edit', 'side'])
    expect(await detectOperation(runner, repo.path)).toBe('merge')
  })

  it('detects a stopped cherry-pick', async () => {
    const repo = await repository()
    const { theirs } = await conflictingBranches(repo, 'base')
    await repo.gitExpectingFailure(['cherry-pick', theirs])
    expect(await detectOperation(runner, repo.path)).toBe('cherry-pick')
  })

  it('detects a stopped revert', async () => {
    const repo = await repository()
    repo.write('h.txt', 'base\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'base'])

    repo.write('h.txt', 'base\nA\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'add A'])
    const addA = (await repo.git(['rev-parse', 'HEAD'])).trim()

    repo.write('h.txt', 'base\nA changed\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'change A'])

    await repo.gitExpectingFailure(['revert', '--no-edit', addA])
    expect(await detectOperation(runner, repo.path)).toBe('revert')
  })

  it('detects a stopped rebase', async () => {
    const repo = await repository()
    await conflictingBranches(repo, 'base')
    await repo.git(['checkout', '-q', 'side'])
    await repo.gitExpectingFailure(['rebase', 'main'])
    expect(await detectOperation(runner, repo.path)).toBe('rebase')
  })
})
