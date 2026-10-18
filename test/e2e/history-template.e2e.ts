// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitRunner } from '../../src/core/git'
import { createRepository, type SampleRepository } from '../fixtures/repository'

/**
 * The phase 4 history and template test: an empty box comes from
 * `commit.template`, and the button under it offers a previous message again.
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
  userData = mkdtempSync(join(tmpdir(), 'seam-e2e-history-user-'))
  temporaries.push(userData)
})

afterAll(async () => {
  await application?.close()
  while (repositories.length > 0) repositories.pop()?.cleanup()
  while (temporaries.length > 0) rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
})

describe('history and template', () => {
  it('fills an empty box from the template and offers a previous message', async () => {
    const repo = await repository()
    await runner.runOrThrow(['config', 'user.name', 'Seam Test'], { cwd: repo.path })
    await runner.runOrThrow(['config', 'user.email', 'seam@example.com'], { cwd: repo.path })
    await runner.runOrThrow(['config', 'commit.gpgsign', 'false'], { cwd: repo.path })
    repo.write('msg-template.txt', 'Template subject\n\nTemplate body\n')
    await runner.runOrThrow(['config', 'commit.template', 'msg-template.txt'], { cwd: repo.path })
    repo.write('f.txt', 'one\n')
    await repo.git(['add', 'f.txt', 'msg-template.txt'])

    application = await electron.launch({
      args: ['--no-sandbox', join(process.cwd(), 'out', 'main', 'index.js'), '--repo', repo.path],
      env: { ...process.env, SEAM_USER_DATA: userData } as Record<string, string>
    })
    page = await application.firstWindow()
    await page.waitForSelector('[data-testid=commit-message]')
    await page.waitForSelector('[data-testid=staged] [data-testid=entry]')

    // With no draft saved, the box starts from the repository's template.
    await waitFor(
      async () =>
        (await page.locator('[data-testid=commit-message]').inputValue()) ===
        'Template subject\n\nTemplate body\n',
      'the template in the box'
    )
    // Nothing was confirmed yet, so the history has nothing to offer.
    expect(await page.locator('[data-testid=commit-history]').count()).toBe(0)

    await page.locator('[data-testid=commit-message]').fill('remember me')
    await page.locator('[data-testid=commit-button]').click()
    await waitFor(
      async () => (await page.locator('[data-testid=commit-message]').inputValue()) === '',
      'the first commit'
    )

    repo.write('g.txt', 'two\n')
    await repo.git(['add', 'g.txt'])
    await waitFor(
      async () => (await page.locator('[data-testid=staged] [data-testid=entry]').count()) === 1,
      'the new staged file'
    )

    // The message just confirmed is now offered by the history button.
    await page.waitForSelector('[data-testid=commit-history]')
    await page.locator('[data-testid=commit-history]').click()
    await page.locator('[data-testid=commit-history-item]').first().click()
    expect(await page.locator('[data-testid=commit-message]').inputValue()).toBe('remember me')
    expect(await repo.git(['log', '-1', '--format=%s'])).toBe('remember me\n')
  })
})
