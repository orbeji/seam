// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { buildFileTree, type FileTreeFolder } from '../src/renderer/changes/file-tree'
import type { StatusEntry } from '../src/shared/git'

const modes = { head: '100644', index: '100644', worktree: '100644' }

function file(path: string): StatusEntry {
  return { kind: 'ordinary', x: 'M', y: '.', path, modes }
}

function names(nodes: ReturnType<typeof buildFileTree>): string[] {
  return nodes.map((node) => (node.kind === 'folder' ? `folder:${node.name}` : node.entry.path))
}

describe('buildFileTree', () => {
  it('groups paths into their folders and lists folders before files', () => {
    const tree = buildFileTree([
      file('src/z.ts'),
      file('README.md'),
      file('src/a.ts'),
      file('docs/guide.md')
    ])

    expect(names(tree)).toEqual(['folder:docs', 'folder:src', 'README.md'])
    const src = tree.find(
      (node): node is FileTreeFolder => node.kind === 'folder' && node.path === 'src'
    )
    expect(
      src?.children.map((node) => (node.kind === 'file' ? node.entry.path : node.path))
    ).toEqual(['src/a.ts', 'src/z.ts'])
  })

  it('keeps nested folders relative to the repository root', () => {
    const tree = buildFileTree([file('src/core/diff/lines.ts'), file('src/core/index.ts')])
    const src = tree[0]
    expect(src?.kind).toBe('folder')
    if (src?.kind !== 'folder') return

    const core = src.children[0]
    expect(core?.kind).toBe('folder')
    if (core?.kind !== 'folder') return

    expect(core.path).toBe('src/core')
    expect(names(core.children)).toEqual(['folder:diff', 'src/core/index.ts'])
    const diff = core.children[0]
    expect(diff?.kind === 'folder' ? diff.path : null).toBe('src/core/diff')
  })

  it('accepts the backslash separator Git may report on Windows', () => {
    const tree = buildFileTree([file('src\\lib\\util.ts')])
    const src = tree[0]
    if (src?.kind !== 'folder') return
    expect(src.path).toBe('src')
    const lib = src.children[0]
    expect(lib?.kind === 'folder' ? lib.path : null).toBe('src/lib')
  })

  it('merges files that share a folder into one node', () => {
    const tree = buildFileTree([file('a/one.ts'), file('a/two.ts'), file('b/three.ts')])
    expect(tree).toHaveLength(2)
    const a = tree[0]
    if (a?.kind !== 'folder') return
    expect(a.children).toHaveLength(2)
  })

  it('keeps a root file at the root', () => {
    expect(names(buildFileTree([file('package.json')]))).toEqual(['package.json'])
  })
})
