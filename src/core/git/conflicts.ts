// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { autoResolve, createMerge } from '../merge'
import { decodeText, isBinary, joinText, splitText } from '../text'
import type {
  ConflictAcceptOutcome,
  ConflictCode,
  ConflictEntry,
  ConflictSide,
  ConflictSides,
  ConflictState,
  GitOperation,
  GitSide,
  Modes,
  ResolveSimpleOutcome,
  UnmergedEntry
} from '../../shared/git'
import { GitError } from './errors'
import { detectOperation } from './operation'
import type { GitRunner } from './runner'
import { readStatus } from './status'
import { readVersion, writeWorktreeFile } from './versions'

/**
 * The conflict list and the actions that resolve a file without opening an
 * editor: accepting a side, deleting a file, resolving the simple conflicts in
 * bulk and undoing a resolution.
 *
 * Git keeps the three stages of a resolved conflict in its resolve-undo data,
 * which is what makes "Revert conflict resolution" work even after Seam is
 * restarted. A `checkout --merge` restores the file and the stages when both
 * sides of the text exist; for a deletion conflict there is no such command, so
 * this module writes the recorded stages back and rebuilds the markers.
 */

/** The three stages as Git numbers them: base, ours, theirs. */
const STAGE_SOURCES = ['stage1', 'stage2', 'stage3'] as const

/** A mode of `000000` in an unmerged entry means that side deleted the file. */
const ABSENT_MODE = '000000'

/** One record of `git ls-files --resolve-undo`. */
export interface ResolveUndoEntry {
  readonly mode: string
  readonly sha: string
  readonly stage: 1 | 2 | 3
}

/** How the two sides are mapped onto Yours and Theirs. */
const DIRECT_MAPPING: Pick<ConflictSides, 'yours' | 'theirs'> = {
  yours: 'ours',
  theirs: 'theirs'
}

const REBASE_MAPPING: Pick<ConflictSides, 'yours' | 'theirs'> = {
  yours: 'theirs',
  theirs: 'ours'
}

/**
 * Parses `git ls-files --resolve-undo -z`: the same record shape as `-s`, one
 * NUL-terminated record per index entry. The path is everything after the first
 * tab, so a path may itself contain a tab.
 */
export function parseResolveUndo(output: Buffer | string): Map<string, ResolveUndoEntry[]> {
  const text = typeof output === 'string' ? output : output.toString('utf8')
  const records = new Map<string, ResolveUndoEntry[]>()

  for (const record of text.split('\0')) {
    if (record === '') continue
    const tab = record.indexOf('\t')
    if (tab === -1) {
      throw new GitError(`Malformed resolve-undo record: ${record}`)
    }
    const [mode, sha, stage] = record.slice(0, tab).split(' ')
    const path = record.slice(tab + 1)
    if (mode === undefined || sha === undefined || stage === undefined) {
      throw new GitError(`Malformed resolve-undo record: ${record}`)
    }
    if (stage !== '1' && stage !== '2' && stage !== '3') {
      throw new GitError(`Unsupported resolve-undo stage: ${record}`)
    }
    const entries = records.get(path) ?? []
    entries.push({ mode, sha, stage: Number(stage) as 1 | 2 | 3 })
    records.set(path, entries)
  }

  return records
}

/** Reads the resolve-undo data, optionally only for one path. */
export async function readResolveUndo(
  runner: GitRunner,
  repo: string,
  path?: string
): Promise<Map<string, ResolveUndoEntry[]>> {
  const args = ['--literal-pathspecs', 'ls-files', '--resolve-undo', '-z']
  if (path !== undefined) args.push('--', path)
  const result = await runner.runOrThrow(args, { cwd: repo, readOnly: true })
  return parseResolveUndo(result.stdout)
}

/** The conflict code implied by the stages Git kept for a resolved file. */
export function codeFromStages(stages: readonly number[]): ConflictCode {
  const present = new Set(stages)
  const base = present.has(1)
  const ours = present.has(2)
  const theirs = present.has(3)

  if (base && ours && theirs) return 'UU'
  if (ours && theirs) return 'AA'
  if (base && ours) return 'UD'
  if (base && theirs) return 'DU'
  if (base) return 'DD'
  if (ours) return 'AU'
  if (theirs) return 'UA'
  throw new GitError(`Unsupported set of merge stages: ${[...present].join(', ')}`)
}

/** The three modes of a resolved file, with `000000` for a missing stage. */
function modesFromStages(stages: readonly ResolveUndoEntry[]): Modes {
  const mode = (stage: number): string =>
    stages.find((entry) => entry.stage === stage)?.mode ?? ABSENT_MODE
  return { head: mode(1), index: mode(2), worktree: mode(3) }
}

function stageMode(modes: Modes, gitSide: GitSide): string {
  return gitSide === 'ours' ? modes.index : modes.worktree
}

/** Whether the side Git calls `gitSide` has a file in the conflict. */
function sideExists(modes: Modes, gitSide: GitSide): boolean {
  return stageMode(modes, gitSide) !== ABSENT_MODE
}

/** A SHA-256 of the working copy, or null when it does not exist. */
async function worktreeFingerprint(repo: string, path: string): Promise<string | null> {
  try {
    const bytes = await readFile(join(repo, path))
    return createHash('sha256').update(bytes).digest('hex')
  } catch {
    return null
  }
}

/** Reads the working copy, telling an absent file apart from an empty one. */
async function readWorktree(repo: string, path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(join(repo, path))
  } catch {
    return null
  }
}

/**
 * Whether a conflict is binary. The working copy is what the user sees, so it
 * is checked first; a deletion leaves no working copy, and then the stages
 * decide.
 */
async function isBinaryConflict(
  runner: GitRunner,
  repo: string,
  path: string,
  modes: Modes,
  worktree: Uint8Array | null
): Promise<boolean> {
  if (worktree !== null) return isBinary(worktree)

  const stageModes = [modes.head, modes.index, modes.worktree]
  for (const [index, source] of STAGE_SOURCES.entries()) {
    if (stageModes[index] === ABSENT_MODE) continue
    const version = await readVersion(runner, repo, path, source)
    if (version.bytes !== null && isBinary(version.bytes)) return true
  }

  return false
}

/** Builds one entry, reading the working copy once for its fingerprint. */
async function describeEntry(
  runner: GitRunner,
  repo: string,
  path: string,
  code: ConflictCode,
  modes: Modes,
  resolved: boolean
): Promise<ConflictEntry> {
  const worktree = await readWorktree(repo, path)
  const fingerprint = worktree === null ? null : createHash('sha256').update(worktree).digest('hex')

  return {
    path,
    code,
    resolved,
    modes,
    binary: await isBinaryConflict(runner, repo, path, modes, worktree),
    fingerprint
  }
}

/** The branch of the working tree, or the abbreviated commit when detached. */
async function branchLabel(runner: GitRunner, repo: string): Promise<string> {
  const branch = await runner.run(['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repo,
    readOnly: true
  })
  const name = branch.stdout.toString('utf8').trim()
  if (branch.code === 0 && name !== '' && name !== 'HEAD') return name

  const short = await runner.run(['rev-parse', '--short', 'HEAD'], {
    cwd: repo,
    readOnly: true
  })
  const id = short.stdout.toString('utf8').trim()
  return id === '' ? 'HEAD' : id
}

/** A branch name when `rev` is a branch tip, otherwise `shortId subject`. */
async function refOrCommitLabel(runner: GitRunner, repo: string, rev: string): Promise<string> {
  const named = await runner.run(['name-rev', '--name-only', '--refs=refs/heads/*', rev], {
    cwd: repo,
    readOnly: true
  })
  const name = named.stdout.toString('utf8').trim()
  if (named.code === 0 && name !== '') return name

  const commit = await runner.run(['log', '-1', '--format=%h %s', rev], {
    cwd: repo,
    readOnly: true
  })
  const label = commit.stdout.toString('utf8').trim()
  return commit.code === 0 && label !== '' ? label : rev
}

/** A short id and subject, for a commit that is not a branch tip. */
async function commitLabel(runner: GitRunner, repo: string, rev: string): Promise<string> {
  const commit = await runner.run(['log', '-1', '--format=%h %s', rev], {
    cwd: repo,
    readOnly: true
  })
  const label = commit.stdout.toString('utf8').trim()
  return commit.code === 0 && label !== '' ? label : rev
}

/** Where Git keeps a state file, following worktrees and submodules. */
async function gitPath(runner: GitRunner, repo: string, name: string): Promise<string> {
  const result = await runner.runOrThrow(['rev-parse', '--git-path', name], {
    cwd: repo,
    readOnly: true
  })
  const path = result.stdout.toString('utf8').trim()
  return isAbsolute(path) ? path : resolve(repo, path)
}

/** Reads a state file, or null when the file does not exist. */
async function readGitFile(runner: GitRunner, repo: string, name: string): Promise<string | null> {
  try {
    const text = await readFile(await gitPath(runner, repo, name), 'utf8')
    const value = text.trim()
    return value === '' ? null : value
  } catch {
    return null
  }
}

/** The commit a rebase stopped on, and the base it is being replayed onto. */
async function rebaseLabels(
  runner: GitRunner,
  repo: string
): Promise<{ stopped: string; onto: string } | null> {
  const stopped =
    (await readGitFile(runner, repo, 'rebase-merge/stopped-sha')) ??
    (await readGitFile(runner, repo, 'rebase-merge/orig-head')) ??
    (await readGitFile(runner, repo, 'rebase-apply/original-commit')) ??
    (await readGitFile(runner, repo, 'rebase-apply/orig-head'))
  const onto =
    (await readGitFile(runner, repo, 'rebase-merge/onto')) ??
    (await readGitFile(runner, repo, 'rebase-apply/onto'))

  if (stopped === null && onto === null) return null
  return { stopped: stopped ?? 'HEAD', onto: onto ?? 'HEAD' }
}

/**
 * Reads the name of each side of the operation in progress. The mapping is the
 * one the phase fixes: everywhere but a rebase, Yours is Git's `ours`; during a
 * rebase Git's `ours` is the base being rebased onto, so Yours is Git's
 * `theirs` (the commit being replayed).
 */
export async function readConflictSides(
  runner: GitRunner,
  repo: string,
  operation: GitOperation | null
): Promise<ConflictSides> {
  if (operation === 'rebase') {
    const labels = await rebaseLabels(runner, repo)
    if (labels !== null) {
      const [yoursLabel, theirsLabel] = await Promise.all([
        commitLabel(runner, repo, labels.stopped),
        refOrCommitLabel(runner, repo, labels.onto)
      ])
      return { operation, yoursLabel, theirsLabel, ...REBASE_MAPPING }
    }
    return {
      operation,
      yoursLabel: await branchLabel(runner, repo),
      theirsLabel: 'HEAD',
      ...REBASE_MAPPING
    }
  }

  const ours = await branchLabel(runner, repo)
  if (operation === 'merge') {
    const head = (await readGitFile(runner, repo, 'MERGE_HEAD'))?.split('\n')[0] ?? 'HEAD'
    return {
      operation,
      yoursLabel: ours,
      theirsLabel: await refOrCommitLabel(runner, repo, head),
      ...DIRECT_MAPPING
    }
  }

  if (operation === 'cherry-pick' || operation === 'revert') {
    const name = operation === 'cherry-pick' ? 'CHERRY_PICK_HEAD' : 'REVERT_HEAD'
    const rev = (await readGitFile(runner, repo, name)) ?? 'HEAD'
    return {
      operation,
      yoursLabel: ours,
      theirsLabel: await commitLabel(runner, repo, rev),
      ...DIRECT_MAPPING
    }
  }

  // A stash pop leaves no marker: the operation is null and the unmerged
  // entries are the only sign of it.
  return {
    operation,
    yoursLabel: ours,
    theirsLabel: 'stash',
    ...DIRECT_MAPPING
  }
}

/**
 * Reads everything the conflicts dialog shows. Unresolved files come from the
 * status; resolved ones come from Git's resolve-undo data, which is also what
 * makes them revertible.
 */
export async function readConflictState(runner: GitRunner, repo: string): Promise<ConflictState> {
  const [status, undo, operation] = await Promise.all([
    readStatus(runner, repo),
    readResolveUndo(runner, repo),
    detectOperation(runner, repo)
  ])

  const unresolved = status.entries.filter(
    (entry): entry is UnmergedEntry => entry.kind === 'unmerged'
  )
  const unresolvedPaths = new Set(unresolved.map((entry) => entry.path))

  const entries: ConflictEntry[] = []
  for (const entry of unresolved) {
    entries.push(await describeEntry(runner, repo, entry.path, entry.xy, entry.modes, false))
  }

  for (const [path, stages] of undo) {
    if (unresolvedPaths.has(path)) continue
    entries.push(
      await describeEntry(
        runner,
        repo,
        path,
        codeFromStages(stages.map((entry) => entry.stage)),
        modesFromStages(stages),
        true
      )
    )
  }

  entries.sort((a, b) => Number(a.resolved) - Number(b.resolved) || a.path.localeCompare(b.path))

  return {
    entries,
    sides: await readConflictSides(runner, repo, operation)
  }
}

/** The Git side behind a Yours/Theirs choice, according to the operation. */
export function gitSideOf(sides: ConflictSides, side: ConflictSide): GitSide {
  return side === 'yours' ? sides.yours : sides.theirs
}

/** A path Git refused to touch, with what it printed. */
function commandError(args: readonly string[], stderr: string): GitError {
  return new GitError(`git ${args.join(' ')} failed: ${stderr.trim()}`)
}

/**
 * Accepts one side of an unresolved file. When the chosen side deleted the
 * file, the resolution is to remove it; otherwise Git checks the side out and
 * the path is staged, which clears the unmerged entry.
 *
 * Accepting overwrites the working copy, so the caller passes the fingerprint
 * the dialog saw. A mismatch asks for confirmation instead of discarding a file
 * the user edited meanwhile.
 */
export async function acceptConflict(
  runner: GitRunner,
  repo: string,
  path: string,
  side: ConflictSide,
  fingerprint: string | null,
  force = false
): Promise<ConflictAcceptOutcome> {
  const status = await readStatus(runner, repo)
  const entry = status.entries.find(
    (candidate): candidate is UnmergedEntry =>
      candidate.kind === 'unmerged' && candidate.path === path
  )
  if (entry === undefined) {
    throw new GitError(`${path} is not an unresolved conflict.`)
  }

  const operation = await detectOperation(runner, repo)
  const sides = await readConflictSides(runner, repo, operation)
  const gitSide = gitSideOf(sides, side)

  if (sideExists(entry.modes, gitSide)) {
    if (!force && (await worktreeFingerprint(repo, path)) !== fingerprint) {
      return { needsConfirmation: true }
    }
    await runner.runOrThrow(['--literal-pathspecs', 'checkout', `--${gitSide}`, '--', path], {
      cwd: repo
    })
    await runner.runOrThrow(['--literal-pathspecs', 'add', '--', path], { cwd: repo })
  } else {
    await runner.runOrThrow(['--literal-pathspecs', 'rm', '--', path], { cwd: repo })
  }

  return { needsConfirmation: false }
}

/**
 * Resolves every text conflict the word-level merge can settle, and leaves the
 * rest untouched. Binary files and deletion conflicts have no three-pane text
 * to merge, so they wait for a person.
 */
export async function resolveSimpleConflicts(
  runner: GitRunner,
  repo: string
): Promise<ResolveSimpleOutcome> {
  const status = await readStatus(runner, repo)
  const conflicts = status.entries.filter(
    (entry): entry is UnmergedEntry => entry.kind === 'unmerged'
  )

  let resolved = 0
  for (const entry of conflicts) {
    if (!sideExists(entry.modes, 'ours') || !sideExists(entry.modes, 'theirs')) continue

    const [base, ours, theirs, worktree] = await Promise.all([
      readVersion(runner, repo, entry.path, 'stage1'),
      readVersion(runner, repo, entry.path, 'stage2'),
      readVersion(runner, repo, entry.path, 'stage3'),
      readVersion(runner, repo, entry.path, 'worktree')
    ])
    const versions = [base, ours, theirs, worktree]
    if (versions.some((version) => version.bytes !== null && isBinary(version.bytes))) {
      continue
    }

    const baseLines = base.bytes === null ? [] : splitText(decodeText(base.bytes)).lines
    const oursLines = ours.bytes === null ? [] : splitText(decodeText(ours.bytes)).lines
    const theirsLines = theirs.bytes === null ? [] : splitText(decodeText(theirs.bytes)).lines
    const lines = autoResolve(createMerge(baseLines, oursLines, theirsLines))
    if (lines === null) continue

    const current = worktree.bytes === null ? null : splitText(decodeText(worktree.bytes))
    const content = joinText({
      lines,
      finalNewline: lines.length > 0 && current !== null ? current.finalNewline : false
    })
    await writeWorktreeFile(runner, repo, entry.path, content)
    await runner.runOrThrow(['--literal-pathspecs', 'add', '--', entry.path], { cwd: repo })
    resolved += 1
  }

  return { resolved, remaining: conflicts.length - resolved }
}

/** Reads a stage's bytes, using null for a stage the conflict did not have. */
async function stageBytes(
  runner: GitRunner,
  repo: string,
  path: string,
  source: (typeof STAGE_SOURCES)[number]
): Promise<Uint8Array | null> {
  return (await readVersion(runner, repo, path, source)).bytes
}

/** Writes staged content through the same filters Git applies on checkout. */
async function writeStageContent(
  runner: GitRunner,
  repo: string,
  path: string,
  base: Uint8Array | null,
  ours: Uint8Array | null,
  theirs: Uint8Array | null
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'seam-merge-'))
  try {
    const files = [ours, base, theirs].map((_bytes, index) => join(directory, `${index}.txt`))
    await Promise.all(
      files.map((file, index) => writeFile(file, [ours, base, theirs][index] ?? new Uint8Array()))
    )
    const result = await runner.run(
      ['merge-file', '-p', '-L', 'ours', '-L', 'base', '-L', 'theirs', ...files],
      { cwd: repo, readOnly: true }
    )
    // 0 is a clean merge, 1 the expected conflicts; anything else is a failure.
    if (result.code !== 0 && result.code !== 1) {
      throw commandError(['merge-file'], result.stderr)
    }
    await writeWorktreeFile(runner, repo, path, result.stdout.toString('utf8'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/**
 * Puts a resolved file back into conflict. Both sides of a text file come back
 * with `checkout --merge`, which Git supports exactly for that. A deletion
 * conflict has no such command, so the recorded stages are written back with
 * `update-index` and the markers rebuilt from the stages that remain.
 */
export async function revertConflict(runner: GitRunner, repo: string, path: string): Promise<void> {
  const undo = await readResolveUndo(runner, repo, path)
  const stages = undo.get(path)
  if (stages === undefined || stages.length === 0) {
    throw new GitError(`${path} has no conflict resolution to undo.`)
  }

  const present = new Set(stages.map((entry) => entry.stage))
  if (present.has(2) && present.has(3)) {
    await runner.runOrThrow(['--literal-pathspecs', 'checkout', '--merge', '--', path], {
      cwd: repo
    })
    return
  }

  await runner.runOrThrow(['--literal-pathspecs', 'update-index', '--force-remove', '--', path], {
    cwd: repo
  })
  const input = stages
    .map((entry) => `${entry.mode} ${entry.sha} ${entry.stage}\t${path}\0`)
    .join('')
  await runner.runOrThrow(['update-index', '-z', '--index-info'], {
    cwd: repo,
    stdin: input
  })

  // With a stage on a side there is text to merge back; the absent side is an
  // empty file, which is how the deletion looks to `merge-file`. A DD conflict
  // has only the base, and no working copy.
  if (present.has(2) || present.has(3)) {
    const [base, ours, theirs] = await Promise.all([
      stageBytes(runner, repo, path, 'stage1'),
      stageBytes(runner, repo, path, 'stage2'),
      stageBytes(runner, repo, path, 'stage3')
    ])
    const binary = [base, ours, theirs].some((bytes) => bytes !== null && isBinary(bytes))
    if (!binary) {
      await writeStageContent(runner, repo, path, base, ours, theirs)
    }
  } else {
    await rm(join(repo, path), { force: true })
  }
}
