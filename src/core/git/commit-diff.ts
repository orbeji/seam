// SPDX-License-Identifier: MIT

import type { CommitChanges, CommitFileChange, CommitFileStatus } from '../../shared/git'
import { decodeText, isBinary, splitText } from '../text'
import type { GitRunner } from './runner'
import type { Comparison } from './versions'

/**
 * Reading a commit's own change: the files it touched against its first parent,
 * and the two versions of any one of them. A merge commit is shown against the
 * branch it was merged into, which is how a terminal's `git show` reads it by
 * default; a root commit is shown against the empty tree.
 */

/** Maps Git's `--name-status` letter to the status the interface shows. */
function fileStatus(letter: string): CommitFileStatus {
  switch (letter) {
    case 'A':
      return 'added'
    case 'M':
      return 'modified'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'type-changed'
    case 'U':
      return 'unmerged'
    default:
      return 'unknown'
  }
}

/**
 * Parses `git diff --name-status -z` output. A record is a status and a path,
 * except for a rename or a copy, which carry the old path and then the new one.
 * Git prints every field NUL-terminated, so the record boundaries are the NULs
 * and not the newlines a path could itself contain.
 */
export function parseCommitFiles(output: string): CommitFileChange[] {
  const fields = output.split('\0')
  const files: CommitFileChange[] = []
  let index = 0

  while (index < fields.length) {
    const field = fields[index] ?? ''
    index += 1
    if (field === '') continue

    const status = fileStatus(field.charAt(0))
    if (status === 'renamed' || status === 'copied') {
      const previousPath = fields[index] ?? ''
      const path = fields[index + 1] ?? ''
      index += 2
      if (path === '') continue
      files.push({
        path,
        previousPath: previousPath === '' ? null : previousPath,
        status
      })
    } else {
      const path = fields[index] ?? ''
      index += 1
      if (path === '') continue
      files.push({ path, previousPath: null, status })
    }
  }

  return files
}

/** The first parent of a commit, or null when the commit has no parent. */
export async function readFirstParent(
  runner: GitRunner,
  repo: string,
  commit: string
): Promise<string | null> {
  const result = await runner.run(['rev-parse', '--verify', '--quiet', `${commit}^1`], {
    cwd: repo,
    readOnly: true
  })
  if (result.code !== 0) return null
  return result.stdout.toString('utf8').trim() || null
}

/**
 * The files a commit changed against its first parent. The commit is read the
 * same way `git show --name-status` reads it, except a merge is compared only
 * with its first parent rather than printing a combined patch.
 */
export async function readCommitChanges(
  runner: GitRunner,
  repo: string,
  commit: string
): Promise<CommitChanges> {
  const parent = await readFirstParent(runner, repo, commit)
  const result =
    parent === null
      ? await runner.runOrThrow(
          ['diff-tree', '--root', '-r', '--no-commit-id', '--name-status', '-z', '-M', commit],
          { cwd: repo, readOnly: true }
        )
      : await runner.runOrThrow(
          ['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '-M', parent, commit],
          {
            cwd: repo,
            readOnly: true
          }
        )

  return {
    oid: commit,
    parent,
    files: parseCommitFiles(result.stdout.toString('utf8'))
  }
}

/** The bytes of one path at one revision, or null when that version has none. */
async function readRevisionBlob(
  runner: GitRunner,
  repo: string,
  revision: string,
  path: string
): Promise<Uint8Array | null> {
  const result = await runner.run(['cat-file', 'blob', `${revision}:${path}`], {
    cwd: repo,
    readOnly: true
  })
  return result.code === 0 ? result.stdout : null
}

/**
 * The two versions of a file a commit changed: its content in the first parent
 * and in the commit itself. A root commit has no parent side, and a deleted file
 * has no commit side, so either can come back as null instead of empty text.
 */
export async function readCommitComparison(
  runner: GitRunner,
  repo: string,
  commit: string,
  path: string,
  previousPath: string | null
): Promise<Comparison> {
  const parent = await readFirstParent(runner, repo, commit)
  const [fromBytes, toBytes] = await Promise.all([
    parent === null
      ? Promise.resolve(null)
      : readRevisionBlob(runner, repo, parent, previousPath ?? path),
    readRevisionBlob(runner, repo, commit, path)
  ])

  const binary =
    (fromBytes !== null && isBinary(fromBytes)) || (toBytes !== null && isBinary(toBytes))

  return {
    from: binary || fromBytes === null ? null : splitText(decodeText(fromBytes)),
    to: binary || toBytes === null ? null : splitText(decodeText(toBytes)),
    fromSize: fromBytes?.length ?? 0,
    toSize: toBytes?.length ?? 0,
    binary,
    normalised: false
  }
}
