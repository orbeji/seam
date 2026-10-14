// SPDX-License-Identifier: MIT

import type {
  BranchStatus,
  ConflictCode,
  Modes,
  OrdinaryEntry,
  RenamedEntry,
  RepoStatus,
  StatusEntry,
  UnmergedEntry
} from '../../shared/git'
import { GitError } from './errors'
import type { GitRunOptions, GitRunner } from './runner'

const CONFLICT_CODES: readonly ConflictCode[] = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']

/**
 * Splits a record into `fieldCount` fields on single spaces, keeping any spaces
 * that follow in the last field. Git's `-z` form only escapes the fixed fields,
 * so the path is everything left after them and may contain spaces.
 */
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

function conflictCode(xy: string): ConflictCode {
  if ((CONFLICT_CODES as readonly string[]).includes(xy)) {
    return xy as ConflictCode
  }
  throw new GitError(`Unknown unmerged status code: ${xy}`)
}

function modesOf(fields: readonly string[], record: string): Modes {
  return {
    head: at(fields, 3, record),
    index: at(fields, 4, record),
    worktree: at(fields, 5, record)
  }
}

function parseOrdinary(record: string): OrdinaryEntry {
  const fields = splitFields(record, 9)
  const code = at(fields, 1, record)
  return {
    kind: 'ordinary',
    x: code[0] ?? '',
    y: code[1] ?? '',
    path: at(fields, 8, record),
    modes: modesOf(fields, record)
  }
}

function parseRenamed(record: string, origPath: string): RenamedEntry {
  const fields = splitFields(record, 10)
  const code = at(fields, 1, record)
  const scoreField = at(fields, 8, record)
  if (scoreField[0] !== 'R' && scoreField[0] !== 'C') {
    throw new GitError(`Malformed rename record: ${record}`)
  }
  return {
    kind: 'renamed',
    x: code[0] ?? '',
    y: code[1] ?? '',
    path: at(fields, 9, record),
    origPath,
    score: Number(scoreField.slice(1))
  }
}

function parseUnmerged(record: string): UnmergedEntry {
  const fields = splitFields(record, 11)
  const xy = at(fields, 1, record)
  return {
    kind: 'unmerged',
    xy: conflictCode(xy),
    path: at(fields, 10, record),
    modes: modesOf(fields, record)
  }
}

function applyBranchHeader(branch: BranchStatus, record: string): void {
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
 * Parses the NUL-separated `git status --porcelain=v2 --branch -z` stream. The
 * `-z` form leaves paths unquoted, which is why the parser splits on NUL and
 * only treats spaces as separators inside the fixed fields. Ignored (`!`)
 * records never appear because the command does not ask for them.
 */
export function parseStatus(output: Buffer | string): RepoStatus {
  const text = typeof output === 'string' ? output : output.toString('utf8')
  const records = text.split('\0')
  const entries: StatusEntry[] = []
  const branch: BranchStatus = { oid: null, head: null }

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]
    if (record === undefined || record === '') continue

    switch (record[0]) {
      case '#':
        applyBranchHeader(branch, record)
        break
      case '1':
        entries.push(parseOrdinary(record))
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
        entries.push({ kind: 'untracked', path: record.slice(2) })
        break
      default:
        throw new GitError(`Unknown status record: ${record}`)
    }
  }

  return { branch, entries }
}

/**
 * The status command from the spec with `--branch` added, exactly as the phase
 * 0 chapter specifies: porcelain v2 only emits the branch headers when it is
 * present, and the commit and push screens need the upstream and the
 * ahead/behind counts.
 */
export const STATUS_ARGS = [
  'status',
  '--porcelain=v2',
  '--branch',
  '-z',
  '--untracked-files=all'
] as const

export async function readStatus(
  runner: GitRunner,
  repo: string,
  options: Omit<GitRunOptions, 'cwd'> = {}
): Promise<RepoStatus> {
  const result = await runner.runOrThrow(STATUS_ARGS, { ...options, cwd: repo, readOnly: true })
  return parseStatus(result.stdout)
}
