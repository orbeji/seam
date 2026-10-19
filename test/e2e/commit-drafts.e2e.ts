// SPDX-License-Identifier: MIT

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSampleRepositories, type SampleRepositories } from '../fixtures/sample-repositories'

/**
 * The phase 4 draft test: the message typed in the box survives opening a file
 * and closing the application. It fails unless the box, the preload bridge and
 * the file in the application data folder all agree.
 */

const DRAFT = 'Fix the parser ✅'

const temporaries: string[] = []
let samples: SampleRepositories
let userData: string
let application: ElectronApplication
let page: Page

/** Launches the application against the sample repository and its data folder. */
async function launch(): Promise<void> {
  application = await electron.launch({
    args: ['--no-sandbox', join(process.cwd(), 'out', 'main', 'index.js'), '--repo', samples.mixed],
    env: { ...process.env, SEAM_USER_DATA: userData, SEAM_HIDDEN_WINDOW: '1' } as Record<
      string,
      string
    >
  })
  page = await application.firstWindow()
  await page.waitForSelector('[data-testid=commit-message]')
}

/** Polls a condition until it holds, so the test never races the application. */
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'seam-e2e-drafts-'))
  temporaries.push(base)
  samples = await createSampleRepositories(base)

  userData = mkdtempSync(join(tmpdir(), 'seam-e2e-drafts-user-'))
  temporaries.push(userData)

  await launch()
})

afterAll(async () => {
  await application?.close()
  while (temporaries.length > 0) rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
})

describe('the commit message box', () => {
  it('keeps the draft while switching files and after a restart', async () => {
    const box = page.locator('[data-testid=commit-message]')
    await box.fill(DRAFT)
    expect(await box.inputValue()).toBe(DRAFT)

    // The draft reaches the application data folder, so the restart below is
    // honest: the window is closed knowing the message was already stored.
    const file = join(userData, 'commit-drafts.json')
    await waitFor(
      () => existsSync(file) && readFileSync(file, 'utf8').includes(DRAFT),
      'the draft to reach the application data folder'
    )

    // Opening a file, then coming back to the lists, must not lose the draft.
    await page.locator('[data-testid=unstaged] [data-testid=entry]').first().click()
    await page.waitForSelector('[data-testid=diff]')
    expect(await page.locator('[data-testid=commit-message]').inputValue()).toBe(DRAFT)

    await page.locator('[data-testid=diff-close]').click()
    await page.waitForSelector('[data-testid=staged]')
    expect(await page.locator('[data-testid=commit-message]').inputValue()).toBe(DRAFT)

    // A restart reads the draft back from the folder.
    await application.close()
    await launch()
    await expect
      .poll(() => page.locator('[data-testid=commit-message]').inputValue(), { timeout: 15_000 })
      .toBe(DRAFT)
  })
})
