// SPDX-License-Identifier: MIT

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication } from 'playwright-core'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { createSampleRepositories, type SampleRepositories } from '../fixtures/sample-repositories'

/**
 * Regenerates the screenshots the README links to. It is not part of the normal
 * suite: set `SEAM_SCREENSHOTS=1` after `npm run build` to run it.
 *
 *   SEAM_SCREENSHOTS=1 npx vitest run --config vitest.e2e.config.ts \
 *     test/e2e/screenshots.e2e.ts
 */

const enabled = process.env['SEAM_SCREENSHOTS'] === '1'
const suite = enabled ? describe : describe.skip
const output = join(process.cwd(), 'docs', 'screenshots')

const temporaries: string[] = []
let samples: SampleRepositories
let userData: string

async function launch(repo: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['--no-sandbox', join(process.cwd(), 'out', 'main', 'index.js'), '--repo', repo],
    env: { ...process.env, SEAM_USER_DATA: userData } as Record<string, string>
  })
}

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'seam-screenshots-'))
  temporaries.push(base)
  samples = await createSampleRepositories(base)
  userData = mkdtempSync(join(tmpdir(), 'seam-screenshots-user-'))
  temporaries.push(userData)
  // The README is in English, so the screenshots are too. A partial settings
  // file is enough: every missing field falls back to its default.
  writeFileSync(join(userData, 'settings.json'), '{"language":"en","theme":"dark"}\n')
  mkdirSync(output, { recursive: true })
}, 90_000)

afterAll(() => {
  while (temporaries.length > 0) {
    rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
  }
})

suite('README screenshots', () => {
  it('shows the changes list and the diff viewer', async () => {
    const application = await launch(samples.mixed)
    try {
      const page = await application.firstWindow()
      await page.waitForSelector('[data-testid=staged]')
      await page.screenshot({ path: join(output, 'changes.png') })

      await page
        .locator('[data-testid=unstaged] [data-testid=entry]')
        .filter({ hasText: 'tracked.txt' })
        .click()
      await page.waitForSelector('[data-testid=diff]')
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(output, 'diff.png') })
    } finally {
      await application.close()
    }
  }, 90_000)

  it('shows the conflict list and the three-pane editor', async () => {
    const application = await launch(samples.conflicts)
    try {
      const page = await application.firstWindow()
      // A repository that opens on conflicts shows the dialog by itself.
      await page.waitForSelector('[data-testid=conflicts-dialog]')
      await page.screenshot({ path: join(output, 'conflicts.png') })

      await page.locator('[data-testid=resolve-manually]').first().click()
      await page.waitForSelector('[data-testid=merge-editor]')
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(output, 'merge-editor.png') })
    } finally {
      await application.close()
    }
  }, 90_000)
})
