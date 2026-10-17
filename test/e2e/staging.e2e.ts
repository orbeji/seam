// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSampleRepositories, type SampleRepositories } from '../fixtures/sample-repositories'

/**
 * The phase 3 staging test: it stages one file from its row and unstages the
 * whole section from its heading, checking the lists move accordingly. It fails
 * unless the interface, the preload bridge and the index writer all agree.
 */

const temporaries: string[] = []
let application: ElectronApplication
let page: Page
let samples: SampleRepositories

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'seam-e2e-stage-'))
  temporaries.push(base)
  samples = await createSampleRepositories(base)

  const userData = mkdtempSync(join(tmpdir(), 'seam-e2e-stage-user-'))
  temporaries.push(userData)

  application = await electron.launch({
    args: ['--no-sandbox', join(process.cwd(), 'out', 'main', 'index.js'), '--repo', samples.mixed],
    env: { ...process.env, SEAM_USER_DATA: userData } as Record<string, string>
  })
  page = await application.firstWindow()
  await page.waitForSelector('[data-testid=staged]')
})

afterAll(async () => {
  await application?.close()
  while (temporaries.length > 0) rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
})

async function count(section: string): Promise<number> {
  return page.locator(`[data-testid=${section}] [data-testid=entry]`).count()
}

/** Polls a condition until it holds, so the test never races the renderer. */
async function waitFor(condition: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

describe('staging from the lists', () => {
  it('stages a file from its row, then unstages the staged section', async () => {
    expect(await count('staged')).toBe(4)
    expect(await count('untracked')).toBe(1)

    // The untracked list holds one row; its button stages that file alone.
    await page.locator('[data-testid=untracked] [data-testid=entry-action]').first().click()
    await waitFor(async () => (await count('untracked')) === 0, 'the untracked file to be staged')
    expect(await count('staged')).toBe(5)

    // The section button works on every staged row at once.
    await page.locator('[data-testid=staged-action]').click()
    await waitFor(async () => (await count('staged')) === 0, 'the staged list to empty')
  })
})
