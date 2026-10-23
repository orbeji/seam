// SPDX-License-Identifier: MIT

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitWatcher } from '../src/main/session/git-watcher'
import { createRepository, type SampleRepository } from './fixtures/repository'

const repositories: SampleRepository[] = []

/** A throwaway repository with one commit, so staging has something to change. */
async function repository(): Promise<SampleRepository> {
  const repo = await createRepository()
  repositories.push(repo)
  repo.write('a.txt', 'one\n')
  await repo.git(['add', 'a.txt'])
  await repo.git(['commit', '-qm', 'base'])
  return repo
}

function gitDir(repo: SampleRepository): string {
  return join(repo.path, '.git')
}

afterEach(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
})

describe('GitWatcher', () => {
  it('reports a change when a file is staged from outside the app', async () => {
    const repo = await repository()
    let changes = 0
    const watcher = new GitWatcher(gitDir(repo), () => {
      changes += 1
    })

    try {
      repo.write('a.txt', 'two\n')
      await repo.git(['add', 'a.txt'])
      await vi.waitFor(() => expect(changes).toBeGreaterThan(0), { timeout: 5000 })
    } finally {
      watcher.close()
    }
  })

  it('ignores edits to the working tree', async () => {
    const repo = await repository()
    let changes = 0
    const watcher = new GitWatcher(gitDir(repo), () => {
      changes += 1
    })

    try {
      // Writing a tracked file changes only the working tree, which is not
      // watched: the interface refreshes those on window focus instead.
      repo.write('a.txt', 'two\n')
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(changes).toBe(0)
    } finally {
      watcher.close()
    }
  })

  it('groups a burst of changes into a single report', async () => {
    const repo = await repository()
    let changes = 0
    const watcher = new GitWatcher(
      gitDir(repo),
      () => {
        changes += 1
      },
      { debounceMs: 120 }
    )

    try {
      for (let index = 0; index < 4; index += 1) {
        writeFileSync(join(gitDir(repo), 'index'), `state ${index}`)
      }
      await vi.waitFor(() => expect(changes).toBe(1), { timeout: 5000 })
      // Give a second debounce window a chance to report anything extra.
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(changes).toBe(1)
    } finally {
      watcher.close()
    }
  })

  it('stops reporting once it is closed', async () => {
    const repo = await repository()
    let changes = 0
    const watcher = new GitWatcher(gitDir(repo), () => {
      changes += 1
    })
    watcher.close()

    repo.write('a.txt', 'two\n')
    await repo.git(['add', 'a.txt'])
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(changes).toBe(0)
  })
})
