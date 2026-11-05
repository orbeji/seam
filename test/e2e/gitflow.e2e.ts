// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { createRepository, SampleRepository } from '../fixtures/repository'

/**
 * The branch, merge and GitFlow buttons from the interface: each opens its
 * dialog, GitFlow initializes the repository, starts a feature from develop and
 * finishes it again, and the branch label follows the checkout.
 */

const WAIT_MS = 15_000
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

async function repository(): Promise<SampleRepository> {
  const repo = await createRepository()
  repositories.push(repo)
  await repo.git(['config', 'user.name', 'Seam Test'])
  await repo.git(['config', 'user.email', 'seam@example.com'])
  await repo.git(['config', 'commit.gpgsign', 'false'])
  repo.write('file.txt', 'base\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Base'])
  return repo
}

async function launch(
  repo: SampleRepository
): Promise<{ application: ElectronApplication; page: Page }> {
  const userData = mkdtempSync(join(tmpdir(), 'seam-e2e-gitflow-user-'))
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

describe('branch, merge and GitFlow dialogs', () => {
  it('opens the new dialogs and drives a feature through GitFlow', async () => {
    const repo = await repository()
    const { application, page } = await launch(repo)
    try {
      await page.click('[data-testid=branch-button]')
      await page.waitForSelector('[data-testid=branch-dialog]', { timeout: WAIT_MS })
      expect(await page.locator('[data-testid=branch-list]').count()).toBe(1)
      await page.click('[data-testid=branch-dialog] .dialog__actions .dialog__button')

      await page.click('[data-testid=merge-button]')
      await page.waitForSelector('[data-testid=merge-dialog]', { timeout: WAIT_MS })
      await page.click('[data-testid=merge-dialog] .dialog__actions .dialog__button')

      await page.click('[data-testid=gitflow-button]')
      await page.waitForSelector('[data-testid=gitflow-init]', { timeout: WAIT_MS })
      await page.click('[data-testid=gitflow-init-submit]')
      await page.waitForSelector('[data-testid=gitflow-init]', {
        state: 'detached',
        timeout: WAIT_MS
      })
      await waitFor(
        async () =>
          (await page.locator('[data-testid=branch-label]').textContent())?.trim() === 'develop',
        'develop checkout'
      )

      await page.click('[data-testid=gitflow-button]')
      await page.waitForSelector('[data-testid=gitflow-start]', { timeout: WAIT_MS })
      await page.fill('[data-testid=gitflow-name]', 'login')
      await page.click('[data-testid=gitflow-start-submit]')
      await page.waitForSelector('[data-testid=gitflow-start]', {
        state: 'detached',
        timeout: WAIT_MS
      })
      await waitFor(
        async () =>
          (await page.locator('[data-testid=branch-label]').textContent())?.trim() ===
          'feature/login',
        'feature checkout'
      )
      expect((await repo.git(['branch', '--format=%(refname:short)'])).trim()).toContain(
        'feature/login'
      )

      await page.click('[data-testid=gitflow-button]')
      await page.waitForSelector('[data-testid=gitflow-finish]', { timeout: WAIT_MS })
      await page.click('[data-testid=gitflow-finish-submit]')
      await page.waitForSelector('[data-testid=gitflow-finish]', {
        state: 'detached',
        timeout: WAIT_MS
      })
      await waitFor(
        async () =>
          (await page.locator('[data-testid=branch-label]').textContent())?.trim() === 'develop',
        'return to develop'
      )
      expect((await repo.git(['branch', '--format=%(refname:short)'])).trim()).not.toContain(
        'feature/login'
      )
    } finally {
      await application.close()
    }
  })
})
