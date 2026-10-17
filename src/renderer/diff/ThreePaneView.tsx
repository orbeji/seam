// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { IpcErrorCode } from '../../shared/ipc'
import { ERROR_KEYS } from '../errors'
import {
  buildThreePane,
  editLine,
  middleText,
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

// The arrow glyphs, kept out of the JSX so the translated text stays the only
// literal the interface shows.
const TAKE_LINE = { head: '\u2192', worktree: '\u2190' } as const
const TAKE_HUNK = { head: '\u21c9', worktree: '\u21c7' } as const

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

export default function ThreePaneView({ repo, path, onChanged, onExit }: ThreePaneViewProps) {
  const { t } = useTranslation()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [writing, setWriting] = useState(false)
  const [writeError, setWriteError] = useState<{
    key: string
    code: IpcErrorCode
    message: string
  } | null>(null)

  const requestKey = `${repo}\u0000${path}`

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
      <div className="three__toolbar">
        <span className="diff__path" data-testid="three-path">
          {path}
        </span>
        <button
          type="button"
          className="diff__button"
          data-testid="three-done"
          disabled={writing || state === null}
          onClick={() => void done()}
        >
          {t('diff.three.done')}
        </button>
        <button type="button" className="diff__button" data-testid="three-close" onClick={onExit}>
          {t('diff.three.close')}
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

      {state !== null && (
        <div className="three__grid" data-testid="three-grid">
          <div className="three__row three__row--heading">
            <div className="three__cell three__heading">{t('diff.three.head')}</div>
            <div className="three__arrow" />
            <div className="three__cell three__heading">{t('diff.three.index')}</div>
            <div className="three__arrow" />
            <div className="three__cell three__heading">{t('diff.three.worktree')}</div>
          </div>

          {state.rows.map((row, at) => {
            const middle = state.middle[at] as ThreeMiddle
            const headRun = starts.head[at] ?? null
            const workRun = starts.worktree[at] ?? null
            return (
              <div className="three__row" data-testid="three-row" key={at}>
                <div
                  className={`three__cell${row.staged ? ' three__cell--changed' : ''}${
                    row.headText === null ? ' three__cell--empty' : ''
                  }`}
                >
                  {row.headText ?? ''}
                </div>

                <div
                  className={`three__arrow${row.staged ? ' three__arrow--changed' : ''}`}
                  data-testid="three-arrow-head"
                >
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

                <textarea
                  className={`three__cell three__input${
                    middle.present ? '' : ' three__input--padding'
                  }`}
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

                <div
                  className={`three__arrow${row.unstaged ? ' three__arrow--changed' : ''}`}
                  data-testid="three-arrow-worktree"
                >
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
                </div>

                <div
                  className={`three__cell${row.unstaged ? ' three__cell--changed' : ''}${
                    row.worktreeText === null ? ' three__cell--empty' : ''
                  }`}
                >
                  {row.worktreeText ?? ''}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
