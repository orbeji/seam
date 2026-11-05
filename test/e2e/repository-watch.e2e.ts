// SPDX-License-Identifier: MIT

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitRunner } from '../../src/core/git'
import { createSampleRepositories, type SampleRepositories } from '../fixtures/sample-repositories'

/**
 * The phase 3 watcher test: a `git add` run outside the application updates the
 * lists on their own, without reopening the repository or focusing the window.
 * It fails unless the main process watches the git folder and pushes the change
 * to the interface. An edit to the working tree must do the same.
 */

const temporaries: string[] = []
let application: ElectronApplication
let page: Page
let samples: SampleRepositories
const runner = new GitRunner()

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'seam-e2e-watch-'))
  temporaries.push(base)
  samples = await createSampleRepositories(base)

  const userData = mkdtempSync(join(tmpdir(), 'seam-e2e-watch-user-'))
  temporaries.push(userData)

  application = await electron.launch({
    args: ['--no-sandbox', join(process.cwd(), 'out', 'main', 'index.js'), '--repo', samples.mixed],
    env: { ...process.env, SEAM_USER_DATA: userData, SEAM_HIDDEN_WINDOW: '1' } as Record<
      string,
      string
    >
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

describe('watching the repository', () => {
  it('updates the lists when a file is staged from the terminal', async () => {
    expect(await count('untracked')).toBe(1)
    const stagedBefore = await count('staged')

    // What the user would do in a terminal opened next to the application.
    const add = await runner.run(['add', 'untracked.txt'], { cwd: samples.mixed })
    expect(add.code).toBe(0)

    await waitFor(async () => (await count('untracked')) === 0, 'untracked.txt to leave the list')
    await waitFor(
      async () => (await count('staged')) === stagedBefore + 1,
      'the staged count to grow'
    )
  })

  it('updates the lists when a file is edited in the working tree', async () => {
    const untrackedBefore = await count('untracked')

    // A save in an editor, in a folder below the repository root.
    mkdirSync(join(samples.mixed, 'nested'), { recursive: true })
    writeFileSync(join(samples.mixed, 'nested', 'new.txt'), 'new file\n')

    await waitFor(
      async () => (await count('untracked')) === untrackedBefore + 1,
      'the new working-tree file to appear'
    )
  })
})
