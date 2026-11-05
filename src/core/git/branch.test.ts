// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import type { GitRunOptions, GitRunResult } from './runner'
import {
  checkoutBranch,
  checkoutCommit,
  createBranch,
  deleteBranch,
  listBranches,
  renameBranch,
  validateBranchName
} from './branch'

const NUL = '\0'
const LF = '\n'

function result(stdout: string, code = 0): GitRunResult {
  return { stdout: Buffer.from(stdout, 'utf8'), stderr: code === 0 ? '' : 'boom', code }
}

interface FakeCall {
  args: readonly string[]
  options: GitRunOptions
}

/**
 * A runner stub whose replies are keyed by the ref prefix of the
 * `for-each-ref` invocation, so both reads can be scripted independently.
 */
function fakeRunner(replies: Record<string, GitRunResult>) {
  const calls: FakeCall[] = []
  return {
    calls,
    run(args: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
      calls.push({ args, options })
      const refs = args.find((arg) => arg.startsWith('refs/')) ?? ''
      const reply = replies[refs]
      if (reply === undefined && args[0] !== 'for-each-ref') return Promise.resolve(result(''))
      if (reply === undefined) return Promise.resolve(result('', 128))
      return Promise.resolve(reply)
    },
    async runOrThrow(args: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
      calls.push({ args, options })
      const reply = replies[args.join(' ')]
      if (reply === undefined) return Promise.resolve(result(''))
      if (reply.code !== 0) throw new Error(reply.stderr)
      return reply
    }
  }
}

// Real `git for-each-ref --format=%(refname:short)%00...%(HEAD) refs/heads/`
// shape: refs are LF-separated, each ref's fields are NUL-separated, and git
// appends one trailing LF after the last ref.
const LOCAL_OUTPUT =
  [`main${NUL}aaa111${NUL}*`, `feature/x${NUL}bbb222${NUL}`, `feature/y${NUL}ccc333${NUL}`].join(
    LF
  ) + LF

const REMOTE_OUTPUT =
  [
    `origin${NUL}aaa111${NUL}origin`,
    `origin/HEAD${NUL}aaa111${NUL}origin/main`,
    `origin/main${NUL}aaa111${NUL}origin/main`,
    `fork/depth/nested${NUL}ddd444${NUL}`
  ].join(LF) + LF

describe('listBranches', () => {
  it('parses local branches from LF-separated, NUL-fielded output', async () => {
    const runner = fakeRunner({ 'refs/heads/': result(LOCAL_OUTPUT), 'refs/remotes/': result('') })
    const list = await listBranches(runner as never, '/repo')

    expect(list.local.map((b) => b.name)).toEqual(['main', 'feature/x', 'feature/y'])
    expect(list.local.map((b) => b.current)).toEqual([true, false, false])
    expect(list.local[0]?.oid).toBe('aaa111')
  })

  it('parses remote branches, taking the remote from the name before the first slash', async () => {
    const runner = fakeRunner({ 'refs/heads/': result(''), 'refs/remotes/': result(REMOTE_OUTPUT) })
    const list = await listBranches(runner as never, '/repo')

    // The bare "origin" ref and the "origin/HEAD" placeholder are the remote's
    // HEAD, not branches to check out, so they are left out.
    expect(list.remote.map((b) => b.name)).toEqual(['origin/main', 'fork/depth/nested'])
    expect(list.remote.map((b) => b.remote)).toEqual(['origin', 'fork'])
  })

  it('treats a failing for-each-ref as an empty list instead of throwing', async () => {
    const runner = fakeRunner({
      'refs/heads/': result('', 128),
      'refs/remotes/': result('', 128)
    })
    const list = await listBranches(runner as never, '/repo')

    expect(list.local).toEqual([])
    expect(list.remote).toEqual([])
  })

  it('reads both ref groups, not just the first', async () => {
    const runner = fakeRunner({
      'refs/heads/': result(LOCAL_OUTPUT),
      'refs/remotes/': result(REMOTE_OUTPUT)
    })
    await listBranches(runner as never, '/repo')

    const refArgs = runner.calls
      .map((call) => call.args.find((arg) => arg.startsWith('refs/')))
      .filter((refs) => refs !== undefined)
    expect(refArgs).toEqual(['refs/heads/', 'refs/remotes/'])
  })
})

describe('createBranch', () => {
  it('creates and checks out a branch from HEAD by default', async () => {
    const runner = fakeRunner({})
    await createBranch(runner as never, '/repo', { name: 'feature/login' })

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['check-ref-format', '--branch', 'feature/login'],
      ['checkout', '-b', 'feature/login']
    ])
  })

  it('can create without checking out, from a chosen start point', async () => {
    const runner = fakeRunner({})
    await createBranch(runner as never, '/repo', {
      name: 'release/1.2.0',
      startPoint: 'develop',
      checkout: false
    })

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['check-ref-format', '--branch', 'release/1.2.0'],
      ['branch', 'release/1.2.0', 'develop']
    ])
  })

  it('treats an empty start point as HEAD', async () => {
    const runner = fakeRunner({})
    await createBranch(runner as never, '/repo', { name: 'topic', startPoint: '  ' })

    expect(runner.calls.map((call) => call.args).at(-1)).toEqual(['checkout', '-b', 'topic'])
  })

  it('refuses an invalid name before creating anything', async () => {
    const runner = fakeRunner({
      'check-ref-format --branch bad..name': result('', 128)
    })
    await expect(createBranch(runner as never, '/repo', { name: 'bad..name' })).rejects.toThrow(
      'boom'
    )

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['check-ref-format', '--branch', 'bad..name']
    ])
  })
})

describe('renameBranch and deleteBranch', () => {
  it('renames a branch after validating the new name', async () => {
    const runner = fakeRunner({})
    await renameBranch(runner as never, '/repo', 'old', 'new/name')

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['check-ref-format', '--branch', 'new/name'],
      ['branch', '-m', 'old', 'new/name']
    ])
  })

  it('deletes a branch safely by default', async () => {
    const runner = fakeRunner({})
    await deleteBranch(runner as never, '/repo', 'feature/done')

    expect(runner.calls.map((call) => call.args)).toEqual([['branch', '-d', 'feature/done']])
  })

  it('forces the deletion when asked', async () => {
    const runner = fakeRunner({})
    await deleteBranch(runner as never, '/repo', 'feature/abandoned', true)

    expect(runner.calls.map((call) => call.args)).toEqual([['branch', '-D', 'feature/abandoned']])
  })
})

describe('validateBranchName', () => {
  it('asks Git to validate the name', async () => {
    const runner = fakeRunner({})
    await validateBranchName(runner as never, '/repo', 'feature/x')

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['check-ref-format', '--branch', 'feature/x']
    ])
  })

  it('rejects an empty name without calling Git', async () => {
    const runner = fakeRunner({})
    await expect(validateBranchName(runner as never, '/repo', ' ')).rejects.toThrow(
      'cannot be empty'
    )

    expect(runner.calls).toEqual([])
  })
})

describe('checkoutBranch', () => {
  it('checks out a local branch with a plain checkout', async () => {
    const runner = fakeRunner({})
    await checkoutBranch(runner as never, '/repo', 'feature/x', false)

    expect(runner.calls.map((call) => call.args)).toEqual([['checkout', 'feature/x']])
  })

  it('fetches the remote and creates a tracking branch for a remote branch', async () => {
    const runner = fakeRunner({})
    await checkoutBranch(runner as never, '/repo', 'origin/main', true)

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['fetch', 'origin'],
      ['checkout', '-b', 'main', 'origin/main']
    ])
  })

  it('keeps the whole remainder of the name for remotes with slashes in the branch', async () => {
    const runner = fakeRunner({})
    await checkoutBranch(runner as never, '/repo', 'fork/depth/nested', true)

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['fetch', 'fork'],
      ['checkout', '-b', 'depth/nested', 'fork/depth/nested']
    ])
  })

  it('falls back to the existing local branch when it already exists', async () => {
    const runner = fakeRunner({
      'checkout -b main origin/main': result('', 1),
      'checkout main': result('')
    })
    await checkoutBranch(runner as never, '/repo', 'origin/main', true)

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['fetch', 'origin'],
      ['checkout', '-b', 'main', 'origin/main'],
      ['checkout', 'main']
    ])
  })

  it('propagates a failed command', async () => {
    const runner = fakeRunner({ 'checkout main': result('', 1) })
    await expect(checkoutBranch(runner as never, '/repo', 'main')).rejects.toThrow('boom')
  })
})

describe('checkoutCommit', () => {
  it('detaches HEAD at the commit instead of following a branch', async () => {
    const runner = fakeRunner({})
    const oid = 'abcdef0123456789abcdef0123456789abcdef01'
    await checkoutCommit(runner as never, '/repo', oid)

    expect(runner.calls.map((call) => call.args)).toEqual([['checkout', '--detach', oid]])
  })

  it('refuses a value that is not a commit id before calling Git', async () => {
    const runner = fakeRunner({})
    await expect(checkoutCommit(runner as never, '/repo', '--help')).rejects.toThrow('commit id')
    await expect(checkoutCommit(runner as never, '/repo', 'main')).rejects.toThrow('commit id')

    expect(runner.calls).toEqual([])
  })

  it('propagates Git refusing a checkout that would overwrite local changes', async () => {
    const oid = 'abcdef0'
    const runner = fakeRunner({ [`checkout --detach ${oid}`]: result('', 1) })
    await expect(checkoutCommit(runner as never, '/repo', oid)).rejects.toThrow('boom')
  })
})
