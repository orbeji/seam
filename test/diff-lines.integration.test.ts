// SPDX-License-Identifier: MIT

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { diffLines, type LineHunk } from '../src/core/diff'

describe('compared with git diff', () => {
  const base = mkdtempSync(join(tmpdir(), 'seam-diff-'))
  let file = 0

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
  })

  /** The hunks git reports for two files, in the same shape as ours. */
  function gitHunks(a: readonly string[], b: readonly string[]): LineHunk[] {
    const left = join(base, `a${file}`)
    const right = join(base, `b${file}`)
    file += 1
    // An empty array is an empty file, not one empty line.
    writeFileSync(left, a.length === 0 ? '' : `${a.join('\n')}\n`)
    writeFileSync(right, b.length === 0 ? '' : `${b.join('\n')}\n`)

    let output = ''
    try {
      output = execFileSync(
        'git',
        ['-c', 'core.quotepath=false', 'diff', '--no-index', '--unified=0', '--', left, right],
        { encoding: 'utf8' }
      )
    } catch (error) {
      output = (error as { stdout?: string }).stdout ?? ''
    }

    const hunks: LineHunk[] = []
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm
    for (const match of output.matchAll(header)) {
      // Git prints a 1-based start for a range with lines, but a 0-based
      // position when the range is empty, which is how it points at a pure
      // insertion or deletion.
      const aLines = match[2] === undefined ? 1 : Number(match[2])
      const bLines = match[4] === undefined ? 1 : Number(match[4])
      hunks.push({
        aStart: aLines === 0 ? Number(match[1]) : Number(match[1]) - 1,
        aLines,
        bStart: bLines === 0 ? Number(match[3]) : Number(match[3]) - 1,
        bLines
      })
    }
    return hunks
  }

  // Fixtures use distinct lines, so the minimal edit script is unambiguous and
  // git and Myers agree. Inputs with repeated lines may be aligned differently.
  const cases: Array<[string[], string[]]> = [
    [
      ['a', 'b', 'c'],
      ['a', 'b', 'c']
    ],
    [
      ['a', 'b', 'c'],
      ['a', 'B', 'c']
    ],
    [
      ['a', 'b', 'c'],
      ['a', 'c']
    ],
    [
      ['a', 'c'],
      ['a', 'b', 'c']
    ],
    [
      ['a', 'b', 'c', 'd', 'e'],
      ['a', 'B', 'c', 'd', 'E']
    ],
    [
      ['a', 'b', 'c', 'd'],
      ['a', 'd']
    ],
    [
      ['a', 'd'],
      ['a', 'b', 'c', 'd']
    ],
    [
      ['one', 'two', 'three'],
      ['zero', 'one', 'two', 'three', 'four']
    ],
    [['one', 'two', 'three'], []],
    [[], ['one', 'two', 'three']],
    [
      ['x', 'y', 'z', 'w'],
      ['x', 'z', 'w', 'v']
    ],
    [
      ['café', 'niño'],
      ['café', 'nino', 'niño']
    ]
  ]

  it.each(cases)('agrees for %j against %j', (a, b) => {
    expect(diffLines(a, b, 'none')).toEqual(gitHunks(a, b))
  })
})
