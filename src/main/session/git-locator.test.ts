// SPDX-License-Identifier: MIT

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findGitExecutable, windowsGitCandidates } from './git-locator'

const temporaries: string[] = []

function temporary(): string {
  const directory = mkdtempSync(join(tmpdir(), 'seam-git-locator-'))
  temporaries.push(directory)
  return directory
}

afterEach(() => {
  while (temporaries.length > 0) {
    rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
  }
})

describe('findGitExecutable', () => {
  it('returns plain git off Windows, leaving the PATH to the runner', () => {
    expect(findGitExecutable({ PATH: '/nowhere' }, 'linux')).toBe('git')
    expect(findGitExecutable({ PATH: '/nowhere' }, 'darwin')).toBe('git')
  })

  it('finds git.exe on the Windows PATH first', () => {
    const directory = temporary()
    const executable = join(directory, 'git.exe')
    writeFileSync(executable, '')

    expect(
      findGitExecutable(
        {
          PATH: directory,
          PATHEXT: '.EXE;.CMD',
          ProgramFiles: join(directory, 'missing')
        },
        'win32'
      )
    ).toBe(executable)
  })

  it('falls back to the usual Git for Windows install folders', () => {
    const root = temporary()
    const executable = join(root, 'Git', 'cmd', 'git.exe')
    mkdirSync(join(root, 'Git', 'cmd'), { recursive: true })
    writeFileSync(executable, '')

    expect(findGitExecutable({ PATH: '', PATHEXT: '.EXE', ProgramFiles: root }, 'win32')).toBe(
      executable
    )
  })

  it('returns null when Windows has no Git anywhere it knows', () => {
    const empty = temporary()
    expect(
      findGitExecutable(
        {
          PATH: empty,
          PATHEXT: '.EXE',
          ProgramFiles: join(empty, 'nope'),
          LOCALAPPDATA: join(empty, 'local')
        },
        'win32'
      )
    ).toBeNull()
  })

  it('uses SEAM_GIT_PATH when it is set', () => {
    expect(findGitExecutable({ SEAM_GIT_PATH: '/opt/git/bin/git' }, 'linux')).toBe(
      '/opt/git/bin/git'
    )
    expect(findGitExecutable({ SEAM_GIT_PATH: 'C:\\Portable\\git.exe' }, 'win32')).toBe(
      'C:\\Portable\\git.exe'
    )
  })

  it('treats an empty SEAM_GIT_PATH as no Git at all', () => {
    expect(findGitExecutable({ SEAM_GIT_PATH: '', PATH: '/usr/bin' }, 'linux')).toBeNull()
  })
})

describe('windowsGitCandidates', () => {
  it('lists every extension of the PATH before the installer folders', () => {
    const candidates = windowsGitCandidates({
      PATH: 'C:\\Tools',
      PATHEXT: '.EXE;.CMD',
      ProgramFiles: 'C:\\Program Files'
    })

    expect(candidates[0]).toBe(join('C:\\Tools', 'git.exe'))
    expect(candidates[1]).toBe(join('C:\\Tools', 'git.cmd'))
    expect(candidates).toContain(join('C:\\Program Files', 'Git', 'cmd', 'git.exe'))
  })
})
