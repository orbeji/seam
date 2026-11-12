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

/** A path in the form Git and the folder picker can be compared in. */
function comparable(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  // Git reports Windows paths with forward slashes, and Windows treats the
  // drive letter and the rest of the path without case.
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized
}

/** Whether two folder paths point at the same worktree. */
export function sameFolder(a: string, b: string | null): boolean {
  return b !== null && comparable(a) === comparable(b)
}
