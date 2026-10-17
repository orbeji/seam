// SPDX-License-Identifier: MIT

import { statSync } from 'node:fs'
import { join } from 'node:path'
import { GitError } from './errors'
import type { GitRunner } from './runner'

/** Index modes Seam can rewrite: an ordinary file, with or without the exec bit. */
const FILE_MODES: readonly string[] = ['100644', '100755']

/**
 * The mode the index entry should keep. The mode already in the index wins, so
 * a file staged as executable stays executable; a file that is not in the index
 * yet falls back to its working copy's executable bit. A path with unresolved
 * conflict stages has several entries and cannot be written this way.
 */
async function readMode(runner: GitRunner, repo: string, path: string): Promise<string> {
  const result = await runner.run(['ls-files', '-s', '-z', '--', path], {
    cwd: repo,
    readOnly: true
  })
  const records = result.stdout
    .toString('utf8')
    .split('\0')
    .filter((record) => record !== '')

  if (records.length > 1) {
    throw new GitError(`${path} has merge conflicts, so its index cannot be written.`)
  }
  if (records.length === 0) {
    return (statSync(join(repo, path)).mode & 0o111) !== 0 ? '100755' : '100644'
  }

  const mode = records[0]?.split(' ')[0] ?? ''
  if (!FILE_MODES.includes(mode)) {
    throw new GitError(`Seam can only write the index of ordinary files, and ${path} has ${mode}.`)
  }
  return mode
}

/**
 * Writes `content` to the index as the staged version of `path`, without
 * touching the working copy. `hash-object --path` runs the text through the
 * same filters and line-ending conversion as `git add`, so the blob is the one
 * Git would have stored; the mode comes from the index and only the entry's
 * object changes.
 */
export async function writeIndexEntry(
  runner: GitRunner,
  repo: string,
  path: string,
  content: string | Uint8Array
): Promise<void> {
  const hashed = await runner.runOrThrow(['hash-object', '-w', `--path=${path}`, '--stdin'], {
    cwd: repo,
    stdin: content
  })
  const id = hashed.stdout.toString('utf8').trim()

  const mode = await readMode(runner, repo, path)
  await runner.runOrThrow(['update-index', '--add', '--cacheinfo', `${mode},${id},${path}`], {
    cwd: repo
  })
}
