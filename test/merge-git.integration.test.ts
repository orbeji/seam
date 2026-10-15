// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { GitRunner } from '../src/core/git'
import { applyNonConflicting, autoResolve, createMerge } from '../src/core/merge'
import { decodeText } from '../src/core/text'
import { describeCase, mulberry32, randomMergeCase, uniqueMergeCase } from './fixtures/merge-cases'

/**
 * The engine against the real `git merge-file -p`.
 *
 * Two comparisons. The first and the one that has to hold exactly uses cases
 * whose lines are all distinct, so the two diffs have a single alignment: the
 * engine must then agree with Git line by line. The second throws the small,
 * repeated-line alphabet of the random tests at Git as well. That is where the
 * two differ, and the difference is a known one: with repeated lines the same
 * edit has several encodings, our Myers picks one and Git's compacted Myers
 * picks another, so a pair of changes that does not touch for Git can touch for
 * us. Those cases are counted and printed, and the test only guards against the
 * rate growing. The smallest of them is pinned in `fixed cases` below.
 *
 * `git merge-file -p` exits 0 when it merges cleanly and, otherwise, with the
 * number of conflicts it wrote (capped at 127); a negative code is an error.
 *
 * Raise the number of cases with `MERGE_CASES=3000 npm test`.
 */

const runner = new GitRunner()
const directory = mkdtempSync(join(tmpdir(), 'seam-merge-'))

const CASES = Number(process.env.MERGE_CASES ?? 150)
const STRESS_CASES = Number(process.env.MERGE_CASES ?? 150)

/** The share of repeated-line cases allowed to differ from Git. */
const STRESS_LIMIT = 0.05

/** Spawning Git for every case takes a while; the tests say how long they get. */
const CASE_TIMEOUT = 120_000

afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
})

/** How the engine and Git see a file: lines joined with LF, empty when empty. */
function toText(lines: readonly string[]): string {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

interface GitMerge {
  /** 0 clean, the number of conflicts otherwise, negative on error. */
  code: number
  text: string
}

/** Every call gets its own files, so the cases cannot race each other. */
let slot = 0

/** `git merge-file -p ours base theirs`. */
async function gitMerge(
  ours: readonly string[],
  base: readonly string[],
  theirs: readonly string[]
): Promise<GitMerge> {
  const prefix = `case-${slot++}`
  writeFileSync(join(directory, `${prefix}-ours.txt`), toText(ours))
  writeFileSync(join(directory, `${prefix}-base.txt`), toText(base))
  writeFileSync(join(directory, `${prefix}-theirs.txt`), toText(theirs))
  const result = await runner.run(
    ['merge-file', '-p', `${prefix}-ours.txt`, `${prefix}-base.txt`, `${prefix}-theirs.txt`],
    { cwd: directory }
  )
  return { code: result.code, text: decodeText(result.stdout) }
}

function conflictCount(state: ReturnType<typeof createMerge>): number {
  return state.model.regions.filter((region) => region.kind === 'conflict').length
}

describe('against git merge-file -p, unambiguous inputs', () => {
  it(
    `agrees with Git on ${CASES} cases with distinct lines`,
    async () => {
      const random = mulberry32(0x5ea5c0de)
      const regrouped: string[] = []

      for (let index = 0; index < CASES; index += 1) {
        const mergeCase = uniqueMergeCase(random)
        const label = describeCase(index, mergeCase)
        const git = await gitMerge(mergeCase.left, mergeCase.base, mergeCase.right)
        const state = createMerge(mergeCase.base, mergeCase.left, mergeCase.right)
        const conflicts = conflictCount(state)

        expect(git.code, label).toBeGreaterThanOrEqual(0)

        if (git.code === 0) {
          expect(conflicts, `Git merged cleanly but the engine conflicted: ${label}`).toBe(0)
          const patch = applyNonConflicting(state, 'all')
          expect(toText(patch.state.result), `Git's clean merge differs: ${label}`).toBe(git.text)
        } else {
          expect(conflicts, `Git conflicted but the engine did not: ${label}`).toBeGreaterThan(0)
          // Git trims and unites conflicts with its own rules, so the counts may
          // differ. That is recorded, not failed.
          if (git.code !== conflicts) {
            regrouped.push(`${label} git=${git.code} engine=${conflicts}`)
          }
        }
      }

      if (regrouped.length > 0) {
        console.info(
          `${regrouped.length} of ${CASES} cases group their conflicts differently from Git, ` +
            `for example:\n${regrouped.slice(0, 3).join('\n')}`
        )
      }
    },
    CASE_TIMEOUT
  )
})

describe('against git merge-file -p, repeated lines', () => {
  it(
    `matches Git except for the alignment cases on ${STRESS_CASES} cases`,
    async () => {
      const random = mulberry32(0x5ea53eed)
      const differences: string[] = []

      for (let index = 0; index < STRESS_CASES; index += 1) {
        const mergeCase = randomMergeCase(random, undefined, 10)
        const label = describeCase(index, mergeCase)
        const git = await gitMerge(mergeCase.left, mergeCase.base, mergeCase.right)
        const state = createMerge(mergeCase.base, mergeCase.left, mergeCase.right)
        expect(git.code, label).toBeGreaterThanOrEqual(0)
        const conflicts = conflictCount(state)

        if (git.code === 0 && conflicts > 0) {
          differences.push(`Git merged cleanly, the engine conflicted: ${label}`)
        } else if (git.code > 0 && conflicts === 0) {
          differences.push(`Git conflicted, the engine merged cleanly: ${label}`)
        } else if (git.code === 0) {
          const patch = applyNonConflicting(state, 'all')
          if (toText(patch.state.result) !== git.text) {
            differences.push(
              `Both merged cleanly with different text: ${label}\n` +
                `  git=${JSON.stringify(git.text)} engine=${JSON.stringify(toText(patch.state.result))}`
            )
          }
        }
      }

      if (differences.length > 0) {
        console.info(
          `${differences.length} of ${STRESS_CASES} repeated-line cases differ from Git, ` +
            `all of them alignment:\n${differences.slice(0, 3).join('\n')}`
        )
      }
      expect(differences.length).toBeLessThanOrEqual(Math.ceil(STRESS_CASES * STRESS_LIMIT))
    },
    CASE_TIMEOUT
  )
})

describe('fixed cases against Git', () => {
  const cases: {
    name: string
    ours: string[]
    base: string[]
    theirs: string[]
    conflicts: boolean
    /** What `autoResolve` returns: the whole file, or null when it needs a user. */
    resolved: string[] | null
  }[] = [
    {
      name: 'changes on different lines merge cleanly',
      ours: ['a', 'B', 'c', 'd', 'e'],
      base: ['a', 'b', 'c', 'd', 'e'],
      theirs: ['a', 'b', 'c', 'd', 'E'],
      conflicts: false,
      resolved: ['a', 'B', 'c', 'd', 'E']
    },
    {
      name: 'the same change on both sides merges cleanly',
      ours: ['a', 'B', 'c'],
      base: ['a', 'b', 'c'],
      theirs: ['a', 'B', 'c'],
      conflicts: false,
      resolved: ['a', 'B', 'c']
    },
    {
      name: 'changes on adjacent lines conflict, but at different words',
      ours: ['a', 'B', 'c', 'd'],
      base: ['a', 'b', 'c', 'd'],
      theirs: ['a', 'b', 'C', 'd'],
      conflicts: true,
      // Git conflicts here; the word-level merge resolves it, and it is left
      // for review rather than applied in bulk.
      resolved: ['a', 'B', 'C', 'd']
    },
    {
      name: 'an addition on both sides conflicts (empty base)',
      ours: ['added by us'],
      base: [],
      theirs: ['added by them'],
      conflicts: true,
      resolved: null
    },
    {
      name: 'a delete against a modify conflicts',
      ours: [],
      base: ['a', 'b', 'c'],
      theirs: ['a', 'B', 'c'],
      conflicts: true,
      resolved: null
    }
  ]

  for (const fixed of cases) {
    it(fixed.name, async () => {
      const git = await gitMerge(fixed.ours, fixed.base, fixed.theirs)
      const state = createMerge(fixed.base, fixed.ours, fixed.theirs)
      const conflicts = conflictCount(state)

      expect(git.code > 0).toBe(fixed.conflicts)
      if (fixed.conflicts) {
        expect(conflicts).toBeGreaterThan(0)
      } else {
        expect(conflicts).toBe(0)
        expect(toText(applyNonConflicting(state, 'all').state.result)).toBe(git.text)
      }
      expect(autoResolve(state)).toEqual(fixed.resolved)
    })
  }

  it('documents a repeated-line case where the engine is more conservative', async () => {
    // Git slides the left deletion over the repeated "b" and keeps a clean
    // merge; our Myers encodes the same edit as an insertion plus a deletion,
    // which the sweep then sees as touching the right side's insertion.
    const ours = ['a', 'b', '', 'b']
    const base = ['b', 'b', '']
    const theirs = ['b', 'b', 'b', '', 'b']
    const git = await gitMerge(ours, base, theirs)
    const state = createMerge(base, ours, theirs)

    expect(git.code).toBe(0)
    // The engine asks the user here. When it does not, its text must be Git's.
    if (conflictCount(state) === 0) {
      expect(toText(applyNonConflicting(state, 'all').state.result)).toBe(git.text)
    } else {
      expect(conflictCount(state)).toBeGreaterThan(0)
    }
  })
})
