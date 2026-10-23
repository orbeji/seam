// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitRunner, push, readPushState, updateForPush } from '../src/core/git'
import { createRepository, SampleRepository } from './fixtures/repository'

/**
 * Phase 8 against real repositories: every remote is a bare folder, so no test
 * touches the network. The push command, its porcelain output and the two ways
 * out of a rejection are compared with what Git does in a terminal.
 */

const runner = new GitRunner()

const repositories: SampleRepository[] = []
const temporaries: string[] = []

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
  while (temporaries.length > 0) rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
})

async function bareRemote(): Promise<string> {
  const path = mkdtempSync(join(tmpdir(), 'seam-remote-'))
  temporaries.push(path)
  await runner.runOrThrow(['init', '--bare', '-q', path], { cwd: tmpdir() })
  await runner.runOrThrow(['--git-dir', path, 'symbolic-ref', 'HEAD', 'refs/heads/main'], {
    cwd: tmpdir()
  })
  return path
}

/** A repository with an `origin` that points at the bare remote. */
async function repository(remote: string): Promise<SampleRepository> {
  const repo = await createRepository()
  repositories.push(repo)
  await repo.git(['remote', 'add', 'origin', remote])
  return repo
}

/** A second working copy that pushes to the same remote, as another person would. */
async function clone(remote: string): Promise<SampleRepository> {
  const path = mkdtempSync(join(tmpdir(), 'seam-clone-'))
  const repo = new SampleRepository(path, runner)
  repositories.push(repo)
  await runner.runOrThrow(['clone', '-q', remote, path], { cwd: tmpdir() })
  return repo
}

async function head(repo: SampleRepository): Promise<string> {
  return (await repo.git(['rev-parse', 'HEAD'])).trim()
}

async function remoteHead(remote: string, ref = 'refs/heads/main'): Promise<string> {
  const result = await runner.runOrThrow(['--git-dir', remote, 'rev-parse', ref], {
    cwd: tmpdir()
  })
  return result.stdout.toString('utf8').trim()
}

async function remoteSubjects(remote: string): Promise<string> {
  const result = await runner.runOrThrow(['--git-dir', remote, 'log', '--format=%s'], {
    cwd: tmpdir()
  })
  return result.stdout.toString('utf8')
}

async function remoteTags(remote: string): Promise<string> {
  const result = await runner.runOrThrow(['--git-dir', remote, 'tag'], { cwd: tmpdir() })
  return result.stdout.toString('utf8')
}

async function firstCommit(repo: SampleRepository, name = 'Base'): Promise<void> {
  repo.write('f.txt', 'base\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', name])
}

describe('readPushState', () => {
  it('offers the origin and the branch before there is an upstream', async () => {
    const remote = await bareRemote()
    const repo = await repository(remote)
    await firstCommit(repo)

    const state = await readPushState(runner, repo.path)
    expect(state.branch).toBe('main')
    expect(state.upstream).toBeNull()
    expect(state.remote).toBe('origin')
    expect(state.remoteBranch).toBe('main')
    expect(state.hasUpstream).toBe(false)
    expect(state.remoteBranchExists).toBe(false)
    expect(state.commits.map((commit) => commit.subject)).toEqual(['Base'])
    expect(state.detached).toBe(false)
  })

  it('reads the upstream and leaves no commits once the branch is pushed', async () => {
    const remote = await bareRemote()
    const repo = await repository(remote)
    await firstCommit(repo)

    const pushed = await push(runner, repo.path, {
      remote: 'origin',
      branch: 'main',
      remoteBranch: 'main',
      setUpstream: true,
      tags: 'none'
    })
    expect(pushed.ok).toBe(true)

    const state = await readPushState(runner, repo.path)
    expect(state.upstream).toBe('origin/main')
    expect(state.hasUpstream).toBe(true)
    expect(state.remoteBranchExists).toBe(true)
    expect(state.remoteOid).toBe(await head(repo))
    expect(state.commits).toEqual([])
  })

  it('has nothing to push and no branch when HEAD is detached', async () => {
    const remote = await bareRemote()
    const repo = await repository(remote)
    await firstCommit(repo)
    await repo.git(['checkout', '-q', '--detach'])

    const state = await readPushState(runner, repo.path)
    expect(state.detached).toBe(true)
    expect(state.branch).toBeNull()
    expect(state.commits).toEqual([])
  })
})

describe('push', () => {
  it('creates a branch without an upstream and sets one', async () => {
    const remote = await bareRemote()
    const repo = await repository(remote)
    await firstCommit(repo)
    const oid = await head(repo)

    const outcome = await push(runner, repo.path, {
      remote: 'origin',
      branch: 'main',
      remoteBranch: 'main',
      setUpstream: true,
      tags: 'none'
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.authFailed).toBe(false)
    expect(outcome.refs).toHaveLength(1)
    expect(outcome.refs[0]?.flag).toBe('*')
    expect(await remoteHead(remote)).toBe(oid)
    expect((await repo.git(['rev-parse', '--abbrev-ref', 'main@{u}'])).trim()).toBe(
      'origin/main'
    )
  })

  it('follows the tags the pushed commits reach, and sends all tags when asked', async () => {
    const remote = await bareRemote()
    const repo = await repository(remote)
    await firstCommit(repo)
    await repo.git(['tag', 'light'])
    await repo.git(['tag', '-a', 'v1', '-m', 'one'])
    await repo.git(['push', '-q', '-u', 'origin', 'main'])

    repo.write('g.txt', 'next\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'Next'])
    await repo.git(['tag', '-a', 'v2', '-m', 'two'])

    const followed = await push(runner, repo.path, {
      remote: 'origin',
      branch: 'main',
      remoteBranch: 'main',
      setUpstream: false,
      tags: 'follow'
    })
    expect(followed.ok).toBe(true)
    // `--follow-tags` sends annotated tags reachable from the sent commits and
    // leaves the lightweight one behind.
    expect((await remoteTags(remote)).split('\n')).toContain('v2')
    expect((await remoteTags(remote)).split('\n')).not.toContain('light')

    const all = await push(runner, repo.path, {
      remote: 'origin',
      branch: 'main',
      remoteBranch: 'main',
      setUpstream: false,
      tags: 'all'
    })
    expect(all.ok).toBe(true)
    expect((await remoteTags(remote)).split('\n')).toContain('light')
  })

  it('reports the server message when a pre-receive hook refuses', async () => {
    const remote = await bareRemote()
    const repo = await repository(remote)
    await firstCommit(repo)
    await repo.git(['push', '-q', '-u', 'origin', 'main'])

    writeFileSync(
      join(remote, 'hooks', 'pre-receive'),
      '#!/bin/sh\necho "no pushes allowed" >&2\nexit 1\n',
      { mode: 0o755 }
    )
    repo.write('g.txt', 'next\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'Next'])

    const outcome = await push(runner, repo.path, {
      remote: 'origin',
      branch: 'main',
      remoteBranch: 'main',
      setUpstream: false,
      tags: 'none'
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.refs[0]?.rejection).toBe('remote-rejected')
    expect(outcome.output).toContain('no pushes allowed')
  })
})

describe('a rejected push', () => {
  it('offers Update and push with a merge', async () => {
    const remote = await bareRemote()
    const repo = await repository(remote)
    await firstCommit(repo)
    await repo.git(['push', '-q', '-u', 'origin', 'main'])

    const other = await clone(remote)
    other.write('other.txt', 'theirs\n')
    await other.git(['add', '.'])
    await other.git(['commit', '-qm', 'Other change'])
    await other.git(['push', '-q', 'origin', 'main'])

    repo.write('local.txt', 'ours\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'Local change'])

    const rejected = await push(runner, repo.path, {
      remote: 'origin',
      branch: 'main',
      remoteBranch: 'main',
      setUpstream: false,
      tags: 'none'
    })
    expect(rejected.ok).toBe(false)
    expect(rejected.refs[0]?.rejection).toBe('non-fast-forward')

    const update = await updateForPush(runner, repo.path, 'merge')
    expect(update.fetched).toBe(true)
    expect(update.ok).toBe(true)
    expect(update.operation).toBeNull()

    const retried = await push(runner, repo.path, {
      remote: 'origin',
      branch: 'main',
      remoteBranch: 'main',
      setUpstream: false,
      tags: 'none'
    })
    expect(retried.ok).toBe(true)
    expect(await remoteHead(remote)).toBe(await head(repo))
    expect(await remoteSubjects(remote)).toContain('Local change')
    expect(await remoteSubjects(remote)).toContain('Other change')
  })

  it('offers Update and push with a rebase, leaving a linear history', async () => {
    const remote = await bareRemote()
    const repo = await repository(remote)
    await firstCommit(repo)
    await repo.git(['push', '-q', '-u', 'origin', 'main'])

    const other = await clone(remote)
    other.write('other.txt', 'theirs\n')
    await other.git(['add', '.'])
    await other.git(['commit', '-qm', 'Other change'])
    await other.git(['push', '-q', 'origin', 'main'])

    repo.write('local.txt', 'ours\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'Local change'])

    const update = await updateForPush(runner, repo.path, 'rebase')
    expect(update.ok).toBe(true)

    const retried = await push(runner, repo.path, {
      remote: 'origin',
      branch: 'main',
      remoteBranch: 'main',
      setUpstream: false,
      tags: 'none'
    })
    expect(retried.ok).toBe(true)
    expect(await remoteHead(remote)).toBe(await head(repo))
    expect((await repo.git(['rev-list', '--count', '--merges', 'HEAD'])).trim()).toBe('0')
  })

  it('leaves the merge in progress when the two sides conflict', async () => {
    const remote = await bareRemote()
    const repo = await repository(remote)
    await firstCommit(repo)
    await repo.git(['push', '-q', '-u', 'origin', 'main'])

    const other = await clone(remote)
    other.write('f.txt', 'theirs\n')
    await other.git(['add', '.'])
    await other.git(['commit', '-qm', 'Other change'])
    await other.git(['push', '-q', 'origin', 'main'])

    repo.write('f.txt', 'ours\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'Local change'])

    const update = await updateForPush(runner, repo.path, 'merge')
    expect(update.ok).toBe(false)
    expect(update.operation).toBe('merge')
    expect(update.conflicts).toBeGreaterThan(0)

    // Resolving and finishing the merge, as phase 7 does, then pushing again.
    repo.write('f.txt', 'resolved\n')
    await repo.git(['add', 'f.txt'])
    await repo.git(['commit', '-qm', 'Merge remote-tracking branch'])
    const retried = await push(runner, repo.path, {
      remote: 'origin',
      branch: 'main',
      remoteBranch: 'main',
      setUpstream: false,
      tags: 'none'
    })
    expect(retried.ok).toBe(true)
    expect(await remoteHead(remote)).toBe(await head(repo))
  })
})

describe('force push', () => {
  it('uses the lease and fails when the remote moved after the dialog read it', async () => {
    const remote = await bareRemote()
    const repo = await repository(remote)
    await firstCommit(repo)
    await repo.git(['push', '-q', '-u', 'origin', 'main'])

    // What the dialog saw when it opened.
    const seen = await readPushState(runner, repo.path)
    expect(seen.remoteOid).not.toBeNull()

    const other = await clone(remote)
    other.write('other.txt', 'theirs\n')
    await other.git(['add', '.'])
    await other.git(['commit', '-qm', 'Other change'])
    await other.git(['push', '-q', 'origin', 'main'])

    repo.write('local.txt', 'ours\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'Local change'])

    const stale = await push(runner, repo.path, {
      remote: 'origin',
      branch: 'main',
      remoteBranch: 'main',
      setUpstream: false,
      tags: 'none',
      forceLeaseOid: seen.remoteOid
    })
    expect(stale.ok).toBe(false)
    expect(stale.refs[0]?.rejection).toBe('stale-info')

    // Fetching shows the new remote commit, and the lease then matches it.
    await repo.git(['fetch', '-q', 'origin'])
    const fresh = await readPushState(runner, repo.path)
    expect(fresh.remoteOid).not.toBe(seen.remoteOid)

    const forced = await push(runner, repo.path, {
      remote: 'origin',
      branch: 'main',
      remoteBranch: 'main',
      setUpstream: false,
      tags: 'none',
      forceLeaseOid: fresh.remoteOid
    })
    expect(forced.ok).toBe(true)
    expect(await remoteHead(remote)).toBe(await head(repo))
  })
})
