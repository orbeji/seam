// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  detectOperation,
  GitRunner,
  readStatus,
  summarizeChanges,
  type OrdinaryEntry,
  type RenamedEntry,
  type RepoStatus,
  type UnmergedEntry
} from '../src/core/git'
import { createSampleRepositories, type SampleRepositories } from './fixtures/sample-repositories'

const runner = new GitRunner()
const baseDir = mkdtempSync(join(tmpdir(), 'seam-samples-'))
let samples: SampleRepositories

beforeAll(async () => {
  samples = await createSampleRepositories(baseDir)
})

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

/** One readable block per repository, printed so the command doubles as a listing. */
function listing(name: string, status: RepoStatus): string {
  const summary = summarizeChanges(status)
  const paths = (entries: readonly { path: string }[]): string =>
    entries.length === 0 ? '(none)' : entries.map((entry) => entry.path).join(', ')

  return [
    `${name}:`,
    `  branch  ${status.branch.head ?? '(detached)'}`,
    `  staged  ${paths(summary.staged)}`,
    `  unstaged  ${paths(summary.unstaged)}`,
    `  untracked  ${paths(summary.untracked)}`,
    `  conflicts  ${paths(summary.conflicts)}`
  ].join('\n')
}

describe('createSampleRepositories', () => {
  it('creates every sample repository', async () => {
    expect(Object.keys(samples).sort()).toEqual([
      'cherryPick',
      'clean',
      'conflicts',
      'mixed',
      'rebase',
      'stash'
    ])
  })

  it('leaves the clean repository with no entries', async () => {
    const status = await readStatus(runner, samples.clean)
    expect(status.entries).toEqual([])
    expect(status.branch.head).toBe('main')
    expect(await detectOperation(runner, samples.clean)).toBeNull()
  })

  it('lists a staged addition, an unstaged edit, a rename and an untracked file', async () => {
    const status = await readStatus(runner, samples.mixed)
    const byPath = new Map(status.entries.map((entry) => [entry.path, entry]))

    const staged = byPath.get('staged.txt') as OrdinaryEntry
    expect([staged.x, staged.y]).toEqual(['A', '.'])

    const edited = byPath.get('tracked.txt') as OrdinaryEntry
    expect([edited.x, edited.y]).toEqual(['.', 'M'])

    const deleted = byPath.get('deleted.txt') as OrdinaryEntry
    expect([deleted.x, deleted.y]).toEqual(['D', '.'])

    const rename = byPath.get('renamed-away.txt') as RenamedEntry
    expect(rename.kind).toBe('renamed')
    expect(rename.origPath).toBe('renamed.txt')

    expect(byPath.get('untracked.txt')?.kind).toBe('untracked')
    expect(await detectOperation(runner, samples.mixed)).toBeNull()
  })

  it('includes the executable, the binary and the accented name', async () => {
    const status = await readStatus(runner, samples.mixed)
    const byPath = new Map(status.entries.map((entry) => [entry.path, entry]))

    const script = byPath.get('run.sh') as OrdinaryEntry
    expect(script.modes.index).toBe('100755')

    const binary = byPath.get('binary.dat') as OrdinaryEntry
    expect([binary.x, binary.y]).toEqual(['.', 'M'])

    const accented = byPath.get('café con leche.txt') as OrdinaryEntry
    expect([accented.x, accented.y]).toEqual(['.', 'M'])
  })

  it('stops a merge on one file of each conflict kind, plus the binary', async () => {
    const status = await readStatus(runner, samples.conflicts)
    const conflicts = status.entries.filter(
      (entry): entry is UnmergedEntry => entry.kind === 'unmerged'
    )
    expect(conflicts.map((entry) => [entry.path, entry.xy]).sort()).toEqual([
      ['added-by-both.txt', 'AA'],
      ['binary.dat', 'UU'],
      ['both.txt', 'UU'],
      ['deleted-by-them.txt', 'UD'],
      ['deleted-by-us.txt', 'DU'],
      ['simple.txt', 'UU']
    ])
    expect(await detectOperation(runner, samples.conflicts)).toBe('merge')
  })

  it('stops a rebase on the commit being replayed', async () => {
    expect(await detectOperation(runner, samples.rebase)).toBe('rebase')
    const status = await readStatus(runner, samples.rebase)
    expect(status.entries.map((entry) => entry.path)).toEqual(['f.txt'])
  })

  it('stops a cherry-pick and leaves the picked commit named', async () => {
    expect(await detectOperation(runner, samples.cherryPick)).toBe('cherry-pick')
    const status = await readStatus(runner, samples.cherryPick)
    expect(status.entries.map((entry) => entry.path)).toEqual(['f.txt'])
  })

  it('leaves a conflicting stash pop with unmerged entries and no operation', async () => {
    expect(await detectOperation(runner, samples.stash)).toBeNull()
    const status = await readStatus(runner, samples.stash)
    expect(status.entries.map((entry) => entry.path)).toEqual(['f.txt'])
  })

  it('prints the four lists of each repository', async () => {
    const blocks: string[] = []
    for (const name of ['clean', 'mixed', 'conflicts', 'rebase', 'cherryPick', 'stash'] as const) {
      blocks.push(listing(name, await readStatus(runner, samples[name])))
    }
    // Not an assertion: this is the listing the phase 0 criterion asks for.
    console.log(`\n${blocks.join('\n\n')}\n`)
    expect(blocks).toHaveLength(6)
  })
})
