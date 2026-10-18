// SPDX-License-Identifier: MIT

import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildFileModel, type FileModel } from '../diff'
import type { TextLines } from '../text'
import { decodeText, encodeText, isBinary, normaliseLineEndings, splitText } from '../text'
import type { GitRunner } from './runner'

/**
 * Reading the versions of a file Git keeps: `HEAD`, the index, the working copy,
 * and the three sides of a conflict. Every read goes through the real `git`
 * executable, so filters, attributes and line endings behave as in a terminal.
 */

/** Where a version of a file comes from. */
export type VersionSource = 'head' | 'index' | 'worktree' | 'stage1' | 'stage2' | 'stage3'

/** One version of a file. `bytes` is null when the version does not exist. */
export interface FileVersion {
  source: VersionSource
  /** The raw bytes, or null when the file is absent from that version. */
  bytes: Uint8Array | null
  /** Git's file mode, like `100644` or `100755`, or null when absent. */
  mode: string | null
}

/** The end-of-line facts Git reports for a path. */
export interface EolInfo {
  /** `lf`, `crlf`, `mixed` or `none`, as stored in the index. */
  index: string
  /** `lf`, `crlf`, `mixed` or `none`, as found in the working copy. */
  worktree: string
  /** The relevant `gitattributes`, empty when none apply. */
  attr: string
}

/** A blob entry as `git ls-files -s` or `git ls-tree` report it. */
interface BlobEntry {
  mode: string
  sha: string
}

/** Reads a file the way the working copy has it, or null when it is absent. */
async function readWorktree(cwd: string, path: string): Promise<FileVersion> {
  const full = join(cwd, path)
  try {
    const bytes = await readFile(full)
    const info = await stat(full)
    const executable = (info.mode & 0o111) !== 0
    return { source: 'worktree', bytes, mode: executable ? '100755' : '100644' }
  } catch {
    return { source: 'worktree', bytes: null, mode: null }
  }
}

/** The record `git ls-files -s -z` prints for one path and stage. */
async function readIndexEntry(
  runner: GitRunner,
  cwd: string,
  path: string,
  stage: string
): Promise<BlobEntry | null> {
  const result = await runner.run(['ls-files', '-s', '-z', '--', path], { cwd, readOnly: true })
  if (result.code !== 0) return null

  for (const record of result.stdout.toString('utf8').split('\0')) {
    if (record === '') continue
    const tab = record.indexOf('\t')
    if (tab === -1) continue
    const meta = record.slice(0, tab).split(' ')
    if (record.slice(tab + 1) !== path) continue
    if (meta.length < 3 || meta[2] !== stage) continue
    return { mode: meta[0] as string, sha: meta[1] as string }
  }
  return null
}

/** The record `git ls-tree -z HEAD` prints for one path. */
async function readHeadEntry(
  runner: GitRunner,
  cwd: string,
  path: string
): Promise<BlobEntry | null> {
  const result = await runner.run(['ls-tree', '-z', 'HEAD', '--', path], { cwd, readOnly: true })
  if (result.code !== 0) return null

  for (const record of result.stdout.toString('utf8').split('\0')) {
    if (record === '') continue
    const tab = record.indexOf('\t')
    if (tab === -1) continue
    const meta = record.slice(0, tab).split(' ')
    if (record.slice(tab + 1) !== path) continue
    if (meta.length < 3) continue
    return { mode: meta[0] as string, sha: meta[2] as string }
  }
  return null
}

/** Reads a blob by hash, or null when it is missing. */
async function readBlob(runner: GitRunner, cwd: string, sha: string): Promise<Uint8Array | null> {
  const result = await runner.run(['cat-file', 'blob', sha], { cwd, readOnly: true })
  if (result.code !== 0) return null
  return result.stdout
}

/**
 * Reads one version of a path. A version that does not exist comes back with
 * `bytes: null`, never as empty text, so a deleted file is told apart from an
 * empty one.
 */
export async function readVersion(
  runner: GitRunner,
  cwd: string,
  path: string,
  source: VersionSource
): Promise<FileVersion> {
  if (source === 'worktree') return readWorktree(cwd, path)

  if (source === 'head') {
    const entry = await readHeadEntry(runner, cwd, path)
    if (!entry) return { source, bytes: null, mode: null }
    return { source, bytes: await readBlob(runner, cwd, entry.sha), mode: entry.mode }
  }

  const stage = source === 'index' ? '0' : source.slice('stage'.length)
  const entry = await readIndexEntry(runner, cwd, path, stage)
  if (!entry) return { source, bytes: null, mode: null }
  return { source, bytes: await readBlob(runner, cwd, entry.sha), mode: entry.mode }
}

/** Reads the end-of-line facts Git reports for a path. */
export async function readEol(
  runner: GitRunner,
  cwd: string,
  path: string
): Promise<EolInfo | null> {
  const result = await runner.run(['ls-files', '--eol', '-z', '--', path], {
    cwd,
    readOnly: true
  })
  if (result.code !== 0) return null

  for (const record of result.stdout.toString('utf8').split('\0')) {
    if (record === '') continue
    const tab = record.indexOf('\t')
    if (tab === -1) continue
    if (record.slice(tab + 1) !== path) continue
    const fields = record.slice(0, tab).trim().split(/\s+/)
    const index = fields.find((field) => field.startsWith('i/'))?.slice(2) ?? 'none'
    const worktree = fields.find((field) => field.startsWith('w/'))?.slice(2) ?? 'none'
    const attr = fields.find((field) => field.startsWith('attr/'))?.slice('attr/'.length) ?? ''
    return { index, worktree, attr }
  }
  return null
}

/**
 * The clean filter Git applies to a path, or null when it has none. The value
 * comes from `check-attr`, which resolves the `.gitattributes` patterns the same
 * way Git does when it stores a file. A path with a filter stores something
 * other than what the working copy holds, so reading it has to go through the
 * same filter the write does.
 */
async function readFilter(runner: GitRunner, cwd: string, path: string): Promise<string | null> {
  const result = await runner.run(['check-attr', '-z', 'filter', '--', path], {
    cwd,
    readOnly: true
  })
  if (result.code !== 0) return null

  // `-z` prints three NUL-terminated fields: the path, the attribute, the value.
  const value = result.stdout.toString('utf8').split('\0')[2] ?? ''
  if (value === '' || value === 'unspecified' || value === 'unset') return null
  return value
}

/**
 * The working copy's bytes as Git would store them: the clean filter and the
 * line-ending conversion of `--path` applied, exactly as `git add` does. The
 * blob is written to the object database to read it back, which is the only way
 * Git offers to see the stored form of a working-copy file; it is the blob `git
 * add` would have written, not new content.
 */
async function storedForm(
  runner: GitRunner,
  cwd: string,
  path: string,
  bytes: Uint8Array
): Promise<Uint8Array> {
  const hashed = await runner.runOrThrow(['hash-object', '-w', `--path=${path}`, '--stdin'], {
    cwd,
    stdin: bytes
  })
  const id = hashed.stdout.toString('utf8').trim()
  const blob = await runner.runOrThrow(['cat-file', 'blob', id], { cwd, readOnly: true })
  return blob.stdout
}

/** Git's `core.autocrlf` setting, `false` when unset. */
export async function readAutocrlf(runner: GitRunner, cwd: string): Promise<string> {
  const result = await runner.run(['config', '--get', 'core.autocrlf'], { cwd, readOnly: true })
  if (result.code !== 0) return 'false'
  return result.stdout.toString('utf8').trim() || 'false'
}

function hasCarriageReturn(eol: string): boolean {
  return eol === 'crlf' || eol === 'mixed'
}

/**
 * Whether Git would turn the working copy's `CRLF` back into `LF`, so the viewer
 * should do the same. It is true when an attribute marks the file as text, or
 * when `core.autocrlf` asks for it. It is false for a file marked `-text`, and
 * for stray `CRLF` with `core.autocrlf=false`, which Git reports as a change.
 */
export function shouldNormaliseWorktree(eol: EolInfo, autocrlf: string): boolean {
  const attrs = eol.attr.split(/\s+/).filter((attr) => attr !== '')
  if (attrs.includes('-text') || attrs.includes('binary')) return false
  const forcedText =
    attrs.some((attr) => attr === 'text' || attr.startsWith('text=')) ||
    attrs.some((attr) => attr.startsWith('eol='))
  if (forcedText) return true
  return autocrlf === 'true' || autocrlf === 'input'
}

/** Two versions of a path, ready to diff against each other. */
export interface Comparison {
  /** The text of the `from` version, or null when it does not exist. */
  from: TextLines | null
  /** The text of the `to` version, or null when it does not exist. */
  to: TextLines | null
  /** The byte size of the `from` version, 0 when it does not exist. */
  fromSize: number
  /** The byte size of the `to` version, 0 when it does not exist. */
  toSize: number
  binary: boolean
  /** Whether the working copy's line endings were normalised to match a Git version. */
  normalised: boolean
}

/** Decodes and splits a version, or null when it does not exist or is binary. */
function linesOf(version: FileVersion, normalise: boolean): TextLines | null {
  if (version.bytes === null) return null
  const text = normalise
    ? normaliseLineEndings(decodeText(version.bytes))
    : decodeText(version.bytes)
  return splitText(text)
}

/**
 * Reads two versions of a path. Either side may be null when the file is only in
 * one of them. When one side is the working copy and the other is a Git version,
 * and Git stores `LF` in the index while the working copy has `CRLF` only because
 * of `core.autocrlf` or the attributes, the working copy is normalised, so the
 * file is not read as changed from end to end.
 */
export async function readComparison(
  runner: GitRunner,
  cwd: string,
  path: string,
  from: VersionSource,
  to: VersionSource
): Promise<Comparison> {
  let [fromVersion, toVersion] = await Promise.all([
    readVersion(runner, cwd, path, from),
    readVersion(runner, cwd, path, to)
  ])

  const worktreeIsFrom = from === 'worktree' && to !== 'worktree'
  const worktreeIsTo = to === 'worktree' && from !== 'worktree'

  // The working copy is read as it lies on disk. When a clean filter applies,
  // Git stores something else, so the comparison has to run on the stored form:
  // the raw text against the filtered index would read as changed end to end.
  let converted = false
  if (worktreeIsFrom || worktreeIsTo) {
    const side = worktreeIsFrom ? fromVersion : toVersion
    if (side.bytes !== null && (await readFilter(runner, cwd, path)) !== null) {
      const bytes = await storedForm(runner, cwd, path, side.bytes)
      if (worktreeIsFrom) fromVersion = { ...fromVersion, bytes }
      else toVersion = { ...toVersion, bytes }
      converted = true
    }
  }

  const binary =
    (fromVersion.bytes !== null && isBinary(fromVersion.bytes)) ||
    (toVersion.bytes !== null && isBinary(toVersion.bytes))

  let normaliseWorktree = false
  if (!binary && !converted && (worktreeIsFrom || worktreeIsTo)) {
    const eol = await readEol(runner, cwd, path)
    normaliseWorktree =
      eol !== null &&
      hasCarriageReturn(eol.worktree) &&
      !hasCarriageReturn(eol.index) &&
      shouldNormaliseWorktree(eol, await readAutocrlf(runner, cwd))
  }

  return {
    from: binary ? null : linesOf(fromVersion, worktreeIsFrom && normaliseWorktree),
    to: binary ? null : linesOf(toVersion, worktreeIsTo && normaliseWorktree),
    fromSize: fromVersion.bytes?.length ?? 0,
    toSize: toVersion.bytes?.length ?? 0,
    binary,
    normalised: normaliseWorktree || converted
  }
}

/**
 * Writes `content` as the working copy of `path`, undoing the conversion the
 * comparison did. `content` is in the index's form, so a path with a clean
 * filter goes back through the smudge filter, and a `CRLF` checkout over an `LF`
 * index stays `CRLF`; otherwise the whole file would read as changed afterwards.
 * The parameters Git decides from (`core.autocrlf`, the attributes) are read the
 * same way the comparison reads them, so the write agrees with what the viewer
 * showed.
 */
export async function writeWorktreeFile(
  runner: GitRunner,
  cwd: string,
  path: string,
  content: string
): Promise<void> {
  const full = join(cwd, path)

  // A filtered path stores something else than it checks out, so the text has to
  // go back through the smudge filter to become the working copy Git would write.
  if ((await readFilter(runner, cwd, path)) !== null) {
    const hashed = await runner.runOrThrow(['hash-object', '-w', '--stdin'], {
      cwd,
      stdin: content
    })
    const id = hashed.stdout.toString('utf8').trim()
    const smudged = await runner.runOrThrow(['cat-file', '--filters', `--path=${path}`, id], {
      cwd,
      readOnly: true
    })
    await writeFile(full, smudged.stdout)
    return
  }

  let existing: Uint8Array | null
  try {
    existing = await readFile(full)
  } catch {
    existing = null
  }

  const eol = await readEol(runner, cwd, path)
  let text = content
  if (
    eol !== null &&
    hasCarriageReturn(eol.worktree) &&
    !hasCarriageReturn(eol.index) &&
    shouldNormaliseWorktree(eol, await readAutocrlf(runner, cwd))
  ) {
    text = content.replace(/\n/g, '\r\n')
  }

  await writeFile(full, encodeText(text, existing))
}

/**
 * Reads the three versions of a path and compares them: HEAD against the index
 * for what is prepared, and the index against the working copy for what is not.
 * The working copy is normalised against the index exactly as the comparison
 * does, so a `CRLF` working copy over an `LF` index is not read as changed.
 *
 * A binary file has no line model and comes back as null.
 */
export async function readFileModel(
  runner: GitRunner,
  cwd: string,
  path: string
): Promise<FileModel | null> {
  const [staged, unstaged] = await Promise.all([
    readComparison(runner, cwd, path, 'head', 'index'),
    readComparison(runner, cwd, path, 'index', 'worktree')
  ])
  if (staged.binary || unstaged.binary) return null
  return buildFileModel(staged.from, staged.to, unstaged.to)
}
