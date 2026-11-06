// SPDX-License-Identifier: MIT

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import en from '../src/renderer/i18n/locales/en.json'

/**
 * `catalog.test.ts` proves the three languages agree with each other. This test
 * proves that the keys the components ask for exist at all: a duplicated object
 * or a forgotten translation otherwise renders the raw key, and the catalogs
 * still agree with one another because the key is missing from all of them.
 */

type Catalog = Record<string, unknown>

function collectFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return collectFiles(path)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

function literalTranslationKeys(source: string): string[] {
  const keys: string[] = []
  // Only `t('key')` and `t("key")`; template literals are dynamic and are
  // covered by the catalogs' shape instead.
  const pattern = /\bt\(\s*(['"])([^'"]+)\1/g
  for (const match of source.matchAll(pattern)) {
    const key = match[2]
    if (key !== undefined) keys.push(key)
  }
  return keys
}

function resolve(catalog: Catalog, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node !== null && typeof node === 'object') return (node as Catalog)[key]
    return undefined
  }, catalog)
}

describe('translation usage', () => {
  it('only asks for keys the English catalog defines', () => {
    const source = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer')
    const keys = new Set(
      collectFiles(source).flatMap((file) => literalTranslationKeys(readFileSync(file, 'utf8')))
    )

    for (const key of keys) {
      const value = resolve(en as Catalog, key)
      if (typeof value === 'string') {
        expect.soft(value.trim(), key).not.toBe('')
        continue
      }

      // `t('history.count', { count })` resolves `history.count_one` or
      // `history.count_other`; the base key itself is deliberately absent.
      const one = resolve(en as Catalog, `${key}_one`)
      const other = resolve(en as Catalog, `${key}_other`)
      expect.soft(typeof one, `${key}_one`).toBe('string')
      expect.soft(typeof other, `${key}_other`).toBe('string')
    }
  })
})
