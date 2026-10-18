// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { GitRunner } from './runner'

/**
 * The commit-message template configured for a repository, or null when there
 * is none or it cannot be read.
 *
 * Git only uses `commit.template` when it opens an editor, and Seam always
 * supplies the message over stdin, so the template has to be loaded here and
 * put in the box instead. `git config --path` expands a leading `~` (and
 * `~user`) the way Git does; a relative path is taken from the repository, which
 * is where a `git commit` run at its top would look.
 */
export async function readCommitTemplate(runner: GitRunner, repo: string): Promise<string | null> {
  // `git config` exits non-zero when the key is unset anywhere.
  const result = await runner.run(['config', '--path', 'commit.template'], {
    cwd: repo,
    readOnly: true
  })
  if (result.code !== 0) return null

  const configured = result.stdout.toString('utf8').trim()
  if (configured === '') return null

  const path = isAbsolute(configured) ? configured : resolve(repo, configured)
  try {
    const text = readFileSync(path, 'utf8')
    return text === '' ? null : text
  } catch {
    // A template that is set but missing or unreadable simply leaves the box
    // empty, rather than failing the whole screen.
    return null
  }
}
