// SPDX-License-Identifier: MIT

/**
 * Reads the repository path from the command line, so `seam --repo <path>`
 * opens a repository directly. The smoke test uses this to open the sample
 * repository without driving the native folder picker.
 */
export function repositoryFromArgv(argv: readonly string[]): string | null {
  const index = argv.indexOf('--repo')
  if (index === -1) return null
  const value = argv[index + 1]
  return value !== undefined && value !== '' && !value.startsWith('--') ? value : null
}
