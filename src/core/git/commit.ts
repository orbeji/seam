// SPDX-License-Identifier: MIT

import type { GitRunner } from './runner'

/**
 * Creates a commit from the index with the given message.
 *
 * The message goes over stdin, encoded as UTF-8, so Unicode survives intact and
 * no command-line limit or shell quoting is involved. `GIT_EDITOR=true` keeps
 * Git from opening an editor for a message it already has; hooks, attributes
 * and configuration still run exactly as they do in a terminal.
 */
export async function createCommit(
  runner: GitRunner,
  repo: string,
  message: string
): Promise<void> {
  await runner.runOrThrow(['commit', '-F', '-'], {
    cwd: repo,
    stdin: Buffer.from(message, 'utf8'),
    noEditor: true
  })
}
