// SPDX-License-Identifier: MIT

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createRepository, type SampleRepository } from '../fixtures/repository'

/**
 * Preparing and removing a single hunk from the viewer. Two lines are changed
 * in the working copy; the first is prepared through the marker menu and must
 * end up prepared, then be taken out again. A change prepared from the terminal
 * instead, while the file is open, must show up as a hollow marker.
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

  const userData = mkdtempSync(join(tmpdir(), 'seam-e2e-hunk-user-'))
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

/** Two changes in the working copy, and an index that matches the branch. */
async function twoPending(): Promise<void> {
  await repository.git(['read-tree', 'HEAD'])
  repository.write('f.txt', 'one\nTWO\nthree\nFOUR\nfive\nsix\n')
}

beforeEach(twoPending)

/**
 * Prepares the first of the two changes with the terminal's `git apply`, the
 * way the user would stage one hunk by hand. The second change stays pending.
 */
function prepareFirstHunkFromTerminal(): void {
  const patch = [
    'diff --git a/f.txt b/f.txt',
    '--- a/f.txt',
    '+++ b/f.txt',
    '@@ -1,4 +1,4 @@',
    ' one',
    '-two',
    '+TWO',
    ' three',
    ' four',
    ''
  ].join('\n')
  const applied = spawnSync('git', ['apply', '--cached', '-'], {
    cwd: repository.path,
    input: patch,
    encoding: 'utf8'
  })
  expect(applied.status).toBe(0)
}

async function closeDiff(): Promise<void> {
  const close = page.locator('[data-testid=diff-close]')
  if ((await close.count()) > 0) await close.click()
  await page.waitForSelector('[data-testid=staged]')
}

afterEach(closeDiff)

async function openFile(): Promise<void> {
  await page.locator('[data-testid=unstaged] [data-testid=entry]', { hasText: 'f.txt' }).click()
  await page.waitForSelector(PANES)
  // The gutter only appears once the staging model has been read.
  await page.waitForSelector(`${FORWARD}, ${BACK}`)
}

describe('preparing a hunk in the viewer', () => {
  it('prepares the chosen hunk and writes nothing else', async () => {
    await openFile()
    expect(await page.locator(FORWARD).count()).toBe(2)

    await page.locator(FORWARD).first().click()
    await page.waitForSelector('[data-testid=hunk-stage]')
    await page.locator('[data-testid=hunk-stage]').click()

    // The prepared hunk turns into a hollow marker; the other stays.
    await expect.poll(() => page.locator(BACK).count(), { timeout: WAIT_MS }).toBe(1)
    expect(await page.locator(FORWARD).count()).toBe(1)

    const staged = await repository.git(['diff', '--cached', '--', 'f.txt'])
    expect(staged).toContain('+TWO')
    expect(staged).not.toContain('FOUR')
  })

  it('takes the prepared hunk back out', async () => {
    await openFile()
    await page.locator(FORWARD).first().click()
    await page.waitForSelector('[data-testid=hunk-stage]')
    await page.locator('[data-testid=hunk-stage]').click()
    await expect.poll(() => page.locator(BACK).count(), { timeout: WAIT_MS }).toBe(1)

    await page.locator(BACK).first().click()
    await page.waitForSelector('[data-testid=hunk-unstage]')
    await page.locator('[data-testid=hunk-unstage]').click()

    await expect.poll(() => page.locator(FORWARD).count(), { timeout: WAIT_MS }).toBe(2)
    expect(await page.locator(BACK).count()).toBe(0)
    expect((await repository.git(['diff', '--cached', '--', 'f.txt'])).trim()).toBe('')
  })

  it('draws a change prepared from the terminal as a hollow marker', async () => {
    await openFile()
    expect(await page.locator(FORWARD).count()).toBe(2)

    // The user prepares the first change from the terminal, `git apply`-style,
    // while the viewer is open.
    prepareFirstHunkFromTerminal()

    await expect.poll(() => page.locator(BACK).count(), { timeout: WAIT_MS }).toBe(1)
    expect(await page.locator(FORWARD).count()).toBe(1)
  })
})
