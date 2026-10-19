// SPDX-License-Identifier: MIT

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitRunner } from '../../src/core/git'
import { createSampleRepositories, type SampleRepositories } from '../fixtures/sample-repositories'

/**
 * The phase 4 commit test: pressing Commit confirms the index with the message
 * in the box, Unicode included, and then empties the box and its stored draft.
 */

const MESSAGE = 'Añadir café ☕\n\nCon detalles.'

const temporaries: string[] = []
let samples: SampleRepositories
let userData: string
let application: ElectronApplication
let page: Page
const runner = new GitRunner()

async function waitFor(condition: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

async function count(section: string): Promise<number> {
  return page.locator(`[data-testid=${section}] [data-testid=entry]`).count()
}

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'seam-e2e-commit-run-'))
  temporaries.push(base)
  samples = await createSampleRepositories(base)

  // A local identity and no signing, so the commit does not depend on the
  // machine's Git configuration; the identity dialog is a later task.
  await runner.runOrThrow(['config', 'user.name', 'Seam Test'], { cwd: samples.mixed })
  await runner.runOrThrow(['config', 'user.email', 'seam@example.com'], { cwd: samples.mixed })
  await runner.runOrThrow(['config', 'commit.gpgsign', 'false'], { cwd: samples.mixed })

  userData = mkdtempSync(join(tmpdir(), 'seam-e2e-commit-run-user-'))
  temporaries.push(userData)

  application = await electron.launch({
    args: ['--no-sandbox', join(process.cwd(), 'out', 'main', 'index.js'), '--repo', samples.mixed],
    env: { ...process.env, SEAM_USER_DATA: userData, SEAM_HIDDEN_WINDOW: '1' } as Record<
      string,
      string
    >
  })
  page = await application.firstWindow()
  await page.waitForSelector('[data-testid=commit-message]')
})

afterAll(async () => {
  await application?.close()
  while (temporaries.length > 0) rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
})

describe('committing from the box', () => {
  it('confirms the index with the message, then empties the box and the draft', async () => {
    const box = page.locator('[data-testid=commit-message]')
    await page.waitForSelector('[data-testid=staged] [data-testid=entry]')
    expect(await count('staged')).toBeGreaterThan(0)

    await box.fill(MESSAGE)
    await page.locator('[data-testid=commit-button]').click()
    await waitFor(async () => (await count('staged')) === 0, 'the index to be committed')

    // The commit holds exactly what was typed, Unicode included. `%B` prints the
    // stored body and adds a newline of its own.
    const body = (
      await runner.runOrThrow(['log', '-1', '--format=%B'], { cwd: samples.mixed })
    ).stdout
      .toString('utf8')
      .replace(/\n$/, '')
    expect(body).toBe(`${MESSAGE}\n`)

    // The message is spent: the box empties and the stored draft is cleared.
    await waitFor(
      async () => (await page.locator('[data-testid=commit-message]').inputValue()) === '',
      'the box to empty'
    )
    const file = join(userData, 'commit-drafts.json')
    const stored = existsSync(file) ? readFileSync(file, 'utf8') : ''
    expect(stored).not.toContain(MESSAGE)
  })
})
