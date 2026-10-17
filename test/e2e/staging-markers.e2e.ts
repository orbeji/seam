// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createRepository, type SampleRepository } from '../fixtures/repository'

/**
 * The phase 3 margin markers: one change is prepared and another is left
 * pending, then the file is opened. The hollow marker must sit on the prepared
 * line, the solid one on the pending line, and a marker must open the hunk menu.
 */

let repository: SampleRepository
let application: ElectronApplication
let page: Page
const temporaries: string[] = []

const PANES = '[data-testid=diff-panes]'

beforeAll(async () => {
  repository = await createRepository()
  repository.write('f.txt', 'one\ntwo\nthree\nfour\nfive\n')
  await repository.git(['add', 'f.txt'])
  await repository.git(['commit', '-qm', 'base'])

  // Prepare a change on line 2, then edit line 4 in the working copy only.
  repository.write('f.txt', 'one\ntwo staged\nthree\nfour\nfive\n')
  await repository.git(['add', 'f.txt'])
  repository.write('f.txt', 'one\ntwo staged\nthree\nfour local\nfive\n')

  const userData = mkdtempSync(join(tmpdir(), 'seam-e2e-marker-user-'))
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
  await page.waitForSelector('[data-testid=staged]')
})

afterAll(async () => {
  await application?.close()
  while (temporaries.length > 0) {
    rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
  }
  repository?.cleanup()
})

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
  await page.waitForSelector('.staging-marker--staged')
}

/** The vertical centre of an element, so a marker can be lined up with a line. */
async function centre(selector: string, text?: string): Promise<number> {
  const locator =
    text === undefined ? page.locator(selector) : page.locator(selector, { hasText: text })
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  return (box as { y: number; height: number }).y + (box as { height: number }).height / 2
}

describe('the staging margin over a real file', () => {
  it('draws one hollow marker and one solid marker, each on its line', async () => {
    await openFile()

    expect(await page.locator('.staging-gutter').count()).toBe(1)
    expect(await page.locator('.staging-marker--staged').count()).toBe(1)
    expect(await page.locator('.staging-marker--unstaged').count()).toBe(1)

    // The prepared line is above the pending one, and each marker sits beside
    // the working-copy line it covers.
    const hollow = await centre('.staging-marker--staged')
    const solid = await centre('.staging-marker--unstaged')
    expect(hollow).toBeLessThan(solid)

    expect(Math.abs(hollow - (await centre('.cm-merge-b .cm-line', 'two staged')))).toBeLessThan(6)
    expect(Math.abs(solid - (await centre('.cm-merge-b .cm-line', 'four local')))).toBeLessThan(6)
  })

  it('opens the hunk menu when a marker is clicked', async () => {
    await openFile()
    await page.locator('.staging-marker--unstaged').click()

    await page.waitForSelector('[data-testid=diff-hunk-menu]')
    expect(await page.locator('[data-testid=hunk-stage]').count()).toBe(1)
    expect(await page.locator('[data-testid=hunk-revert]').count()).toBe(1)
  })
})
