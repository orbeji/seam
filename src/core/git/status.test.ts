// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { summarizeChanges } from './changes'
import { GitError } from './errors'
import {
  parseStatus,
  type ConflictCode,
  type OrdinaryEntry,
  type RenamedEntry,
  type UnmergedEntry
} from './status'

const NUL = '\0'

/** Joins records the way `git status --porcelain=v2 -z` does. */
function stream(...records: string[]): string {
  return records.join(NUL) + NUL
}

// Captured from real `git status --porcelain=v2 --branch -z --untracked-files=all`
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
    expect(status.entries.map((entry) => entry.kind)).toEqual([
      'ordinary',
      'ordinary',
      'renamed',
      'ordinary',
      'untracked',
      'untracked'
    ])
  })

  it('splits the XY code into the index and worktree letters', () => {
    const worktreeOnly = status.entries[0] as OrdinaryEntry
    expect(worktreeOnly.x).toBe('.')
    expect(worktreeOnly.y).toBe('M')
    expect(worktreeOnly.path).toBe('a.txt')
    expect(worktreeOnly.modes).toEqual({
      head: '100644',
      index: '100644',
      worktree: '100644'
    })

    const stagedDeletion = status.entries[1] as OrdinaryEntry
    expect(stagedDeletion.x).toBe('D')
    expect(stagedDeletion.y).toBe('.')
    expect(stagedDeletion.modes).toEqual({
      head: '100644',
      index: '000000',
      worktree: '000000'
    })
  })

  it('keeps the source path and score of a rename', () => {
    const rename = status.entries[2] as RenamedEntry
    expect(rename.kind).toBe('renamed')
    expect(rename.x).toBe('R')
    expect(rename.path).toBe('c2.txt')
    expect(rename.origPath).toBe('c.txt')
    expect(rename.score).toBe(100)
  })

  it('keeps paths with spaces intact', () => {
    const untracked = status.entries.filter((entry) => entry.kind === 'untracked')
    expect(untracked.map((entry) => entry.path)).toEqual(['e with space.txt', 'e.txt'])
  })

  it('keeps accented path bytes', () => {
    const parsed = parseStatus(stream('? café.txt', '1 .M N... 100644 100644 100644 a b año.txt'))
    expect(parsed.entries.map((entry) => entry.path)).toEqual(['café.txt', 'año.txt'])
  })

  it('accepts a Buffer, as the runner hands it over', () => {
    expect(parseStatus(Buffer.from(MIXED)).entries).toHaveLength(6)
  })

  it('reports a branch with no headers as oid/head null and no upstream', () => {
    expect(status.branch).toEqual({ oid: null, head: null })
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

  it('classifies both-added and both-modified conflicts by their code', () => {
    const unmerged = status.entries.filter(
      (entry): entry is UnmergedEntry => entry.kind === 'unmerged'
    )
    expect(unmerged.map((entry) => [entry.path, entry.xy])).toEqual([
      ['addboth.txt', 'AA'],
      ['both.txt', 'UU']
    ])
  })

  it('keeps the three merge-stage modes of a conflict', () => {
    const added = status.entries.find((entry) => entry.path === 'addboth.txt') as UnmergedEntry
    expect(added.modes).toEqual({ head: '000000', index: '100644', worktree: '100644' })
  })

  it('maps every conflict code the spec lists', () => {
    const codes: ConflictCode[] = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']
    for (const code of codes) {
      const record = `u ${code} N... 100644 100644 100644 100644 a b c path.txt`
      const parsed = parseStatus(stream(record)).entries[0] as UnmergedEntry
      expect(parsed.xy).toBe(code)
    }
  })

  it('recognises the initial and detached header markers', () => {
    const initial = parseStatus(stream('# branch.oid (initial)', '# branch.head main'))
    expect(initial.branch.oid).toBeNull()
    expect(initial.branch.head).toBe('main')

    const detached = parseStatus(stream('# branch.head (detached)'))
    expect(detached.branch.head).toBeNull()
  })
})

describe('summarizeChanges', () => {
  it('groups ordinary entries into staged and unstaged by their letters', () => {
    const summary = summarizeChanges(parseStatus(MIXED))
    expect(summary.staged.map((entry) => entry.path)).toEqual(['b.txt', 'c2.txt', 'd.txt'])
    expect(summary.unstaged.map((entry) => entry.path)).toEqual(['a.txt'])
    expect(summary.untracked.map((entry) => entry.path)).toEqual(['e with space.txt', 'e.txt'])
    expect(summary.conflicts).toEqual([])
  })

  it('puts an entry that changed on both sides in both lists', () => {
    const record = '1 MM N... 100644 100644 100644 a b both.txt'
    const summary = summarizeChanges(parseStatus(stream(record)))
    expect(summary.staged.map((entry) => entry.path)).toEqual(['both.txt'])
    expect(summary.unstaged.map((entry) => entry.path)).toEqual(['both.txt'])
  })

  it('keeps unmerged entries out of the staged and unstaged lists', () => {
    const summary = summarizeChanges(parseStatus(CONFLICTED))
    expect(summary.conflicts.map((entry) => entry.path)).toEqual(['addboth.txt', 'both.txt'])
    // The fixture also has two ordinary entries, which group as usual.
    expect(summary.staged.map((entry) => entry.path)).toEqual([
      'deletedbythem.txt',
      'theirsmod.txt'
    ])
    expect(summary.unstaged).toEqual([])
  })
})

describe('parseStatus: malformed input', () => {
  it('rejects an unknown record', () => {
    expect(() => parseStatus(stream('x nope'))).toThrow(GitError)
  })

  it('rejects a rename without a source path', () => {
    expect(() => parseStatus('2 R. N... 100644 100644 100644 h h R100 new.txt')).toThrow(GitError)
  })

  it('rejects a rename whose score field is not a rename or copy marker', () => {
    expect(() =>
      parseStatus(stream('2 R. N... 100644 100644 100644 h h X100 new.txt', 'old.txt'))
    ).toThrow(GitError)
  })

  it('rejects an unknown conflict code', () => {
    expect(() => parseStatus(stream('u ZZ N... 1 1 1 1 a b c p'))).toThrow(GitError)
  })

  it('rejects a record with too few fields', () => {
    expect(() => parseStatus(stream('1 .M N... 100644'))).toThrow(GitError)
  })
})
