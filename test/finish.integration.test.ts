// SPDX-License-Identifier: MIT

import { chmodSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  abortOperation,
  detectOperation,
  finishOperation,
  GitRunner,
  readConflictState,
  readMergeMessage,
  readStatus
} from '../src/core/git'
import { createRepository, type SampleRepository } from './fixtures/repository'

/**
 * Phase 7 against real repositories: every operation is finished and aborted
 * with the same commands a terminal runs, and the resulting commit ids are
 * compared with a twin repository driven by Git directly. Dates are pinned so
 * the ids are stable.
 */

const FIXED_DATE = '2001-02-03T04:05:06 +0000'

const runner = new GitRunner({
  globalArgs: [
    '-c',
    'core.quotepath=false',
    '-c',
    'user.name=Seam',
    '-c',
    'user.email=seam@example.com'
  ],
  env: { GIT_AUTHOR_DATE: FIXED_DATE, GIT_COMMITTER_DATE: FIXED_DATE }
})

const repositories: SampleRepository[] = []

async function repository(): Promise<SampleRepository> {
  const created = await createRepository({
    env: { GIT_AUTHOR_DATE: FIXED_DATE, GIT_COMMITTER_DATE: FIXED_DATE }
  })
  repositories.push(created)
  return created
}

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

function head(repo: SampleRepository): Promise<string> {
  return repo.git(['rev-parse', 'HEAD']).then((value) => value.trim())
}

async function statusEntries(repo: SampleRepository): Promise<number> {
  return (await readStatus(runner, repo.path)).entries.length
}

/** A merge stopped on one line both branches changed. */
async function mergeConflicted(): Promise<SampleRepository> {
  const repo = await repository()
  repo.write('f.txt', 'base\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Base'])

  await repo.git(['checkout', '-q', '-b', 'side'])
  repo.write('f.txt', 'theirs\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Side change'])

  await repo.git(['checkout', '-q', 'main'])
  repo.write('f.txt', 'ours\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Main change'])

  await repo.gitExpectingFailure(['merge', '--no-edit', 'side'])
  return repo
}

/** A cherry-pick stopped on the commit it picked. */
async function cherryPickConflicted(): Promise<SampleRepository> {
  const repo = await repository()
  repo.write('f.txt', 'base\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Base'])

  await repo.git(['checkout', '-q', '-b', 'side'])
  repo.write('f.txt', 'side\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Side change'])
  const picked = (await repo.git(['rev-parse', 'HEAD'])).trim()

  await repo.git(['checkout', '-q', 'main'])
  repo.write('f.txt', 'main\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Main change'])

  await repo.gitExpectingFailure(['cherry-pick', picked])
  return repo
}

/** A revert stopped where the commit being reverted touched a changed line. */
async function revertConflicted(): Promise<SampleRepository> {
  const repo = await repository()
  repo.write('h.txt', 'base\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Base'])

  repo.write('h.txt', 'base\nA\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Add A'])
  const addA = (await repo.git(['rev-parse', 'HEAD'])).trim()

  repo.write('h.txt', 'base\nA changed\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Change A'])

  await repo.gitExpectingFailure(['revert', '--no-edit', addA])
  return repo
}

/**
 * A rebase of four commits that stops three times: on the first commit, on the
 * third and on the fourth. The second commit replays cleanly.
 */
async function rebaseTwice(): Promise<SampleRepository> {
  const repo = await repository()
  repo.write('f.txt', 'one\ntwo\nthree\nfour\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Base'])

  await repo.git(['checkout', '-q', '-b', 'side'])
  repo.write('f.txt', 'side1\ntwo\nthree\nfour\n')
  await repo.git(['commit', '-qam', 'Side change'])
  repo.write('f.txt', 'side1\ntwo\nthree\nfour\nfive\n')
  await repo.git(['commit', '-qam', 'Append five'])
  repo.write('f.txt', 'side1\nside2\nthree\nfour\nfive\n')
  await repo.git(['commit', '-qam', 'Change two'])
  repo.write('f.txt', 'side1\nside2\nside3\nfour\nfive\n')
  await repo.git(['commit', '-qam', 'Change three'])

  await repo.git(['checkout', '-q', 'main'])
  repo.write('f.txt', 'main1\ntwo\nmain3\nfour\n')
  await repo.git(['commit', '-qam', 'Main change'])

  await repo.git(['checkout', '-q', 'side'])
  await repo.gitExpectingFailure(['rebase', 'main'])
  return repo
}

/** A stash pop stopped on the file both the stash and the commit changed. */
async function stashConflicted(): Promise<SampleRepository> {
  const repo = await repository()
  repo.write('f.txt', 'base\n')
  repo.write('other.txt', 'other\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Base'])

  repo.write('f.txt', 'stashed\n')
  await repo.git(['stash', 'push', '-m', 'Stashed change'])

  repo.write('f.txt', 'current\n')
  await repo.git(['commit', '-qam', 'Current change'])
  await repo.gitExpectingFailure(['stash', 'pop'])
  return repo
}

describe('finishOperation', () => {
  it('finishes a merge with the message Git prepared, like the terminal', async () => {
    const seam = await mergeConflicted()
    const terminal = await mergeConflicted()

    const message = await readMergeMessage(runner, seam.path)
    expect(message).toBe("Merge branch 'side'")

    for (const repo of [seam, terminal]) {
      repo.write('f.txt', 'resolved\n')
      await repo.git(['add', 'f.txt'])
    }
    // The terminal commits through an editor, whose cleanup strips the
    // `# Conflicts:` block, exactly like the commit box does.
    await terminal.git(['-c', 'core.editor=true', 'commit'])

    const outcome = await finishOperation(runner, seam.path)

    expect(outcome).toMatchObject({ finished: true, failed: false, operation: null, conflicts: 0 })
    expect(await head(seam)).toBe(await head(terminal))
    expect((await seam.git(['log', '-1', '--format=%P'])).trim().split(' ')).toHaveLength(2)
  })

  it('finishes a cherry-pick, like the terminal', async () => {
    const seam = await cherryPickConflicted()
    const terminal = await cherryPickConflicted()

    for (const repo of [seam, terminal]) {
      repo.write('f.txt', 'resolved\n')
      await repo.git(['add', 'f.txt'])
    }
    await terminal.git(['-c', 'core.editor=true', 'cherry-pick', '--continue'])

    const outcome = await finishOperation(runner, seam.path)

    expect(outcome).toMatchObject({ finished: true, failed: false, operation: null, conflicts: 0 })
    expect(await head(seam)).toBe(await head(terminal))
  })

  it('finishes a revert, like the terminal', async () => {
    const seam = await revertConflicted()
    const terminal = await revertConflicted()

    for (const repo of [seam, terminal]) {
      repo.write('h.txt', 'base\n')
      await repo.git(['add', 'h.txt'])
    }
    await terminal.git(['-c', 'core.editor=true', 'revert', '--continue'])

    const outcome = await finishOperation(runner, seam.path)

    expect(outcome).toMatchObject({ finished: true, failed: false, operation: null, conflicts: 0 })
    expect(await head(seam)).toBe(await head(terminal))
  })

  it('reports the rebase progress and reloads the list at every stop', async () => {
    const seam = await rebaseTwice()
    const terminal = await rebaseTwice()

    const resolved = [
      'side1\ntwo\nmain3\nfour\n',
      'side1\nside2\nmain3\nfour\nfive\n',
      'side1\nside2\nside3\nfour\nfive\n'
    ]

    // First stop: commit 1 of 4.
    let state = await readConflictState(runner, seam.path)
    expect(state.progress).toEqual({ current: 1, total: 4 })
    expect(state.entries.map((entry) => entry.path)).toEqual(['f.txt'])

    seam.write('f.txt', resolved[0] ?? '')
    await seam.git(['add', 'f.txt'])
    const first = await finishOperation(runner, seam.path)

    // The second commit replays cleanly and Git stops on the third.
    expect(first).toMatchObject({
      finished: false,
      failed: true,
      operation: 'rebase',
      conflicts: 1
    })
    state = await readConflictState(runner, seam.path)
    expect(state.progress).toEqual({ current: 3, total: 4 })

    seam.write('f.txt', resolved[1] ?? '')
    await seam.git(['add', 'f.txt'])
    const second = await finishOperation(runner, seam.path)

    // The fourth commit conflicts on the same line main changed.
    expect(second).toMatchObject({
      finished: false,
      failed: true,
      operation: 'rebase',
      conflicts: 1
    })
    state = await readConflictState(runner, seam.path)
    expect(state.progress).toEqual({ current: 4, total: 4 })

    seam.write('f.txt', resolved[2] ?? '')
    await seam.git(['add', 'f.txt'])
    const third = await finishOperation(runner, seam.path)
    expect(third).toMatchObject({ finished: true, failed: false, operation: null })

    // The same three resolutions through the terminal end on the same commit.
    for (const [index, content] of resolved.entries()) {
      terminal.write('f.txt', content)
      await terminal.git(['add', 'f.txt'])
      const result = await terminal.run(['-c', 'core.editor=true', 'rebase', '--continue'])
      expect(result.code).toBe(index === resolved.length - 1 ? 0 : 1)
    }

    expect(await head(seam)).toBe(await head(terminal))
    expect(seam.read('f.txt')).toBe(resolved[2])
    expect(await detectOperation(runner, seam.path)).toBeNull()
  })

  it('reads progress from the am backend of a rebase too', async () => {
    const repo = await rebaseTwice()
    await abortOperation(runner, repo.path)

    await repo.git(['checkout', '-q', 'side'])
    await repo.gitExpectingFailure(['-c', 'rebase.backend=apply', 'rebase', 'main'])

    expect((await readConflictState(runner, repo.path)).progress).toEqual({
      current: 1,
      total: 4
    })
  })

  it('drops the stash a resolved pop left behind', async () => {
    const repo = await stashConflicted()
    expect((await readConflictState(runner, repo.path)).stash).toBe('stash@{0}')

    repo.write('f.txt', 'resolved\n')
    await repo.git(['add', 'f.txt'])
    const outcome = await finishOperation(runner, repo.path)

    expect(outcome).toMatchObject({ finished: true, failed: false })
    expect((await repo.git(['stash', 'list'])).trim()).toBe('')
    // The resolved change stays staged: the user commits it as usual.
    expect(await statusEntries(repo)).toBe(1)
  })

  it('keeps the resolutions when a pre-commit hook refuses', async () => {
    const repo = await mergeConflicted()
    repo.write('f.txt', 'resolved\n')
    await repo.git(['add', 'f.txt'])

    const hook = join(repo.path, '.git', 'hooks', 'pre-commit')
    writeFileSync(hook, '#!/bin/sh\necho "hook refused" >&2\nexit 1\n')
    chmodSync(hook, 0o755)

    const failed = await finishOperation(runner, repo.path)
    expect(failed).toMatchObject({
      finished: false,
      failed: true,
      operation: 'merge',
      conflicts: 0
    })
    expect(failed.output).toContain('hook refused')
    expect(await detectOperation(runner, repo.path)).toBe('merge')
    expect(await statusEntries(repo)).toBeGreaterThan(0)

    rmSync(hook)
    const retried = await finishOperation(runner, repo.path)
    expect(retried).toMatchObject({ finished: true, failed: false })
    expect(seamFile(repo)).toBe('resolved\n')
  })
})

function seamFile(repo: SampleRepository): string {
  return repo.read('f.txt')
}

describe('abortOperation', () => {
  const cases = [
    ['merge', mergeConflicted],
    ['cherry-pick', cherryPickConflicted],
    ['revert', revertConflicted],
    ['rebase', rebaseTwice]
  ] as const

  it.each(cases)('restores the tree and HEAD after a %s', async (name, create) => {
    const repo = await create()
    // A rebase moves HEAD onto the new base while it stops; the branch it
    // started from is what abort has to restore.
    const before =
      name === 'rebase' ? (await repo.git(['rev-parse', 'side'])).trim() : await head(repo)

    const outcome = await abortOperation(runner, repo.path)

    expect(outcome).toMatchObject({ finished: true, failed: false, operation: null })
    expect(await detectOperation(runner, repo.path)).toBeNull()
    expect(await head(repo)).toBe(before)
    expect(await statusEntries(repo)).toBe(0)
  })

  it('undoes a stash pop without dropping the stash or unrelated edits', async () => {
    const repo = await stashConflicted()
    // An edit in a file the stash never touched must survive the abort.
    repo.write('other.txt', 'edited while the pop was stopped\n')
    const before = await head(repo)
    expect(await detectOperation(runner, repo.path)).toBeNull()

    const outcome = await abortOperation(runner, repo.path)

    expect(outcome).toMatchObject({ finished: true, failed: false })
    expect(await head(repo)).toBe(before)
    expect(repo.read('f.txt')).toBe('current\n')
    expect(repo.read('other.txt')).toBe('edited while the pop was stopped\n')
    expect(await statusEntries(repo)).toBe(1)
    expect((await repo.git(['stash', 'list'])).trim()).toContain('Stashed change')
    expect((await readConflictState(runner, repo.path)).entries).toEqual([])
  })

  it('undoes a stash pop after every conflict was resolved', async () => {
    const repo = await stashConflicted()
    repo.write('f.txt', 'resolved\n')
    await repo.git(['add', 'f.txt'])
    expect((await readConflictState(runner, repo.path)).stash).toBe('stash@{0}')
    const before = await head(repo)

    const outcome = await abortOperation(runner, repo.path)

    expect(outcome).toMatchObject({ finished: true, failed: false })
    expect(await head(repo)).toBe(before)
    expect(repo.read('f.txt')).toBe('current\n')
    expect((await repo.git(['stash', 'list'])).trim()).toContain('Stashed change')
    expect(await statusEntries(repo)).toBe(0)
    expect((await readConflictState(runner, repo.path)).entries).toEqual([])
  })
})
