// SPDX-License-Identifier: MIT

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { createSampleRepositories, type SampleRepositories } from '../fixtures/sample-repositories'

/**
 * The same dialog after a rebase, a cherry-pick and a stash pop. Each operation
 * names its two sides differently, and in a rebase Yours is the commit being
 * replayed (Git's `theirs`), not the new base. One app is launched per
 * repository, because the repository is chosen on the command line.
 */

const WAIT_MS = 15_000
const temporaries: string[] = []

afterAll(() => {
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

interface Case {
  readonly name: string
  readonly repository: keyof SampleRepositories
  readonly yours: string
  readonly theirs: string
  readonly accepted: string
}

const cases: readonly Case[] = [
  {
    name: 'rebase',
    repository: 'rebase',
    yours: 'Side change',
    theirs: 'main',
    accepted: 'side\n'
  },
  {
    name: 'cherry-pick',
    repository: 'cherryPick',
    yours: 'main',
    theirs: 'Side change',
    accepted: 'main\n'
  },
  {
    name: 'stash',
    repository: 'stash',
    yours: 'main',
    theirs: 'stash',
    accepted: 'current\n'
  }
]

describe('conflict sides per operation', () => {
  it.each(cases)('$name names its sides and accepts Yours', async (testCase) => {
    const base = mkdtempSync(join(tmpdir(), `seam-e2e-${testCase.name}-`))
    const userData = mkdtempSync(join(tmpdir(), `seam-e2e-${testCase.name}-user-`))
    temporaries.push(base, userData)
    const samples = await createSampleRepositories(base)
    const repository = samples[testCase.repository]

    let application: ElectronApplication | null = null
    try {
      application = await electron.launch({
        args: [
          '--no-sandbox',
          '--lang=en-US',
          join(process.cwd(), 'out', 'main', 'index.js'),
          '--repo',
          repository
        ],
        env: { ...process.env, SEAM_USER_DATA: userData, SEAM_HIDDEN_WINDOW: '1' } as Record<
          string,
          string
        >
      })
      const page: Page = await application.firstWindow()
      await page.waitForSelector('[data-testid=conflicts-dialog]', { timeout: WAIT_MS })

      const sides = await page.locator('[data-testid=conflict-sides]').textContent()
      const match = /Yours: (.*) · Theirs: (.*)$/.exec(sides ?? '')
      expect(match?.[1]).toContain(testCase.yours)
      expect(match?.[2]).toContain(testCase.theirs)

      const row = page.locator('[data-testid=conflict-row][data-path="f.txt"]')
      await row.locator('[data-testid=accept-yours]').click()
      await waitFor(
        async () => (await row.getAttribute('data-resolved')) === 'true',
        'the conflict to resolve'
      )
      expect(readFileSync(join(repository, 'f.txt'), 'utf8')).toBe(testCase.accepted)
    } finally {
      await application?.close()
    }
  })
})
