// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ChangeSummary,
  ConflictEntry,
  ConflictSide,
  ConflictState,
  HeadCommit,
  IdentityScope
} from '../shared/git'
import type { CrlfChoice, FileVersionSource, IpcErrorCode, RepositorySnapshot } from '../shared/ipc'
import { fileBadge, type FileBadge } from './changes/entry-view'
import ChangesView from './changes/ChangesView'
import CommitBox from './commit/CommitBox'
import EolDialog, { type EolAnswer } from './commit/EolDialog'
import IdentityDialog from './commit/IdentityDialog'
import ConflictsDialog, { type ConflictOverwrite } from './conflicts/ConflictsDialog'
import DiffView, { type DiffInfo } from './diff/DiffView'
import { ERROR_KEYS } from './errors'
import MergeEditor from './merge/MergeEditor'
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from './i18n'
import { splitPath } from './paths'
import TopBar from './shell/TopBar'

type View =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; snapshot: RepositorySnapshot }
  | { state: 'error'; code: IpcErrorCode; message: string }

/** The conflicts dialog's contents: loading, or the list and the side names. */
type ConflictsView = { state: 'loading' } | { state: 'ready'; data: ConflictState }

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

/** The badge of the selected file, read from whichever list holds it. */
function selectionBadge(summary: ChangeSummary, selection: Selection): FileBadge | null {
  const entry = [
    ...summary.staged,
    ...summary.unstaged,
    ...summary.untracked,
    ...summary.conflicts
  ].find((candidate) => candidate.path === selection.path)
  return entry === undefined ? null : fileBadge(entry)
}

export default function App() {
  const { t, i18n } = useTranslation()
  const current: SupportedLanguage = (i18n.resolvedLanguage as SupportedLanguage) ?? 'en'
  const [view, setView] = useState<View>({ state: 'idle' })
  const [recent, setRecent] = useState<string[]>([])
  const [selected, setSelected] = useState<Selection | null>(null)
  // The open file's language and hunk counts, reported by the viewer for the
  // status bar. It is null whenever no file is open.
  const [fileInfo, setFileInfo] = useState<DiffInfo | null>(null)
  // A failed stage or unstage, shown above the lists without hiding them.
  const [writeError, setWriteError] = useState<{
    code: IpcErrorCode
    message: string
  } | null>(null)
  // The unconfirmed commit message of the open repository. It is stored in the
  // application data folder as it is typed, so it survives a restart.
  const [commitMessage, setCommitMessage] = useState('')
  // Whether the commit box is amending the last commit. It resets with the
  // repository, like the draft but without being stored anywhere.
  const [amend, setAmend] = useState(false)
  // The last commit, shown while Amend is checked, and the text the box held
  // before it, so the draft comes back when Amend is unchecked.
  const [head, setHead] = useState<HeadCommit | null>(null)
  const draftBeforeAmend = useRef<string | null>(null)
  // The author to sign as and whether to add the sign-off trailer. They belong
  // to the repository, so they stay across commits and reset with it.
  const [author, setAuthor] = useState('')
  const [signoff, setSignoff] = useState(false)
  // Whether Git's commit hooks run. It is a preference, read at startup and
  // stored when the user changes it, so it survives closing Seam.
  const [runHooks, setRunHooks] = useState(true)
  // What the last commit's hooks printed, so a failing hook can be read in the
  // panel under the button; null until a commit has said anything.
  const [commitOutput, setCommitOutput] = useState<string | null>(null)
  // The last messages confirmed from this repository, newest first, offered by
  // the history button under the box. They belong to the repository, so they
  // reset with it.
  const [commitHistory, setCommitHistory] = useState<readonly string[]>([])
  // Whether a commit is being created, so its button cannot be pressed twice.
  const [committing, setCommitting] = useState(false)
  // The staged files a CRLF warning is about, with the dialog open over them,
  // or null when no warning is due. The commit waits for the dialog's answer.
  const [crlfPrompt, setCrlfPrompt] = useState<readonly string[] | null>(null)
  // The short id of the commit just made, shown with a copy button until the
  // next commit or repository replaces it.
  const [commitNotice, setCommitNotice] = useState<string | null>(null)
  // Whether the copy button has just copied, so it can say so for a moment.
  const [copied, setCopied] = useState(false)
  // The identity the dialog is asking for, with whatever Git already has, or
  // null when the dialog is closed. It opens before a commit that lacks one.
  const [identityPrompt, setIdentityPrompt] = useState<{ name: string; email: string } | null>(null)
  // Whether the typed identity is being stored, so its buttons wait.
  const [savingIdentity, setSavingIdentity] = useState(false)
  // The conflicts dialog: null when closed, loading while the main process
  // reads the list, and ready with the files and the name of each side.
  const [conflictsView, setConflictsView] = useState<ConflictsView | null>(null)
  // Whether a conflict action is running, so its buttons cannot be pressed twice.
  const [conflictsBusy, setConflictsBusy] = useState(false)
  // A failed conflict action, shown inside the dialog without closing it.
  const [conflictsError, setConflictsError] = useState<string | null>(null)
  // What the last bulk resolution did, under the list.
  const [conflictsNotice, setConflictsNotice] = useState<string | null>(null)
  // The file and side waiting for the user to confirm an overwrite.
  const [overwrite, setOverwrite] = useState<ConflictOverwrite | null>(null)
  // The operation the dialog was last opened for. Conflicts open the dialog
  // once per operation, not on every refresh; when none are left the key is
  // cleared so the next operation opens it again.
  const conflictsOpenedFor = useRef<string | null>(null)
  // The file the merge editor has open, with its repository, or null when the
  // three-pane editor is closed and the main window is showing.
  const [mergeEditor, setMergeEditor] = useState<{ repo: string; path: string } | null>(null)

  const open = useCallback(async (repo: string) => {
    setSelected(null)
    setWriteError(null)
    setCommitMessage('')
    setAmend(false)
    setHead(null)
    draftBeforeAmend.current = null
    setAuthor('')
    setSignoff(false)
    setCommitOutput(null)
    setCommitHistory([])
    setCrlfPrompt(null)
    setCommitNotice(null)
    setCopied(false)
    setIdentityPrompt(null)
    setConflictsView(null)
    setConflictsError(null)
    setConflictsNotice(null)
    setOverwrite(null)
    setMergeEditor(null)
    conflictsOpenedFor.current = null
    setView({ state: 'loading' })
    const result = await window.seam.readRepositoryStatus(repo)
    if (result.ok) {
      setView({ state: 'ready', snapshot: result.value })
    } else {
      setView({ state: 'error', code: result.code, message: result.message })
    }
  }, [])

  const currentRepo = view.state === 'ready' ? view.snapshot.repo : null
  const staged = view.state === 'ready' ? view.snapshot.summary.staged.length : 0
  const unstaged = view.state === 'ready' ? view.snapshot.summary.unstaged.length : 0
  const untracked = view.state === 'ready' ? view.snapshot.summary.untracked.length : 0
  const conflicts = view.state === 'ready' ? view.snapshot.summary.conflicts.length : 0
  const operation = view.state === 'ready' ? view.snapshot.operation : null
  const canAmend = view.state === 'ready' && view.snapshot.status.branch.oid !== null
  const branchStatus = view.state === 'ready' ? view.snapshot.status.branch : null
  const branchLabel =
    branchStatus === null ? null : (branchStatus.head ?? branchStatus.oid?.slice(0, 7) ?? null)
  const fileCount = staged + unstaged + untracked + conflicts

  // The open repository, kept in a ref so the focus and change listeners can be
  // set up once and never resubscribe as the view changes.
  const repoRef = useRef<string | null>(null)
  useEffect(() => {
    repoRef.current = currentRepo
  }, [currentRepo])

  // Refill the box with the draft this repository had, so reopening Seam or
  // opening another repository shows what belongs to it, not to the last one.
  // With an empty draft the box comes from `commit.template` instead, and the
  // history is read for the button that offers a previous message again.
  useEffect(() => {
    if (currentRepo === null) return
    let active = true
    void (async () => {
      const [draft, history] = await Promise.all([
        window.seam.readCommitDraft(currentRepo),
        window.seam.readCommitHistory(currentRepo)
      ])
      if (!active) return
      if (history.ok) setCommitHistory(history.value)
      if (!draft.ok) return
      if (draft.value !== '') {
        setCommitMessage(draft.value)
        return
      }

      const template = await window.seam.readCommitTemplate(currentRepo)
      if (active && template.ok && template.value !== null) setCommitMessage(template.value)
    })()
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

  /** Rereads the dialog's list without making it flash "loading". */
  const reloadConflicts = useCallback(async () => {
    const repo = repoRef.current
    if (repo === null) return
    const result = await window.seam.readConflicts(repo)
    if (result.ok) setConflictsView({ state: 'ready', data: result.value })
    else setConflictsError(result.message)
  }, [])

  /** Opens the dialog and reads the conflicts, including the resolved ones. */
  const openConflicts = useCallback(async () => {
    const repo = repoRef.current
    if (repo === null) return
    setConflictsView({ state: 'loading' })
    setConflictsError(null)
    setConflictsNotice(null)
    setOverwrite(null)
    const result = await window.seam.readConflicts(repo)
    if (result.ok) {
      setConflictsView({ state: 'ready', data: result.value })
    } else {
      setConflictsView(null)
      setWriteError({ code: result.code, message: result.message })
    }
  }, [])

  /**
   * Accepts one side of a file. When the working copy changed since the dialog
   * read it, the main process asks first; the second call is forced.
   */
  const acceptSide = useCallback(
    async (path: string, side: ConflictSide, fingerprint: string | null, force: boolean) => {
      const repo = repoRef.current
      if (repo === null) return
      setConflictsBusy(true)
      setConflictsError(null)
      setConflictsNotice(null)
      try {
        const result = await window.seam.acceptConflict({
          repo,
          path,
          side,
          fingerprint,
          ...(force ? { force: true } : {})
        })
        if (!result.ok) {
          setConflictsError(result.message)
          return
        }
        if (result.value.needsConfirmation) {
          setOverwrite({ path, side })
          return
        }
        setOverwrite(null)
        await refresh()
        await reloadConflicts()
      } finally {
        setConflictsBusy(false)
      }
    },
    [refresh, reloadConflicts]
  )

  const acceptConflict = useCallback(
    (entry: ConflictEntry, side: ConflictSide) =>
      void acceptSide(entry.path, side, entry.fingerprint, false),
    [acceptSide]
  )

  const confirmOverwrite = useCallback(() => {
    if (overwrite === null) return
    void acceptSide(overwrite.path, overwrite.side, null, true)
  }, [acceptSide, overwrite])

  /** Resolves every simple text conflict and reports what was left. */
  const resolveSimple = useCallback(async () => {
    const repo = repoRef.current
    if (repo === null) return
    setConflictsBusy(true)
    setConflictsError(null)
    setConflictsNotice(null)
    try {
      const result = await window.seam.resolveSimpleConflicts(repo)
      if (!result.ok) {
        setConflictsError(result.message)
        return
      }
      setConflictsNotice(
        t('conflicts.resolvedCount', {
          resolved: result.value.resolved,
          remaining: result.value.remaining
        })
      )
      await refresh()
      await reloadConflicts()
    } finally {
      setConflictsBusy(false)
    }
  }, [refresh, reloadConflicts, t])

  /** Puts a resolved file back into conflict. */
  const revertConflict = useCallback(
    async (entry: ConflictEntry) => {
      const repo = repoRef.current
      if (repo === null) return
      setConflictsBusy(true)
      setConflictsError(null)
      setConflictsNotice(null)
      try {
        const result = await window.seam.revertConflict({ repo, path: entry.path })
        if (!result.ok) {
          setConflictsError(result.message)
          return
        }
        await refresh()
        await reloadConflicts()
      } finally {
        setConflictsBusy(false)
      }
    },
    [refresh, reloadConflicts]
  )

  const closeConflicts = useCallback(() => {
    setConflictsView(null)
    setConflictsError(null)
    setConflictsNotice(null)
    setOverwrite(null)
  }, [])

  /** Closes the dialog on the resolved file, comparing the result against HEAD. */
  const showConflictDiff = useCallback(
    (entry: ConflictEntry) => {
      closeConflicts()
      setSelected({ path: entry.path, from: 'head', to: 'worktree' })
    },
    [closeConflicts]
  )

  /** Leaves the list for the three-pane editor on one manually merged file. */
  const openMergeEditor = useCallback((entry: ConflictEntry) => {
    const repo = repoRef.current
    if (repo === null) return
    setOverwrite(null)
    setConflictsView(null)
    setMergeEditor({ repo, path: entry.path })
  }, [])

  /**
   * Comes back from the editor, rereading the status and the conflict list. The
   * list reopens whether the result was written or discarded, so the user lands
   * on the remaining files instead of the plain window.
   */
  const leaveMergeEditor = useCallback(async () => {
    setMergeEditor(null)
    await refresh()
    await openConflicts()
  }, [refresh, openConflicts])

  // Conflicts open the dialog once per operation, not on every refresh: the
  // key is the operation and the commit it started from. A closed dialog stays
  // closed until the next operation, and the list's Resolve link reopens it.
  useEffect(() => {
    if (view.state !== 'ready' || conflictsView !== null) return
    const count = view.snapshot.summary.conflicts.length
    if (count === 0) {
      conflictsOpenedFor.current = null
      return
    }
    const key = `${view.snapshot.operation ?? 'conflict'}:${view.snapshot.status.branch.oid ?? ''}`
    if (conflictsOpenedFor.current === key) return
    conflictsOpenedFor.current = key
    void openConflicts()
  }, [view, conflictsView, openConflicts])

  useEffect(() => {
    void (async () => {
      const settings = await window.seam.readSettings()
      if (settings.ok) setRunHooks(settings.value.runHooks)
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
  // message clears the repository's draft in the main process. While Amend is
  // checked the box holds the previous message, which is not this repository's
  // draft, so it is left untouched and restored when Amend is unchecked.
  const writeMessage = useCallback(
    (message: string) => {
      setCommitMessage(message)
      const repo = repoRef.current
      if (repo !== null && !amend) void window.seam.writeCommitDraft({ repo, message })
    },
    [amend]
  )

  // Turning Amend on reads the last commit and fills the box with its message,
  // keeping the draft aside. Turning it off puts the draft back.
  const changeAmend = useCallback(
    async (next: boolean) => {
      if (next === amend) return
      if (!next) {
        setAmend(false)
        setHead(null)
        if (draftBeforeAmend.current !== null) setCommitMessage(draftBeforeAmend.current)
        return
      }

      const repo = repoRef.current
      if (repo === null) return
      // Toggle at once so the box reacts, then fill it from the last commit.
      const draft = commitMessage
      draftBeforeAmend.current = draft
      setAmend(true)
      setWriteError(null)

      const result = await window.seam.readHeadCommit(repo)
      if (!result.ok) {
        // Nothing to amend: undo the toggle and keep the draft as it was.
        setAmend(false)
        setHead(null)
        draftBeforeAmend.current = null
        setCommitMessage(draft)
        setWriteError({ code: result.code, message: result.message })
        return
      }
      setHead(result.value)
      setCommitMessage(result.value.message)
    },
    [amend, commitMessage]
  )

  // Confirms the index with the typed message. On success the message is spent:
  // the box and its stored draft go back to empty and Amend is cleared, before
  // the lists are read again. A failed commit keeps the message for another try.
  //
  // Git refuses to commit without a name and an address, so they are read first;
  // when either is missing the dialog opens and the commit waits for it. The
  // same happens for staged files that would commit CRLF: `crlf` carries the
  // answer to that warning, and without one the main process decides from the
  // preference whether to check at all.
  const commit = useCallback(
    async (crlf?: CrlfChoice) => {
      const repo = repoRef.current
      if (repo === null) return
      setWriteError(null)

      const identity = await window.seam.readIdentity(repo)
      if (identity.ok && (identity.value.name === null || identity.value.email === null)) {
        setIdentityPrompt({ name: identity.value.name ?? '', email: identity.value.email ?? '' })
        return
      }

      setCommitting(true)
      try {
        const result = await window.seam.commit({
          repo,
          message: commitMessage,
          amend,
          author,
          signoff,
          runHooks,
          ...(crlf === undefined ? {} : { crlf })
        })
        if (!result.ok) {
          setWriteError({ code: result.code, message: result.message })
          return
        }

        const outcome = result.value
        setCommitOutput(outcome.output === '' ? null : outcome.output)

        // A cancelled or timed-out commit keeps the message; the wait is over and
        // the box goes back to normal.
        if (outcome.cancelled) return
        if (outcome.timedOut) {
          setWriteError({ code: 'command-failed', message: t('commit.timedOut') })
          return
        }

        if (!outcome.created) {
          // Staged files that would commit CRLF: Seam's own warning, answered by
          // the dialog with a fix, a commit as they are, or nothing at all.
          if (outcome.crlf.length > 0) {
            setCrlfPrompt(outcome.crlf)
            return
          }
          // Git refused. A missing identity is the one refusal Seam can fix here.
          if (outcome.reason === 'identity') {
            const again = await window.seam.readIdentity(repo)
            setIdentityPrompt({
              name: again.ok ? (again.value.name ?? '') : '',
              email: again.ok ? (again.value.email ?? '') : ''
            })
            return
          }
          setWriteError({ code: 'command-failed', message: outcome.message })
          return
        }

        setCommitMessage('')
        setAmend(false)
        setHead(null)
        draftBeforeAmend.current = null
        await window.seam.writeCommitDraft({ repo, message: '' })
        await refresh()
        // The notification shows the short id Git reports for the new commit.
        setCommitNotice(outcome.shortId === '' ? null : outcome.shortId)
        setCopied(false)
        // The message just confirmed is the newest one the history offers.
        const history = await window.seam.readCommitHistory(repo)
        if (history.ok) setCommitHistory(history.value)
      } finally {
        setCommitting(false)
      }
    },
    [commitMessage, amend, author, signoff, runHooks, refresh, t]
  )

  // Stops a commit a hook is holding up, so the user is not stuck for five
  // minutes. The main process kills the Git command and the message is kept.
  const cancelCommit = useCallback(() => {
    const repo = repoRef.current
    if (repo === null) return
    void window.seam.cancelCommit(repo)
  }, [])

  // Answers the CRLF warning: fix the endings and commit, commit as they are,
  // or leave the commit alone. A "do not warn again" travels with the commit
  // that follows it, so it is only kept when the commit goes ahead.
  const answerCrlf = useCallback(
    async (answer: EolAnswer) => {
      setCrlfPrompt(null)
      await commit({
        fix: answer.fix,
        ...(answer.disable === null ? {} : { disable: answer.disable })
      })
    },
    [commit]
  )

  // Copies the notification's short id through the main process, which owns
  // the system clipboard, so the browser's clipboard rules do not apply.
  const copyShortId = useCallback(() => {
    if (commitNotice === null) return
    setCopied(true)
    void window.seam.writeClipboardText(commitNotice)
  }, [commitNotice])

  // The button goes back to its plain label once the copy has been seen.
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  // Remembers whether hooks run, so the choice survives the next window.
  const changeRunHooks = useCallback((next: boolean) => {
    setRunHooks(next)
    void window.seam.writeSettings({ runHooks: next })
  }, [])

  // Stores the identity the dialog asked for and, if Git takes it, commits the
  // message that was waiting.
  const saveIdentity = useCallback(
    async (identity: { name: string; email: string; scope: IdentityScope }) => {
      const repo = repoRef.current
      if (repo === null) return
      setWriteError(null)
      setSavingIdentity(true)
      try {
        const result = await window.seam.writeIdentity({ repo, ...identity })
        if (!result.ok) {
          setWriteError({ code: result.code, message: result.message })
          return
        }
        setIdentityPrompt(null)
        await commit()
      } finally {
        setSavingIdentity(false)
      }
    },
    [commit]
  )

  /** Opens a file, and on navigation past either end moves to the neighbouring file. */
  const move = (summary: ChangeSummary, current: Selection, direction: 1 | -1): void => {
    const files = summaryEntries(summary)
    const index = files.findIndex((file) => sameFile(file, current))
    const next = index === -1 ? undefined : files[index + direction]
    if (next !== undefined) setSelected(next)
  }

  if (mergeEditor !== null) {
    return (
      <MergeEditor
        key={`${mergeEditor.repo}\u0000${mergeEditor.path}`}
        repo={mergeEditor.repo}
        path={mergeEditor.path}
        onExit={() => void leaveMergeEditor()}
      />
    )
  }

  return (
    <div className="app">
      <TopBar
        repo={currentRepo}
        branch={branchLabel}
        recent={recent}
        canRefresh={currentRepo !== null}
        language={current}
        languages={SUPPORTED_LANGUAGES}
        onChoose={() => void choose()}
        onOpen={(repo) => void open(repo)}
        onRefresh={() => void refresh()}
        onLanguageChange={(language) => void i18n.changeLanguage(language)}
      />

      <div className="shell">
        <aside className="sidebar" aria-label={t('changes.title')}>
          <div className="sidebar__heading">
            <span>{t('changes.title')}</span>
            <span className="sidebar__count" data-testid="changes-count">
              {t('changes.files', { count: fileCount })}
            </span>
          </div>

          <div className="sidebar__scroll">{renderSidebar()}</div>

          {currentRepo !== null && (
            <div className="sidebar__commit">
              {commitNotice !== null && (
                <p className="app__notice" data-testid="commit-notice">
                  <span className="app__notice-text">
                    {t('commit.committed', { id: commitNotice })}
                  </span>
                  <button
                    type="button"
                    className="app__notice-copy"
                    data-testid="commit-copy"
                    onClick={copyShortId}
                  >
                    {t(copied ? 'commit.copied' : 'commit.copy')}
                  </button>
                </p>
              )}
              <CommitBox
                value={commitMessage}
                onChange={writeMessage}
                amend={amend}
                onAmendChange={(next) => void changeAmend(next)}
                canAmend={canAmend}
                head={head}
                author={author}
                onAuthorChange={setAuthor}
                signoff={signoff}
                onSignoffChange={setSignoff}
                runHooks={runHooks}
                onRunHooksChange={changeRunHooks}
                staged={staged}
                conflicts={conflicts}
                operation={operation}
                onCommit={() => void commit()}
                onCancel={cancelCommit}
                busy={committing}
                output={commitOutput}
                history={commitHistory}
                onPickHistory={writeMessage}
              />
            </div>
          )}
        </aside>

        <main className="workarea">{renderWorkArea()}</main>
      </div>

      {renderStatusBar()}

      {identityPrompt !== null && (
        <IdentityDialog
          name={identityPrompt.name}
          email={identityPrompt.email}
          busy={savingIdentity}
          error={writeError?.message ?? null}
          onSave={(identity) => void saveIdentity(identity)}
          onCancel={() => setIdentityPrompt(null)}
        />
      )}

      {crlfPrompt !== null && (
        <EolDialog
          files={crlfPrompt}
          onAnswer={(answer) => void answerCrlf(answer)}
          onCancel={() => setCrlfPrompt(null)}
        />
      )}

      {conflictsView !== null && (
        <ConflictsDialog
          state={conflictsView.state === 'ready' ? conflictsView.data : null}
          busy={conflictsBusy}
          error={conflictsError}
          notice={conflictsNotice}
          overwrite={overwrite}
          onAccept={acceptConflict}
          onResolveSimple={() => void resolveSimple()}
          onRevert={(entry) => void revertConflict(entry)}
          onResolveManually={openMergeEditor}
          onShowDiff={showConflictDiff}
          onOverwrite={confirmOverwrite}
          onCancelOverwrite={() => setOverwrite(null)}
          onClose={closeConflicts}
        />
      )}
    </div>
  )

  function renderSidebar() {
    switch (view.state) {
      case 'idle':
        return <p className="panel__empty">{t('changes.empty')}</p>
      case 'loading':
        return <p className="panel__empty">{t('changes.loading')}</p>
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
            <ChangesView
              summary={view.snapshot.summary}
              operation={view.snapshot.operation}
              selectedPath={selected?.path ?? null}
              onOpen={(path, from, to) => setSelected({ path, from, to })}
              onStage={(paths) => void writeStaging(paths, false)}
              onUnstage={(paths) => void writeStaging(paths, true)}
              onResolve={() => void openConflicts()}
            />
          </>
        )
    }
  }

  function renderWorkArea() {
    if (view.state === 'error') {
      return (
        <div className="workarea__empty">
          <div className="app__error" role="alert">
            <p className="app__error-title">{t(ERROR_KEYS[view.code])}</p>
            <p className="app__error-detail">{view.message}</p>
          </div>
        </div>
      )
    }
    if (view.state === 'idle' || view.state === 'loading') {
      return (
        <p className="workarea__empty">
          {t(view.state === 'idle' ? 'changes.empty' : 'changes.loading')}
        </p>
      )
    }
    if (selected === null) {
      return <p className="workarea__empty">{t('workarea.selectFile')}</p>
    }

    const { name, dir } = splitPath(selected.path)
    const badge = selectionBadge(view.snapshot.summary, selected)
    return (
      <>
        <div className="workarea__tabbar">
          <div className="workarea__tab">
            {badge !== null && (
              <span className={`changes__badge changes__badge--${badge.tone}`}>{badge.letter}</span>
            )}
            <span className="workarea__tab-name" title={selected.path}>
              {name}
            </span>
            <span className="sr-only" data-testid="diff-path">
              {selected.path}
            </span>
            {dir !== '' && <span className="workarea__tab-dir">{dir}</span>}
            <button
              type="button"
              className="icon-button workarea__tab-close"
              data-testid="diff-close"
              aria-label={t('workarea.closeTab')}
              title={t('workarea.closeTab')}
              onClick={() => setSelected(null)}
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
        </div>

        <div className="workarea__content">
          <DiffView
            repo={view.snapshot.repo}
            path={selected.path}
            from={selected.from}
            to={selected.to}
            onEdge={(direction) => move(view.snapshot.summary, selected, direction)}
            onChanged={() => void refresh()}
            onInfoChange={setFileInfo}
          />
        </div>
      </>
    )
  }

  function renderStatusBar() {
    const info = selected !== null && view.state === 'ready' ? fileInfo : null
    const fileHunks = info === null ? 0 : info.stagedHunks + info.unstagedHunks
    return (
      <footer className="statusbar">
        <span className="statusbar__left">
          {info !== null ? (
            fileHunks === 0 ? (
              <span>{t('status.noHunks')}</span>
            ) : (
              <span>
                {t('status.fileHunks', {
                  count: fileHunks,
                  staged: info.stagedHunks,
                  unstaged: info.unstagedHunks
                })}
              </span>
            )
          ) : view.state === 'ready' ? (
            <>
              <span>{t('status.staged', { count: staged })}</span>
              <span>{t('status.unstaged', { count: unstaged })}</span>
              <span>{t('status.untracked', { count: untracked })}</span>
              {conflicts > 0 && (
                <span className="statusbar__conflict">
                  {t('status.conflicts', { count: conflicts })}
                </span>
              )}
            </>
          ) : (
            <span>{t('status.ready')}</span>
          )}
        </span>
        {info !== null && info.language !== null ? (
          <span className="statusbar__language">
            {t('status.languageDetected', { language: info.language })}
          </span>
        ) : currentRepo !== null ? (
          <span className="statusbar__repo" title={currentRepo}>
            {currentRepo}
          </span>
        ) : null}
      </footer>
    )
  }
}
