// SPDX-License-Identifier: MIT

import { existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { normalizeRepositoryUrl } from '../../shared/git-url'
import { GitError } from './errors'
import type { GitRunner } from './runner'

/** A clone can be much slower than a status read, as it transfers a whole repository. */
export const CLONE_TIMEOUT_MS = 5 * 60 * 1000

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    // The folder disappeared between the two checks, or is not readable.
    return false
  }
}

/**
 * Clones `url` into `destination`, which must be the full path of the new
 * folder. Its parent must already exist: like `git clone`, Seam creates only the
 * repository folder, not a chain of directories that a mistyped path could
 * leave behind.
 */
export async function cloneRepository(
  runner: GitRunner,
  url: string,
  destination: string
): Promise<string> {
  const repository = normalizeRepositoryUrl(url)
  if (repository === '') throw new GitError('A repository URL is required.')
  if (destination.trim() === '') throw new GitError('A destination folder is required.')

  const target = resolve(destination.trim())
  const parent = dirname(target)
  if (!isDirectory(parent)) {
    throw new GitError(`The destination folder does not exist: ${parent}`)
  }

  // `--` keeps a URL that starts with a dash from being read as an option.
  await runner.runOrThrow(['clone', '--', repository, target], {
    cwd: parent,
    timeoutMs: CLONE_TIMEOUT_MS
  })
  return target
}
