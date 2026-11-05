// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { parseCommitFiles } from './commit-diff'

describe('parseCommitFiles', () => {
  it('reads statuses and paths, with the old path of a rename', () => {
    const output = [
      'M\0src/app.ts\0',
      'A\0README.md\0',
      'D\0old.txt\0',
      'R100\0before.txt\0after.txt\0',
      'C75\0copy.txt\0copy-2.txt\0',
      'T\0tool\0'
    ].join('')

    expect(parseCommitFiles(output)).toEqual([
      { path: 'src/app.ts', previousPath: null, status: 'modified' },
      { path: 'README.md', previousPath: null, status: 'added' },
      { path: 'old.txt', previousPath: null, status: 'deleted' },
      { path: 'after.txt', previousPath: 'before.txt', status: 'renamed' },
      { path: 'copy-2.txt', previousPath: 'copy.txt', status: 'copied' },
      { path: 'tool', previousPath: null, status: 'type-changed' }
    ])
  })

  it('keeps a path that holds a newline in one record', () => {
    const output = 'A\0odd\nname.txt\0'

    expect(parseCommitFiles(output)).toEqual([
      { path: 'odd\nname.txt', previousPath: null, status: 'added' }
    ])
  })

  it('returns nothing for empty output', () => {
    expect(parseCommitFiles('')).toEqual([])
  })
})
