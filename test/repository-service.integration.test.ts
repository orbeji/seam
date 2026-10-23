// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitRunner } from '../src/core/git'
import { RepositoryService } from '../src/main/session/repository-service'
import { createRepository, type SampleRepository } from './fixtures/repository'

const repositories: SampleRepository[] = []
const directories: string[] = []

async function repository(): Promise<SampleRepository> {
  const repo = await createRepository()
  repositories.push(repo)
  return repo
}

function tempDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'seam-dir-'))
  directories.push(dir)
  return dir
}

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
  while (directories.length > 0) rmSync(directories.pop() ?? '', { recursive: true, force: true })
})

describe('RepositoryService.snapshot', () => {
  it('returns the four lists for a real repository', async () => {
    const repo = await repository()
    repo.write('tracked.txt', 'base\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'base'])
    repo.write('tracked.txt', 'changed\n')
    repo.write('new.txt', 'untracked\n')

    const result = await new RepositoryService().snapshot(repo.path)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.repo).toBe(repo.path)
    expect(result.value.summary.unstaged.map((entry) => entry.path)).toEqual(['tracked.txt'])
    expect(result.value.summary.untracked.map((entry) => entry.path)).toEqual(['new.txt'])
    expect(result.value.operation).toBeNull()
  })

  it('reports a stopped merge', async () => {
    const repo = await repository()
    repo.write('f.txt', 'base\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'base'])
    await repo.git(['checkout', '-q', '-b', 'side'])
    repo.write('f.txt', 'theirs\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'side'])
    await repo.git(['checkout', '-q', 'main'])
    repo.write('f.txt', 'ours\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'main'])
    await repo.gitExpectingFailure(['merge', '--no-edit', 'side'])

    const result = await new RepositoryService().snapshot(repo.path)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.operation).toBe('merge')
    expect(result.value.summary.conflicts.map((entry) => entry.path)).toEqual(['f.txt'])
  })

  it('reports a missing folder as not a repository', async () => {
    const result = await new RepositoryService().snapshot(
      join(tmpdir(), 'seam-does-not-exist-9f3a')
    )
    expect(result).toMatchObject({ ok: false, code: 'not-a-repository' })
  })

  it('reports a folder that is not a repository', async () => {
    const result = await new RepositoryService().snapshot(tempDirectory())
    expect(result).toMatchObject({ ok: false, code: 'not-a-repository' })
  })

  it('reports a missing Git executable', async () => {
    const repo = await repository()
    const runner = new GitRunner({ gitPath: 'seam-definitely-missing-git', globalArgs: [] })
    const result = await new RepositoryService(runner).snapshot(repo.path)
    expect(result).toMatchObject({ ok: false, code: 'git-not-found' })
  })
})

describe('RepositoryService.gitDirectory', () => {
  it('resolves the absolute git folder of a repository', async () => {
    const repo = await repository()
    const found = await new RepositoryService().gitDirectory(repo.path)
    expect(found).not.toBeNull()
    expect(isAbsolute(found ?? '')).toBe(true)
    expect(found?.endsWith('.git')).toBe(true)
  })

  it('is null for a folder that is not a repository', async () => {
    await expect(new RepositoryService().gitDirectory(tempDirectory())).resolves.toBeNull()
  })
})
