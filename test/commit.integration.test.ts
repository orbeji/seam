// SPDX-License-Identifier: MIT

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { commitFailure, createCommit, GitRunner, readHeadCommit } from '../src/core/git'
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

/** Writes an executable hook into the repository, as a user would by hand. */
function writeHook(repo: SampleRepository, name: string, body: string): void {
  writeFileSync(join(repo.path, '.git', 'hooks', name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
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

  it('reports a refusal instead of committing when the message is empty', async () => {
    const repo = await repository()
    await identity(repo)
    repo.write('f.txt', 'one\n')
    await repo.git(['add', '.'])

    const outcome = await createCommit(new GitRunner(), repo.path, '')

    expect(outcome.created).toBe(false)
    expect(outcome.message).toContain('empty commit message')
    expect((await repo.run(['rev-parse', '--verify', 'HEAD'])).code).not.toBe(0)
  })

  it('recognises a commit with nothing staged', async () => {
    const repo = await repository()
    await identity(repo)
    repo.write('f.txt', 'one\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'base'])

    const outcome = await createCommit(new GitRunner(), repo.path, 'again')

    expect(outcome.created).toBe(false)
    expect(outcome.reason).toBe('nothing-staged')
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

    const author = 'Ada Lovelace <ada@example.com>'
    await createCommit(runner, seam.path, MESSAGE, { author, signoff: true })
    await runner.runOrThrow(['commit', '-F', '-', `--author=${author}`, '--signoff'], {
      cwd: terminal.path,
      stdin: MESSAGE
    })

    const head = async (repo: SampleRepository): Promise<string> =>
      (await runner.runOrThrow(['rev-parse', 'HEAD'], { cwd: repo.path })).stdout.toString('utf8')
    expect(await head(seam)).toBe(await head(terminal))
  })

  it('signs as another author and adds the sign-off trailer', async () => {
    const repo = await repository()
    await identity(repo)
    repo.write('f.txt', 'one\n')
    await repo.git(['add', '.'])

    await createCommit(new GitRunner(), repo.path, 'base', {
      author: 'Ada Lovelace <ada@example.com>',
      signoff: true
    })

    expect(await repo.git(['log', '-1', '--format=%an <%ae>'])).toBe(
      'Ada Lovelace <ada@example.com>\n'
    )
    // The sign-off uses the committer, not the author written above.
    expect(await repo.git(['log', '-1', '--format=%cn <%ce>'])).toBe('Seam <seam@example.com>\n')
    expect(await repo.git(['log', '-1', '--format=%B'])).toContain(
      'Signed-off-by: Seam <seam@example.com>'
    )
  })

  it('comes back with the short id of the commit it made', async () => {
    const repo = await repository()
    await identity(repo)
    repo.write('f.txt', 'one\n')
    await repo.git(['add', '.'])

    const outcome = await createCommit(new GitRunner(), repo.path, 'with an id')
    const shortId = (await repo.git(['rev-parse', '--short', 'HEAD'])).trim()

    expect(outcome.created).toBe(true)
    // The same abbreviation a terminal would print for the new commit.
    expect(outcome.shortId).toBe(shortId)
  })

  it('keeps the id empty when Git refuses the commit', async () => {
    const repo = await repository()
    await identity(repo)

    const outcome = await createCommit(new GitRunner(), repo.path, 'nothing staged')

    expect(outcome.created).toBe(false)
    expect(outcome.shortId).toBe('')
  })
})

describe('hooks', () => {
  /** A repository with one file staged and the identity pinned. */
  async function staged(): Promise<SampleRepository> {
    const repo = await repository()
    await identity(repo)
    repo.write('f.txt', 'one\n')
    await repo.git(['add', '.'])
    return repo
  }

  it('refuses the commit when a pre-commit hook fails, and keeps its output', async () => {
    const repo = await staged()
    writeHook(repo, 'pre-commit', 'echo "the hook says no"\nexit 1')

    const outcome = await createCommit(new GitRunner(), repo.path, 'a message')

    expect(outcome.created).toBe(false)
    expect(outcome.output).toContain('the hook says no')
    expect((await repo.run(['rev-parse', '--verify', 'HEAD'])).code).not.toBe(0)
  })

  it('lets the commit through when the hooks are skipped', async () => {
    const repo = await staged()
    writeHook(repo, 'pre-commit', 'exit 1')

    const outcome = await createCommit(new GitRunner(), repo.path, 'a message', { noVerify: true })

    expect(outcome.created).toBe(true)
    expect((await repo.git(['log', '-1', '--format=%s'])).trim()).toBe('a message')
  })

  it('keeps what a passing hook printed, for the panel', async () => {
    const repo = await staged()
    writeHook(repo, 'pre-commit', 'echo "checked the change"')

    const outcome = await createCommit(new GitRunner(), repo.path, 'a message')

    expect(outcome.created).toBe(true)
    expect(outcome.output).toContain('checked the change')
  })

  it('lets a commit-msg hook rewrite the message, as the terminal would', async () => {
    const repo = await staged()
    writeHook(repo, 'commit-msg', 'echo "Reviewed-by: hook" >> "$1"')

    const outcome = await createCommit(new GitRunner(), repo.path, 'original subject')

    expect(outcome.created).toBe(true)
    expect(await repo.git(['log', '-1', '--format=%B'])).toContain('Reviewed-by: hook')
  })

  it('stops a hook that will not end when the caller cancels', async () => {
    const repo = await staged()
    writeHook(repo, 'pre-commit', 'sleep 30')
    const controller = new AbortController()

    const promise = createCommit(new GitRunner(), repo.path, 'slow', {
      signal: controller.signal
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    controller.abort()

    const outcome = await promise
    expect(outcome.cancelled).toBe(true)
    expect(outcome.created).toBe(false)
    expect((await repo.run(['rev-parse', '--verify', 'HEAD'])).code).not.toBe(0)
  })
})

describe('commitFailure', () => {
  it('recognises the refusals the interface reacts to', () => {
    expect(commitFailure("fatal: unable to auto-detect email address (got 'x@y')")).toBe('identity')
    expect(commitFailure('nothing to commit, working tree clean')).toBe('nothing-staged')
    expect(
      commitFailure('error: Committing is not possible because you have unmerged files.')
    ).toBe('conflicts')
    expect(commitFailure('some other failure')).toBeNull()
  })
})

describe('amending', () => {
  /** A repository with one commit (`base`) and its file staged. */
  async function staged(): Promise<SampleRepository> {
    const repo = await repository()
    await identity(repo)
    repo.write('f.txt', 'one\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'base'])
    repo.write('f.txt', 'one\ntwo\n')
    await repo.git(['add', '.'])
    return repo
  }

  it('rewrites the message and adds the index to the last commit', async () => {
    const repo = await staged()
    await createCommit(new GitRunner(), repo.path, 'amended with the change', { amend: true })

    expect(await repo.git(['rev-list', '--count', 'HEAD'])).toBe('1\n')
    expect(await repo.git(['log', '-1', '--format=%s'])).toBe('amended with the change\n')
    expect(await repo.git(['show', '-1', '--name-only', '--format='])).toBe('f.txt\n')
    expect(await repo.git(['cat-file', '-p', 'HEAD:f.txt'])).toBe('one\ntwo\n')
  })

  it('rewrites only the message when nothing is staged', async () => {
    const repo = await staged()
    await createCommit(new GitRunner(), repo.path, 'first pass', { amend: true })
    const tree = await repo.git(['rev-parse', 'HEAD^{tree}'])

    await createCommit(new GitRunner(), repo.path, 'second pass', { amend: true })

    expect(await repo.git(['rev-list', '--count', 'HEAD'])).toBe('1\n')
    expect(await repo.git(['log', '-1', '--format=%s'])).toBe('second pass\n')
    expect(await repo.git(['rev-parse', 'HEAD^{tree}'])).toBe(tree)
  })
})

describe('readHeadCommit', () => {
  it('reads the short id, the subject and the whole message', async () => {
    const repo = await repository()
    await identity(repo)
    repo.write('f.txt', 'one\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'a subject\n\nand a body'])

    const head = await readHeadCommit(new GitRunner(), repo.path)

    expect(head.shortId).toBe((await repo.git(['rev-parse', '--short', 'HEAD'])).trim())
    expect(head.subject).toBe('a subject')
    expect(head.message).toBe('a subject\n\nand a body')
    expect(head.published).toBe(false)
  })

  it('reports the commit as published when a remote branch contains it', async () => {
    const repo = await repository()
    await identity(repo)
    repo.write('f.txt', 'one\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'base'])
    await repo.git(['update-ref', 'refs/remotes/origin/main', 'HEAD'])

    expect((await readHeadCommit(new GitRunner(), repo.path)).published).toBe(true)
  })
})
