// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The help screen is part of the product, not just an error path: when the
 * machine has no Git, the window must explain it before the user tries to open
 * a repository. This test marks Git as absent through `SEAM_GIT_PATH`, which
 * keeps the rest of the environment intact so the launch behaves like a normal
 * one on every platform.
 */

const temporaries: string[] = []
let application: ElectronApplication
let page: Page

beforeAll(async () => {
  const userData = mkdtempSync(join(tmpdir(), 'seam-no-git-user-'))
  temporaries.push(userData)

  application = await electron.launch({
    args: ['--no-sandbox', join(process.cwd(), 'out', 'main', 'index.js')],
    env: {
      ...process.env,
      SEAM_GIT_PATH: '',
      SEAM_USER_DATA: userData,
      SEAM_HIDDEN_WINDOW: '1'
    } as Record<string, string>
  })
  page = await application.firstWindow()
  await page.waitForSelector('[data-testid=git-gate]', { timeout: 30_000 })
  // The gate appears while the version check runs; wait for its answer so the
  // assertions below never read the "checking" screen.
  try {
    await page.waitForSelector('[data-testid=git-gate-detail]', { timeout: 30_000 })
  } catch (error) {
    // A bare timeout says nothing about whether the check never answered or
    // the app found a Git the test meant to hide; keep that in the report.
    const gate = await page
      .locator('[data-testid=git-gate]')
      .innerText()
      .catch(() => '')
    throw new Error(`The Git gate never explained itself. It shows: ${JSON.stringify(gate)}`, {
      cause: error
    })
  }
}, 60_000)

afterAll(async () => {
  await application?.close()
  while (temporaries.length > 0) {
    rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
  }
})

describe('the Git help screen', () => {
  it('appears before a repository can be opened', async () => {
    expect(await page.locator('[data-testid=git-gate]').count()).toBe(1)
  })

  it('explains what failed', async () => {
    const detail = await page.locator('[data-testid=git-gate-detail]').textContent()
    expect(detail).toBeTruthy()
    expect(detail?.toLowerCase()).toContain('git')
  })

  it('offers a download and a retry', async () => {
    const buttons = await page.locator('[data-testid=git-gate] button').allTextContents()
    expect(buttons).toHaveLength(2)
  })
})
