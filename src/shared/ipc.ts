// SPDX-License-Identifier: MIT

import type {
  ChangeSummary,
  CommitOutcome,
  ConflictAcceptOutcome,
  ConflictSide,
  ConflictSides,
  ConflictState,
  GitOperation,
  HeadCommit,
  Identity,
  IdentityScope,
  OperationOutcome,
  PushOutcome,
  PushState,
  PushTagMode,
  PushUpdateOutcome,
  RepoStatus,
  ResolveSimpleOutcome
} from './git'

/**
 * Version of the contract between the main process, the preload bridge and the
 * interface. Bump it whenever a message shape changes so the three layers can
 * detect a mismatch instead of failing silently.
 */
export const IPC_CONTRACT_VERSION = 19

/** Channel names shared by the main process and the preload bridge. */
export const IPC_CHANNELS = {
  chooseRepository: 'repo:choose',
  listRecentRepositories: 'repo:recent:list',
  readRepositoryStatus: 'repo:status',
  readFileComparison: 'diff:read',
  readStagingModel: 'staging:read',
  writeHunks: 'staging:write-hunks',
  writeIndex: 'staging:write-index',
  revertHunks: 'staging:revert-hunks',
  initialRepository: 'app:initial-repository',
  /** Sent from main to the interface when Git changed a repository on disk. */
  repositoryChanged: 'repo:changed',
  stageFiles: 'repo:stage',
  unstageFiles: 'repo:unstage',
  readCommitDraft: 'commit:draft:read',
  writeCommitDraft: 'commit:draft:write',
  createCommit: 'commit:create',
  cancelCommit: 'commit:cancel',
  readHeadCommit: 'commit:head',
  readCommitHistory: 'commit:history:read',
  readCommitTemplate: 'commit:template',
  readIdentity: 'identity:read',
  writeIdentity: 'identity:write',
  readSettings: 'settings:read',
  writeSettings: 'settings:write',
  readConflicts: 'conflicts:read',
  acceptConflict: 'conflicts:accept',
  resolveSimpleConflicts: 'conflicts:resolve-simple',
  revertConflict: 'conflicts:revert',
  readMergeEditor: 'merge:read',
  applyMerge: 'merge:apply',
  finishOperation: 'operation:finish',
  skipOperation: 'operation:skip',
  abortOperation: 'operation:abort',
  readMergeMessage: 'operation:merge-message',
  readPushState: 'push:read',
  runPush: 'push:run',
  cancelPush: 'push:cancel',
  updateForPush: 'push:update',
  /** Sent from main to the interface while a push prints its progress. */
  pushProgress: 'push:progress',
  /** Copies text from the interface through the main process's clipboard. */
  writeClipboardText: 'clipboard:write-text'
} as const

/** Why a call failed, so the interface can show a translated message. */
export type IpcErrorCode =
  'git-not-found' | 'git-too-old' | 'not-a-repository' | 'command-failed' | 'unknown'

/** Everything the changes screen needs about one repository, in one message. */
export interface RepositorySnapshot {
  readonly repo: string
  readonly status: RepoStatus
  readonly summary: ChangeSummary
  readonly operation: GitOperation | null
}

/**
 * A call either succeeds with a value or fails with a reason. Errors are data
 * rather than thrown across IPC, because Electron does not preserve an error's
 * class or custom fields.
 */
export type IpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: IpcErrorCode; readonly message: string }

/** Where a version of a file comes from, for the diff viewer. */
export type FileVersionSource = 'head' | 'index' | 'worktree' | 'stage1' | 'stage2' | 'stage3'

/** One side of a comparison, as the viewer needs it. */
export interface DiffSide {
  readonly lines: readonly string[]
  readonly finalNewline: boolean
}

/** Two versions of a file, ready to be diffed by the viewer. */
export interface FileComparison {
  readonly from: DiffSide | null
  readonly to: DiffSide | null
  readonly fromSize: number
  readonly toSize: number
  readonly binary: boolean
  /** Whether the working copy's line endings were normalised to match a Git version. */
  readonly normalised: boolean
}

/** What the viewer asks for when it opens a file. */
export interface FileComparisonRequest {
  readonly repo: string
  readonly path: string
  readonly from: FileVersionSource
  readonly to: FileVersionSource
}

/**
 * A changed region of a file: `a`'s lines `[aStart, aStart + aLines)` become
 * `b`'s lines `[bStart, bStart + bLines)`. A pure insertion has `aLines === 0`,
 * a pure deletion has `bLines === 0`.
 */
export interface HunkRange {
  readonly aStart: number
  readonly aLines: number
  readonly bStart: number
  readonly bLines: number
}

/** A prepared hunk placed on the working copy's lines, for the margin marker. */
export interface PlacedMarker {
  readonly hunk: HunkRange
  /** First working-copy line the marker covers. */
  readonly start: number
  /** How many working-copy lines it covers; 0 marks a point between two lines. */
  readonly lines: number
}

/**
 * The three versions of one file and the two changes between them. The viewer
 * shows the working copy, so the prepared hunks, which are written on the
 * index's lines, are carried over to the working copy as well.
 */
export interface StagingModel {
  readonly head: DiffSide | null
  readonly index: DiffSide | null
  readonly worktree: DiffSide | null
  /** HEAD against the index: the prepared change, drawn as a hollow marker. */
  readonly staged: readonly HunkRange[]
  /** The index against the working copy: a solid marker. */
  readonly unstaged: readonly HunkRange[]
  /** The prepared hunks placed on the working copy's lines. */
  readonly stagedInWorktree: readonly PlacedMarker[]
}

/** What the viewer asks for when it draws the staging markers of a file. */
export interface StagingModelRequest {
  readonly repo: string
  readonly path: string
}

/** One file, several or a whole section to stage or unstage in one write. */
export interface StagePathsRequest {
  readonly repo: string
  readonly paths: readonly string[]
}

/**
 * Hunks to prepare or remove in one write. The hunks always point at the two
 * versions the action moves between: the index against the working copy to
 * prepare, HEAD against the index to remove.
 */
export interface HunkWriteRequest {
  readonly repo: string
  readonly path: string
  readonly action: 'stage' | 'unstage'
  readonly hunks: readonly HunkRange[]
  /**
   * With exactly one hunk in `hunks`: the hunk's patch lines to take, its
   * index-side lines first, instead of the whole hunk. Absent means the whole
   * hunk. It is how a single line is prepared from the viewer.
   */
  readonly lines?: readonly number[]
}

/**
 * The text the three-pane view's centre holds, written as the file's index
 * version. It is the whole index side, not a patch, so Done stores exactly what
 * the panel shows.
 */
export interface IndexWriteRequest {
  readonly repo: string
  readonly path: string
  readonly content: string
}

/**
 * Reverting hunks throws away a pending change. The hunks are the unstaged ones
 * the viewer drew, in index and working-copy lines; the main process rebuilds
 * the working copy with the index's lines and writes the file.
 */
export interface RevertHunksRequest {
  readonly repo: string
  readonly path: string
  readonly hunks: readonly HunkRange[]
}

/**
 * The unconfirmed commit message of a repository, kept until it is confirmed.
 * An empty message clears the draft.
 */
export interface CommitDraftWriteRequest {
  readonly repo: string
  readonly message: string
}

/** The message to create a commit from the index with. */
export interface CommitRequest {
  readonly repo: string
  readonly message: string
  /** Rewrite the last commit instead of making a new one. */
  readonly amend: boolean
  /** Signs as someone else, written `Name <email>`; empty uses the configured author. */
  readonly author: string
  /** Adds Git's `Signed-off-by` trailer. */
  readonly signoff: boolean
  /** Whether the `pre-commit` and `commit-msg` hooks run; false adds `--no-verify`. */
  readonly runHooks: boolean
  /**
   * The answer to a CRLF warning this commit showed. Absent means no answer
   * yet: the check runs if the preference allows it, and a file that would
   * commit CRLF comes back as a warning instead of a commit.
   */
  readonly crlf?: CrlfChoice
}

/** How the interface answers the CRLF warning before a commit. */
export interface CrlfChoice {
  /** Whether the endings are fixed before committing (Fix and Commit). */
  readonly fix: boolean
  /**
   * Stops the warning from showing, for this repository or for every one of
   * them. Commit As Is and Fix and Commit can carry it; Cancel cannot.
   */
  readonly disable?: 'repo' | 'global'
}

/** An identity the user typed in the dialog, and where to keep it. */
export interface IdentityWriteRequest {
  readonly repo: string
  readonly name: string
  readonly email: string
  /** `local` keeps it to this repository, `global` to every repository. */
  readonly scope: IdentityScope
}

/** The preferences the interface reads at startup and stores when changed. */
export interface SettingsData {
  /** Whether Git's `pre-commit` and `commit-msg` hooks run. */
  readonly runHooks: boolean
}

/** One side of a conflict to accept, with the working copy the dialog saw. */
export interface ConflictAcceptRequest {
  readonly repo: string
  readonly path: string
  readonly side: ConflictSide
  /** The fingerprint from the entry, or null when the file did not exist. */
  readonly fingerprint: string | null
  /** Whether to overwrite even when the file changed since it was read. */
  readonly force?: boolean
}

/** A resolved conflict whose resolution should be undone. */
export interface ConflictRevertRequest {
  readonly repo: string
  readonly path: string
}

/** The file the merge editor opens, and the repository that holds it. */
export interface MergeEditorRequest {
  readonly repo: string
  readonly path: string
}

/**
 * The versions the merge editor starts from. `left` and `right` are already
 * mapped to what the dialog calls Yours and Theirs: in a rebase Git's `ours` is
 * the base being replayed onto, so the stages are swapped before they get here.
 *
 * The result starts from `base`, as the specification decides. `worktree` is
 * only used to keep the original line ending and to tell a file that already
 * carries markers with no stages left from one that can still be merged.
 */
export interface MergeEditorModel {
  readonly path: string
  readonly base: DiffSide | null
  readonly left: DiffSide | null
  readonly right: DiffSide | null
  readonly worktree: DiffSide | null
  readonly binary: boolean
  /** The file has no two sides to merge, so the editor only shows it. */
  readonly readOnly: boolean
  readonly sides: ConflictSides
  /** Whether the result the editor writes should end with a newline. */
  readonly finalNewline: boolean
  /** The encoding the working copy carries, for the status bar. */
  readonly encoding: string
  /** The working copy's line endings, for the status bar. */
  readonly eol: string
  /** Above the viewer's threshold, so inline highlighting and ribbons are reduced. */
  readonly large: boolean
}

/** The whole result the merge editor wants to write, and whether to stage it. */
export interface MergeApplyRequest {
  readonly repo: string
  readonly path: string
  readonly content: string
  /** Run `git add` after writing; Apply changes does, Save and close does not. */
  readonly stage: boolean
}

/** The choices the push dialog made, ready for `git push --porcelain`. */
export interface PushRequest {
  readonly repo: string
  readonly remote: string
  /** The local branch to send. */
  readonly branch: string
  /** The branch name on the remote, which may differ when no upstream exists. */
  readonly remoteBranch: string
  /** Adds `--set-upstream`, for a branch that does not track anything yet. */
  readonly setUpstream: boolean
  readonly tags: PushTagMode
  /**
   * The commit the remote branch must still point at. Present only when the user
   * chose a force push; the main process always sends it as
   * `--force-with-lease`, never as a plain `--force`.
   */
  readonly forceLeaseOid: string | null
}

/** How the retry after a rejection integrates the fetched upstream. */
export interface PushUpdateRequest {
  readonly repo: string
  readonly strategy: 'rebase' | 'merge'
}

/** One chunk of a push's live output, tied to the repository it belongs to. */
export interface PushProgress {
  readonly repo: string
  readonly text: string
}

/**
 * Surface the preload script exposes to the renderer on `window.seam`. It grows
 * as the interface needs typed calls: stage, commit, resolve, continue, abort and
 * push arrive in later phases.
 */
export interface SeamApi {
  readonly contractVersion: number
  /** Opens the folder picker; resolves with the chosen path, or null if cancelled. */
  chooseRepository(): Promise<string | null>
  /** Recent repository paths, most recent first. */
  listRecentRepositories(): Promise<string[]>
  /** The repository passed on the command line with `--repo`, or null. */
  initialRepository(): Promise<string | null>
  /** Reads a repository's status; never throws, returns an error result instead. */
  readRepositoryStatus(repo: string): Promise<IpcResult<RepositorySnapshot>>
  /** Reads two versions of a file for the diff viewer; never throws. */
  readFileComparison(request: FileComparisonRequest): Promise<IpcResult<FileComparison>>
  /**
   * Reads the three versions of a file and the changes between them, so the
   * viewer can mark prepared and pending hunks. Null for a binary file.
   */
  readStagingModel(request: StagingModelRequest): Promise<IpcResult<StagingModel | null>>
  /** Stages paths in one write; never throws. */
  stageFiles(request: StagePathsRequest): Promise<IpcResult<null>>
  /** Removes paths from the index in one write; never throws. */
  unstageFiles(request: StagePathsRequest): Promise<IpcResult<null>>
  /**
   * Prepares the given hunks of a file or removes them, rebuilding the index's
   * text; never throws. It is how a single hunk is staged from the viewer.
   */
  writeHunks(request: HunkWriteRequest): Promise<IpcResult<null>>
  /**
   * Writes `content` as the file's index version without touching the working
   * copy. It is how the three-pane view's Done button stages what the centre
   * holds; never throws.
   */
  writeIndex(request: IndexWriteRequest): Promise<IpcResult<null>>
  /**
   * Reverts the given pending hunks: the working copy's lines inside each hunk
   * go back to the index's. The index is left alone, so it is destructive and
   * the caller confirms first. The new working-copy text comes back, so the
   * viewer can show it without reading the file again; never throws.
   */
  revertHunks(request: RevertHunksRequest): Promise<IpcResult<string>>
  /**
   * The commit message the user typed and did not confirm for a repository, so
   * the box can be refilled after switching files or reopening Seam; never
   * throws. An empty string means there is no draft.
   */
  readCommitDraft(repo: string): Promise<IpcResult<string>>
  /** Stores or clears a repository's unconfirmed commit message; never throws. */
  writeCommitDraft(request: CommitDraftWriteRequest): Promise<IpcResult<null>>
  /**
   * Creates a commit from the index, or reports why Git refused one. The
   * outcome carries the hooks' output for the panel under the button, and the
   * staged files behind a CRLF warning when one is due; only a failure to
   * reach Git itself is an error.
   */
  commit(request: CommitRequest): Promise<IpcResult<CommitOutcome>>
  /**
   * Stops the commit running in a repository, for a hook that will not end;
   * never throws. Without a commit in flight it does nothing.
   */
  cancelCommit(repo: string): Promise<IpcResult<null>>
  /**
   * The last commit of a repository, for the Amend box to fill its message and
   * to warn when the commit is already published; never throws. It fails when
   * the repository has no commits yet.
   */
  readHeadCommit(repo: string): Promise<IpcResult<HeadCommit>>
  /**
   * The last messages confirmed from Seam in a repository, newest first, so the
   * box can offer one again; never throws.
   */
  readCommitHistory(repo: string): Promise<IpcResult<readonly string[]>>
  /**
   * The text of the repository's `commit.template`, or null when none is set;
   * never throws. It is loaded here because Git would only use it with an
   * editor, and Seam always passes the message over stdin.
   */
  readCommitTemplate(repo: string): Promise<IpcResult<string | null>>
  /**
   * The name and address Git would sign with; never throws. A null field means
   * the configuration does not set it and the commit would fail without help.
   */
  readIdentity(repo: string): Promise<IpcResult<Identity>>
  /** Stores a missing identity for one repository or for all of them; never throws. */
  writeIdentity(request: IdentityWriteRequest): Promise<IpcResult<null>>
  /** The stored preferences, so the interface starts with what the user chose. */
  readSettings(): Promise<IpcResult<SettingsData>>
  /** Stores the preferences; never throws. */
  writeSettings(settings: SettingsData): Promise<IpcResult<null>>
  /**
   * The conflict list and the name of each side, including the files Git can
   * still un-resolve; never throws.
   */
  readConflicts(repo: string): Promise<IpcResult<ConflictState>>
  /**
   * Accepts one side of an unresolved file, or deletes it when that side has no
   * file. Returns `needsConfirmation` when the working copy changed since the
   * dialog read it; sending it again with `force` overwrites it; never throws.
   */
  acceptConflict(request: ConflictAcceptRequest): Promise<IpcResult<ConflictAcceptOutcome>>
  /**
   * Resolves every text conflict the word-level merge settles and leaves the
   * rest; never throws. The outcome counts what changed.
   */
  resolveSimpleConflicts(repo: string): Promise<IpcResult<ResolveSimpleOutcome>>
  /** Puts a resolved file back into conflict; never throws. */
  revertConflict(request: ConflictRevertRequest): Promise<IpcResult<null>>
  /**
   * The three versions of one unresolved conflict and the names of its sides,
   * ready for the merge editor; never throws.
   */
  readMergeEditor(request: MergeEditorRequest): Promise<IpcResult<MergeEditorModel>>
  /**
   * Writes the editor's result over the working copy and, when `stage` is set,
   * prepares it so the conflict is resolved; never throws.
   */
  applyMerge(request: MergeApplyRequest): Promise<IpcResult<null>>
  /**
   * Finishes the operation in progress: continues a cherry-pick, revert or
   * rebase, or drops the stash a resolved pop left behind. A merge is finished
   * from the commit box instead, with `readMergeMessage` filling it. Never
   * throws; the outcome says whether Git stopped on another conflict or a hook
   * refused, and carries everything it printed.
   */
  finishOperation(repo: string): Promise<IpcResult<OperationOutcome>>
  /** Skips the commit that stopped a rebase, cherry-pick or revert; never throws. */
  skipOperation(repo: string): Promise<IpcResult<OperationOutcome>>
  /** Aborts the operation in progress, or a conflicted stash pop; never throws. */
  abortOperation(repo: string): Promise<IpcResult<OperationOutcome>>
  /**
   * The message Git prepared for a merge commit (`MERGE_MSG`), with its comment
   * lines removed, so the commit box can show it; never throws.
   */
  readMergeMessage(repo: string): Promise<IpcResult<string>>
  /**
   * The branch, its upstream, the remotes and the commits the push dialog would
   * send; never throws.
   */
  readPushState(repo: string): Promise<IpcResult<PushState>>
  /**
   * Runs `git push --porcelain` with the dialog's choices. A rejected reference
   * comes back inside the outcome, not as an error; only a failure to reach Git
   * itself is one. Progress arrives through `onPushProgress`.
   */
  push(request: PushRequest): Promise<IpcResult<PushOutcome>>
  /** Stops the push running in a repository; never throws. */
  cancelPush(repo: string): Promise<IpcResult<null>>
  /**
   * Fetches and integrates the upstream with a rebase or a merge before the
   * dialog retries; never throws. A conflict leaves the operation in progress.
   */
  updateForPush(request: PushUpdateRequest): Promise<IpcResult<PushUpdateOutcome>>
  /**
   * Calls the listener with each chunk of a running push's output, so the dialog
   * can show it live. Returns a function that removes the listener.
   */
  onPushProgress(listener: (progress: PushProgress) => void): () => void
  /**
   * Copies text to the system clipboard, so the commit notification can offer
   * the short id without the renderer fighting the browser's clipboard rules;
   * never throws.
   */
  writeClipboardText(text: string): Promise<IpcResult<null>>
  /**
   * Calls the listener when Git changed the given repository on disk, so the
   * interface can refresh without the user doing anything. Returns a function
   * that removes the listener.
   */
  onRepositoryChanged(listener: (repo: string) => void): () => void
}
