// SPDX-License-Identifier: MIT

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GitRunOptions, GitRunResult } from './runner'
import {
  addWorktree,
  listWorktrees,
  lockWorktree,
  moveWorktree,
  parseWorktrees,
  pruneWorktrees,
  removeWorktree,
  repairWorktrees,
  unlockWorktree
} from './worktree'

function result(stdout = '', code = 0): GitRunResult {
  return { stdout: Buffer.from(stdout, 'utf8'), stderr: code === 0 ? '' : 'boom', code }
}

interface FakeCall {
  args: readonly string[]
  options: GitRunOptions
}

/** A runner stub that records every call and can fail a chosen command. */
function fakeRunner(failures: readonly string[] = []) {
  const calls: FakeCall[] = []
  return {
    calls,
    async run(args: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
      calls.push({ args, options })
      return result('', failures.includes(args.join(' ')) ? 1 : 0)
    },
    async runOrThrow(args: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
      calls.push({ args, options })
      if (failures.includes(args.join(' '))) throw new Error('boom')
      return result(args[0] === 'worktree' && args[1] === 'list' ? WORKTREE_OUTPUT : '')
    }
  }
}

const WORKTREE_OUTPUT = [
  `worktree /repo`,
  `HEAD aaa111`,
  `branch refs/heads/main`,
  ``,
  `worktree /repo/feature`,
  `HEAD bbb222`,
  `branch refs/heads/feature/x`,
  `locked on a drive`,
  ``,
  `worktree /repo/gone`,
  `HEAD ccc333`,
  `detached`,
  `prunable gitdir file points to non-existent location`,
  ``
].join('\n')

describe('parseWorktrees', () => {
  it('parses NUL-separated blocks and keeps the main worktree first', () => {
    const worktrees = parseWorktrees(WORKTREE_OUTPUT)

    expect(worktrees).toHaveLength(3)
    expect(worktrees[0]).toMatchObject({
      path: '/repo',
      head: 'aaa111',
      branch: 'main',
      main: true,
      detached: false,
      locked: null,
      prunable: null
    })
    expect(worktrees[1]).toMatchObject({
      path: '/repo/feature',
      branch: 'feature/x',
      main: false,
      locked: 'on a drive'
    })
    expect(worktrees[2]).toMatchObject({
      path: '/repo/gone',
      detached: true,
      branch: null,
      prunable: 'gitdir file points to non-existent location'
    })
  })

  it('reads a lock without a reason and a bare repository', () => {
    const worktrees = parseWorktrees(
      [`worktree /repo`, `HEAD aaa111`, `bare`, `locked`, ``].join('\n')
    )

    expect(worktrees[0]).toMatchObject({ bare: true, locked: '', branch: null })
  })

  it('keeps a path with spaces as Git prints it', () => {
    const worktrees = parseWorktrees(
      [`worktree C:/my repo`, `HEAD aaa111`, `branch refs/heads/main`, ``].join('\n')
    )

    expect(worktrees[0]?.path).toBe('C:/my repo')
  })

  it('unquotes a path Git had to quote', () => {
    const worktrees = parseWorktrees(
      [`worktree "C:/repo/say \\"hi\\""`, `HEAD aaa111`, `branch refs/heads/main`, ``].join('\n')
    )

    expect(worktrees[0]?.path).toBe('C:/repo/say "hi"')
  })

  it('unquotes a lock reason Git had to quote', () => {
    const worktrees = parseWorktrees(
      [`worktree /repo`, `HEAD aaa111`, `branch refs/heads/main`, `locked "say \\"hi\\""`, ``].join(
        '\n'
      )
    )

    expect(worktrees[0]?.locked).toBe('say "hi"')
  })

  it('returns nothing for empty output', () => {
    expect(parseWorktrees('')).toEqual([])
  })

  it('reads CRLF output from Git for Windows', () => {
    const worktrees = parseWorktrees(
      [`worktree C:/my repo`, `HEAD aaa111`, `branch refs/heads/main`, ``, ``].join('\r\n')
    )

    expect(worktrees[0]).toMatchObject({ path: 'C:/my repo', branch: 'main' })
  })
})

describe('listWorktrees', () => {
  it('runs the porcelain command and parses its output', async () => {
    const runner = fakeRunner()
    const worktrees = await listWorktrees(runner as never, '/repo')

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['worktree', 'list', '--porcelain'],
      ['rev-parse', '--git-common-dir']
    ])
    expect(runner.calls[0]?.options.readOnly).toBe(true)
    expect(worktrees.map((worktree) => worktree.path)).toEqual([
      '/repo',
      '/repo/feature',
      '/repo/gone'
    ])
  })

  it('fills in the lock reason and prune state Git 2.30 does not print', async () => {
    const common = await mkdtemp(join(tmpdir(), 'seam-worktrees-'))
    try {
      const linked = join(common, 'feature')
      const gone = join(common, 'gone')
      const admin = join(common, 'worktrees')
      await mkdir(join(admin, 'feature'), { recursive: true })
      await mkdir(join(admin, 'gone'), { recursive: true })
      await writeFile(join(admin, 'feature', 'gitdir'), `${linked}/.git\n`)
      await writeFile(join(admin, 'feature', 'locked'), 'external drive')
      await writeFile(join(admin, 'gone', 'gitdir'), `${gone}/.git\n`)

      // Git 2.30 prints neither `locked` nor `prunable` in the porcelain list.
      const output = [
        `worktree ${common}`,
        `HEAD aaa111`,
        `branch refs/heads/main`,
        ``,
        `worktree ${linked}`,
        `HEAD bbb222`,
        `branch refs/heads/feature/x`,
        ``,
        `worktree ${gone}`,
        `HEAD ccc333`,
        `detached`,
        ``
      ].join('\n')
      const calls: FakeCall[] = []
      const runner = {
        async run(args: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
          calls.push({ args, options })
          return result(`${common}\n`)
        },
        async runOrThrow(args: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
          calls.push({ args, options })
          return result(args[0] === 'worktree' ? output : `${common}\n`)
        }
      }

      const worktrees = await listWorktrees(runner as never, common)
      expect(worktrees[0]?.locked).toBeNull()
      expect(worktrees[0]?.prunable).toBeNull()
      expect(worktrees[1]?.locked).toBe('external drive')
      expect(worktrees[1]?.prunable).toBeNull()
      expect(worktrees[2]?.locked).toBeNull()
      expect(worktrees[2]?.prunable).toBe('gitdir file points to non-existent location')
    } finally {
      await rm(common, { recursive: true, force: true })
    }
  })
})

describe('addWorktree', () => {
  it('creates a worktree on a new branch after validating its name', async () => {
    const runner = fakeRunner()
    await addWorktree(runner as never, '/repo', {
      path: '/tmp/feature',
      branch: 'feature/x',
      newBranch: true,
      startPoint: 'develop',
      detach: false
    })

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['check-ref-format', '--branch', 'feature/x'],
      ['worktree', 'add', '-b', 'feature/x', '/tmp/feature', 'develop']
    ])
  })

  it('reuses an existing branch without validating a new one', async () => {
    const runner = fakeRunner()
    await addWorktree(runner as never, '/repo', {
      path: '/tmp/feature',
      branch: 'feature/x',
      newBranch: false,
      startPoint: null,
      detach: false
    })

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['worktree', 'add', '/tmp/feature', 'feature/x']
    ])
  })

  it('detaches HEAD at the chosen start point', async () => {
    const runner = fakeRunner()
    await addWorktree(runner as never, '/repo', {
      path: '/tmp/review',
      branch: '',
      newBranch: false,
      startPoint: 'v1.0.0',
      detach: true
    })

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['worktree', 'add', '--detach', '/tmp/review', 'v1.0.0']
    ])
  })

  it('lets Git name a branch after the folder when none is given', async () => {
    const runner = fakeRunner()
    await addWorktree(runner as never, '/repo', {
      path: '/tmp/topic',
      branch: '',
      newBranch: false,
      startPoint: null,
      detach: false
    })

    expect(runner.calls.map((call) => call.args)).toEqual([['worktree', 'add', '/tmp/topic']])
  })

  it('refuses a path or revision that Git would read as an option', async () => {
    const runner = fakeRunner()
    const base = {
      path: '/tmp/feature',
      branch: '',
      newBranch: false,
      startPoint: null,
      detach: false
    }

    await expect(
      addWorktree(runner as never, '/repo', { ...base, path: '--force' })
    ).rejects.toThrow('path')
    await expect(
      addWorktree(runner as never, '/repo', { ...base, detach: true, startPoint: '--all' })
    ).rejects.toThrow('start point')
    expect(runner.calls).toEqual([])
  })
})

describe('removeWorktree', () => {
  it('removes safely by default and forces when asked', async () => {
    const runner = fakeRunner()
    await removeWorktree(runner as never, '/repo', '/tmp/feature')
    await removeWorktree(runner as never, '/repo', '/tmp/feature', true)

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['worktree', 'remove', '/tmp/feature'],
      ['worktree', 'remove', '--force', '/tmp/feature']
    ])
  })
})

describe('moveWorktree', () => {
  it('moves the worktree to the destination', async () => {
    const runner = fakeRunner()
    await moveWorktree(runner as never, '/repo', '/tmp/feature', '/tmp/moved')

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['worktree', 'move', '/tmp/feature', '/tmp/moved']
    ])
  })
})

describe('lockWorktree and unlockWorktree', () => {
  it('keeps the reason when one is given', async () => {
    const runner = fakeRunner()
    await lockWorktree(runner as never, '/repo', '/tmp/feature', 'external drive')
    await lockWorktree(runner as never, '/repo', '/tmp/feature', null)

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['worktree', 'lock', '--reason', 'external drive', '/tmp/feature'],
      ['worktree', 'lock', '/tmp/feature']
    ])
  })

  it('unlocks the worktree', async () => {
    const runner = fakeRunner()
    await unlockWorktree(runner as never, '/repo', '/tmp/feature')

    expect(runner.calls.map((call) => call.args)).toEqual([['worktree', 'unlock', '/tmp/feature']])
  })
})

describe('pruneWorktrees and repairWorktrees', () => {
  it('prunes missing worktrees', async () => {
    const runner = fakeRunner()
    await pruneWorktrees(runner as never, '/repo')

    expect(runner.calls.map((call) => call.args)).toEqual([['worktree', 'prune']])
  })

  it('repairs one worktree or all of them', async () => {
    const runner = fakeRunner()
    await repairWorktrees(runner as never, '/repo', '/tmp/moved')
    await repairWorktrees(runner as never, '/repo', null)

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['worktree', 'repair', '/tmp/moved'],
      ['worktree', 'repair']
    ])
  })
})
