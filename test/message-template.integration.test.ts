// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitRunner, readCommitTemplate } from '../src/core/git'
import { createRepository, type SampleRepository } from './fixtures/repository'

/**
 * The `commit.template` reader: it fills the box when there is no draft, and it
 * has to expand the same paths Git would, or the template would be found in a
 * terminal and missed in Seam.
 */

const temporaries: string[] = []
const repositories: SampleRepository[] = []

async function repository(
  options: Parameters<typeof createRepository>[0]
): Promise<SampleRepository> {
  const created = await createRepository(options)
  repositories.push(created)
  return created
}

/** A temporary directory, removed with the rest at the end of the file. */
function directory(prefix: string): string {
  const created = mkdtempSync(join(tmpdir(), prefix))
  temporaries.push(created)
  return created
}

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
  while (temporaries.length > 0) rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
})

describe('readCommitTemplate', () => {
  it('reads nothing when no template is configured', async () => {
    const repo = await repository({})
    expect(await readCommitTemplate(new GitRunner(), repo.path)).toBeNull()
  })

  it('reads the template configured with an absolute path', async () => {
    const repo = await repository({})
    const file = join(directory('seam-template-'), 'msg.txt')
    // The fixture writes inside the repository; the absolute path lives outside.
    await repo.git(['config', 'commit.template', file])
    writeFileSync(file, 'Subject from the template\n')

    expect(await readCommitTemplate(new GitRunner(), repo.path)).toBe('Subject from the template\n')
  })

  it('reads the template configured with a path in the repository', async () => {
    const repo = await repository({})
    repo.write('template.txt', 'Use this message\n')
    await repo.git(['config', 'commit.template', 'template.txt'])

    expect(await readCommitTemplate(new GitRunner(), repo.path)).toBe('Use this message\n')
  })

  it('expands a leading ~ to the home directory, as Git does', async () => {
    const home = directory('seam-template-home-')
    writeFileSync(join(home, 'message.txt'), 'From the home directory\n')
    const repo = await repository({ env: { HOME: home } })
    await repo.git(['config', 'commit.template', '~/message.txt'])

    // The reader expands `~` with Git, so a different HOME must be followed.
    expect(await readCommitTemplate(new GitRunner({ env: { HOME: home } }), repo.path)).toBe(
      'From the home directory\n'
    )
  })

  it('reads nothing when the configured file does not exist', async () => {
    const repo = await repository({})
    await repo.git(['config', 'commit.template', 'missing.txt'])

    expect(await readCommitTemplate(new GitRunner(), repo.path)).toBeNull()
  })

  it('reads nothing when the template file is empty', async () => {
    const repo = await repository({})
    repo.write('template.txt', '')
    await repo.git(['config', 'commit.template', 'template.txt'])

    expect(await readCommitTemplate(new GitRunner(), repo.path)).toBeNull()
  })
})
