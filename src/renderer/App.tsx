// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChangeSummary } from '../shared/git'
import type { FileVersionSource, IpcErrorCode, RepositorySnapshot } from '../shared/ipc'
import ChangesView from './changes/ChangesView'
import CommitBox from './commit/CommitBox'
import DiffView from './diff/DiffView'
import { ERROR_KEYS } from './errors'
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

/**
 * Every file in a summary, in the order the screen shows them. Every staging
 * list opens the viewer the same way, against the working copy, so a file that
 * appears in two lists is listed once and navigation does not get stuck on it.
 */
export function summaryEntries(summary: ChangeSummary): Selection[] {
  const entries = [
    ...entriesOf(summary.staged, 'index', 'worktree'),
    ...entriesOf(summary.unstaged, 'index', 'worktree'),
    ...entriesOf(summary.untracked, 'index', 'worktree'),
    ...entriesOf(summary.conflicts, 'stage2', 'stage3')
  ]

  const seen = new Set<string>()
  return entries.filter((entry) => {
    const key = `${entry.path}\u0000${entry.from}\u0000${entry.to}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sameFile(a: Selection, b: Selection): boolean {
  return a.path === b.path && a.from === b.from && a.to === b.to
}

export default function App() {
  const { t, i18n } = useTranslation()
  const current: SupportedLanguage = (i18n.resolvedLanguage as SupportedLanguage) ?? 'en'
  const [view, setView] = useState<View>({ state: 'idle' })
  const [recent, setRecent] = useState<string[]>([])
  const [selected, setSelected] = useState<Selection | null>(null)
  // A failed stage or unstage, shown above the lists without hiding them.
  const [writeError, setWriteError] = useState<{
    code: IpcErrorCode
    message: string
  } | null>(null)
  // The unconfirmed commit message of the open repository. It is stored in the
  // application data folder as it is typed, so it survives a restart.
  const [commitMessage, setCommitMessage] = useState('')

  const open = useCallback(async (repo: string) => {
    setSelected(null)
    setWriteError(null)
    setCommitMessage('')
    setView({ state: 'loading' })
    const result = await window.seam.readRepositoryStatus(repo)
    if (result.ok) {
      setView({ state: 'ready', snapshot: result.value })
    } else {
      setView({ state: 'error', code: result.code, message: result.message })
    }
  }, [])

  const currentRepo = view.state === 'ready' ? view.snapshot.repo : null

  // The open repository, kept in a ref so the focus and change listeners can be
  // set up once and never resubscribe as the view changes.
  const repoRef = useRef<string | null>(null)
  useEffect(() => {
    repoRef.current = currentRepo
  }, [currentRepo])

  // Refill the box with the draft this repository had, so reopening Seam or
  // opening another repository shows what belongs to it, not to the last one.
  useEffect(() => {
    if (currentRepo === null) return
    let active = true
    void window.seam.readCommitDraft(currentRepo).then((result) => {
      if (active && result.ok) setCommitMessage(result.value)
    })
    return () => {
      active = false
    }
  }, [currentRepo])

  const refresh = useCallback(async () => {
    const repo = repoRef.current
    if (repo === null) return
    const result = await window.seam.readRepositoryStatus(repo)
    if (result.ok) {
      setView({ state: 'ready', snapshot: result.value })
    }
  }, [])

  useEffect(() => {
    void (async () => {
      setRecent(await window.seam.listRecentRepositories())
      const initial = await window.seam.initialRepository()
      if (initial) await open(initial)
    })()
  }, [open])

  useEffect(() => {
    // The working tree is not watched, so a change to a file on disk is picked
    // up when the window regains focus; the git folder is watched, so a change
    // there arrives as a `repositoryChanged` message.
    const handleFocus = () => void refresh()
    window.addEventListener('focus', handleFocus)
    const stopWatching = window.seam.onRepositoryChanged(() => void refresh())
    return () => {
      window.removeEventListener('focus', handleFocus)
      stopWatching()
    }
  }, [refresh])

  const choose = useCallback(async () => {
    const repo = await window.seam.chooseRepository()
    if (repo === null) return
    setRecent(await window.seam.listRecentRepositories())
    await open(repo)
  }, [open])

  // Stages or unstages the rows that asked for it, then rereads the repository.
  // The main process serialises the write, so a burst of clicks cannot race.
  const writeStaging = useCallback(
    async (paths: readonly string[], unstage: boolean) => {
      const repo = repoRef.current
      if (repo === null) return

      const result = unstage
        ? await window.seam.unstageFiles({ repo, paths })
        : await window.seam.stageFiles({ repo, paths })

      if (result.ok) {
        setWriteError(null)
        await refresh()
      } else {
        setWriteError({ code: result.code, message: result.message })
      }
    },
    [refresh]
  )

  // The box is stored as it is typed, one draft per repository. An empty
  // message clears the repository's draft in the main process.
  const writeMessage = useCallback((message: string) => {
    setCommitMessage(message)
    const repo = repoRef.current
    if (repo !== null) void window.seam.writeCommitDraft({ repo, message })
  }, [])

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

      {currentRepo !== null && <CommitBox value={commitMessage} onChange={writeMessage} />}

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
            {writeError !== null && (
              <div className="app__error app__error--inline" role="alert" data-testid="write-error">
                <p className="app__error-title">{t(ERROR_KEYS[writeError.code])}</p>
                <p className="app__error-detail">{writeError.message}</p>
              </div>
            )}
            {selected === null ? (
              <ChangesView
                summary={view.snapshot.summary}
                onOpen={(path, from, to) => setSelected({ path, from, to })}
                onStage={(paths) => void writeStaging(paths, false)}
                onUnstage={(paths) => void writeStaging(paths, true)}
              />
            ) : (
              <DiffView
                repo={view.snapshot.repo}
                path={selected.path}
                from={selected.from}
                to={selected.to}
                onClose={() => setSelected(null)}
                onEdge={(direction) => move(view.snapshot.summary, selected, direction)}
                onChanged={() => void refresh()}
              />
            )}
          </>
        )
    }
  }
}
