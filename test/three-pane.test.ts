// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RepositoryService } from '../src/main/session/repository-service'
import { createRepository, type SampleRepository } from './fixtures/repository'

/**
 * Storing the three-pane centre as the index's version. Done writes the whole
 * text of the centre, so the index ends up holding exactly what the panel
 * showed and the working copy is left alone.
 */

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

/** The text the index holds for the file. */
function indexText(repo: SampleRepository): Promise<string> {
  return repo.git(['show', ':f.txt'])
}

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

describe('writing the index from the three-pane centre', () => {
  it('stores exactly the text it is given', async () => {
    const repo = await committed()
    repo.write('f.txt', 'one\nTWO\nthree\n')
    const service = new RepositoryService()

    const result = await service.writeIndex(repo.path, 'f.txt', 'one\nTWO\nthree\n')
    expect(result).toEqual({ ok: true, value: null })

    expect(await indexText(repo)).toBe('one\nTWO\nthree\n')
    const staged = await repo.git(['diff', '--cached', '--', 'f.txt'])
    expect(staged).toContain('-two')
    expect(staged).toContain('+TWO')
  })

  it('leaves the working copy alone', async () => {
    const repo = await committed()
    repo.write('f.txt', 'one\nTWO\nthree\n')
    const service = new RepositoryService()

    await service.writeIndex(repo.path, 'f.txt', 'one\ntwo\nthree\n')
    expect(readFileSync(join(repo.path, 'f.txt'), 'utf8')).toBe('one\nTWO\nthree\n')
    expect(await indexText(repo)).toBe('one\ntwo\nthree\n')
  })

  it('clears a prepared change when the centre holds HEAD', async () => {
    const repo = await committed()
    repo.write('f.txt', 'one\nTWO\nthree\n')
    const service = new RepositoryService()

    await service.writeIndex(repo.path, 'f.txt', 'one\nTWO\nthree\n')
    await service.writeIndex(repo.path, 'f.txt', 'one\ntwo\nthree\n')

    expect(await repo.git(['diff', '--cached', '--', 'f.txt'])).toBe('')
    expect(await repo.git(['diff', '--', 'f.txt'])).toContain('+TWO')
  })
})
