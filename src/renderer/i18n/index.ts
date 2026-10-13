// SPDX-License-Identifier: MIT

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import es from './locales/es.json'

/** Languages the interface ships with. Adding one is adding a catalog file. */
export const SUPPORTED_LANGUAGES = ['en', 'es'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]
export const FALLBACK_LANGUAGE: SupportedLanguage = 'en'

const catalogs: Record<SupportedLanguage, typeof en> = { en, es }

function isSupported(candidate: string): candidate is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(candidate)
}

/**
 * Picks the interface language from the system locales, falling back to
 * English. A regional locale such as `es-ES` or `es-419` maps to `es`.
 */
export function detectLanguage(
  locales: readonly string[] = typeof navigator === 'undefined'
    ? []
    : [navigator.language, ...navigator.languages]
): SupportedLanguage {
  for (const locale of locales) {
    const base = locale.toLowerCase().split('-')[0] ?? ''
    if (isSupported(base)) {
      return base
    }
  }
  return FALLBACK_LANGUAGE
}

void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(
    SUPPORTED_LANGUAGES.map((language) => [language, { translation: catalogs[language] }])
  ),
  lng: detectLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  interpolation: { escapeValue: false }
})

export default i18n