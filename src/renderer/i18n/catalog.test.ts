// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import es from './locales/es.json'

type Catalog = Record<string, unknown>

function flattenKeys(catalog: Catalog, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return value !== null && typeof value === 'object'
      ? flattenKeys(value as Catalog, path)
      : [path]
  })
}

function resolve(catalog: Catalog, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node !== null && typeof node === 'object') {
      return (node as Catalog)[key]
    }
    return undefined
  }, catalog)
}

const catalogs: ReadonlyArray<[string, Catalog]> = [
  ['en', en],
  ['es', es]
]

describe('i18n catalogs', () => {
  it('define the same keys in every language', () => {
    const english = flattenKeys(en).sort()
    for (const [language, catalog] of catalogs) {
      expect.soft(flattenKeys(catalog).sort(), language).toEqual(english)
    }
  })

  it('hold a non-empty string for every key', () => {
    for (const [language, catalog] of catalogs) {
      for (const path of flattenKeys(catalog)) {
        const value = resolve(catalog, path)
        expect.soft(typeof value, `${language}:${path}`).toBe('string')
        expect.soft(String(value).trim(), `${language}:${path}`).not.toBe('')
      }
    }
  })
})
