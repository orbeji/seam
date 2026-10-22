// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ConflictCode,
  ConflictEntry,
  ConflictSide,
  ConflictSides,
  ConflictState,
  GitSide
} from '../../shared/git'
import { splitPath } from '../paths'

/** The sides whose conflict has a keep/delete answer instead of Yours/Theirs. */
const DELETION_CODES: ReadonlySet<ConflictCode> = new Set(['DU', 'UD', 'AU', 'UA', 'DD'])

/** The width of the resolved file's context menu, used to keep it in the window. */
const MENU_WIDTH = 230

/** The height of the resolved file's context menu, used to keep it in the window. */
const MENU_HEIGHT = 82

/** The prompt shown before overwriting a working copy that changed meanwhile. */
export interface ConflictOverwrite {
  readonly path: string
  readonly side: ConflictSide
}

/** Where the resolved file's context menu sits, and which file it belongs to. */
interface ContextMenu {
  readonly path: string
  readonly left: number
  readonly top: number
}

interface ConflictsDialogProps {
  /** The conflicts to show, or null while the main process is reading them. */
  readonly state: ConflictState | null
  /** Whether a write is in flight, so every button waits. */
  readonly busy: boolean
  readonly error: string | null
  readonly notice: string | null
  readonly overwrite: ConflictOverwrite | null
  readonly onAccept: (entry: ConflictEntry, side: ConflictSide) => void
  readonly onResolveSimple: () => void
  readonly onRevert: (entry: ConflictEntry) => void
  readonly onResolveManually: (entry: ConflictEntry) => void
  readonly onShowDiff: (entry: ConflictEntry) => void
  readonly onOverwrite: () => void
  readonly onCancelOverwrite: () => void
  readonly onClose: () => void
}

/** The Seam side that stands for one Git side, according to the operation. */
function seamSide(sides: ConflictSides, gitSide: GitSide): ConflictSide {
  return sides.yours === gitSide ? 'yours' : 'theirs'
}

/** The Git side that still has a file in a deletion conflict, or null for DD. */
function existingSide(entry: ConflictEntry): GitSide | null {
  if (entry.modes.index !== '000000') return 'ours'
  if (entry.modes.worktree !== '000000') return 'theirs'
  return null
}

/** The Git side without a file, which resolves the conflict by deleting it. */
function missingSide(entry: ConflictEntry): GitSide {
  return entry.modes.index === '000000' ? 'ours' : 'theirs'
}

/** Whether the bulk action has at least one text file with two sides to merge. */
function hasSimpleCandidates(state: ConflictState | null): boolean {
  if (state === null) return false
  return state.entries.some(
    (entry) =>
      !entry.resolved &&
      !entry.binary &&
      entry.modes.index !== '000000' &&
      entry.modes.worktree !== '000000'
  )
}

/** The sentence under the table, which explains what the selected file offers. */
function helpKey(entry: ConflictEntry): string {
  if (entry.resolved) return 'conflicts.help.resolved'
  if (entry.binary) return 'conflicts.help.binary'
  if (DELETION_CODES.has(entry.code)) return 'conflicts.help.deletion'
  return 'conflicts.help.unresolved'
}

/**
 * The conflicts list, laid out as the table in the screen designs: every
 * unmerged file with the actions that resolve it without opening the three-pane
 * editor, the files whose resolution can still be undone, the legend and the
 * bulk actions. Accept and Finish and Abort belong to the next phase, so they
 * stay disabled and say why.
 */
export default function ConflictsDialog({
  state,
  busy,
  error,
  notice,
  overwrite,
  onAccept,
  onResolveSimple,
  onRevert,
  onResolveManually,
  onShowDiff,
  onOverwrite,
  onCancelOverwrite,
  onClose
}: ConflictsDialogProps) {
  const { t } = useTranslation()
  const simple = hasSimpleCandidates(state)
  const entries = state?.entries ?? []
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const selected = entries.find((entry) => entry.path === selectedPath) ?? entries[0] ?? null
  const menuEntry =
    menu === null
      ? null
      : (entries.find((entry) => entry.path === menu.path && entry.resolved) ?? null)

  // A click outside the menu closes it, and so does Escape.
  useEffect(() => {
    if (menu === null) return
    const close = (event: MouseEvent): void => {
      if (
        event.target instanceof Element &&
        event.target.closest('.conflicts__menu-button') !== null
      ) {
        return
      }
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) {
        setMenu(null)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const resolved = entries.filter((entry) => entry.resolved).length
  const unresolved = entries.length - resolved

  /** Opens the resolved file's menu under its row, staying inside the window. */
  const toggleMenu = (event: ReactMouseEvent<HTMLButtonElement>, path: string): void => {
    if (menu?.path === path) {
      setMenu(null)
      return
    }
    const row = event.currentTarget.closest('.conflicts__row')
    const rect = row?.getBoundingClientRect()
    const left = Math.max(
      12,
      Math.min((rect?.left ?? 0) + 300, window.innerWidth - MENU_WIDTH - 12)
    )
    const top = Math.max(
      12,
      Math.min((rect?.bottom ?? 0) + 2, window.innerHeight - MENU_HEIGHT - 12)
    )
    setMenu({ path, left, top })
  }

  return (
    <div
      className="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflicts-title"
      data-testid="conflicts-dialog"
    >
      <div className="dialog__panel conflicts__panel">
        <header className="conflicts__header">
          <h2 className="conflicts__title" id="conflicts-title">
            {t('conflicts.title')}
          </h2>
          {state !== null && (
            <p className="conflicts__sides" data-testid="conflict-sides">
              {t('conflicts.sides', {
                yours: state.sides.yoursLabel,
                theirs: state.sides.theirsLabel
              })}
            </p>
          )}
        </header>

        {state === null ? (
          <p className="changes__none conflicts__loading">{t('conflicts.loading')}</p>
        ) : (
          <div className="conflicts__body">
            {overwrite !== null && (
              <div className="conflicts__overwrite" role="alert" data-testid="overwrite-prompt">
                <p className="conflicts__overwrite-title">{t('conflicts.overwriteTitle')}</p>
                <p className="dialog__explain">
                  {t('conflicts.overwriteExplain', { path: overwrite.path })}
                </p>
                <div className="dialog__actions">
                  <button
                    type="button"
                    className="conflicts__button conflicts__button--primary"
                    data-testid="overwrite-confirm"
                    disabled={busy}
                    onClick={onOverwrite}
                  >
                    {t('conflicts.overwrite')}
                  </button>
                  <button
                    type="button"
                    className="conflicts__button"
                    data-testid="overwrite-cancel"
                    disabled={busy}
                    onClick={onCancelOverwrite}
                  >
                    {t('conflicts.overwriteCancel')}
                  </button>
                </div>
              </div>
            )}

            {entries.length === 0 ? (
              <p className="changes__none conflicts__loading">{t('conflicts.noUnresolved')}</p>
            ) : (
              <div className="conflicts__table" role="table" aria-label={t('conflicts.title')}>
                <div className="conflicts__thead" role="row">
                  <span role="columnheader">{t('conflicts.columns.file')}</span>
                  <span role="columnheader">{t('conflicts.columns.kind')}</span>
                  <span role="columnheader">{t('conflicts.columns.status')}</span>
                  <span role="columnheader">{t('conflicts.columns.resolve')}</span>
                </div>

                <ul className="conflicts__list" role="rowgroup">
                  {entries.map((entry) => {
                    const deletion = DELETION_CODES.has(entry.code)
                    const existing = existingSide(entry)
                    const { name, dir } = splitPath(entry.path)
                    const isSelected = selected?.path === entry.path
                    const kind = t(`conflicts.kind.${entry.code}`)
                    return (
                      <li
                        className={`conflicts__row${isSelected ? ' conflicts__row--selected' : ''}`}
                        key={entry.path}
                        role="row"
                        aria-selected={isSelected}
                        data-testid="conflict-row"
                        data-path={entry.path}
                        data-resolved={entry.resolved ? 'true' : 'false'}
                        onClick={() => setSelectedPath(entry.path)}
                      >
                        <div className="conflicts__file" role="cell" title={entry.path}>
                          <span className="conflicts__name">{name}</span>
                          {dir !== '' && <span className="conflicts__dir">{dir}</span>}
                        </div>

                        <div className="conflicts__kind" role="cell">
                          <span>{kind}</span>
                          {entry.binary && (
                            <span className="conflicts__binary">{t('conflicts.binary')}</span>
                          )}
                        </div>

                        <div role="cell">
                          <span
                            className={
                              entry.resolved
                                ? 'conflicts__pill conflicts__pill--resolved'
                                : 'conflicts__pill conflicts__pill--unresolved'
                            }
                            data-testid="conflict-status"
                          >
                            {t(
                              entry.resolved
                                ? 'conflicts.status.resolved'
                                : 'conflicts.status.unresolved'
                            )}
                          </span>
                        </div>

                        <div className="conflicts__actions" role="cell">
                          {entry.resolved ? (
                            <>
                              <button
                                type="button"
                                className="conflicts__button conflicts__button--small"
                                data-testid="show-result"
                                onClick={() => onShowDiff(entry)}
                              >
                                {t('conflicts.showResult')}
                              </button>
                              <button
                                type="button"
                                className="conflicts__menu-button"
                                data-testid="conflict-menu"
                                aria-label={t('conflicts.moreActions')}
                                aria-haspopup="menu"
                                aria-expanded={menu?.path === entry.path}
                                title={t('conflicts.moreActions')}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setSelectedPath(entry.path)
                                  toggleMenu(event, entry.path)
                                }}
                              >
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 14 14"
                                  fill="currentColor"
                                  aria-hidden="true"
                                >
                                  <circle cx="3" cy="7" r="1.2" />
                                  <circle cx="7" cy="7" r="1.2" />
                                  <circle cx="11" cy="7" r="1.2" />
                                </svg>
                              </button>
                            </>
                          ) : deletion ? (
                            <>
                              {existing !== null && (
                                <button
                                  type="button"
                                  className="conflicts__button conflicts__button--small"
                                  data-testid="keep-file"
                                  disabled={busy}
                                  onClick={() => onAccept(entry, seamSide(state.sides, existing))}
                                >
                                  {t('conflicts.keep')}
                                </button>
                              )}
                              <button
                                type="button"
                                className="conflicts__button conflicts__button--small"
                                data-testid="delete-file"
                                disabled={busy}
                                onClick={() =>
                                  onAccept(entry, seamSide(state.sides, missingSide(entry)))
                                }
                              >
                                {t('conflicts.delete')}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="conflicts__button conflicts__button--small"
                                data-testid="accept-yours"
                                title={t('conflicts.acceptYoursFull', {
                                  label: state.sides.yoursLabel
                                })}
                                disabled={busy}
                                onClick={() => onAccept(entry, 'yours')}
                              >
                                {t('conflicts.acceptYours')}
                                <span className="sr-only">
                                  {t('conflicts.sideLabel', { label: state.sides.yoursLabel })}
                                </span>
                              </button>
                              <button
                                type="button"
                                className="conflicts__button conflicts__button--small"
                                data-testid="accept-theirs"
                                title={t('conflicts.acceptTheirsFull', {
                                  label: state.sides.theirsLabel
                                })}
                                disabled={busy}
                                onClick={() => onAccept(entry, 'theirs')}
                              >
                                {t('conflicts.acceptTheirs')}
                                <span className="sr-only">
                                  {t('conflicts.sideLabel', { label: state.sides.theirsLabel })}
                                </span>
                              </button>
                              {!entry.binary &&
                                entry.modes.index !== '000000' &&
                                entry.modes.worktree !== '000000' && (
                                  <button
                                    type="button"
                                    className="conflicts__button conflicts__button--small conflicts__button--primary"
                                    data-testid="resolve-manually"
                                    disabled={busy}
                                    title={t('conflicts.resolveManuallyHint')}
                                    onClick={() => onResolveManually(entry)}
                                  >
                                    {t('conflicts.resolveManually')}
                                  </button>
                                )}
                            </>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {selected !== null && (
              <div className="conflicts__info">
                <p className="conflicts__help" data-testid="conflicts-help">
                  {t(helpKey(selected), {
                    name: splitPath(selected.path).name,
                    kind: t(`conflicts.kind.${selected.code}`)
                  })}
                </p>
                <div className="conflicts__legend" data-testid="conflicts-legend">
                  <span>
                    <span className="conflicts__swatch conflicts__swatch--modified" />
                    {t('conflicts.legend.modified')}
                  </span>
                  <span>
                    <span className="conflicts__swatch conflicts__swatch--deleted" />
                    {t('conflicts.legend.deleted')}
                  </span>
                  <span>
                    <span className="conflicts__swatch conflicts__swatch--added" />
                    {t('conflicts.legend.added')}
                  </span>
                  <span>
                    <span className="conflicts__swatch conflicts__swatch--conflicting" />
                    {t('conflicts.legend.conflicting')}
                  </span>
                </div>
              </div>
            )}

            {error !== null && (
              <p
                className="dialog__error conflicts__message"
                role="alert"
                data-testid="conflicts-error"
              >
                {error}
              </p>
            )}
            {notice !== null && (
              <p className="conflicts__notice conflicts__message" data-testid="conflicts-notice">
                {notice}
              </p>
            )}
          </div>
        )}

        <footer className="conflicts__footer">
          <button
            type="button"
            className="conflicts__button conflicts__button--danger"
            data-testid="dialog-abort"
            disabled
            title={t('conflicts.laterPhase')}
          >
            {t('conflicts.abort')}
          </button>
          <button
            type="button"
            className="conflicts__button"
            data-testid="resolve-simple"
            disabled={busy || !simple}
            title={simple ? undefined : t('conflicts.nothingSimple')}
            onClick={onResolveSimple}
          >
            {t('conflicts.resolveSimple')}
          </button>
          <span className="conflicts__spacer" />
          {state !== null && (
            <span className="conflicts__summary" data-testid="conflicts-summary">
              {t('conflicts.summary', { unresolved, resolved })}
            </span>
          )}
          <button
            type="button"
            className="conflicts__button"
            data-testid="conflicts-close"
            onClick={onClose}
          >
            {t('conflicts.close')}
          </button>
          <button
            type="button"
            className="conflicts__button conflicts__button--primary"
            data-testid="accept-finish"
            disabled
            title={t('conflicts.laterPhase')}
          >
            {t('conflicts.acceptAndFinish')}
          </button>
        </footer>
      </div>

      {menu !== null && menuEntry !== null && (
        <div
          className="conflicts__menu"
          ref={menuRef}
          role="menu"
          aria-label={t('conflicts.menuLabel')}
          data-testid="conflict-menu-popup"
          style={{ left: menu.left, top: menu.top }}
        >
          <button
            type="button"
            role="menuitem"
            className="conflicts__menu-item"
            data-testid="show-diff"
            onClick={() => {
              setMenu(null)
              onShowDiff(menuEntry)
            }}
          >
            {t('conflicts.showDiff')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="conflicts__menu-item"
            data-testid="revert"
            disabled={busy}
            onClick={() => {
              setMenu(null)
              onRevert(menuEntry)
            }}
          >
            {t('conflicts.revert')}
          </button>
        </div>
      )}
    </div>
  )
}
