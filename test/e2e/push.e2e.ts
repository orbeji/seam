// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { GitRunner } from '../../src/core/git'
import { createRepository, SampleRepository } from '../fixtures/repository'

/**
 * Phase 8 from the interface: the Push button opens the dialog with the commits
 * that would travel, a normal push lands on a local bare remote, a rejection is
 * recovered with Update and push, and Commit and Push chains the two actions.
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
  const path = mkdtempSync(join(tmpdir(), 'seam-e2e-remote-'))
  temporaries.push(path)
  await runner.runOrThrow(['init', '--bare', '-q', path], { cwd: tmpdir() })
  await runner.runOrThrow(['--git-dir', path, 'symbolic-ref', 'HEAD', 'refs/heads/main'], {
    cwd: tmpdir()
  })
  return path
}

async function repository(remote: string): Promise<SampleRepository> {
  const repo = await createRepository()
  repositories.push(repo)
  await repo.git(['config', 'user.name', 'Seam Test'])
  await repo.git(['config', 'user.email', 'seam@example.com'])
  await repo.git(['config', 'commit.gpgsign', 'false'])
  await repo.git(['remote', 'add', 'origin', remote])
  repo.write('f.txt', 'base\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Base'])
  return repo
}

async function clone(remote: string): Promise<SampleRepository> {
  const path = mkdtempSync(join(tmpdir(), 'seam-e2e-clone-'))
  const repo = new SampleRepository(path, runner)
  repositories.push(repo)
  await runner.runOrThrow(['clone', '-q', remote, path], { cwd: tmpdir() })
  await repo.git(['config', 'user.name', 'Other'])
  await repo.git(['config', 'user.email', 'other@example.com'])
  return repo
}

async function launch(
  repo: SampleRepository
): Promise<{ application: ElectronApplication; page: Page }> {
  const userData = mkdtempSync(join(tmpdir(), 'seam-e2e-push-user-'))
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

async function remoteHead(remote: string): Promise<string> {
  const result = await runner.runOrThrow(['--git-dir', remote, 'rev-parse', 'refs/heads/main'], {
    cwd: tmpdir()
  })
  return result.stdout.toString('utf8').trim()
}

async function dialogClosed(page: Page): Promise<void> {
  await waitFor(
    async () => (await page.locator('[data-testid=push-dialog]').count()) === 0,
    'the push dialog to close'
  )
}

describe('push', () => {
  it('pushes a new branch from the top bar and sets its upstream', async () => {
    const remote = await bareRemote()
    const repo = await repository(remote)
    const localHead = (await repo.git(['rev-parse', 'HEAD'])).trim()
    const { application, page } = await launch(repo)
    try {
      // The bar advertises the one commit the new branch would publish, once
      // the first snapshot has arrived.
      const pushButton = page.locator('[data-testid=push-button]')
      await waitFor(async () => !(await pushButton.isDisabled()), 'the push button to enable')
      expect(await page.locator('[data-testid=push-count]').textContent()).toBe('1')

      await pushButton.click()
      await page.waitForSelector('[data-testid=push-dialog]')

      expect(await page.locator('[data-testid=push-local-branch]').textContent()).toBe('main')
      expect(await page.locator('[data-testid=push-remote]').inputValue()).toBe('origin')
      expect(await page.locator('[data-testid=push-target-branch]').inputValue()).toBe('main')
      expect(await page.locator('[data-testid=push-commit-count]').textContent()).toBe(
        '1 commit to push'
      )
      expect(await page.locator('[data-testid=push-set-upstream]').count()).toBe(1)

      await page.locator('[data-testid=push-submit]').click()
      await dialogClosed(page)

      // The success popup arrives as soon as the push ends, before the slow
      // checks below and before its own few seconds run out.
      const notice = page.locator('[data-testid=sync-notice][data-tone=ok]')
      await notice.waitFor()
      expect(await notice.textContent()).toBe('Pushed to origin/main.')

      await waitFor(async () => (await remoteHead(remote)) === localHead, 'the remote branch')

      expect((await repo.git(['rev-parse', '--abbrev-ref', 'main@{u}'])).trim()).toBe('origin/main')

      // Nothing is left to send, so the button waits for the next commit.
      await waitFor(async () => pushButton.isDisabled(), 'the push button to disable')
      expect(await page.locator('[data-testid=push-count]').count()).toBe(0)
    } finally {
      await application.close()
    }
  })

  it('recovers a rejected push with Update and push', async () => {
    const remote = await bareRemote()
    const repo = await repository(remote)
    await repo.git(['push', '-q', '-u', 'origin', 'main'])

    const other = await clone(remote)
    other.write('other.txt', 'theirs\n')
    await other.git(['add', '.'])
    await other.git(['commit', '-qm', 'Other change'])
    await other.git(['push', '-q', 'origin', 'main'])

    repo.write('local.txt', 'ours\n')
    await repo.git(['add', '.'])
    await repo.git(['commit', '-qm', 'Local change'])
    const localHead = (await repo.git(['rev-parse', 'HEAD'])).trim()

    const { application, page } = await launch(repo)
    try {
      await page.locator('[data-testid=push-button]').click()
      await page.waitForSelector('[data-testid=push-dialog]')
      await page.locator('[data-testid=push-submit]').click()

      await page.waitForSelector('[data-testid=push-rejected]')
      expect(await page.locator('[data-testid=push-rejected-reason]').textContent()).toContain(
        'The remote has commits that are not here'
      )

      await page.locator('[data-testid=push-strategy]').selectOption('merge')
      await page.locator('[data-testid=push-update]').click()
      await dialogClosed(page)

      await waitFor(
        async () => (await remoteHead(remote)) !== localHead,
        'the merge commit on the remote'
      )
      expect(await repo.git(['log', '-1', '--format=%s'])).toContain('Merge')
      const subjects = await repo.git(['log', '--format=%s'])
      expect(subjects).toContain('Local change')
      expect(subjects).toContain('Other change')
    } finally {
      await application.close()
    }
  })

  it('chains Commit and Push after the commit exists', async () => {
    const remote = await bareRemote()
    const repo = await repository(remote)
    repo.write('g.txt', 'next\n')
    await repo.git(['add', '.'])

    const { application, page } = await launch(repo)
    try {
      await page.locator('[data-testid=commit-message]').fill('Add g')
      await page.locator('[data-testid=commit-push-button]').click()
      await page.waitForSelector('[data-testid=push-dialog]')
      expect(await page.locator('[data-testid=push-commit-count]').textContent()).toBe(
        '2 commits to push'
      )

      await page.locator('[data-testid=push-submit]').click()
      await dialogClosed(page)
      await waitFor(
        async () => (await remoteHead(remote)) === (await repo.git(['rev-parse', 'HEAD'])).trim(),
        'the two commits on the remote'
      )
      expect((await repo.git(['log', '-1', '--format=%s'])).trim()).toBe('Add g')
    } finally {
      await application.close()
    }
  })
})
