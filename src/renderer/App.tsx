// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChangeSummary } from '../shared/git'
import type { FileVersionSource, IpcErrorCode, RepositorySnapshot } from '../shared/ipc'
import ChangesView from './changes/ChangesView'
import DiffView from './diff/DiffView'
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from './i18n'

type View =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; snapshot: RepositorySnapshot }
  | { state: 'error'; code: IpcErrorCode; message: string }

/** The file the viewer shows and the two versions it compares. */
interface Selection {
  path: string
  from: FileVersionSource
  to: FileVersionSource
}

/** The files a section shows, paired with the versions their rows compare. */
function entriesOf(
  entries: ChangeSummary['staged'],
  from: FileVersionSource,
  to: FileVersionSource
): Selection[] {
  return entries.map((entry) => ({ path: entry.path, from, to }))
}

/** Every file in a summary, in the order the screen shows them. */
export function summaryEntries(summary: ChangeSummary): Selection[] {
  return [
    ...entriesOf(summary.staged, 'head', 'index'),
    ...entriesOf(summary.unstaged, 'index', 'worktree'),
    ...entriesOf(summary.untracked, 'head', 'worktree'),
    ...entriesOf(summary.conflicts, 'stage2', 'stage3')
  ]
}

function sameFile(a: Selection, b: Selection): boolean {
  return a.path === b.path && a.from === b.from && a.to === b.to
}

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
  const [selected, setSelected] = useState<Selection | null>(null)

  const open = useCallback(async (repo: string) => {
    setSelected(null)
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

  /** Opens a file, and on navigation past either end moves to the neighbouring file. */
  const move = (summary: ChangeSummary, current: Selection, direction: 1 | -1): void => {
    const files = summaryEntries(summary)
    const index = files.findIndex((file) => sameFile(file, current))
    const next = index === -1 ? undefined : files[index + direction]
    if (next !== undefined) setSelected(next)
  }

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
            {selected === null ? (
              <ChangesView
                summary={view.snapshot.summary}
                onOpen={(path, from, to) => setSelected({ path, from, to })}
              />
            ) : (
              <DiffView
                repo={view.snapshot.repo}
                path={selected.path}
                from={selected.from}
                to={selected.to}
                onClose={() => setSelected(null)}
                onEdge={(direction) => move(view.snapshot.summary, selected, direction)}
              />
            )}
          </>
        )
    }
  }
}
