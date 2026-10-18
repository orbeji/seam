// SPDX-License-Identifier: MIT

import type { GitRunner } from './runner'

/**
 * The line endings Git sees, read with `git ls-files --eol`: `i/` is the format
 * stored in the index, `w/` the working copy's and `attr/` the attributes set
 * for the file. A commit stores `i/`, so a file with `i/crlf` and no attributes
 * puts CRLF in the repository for good and mixes endings with the files that
 * already use LF. The files that carry attributes are left out of the
 * analysis, as in the reference client: whoever set them has decided how they are stored.
 */

/** One `git ls-files --eol -z` record: the columns, a tab, then the path. */
function parseRecord(record: string): { path: string; index: string; attributes: string } | null {
  const column = record.indexOf('\t')
  if (column === -1) return null
  const match = /^i\/(\S+)\s+w\/(\S+)\s+attr\/(.*)$/.exec(record.slice(0, column))
  if (match === null) return null
  const [, index = '', , attributes = ''] = match
  return { path: record.slice(column + 1), index, attributes: attributes.trim() }
}

/** The paths the next commit would take, as `git diff --cached` lists them. */
async function stagedPaths(runner: GitRunner, repo: string): Promise<string[]> {
  const staged = await runner.runOrThrow(['diff', '--cached', '--name-only', '-z'], { cwd: repo })
  return staged.stdout
    .toString('utf8')
    .split('\0')
    .filter((path) => path !== '')
}

/**
 * The staged files whose index copy carries CRLF (or a mix of endings) with no
 * attribute saying so, which is what the warning before a commit is about. An
 * empty list means committing keeps the endings the repository already has.
 */
export async function findCrlfProblems(runner: GitRunner, repo: string): Promise<string[]> {
  const paths = await stagedPaths(runner, repo)
  if (paths.length === 0) return []

  const eol = await runner.runOrThrow(['ls-files', '--eol', '-z', '--', ...paths], { cwd: repo })
  return eol.stdout
    .toString('utf8')
    .split('\0')
    .flatMap((record) => {
      const parsed = parseRecord(record)
      if (parsed === null || (parsed.index !== 'crlf' && parsed.index !== 'mixed')) return []
      return parsed.attributes === '' ? [parsed.path] : []
    })
}

/**
 * Puts `core.autocrlf` on the repository's own configuration — never on the
 * global one, so other projects keep theirs — and prepares the given paths
 * again with `add --renormalize`, which re-applies the conversion to files
 * already in the index. The working copies are left alone. The files that
 * still carry CRLF come back, empty when the fix worked.
 */
export async function fixCrlf(
  runner: GitRunner,
  repo: string,
  paths: readonly string[]
): Promise<string[]> {
  // On Windows `true` also converts on checkout, which is what Git for
  // Windows does; elsewhere `input` keeps CRLF out of the index and leaves
  // the working copies as they are.
  const autocrlf = process.platform === 'win32' ? 'true' : 'input'
  await runner.runOrThrow(['config', 'core.autocrlf', autocrlf], { cwd: repo })
  await runner.runOrThrow(['add', '--renormalize', '--', ...paths], { cwd: repo })
  return findCrlfProblems(runner, repo)
}
