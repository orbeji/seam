// SPDX-License-Identifier: MIT

import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { UnmergedEntry } from '../../shared/git'
import { GitError } from './errors'
import type { GitRunner } from './runner'
import { readStatus } from './status'

/**
 * A `stash pop` that conflicts leaves no marker of its own: no `MERGE_HEAD`, no
 * rebase folder. The stash entry stays in the list and the unmerged entries are
 * the only sign that the pop happened. This module recognises that case and
 * undoes it without touching files the stash never had.
 *
 * Aborting cannot simply run `git checkout -- .`: that would throw away edits
 * the user had in other files before the pop. Instead, only the paths the stash
 * touches are put back, and unrelated changes are left exactly as they were.
 * Git refuses a pop that would overwrite local changes in those same files, so
 * restoring them to HEAD is safe.
 */

/** The paths a stash entry changes, including untracked files added with `-u`. */
export async function readStashPaths(
  runner: GitRunner,
  repo: string,
  ref: string
): Promise<Set<string>> {
  const paths = new Set<string>()
  const exists = await runner.run(['rev-parse', '--verify', '--quiet', ref], {
    cwd: repo,
    readOnly: true
  })
  if (exists.code !== 0) return paths

  const tracked = await runner.runOrThrow(['diff', '--name-only', '-z', `${ref}^1`, ref], {
    cwd: repo,
    readOnly: true
  })
  for (const path of tracked.stdout.toString('utf8').split('\0')) {
    if (path !== '') paths.add(path)
  }

  // A stash created with `-u` keeps untracked files in a third parent.
  const untracked = await runner.run(['rev-parse', '--verify', '--quiet', `${ref}^3`], {
    cwd: repo,
    readOnly: true
  })
  if (untracked.code === 0) {
    const diff = await runner.runOrThrow(['diff', '--name-only', '-z', `${ref}^1`, `${ref}^3`], {
      cwd: repo,
      readOnly: true
    })
    for (const path of diff.stdout.toString('utf8').split('\0')) {
      if (path !== '') paths.add(path)
    }
  }

  return paths
}

/**
 * The newest stash entry when it touches one of the files in conflict, or null.
 * The check keeps a plain conflict and an unrelated stash from looking like a
 * failed pop.
 */
export async function readStashCandidate(
  runner: GitRunner,
  repo: string,
  relatedPaths: Iterable<string>
): Promise<string | null> {
  const ref = 'stash@{0}'
  const paths = await readStashPaths(runner, repo, ref)
  if (paths.size === 0) return null

  for (const path of relatedPaths) {
    if (paths.has(path)) return ref
  }
  return null
}

/** Whether HEAD still has a file, so aborting can check that version out. */
async function existsInHead(runner: GitRunner, repo: string, path: string): Promise<boolean> {
  const result = await runner.run(['cat-file', '-e', `HEAD:${path}`], {
    cwd: repo,
    readOnly: true
  })
  return result.code === 0
}

/**
 * Undoes a conflicted stash pop: every path the stash touched goes back to
 * HEAD, in the index and in the working copy, and files added by the stash are
 * removed. The stash entry is kept, because the pop did not consume it.
 *
 * Files the user already resolved no longer appear in the status, so the caller
 * passes the paths Git kept in resolve-undo; without them an abort after every
 * conflict was resolved would not recognise the pop.
 */
export async function abortStash(
  runner: GitRunner,
  repo: string,
  resolvedPaths: Iterable<string> = []
): Promise<void> {
  const status = await readStatus(runner, repo)
  const unmerged = status.entries.filter(
    (entry): entry is UnmergedEntry => entry.kind === 'unmerged'
  )
  const related = new Set(unmerged.map((entry) => entry.path))
  for (const path of resolvedPaths) related.add(path)
  const stash = await readStashCandidate(runner, repo, related)
  if (stash === null) {
    throw new GitError('This repository has no conflicted stash pop to abort.')
  }

  const paths = new Set(unmerged.map((entry) => entry.path))
  for (const path of await readStashPaths(runner, repo, stash)) paths.add(path)

  for (const path of paths) {
    if (await existsInHead(runner, repo, path)) {
      // HEAD's version into both the index and the working copy.
      await runner.runOrThrow(['--literal-pathspecs', 'checkout', '-q', 'HEAD', '--', path], {
        cwd: repo
      })
    } else {
      // The stash added the file: take it out of the index and the working copy.
      await runner.runOrThrow(['--literal-pathspecs', 'reset', '-q', 'HEAD', '--', path], {
        cwd: repo
      })
      await rm(join(repo, path), { force: true })
    }
  }

  // Putting the paths back to HEAD resolves their unmerged entries, and Git
  // records those stages as resolve-undo data. Without clearing it the dialog
  // would still offer the aborted pop as a list of resolved conflicts.
  await runner.runOrThrow(['update-index', '--clear-resolve-undo'], { cwd: repo })
}
