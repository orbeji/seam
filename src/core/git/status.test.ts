// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { GitError } from './errors'
import {
  CONFLICT_KINDS,
  parseStatus,
  type ChangedEntry,
  type RenamedEntry,
  type UnmergedEntry
} from './status'

const NUL = '\0'

/** Joins records the way `git status --porcelain=v2 -z` does. */
function stream(...records: string[]): string {
  return records.join(NUL) + NUL
}

// Captured from real `git status --porcelain=v2 -z --untracked-files=all`
// output on a repository with a modification, a staged deletion, a rename, a
// staged addition and two untracked files (one with a space in its name).
const MIXED = stream(
  '1 .M N... 100644 100644 100644 814f4a422927b82f5f8a43f8fab6d3839e3983f2 814f4a422927b82f5f8a43f8fab6d3839e3983f2 a.txt',
  '1 D. N... 100644 000000 000000 af9c6fd168ea28cf99aa2c2dd9057a8b720e2262 0000000000000000000000000000000000000000 b.txt',
  '2 R. N... 100644 100644 100644 d859c29f57731cc96afb78edf8e423b41b368fec d859c29f57731cc96afb78edf8e423b41b368fec R100 c2.txt',
  'c.txt',
  '1 A. N... 000000 100644 100644 0000000000000000000000000000000000000000 3e757666cf36eca53338e520d134963a44f793f8 d.txt',
  '? e with space.txt',
  '? e.txt'
)

// Captured from a merge that conflicted on both a both-modified and a
// both-added file, with branch headers from `--branch`.
const CONFLICTED = stream(
  '# branch.oid 245362a5a63d8e5fb8a3cf0118463248a6389100',
  '# branch.head work',
  '# branch.upstream origin/work',
  '# branch.ab +1 -0',
  '1 D. N... 100644 000000 000000 df967b96a579e45a18b8251732d16804b2e56a55 0000000000000000000000000000000000000000 deletedbythem.txt',
  '1 M. N... 100644 100644 100644 df967b96a579e45a18b8251732d16804b2e56a55 cd6a47aeae6c5cdc115510997bb052c0d80cd78c theirsmod.txt',
  'u AA N... 000000 100644 100644 100644 0000000000000000000000000000000000000000 e11ce225bbe455fbc00727135cfa51c6bdebf7bf d994a3ba0815caa837fddeda224f5169e4cc8e77 addboth.txt',
  'u UU N... 100644 100644 100644 100644 df967b96a579e45a18b8251732d16804b2e56a55 b19a1e93bec1317dc6097229e12afaffbfa74dc2 950b81b7eee953d050aa05a641f8e056c85dd1bd both.txt',
  '? remote.git/'
)

describe('parseStatus: ordinary entries', () => {
  const status = parseStatus(MIXED)

  it('reads every record type in order', () => {
    expect(status.entries.map((entry) => entry.type)).toEqual([
      'changed',
      'changed',
      'renamed',
      'changed',
      'untracked',
      'untracked'
    ])
  })

  it('splits the XY code into index and worktree status', () => {
    const worktreeOnly = status.entries[0] as ChangedEntry
    expect(worktreeOnly.code).toBe('.M')
    expect(worktreeOnly.indexStatus).toBe('.')
    expect(worktreeOnly.worktreeStatus).toBe('M')
    expect(worktreeOnly.path).toBe('a.txt')
    expect(worktreeOnly.modeHead).toBe('100644')
    expect(worktreeOnly.hashHead).toBe('814f4a422927b82f5f8a43f8fab6d3839e3983f2')

    const stagedDeletion = status.entries[1] as ChangedEntry
    expect(stagedDeletion.indexStatus).toBe('D')
    expect(stagedDeletion.worktreeStatus).toBe('.')
    expect(stagedDeletion.modeWorktree).toBe('000000')
  })

  it('keeps the source path of a rename', () => {
    const rename = status.entries[2] as RenamedEntry
    expect(rename.type).toBe('renamed')
    expect(rename.operation).toBe('rename')
    expect(rename.score).toBe(100)
    expect(rename.path).toBe('c2.txt')
    expect(rename.origPath).toBe('c.txt')
  })

  it('keeps paths with spaces intact', () => {
    const untracked = status.entries.filter((entry) => entry.type === 'untracked')
    expect(untracked.map((entry) => entry.path)).toEqual(['e with space.txt', 'e.txt'])
  })

  it('accepts a Buffer, as the runner hands it over', () => {
    expect(parseStatus(Buffer.from(MIXED)).entries).toHaveLength(6)
  })

  it('reports an empty branch when no header is present', () => {
    expect(status.branch).toEqual({ oid: null, head: null, upstream: null, ahead: 0, behind: 0 })
  })
})

describe('parseStatus: headers and unmerged entries', () => {
  const status = parseStatus(CONFLICTED)

  it('reads the branch headers', () => {
    expect(status.branch).toEqual({
      oid: '245362a5a63d8e5fb8a3cf0118463248a6389100',
      head: 'work',
      upstream: 'origin/work',
      ahead: 1,
      behind: 0
    })
  })

  it('classifies both-modified and both-added conflicts', () => {
    const unmerged = status.entries.filter((entry) => entry.type === 'unmerged') as UnmergedEntry[]
    expect(unmerged.map((entry) => [entry.path, entry.conflict])).toEqual([
      ['addboth.txt', 'both-added'],
      ['both.txt', 'both-modified']
    ])
  })

  it('keeps the three stage hashes of a conflict', () => {
    const both = status.entries.find((entry) => entry.path === 'both.txt') as UnmergedEntry
    expect(both.modeStage1).toBe('100644')
    expect(both.modeStage2).toBe('100644')
    expect(both.modeStage3).toBe('100644')
    expect(both.hashStage1).toBe('df967b96a579e45a18b8251732d16804b2e56a55')
    expect(both.modeWorktree).toBe('100644')
  })

  it('maps every conflict code the spec lists', () => {
    const codes = Object.keys(CONFLICT_KINDS)
    for (const code of codes) {
      const record = `u ${code} N... 100644 100644 100644 100644 a b c path.txt`
      const parsed = parseStatus(stream(record)).entries[0] as UnmergedEntry
      expect(parsed.conflict).toBe(CONFLICT_KINDS[code as keyof typeof CONFLICT_KINDS])
    }
    expect(codes.sort()).toEqual(['AA', 'AU', 'DD', 'DU', 'UA', 'UD', 'UU'].sort())
  })

  it('recognises the initial and detached header markers', () => {
    const initial = parseStatus(stream('# branch.oid (initial)', '# branch.head main'))
    expect(initial.branch.oid).toBeNull()
    expect(initial.branch.head).toBe('main')

    const detached = parseStatus(stream('# branch.head (detached)'))
    expect(detached.branch.head).toBeNull()
  })
})

describe('parseStatus: malformed input', () => {
  it('rejects an unknown record', () => {
    expect(() => parseStatus(stream('x nope'))).toThrow(GitError)
  })

  it('rejects a rename without a source path', () => {
    expect(() => parseStatus('2 R. N... 100644 100644 100644 h h R100 new.txt')).toThrow(GitError)
  })

  it('rejects an unknown conflict code', () => {
    expect(() => parseStatus(stream('u ZZ N... 1 1 1 1 a b c p'))).toThrow(GitError)
  })

  it('rejects a record with too few fields', () => {
    expect(() => parseStatus(stream('1 .M N... 100644'))).toThrow(GitError)
  })
})
