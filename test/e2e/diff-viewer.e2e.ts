// SPDX-License-Identifier: MIT

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createSampleRepositories } from '../fixtures/sample-repositories'

/**
 * The phase 1 end-to-end test: it opens files of the mixed repository in the
 * viewer and checks the two layouts, the difference count, the highlight and
 * whitespace modes, folding, navigation, languages, binaries and large files.
 */

const temporaries: string[] = []
let application: ElectronApplication
let page: Page
let userData: string

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'seam-e2e-diff-'))
  temporaries.push(base)
  const samples = await createSampleRepositories(base)

  userData = mkdtempSync(join(tmpdir(), 'seam-e2e-diff-user-'))
  temporaries.push(userData)

  application = await electron.launch({
    args: ['--no-sandbox', join(process.cwd(), 'out', 'main', 'index.js'), '--repo', samples.mixed],
    env: { ...process.env, SEAM_USER_DATA: userData, SEAM_HIDDEN_WINDOW: '1' } as Record<
      string,
      string
    >
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

const DIFF = '[data-testid=diff]'
const PANES = '[data-testid=diff-panes]'
/** What proves a file finished loading: an editor, a binary notice or an error. */
const LOADED = `${PANES} .cm-editor, [data-testid=diff-binary], [data-testid=diff-error]`

/** Polls a condition until it holds, so the test never races the renderer. */
async function waitFor(condition: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

async function editorCount(): Promise<number> {
  return page.locator(`${PANES} .cm-editor`).count()
}

async function waitForEditors(count: number): Promise<void> {
  await waitFor(async () => (await editorCount()) === count, `${count} editor(s)`)
}

async function openFile(name: string): Promise<void> {
  await page.locator('[data-testid=unstaged] [data-testid=entry]', { hasText: name }).click()
  await page.waitForSelector(DIFF)
  await waitFor(async () => (await page.locator(LOADED).count()) > 0, `${name} to finish loading`)
}

async function closeDiff(): Promise<void> {
  const close = page.locator('[data-testid=diff-close]')
  if ((await close.count()) > 0) await close.click()
  await page.waitForSelector('[data-testid=staged]')
}

/** Waits until a write has reached the settings file on disk. */
async function waitForSetting(key: string, expected: unknown): Promise<void> {
  await waitFor(
    async () => {
      try {
        const settings = JSON.parse(
          readFileSync(join(userData, 'settings.json'), 'utf8')
        ) as Record<string, unknown>
        return settings[key] === expected
      } catch {
        return false
      }
    },
    `${key} to be ${String(expected)}`
  )
}

/**
 * Changes one viewer option from the settings dialog. The viewer reads the
 * settings again after every write, so the caller still waits for the effect.
 */
async function setViewerSetting(id: string, value: string | boolean): Promise<void> {
  await page.locator('[data-testid=settings]').click()
  await page.waitForSelector('[data-testid=settings-dialog][data-ready=true]')
  const key = id.replace('settings-', '')
  if (typeof value === 'boolean') {
    const control = page.locator(`[data-testid=${id}]`)
    if ((await control.isChecked()) !== value) {
      await control.click()
      await waitFor(async () => (await control.isChecked()) === value, `${id} to be ${value}`)
    }
  } else {
    await page.selectOption(`[data-testid=${id}]`, value)
  }
  await waitForSetting(key, value)
  await page.locator('[data-testid=settings-close]').click()
  await page.waitForSelector('[data-testid=settings-dialog]', { state: 'detached' })
}

async function countText(): Promise<string> {
  return (await page.locator('[data-testid=diff-count]').textContent()) ?? ''
}

/** The total difference count, independent of the interface language. */
async function differenceCount(): Promise<number> {
  const matches = [...(await countText()).matchAll(/\d+/g)]
  const last = matches.at(-1)
  return last ? Number(last[0]) : Number.NaN
}

/** Inline changed-word marks, which the "none" highlight turns off. */
async function changedTextMarks(): Promise<number> {
  return page.locator(`${PANES} .cm-changedText`).count()
}

afterEach(async () => {
  await closeDiff()
})

describe('the diff viewer over the mixed repository', () => {
  it('opens in the unified view and hides the layout switch', async () => {
    await openFile('tracked.txt')
    await waitForEditors(1)
    expect(await page.locator('[data-testid=diff-layout-three]').count()).toBe(0)
    expect(await page.locator('.diff__layout-button').count()).toBe(0)

    // A working-tree change can be accepted or rejected in the unified view.
    await waitFor(
      async () => (await page.locator(`${PANES} .cm-chunkButtons button[name=accept]`).count()) > 0,
      'accept and reject controls'
    )
  })

  it('counts the changed ranges of a file', async () => {
    await openFile('tracked.txt')
    await setViewerSetting('settings-highlight', 'lines')
    await waitFor(async () => (await differenceCount()) === 1, 'one difference')
  })

  it('changes the highlight from the settings', async () => {
    await openFile('tracked.txt')
    await setViewerSetting('settings-highlight', 'words')
    await waitFor(async () => (await changedTextMarks()) > 0, 'inline changed words')

    // "None" drops the inline changed-word highlighting.
    await setViewerSetting('settings-highlight', 'none')
    await waitFor(async () => (await changedTextMarks()) === 0, 'no inline highlighting')
    await waitForEditors(1)

    await setViewerSetting('settings-highlight', 'words')
    await waitFor(async () => (await changedTextMarks()) > 0, 'inline changed words again')
  })

  it('ignores whitespace from the settings', async () => {
    await openFile('spaces.txt')
    await setViewerSetting('settings-highlight', 'lines')
    await waitFor(async () => (await differenceCount()) === 1, 'one difference')

    for (const mode of ['trim', 'ignore', 'ignore-and-blank']) {
      await setViewerSetting('settings-whitespace', mode)
      await waitFor(async () => (await differenceCount()) === 0, `no difference under ${mode}`)
    }

    await setViewerSetting('settings-whitespace', 'none')
    await waitFor(async () => (await differenceCount()) === 1, 'the original difference again')
  })

  it('folds unchanged blocks and expands them again', async () => {
    await openFile('context.txt')
    expect(await page.locator(`${PANES} .cm-collapsedLines`).count()).toBe(0)
    await setViewerSetting('settings-collapse', true)
    await waitFor(
      async () => (await page.locator(`${PANES} .cm-collapsedLines`).count()) > 0,
      'a folded block'
    )

    await setViewerSetting('settings-collapse', false)
    await waitFor(
      async () => (await page.locator(`${PANES} .cm-collapsedLines`).count()) === 0,
      'the folded block to expand'
    )
  })

  it('moves to the next file when navigation runs off the end', async () => {
    await openFile('tracked.txt')
    await setViewerSetting('settings-highlight', 'lines')

    // The first "next" reaches the only change; the second runs off the end.
    await page.click('[data-testid=diff-next]')
    await page.click('[data-testid=diff-next]')

    await waitFor(
      async () => (await page.locator('[data-testid=diff-path]').textContent()) === 'untracked.txt',
      'the viewer to move to untracked.txt'
    )
  })

  it('detects the language from the extension and from a shebang', async () => {
    await openFile('page.php')
    expect(await page.locator(DIFF).getAttribute('data-language')).toBe('php')

    await closeDiff()
    await openFile('tool')
    expect(await page.locator(DIFF).getAttribute('data-language')).toBe('python')
  })

  it('labels a binary file instead of diffing it', async () => {
    await openFile('binary.dat')
    await waitFor(
      async () => (await page.locator('[data-testid=diff-binary]').count()) > 0,
      'the binary notice'
    )
    expect(await editorCount()).toBe(0)
  })

  it('falls back to line-only highlighting for a large file', async () => {
    await openFile('large.txt')
    await waitFor(
      async () => (await page.locator('[data-testid=diff-large]').count()) > 0,
      'the large file notice'
    )
    // The viewer forces line granularity even when the setting asks for words.
    expect(await page.locator(DIFF).getAttribute('data-granularity')).toBe('lines')
  })
})
