// SPDX-License-Identifier: MIT

import type { Identity, IdentityScope } from '../../shared/git'
import type { GitRunner } from './runner'

/**
 * Reads the identity Git would sign a commit with: `user.name` and `user.email`
 * as the whole configuration resolves them, so an address set only globally is
 * found here and does not open the dialog. A key that is unset comes back as
 * null rather than as an error, because a missing identity is a normal state to
 * ask the user about.
 */
export async function readIdentity(runner: GitRunner, repo: string): Promise<Identity> {
  const read = async (key: string): Promise<string | null> => {
    // `git config <key>` exits non-zero when the key is unset anywhere.
    const result = await runner.run(['config', key], { cwd: repo, readOnly: true })
    if (result.code !== 0) return null
    const value = result.stdout.toString('utf8').trim()
    return value === '' ? null : value
  }

  return { name: await read('user.name'), email: await read('user.email') }
}

/**
 * Writes the identity the user typed, either for this repository alone
 * (`--local`) or for every repository (`--global`).
 */
export async function writeIdentity(
  runner: GitRunner,
  repo: string,
  identity: { readonly name: string; readonly email: string },
  scope: IdentityScope
): Promise<void> {
  const flag = scope === 'global' ? '--global' : '--local'
  await runner.runOrThrow(['config', flag, 'user.name', identity.name], { cwd: repo })
  await runner.runOrThrow(['config', flag, 'user.email', identity.email], { cwd: repo })
}
