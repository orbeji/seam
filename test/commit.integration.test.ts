// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest'
import { createCommit, GitRunner } from '../src/core/git'
import { createRepository, type SampleRepository } from './fixtures/repository'

/**
 * The commit command: the message travels over stdin, so Unicode and several
 * lines reach Git untouched, and the resulting commit is byte-for-byte the one
 * a terminal would make with the same options.
 */

const MESSAGE = 'Añadir café ☕\n\nCon detalles.'

/** A fixed identity and date, so two commits can be compared by their id. */
const FIXED_ENV = {
  GIT_AUTHOR_NAME: 'Seam',
  GIT_AUTHOR_EMAIL: 'seam@example.com',
  GIT_COMMITTER_NAME: 'Seam',
  GIT_COMMITTER_EMAIL: 'seam@example.com',
  GIT_AUTHOR_DATE: '2001-02-03T04:05:06 +0000',
  GIT_COMMITTER_DATE: '2001-02-03T04:05:06 +0000'
}

const repositories: SampleRepository[] = []

async function repository(): Promise<SampleRepository> {
  const created = await createRepository()
  repositories.push(created)
  return created
}

/** Pins the identity in the repository, away from the machine's Git config. */
async function identity(repo: SampleRepository): Promise<void> {
  await repo.git(['config', 'user.name', 'Seam'])
  await repo.git(['config', 'user.email', 'seam@example.com'])
  await repo.git(['config', 'commit.gpgsign', 'false'])
}

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

describe('createCommit', () => {
  it('commits the index with the message, Unicode included', async () => {
    const repo = await repository()
    await identity(repo)
    repo.write('f.txt', 'one\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'base'])

    repo.write('f.txt', 'one\ntwo\n')
    await repo.git(['add', '.'])

    await createCommit(new GitRunner(), repo.path, MESSAGE)

    // `%B` prints the stored body and adds a newline of its own.
    const body = (await repo.git(['log', '-1', '--format=%B'])).replace(/\n$/, '')
    expect(body).toBe(`${MESSAGE}\n`)
    expect(await repo.git(['show', '--name-only', '--format=', 'HEAD'])).toBe('f.txt\n')
    expect(await repo.git(['status', '--porcelain'])).toBe('')
  })

  it('fails on an empty message instead of committing', async () => {
    const repo = await repository()
    await identity(repo)
    repo.write('f.txt', 'one\n')
    await repo.git(['add', '.'])

    await expect(createCommit(new GitRunner(), repo.path, '')).rejects.toThrow()
    expect((await repo.run(['rev-parse', '--verify', 'HEAD'])).code).not.toBe(0)
  })

  it('fails when there is nothing to commit', async () => {
    const repo = await repository()
    await identity(repo)
    repo.write('f.txt', 'one\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'base'])

    await expect(createCommit(new GitRunner(), repo.path, 'again')).rejects.toThrow()
  })

  it('builds the same commit as the terminal with the same options', async () => {
    const runner = new GitRunner({ env: FIXED_ENV })
    const seam = await repository()
    const terminal = await repository()

    for (const repo of [seam, terminal]) {
      await identity(repo)
      repo.write('f.txt', 'one\n')
      await runner.runOrThrow(['add', 'f.txt'], { cwd: repo.path })
      await runner.runOrThrow(['commit', '-m', 'base'], { cwd: repo.path })
      repo.write('f.txt', 'one\ntwo\n')
      await runner.runOrThrow(['add', 'f.txt'], { cwd: repo.path })
    }

    await createCommit(runner, seam.path, MESSAGE)
    await runner.runOrThrow(['commit', '-F', '-'], { cwd: terminal.path, stdin: MESSAGE })

    const head = async (repo: SampleRepository): Promise<string> =>
      (await runner.runOrThrow(['rev-parse', 'HEAD'], { cwd: repo.path })).stdout.toString('utf8')
    expect(await head(seam)).toBe(await head(terminal))
  })
})
