// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { joinText, splitText, type TextLines } from '../text'
import { buildFileModel } from './file-model'
import { type LineHunk } from './lines'
import { stageHunks, stageSelection, unstageHunks } from './stage-hunks'

/** A version built from plain line arrays, ending with a terminator. */
function lines(contents: readonly string[], finalNewline = true): TextLines {
  return { lines: [...contents], finalNewline }
}

/** A tiny deterministic generator, so a failing case can be replayed. */
function generator(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Lines with no repeats, so both diffs have one alignment and agree. */
function distinct(random: () => number, from: number): TextLines {
  const count = 1 + Math.floor(random() * 8)
  const out: string[] = []
  for (let i = 0; i < count; i += 1) out.push(`line-${from + i}`)
  return lines(out)
}

describe('staging a hunk into the index text', () => {
  it('takes the working copy lines inside the hunk and the index outside', () => {
    const index = lines(['one', 'two', 'three', 'four'])
    const worktree = lines(['one', 'TWO', 'three', 'FOUR'])
    const hunk: LineHunk = { aStart: 1, aLines: 1, bStart: 1, bLines: 1 }

    expect(stageHunks(index, worktree, [hunk])).toBe('one\nTWO\nthree\nfour\n')
  })

  it('turns a deletion into the index losing those lines', () => {
    const index = lines(['one', 'two', 'three'])
    const worktree = lines(['one', 'three'])
    const hunk: LineHunk = { aStart: 1, aLines: 1, bStart: 1, bLines: 0 }

    expect(stageHunks(index, worktree, [hunk])).toBe('one\nthree\n')
  })

  it('follows the working copy ending only when the hunk reaches the end', () => {
    // The last line loses its terminator, and staging it takes that from W.
    expect(
      stageHunks(lines(['one', 'two', 'three']), lines(['one', 'two', 'THREE'], false), [
        { aStart: 2, aLines: 1, bStart: 2, bLines: 1 }
      ])
    ).toBe('one\ntwo\nTHREE')

    // A change in the middle keeps the index's terminator, whatever W has.
    expect(
      stageHunks(lines(['one', 'two', 'three']), lines(['ONE', 'two', 'three'], false), [
        { aStart: 0, aLines: 1, bStart: 0, bLines: 1 }
      ])
    ).toBe('ONE\ntwo\nthree\n')
  })
})

describe('removing a hunk from the index text', () => {
  it('brings HEAD lines back where the prepared change replaced them', () => {
    const head = lines(['one', 'two', 'three'])
    const index = lines(['one', 'TWO', 'three'])
    const hunk: LineHunk = { aStart: 1, aLines: 1, bStart: 1, bLines: 1 }

    expect(unstageHunks(head, index, [hunk])).toBe('one\ntwo\nthree\n')
  })

  it('takes a wholly added path out of the index instead of emptying it', () => {
    const index = lines(['base', 'added'])
    const hunks: LineHunk[] = [{ aStart: 0, aLines: 0, bStart: 0, bLines: 2 }]

    expect(unstageHunks(null, index, hunks)).toBeNull()
  })

  it('keeps the rest when only one of several prepared hunks is removed', () => {
    const head = lines(['one', 'two', 'three'])
    const index = lines(['ONE', 'two', 'THREE'])
    const hunks: LineHunk[] = [{ aStart: 0, aLines: 1, bStart: 0, bLines: 1 }]

    expect(unstageHunks(head, index, hunks)).toBe('one\ntwo\nTHREE\n')
  })

  it('gives HEAD back after the change was staged and read again', () => {
    const head = lines(['one', 'two', 'three'])
    const worktree = lines(['one', 'TWO', 'three'])
    const pending = buildFileModel(head, head, worktree).unstaged

    // Prepare it, then read the model as the viewer would after a refresh.
    const prepared = splitText(stageHunks(head, worktree, pending))
    const model = buildFileModel(head, prepared, worktree)

    expect(model.staged).toEqual(pending)
    expect(unstageHunks(head, prepared, model.staged)).toBe(joinText(head))
  })
})

describe('staging and removing whole files, over random cases', () => {
  it('stages every pending hunk and removes every prepared one', () => {
    const random = generator(20261017)
    for (let round = 0; round < 500; round += 1) {
      const head = round % 7 === 0 ? null : distinct(random, round * 100)
      const index = round % 11 === 0 ? null : distinct(random, round * 100 + 40)
      const worktree = distinct(random, round * 100 + 80)
      const model = buildFileModel(head, index, worktree)

      // Staging everything pending leaves the working copy's text.
      expect(stageHunks(index, worktree, model.unstaged)).toBe(joinText(worktree))

      // Removing everything prepared leaves HEAD, or clears the index when
      // HEAD has no version of the path at all.
      if (model.staged.length > 0) {
        const back = unstageHunks(head, index, model.staged)
        if (head === null) expect(back).toBeNull()
        else expect(back).toBe(joinText(head))
      }
    }
  })

  it('leaves the hunks it was not asked about alone', () => {
    const index = lines(['one', 'two', 'three', 'four'])
    const worktree = lines(['ONE', 'two', 'three', 'FOUR'])
    const model = buildFileModel(index, index, worktree)

    const after = stageHunks(index, worktree, [model.unstaged[0] as LineHunk])
    expect(after).toBe('ONE\ntwo\nthree\nfour\n')
  })
})

describe('staging the chosen lines of a hunk', () => {
  // A modified line is a deletion plus an addition, listed index side first.
  const modified: LineHunk = { aStart: 1, aLines: 1, bStart: 1, bLines: 1 }

  it('keeps the old line when only the addition is chosen', () => {
    const index = lines(['one', 'two', 'three'])
    const worktree = lines(['one', 'TWO', 'three'])

    expect(stageSelection(index, worktree, modified, new Set([1]))).toBe('one\ntwo\nTWO\nthree\n')
  })

  it('drops the line when only the deletion is chosen', () => {
    const index = lines(['one', 'two', 'three'])
    const worktree = lines(['one', 'TWO', 'three'])

    expect(stageSelection(index, worktree, modified, new Set([0]))).toBe('one\nthree\n')
  })

  it('replaces the line when both sides are chosen', () => {
    const index = lines(['one', 'two', 'three'])
    const worktree = lines(['one', 'TWO', 'three'])

    expect(stageSelection(index, worktree, modified, new Set([0, 1]))).toBe('one\nTWO\nthree\n')
  })

  it('leaves the index alone when nothing is chosen', () => {
    const index = lines(['one', 'two', 'three'])
    const worktree = lines(['one', 'TWO', 'three'])

    expect(stageSelection(index, worktree, modified, new Set())).toBe('one\ntwo\nthree\n')
  })

  it('takes only the chosen lines of a multi-line insertion', () => {
    const index = lines(['one', 'five'])
    const worktree = lines(['one', 'A', 'B', 'C', 'five'])
    const insertion: LineHunk = { aStart: 1, aLines: 0, bStart: 1, bLines: 3 }

    // Patch line 1 of an insertion is its second working-copy line, `B`.
    expect(stageSelection(index, worktree, insertion, new Set([1]))).toBe('one\nB\nfive\n')
    expect(stageSelection(index, worktree, insertion, new Set([0, 2]))).toBe('one\nA\nC\nfive\n')
  })

  it('follows the working copy ending when the chosen lines reach the end', () => {
    // Replacing the last line takes the working copy's missing terminator.
    expect(
      stageSelection(
        lines(['one', 'two', 'three']),
        lines(['one', 'two', 'THREE'], false),
        { aStart: 2, aLines: 1, bStart: 2, bLines: 1 },
        new Set([0, 1])
      )
    ).toBe('one\ntwo\nTHREE')
  })

  it('equals staging the whole hunk when every line is chosen', () => {
    const random = generator(20261018)
    for (let round = 0; round < 500; round += 1) {
      const index = round % 11 === 0 ? null : distinct(random, round * 100)
      const worktree = distinct(random, round * 100 + 40)
      const model = buildFileModel(index, index, worktree)

      for (const hunk of model.unstaged) {
        const every = new Set<number>()
        for (let line = 0; line < hunk.aLines + hunk.bLines; line += 1) every.add(line)
        expect(stageSelection(index, worktree, hunk, every)).toBe(
          stageHunks(index, worktree, [hunk])
        )
      }
    }
  })
})
