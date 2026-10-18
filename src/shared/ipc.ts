// SPDX-License-Identifier: MIT

import type {
  ChangeSummary,
  GitOperation,
  HeadCommit,
  Identity,
  IdentityScope,
  RepoStatus
} from './git'

/**
 * Version of the contract between the main process, the preload bridge and the
 * interface. Bump it whenever a message shape changes so the three layers can
 * detect a mismatch instead of failing silently.
 */
export const IPC_CONTRACT_VERSION = 11

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
  readHeadCommit: 'commit:head',
  readIdentity: 'identity:read',
  writeIdentity: 'identity:write'
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
}

/** An identity the user typed in the dialog, and where to keep it. */
export interface IdentityWriteRequest {
  readonly repo: string
  readonly name: string
  readonly email: string
  /** `local` keeps it to this repository, `global` to every repository. */
  readonly scope: IdentityScope
}

/**
 * Surface the preload script exposes to the renderer on `window.seam`. It grows
 * as the interface needs typed calls: stage, commit, resolve, continue and abort
 * arrive in later phases.
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
   * Creates a commit from the index with the given message; never throws. A
   * failed hook or a missing identity comes back as an error result, not a
   * thrown exception.
   */
  commit(request: CommitRequest): Promise<IpcResult<null>>
  /**
   * The last commit of a repository, for the Amend box to fill its message and
   * to warn when the commit is already published; never throws. It fails when
   * the repository has no commits yet.
   */
  readHeadCommit(repo: string): Promise<IpcResult<HeadCommit>>
  /**
   * The name and address Git would sign with; never throws. A null field means
   * the configuration does not set it and the commit would fail without help.
   */
  readIdentity(repo: string): Promise<IpcResult<Identity>>
  /** Stores a missing identity for one repository or for all of them; never throws. */
  writeIdentity(request: IdentityWriteRequest): Promise<IpcResult<null>>
  /**
   * Calls the listener when Git changed the given repository on disk, so the
   * interface can refresh without the user doing anything. Returns a function
   * that removes the listener.
   */
  onRepositoryChanged(listener: (repo: string) => void): () => void
}
