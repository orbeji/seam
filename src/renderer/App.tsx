// SPDX-License-Identifier: MIT

import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from './i18n'

export default function App() {
  const { t, i18n } = useTranslation()
  const current: SupportedLanguage = (i18n.resolvedLanguage as SupportedLanguage) ?? 'en'

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">{t('app.name')}</h1>
        <p className="app__tagline">{t('app.tagline')}</p>
      </header>

      <main className="app__body">
        <p className="app__empty">{t('changes.empty')}</p>
      </main>

      <footer className="app__footer">
        <label className="language__label" htmlFor="language">
          {t('language.label')}
        </label>
        <select
          id="language"
          className="language__select"
          value={current}
          onChange={(event) => void i18n.changeLanguage(event.target.value)}
        >
          {SUPPORTED_LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {t(`language.names.${language}`)}
            </option>
          ))}
        </select>
      </footer>
    </div>
  )
}
