// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitRunner, readIdentity, writeIdentity } from '../src/core/git'
import { createRepository, type SampleRepository } from './fixtures/repository'

/**
 * Reading and storing the identity Git signs with. Each case runs under a home
 * of its own, so the machine's global configuration cannot answer the question.
 */

const homes: string[] = []
const repositories: SampleRepository[] = []

/** A runner whose home is empty, so nothing sets an identity for it. */
function isolated(): GitRunner {
  const home = mkdtempSync(join(tmpdir(), 'seam-identity-home-'))
  homes.push(home)
  return new GitRunner({
    env: { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), GIT_CONFIG_NOSYSTEM: '1' }
  })
}

async function repository(): Promise<SampleRepository> {
  const created = await createRepository({ identity: false })
  repositories.push(created)
  return created
}

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
  while (homes.length > 0) rmSync(homes.pop() ?? '', { recursive: true, force: true })
})

describe('readIdentity', () => {
  it('reports both halves missing when nothing sets them', async () => {
    const repo = await repository()
    expect(await readIdentity(isolated(), repo.path)).toEqual({ name: null, email: null })
  })

  it('reports the half that is set and the half that is not', async () => {
    const repo = await repository()
    await repo.git(['config', 'user.name', 'Alan'])

    expect(await readIdentity(isolated(), repo.path)).toEqual({ name: 'Alan', email: null })
  })
})

describe('writeIdentity', () => {
  it('keeps a local identity to its own repository', async () => {
    const runner = isolated()
    const first = await repository()
    const second = await repository()

    await writeIdentity(runner, first.path, { name: 'Ada', email: 'ada@example.com' }, 'local')

    expect(await readIdentity(runner, first.path)).toEqual({
      name: 'Ada',
      email: 'ada@example.com'
    })
    expect(await readIdentity(runner, second.path)).toEqual({ name: null, email: null })
  })

  it('shares a global identity with every repository', async () => {
    const runner = isolated()
    const first = await repository()
    const second = await repository()

    await writeIdentity(runner, first.path, { name: 'Grace', email: 'grace@example.com' }, 'global')

    expect(await readIdentity(runner, second.path)).toEqual({
      name: 'Grace',
      email: 'grace@example.com'
    })
  })
})
