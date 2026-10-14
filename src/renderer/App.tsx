// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { IpcErrorCode, RepositorySnapshot } from '../shared/ipc'
import ChangesView from './changes/ChangesView'
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from './i18n'

type View =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; snapshot: RepositorySnapshot }
  | { state: 'error'; code: IpcErrorCode; message: string }

/** Translation key for each failure the main process can report. */
const ERROR_KEYS: Record<IpcErrorCode, string> = {
  'git-not-found': 'errors.gitNotFound',
  'git-too-old': 'errors.gitTooOld',
  'not-a-repository': 'errors.notARepository',
  'command-failed': 'errors.commandFailed',
  unknown: 'errors.unknown'
}

export default function App() {
  const { t, i18n } = useTranslation()
  const current: SupportedLanguage = (i18n.resolvedLanguage as SupportedLanguage) ?? 'en'
  const [view, setView] = useState<View>({ state: 'idle' })
  const [recent, setRecent] = useState<string[]>([])

  const open = useCallback(async (repo: string) => {
    setView({ state: 'loading' })
    const result = await window.seam.readRepositoryStatus(repo)
    if (result.ok) {
      setView({ state: 'ready', snapshot: result.value })
    } else {
      setView({ state: 'error', code: result.code, message: result.message })
    }
  }, [])

  useEffect(() => {
    void (async () => {
      setRecent(await window.seam.listRecentRepositories())
      const initial = await window.seam.initialRepository()
      if (initial) await open(initial)
    })()
  }, [open])

  const choose = useCallback(async () => {
    const repo = await window.seam.chooseRepository()
    if (repo === null) return
    setRecent(await window.seam.listRecentRepositories())
    await open(repo)
  }, [open])

  const currentRepo = view.state === 'ready' ? view.snapshot.repo : null

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">{t('app.name')}</h1>
        <p className="app__tagline">{t('app.tagline')}</p>
      </header>

      <div className="app__toolbar">
        <button type="button" className="button" onClick={() => void choose()}>
          {t('changes.open')}
        </button>
        {currentRepo !== null && <span className="app__repo">{currentRepo}</span>}
      </div>

      <main className="app__body">{renderBody()}</main>

      {recent.length > 0 && (
        <aside className="app__recent" aria-label={t('changes.recent')}>
          <h2 className="app__recent-title">{t('changes.recent')}</h2>
          <ul className="app__recent-list">
            {recent.map((repo) => (
              <li key={repo}>
                <button type="button" className="app__recent-item" onClick={() => void open(repo)}>
                  {repo}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}

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

  function renderBody() {
    switch (view.state) {
      case 'idle':
        return <p className="app__empty">{t('changes.empty')}</p>
      case 'loading':
        return <p className="app__empty">{t('changes.loading')}</p>
      case 'error':
        return (
          <div className="app__error" role="alert">
            <p className="app__error-title">{t(ERROR_KEYS[view.code])}</p>
            <p className="app__error-detail">{view.message}</p>
          </div>
        )
      case 'ready':
        return (
          <>
            {view.snapshot.operation !== null && (
              <p className="app__operation" data-testid="operation">
                {t(`changes.operation.${view.snapshot.operation}`)}
              </p>
            )}
            <ChangesView summary={view.snapshot.summary} />
          </>
        )
    }
  }
}
