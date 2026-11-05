// SPDX-License-Identifier: MIT

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSampleRepositories, type SampleRepositories } from '../fixtures/sample-repositories'

/**
 * The phase 5 conflicts dialog against a stopped merge: it opens on its own,
 * names both sides, resolves each kind without an editor, resolves the simple
 * conflicts in bulk, asks before overwriting an edited file and undoes a
 * resolution. Abort is available from the start; Accept and finish waits for
 * every file to be resolved.
 */

let repository: string
let application: ElectronApplication
let page: Page
const temporaries: string[] = []
const WAIT_MS = 15_000

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'seam-e2e-conflicts-'))
  temporaries.push(base)
  const samples: SampleRepositories = await createSampleRepositories(base)
  repository = samples.conflicts

  const userData = mkdtempSync(join(tmpdir(), 'seam-e2e-conflicts-user-'))
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

/** Polls a condition until it holds, so the test never races the renderer. */
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

async function clickAndResolve(path: string, action: string): Promise<void> {
  await row(path).locator(`[data-testid=${action}]`).click()
  await waitFor(() => resolved(path), `${path} to be resolved`)
}

/** The index still holds unmerged stages for a path. */
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

describe('the conflicts dialog', () => {
  it('opens by itself during a merge and names both sides', async () => {
    const sides = await page.locator('[data-testid=conflict-sides]').textContent()
    expect(sides).toContain('Yours: main')
    expect(sides).toContain('Theirs: side')

    const rows = page.locator('[data-testid=conflict-row]')
    expect(await rows.count()).toBe(6)
    expect(await row('both.txt').locator('[data-testid=accept-yours]').textContent()).toContain(
      'main'
    )
    expect(await row('both.txt').locator('[data-testid=accept-theirs]').textContent()).toContain(
      'side'
    )
  })

  it('offers Abort at once and waits for every file before Accept and finish', async () => {
    expect(await page.locator('[data-testid=dialog-abort]').isDisabled()).toBe(false)
    expect(await page.locator('[data-testid=dialog-abort]').textContent()).toBe('Abort merge')
    expect(await page.locator('[data-testid=accept-finish]').isDisabled()).toBe(true)
    expect(await page.locator('[data-testid=accept-finish]').getAttribute('title')).toBe(
      'Resolve every conflict before finishing.'
    )
  })

  it('reopens from the Merge Conflicts node after closing', async () => {
    await page.locator('[data-testid=conflicts-close]').click()
    await page.waitForSelector('[data-testid=conflicts]')
    expect(await page.locator('[data-testid=conflicts-dialog]').count()).toBe(0)

    await page.locator('[data-testid=conflicts-resolve]').click()
    await page.waitForSelector('[data-testid=conflicts-dialog]')
  })

  it('does not offer accept or reject on a conflict in the unified view', async () => {
    await page.locator('[data-testid=conflicts-close]').click()
    await page.waitForSelector('[data-testid=conflicts]')

    await page.locator('[data-testid=conflicts] [data-testid=entry][title="both.txt"]').click()
    await page.waitForSelector('[data-testid=diff-panes]')
    await page.selectOption('[data-testid=diff-layout]', 'unified')
    await page.waitForSelector('[data-testid=diff-panes] .cm-deletedChunk')

    expect(await page.locator('[data-testid=diff-panes] .cm-chunkButtons').count()).toBe(0)

    await page.locator('[data-testid=diff-close]').click()
    await page.waitForSelector('[data-testid=conflicts-resolve]')
    await page.locator('[data-testid=conflicts-resolve]').click()
    await page.waitForSelector('[data-testid=conflicts-dialog]')
  })

  it('resolves the simple conflicts and leaves the rest', async () => {
    await page.locator('[data-testid=resolve-simple]').click()
    await waitFor(() => resolved('simple.txt'), 'the simple conflict to resolve')
    expect(workingCopy('simple.txt')).toBe('ALPHA beta GAMMA\n')
    expect(unmerged('simple.txt')).toBe(0)
    expect(await resolved('both.txt')).toBe(false)
    expect(await page.locator('[data-testid=conflict-row][data-resolved=false]').count()).toBe(5)
    expect(await page.locator('[data-testid=conflicts-notice]').textContent()).toContain(
      'Resolved 1'
    )
  })

  it('accepts the checked-out and the incoming side of a text conflict', async () => {
    await clickAndResolve('both.txt', 'accept-yours')
    expect(workingCopy('both.txt')).toBe('ours\n')
    expect(unmerged('both.txt')).toBe(0)

    await clickAndResolve('added-by-both.txt', 'accept-theirs')
    expect(workingCopy('added-by-both.txt')).toBe('added by them\n')
  })

  it('keeps or deletes a file in a deletion conflict', async () => {
    await clickAndResolve('deleted-by-us.txt', 'keep-file')
    expect(workingCopy('deleted-by-us.txt')).toBe('modified by them\n')

    await clickAndResolve('deleted-by-them.txt', 'delete-file')
    expect(() => workingCopy('deleted-by-them.txt')).toThrow()
    expect(unmerged('deleted-by-them.txt')).toBe(0)
  })

  it('accepts a side of a binary conflict', async () => {
    await clickAndResolve('binary.dat', 'accept-yours')
    expect(unmerged('binary.dat')).toBe(0)
  })

  it('undoes a resolution and asks before overwriting an edited file', async () => {
    await row('both.txt').locator('[data-testid=conflict-menu]').click()
    await page.locator('[data-testid=revert]').click()
    await waitFor(async () => !(await resolved('both.txt')), 'both.txt to be a conflict again')
    expect(workingCopy('both.txt')).toContain('<<<<<<<')
    expect(unmerged('both.txt')).toBeGreaterThan(0)

    // Rewrite the file behind the dialog's back: the fingerprint no longer matches.
    writeFileSync(join(repository, 'both.txt'), 'edited outside Seam\n')
    await row('both.txt').locator('[data-testid=accept-yours]').click()
    await page.waitForSelector('[data-testid=overwrite-prompt]')
    await page.locator('[data-testid=overwrite-cancel]').click()
    expect(workingCopy('both.txt')).toBe('edited outside Seam\n')

    await row('both.txt').locator('[data-testid=accept-yours]').click()
    await page.waitForSelector('[data-testid=overwrite-prompt]')
    await page.locator('[data-testid=overwrite-confirm]').click()
    await waitFor(() => resolved('both.txt'), 'the confirmed overwrite')
    expect(workingCopy('both.txt')).toBe('ours\n')
  })

  it('shows a resolved result and the actions of its context menu', async () => {
    await row('both.txt').locator('[data-testid=conflict-menu]').click()
    await page.waitForSelector('[data-testid=conflict-menu-popup]')
    expect(await page.locator('[data-testid=show-diff]').textContent()).toBe('Show diff')
    expect(await page.locator('[data-testid=revert]').textContent()).toBe(
      'Revert conflict resolution'
    )
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid=conflict-menu-popup]', { state: 'detached' })

    await row('both.txt').locator('[data-testid=show-result]').click()
    await page.waitForSelector('[data-testid=diff-path]')
    expect(await page.locator('[data-testid=diff-path]').textContent()).toBe('both.txt')
    expect(await page.locator('[data-testid=conflicts-dialog]').count()).toBe(0)
  })
})
