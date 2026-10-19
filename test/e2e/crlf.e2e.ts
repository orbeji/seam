// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitRunner } from '../../src/core/git'
import { createRepository, type SampleRepository } from '../fixtures/repository'

/**
 * The phase 4 CRLF test: a staged file that would commit CRLF with no
 * attribute deciding it opens the warning before the commit, and Fix and
 * Commit leaves the index holding LF.
 */

const runner = new GitRunner()
const temporaries: string[] = []
const repositories: SampleRepository[] = []
let userData: string
let application: ElectronApplication | null = null
let page: Page

async function repository(): Promise<SampleRepository> {
  const created = await createRepository()
  repositories.push(created)
  return created
}

async function waitFor(condition: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'seam-e2e-crlf-user-'))
  temporaries.push(userData)
})

afterAll(async () => {
  await application?.close()
  while (repositories.length > 0) repositories.pop()?.cleanup()
  while (temporaries.length > 0) rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
})

describe('CRLF warning', () => {
  it('opens the warning, and Fix and Commit leaves the index in LF', async () => {
    const repo = await repository()
    await runner.runOrThrow(['config', 'user.name', 'Seam Test'], { cwd: repo.path })
    await runner.runOrThrow(['config', 'user.email', 'seam@example.com'], { cwd: repo.path })
    await runner.runOrThrow(['config', 'commit.gpgsign', 'false'], { cwd: repo.path })
    repo.write('windows.txt', 'one\r\ntwo\r\n')
    await repo.git(['add', 'windows.txt'])

    application = await electron.launch({
      args: ['--no-sandbox', join(process.cwd(), 'out', 'main', 'index.js'), '--repo', repo.path],
      env: { ...process.env, SEAM_USER_DATA: userData, SEAM_HIDDEN_WINDOW: '1' } as Record<
        string,
        string
      >
    })
    page = await application.firstWindow()
    await page.waitForSelector('[data-testid=commit-message]')
    await page.waitForSelector('[data-testid=staged] [data-testid=entry]')

    await page.locator('[data-testid=commit-message]').fill('normalize the endings')
    await page.locator('[data-testid=commit-button]').click()

    // The commit stops at the warning, which names the file, and nothing is
    // committed behind the user's back.
    await page.waitForSelector('[data-testid=eol-dialog]')
    expect(await page.locator('[data-testid=eol-files]').innerText()).toContain('windows.txt')
    await repo.gitExpectingFailure(['log', '-1'])

    await page.locator('[data-testid=eol-fix]').click()
    await page.waitForSelector('[data-testid=eol-dialog]', { state: 'detached' })
    await waitFor(async () => {
      const log = await repo.run(['log', '-1', '--format=%s'])
      return log.code === 0 && log.stdout.toString('utf8').trim() === 'normalize the endings'
    }, 'the commit after the fix')

    // Fix and Commit: the index holds LF and the switch lives in the
    // repository's own configuration, never in the global one.
    expect(await repo.git(['ls-files', '--eol', '--', 'windows.txt'])).toMatch(/i\/lf\s/)
    expect((await repo.git(['config', '--get', 'core.autocrlf'])).trim()).toBe(
      process.platform === 'win32' ? 'true' : 'input'
    )
    expect(await repo.git(['config', '--show-origin', '--get', 'core.autocrlf'])).toContain(
      '.git/config'
    )
  })
})
