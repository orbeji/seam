// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCommit, findCrlfProblems, fixCrlf, GitRunner } from '../src/core/git'
import { createRepository, type SampleRepository } from './fixtures/repository'

/**
 * The CRLF warning: `git ls-files --eol` says what the index holds, and the
 * only file worth asking about is one that would commit CRLF with no attribute
 * deciding it. The phase's three cases live here: a file without attributes,
 * one with `* text=auto` in `.gitattributes` and one already normalized.
 */

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

/** The `i/` column of a path, which is the format the next commit would store. */
async function indexEol(repo: SampleRepository, path: string): Promise<string> {
  const listing = await repo.git(['ls-files', '--eol', '--', path])
  return /i\/(\S+)/.exec(listing)?.[1] ?? ''
}

/** The value `core.autocrlf` takes when Seam fixes a repository's endings. */
const FIXTURE_AUTOCRLF = process.platform === 'win32' ? 'true' : 'input'

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

describe('findCrlfProblems', () => {
  it('reports a file without attributes that would commit CRLF', async () => {
    const repo = await repository()
    repo.write('plain.txt', 'one\r\ntwo\r\n')
    await repo.git(['add', 'plain.txt'])

    expect(await findCrlfProblems(new GitRunner(), repo.path)).toEqual(['plain.txt'])
  })

  it('leaves out a file with `* text=auto` in .gitattributes', async () => {
    const repo = await repository()
    repo.write('.gitattributes', '* text=auto\n')
    repo.write('protected.txt', 'one\r\ntwo\r\n')
    await repo.git(['add', '.'])

    // The attribute normalizes the file as it is prepared, so the index
    // already holds LF and there is nothing to ask about.
    expect(await indexEol(repo, 'protected.txt')).toBe('lf')
    expect(await findCrlfProblems(new GitRunner(), repo.path)).toEqual([])
  })

  it('leaves out a file that was already normalized', async () => {
    const repo = await repository()
    repo.write('normal.txt', 'one\ntwo\n')
    await repo.git(['add', 'normal.txt'])

    expect(await findCrlfProblems(new GitRunner(), repo.path)).toEqual([])
  })

  it('reports mixed endings as well', async () => {
    const repo = await repository()
    repo.write('mixed.txt', 'one\r\ntwo\n')
    await repo.git(['add', 'mixed.txt'])

    expect(await findCrlfProblems(new GitRunner(), repo.path)).toEqual(['mixed.txt'])
  })

  it('leaves out a file whose attributes decide how it is stored', async () => {
    const repo = await repository()
    repo.write('.gitattributes', 'plain.txt -text\n')
    repo.write('plain.txt', 'one\r\n')
    await repo.git(['add', '.'])

    // The file keeps CRLF, which is what its attributes ask for.
    expect(await indexEol(repo, 'plain.txt')).toBe('crlf')
    expect(await findCrlfProblems(new GitRunner(), repo.path)).toEqual([])
  })

  it('says nothing when nothing is staged', async () => {
    const repo = await repository()
    repo.write('plain.txt', 'one\r\n')

    expect(await findCrlfProblems(new GitRunner(), repo.path)).toEqual([])
  })
})

describe('fixCrlf', () => {
  it('normalizes the index and keeps the setting in the repository alone', async () => {
    const repo = await repository()
    repo.write('plain.txt', 'one\r\ntwo\r\n')
    repo.write('other.txt', 'three\r\n')
    await repo.git(['add', '.'])
    const problems = await findCrlfProblems(new GitRunner(), repo.path)
    expect(problems).toHaveLength(2)

    expect(await fixCrlf(new GitRunner(), repo.path, problems)).toEqual([])
    expect(await indexEol(repo, 'plain.txt')).toBe('lf')
    expect(await indexEol(repo, 'other.txt')).toBe('lf')
    expect((await repo.git(['config', '--get', 'core.autocrlf'])).trim()).toBe(FIXTURE_AUTOCRLF)
    // The working copies keep their endings: the fix is about the index.
    expect(readFileSync(join(repo.path, 'plain.txt'), 'utf8')).toBe('one\r\ntwo\r\n')
  })
})

describe('createCommit with the CRLF check', () => {
  it('warns instead of committing when a file would commit CRLF', async () => {
    const repo = await repository()
    await identity(repo)
    repo.write('plain.txt', 'one\r\n')
    await repo.git(['add', 'plain.txt'])

    const outcome = await createCommit(new GitRunner(), repo.path, 'warned', { checkCrlf: true })

    expect(outcome.created).toBe(false)
    expect(outcome.crlf).toEqual(['plain.txt'])
    // The warning is Seam's own question, not something Git printed.
    expect(outcome.output).toBe('')
    await repo.gitExpectingFailure(['log', '-1'])
  })

  it('commits as they are when the check is not asked for', async () => {
    const repo = await repository()
    await identity(repo)
    repo.write('plain.txt', 'one\r\n')
    await repo.git(['add', 'plain.txt'])

    const outcome = await createCommit(new GitRunner(), repo.path, 'as is')

    expect(outcome.created).toBe(true)
    expect(await indexEol(repo, 'plain.txt')).toBe('crlf')
  })

  it('fixes the endings and commits when asked to', async () => {
    const repo = await repository()
    await identity(repo)
    repo.write('plain.txt', 'one\r\n')
    await repo.git(['add', 'plain.txt'])

    const outcome = await createCommit(new GitRunner(), repo.path, 'fixed', { fixCrlf: true })

    expect(outcome.created).toBe(true)
    expect(outcome.crlf).toEqual([])
    expect(await indexEol(repo, 'plain.txt')).toBe('lf')
    expect((await repo.git(['log', '-1', '--format=%s'])).trim()).toBe('fixed')
  })

  it('commits a clean index without saying anything', async () => {
    const repo = await repository()
    await identity(repo)
    repo.write('plain.txt', 'one\n')
    await repo.git(['add', 'plain.txt'])

    const outcome = await createCommit(new GitRunner(), repo.path, 'clean', { checkCrlf: true })

    expect(outcome.created).toBe(true)
    expect(outcome.crlf).toEqual([])
  })
})
