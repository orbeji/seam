// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { GitRunner } from '../../src/core/git'
import { createRepository, SampleRepository } from '../fixtures/repository'

/**
 * The Pull button's badge: like the Push count, it says how many commits the
 * next pull would bring, and a silent fetch on opening the repository is what
 * makes that count current.
 */

const WAIT_MS = 15_000
const runner = new GitRunner()
const repositories: SampleRepository[] = []
const temporaries: string[] = []

afterAll(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
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

async function bareRemote(): Promise<string> {
  const path = mkdtempSync(join(tmpdir(), 'seam-e2e-pull-remote-'))
  temporaries.push(path)
  await runner.runOrThrow(['init', '--bare', '-q', path], { cwd: tmpdir() })
  await runner.runOrThrow(['--git-dir', path, 'symbolic-ref', 'HEAD', 'refs/heads/main'], {
    cwd: tmpdir()
  })
  return path
}

/** A clone that tracks `origin/main`, so the application has an upstream to read. */
async function clone(remote: string): Promise<SampleRepository> {
  const path = mkdtempSync(join(tmpdir(), 'seam-e2e-pull-clone-'))
  const repo = new SampleRepository(path, runner)
  repositories.push(repo)
  await runner.runOrThrow(['clone', '-q', remote, path], { cwd: tmpdir() })
  await repo.git(['config', 'user.name', 'Seam Test'])
  await repo.git(['config', 'user.email', 'seam@example.com'])
  return repo
}

async function launch(
  repo: SampleRepository
): Promise<{ application: ElectronApplication; page: Page }> {
  const userData = mkdtempSync(join(tmpdir(), 'seam-e2e-pull-user-'))
  temporaries.push(userData)
  const application = await electron.launch({
    args: [
      '--no-sandbox',
      '--lang=en-US',
      join(process.cwd(), 'out', 'main', 'index.js'),
      '--repo',
      repo.path
    ],
    env: { ...process.env, SEAM_USER_DATA: userData, SEAM_HIDDEN_WINDOW: '1' } as Record<
      string,
      string
    >
  })
  const page = await application.firstWindow()
  await page.waitForSelector('[data-testid=topbar]', { timeout: WAIT_MS })
  return { application, page }
}

describe('pull', () => {
  it('counts the commits the upstream has and pulls them', async () => {
    const remote = await bareRemote()
    const writer = await createRepository()
    repositories.push(writer)
    await writer.git(['remote', 'add', 'origin', remote])
    writer.write('base.txt', 'base\n')
    await writer.git(['add', '.'])
    await writer.git(['commit', '-qm', 'Base'])
    await writer.git(['push', '-q', '-u', 'origin', 'main'])

    // The clone is made before the new commit, so its remote-tracking ref is
    // stale: only the silent fetch on opening can reveal the commit.
    const reader = await clone(remote)
    writer.write('newer.txt', 'newer\n')
    await writer.git(['add', '.'])
    await writer.git(['commit', '-qm', 'Newer'])
    await writer.git(['push', '-q', 'origin', 'main'])

    const { application, page } = await launch(reader)
    try {
      const count = page.locator('[data-testid=pull-count]')
      await waitFor(async () => (await count.count()) === 1, 'the pull count to appear')
      expect(await count.textContent()).toBe('1')
      expect(await page.locator('[data-testid=pull]').getAttribute('aria-label')).toBe(
        'Pull · 1 commit to pull'
      )

      await page.locator('[data-testid=pull]').click()
      const notice = page.locator('[data-testid=sync-notice][data-tone=ok]')
      await notice.waitFor({ timeout: WAIT_MS })
      await waitFor(async () => (await count.count()) === 0, 'the pull count to clear')
      expect(reader.read('newer.txt')).toBe('newer\n')
    } finally {
      await application.close()
    }
  })
})
