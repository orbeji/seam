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

/** Which of the two sides of a merge or rebase a Git command works on. */
export type GitSide = 'ours' | 'theirs'

/** The side the dialog calls Yours or Theirs. */
export type ConflictSide = 'yours' | 'theirs'

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
  /**
   * The abbreviated id of the commit just made, read with `rev-parse
   * --short HEAD` so it is the same abbreviation a terminal prints. Empty
   * when there was no commit, for the notification under the box to show.
   */
  readonly shortId: string
  /**
   * The staged files the CRLF warning is about: they would commit CRLF into
   * the index without attributes to justify it, and the commit waits for the
   * dialog's answer. Empty when there is nothing to warn about.
   */
  readonly crlf: readonly string[]
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

/**
 * One file in the conflicts dialog. It is either unmerged right now, or it was
 * unmerged and Seam can still undo the resolution because Git kept the three
 * versions in its resolve-undo data. `modes` holds the modes of stages 1, 2 and
 * 3 in `head`, `index` and `worktree`; `000000` marks a side that deleted the
 * file.
 */
export interface ConflictEntry {
  readonly path: string
  readonly code: ConflictCode
  /** Whether the conflict has already been resolved (and can be reverted). */
  readonly resolved: boolean
  readonly modes: Modes
  /** Whether either side is binary, which rules out the text merge. */
  readonly binary: boolean
  /**
   * A fingerprint of the working copy when the dialog read it, or null when the
   * file did not exist. Accepting a side only overwrites the file when it still
   * matches, unless the user confirms.
   */
  readonly fingerprint: string | null
}

/**
 * How the dialog names the two sides for the operation in progress. In a
 * rebase the side Git calls `ours` is the new base, so Seam calls your commits
 * Yours (`theirs` in Git) and the base Theirs (`ours` in Git).
 */
export interface ConflictSides {
  /** The operation in progress, or null for a stash pop or a bare conflict. */
  readonly operation: GitOperation | null
  /** The branch or commit Seam calls Yours. */
  readonly yoursLabel: string
  /** The branch or commit Seam calls Theirs. */
  readonly theirsLabel: string
  /** The Git side behind Yours. */
  readonly yours: GitSide
  /** The Git side behind Theirs. */
  readonly theirs: GitSide
}

/** How far a rebase has got, as `rebase-merge/msgnum` and `end` record it. */
export interface RebaseProgress {
  /** The commit being replayed, counting from 1. */
  readonly current: number
  /** How many commits the rebase replays. */
  readonly total: number
}

/** Everything the conflicts dialog shows: the files, the sides and the progress. */
export interface ConflictState {
  readonly entries: readonly ConflictEntry[]
  readonly sides: ConflictSides
  /** The step of a rebase in progress, or null for every other operation. */
  readonly progress: RebaseProgress | null
  /**
   * The stash entry a conflicted `stash pop` left behind, or null. It names the
   * entry Seam would drop when the resolution is accepted, and lets the dialog
   * offer to abort a pop, which leaves no other marker.
   */
  readonly stash: string | null
}

/**
 * What came of continuing, skipping or aborting an operation. Git exits non-zero
 * both when it stopped on the next conflict and when a hook refused, so the
 * caller looks at `failed`, `conflicts` and `finished` together.
 */
export interface OperationOutcome {
  /** Whether the operation is over: no marker is left. */
  readonly finished: boolean
  /** Whether Git exited non-zero. */
  readonly failed: boolean
  /** The operation still in progress, or null when it finished. */
  readonly operation: GitOperation | null
  /** Files still unmerged, which is what a stopped rebase leaves behind. */
  readonly conflicts: number
  /** Everything Git and its hooks printed, for the error dialog. */
  readonly output: string
}

/** A remote configured in the repository, as the push dialog lists it. */
export interface PushRemote {
  readonly name: string
  readonly url: string
}

/** One commit the push sends, as the dialog lists it. */
export interface PushCommit {
  readonly oid: string
  readonly shortId: string
  readonly subject: string
  readonly author: string
  /** When the commit was made, in words (`%ar`), for the row's tail. */
  readonly date: string
}

/** Which tags a push sends: none, the annotated ones it reaches, or every one. */
export type PushTagMode = 'none' | 'follow' | 'all'

/** Why Git refused one reference, when Seam can tell it apart. */
export type PushRejection =
  | 'non-fast-forward'
  | 'remote-rejected'
  | 'tag-exists'
  | 'stale-info'
  | 'other'

/** The first letter of a `git push --porcelain` reference line. */
export type PushRefFlag = ' ' | '*' | '!' | '=' | '+' | '-'

/** One reference line of `git push --porcelain`, in Seam's words. */
export interface PushRef {
  /** `*` new, space updated, `!` rejected, `=` unchanged, `+` forced, `-` deleted. */
  readonly flag: PushRefFlag
  /** The local reference, such as `refs/heads/main`. */
  readonly from: string
  /** The remote reference, such as `refs/heads/main`. */
  readonly to: string
  /** Everything after the second tab: the range, `[new branch]`, and so on. */
  readonly summary: string
  /** The text in the summary's parentheses, or null when it has none. */
  readonly reason: string | null
  /** The refusal Seam recognised, or null for a reference that went through. */
  readonly rejection: PushRejection | null
  /** Whether the reference is a tag rather than a branch. */
  readonly tag: boolean
}

/**
 * Everything the push dialog shows before it runs: the local branch, where it
 * would go, the commits that would travel and what the remote last looked like.
 */
export interface PushState {
  /** The local branch, or null when HEAD is detached. */
  readonly branch: string | null
  /** The upstream as Git names it, such as `origin/main`, or null. */
  readonly upstream: string | null
  /** The remote the dialog starts with, or null when none is configured. */
  readonly remote: string | null
  /** The remote branch the dialog starts with, or null. */
  readonly remoteBranch: string | null
  /** The remote-tracking commit Seam saw, used as the lease and for force push. */
  readonly remoteOid: string | null
  readonly remotes: readonly PushRemote[]
  /** The commits the push would send, newest first. */
  readonly commits: readonly PushCommit[]
  /** Whether HEAD is detached, which leaves nothing to push. */
  readonly detached: boolean
  /**
   * Whether HEAD is already in a remote branch, so a rebase would rewrite
   * published history and the dialog offers only a merge.
   */
  readonly published: boolean
  /** Whether the branch is `main` or `master`, so a force push asks for its name. */
  readonly protectedBranch: boolean
  /** Whether the branch already tracks an upstream. */
  readonly hasUpstream: boolean
  /** Whether the target branch already exists on the remote. */
  readonly remoteBranchExists: boolean
}

/** What came of a push: whether it landed and how each reference fared. */
export interface PushOutcome {
  /** Whether Git exited zero. */
  readonly ok: boolean
  /** One entry per reference Git printed, empty when it never got that far. */
  readonly refs: readonly PushRef[]
  /** Whether Git could not authenticate, so the dialog explains what to configure. */
  readonly authFailed: boolean
  /** Whether the user stopped the push. */
  readonly cancelled: boolean
  /** Whether the push ran past its deadline and was killed. */
  readonly timedOut: boolean
  /** Everything Git printed, for the dialog's output panel. */
  readonly output: string
}

/**
 * What came of fetching and integrating the upstream before pushing again.
 * A conflict leaves the operation in progress, so the phase 5 list takes over.
 */
export interface PushUpdateOutcome {
  /** Whether the branch was updated and no operation is left in progress. */
  readonly ok: boolean
  /** Whether the fetch itself succeeded. */
  readonly fetched: boolean
  /** Files still unmerged when Git stopped on a conflict. */
  readonly conflicts: number
  /** The operation still in progress, or null when the update finished. */
  readonly operation: GitOperation | null
  /** Everything Git printed, for the dialog's output panel. */
  readonly output: string
}

/** The result of accepting a side: whether the user must confirm an overwrite. */
export interface ConflictAcceptOutcome {
  readonly needsConfirmation: boolean
}

/** How many files a bulk resolution changed, and how many it left alone. */
export interface ResolveSimpleOutcome {
  readonly resolved: number
  readonly remaining: number
}
