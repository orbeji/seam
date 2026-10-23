// SPDX-License-Identifier: MIT

import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitRunner, stagePaths, unstagePaths } from '../src/core/git'
import { createRepository, type SampleRepository } from './fixtures/repository'

const runner = new GitRunner()
const repositories: SampleRepository[] = []

// The scale test stages 5 000 files, which takes longer than the runner's 30 s
// default on a Windows runner: `git add` and `git status` both walk the whole
// working tree there. The default stays as it is, because the interface relies
// on it to fail a command that is truly stuck, and the scale test asks for the
// headroom it needs instead. One command may use SCALE_TIMEOUT_MS, and the test
// as a whole (several such commands plus the fixture) gets the larger budget.
const SCALE_TIMEOUT_MS = 120_000
const SCALE_TEST_TIMEOUT_MS = 300_000
const scaleRunner = new GitRunner({ timeoutMs: SCALE_TIMEOUT_MS })

async function repository(timeoutMs?: number): Promise<SampleRepository> {
  const repo = await createRepository(timeoutMs === undefined ? {} : { timeoutMs })
  repositories.push(repo)
  return repo
}

/** A repository with one committed file, so unstaging has a HEAD to compare. */
async function committed(timeoutMs?: number): Promise<SampleRepository> {
  const repo = await repository(timeoutMs)
  repo.write('tracked.txt', 'base\n')
  await repo.git(['add', 'tracked.txt'])
  await repo.git(['commit', '-qm', 'base'])
  return repo
}

/** Status with every untracked file spelled out, not collapsed to a folder. */
async function porcelain(repo: SampleRepository): Promise<string[]> {
  const output = await repo.git(['status', '--porcelain', '--untracked-files=all'])
  return output.split('\n').filter((line) => line !== '')
}

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

describe('staging one file', () => {
  it('stages and unstages a modification', async () => {
    const repo = await committed()
    repo.write('tracked.txt', 'changed\n')

    await stagePaths(runner, repo.path, ['tracked.txt'])
    expect(await porcelain(repo)).toEqual(['M  tracked.txt'])

    await unstagePaths(runner, repo.path, ['tracked.txt'])
    expect(await porcelain(repo)).toEqual([' M tracked.txt'])
  })

  it('stages a new file and a deletion together', async () => {
    const repo = await committed()
    repo.write('fresh.txt', 'new\n')
    repo.remove('tracked.txt')

    await stagePaths(runner, repo.path, ['fresh.txt', 'tracked.txt'])

    const status = await porcelain(repo)
    expect(status).toContain('A  fresh.txt')
    expect(status).toContain('D  tracked.txt')
  })

  it('does nothing for an empty list', async () => {
    const repo = await committed()
    repo.write('tracked.txt', 'changed\n')

    await stagePaths(runner, repo.path, [])
    await unstagePaths(runner, repo.path, [])

    expect(await porcelain(repo)).toEqual([' M tracked.txt'])
  })
})

describe('staging paths Git would otherwise read as pathspecs', () => {
  it('stages names with spaces, accents and a leading colon', async () => {
    const repo = await repository()
    const names = ['a space.txt', 'café.txt']
    // A colon is not allowed in a Windows file name; the flag still guards it.
    if (process.platform !== 'win32') names.push(':colon.txt')

    for (const name of names) repo.write(name, `${name}\n`)
    await stagePaths(runner, repo.path, names)

    const staged = (await repo.git(['ls-files', '-z', '--cached']))
      .split('\0')
      .filter((name) => name !== '')
    expect(staged.sort()).toEqual([...names].sort())
  })
})

describe('staging a rename', () => {
  it('records a rename when both paths are staged in one write', async () => {
    const repo = await committed()
    repo.write('renamed.txt', 'base\n')
    repo.remove('tracked.txt')

    await stagePaths(runner, repo.path, ['tracked.txt', 'renamed.txt'])

    const names = await repo.git(['diff', '--cached', '--name-status'])
    expect(names.trim()).toBe('R100\ttracked.txt\trenamed.txt')
  })
})

describe('staging a section', () => {
  // The point of the phase: a section action puts every path on stdin, so this
  // many paths never has to fit in a command line, which Windows caps sharply.
  it(
    'stages and unstages five thousand files in one write',
    async () => {
      // A commit must exist: `git restore --staged` resolves the index against
      // HEAD. The no-commit case takes a different command and has its own tests.
      const repo = await committed(SCALE_TIMEOUT_MS)
      mkdirSync(join(repo.path, 'bulk'))

      const paths: string[] = []
      for (let index = 0; index < 5000; index += 1) {
        const name = `bulk/f${index}.txt`
        paths.push(name)
        repo.write(name, `${index}\n`)
      }

      await stagePaths(scaleRunner, repo.path, paths)
      const staged = await porcelain(repo)
      expect(staged).toHaveLength(5000)
      expect(staged.every((line) => line.startsWith('A  '))).toBe(true)

      await unstagePaths(scaleRunner, repo.path, paths)
      const unstaged = await porcelain(repo)
      expect(unstaged).toHaveLength(5000)
      expect(unstaged.every((line) => line.startsWith('?? '))).toBe(true)
    },
    SCALE_TEST_TIMEOUT_MS
  )
})

describe('unstaging in a repository without commits', () => {
  it('stages and unstages a file in a freshly created repository', async () => {
    const repo = await repository()
    repo.write('new.txt', 'content\n')

    await stagePaths(runner, repo.path, ['new.txt'])
    expect(await porcelain(repo)).toEqual(['A  new.txt'])

    await unstagePaths(runner, repo.path, ['new.txt'])
    expect(await porcelain(repo)).toEqual(['?? new.txt'])
  })

  it('keeps the working copy when it differs from the staged content', async () => {
    const repo = await repository()
    repo.write('new.txt', 'staged\n')
    await stagePaths(runner, repo.path, ['new.txt'])
    repo.write('new.txt', 'changed after staging\n')

    await unstagePaths(runner, repo.path, ['new.txt'])

    expect(await porcelain(repo)).toEqual(['?? new.txt'])
    expect(readFileSync(join(repo.path, 'new.txt'), 'utf8')).toBe('changed after staging\n')
  })

  it('unstages a whole section in a repository without commits', async () => {
    const repo = await repository()
    const paths = ['one.txt', 'two.txt', 'three.txt']
    for (const path of paths) repo.write(path, `${path}\n`)

    await stagePaths(runner, repo.path, paths)
    expect(await porcelain(repo)).toHaveLength(3)

    await unstagePaths(runner, repo.path, paths)

    const status = await porcelain(repo)
    expect(status).toHaveLength(3)
    for (const path of paths) expect(status).toContain(`?? ${path}`)
  })
})
