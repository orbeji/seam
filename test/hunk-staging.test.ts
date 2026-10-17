// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest'
import type { LineHunk } from '../src/core/diff'
import { GitRunner, readFileModel } from '../src/core/git'
import { RepositoryService } from '../src/main/session/repository-service'
import { createRepository, type SampleRepository } from './fixtures/repository'

const runner = new GitRunner()
const repositories: SampleRepository[] = []

async function repository(): Promise<SampleRepository> {
  const repo = await createRepository()
  repositories.push(repo)
  return repo
}

/** A repository with one committed file of six lines. */
async function committed(): Promise<SampleRepository> {
  const repo = await repository()
  repo.write('f.txt', 'one\ntwo\nthree\nfour\nfive\nsix\n')
  await repo.git(['add', 'f.txt'])
  await repo.git(['commit', '-qm', 'base'])
  return repo
}

/** The text the index holds for the file, which is what `git add` left. */
function indexText(repo: SampleRepository): Promise<string> {
  return repo.git(['show', ':f.txt'])
}

/** The staged change: the index against HEAD. */
function cachedDiff(repo: SampleRepository): Promise<string> {
  return repo.git(['diff', '--cached', '--', 'f.txt'])
}

/** The pending change: the working copy against the index. */
function worktreeDiff(repo: SampleRepository): Promise<string> {
  return repo.git(['diff', '--', 'f.txt'])
}

/**
 * The line range a hunk header counts from. Git counts from one, and an empty
 * range points at the line before it, which for these hunks is the 0-based
 * start: `-2,1` for a change to the second line, `-2,0` for a deletion there.
 */
function header(start: number, count: number): string {
  return `${count > 0 ? start + 1 : start},${count}`
}

/**
 * Building the `-U0` patch Git would make from one hunk, so `git apply
 * --cached` can perform the same write Seam performs and the two can be
 * compared by the tree they leave.
 */
function patchFor(path: string, comparison: { a: string[]; b: string[] }, hunk: LineHunk): string {
  const lines = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${header(hunk.aStart, hunk.aLines)} +${header(hunk.bStart, hunk.bLines)} @@`
  ]
  for (let i = hunk.aStart; i < hunk.aStart + hunk.aLines; i += 1)
    lines.push(`-${comparison.a[i] ?? ''}`)
  for (let i = hunk.bStart; i < hunk.bStart + hunk.bLines; i += 1)
    lines.push(`+${comparison.b[i] ?? ''}`)
  return `${lines.join('\n')}\n`
}

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

describe('preparing a hunk in the index', () => {
  it('writes the chosen hunk and no other', async () => {
    const repo = await committed()
    repo.write('f.txt', 'one\nTWO\nthree\nFOUR\nfive\nsix\n')
    const service = new RepositoryService()

    const model = await readFileModel(runner, repo.path, 'f.txt')
    expect(model?.unstaged).toHaveLength(2)
    const hunk = model?.unstaged[0] as LineHunk

    const result = await service.writeHunks(repo.path, 'f.txt', 'stage', [hunk])
    expect(result).toEqual({ ok: true, value: null })

    // The index holds the first change, and the working copy still has the
    // second one pending. The working copy was never touched.
    expect(await indexText(repo)).toBe('one\nTWO\nthree\nfour\nfive\nsix\n')
    expect(await cachedDiff(repo)).toContain('+TWO')
    expect(await cachedDiff(repo)).not.toContain('FOUR')
    expect(await worktreeDiff(repo)).toContain('+FOUR')
    expect(await worktreeDiff(repo)).not.toContain('+TWO')
  })

  it('leaves the same tree as `git apply --cached` of the same hunk', async () => {
    const repo = await committed()
    repo.write('f.txt', 'one\nTWO\nthree\nFOUR\nfive\nsix\n')
    const service = new RepositoryService()

    const model = await readFileModel(runner, repo.path, 'f.txt')
    const hunk = model?.unstaged[0] as LineHunk

    await service.writeHunks(repo.path, 'f.txt', 'stage', [hunk])
    const seam = (await repo.git(['write-tree'])).trim()

    // Let Git make the same change on the same starting index.
    await repo.git(['read-tree', 'HEAD'])
    const patch = patchFor(
      'f.txt',
      { a: model?.index?.lines ?? [], b: model?.worktree?.lines ?? [] },
      hunk
    )
    await runner.runOrThrow(['apply', '--cached', '--unidiff-zero', '-'], {
      cwd: repo.path,
      stdin: patch
    })
    const git = (await repo.git(['write-tree'])).trim()

    expect(git).toBe(seam)
  })

  it('refuses a hunk the file no longer has', async () => {
    const repo = await committed()
    repo.write('f.txt', 'one\nTWO\nthree\nfour\nfive\nsix\n')
    const service = new RepositoryService()

    const model = await readFileModel(runner, repo.path, 'f.txt')
    const hunk = model?.unstaged[0] as LineHunk

    // The working copy goes back between the read and the click, so the hunk
    // the viewer drew no longer exists.
    repo.write('f.txt', 'one\ntwo\nthree\nfour\nfive\nsix\n')

    const result = await service.writeHunks(repo.path, 'f.txt', 'stage', [hunk])
    expect(result.ok).toBe(false)
  })
})

describe('removing a hunk from the index', () => {
  it('takes it back out, leaving the index as the branch has it', async () => {
    const repo = await committed()
    repo.write('f.txt', 'one\nTWO\nthree\nfour\nfive\nsix\n')
    const service = new RepositoryService()

    const pending = await readFileModel(runner, repo.path, 'f.txt')
    await service.writeHunks(repo.path, 'f.txt', 'stage', [pending?.unstaged[0] as LineHunk])
    expect(await cachedDiff(repo)).toContain('+TWO')

    const prepared = await readFileModel(runner, repo.path, 'f.txt')
    expect(prepared?.staged).toHaveLength(1)
    const result = await service.writeHunks(repo.path, 'f.txt', 'unstage', [
      prepared?.staged[0] as LineHunk
    ])
    expect(result).toEqual({ ok: true, value: null })

    expect(await cachedDiff(repo)).toBe('')
    expect(await indexText(repo)).toBe('one\ntwo\nthree\nfour\nfive\nsix\n')
  })

  it('takes a wholly added path out of the index instead of emptying it', async () => {
    const repo = await committed()
    repo.write('fresh.txt', 'brand new\n')
    const service = new RepositoryService()
    await service.stage(repo.path, ['fresh.txt'])

    const model = await readFileModel(runner, repo.path, 'fresh.txt')
    expect(model?.staged).toHaveLength(1)
    const result = await service.writeHunks(repo.path, 'fresh.txt', 'unstage', [
      model?.staged[0] as LineHunk
    ])
    expect(result).toEqual({ ok: true, value: null })

    // The path left the index; it is untracked again, not staged as empty.
    expect((await repo.git(['status', '--porcelain', '--', 'fresh.txt'])).trim()).toBe(
      '?? fresh.txt'
    )
  })
})
