// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitRunner } from '../../src/core/git'
import { createSampleRepositories, type SampleRepositories } from '../fixtures/sample-repositories'

/**
 * The persistent commit graph beside the file sidebar: it is visible as soon as
 * a repository opens, a click opens a commit's files and their diff, and a
 * double click still offers to check the commit out.
 */

const temporaries: string[] = []
let application: ElectronApplication
let page: Page
let samples: SampleRepositories

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'seam-e2e-'))
  temporaries.push(base)
  samples = await createSampleRepositories(base)
  await new GitRunner().runOrThrow(['tag', 'v1.0.0'], { cwd: samples.clean })

  const userData = mkdtempSync(join(tmpdir(), 'seam-e2e-user-'))
  temporaries.push(userData)

  application = await electron.launch({
    args: ['--no-sandbox', join(process.cwd(), 'out', 'main', 'index.js'), '--repo', samples.clean],
    env: { ...process.env, SEAM_USER_DATA: userData, SEAM_HIDDEN_WINDOW: '1' } as Record<
      string,
      string
    >
  })
  page = await application.firstWindow()
  await page.waitForSelector('[data-testid=staged]')
  await page.waitForSelector('[data-testid=history-commits]')
})

afterAll(async () => {
  await application?.close()
  while (temporaries.length > 0) {
    rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
  }
})

describe('the persistent commit history', () => {
  it('is always visible, shows each commit, and opens a commit in the file sidebar', async () => {
    // The graph is part of the window, not a dialog opened from the top bar.
    expect(await page.locator('[data-testid=history-dialog]').count()).toBe(0)
    const rows = page.locator('[data-testid=history-commit]')
    expect(await rows.count()).toBe(2)

    const text = (await rows.allTextContents()).join(' ')
    expect(text).toContain('Second commit')
    expect(text).toContain('First commit')
    expect(text).toContain('Seam Sample')
    expect(text).toContain('v1.0.0')

    // The top bar hides and restores the panel without losing the repository.
    await page.click('[data-testid=history-button]')
    await page.waitForSelector('[data-testid=history-commits]', { state: 'detached' })
    await page.click('[data-testid=history-button]')
    await page.waitForSelector('[data-testid=history-commits]')

    // The newest commit adds b.txt. Selecting it replaces the changes list
    // with the commit's files and opens the first diff in the work area.
    await rows.first().click()
    await page.waitForSelector('[data-testid=history-file]')
    const files = await page.locator('[data-testid=history-file]').allTextContents()
    expect(files.join(' ')).toContain('b.txt')
    await page.waitForSelector('[data-testid=diff-panes]')
    await page.waitForSelector('[data-testid=diff-panes] .cm-content')
    expect(await page.locator('[data-testid=diff]').innerText()).toContain('second')

    // A commit's changes are already applied, so the unified view must not offer
    // to accept or reject them.
    await page.selectOption('[data-testid=diff-layout]', 'unified')
    await page.waitForSelector('[data-testid=diff] .cm-content')
    expect(await page.locator('[data-testid=diff] button[name=accept]').count()).toBe(0)
    expect(await page.locator('[data-testid=diff] button[name=reject]').count()).toBe(0)

    // Current changes returns the sidebar to the working tree's own lists.
    await page.click('[data-testid=history-current-changes]')
    await page.waitForSelector('[data-testid=history-file]', { state: 'detached' })
    await page.waitForSelector('[data-testid=staged]')
  })

  it('warns before a double click checks out an older commit', async () => {
    const git = new GitRunner()
    const before = (await git.runOrThrow(['rev-parse', 'HEAD'], { cwd: samples.clean })).stdout
      .toString()
      .trim()

    const rows = page.locator('[data-testid=history-commit]')
    expect(await rows.count()).toBe(2)

    // The second row is the older commit. A double click asks first, because
    // checking it out leaves HEAD detached and moves the working tree back.
    await rows.nth(1).dblclick()
    await page.waitForSelector('[data-testid=history-checkout]')
    const warning = await page.locator('[data-testid=history-checkout-warning]').innerText()
    // The test machine may run in any interface language, so only the facts the
    // warning must carry are checked: it talks about HEAD and shows the commit.
    expect(warning).toContain('HEAD')
    expect(await page.locator('[data-testid=history-checkout-target]').innerText()).toContain(
      (await rows.nth(1).locator('.history__id').innerText()).trim()
    )

    await page.click('[data-testid=history-checkout-confirm]')
    await page.waitForSelector('[data-testid=history-checkout]', { state: 'detached' })
    await expect
      .poll(async () =>
        (await git.runOrThrow(['rev-parse', 'HEAD'], { cwd: samples.clean })).stdout
          .toString()
          .trim()
      )
      .not.toBe(before)

    // The panel stays open and reads the repository again, now without a branch.
    await page.waitForSelector('[data-testid=history-commits]')
    await page.waitForSelector('[data-testid=staged]')
  })

  it('names the branch a tip belongs to instead of detaching HEAD', async () => {
    const git = new GitRunner()
    // The previous test left HEAD at the older commit. Go back to main and give
    // that same commit a branch, so it is a tip rather than an untipped past.
    await git.runOrThrow(['checkout', '-q', 'main'], { cwd: samples.clean })
    const older = (await git.runOrThrow(['rev-parse', 'HEAD~1'], { cwd: samples.clean })).stdout
      .toString()
      .trim()
    await git.runOrThrow(['branch', 'feature/pitagoras', older], { cwd: samples.clean })

    await page.click('[data-testid=history-button]')
    await page.waitForSelector('[data-testid=history-commits]', { state: 'detached' })
    await page.click('[data-testid=history-button]')
    await page.waitForSelector('[data-testid=history-commit]')
    const rows = page.locator('[data-testid=history-commit]')
    expect(await rows.count()).toBe(2)
    await expect.poll(async () => rows.nth(1).innerText()).toContain('feature/pitagoras')

    // The older row is now the tip of feature/pitagoras. The warning names the
    // branch, because confirming keeps HEAD attached to it.
    await rows.nth(1).dblclick()
    await page.waitForSelector('[data-testid=history-checkout]')
    expect(await page.locator('[data-testid=history-checkout-warning]').innerText()).toContain(
      'feature/pitagoras'
    )

    await page.click('[data-testid=history-checkout-confirm]')
    await page.waitForSelector('[data-testid=history-checkout]', { state: 'detached' })
    await expect
      .poll(async () =>
        (await git.runOrThrow(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: samples.clean })).stdout
          .toString()
          .trim()
      )
      .toBe('feature/pitagoras')
    expect(
      (await git.runOrThrow(['rev-parse', 'HEAD'], { cwd: samples.clean })).stdout.toString().trim()
    ).toBe(older)
  })

  it('resizes the panel with its handle and keeps the split when it is hidden', async () => {
    const panel = page.locator('.history-panel')
    const handle = page.locator('[data-testid=history-resizer]')
    const before = (await panel.boundingBox())?.width ?? 0
    const box = await handle.boundingBox()
    if (box === null) throw new Error('the history panel has no resize handle')

    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 120, startY, { steps: 6 })
    await page.mouse.up()

    await expect
      .poll(async () => (await panel.boundingBox())?.width ?? 0)
      .toBeGreaterThan(before + 100)

    // The width belongs to the panel, not to this visit: hiding and showing it
    // again restores the split the drag left.
    await page.click('[data-testid=history-button]')
    await page.waitForSelector('.history-panel', { state: 'detached' })
    await page.click('[data-testid=history-button]')
    await page.waitForSelector('.history-panel')
    const kept = (await panel.boundingBox())?.width ?? 0
    expect(Math.abs(kept - (before + 120))).toBeLessThan(2)
  })
})
