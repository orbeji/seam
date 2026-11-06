// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ChangeSummary,
  CommitChanges,
  CommitFileStatus,
  ConflictEntry,
  ConflictSide,
  ConflictState,
  GitFlowConfig,
  GitFlowFinishOutcome,
  GitFlowKind,
  GitFlowState,
  GitOperation,
  HeadCommit,
  HistoryCommit,
  IdentityScope,
  MergeOutcome,
  MergeState,
  MergeStrategy,
  OperationOutcome,
  PushOutcome,
  PushState
} from '../shared/git'
import type {
  CloneRequest,
  CrlfChoice,
  FileVersionSource,
  IpcErrorCode,
  RepositorySnapshot
} from '../shared/ipc'
import { fileBadge, type FileBadge } from './changes/entry-view'
import ChangesView from './changes/ChangesView'
import CommitBox from './commit/CommitBox'
import EolDialog, { type EolAnswer } from './commit/EolDialog'
import IdentityDialog from './commit/IdentityDialog'
import ConflictsDialog, { type ConflictOverwrite } from './conflicts/ConflictsDialog'
import OutputDialog from './conflicts/OutputDialog'
import DiffView, { type DiffInfo } from './diff/DiffView'
import { ERROR_KEYS } from './errors'
import GitFlowDialog from './gitflow/GitFlowDialog'
import MergeDialog from './gitflow/MergeDialog'
import {
  CommitFilesPanel,
  HistoryPanel,
  type HistoryCheckout,
  type HistoryView
} from './history/HistoryPanel'
import MergeEditor from './merge/MergeEditor'
import { splitPath } from './paths'
import PushDialog, { type PushChoice } from './push/PushDialog'
import BranchDialog from './shell/BranchDialog'
import CloneDialog from './shell/CloneDialog'
import GitRequired from './shell/GitRequired'
import RepositoryTabs from './shell/RepositoryTabs'
import TopBar from './shell/TopBar'
import SettingsPanel from './shell/SettingsPanel'

type View =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; snapshot: RepositorySnapshot }
  | { state: 'error'; code: IpcErrorCode; message: string }

/** The conflicts dialog's contents: loading, or the list and the side names. */
type ConflictsView = { state: 'loading' } | { state: 'ready'; data: ConflictState }

/** The push dialog's contents: loading, or the branch and the commits to send. */
type PushView = { state: 'loading' } | { state: 'ready'; data: PushState }

/** The merge dialog's contents: loading, or the branches and readiness. */
type MergeView = { state: 'loading' } | { state: 'ready'; data: MergeState }

/** The GitFlow popup's contents: loading, or the configuration and branches. */
type GitFlowView = { state: 'loading' } | { state: 'ready'; data: GitFlowState }

/**
 * The startup Git check. Nothing else is rendered until it passes, so a missing
 * or too-old Git becomes a help screen rather than a failure on the first
 * repository the user opens.
 */
type GitGate =
  | { state: 'checking' }
  | { state: 'ready' }
  | { state: 'blocked'; code: IpcErrorCode; message: string }

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
 * Every file in a summary, in the order the screen shows them. The staged list
 * shows HEAD against the index, which is exactly the change the next commit
 * would record; the other lists compare the index with the working copy. A file
 * with both kinds of change therefore appears twice, and each row opens its own
 * comparison.
 */
export function summaryEntries(summary: ChangeSummary): Selection[] {
  const entries = [
    ...entriesOf(summary.staged, 'head', 'index'),
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

/** What a long-running fetch, pull, commit or push is doing, and how it ended. */
type SyncNoticeTone = 'busy' | 'ok' | 'error'

/** The catalogue key for each refusal a `git push --porcelain` can report. */
const PUSH_REJECTION_KEYS = {
  'non-fast-forward': 'nonFastForward',
  'remote-rejected': 'remoteRejected',
  'tag-exists': 'tagExists',
  'stale-info': 'staleInfo',
  other: 'other'
} as const

/** The badge a commit's changed file shows in the work area tab. */
const COMMIT_BADGE: Record<CommitFileStatus, FileBadge> = {
  added: { letter: 'A', tone: 'added' },
  modified: { letter: 'M', tone: 'modified' },
  deleted: { letter: 'D', tone: 'deleted' },
  renamed: { letter: 'R', tone: 'modified' },
  copied: { letter: 'C', tone: 'modified' },
  'type-changed': { letter: 'T', tone: 'modified' },
  unmerged: { letter: 'U', tone: 'conflict' },
  unknown: { letter: '?', tone: 'untracked' }
}

/**
 * The popup that follows a fetch, pull, commit or push. It floats over the work
 * area so it does not squeeze the file lists: a spinner while Git runs, a short
 * confirmation that leaves by itself, or a failure that waits for the user.
 */
function SyncToast({
  tone,
  text,
  dismissLabel,
  action,
  onDismiss
}: {
  readonly tone: SyncNoticeTone
  readonly text: string
  readonly dismissLabel: string
  /** An extra action the result offers, such as copying a commit's short id. */
  readonly action?: { label: string; testId: string; onClick: () => void } | undefined
  readonly onDismiss: () => void
}) {
  return (
    <div
      className={
        tone === 'busy'
          ? 'app__toast app__toast--busy'
          : tone === 'ok'
            ? 'app__toast'
            : 'app__toast app__toast--error'
      }
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      data-testid="sync-notice"
      data-tone={tone}
    >
      {tone === 'busy' ? (
        <span className="app__toast-spinner" aria-hidden="true" />
      ) : (
        <svg
          width="16"
          height="16"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {tone === 'ok' ? (
            <path d="M2.5 7.5l3 3 6-6" />
          ) : (
            <>
              <path d="M1.3 11.8h11.4L7 2.4z" />
              <path d="M7 6v2.6" />
              <path d="M7 10.7v.1" />
            </>
          )}
        </svg>
      )}
      <span className="app__toast-text" title={text}>
        {text}
      </span>
      {action !== undefined && (
        <button
          type="button"
          className="app__toast-action"
          data-testid={action.testId}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
      {tone !== 'busy' && (
        <button
          type="button"
          className="app__toast-close"
          aria-label={dismissLabel}
          onClick={onDismiss}
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
      )}
    </div>
  )
}

export default function App() {
  const { t, i18n } = useTranslation()
  const [view, setView] = useState<View>({ state: 'idle' })
  // Whether Seam may start: it waits for the Git check, then blocks on a help
  // screen when the system has no usable Git.
  const [gitGate, setGitGate] = useState<GitGate>({ state: 'checking' })
  const [recent, setRecent] = useState<string[]>([])
  // The repositories with an open tab, in the order they were opened, and the
  // one whose tab is showing. Tabs stay open while another repository is used.
  const [openRepos, setOpenRepos] = useState<string[]>([])
  const [activeRepo, setActiveRepo] = useState<string | null>(null)
  // The tabs closed during this session, newest first, offered by the reopen
  // arrow beside the plus.
  const [closedRepos, setClosedRepos] = useState<string[]>([])
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
  // The short id of the commit just made, kept for the success popup's copy
  // button until the next commit or repository replaces it.
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
  // A confirmation the dialog should open with, when Abort was pressed in the
  // changes list rather than inside the dialog.
  const [conflictsPrompt, setConflictsPrompt] = useState<'abort' | null>(null)
  // What Git printed when a hook or another error stopped an operation, in a
  // dialog over the conflicts list so no resolution is lost.
  const [gitOutput, setGitOutput] = useState<string | null>(null)
  // The operation the dialog was last opened for. Conflicts open the dialog
  // once per operation, not on every refresh; when none are left the key is
  // cleared so the next operation opens it again.
  const conflictsOpenedFor = useRef<string | null>(null)
  // The file the merge editor has open, with its repository, or null when the
  // three-pane editor is closed and the main window is showing.
  const [mergeEditor, setMergeEditor] = useState<{ repo: string; path: string } | null>(null)
  // The settings panel.
  const [settingsOpen, setSettingsOpen] = useState(false)
  // The clone dialog: whether it is open, whether Git is running, and why the
  // last attempt failed. A successful clone opens the new repository.
  const [cloneOpen, setCloneOpen] = useState(false)
  const [cloneBusy, setCloneBusy] = useState(false)
  const [cloneError, setCloneError] = useState<string | null>(null)
  // The commit graph panel: null before a repository is open, then loading,
  // showing the read commits, or explaining why Git could not read them.
  const [historyView, setHistoryView] = useState<HistoryView | null>(null)
  // Whether the persistent history panel is shown beside the file sidebar.
  const [historyVisible, setHistoryVisible] = useState(true)
  // The commit whose files and diff are open, or null while the working tree
  // is showing. The graph stays selected on this commit.
  const [selectedCommit, setSelectedCommit] = useState<HistoryCommit | null>(null)
  // The files the selected commit changed, read when the commit is selected.
  const [commitChanges, setCommitChanges] = useState<{
    readonly oid: string
    readonly data: CommitChanges | null
    readonly error: string | null
  } | null>(null)
  // The file of the selected commit open in the work area.
  const [selectedCommitPath, setSelectedCommitPath] = useState<string | null>(null)
  // The commit file's language and hunk counts, for the status bar.
  const [commitFileInfo, setCommitFileInfo] = useState<DiffInfo | null>(null)
  // Identifies the history read in flight, so opening another repository
  // discards the answer instead of replacing the graph.
  const historyRequest = useRef(0)
  // The push dialog: null when closed, loading while the branch and the commits
  // are read, and ready with everything it shows before pushing.
  const [pushView, setPushView] = useState<PushView | null>(null)
  // Whether a push or the update before it is running, so its buttons wait.
  const [pushBusy, setPushBusy] = useState(false)
  // A failed push, or the explanation of a rejection Seam cannot recover from.
  const [pushError, setPushError] = useState<string | null>(null)
  // What the last push did, shown inside the dialog when it did not simply land.
  const [pushOutcome, setPushOutcome] = useState<PushOutcome | null>(null)
  // Git's live output while a push runs, so a slow remote is visible.
  const [pushProgress, setPushProgress] = useState('')
  // How Update and push integrates the fetched upstream; the dialog remembers it.
  const [pushStrategy, setPushStrategy] = useState<'rebase' | 'merge'>('rebase')
  // A push that stopped on conflicts: finishing the operation reopens the
  // dialog with the list refreshed, as the phase describes.
  const pushAfterConflicts = useRef(false)
  // Commit and Push: once the commit exists, the push dialog opens by itself.
  const pushAfterCommit = useRef(false)
  // Whether a fetch or a pull is running, so their buttons wait too.
  const [syncBusy, setSyncBusy] = useState(false)
  // The popup that follows a running fetch, pull, commit or push: a spinner
  // while Git works, a brief success, or a failure that stays until dismissed.
  const [syncNotice, setSyncNotice] = useState<{
    id: number
    tone: SyncNoticeTone
    text: string
    /** The extra thing the popup offers, such as copying a new commit's id. */
    action?: 'copy-commit'
  } | null>(null)
  const syncNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (syncNoticeTimer.current !== null) clearTimeout(syncNoticeTimer.current)
    },
    []
  )

  /** Shows the operation popup, keeping only a success for a few seconds. */
  const showSyncNotice = useCallback(
    (tone: SyncNoticeTone, text: string, action?: 'copy-commit') => {
      if (syncNoticeTimer.current !== null) clearTimeout(syncNoticeTimer.current)
      syncNoticeTimer.current = null
      setSyncNotice({ id: Date.now(), tone, text, ...(action === undefined ? {} : { action }) })
      if (tone === 'ok') {
        // A result with a button stays long enough to use it; a plain
        // confirmation is just a glimpse.
        const dismissAfter = action === undefined ? 4000 : 8000
        syncNoticeTimer.current = setTimeout(() => {
          syncNoticeTimer.current = null
          setSyncNotice(null)
        }, dismissAfter)
      }
    },
    []
  )

  /** Takes the popup away, and cancels any pending self-dismissal. */
  const hideSyncNotice = useCallback(() => {
    if (syncNoticeTimer.current !== null) clearTimeout(syncNoticeTimer.current)
    syncNoticeTimer.current = null
    setSyncNotice(null)
  }, [])

  // Branch selector state
  const [branches, setBranches] = useState<{
    local: Array<{ name: string; current: boolean }>
    remote: Array<{ name: string; remote: string }>
  } | null>(null)
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [branchesError, setBranchesError] = useState<string | null>(null)

  // The branch manager: its list is the same one the top bar menu reads, so a
  // create, rename or delete refreshes both.
  const [branchOpen, setBranchOpen] = useState(false)
  const [branchBusy, setBranchBusy] = useState(false)
  const [branchError, setBranchError] = useState<string | null>(null)

  // The merge dialog and what the last merge did.
  const [mergeView, setMergeView] = useState<MergeView | null>(null)
  const [mergeBusy, setMergeBusy] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [mergeOutcome, setMergeOutcome] = useState<MergeOutcome | null>(null)

  // The GitFlow popup and what its last finish did. A finish that stops on a
  // conflict is resumed after the merge commit, through the ref below.
  const [gitflowView, setGitflowView] = useState<GitFlowView | null>(null)
  const [gitflowBusy, setGitflowBusy] = useState(false)
  const [gitflowError, setGitflowError] = useState<string | null>(null)
  const [gitflowOutcome, setGitflowOutcome] = useState<GitFlowFinishOutcome | null>(null)
  const gitflowAfterMerge = useRef(false)

  // Identifies the status read in flight, so switching tabs quickly discards
  // the answer for the repository that was left behind.
  const statusRequest = useRef(0)

  /** Drops everything that belonged to the repository that was showing. */
  const resetRepositoryState = useCallback(() => {
    setSelected(null)
    setWriteError(null)
    setCommitMessage('')
    setAmend(false)
    setHead(null)
    draftBeforeAmend.current = null
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
    setConflictsPrompt(null)
    setGitOutput(null)
    setMergeEditor(null)
    historyRequest.current += 1
    setHistoryView(null)
    setSelectedCommit(null)
    setCommitChanges(null)
    setSelectedCommitPath(null)
    setCommitFileInfo(null)
    // The old repository's branches never leak into the new one's menu.
    setBranches(null)
    setBranchesError(null)
    setLoadingBranches(false)
    setBranchOpen(false)
    setBranchBusy(false)
    setBranchError(null)
    setMergeView(null)
    setMergeBusy(false)
    setMergeError(null)
    setMergeOutcome(null)
    setGitflowView(null)
    setGitflowBusy(false)
    setGitflowError(null)
    setGitflowOutcome(null)
    gitflowAfterMerge.current = false
    setPushView(null)
    setPushBusy(false)
    setPushError(null)
    setPushOutcome(null)
    setPushProgress('')
    setPushStrategy('rebase')
    pushAfterConflicts.current = false
    pushAfterCommit.current = false
    conflictsOpenedFor.current = null
  }, [])

  const open = useCallback(
    async (repo: string) => {
      resetRepositoryState()
      // Opening a repository from the reopen list or from disk gives it a tab;
      // switching to a tab that is already open keeps the strip as it was.
      setActiveRepo(repo)
      setOpenRepos((current) => (current.includes(repo) ? current : [...current, repo]))
      setClosedRepos((current) => current.filter((entry) => entry !== repo))
      setView({ state: 'loading' })
      const request = statusRequest.current + 1
      statusRequest.current = request
      const result = await window.seam.readRepositoryStatus(repo)
      if (request !== statusRequest.current) return
      if (result.ok) {
        setView({ state: 'ready', snapshot: result.value })
      } else {
        setView({ state: 'error', code: result.code, message: result.message })
      }
    },
    [resetRepositoryState]
  )

  /** Closes a tab, moving to a neighbour and keeping the repository reopenable. */
  const closeRepo = useCallback(
    (repo: string) => {
      const index = openRepos.indexOf(repo)
      const remaining = openRepos.filter((entry) => entry !== repo)
      setOpenRepos(remaining)
      setClosedRepos((current) => [repo, ...current.filter((entry) => entry !== repo)])
      if (repo !== activeRepo) return

      const neighbour = remaining[index] ?? remaining[index - 1] ?? null
      if (neighbour !== null) {
        void open(neighbour)
        return
      }
      statusRequest.current += 1
      resetRepositoryState()
      setActiveRepo(null)
      setView({ state: 'idle' })
    },
    [openRepos, activeRepo, open, resetRepositoryState]
  )

  const currentRepo = activeRepo
  const staged = view.state === 'ready' ? view.snapshot.summary.staged.length : 0
  const unstaged = view.state === 'ready' ? view.snapshot.summary.unstaged.length : 0
  const untracked = view.state === 'ready' ? view.snapshot.summary.untracked.length : 0
  const conflicts = view.state === 'ready' ? view.snapshot.summary.conflicts.length : 0
  const operation = view.state === 'ready' ? view.snapshot.operation : null
  const canAmend = view.state === 'ready' && view.snapshot.status.branch.oid !== null
  const branchStatus = view.state === 'ready' ? view.snapshot.status.branch : null
  const pushCount = view.state === 'ready' ? view.snapshot.pushCount : null
  const branchLabel =
    branchStatus === null ? null : (branchStatus.head ?? branchStatus.oid?.slice(0, 7) ?? null)
  const fileCount = staged + unstaged + untracked + conflicts
  // The selected commit's file list and the file open in the work area.
  const currentCommitChanges =
    selectedCommit !== null && commitChanges?.oid === selectedCommit.oid ? commitChanges : null
  const commitFileCount = currentCommitChanges?.data?.files.length ?? 0
  const selectedCommitFile =
    currentCommitChanges?.data?.files.find((file) => file.path === selectedCommitPath) ?? null

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

  /** Reads the commit graph of the open repository without flashing "loading". */
  const loadHistory = useCallback(async () => {
    const repo = repoRef.current
    if (repo === null) return
    const request = historyRequest.current + 1
    historyRequest.current = request
    setHistoryView((current) => (current?.state === 'ready' ? current : { state: 'loading' }))
    const result = await window.seam.readRepositoryHistory(repo)
    if (request !== historyRequest.current) return
    if (result.ok) setHistoryView({ state: 'ready', data: result.value })
    else setHistoryView({ state: 'error', message: result.message })
  }, [])

  const refresh = useCallback(async () => {
    const repo = repoRef.current
    if (repo === null) return
    const request = statusRequest.current
    const result = await window.seam.readRepositoryStatus(repo)
    if (request !== statusRequest.current) return
    if (result.ok) {
      setView({ state: 'ready', snapshot: result.value })
    }
  }, [])

  /** Loads the branch list for the current repository. */
  const loadBranches = useCallback(async () => {
    const repo = repoRef.current
    if (repo === null) return
    setLoadingBranches(true)
    setBranchesError(null)
    try {
      const result = await window.seam.listBranches(repo)
      if (result.ok) {
        setBranches({
          local: result.value.local.map((b) => ({ name: b.name, current: b.current })),
          remote: result.value.remote.map((b) => ({ name: b.name, remote: b.remote ?? '' }))
        })
      } else {
        console.error('Failed to load branches:', result.message)
        setBranches({ local: [], remote: [] })
        setBranchesError(result.message)
      }
    } catch (error) {
      console.error('Error loading branches:', error)
      setBranches({ local: [], remote: [] })
      setBranchesError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingBranches(false)
    }
  }, [])

  /** Removes a repository from the recent list. */
  const removeRecent = useCallback(async (repo: string) => {
    const result = await window.seam.removeRecentRepository(repo)
    if (result.ok) {
      setRecent((prev) => prev.filter((r) => r !== repo))
    }
  }, [])

  /** Checks out a branch (local stays local, a remote one downloads first). */
  const checkoutBranch = useCallback(
    async (branchName: string) => {
      const repo = repoRef.current
      if (repo === null) return
      setWriteError(null)
      // A local branch can contain "/" (feature/x), so the slash alone does not
      // say remote: the name is remote when no local branch has that exact name.
      const isLocal = branches !== null && branches.local.some((b) => b.name === branchName)
      const result = await window.seam.checkoutBranch({
        repo,
        branch: branchName,
        createTracking: !isLocal
      })
      if (result.ok) {
        setBranches(null) // Reset to reload after checkout
        await refresh()
      } else {
        setWriteError({ code: result.code, message: result.message })
      }
    },
    [refresh, branches]
  )

  /** Rereads the dialog's list without making it flash "loading". */
  const reloadConflicts = useCallback(async () => {
    const repo = repoRef.current
    if (repo === null) return
    const result = await window.seam.readConflicts(repo)
    if (result.ok) setConflictsView({ state: 'ready', data: result.value })
    else setConflictsError(result.message)
  }, [])

  /** Opens the dialog and reads the conflicts, including the resolved ones. */
  const openConflicts = useCallback(async (prompt: 'abort' | null = null) => {
    const repo = repoRef.current
    if (repo === null) return
    setConflictsPrompt(prompt)
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

  /** Opens the branch manager and reads the list it shows. */
  const openBranch = useCallback(async () => {
    if (repoRef.current === null) return
    setBranchOpen(true)
    setBranchError(null)
    await loadBranches()
  }, [loadBranches])

  /** Creates a branch, then refreshes the status and the branch list. */
  const createBranch = useCallback(
    async (name: string, startPoint: string | null, checkout: boolean): Promise<boolean> => {
      const repo = repoRef.current
      if (repo === null) return false
      setBranchBusy(true)
      setBranchError(null)
      try {
        const result = await window.seam.createBranch({ repo, name, startPoint, checkout })
        if (!result.ok) {
          setBranchError(result.message)
          return false
        }
        await refresh()
        await loadBranches()
        await loadHistory()
        showSyncNotice('ok', t('branch.created', { branch: name }))
        return true
      } finally {
        setBranchBusy(false)
      }
    },
    [refresh, loadBranches, loadHistory, showSyncNotice, t]
  )

  /** Renames a branch and refreshes the list the menu shows. */
  const renameBranch = useCallback(
    async (name: string, newName: string): Promise<boolean> => {
      const repo = repoRef.current
      if (repo === null) return false
      setBranchBusy(true)
      setBranchError(null)
      try {
        const result = await window.seam.renameBranch({ repo, name, newName })
        if (!result.ok) {
          setBranchError(result.message)
          return false
        }
        await refresh()
        await loadBranches()
        await loadHistory()
        showSyncNotice('ok', t('branch.renamed', { name, newName }))
        return true
      } finally {
        setBranchBusy(false)
      }
    },
    [refresh, loadBranches, loadHistory, showSyncNotice, t]
  )

  /** Deletes a branch, safely or by force, and refreshes the list. */
  const deleteBranch = useCallback(
    async (name: string, force: boolean): Promise<boolean> => {
      const repo = repoRef.current
      if (repo === null) return false
      setBranchBusy(true)
      setBranchError(null)
      try {
        const result = await window.seam.deleteBranch({ repo, name, force })
        if (!result.ok) {
          setBranchError(result.message)
          return false
        }
        await refresh()
        await loadBranches()
        await loadHistory()
        showSyncNotice('ok', t('branch.deleted', { branch: name }))
        return true
      } finally {
        setBranchBusy(false)
      }
    },
    [refresh, loadBranches, loadHistory, showSyncNotice, t]
  )

  /** Opens the merge dialog and reads the branches it can merge in. */
  const openMerge = useCallback(async () => {
    const repo = repoRef.current
    if (repo === null) return
    setMergeView({ state: 'loading' })
    setMergeError(null)
    setMergeOutcome(null)
    const result = await window.seam.readMergeState(repo)
    if (result.ok) setMergeView({ state: 'ready', data: result.value })
    else {
      setMergeView(null)
      setWriteError({ code: result.code, message: result.message })
    }
  }, [])

  /** Starts the merge and hands a conflict over to the conflicts list. */
  const performMerge = useCallback(
    async (source: string, strategy: MergeStrategy, message: string) => {
      const repo = repoRef.current
      if (repo === null) return
      const branch = mergeView?.state === 'ready' ? mergeView.data.currentBranch : null
      setMergeBusy(true)
      setMergeError(null)
      setMergeOutcome(null)
      try {
        const result = await window.seam.mergeBranch({ repo, source, strategy, message })
        if (!result.ok) {
          setMergeError(result.message)
          return
        }
        const outcome = result.value
        setMergeOutcome(outcome)
        await refresh()
        await loadBranches()
        if (outcome.ok) {
          setMergeView(null)
          showSyncNotice(
            'ok',
            branch === null ? t('merge.completed') : t('merge.done', { source, branch })
          )
          return
        }
        if (outcome.operation !== null || outcome.conflicts > 0) {
          setMergeView(null)
          await openConflicts()
          return
        }
        setMergeError(outcome.output === '' ? t('merge.failed') : outcome.output)
      } finally {
        setMergeBusy(false)
      }
    },
    [mergeView, refresh, loadBranches, openConflicts, showSyncNotice, t]
  )

  /** Reads the GitFlow configuration and opens the popup on the right face. */
  const openGitFlow = useCallback(async () => {
    const repo = repoRef.current
    if (repo === null) return
    setGitflowView({ state: 'loading' })
    setGitflowError(null)
    setGitflowOutcome(null)
    const result = await window.seam.readGitFlow(repo)
    if (result.ok) setGitflowView({ state: 'ready', data: result.value })
    else {
      setGitflowView(null)
      setWriteError({ code: result.code, message: result.message })
    }
  }, [])

  /** Writes the GitFlow configuration and creates develop when it is missing. */
  const initGitFlow = useCallback(
    async (config: GitFlowConfig) => {
      const repo = repoRef.current
      if (repo === null) return
      setGitflowBusy(true)
      setGitflowError(null)
      try {
        const result = await window.seam.initGitFlow({ repo, ...config })
        if (!result.ok) {
          setGitflowError(result.message)
          return
        }
        setGitflowView(null)
        await refresh()
        await loadBranches()
        showSyncNotice('ok', t('gitflow.initialized'))
      } finally {
        setGitflowBusy(false)
      }
    },
    [refresh, loadBranches, showSyncNotice, t]
  )

  /** Starts a feature, release or hotfix branch. */
  const startGitFlow = useCallback(
    async (kind: GitFlowKind, name: string) => {
      const repo = repoRef.current
      if (repo === null) return
      setGitflowBusy(true)
      setGitflowError(null)
      try {
        const result = await window.seam.startGitFlow({ repo, kind, name })
        if (!result.ok) {
          setGitflowError(result.message)
          return
        }
        setGitflowView(null)
        await refresh()
        await loadBranches()
        showSyncNotice('ok', t('gitflow.started', { branch: result.value }))
      } finally {
        setGitflowBusy(false)
      }
    },
    [refresh, loadBranches, showSyncNotice, t]
  )

  /** Finishes the current GitFlow branch, or resumes a stopped finish. */
  const finishGitFlow = useCallback(
    async (tag: string | null) => {
      const repo = repoRef.current
      if (repo === null || gitflowView?.state !== 'ready') return
      const branch = gitflowView.data.pending?.branch ?? gitflowView.data.currentBranch ?? ''
      setGitflowBusy(true)
      setGitflowError(null)
      setGitflowOutcome(null)
      try {
        const result = await window.seam.finishGitFlow({ repo, tag })
        if (!result.ok) {
          setGitflowError(result.message)
          return
        }
        const outcome = result.value
        setGitflowOutcome(outcome)
        await refresh()
        await loadBranches()
        if (outcome.finished) {
          gitflowAfterMerge.current = false
          setGitflowView(null)
          showSyncNotice('ok', t('gitflow.finished', { branch }))
          return
        }
        if (outcome.operation !== null || outcome.conflicts > 0) {
          gitflowAfterMerge.current = true
          setGitflowView(null)
          await openConflicts()
        }
      } finally {
        setGitflowBusy(false)
      }
    },
    [gitflowView, refresh, loadBranches, openConflicts, showSyncNotice, t]
  )

  /**
   * Resumes a GitFlow finish that a merge commit was blocking. It reads the
   * pending record first, so an ordinary commit never starts a finish.
   */
  const resumeGitFlow = useCallback(async () => {
    const repo = repoRef.current
    if (repo === null) return
    setGitflowBusy(true)
    try {
      const state = await window.seam.readGitFlow(repo)
      if (!state.ok) {
        showSyncNotice('error', state.message)
        return
      }
      if (state.value.pending === null) {
        gitflowAfterMerge.current = false
        return
      }
      const branch = state.value.pending.branch
      const result = await window.seam.finishGitFlow({ repo, tag: null })
      if (!result.ok) {
        showSyncNotice('error', result.message)
        return
      }
      const outcome = result.value
      setGitflowOutcome(outcome)
      await refresh()
      await loadBranches()
      if (outcome.finished) {
        gitflowAfterMerge.current = false
        showSyncNotice('ok', t('gitflow.finished', { branch }))
        return
      }
      if (outcome.operation !== null || outcome.conflicts > 0) {
        await openConflicts()
        return
      }
      gitflowAfterMerge.current = false
      showSyncNotice('error', outcome.output === '' ? t('gitflow.failed') : outcome.output)
    } finally {
      setGitflowBusy(false)
    }
  }, [refresh, loadBranches, openConflicts, showSyncNotice, t])

  /** Closes the push dialog and forgets what the last push printed. */
  const closePush = useCallback(() => {
    setPushView(null)
    setPushError(null)
    setPushOutcome(null)
    setPushProgress('')
  }, [])

  /** Opens the push dialog and reads the branch, its remotes and its commits. */
  const openPush = useCallback(async () => {
    const repo = repoRef.current
    if (repo === null) return
    setPushView({ state: 'loading' })
    setPushError(null)
    setPushOutcome(null)
    setPushProgress('')
    const result = await window.seam.readPushState(repo)
    if (result.ok) setPushView({ state: 'ready', data: result.value })
    else {
      setPushView(null)
      setWriteError({ code: result.code, message: result.message })
    }
  }, [])

  // The panel is read as soon as a repository opens and again whenever HEAD
  // moves, so a commit or a checkout shows up without reopening anything.
  useEffect(() => {
    if (currentRepo !== null) void loadHistory()
  }, [currentRepo, branchStatus?.oid, loadHistory])

  // Selecting a commit reads the files it changed and opens the first one.
  // The previous selection's state is cleared by selectCommit before the read.
  useEffect(() => {
    const repo = currentRepo
    if (repo === null || selectedCommit === null) return
    let active = true
    const oid = selectedCommit.oid
    void window.seam.readCommitChanges(repo, oid).then((result) => {
      if (!active) return
      if (result.ok) {
        setCommitChanges({ oid, data: result.value, error: null })
        setSelectedCommitPath(result.value.files[0]?.path ?? null)
      } else {
        setCommitChanges({ oid, data: null, error: result.message })
      }
    })
    return () => {
      active = false
    }
  }, [currentRepo, selectedCommit])

  /** Shows or hides the persistent history panel, rereading it when shown. */
  const toggleHistory = useCallback(() => {
    if (!historyVisible) void loadHistory()
    setHistoryVisible((visible) => !visible)
  }, [historyVisible, loadHistory])

  /** Returns the file sidebar to the working tree's own changes. */
  const showWorkingTree = useCallback(() => {
    setSelectedCommit(null)
    setCommitChanges(null)
    setSelectedCommitPath(null)
    setCommitFileInfo(null)
  }, [])

  /** Opens one commit's files, or returns to the working tree when null. */
  const selectCommit = useCallback(
    (commit: HistoryCommit | null) => {
      if (commit === null) {
        showWorkingTree()
        return
      }
      if (selectedCommit?.oid === commit.oid) return
      setSelectedCommit(commit)
      setCommitChanges(null)
      setSelectedCommitPath(null)
      setCommitFileInfo(null)
    },
    [selectedCommit, showWorkingTree]
  )

  /**
   * The graph checked out one commit or branch. The working tree and the branch
   * list have moved with HEAD, so both are reread, and the graph is replaced by
   * a fresh one. The popup confirms what was checked out.
   */
  const historyCheckedOut = useCallback(
    async (result: HistoryCheckout) => {
      const repo = repoRef.current
      if (repo === null) return
      showWorkingTree()
      await Promise.all([refresh(), loadBranches()])
      await loadHistory()
      showSyncNotice(
        'ok',
        result.branch === null
          ? t('history.checkout.done', { id: result.shortId })
          : t('history.checkout.doneBranch', { branch: result.branch })
      )
    },
    [refresh, loadBranches, loadHistory, showWorkingTree, showSyncNotice, t]
  )

  /**
   * Runs the push with the dialog's choices. A rejected reference stays in the
   * outcome so the dialog can offer update or force; only a failure to start
   * Git becomes an error above it. Either way the operation popup says what
   * happened, and a failure stays until the user dismisses it.
   */
  const performPush = useCallback(
    async (choice: PushChoice) => {
      const repo = repoRef.current
      if (repo === null) return
      setPushError(null)
      setPushOutcome(null)
      setPushProgress('')
      showSyncNotice('busy', t('push.pushing'))
      const result = await window.seam.push({ repo, ...choice })
      if (!result.ok) {
        setPushError(result.message)
        showSyncNotice('error', result.message)
        return
      }

      const outcome = result.value
      setPushOutcome(outcome)
      if (outcome.cancelled) {
        setPushError(t('push.cancelled'))
        showSyncNotice('error', t('push.cancelled'))
        return
      }
      if (outcome.timedOut) {
        setPushError(t('push.timedOut'))
        showSyncNotice('error', t('push.timedOut'))
        return
      }
      if (outcome.ok) {
        closePush()
        await refresh()
        await loadHistory()
        showSyncNotice('ok', t('push.done', { remote: choice.remote, branch: choice.remoteBranch }))
        return
      }
      if (outcome.authFailed) {
        setPushError(t('push.authFailed'))
        showSyncNotice('error', t('push.authFailed'))
        return
      }

      // A rejected reference is explained with the same words as the dialog.
      const rejected = outcome.refs.find((ref) => ref.rejection !== null)
      if (rejected !== undefined && rejected.rejection !== null) {
        showSyncNotice('error', t(`push.rejected.${PUSH_REJECTION_KEYS[rejected.rejection]}`))
        return
      }
      showSyncNotice('error', outcome.output !== '' ? outcome.output : t('push.rejected.other'))
    },
    [refresh, closePush, loadHistory, showSyncNotice, t]
  )

  /** Runs a push and holds the dialog's buttons until it is over. */
  const runPush = useCallback(
    async (choice: PushChoice) => {
      setPushBusy(true)
      try {
        await performPush(choice)
      } finally {
        setPushBusy(false)
      }
    },
    [performPush]
  )

  /** Stops a push whose remote will not answer. */
  const cancelPush = useCallback(() => {
    const repo = repoRef.current
    if (repo !== null) void window.seam.cancelPush(repo)
  }, [])

  /** Fetches every configured remote and rereads the status afterwards. */
  const fetchRemotes = useCallback(async () => {
    const repo = repoRef.current
    if (repo === null) return
    setSyncBusy(true)
    showSyncNotice('busy', t('topbar.sync.fetching'))
    try {
      const result = await window.seam.fetchRemotes(repo)
      if (!result.ok) {
        showSyncNotice('error', result.message)
        return
      }
      await refresh()
      await loadHistory()
      showSyncNotice('ok', t('topbar.sync.fetchDone'))
    } finally {
      setSyncBusy(false)
    }
  }, [refresh, loadHistory, t, showSyncNotice])

  /** Fetches and integrates the branch's upstream; a conflict opens its list. */
  const pullFromUpstream = useCallback(async () => {
    const repo = repoRef.current
    if (repo === null) return
    setSyncBusy(true)
    showSyncNotice('busy', t('topbar.sync.pulling'))
    try {
      const result = await window.seam.pull({ repo, strategy: pushStrategy })
      if (!result.ok) {
        showSyncNotice('error', result.message)
        return
      }
      const update = result.value
      if (update.operation !== null || update.conflicts > 0) {
        // The conflict list takes over; a success popup would be misleading.
        hideSyncNotice()
        await refresh()
        await openConflicts()
        return
      }
      await refresh()
      if (update.ok) showSyncNotice('ok', t('topbar.sync.pullDone'))
      else
        showSyncNotice('error', update.output !== '' ? update.output : t('topbar.sync.pullFailed'))
    } finally {
      setSyncBusy(false)
    }
  }, [pushStrategy, refresh, openConflicts, showSyncNotice, hideSyncNotice, t])

  /**
   * Update and push: fetches, integrates the upstream with the chosen strategy
   * and pushes again. A conflict hands over to the phase 5 list, and finishing
   * it reopens this dialog with the list refreshed.
   */
  const updateAndPush = useCallback(
    async (choice: PushChoice) => {
      const repo = repoRef.current
      if (repo === null) return
      setPushBusy(true)
      setPushError(null)
      setPushProgress('')
      showSyncNotice('busy', t('push.updating'))
      try {
        const result = await window.seam.updateForPush({ repo, strategy: pushStrategy })
        if (!result.ok) {
          setPushError(result.message)
          showSyncNotice('error', result.message)
          return
        }

        const update = result.value
        if (update.operation !== null || update.conflicts > 0) {
          pushAfterConflicts.current = true
          hideSyncNotice()
          closePush()
          await refresh()
          await openConflicts()
          return
        }
        if (!update.ok) {
          const message = update.output === '' ? t('push.updateFailed') : update.output
          setPushError(message)
          showSyncNotice('error', message)
          return
        }
        await performPush(choice)
      } finally {
        setPushBusy(false)
      }
    },
    [
      pushStrategy,
      closePush,
      refresh,
      openConflicts,
      performPush,
      showSyncNotice,
      hideSyncNotice,
      t
    ]
  )

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
    setConflictsPrompt(null)
    setGitOutput(null)
  }, [])

  /**
   * Reads what continuing, skipping or aborting did. A rebase that stopped on
   * the next commit reloads the list and keeps the dialog; a hook refusal with
   * no conflict left goes to the output dialog; a finished operation closes the
   * dialog and says so in the popup.
   */
  const handleOperationOutcome = useCallback(
    async (outcome: OperationOutcome, operation: GitOperation | null, successKey: string) => {
      if (outcome.failed && outcome.conflicts === 0) {
        setGitOutput(outcome.output === '' ? t('conflicts.outputEmpty') : outcome.output)
        return
      }
      if (!outcome.finished) {
        await refresh()
        await reloadConflicts()
        setConflictsNotice(
          t('conflicts.stopped', {
            operation: t(`changes.operation.${outcome.operation ?? operation ?? 'merge'}`)
          })
        )
        return
      }
      closeConflicts()
      await refresh()
      showSyncNotice('ok', t(successKey))
      // The operation started as Update and push: once it is over, the dialog
      // reopens with the pending commits as they are now.
      if (pushAfterConflicts.current) {
        pushAfterConflicts.current = false
        await openPush()
      }
    },
    [refresh, reloadConflicts, closeConflicts, openPush, showSyncNotice, t]
  )

  /** Closes the conflicts dialog in the way the operation requires. */
  const finishConflicts = useCallback(async () => {
    const repo = repoRef.current
    if (repo === null || conflictsView?.state !== 'ready') return
    const operation = conflictsView.data.sides.operation
    setConflictsBusy(true)
    setConflictsError(null)
    setConflictsNotice(null)
    try {
      // A merge is finished with the commit box, which takes MERGE_MSG as its
      // starting point and lets the user edit it before committing.
      if (operation === 'merge') {
        const message = await window.seam.readMergeMessage(repo)
        if (!message.ok) {
          setConflictsError(message.message)
          return
        }
        setCommitMessage(message.value)
        void window.seam.writeCommitDraft({ repo, message: message.value })
        closeConflicts()
        showSyncNotice('ok', t('conflicts.reviewMergeMessage'))
        requestAnimationFrame(() => {
          const box = document.getElementById('commit-message')
          if (box instanceof HTMLTextAreaElement) {
            box.focus()
            box.select()
          }
        })
        return
      }

      const result = await window.seam.finishOperation(repo)
      if (!result.ok) {
        setConflictsError(result.message)
        return
      }
      await handleOperationOutcome(
        result.value,
        operation,
        operation === null ? 'conflicts.finished.stash' : `conflicts.finished.${operation}`
      )
    } finally {
      setConflictsBusy(false)
    }
  }, [conflictsView, closeConflicts, handleOperationOutcome, showSyncNotice, t])

  /** Leaves out the commit that stopped a rebase, cherry-pick or revert. */
  const skipConflicts = useCallback(async () => {
    const repo = repoRef.current
    if (repo === null || conflictsView?.state !== 'ready') return
    const operation = conflictsView.data.sides.operation
    setConflictsBusy(true)
    setConflictsError(null)
    setConflictsNotice(null)
    try {
      const result = await window.seam.skipOperation(repo)
      if (!result.ok) {
        setConflictsError(result.message)
        return
      }
      await handleOperationOutcome(
        result.value,
        operation,
        operation === null ? 'conflicts.finished.stash' : `conflicts.finished.${operation}`
      )
    } finally {
      setConflictsBusy(false)
    }
  }, [conflictsView, handleOperationOutcome])

  /** Aborts the operation, or undoes a conflicted stash pop. */
  const abortConflicts = useCallback(async () => {
    const repo = repoRef.current
    if (repo === null || conflictsView?.state !== 'ready') return
    const operation = conflictsView.data.sides.operation
    setConflictsBusy(true)
    setConflictsError(null)
    setConflictsNotice(null)
    try {
      const result = await window.seam.abortOperation(repo)
      if (!result.ok) {
        setConflictsError(result.message)
        return
      }
      if (result.value.failed) {
        setGitOutput(result.value.output === '' ? t('conflicts.outputEmpty') : result.value.output)
        return
      }
      pushAfterConflicts.current = false
      gitflowAfterMerge.current = false
      closeConflicts()
      await refresh()
      showSyncNotice('ok', t(`conflicts.aborted.${operation ?? 'stash'}`))
    } finally {
      setConflictsBusy(false)
    }
  }, [conflictsView, closeConflicts, refresh, showSyncNotice, t])

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

  // The operation can also end from a terminal while the dialog is open: the
  // watcher refreshes the status, the marker disappears and the dialog closes
  // with a note instead of pretending the list is still live.
  const dialogOperation =
    conflictsView?.state === 'ready' ? conflictsView.data.sides.operation : null
  useEffect(() => {
    if (conflictsView === null || dialogOperation === null || view.state !== 'ready') return
    if (conflictsBusy || view.snapshot.operation !== null) return
    // The refresh that ended the operation arrives as a new snapshot; closing
    // the dialog is a reaction to it, so it runs after the effect instead of
    // triggering a cascading render during the same commit.
    queueMicrotask(() => {
      closeConflicts()
      showSyncNotice('ok', t('conflicts.endedOutside'))
    })
  }, [view, conflictsView, dialogOperation, conflictsBusy, closeConflicts, showSyncNotice, t])

  // The repositories and the repository passed on the command line are read
  // only after Git itself is usable, so the first screen is either the app or
  // the help screen that explains how to install Git.
  const finishStartup = useCallback(async () => {
    setRecent(await window.seam.listRecentRepositories())
    const initial = await window.seam.initialRepository()
    if (initial) await open(initial)
  }, [open])

  const retryGit = useCallback(async () => {
    setGitGate({ state: 'checking' })
    const status = await window.seam.readGitStatus()
    if (!status.ok) {
      setGitGate({ state: 'blocked', code: status.code, message: status.message })
      return
    }
    setGitGate({ state: 'ready' })
    await finishStartup()
  }, [finishStartup])

  useEffect(() => {
    void (async () => {
      const settings = await window.seam.readSettings()
      if (settings.ok) {
        if (settings.value.theme) {
          document.documentElement.style.setProperty('color-scheme', settings.value.theme)
          document.documentElement.setAttribute('data-theme', settings.value.theme)
        }
        if (settings.value.language) {
          i18n.changeLanguage(settings.value.language)
        }
      }

      const status = await window.seam.readGitStatus()
      if (!status.ok) {
        setGitGate({ state: 'blocked', code: status.code, message: status.message })
        return
      }
      setGitGate({ state: 'ready' })
      await finishStartup()
    })()
  }, [finishStartup, i18n])

  useEffect(() => {
    // The watcher refreshes a change to the working tree or the git folder as
    // it happens; regaining focus is the fallback for when a watch could not be
    // set up.
    const handleFocus = () => void refresh()
    window.addEventListener('focus', handleFocus)
    const stopWatching = window.seam.onRepositoryChanged(() => void refresh())
    return () => {
      window.removeEventListener('focus', handleFocus)
      stopWatching()
    }
  }, [refresh])

  // A push prints while it runs, so its output is appended to the dialog. The
  // last few thousand characters are enough to see what the remote is doing.
  useEffect(() => {
    const stop = window.seam.onPushProgress(({ repo, text }) => {
      if (repoRef.current !== repo) return
      setPushProgress((previous) => `${previous}${text}`.slice(-20_000))
    })
    return stop
  }, [])

  const choose = useCallback(async () => {
    const repo = await window.seam.chooseRepository()
    if (repo === null) return
    setRecent(await window.seam.listRecentRepositories())
    await open(repo)
  }, [open])

  /** Opens the clone dialog with no leftovers from a previous attempt. */
  const openClone = useCallback(() => {
    setCloneError(null)
    setCloneOpen(true)
  }, [])

  /** Clones a repository, then opens it and moves it to the top of the recents. */
  const clone = useCallback(
    async (request: CloneRequest) => {
      setCloneBusy(true)
      setCloneError(null)
      try {
        const result = await window.seam.cloneRepository(request)
        if (!result.ok) {
          setCloneError(result.message)
          return
        }
        setCloneOpen(false)
        setRecent(await window.seam.listRecentRepositories())
        await open(result.value)
      } finally {
        setCloneBusy(false)
      }
    },
    [open]
  )

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

  // Throws away the pending changes of the rows that asked for it, restoring
  // their working-tree contents from the index, then rereads the repository.
  const discardFiles = useCallback(
    async (paths: readonly string[]) => {
      const repo = repoRef.current
      if (repo === null) return

      const result = await window.seam.discardFiles({ repo, paths })
      if (result.ok) {
        setWriteError(null)
        // The row is gone from the unstaged list, so the file it opened has
        // nothing left to compare: close the tab instead of showing an empty
        // viewer for a file the user just threw away.
        setSelected((current) =>
          current !== null && paths.includes(current.path) ? null : current
        )
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

      // Read settings to get the signoff and runHooks preferences
      const settingsResult = await window.seam.readSettings()
      const signoff = settingsResult.ok ? settingsResult.value.signoff : false
      const runHooks = settingsResult.ok ? settingsResult.value.runHooks : true

      setCommitting(true)
      showSyncNotice('busy', t('commit.committing'))
      try {
        // A merge in progress is finished by this commit, never by an amend.
        const amending = operation === null && amend
        const result = await window.seam.commit({
          repo,
          message: commitMessage,
          amend: amending,
          author: '',
          signoff,
          runHooks,
          ...(crlf === undefined ? {} : { crlf })
        })
        if (!result.ok) {
          pushAfterCommit.current = false
          setWriteError({ code: result.code, message: result.message })
          showSyncNotice('error', result.message)
          return
        }

        const outcome = result.value
        setCommitOutput(outcome.output === '' ? null : outcome.output)

        // A cancelled or timed-out commit keeps the message; the wait is over and
        // the box goes back to normal.
        if (outcome.cancelled) {
          pushAfterCommit.current = false
          hideSyncNotice()
          return
        }
        if (outcome.timedOut) {
          pushAfterCommit.current = false
          setWriteError({ code: 'command-failed', message: t('commit.timedOut') })
          showSyncNotice('error', t('commit.timedOut'))
          return
        }

        if (!outcome.created) {
          // Staged files that would commit CRLF: Seam's own warning, answered by
          // the dialog with a fix, a commit as they are, or nothing at all.
          if (outcome.crlf.length > 0) {
            hideSyncNotice()
            setCrlfPrompt(outcome.crlf)
            return
          }
          // Git refused. A missing identity is the one refusal Seam can fix here.
          if (outcome.reason === 'identity') {
            hideSyncNotice()
            const again = await window.seam.readIdentity(repo)
            setIdentityPrompt({
              name: again.ok ? (again.value.name ?? '') : '',
              email: again.ok ? (again.value.email ?? '') : ''
            })
            return
          }
          pushAfterCommit.current = false
          setWriteError({ code: 'command-failed', message: outcome.message })
          showSyncNotice('error', outcome.message)
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
        showSyncNotice(
          'ok',
          t('commit.committed', { id: outcome.shortId }),
          outcome.shortId === '' ? undefined : 'copy-commit'
        )
        // The message just confirmed is the newest one the history offers.
        const history = await window.seam.readCommitHistory(repo)
        if (history.ok) setCommitHistory(history.value)

        // Commit and Push chains the push dialog; a merge that finished an
        // Update and push reopens it too, with the merge commit already in. A
        // GitFlow finish that stopped on a merge resumes after its commit.
        if (gitflowAfterMerge.current) {
          gitflowAfterMerge.current = false
          await resumeGitFlow()
        } else if (pushAfterCommit.current || pushAfterConflicts.current) {
          pushAfterCommit.current = false
          pushAfterConflicts.current = false
          await openPush()
        }
      } finally {
        setCommitting(false)
      }
    },
    [
      commitMessage,
      amend,
      operation,
      refresh,
      openPush,
      resumeGitFlow,
      showSyncNotice,
      hideSyncNotice,
      t
    ]
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

  if (gitGate.state !== 'ready') {
    return (
      <GitRequired
        code={gitGate.state === 'blocked' ? gitGate.code : null}
        message={gitGate.state === 'blocked' ? gitGate.message : ''}
        checking={gitGate.state === 'checking'}
        onRetry={() => void retryGit()}
      />
    )
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
      <RepositoryTabs
        open={openRepos}
        active={activeRepo}
        recent={recent}
        closed={closedRepos}
        onActivate={(repo) => {
          if (repo !== activeRepo) void open(repo)
        }}
        onClose={closeRepo}
        onOpenExisting={() => void choose()}
        onClone={openClone}
        onRestore={(repo) => void open(repo)}
        onRemoveRecent={(repo) => void removeRecent(repo)}
      />

      <TopBar
        // A new repository gets a fresh bar: folded folders and an open menu
        // belong to the repository they came from, not to the one arriving.
        key={currentRepo ?? ''}
        branch={branchLabel}
        canRefresh={currentRepo !== null}
        canHistory={currentRepo !== null}
        canPush={currentRepo !== null && operation === null && pushCount !== null && pushCount > 0}
        pushCount={pushCount}
        syncing={syncBusy}
        canFetch={currentRepo !== null && operation === null}
        canPull={currentRepo !== null && operation === null && branchStatus?.upstream != null}
        canBranch={currentRepo !== null && operation === null}
        canMerge={currentRepo !== null && operation === null && branchStatus?.head != null}
        canGitFlow={currentRepo !== null && operation === null}
        onFetch={() => void fetchRemotes()}
        onPull={() => void pullFromUpstream()}
        onBranch={() => void openBranch()}
        onMerge={() => void openMerge()}
        onGitFlow={() => void openGitFlow()}
        onRefresh={() => void refresh()}
        onHistory={toggleHistory}
        historyVisible={historyVisible}
        onPush={() => void openPush()}
        onSettings={() => setSettingsOpen(true)}
        onLoadBranches={() => void loadBranches()}
        onCheckoutBranch={(branch) => void checkoutBranch(branch)}
        branches={branches}
        loadingBranches={loadingBranches}
        branchesError={branchesError}
      />

      <div className={historyVisible && currentRepo !== null ? 'shell' : 'shell shell--no-history'}>
        {historyVisible && currentRepo !== null && (
          <aside className="history-panel" aria-label={t('history.title')}>
            <HistoryPanel
              repo={currentRepo}
              view={historyView ?? { state: 'loading' }}
              selectedOid={selectedCommit?.oid ?? null}
              onSelect={selectCommit}
              onCheckedOut={(result) => void historyCheckedOut(result)}
            />
          </aside>
        )}

        <aside
          className="sidebar"
          aria-label={selectedCommit === null ? t('changes.title') : t('history.commitChanges')}
        >
          <div className="sidebar__heading">
            <span>{selectedCommit === null ? t('changes.title') : t('history.commitChanges')}</span>
            <div className="sidebar__heading-actions">
              <span className="sidebar__count" data-testid="changes-count">
                {selectedCommit === null
                  ? t('changes.files', { count: fileCount })
                  : currentCommitChanges?.data !== null && currentCommitChanges !== null
                    ? t('history.filesCount', { count: commitFileCount })
                    : t('history.files')}
              </span>
              {selectedCommit !== null && (
                <button
                  type="button"
                  className="icon-button sidebar__heading-close"
                  data-testid="history-current-changes"
                  aria-label={t('history.backToCurrentChanges')}
                  title={t('history.backToCurrentChanges')}
                  onClick={showWorkingTree}
                >
                  <svg
                    width="11"
                    height="11"
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
              )}
            </div>
          </div>

          {selectedCommit === null ? (
            <>
              <div className="sidebar__scroll">{renderSidebar()}</div>

              {currentRepo !== null && (
                <div className="sidebar__commit">
                  <CommitBox
                    value={commitMessage}
                    onChange={writeMessage}
                    amend={amend}
                    onAmendChange={(next) => void changeAmend(next)}
                    canAmend={canAmend && operation === null}
                    head={head}
                    staged={staged}
                    conflicts={conflicts}
                    operation={operation}
                    onCommit={() => {
                      pushAfterCommit.current = false
                      void commit()
                    }}
                    onCommitAndPush={() => {
                      pushAfterCommit.current = true
                      void commit()
                    }}
                    onCancel={cancelCommit}
                    busy={committing}
                    output={commitOutput}
                    history={commitHistory}
                    onPickHistory={writeMessage}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="sidebar__scroll">
              <CommitFilesPanel
                commit={selectedCommit}
                changes={currentCommitChanges}
                selectedPath={selectedCommitPath}
                onSelect={setSelectedCommitPath}
              />
            </div>
          )}
        </aside>

        <main className="workarea">
          {renderWorkArea()}
          {syncNotice !== null && (
            <SyncToast
              key={syncNotice.id}
              tone={syncNotice.tone}
              text={syncNotice.text}
              dismissLabel={t('topbar.sync.dismiss')}
              action={
                syncNotice.action === 'copy-commit'
                  ? {
                      label: t(copied ? 'commit.copied' : 'commit.copy'),
                      testId: 'commit-copy',
                      onClick: copyShortId
                    }
                  : undefined
              }
              onDismiss={hideSyncNotice}
            />
          )}
        </main>
      </div>

      {renderStatusBar()}

      {identityPrompt !== null && (
        <IdentityDialog
          name={identityPrompt.name}
          email={identityPrompt.email}
          busy={savingIdentity}
          error={writeError?.message ?? null}
          onSave={(identity) => void saveIdentity(identity)}
          onCancel={() => {
            pushAfterCommit.current = false
            setIdentityPrompt(null)
          }}
        />
      )}

      {crlfPrompt !== null && (
        <EolDialog
          files={crlfPrompt}
          onAnswer={(answer) => void answerCrlf(answer)}
          onCancel={() => {
            pushAfterCommit.current = false
            setCrlfPrompt(null)
          }}
        />
      )}

      {pushView !== null && (
        <PushDialog
          key={
            pushView.state === 'ready'
              ? [
                  pushView.data.branch,
                  pushView.data.upstream,
                  pushView.data.remote,
                  pushView.data.remoteBranch,
                  pushView.data.remoteOid
                ].join('|')
              : 'loading'
          }
          state={pushView.state === 'ready' ? pushView.data : null}
          busy={pushBusy}
          error={pushError}
          outcome={pushOutcome}
          progress={pushProgress}
          strategy={pushStrategy}
          onStrategyChange={setPushStrategy}
          onPush={(choice) => void runPush(choice)}
          onUpdate={(choice) => void updateAndPush(choice)}
          onCancelPush={cancelPush}
          onClose={() => {
            pushAfterCommit.current = false
            pushAfterConflicts.current = false
            closePush()
          }}
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
          onFinish={() => void finishConflicts()}
          onAbort={() => void abortConflicts()}
          onSkip={() => void skipConflicts()}
          initialPrompt={conflictsPrompt}
          onClose={closeConflicts}
        />
      )}

      {gitOutput !== null && <OutputDialog output={gitOutput} onClose={() => setGitOutput(null)} />}
      {cloneOpen && (
        <CloneDialog
          busy={cloneBusy}
          error={cloneError}
          onClone={(request) => void clone(request)}
          onCancel={() => {
            setCloneOpen(false)
            setCloneError(null)
          }}
        />
      )}
      {settingsOpen && (
        <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      )}

      {branchOpen && (
        <BranchDialog
          branches={branches}
          loading={loadingBranches}
          busy={branchBusy}
          error={branchError}
          onCreate={createBranch}
          onRename={renameBranch}
          onDelete={deleteBranch}
          onClose={() => {
            if (branchBusy) return
            setBranchOpen(false)
            setBranchError(null)
          }}
        />
      )}

      {mergeView !== null && (
        <MergeDialog
          state={mergeView.state === 'ready' ? mergeView.data : null}
          busy={mergeBusy}
          error={mergeError}
          outcome={mergeOutcome}
          onMerge={(source, strategy, message) => void performMerge(source, strategy, message)}
          onResolve={() => {
            setMergeView(null)
            void openConflicts()
          }}
          onClose={() => {
            if (mergeBusy) return
            setMergeView(null)
            setMergeError(null)
            setMergeOutcome(null)
          }}
        />
      )}

      {gitflowView !== null && (
        <GitFlowDialog
          state={gitflowView.state === 'ready' ? gitflowView.data : null}
          busy={gitflowBusy}
          error={gitflowError}
          outcome={gitflowOutcome}
          onInit={(config) => void initGitFlow(config)}
          onStart={(kind, name) => void startGitFlow(kind, name)}
          onFinish={(tag) => void finishGitFlow(tag)}
          onResolve={() => {
            setGitflowView(null)
            void openConflicts()
          }}
          onClose={() => {
            if (gitflowBusy) return
            setGitflowView(null)
            setGitflowError(null)
            setGitflowOutcome(null)
          }}
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
              selectedFrom={selected?.from ?? null}
              selectedTo={selected?.to ?? null}
              onOpen={(path, from, to) => setSelected({ path, from, to })}
              onStage={(paths) => void writeStaging(paths, false)}
              onUnstage={(paths) => void writeStaging(paths, true)}
              onDiscard={(paths) => void discardFiles(paths)}
              onResolve={() => void openConflicts()}
              onAbort={() => void openConflicts('abort')}
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
    if (selectedCommit !== null) {
      if (selectedCommitFile === null) {
        return <p className="workarea__empty">{t('history.selectFile')}</p>
      }
      const { name, dir } = splitPath(selectedCommitFile.path)
      const badge = COMMIT_BADGE[selectedCommitFile.status]
      const files = currentCommitChanges?.data?.files ?? []
      return (
        <>
          <div className="workarea__tabbar">
            <div className="workarea__tab">
              <span className={`changes__badge changes__badge--${badge.tone}`}>{badge.letter}</span>
              <span className="workarea__tab-name" title={selectedCommitFile.path}>
                {name}
              </span>
              <span className="sr-only" data-testid="diff-path">
                {selectedCommitFile.path}
              </span>
              {dir !== '' && <span className="workarea__tab-dir">{dir}</span>}
              <button
                type="button"
                className="icon-button workarea__tab-close"
                data-testid="diff-close"
                aria-label={t('workarea.closeTab')}
                title={t('workarea.closeTab')}
                onClick={() => setSelectedCommitPath(null)}
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
              key={`${selectedCommit.oid}:${selectedCommitFile.path}`}
              repo={view.snapshot.repo}
              path={selectedCommitFile.path}
              from="commitParent"
              to="commit"
              commit={selectedCommit.oid}
              previousPath={selectedCommitFile.previousPath}
              onEdge={(direction) => {
                const index = files.findIndex((file) => file.path === selectedCommitFile.path)
                const next = index === -1 ? undefined : files[index + direction]
                if (next !== undefined) setSelectedCommitPath(next.path)
              }}
              onInfoChange={setCommitFileInfo}
            />
          </div>
        </>
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
    const info =
      selectedCommit !== null
        ? selectedCommitPath === null
          ? null
          : commitFileInfo
        : selected !== null && view.state === 'ready'
          ? fileInfo
          : null
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
