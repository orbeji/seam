// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createRepository, type SampleRepository } from '../fixtures/repository'

/**
 * Reverting a pending hunk from the viewer. Two lines are changed in the
 * working copy; the first change is thrown away through the marker menu, so the
 * file goes back to the index's line while the second change stays pending. The
 * action asks first, and the editor can bring the change back while the viewer
 * is open.
 */

let repository: SampleRepository
let application: ElectronApplication
let page: Page
const temporaries: string[] = []

const PANES = '[data-testid=diff-panes]'
const FORWARD = '.staging-marker--unstaged'
const BACK = '.staging-marker--staged'
const WAIT_MS = 15_000

beforeAll(async () => {
  repository = await createRepository()
  repository.write('f.txt', 'one\ntwo\nthree\nfour\nfive\nsix\n')
  await repository.git(['add', 'f.txt'])
  await repository.git(['commit', '-qm', 'base'])

  const userData = mkdtempSync(join(tmpdir(), 'seam-e2e-revert-user-'))
  temporaries.push(userData)

  application = await electron.launch({
    args: [
      '--no-sandbox',
      join(process.cwd(), 'out', 'main', 'index.js'),
      '--repo',
      repository.path
    ],
    env: { ...process.env, SEAM_USER_DATA: userData } as Record<string, string>
  })
  page = await application.firstWindow()
  await page.waitForSelector('[data-testid=unstaged]')
})

afterAll(async () => {
  await application?.close()
  while (temporaries.length > 0) {
    rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
  }
  repository?.cleanup()
})

/** Two changes in the working copy, and an index that matches the branch. */
async function twoPending(): Promise<void> {
  await repository.git(['read-tree', 'HEAD'])
  repository.write('f.txt', 'one\nTWO\nthree\nFOUR\nfive\nsix\n')
}

beforeEach(twoPending)

afterEach(async () => {
  const close = page.locator('[data-testid=diff-close]')
  if ((await close.count()) > 0) await close.click()
  await page.waitForSelector('[data-testid=staged]')
})

async function openFile(): Promise<void> {
  await page.locator('[data-testid=unstaged] [data-testid=entry]', { hasText: 'f.txt' }).click()
  await page.waitForSelector(PANES)
  // The gutter only appears once the staging model has been read.
  await page.waitForSelector(`${FORWARD}, ${BACK}`)
}

/** Opens the marker menu of the first pending change and asks to revert it. */
async function openRevertConfirm(): Promise<void> {
  await page.locator(FORWARD).first().click()
  await page.waitForSelector('[data-testid=hunk-revert]')
  await page.locator('[data-testid=hunk-revert]').click()
  await page.waitForSelector('[data-testid=revert-confirm]')
}

describe('reverting a hunk in the viewer', () => {
  it('drops the chosen hunk from the file and leaves the index alone', async () => {
    await openFile()
    expect(await page.locator(FORWARD).count()).toBe(2)

    await page.locator(FORWARD).first().click()
    await page.waitForSelector('[data-testid=hunk-revert]')
    expect(await page.locator('[data-testid=hunk-revert]').isEnabled()).toBe(true)
    await page.locator('[data-testid=hunk-revert]').click()
    await page.waitForSelector('[data-testid=revert-confirm]')
    await page.locator('[data-testid=revert-accept]').click()

    // The file loses the reverted line and keeps the other pending change.
    await expect
      .poll(async () => (await repository.git(['diff', '--', 'f.txt'])).includes('+TWO'), {
        timeout: WAIT_MS
      })
      .toBe(false)
    const pending = await repository.git(['diff', '--', 'f.txt'])
    expect(pending).toContain('+FOUR')
    // The index was never touched, so nothing is prepared for the next commit.
    expect(await repository.git(['diff', '--cached', '--', 'f.txt'])).toBe('')

    // The marker for the reverted change is gone; the other stays pending.
    await expect.poll(() => page.locator(FORWARD).count(), { timeout: WAIT_MS }).toBe(1)
    expect(await page.locator(BACK).count()).toBe(0)
    // The pane follows the file, so the index's line is back on screen.
    expect(await page.locator('.cm-merge-b .cm-line', { hasText: /^two$/ }).count()).toBe(1)
  })

  it('asks first, and leaves the file alone when the revert is cancelled', async () => {
    await openFile()

    await openRevertConfirm()
    await page.locator('[data-testid=revert-cancel]').click()

    await expect.poll(() => page.locator('[data-testid=revert-confirm]').count()).toBe(0)
    expect(await page.locator(FORWARD).count()).toBe(2)
    expect(await repository.git(['diff', '--', 'f.txt'])).toContain('+TWO')
  })

  it('can be brought back with the editor while the viewer is open', async () => {
    await openFile()

    await openRevertConfirm()
    await page.locator('[data-testid=revert-accept]').click()

    // The reverted line is on screen as the index has it.
    await expect
      .poll(() => page.locator('.cm-merge-b .cm-line', { hasText: /^two$/ }).count(), {
        timeout: WAIT_MS
      })
      .toBe(1)

    // Undo in the working-copy editor brings the working copy's line back.
    await page.locator('.cm-merge-b .cm-content').click()
    await page.keyboard.press('Control+z')
    await expect
      .poll(() => page.locator('.cm-merge-b .cm-line', { hasText: /^TWO$/ }).count(), {
        timeout: WAIT_MS
      })
      .toBe(1)
  })
})
