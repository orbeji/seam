// SPDX-License-Identifier: MIT

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSampleRepositories, type SampleRepositories } from '../fixtures/sample-repositories'

/**
 * Cloning from the repository tab strip: the plus offers Open and Clone, the
 * dialog previews the folder Git will create, a missing parent is reported
 * without closing the dialog, and a finished clone opens a new tab. Closing
 * that tab leaves the repository in the reopen list.
 */

const WAIT_MS = 30_000
const temporaries: string[] = []
let application: ElectronApplication
let page: Page
let samples: SampleRepositories
let cloneParent: string

/** Polls an interface condition until it holds or the clone timeout expires. */
async function waitFor(condition: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'seam-e2e-'))
  temporaries.push(base)
  samples = await createSampleRepositories(base)
  cloneParent = mkdtempSync(join(tmpdir(), 'seam-e2e-clone-parent-'))
  temporaries.push(cloneParent)

  const userData = mkdtempSync(join(tmpdir(), 'seam-e2e-clone-user-'))
  temporaries.push(userData)

  application = await electron.launch({
    args: ['--no-sandbox', '--lang=en-US', join(process.cwd(), 'out', 'main', 'index.js')],
    env: { ...process.env, SEAM_USER_DATA: userData, SEAM_HIDDEN_WINDOW: '1' } as Record<
      string,
      string
    >
  })
  page = await application.firstWindow()
  await page.waitForSelector('[data-testid=topbar]')
})

afterAll(async () => {
  await application?.close()
  while (temporaries.length > 0) {
    rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
  }
})

describe('cloning a repository from the tab strip', () => {
  it('asks for a URL and a folder, reports a bad folder, then opens the clone', async () => {
    await page.click('[data-testid=repo-add]')
    await page.waitForSelector('[data-testid=repo-add-menu]')

    const menuText = await page.locator('[data-testid=repo-add-menu]').innerText()
    expect(menuText).toContain('Open repository…')
    expect(menuText).toContain('Clone repository…')

    await page.click('[data-testid=repo-clone]')
    await page.waitForSelector('[data-testid=clone-dialog]')
    // The panel sits in the centered overlay, not in the window flow.
    expect(await page.locator('.dialog [data-testid=clone-dialog]').count()).toBe(1)

    // The button refuses an empty form rather than starting a doomed clone.
    await page.click('[data-testid=clone-submit]')
    await page.waitForSelector('[data-testid=clone-required]')
    expect(await page.locator('[data-testid=clone-required]').innerText()).toContain(
      'Enter a repository URL'
    )

    await page.fill('[data-testid=clone-url]', 'https://github.com/orbeji/test/tree/main/src')
    await page.fill('[data-testid=clone-parent]', cloneParent)
    await waitFor(
      async () =>
        ((await page.locator('[data-testid=clone-target]').textContent()) ?? '').includes(
          join(cloneParent, 'test')
        ),
      'the repository name taken from a GitHub branch URL'
    )

    await page.fill('[data-testid=clone-url]', samples.clean)
    await page.fill('[data-testid=clone-parent]', join(cloneParent, 'missing'))
    await waitFor(
      async () =>
        ((await page.locator('[data-testid=clone-target]').textContent()) ?? '').includes(
          join(cloneParent, 'missing', 'clean')
        ),
      'the clone destination preview'
    )

    // A missing parent is Git's job to refuse; the dialog stays open with it.
    await page.click('[data-testid=clone-submit]')
    await page.waitForSelector('[data-testid=clone-error]')
    expect(await page.locator('[data-testid=clone-error]').innerText()).toContain(
      'destination folder does not exist'
    )

    await page.fill('[data-testid=clone-parent]', cloneParent)
    await page.click('[data-testid=clone-submit]')
    await page.waitForSelector('[data-testid=clone-dialog]', {
      state: 'detached',
      timeout: WAIT_MS
    })

    const target = join(cloneParent, 'clean')
    await waitFor(
      async () =>
        ((await page.locator('[data-testid=repo-tab]').first().textContent()) ?? '').includes(
          'clean'
        ),
      'the cloned repository tab'
    )
    expect(existsSync(join(target, '.git'))).toBe(true)
    expect(readFileSync(join(target, 'a.txt'), 'utf8').trim()).toBe('first')

    // Closing the tab leaves the repository in the arrow's reopen list.
    await page.click('[data-testid=repo-tab-close]')
    await page.waitForSelector('[data-testid=repo-tab]', { state: 'detached' })
    await page.click('[data-testid=repo-reopen]')
    await page.waitForSelector('[data-testid=repo-reopen-menu]')
    const reopenText = await page.locator('[data-testid=repo-reopen-menu]').innerText()
    expect(reopenText).toContain('RECENTLY CLOSED')
    expect(reopenText).toContain(target)

    await page.click('[data-testid=repo-reopen-item]')
    await waitFor(
      async () =>
        ((await page.locator('[data-testid=repo-tab]').first().textContent()) ?? '').includes(
          'clean'
        ),
      'the reopened repository tab'
    )
  })
})
