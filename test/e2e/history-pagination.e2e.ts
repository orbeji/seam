// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitRunner } from '../../src/core/git'
import { HISTORY_PAGE_SIZE } from '../../src/shared/git'
import { createRepository, type SampleRepository } from '../fixtures/repository'

/**
 * The history reads its first page at once and keeps reading pages as the list
 * reaches its end, so a repository with more commits than one page stays
 * browsable without loading everything up front.
 */

const PAGE_SIZE = HISTORY_PAGE_SIZE
const COMMIT_COUNT = HISTORY_PAGE_SIZE + 5

let application: ElectronApplication
let page: Page
let repo: SampleRepository
let userData: string

/**
 * Seeds a linear history with `count` commits in one fast-import run, so the
 * test does not pay for hundreds of `git commit` processes.
 */
async function seedCommits(repository: SampleRepository, count: number): Promise<void> {
  const lines: string[] = []
  let timestamp = 1_600_000_000
  for (let index = 1; index <= count; index += 1) {
    const message = `Commit ${index}`
    lines.push('commit refs/heads/main')
    lines.push(`mark :${index}`)
    lines.push(`committer Seam <seam@example.com> ${timestamp} +0000`)
    lines.push(`data ${Buffer.byteLength(message)}`)
    lines.push(message)
    if (index > 1) lines.push(`from :${index - 1}`)
    lines.push('')
    timestamp += 1
  }
  await new GitRunner().runOrThrow(['fast-import', '--quiet'], {
    cwd: repository.path,
    stdin: `${lines.join('\n')}\n`
  })
}

beforeAll(async () => {
  repo = await createRepository()
  await seedCommits(repo, COMMIT_COUNT)

  userData = mkdtempSync(join(tmpdir(), 'seam-e2e-pages-'))
  application = await electron.launch({
    args: ['--no-sandbox', join(process.cwd(), 'out', 'main', 'index.js'), '--repo', repo.path],
    env: { ...process.env, SEAM_USER_DATA: userData, SEAM_HIDDEN_WINDOW: '1' } as Record<
      string,
      string
    >
  })
  page = await application.firstWindow()
  await page.waitForSelector('[data-testid=history-commit]')
})

afterAll(async () => {
  await application?.close()
  repo?.cleanup()
  if (userData !== undefined) rmSync(userData, { recursive: true, force: true })
})

describe('the paged commit history', () => {
  it('reads the first page and the next one at the end of the list', async () => {
    const rows = page.locator('[data-testid=history-commit]')
    const note = page.locator('[data-testid=history-truncated]')

    // The newest commit comes first, and the list stops at one page even
    // though Git holds five more commits.
    await expect.poll(() => rows.count()).toBe(PAGE_SIZE)
    expect(await rows.first().innerText()).toContain(`Commit ${COMMIT_COUNT}`)
    expect(await note.innerText()).toContain(String(PAGE_SIZE))

    // Reaching the end reads the next page and appends it, so the graph keeps
    // its order and the list now covers every commit.
    await page.locator('.history__sidebar-scroll').evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect.poll(() => rows.count(), { timeout: 30_000 }).toBe(COMMIT_COUNT)
    expect(await note.count()).toBe(0)
    expect(await rows.last().innerText()).toContain('Commit 1')
  })
})
