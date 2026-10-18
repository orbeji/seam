// SPDX-License-Identifier: MIT

/**
 * The shape of a repository's status. It lives in `shared` because it crosses
 * IPC: the main process builds it with `core/git` and the interface renders it,
 * and the interface may not import `core/git`. Nothing here touches Node or
 * Electron, so every layer can depend on it.
 */

/**
 * The seven two-letter codes Git uses for an unmerged file. The first letter is
 * the HEAD side and the second the other side. Phase 5 turns each into the
 * actions the conflict dialog offers.
 */
export type ConflictCode = 'DD' | 'AU' | 'UD' | 'UA' | 'DU' | 'AA' | 'UU'

/**
 * File modes of an entry. For an ordinary or renamed entry they are the modes
 * in HEAD, the index and the working tree. For an unmerged entry the three
 * modes are the merge stages (01 base, 02 ours, 03 theirs), which is how a
 * conflict tells that one side deleted the file (mode `000000`).
 */
export interface Modes {
  head: string
  index: string
  worktree: string
}

export interface BranchStatus {
  /** Commit the branch points at, or null before the first commit. */
  oid: string | null
  /** Branch name, or null when HEAD is detached. */
  head: string | null
  /** Only present with `--branch` and when the branch has an upstream. */
  upstream?: string
  /** Commits ahead of the upstream; only present when the upstream is known. */
  ahead?: number
  /** Commits behind the upstream; only present when the upstream is known. */
  behind?: number
}

/** An ordinary changed entry (porcelain record type `1`). */
export interface OrdinaryEntry {
  kind: 'ordinary'
  /** Index status letter (X), `.` when the change is not staged. */
  x: string
  /** Worktree status letter (Y), `.` when the change exists only in the index. */
  y: string
  path: string
  modes: Modes
}

/** A renamed entry (porcelain record type `2`). */
export interface RenamedEntry {
  kind: 'renamed'
  x: string
  y: string
  path: string
  /** The path the file had before the rename. */
  origPath: string
  /** Similarity score between 0 and 100. */
  score: number
}

/** An unmerged entry (porcelain record type `u`). */
export interface UnmergedEntry {
  kind: 'unmerged'
  xy: ConflictCode
  path: string
  modes: Modes
}

export interface UntrackedEntry {
  kind: 'untracked'
  path: string
}

export type StatusEntry = OrdinaryEntry | RenamedEntry | UnmergedEntry | UntrackedEntry

export interface RepoStatus {
  branch: BranchStatus
  entries: StatusEntry[]
}

/** A Git operation that can be stopped halfway. */
export type GitOperation = 'merge' | 'cherry-pick' | 'revert' | 'rebase'

/**
 * The name and address Git signs a commit with, read from `user.name` and
 * `user.email`. Either one may be missing, and then Git would refuse to commit.
 */
export interface Identity {
  readonly name: string | null
  readonly email: string | null
}

/** Where a missing identity is written when the user is asked for it. */
export type IdentityScope = 'local' | 'global'

/** A refusal Git prints that Seam knows how to react to. */
export type CommitFailure = 'identity' | 'nothing-staged' | 'conflicts'

/** What came of a commit: whether it was made and what was printed meanwhile. */
export interface CommitOutcome {
  /** Whether Git created the commit. */
  readonly created: boolean
  /** Everything Git and its hooks printed, for the panel under the button. */
  readonly output: string
  /** Git's own refusal, when it did not commit; empty otherwise. */
  readonly message: string
  /** The refusal Seam recognised, or null when it is an ordinary failure. */
  readonly reason: CommitFailure | null
  /** Whether the commit ran past its deadline and was killed. */
  readonly timedOut: boolean
  /** Whether the user cancelled the commit. */
  readonly cancelled: boolean
}

/**
 * The last commit, as the amend box shows it: enough to fill the message box and
 * to warn when the commit has already been published.
 */
export interface HeadCommit {
  /** Abbreviated commit id (`%h`). */
  shortId: string
  /** First line of the message (`%s`). */
  subject: string
  /** The whole message, without the newline Git stores at the end. */
  message: string
  /** Whether a remote branch already contains the commit. */
  published: boolean
}

/**
 * The four lists the changes screen shows. An entry can be both staged and
 * unstaged (porcelain `MM`), in which case it appears in both, like the reference client.
 * Unmerged entries are kept apart so the conflict dialog can own them.
 */
export interface ChangeSummary {
  staged: StatusEntry[]
  unstaged: StatusEntry[]
  untracked: UntrackedEntry[]
  conflicts: UnmergedEntry[]
}
