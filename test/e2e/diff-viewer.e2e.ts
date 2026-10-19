// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
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

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'seam-e2e-diff-'))
  temporaries.push(base)
  const samples = await createSampleRepositories(base)

  const userData = mkdtempSync(join(tmpdir(), 'seam-e2e-diff-user-'))
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

async function countText(): Promise<string> {
  return (await page.locator('[data-testid=diff-count]').textContent()) ?? ''
}

/** The difference count, independent of the interface language. */
async function differenceCount(): Promise<number> {
  const match = /\d+/.exec(await countText())
  return match ? Number(match[0]) : Number.NaN
}

/** Inline changed-word marks, which the "none" highlight turns off. */
async function changedTextMarks(): Promise<number> {
  return page.locator(`${PANES} .cm-changedText`).count()
}

afterEach(async () => {
  await closeDiff()
})

describe('the diff viewer over the mixed repository', () => {
  it('shows side by side with two editors and unified with one', async () => {
    await openFile('tracked.txt')
    await waitForEditors(2)

    await page.selectOption('[data-testid=diff-layout]', 'unified')
    await waitForEditors(1)

    await page.selectOption('[data-testid=diff-layout]', 'side-by-side')
    await waitForEditors(2)
  })

  it('counts the changed ranges of a file', async () => {
    await openFile('tracked.txt')
    await page.selectOption('[data-testid=diff-granularity]', 'lines')
    await waitFor(async () => (await differenceCount()) === 1, 'one difference')
  })

  it('changes the highlight from the toolbar', async () => {
    await openFile('tracked.txt')
    for (const granularity of ['words', 'lines', 'split', 'characters', 'none']) {
      await page.selectOption('[data-testid=diff-granularity]', granularity)
      await waitForEditors(2)
    }

    await page.selectOption('[data-testid=diff-granularity]', 'words')
    await waitFor(async () => (await changedTextMarks()) > 0, 'inline changed words')

    // "None" drops the inline changed-word highlighting.
    await page.selectOption('[data-testid=diff-granularity]', 'none')
    await waitFor(async () => (await changedTextMarks()) === 0, 'no inline highlighting')
  })

  it('ignores whitespace from the toolbar', async () => {
    await openFile('spaces.txt')
    await page.selectOption('[data-testid=diff-granularity]', 'lines')
    await waitFor(async () => (await differenceCount()) === 1, 'one difference')

    for (const mode of ['trim', 'ignore', 'ignore-and-blank']) {
      await page.selectOption('[data-testid=diff-whitespace]', mode)
      await waitFor(async () => (await differenceCount()) === 0, `no difference under ${mode}`)
    }
  })

  it('folds unchanged blocks and expands them again', async () => {
    await openFile('context.txt')
    await page.check('[data-testid=diff-collapse]')
    await waitFor(
      async () => (await page.locator(`${PANES} .cm-collapsedLines`).count()) > 0,
      'a folded block'
    )

    await page.uncheck('[data-testid=diff-collapse]')
    await waitFor(
      async () => (await page.locator(`${PANES} .cm-collapsedLines`).count()) === 0,
      'the folded block to expand'
    )
  })

  it('moves to the next file when navigation runs off the end', async () => {
    await openFile('tracked.txt')
    await page.selectOption('[data-testid=diff-granularity]', 'lines')

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
    expect(await page.locator('[data-testid=diff-granularity]').isDisabled()).toBe(true)
  })
})
