// SPDX-License-Identifier: MIT

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRepository, type SampleRepository } from './fixtures/repository'

/**
 * Pins the behaviour the phase 0 spike measured (see
 * docs/spikes/fase-0-checkout-merge.md): `git checkout --merge -- <path>`
 * undoes a resolution only when the conflict kept all three stages. Phase 5
 * relies on this to pick between `checkout --merge` and rebuilding the file.
 */

const repositories: SampleRepository[] = []

async function repository(): Promise<SampleRepository> {
  const repo = await createRepository()
  repositories.push(repo)
  return repo
}

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

function contents(repo: SampleRepository, name: string): string {
  const path = join(repo.path, name)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

async function unmergedStages(repo: SampleRepository, name: string): Promise<number> {
  const out = await repo.git(['ls-files', '--unmerged', '--', name])
  return out.split('\n').filter((line) => line.trim() !== '').length
}

/** A base commit plus a `side` and a `main` change that conflict on merge. */
async function mergedConflict(
  change: (repo: SampleRepository, side: 'theirs' | 'ours') => void
): Promise<SampleRepository> {
  const repo = await repository()
  repo.write('f.txt', 'base\n')
  repo.write('g.txt', 'base\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'base'])

  await repo.git(['checkout', '-q', '-b', 'side'])
  change(repo, 'theirs')
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-qm', 'side'])

  await repo.git(['checkout', '-q', 'main'])
  change(repo, 'ours')
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-qm', 'main'])

  await repo.gitExpectingFailure(['merge', '--no-edit', 'side'])
  return repo
}

describe('git checkout --merge undoes a resolution', () => {
  it('restores a both-modified file resolved with git add', async () => {
    const repo = await mergedConflict((r, who) => r.write('f.txt', `${who}\n`))
    await repo.git(['add', 'f.txt'])

    const result = await repo.run(['checkout', '--merge', '--', 'f.txt'])

    expect(result.code).toBe(0)
    expect(contents(repo, 'f.txt')).toContain('<<<<<<<')
    expect(contents(repo, 'f.txt')).toContain('=======')
    expect(contents(repo, 'f.txt')).toContain('>>>>>>>')
    expect(await unmergedStages(repo, 'f.txt')).toBe(3)
  })

  it('restores a both-added file resolved with git add', async () => {
    const repo = await mergedConflict((r, who) => r.write('new.txt', `${who}\n`))
    await repo.git(['add', 'new.txt'])

    const result = await repo.run(['checkout', '--merge', '--', 'new.txt'])

    expect(result.code).toBe(0)
    expect(contents(repo, 'new.txt')).toContain('<<<<<<<')
    expect(await unmergedStages(repo, 'new.txt')).toBe(2)
  })

  it('cannot restore a modify/delete conflict (theirs deleted)', async () => {
    const repo = await mergedConflict((r, who) => {
      if (who === 'theirs') r.remove('g.txt')
      else r.write('g.txt', 'ours\n')
    })
    await repo.git(['rm', '-q', 'g.txt'])

    const result = await repo.run(['checkout', '--merge', '--', 'g.txt'])

    expect(result.code).not.toBe(0)
    // The wording differs between Git versions ("pathspec ... did not match"
    // on 2.30, "does not have all necessary versions" on newer ones), so only
    // check that the failure names the file.
    expect(result.stderr).toContain('g.txt')
    expect(contents(repo, 'g.txt')).toBe('')
    expect(await unmergedStages(repo, 'g.txt')).toBe(0)
  })

  it('cannot restore a delete/modify conflict (ours deleted) even when kept', async () => {
    const repo = await mergedConflict((r, who) => {
      if (who === 'theirs') r.write('g.txt', 'theirs\n')
      else r.remove('g.txt')
    })
    // Resolve by keeping their side, so the file exists before the undo attempt.
    await repo.git(['add', 'g.txt'])

    const result = await repo.run(['checkout', '--merge', '--', 'g.txt'])

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('g.txt')
    expect(await unmergedStages(repo, 'g.txt')).toBe(0)
  })
})
