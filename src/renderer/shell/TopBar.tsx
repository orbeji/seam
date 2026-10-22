// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** The repository folder's last segment, used as the picker's label. */
export function repositoryName(repo: string): string {
  const parts = repo.split(/[\\/]/).filter((part) => part !== '')
  return parts[parts.length - 1] ?? repo
}

interface TopBarProps {
  /** The open repository, or null before one is chosen. */
  readonly repo: string | null
  /** The branch to label, or null when there is nothing to show. */
  readonly branch: string | null
  /** The repositories to offer in the picker menu, newest first. */
  readonly recent: readonly string[]
  /** Whether there is a repository whose status can be read again. */
  readonly canRefresh: boolean
  readonly language: string
  readonly languages: readonly string[]
  readonly onChoose: () => void
  readonly onOpen: (repo: string) => void
  readonly onRefresh: () => void
  readonly onLanguageChange: (language: string) => void
}

/**
 * The 40px bar at the top of the window: the brand, the repository picker, the
 * current branch, refresh and the language. It is the only place a repository
 * is opened from, so the recent list lives in the picker's menu.
 */
export default function TopBar({
  repo,
  branch,
  recent,
  canRefresh,
  language,
  languages,
  onChoose,
  onOpen,
  onRefresh,
  onLanguageChange
}: TopBarProps) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // A click outside the picker closes its menu, and so does Escape.
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const pickerLabel = repo === null ? t('changes.open') : repositoryName(repo)

  return (
    <header className="topbar" data-testid="topbar">
      <div className="topbar__brand">
        <svg
          className="topbar__logo"
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

      <div className="topbar__picker" ref={menuRef}>
        <button
          type="button"
          className="topbar__repo"
          data-testid="repo-picker"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={repo ?? undefined}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="topbar__repo-name">{pickerLabel}</span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M2 3.5l3 3 3-3" />
          </svg>
        </button>

        {menuOpen && (
          <div className="topbar__menu" role="menu" data-testid="repo-menu">
            <button
              type="button"
              role="menuitem"
              className="topbar__menu-item"
              data-testid="repo-open"
              onClick={() => {
                setMenuOpen(false)
                onChoose()
              }}
            >
              {t('changes.open')}
            </button>

            {recent.length > 0 && <p className="topbar__menu-title">{t('changes.recent')}</p>}
            {recent.map((entry) => (
              <button
                type="button"
                role="menuitem"
                className="topbar__menu-item topbar__menu-item--recent"
                key={entry}
                title={entry}
                onClick={() => {
                  setMenuOpen(false)
                  onOpen(entry)
                }}
              >
                <span className="topbar__menu-name">{repositoryName(entry)}</span>
                <span className="topbar__menu-path">{entry}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {branch !== null && (
        <span className="topbar__branch" data-testid="branch-label" title={branch}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="4" cy="3" r="1.6" />
            <circle cx="4" cy="11" r="1.6" />
            <circle cx="10" cy="5" r="1.6" />
            <path d="M4 4.6v4.8M10 6.6c0 2-3 1.6-6 3" />
          </svg>
          <span className="topbar__branch-name">{branch}</span>
        </span>
      )}

      <div className="topbar__spacer" />

      <button
        type="button"
        className="icon-button"
        data-testid="refresh"
        aria-label={t('topbar.refresh')}
        title={t('topbar.refresh')}
        disabled={!canRefresh}
        onClick={onRefresh}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3" />
        </svg>
      </button>

      <label className="topbar__language">
        <span className="sr-only">{t('language.label')}</span>
        <select
          className="topbar__language-select"
          aria-label={t('language.label')}
          value={language}
          onChange={(event) => onLanguageChange(event.target.value)}
        >
          {languages.map((code) => (
            <option key={code} value={code}>
              {t(`language.names.${code}`)}
            </option>
          ))}
        </select>
      </label>
    </header>
  )
}
