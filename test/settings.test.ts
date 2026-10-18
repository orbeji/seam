// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Settings } from '../src/main/session/settings'

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
})
