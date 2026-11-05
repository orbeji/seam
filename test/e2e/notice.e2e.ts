// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitRunner } from '../../src/core/git'
import { createRepository, type SampleRepository } from '../fixtures/repository'

/**
 * The phase 4 notification test: a commit shows the short id Git reports for
 * it, and the button copies that id to the system clipboard.
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

async function waitFor(condition: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'seam-e2e-notice-user-'))
  temporaries.push(userData)
})

afterAll(async () => {
  await application?.close()
  while (repositories.length > 0) repositories.pop()?.cleanup()
  while (temporaries.length > 0) rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
})

describe('commit notification', () => {
  it('shows the short id of the commit and copies it', async () => {
    const repo = await repository()
    await runner.runOrThrow(['config', 'user.name', 'Seam Test'], { cwd: repo.path })
    await runner.runOrThrow(['config', 'user.email', 'seam@example.com'], { cwd: repo.path })
    await runner.runOrThrow(['config', 'commit.gpgsign', 'false'], { cwd: repo.path })
    repo.write('f.txt', 'one\n')
    await repo.git(['add', 'f.txt'])

    application = await electron.launch({
      args: ['--no-sandbox', join(process.cwd(), 'out', 'main', 'index.js'), '--repo', repo.path],
      env: { ...process.env, SEAM_USER_DATA: userData, SEAM_HIDDEN_WINDOW: '1' } as Record<
        string,
        string
      >
    })
    page = await application.firstWindow()
    await page.waitForSelector('[data-testid=commit-message]')
    await page.waitForSelector('[data-testid=staged] [data-testid=entry]')

    await page.locator('[data-testid=commit-message]').fill('with a notice')
    await page.locator('[data-testid=commit-button]').click()

    // The popup carries the id a terminal would print for this commit.
    await page.waitForSelector('[data-testid=sync-notice][data-tone=ok]')
    // The copy button reaches the system clipboard through the main process.
    await page.locator('[data-testid=commit-copy]').click()
    const shortId = (await repo.git(['rev-parse', '--short', 'HEAD'])).trim()
    expect(await page.locator('[data-testid=sync-notice][data-tone=ok]').innerText()).toContain(
      shortId
    )

    await waitFor(
      async () =>
        (await application?.evaluate(({ clipboard }) => clipboard.readText())) === shortId,
      'the short id on the clipboard'
    )

    // The lists refreshed on their own: the staged file is gone.
    expect(await page.locator('[data-testid=staged] [data-testid=entry]').count()).toBe(0)
  })
})
