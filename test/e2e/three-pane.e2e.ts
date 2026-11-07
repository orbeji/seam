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
      '--lang=en-US',
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

/**
 * Closes the open file, whatever layout it is in. The tab bar is hidden while
 * the three-pane screen is up, so its Close button cannot be clicked with the
 * pointer; dispatching the event reaches React all the same and avoids waiting
 * on an element the layout has hidden. If the renderer does not react, a reload
 * is the clean slate the next test needs.
 */
async function closeFile(): Promise<void> {
  const close = page.locator('[data-testid=diff-close]')
  if ((await close.count()) === 0) return
  await close.dispatchEvent('click').catch(() => undefined)
  try {
    await page.waitForSelector('[data-testid=diff-close]', { state: 'detached', timeout: 5_000 })
  } catch {
    await page.reload()
    await page.waitForSelector('[data-testid=staged]', { timeout: WAIT_MS })
  }
}

afterEach(async () => {
  await closeFile().catch(() => undefined)
  await page.waitForSelector('[data-testid=staged]', { timeout: WAIT_MS }).catch(() => undefined)
})

/**
 * Opens `f.txt`, retrying while a background refresh replaces the list under
 * the pointer: the click can land on a row that is about to be swapped out, and
 * a second click on the rebuilt list is what finally selects the file.
 */
async function openFile(): Promise<void> {
  const entry = page.locator('[data-testid=unstaged] [data-testid=entry]', { hasText: 'f.txt' })
  const deadline = Date.now() + WAIT_MS
  while (Date.now() < deadline) {
    if ((await page.locator(PANES).count()) > 0) return
    await entry.dispatchEvent('click').catch(() => undefined)
    await page.waitForTimeout(100)
  }
  throw new Error('the diff viewer did not open')
}

/** Opens the file and switches the viewer to the three-pane layout. */
async function openThreePane(): Promise<void> {
  await closeFile()
  await openFile()
  await page.selectOption(LAYOUT, 'three-pane')
  await page.waitForSelector(GRID)
}

/** The row that holds the modified `TWO` line, and its editable index cell. */
function changedRow(): { row: Locator; centre: Locator } {
  const row = page.locator('[data-testid=three-row]', { hasText: 'TWO' })
  return { row, centre: row.locator('[data-testid=three-index-line]') }
}

describe('the three-pane view', () => {
  it('presents the dedicated staging screen', async () => {
    await openThreePane()

    expect(await page.locator('[data-testid=three-title]').textContent()).toBe(
      'Stage changes line by line'
    )
    const columns = await page.locator('[data-testid=three-columns]').textContent()
    expect(columns).toContain('HEAD')
    expect(columns).toContain('Index')
    expect(columns).toContain('Working copy')
    expect(columns).toContain('read-only')
    expect(columns).toContain('editable')
    expect(await page.locator('[data-testid=three-help] > div').count()).toBe(3)
    expect(await page.locator('[data-testid=diff-close]').isVisible()).toBe(false)
    expect(await page.locator('[data-testid=three-status]').textContent()).toContain(
      'Staged lines get a "staged" label'
    )
  })

  it('stages all remaining changes and resets the index to HEAD', async () => {
    await openThreePane()
    const { row, centre } = changedRow()

    expect(await page.locator('[data-testid=three-reset-index]').isDisabled()).toBe(true)
    expect(await page.locator('[data-testid=three-stage-all]').isDisabled()).toBe(false)
    expect(await page.locator('[data-testid=three-stats]').textContent()).toContain(
      'Index differs from HEAD by 0 lines'
    )

    await page.locator('[data-testid=three-stage-all]').click()
    await expect.poll(() => centre.inputValue(), { timeout: WAIT_MS }).toBe('TWO')
    await expect
      .poll(async () => (await page.locator('[data-testid=three-stats]').textContent()) ?? '', {
        timeout: WAIT_MS
      })
      .toContain('Index differs from HEAD by 1 line')
    expect(await page.locator('[data-testid=three-stage-all]').isDisabled()).toBe(true)
    expect(await page.locator('[data-testid=three-reset-index]').isDisabled()).toBe(false)
    expect(await row.locator('[data-testid=three-staged]').textContent()).toBe('staged')
    expect(await row.locator('[data-testid=three-take-worktree]').count()).toBe(0)

    await page.locator('[data-testid=three-reset-index]').click()
    await expect.poll(() => centre.inputValue(), { timeout: WAIT_MS }).toBe('two')
    await expect
      .poll(async () => (await page.locator('[data-testid=three-stats]').textContent()) ?? '', {
        timeout: WAIT_MS
      })
      .toContain('Index differs from HEAD by 0 lines')
    expect(await page.locator('[data-testid=three-stage-all]').isDisabled()).toBe(false)
    expect(await page.locator('[data-testid=three-reset-index]').isDisabled()).toBe(true)
    expect(await row.locator('[data-testid=three-take-worktree]').count()).toBe(1)
    expect(await row.locator('[data-testid=three-staged]').count()).toBe(0)
  })

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
