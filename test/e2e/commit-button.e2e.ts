// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRepository, type SampleRepository } from '../fixtures/repository'
import { createSampleRepositories, type SampleRepositories } from '../fixtures/sample-repositories'

/**
 * The phase 4 activation rule: the commit button is enabled only when there is
 * something staged, or when Amend is checked. Unresolved conflicts disable it
 * with a reason, and an operation stopped halfway replaces it.
 */

const temporaries: string[] = []
let samples: SampleRepositories
let conflicted: SampleRepository
let userData: string
let application: ElectronApplication | null = null
let page: Page

/** Launches the application against a repository, replacing any running one. */
async function launch(repo: string): Promise<void> {
  if (application !== null) await application.close()
  application = await electron.launch({
    args: ['--no-sandbox', join(process.cwd(), 'out', 'main', 'index.js'), '--repo', repo],
    env: { ...process.env, SEAM_USER_DATA: userData } as Record<string, string>
  })
  page = await application.firstWindow()
  await page.waitForSelector('[data-testid=commit-message]')
}

/** Polls a condition until it holds, so the test never races the renderer. */
async function waitFor(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
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

function button(): Locator {
  return page.locator('[data-testid=commit-button]')
}

/** The reason shown next to the disabled button, or null when there is none. */
async function reason(): Promise<string | null> {
  const element = page.locator('[data-testid=commit-reason]')
  if ((await element.count()) === 0) return null
  return element.getAttribute('data-reason')
}

/** The operation that replaced the button, or null when the button is there. */
async function replacedBy(): Promise<string | null> {
  const element = page.locator('[data-testid=commit-blocked]')
  if ((await element.count()) === 0) return null
  return element.getAttribute('data-operation')
}

/**
 * A repository whose index holds unmerged entries but no operation marker:
 * `read-tree -m` merges three trees into the index without writing MERGE_HEAD,
 * so the conflict rule is reached without a stopped merge in front of it.
 */
async function conflictingIndex(): Promise<SampleRepository> {
  const repository = await createRepository()
  repository.write('f.txt', 'base\n')
  await repository.git(['add', 'f.txt'])
  await repository.git(['commit', '-qm', 'base'])
  const base = (await repository.git(['rev-parse', 'HEAD'])).trim()

  await repository.git(['checkout', '-q', '-b', 'side'])
  repository.write('f.txt', 'theirs\n')
  await repository.git(['commit', '-qam', 'side'])
  const theirs = (await repository.git(['rev-parse', 'HEAD'])).trim()

  await repository.git(['checkout', '-q', 'main'])
  repository.write('f.txt', 'ours\n')
  await repository.git(['commit', '-qam', 'main'])
  const ours = (await repository.git(['rev-parse', 'HEAD'])).trim()

  await repository.git(['read-tree', '-m', base, ours, theirs])
  return repository
}

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'seam-e2e-commit-'))
  temporaries.push(base)
  samples = await createSampleRepositories(base)
  userData = mkdtempSync(join(tmpdir(), 'seam-e2e-commit-user-'))
  temporaries.push(userData)
  conflicted = await conflictingIndex()
})

afterAll(async () => {
  await application?.close()
  conflicted.cleanup()
  while (temporaries.length > 0) rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
})

describe('the commit button', () => {
  it('is enabled with something staged, and with Amend, but not with nothing staged', async () => {
    await launch(samples.mixed)
    await waitFor(() => button().isEnabled(), 'the button to be enabled with staged files')

    // Emptying the staged list leaves nothing to confirm.
    await page.locator('[data-testid=staged-action]').click()
    await waitFor(async () => (await count('staged')) === 0, 'the staged list to empty')

    await waitFor(async () => !(await button().isEnabled()), 'the button to be disabled')
    await waitFor(async () => (await reason()) === 'nothing-staged', 'the nothing-staged reason')

    // Amend alone is enough: it rewrites the last commit's message.
    await page.locator('[data-testid=commit-amend]').check()
    await waitFor(() => button().isEnabled(), 'the button to be enabled by Amend')
  })

  it('is replaced while an operation is in progress', async () => {
    await launch(samples.conflicts)
    await waitFor(async () => (await replacedBy()) === 'merge', 'the merge note')
    expect(await button().count()).toBe(0)
  })

  it('is disabled while conflicts are unresolved', async () => {
    await launch(conflicted.path)
    await waitFor(async () => (await reason()) === 'conflicts', 'the conflicts reason')
    await waitFor(async () => !(await button().isEnabled()), 'the button to be disabled')
  })
})
