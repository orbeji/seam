// SPDX-License-Identifier: MIT

import { GitError } from './errors'
import type { GitRunOptions, GitRunner } from './runner'

/** The seven ways Git can leave a file unmerged, keyed by their XY code. */
export type ConflictKind =
  | 'both-modified'
  | 'both-added'
  | 'both-deleted'
  | 'added-by-us'
  | 'added-by-them'
  | 'deleted-by-us'
  | 'deleted-by-them'

export const CONFLICT_KINDS = {
  UU: 'both-modified',
  AA: 'both-added',
  DD: 'both-deleted',
  AU: 'added-by-us',
  UA: 'added-by-them',
  DU: 'deleted-by-us',
  UD: 'deleted-by-them'
} as const satisfies Record<string, ConflictKind>

export interface BranchInfo {
  /** Commit the branch points at, or null before the first commit. */
  oid: string | null
  /** Branch name, or null when HEAD is detached. */
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
}

/** An ordinary changed entry (record type `1`). */
export interface ChangedEntry {
  type: 'changed'
  /** Raw two-letter XY code, e.g. `.M` or `M.`. */
  code: string
  /** Index status letter (X): `.` when the change is not staged. */
  indexStatus: string
  /** Worktree status letter (Y): `.` when the change exists only in the index. */
  worktreeStatus: string
  submodule: string
  modeHead: string
  modeIndex: string
  modeWorktree: string
  hashHead: string
  hashIndex: string
  path: string
}

/** A renamed or copied entry (record type `2`). */
export interface RenamedEntry {
  type: 'renamed'
  code: string
  indexStatus: string
  worktreeStatus: string
  submodule: string
  modeHead: string
  modeIndex: string
  modeWorktree: string
  hashHead: string
  hashIndex: string
  operation: 'rename' | 'copy'
  /** Similarity score between 0 and 100, or null when Git omits it. */
  score: number | null
  path: string
  /** The path the file had before the rename or copy. */
  origPath: string
}

/** An unmerged entry (record type `u`). */
export interface UnmergedEntry {
  type: 'unmerged'
  /** Raw XY code, one of the seven conflict kinds. */
  code: string
  conflict: ConflictKind
  submodule: string
  modeStage1: string
  modeStage2: string
  modeStage3: string
  modeWorktree: string
  hashStage1: string
  hashStage2: string
  hashStage3: string
  path: string
}

export interface UntrackedEntry {
  type: 'untracked'
  path: string
}

export interface IgnoredEntry {
  type: 'ignored'
  path: string
}

export type StatusEntry =
  ChangedEntry | RenamedEntry | UnmergedEntry | UntrackedEntry | IgnoredEntry

export interface GitStatus {
  branch: BranchInfo
  entries: StatusEntry[]
}

function splitFields(record: string, fieldCount: number): string[] {
  const fields: string[] = []
  let start = 0
  for (let i = 0; i < fieldCount - 1; i += 1) {
    const space = record.indexOf(' ', start)
    if (space === -1) {
      throw new GitError(`Malformed status record, expected ${fieldCount} fields: ${record}`)
    }
    fields.push(record.slice(start, space))
    start = space + 1
  }
  // The last field is the rest of the record, so a path may contain spaces.
  fields.push(record.slice(start))
  return fields
}

function at(fields: readonly string[], index: number, record: string): string {
  const value = fields[index]
  if (value === undefined) {
    throw new GitError(`Malformed status record: ${record}`)
  }
  return value
}

function letters(code: string): [string, string] {
  return [code[0] ?? '', code[1] ?? '']
}

function conflictKind(code: string): ConflictKind {
  const kind = (CONFLICT_KINDS as Record<string, ConflictKind | undefined>)[code]
  if (kind === undefined) {
    throw new GitError(`Unknown unmerged status code: ${code}`)
  }
  return kind
}

function parseChanged(record: string): ChangedEntry {
  const fields = splitFields(record, 9)
  const code = at(fields, 1, record)
  const [indexStatus, worktreeStatus] = letters(code)
  return {
    type: 'changed',
    code,
    indexStatus,
    worktreeStatus,
    submodule: at(fields, 2, record),
    modeHead: at(fields, 3, record),
    modeIndex: at(fields, 4, record),
    modeWorktree: at(fields, 5, record),
    hashHead: at(fields, 6, record),
    hashIndex: at(fields, 7, record),
    path: at(fields, 8, record)
  }
}

function parseRenamed(record: string, origPath: string): RenamedEntry {
  const fields = splitFields(record, 10)
  const code = at(fields, 1, record)
  const [indexStatus, worktreeStatus] = letters(code)
  const scoreField = at(fields, 8, record)
  const scoreText = scoreField.slice(1)
  return {
    type: 'renamed',
    code,
    indexStatus,
    worktreeStatus,
    submodule: at(fields, 2, record),
    modeHead: at(fields, 3, record),
    modeIndex: at(fields, 4, record),
    modeWorktree: at(fields, 5, record),
    hashHead: at(fields, 6, record),
    hashIndex: at(fields, 7, record),
    operation: scoreField.startsWith('C') ? 'copy' : 'rename',
    score: scoreText === '' ? null : Number(scoreText),
    path: at(fields, 9, record),
    origPath
  }
}

function parseUnmerged(record: string): UnmergedEntry {
  const fields = splitFields(record, 11)
  const code = at(fields, 1, record)
  return {
    type: 'unmerged',
    code,
    conflict: conflictKind(code),
    submodule: at(fields, 2, record),
    modeStage1: at(fields, 3, record),
    modeStage2: at(fields, 4, record),
    modeStage3: at(fields, 5, record),
    modeWorktree: at(fields, 6, record),
    hashStage1: at(fields, 7, record),
    hashStage2: at(fields, 8, record),
    hashStage3: at(fields, 9, record),
    path: at(fields, 10, record)
  }
}

function applyBranchHeader(branch: BranchInfo, record: string): void {
  const space = record.indexOf(' ', 2)
  if (space === -1) return
  const key = record.slice(2, space)
  const value = record.slice(space + 1)

  switch (key) {
    case 'branch.oid':
      branch.oid = value === '(initial)' ? null : value
      break
    case 'branch.head':
      branch.head = value === '(detached)' ? null : value
      break
    case 'branch.upstream':
      branch.upstream = value
      break
    case 'branch.ab': {
      const match = /^\+(\d+) -(\d+)$/.exec(value)
      if (match) {
        branch.ahead = Number(match[1])
        branch.behind = Number(match[2])
      }
      break
    }
    default:
      break
  }
}

/**
 * Parses the NUL-separated `git status --porcelain=v2 -z` stream. The `-z`
 * form leaves paths unquoted, which is why the parser splits on NUL rather than
 * on newlines: only the fixed fields use spaces, the path is everything left.
 */
export function parseStatus(output: Buffer | string): GitStatus {
  const text = typeof output === 'string' ? output : output.toString('utf8')
  const records = text.split('\0')
  const entries: StatusEntry[] = []
  const branch: BranchInfo = { oid: null, head: null, upstream: null, ahead: 0, behind: 0 }

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]
    if (record === undefined || record === '') continue

    switch (record[0]) {
      case '#':
        applyBranchHeader(branch, record)
        break
      case '1':
        entries.push(parseChanged(record))
        break
      case '2': {
        const origPath = records[i + 1]
        if (origPath === undefined || origPath === '') {
          throw new GitError(`Rename record without a source path: ${record}`)
        }
        i += 1
        entries.push(parseRenamed(record, origPath))
        break
      }
      case 'u':
        entries.push(parseUnmerged(record))
        break
      case '?':
        entries.push({ type: 'untracked', path: record.slice(2) })
        break
      case '!':
        entries.push({ type: 'ignored', path: record.slice(2) })
        break
      default:
        throw new GitError(`Unknown status record: ${record}`)
    }
  }

  return { branch, entries }
}

/**
 * The exact command from the spec, with `--branch` added: porcelain v2 only
 * emits the branch headers when it is present, and the commit and push screens
 * need the upstream and the ahead/behind counts.
 */
export const STATUS_ARGS = [
  'status',
  '--porcelain=v2',
  '--branch',
  '--untracked-files=all',
  '-z'
] as const

export async function readStatus(
  runner: GitRunner,
  cwd: string,
  options: Omit<GitRunOptions, 'cwd'> = {}
): Promise<GitStatus> {
  const result = await runner.runOrThrow(STATUS_ARGS, { ...options, cwd })
  return parseStatus(result.stdout)
}
