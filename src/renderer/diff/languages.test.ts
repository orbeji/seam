// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { detectLanguageId, loadLanguage } from './languages'

describe('detectLanguageId', () => {
  it('matches a language by extension', () => {
    expect(detectLanguageId('page.php', '')).toBe('php')
    expect(detectLanguageId('src/File.java', '')).toBe('java')
    expect(detectLanguageId('styles.scss', '')).toBe('css')
    expect(detectLanguageId('view.tsx', '')).toBe('tsx')
    expect(detectLanguageId('data.json', '')).toBe('json')
  })

  it('matches by name', () => {
    expect(detectLanguageId('Dockerfile', '')).toBeNull()
    expect(detectLanguageId('main.rs', '')).toBe('rust')
  })

  it('falls back to a shebang when there is no extension', () => {
    expect(detectLanguageId('script', '#!/usr/bin/env node')).toBe('javascript')
    expect(detectLanguageId('script', '#!/bin/bash')).toBe('shell')
    expect(detectLanguageId('script', '#!/usr/bin/python3')).toBe('python')
  })

  it('prefers the extension over the shebang', () => {
    expect(detectLanguageId('run.sh', '#!/bin/sh')).toBe('shell')
  })

  it('returns null when nothing matches', () => {
    expect(detectLanguageId('mystery.xyz', 'plain text, no shebang')).toBeNull()
  })
})

describe('loadLanguage', () => {
  it('loads a grammar for a known language and nothing for an unknown one', async () => {
    const support = await loadLanguage('json')
    expect(support).not.toBeNull()
    expect(await loadLanguage(null)).toBeNull()
    expect(await loadLanguage('not-a-language')).toBeNull()
  })
})
