// SPDX-License-Identifier: MIT

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitRunner } from '../../src/core/git'
import { createRepository, type SampleRepository } from '../fixtures/repository'

/**
 * The phase 4 sign-off test: the setting adds Git's `Signed-off-by` trailer and
 * stays set for the next commit.
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

/** Waits until the checkbox's write has reached the settings file on disk. */
async function waitForSetting(key: string, expected: unknown): Promise<void> {
  await waitFor(
    async () => {
      try {
        const settings = JSON.parse(
          readFileSync(join(userData, 'settings.json'), 'utf8')
        ) as Record<string, unknown>
        return settings[key] === expected
      } catch {
        return false
      }
    },
    `${key} to be ${String(expected)}`
  )
}

beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'seam-e2e-author-user-'))
  temporaries.push(userData)
})

afterAll(async () => {
  await application?.close()
  while (repositories.length > 0) repositories.pop()?.cleanup()
  while (temporaries.length > 0) rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
})

describe('signing the commit', () => {
  it('adds the trailer from the setting and keeps it for the next commit', async () => {
    const repo = await repository()
    await runner.runOrThrow(['config', 'user.name', 'Seam Test'], { cwd: repo.path })
    await runner.runOrThrow(['config', 'user.email', 'seam@example.com'], { cwd: repo.path })
    await runner.runOrThrow(['config', 'commit.gpgsign', 'false'], { cwd: repo.path })
    repo.write('f.txt', 'one\n')
    await repo.git(['add', 'f.txt'])

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

    await page.locator('[data-testid=settings]').click()
    await page.waitForSelector('[data-testid=settings-dialog][data-ready=true]')
    await page.locator('[data-testid=settings-signoff]').click()
    await waitFor(
      async () => await page.locator('[data-testid=settings-signoff]').isChecked(),
      'the sign-off setting'
    )
    await waitForSetting('signoff', true)
    await page.locator('[data-testid=settings-close]').click()
    await page.waitForSelector('[data-testid=settings-dialog]', { state: 'detached' })

    await page.locator('[data-testid=commit-message]').fill('first')
    await page.locator('[data-testid=commit-button]').click()
    await waitFor(
      async () => (await page.locator('[data-testid=commit-message]').inputValue()) === '',
      'the first commit'
    )

    expect((await repo.git(['log', '-1', '--format=%an <%ae>'])).trim()).toBe(
      'Seam Test <seam@example.com>'
    )
    expect((await repo.git(['log', '-1', '--format=%cn <%ce>'])).trim()).toBe(
      'Seam Test <seam@example.com>'
    )
    expect(await repo.git(['log', '-1', '--format=%B'])).toContain(
      'Signed-off-by: Seam Test <seam@example.com>'
    )

    // The setting is still set, so the next commit is signed the same way.
    await page.locator('[data-testid=settings]').click()
    await page.waitForSelector('[data-testid=settings-dialog][data-ready=true]')
    expect(await page.locator('[data-testid=settings-signoff]').isChecked()).toBe(true)
    await page.locator('[data-testid=settings-close]').click()
    await page.waitForSelector('[data-testid=settings-dialog]', { state: 'detached' })

    repo.write('g.txt', 'two\n')
    await repo.git(['add', 'g.txt'])
    await waitFor(
      async () => (await page.locator('[data-testid=staged] [data-testid=entry]').count()) === 1,
      'the new staged file'
    )
    await page.locator('[data-testid=commit-message]').fill('second')
    await page.locator('[data-testid=commit-button]').click()
    await waitFor(
      async () =>
        (await runner.run(['log', '-1', '--format=%s'], { cwd: repo.path })).stdout
          .toString('utf8')
          .trim() === 'second',
      'the second commit'
    )

    expect((await repo.git(['log', '-1', '--format=%an <%ae>'])).trim()).toBe(
      'Seam Test <seam@example.com>'
    )
    expect(await repo.git(['log', '-1', '--format=%B'])).toContain(
      'Signed-off-by: Seam Test <seam@example.com>'
    )
  })
})
