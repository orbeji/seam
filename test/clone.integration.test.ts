// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cloneRepository, GitRunner } from '../src/core/git'
import { createRepository, SampleRepository } from './fixtures/repository'

/**
 * Cloning against real Git: a local path stands in for a remote, the new folder
 * carries the repository, and a missing parent is refused with a clear message.
 */

const runner = new GitRunner()
const repositories: SampleRepository[] = []
const temporaries: string[] = []

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
  while (temporaries.length > 0) rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
})

async function sourceRepository(): Promise<SampleRepository> {
  const repo = await createRepository()
  repositories.push(repo)
  repo.write('a.txt', 'hello from the source\n')
  await repo.git(['add', 'a.txt'])
  await repo.git(['commit', '-qm', 'Base'])
  return repo
}

function parentFolder(): string {
  const path = mkdtempSync(join(tmpdir(), 'seam-clone-parent-'))
  temporaries.push(path)
  return path
}

describe('cloneRepository', () => {
  it('copies a repository into the requested folder and returns its path', async () => {
    const source = await sourceRepository()
    const parent = parentFolder()
    const target = join(parent, 'cloned')

    const clonedPath = await cloneRepository(runner, source.path, target)

    expect(clonedPath).toBe(resolve(target))
    const cloned = new SampleRepository(clonedPath, runner)
    // The working copy's line endings follow the machine's `core.autocrlf`; the
    // committed blob is what the clone must carry, so it is the stable check.
    expect(await cloned.git(['show', 'HEAD:a.txt'])).toBe('hello from the source\n')
    expect((await cloned.git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe('main')
  })

  it('trims the URL and destination before running Git', async () => {
    const source = await sourceRepository()
    const parent = parentFolder()

    const clonedPath = await cloneRepository(
      runner,
      `  ${source.path}  `,
      `  ${join(parent, 'trimmed')}  `
    )

    expect(clonedPath).toBe(resolve(parent, 'trimmed'))
    expect(await new SampleRepository(clonedPath, runner).git(['show', 'HEAD:a.txt'])).toBe(
      'hello from the source\n'
    )
  })

  it('refuses a missing parent folder instead of creating a chain of it', async () => {
    const source = await sourceRepository()
    const parent = parentFolder()

    await expect(
      cloneRepository(runner, source.path, join(parent, 'missing', 'cloned'))
    ).rejects.toThrow(/destination folder does not exist/i)
  })

  it('needs both a URL and a destination', async () => {
    const parent = parentFolder()

    await expect(cloneRepository(runner, '  ', join(parent, 'cloned'))).rejects.toThrow(
      /repository URL is required/i
    )
    await expect(cloneRepository(runner, 'https://example.com/repo.git', '  ')).rejects.toThrow(
      /destination folder is required/i
    )
  })
})
