// SPDX-License-Identifier: MIT

import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  finishGitFlow,
  GitRunner,
  initGitFlow,
  readGitFlowState,
  readStatus,
  startGitFlow
} from '../src/core/git'
import { RepositoryService } from '../src/main/session/repository-service'
import { createRepository, type SampleRepository } from './fixtures/repository'

const runner = new GitRunner()
const repositories: SampleRepository[] = []

async function repository(): Promise<SampleRepository> {
  const repo = await createRepository()
  repositories.push(repo)
  repo.write('file.txt', 'base\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'base'])
  return repo
}

const CONFIG = {
  master: 'main',
  develop: 'develop',
  featurePrefix: 'feature/',
  releasePrefix: 'release/',
  hotfixPrefix: 'hotfix/',
  versionTagPrefix: 'v'
}

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

async function branchNames(repo: SampleRepository): Promise<string[]> {
  return (await repo.git(['branch', '--format=%(refname:short)']))
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name !== '')
}

async function subjects(repo: SampleRepository, ref: string): Promise<string[]> {
  return (await repo.git(['log', '--format=%s', ref]))
    .split('\n')
    .map((subject) => subject.trim())
    .filter((subject) => subject !== '')
}

describe('GitFlow initialization and start', () => {
  it('creates develop from master and stores the configuration', async () => {
    const repo = await repository()

    await initGitFlow(runner, repo.path, CONFIG)
    const state = await readGitFlowState(runner, repo.path)

    expect(state.initialized).toBe(true)
    expect(state.config).toEqual(CONFIG)
    expect(await branchNames(repo)).toContain('develop')
    expect((await readStatus(runner, repo.path)).branch.head).toBe('develop')
  })

  it('starts a feature from develop and a hotfix from master', async () => {
    const repo = await repository()
    await initGitFlow(runner, repo.path, CONFIG)

    expect(await startGitFlow(runner, repo.path, 'feature', 'login')).toBe('feature/login')
    expect((await readStatus(runner, repo.path)).branch.head).toBe('feature/login')

    await repo.git(['checkout', '-q', 'develop'])
    expect(await startGitFlow(runner, repo.path, 'hotfix', '1.0.1')).toBe('hotfix/1.0.1')
    expect((await readStatus(runner, repo.path)).branch.head).toBe('hotfix/1.0.1')
  })
})

describe('GitFlow finish', () => {
  it('merges a feature into develop and deletes the branch', async () => {
    const repo = await repository()
    await initGitFlow(runner, repo.path, CONFIG)
    await startGitFlow(runner, repo.path, 'feature', 'login')
    repo.write('login.txt', 'login\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'login'])

    const outcome = await finishGitFlow(runner, repo.path)

    expect(outcome.finished).toBe(true)
    expect(outcome.tag).toBeNull()
    expect((await readStatus(runner, repo.path)).branch.head).toBe('develop')
    expect(await branchNames(repo)).not.toContain('feature/login')
    expect(await subjects(repo, 'develop')).toContain("Merge branch 'feature/login' into develop")
    expect((await readGitFlowState(runner, repo.path)).pending).toBeNull()
  })

  it('merges a release into master, tags it and merges back into develop', async () => {
    const repo = await repository()
    await initGitFlow(runner, repo.path, CONFIG)
    await startGitFlow(runner, repo.path, 'release', '1.2.0')
    repo.write('release.txt', 'release\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'release work'])

    const outcome = await finishGitFlow(runner, repo.path)

    expect(outcome.finished).toBe(true)
    expect(outcome.tag).toBe('v1.2.0')
    expect(await branchNames(repo)).not.toContain('release/1.2.0')
    expect((await repo.git(['tag', '--list'])).trim()).toBe('v1.2.0')
    expect(await subjects(repo, 'main')).toContain("Merge branch 'release/1.2.0' into main")
    expect(await subjects(repo, 'develop')).toContain("Merge branch 'main' into develop")
    expect(existsSync(`${repo.path}/release.txt`)).toBe(true)
  })

  it('keeps the pending finish when a merge conflicts and resumes it after the commit', async () => {
    const repo = await repository()
    await initGitFlow(runner, repo.path, CONFIG)
    await startGitFlow(runner, repo.path, 'release', '2.0.0')
    repo.write('file.txt', 'release\n')
    await repo.git(['commit', '-qam', 'release edit'])
    await repo.git(['checkout', '-q', 'main'])
    repo.write('file.txt', 'main\n')
    await repo.git(['commit', '-qam', 'main edit'])
    await repo.git(['checkout', '-q', 'release/2.0.0'])

    const stopped = await finishGitFlow(runner, repo.path)

    expect(stopped.finished).toBe(false)
    expect(stopped.operation).toBe('merge')
    expect(stopped.conflicts).toBe(1)
    expect(stopped.step).toBe('merge-master')
    const pending = (await readGitFlowState(runner, repo.path)).pending
    expect(pending?.branch).toBe('release/2.0.0')
    expect(pending?.tag).toBe('v2.0.0')

    // The interface finishes the merge through the commit box, then resumes.
    repo.write('file.txt', 'resolved\n')
    await repo.git(['add', 'file.txt'])
    await repo.git(['commit', '-qm', "Merge branch 'release/2.0.0' into main"])

    const resumed = await finishGitFlow(runner, repo.path)

    expect(resumed.finished).toBe(true)
    expect(await branchNames(repo)).not.toContain('release/2.0.0')
    expect((await repo.git(['tag', '--list'])).trim()).toBe('v2.0.0')
    expect((await readGitFlowState(runner, repo.path)).pending).toBeNull()
  })
})

describe('RepositoryService GitFlow', () => {
  it('aborting a conflicted finish clears the pending record', async () => {
    const repo = await repository()
    const service = new RepositoryService()
    await initGitFlow(runner, repo.path, CONFIG)
    await startGitFlow(runner, repo.path, 'release', '4.0.0')
    repo.write('file.txt', 'release\n')
    await repo.git(['commit', '-qam', 'release edit'])
    await repo.git(['checkout', '-q', 'main'])
    repo.write('file.txt', 'main\n')
    await repo.git(['commit', '-qam', 'main edit'])
    await repo.git(['checkout', '-q', 'release/4.0.0'])

    const stopped = await service.finishGitFlow(repo.path, null)
    expect(stopped.ok && !stopped.value.finished).toBe(true)

    const aborted = await service.abortOperation(repo.path)
    expect(aborted.ok).toBe(true)
    const state = await service.readGitFlow(repo.path)
    expect(state.ok && state.value.pending).toBeNull()
  })

  it('starts a feature and finishes it through the service', async () => {
    const repo = await repository()
    const service = new RepositoryService()
    const initialized = await service.initGitFlow(repo.path, CONFIG)
    expect(initialized.ok).toBe(true)

    const started = await service.startGitFlow(repo.path, 'feature', 'service')
    expect(started.ok && started.value).toBe('feature/service')
    repo.write('service.txt', 'service\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'service work'])

    const finished = await service.finishGitFlow(repo.path, null)
    expect(finished.ok && finished.value.finished).toBe(true)
    expect(await branchNames(repo)).not.toContain('feature/service')
  })
})
