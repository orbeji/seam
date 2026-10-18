// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitRunner } from '../../src/core/git'
import { createRepository, type SampleRepository } from '../fixtures/repository'

/**
 * The phase 4 hooks test: a `pre-commit` hook that refuses stops the commit and
 * its output is shown, and turning the hooks off lets the same commit through.
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

/** Writes an executable hook into the repository, as a user would by hand. */
function writeHook(repo: SampleRepository, name: string, body: string): void {
  writeFileSync(join(repo.path, '.git', 'hooks', name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
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
  userData = mkdtempSync(join(tmpdir(), 'seam-e2e-hooks-user-'))
  temporaries.push(userData)
})

afterAll(async () => {
  await application?.close()
  while (repositories.length > 0) repositories.pop()?.cleanup()
  while (temporaries.length > 0) rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
})

describe('running hooks', () => {
  it('shows a refusing hook and lets the commit through with hooks off', async () => {
    const repo = await repository()
    await runner.runOrThrow(['config', 'user.name', 'Seam Test'], { cwd: repo.path })
    await runner.runOrThrow(['config', 'user.email', 'seam@example.com'], { cwd: repo.path })
    await runner.runOrThrow(['config', 'commit.gpgsign', 'false'], { cwd: repo.path })
    repo.write('f.txt', 'one\n')
    await repo.git(['add', 'f.txt'])
    writeHook(repo, 'pre-commit', 'echo "pre-commit refuses"\nexit 1')

    application = await electron.launch({
      args: ['--no-sandbox', join(process.cwd(), 'out', 'main', 'index.js'), '--repo', repo.path],
      env: { ...process.env, SEAM_USER_DATA: userData } as Record<string, string>
    })
    page = await application.firstWindow()
    await page.waitForSelector('[data-testid=commit-message]')
    await page.waitForSelector('[data-testid=staged] [data-testid=entry]')

    // The hook refuses, so nothing is committed and its output is shown.
    await page.locator('[data-testid=commit-message]').fill('blocked')
    await page.locator('[data-testid=commit-button]').click()
    await page.waitForSelector('[data-testid=commit-output]')
    expect(await page.locator('[data-testid=commit-output]').textContent()).toContain(
      'pre-commit refuses'
    )
    expect(await page.locator('[data-testid=commit-message]').inputValue()).toBe('blocked')
    expect((await repo.run(['rev-parse', '--verify', 'HEAD'])).code).not.toBe(0)

    // Turning the hooks off lets the same commit through.
    await page.locator('[data-testid=commit-hooks]').uncheck()
    await page.locator('[data-testid=commit-button]').click()
    await waitFor(
      async () => (await repo.run(['rev-parse', '--verify', 'HEAD'])).code === 0,
      'the commit'
    )
    expect((await repo.git(['log', '-1', '--format=%s'])).trim()).toBe('blocked')
  })
})
