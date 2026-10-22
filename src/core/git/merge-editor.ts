// SPDX-License-Identifier: MIT

import type { MergeApplyRequest, MergeEditorModel, DiffSide } from '../../shared/ipc'
import { decodeText, isBinary, splitText } from '../text'
import { readConflictSides } from './conflicts'
import { GitError } from './errors'
import { detectOperation } from './operation'
import type { GitRunner } from './runner'
import { readStatus } from './status'
import { readEol, readVersion, writeWorktreeFile, type EolInfo, type FileVersion } from './versions'

/**
 * The two calls behind the merge editor: reading the three stages of an
 * unresolved file, and writing the result back. The editor receives the stages
 * already ordered as Yours, base and Theirs, so a rebase does not have to swap
 * them again in the interface.
 *
 * The result starts from the common ancestor. The working copy is read as well,
 * but only for its encoding, its line endings and its final newline; the
 * conflict markers Git wrote there are never part of the result.
 */

/** The viewer's large-file threshold, repeated here so both screens agree. */
const LARGE_BYTES = 5 * 1024 * 1024
const LARGE_LINES = 50_000

function sideOf(version: FileVersion | null): DiffSide | null {
  if (version?.bytes === null || version === null) return null
  const text = splitText(decodeText(version.bytes))
  return { lines: text.lines, finalNewline: text.finalNewline }
}

/** The BOM a version carries, or plain UTF-8 when it has none. */
function encodingOf(bytes: Uint8Array | null): string {
  if (bytes === null) return 'UTF-8'
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'UTF-16 LE'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'UTF-16 BE'
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'UTF-8 BOM'
  return 'UTF-8'
}

/** The line-ending label the mockup's status bar shows. */
function eolOf(info: EolInfo | null): string {
  const value =
    info?.worktree !== undefined && info.worktree !== 'none' ? info.worktree : info?.index
  switch (value) {
    case 'lf':
      return 'LF'
    case 'crlf':
      return 'CRLF'
    case 'mixed':
      return 'Mixed'
    case 'none':
      return 'None'
    default:
      return 'LF'
  }
}

function isLarge(versions: readonly (FileVersion | null)[]): boolean {
  let lines = 0
  for (const version of versions) {
    if (version?.bytes === null || version === null) continue
    if (version.bytes.length > LARGE_BYTES) return true
    lines = Math.max(lines, splitText(decodeText(version.bytes)).lines.length)
  }
  return lines > LARGE_LINES
}

/**
 * Reads one unresolved conflict for the merge editor. A file without both
 * sides (a deletion, or a working copy that only has markers) opens read-only
 * instead of inventing lines the merge never had.
 */
export async function readMergeEditor(
  runner: GitRunner,
  repo: string,
  path: string
): Promise<MergeEditorModel> {
  const status = await readStatus(runner, repo)
  const entry = status.entries.find(
    (candidate) => candidate.kind === 'unmerged' && candidate.path === path
  )
  if (entry === undefined) {
    throw new GitError(`${path} is not an unresolved conflict.`)
  }

  const operation = await detectOperation(runner, repo)
  const sides = await readConflictSides(runner, repo, operation)
  const [base, stage2, stage3, worktree, eol] = await Promise.all([
    readVersion(runner, repo, path, 'stage1'),
    readVersion(runner, repo, path, 'stage2'),
    readVersion(runner, repo, path, 'stage3'),
    readVersion(runner, repo, path, 'worktree'),
    readEol(runner, repo, path)
  ])

  // Yours is Git's `theirs` during a rebase, and the other way round elsewhere.
  const leftVersion = sides.yours === 'ours' ? stage2 : stage3
  const rightVersion = sides.yours === 'ours' ? stage3 : stage2
  const versions = [base, leftVersion, rightVersion, worktree]
  const binary = versions.some((version) => version.bytes !== null && isBinary(version.bytes))
  const readOnly = leftVersion.bytes === null || rightVersion.bytes === null

  const worktreeSide = sideOf(worktree)
  const baseSide = sideOf(base)
  return {
    path,
    base: binary ? null : baseSide,
    left: binary ? null : sideOf(leftVersion),
    right: binary ? null : sideOf(rightVersion),
    worktree: binary ? null : worktreeSide,
    binary,
    readOnly,
    sides,
    finalNewline:
      worktreeSide?.finalNewline ??
      baseSide?.finalNewline ??
      sideOf(leftVersion)?.finalNewline ??
      false,
    encoding: encodingOf(worktree.bytes ?? stage2.bytes ?? stage3.bytes ?? base.bytes),
    eol: eolOf(eol),
    large: isLarge(versions)
  }
}

/**
 * Writes the merge editor's result through the same filters a checkout uses and,
 * when asked, stages it. Save and close leaves the file unresolved in the index;
 * Apply changes clears the unmerged stages, so the conflict list sees it as
 * resolved.
 */
export async function applyMerge(
  runner: GitRunner,
  repo: string,
  request: MergeApplyRequest
): Promise<void> {
  const status = await readStatus(runner, repo)
  const entry = status.entries.find(
    (candidate) => candidate.kind === 'unmerged' && candidate.path === request.path
  )
  if (entry === undefined) {
    throw new GitError(`${request.path} is not an unresolved conflict.`)
  }

  await writeWorktreeFile(runner, repo, request.path, request.content)
  if (request.stage) {
    await runner.runOrThrow(['--literal-pathspecs', 'add', '--', request.path], { cwd: repo })
  }
}
