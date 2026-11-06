// SPDX-License-Identifier: MIT

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSampleRepositories, type SampleRepositories } from '../fixtures/sample-repositories'

/**
 * The installer smoke test. Unlike `window.smoke.e2e.ts`, which launches the
 * compiled `out/main/index.js`, this one launches a packaged executable: the
 * unpacked folder `electron-builder --dir` leaves in `release/`, an installed
 * `.deb`, or an installed NSIS build. The release workflow sets
 * `SEAM_EXECUTABLE` to the path the installer produced.
 *
 * It proves the asar, the bundled preload and the renderer assets still work
 * outside the development tree, and that a packaged Seam can open a real
 * repository passed with `--repo`.
 */

/** Finds the executable to smoke-test, or null when the suite should skip. */
function resolveExecutable(): string | null {
  const fromEnvironment = process.env['SEAM_EXECUTABLE']
  if (fromEnvironment !== undefined && fromEnvironment !== '') {
    return existsSync(fromEnvironment) ? fromEnvironment : null
  }

  const candidates =
    process.platform === 'win32'
      ? [join(process.cwd(), 'release', 'win-unpacked', 'seam.exe')]
      : [join(process.cwd(), 'release', 'linux-unpacked', 'seam')]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

const executable = resolveExecutable()
const packaged = executable === null ? describe.skip : describe

const temporaries: string[] = []
let application: ElectronApplication
let page: Page
let samples: SampleRepositories

packaged('the packaged application', () => {
  beforeAll(async () => {
    const base = mkdtempSync(join(tmpdir(), 'seam-packaged-'))
    temporaries.push(base)
    samples = await createSampleRepositories(base)

    const userData = mkdtempSync(join(tmpdir(), 'seam-packaged-user-'))
    temporaries.push(userData)

    application = await electron.launch({
      ...(executable === null ? {} : { executablePath: executable }),
      args: ['--no-sandbox', '--repo', samples.mixed],
      env: { ...process.env, SEAM_USER_DATA: userData, SEAM_HIDDEN_WINDOW: '1' } as Record<
        string,
        string
      >
    })
    page = await application.firstWindow()
    await page.waitForSelector('[data-testid=staged]', { timeout: 60_000 })
  }, 90_000)

  afterAll(async () => {
    await application?.close()
    while (temporaries.length > 0) {
      rmSync(temporaries.pop() ?? '', { recursive: true, force: true })
    }
  })

  it('opens the window over a repository', async () => {
    expect(await page.title()).toBe('Seam')
  })

  it('lists the prepared files of the sample repository', async () => {
    const staged = await page.locator('[data-testid=staged] [data-testid=entry]').allTextContents()
    expect(staged).toHaveLength(4)
    expect(staged.join(' ')).toContain('staged.txt')
  })

  it('opens exactly one window', async () => {
    expect(application.windows()).toHaveLength(1)
  })
})
