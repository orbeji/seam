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

/** What a reference shown in the commit history points at. */
export type HistoryRefKind = 'tag' | 'branch' | 'remote' | 'head'

/** A tag or branch pointing at one commit of the history. */
export interface HistoryRef {
  /** The short name Git shows: `main`, `origin/main` or `v1.0.0`. */
  readonly name: string
  readonly kind: HistoryRefKind
  /**
   * For a local branch, the remote-tracking refs (`origin/main`) that point at
   * the same commit and are folded into this one pill. A remote that has moved
   * elsewhere stays a separate ref with its own commit.
   */
  readonly remotes?: readonly string[]
}

/**
 * One commit of the history graph. The parents let the interface lay the graph
 * out: a commit with two parents is a merge, and the branches that share a
 * parent meet again at that commit.
 */
export interface HistoryCommit {
  readonly oid: string
  readonly shortId: string
  readonly parents: readonly string[]
  readonly subject: string
  readonly authorName: string
  readonly authorEmail: string
  /** The author date, in Git's strict ISO 8601 format (`%aI`). */
  readonly authorDate: string
  /** The tags and branches that point at the commit, tags first. */
  readonly refs: readonly HistoryRef[]
}

/** The commits the history view draws, newest first, and the refs they carry. */
export interface RepositoryHistory {
  readonly commits: readonly HistoryCommit[]
  /** Whether Git held more commits than Seam read. */
  readonly truncated: boolean
  /** The branch HEAD points at, or null when it is detached. */
  readonly head: string | null
  /** The commit HEAD points at, or null before the first commit. */
  readonly headOid: string | null
}

/** How a commit changed one path against its first parent. */
export type CommitFileStatus =
  'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type-changed' | 'unmerged' | 'unknown'

/** One file a commit touched, with the name it had before a rename. */
export interface CommitFileChange {
  /** The path in the commit, or the path it was deleted or renamed from. */
  readonly path: string
  /** The path in the parent for a rename or a copy, otherwise null. */
  readonly previousPath: string | null
  readonly status: CommitFileStatus
}

/** The files one commit changed against its first parent. */
export interface CommitChanges {
  readonly oid: string
  /** The commit compared against, or null for a root commit. */
  readonly parent: string | null
  readonly files: readonly CommitFileChange[]
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
  'non-fast-forward' | 'remote-rejected' | 'tag-exists' | 'stale-info' | 'other'

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

/** How a merge integrates the source branch. */
export type MergeStrategy = 'merge-commit' | 'fast-forward' | 'squash'

/** What came of starting a merge: a clean result or an operation left in progress. */
export interface MergeOutcome {
  /** Whether Git exited zero and left no operation behind. */
  readonly ok: boolean
  /** Files still unmerged when Git stopped on a conflict. */
  readonly conflicts: number
  /** The operation still in progress, or null when the merge finished. */
  readonly operation: GitOperation | null
  /** Everything Git printed, for the dialog's output panel. */
  readonly output: string
}

/** What the merge dialog reads before it starts. */
export interface MergeState {
  /** The checked-out branch, or null when HEAD is detached. */
  readonly currentBranch: string | null
  /** The commit HEAD points at, or null before the first commit. */
  readonly headOid: string | null
  /** Local branches that can be merged in. */
  readonly local: readonly string[]
  /** Remote branches that can be merged in, named `origin/main`. */
  readonly remote: readonly string[]
  /** The operation in progress, or null when the repository is idle. */
  readonly operation: GitOperation | null
  /** Files still unmerged. */
  readonly conflicts: number
  /** Whether tracked files have staged or unstaged changes. */
  readonly dirty: boolean
}

/** The GitFlow branch families Seam manages. */
export type GitFlowKind = 'feature' | 'release' | 'hotfix'

/** The names and prefixes GitFlow uses in one repository. */
export interface GitFlowConfig {
  /** The branch releases and hotfixes are merged into. */
  readonly master: string
  /** The integration branch features and releases start from. */
  readonly develop: string
  /** Prefix of a feature branch, ending in `/`. */
  readonly featurePrefix: string
  /** Prefix of a release branch, ending in `/`. */
  readonly releasePrefix: string
  /** Prefix of a hotfix branch, ending in `/`. */
  readonly hotfixPrefix: string
  /** Prefix of a release or hotfix tag. */
  readonly versionTagPrefix: string
}

/** The local branches of each GitFlow family, with their full names. */
export interface GitFlowBranches {
  readonly feature: readonly string[]
  readonly release: readonly string[]
  readonly hotfix: readonly string[]
}

/** One step of a finish that Git may stop halfway through. */
export type GitFlowFinishStep = 'merge-master' | 'tag' | 'merge-develop' | 'delete'

/**
 * A finish that is still running. It is kept next to the Git directory so a
 * conflict, a restart or a commit made from the main window can resume it.
 */
export interface GitFlowPendingFinish {
  readonly kind: GitFlowKind
  /** The full branch name, such as `release/1.2.0`. */
  readonly branch: string
  /** The branch name without its prefix, used for the default tag. */
  readonly name: string
  /** The tag to create for a release or hotfix, or null for a feature. */
  readonly tag: string | null
  /** The next command to run. */
  readonly step: GitFlowFinishStep
}

/** Everything the GitFlow popup shows about the open repository. */
export interface GitFlowState {
  /** Whether a complete configuration exists and both main branches are present. */
  readonly initialized: boolean
  readonly config: GitFlowConfig
  /** The checked-out branch, or null when HEAD is detached. */
  readonly currentBranch: string | null
  /** The GitFlow family of the current branch, or null. */
  readonly currentKind: GitFlowKind | null
  /** The current branch without its prefix, or null. */
  readonly currentName: string | null
  readonly branches: GitFlowBranches
  /** The operation in progress, or null. */
  readonly operation: GitOperation | null
  /** Files still unmerged. */
  readonly conflicts: number
  /** Whether tracked files have staged or unstaged changes. */
  readonly dirty: boolean
  /** An interrupted finish waiting to be resumed, or null. */
  readonly pending: GitFlowPendingFinish | null
}

/** What came of running one or more steps of a GitFlow finish. */
export interface GitFlowFinishOutcome {
  /** Whether every step ran and the branch was deleted. */
  readonly finished: boolean
  /** Whether Git exited non-zero on the step that stopped. */
  readonly failed: boolean
  /** Files still unmerged when a merge stopped. */
  readonly conflicts: number
  /** The operation still in progress, or null. */
  readonly operation: GitOperation | null
  /** The step that stopped the finish, or null when it is over. */
  readonly step: GitFlowFinishStep | null
  /** The tag this finish creates, or null for a feature. */
  readonly tag: string | null
  /** Everything Git printed, for the popup's output panel. */
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
