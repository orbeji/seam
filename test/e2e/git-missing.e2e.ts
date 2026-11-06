// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The help screen is part of the product, not just an error path: when the
 * machine has no Git, the window must explain it before the user tries to open
 * a repository. This test launches the built application with a PATH that has
 * no Git and the Windows install folders pointed at nowhere.
 */

const temporaries: string[] = []
let application: ElectronApplication
let page: Page

beforeAll(async () => {
  const userData = mkdtempSync(join(tmpdir(), 'seam-no-git-user-'))
  temporaries.push(userData)
  const empty = mkdtempSync(join(tmpdir(), 'seam-no-git-path-'))
  temporaries.push(empty)

  application = await electron.launch({
    args: ['--no-sandbox', join(process.cwd(), 'out', 'main', 'index.js')],
    env: {
      ...process.env,
      PATH: empty,
      ProgramFiles: empty,
      'ProgramFiles(x86)': empty,
      LOCALAPPDATA: empty,
      SEAM_USER_DATA: userData,
      SEAM_HIDDEN_WINDOW: '1'
    } as Record<string, string>
  })
  page = await application.firstWindow()
  await page.waitForSelector('[data-testid=git-gate]', { timeout: 30_000 })
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
