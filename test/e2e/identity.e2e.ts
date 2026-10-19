// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRepository, type SampleRepository } from '../fixtures/repository'

/**
 * The phase 4 identity test: a repository without `user.*`, under an empty home,
 * opens the dialog when Commit is pressed; the identity is then kept either in
 * the repository or for every repository, and the waiting commit goes through.
 */

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

/** A repository with one file staged and no commit yet. */
async function staged(): Promise<SampleRepository> {
  const repo = await repository()
  repo.write('f.txt', 'one\n')
  await repo.git(['add', 'f.txt'])
  return repo
}

async function waitFor(condition: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

/** A home of its own, so no global configuration can supply the identity. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'seam-e2e-identity-home-'))
  temporaries.push(home)
  return home
}

async function launch(repo: string, home: string): Promise<void> {
  if (application !== null) await application.close()
  application = await electron.launch({
    args: ['--no-sandbox', join(process.cwd(), 'out', 'main', 'index.js'), '--repo', repo],
    env: {
      ...process.env,
      SEAM_USER_DATA: userData,
      SEAM_HIDDEN_WINDOW: '1',
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      GIT_CONFIG_NOSYSTEM: '1'
    } as Record<string, string>
  })
  page = await application.firstWindow()
  await page.waitForSelector('[data-testid=commit-message]')
}

/** Types a message, presses Commit and waits for the identity dialog. */
async function openDialog(message: string): Promise<void> {
  await page.locator('[data-testid=commit-message]').fill(message)
  await page.locator('[data-testid=commit-button]').click()
  await page.waitForSelector('[data-testid=identity-dialog]')
}

beforeAll(() => {
  userData = mkdtempSync(join(tmpdir(), 'seam-e2e-identity-user-'))
  temporaries.push(userData)
})

afterAll(async () => {
  await application?.close()
  while (repositories.length > 0) repositories.pop()?.cleanup()
  while (temporaries.length > 0) rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
})

describe('the missing identity', () => {
  it('asks for it and keeps it in this repository', async () => {
    const repo = await staged()
    await launch(repo.path, freshHome())
    await openDialog('first commit')

    await page.locator('[data-testid=identity-name]').fill('Ada Lovelace')
    await page.locator('[data-testid=identity-email]').fill('ada@example.com')
    await page.locator('[data-testid=identity-scope-local]').check()
    await page.locator('[data-testid=identity-save]').click()

    await waitFor(
      async () => (await page.locator('[data-testid=identity-dialog]').count()) === 0,
      'the dialog to close'
    )
    await waitFor(
      async () => (await repo.run(['rev-parse', '--verify', 'HEAD'])).code === 0,
      'the waiting commit to be created'
    )

    expect((await repo.git(['log', '-1', '--format=%s'])).trim()).toBe('first commit')
    expect((await repo.git(['log', '-1', '--format=%an <%ae>'])).trim()).toBe(
      'Ada Lovelace <ada@example.com>'
    )
    expect((await repo.git(['config', '--local', 'user.name'])).trim()).toBe('Ada Lovelace')
    expect((await repo.git(['config', '--local', 'user.email'])).trim()).toBe('ada@example.com')
  })

  it('keeps it for every repository when asked to', async () => {
    const repo = await staged()
    await launch(repo.path, freshHome())
    await openDialog('shared identity')

    await page.locator('[data-testid=identity-name]').fill('Grace Hopper')
    await page.locator('[data-testid=identity-email]').fill('grace@example.com')
    await page.locator('[data-testid=identity-scope-global]').check()
    await page.locator('[data-testid=identity-save]').click()

    await waitFor(
      async () => (await repo.run(['rev-parse', '--verify', 'HEAD'])).code === 0,
      'the waiting commit to be created'
    )

    expect((await repo.git(['log', '-1', '--format=%an <%ae>'])).trim()).toBe(
      'Grace Hopper <grace@example.com>'
    )
    // Nothing was written into the repository: the address is global.
    expect((await repo.run(['config', '--local', 'user.email'])).code).not.toBe(0)
  })

  it('commits straight away when the identity is already set', async () => {
    const repo = await staged()
    await repo.git(['config', 'user.name', 'Seam Test'])
    await repo.git(['config', 'user.email', 'seam@example.com'])
    await repo.git(['config', 'commit.gpgsign', 'false'])
    await launch(repo.path, freshHome())

    await page.locator('[data-testid=commit-message]').fill('direct commit')
    await page.locator('[data-testid=commit-button]').click()
    await waitFor(
      async () => (await repo.run(['rev-parse', '--verify', 'HEAD'])).code === 0,
      'the commit to be created'
    )

    expect(await page.locator('[data-testid=identity-dialog]').count()).toBe(0)
    expect((await repo.git(['log', '-1', '--format=%s'])).trim()).toBe('direct commit')
  })
})
