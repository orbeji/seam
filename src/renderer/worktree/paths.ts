// SPDX-License-Identifier: MIT

/**
 * The current repository folder with a trailing separator, so a folder field
 * opens ready for the name of the new worktree to be typed after it.
 */
export function folderPrefix(path: string): string {
  if (path === '' || path.endsWith('/') || path.endsWith('\\')) return path
  return `${path}${path.includes('\\') ? '\\' : '/'}`
}

/** The folder without its trailing separators, for comparing two paths. */
export function withoutTrailingSeparators(path: string): string {
  return path.trim().replace(/[\\/]+$/, '')
}

/** Whether two folder paths point at the same worktree. */
export function sameFolder(a: string, b: string): boolean {
  return withoutTrailingSeparators(a) === withoutTrailingSeparators(b)
}
