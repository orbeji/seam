// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { cloneTarget, repositoryNameFromUrl } from './clone-path'

describe('repositoryNameFromUrl', () => {
  it('reads the last segment of HTTPS, SSH and scp-like URLs', () => {
    expect(repositoryNameFromUrl('https://github.com/acme/seam.git')).toBe('seam')
    expect(repositoryNameFromUrl('ssh://git@example.com:2222/acme/seam.git')).toBe('seam')
    expect(repositoryNameFromUrl('git@github.com:acme/seam.git')).toBe('seam')
    expect(repositoryNameFromUrl('https://github.com/acme/seam.git/')).toBe('seam')
  })

  it('reads local paths, with their trailing separators removed', () => {
    expect(repositoryNameFromUrl('/home/me/projects/seam')).toBe('seam')
    expect(repositoryNameFromUrl('/home/me/projects/seam/')).toBe('seam')
    expect(repositoryNameFromUrl('C:\\repos\\seam.git')).toBe('seam')
  })

  it('ignores a query or fragment and has no name for an empty address', () => {
    expect(repositoryNameFromUrl('https://example.com/acme/seam.git?ref=main')).toBe('seam')
    expect(repositoryNameFromUrl('   ')).toBe('')
    expect(repositoryNameFromUrl('https://example.com/acme/.git')).toBe('')
  })

  it('turns a GitHub URL and a parent folder into the folder Git will create', () => {
    expect(
      cloneTarget(
        '/home/oriol/Documentos/Projects',
        repositoryNameFromUrl('https://github.com/orbeji/test')
      )
    ).toBe('/home/oriol/Documentos/Projects/test')
    expect(
      cloneTarget(
        '/home/oriol/Documentos/Projects',
        repositoryNameFromUrl('https://github.com/orbeji/test/tree/main/src')
      )
    ).toBe('/home/oriol/Documentos/Projects/test')
  })
})

describe('cloneTarget', () => {
  it('joins a parent folder and a name without doubling the separator', () => {
    expect(cloneTarget('/home/me/projects', 'seam')).toBe('/home/me/projects/seam')
    expect(cloneTarget('/home/me/projects/', 'seam')).toBe('/home/me/projects/seam')
    expect(cloneTarget('/', 'seam')).toBe('/seam')
  })

  it('keeps the separator style of a Windows path', () => {
    expect(cloneTarget('C:\\repos', 'seam')).toBe('C:\\repos\\seam')
    expect(cloneTarget('C:/repos', 'seam')).toBe('C:/repos/seam')
  })

  it('has no target until both parts are known', () => {
    expect(cloneTarget('', 'seam')).toBe('')
    expect(cloneTarget('/home/me', '')).toBe('')
  })
})
