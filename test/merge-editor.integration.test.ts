// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest'
import { applyMerge, GitRunner, readMergeEditor, readStatus } from '../src/core/git'
import { createRepository, type SampleRepository } from './fixtures/repository'

const runner = new GitRunner()
const repositories: SampleRepository[] = []

async function repository(): Promise<SampleRepository> {
  const created = await createRepository()
  repositories.push(created)
  return created
}

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

/** A merge stopped on one line both branches changed. */
async function conflicted(): Promise<SampleRepository> {
  const repo = await repository()
  repo.write('file.txt', 'one\ntwo\nthree\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Base'])

  await repo.git(['checkout', '-qb', 'side'])
  repo.write('file.txt', 'one\nTHEIRS\nthree\n')
  await repo.git(['commit', '-qam', 'Side'])

  await repo.git(['checkout', '-q', 'main'])
  repo.write('file.txt', 'one\nOURS\nthree\n')
  await repo.git(['commit', '-qam', 'Main'])

  const merge = await repo.run(['merge', 'side'])
  expect(merge.code).not.toBe(0)
  return repo
}

describe('readMergeEditor', () => {
  it('reads the three stages with Yours on the left and Theirs on the right', async () => {
    const repo = await conflicted()
    const model = await readMergeEditor(runner, repo.path, 'file.txt')

    expect(model.base?.lines).toEqual(['one', 'two', 'three'])
    expect(model.left?.lines).toEqual(['one', 'OURS', 'three'])
    expect(model.right?.lines).toEqual(['one', 'THEIRS', 'three'])
    expect(model.readOnly).toBe(false)
    expect(model.binary).toBe(false)
    expect(model.finalNewline).toBe(true)
    expect(model.eol).toBe('LF')
    expect(model.sides.yoursLabel).toBe('main')
    expect(model.sides.theirsLabel).toBe('side')
  })

  it('refuses a path that is not an unresolved conflict', async () => {
    const repo = await conflicted()
    await expect(readMergeEditor(runner, repo.path, 'missing.txt')).rejects.toThrow(
      /not an unresolved conflict/
    )
  })
})

describe('applyMerge', () => {
  it('writes and stages the result, which resolves the file', async () => {
    const repo = await conflicted()
    await applyMerge(runner, repo.path, {
      repo: repo.path,
      path: 'file.txt',
      content: 'one\nRESOLVED\nthree\n',
      stage: true
    })

    expect(repo.read('file.txt')).toBe('one\nRESOLVED\nthree\n')
    const status = await readStatus(runner, repo.path)
    expect(
      status.entries.some((entry) => entry.path === 'file.txt' && entry.kind === 'unmerged')
    ).toBe(false)
  })

  it('writes without staging for Save and close, keeping the conflict', async () => {
    const repo = await conflicted()
    await applyMerge(runner, repo.path, {
      repo: repo.path,
      path: 'file.txt',
      content: 'one\nSAVED\nthree\n',
      stage: false
    })

    expect(repo.read('file.txt')).toBe('one\nSAVED\nthree\n')
    const status = await readStatus(runner, repo.path)
    expect(status.entries.find((entry) => entry.path === 'file.txt')?.kind).toBe('unmerged')
  })
})
