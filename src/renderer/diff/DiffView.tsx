// SPDX-License-Identifier: MIT

import { history, defaultKeymap, historyKeymap } from '@codemirror/commands'
import { bracketMatching } from '@codemirror/language'
import { Change, MergeView, getChunks, unifiedMergeView } from '@codemirror/merge'
import { EditorState, type Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WHITESPACE_MODES, type WhitespaceMode } from '../../core/diff'
import type {
  DiffSide,
  FileComparison,
  FileVersionSource,
  IpcResult,
  StagingModel
} from '../../shared/ipc'
import { computeChanges, type HighlightGranularity } from './changes'
import { detectLanguageId, loadLanguage } from './languages'
import { markerLines, type MarkerLine } from './staging-markers'
import { stagingGutter } from './staging-gutter'

/** Above these limits the viewer drops inline highlighting, per the spec. */
const LARGE_BYTES = 5 * 1024 * 1024
const LARGE_LINES = 50_000

const GRANULARITIES: readonly HighlightGranularity[] = [
  'words',
  'lines',
  'split',
  'characters',
  'none'
]

export type DiffLayout = 'side-by-side' | 'unified'

interface DiffViewProps {
  readonly repo: string
  readonly path: string
  readonly from: FileVersionSource
  readonly to: FileVersionSource
  readonly onClose: () => void
  /** Called when navigation runs off the end, so the caller can open the next file. */
  readonly onEdge?: (direction: 1 | -1) => void
}

/** Rebuilds the document text of one side the way the viewer's editors hold it. */
export function sideText(side: DiffSide | null): string {
  if (side === null) return ''
  return side.lines.join('\n') + (side.finalNewline && side.lines.length > 0 ? '\n' : '')
}

/** The first line of a side, for shebang detection. */
function firstLine(side: DiffSide | null): string {
  return side?.lines[0] ?? ''
}

/**
 * Change colours: the side that only has the old text reads as grey, the side
 * that only has the new text as green, and the words that changed inside a line
 * get a stronger blue so they stand out from the line's own tint. It is a theme
 * extension rather than plain CSS so it outranks CodeMirror's own base theme.
 */
const changeTheme = EditorView.theme({
  '&.cm-merge-a .cm-changedLine, &.cm-merge-a .cm-changedLineGutter': {
    backgroundColor: 'rgba(150, 150, 150, 0.28)'
  },
  '&.cm-merge-b .cm-changedLine, &.cm-merge-b .cm-changedLineGutter, .cm-inlineChangedLine': {
    backgroundColor: 'rgba(88, 166, 87, 0.28)'
  },
  '.cm-insertedLine': { backgroundColor: 'rgba(88, 166, 87, 0.42)', borderRadius: '2px' },
  '.cm-deletedLine': { backgroundColor: 'rgba(150, 150, 150, 0.42)', borderRadius: '2px' },
  '.cm-changedText': { background: 'rgba(86, 132, 219, 0.55)', borderRadius: '2px' },
  '.cm-deletedText': { background: 'rgba(120, 120, 120, 0.55)', borderRadius: '2px' }
})

function isLarge(comparison: FileComparison): boolean {
  return (
    Math.max(comparison.fromSize, comparison.toSize) > LARGE_BYTES ||
    Math.max(comparison.from?.lines.length ?? 0, comparison.to?.lines.length ?? 0) > LARGE_LINES
  )
}

/**
 * The differences viewer. It loads two versions over IPC and renders them with
 * CodeMirror's merge view, feeding it our own diff engine through `diffConfig`.
 */
export default function DiffView({ repo, path, from, to, onClose, onEdge }: DiffViewProps) {
  const { t } = useTranslation()
  const [loaded, setLoaded] = useState<{
    key: string
    comparison: FileComparison | null
    model: StagingModel | null
    error: string | null
  } | null>(null)

  const [layout, setLayout] = useState<DiffLayout>('side-by-side')
  const [granularity, setGranularity] = useState<HighlightGranularity>('words')
  const [whitespace, setWhitespace] = useState<WhitespaceMode>('none')
  const [collapse, setCollapse] = useState(false)
  const [context, setContext] = useState(3)
  const [language, setLanguage] = useState<Extension | null>(null)
  // The hunk menu opened by clicking a marker, if any, and where it sits. It
  // remembers the file it belongs to, so moving on closes it without an effect.
  const [menu, setMenu] = useState<{
    key: string
    marker: MarkerLine
    x: number
    y: number
  } | null>(null)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const chunkIndexRef = useRef(-1)
  const editableTextRef = useRef('')
  const editKeyRef = useRef('')

  // Reads and errors are keyed by the request, so a stale answer for a file the
  // user has already left is ignored rather than shown.
  const requestKey = `${repo}\u0000${path}\u0000${from}\u0000${to}`
  const comparison = loaded?.key === requestKey ? loaded.comparison : null
  const model = loaded?.key === requestKey ? loaded.model : null
  const error = loaded?.key === requestKey ? loaded.error : null
  const loading = loaded?.key !== requestKey
  // A menu opened for a file the viewer has since left is dropped.
  const openMenu = menu !== null && menu.key === requestKey ? menu : null

  const fromText = useMemo(() => sideText(comparison?.from ?? null), [comparison])
  const toText = useMemo(() => sideText(comparison?.to ?? null), [comparison])
  const markers = useMemo(() => (model === null ? [] : markerLines(model)), [model])
  const languageId = useMemo(
    () => detectLanguageId(path, firstLine(comparison?.to ?? comparison?.from ?? null)),
    [path, comparison]
  )

  const large = comparison !== null && isLarge(comparison)
  const binary = comparison?.binary ?? false
  // Heavily rewritten or oversized files fall back to line-only highlighting.
  const effectiveGranularity: HighlightGranularity = binary || large ? 'lines' : granularity

  // The number of changed ranges the engine reports, shown in the toolbar. It is
  // skipped for large and binary files, where it would only cost time.
  const differenceCount = useMemo(
    () =>
      binary || large
        ? null
        : computeChanges(fromText, toText, { whitespace, granularity: effectiveGranularity })
            .length,
    [binary, large, fromText, toText, whitespace, effectiveGranularity]
  )

  // Load the comparison and the staging model over IPC. The result is stored
  // with its key, so nothing is set synchronously and a superseded request
  // leaves no trace. The comparison drives the panes; the model only drives the
  // margin markers, so a failed model read leaves the diff itself untouched.
  useEffect(() => {
    let active = true
    const files = window.seam.readFileComparison({ repo, path, from, to })
    const staging: Promise<IpcResult<StagingModel | null>> =
      to === 'worktree'
        ? window.seam.readStagingModel({ repo, path })
        : Promise.resolve({ ok: true, value: null })

    void Promise.all([files, staging]).then(([fileResult, modelResult]) => {
      if (!active) return
      setLoaded(
        fileResult.ok
          ? {
              key: requestKey,
              comparison: fileResult.value,
              model: modelResult.ok ? modelResult.value : null,
              error: null
            }
          : { key: requestKey, comparison: null, model: null, error: fileResult.message }
      )
    })
    return () => {
      active = false
    }
  }, [repo, path, from, to, requestKey])

  // Load the language grammar on demand.
  useEffect(() => {
    let active = true
    void loadLanguage(languageId).then((support) => {
      if (active) setLanguage(support)
    })
    return () => {
      active = false
    }
  }, [languageId])

  const handleMarker = useCallback(
    (marker: MarkerLine, event: MouseEvent) => {
      setMenu({ key: requestKey, marker, x: event.clientX, y: event.clientY })
    },
    [requestKey]
  )

  // A click outside the gutter and the menu itself closes it, so the popup never
  // lingers over a file the user has moved on from.
  useEffect(() => {
    if (openMenu === null) return
    const close = (event: MouseEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('.staging-gutter, .diff__hunk-menu')) {
        return
      }
      setMenu(null)
    }
    window.addEventListener('mousedown', close)
    return () => {
      window.removeEventListener('mousedown', close)
    }
  }, [openMenu])

  const navigate = useCallback(
    (direction: 1 | -1) => {
      const view = viewRef.current
      const info = view ? getChunks(view.state) : null
      const chunks = info?.chunks ?? []
      if (view === null || chunks.length === 0) {
        onEdge?.(direction)
        return
      }
      let index = chunkIndexRef.current + direction
      if (index < 0) index = 0
      if (index >= chunks.length) {
        onEdge?.(direction)
        return
      }
      chunkIndexRef.current = index
      const chunk = chunks[index]
      if (chunk === undefined) {
        onEdge?.(direction)
        return
      }
      const anchor = info?.side === 'b' ? chunk.fromB : chunk.fromA
      const end = info?.side === 'b' ? chunk.toB : chunk.toA
      view.dispatch({
        selection: { anchor },
        effects: EditorView.scrollIntoView(end),
        userEvent: 'select.byChunk'
      })
    },
    [onEdge]
  )

  // Build or rebuild the merge view whenever the content or the options change.
  useEffect(() => {
    const container = containerRef.current
    if (container === null || comparison === null) return
    container.replaceChildren()
    chunkIndexRef.current = -1
    if (comparison.binary) return

    // A new file starts from the version read from Git; a rebuild after an
    // option change keeps whatever the user has typed in an editable pane.
    if (editKeyRef.current !== requestKey) {
      editableTextRef.current = toText
      editKeyRef.current = requestKey
    }

    const override = (a: string, b: string): readonly Change[] =>
      computeChanges(a, b, { whitespace, granularity: effectiveGranularity }).map(
        (change) => new Change(change.fromA, change.toA, change.fromB, change.toB)
      )
    const diffConfig = { override }
    const collapseOption = collapse ? { margin: context, minSize: 1 } : undefined
    const editable = to === 'worktree'

    const common: Extension[] = [
      lineNumbers(),
      drawSelection(),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        {
          key: 'F7',
          run: () => {
            navigate(1)
            return true
          }
        },
        {
          key: 'Shift-F7',
          run: () => {
            navigate(-1)
            return true
          }
        }
      ]),
      EditorView.lineWrapping,
      bracketMatching(),
      changeTheme,
      oneDark
    ]

    const editableExtensions: Extension[] = [
      ...common,
      history(),
      EditorState.readOnly.of(false),
      EditorView.editable.of(true),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) editableTextRef.current = update.state.doc.toString()
      })
    ]

    const readOnlyExtensions: Extension[] = [
      ...common,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false)
    ]

    if (language) {
      editableExtensions.push(language)
      readOnlyExtensions.push(language)
    }

    if (editable && markers.length > 0) {
      editableExtensions.push(stagingGutter(markers, handleMarker))
    }

    if (layout === 'unified') {
      const view = new EditorView({
        parent: container,
        state: EditorState.create({
          doc: editable ? editableTextRef.current : toText,
          extensions: [
            ...(editable ? editableExtensions : readOnlyExtensions),
            unifiedMergeView({
              original: fromText,
              highlightChanges: effectiveGranularity !== 'none',
              gutter: true,
              ...(collapseOption ? { collapseUnchanged: collapseOption } : {}),
              diffConfig
            })
          ]
        })
      })
      viewRef.current = view
      return () => {
        view.destroy()
        viewRef.current = null
      }
    }

    const merge = new MergeView({
      a: { doc: fromText, extensions: readOnlyExtensions },
      b: { doc: editable ? editableTextRef.current : toText, extensions: editableExtensions },
      parent: container,
      orientation: 'a-b',
      ...(editable ? { revertControls: 'a-to-b' as const } : {}),
      highlightChanges: effectiveGranularity !== 'none',
      gutter: true,
      ...(collapseOption ? { collapseUnchanged: collapseOption } : {}),
      diffConfig
    })
    viewRef.current = merge.b
    return () => {
      merge.destroy()
      viewRef.current = null
    }
  }, [
    comparison,
    layout,
    granularity,
    effectiveGranularity,
    whitespace,
    collapse,
    context,
    language,
    to,
    fromText,
    toText,
    requestKey,
    markers,
    handleMarker,
    navigate
  ])

  const nextDifference = useCallback(() => navigate(1), [navigate])
  const previousDifference = useCallback(() => navigate(-1), [navigate])

  return (
    <div className="diff" data-testid="diff" data-language={languageId ?? ''}>
      <div className="diff__toolbar" data-testid="diff-toolbar">
        <span className="diff__path" data-testid="diff-path">
          {path}
        </span>

        {differenceCount !== null && (
          <span className="diff__count" data-testid="diff-count">
            {t('diff.count', { count: differenceCount })}
          </span>
        )}

        <label className="diff__label">
          {t('diff.layout.label')}
          <select
            className="diff__select"
            data-testid="diff-layout"
            value={layout}
            onChange={(event) => setLayout(event.target.value as DiffLayout)}
          >
            <option value="side-by-side">{t('diff.layout.side-by-side')}</option>
            <option value="unified">{t('diff.layout.unified')}</option>
          </select>
        </label>

        <label className="diff__label">
          {t('diff.granularity.label')}
          <select
            className="diff__select"
            data-testid="diff-granularity"
            value={effectiveGranularity}
            disabled={binary || large}
            onChange={(event) => setGranularity(event.target.value as HighlightGranularity)}
          >
            {GRANULARITIES.map((value) => (
              <option key={value} value={value}>
                {t(`diff.granularity.${value}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="diff__label">
          {t('diff.whitespace.label')}
          <select
            className="diff__select"
            data-testid="diff-whitespace"
            value={whitespace}
            onChange={(event) => setWhitespace(event.target.value as WhitespaceMode)}
          >
            {WHITESPACE_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`diff.whitespace.${mode}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="diff__label diff__label--check">
          <input
            type="checkbox"
            data-testid="diff-collapse"
            checked={collapse}
            onChange={(event) => setCollapse(event.target.checked)}
          />
          {t('diff.collapse')}
        </label>

        <label className="diff__label">
          {t('diff.context')}
          <input
            className="diff__number"
            data-testid="diff-context"
            type="number"
            min={0}
            max={50}
            value={context}
            onChange={(event) => setContext(Math.max(0, Number(event.target.value) || 0))}
          />
        </label>

        <button
          type="button"
          className="diff__button"
          data-testid="diff-previous"
          onClick={previousDifference}
        >
          {t('diff.navigation.previous')}
        </button>
        <button
          type="button"
          className="diff__button"
          data-testid="diff-next"
          onClick={nextDifference}
        >
          {t('diff.navigation.next')}
        </button>
        <button type="button" className="diff__button" data-testid="diff-close" onClick={onClose}>
          {t('diff.close')}
        </button>
      </div>

      {loading && <p className="diff__notice">{t('diff.loading')}</p>}
      {error !== null && (
        <p className="diff__error" role="alert" data-testid="diff-error">
          {error}
        </p>
      )}
      {binary && (
        <p className="diff__notice" data-testid="diff-binary">
          {t('diff.binary', { from: comparison?.fromSize ?? 0, to: comparison?.toSize ?? 0 })}
        </p>
      )}
      {large && !binary && (
        <p className="diff__notice" data-testid="diff-large">
          {t('diff.large')}
        </p>
      )}

      {openMenu !== null && (
        <div
          className="diff__hunk-menu"
          data-testid="diff-hunk-menu"
          role="menu"
          style={{ left: openMenu.x, top: openMenu.y }}
        >
          {openMenu.marker.unstaged && (
            <button type="button" role="menuitem" data-testid="hunk-stage" disabled>
              {t('diff.hunk.stage')}
            </button>
          )}
          {openMenu.marker.staged && (
            <button type="button" role="menuitem" data-testid="hunk-unstage" disabled>
              {t('diff.hunk.unstage')}
            </button>
          )}
          <button type="button" role="menuitem" data-testid="hunk-revert" disabled>
            {t('diff.hunk.revert')}
          </button>
        </div>
      )}

      <div className="diff__panes" data-testid="diff-panes" ref={containerRef} />
    </div>
  )
}
