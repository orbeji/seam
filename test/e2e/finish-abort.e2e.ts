// SPDX-License-Identifier: MIT

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { GitRunner } from '../../src/core/git'
import { createRepository, type SampleRepository } from '../fixtures/repository'

/**
 * Phase 7 from the interface: Accept and finish closes each operation the way
 * its Git command does, Abort asks first, a rebase reloads its progress and
 * survives a hook refusal, and an operation finished from a terminal closes the
 * dialog with a notice.
 */

const WAIT_MS = 15_000
const runner = new GitRunner()
const temporaries: string[] = []
const repositories: SampleRepository[] = []

afterAll(() => {
  while (repositories.length > 0) repositories.pop()?.cleanup()
  while (temporaries.length > 0) rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
})

async function repository(): Promise<SampleRepository> {
  const created = await createRepository()
  repositories.push(created)
  // The app commits with the repository's identity, not the fixture's -c flags.
  await created.git(['config', 'user.name', 'Seam Test'])
  await created.git(['config', 'user.email', 'seam@example.com'])
  await created.git(['config', 'commit.gpgsign', 'false'])
  return created
}

/** Polls a condition until it holds, so the test never races the renderer. */
async function waitFor(condition: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

async function launch(
  repo: SampleRepository
): Promise<{ application: ElectronApplication; page: Page }> {
  const userData = mkdtempSync(join(tmpdir(), 'seam-e2e-finish-user-'))
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
  await page.waitForSelector('[data-testid=conflicts-dialog]', { timeout: WAIT_MS })
  return { application, page }
}

function row(page: Page, path: string) {
  return page.locator(`[data-testid=conflict-row][data-path="${path}"]`)
}

async function acceptYours(page: Page, path: string): Promise<void> {
  await row(page, path).locator('[data-testid=accept-yours]').click()
  await waitFor(
    async () => (await row(page, path).getAttribute('data-resolved')) === 'true',
    `${path} to be resolved`
  )
}

async function dialogClosed(page: Page): Promise<void> {
  await waitFor(
    async () => (await page.locator('[data-testid=conflicts-dialog]').count()) === 0,
    'the conflicts dialog to close'
  )
}

async function notice(page: Page): Promise<string> {
  await page.waitForSelector('[data-testid=sync-notice][data-tone=ok]')
  return (await page.locator('[data-testid=sync-notice][data-tone=ok]').textContent()) ?? ''
}

/** A merge stopped on the one line both branches changed. */
async function mergeConflicted(): Promise<SampleRepository> {
  const repo = await repository()
  repo.write('f.txt', 'base\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Base'])

  await repo.git(['checkout', '-q', '-b', 'side'])
  repo.write('f.txt', 'theirs\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Side change'])

  await repo.git(['checkout', '-q', 'main'])
  repo.write('f.txt', 'ours\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Main change'])

  await repo.gitExpectingFailure(['merge', '--no-edit', 'side'])
  return repo
}

/** A rebase stopped on the only commit being replayed. */
async function rebaseConflicted(): Promise<SampleRepository> {
  const repo = await repository()
  repo.write('f.txt', 'base\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Base'])

  await repo.git(['checkout', '-q', '-b', 'side'])
  repo.write('f.txt', 'side\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Side change'])

  await repo.git(['checkout', '-q', 'main'])
  repo.write('f.txt', 'main\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Main change'])

  await repo.git(['checkout', '-q', 'side'])
  await repo.gitExpectingFailure(['rebase', 'main'])
  return repo
}

/** A cherry-pick stopped on the picked commit. */
async function cherryPickConflicted(): Promise<SampleRepository> {
  const repo = await repository()
  repo.write('f.txt', 'base\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Base'])

  await repo.git(['checkout', '-q', '-b', 'side'])
  repo.write('f.txt', 'side\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Side change'])
  const picked = (await repo.git(['rev-parse', 'HEAD'])).trim()

  await repo.git(['checkout', '-q', 'main'])
  repo.write('f.txt', 'main\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Main change'])

  await repo.gitExpectingFailure(['cherry-pick', picked])
  return repo
}

/** A stash pop stopped on the files the current commit also changed. */
async function stashConflicted(): Promise<SampleRepository> {
  const repo = await repository()
  repo.write('f.txt', 'base\n')
  repo.write('g.txt', 'base\n')
  await repo.git(['add', '.'])
  await repo.git(['commit', '-qm', 'Base'])

  repo.write('f.txt', 'stashed\n')
  repo.write('g.txt', 'stashed\n')
  await repo.git(['stash', 'push', '-m', 'Stashed change'])

  repo.write('f.txt', 'current\n')
  repo.write('g.txt', 'current\n')
  await repo.git(['commit', '-qam', 'Current change'])
  await repo.gitExpectingFailure(['stash', 'pop'])
  return repo
}

describe('finishing and aborting', () => {
  it('finishes a merge through the commit box', async () => {
    const repo = await mergeConflicted()
    const { application, page } = await launch(repo)
    try {
      await acceptYours(page, 'f.txt')
      await waitFor(
        async () => !(await page.locator('[data-testid=accept-finish]').isDisabled()),
        'Accept and finish to enable'
      )
      await page.locator('[data-testid=accept-finish]').click()
      await dialogClosed(page)

      const box = page.locator('[data-testid=commit-message]')
      await waitFor(
        async () => (await box.inputValue()) === "Merge branch 'side'",
        'MERGE_MSG in the commit box'
      )
      await waitFor(
        async () => box.evaluate((element) => element.ownerDocument.activeElement === element),
        'the commit box to take focus'
      )

      await page.locator('[data-testid=commit-button]').click()
      await waitFor(
        async () =>
          (await repo.git(['rev-list', '--parents', '-n', '1', 'HEAD'])).trim().split(' ')
            .length === 3,
        'the merge commit'
      )
      expect((await repo.git(['log', '-1', '--format=%s'])).trim()).toBe("Merge branch 'side'")
      expect(existsSync(join(repo.path, '.git', 'MERGE_HEAD'))).toBe(false)
    } finally {
      await application.close()
    }
  })

  it('shows the rebase progress and finishes the replayed commit', async () => {
    const repo = await rebaseConflicted()
    const { application, page } = await launch(repo)
    try {
      expect(await page.locator('[data-testid=rebase-progress]').textContent()).toBe(
        'Commit 1 of 1'
      )
      await acceptYours(page, 'f.txt')
      await waitFor(
        async () => !(await page.locator('[data-testid=accept-finish]').isDisabled()),
        'Accept and finish to enable'
      )
      await page.locator('[data-testid=accept-finish]').click()
      await dialogClosed(page)

      expect(await notice(page)).toBe('Rebase finished.')
      expect(existsSync(join(repo.path, '.git', 'rebase-merge'))).toBe(false)
      expect((await repo.git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe('side')
      expect((await repo.git(['log', '-1', '--format=%s'])).trim()).toBe('Side change')
    } finally {
      await application.close()
    }
  })

  it('shows a failed hook without losing the resolution', async () => {
    const repo = await cherryPickConflicted()
    const { application, page } = await launch(repo)
    try {
      await row(page, 'f.txt').locator('[data-testid=accept-theirs]').click()
      await waitFor(
        async () => (await row(page, 'f.txt').getAttribute('data-resolved')) === 'true',
        'f.txt to be resolved'
      )
      await waitFor(
        async () => !(await page.locator('[data-testid=accept-finish]').isDisabled()),
        'Accept and finish to enable'
      )

      const hook = join(repo.path, '.git', 'hooks', 'pre-commit')
      writeFileSync(hook, '#!/bin/sh\necho "hook refused" >&2\nexit 1\n', { mode: 0o755 })
      await page.locator('[data-testid=accept-finish]').click()
      await page.waitForSelector('[data-testid=git-output-dialog]')
      expect(await page.locator('[data-testid=git-output]').textContent()).toContain('hook refused')
      // The resolutions are still there behind the output.
      expect(await row(page, 'f.txt').getAttribute('data-resolved')).toBe('true')

      await page.locator('[data-testid=git-output-close]').click()
      await page.waitForSelector('[data-testid=git-output-dialog]', { state: 'detached' })
      rmSync(hook)
      await page.locator('[data-testid=accept-finish]').click()
      await dialogClosed(page)

      expect(await notice(page)).toBe('Cherry-pick finished.')
      expect((await repo.git(['log', '-1', '--format=%s'])).trim()).toBe('Side change')
    } finally {
      await application.close()
    }
  })

  it('skips the commit that stopped a cherry-pick', async () => {
    const repo = await cherryPickConflicted()
    const { application, page } = await launch(repo)
    try {
      await page.locator('[data-testid=skip-commit]').click()
      await page.waitForSelector('[data-testid=skip-prompt]')
      expect(await page.locator('[data-testid=skip-prompt]').textContent()).toContain(
        'The commit that stopped here is left out of the operation.'
      )
      await page.locator('[data-testid=skip-confirm]').click()
      await dialogClosed(page)

      expect(await notice(page)).toBe('Cherry-pick finished.')
      expect(existsSync(join(repo.path, '.git', 'CHERRY_PICK_HEAD'))).toBe(false)
      expect((await repo.git(['log', '-1', '--format=%s'])).trim()).toBe('Main change')
    } finally {
      await application.close()
    }
  })

  it('aborts a stash pop from the changes list after saying how much is lost', async () => {
    const repo = await stashConflicted()
    const { application, page } = await launch(repo)
    try {
      // Resolve one of the two files; the other keeps the section in the list.
      await acceptYours(page, 'f.txt')
      await page.locator('[data-testid=conflicts-close]').click()
      await dialogClosed(page)

      // The Abort button in the changes list opens the dialog already asking.
      await page.locator('[data-testid=conflicts-abort]').click()
      await page.waitForSelector('[data-testid=abort-prompt]')
      expect(await page.locator('[data-testid=abort-prompt]').textContent()).toContain(
        '1 resolved file will be lost.'
      )
      await page.locator('[data-testid=abort-confirm]').click()
      await dialogClosed(page)

      expect(await notice(page)).toBe('Stash pop aborted.')
      expect(repo.read('f.txt')).toBe('current\n')
      expect(repo.read('g.txt')).toBe('current\n')
      expect((await repo.git(['stash', 'list'])).trim()).toContain('Stashed change')
      expect((await repo.git(['ls-files', '-u'])).trim()).toBe('')
    } finally {
      await application.close()
    }
  })

  it('drops the stash once the pop is fully resolved', async () => {
    const repo = await stashConflicted()
    const { application, page } = await launch(repo)
    try {
      for (const path of ['f.txt', 'g.txt']) {
        await row(page, path).locator('[data-testid=accept-theirs]').click()
        await waitFor(
          async () => (await row(page, path).getAttribute('data-resolved')) === 'true',
          `${path} to be resolved`
        )
      }
      await waitFor(
        async () => !(await page.locator('[data-testid=accept-finish]').isDisabled()),
        'Accept and finish to enable'
      )
      await page.locator('[data-testid=accept-finish]').click()
      await dialogClosed(page)

      expect(await notice(page)).toBe('Stash dropped.')
      expect(repo.read('f.txt')).toBe('stashed\n')
      expect(repo.read('g.txt')).toBe('stashed\n')
      expect((await repo.git(['stash', 'list'])).trim()).toBe('')
    } finally {
      await application.close()
    }
  })

  it('closes the dialog when the operation ends from a terminal', async () => {
    const repo = await rebaseConflicted()
    const { application, page } = await launch(repo)
    try {
      await runner.runOrThrow(['rebase', '--abort'], { cwd: repo.path })
      await dialogClosed(page)
      expect(await notice(page)).toBe('The operation finished outside Seam.')
      expect(existsSync(join(repo.path, '.git', 'rebase-merge'))).toBe(false)
    } finally {
      await application.close()
    }
  })
})
