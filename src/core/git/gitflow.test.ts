// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { GitRunOptions, GitRunResult } from './runner'
import { finishGitFlow, initGitFlow, readGitFlowState, startGitFlow } from './gitflow'

const DIR = mkdtempSync(join(tmpdir(), 'seam-gitflow-test-'))
const PENDING = join(DIR, 'gitflow-finish.json')
const EXISTING = fileURLToPath(import.meta.url)
const MISSING = join(DIR, 'missing')

afterEach(() => {
  rmSync(PENDING, { force: true })
})

function result(stdout: string, code = 0): GitRunResult {
  return { stdout: Buffer.from(stdout, 'utf8'), stderr: code === 0 ? '' : 'boom', code }
}

interface FakeOptions {
  readonly config?: Record<string, string>
  readonly local?: readonly string[]
  readonly current?: string
  readonly status?: string
  readonly mergeCode?: number
  readonly ancestor?: boolean
  readonly operation?: string | null
  /** The operation Git leaves behind after the merge step. */
  readonly mergeOperation?: string | null
  /** The status Git leaves behind after the merge step. */
  readonly afterStatus?: string
}

function fakeRunner(options: FakeOptions = {}) {
  const state = {
    config: { ...(options.config ?? {}) },
    local: [...(options.local ?? ['main', 'develop'])],
    current: options.current ?? 'develop',
    status: options.status,
    mergeCode: options.mergeCode ?? 0,
    ancestor: options.ancestor ?? false,
    operation: options.operation ?? null
  }
  const calls: Array<{ args: readonly string[]; options: GitRunOptions }> = []

  function reply(args: readonly string[]): GitRunResult {
    if (args[0] === 'config' && args[1] === '--get') {
      const value = state.config[args[2] ?? '']
      return value === undefined ? result('', 1) : result(`${value}\n`)
    }
    if (args[0] === 'config' && args[1] === '--local') {
      state.config[args[2] ?? ''] = args[3] ?? ''
      return result('')
    }
    if (args[0] === 'for-each-ref') {
      if (!args.includes('refs/heads/')) return result('')
      const lines = state.local.map((name) => `${name}\0aaa\0${name === state.current ? '*' : ''}`)
      return result(`${lines.join('\n')}\n`)
    }
    if (args[0] === 'status') {
      return result(state.status ?? `# branch.oid aaa\0# branch.head ${state.current}\0`)
    }
    if (args[0] === 'rev-parse' && args[1] === '--git-path') {
      const marker = args[2] ?? ''
      if (marker === 'seam/gitflow-finish.json') return result(PENDING)
      return result(state.operation === marker ? EXISTING : MISSING)
    }
    if (args[0] === 'rev-parse' && args[1] === '--verify') return result('', 1)
    if (args[0] === 'merge') {
      state.operation = options.mergeOperation ?? state.operation
      state.status = options.afterStatus ?? state.status
      return result('', state.mergeCode)
    }
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      return result('', state.ancestor ? 0 : 1)
    }
    return result('')
  }

  return {
    calls,
    state,
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

const CONFIG = {
  'gitflow.branch.master': 'main',
  'gitflow.branch.develop': 'develop',
  'gitflow.prefix.feature': 'feature/',
  'gitflow.prefix.release': 'release/',
  'gitflow.prefix.hotfix': 'hotfix/',
  'gitflow.prefix.versiontag': 'v'
}

describe('readGitFlowState', () => {
  it('offers the default form values before GitFlow is initialized', async () => {
    const runner = fakeRunner({ local: ['main'], current: 'main' })
    const state = await readGitFlowState(runner as never, '/repo')

    expect(state.initialized).toBe(false)
    expect(state.config).toEqual({
      master: 'main',
      develop: 'develop',
      featurePrefix: 'feature/',
      releasePrefix: 'release/',
      hotfixPrefix: 'hotfix/',
      versionTagPrefix: 'v'
    })
    expect(state.currentKind).toBeNull()
  })

  it('classifies the current branch and the branches of each family', async () => {
    const runner = fakeRunner({
      config: CONFIG,
      local: ['main', 'develop', 'feature/a', 'feature/b', 'release/1.0', 'hotfix/1.0.1'],
      current: 'feature/a'
    })
    const state = await readGitFlowState(runner as never, '/repo')

    expect(state.initialized).toBe(true)
    expect(state.currentKind).toBe('feature')
    expect(state.currentName).toBe('a')
    expect(state.branches).toEqual({
      feature: ['feature/a', 'feature/b'],
      release: ['release/1.0'],
      hotfix: ['hotfix/1.0.1']
    })
  })

  it('is not initialized when a configured main branch is missing', async () => {
    const runner = fakeRunner({ config: CONFIG, local: ['main'], current: 'main' })
    const state = await readGitFlowState(runner as never, '/repo')

    expect(state.initialized).toBe(false)
  })
})

describe('initGitFlow', () => {
  it('creates develop, writes the configuration and checks it out', async () => {
    const runner = fakeRunner({ local: ['main'], current: 'main' })

    await initGitFlow(runner as never, '/repo', {
      master: 'main',
      develop: 'develop',
      featurePrefix: 'feature',
      releasePrefix: 'release',
      hotfixPrefix: 'hotfix',
      versionTagPrefix: 'v'
    })

    expect(runner.calls.map((call) => call.args)).toContainEqual(['branch', 'develop', 'main'])
    expect(runner.calls.map((call) => call.args)).toContainEqual([
      'config',
      '--local',
      'gitflow.prefix.feature',
      'feature/'
    ])
    expect(runner.calls.map((call) => call.args)).toContainEqual(['checkout', 'develop'])
    expect(runner.state.config['gitflow.branch.develop']).toBe('develop')
  })

  it('refuses a master branch that does not exist', async () => {
    const runner = fakeRunner({ local: ['main'], current: 'main' })

    await expect(
      initGitFlow(runner as never, '/repo', {
        master: 'trunk',
        develop: 'develop',
        featurePrefix: 'feature/',
        releasePrefix: 'release/',
        hotfixPrefix: 'hotfix/',
        versionTagPrefix: 'v'
      })
    ).rejects.toThrow('does not exist')
  })

  it('refuses to check out develop over tracked changes', async () => {
    const runner = fakeRunner({
      local: ['main'],
      current: 'main',
      status:
        '# branch.oid aaa\0# branch.head main\0' +
        '1 .M N... 100644 100644 100644 aaa bbb file.txt\0'
    })

    await expect(
      initGitFlow(runner as never, '/repo', {
        master: 'main',
        develop: 'develop',
        featurePrefix: 'feature/',
        releasePrefix: 'release/',
        hotfixPrefix: 'hotfix/',
        versionTagPrefix: 'v'
      })
    ).rejects.toThrow('Commit or stash')
  })
})

describe('startGitFlow', () => {
  it('starts a feature from develop', async () => {
    const runner = fakeRunner({ config: CONFIG, current: 'develop' })
    const branch = await startGitFlow(runner as never, '/repo', 'feature', 'login')

    expect(branch).toBe('feature/login')
    expect(runner.calls.map((call) => call.args)).toContainEqual([
      'checkout',
      '-b',
      'feature/login',
      'develop'
    ])
  })

  it('starts a hotfix from master', async () => {
    const runner = fakeRunner({ config: CONFIG, current: 'main' })
    const branch = await startGitFlow(runner as never, '/repo', 'hotfix', '1.0.1')

    expect(branch).toBe('hotfix/1.0.1')
    expect(runner.calls.map((call) => call.args)).toContainEqual([
      'checkout',
      '-b',
      'hotfix/1.0.1',
      'main'
    ])
  })

  it('accepts a name that already carries the prefix', async () => {
    const runner = fakeRunner({ config: CONFIG, current: 'develop' })
    const branch = await startGitFlow(runner as never, '/repo', 'feature', 'feature/login')

    expect(branch).toBe('feature/login')
  })

  it('refuses to start on a dirty working tree', async () => {
    const runner = fakeRunner({
      config: CONFIG,
      current: 'develop',
      status:
        '# branch.oid aaa\0# branch.head develop\0' +
        '1 .M N... 100644 100644 100644 aaa bbb file.txt\0'
    })

    await expect(startGitFlow(runner as never, '/repo', 'feature', 'login')).rejects.toThrow(
      'Commit or stash'
    )
  })
})

describe('finishGitFlow', () => {
  it('merges a feature into develop and deletes it', async () => {
    const runner = fakeRunner({
      config: CONFIG,
      local: ['main', 'develop', 'feature/login'],
      current: 'feature/login'
    })

    const outcome = await finishGitFlow(runner as never, '/repo')

    expect(outcome.finished).toBe(true)
    expect(outcome.tag).toBeNull()
    expect(runner.calls.map((call) => call.args)).toContainEqual([
      'merge',
      '--no-ff',
      '-m',
      "Merge branch 'feature/login' into develop",
      '--',
      'feature/login'
    ])
    expect(runner.calls.map((call) => call.args)).toContainEqual(['branch', '-d', 'feature/login'])
  })

  it('merges a release into master, tags it, merges back and deletes it', async () => {
    const runner = fakeRunner({
      config: CONFIG,
      local: ['main', 'develop', 'release/1.2.0'],
      current: 'release/1.2.0'
    })

    const outcome = await finishGitFlow(runner as never, '/repo', '1.2.0')

    expect(outcome.finished).toBe(true)
    expect(outcome.tag).toBe('1.2.0')
    const args = runner.calls.map((call) => call.args)
    expect(args).toContainEqual([
      'merge',
      '--no-ff',
      '-m',
      "Merge branch 'release/1.2.0' into main",
      '--',
      'release/1.2.0'
    ])
    expect(args).toContainEqual(['tag', '-a', '1.2.0', '-m', 'Release 1.2.0'])
    expect(args).toContainEqual([
      'merge',
      '--no-ff',
      '-m',
      "Merge branch 'main' into develop",
      '--',
      'main'
    ])
    expect(args).toContainEqual(['branch', '-d', 'release/1.2.0'])
  })

  it('stops on a merge conflict and keeps the pending finish', async () => {
    const runner = fakeRunner({
      config: CONFIG,
      local: ['main', 'develop', 'feature/login'],
      current: 'feature/login',
      mergeCode: 1,
      mergeOperation: 'MERGE_HEAD',
      afterStatus:
        '# branch.oid aaa\0# branch.head develop\0' +
        'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.txt\0'
    })

    const outcome = await finishGitFlow(runner as never, '/repo')

    expect(outcome.finished).toBe(false)
    expect(outcome.operation).toBe('merge')
    expect(outcome.conflicts).toBe(1)
    expect(outcome.step).toBe('merge-develop')
    expect(outcome.failed).toBe(false)
  })
})
