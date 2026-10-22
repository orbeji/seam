// SPDX-License-Identifier: MIT

/** The last segment of a path, and the directory it sits in. */
export function splitPath(path: string): { name: string; dir: string } {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (at === -1) return { name: path, dir: '' }
  return { name: path.slice(at + 1), dir: path.slice(0, at) }
}
