// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest'
import {
  GitRunner,
  isAtLeast,
  MINIMUM_GIT_VERSION,
  readStatus,
  type OrdinaryEntry,
  type RenamedEntry,
  type UnmergedEntry
} from '../src/core/git'
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

describe('the installed Git', () => {
  it('is at least the version the spec requires', async () => {
    const repo = await repository()
    const version = await runner.ensureVersion(repo.path)
    expect(isAtLeast(version, MINIMUM_GIT_VERSION)).toBe(true)
  })
})

describe('readStatus against real repositories', () => {
  it('reports a clean repository with its branch and no entries', async () => {
    const repo = await repository()
    repo.write('a.txt', 'one\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'base'])

    const status = await readStatus(runner, repo.path)
    expect(status.entries).toEqual([])
    expect(status.branch.head).toBe('main')
    expect(status.branch.oid).toMatch(/^[0-9a-f]{40}$/)
  })

  it('separates staged, unstaged, renamed and untracked changes', async () => {
    const repo = await repository()
    repo.write('a.txt', 'one\ntwo\n')
    repo.write('b.txt', 'bee\n')
    repo.write('c.txt', 'see\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'base'])

    repo.write('a.txt', 'one\ntwo changed\n') // unstaged edit
    repo.write('d.txt', 'new\n')
    await repo.git(['add', 'd.txt']) // staged addition
    await repo.git(['rm', '-q', 'b.txt']) // staged deletion
    await repo.git(['mv', 'c.txt', 'c2.txt']) // staged rename
    repo.write('e with space.txt', 'untracked\n')

    const status = await readStatus(runner, repo.path)
    const byPath = new Map(status.entries.map((entry) => [entry.path, entry]))

    const edited = byPath.get('a.txt') as OrdinaryEntry
    expect([edited.x, edited.y]).toEqual(['.', 'M'])
    const deleted = byPath.get('b.txt') as OrdinaryEntry
    expect([deleted.x, deleted.y]).toEqual(['D', '.'])
    const added = byPath.get('d.txt') as OrdinaryEntry
    expect([added.x, added.y]).toEqual(['A', '.'])

    const rename = byPath.get('c2.txt') as RenamedEntry
    expect(rename.kind).toBe('renamed')
    expect(rename.origPath).toBe('c.txt')

    expect(byPath.get('e with space.txt')?.kind).toBe('untracked')
  })

  it('reports the conflict code of each unmerged file of a merge', async () => {
    const repo = await repository()
    repo.write('both.txt', 'base\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'base'])

    await repo.git(['checkout', '-q', '-b', 'feature'])
    repo.write('both.txt', 'theirs\n')
    repo.write('addboth.txt', 'added by them\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'feature'])

    await repo.git(['checkout', '-q', 'main'])
    repo.write('both.txt', 'ours\n')
    repo.write('addboth.txt', 'added by us\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'main'])

    await repo.gitExpectingFailure(['merge', 'feature'])

    const status = await readStatus(runner, repo.path)
    const conflicts = status.entries.filter(
      (entry): entry is UnmergedEntry => entry.kind === 'unmerged'
    )
    expect(conflicts.map((entry) => [entry.path, entry.xy]).sort()).toEqual([
      ['addboth.txt', 'AA'],
      ['both.txt', 'UU']
    ])
    expect(status.branch.head).toBe('main')
  })
})
