// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from 'playwright-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createRepository, type SampleRepository } from '../fixtures/repository'

/**
 * The three-pane view: HEAD, the editable index and the working copy. Taking a
 * line from the working copy into the centre writes exactly that to the index
 * on Done, and Close leaves the index alone.
 */

let repository: SampleRepository
let application: ElectronApplication
let page: Page
const temporaries: string[] = []

const LAYOUT = '[data-testid=diff-layout]'
const PANES = '[data-testid=diff-panes]'
const GRID = '[data-testid=three-grid]'
const WAIT_MS = 15_000

beforeAll(async () => {
  repository = await createRepository()
  repository.write('f.txt', 'one\ntwo\nthree\n')
  await repository.git(['add', 'f.txt'])
  await repository.git(['commit', '-qm', 'base'])

  const userData = mkdtempSync(join(tmpdir(), 'seam-e2e-three-user-'))
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

/** One modified line in the working copy, and an index that matches the branch. */
async function pending(): Promise<void> {
  await repository.git(['read-tree', 'HEAD'])
  repository.write('f.txt', 'one\nTWO\nthree\n')
}

beforeEach(pending)

afterEach(async () => {
  const close = page.locator('[data-testid=diff-close]')
  if ((await close.count()) > 0) await close.click()
  await page.waitForSelector('[data-testid=staged]')
})

/** Opens the file and switches the viewer to the three-pane layout. */
async function openThreePane(): Promise<void> {
  await page.locator('[data-testid=unstaged] [data-testid=entry]', { hasText: 'f.txt' }).click()
  await page.waitForSelector(PANES)
  await page.selectOption(LAYOUT, 'three-pane')
  await page.waitForSelector(GRID)
}

/** The row that holds the modified `TWO` line, and its editable index cell. */
function changedRow(): { row: Locator; centre: Locator } {
  const row = page.locator('[data-testid=three-row]', { hasText: 'TWO' })
  return { row, centre: row.locator('[data-testid=three-index-line]') }
}

describe('the three-pane view', () => {
  it('stores what the centre holds when Done is clicked', async () => {
    await openThreePane()
    const { row, centre } = changedRow()

    // The centre opens on the index, not on the working copy.
    expect(await centre.inputValue()).toBe('two')

    await row.locator('[data-testid=three-take-worktree]').click()
    await expect.poll(() => centre.inputValue(), { timeout: WAIT_MS }).toBe('TWO')

    await page.locator('[data-testid=three-done]').click()

    await expect
      .poll(
        async () => (await repository.git(['diff', '--cached', '--', 'f.txt'])).includes('+TWO'),
        { timeout: WAIT_MS }
      )
      .toBe(true)
    expect(await repository.git(['show', ':f.txt'])).toBe('one\nTWO\nthree\n')
  })

  it('leaves the index alone on Close', async () => {
    await openThreePane()
    const { row, centre } = changedRow()

    await row.locator('[data-testid=three-take-worktree]').click()
    await expect.poll(() => centre.inputValue(), { timeout: WAIT_MS }).toBe('TWO')

    await page.locator('[data-testid=three-close]').click()
    await page.waitForSelector(PANES)

    expect(await repository.git(['diff', '--cached', '--', 'f.txt'])).toBe('')
  })
})
