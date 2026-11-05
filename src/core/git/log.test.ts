// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { parseHistoryLog, parseHistoryRefs } from './log'

describe('parseHistoryLog', () => {
  it('reads the commit fields and their parents', () => {
    const output = [
      [
        'aaaa1111',
        'aaaa111',
        'bbbb2222 cccc3333',
        'Ada Lovelace',
        'ada@example.com',
        '2026-10-26T10:20:30+02:00',
        'Merge the feature branch'
      ].join('\0'),
      [
        'bbbb2222',
        'bbbb222',
        '',
        'Grace Hopper',
        'grace@example.com',
        '2026-10-25T09:10:11+02:00',
        'Add the parser'
      ].join('\0')
    ].join('\n')

    const commits = parseHistoryLog(output)

    expect(commits).toHaveLength(2)
    expect(commits[0]).toMatchObject({
      oid: 'aaaa1111',
      shortId: 'aaaa111',
      parents: ['bbbb2222', 'cccc3333'],
      authorName: 'Ada Lovelace',
      authorEmail: 'ada@example.com',
      authorDate: '2026-10-26T10:20:30+02:00',
      subject: 'Merge the feature branch',
      refs: []
    })
    expect(commits[1]?.parents).toEqual([])
  })

  it('ignores the empty line Git leaves after the last record', () => {
    const output = [
      'aaaa1111',
      'aaaa111',
      '',
      'Ada',
      'ada@example.com',
      '2026-10-26T10:20:30Z',
      'One'
    ].join('\0')

    expect(parseHistoryLog(`${output}\n`)).toHaveLength(1)
  })
})

describe('parseHistoryRefs', () => {
  it('folds a remote-tracking ref into the local branch at the same commit', () => {
    const output = [
      ['aaaa', 'refs/heads/develop', ''].join('\0'),
      ['aaaa', 'refs/remotes/origin/develop', ''].join('\0'),
      ['aaaa', 'refs/remotes/upstream/develop', ''].join('\0'),
      ['bbbb', 'refs/heads/feature/x', ''].join('\0'),
      ['bbbb', 'refs/remotes/origin/feature/x', ''].join('\0'),
      ['cccc', 'refs/remotes/origin/only-remote', ''].join('\0'),
      ['dddd', 'refs/heads/main', ''].join('\0'),
      ['dddd', 'refs/remotes/origin/main', ''].join('\0'),
      ['eeee', 'refs/heads/release', ''].join('\0'),
      ['eeee', 'refs/remotes/origin/other', ''].join('\0')
    ].join('\n')

    const refs = parseHistoryRefs(output, 'main')

    expect(refs.get('aaaa')).toEqual([
      { name: 'develop', kind: 'branch', remotes: ['origin/develop', 'upstream/develop'] }
    ])
    expect(refs.get('bbbb')).toEqual([
      { name: 'feature/x', kind: 'branch', remotes: ['origin/feature/x'] }
    ])
    expect(refs.get('cccc')).toEqual([{ name: 'origin/only-remote', kind: 'remote' }])
    expect(refs.get('dddd')).toEqual([{ name: 'main', kind: 'head', remotes: ['origin/main'] }])
    expect(refs.get('eeee')).toEqual([
      { name: 'release', kind: 'branch' },
      { name: 'origin/other', kind: 'remote' }
    ])
  })

  it('peels annotated tags and labels branches, remotes and the current head', () => {
    const output = [
      ['aaaa', 'refs/heads/main', ''].join('\0'),
      ['bbbb', 'refs/heads/feature/x', ''].join('\0'),
      ['cccc', 'refs/remotes/origin/main', ''].join('\0'),
      ['dddd', 'refs/remotes/origin/HEAD', ''].join('\0'),
      ['tag-object', 'refs/tags/v1.0.0', 'aaaa'].join('\0'),
      ['eeee', 'refs/tags/light', ''].join('\0'),
      ['ffff', 'refs/stash', ''].join('\0')
    ].join('\n')

    const refs = parseHistoryRefs(output, 'main')

    expect(refs.get('aaaa')).toEqual([
      { name: 'v1.0.0', kind: 'tag' },
      { name: 'main', kind: 'head' }
    ])
    expect(refs.get('bbbb')).toEqual([{ name: 'feature/x', kind: 'branch' }])
    expect(refs.get('cccc')).toEqual([{ name: 'origin/main', kind: 'remote' }])
    expect(refs.get('eeee')).toEqual([{ name: 'light', kind: 'tag' }])
    expect(refs.has('dddd')).toBe(false)
    expect(refs.has('ffff')).toBe(false)
  })
})
