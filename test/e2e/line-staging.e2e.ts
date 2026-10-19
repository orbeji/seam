// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createRepository, type SampleRepository } from '../fixtures/repository'

/**
 * Preparing a single line from the viewer. Two lines are inserted in the
 * working copy; one is selected and prepared on its own, so the other stays
 * pending and the index ends up with just the chosen line.
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
  repository.write('f.txt', 'one\ntwo\nthree\n')
  await repository.git(['add', 'f.txt'])
  await repository.git(['commit', '-qm', 'base'])

  const userData = mkdtempSync(join(tmpdir(), 'seam-e2e-line-user-'))
  temporaries.push(userData)

  application = await electron.launch({
    args: [
      '--no-sandbox',
      join(process.cwd(), 'out', 'main', 'index.js'),
      '--repo',
      repository.path
    ],
    env: { ...process.env, SEAM_USER_DATA: userData, SEAM_HIDDEN_WINDOW: '1' } as Record<
      string,
      string
    >
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

/** Two inserted lines in the working copy, and an index that matches the branch. */
async function pending(): Promise<void> {
  await repository.git(['read-tree', 'HEAD'])
  repository.write('f.txt', 'one\ntwo\nX\nY\nthree\n')
}

beforeEach(pending)

afterEach(async () => {
  const close = page.locator('[data-testid=diff-close]')
  if ((await close.count()) > 0) await close.click()
  await page.waitForSelector('[data-testid=staged]')
})

async function openFile(): Promise<void> {
  await page.locator('[data-testid=unstaged] [data-testid=entry]', { hasText: 'f.txt' }).click()
  await page.waitForSelector(PANES)
  // The gutter only appears once the staging model has been read.
  await page.waitForSelector(FORWARD)
}

/** Selects the whole `X` line in the editable working-copy pane. */
async function selectLine(text: string): Promise<void> {
  await page.locator('.cm-merge-b .cm-line', { hasText: new RegExp(`^${text}$`) }).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
}

describe('preparing a single line in the viewer', () => {
  it('prepares the chosen line and leaves the rest pending', async () => {
    await openFile()

    // Select the `X` line, then open the marker menu over it.
    await selectLine('X')
    await page.locator(FORWARD).first().click()

    const button = page.locator('[data-testid=hunk-stage-selection]')
    await button.waitFor()
    expect(await button.isEnabled()).toBe(true)
    await button.click()

    await expect
      .poll(
        async () => (await repository.git(['diff', '--cached', '--', 'f.txt'])).includes('+X'),
        {
          timeout: WAIT_MS
        }
      )
      .toBe(true)

    const staged = await repository.git(['diff', '--cached', '--', 'f.txt'])
    expect(staged).not.toContain('+Y')
    const pending = await repository.git(['diff', '--', 'f.txt'])
    expect(pending).toContain('+Y')
    expect(pending).not.toContain('+X')

    await expect.poll(() => page.locator(BACK).count(), { timeout: WAIT_MS }).toBe(1)
    expect(await page.locator(FORWARD).count()).toBe(1)
  })

  it('leaves the line action disabled without a selection', async () => {
    await openFile()

    // A bare caret is not a selection, so the partial action stays disabled.
    await page.locator('.cm-merge-b .cm-line', { hasText: /^X$/ }).click()
    await page.locator(FORWARD).first().click()

    const button = page.locator('[data-testid=hunk-stage-selection]')
    await button.waitFor()
    expect(await button.isDisabled()).toBe(true)
  })
})
