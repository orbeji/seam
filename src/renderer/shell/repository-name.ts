// SPDX-License-Identifier: MIT

/** The repository folder's last segment, used as a tab's label. */
export function repositoryName(repo: string): string {
  const parts = repo.split(/[\\/]/).filter((part) => part !== '')
  return parts[parts.length - 1] ?? repo
}
