// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSampleRepositories, type SampleRepositories } from '../fixtures/sample-repositories'

/**
 * Launches the built application over the mixed sample repository and checks
 * that the window shows the four lists with the right files. It is the phase 0
 * smoke test: it proves the window, the preload bridge and the Git layer are
 * wired together, not just that each works alone.
 *
 * `--repo` opens the repository without driving the native folder picker, which
 * Playwright cannot reach.
 */

const temporaries: string[] = []
let application: ElectronApplication
let page: Page
let samples: SampleRepositories

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'seam-e2e-'))
  temporaries.push(base)
  samples = await createSampleRepositories(base)

  const userData = mkdtempSync(join(tmpdir(), 'seam-e2e-user-'))
  temporaries.push(userData)

  application = await electron.launch({
    args: ['--no-sandbox', join(process.cwd(), 'out', 'main', 'index.js'), '--repo', samples.mixed],
    env: { ...process.env, SEAM_USER_DATA: userData } as Record<string, string>
  })
  page = await application.firstWindow()
  await page.waitForSelector('[data-testid=staged]')
})

afterAll(async () => {
  await application?.close()
  while (temporaries.length > 0) {
    rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
  }
})

async function entries(section: string): Promise<string[]> {
  return page.locator(`[data-testid=${section}] [data-testid=entry]`).allTextContents()
}

describe('the window over the mixed repository', () => {
  it('lists the staged files', async () => {
    const staged = await entries('staged')
    expect(staged).toHaveLength(4)
    expect(staged.join(' ')).toContain('staged.txt')
    expect(staged.join(' ')).toContain('renamed-away.txt')
    expect(staged.join(' ')).toContain('run.sh')
  })

  it('lists the unstaged files', async () => {
    const unstaged = await entries('unstaged')
    expect(unstaged).toHaveLength(8)
    expect(unstaged.join(' ')).toContain('tracked.txt')
    expect(unstaged.join(' ')).toContain('binary.dat')
    expect(unstaged.join(' ')).toContain('café con leche.txt')
    expect(unstaged.join(' ')).toContain('page.php')
    expect(unstaged.join(' ')).toContain('tool')
    expect(unstaged.join(' ')).toContain('spaces.txt')
    expect(unstaged.join(' ')).toContain('context.txt')
    expect(unstaged.join(' ')).toContain('large.txt')
  })

  it('lists the untracked files', async () => {
    const untracked = await entries('untracked')
    expect(untracked).toHaveLength(1)
    expect(untracked.join(' ')).toContain('untracked.txt')
  })

  it('shows no merge conflicts in a repository without one', async () => {
    expect(await entries('conflicts')).toHaveLength(0)
  })
})
