// SPDX-License-Identifier: MIT

import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { GitRunOptions, GitRunResult } from './runner'
import { mergeBranch, readMergeState } from './merge'

const MISSING = join(tmpdir(), 'seam-merge-test-missing')
const EXISTING = fileURLToPath(import.meta.url)

function result(stdout: string, code = 0): GitRunResult {
  return { stdout: Buffer.from(stdout, 'utf8'), stderr: code === 0 ? '' : 'boom', code }
}

interface FakeOptions {
  readonly status?: string
  readonly local?: string
  readonly remote?: string
  readonly mergeResult?: GitRunResult
  readonly operationMarker?: string
}

function fakeRunner(options: FakeOptions = {}) {
  const calls: Array<{ args: readonly string[]; options: GitRunOptions }> = []
  const status = options.status ?? '# branch.oid aaa\0# branch.head main\0'
  const local = options.local ?? ''
  const remote = options.remote ?? ''
  const mergeResult = options.mergeResult ?? result('')

  function reply(args: readonly string[]): GitRunResult {
    if (args[0] === 'status') return result(status)
    if (args[0] === 'for-each-ref') {
      return result(args.includes('refs/heads/') ? local : remote)
    }
    if (args[0] === 'rev-parse' && args[1] === '--git-path') {
      const marker = args[2] ?? ''
      return result(options.operationMarker === marker ? EXISTING : `${MISSING}-none`)
    }
    if (args[0] === 'merge') return mergeResult
    return result('')
  }

  return {
    calls,
    run(args: readonly string[], runOptions: GitRunOptions): Promise<GitRunResult> {
      calls.push({ args, options: runOptions })
      return Promise.resolve(reply(args))
    },
    runOrThrow(args: readonly string[], runOptions: GitRunOptions): Promise<GitRunResult> {
      calls.push({ args, options: runOptions })
      const value = reply(args)
      if (value.code !== 0) return Promise.reject(new Error(value.stderr))
      return Promise.resolve(value)
    }
  }
}

describe('readMergeState', () => {
  it('lists the branches and leaves untracked files out of the dirty flag', async () => {
    const runner = fakeRunner({
      status: '# branch.oid aaa\0# branch.head develop\0? new.txt\0',
      local: `develop\0aaa\0*\nmain\0aaa\0\n`,
      remote: `origin/main\0aaa\0\n`
    })
    const state = await readMergeState(runner as never, '/repo')

    expect(state.currentBranch).toBe('develop')
    expect(state.headOid).toBe('aaa')
    expect(state.local).toEqual(['develop', 'main'])
    expect(state.remote).toEqual(['origin/main'])
    expect(state.conflicts).toBe(0)
    expect(state.dirty).toBe(false)
  })

  it('counts tracked changes and unmerged files', async () => {
    const runner = fakeRunner({
      status:
        '# branch.oid aaa\0# branch.head main\0' +
        '1 .M N... 100644 100644 100644 aaa bbb file.txt\0' +
        'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.txt\0'
    })
    const state = await readMergeState(runner as never, '/repo')

    expect(state.dirty).toBe(true)
    expect(state.conflicts).toBe(1)
  })
})

describe('mergeBranch', () => {
  it('creates a merge commit with --no-ff and the message', async () => {
    const runner = fakeRunner({ mergeResult: result('') })
    const outcome = await mergeBranch(
      runner as never,
      '/repo',
      'feature/x',
      'merge-commit',
      'Merge feature/x'
    )

    expect(outcome.ok).toBe(true)
    expect(runner.calls.find((call) => call.args[0] === 'merge')?.args).toEqual([
      'merge',
      '--no-ff',
      '-m',
      'Merge feature/x',
      '--',
      'feature/x'
    ])
  })

  it('uses --ff-only and leaves the message out of the command', async () => {
    const runner = fakeRunner({ mergeResult: result('') })
    await mergeBranch(runner as never, '/repo', 'develop', 'fast-forward', 'ignored')

    expect(runner.calls.find((call) => call.args[0] === 'merge')?.args).toEqual([
      'merge',
      '--ff-only',
      '--',
      'develop'
    ])
  })

  it('uses --squash and reports the staged result as a success', async () => {
    const runner = fakeRunner({ mergeResult: result('') })
    const outcome = await mergeBranch(runner as never, '/repo', 'develop', 'squash')

    expect(outcome.ok).toBe(true)
    expect(runner.calls.find((call) => call.args[0] === 'merge')?.args).toEqual([
      'merge',
      '--squash',
      '--',
      'develop'
    ])
  })

  it('refuses to start while another operation is in progress', async () => {
    const runner = fakeRunner({ operationMarker: 'CHERRY_PICK_HEAD' })

    await expect(mergeBranch(runner as never, '/repo', 'develop', 'merge-commit')).rejects.toThrow(
      'cherry-pick is already in progress'
    )

    expect(runner.calls.some((call) => call.args[0] === 'merge')).toBe(false)
  })

  it('returns a failed outcome with the output when the merge refuses', async () => {
    const runner = fakeRunner({
      mergeResult: { stdout: Buffer.from(''), stderr: 'not possible', code: 1 }
    })
    const outcome = await mergeBranch(runner as never, '/repo', 'develop', 'merge-commit')

    expect(outcome.ok).toBe(false)
    expect(outcome.output).toBe('not possible')
  })
})
