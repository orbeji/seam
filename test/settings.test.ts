// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Settings } from '../src/main/session/settings'
import { DEFAULT_HISTORY_WIDTH, MAX_HISTORY_WIDTH, MIN_HISTORY_WIDTH } from '../src/shared/ipc'

const directories: string[] = []

function tempFile(name = 'settings.json'): string {
  const dir = mkdtempSync(join(tmpdir(), 'seam-settings-'))
  directories.push(dir)
  return join(dir, name)
}

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop() ?? '', { recursive: true, force: true })
})

describe('Settings', () => {
  it('runs hooks on a fresh install', () => {
    expect(new Settings(tempFile()).runHooks).toBe(true)
  })

  it('remembers when hooks are turned off', () => {
    const file = tempFile()
    const settings = new Settings(file)
    settings.setRunHooks(false)
    expect(settings.runHooks).toBe(false)
    expect(new Settings(file).runHooks).toBe(false)
  })

  it('turns hooks back on', () => {
    const file = tempFile()
    const settings = new Settings(file)
    settings.setRunHooks(false)
    settings.setRunHooks(true)
    expect(new Settings(file).runHooks).toBe(true)
  })

  it('starts from the defaults when the file holds unusable JSON', () => {
    const file = tempFile()
    writeFileSync(file, 'not json')
    expect(new Settings(file).runHooks).toBe(true)
  })

  it('ignores a field of the wrong type', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({ runHooks: 'yes' }))
    expect(new Settings(file).runHooks).toBe(true)
  })

  it('warns about CRLF on a fresh install', () => {
    expect(new Settings(tempFile()).crlfWarningFor('/repo')).toBe(true)
  })

  it('remembers a repository that was left out of the warning', () => {
    const file = tempFile()
    const settings = new Settings(file)
    settings.setCrlfWarningFor('/repo', false)

    expect(settings.crlfWarningFor('/repo')).toBe(false)
    expect(settings.crlfWarningFor('/other')).toBe(true)
    expect(new Settings(file).crlfWarningFor('/repo')).toBe(false)
  })

  it('turns the warning off everywhere, a repository answer still winning', () => {
    const file = tempFile()
    const settings = new Settings(file)
    settings.setCrlfWarningFor('/repo', true)
    settings.setCrlfWarning(false)

    expect(settings.crlfWarningFor('/repo')).toBe(true)
    expect(settings.crlfWarningFor('/other')).toBe(false)
    expect(new Settings(file).crlfWarningFor('/other')).toBe(false)
  })

  it('turns the warning back on everywhere', () => {
    const file = tempFile()
    const settings = new Settings(file)
    settings.setCrlfWarning(false)
    settings.setCrlfWarning(true)

    expect(new Settings(file).crlfWarningFor('/any')).toBe(true)
  })

  it('ignores a per-repository answer of the wrong type', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({ crlfWarningRepos: { '/repo': 'no', '/ok': false } }))
    const settings = new Settings(file)

    expect(settings.crlfWarningFor('/repo')).toBe(true)
    expect(settings.crlfWarningFor('/ok')).toBe(false)
  })

  it('starts the light syntax colours from its own palette', () => {
    expect(new Settings(tempFile()).read().syntaxTheme).toBe('seam')
  })

  it('remembers the syntax palette and falls back on a name it does not know', () => {
    const file = tempFile()
    const settings = new Settings(file)
    settings.update({ syntaxTheme: 'github' })

    expect(new Settings(file).read().syntaxTheme).toBe('github')

    writeFileSync(file, JSON.stringify({ syntaxTheme: 'neon' }))
    expect(new Settings(file).read().syntaxTheme).toBe('seam')
  })

  it('opens the history panel at its default width and remembers a dragged one', () => {
    const file = tempFile()
    expect(new Settings(file).read().historyWidth).toBe(DEFAULT_HISTORY_WIDTH)

    new Settings(file).update({ historyWidth: 420 })
    expect(new Settings(file).read().historyWidth).toBe(420)
  })

  it('keeps a stored history width inside the panel limits', () => {
    const tooNarrow = tempFile()
    writeFileSync(tooNarrow, JSON.stringify({ historyWidth: 10 }))
    const tooWide = tempFile()
    writeFileSync(tooWide, JSON.stringify({ historyWidth: 5000 }))
    const unusable = tempFile()
    writeFileSync(unusable, JSON.stringify({ historyWidth: 'wide' }))

    expect(new Settings(tooNarrow).read().historyWidth).toBe(MIN_HISTORY_WIDTH)
    expect(new Settings(tooWide).read().historyWidth).toBe(MAX_HISTORY_WIDTH)
    expect(new Settings(unusable).read().historyWidth).toBe(DEFAULT_HISTORY_WIDTH)
  })
})
