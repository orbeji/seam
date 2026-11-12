// SPDX-License-Identifier: MIT

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  addWorktree,
  GitRunner,
  listWorktrees,
  lockWorktree,
  mergeWorktree,
  moveWorktree,
  pruneWorktrees,
  readStatus,
  removeWorktree,
  summarizeChanges,
  unlockWorktree
} from '../src/core/git'
import { createRepository, type SampleRepository } from './fixtures/repository'

const runner = new GitRunner()
const repositories: SampleRepository[] = []
const folders: string[] = []

async function repository(): Promise<SampleRepository> {
  const repo = await createRepository()
  repositories.push(repo)
  repo.write('file.txt', 'base\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'base'])
  return repo
}

/** A parent folder for a linked worktree, removed after its test. */
function folder(): string {
  const path = mkdtempSync(join(tmpdir(), 'seam-worktree-'))
  folders.push(path)
  return path
}

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
  while (folders.length > 0) rmSync(folders.pop() as string, { recursive: true, force: true })
})

describe('worktree operations', () => {
  it('creates a worktree with its own branch and reads its changes', async () => {
    const repo = await repository()
    const linked = join(folder(), 'feature')

    await addWorktree(runner, repo.path, {
      path: linked,
      branch: 'feature/x',
      newBranch: true,
      startPoint: null,
      detach: false
    })

    const worktrees = await listWorktrees(runner, repo.path)
    expect(worktrees.map((worktree) => worktree.path)).toEqual([repo.path, linked])
    expect(worktrees[0]?.main).toBe(true)
    expect(worktrees[1]).toMatchObject({ branch: 'feature/x', main: false })

    writeFileSync(join(linked, 'file.txt'), 'changed in the worktree\n')
    const summary = summarizeChanges(await readStatus(runner, linked))
    expect(summary.unstaged.map((entry) => entry.path)).toEqual(['file.txt'])
  })

  it('locks and unlocks a worktree', async () => {
    const repo = await repository()
    const linked = join(folder(), 'feature')
    await addWorktree(runner, repo.path, {
      path: linked,
      branch: 'feature/x',
      newBranch: true,
      startPoint: null,
      detach: false
    })

    await lockWorktree(runner, repo.path, linked, 'external drive')
    let worktrees = await listWorktrees(runner, repo.path)
    expect(worktrees.find((worktree) => worktree.path === linked)?.locked).toBe('external drive')

    await unlockWorktree(runner, repo.path, linked)
    worktrees = await listWorktrees(runner, repo.path)
    expect(worktrees.find((worktree) => worktree.path === linked)?.locked).toBeNull()
  })

  it('moves and removes a linked worktree', async () => {
    const repo = await repository()
    const parent = folder()
    const linked = join(parent, 'feature')
    const moved = join(parent, 'moved')
    await addWorktree(runner, repo.path, {
      path: linked,
      branch: 'feature/x',
      newBranch: true,
      startPoint: null,
      detach: false
    })

    await moveWorktree(runner, repo.path, linked, moved)
    expect((await listWorktrees(runner, repo.path)).map((worktree) => worktree.path)).toEqual([
      repo.path,
      moved
    ])

    await removeWorktree(runner, repo.path, moved)
    expect((await listWorktrees(runner, repo.path)).map((worktree) => worktree.path)).toEqual([
      repo.path
    ])
  })

  it('prunes the record of a worktree whose folder was deleted', async () => {
    const repo = await repository()
    const parent = folder()
    const linked = join(parent, 'feature')
    await addWorktree(runner, repo.path, {
      path: linked,
      branch: 'feature/x',
      newBranch: true,
      startPoint: null,
      detach: false
    })
    rmSync(linked, { recursive: true, force: true })

    const before = await listWorktrees(runner, repo.path)
    expect(before.find((worktree) => worktree.path === linked)?.prunable).not.toBeNull()

    await pruneWorktrees(runner, repo.path)
    expect((await listWorktrees(runner, repo.path)).map((worktree) => worktree.path)).toEqual([
      repo.path
    ])
  })

  it('refuses to reuse a branch that is already checked out', async () => {
    const repo = await repository()
    const linked = join(folder(), 'second')

    await expect(
      addWorktree(runner, repo.path, {
        path: linked,
        branch: 'main',
        newBranch: false,
        startPoint: null,
        detach: false
      })
    ).rejects.toThrow()
    expect((await listWorktrees(runner, repo.path)).map((worktree) => worktree.path)).toEqual([
      repo.path
    ])
  })
})

describe('merging a worktree', () => {
  /** Creates a linked worktree on its own branch with one committed change. */
  async function changedWorktree(repo: SampleRepository, contents: string): Promise<string> {
    const linked = join(folder(), 'feature')
    await addWorktree(runner, repo.path, {
      path: linked,
      branch: 'feature/x',
      newBranch: true,
      startPoint: null,
      detach: false
    })
    writeFileSync(join(linked, 'file.txt'), contents)
    await runner.runOrThrow(['add', '.'], { cwd: linked })
    await runner.runOrThrow(['commit', '-qm', 'feature'], { cwd: linked })
    return linked
  }

  it('merges into a branch that another worktree has checked out', async () => {
    const repo = await repository()
    const linked = await changedWorktree(repo, 'feature\n')

    const result = await mergeWorktree(runner, repo.path, {
      sourcePath: linked,
      target: 'main',
      strategy: 'merge-commit',
      message: ''
    })

    expect(result.outcome).toMatchObject({ ok: true, conflicts: 0, operation: null })
    // The interface opens the worktree that holds the target branch.
    expect(result.worktreePath).toBe(resolve(repo.path))
    expect(repo.read('file.txt')).toBe('feature\n')
  })

  it('returns the linked worktree that holds the target branch', async () => {
    const repo = await repository()
    const develop = join(folder(), 'develop')
    await addWorktree(runner, repo.path, {
      path: develop,
      branch: 'develop',
      newBranch: true,
      startPoint: null,
      detach: false
    })
    const linked = await changedWorktree(repo, 'feature\n')

    const result = await mergeWorktree(runner, repo.path, {
      sourcePath: linked,
      target: 'develop',
      strategy: 'merge-commit',
      message: ''
    })

    expect(result.outcome).toMatchObject({ ok: true, conflicts: 0 })
    expect(result.worktreePath).toBe(resolve(develop))
    expect(readFileSync(join(develop, 'file.txt'), 'utf8')).toBe('feature\n')
  })

  it('merges into a branch that no worktree has checked out', async () => {
    const repo = await repository()
    await repo.git(['branch', 'release'])
    const linked = await changedWorktree(repo, 'feature\n')

    const result = await mergeWorktree(runner, repo.path, {
      sourcePath: linked,
      target: 'release',
      strategy: 'merge-commit',
      message: ''
    })

    expect(result.outcome).toMatchObject({ ok: true, conflicts: 0, operation: null })
    expect(result.worktreePath).toBeNull()
    expect(await repo.git(['show', 'release:file.txt'])).toBe('feature\n')
    // The throwaway worktree used for the merge is gone again.
    expect((await listWorktrees(runner, repo.path)).map((worktree) => worktree.path)).toEqual([
      repo.path,
      linked
    ])
  })

  it('leaves the temporary worktree when a squash needs a commit', async () => {
    const repo = await repository()
    await repo.git(['branch', 'release'])
    const linked = await changedWorktree(repo, 'feature\n')

    const result = await mergeWorktree(runner, repo.path, {
      sourcePath: linked,
      target: 'release',
      strategy: 'squash',
      message: ''
    })

    expect(result.outcome.ok).toBe(true)
    const temporary = result.worktreePath
    expect(temporary).not.toBeNull()
    expect((await listWorktrees(runner, repo.path)).map((worktree) => worktree.path)).toContain(
      temporary
    )
    expect(await runner.runOrThrow(['show', 'release:file.txt'], { cwd: repo.path })).toMatchObject(
      { stdout: Buffer.from('base\n') }
    )

    await removeWorktree(runner, repo.path, temporary as string, true)
  })

  it('reports the conflicts left when the merge stops', async () => {
    const repo = await repository()
    const linked = await changedWorktree(repo, 'feature\n')
    repo.write('file.txt', 'main\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'main change'])

    const result = await mergeWorktree(runner, repo.path, {
      sourcePath: linked,
      target: 'main',
      strategy: 'merge-commit',
      message: ''
    })

    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.conflicts).toBe(1)
    expect(result.worktreePath).toBe(resolve(repo.path))
    await repo.git(['merge', '--abort'])
  })
})
