// SPDX-License-Identifier: MIT

import { history, defaultKeymap, historyKeymap } from '@codemirror/commands'
import { bracketMatching } from '@codemirror/language'
import { Change, MergeView, getChunks, unifiedMergeView } from '@codemirror/merge'
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Extension
} from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  drawSelection,
  keymap,
  lineNumbers
} from '@codemirror/view'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HighlightGranularity } from './changes'
import type { WhitespaceMode } from '../../core/diff/lines'
import type {
  DiffSide,
  FileComparison,
  FileVersionSource,
  HunkRange,
  IpcErrorCode,
  StagingModel,
  SyntaxThemePreference
} from '../../shared/ipc'
import { ERROR_KEYS } from '../errors'
import { computeChanges } from './changes'
import { selectedLines } from './line-selection'
import { detectLanguageId, languageName, loadLanguage } from './languages'
import {
  hunksAt,
  markerLines,
  selectionAt,
  stagedHunksAt,
  stagedMarkerLines,
  type HunkSelection,
  type MarkerLine,
  type MarkerHunks
} from './staging-markers'
import { stagingGutter } from './staging-gutter'
import { lightSyntax, oneLight, readsLight } from './theme'
import { SETTINGS_CHANGED } from '../settings-events'
import ThreePaneView from './ThreePaneView'

/** Above these limits the viewer drops inline highlighting, per the spec. */
const LARGE_BYTES = 5 * 1024 * 1024
const LARGE_LINES = 50_000

export type DiffLayout = 'side-by-side' | 'unified' | 'three-pane'

/**
 * A version the history view can show. It adds the two sides of a commit to the
 * working-tree sources, since a commit's file has no index or working copy.
 */
export type DiffSource = FileVersionSource | 'commitParent' | 'commit'

/** What the window's status bar shows about the file that is open. */
export interface DiffInfo {
  readonly language: string | null
  readonly stagedHunks: number
  readonly unstagedHunks: number
}

interface DiffViewProps {
  readonly repo: string
  readonly path: string
  readonly from: DiffSource
  readonly to: DiffSource
  /**
   * The commit to read the file from, for the history view. When set, `from` is
   * the parent's version and `to` the commit's, and the viewer is read-only.
   */
  readonly commit?: string
  /** The file's path in the parent, for a rename or a copy. */
  readonly previousPath?: string | null
  /** Called when navigation runs off the end, so the caller can open the next file. */
  readonly onEdge?: (direction: 1 | -1) => void
  /** Called after a hunk write, so the caller can refresh the lists. */
  readonly onChanged?: () => void
  /** Pushes the open file's language and hunk counts to the window's status bar. */
  readonly onInfoChange?: (info: DiffInfo | null) => void
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
 * Change colours: the side that only has the old text reads as a pastel red,
 * the side that only has the new text as a pastel green, and modified lines get
 * a pastel green wash over the file's white text background. It is a theme
 * extension rather than plain CSS so it outranks CodeMirror's base theme.
 */
const changeTheme = EditorView.theme({
  '&': { backgroundColor: '#17181b', color: '#e6e7ea' },
  '.cm-content': { caretColor: '#e8a33d' },
  '.cm-gutters': {
    backgroundColor: '#17181b',
    color: '#8b909a',
    borderRight: '1px solid #2a2c32'
  },
  '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.025)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#e6e7ea' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(91, 156, 240, 0.25)'
  },
  // One background per kind of line: old text red, new text green. The base
  // theme also tints the deleted block and the changed words, which stacked
  // into a double shade, so those extra layers are turned off below.
  '&.cm-merge-a .cm-changedLine': {
    backgroundColor: 'rgba(240, 160, 160, 0.18)'
  },
  '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
    backgroundColor: 'rgba(159, 227, 189, 0.16)'
  },
  '&.cm-merge-a .cm-changedLineGutter': {
    backgroundColor: 'rgba(240, 160, 160, 0.62)'
  },
  '&.cm-merge-b .cm-changedLineGutter': {
    backgroundColor: 'rgba(159, 227, 189, 0.62)'
  },
  '.cm-deletedLineGutter': {
    backgroundColor: 'rgba(240, 160, 160, 0.62)'
  },
  '.cm-inlineChangedLineGutter': {
    backgroundColor: 'rgba(159, 227, 189, 0.62)'
  },
  '& .cm-deletedChunk': {
    backgroundColor: 'rgba(240, 160, 160, 0.14)'
  },
  // The words inside a changed line only keep the line's own background; these
  // selectors outrank the merge package's base gradient.
  '&.cm-merge-a .cm-changedText, &.cm-merge-b .cm-changedText, & .cm-deletedChunk .cm-deletedText, .cm-changedText, .cm-deletedText':
    {
      background: 'none'
    }
})

/** The effect that paints the navigation flash, and the field that keeps it. */
const flashEffect = StateEffect.define<DecorationSet>()

const flashField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(flashEffect)) return effect.value
    }
    return value
  },
  provide: (field) => EditorView.decorations.from(field)
})

/** A CodeMirror merge view keeps the editor of its other side on the view. */
interface MergeViewHost extends EditorView {
  readonly mergeView?: { readonly a: EditorView }
}

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
export default function DiffView({
  repo,
  path,
  from,
  to,
  commit,
  previousPath = null,
  onEdge,
  onChanged,
  onInfoChange
}: DiffViewProps) {
  const { t } = useTranslation()
  // Reads and errors are keyed by the request, so a stale answer for a file the
  // user has already left is ignored rather than shown.
  const requestKey =
    commit === undefined
      ? `${repo}\u0000${path}\u0000${from}\u0000${to}`
      : `${repo}\u0000${path}\u0000${from}\u0000${to}\u0000${commit}\u0000${previousPath ?? ''}`
  // The comparison and the staging model are read by two effects. Splitting them
  // lets a revert read only the model again: the comparison keeps its identity,
  // so the editors are not rebuilt and their undo history survives.
  const [fileState, setFileState] = useState<{
    key: string
    comparison: FileComparison | null
    error: string | null
  } | null>(null)
  const [stagingState, setStagingState] = useState<{
    key: string
    model: StagingModel | null
  } | null>(null)

  // The changes panel opens in the unified view. Only a conflict preview offers
  // another layout, and its switch is the only place the choice is visible. The
  // choice belongs to the file, so changing files starts unified again.
  const [layoutState, setLayoutState] = useState<{ key: string; layout: DiffLayout }>({
    key: requestKey,
    layout: 'unified'
  })
  const layout = layoutState.key === requestKey ? layoutState.layout : 'unified'
  const setLayout = useCallback(
    (next: DiffLayout) => setLayoutState({ key: requestKey, layout: next }),
    [requestKey]
  )
  // The difference the viewer last moved to, 0 until navigation is used.
  const [currentDifference, setCurrentDifference] = useState(0)
  const [language, setLanguage] = useState<Extension | null>(null)
  // Viewer options from settings (with defaults)
  const [granularity, setGranularity] = useState<HighlightGranularity>('words')
  const [whitespace, setWhitespace] = useState<WhitespaceMode>('none')
  const [collapse, setCollapse] = useState(false)
  const [context, setContext] = useState(3)
  // The palette the light scheme paints syntax with, from the settings.
  const [syntaxTheme, setSyntaxTheme] = useState<SyntaxThemePreference>('seam')
  // Whether the window wears the light scheme, which picks which palette is
  // used at all: the dark scheme always keeps its own.
  const [light, setLight] = useState(() => readsLight())
  // The hunk menu opened by clicking a marker, if any, and where it sits. It
  // remembers the file it belongs to, so moving on closes it without an effect.
  const [menu, setMenu] = useState<{
    key: string
    marker: MarkerLine
    hunks: MarkerHunks
    /** The selected lines of an unstaged hunk, ready to prepare on their own. */
    selection: HunkSelection | null
    x: number
    y: number
  } | null>(null)
  // Bumped after a hunk write and when Git changes the repository, so both
  // panes and the staging model are read again without leaving the file.
  const [revision, setRevision] = useState(0)
  // Bumped after a revert. A revert writes the working copy but not the index,
  // so only the staging model is read again and the editors are left alone.
  const [modelRevision, setModelRevision] = useState(0)
  // The working-copy text the toolbar counts differences on after a revert. The
  // comparison is not read again, so the count would otherwise show the numbers
  // from before the revert. Null means "use the comparison that was read".
  const [countedText, setCountedText] = useState<string | null>(null)
  // A failed hunk write, shown over the viewer without hiding the diff.
  const [writeError, setWriteError] = useState<{
    code: IpcErrorCode
    message: string
  } | null>(null)
  const [writing, setWriting] = useState(false)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  // The staging gutter sits in its own compartment, so its markers can be
  // replaced after a revert without rebuilding the editor and dropping the undo
  // history that makes the revert undoable.
  const gutter = useMemo(() => new Compartment(), [])
  const chunkIndexRef = useRef(-1)
  const editableTextRef = useRef('')
  const editKeyRef = useRef('')
  // The comparison the editors currently show, so a reread that found the same
  // two sides leaves the editor - and any typing in it - alone.
  const displayedRef = useRef<{ key: string; comparison: FileComparison | null } | null>(null)
  // The parent re-renders for reasons of its own - a status refresh after a
  // write, for instance - which would reach the editor through `navigate` and
  // rebuild it, dropping the undo history. Keeping the edge callback in a ref
  // keeps `navigate` still, so only the content and the options rebuild.
  const onEdgeRef = useRef(onEdge)
  useEffect(() => {
    onEdgeRef.current = onEdge
  }, [onEdge])
  // The working-copy lines selected in the editable pane. It is kept in a ref
  // so the menu can still read it when the click that opens the menu moves the
  // editor's selection.
  const selectionRef = useRef<number[]>([])
  // The text the selection was made on. A refresh that reads the same content
  // rebuilds the editor but does not throw the selection away.
  const docRef = useRef('')

  const comparison = fileState?.key === requestKey ? fileState.comparison : null
  const model = stagingState?.key === requestKey ? stagingState.model : null
  const error = fileState?.key === requestKey ? fileState.error : null
  const loading = fileState?.key !== requestKey
  // A menu opened for a file the viewer has since left is dropped. It is keyed
  // to the request and not to the revision, so a refresh that arrives while the
  // menu is open does not unmount it from under the click.
  const openMenu = menu !== null && menu.key === requestKey ? menu : null

  const fromText = useMemo(() => sideText(comparison?.from ?? null), [comparison])
  const toText = useMemo(() => sideText(comparison?.to ?? null), [comparison])
  const worktreeView = to === 'worktree' && commit === undefined
  // The staged list compares HEAD with the index: the change a commit would
  // record. The viewer can show it and take individual hunks back out.
  const stagedView = from === 'head' && to === 'index' && commit === undefined
  // The two sides of an unresolved conflict are Git's stage 2 and stage 3.
  const resolvingConflict =
    from === 'stage1' ||
    from === 'stage2' ||
    from === 'stage3' ||
    to === 'stage1' ||
    to === 'stage2' ||
    to === 'stage3'
  const markers = useMemo(() => (model === null ? [] : markerLines(model)), [model])
  const stagedMarkers = useMemo(
    () => (model === null || !stagedView ? [] : stagedMarkerLines(model)),
    [model, stagedView]
  )
  // The chunk buttons CodeMirror builds outlive a model refresh, so their
  // handlers read the current model through a ref instead of a stale closure.
  const modelRef = useRef<StagingModel | null>(null)
  useEffect(() => {
    modelRef.current = model
  }, [model])
  // The text Seam itself wrote when it reverted hunks. The watcher reports that
  // write back like any other working-tree change, and this lets the viewer
  // ignore its own change so the editor keeps the undo history that can bring
  // the reverted lines back.
  const revertedRef = useRef<{ key: string; text: string } | null>(null)
  const languageId = useMemo(
    () => detectLanguageId(path, firstLine(comparison?.to ?? comparison?.from ?? null)),
    [path, comparison]
  )

  const large = comparison !== null && isLarge(comparison)
  const binary = comparison?.binary ?? false
  // Heavily rewritten or oversized files fall back to line-only highlighting.
  const effectiveGranularity: HighlightGranularity = binary || large ? 'lines' : granularity

  // The number of changed ranges the engine reports, shown in the toolbar. It is
  // skipped for large and binary files, where it would only cost time. A revert
  // updates the working-copy text directly, since the comparison is not reread.
  const differenceCount = useMemo(
    () =>
      binary || large
        ? null
        : computeChanges(fromText, countedText ?? toText, {
            whitespace,
            granularity: effectiveGranularity
          }).length,
    [binary, large, fromText, toText, countedText, whitespace, effectiveGranularity]
  )

  const totalDifferences = differenceCount ?? 0
  // Before navigation the first difference is the one in view, so the counter
  // reads "Difference 1 of 6" rather than "0 of 6".
  const shownDifference =
    totalDifferences === 0 ? 0 : Math.min(Math.max(currentDifference, 1), totalDifferences)
  const threePaneAvailable =
    commit === undefined && !from.startsWith('stage') && !to.startsWith('stage')

  // The shell's status bar follows the open file: its language and the hunks
  // in either direction. Clearing on unmount keeps the previous file's data
  // from lingering after the tab is closed.
  useEffect(() => {
    onInfoChange?.({
      language: languageName(languageId),
      stagedHunks: model?.staged.length ?? 0,
      unstagedHunks: model?.unstaged.length ?? 0
    })
    return () => onInfoChange?.(null)
  }, [onInfoChange, languageId, model])

  // Load the comparison over IPC. The result is stored with its key, so nothing
  // is set synchronously and a superseded request leaves no trace.
  useEffect(() => {
    let active = true
    const request =
      commit === undefined
        ? window.seam.readFileComparison({
            repo,
            path,
            from: from as FileVersionSource,
            to: to as FileVersionSource
          })
        : window.seam.readCommitFileComparison({ repo, commit, path, previousPath })
    void request.then((result) => {
      if (!active) return
      const reverted = revertedRef.current
      if (
        result.ok &&
        reverted !== null &&
        reverted.key === requestKey &&
        sideText(result.value.to) === reverted.text
      ) {
        // The working copy already shows what was just read; a rebuild would
        // throw away the undo entry the revert added.
        return
      }
      revertedRef.current = null
      if (!result.ok) {
        displayedRef.current = { key: requestKey, comparison: null }
        setFileState({ key: requestKey, comparison: null, error: result.message })
        setCountedText(null)
        return
      }
      const previous = displayedRef.current
      if (
        previous !== null &&
        previous.key === requestKey &&
        previous.comparison !== null &&
        previous.comparison.binary === result.value.binary &&
        sideText(previous.comparison.from) === sideText(result.value.from) &&
        sideText(previous.comparison.to) === sideText(result.value.to)
      ) {
        // The two sides read back unchanged - a refresh caused by a change Seam
        // already applied, for instance. Keeping the previous state leaves the
        // editor, and the undo history that makes a revert undoable, untouched.
        return
      }
      displayedRef.current = { key: requestKey, comparison: result.value }
      // The working copy changed under the viewer - an external save or a file
      // discarded from the list. The editable pane adopts the new text so the
      // diff, its chunk buttons and the difference count follow it.
      editableTextRef.current = sideText(result.value.to)
      setFileState({ key: requestKey, comparison: result.value, error: null })
      // A freshly read comparison is the working-copy text again, so the count a
      // revert kept up to date is no longer needed.
      setCountedText(null)
    })
    return () => {
      active = false
    }
  }, [repo, path, from, to, commit, previousPath, requestKey, revision])

  // Load the staging model. The working-copy side uses it for its margin
  // markers; the staged side uses it to find the prepared hunk under a chunk.
  // It is read on its own so a revert, which bumps `modelRevision`, refreshes
  // the markers without rereading the comparison and rebuilding the editors.
  useEffect(() => {
    const wanted =
      commit === undefined && (to === 'worktree' || (from === 'head' && to === 'index'))
    if (!wanted) return
    let active = true
    void window.seam.readStagingModel({ repo, path }).then((result) => {
      if (!active) return
      setStagingState({ key: requestKey, model: result.ok ? result.value : null })
    })
    return () => {
      active = false
    }
  }, [repo, path, from, to, commit, requestKey, revision, modelRevision])

  // A change Git makes on disk - an `add` from the terminal, a commit, a
  // checkout - re-reads the file, so a hunk prepared elsewhere becomes a hollow
  // marker here without the user reopening it.
  useEffect(
    () =>
      window.seam.onRepositoryChanged((changed) => {
        if (changed === repo) setRevision((value) => value + 1)
      }),
    [repo]
  )

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

  // Read viewer options from settings, and read them again when the colour
  // scheme flips: the light scheme changes which syntax palette is in use.
  useEffect(() => {
    let active = true
    const read = (): void => {
      void window.seam.readSettings().then((result) => {
        if (!active || !result.ok) return
        setGranularity(result.value.highlight)
        setWhitespace(result.value.whitespace)
        setCollapse(result.value.collapse)
        setSyntaxTheme(result.value.syntaxTheme)
        setContext(3) // context is not in settings yet, use default
      })
    }
    read()
    const observer = new MutationObserver(() => {
      setLight(readsLight())
      read()
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    window.addEventListener(SETTINGS_CHANGED, read)
    return () => {
      active = false
      window.removeEventListener(SETTINGS_CHANGED, read)
      observer.disconnect()
    }
  }, [])

  const handleMarker = useCallback(
    (marker: MarkerLine, event: MouseEvent) => {
      const hunks =
        model === null
          ? { staged: [], unstaged: [] }
          : stagedView
            ? { staged: stagedHunksAt(model, marker.line), unstaged: [] }
            : hunksAt(model, marker.line)
      const selection =
        model === null || stagedView ? null : selectionAt(model, marker.line, selectionRef.current)
      setMenu({ key: requestKey, marker, hunks, selection, x: event.clientX, y: event.clientY })
    },
    [requestKey, model, stagedView]
  )

  // Prepare or remove the hunks a marker stands for. The index's text is rebuilt
  // in the main process and written without touching the working copy, and the
  // viewer then rereads both versions so the marker moves where it belongs.
  //
  // With `lines`, only those patch lines of a single hunk are taken, so the rest
  // of the hunk stays pending.
  const writeHunk = useCallback(
    async (action: 'stage' | 'unstage', hunks: readonly HunkRange[], lines?: readonly number[]) => {
      if (hunks.length === 0) return
      setMenu(null)
      selectionRef.current = []
      setWriteError(null)
      setWriting(true)
      try {
        const result = await window.seam.writeHunks({
          repo,
          path,
          action,
          hunks,
          ...(lines === undefined ? {} : { lines })
        })
        if (result.ok) {
          setRevision((value) => value + 1)
          onChanged?.()
        } else {
          setWriteError({ code: result.code, message: result.message })
        }
      } finally {
        setWriting(false)
      }
    },
    [repo, path, onChanged]
  )
  // The editor's chunk buttons keep the handler they were built with; the ref
  // makes them call the newest write function after the file changes.
  const writeHunkRef = useRef(writeHunk)
  useEffect(() => {
    writeHunkRef.current = writeHunk
  }, [writeHunk])

  // Throw a pending change away: the working copy's lines inside the hunks go
  // back to the index's. It is destructive, but the editor's undo can bring the
  // lines back while the viewer is open, so the viewer reverts straight away
  // and only the markers are read again. The new text is applied to the
  // editable pane as one change.
  const revert = useCallback(
    async (hunks: readonly HunkRange[]) => {
      if (hunks.length === 0) return
      setMenu(null)
      setWriteError(null)
      setWriting(true)
      try {
        const result = await window.seam.revertHunks({ repo, path, hunks })
        if (!result.ok) {
          setWriteError({ code: result.code, message: result.message })
          return
        }
        const text = result.value
        revertedRef.current = { key: requestKey, text }
        editableTextRef.current = text
        const view = viewRef.current
        if (view !== null && to === 'worktree') {
          const length = view.state.doc.length
          if (view.state.doc.toString() !== text) {
            view.dispatch({ changes: { from: 0, to: length, insert: text } })
          }
        }
        setCountedText(text)
        setModelRevision((value) => value + 1)
        onChanged?.()
      } finally {
        setWriting(false)
      }
    },
    [repo, path, to, requestKey, onChanged]
  )
  // The editor's chunk buttons keep the handler they were built with; the ref
  // makes them call the newest revert function after the file changes.
  const revertRef = useRef(revert)
  useEffect(() => {
    revertRef.current = revert
  }, [revert])

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

  const navigate = useCallback((direction: 1 | -1) => {
    const view = viewRef.current
    if (view === null) {
      onEdgeRef.current?.(direction)
      return
    }
    const info = getChunks(view.state)
    const chunks = info?.chunks ?? []
    if (chunks.length === 0) {
      onEdgeRef.current?.(direction)
      return
    }
    let index = chunkIndexRef.current + direction
    if (index < 0) index = 0
    if (index >= chunks.length) {
      onEdgeRef.current?.(direction)
      return
    }
    chunkIndexRef.current = index
    setCurrentDifference(index + 1)
    const chunk = chunks[index]
    if (chunk === undefined) {
      onEdgeRef.current?.(direction)
      return
    }
    const anchor = info?.side === 'b' ? chunk.fromB : chunk.fromA
    const end = info?.side === 'b' ? chunk.toB : chunk.toA
    const from = info?.side === 'b' ? chunk.fromB : chunk.fromA
    const to = info?.side === 'b' ? chunk.toB : chunk.toA
    // Scroll so the difference appears in the center of the visible area
    view.dispatch({
      selection: { anchor },
      effects: EditorView.scrollIntoView(end, { y: 'center' }),
      userEvent: 'select.byChunk'
    })
    // Flash the chunk by adding a temporary decoration via StateEffect
    // Apply to the current view
    const flashDecoration = Decoration.mark({
      class: 'diff__flash',
      inclusiveStart: false,
      inclusiveEnd: false
    }).range(from, to)
    view.dispatch({
      effects: [flashEffect.of(Decoration.set([flashDecoration]))]
    })
    // Also flash the other editor in side-by-side mode
    const mergeView = (view as MergeViewHost).mergeView
    if (mergeView && mergeView.a && mergeView.a !== view) {
      const otherFrom = info?.side === 'b' ? chunk.fromA : chunk.fromB
      const otherTo = info?.side === 'b' ? chunk.toA : chunk.toB
      const otherFlashDecoration = Decoration.mark({
        class: 'diff__flash',
        inclusiveStart: false,
        inclusiveEnd: false
      }).range(otherFrom, otherTo)
      mergeView.a.dispatch({
        effects: [flashEffect.of(Decoration.set([otherFlashDecoration]))]
      })
    }
    // Remove the flash after a short delay
    setTimeout(() => {
      if (viewRef.current) {
        viewRef.current.dispatch({
          effects: [flashEffect.of(Decoration.none)]
        })
        const merged = (viewRef.current as MergeViewHost).mergeView
        if (merged?.a) {
          merged.a.dispatch({
            effects: [flashEffect.of(Decoration.none)]
          })
        }
      }
    }, 400)
  }, [])

  // Build or rebuild the merge view whenever the content or the options change.
  useEffect(() => {
    const container = containerRef.current
    if (container === null || comparison === null) return
    container.replaceChildren()
    chunkIndexRef.current = -1
    setCurrentDifference(0)
    if (comparison.binary) return

    // A new file starts from the version read from Git; a rebuild after an
    // option change keeps whatever the user has typed in an editable pane.
    if (editKeyRef.current !== requestKey) {
      editableTextRef.current = toText
      editKeyRef.current = requestKey
    }

    const editable = worktreeView
    // Drop the selection only when the text it was made on is gone.
    const doc = editable ? editableTextRef.current : toText
    if (docRef.current !== doc) {
      selectionRef.current = []
      docRef.current = doc
    }

    const override = (a: string, b: string): readonly Change[] =>
      computeChanges(a, b, { whitespace, granularity: effectiveGranularity }).map(
        (change) => new Change(change.fromA, change.toA, change.fromB, change.toB)
      )
    const diffConfig = { override }
    // Large unchanged gaps are folded so the file reads as a series of blocks.
    // The setting folds every gap, however small it is.
    const collapseOption = { margin: context, minSize: collapse ? 1 : 13 }

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
      // The light scheme paints its own syntax and chrome; the dark one keeps
      // the palette that ships with CodeMirror, with the viewer's change tints
      // layered on top. The light palette already carries the light tints.
      ...(light ? [oneLight, lightSyntax(syntaxTheme)] : [oneDark, changeTheme]),
      flashField
    ]

    const editableExtensions: Extension[] = [
      ...common,
      history(),
      EditorState.readOnly.of(false),
      EditorView.editable.of(true),
      gutter.of(worktreeView && markers.length > 0 ? stagingGutter(markers, handleMarker) : []),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) editableTextRef.current = update.state.doc.toString()
        if (update.selectionSet || update.docChanged) {
          selectionRef.current = selectedLines(update.state)
        }
      })
    ]

    const readOnlyExtensions: Extension[] = [
      ...common,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false)
    ]

    // The staged view is read-only, but its index side still carries a hollow
    // dot on every prepared hunk so the marker menu can take it back out.
    const stagedExtensions: Extension[] = [
      ...readOnlyExtensions,
      gutter.of(
        stagedView && stagedMarkers.length > 0 ? stagingGutter(stagedMarkers, handleMarker) : []
      )
    ]

    if (language) {
      editableExtensions.push(language)
      readOnlyExtensions.push(language)
      stagedExtensions.push(language)
    }

    // CodeMirror's default Accept/Reject buttons only move a chunk between the
    // two documents it keeps in memory. Seam's buttons stand for Git instead:
    // Stage prepares the chunk in the index, Discard restores the staged
    // version, and Unstage takes a prepared chunk back out.
    const chunkLine = (event: MouseEvent): number | null => {
      const target = event.currentTarget
      if (!(target instanceof Element)) return null
      const chunk = target.closest('.cm-deletedChunk')
      const current = viewRef.current
      if (chunk === null || current === null) return null
      return current.state.doc.lineAt(current.posAtDOM(chunk)).number - 1
    }
    const handleChunk = (type: 'accept' | 'reject', event: MouseEvent): void => {
      const currentModel = modelRef.current
      const line = chunkLine(event)
      if (currentModel === null || line === null) return
      if (stagedView) {
        const hunk = stagedHunksAt(currentModel, line)[0]
        if (hunk === undefined) return
        event.preventDefault()
        event.stopPropagation()
        void writeHunkRef.current('unstage', [hunk])
        return
      }
      const hunk = hunksAt(currentModel, line).unstaged[0]
      if (hunk === undefined) return
      event.preventDefault()
      event.stopPropagation()
      if (type === 'accept') {
        void writeHunkRef.current('stage', [hunk])
      } else {
        void revertRef.current([hunk])
      }
    }
    const chunkButton = (type: 'accept' | 'reject'): HTMLElement => {
      // A staged diff only has one direction: the index back to HEAD's version.
      if (stagedView && type === 'reject') {
        const hidden = document.createElement('span')
        hidden.hidden = true
        return hidden
      }
      const action = stagedView ? 'unstage' : type === 'accept' ? 'stage' : 'discard'
      const button = document.createElement('button')
      button.type = 'button'
      button.name = type
      button.className = `diff__chunk-button diff__chunk-button--${action}`
      button.dataset.testid = `chunk-${action}`
      button.textContent = t(`diff.chunk.${action}`)
      button.onmousedown = (event) => handleChunk(type, event)
      button.onclick = (event) => {
        // Keyboard activation arrives as a click without a mouse's detail.
        if (event.detail === 0) handleChunk(type, event)
      }
      return button
    }

    if (layout === 'unified') {
      const view = new EditorView({
        parent: container,
        state: EditorState.create({
          doc: editable ? editableTextRef.current : toText,
          extensions: [
            ...(editable ? editableExtensions : stagedView ? stagedExtensions : readOnlyExtensions),
            unifiedMergeView({
              original: fromText,
              highlightChanges: effectiveGranularity !== 'none',
              gutter: true,
              // A commit's diff is history and an unresolved conflict's stages
              // are read-only: neither has changes Seam can stage, discard or
              // unstage. The working-tree and staged views keep the buttons.
              mergeControls:
                !resolvingConflict && (worktreeView || stagedView) ? chunkButton : false,
              collapseUnchanged: collapseOption,
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
      b: {
        doc: editable ? editableTextRef.current : toText,
        extensions: editable
          ? editableExtensions
          : stagedView
            ? stagedExtensions
            : readOnlyExtensions
      },
      parent: container,
      orientation: 'a-b',
      ...(editable ? { revertControls: 'a-to-b' as const } : {}),
      highlightChanges: effectiveGranularity !== 'none',
      gutter: true,
      collapseUnchanged: collapseOption,
      diffConfig
    })
    viewRef.current = merge.b
    return () => {
      merge.destroy()
      viewRef.current = null
    }
    // The markers are refreshed in place by the effect below; a change to them
    // must not rebuild the editor, or the undo history would be thrown away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    comparison,
    layout,
    granularity,
    effectiveGranularity,
    whitespace,
    collapse,
    context,
    language,
    light,
    syntaxTheme,
    from,
    to,
    commit,
    fromText,
    toText,
    requestKey,
    gutter,
    navigate,
    t
  ])

  // Refresh the margin markers in place. A revert changes the staging model but
  // not the comparison, so the editor is left alone and its undo history, which
  // holds the revert, survives.
  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    const current = stagedView ? stagedMarkers : worktreeView ? markers : []
    view.dispatch({
      effects: gutter.reconfigure(current.length > 0 ? stagingGutter(current, handleMarker) : [])
    })
  }, [gutter, stagedView, worktreeView, markers, stagedMarkers, handleMarker])

  const menuTitle =
    openMenu === null
      ? ''
      : openMenu.marker.unstaged && openMenu.marker.staged
        ? t('diff.hunk.both')
        : openMenu.marker.unstaged
          ? t('diff.hunk.pending')
          : t('diff.hunk.staged')

  return (
    <div
      className={`diff${layout === 'three-pane' ? ' diff--three-pane' : ''}`}
      data-testid="diff"
      data-language={languageId ?? ''}
      data-granularity={effectiveGranularity}
    >
      <div className="diff__toolbar" data-testid="diff-toolbar">
        {/* The changes panel always shows the unified view. A conflict preview
            is the one place the two layouts are worth choosing between. */}
        {resolvingConflict && (
          <div className="diff__layout" role="group" aria-label={t('diff.layout.label')}>
            <button
              type="button"
              className={`diff__layout-button${layout === 'side-by-side' ? ' is-active' : ''}`}
              aria-pressed={layout === 'side-by-side'}
              onClick={() => setLayout('side-by-side')}
            >
              {t('diff.layout.side-by-side')}
            </button>
            <button
              type="button"
              className={`diff__layout-button${layout === 'unified' ? ' is-active' : ''}`}
              aria-pressed={layout === 'unified'}
              onClick={() => setLayout('unified')}
            >
              {t('diff.layout.unified')}
            </button>
          </div>
        )}
        {/* The tests keep the native control; it is never visible, so the
            layout switch cannot be reached outside a conflict. */}
        <select
          className="diff__compat-select"
          data-testid="diff-layout"
          aria-hidden="true"
          tabIndex={-1}
          value={layout}
          onChange={(event) => setLayout(event.target.value as DiffLayout)}
        >
          <option value="side-by-side">{t('diff.layout.side-by-side')}</option>
          <option value="unified">{t('diff.layout.unified')}</option>
          <option value="three-pane" disabled={!threePaneAvailable}>
            {t('diff.layout.three-pane')}
          </option>
        </select>

        <div className="diff__toolbar-spacer" />

        {differenceCount !== null && (
          <div className="diff__difference-nav" aria-live="polite">
            <span className="diff__difference" data-testid="diff-count">
              {t('diff.differenceOf', {
                current: shownDifference,
                total: differenceCount
              })}
            </span>
            <div className="diff__nav-buttons">
              <button
                type="button"
                className="icon-button diff__nav-button"
                data-testid="diff-previous"
                aria-label={t('diff.navigation.previous')}
                disabled={totalDifferences === 0}
                onClick={() => navigate(-1)}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M6 2L2 6L6 10" />
                </svg>
              </button>
              <button
                type="button"
                className="icon-button diff__nav-button"
                data-testid="diff-next"
                aria-label={t('diff.navigation.next')}
                disabled={totalDifferences === 0}
                onClick={() => navigate(1)}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M6 10L10 6L6 2" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {layout === 'side-by-side' && comparison !== null && !comparison.binary && (
        <div className="diff__columns" data-testid="diff-columns">
          <span>{t(`diff.columns.${from}`)}</span>
          <span>{t(`diff.columns.${to}`)}</span>
        </div>
      )}

      {loading && <p className="diff__notice">{t('diff.loading')}</p>}
      {error !== null && (
        <p className="diff__error" role="alert" data-testid="diff-error">
          {error}
        </p>
      )}
      {writeError !== null && (
        <p className="diff__error" role="alert" data-testid="diff-write-error">
          {t(ERROR_KEYS[writeError.code])} {writeError.message}
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
          aria-label={menuTitle}
          style={{ left: openMenu.x, top: openMenu.y }}
        >
          <p className="diff__hunk-title">{menuTitle}</p>
          <div className="diff__hunk-actions">
            {openMenu.marker.unstaged && (
              <button
                type="button"
                role="menuitem"
                className="diff__hunk-action diff__hunk-action--stage"
                data-testid="hunk-stage"
                disabled={writing || openMenu.hunks.unstaged.length === 0}
                onClick={() => void writeHunk('stage', openMenu.hunks.unstaged)}
              >
                {t('diff.hunk.stage')}
              </button>
            )}
            {openMenu.marker.unstaged && (
              <button
                type="button"
                role="menuitem"
                className="diff__hunk-action diff__hunk-action--stage diff__hunk-action--quiet"
                data-testid="hunk-stage-selection"
                disabled={writing || openMenu.selection === null}
                onClick={() => {
                  const selection = openMenu.selection
                  if (selection !== null) void writeHunk('stage', [selection.hunk], selection.lines)
                }}
              >
                {t('diff.hunk.stageSelection')}
              </button>
            )}
            {openMenu.marker.staged && (
              <button
                type="button"
                role="menuitem"
                className="diff__hunk-action diff__hunk-action--unstage"
                data-testid="hunk-unstage"
                disabled={writing || openMenu.hunks.staged.length === 0}
                onClick={() => void writeHunk('unstage', openMenu.hunks.staged)}
              >
                {t('diff.hunk.unstage')}
              </button>
            )}
            {openMenu.marker.unstaged && (
              <button
                type="button"
                role="menuitem"
                className="diff__hunk-action diff__hunk-action--discard"
                data-testid="hunk-revert"
                disabled={writing || openMenu.hunks.unstaged.length === 0}
                onClick={() => void revert(openMenu.hunks.unstaged)}
              >
                {t('diff.hunk.revert')}
              </button>
            )}
          </div>
        </div>
      )}

      {layout === 'three-pane' ? (
        <ThreePaneView
          repo={repo}
          path={path}
          language={languageName(languageId)}
          {...(onChanged === undefined ? {} : { onChanged })}
          onExit={() => setLayout(resolvingConflict ? 'side-by-side' : 'unified')}
        />
      ) : (
        <div className="diff__panes" data-testid="diff-panes" ref={containerRef} />
      )}
    </div>
  )
}
