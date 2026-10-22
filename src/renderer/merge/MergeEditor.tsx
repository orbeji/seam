// SPDX-License-Identifier: MIT

import { MergeView } from '@codemirror/merge'
import { EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, drawSelection, lineNumbers } from '@codemirror/view'
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from 'react'
import { useTranslation } from 'react-i18next'
import { diffInline } from '../../core/diff'
import {
  createMerge,
  isRegionResolved,
  type MergeState,
  type NonConflictingSelection
} from '../../core/merge'
import type { IpcErrorCode, MergeEditorModel } from '../../shared/ipc'
import { ERROR_KEYS } from '../errors'
import { detectLanguageId, languageName } from '../diff/languages'
import { splitPath } from '../paths'
import {
  acceptRegion,
  applyNonConflictingRegions,
  buildMergeRows,
  canApplyMerge,
  conflictRegions,
  editResultLine,
  hasNonConflicting,
  ignoreRegion,
  mergeResultText,
  mergeStats,
  resolveRegion,
  resolveSimpleRegions,
  revertRegion,
  type MergeRowKind
} from './model'

/**
 * The three-way merge editor: Yours on the left, the editable Result in the
 * middle and Theirs on the right, aligned region by region. The arrows settle
 * one side of a region, the centre is a normal editor and Apply changes writes
 * the result and stages it, which is what resolves the conflict.
 *
 * The result starts from the common ancestor, as the specification decides. The
 * editor keeps its own undo history, so a single Ctrl+Z restores both the text
 * and the state of the region it came from.
 */

interface MergeEditorProps {
  readonly repo: string
  readonly path: string
  /** Called to leave: `written` is true after Apply changes or Save and close. */
  readonly onExit: (written: boolean) => void
}

interface Loaded {
  readonly key: string
  readonly model: MergeEditorModel
  readonly state: MergeState | null
  readonly initialText: string
  readonly error: string | null
}

interface Store {
  readonly loaded: Loaded | null
  readonly past: readonly MergeState[]
  readonly future: readonly MergeState[]
}

type Action =
  | { readonly type: 'load'; readonly loaded: Loaded }
  | { readonly type: 'change'; readonly change: (state: MergeState) => MergeState }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }

const EMPTY: Store = { loaded: null, past: [], future: [] }

function reducer(store: Store, action: Action): Store {
  switch (action.type) {
    case 'load':
      return { loaded: action.loaded, past: [], future: [] }
    case 'change': {
      const state = store.loaded?.state
      if (state === null || state === undefined) return store
      const next = action.change(state)
      if (next === state) return store
      return {
        loaded: { ...store.loaded, state: next } as Loaded,
        past: [...store.past.slice(-99), state],
        future: []
      }
    }
    case 'undo': {
      const previous = store.past[store.past.length - 1]
      const state = store.loaded?.state
      if (previous === undefined || state === null || state === undefined) return store
      return {
        loaded: { ...store.loaded, state: previous } as Loaded,
        past: store.past.slice(0, -1),
        future: [state, ...store.future]
      }
    }
    case 'redo': {
      const next = store.future[0]
      const state = store.loaded?.state
      if (next === undefined || state === null || state === undefined) return store
      return {
        loaded: { ...store.loaded, state: next } as Loaded,
        past: [...store.past, state],
        future: store.future.slice(1)
      }
    }
  }
}

/** The side of a line that changed, for the colour of the cell. */
function toneOf(kind: MergeRowKind, text: string | null, base: string | null): string {
  if (kind === 'conflict') return ' merge__cell--conflict'
  if (text === null) return base === null ? '' : ' merge__cell--deleted'
  if (base === null) return ' merge__cell--added'
  return text === base ? '' : ' merge__cell--modified'
}

/**
 * Marks the words of a line that differ from the common ancestor. It is skipped
 * for large files and for lines outside a region, where there is nothing to
 * review.
 */
function highlighted(
  text: string | null,
  base: string | null,
  inline: boolean,
  conflict: boolean
): ReactNode {
  if (text === null) return ''
  if (!inline) return text
  if (base === null) {
    return text === '' ? '' : <mark className="merge__word">{text}</mark>
  }
  const ranges = diffInline(base, text, 'word')
  if (ranges.length === 0) return text

  const parts: ReactNode[] = []
  let at = 0
  for (const [index, range] of ranges.entries()) {
    if (range.bFrom > at) parts.push(text.slice(at, range.bFrom))
    if (range.bTo > range.bFrom) {
      parts.push(
        <mark
          className={conflict ? 'merge__word merge__word--conflict' : 'merge__word'}
          key={index}
        >
          {text.slice(range.bFrom, range.bTo)}
        </mark>
      )
    }
    at = range.bTo
  }
  if (at < text.length) parts.push(text.slice(at))
  return parts
}

/** A read-only side-by-side comparison of two versions, opened by Compare. */
function CompareOverlay({
  title,
  leftLabel,
  rightLabel,
  left,
  right,
  onClose
}: {
  readonly title: string
  readonly leftLabel: string
  readonly rightLabel: string
  readonly left: string
  readonly right: string
  readonly onClose: () => void
}): ReactNode {
  const { t } = useTranslation()
  const container = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const parent = container.current
    if (parent === null) return
    parent.replaceChildren()
    const extensions = [
      lineNumbers(),
      drawSelection(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      oneDark
    ]
    const merge = new MergeView({
      a: { doc: left, extensions },
      b: { doc: right, extensions },
      parent,
      orientation: 'a-b'
    })
    return () => {
      merge.destroy()
    }
  }, [left, right])

  return (
    <div className="merge__overlay" role="dialog" aria-modal="true" data-testid="merge-compare">
      <div className="merge__compare-panel">
        <header className="merge__compare-header">
          <strong>{title}</strong>
          <span className="merge__compare-labels">
            {leftLabel} {'\u2194'} {rightLabel}
          </span>
          <span className="merge__spacer" />
          <button
            type="button"
            className="merge__button"
            data-testid="merge-compare-close"
            onClick={onClose}
          >
            {t('merge.closeCompare')}
          </button>
        </header>
        <div className="merge__compare-panes" ref={container} />
      </div>
    </div>
  )
}

export default function MergeEditor({ repo, path, onExit }: MergeEditorProps) {
  const { t } = useTranslation()
  const [store, dispatch] = useReducer(reducer, EMPTY)
  const [writing, setWriting] = useState(false)
  const [writeError, setWriteError] = useState<{
    readonly code: IpcErrorCode
    readonly message: string
  } | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    readonly regionId: number
    readonly left: number
    readonly top: number
  } | null>(null)
  const [compare, setCompare] = useState<'left' | 'right' | null>(null)
  const [compareMenu, setCompareMenu] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [conflictIndex, setConflictIndex] = useState(0)
  const grid = useRef<HTMLDivElement | null>(null)
  const menu = useRef<HTMLDivElement | null>(null)

  const requestKey = `${repo}\u0000${path}`
  const file = splitPath(path)
  const loaded = store.loaded?.key === requestKey ? store.loaded : null
  const model = loaded?.model ?? null
  const state = loaded?.state ?? null
  const failure = writeError

  useEffect(() => {
    let active = true
    void window.seam.readMergeEditor({ repo, path }).then((result) => {
      if (!active) return
      if (!result.ok) {
        dispatch({
          type: 'load',
          loaded: {
            key: requestKey,
            model: emptyModel(path),
            state: null,
            initialText: '',
            error: result.message
          }
        })
        return
      }
      const next = result.value
      if (next.binary || next.readOnly || next.left === null || next.right === null) {
        dispatch({
          type: 'load',
          loaded: { key: requestKey, model: next, state: null, initialText: '', error: null }
        })
        return
      }
      const merge = createMerge(next.base?.lines ?? [], next.left.lines, next.right.lines)
      dispatch({
        type: 'load',
        loaded: {
          key: requestKey,
          model: next,
          state: merge,
          initialText: mergeResultText(merge, next.finalNewline),
          error: null
        }
      })
    })
    return () => {
      active = false
    }
  }, [repo, path, requestKey])

  const rows = useMemo(() => (state === null ? [] : buildMergeRows(state)), [state])
  const conflicts = useMemo(() => (state === null ? [] : conflictRegions(state)), [state])
  const stats = useMemo(
    () => (state === null ? { conflicts: 0, nonConflicting: 0, resolved: 0 } : mergeStats(state)),
    [state]
  )
  const shownConflict =
    conflicts.length === 0 ? 0 : Math.min(Math.max(conflictIndex, 0), conflicts.length - 1)
  const dirty =
    loaded !== null && state !== null
      ? mergeResultText(state, loaded.model.finalNewline) !== loaded.initialText
      : false
  const applyReady =
    state !== null && model !== null && !model.binary && !model.readOnly && canApplyMerge(state)
  const hasSimple =
    state?.model.regions.some(
      (region) => region.kind === 'conflict' && region.simple && !isRegionResolved(region)
    ) ?? false
  const allNonConflicting = state !== null && hasNonConflicting(state, 'all')
  const leftNonConflicting = state !== null && hasNonConflicting(state, 'left')
  const rightNonConflicting = state !== null && hasNonConflicting(state, 'right')
  const language =
    model === null
      ? null
      : languageName(detectLanguageId(path, model.base?.lines[0] ?? model.left?.lines[0] ?? ''))

  const change = (mutate: (current: MergeState) => MergeState): void => {
    dispatch({ type: 'change', change: mutate })
  }

  const goConflict = (direction: 1 | -1): void => {
    if (conflicts.length === 0) return
    const next = (shownConflict + direction + conflicts.length) % conflicts.length
    setConflictIndex(next)
    const region = conflicts[next]
    if (region !== undefined) {
      requestAnimationFrame(() => {
        const row = grid.current?.querySelector(
          `[data-merge-region="${region.id}"]`
        ) as HTMLElement | null
        row?.scrollIntoView({ block: 'center' })
      })
    }
  }

  const applyNonConflicting = (selection: NonConflictingSelection): void => {
    change((current) => applyNonConflictingRegions(current, selection))
  }

  const write = async (stage: boolean): Promise<void> => {
    if (loaded === null || state === null) {
      onExit(false)
      return
    }
    if (!stage && !dirty) {
      onExit(false)
      return
    }
    setWriting(true)
    setWriteError(null)
    try {
      const result = await window.seam.applyMerge({
        repo,
        path,
        content: mergeResultText(state, loaded.model.finalNewline),
        stage
      })
      if (!result.ok) {
        setWriteError({ code: result.code, message: result.message })
        return
      }
      onExit(true)
    } finally {
      setWriting(false)
    }
  }

  const requestClose = (): void => {
    if (writing) return
    if (dirty) setConfirmDiscard(true)
    else onExit(false)
  }

  const openContext = (event: ReactMouseEvent<HTMLElement>, regionId: number | null): void => {
    if (regionId === null) return
    event.preventDefault()
    const left = Math.max(12, Math.min(event.clientX, window.innerWidth - 240))
    const top = Math.max(12, Math.min(event.clientY, window.innerHeight - 120))
    setContextMenu({ regionId, left, top })
  }

  useEffect(() => {
    if (contextMenu === null && !compareMenu && compare === null && !confirmDiscard) return
    const onMouseDown = (event: MouseEvent): void => {
      if (menu.current !== null && menu.current.contains(event.target as Node)) return
      setContextMenu(null)
      setCompareMenu(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (contextMenu !== null) setContextMenu(null)
      else if (compareMenu) setCompareMenu(false)
      else if (compare !== null) setCompare(null)
      else if (confirmDiscard) setConfirmDiscard(false)
      else requestClose()
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKey)
    }
  })

  const contextRegion =
    contextMenu === null || state === null
      ? undefined
      : state.model.regions.find((region) => region.id === contextMenu.regionId)
  const compareTitle = compare === 'left' ? t('merge.compareYours') : t('merge.compareTheirs')
  const compareSide = compare === 'left' ? model?.left : model?.right

  const onRootKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      if (applyReady && !writing) void write(true)
      return
    }
    if (event.key === 'F7') {
      event.preventDefault()
      goConflict(event.shiftKey ? -1 : 1)
    }
  }

  return (
    <div
      className="merge"
      data-testid="merge-editor"
      onKeyDown={onRootKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <header className="merge__topbar">
        <span className="merge__file-name" title={path} data-testid="merge-path">
          {file.name}
        </span>
        {file.dir !== '' && <span className="merge__file-dir">{file.dir}</span>}
        <span className="merge__spacer" />
        <button
          type="button"
          className="merge__icon"
          data-testid="merge-previous"
          aria-label={t('merge.previousConflict')}
          title={t('merge.previousConflict')}
          disabled={conflicts.length === 0}
          onClick={() => goConflict(-1)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M3 9l4-4 4 4" />
          </svg>
        </button>
        <span className="merge__conflict-count" data-testid="merge-conflict-of">
          {conflicts.length === 0
            ? t('merge.noConflicts')
            : t('merge.conflictOf', { current: shownConflict + 1, total: conflicts.length })}
        </span>
        <button
          type="button"
          className="merge__icon"
          data-testid="merge-next"
          aria-label={t('merge.nextConflict')}
          title={t('merge.nextConflict')}
          disabled={conflicts.length === 0}
          onClick={() => goConflict(1)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M3 5l4 4 4-4" />
          </svg>
        </button>
        <span className="merge__separator" />
        <button
          type="button"
          className="merge__button"
          data-testid="merge-save"
          disabled={writing || state === null}
          onClick={() => void write(false)}
        >
          {t('merge.save')}
        </button>
        <button
          type="button"
          className="merge__button merge__button--primary"
          data-testid="merge-apply"
          disabled={writing || !applyReady}
          title={applyReady ? undefined : t('merge.resolveAllFirst')}
          onClick={() => void write(true)}
        >
          {t('merge.apply')}
        </button>
        <button
          type="button"
          className="merge__icon"
          data-testid="merge-close"
          aria-label={t('merge.close')}
          title={t('merge.close')}
          disabled={writing}
          onClick={requestClose}
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
      </header>

      <div className="merge__toolbar">
        <button
          type="button"
          className="merge__button"
          data-testid="merge-apply-all"
          disabled={writing || state === null || !allNonConflicting}
          onClick={() => applyNonConflicting('all')}
        >
          {t('merge.applyAll')}
        </button>
        <button
          type="button"
          className="merge__button"
          data-testid="merge-from-left"
          disabled={writing || state === null || !leftNonConflicting}
          onClick={() => applyNonConflicting('left')}
        >
          {t('merge.fromLeft')}
        </button>
        <button
          type="button"
          className="merge__button"
          data-testid="merge-from-right"
          disabled={writing || state === null || !rightNonConflicting}
          onClick={() => applyNonConflicting('right')}
        >
          {t('merge.fromRight')}
        </button>
        <span className="merge__separator" />
        <button
          type="button"
          className="merge__button merge__button--simple"
          data-testid="merge-resolve-simple"
          disabled={writing || state === null || !hasSimple}
          onClick={() => change(resolveSimpleRegions)}
        >
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
            <path d="M2 12L9 5M8 2v2M11 3.5l-1.4 1.4M12 7h-2M5 2.5l1.4 1.4" />
          </svg>
          {t('merge.resolveSimple')}
        </button>
        <span className="merge__separator" />
        <div className="merge__compare-wrap" ref={compareMenu ? menu : undefined}>
          <button
            type="button"
            className="merge__button"
            data-testid="merge-compare"
            aria-haspopup="menu"
            aria-expanded={compareMenu}
            disabled={state === null}
            onClick={() => setCompareMenu((open) => !open)}
          >
            {t('merge.compare')}
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
          {compareMenu && (
            <div className="merge__menu merge__menu--compare" role="menu">
              <button
                type="button"
                role="menuitem"
                className="merge__menu-item"
                data-testid="merge-compare-yours"
                onClick={() => {
                  setCompareMenu(false)
                  setCompare('left')
                }}
              >
                {t('merge.compareYours')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="merge__menu-item"
                data-testid="merge-compare-theirs"
                onClick={() => {
                  setCompareMenu(false)
                  setCompare('right')
                }}
              >
                {t('merge.compareTheirs')}
              </button>
            </div>
          )}
        </div>
        <span className="merge__spacer" />
        <span className="merge__stats" data-testid="merge-stats">
          {t('merge.stats', {
            changes: stats.conflicts + stats.nonConflicting,
            conflicts: stats.conflicts,
            nonConflicting: stats.nonConflicting,
            resolved: stats.resolved
          })}
        </span>
      </div>

      <div className="merge__columns">
        <div className="merge__column">
          <strong>{t('merge.yours')}</strong>
          {model !== null && (
            <span className="merge__column-label">· {model.sides.yoursLabel}</span>
          )}
          <span className="merge__tag">{t('merge.readOnly')}</span>
        </div>
        <div />
        <div className="merge__column">
          <strong>{t('merge.result')}</strong>
          <span className="merge__tag">{t('merge.editable')}</span>
        </div>
        <div />
        <div className="merge__column">
          <strong>{t('merge.theirs')}</strong>
          {model !== null && (
            <span className="merge__column-label">· {model.sides.theirsLabel}</span>
          )}
          <span className="merge__tag">{t('merge.readOnly')}</span>
        </div>
      </div>

      {loaded?.error !== null && loaded?.error !== undefined && (
        <p className="diff__error" role="alert" data-testid="merge-error">
          {loaded.error}
        </p>
      )}
      {failure !== null && (
        <p className="diff__error" role="alert" data-testid="merge-write-error">
          {t(ERROR_KEYS[failure.code])} {failure.message}
        </p>
      )}
      {model?.binary && (
        <p className="diff__notice" data-testid="merge-binary">
          {t('merge.binary')}
        </p>
      )}
      {model?.readOnly && !loaded?.error && (
        <p className="diff__notice" data-testid="merge-read-only">
          {t('merge.readOnlyFile')}
        </p>
      )}
      {model?.large && (
        <p className="diff__notice" data-testid="merge-large">
          {t('merge.large')}
        </p>
      )}

      {state !== null && !model?.binary && !model?.readOnly ? (
        <div className="merge__grid" data-testid="merge-grid" ref={grid}>
          {rows.map((row) => {
            const region =
              row.regionId === null
                ? undefined
                : state.model.regions.find((candidate) => candidate.id === row.regionId)
            const inline = model !== null && !model.large && row.kind !== 'gap'
            const actions = region !== undefined && row.first && !region.edited
            return (
              <div
                className="merge__row"
                data-testid="merge-row"
                data-kind={row.kind}
                data-region={row.regionId ?? ''}
                key={row.key}
                onContextMenu={(event) => openContext(event, row.regionId)}
              >
                <div
                  className={`merge__cell${toneOf(row.kind, row.leftText, row.baseText)}${
                    row.leftText === null ? ' merge__cell--empty' : ''
                  }`}
                >
                  <span className="merge__line-number">{row.leftLine ?? ''}</span>
                  <span className="merge__text">
                    {highlighted(row.leftText, row.baseText, inline, row.kind === 'conflict')}
                  </span>
                </div>

                <div className="merge__gutter" data-testid="merge-gutter-left">
                  {actions && region?.leftState === 'pending' && (
                    <>
                      <button
                        type="button"
                        className="merge__take"
                        data-testid="merge-take-left"
                        title={t('merge.takeLeft')}
                        aria-label={t('merge.takeLeft')}
                        onClick={() =>
                          change((current) => acceptRegion(current, region.id, 'left'))
                        }
                      >
                        {'\u203a'}
                      </button>
                      <button
                        type="button"
                        className="merge__take"
                        data-testid="merge-ignore-left"
                        title={t('merge.ignoreLeft')}
                        aria-label={t('merge.ignoreLeft')}
                        onClick={() =>
                          change((current) => ignoreRegion(current, region.id, 'left'))
                        }
                      >
                        {'\u00d7'}
                      </button>
                    </>
                  )}
                </div>

                <div
                  className={`merge__cell merge__cell--result${toneOf(
                    row.kind,
                    row.resultText,
                    row.baseText
                  )}${row.resultLine === null ? ' merge__cell--empty' : ''}`}
                >
                  <span className="merge__line-number">{row.resultLine ?? ''}</span>
                  {row.resultLine === null ? (
                    <span className="merge__text" />
                  ) : (
                    <textarea
                      className="merge__input"
                      data-testid="merge-result-line"
                      value={row.resultText ?? ''}
                      rows={1}
                      wrap="off"
                      spellCheck={false}
                      aria-label={t('merge.result')}
                      onChange={(event) =>
                        change((current) =>
                          editResultLine(
                            current,
                            (row.resultLine as number) - 1,
                            event.target.value
                          )
                        )
                      }
                    />
                  )}
                </div>

                <div className="merge__gutter" data-testid="merge-gutter-right">
                  {actions && region?.rightState === 'pending' && (
                    <>
                      <button
                        type="button"
                        className="merge__take"
                        data-testid="merge-ignore-right"
                        title={t('merge.ignoreRight')}
                        aria-label={t('merge.ignoreRight')}
                        onClick={() =>
                          change((current) => ignoreRegion(current, region.id, 'right'))
                        }
                      >
                        {'\u00d7'}
                      </button>
                      <button
                        type="button"
                        className="merge__take"
                        data-testid="merge-take-right"
                        title={t('merge.takeRight')}
                        aria-label={t('merge.takeRight')}
                        onClick={() =>
                          change((current) => acceptRegion(current, region.id, 'right'))
                        }
                      >
                        {'\u2039'}
                      </button>
                    </>
                  )}
                </div>

                <div
                  className={`merge__cell${toneOf(row.kind, row.rightText, row.baseText)}${
                    row.rightText === null ? ' merge__cell--empty' : ''
                  }`}
                >
                  <span className="merge__line-number">{row.rightLine ?? ''}</span>
                  <span className="merge__text">
                    {highlighted(row.rightText, row.baseText, inline, row.kind === 'conflict')}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="merge__empty">
          {state === null && !model?.binary && !model?.readOnly && !loaded?.error
            ? t('merge.loading')
            : null}
        </div>
      )}

      <footer className="merge__status" data-testid="merge-status">
        <span className="merge__legend">
          <span>
            <span className="merge__swatch merge__swatch--modified" />
            {t('merge.legend.modified')}
          </span>
          <span>
            <span className="merge__swatch merge__swatch--deleted" />
            {t('merge.legend.deleted')}
          </span>
          <span>
            <span className="merge__swatch merge__swatch--added" />
            {t('merge.legend.added')}
          </span>
          <span>
            <span className="merge__swatch merge__swatch--conflicting" />
            {t('merge.legend.conflicting')}
          </span>
        </span>
        <span className="merge__meta">
          {t('merge.statusResult')}
          {language !== null && <> · {t('status.languageDetected', { language })}</>}
          {model !== null && (
            <>
              {' '}
              · {model.encoding} · {model.eol}
            </>
          )}
        </span>
      </footer>

      {contextMenu !== null && contextRegion !== undefined && (
        <div
          className="merge__menu"
          ref={menu}
          role="menu"
          aria-label={t('merge.contextMenu')}
          data-testid="merge-context-menu"
          style={{ left: contextMenu.left, top: contextMenu.top }}
        >
          <button
            type="button"
            role="menuitem"
            className="merge__menu-item"
            data-testid="merge-resolve-left"
            onClick={() => {
              setContextMenu(null)
              change((current) => resolveRegion(current, contextRegion.id, 'left'))
            }}
          >
            {t('merge.resolveLeft')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="merge__menu-item"
            data-testid="merge-resolve-right"
            onClick={() => {
              setContextMenu(null)
              change((current) => resolveRegion(current, contextRegion.id, 'right'))
            }}
          >
            {t('merge.resolveRight')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="merge__menu-item"
            data-testid="merge-revert"
            onClick={() => {
              setContextMenu(null)
              change((current) => revertRegion(current, contextRegion.id))
            }}
          >
            {t('merge.revert')}
          </button>
        </div>
      )}

      {compare !== null &&
        state !== null &&
        model !== null &&
        compareSide !== null &&
        compareSide !== undefined && (
          <CompareOverlay
            title={compareTitle}
            leftLabel={compare === 'left' ? t('merge.yours') : t('merge.theirs')}
            rightLabel={t('merge.result')}
            left={compareSide.lines.join('\n')}
            right={mergeResultText(state, model.finalNewline)}
            onClose={() => setCompare(null)}
          />
        )}

      {confirmDiscard && (
        <div className="merge__overlay" role="alertdialog" aria-modal="true">
          <div className="merge__confirm" data-testid="merge-discard-prompt">
            <h2>{t('merge.discardTitle')}</h2>
            <p>{t('merge.discardBody')}</p>
            <div className="merge__confirm-actions">
              <button
                type="button"
                className="merge__button"
                data-testid="merge-discard-cancel"
                onClick={() => setConfirmDiscard(false)}
              >
                {t('merge.cancel')}
              </button>
              <button
                type="button"
                className="merge__button merge__button--danger"
                data-testid="merge-discard"
                onClick={() => onExit(false)}
              >
                {t('merge.discard')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** A placeholder for a failed or missing read, so the header still draws. */
function emptyModel(path: string): MergeEditorModel {
  return {
    path,
    base: null,
    left: null,
    right: null,
    worktree: null,
    binary: false,
    readOnly: true,
    sides: {
      operation: null,
      yoursLabel: '',
      theirsLabel: '',
      yours: 'ours',
      theirs: 'theirs'
    },
    finalNewline: false,
    encoding: 'UTF-8',
    eol: 'LF',
    large: false
  }
}
