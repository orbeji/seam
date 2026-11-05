// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { repositoryName } from './repository-name'

interface RepositoryTabsProps {
  /** The repositories whose tabs are open, in the order they were opened. */
  readonly open: readonly string[]
  /** The repository whose tab is showing, or null when every tab is closed. */
  readonly active: string | null
  /** The repositories remembered across restarts, newest first. */
  readonly recent: readonly string[]
  /** The repositories whose tabs were closed during this session, newest first. */
  readonly closed: readonly string[]
  /** Switches to a tab without removing it. */
  readonly onActivate: (repo: string) => void
  /** Closes a tab; the repository stays in the reopen list. */
  readonly onClose: (repo: string) => void
  /** Opens a repository that is already on disk. */
  readonly onOpenExisting: () => void
  /** Opens the clone dialog. */
  readonly onClone: () => void
  /** Opens a repository from the reopen list. */
  readonly onRestore: (repo: string) => void
  /** Removes a repository from the remembered list. */
  readonly onRemoveRecent: (repo: string) => void
}

/**
 * The strip under the top bar: one tab per open repository, an arrow that
 * reopens a closed one, and a plus that adds a repository from disk or from a
 * URL. It replaces the old repository picker, so switching repositories never
 * hides the others behind a menu.
 */
export default function RepositoryTabs({
  open,
  active,
  recent,
  closed,
  onActivate,
  onClose,
  onOpenExisting,
  onClone,
  onRestore,
  onRemoveRecent
}: RepositoryTabsProps) {
  const { t } = useTranslation()
  const [addOpen, setAddOpen] = useState(false)
  const [reopenOpen, setReopenOpen] = useState(false)
  const addRef = useRef<HTMLDivElement | null>(null)
  const reopenRef = useRef<HTMLDivElement | null>(null)

  // A click outside either menu closes it, and so does Escape.
  useEffect(() => {
    if (!addOpen && !reopenOpen) return
    const close = (event: MouseEvent): void => {
      if (addRef.current !== null && !addRef.current.contains(event.target as Node)) {
        setAddOpen(false)
      }
      if (reopenRef.current !== null && !reopenRef.current.contains(event.target as Node)) {
        setReopenOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setAddOpen(false)
        setReopenOpen(false)
      }
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [addOpen, reopenOpen])

  const openSet = new Set(open)
  const closedAvailable = closed.filter((repo) => !openSet.has(repo))
  const recentAvailable = recent.filter(
    (repo) => !openSet.has(repo) && !closedAvailable.includes(repo)
  )
  const hasRestorable = closedAvailable.length > 0 || recentAvailable.length > 0

  const restore = (repo: string): void => {
    setReopenOpen(false)
    onRestore(repo)
  }

  return (
    <nav className="repobar" data-testid="repo-tabs" aria-label={t('repoTabs.label')}>
      <div className="repobar__brand">
        <svg
          className="repobar__logo"
          width="22"
          height="22"
          viewBox="0 0 22 22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <rect x="2.5" y="3.5" width="6" height="15" rx="1.5" />
          <rect x="13.5" y="3.5" width="6" height="15" rx="1.5" />
          <path d="M9.5 8h3M9.5 11h3M9.5 14h3" strokeDasharray="1 2.2" />
        </svg>
        <span>{t('app.name')}</span>
      </div>

      <div className="repobar__tabs" role="tablist">
        {open.map((repo) => {
          const name = repositoryName(repo)
          const selected = repo === active
          return (
            <div
              className={selected ? 'repobar__tab repobar__tab--active' : 'repobar__tab'}
              key={repo}
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                className="repobar__tab-button"
                data-testid="repo-tab"
                title={repo}
                onClick={() => onActivate(repo)}
              >
                <span className="repobar__tab-name">{name}</span>
              </button>
              <button
                type="button"
                className="repobar__tab-close"
                data-testid="repo-tab-close"
                aria-label={t('repoTabs.close', { repo: name })}
                title={t('repoTabs.close', { repo: name })}
                onClick={() => onClose(repo)}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M2 2l6 6M8 2l-6 6" />
                </svg>
              </button>
            </div>
          )
        })}
        {open.length === 0 && <span className="repobar__empty">{t('repoTabs.empty')}</span>}
      </div>

      <div className="repobar__actions">
        <div className="repobar__anchor" ref={reopenRef}>
          <button
            type="button"
            className="repobar__action"
            data-testid="repo-reopen"
            aria-haspopup="menu"
            aria-expanded={reopenOpen}
            aria-label={t('repoTabs.reopen')}
            title={t('repoTabs.reopen')}
            onClick={() => setReopenOpen((value) => !value)}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 3.5l3 3 3-3" />
            </svg>
          </button>

          {reopenOpen && (
            <div className="repobar__menu" role="menu" data-testid="repo-reopen-menu">
              {!hasRestorable && <p className="repobar__menu-title">{t('repoTabs.none')}</p>}

              {closedAvailable.length > 0 && (
                <>
                  <p className="repobar__menu-title">{t('repoTabs.closed')}</p>
                  {closedAvailable.map((repo) => (
                    <button
                      type="button"
                      role="menuitem"
                      className="repobar__menu-item"
                      data-testid="repo-reopen-item"
                      key={repo}
                      title={repo}
                      onClick={() => restore(repo)}
                    >
                      <span className="repobar__menu-name">{repositoryName(repo)}</span>
                      <span className="repobar__menu-path">{repo}</span>
                    </button>
                  ))}
                </>
              )}

              {recentAvailable.length > 0 && (
                <>
                  <p className="repobar__menu-title">{t('changes.recent')}</p>
                  {recentAvailable.map((repo) => (
                    <div className="repobar__menu-row" key={repo}>
                      <button
                        type="button"
                        role="menuitem"
                        className="repobar__menu-item repobar__menu-item--recent"
                        data-testid="repo-reopen-item"
                        title={repo}
                        onClick={() => restore(repo)}
                      >
                        <span className="repobar__menu-name">{repositoryName(repo)}</span>
                        <span className="repobar__menu-path">{repo}</span>
                      </button>
                      <button
                        type="button"
                        className="repobar__menu-remove"
                        data-testid="repo-recent-remove"
                        aria-label={t('topbar.repo.remove')}
                        title={t('topbar.repo.remove')}
                        onClick={(event) => {
                          event.stopPropagation()
                          onRemoveRecent(repo)
                        }}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <path d="M3.5 3.5l5 5M8.5 3.5l-5 5" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        <div className="repobar__anchor" ref={addRef}>
          <button
            type="button"
            className="repobar__action repobar__action--add"
            data-testid="repo-add"
            aria-haspopup="menu"
            aria-expanded={addOpen}
            aria-label={t('repoTabs.add')}
            title={t('repoTabs.add')}
            onClick={() => setAddOpen((value) => !value)}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 2v8M2 6h8" />
            </svg>
          </button>

          {addOpen && (
            <div
              className="repobar__menu repobar__menu--right"
              role="menu"
              data-testid="repo-add-menu"
            >
              <button
                type="button"
                role="menuitem"
                className="repobar__menu-item repobar__menu-item--action"
                data-testid="repo-open"
                onClick={() => {
                  setAddOpen(false)
                  onOpenExisting()
                }}
              >
                {t('changes.open')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="repobar__menu-item repobar__menu-item--action"
                data-testid="repo-clone"
                onClick={() => {
                  setAddOpen(false)
                  onClone()
                }}
              >
                {t('changes.clone')}
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
