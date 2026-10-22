// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { IpcErrorCode } from '../../shared/ipc'
import { ERROR_KEYS } from '../errors'
import { splitPath } from '../paths'
import {
  buildThreePane,
  editLine,
  middleText,
  takeAll,
  takeHunk,
  takeLine,
  type ThreeMiddle,
  type ThreePaneState,
  type ThreeRow
} from './three-pane'

/**
 * The three-pane staging view: HEAD on the left, the editable index in the
 * centre and the working copy on the right, aligned line by line. The arrows
 * take a line or a whole change from a side into the centre; nothing is written
 * until Done stores the centre as the index's version. Close leaves the index
 * alone and returns to the two-pane viewer.
 *
 * The three versions are read in one call, the same staging model the margin
 * markers use, so the two views can never disagree about what is prepared.
 */
interface ThreePaneViewProps {
  readonly repo: string
  readonly path: string
  /** The language the viewer detected for the file, shown in the status bar. */
  readonly language?: string | null
  /** Called after Done wrote the index, so the caller can refresh the lists. */
  readonly onChanged?: () => void
  /** Called to leave the three-pane view, whether it wrote or was closed. */
  readonly onExit: () => void
}

interface Loaded {
  readonly key: string
  readonly state: ThreePaneState | null
  readonly error: string | null
  readonly binary: boolean
}

type Tone = 'add' | 'mod' | 'del'

// The arrow glyphs, kept out of the JSX so the translated text stays the only
// literal the interface shows. A single angle takes one line, a double one the
// whole change.
const TAKE_LINE = { head: '\u203a', worktree: '\u2039' } as const
const TAKE_HUNK = { head: '\u00bb', worktree: '\u00ab' } as const

/** The colour of a HEAD line: removed from the index, or rewritten by it. */
function headTone(row: ThreeRow): Tone | null {
  if (!row.staged || row.headText === null) return null
  return row.indexText === null ? 'del' : 'mod'
}

/** The colour of the centre line: new against HEAD, or rewritten by it. */
function indexTone(row: ThreeRow, middle: ThreeMiddle): Tone | null {
  if (!row.staged || !middle.present) return null
  return row.headText === null ? 'add' : 'mod'
}

/** The colour of a working-copy line: new against HEAD, or rewritten by it. */
function worktreeTone(row: ThreeRow): Tone | null {
  if (row.worktreeText === null || (!row.staged && !row.unstaged)) return null
  return row.headText === null ? 'add' : 'mod'
}

function toneClass(tone: Tone | null): string {
  return tone === null ? '' : ` three__cell--${tone}`
}

/**
 * For every row, the number of rows in the change run it starts, or null when
 * the row does not start one. A run of one is a single changed line; a longer
 * one is a change the hunk arrow takes whole.
 */
function runStarts(rows: readonly ThreeRow[], flag: 'staged' | 'unstaged'): (number | null)[] {
  const starts = new Array<number | null>(rows.length).fill(null)
  let at = 0
  while (at < rows.length) {
    if (!(rows[at] as ThreeRow)[flag]) {
      at += 1
      continue
    }
    let end = at
    while (end + 1 < rows.length && (rows[end + 1] as ThreeRow)[flag]) end += 1
    starts[at] = end - at + 1
    at = end + 1
  }
  return starts
}

export default function ThreePaneView({
  repo,
  path,
  language = null,
  onChanged,
  onExit
}: ThreePaneViewProps) {
  const { t } = useTranslation()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [writing, setWriting] = useState(false)
  const [writeError, setWriteError] = useState<{
    key: string
    code: IpcErrorCode
    message: string
  } | null>(null)

  const requestKey = `${repo}\u0000${path}`
  const file = splitPath(path)

  useEffect(() => {
    let active = true
    void window.seam.readStagingModel({ repo, path }).then((result) => {
      if (!active) return
      if (!result.ok) {
        setLoaded({ key: requestKey, state: null, error: result.message, binary: false })
        return
      }
      const model = result.value
      if (model === null) {
        setLoaded({ key: requestKey, state: null, error: null, binary: true })
        return
      }
      setLoaded({
        key: requestKey,
        state: buildThreePane(
          model.head,
          model.index,
          model.worktree,
          model.staged,
          model.unstaged
        ),
        error: null,
        binary: false
      })
    })
    return () => {
      active = false
    }
  }, [repo, path, requestKey])

  const state = loaded?.key === requestKey ? loaded.state : null
  const error = loaded?.key === requestKey ? loaded.error : null
  const binary = loaded?.key === requestKey && loaded.binary
  const failure = writeError !== null && writeError.key === requestKey ? writeError : null

  const update = useCallback(
    (change: (current: ThreePaneState) => ThreePaneState) => {
      setLoaded((current) => {
        if (current === null || current.key !== requestKey || current.state === null) return current
        return { ...current, state: change(current.state) }
      })
    },
    [requestKey]
  )

  // The change runs of each side, so a multi-line change gets a whole-hunk
  // arrow on its first row. Read from the rows, so it follows every edit.
  const starts = useMemo(() => {
    if (state === null) return { head: [], worktree: [] }
    return {
      head: runStarts(state.rows, 'staged'),
      worktree: runStarts(state.rows, 'unstaged')
    }
  }, [state])

  const stats = useMemo(() => {
    if (state === null) return { staged: 0, unstaged: 0 }
    let staged = 0
    let unstaged = 0
    for (const row of state.rows) {
      if (row.staged) staged += 1
      if (row.unstaged) unstaged += 1
    }
    return { staged, unstaged }
  }, [state])

  // The centre line numbers follow the pending index, so a line taken into a
  // gap gets the number it will have when Done writes the text.
  const middleNumbers = useMemo(() => {
    if (state === null) return []
    let line = 0
    return state.middle.map((entry): number | null => {
      if (!entry.present) return null
      line += 1
      return line
    })
  }, [state])

  const done = useCallback(async () => {
    if (state === null) {
      onExit()
      return
    }
    const text = middleText(state)
    // Nothing typed or taken: Done is a no-op, so the index is left untouched.
    if (text === state.originalText) {
      onExit()
      return
    }
    setWriting(true)
    try {
      const result = await window.seam.writeIndex({ repo, path, content: text })
      if (!result.ok) {
        setWriteError({ key: requestKey, code: result.code, message: result.message })
        return
      }
      onChanged?.()
      onExit()
    } finally {
      setWriting(false)
    }
  }, [state, requestKey, repo, path, onChanged, onExit])

  return (
    <div className="three" data-testid="three-pane">
      <div className="three__topbar">
        <span className="three__title" data-testid="three-title">
          {t('diff.three.title')}
        </span>
        <span className="three__file">
          <span className="three__file-name" title={path}>
            {file.name}
          </span>
          {file.dir !== '' && <span className="three__file-dir">{file.dir}</span>}
          <span className="sr-only" data-testid="three-path">
            {path}
          </span>
        </span>
        <div className="three__spacer" />
        <button type="button" className="three__button" data-testid="three-close" onClick={onExit}>
          {t('diff.three.close')}
        </button>
        <button
          type="button"
          className="three__button three__button--primary"
          data-testid="three-done"
          disabled={writing || state === null}
          onClick={() => void done()}
        >
          {t('diff.three.done')}
        </button>
      </div>

      {error !== null && (
        <p className="diff__error" role="alert" data-testid="three-error">
          {error}
        </p>
      )}
      {failure !== null && (
        <p className="diff__error" role="alert" data-testid="three-write-error">
          {t(ERROR_KEYS[failure.code])} {failure.message}
        </p>
      )}
      {binary && (
        <p className="diff__notice" data-testid="three-binary">
          {t('diff.three.binary')}
        </p>
      )}

      <div className="three__actions">
        <button
          type="button"
          className="three__button"
          data-testid="three-stage-all"
          disabled={writing || state === null || stats.unstaged === 0}
          onClick={() => update((current) => takeAll(current, 'worktree'))}
        >
          {t('diff.three.stageAll')}
        </button>
        <button
          type="button"
          className="three__button"
          data-testid="three-reset-index"
          disabled={writing || state === null || stats.staged === 0}
          onClick={() => update((current) => takeAll(current, 'head'))}
        >
          {t('diff.three.resetIndex')}
        </button>
        <div className="three__spacer" />
        <span className="three__stats" data-testid="three-stats" aria-live="polite">
          {t('diff.three.statsStaged', { count: stats.staged })}{' '}
          {t('diff.three.statsWorktree', { count: stats.unstaged })}
        </span>
      </div>

      {state !== null && (
        <>
          <div className="three__columns" data-testid="three-columns">
            <div className="three__column">
              <strong>{t('diff.three.head')}</strong>
              <span className="three__tag">{t('diff.three.readOnly')}</span>
            </div>
            <div />
            <div className="three__column">
              <strong>{t('diff.three.index')}</strong>
              <span className="three__column-note">· {t('diff.three.indexNote')}</span>
              <span className="three__tag">{t('diff.three.editable')}</span>
            </div>
            <div />
            <div className="three__column">
              <strong>{t('diff.three.worktree')}</strong>
              <span className="three__tag">{t('diff.three.readOnly')}</span>
            </div>
          </div>

          <div className="three__grid" data-testid="three-grid">
            {state.rows.map((row, at) => {
              const middle = state.middle[at] as ThreeMiddle
              const headRun = starts.head[at] ?? null
              const workRun = starts.worktree[at] ?? null
              return (
                <div className="three__row" data-testid="three-row" key={at}>
                  <div
                    className={`three__cell${toneClass(headTone(row))}${
                      row.headText === null ? ' three__cell--empty' : ''
                    }`}
                  >
                    <span className="three__line-number">
                      {row.aligned.head === null ? '' : row.aligned.head + 1}
                    </span>
                    <span className="three__text">{row.headText ?? ''}</span>
                  </div>

                  <div className="three__arrow" data-testid="three-arrow-head">
                    {row.staged && (
                      <button
                        type="button"
                        className="three__take"
                        data-testid="three-take-head"
                        title={t('diff.three.takeHead')}
                        aria-label={t('diff.three.takeHead')}
                        onClick={() => update((current) => takeLine(current, at, 'head'))}
                      >
                        {TAKE_LINE.head}
                      </button>
                    )}
                    {headRun !== null && headRun > 1 && (
                      <button
                        type="button"
                        className="three__take"
                        data-testid="three-take-head-hunk"
                        title={t('diff.three.takeHeadHunk')}
                        aria-label={t('diff.three.takeHeadHunk')}
                        onClick={() => update((current) => takeHunk(current, at, 'head'))}
                      >
                        {TAKE_HUNK.head}
                      </button>
                    )}
                  </div>

                  <div
                    className={`three__cell three__index-cell${toneClass(indexTone(row, middle))}${
                      middle.present ? '' : ' three__cell--empty'
                    }`}
                  >
                    <span className="three__line-number">{middleNumbers[at] ?? ''}</span>
                    <textarea
                      className="three__input"
                      data-testid="three-index-line"
                      value={middle.text}
                      rows={1}
                      wrap="off"
                      spellCheck={false}
                      aria-label={t('diff.three.index')}
                      onChange={(event) =>
                        update((current) => editLine(current, at, event.target.value))
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.preventDefault()
                      }}
                    />
                  </div>

                  <div className="three__arrow" data-testid="three-arrow-worktree">
                    {row.unstaged && (
                      <button
                        type="button"
                        className="three__take"
                        data-testid="three-take-worktree"
                        title={t('diff.three.takeWorktree')}
                        aria-label={t('diff.three.takeWorktree')}
                        onClick={() => update((current) => takeLine(current, at, 'worktree'))}
                      >
                        {TAKE_LINE.worktree}
                      </button>
                    )}
                    {workRun !== null && workRun > 1 && (
                      <button
                        type="button"
                        className="three__take"
                        data-testid="three-take-worktree-hunk"
                        title={t('diff.three.takeWorktreeHunk')}
                        aria-label={t('diff.three.takeWorktreeHunk')}
                        onClick={() => update((current) => takeHunk(current, at, 'worktree'))}
                      >
                        {TAKE_HUNK.worktree}
                      </button>
                    )}
                    {!row.unstaged && row.staged && (
                      <span className="three__staged" data-testid="three-staged">
                        {t('diff.three.staged')}
                      </span>
                    )}
                  </div>

                  <div
                    className={`three__cell${toneClass(worktreeTone(row))}${
                      row.worktreeText === null ? ' three__cell--empty' : ''
                    }`}
                  >
                    <span className="three__line-number">
                      {row.aligned.worktree === null ? '' : row.aligned.worktree + 1}
                    </span>
                    <span className="three__text">{row.worktreeText ?? ''}</span>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="three__help" data-testid="three-help">
            <div className="three__card">
              <p className="three__card-title">{t('diff.three.helpStageTitle')}</p>
              <p className="three__card-body">{t('diff.three.helpStageBody')}</p>
            </div>
            <div className="three__card">
              <p className="three__card-title">{t('diff.three.helpUnstageTitle')}</p>
              <p className="three__card-body">{t('diff.three.helpUnstageBody')}</p>
            </div>
            <div className="three__card">
              <p className="three__card-title">{t('diff.three.helpEditTitle')}</p>
              <p className="three__card-body">{t('diff.three.helpEditBody')}</p>
            </div>
          </div>

          <div className="three__status" data-testid="three-status">
            <span>{t('diff.three.status')}</span>
            {language !== null && (
              <span className="three__status-meta">
                {t('status.languageDetected', { language })}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
