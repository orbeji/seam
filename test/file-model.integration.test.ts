// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest'
import { applyHunks, buildFileModel, reverseHunks, type PlacedHunk } from '../src/core/diff'
import { GitRunner, readFileModel } from '../src/core/git'
import type { TextLines } from '../src/core/text'
import { createRepository, type SampleRepository } from './fixtures/repository'

/** A tiny deterministic generator, so a failing case can be replayed. */
function generator(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

const ALPHABET = ['a', 'b', 'c', 'd', 'e', 'f', ' empty', 'tab\t']

/** A short random file, with repeated lines so the diff has real choices. */
function randomLines(random: () => number): string[] {
  const length = Math.floor(random() * 14)
  const lines: string[] = []
  for (let i = 0; i < length; i += 1) {
    lines.push(ALPHABET[Math.floor(random() * ALPHABET.length)] as string)
  }
  return lines
}

const placement = (placed: PlacedHunk): { start: number; lines: number } => ({
  start: placed.start,
  lines: placed.lines
})

describe('building the model from HEAD, the index and the working copy', () => {
  it('rebuilds all three versions from the two sets of hunks', () => {
    const random = generator(20261017)
    for (let round = 0; round < 500; round += 1) {
      const head = randomLines(random)
      const index = randomLines(random)
      const worktree = randomLines(random)
      const model = buildFileModel(lines(head), lines(index), lines(worktree))

      // HEAD against the index, forwards and back.
      expect(applyHunks(head, index, model.staged)).toEqual(index)
      expect(applyHunks(index, head, reverseHunks(model.staged))).toEqual(head)

      // The index against the working copy, forwards and back.
      expect(applyHunks(index, worktree, model.unstaged)).toEqual(worktree)
      expect(applyHunks(worktree, index, reverseHunks(model.unstaged))).toEqual(index)
    }
  })

  it('keeps every prepared marker on the working copy, in order', () => {
    const random = generator(7)
    for (let round = 0; round < 500; round += 1) {
      const worktree = randomLines(random)
      const model = buildFileModel(
        lines(randomLines(random)),
        lines(randomLines(random)),
        lines(worktree)
      )

      // The doc's guarantee: a prepared hunk is never dropped, only placed.
      expect(model.stagedInWorktree).toHaveLength(model.staged.length)

      let previous = 0
      for (const placed of model.stagedInWorktree) {
        expect(placed.start).toBeGreaterThanOrEqual(0)
        expect(placed.lines).toBeGreaterThanOrEqual(0)
        expect(placed.start + placed.lines).toBeLessThanOrEqual(worktree.length)
        expect(placed.start).toBeGreaterThanOrEqual(previous)
        previous = placed.start
      }
    }
  })

  it('marks the prepared lines directly when the working copy is unchanged', () => {
    const random = generator(99)
    for (let round = 0; round < 200; round += 1) {
      const head = randomLines(random)
      const index = randomLines(random)
      const model = buildFileModel(lines(head), lines(index), lines(index))

      expect(model.unstaged).toEqual([])
      expect(model.stagedInWorktree.map(placement)).toEqual(
        model.staged.map((hunk) => ({ start: hunk.bStart, lines: hunk.bLines }))
      )
    }
  })
})

describe('placing a prepared hunk on the working copy', () => {
  it('keeps a prepared insertion where it is', () => {
    const head = ['a', 'b', 'c']
    const index = ['a', 'b', 'x', 'c']
    const model = buildFileModel(lines(head), lines(index), lines(index))

    expect(model.staged).toEqual([{ aStart: 2, aLines: 0, bStart: 2, bLines: 1 }])
    expect(model.stagedInWorktree.map(placement)).toEqual([{ start: 2, lines: 1 }])
  })

  it('draws a prepared deletion as a point between two lines', () => {
    const head = ['a', 'b', 'c']
    const index = ['a', 'c']
    const model = buildFileModel(lines(head), lines(index), lines(index))

    expect(model.staged).toEqual([{ aStart: 1, aLines: 1, bStart: 1, bLines: 0 }])
    expect(model.stagedInWorktree.map(placement)).toEqual([{ start: 1, lines: 0 }])
  })

  it('moves a prepared change to a point when it was rewritten afterwards', () => {
    const model = buildFileModel(
      lines(['a', 'b', 'c']),
      lines(['a', 'b!', 'c']),
      lines(['a', 'b?', 'c'])
    )

    expect(model.unstaged).toEqual([{ aStart: 1, aLines: 1, bStart: 1, bLines: 1 }])
    expect(model.stagedInWorktree.map(placement)).toEqual([{ start: 1, lines: 0 }])
  })

  it('follows a prepared insertion when the working copy edits other lines', () => {
    const model = buildFileModel(
      lines(['a', 'b', 'c']),
      lines(['a', 'b', 'x', 'c']),
      lines(['a!', 'b', 'x', 'c'])
    )

    expect(model.stagedInWorktree.map(placement)).toEqual([{ start: 2, lines: 1 }])
  })
})

/** A version built from plain line arrays, for the property tests. */
function lines(contents: readonly string[]): TextLines {
  return { lines: [...contents], finalNewline: false }
}

const repositories: SampleRepository[] = []
const runner = new GitRunner()

async function repository(): Promise<SampleRepository> {
  const repo = await createRepository()
  repositories.push(repo)
  return repo
}

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

describe('reading the model from a repository', () => {
  it('tells the prepared change from the one still to prepare', async () => {
    const repo = await repository()
    repo.write('f.txt', 'one\ntwo\n')
    await repo.git(['add', 'f.txt'])
    await repo.git(['commit', '-qm', 'base'])

    // Prepare one change, then edit the working copy again.
    repo.write('f.txt', 'one\ntwo\nthree\n')
    await repo.git(['add', 'f.txt'])
    repo.write('f.txt', 'one\nTWO\nthree\n')

    const model = await readFileModel(runner, repo.path, 'f.txt')
    expect(model).not.toBeNull()
    expect(model?.staged).toEqual([{ aStart: 2, aLines: 0, bStart: 2, bLines: 1 }])
    expect(model?.unstaged).toEqual([{ aStart: 1, aLines: 1, bStart: 1, bLines: 1 }])
    expect(model?.stagedInWorktree.map(placement)).toEqual([{ start: 2, lines: 1 }])
  })

  it('reads a file that is only in the working copy as one insertion', async () => {
    const repo = await repository()
    repo.write('fresh.txt', 'alpha\nbeta\n')

    const model = await readFileModel(runner, repo.path, 'fresh.txt')
    expect(model?.staged).toEqual([])
    expect(model?.unstaged).toEqual([{ aStart: 0, aLines: 0, bStart: 0, bLines: 2 }])
  })
})
