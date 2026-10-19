// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitRunner } from '../../src/core/git'
import { createRepository, type SampleRepository } from '../fixtures/repository'

/**
 * The phase 4 amend test: checking Amend fills the box with the last commit's
 * message and shows which commit it is, the commit adds the staged changes or
 * only rewrites the message, and a commit already on a remote is flagged.
 */

const runner = new GitRunner()
const temporaries: string[] = []
const repositories: SampleRepository[] = []
let userData: string
let application: ElectronApplication | null = null
let page: Page

async function repository(): Promise<SampleRepository> {
  const created = await createRepository()
  repositories.push(created)
  return created
}

/** Pins the identity in the repository, away from the machine's Git config. */
async function identity(repo: SampleRepository): Promise<void> {
  await runner.runOrThrow(['config', 'user.name', 'Seam Test'], { cwd: repo.path })
  await runner.runOrThrow(['config', 'user.email', 'seam@example.com'], { cwd: repo.path })
  await runner.runOrThrow(['config', 'commit.gpgsign', 'false'], { cwd: repo.path })
}

/** One commit whose file has no staged change yet. */
async function withCommit(): Promise<SampleRepository> {
  const repo = await repository()
  await identity(repo)
  repo.write('f.txt', 'one\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'base'])
  return repo
}

/** One commit with a further change staged, ready to be folded into it. */
async function withStagedChange(): Promise<SampleRepository> {
  const repo = await withCommit()
  repo.write('f.txt', 'one\ntwo\n')
  await repo.git(['add', '.'])
  return repo
}

/** Launches the application against a repository, replacing any running one. */
async function launch(repo: string): Promise<void> {
  if (application !== null) await application.close()
  application = await electron.launch({
    args: ['--no-sandbox', join(process.cwd(), 'out', 'main', 'index.js'), '--repo', repo],
    env: { ...process.env, SEAM_USER_DATA: userData, SEAM_HIDDEN_WINDOW: '1' } as Record<
      string,
      string
    >
  })
  page = await application.firstWindow()
  await page.waitForSelector('[data-testid=commit-message]')
}

async function waitFor(condition: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

beforeAll(() => {
  userData = mkdtempSync(join(tmpdir(), 'seam-e2e-amend-user-'))
  temporaries.push(userData)
})

afterAll(async () => {
  await application?.close()
  while (repositories.length > 0) repositories.pop()?.cleanup()
  while (temporaries.length > 0) rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
})

describe('amending from the box', () => {
  it('folds the staged change into the last commit with a new message', async () => {
    const repo = await withStagedChange()
    await launch(repo.path)
    const box = page.locator('[data-testid=commit-message]')

    await page.locator('[data-testid=commit-amend]').check()
    await waitFor(async () => (await box.inputValue()) === 'base', 'the previous message')
    await waitFor(
      async () => (await page.locator('[data-testid=commit-head]').count()) === 1,
      'the commit being amended'
    )
    expect(await page.locator('[data-testid=commit-head]').innerText()).toContain('base')

    await box.fill('amended with the change')
    await page.locator('[data-testid=commit-button]').click()
    await waitFor(async () => (await box.inputValue()) === '', 'the box to empty')
    await waitFor(
      async () => !(await page.locator('[data-testid=commit-amend]').isChecked()),
      'Amend to be cleared'
    )

    expect(await repo.git(['rev-list', '--count', 'HEAD'])).toBe('1\n')
    expect(await repo.git(['log', '-1', '--format=%s'])).toBe('amended with the change\n')
    expect(await repo.git(['cat-file', '-p', 'HEAD:f.txt'])).toBe('one\ntwo\n')
  })

  it('rewrites only the message when nothing is staged', async () => {
    const repo = await withCommit()
    const tree = await repo.git(['rev-parse', 'HEAD^{tree}'])
    await launch(repo.path)
    const box = page.locator('[data-testid=commit-message]')

    await page.locator('[data-testid=commit-amend]').check()
    await waitFor(async () => (await box.inputValue()) === 'base', 'the previous message')
    await box.fill('a new message only')
    await page.locator('[data-testid=commit-button]').click()
    await waitFor(async () => (await box.inputValue()) === '', 'the box to empty')

    expect(await repo.git(['rev-list', '--count', 'HEAD'])).toBe('1\n')
    expect(await repo.git(['log', '-1', '--format=%s'])).toBe('a new message only\n')
    expect(await repo.git(['rev-parse', 'HEAD^{tree}'])).toBe(tree)
  })

  it('warns when the commit is already published', async () => {
    const repo = await withCommit()
    // A remote-tracking reference is enough for `branch -r --contains HEAD`.
    await repo.git(['update-ref', 'refs/remotes/origin/main', 'HEAD'])
    await launch(repo.path)

    await page.locator('[data-testid=commit-amend]').check()
    await waitFor(
      async () => (await page.locator('[data-testid=commit-published]').count()) === 1,
      'the published warning'
    )
  })
})
