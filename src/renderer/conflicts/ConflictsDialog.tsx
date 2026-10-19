// SPDX-License-Identifier: MIT

import { useTranslation } from 'react-i18next'
import type {
  ConflictCode,
  ConflictEntry,
  ConflictSide,
  ConflictSides,
  ConflictState,
  GitSide
} from '../../shared/git'

/** The sides whose conflict has a keep/delete answer instead of Yours/Theirs. */
const DELETION_CODES: ReadonlySet<ConflictCode> = new Set(['DU', 'UD', 'AU', 'UA', 'DD'])

/** The prompt shown before overwriting a working copy that changed meanwhile. */
export interface ConflictOverwrite {
  readonly path: string
  readonly side: ConflictSide
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

/**
 * The conflicts list: every unmerged file with the actions that resolve it
 * without opening the three-pane editor, the files whose resolution can still
 * be undone, and the bulk actions. Accept and Finish and Abort belong to the
 * next phase, so they stay disabled and say why.
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
  onOverwrite,
  onCancelOverwrite,
  onClose
}: ConflictsDialogProps) {
  const { t } = useTranslation()
  const simple = hasSimpleCandidates(state)

  return (
    <div
      className="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflicts-title"
      data-testid="conflicts-dialog"
    >
      <div className="dialog__panel conflicts__panel">
        <h2 className="dialog__title" id="conflicts-title">
          {t('conflicts.title')}
        </h2>

        {state === null ? (
          <p className="changes__none">{t('conflicts.loading')}</p>
        ) : (
          <>
            <p className="conflicts__sides" data-testid="conflict-sides">
              {t('conflicts.sides', {
                yours: state.sides.yoursLabel,
                theirs: state.sides.theirsLabel
              })}
            </p>

            {overwrite !== null && (
              <div className="conflicts__overwrite" role="alert" data-testid="overwrite-prompt">
                <p className="conflicts__overwrite-title">{t('conflicts.overwriteTitle')}</p>
                <p className="dialog__explain">
                  {t('conflicts.overwriteExplain', { path: overwrite.path })}
                </p>
                <div className="dialog__actions">
                  <button
                    type="button"
                    className="button"
                    data-testid="overwrite-confirm"
                    disabled={busy}
                    onClick={onOverwrite}
                  >
                    {t('conflicts.overwrite')}
                  </button>
                  <button
                    type="button"
                    className="dialog__button"
                    data-testid="overwrite-cancel"
                    disabled={busy}
                    onClick={onCancelOverwrite}
                  >
                    {t('conflicts.overwriteCancel')}
                  </button>
                </div>
              </div>
            )}

            {state.entries.length === 0 ? (
              <p className="changes__none">{t('conflicts.noUnresolved')}</p>
            ) : (
              <ul className="conflicts__list">
                {state.entries.map((entry) => {
                  const deletion = DELETION_CODES.has(entry.code)
                  const existing = existingSide(entry)
                  return (
                    <li
                      className="conflicts__item"
                      key={entry.path}
                      data-testid="conflict-row"
                      data-path={entry.path}
                      data-resolved={entry.resolved ? 'true' : 'false'}
                    >
                      <div className="conflicts__row">
                        <span className="conflicts__path">{entry.path}</span>
                        <span className="conflicts__badge">
                          {t(`conflicts.kind.${entry.code}`)}
                        </span>
                        {entry.binary && (
                          <span className="conflicts__badge">{t('conflicts.binary')}</span>
                        )}
                        <span
                          className={
                            entry.resolved
                              ? 'conflicts__status conflicts__status--resolved'
                              : 'conflicts__status'
                          }
                        >
                          {t(
                            entry.resolved
                              ? 'conflicts.status.resolved'
                              : 'conflicts.status.unresolved'
                          )}
                        </span>
                      </div>

                      <div className="conflicts__actions">
                        {entry.resolved ? (
                          <button
                            type="button"
                            className="dialog__button"
                            data-testid="revert"
                            disabled={busy}
                            onClick={() => onRevert(entry)}
                          >
                            {t('conflicts.revert')}
                          </button>
                        ) : deletion ? (
                          <>
                            {existing !== null && (
                              <button
                                type="button"
                                className="button"
                                data-testid="keep-file"
                                disabled={busy}
                                onClick={() => onAccept(entry, seamSide(state.sides, existing))}
                              >
                                {t('conflicts.keep')}
                              </button>
                            )}
                            <button
                              type="button"
                              className="dialog__button"
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
                              className="button"
                              data-testid="accept-yours"
                              disabled={busy}
                              onClick={() => onAccept(entry, 'yours')}
                            >
                              {t('conflicts.acceptYours', { label: state.sides.yoursLabel })}
                            </button>
                            <button
                              type="button"
                              className="button"
                              data-testid="accept-theirs"
                              disabled={busy}
                              onClick={() => onAccept(entry, 'theirs')}
                            >
                              {t('conflicts.acceptTheirs', { label: state.sides.theirsLabel })}
                            </button>
                            {!entry.binary && (
                              <button
                                type="button"
                                className="dialog__button"
                                data-testid="resolve-manually"
                                disabled
                                title={t('conflicts.laterPhase')}
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
            )}
          </>
        )}

        {error !== null && (
          <p className="dialog__error" role="alert" data-testid="conflicts-error">
            {error}
          </p>
        )}
        {notice !== null && (
          <p className="conflicts__notice" data-testid="conflicts-notice">
            {notice}
          </p>
        )}

        <div className="conflicts__footer">
          <button
            type="button"
            className="button"
            data-testid="resolve-simple"
            disabled={busy || !simple}
            title={simple ? undefined : t('conflicts.nothingSimple')}
            onClick={onResolveSimple}
          >
            {t('conflicts.resolveSimple')}
          </button>
          <span className="conflicts__spacer" />
          <button
            type="button"
            className="dialog__button"
            data-testid="accept-finish"
            disabled
            title={t('conflicts.laterPhase')}
          >
            {t('conflicts.acceptAndFinish')}
          </button>
          <button
            type="button"
            className="dialog__button"
            data-testid="dialog-abort"
            disabled
            title={t('conflicts.laterPhase')}
          >
            {t('conflicts.abort')}
          </button>
          <button
            type="button"
            className="dialog__button"
            data-testid="conflicts-close"
            onClick={onClose}
          >
            {t('conflicts.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
