// SPDX-License-Identifier: MIT

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acceptConflict,
  codeFromStages,
  GitRunner,
  parseResolveUndo,
  readConflictSides,
  readConflictState,
  revertConflict,
  resolveSimpleConflicts
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
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

/** A merge stopped on one file of every text conflict kind and a binary one. */
async function mergeWithEveryConflict(): Promise<SampleRepository> {
  const repo = await repository()
  repo.write('both.txt', 'base\n')
  repo.write('deleted-by-us.txt', 'base\n')
  repo.write('deleted-by-them.txt', 'base\n')
  repo.write('simple.txt', 'alpha beta gamma\n')
  repo.write('binary.dat', 'base\u0000binary\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'base'])

  await repo.git(['checkout', '-q', '-b', 'side'])
  repo.write('both.txt', 'theirs\n')
  repo.write('deleted-by-us.txt', 'theirs\n')
  repo.remove('deleted-by-them.txt')
  repo.write('added-both.txt', 'theirs\n')
  repo.write('simple.txt', 'alpha beta GAMMA\n')
  repo.write('binary.dat', 'theirs\u0000binary\n')
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-qm', 'side change'])

  await repo.git(['checkout', '-q', 'main'])
  repo.write('both.txt', 'ours\n')
  repo.remove('deleted-by-us.txt')
  repo.write('deleted-by-them.txt', 'ours\n')
  repo.write('added-both.txt', 'ours\n')
  repo.write('simple.txt', 'ALPHA beta gamma\n')
  repo.write('binary.dat', 'ours\u0000binary\n')
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-qm', 'main change'])

  await repo.gitExpectingFailure(['merge', '--no-edit', 'side'])
  return repo
}

describe('parseResolveUndo', () => {
  it('reads the path after the first tab, so a tab in a name survives', () => {
    const output = '100644 aaa 1\tdir/a\tb.txt\0' + '100644 bbb 2\tdir/a\tb.txt\0'
    const parsed = parseResolveUndo(output)
    expect(parsed.get('dir/a\tb.txt')?.map((entry) => entry.stage)).toEqual([1, 2])
  })

  it('rejects a record without a tab', () => {
    expect(() => parseResolveUndo('100644 aaa 1')).toThrow()
  })
})

describe('codeFromStages', () => {
  it.each([
    [[1, 2, 3], 'UU'],
    [[2, 3], 'AA'],
    [[1, 2], 'UD'],
    [[1, 3], 'DU'],
    [[1], 'DD'],
    [[2], 'AU'],
    [[3], 'UA']
  ] as const)('maps %j to %s', (stages, code) => {
    expect(codeFromStages(stages)).toBe(code)
  })
})

describe('readConflictState', () => {
  it('lists every unresolved kind, binary files and the names of the sides', async () => {
    const repo = await mergeWithEveryConflict()
    const state = await readConflictState(runner, repo.path)

    expect(state.sides).toEqual({
      operation: 'merge',
      yoursLabel: 'main',
      theirsLabel: 'side',
      yours: 'ours',
      theirs: 'theirs'
    })

    const byPath = new Map(state.entries.map((entry) => [entry.path, entry]))
    expect(byPath.get('both.txt')?.code).toBe('UU')
    expect(byPath.get('deleted-by-us.txt')?.code).toBe('DU')
    expect(byPath.get('deleted-by-them.txt')?.code).toBe('UD')
    expect(byPath.get('added-both.txt')?.code).toBe('AA')
    expect(byPath.get('binary.dat')?.binary).toBe(true)
    expect(byPath.get('both.txt')?.binary).toBe(false)
    expect(state.entries.every((entry) => !entry.resolved)).toBe(true)
  })

  it('lists resolved files from the resolve-undo data after a fresh reader starts', async () => {
    const repo = await mergeWithEveryConflict()
    const before = await readConflictState(runner, repo.path)
    const both = before.entries.find((entry) => entry.path === 'both.txt')
    expect(both).toBeDefined()
    await acceptConflict(runner, repo.path, 'both.txt', 'yours', both?.fingerprint ?? null)

    const restarted = new GitRunner()
    const after = await readConflictState(restarted, repo.path)
    const resolved = after.entries.find((entry) => entry.path === 'both.txt')
    expect(resolved?.resolved).toBe(true)
    expect(resolved?.code).toBe('UU')
  })
})

describe('acceptConflict', () => {
  it('takes the checked-out version and clears the unmerged entry', async () => {
    const repo = await mergeWithEveryConflict()
    const state = await readConflictState(runner, repo.path)
    const entry = state.entries.find((candidate) => candidate.path === 'both.txt')

    await acceptConflict(runner, repo.path, 'both.txt', 'yours', entry?.fingerprint ?? null)

    expect(repo.read('both.txt')).toBe('ours\n')
    const status = await readConflictState(runner, repo.path)
    expect(status.entries.find((candidate) => candidate.path === 'both.txt')?.resolved).toBe(true)
  })

  it('takes the incoming version', async () => {
    const repo = await mergeWithEveryConflict()
    const state = await readConflictState(runner, repo.path)
    const entry = state.entries.find((candidate) => candidate.path === 'both.txt')

    await acceptConflict(runner, repo.path, 'both.txt', 'theirs', entry?.fingerprint ?? null)

    expect(repo.read('both.txt')).toBe('theirs\n')
  })

  it('keeps the side that still has the file in a deletion conflict', async () => {
    const repo = await mergeWithEveryConflict()
    const state = await readConflictState(runner, repo.path)
    const entry = state.entries.find((candidate) => candidate.path === 'deleted-by-us.txt')

    await acceptConflict(
      runner,
      repo.path,
      'deleted-by-us.txt',
      'theirs',
      entry?.fingerprint ?? null
    )

    expect(repo.read('deleted-by-us.txt')).toBe('theirs\n')
  })

  it('deletes the file when the chosen side deleted it', async () => {
    const repo = await mergeWithEveryConflict()
    const state = await readConflictState(runner, repo.path)
    const entry = state.entries.find((candidate) => candidate.path === 'deleted-by-them.txt')

    await acceptConflict(
      runner,
      repo.path,
      'deleted-by-them.txt',
      'theirs',
      entry?.fingerprint ?? null
    )

    expect(() => repo.read('deleted-by-them.txt')).toThrow()
  })

  it('asks before overwriting a working copy that changed since it was read', async () => {
    const repo = await mergeWithEveryConflict()
    const state = await readConflictState(runner, repo.path)
    const entry = state.entries.find((candidate) => candidate.path === 'both.txt')

    writeFileSync(join(repo.path, 'both.txt'), 'edited after the dialog opened\n')
    const refusal = await acceptConflict(
      runner,
      repo.path,
      'both.txt',
      'yours',
      entry?.fingerprint ?? null
    )
    expect(refusal.needsConfirmation).toBe(true)
    expect(repo.read('both.txt')).toBe('edited after the dialog opened\n')

    const confirmed = await acceptConflict(
      runner,
      repo.path,
      'both.txt',
      'yours',
      entry?.fingerprint ?? null,
      true
    )
    expect(confirmed.needsConfirmation).toBe(false)
    expect(repo.read('both.txt')).toBe('ours\n')
  })
})

describe('deletion conflicts from a rename', () => {
  async function renameConflict(): Promise<SampleRepository> {
    const repo = await repository()
    repo.write('f.txt', 'base\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'base'])
    await repo.git(['checkout', '-q', '-b', 'side'])
    await repo.git(['mv', 'f.txt', 'a.txt'])
    await repo.git(['commit', '-qam', 'side rename'])
    await repo.git(['checkout', '-q', 'main'])
    await repo.git(['mv', 'f.txt', 'b.txt'])
    await repo.git(['commit', '-qam', 'main rename'])
    await repo.gitExpectingFailure(['merge', '--no-edit', 'side'])
    return repo
  }

  it('offers AU, UA and DD and resolves them from the existing stages', async () => {
    const repo = await renameConflict()
    const state = await readConflictState(runner, repo.path)
    const codes = new Map(state.entries.map((entry) => [entry.path, entry.code]))
    expect(codes.get('a.txt')).toBe('UA')
    expect(codes.get('b.txt')).toBe('AU')
    expect(codes.get('f.txt')).toBe('DD')

    const fingerprint = (path: string): string | null =>
      state.entries.find((entry) => entry.path === path)?.fingerprint ?? null
    await acceptConflict(runner, repo.path, 'a.txt', 'theirs', fingerprint('a.txt'))
    await acceptConflict(runner, repo.path, 'b.txt', 'yours', fingerprint('b.txt'))
    await acceptConflict(runner, repo.path, 'f.txt', 'yours', fingerprint('f.txt'))

    expect(repo.read('a.txt')).toBe('base\n')
    expect(repo.read('b.txt')).toBe('base\n')
    const after = await readConflictState(runner, repo.path)
    expect(after.entries.filter((entry) => !entry.resolved)).toEqual([])
  })
})

describe('resolveSimpleConflicts', () => {
  it('resolves the word-level conflict and leaves the overlapping and binary ones', async () => {
    const repo = await mergeWithEveryConflict()
    const outcome = await resolveSimpleConflicts(runner, repo.path)

    expect(outcome).toEqual({ resolved: 1, remaining: 5 })
    expect(repo.read('simple.txt')).toBe('ALPHA beta GAMMA\n')
    const state = await readConflictState(runner, repo.path)
    expect(state.entries.find((entry) => entry.path === 'simple.txt')?.resolved).toBe(true)
    expect(state.entries.find((entry) => entry.path === 'both.txt')?.resolved).toBe(false)
  })
})

describe('revertConflict', () => {
  it('brings back a text conflict with its markers', async () => {
    const repo = await mergeWithEveryConflict()
    const state = await readConflictState(runner, repo.path)
    const entry = state.entries.find((candidate) => candidate.path === 'both.txt')
    await acceptConflict(runner, repo.path, 'both.txt', 'yours', entry?.fingerprint ?? null)

    await revertConflict(runner, repo.path, 'both.txt')

    expect(repo.read('both.txt')).toContain('<<<<<<<')
    const after = await readConflictState(runner, repo.path)
    const again = after.entries.find((candidate) => candidate.path === 'both.txt')
    expect(again?.resolved).toBe(false)
    expect(again?.code).toBe('UU')
  })

  it('brings back a deletion conflict by writing the recorded stages', async () => {
    const repo = await mergeWithEveryConflict()
    const state = await readConflictState(runner, repo.path)
    const entry = state.entries.find((candidate) => candidate.path === 'deleted-by-them.txt')
    await acceptConflict(
      runner,
      repo.path,
      'deleted-by-them.txt',
      'theirs',
      entry?.fingerprint ?? null
    )

    await revertConflict(runner, repo.path, 'deleted-by-them.txt')

    expect(repo.read('deleted-by-them.txt')).toContain('<<<<<<<')
    const after = await readConflictState(runner, repo.path)
    const again = after.entries.find((candidate) => candidate.path === 'deleted-by-them.txt')
    expect(again?.resolved).toBe(false)
    expect(again?.code).toBe('UD')
  })

  it('restores the index after a restart', async () => {
    const repo = await mergeWithEveryConflict()
    const state = await readConflictState(runner, repo.path)
    const entry = state.entries.find((candidate) => candidate.path === 'deleted-by-us.txt')
    await acceptConflict(
      runner,
      repo.path,
      'deleted-by-us.txt',
      'theirs',
      entry?.fingerprint ?? null
    )

    const restarted = new GitRunner()
    const after = await readConflictState(restarted, repo.path)
    expect(
      after.entries.find((candidate) => candidate.path === 'deleted-by-us.txt')?.resolved
    ).toBe(true)

    await revertConflict(restarted, repo.path, 'deleted-by-us.txt')
    const reverted = await readConflictState(restarted, repo.path)
    const again = reverted.entries.find((candidate) => candidate.path === 'deleted-by-us.txt')
    expect(again?.resolved).toBe(false)
    expect(again?.code).toBe('DU')
  })
})

describe('readConflictSides', () => {
  it('maps Yours to your commit during a rebase', async () => {
    const repo = await repository()
    repo.write('f.txt', 'base\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'base'])
    await repo.git(['checkout', '-q', '-b', 'side'])
    repo.write('f.txt', 'side\n')
    await repo.git(['commit', '-qam', 'side change'])
    await repo.git(['checkout', '-q', 'main'])
    repo.write('f.txt', 'main\n')
    await repo.git(['commit', '-qam', 'main change'])
    await repo.git(['checkout', '-q', 'side'])
    await repo.gitExpectingFailure(['rebase', 'main'])

    const sides = await readConflictSides(runner, repo.path, 'rebase')
    expect(sides.operation).toBe('rebase')
    expect(sides.yours).toBe('theirs')
    expect(sides.theirs).toBe('ours')
    expect(sides.yoursLabel).toContain('side change')
    expect(sides.theirsLabel).toBe('main')
  })

  it('names the cherry-picked commit on Theirs', async () => {
    const repo = await repository()
    repo.write('f.txt', 'base\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'base'])
    await repo.git(['checkout', '-q', '-b', 'side'])
    repo.write('f.txt', 'side\n')
    await repo.git(['commit', '-qam', 'side change'])
    const side = (await repo.git(['rev-parse', 'HEAD'])).trim()
    await repo.git(['checkout', '-q', 'main'])
    repo.write('f.txt', 'main\n')
    await repo.git(['commit', '-qam', 'main change'])
    await repo.gitExpectingFailure(['cherry-pick', side])

    const sides = await readConflictSides(runner, repo.path, 'cherry-pick')
    expect(sides.yoursLabel).toBe('main')
    expect(sides.theirsLabel).toContain('side change')
    expect(sides.yours).toBe('ours')
  })

  it('names the stash when a pop leaves conflicts', async () => {
    const repo = await repository()
    repo.write('f.txt', 'base\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'base'])
    repo.write('f.txt', 'stashed\n')
    await repo.git(['stash', 'push', '-m', 'stash'])
    repo.write('f.txt', 'current\n')
    await repo.git(['commit', '-qam', 'current'])
    await repo.gitExpectingFailure(['stash', 'pop'])

    const sides = await readConflictSides(runner, repo.path, null)
    expect(sides.operation).toBeNull()
    expect(sides.theirsLabel).toBe('stash')
    expect(sides.yoursLabel).toBe('main')
  })
})
