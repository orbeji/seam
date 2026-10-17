// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest'
import type { LineHunk } from '../src/core/diff'
import { GitRunner, readFileModel } from '../src/core/git'
import { RepositoryService } from '../src/main/session/repository-service'
import { createRepository, type SampleRepository } from './fixtures/repository'

/**
 * Preparing single lines of a hunk. The chosen lines end up in the index and
 * the rest of the hunk stays pending, matching what Git leaves when the same
 * partial patch is applied with `git apply --cached`.
 */

const runner = new GitRunner()
const repositories: SampleRepository[] = []

async function repository(): Promise<SampleRepository> {
  const repo = await createRepository()
  repositories.push(repo)
  return repo
}

async function committed(): Promise<SampleRepository> {
  const repo = await repository()
  repo.write('f.txt', 'one\ntwo\nthree\n')
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

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

describe('preparing single lines of a hunk', () => {
  it('prepares the chosen line and leaves the rest pending', async () => {
    const repo = await committed()
    repo.write('f.txt', 'one\ntwo\nX\nY\nthree\n')
    const service = new RepositoryService()

    const model = await readFileModel(runner, repo.path, 'f.txt')
    const hunk = model?.unstaged[0] as LineHunk
    // Patch line 0 of an insertion is the first of its two working-copy lines.
    const result = await service.writeHunks(repo.path, 'f.txt', 'stage', [hunk], [0])
    expect(result).toEqual({ ok: true, value: null })

    expect(await indexText(repo)).toBe('one\ntwo\nX\nthree\n')
    const staged = await cachedDiff(repo)
    expect(staged).toContain('+X')
    expect(staged).not.toContain('+Y')

    // `Y` is still there to prepare, and nothing else moved.
    const after = await readFileModel(runner, repo.path, 'f.txt')
    expect(after?.unstaged).toEqual([{ aStart: 3, aLines: 0, bStart: 3, bLines: 1 }])
    const pending = await worktreeDiff(repo)
    expect(pending).toContain('+Y')
    expect(pending).not.toContain('+X')
  })

  it('leaves the same tree as git apply of the same partial patch', async () => {
    const repo = await committed()
    repo.write('f.txt', 'one\ntwo\nX\nY\nthree\n')
    const service = new RepositoryService()

    const model = await readFileModel(runner, repo.path, 'f.txt')
    const hunk = model?.unstaged[0] as LineHunk
    await service.writeHunks(repo.path, 'f.txt', 'stage', [hunk], [0])
    const seam = (await repo.git(['write-tree'])).trim()

    // Let Git insert only `X` after `two` on the same starting index.
    await repo.git(['read-tree', 'HEAD'])
    const patch = ['--- a/f.txt', '+++ b/f.txt', '@@ -2,0 +3 @@', '+X', ''].join('\n')
    await runner.runOrThrow(['apply', '--cached', '--unidiff-zero', '-'], {
      cwd: repo.path,
      stdin: patch
    })
    const git = (await repo.git(['write-tree'])).trim()

    expect(git).toBe(seam)
  })

  it('keeps the old line when only the addition of a modified line is chosen', async () => {
    const repo = await committed()
    repo.write('f.txt', 'one\nTWO\nthree\n')
    const service = new RepositoryService()

    const model = await readFileModel(runner, repo.path, 'f.txt')
    const hunk = model?.unstaged[0] as LineHunk
    // Patch line 1 of a modification is its working-copy line, after the
    // index line it replaces at patch line 0.
    const result = await service.writeHunks(repo.path, 'f.txt', 'stage', [hunk], [1])
    expect(result).toEqual({ ok: true, value: null })

    // The old line stays and the new one is inserted after it, as Git does.
    expect(await indexText(repo)).toBe('one\ntwo\nTWO\nthree\n')
    const staged = await cachedDiff(repo)
    expect(staged).toContain('+TWO')
    expect(staged).not.toContain('-two')
  })

  it('refuses a line the hunk does not have', async () => {
    const repo = await committed()
    repo.write('f.txt', 'one\nTWO\nthree\n')
    const service = new RepositoryService()

    const model = await readFileModel(runner, repo.path, 'f.txt')
    const hunk = model?.unstaged[0] as LineHunk
    const result = await service.writeHunks(repo.path, 'f.txt', 'stage', [hunk], [5])
    expect(result.ok).toBe(false)
  })
})
