// SPDX-License-Identifier: MIT

import type { StatusEntry } from '../../shared/git'

/** A file row in the changes tree. */
export interface FileTreeFile {
  readonly kind: 'file'
  readonly entry: StatusEntry
}

/** A folder that holds files and other folders from the changes tree. */
export interface FileTreeFolder {
  readonly kind: 'folder'
  /** The folder's own name, not its whole path. */
  readonly name: string
  /** The folder's path from the repository root, used as its identity. */
  readonly path: string
  readonly children: readonly FileTreeNode[]
}

export type FileTreeNode = FileTreeFile | FileTreeFolder

interface MutableFolder {
  readonly name: string
  readonly path: string
  readonly folders: Map<string, MutableFolder>
  readonly files: StatusEntry[]
}

/** The path segments Git uses, whichever separator the platform reports. */
function segmentsOf(path: string): string[] {
  return path.split(/[\\/]+/).filter((segment) => segment !== '')
}

function compareNames(left: string, right: string): number {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * Groups status entries into the folder hierarchy their paths describe. The
 * paths are already relative to the repository root, so every leading segment
 * becomes a folder. Folders come before files and each group is sorted by name,
 * which keeps a deeply nested list predictable to scan.
 */
export function buildFileTree(entries: readonly StatusEntry[]): readonly FileTreeNode[] {
  const root: MutableFolder = { name: '', path: '', folders: new Map(), files: [] }

  for (const entry of entries) {
    const segments = segmentsOf(entry.path)
    const name = segments.pop()
    let folder = root
    for (const segment of segments) {
      const path = folder.path === '' ? segment : `${folder.path}/${segment}`
      let child = folder.folders.get(segment)
      if (child === undefined) {
        child = { name: segment, path, folders: new Map(), files: [] }
        folder.folders.set(segment, child)
      }
      folder = child
    }
    // A path with no file name can only be unusual input; keeping it at the
    // root is better than dropping the entry from the list.
    if (name !== undefined && name !== '') folder.files.push(entry)
    else root.files.push(entry)
  }

  return toNodes(root)
}

function toNodes(folder: MutableFolder): FileTreeNode[] {
  const folders = [...folder.folders.values()]
    .sort((left, right) => compareNames(left.name, right.name))
    .map((child): FileTreeFolder => ({
      kind: 'folder',
      name: child.name,
      path: child.path,
      children: toNodes(child)
    }))
  const files = [...folder.files]
    .sort((left, right) => compareNames(fileName(left.path), fileName(right.path)))
    .map((entry): FileTreeFile => ({ kind: 'file', entry }))
  return [...folders, ...files]
}

function fileName(path: string): string {
  const segments = segmentsOf(path)
  return segments[segments.length - 1] ?? path
}
