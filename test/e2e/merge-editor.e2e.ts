// SPDX-License-Identifier: MIT

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSampleRepositories, type SampleRepositories } from '../fixtures/sample-repositories'

/**
 * The phase 6 merge editor against a stopped merge: the conflicts list opens it
 * on Resolve manually, the arrows settle a conflict, Apply changes writes and
 * stages the result and the editor returns to the list. Closing with unsaved
 * text asks first and leaves the working copy alone.
 */

let repository: string
let application: ElectronApplication
let page: Page
const temporaries: string[] = []
const WAIT_MS = 15_000

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'seam-e2e-merge-'))
  temporaries.push(base)
  const samples: SampleRepositories = await createSampleRepositories(base)
  repository = samples.conflicts

  const userData = mkdtempSync(join(tmpdir(), 'seam-e2e-merge-user-'))
  temporaries.push(userData)

  application = await electron.launch({
    args: [
      '--no-sandbox',
      '--lang=en-US',
      join(process.cwd(), 'out', 'main', 'index.js'),
      '--repo',
      repository
    ],
    env: { ...process.env, SEAM_USER_DATA: userData, SEAM_HIDDEN_WINDOW: '1' } as Record<
      string,
      string
    >
  })
  page = await application.firstWindow()
  await page.waitForSelector('[data-testid=conflicts-dialog]', { timeout: WAIT_MS })
})

afterAll(async () => {
  await application?.close()
  while (temporaries.length > 0) rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
})

async function waitFor(condition: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

function row(path: string) {
  return page.locator(`[data-testid=conflict-row][data-path="${path}"]`)
}

async function resolved(path: string): Promise<boolean> {
  return (await row(path).getAttribute('data-resolved')) === 'true'
}

function unmerged(path: string): number {
  const output = execFileSync('git', ['ls-files', '-u', '--', path], {
    cwd: repository,
    encoding: 'utf8'
  })
  return output.split('\n').filter((line) => line !== '').length
}

function workingCopy(path: string): string {
  return readFileSync(join(repository, path), 'utf8')
}

describe('the merge editor', () => {
  it('opens from Resolve manually with the three panes and the sides', async () => {
    await row('both.txt').locator('[data-testid=resolve-manually]').click()
    await page.waitForSelector('[data-testid=merge-editor]', { timeout: WAIT_MS })

    expect(await page.locator('[data-testid=merge-path]').textContent()).toBe('both.txt')
    expect(await page.locator('[data-testid=merge-conflict-of]').textContent()).toBe(
      'Conflict 1 of 1'
    )
    expect(await page.locator('[data-testid=merge-stats]').textContent()).toContain('1 conflicts')
    expect(await page.locator('[data-testid=merge-result-line]').first().inputValue()).toBe('base')
  })

  it('settles the conflict with an arrow and the other side ignore', async () => {
    const result = page.locator('[data-testid=merge-result-line]').first()
    await page.locator('[data-testid=merge-take-left]').click()
    expect(await result.inputValue()).toBe('ours')

    await result.click()
    await page.keyboard.press('Control+z')
    expect(await result.inputValue()).toBe('base')
    await page.keyboard.press('Control+Shift+z')
    expect(await result.inputValue()).toBe('ours')

    await page.locator('[data-testid=merge-ignore-right]').click()
    expect(await page.locator('[data-testid=merge-apply]').isDisabled()).toBe(false)
    await page.locator('[data-testid=merge-apply]').click()

    await page.waitForSelector('[data-testid=conflicts-dialog]', { timeout: WAIT_MS })
    await waitFor(() => resolved('both.txt'), 'both.txt to be resolved')
    expect(workingCopy('both.txt')).toBe('ours\n')
    expect(unmerged('both.txt')).toBe(0)
  })

  it('asks before closing with unsaved text and writes nothing', async () => {
    await row('simple.txt').locator('[data-testid=resolve-manually]').click()
    await page.waitForSelector('[data-testid=merge-editor]', { timeout: WAIT_MS })

    const before = workingCopy('simple.txt')
    await page.locator('[data-testid=merge-result-line]').first().fill('draft')
    await page.locator('[data-testid=merge-close]').click()
    await page.waitForSelector('[data-testid=merge-discard-prompt]', { timeout: WAIT_MS })

    await page.locator('[data-testid=merge-discard-cancel]').click()
    expect(await page.locator('[data-testid=merge-editor]').count()).toBe(1)

    await page.locator('[data-testid=merge-close]').click()
    await page.locator('[data-testid=merge-discard]').click()
    await page.waitForSelector('[data-testid=conflicts-dialog]', { timeout: WAIT_MS })
    expect(workingCopy('simple.txt')).toBe(before)
    expect(unmerged('simple.txt')).toBe(3)
    expect(await resolved('simple.txt')).toBe(false)
  })
})
