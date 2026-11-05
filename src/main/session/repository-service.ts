// SPDX-License-Identifier: MIT

import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { revertHunks, stageHunks, stageSelection, unstageHunks } from '../../core/diff'
import {
  acceptConflict as acceptConflictSide,
  abortOperation as abortOperationInRepo,
  applyMerge as applyMergeResult,
  checkoutBranch as checkoutBranchInRepo,
  checkoutCommit as checkoutCommitInRepo,
  clearPendingGitFlow,
  cloneRepository as cloneRepositoryInRepo,
  countPushCommits,
  createBranch as createBranchInRepo,
  createCommit,
  deleteBranch as deleteBranchInRepo,
  detectOperation,
  discardPaths,
  finishGitFlow as finishGitFlowInRepo,
  finishOperation as finishOperationInRepo,
  GitCommandError,
  GitError,
  GitNotFoundError,
  GitRunner,
  GitVersionError,
  initGitFlow as initGitFlowInRepo,
  listBranches as listBranchesInRepo,
  mergeBranch as mergeBranchInRepo,
  readCommitChanges as readCommitChangesFromRepo,
  readCommitComparison as readCommitComparisonFromRepo,
  readCommitTemplate,
  readComparison,
  readConflictState,
  readFileModel,
  readGitFlowState as readGitFlowStateFromRepo,
  readHeadCommit,
  readIdentity,
  readMergeEditor as readMergeEditorModel,
  readMergeMessage as readMergeMessageFromRepo,
  readMergeState as readMergeStateFromRepo,
  readPushState as readPushStateFromRepo,
  readRepositoryHistory as readRepositoryHistoryFromRepo,
  readStatus,
  removeIndexPaths,
  renameBranch as renameBranchInRepo,
  resolveSimpleConflicts as resolveSimple,
  revertConflict as revertConflictResolution,
  skipOperation as skipOperationInRepo,
  stagePaths,
  startGitFlow as startGitFlowInRepo,
  summarizeChanges,
  unstagePaths,
  updateForPush as updateForPushInRepo,
  fetchRemotes as fetchRemotesInRepo,
  pull as pullInRepo,
  push as pushToRemote,
  writeIdentity,
  writeIndexEntry,
  writeWorktreeFile,
  type BranchList,
  type CommitOptions,
  type GitFlowConfig,
  type GitFlowFinishOutcome,
  type GitFlowKind,
  type GitFlowState,
  type HeadCommit,
  type MergeOutcome,
  type MergeState,
  type MergeStrategy,
  type PushOptions,
  type PushUpdateStrategy,
  type VersionSource
} from '../../core/git'
import type {
  FileComparison,
  HunkRange,
  IpcErrorCode,
  IpcResult,
  MergeApplyRequest,
  MergeEditorModel,
  RepositorySnapshot,
  StagingModel
} from '../../shared/ipc'
import type {
  CommitChanges,
  CommitOutcome,
  ConflictAcceptOutcome,
  ConflictSide,
  ConflictState,
  Identity,
  IdentityScope,
  OperationOutcome,
  PushOutcome,
  PushState,
  PushUpdateOutcome,
  RepositoryHistory,
  ResolveSimpleOutcome
} from '../../shared/git'
import { GitWatcher } from './git-watcher'

type Failure = { readonly ok: false; readonly code: IpcErrorCode; readonly message: string }

function failure(code: IpcErrorCode, message: string): Failure {
  return { ok: false, code, message }
}

/** Whether two hunks cover the same lines, so a stale request can be refused. */
function sameHunk(left: HunkRange, right: HunkRange): boolean {
  return (
    left.aStart === right.aStart &&
    left.aLines === right.aLines &&
    left.bStart === right.bStart &&
    left.bLines === right.bLines
  )
}

function failureFrom(error: unknown): Failure {
  if (error instanceof GitNotFoundError) return failure('git-not-found', error.message)
  if (error instanceof GitVersionError) return failure('git-too-old', error.message)
  if (error instanceof GitCommandError) {
    return failure('command-failed', error.stderr.trim() || error.message)
  }
  if (error instanceof GitError) return failure('unknown', error.message)
  return failure('unknown', error instanceof Error ? error.message : String(error))
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    // The folder disappeared between the two checks, or is not readable.
    return false
  }
}

/**
 * Reads everything the interface needs from a repository. It owns one Git runner
 * and checks the Git version once, so the interface gets a clear error instead of
 * a failed command when Git is missing or too old.
 */
export class RepositoryService {
  private versionChecked: Promise<unknown> | null = null
  /** The commit running right now, so a hook that will not end can be stopped. */
  private commitInFlight: { readonly repo: string; readonly controller: AbortController } | null =
    null
  /** The push running right now, so a remote that will not answer can be stopped. */
  private pushInFlight: { readonly repo: string; readonly controller: AbortController } | null =
    null

  constructor(private readonly runner: GitRunner = new GitRunner()) {}

  /**
   * Clones a repository into a new folder. The path is the full destination,
   * not a parent, and must not exist yet unless it is an empty folder Git can
   * fill. The path is left out of the recent list; the handler adds it only
   * after the clone succeeds.
   */
  async clone(url: string, destination: string): Promise<IpcResult<string>> {
    try {
      const target = await cloneRepositoryInRepo(this.runner, url, destination)
      this.versionChecked ??= this.runner.ensureVersion(target)
      await this.versionChecked
      return { ok: true, value: target }
    } catch (error) {
      return failureFrom(error)
    }
  }

  async snapshot(repo: string): Promise<IpcResult<RepositorySnapshot>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      const status = await readStatus(this.runner, repo)
      const [operation, pushCount] = await Promise.all([
        detectOperation(this.runner, repo),
        countPushCommits(this.runner, repo, status.branch)
      ])
      return {
        ok: true,
        value: { repo, status, summary: summarizeChanges(status), operation, pushCount }
      }
    } catch (error) {
      return failureFrom(error)
    }
  }

  async readFileComparison(
    repo: string,
    path: string,
    from: VersionSource,
    to: VersionSource
  ): Promise<IpcResult<FileComparison>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      const comparison = await readComparison(this.runner, repo, path, from, to)
      return {
        ok: true,
        value: {
          from: comparison.from,
          to: comparison.to,
          fromSize: comparison.fromSize,
          toSize: comparison.toSize,
          binary: comparison.binary,
          normalised: comparison.normalised
        }
      }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /**
   * Reads the three versions of a file and the changes between them, for the
   * viewer's staging markers. Null when the file is binary and has no lines.
   */
  async readStagingModel(repo: string, path: string): Promise<IpcResult<StagingModel | null>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await readFileModel(this.runner, repo, path) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Stages the given paths: one file, several or a whole section, in one write. */
  stage(repo: string, paths: readonly string[]): Promise<IpcResult<null>> {
    return this.write(repo, () => stagePaths(this.runner, repo, paths))
  }

  /** Removes the given paths from the index, leaving the working tree alone. */
  unstage(repo: string, paths: readonly string[]): Promise<IpcResult<null>> {
    return this.write(repo, () => unstagePaths(this.runner, repo, paths))
  }

  /**
   * Throws away the working-tree changes to the given paths, restoring them
   * from the index. Prepared changes stay prepared.
   */
  discard(repo: string, paths: readonly string[]): Promise<IpcResult<null>> {
    return this.write(repo, () => discardPaths(this.runner, repo, paths))
  }

  /**
   * Prepares the given hunks of a file or removes them, rebuilding the index's
   * text and writing it without touching the working copy.
   *
   * The model is read again first, so the hunks are applied to the index as it
   * is now. A hunk the file no longer has - because it changed after the viewer
   * read it - is refused rather than applied at coordinates that have moved.
   *
   * With `lines`, only those patch lines of a single hunk are taken, so a
   * prepared hunk can end up holding some of its lines and not the rest.
   */
  async writeHunks(
    repo: string,
    path: string,
    action: 'stage' | 'unstage',
    hunks: readonly HunkRange[],
    lines?: readonly number[]
  ): Promise<IpcResult<null>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      const model = await readFileModel(this.runner, repo, path)
      if (model === null) {
        return failure('command-failed', `${path} is binary, so it cannot be prepared by hunk.`)
      }

      const known = action === 'stage' ? model.unstaged : model.staged
      if (!hunks.every((hunk) => known.some((candidate) => sameHunk(candidate, hunk)))) {
        return failure('command-failed', `${path} changed since it was read. Open it again.`)
      }

      if (lines !== undefined) {
        const hunk = hunks[0]
        if (action !== 'stage' || hunk === undefined || hunks.length !== 1) {
          return failure('unknown', `Only one hunk can be prepared by line at a time.`)
        }
        if (
          !lines.every(
            (line) => Number.isInteger(line) && line >= 0 && line < hunk.aLines + hunk.bLines
          )
        ) {
          return failure('command-failed', `${path} changed since it was read. Open it again.`)
        }
        const content = stageSelection(model.index, model.worktree, hunk, new Set(lines))
        await writeIndexEntry(this.runner, repo, path, content)
      } else if (action === 'stage') {
        const content = stageHunks(model.index, model.worktree, hunks)
        await writeIndexEntry(this.runner, repo, path, content)
      } else {
        const content = unstageHunks(model.head, model.index, hunks)
        if (content === null) await removeIndexPaths(this.runner, repo, [path])
        else await writeIndexEntry(this.runner, repo, path, content)
      }
      return { ok: true, value: null }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /**
   * Writes `content` as the file's index version, leaving the working copy
   * alone. It is what the three-pane view's Done button stores: the whole text
   * of the centre, filters and all, exactly as `git add` would.
   */
  writeIndex(repo: string, path: string, content: string): Promise<IpcResult<null>> {
    return this.write(repo, () => writeIndexEntry(this.runner, repo, path, content))
  }

  /**
   * Creates a commit from the index with the given message. The message is
   * written over stdin, so Unicode and several lines reach Git untouched, and
   * `options` decides whether the last commit is rewritten instead, who signs
   * and whether the hooks run.
   *
   * A hook can wait for something Seam cannot give, so the commit is tracked
   * while it runs and `cancelCommit` can stop it. A refusal comes back inside
   * the outcome rather than as an error, so the interface can show the hooks'
   * output; only a failure to reach Git itself is an error.
   */
  async commit(
    repo: string,
    message: string,
    options: CommitOptions = {}
  ): Promise<IpcResult<CommitOutcome>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    const controller = new AbortController()
    this.commitInFlight = { repo: resolve(repo), controller }
    try {
      const outcome = await createCommit(this.runner, repo, message, {
        ...options,
        signal: controller.signal
      })
      return { ok: true, value: outcome }
    } catch (error) {
      return failureFrom(error)
    } finally {
      if (this.commitInFlight?.controller === controller) this.commitInFlight = null
    }
  }

  /** Stops the commit running in a repository, for a hook that will not end. */
  cancelCommit(repo: string): IpcResult<null> {
    if (this.commitInFlight?.repo === resolve(repo)) {
      const controller = this.commitInFlight.controller
      this.commitInFlight = null
      controller.abort()
    }
    return { ok: true, value: null }
  }

  /**
   * Reads the last commit, which is what Amend rewrites: its short id, subject,
   * message and whether it is already published. Fails when there is no commit.
   */
  async readHeadCommit(repo: string): Promise<IpcResult<HeadCommit>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await readHeadCommit(this.runner, repo) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** The text of the repository's `commit.template`, or null when none is set. */
  async readCommitTemplate(repo: string): Promise<IpcResult<string | null>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await readCommitTemplate(this.runner, repo) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** The commit graph, with each commit's parents, author and refs. */
  async readHistory(repo: string): Promise<IpcResult<RepositoryHistory>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await readRepositoryHistoryFromRepo(this.runner, repo) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** The files one commit changed against its first parent. */
  async readCommitChanges(repo: string, commit: string): Promise<IpcResult<CommitChanges>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await readCommitChangesFromRepo(this.runner, repo, commit) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** One file of a commit, from its first parent's version to the commit's. */
  async readCommitFileComparison(
    repo: string,
    commit: string,
    path: string,
    previousPath: string | null
  ): Promise<IpcResult<FileComparison>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      const comparison = await readCommitComparisonFromRepo(
        this.runner,
        repo,
        commit,
        path,
        previousPath
      )
      return {
        ok: true,
        value: {
          from: comparison.from,
          to: comparison.to,
          fromSize: comparison.fromSize,
          toSize: comparison.toSize,
          binary: comparison.binary,
          normalised: comparison.normalised
        }
      }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** The identity Git would sign a commit with, or nulls where it is unset. */
  async readIdentity(repo: string): Promise<IpcResult<Identity>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await readIdentity(this.runner, repo) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Stores an identity the user typed, for this repository or for all. */
  writeIdentity(
    repo: string,
    identity: { readonly name: string; readonly email: string },
    scope: IdentityScope
  ): Promise<IpcResult<null>> {
    return this.write(repo, () => writeIdentity(this.runner, repo, identity, scope))
  }

  /**
   * Reverts the given pending hunks: the working copy's lines inside each hunk
   * go back to the index's, and the index is left alone, so the change is only
   * thrown away from the file. It is destructive, so the viewer confirms first.
   *
   * The hunks are checked against the unstaged set as it is now, the same way a
   * stage refuses a hunk that changed since it was read, so a stale click cannot
   * drop lines the user never saw. The new working-copy text comes back so the
   * viewer can show exactly what was written.
   */
  async revert(
    repo: string,
    path: string,
    hunks: readonly HunkRange[]
  ): Promise<IpcResult<string>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      const model = await readFileModel(this.runner, repo, path)
      if (model === null) {
        return failure('command-failed', `${path} is binary, so it cannot be reverted by hunk.`)
      }
      if (!hunks.every((hunk) => model.unstaged.some((candidate) => sameHunk(candidate, hunk)))) {
        return failure('command-failed', `${path} changed since it was read. Open it again.`)
      }

      const content = revertHunks(model.index, model.worktree, hunks)
      await writeWorktreeFile(this.runner, repo, path, content)
      return { ok: true, value: content }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /**
   * Reads the conflict list and the name of each side, including resolved files
   * Git can still un-resolve.
   */
  async readConflicts(repo: string): Promise<IpcResult<ConflictState>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await readConflictState(this.runner, repo) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /**
   * Accepts one side of a conflict. The fingerprint the dialog read guards
   * against overwriting a file the user edited meanwhile; `force` is the answer
   * to the confirmation.
   */
  async acceptConflict(
    repo: string,
    path: string,
    side: ConflictSide,
    fingerprint: string | null,
    force = false
  ): Promise<IpcResult<ConflictAcceptOutcome>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return {
        ok: true,
        value: await acceptConflictSide(this.runner, repo, path, side, fingerprint, force)
      }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Resolves every text conflict the word-level merge settles, in one write. */
  async resolveSimpleConflicts(repo: string): Promise<IpcResult<ResolveSimpleOutcome>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await resolveSimple(this.runner, repo) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Puts a resolved file back into conflict, restoring its stages. */
  revertConflict(repo: string, path: string): Promise<IpcResult<null>> {
    return this.write(repo, () => revertConflictResolution(this.runner, repo, path))
  }

  /** Reads the three stages and sides of one conflict for the merge editor. */
  async readMergeEditor(repo: string, path: string): Promise<IpcResult<MergeEditorModel>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await readMergeEditorModel(this.runner, repo, path) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /**
   * Writes the merge editor's result over the working copy. Apply changes also
   * stages it; Save and close leaves the conflict unresolved.
   */
  applyMerge(request: MergeApplyRequest): Promise<IpcResult<null>> {
    return this.write(request.repo, () => applyMergeResult(this.runner, request.repo, request))
  }

  /**
   * Finishes the operation in progress. A merge is finished with the commit
   * box, so this continues the others and drops a resolved stash pop.
   */
  async finishOperation(repo: string): Promise<IpcResult<OperationOutcome>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await finishOperationInRepo(this.runner, repo) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Skips the commit that stopped a rebase, cherry-pick or revert. */
  async skipOperation(repo: string): Promise<IpcResult<OperationOutcome>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await skipOperationInRepo(this.runner, repo) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Aborts the operation in progress, or a conflicted stash pop. */
  async abortOperation(repo: string): Promise<IpcResult<OperationOutcome>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      const outcome = await abortOperationInRepo(this.runner, repo)
      // An aborted GitFlow merge means the finish was abandoned, so the stored
      // steps must not resume on their own later.
      if (outcome.finished && outcome.operation === null) {
        await clearPendingGitFlow(this.runner, repo)
      }
      return { ok: true, value: outcome }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** The message Git prepared for a merge commit, without its comments. */
  async readMergeMessage(repo: string): Promise<IpcResult<string>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await readMergeMessageFromRepo(this.runner, repo) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Reads the branch, its upstream, the remotes and the commits to push. */
  async readPushState(repo: string): Promise<IpcResult<PushState>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await readPushStateFromRepo(this.runner, repo) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Lists local and remote branches. */
  async listBranches(repo: string): Promise<IpcResult<BranchList>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await listBranchesInRepo(this.runner, repo) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Checks out a branch (local or remote). */
  async checkoutBranch(
    repo: string,
    branch: string,
    createTracking = true
  ): Promise<IpcResult<null>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      await checkoutBranchInRepo(this.runner, repo, branch, createTracking)
      return { ok: true, value: null }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Checks out one commit with HEAD detached, as the history view asks. */
  checkoutCommit(repo: string, commit: string): Promise<IpcResult<null>> {
    return this.write(repo, () => checkoutCommitInRepo(this.runner, repo, commit))
  }

  /** Creates a local branch, validating the name with Git first. */
  async createBranch(
    repo: string,
    name: string,
    startPoint: string | null,
    checkout: boolean
  ): Promise<IpcResult<null>> {
    return this.write(repo, () =>
      createBranchInRepo(this.runner, repo, { name, startPoint, checkout })
    )
  }

  /** Renames a local branch, validating the new name with Git first. */
  async renameBranch(repo: string, name: string, newName: string): Promise<IpcResult<null>> {
    return this.write(repo, () => renameBranchInRepo(this.runner, repo, name, newName))
  }

  /** Deletes a local branch, safely unless `force` is set. */
  async deleteBranch(repo: string, name: string, force: boolean): Promise<IpcResult<null>> {
    return this.write(repo, () => deleteBranchInRepo(this.runner, repo, name, force))
  }

  /** Reads the branches and readiness of the merge dialog. */
  async readMergeState(repo: string): Promise<IpcResult<MergeState>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await readMergeStateFromRepo(this.runner, repo) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Starts a merge into the checked-out branch. */
  async mergeBranch(
    repo: string,
    source: string,
    strategy: MergeStrategy,
    message: string
  ): Promise<IpcResult<MergeOutcome>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return {
        ok: true,
        value: await mergeBranchInRepo(this.runner, repo, source, strategy, message)
      }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Reads the GitFlow configuration, its branches and any pending finish. */
  async readGitFlow(repo: string): Promise<IpcResult<GitFlowState>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await readGitFlowStateFromRepo(this.runner, repo) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Writes the GitFlow configuration and creates develop when missing. */
  async initGitFlow(repo: string, config: GitFlowConfig): Promise<IpcResult<null>> {
    return this.write(repo, () => initGitFlowInRepo(this.runner, repo, config))
  }

  /** Creates and checks out a feature, release or hotfix branch. */
  async startGitFlow(repo: string, kind: GitFlowKind, name: string): Promise<IpcResult<string>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await startGitFlowInRepo(this.runner, repo, kind, name) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Finishes, or resumes finishing, the current GitFlow branch. */
  async finishGitFlow(repo: string, tag: string | null): Promise<IpcResult<GitFlowFinishOutcome>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return {
        ok: true,
        value: await finishGitFlowInRepo(this.runner, repo, tag ?? undefined)
      }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /**
   * Runs the push. `onProgress` receives Git's output as it arrives, so the
   * dialog can show it while the remote answers. The push is tracked while it
   * runs, so `cancelPush` can kill a remote that never answers.
   */
  async push(
    repo: string,
    options: Omit<PushOptions, 'signal' | 'onProgress'>,
    onProgress?: (text: string) => void
  ): Promise<IpcResult<PushOutcome>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    const controller = new AbortController()
    this.pushInFlight = { repo: resolve(repo), controller }
    try {
      const outcome = await pushToRemote(this.runner, repo, {
        ...options,
        signal: controller.signal,
        ...(onProgress === undefined ? {} : { onProgress })
      })
      return { ok: true, value: outcome }
    } catch (error) {
      return failureFrom(error)
    } finally {
      if (this.pushInFlight?.controller === controller) this.pushInFlight = null
    }
  }

  /** Stops the push running in a repository, for a remote that will not answer. */
  cancelPush(repo: string): IpcResult<null> {
    if (this.pushInFlight?.repo === resolve(repo)) {
      const controller = this.pushInFlight.controller
      this.pushInFlight = null
      controller.abort()
    }
    return { ok: true, value: null }
  }

  /**
   * Fetches and integrates the upstream before a retry. A conflict leaves the
   * operation in progress, so the interface hands over to the conflict list.
   */
  async updateForPush(
    repo: string,
    strategy: PushUpdateStrategy
  ): Promise<IpcResult<PushUpdateOutcome>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await updateForPushInRepo(this.runner, repo, strategy) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Refreshes every configured remote's refs without touching the branches. */
  async fetchRemotes(repo: string): Promise<IpcResult<null>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      await fetchRemotesInRepo(this.runner, repo)
      return { ok: true, value: null }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Fetches and integrates the current branch's upstream, the way pull would. */
  async pull(repo: string, strategy: PushUpdateStrategy): Promise<IpcResult<PushUpdateOutcome>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      return { ok: true, value: await pullInRepo(this.runner, repo, strategy) }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** Opens the repository, runs one write and maps any failure to a result. */
  private async write(repo: string, action: () => Promise<unknown>): Promise<IpcResult<null>> {
    const opened = await this.open(repo)
    if (!opened.ok) return opened

    try {
      await action()
      return { ok: true, value: null }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /**
   * Starts watching the files Git writes and the working tree, so the interface
   * can refresh when a `git add`, a `commit` or an editor's save happens outside
   * Seam. Returns null when the path is not a repository this Git version can
   * read.
   */
  async watch(repo: string, onChange: () => void): Promise<GitWatcher | null> {
    const gitDir = await this.gitDirectory(repo)
    if (gitDir === null) return null
    return new GitWatcher(gitDir, onChange, { workingTree: repo })
  }

  /** Absolute path of the repository's git folder, or null when it is not one. */
  async gitDirectory(repo: string): Promise<string | null> {
    const opened = await this.open(repo)
    if (!opened.ok) return null

    try {
      const result = await this.runner.run(['rev-parse', '--absolute-git-dir'], {
        cwd: repo,
        readOnly: true
      })
      if (result.code !== 0) return null
      const path = result.stdout.toString('utf8').trim()
      return path === '' ? null : path
    } catch {
      return null
    }
  }

  /** Checks that the path is a repository that this Git version can read. */
  private async open(repo: string): Promise<{ ok: true; value: null } | Failure> {
    if (!isDirectory(repo)) {
      return failure('not-a-repository', `Not a folder: ${repo}`)
    }

    try {
      this.versionChecked ??= this.runner.ensureVersion(repo)
      await this.versionChecked
      const probe = await this.runner.run(['rev-parse', '--git-dir'], { cwd: repo, readOnly: true })
      if (probe.code !== 0) {
        return failure('not-a-repository', probe.stderr.trim() || repo)
      }
      return { ok: true, value: null }
    } catch (error) {
      return failureFrom(error)
    }
  }
}
