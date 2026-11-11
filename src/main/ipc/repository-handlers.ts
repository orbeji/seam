// SPDX-License-Identifier: MIT

import {
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type OpenDialogOptions,
  type WebContents
} from 'electron'
import type {
  CheckoutBranchRequest,
  CheckoutCommitRequest,
  CloneRequest,
  CommitFileComparisonRequest,
  CommitRequest,
  ConflictAcceptRequest,
  ConflictRevertRequest,
  CreateBranchRequest,
  CrlfChoice,
  DeleteBranchRequest,
  FileVersionSource,
  GitFlowFinishRequest,
  GitFlowInitRequest,
  GitFlowStartRequest,
  HunkRange,
  HunkWriteRequest,
  IdentityWriteRequest,
  IndexWriteRequest,
  MergeApplyRequest,
  MergeRequest,
  PushRequest,
  PushUpdateRequest,
  RenameBranchRequest,
  RevertHunksRequest,
  SettingsPatch,
  StagePathsRequest
} from '../../shared/ipc'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { GitFlowKind, MergeStrategy } from '../../shared/git'
import type { CommitDrafts } from '../session/commit-drafts'
import type { CommitHistory } from '../session/commit-history'
import type { GitWatcher } from '../session/git-watcher'
import type { RecentRepositories } from '../session/recent-repositories'
import type { RepositoryService } from '../session/repository-service'
import type { Settings } from '../session/settings'

const OPEN_DIRECTORY: OpenDialogOptions = { properties: ['openDirectory'] }

/**
 * The only pages the interface may open in the system browser. Keeping the
 * list here means a compromised renderer cannot use the bridge to launch an
 * arbitrary URL.
 */
const HELP_URLS = new Set([
  'https://git-scm.com/downloads',
  'https://git-scm.com/download/linux',
  'https://git-scm.com/download/win',
  'https://github.com/orbeji/seam#readme'
])

const VERSION_SOURCES: readonly FileVersionSource[] = [
  'head',
  'index',
  'worktree',
  'stage1',
  'stage2',
  'stage3'
]

interface ComparisonRequest {
  repo: string
  path: string
  from: FileVersionSource
  to: FileVersionSource
}

/** Narrows an IPC payload to the comparison request, rejecting anything else. */
function parseComparisonRequest(value: unknown): ComparisonRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, path, from, to } = value as Record<string, unknown>
  if (typeof repo !== 'string' || typeof path !== 'string') return null
  if (!VERSION_SOURCES.includes(from as FileVersionSource)) return null
  if (!VERSION_SOURCES.includes(to as FileVersionSource)) return null
  return { repo, path, from: from as FileVersionSource, to: to as FileVersionSource }
}

/** Narrows an IPC payload to a stage or unstage request, rejecting anything else. */
function parseStagePaths(value: unknown): StagePathsRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, paths } = value as Record<string, unknown>
  if (typeof repo !== 'string') return null
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string')) return null
  return { repo, paths: paths as string[] }
}

/** Whether a value is a hunk range: four line numbers and nothing else. */
function isHunkRange(value: unknown): value is HunkRange {
  if (typeof value !== 'object' || value === null) return false
  const { aStart, aLines, bStart, bLines } = value as Record<string, unknown>
  return (
    typeof aStart === 'number' &&
    typeof aLines === 'number' &&
    typeof bStart === 'number' &&
    typeof bLines === 'number'
  )
}

/** Narrows an IPC payload to a write of hunks, rejecting anything else. */
function parseHunkWrite(value: unknown): HunkWriteRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, path, action, hunks, lines } = value as Record<string, unknown>
  if (typeof repo !== 'string' || typeof path !== 'string') return null
  if (action !== 'stage' && action !== 'unstage') return null
  if (!Array.isArray(hunks) || !hunks.every(isHunkRange)) return null
  if (
    lines !== undefined &&
    (!Array.isArray(lines) || lines.some((line) => typeof line !== 'number'))
  ) {
    return null
  }
  return { repo, path, action, hunks, ...(lines === undefined ? {} : { lines: lines as number[] }) }
}

/** Narrows an IPC payload to a write of the index's whole text. */
function parseIndexWrite(value: unknown): IndexWriteRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, path, content } = value as Record<string, unknown>
  if (typeof repo !== 'string' || typeof path !== 'string' || typeof content !== 'string') {
    return null
  }
  return { repo, path, content }
}

/** Narrows an IPC payload to a revert of hunks, rejecting anything else. */
function parseRevertHunks(value: unknown): RevertHunksRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, path, hunks } = value as Record<string, unknown>
  if (typeof repo !== 'string' || typeof path !== 'string') return null
  if (!Array.isArray(hunks) || !hunks.every(isHunkRange)) return null
  return { repo, path, hunks }
}

/** Narrows an IPC payload to a repository and a path, rejecting anything else. */
function parsePathRequest(value: unknown): { repo: string; path: string } | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, path } = value as Record<string, unknown>
  if (typeof repo !== 'string' || typeof path !== 'string') return null
  return { repo, path }
}

/** Narrows an IPC payload to accepting one side of a conflict. */
function parseConflictAccept(value: unknown): ConflictAcceptRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, path, side, fingerprint, force } = value as Record<string, unknown>
  if (typeof repo !== 'string' || typeof path !== 'string') return null
  if (side !== 'yours' && side !== 'theirs') return null
  if (fingerprint !== null && typeof fingerprint !== 'string') return null
  if (force !== undefined && typeof force !== 'boolean') return null
  return {
    repo,
    path,
    side,
    fingerprint,
    ...(force === undefined ? {} : { force })
  }
}

/** Narrows an IPC payload to undoing one conflict resolution. */
function parseConflictRevert(value: unknown): ConflictRevertRequest | null {
  return parsePathRequest(value)
}

/** Narrows an IPC payload to writing the merge editor's result. */
function parseMergeApply(value: unknown): MergeApplyRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, path, content, stage } = value as Record<string, unknown>
  if (typeof repo !== 'string' || typeof path !== 'string' || typeof content !== 'string') {
    return null
  }
  if (typeof stage !== 'boolean') return null
  return { repo, path, content, stage }
}

/** Narrows an IPC payload to a clone request, rejecting anything else. */
function parseCloneRequest(value: unknown): CloneRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { url, path } = value as Record<string, unknown>
  if (typeof url !== 'string' || typeof path !== 'string') return null
  return { url, path }
}

/** Narrows an IPC payload to a push, rejecting anything else. */
function parsePushRequest(value: unknown): PushRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, remote, branch, remoteBranch, setUpstream, tags, forceLeaseOid } = value as Record<
    string,
    unknown
  >
  if (
    typeof repo !== 'string' ||
    typeof remote !== 'string' ||
    typeof branch !== 'string' ||
    typeof remoteBranch !== 'string'
  ) {
    return null
  }
  if (remote === '' || branch === '' || remoteBranch === '') return null
  if (typeof setUpstream !== 'boolean') return null
  if (tags !== 'none' && tags !== 'follow' && tags !== 'all') return null
  if (forceLeaseOid !== null && typeof forceLeaseOid !== 'string') return null
  return { repo, remote, branch, remoteBranch, setUpstream, tags, forceLeaseOid }
}

/** Narrows an IPC payload to the update that follows a rejected push. */
function parsePushUpdate(value: unknown): PushUpdateRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, strategy } = value as Record<string, unknown>
  if (typeof repo !== 'string' || (strategy !== 'rebase' && strategy !== 'merge')) return null
  return { repo, strategy }
}

/** Narrows an IPC payload to a branch checkout request. */
function parseCheckoutBranch(value: unknown): CheckoutBranchRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, branch, createTracking } = value as Record<string, unknown>
  if (typeof repo !== 'string' || typeof branch !== 'string') return null
  if (createTracking !== undefined && typeof createTracking !== 'boolean') return null
  return { repo, branch, ...(createTracking === undefined ? {} : { createTracking }) }
}

/** Narrows an IPC payload to checking out one commit. */
function parseCheckoutCommit(value: unknown): CheckoutCommitRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, commit } = value as Record<string, unknown>
  if (typeof repo !== 'string' || typeof commit !== 'string' || commit === '') return null
  return { repo, commit }
}

/** Narrows an IPC payload to a branch creation request. */
function parseCreateBranch(value: unknown): CreateBranchRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, name, startPoint, checkout } = value as Record<string, unknown>
  if (typeof repo !== 'string' || typeof name !== 'string') return null
  if (startPoint !== undefined && startPoint !== null && typeof startPoint !== 'string') return null
  if (typeof checkout !== 'boolean') return null
  return { repo, name, startPoint: startPoint ?? null, checkout }
}

/** Narrows an IPC payload to a branch rename request. */
function parseRenameBranch(value: unknown): RenameBranchRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, name, newName } = value as Record<string, unknown>
  if (typeof repo !== 'string' || typeof name !== 'string' || typeof newName !== 'string') {
    return null
  }
  return { repo, name, newName }
}

/** Narrows an IPC payload to a branch deletion request. */
function parseDeleteBranch(value: unknown): DeleteBranchRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, name, force } = value as Record<string, unknown>
  if (typeof repo !== 'string' || typeof name !== 'string' || typeof force !== 'boolean') {
    return null
  }
  return { repo, name, force }
}

/** Narrows an IPC payload to a merge request. */
function parseMergeRequest(value: unknown): MergeRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, source, strategy, message } = value as Record<string, unknown>
  if (typeof repo !== 'string' || typeof source !== 'string' || typeof message !== 'string') {
    return null
  }
  if (strategy !== 'merge-commit' && strategy !== 'fast-forward' && strategy !== 'squash') {
    return null
  }
  return { repo, source, strategy: strategy as MergeStrategy, message }
}

/** Narrows an IPC payload to a GitFlow initialization request. */
function parseGitFlowInit(value: unknown): GitFlowInitRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const fields = value as Record<string, unknown>
  const keys = [
    'repo',
    'master',
    'develop',
    'featurePrefix',
    'releasePrefix',
    'hotfixPrefix',
    'versionTagPrefix'
  ] as const
  for (const key of keys) {
    if (typeof fields[key] !== 'string') return null
  }
  return {
    repo: fields['repo'] as string,
    master: fields['master'] as string,
    develop: fields['develop'] as string,
    featurePrefix: fields['featurePrefix'] as string,
    releasePrefix: fields['releasePrefix'] as string,
    hotfixPrefix: fields['hotfixPrefix'] as string,
    versionTagPrefix: fields['versionTagPrefix'] as string
  }
}

/** Narrows an IPC payload to a GitFlow branch start. */
function parseGitFlowStart(value: unknown): GitFlowStartRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, kind, name } = value as Record<string, unknown>
  if (typeof repo !== 'string' || typeof name !== 'string') return null
  if (kind !== 'feature' && kind !== 'release' && kind !== 'hotfix') return null
  return { repo, kind: kind as GitFlowKind, name }
}

/** Narrows an IPC payload to a GitFlow finish. */
function parseGitFlowFinish(value: unknown): GitFlowFinishRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, tag } = value as Record<string, unknown>
  if (typeof repo !== 'string') return null
  if (tag !== null && typeof tag !== 'string') return null
  return { repo, tag }
}

/** Narrows an IPC payload to a one-file commit comparison request. */
function parseCommitFileComparison(value: unknown): CommitFileComparisonRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, commit, path, previousPath } = value as Record<string, unknown>
  if (typeof repo !== 'string' || typeof commit !== 'string' || typeof path !== 'string') {
    return null
  }
  if (previousPath !== undefined && previousPath !== null && typeof previousPath !== 'string') {
    return null
  }
  return { repo, commit, path, previousPath: previousPath ?? null }
}

/** Narrows an IPC payload to a repository and a message, rejecting anything
 * else. The draft write and the commit share this shape. */
function parseMessageRequest(value: unknown): { repo: string; message: string } | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, message } = value as Record<string, unknown>
  if (typeof repo !== 'string' || typeof message !== 'string') return null
  return { repo, message }
}

/** Narrows an IPC payload to a commit, rejecting anything else. */
function parseCommitRequest(value: unknown): CommitRequest | null {
  const base = parseMessageRequest(value)
  if (base === null) return null
  const { amend, author, signoff, runHooks, crlf } = value as Record<string, unknown>
  if (typeof amend !== 'boolean' || typeof signoff !== 'boolean') return null
  if (typeof author !== 'string' || typeof runHooks !== 'boolean') return null
  const choice = crlf === undefined ? null : parseCrlfChoice(crlf)
  if (crlf !== undefined && choice === null) return null
  return {
    repo: base.repo,
    message: base.message,
    amend,
    author,
    signoff,
    runHooks,
    ...(choice === null ? {} : { crlf: choice })
  }
}

/** Narrows an IPC payload to the answer to a CRLF warning, rejecting anything else. */
function parseCrlfChoice(value: unknown): CrlfChoice | null {
  if (typeof value !== 'object' || value === null) return null
  const { fix, disable } = value as Record<string, unknown>
  if (typeof fix !== 'boolean') return null
  if (disable !== undefined && disable !== 'repo' && disable !== 'global') return null
  return { fix, ...(disable === undefined ? {} : { disable }) }
}

/**
 * What the commit does about CRLF endings: an answer to the warning decides,
 * and before any answer the preference says whether the check runs at all.
 */
function crlfOptionsFor(
  parsed: CommitRequest,
  settings: Settings
): { checkCrlf?: true; fixCrlf?: true } {
  if (parsed.crlf === undefined) {
    return settings.crlfWarningFor(parsed.repo) ? { checkCrlf: true } : {}
  }
  // Commit As Is carries neither flag, so the commit runs without the check.
  return parsed.crlf.fix ? { fixCrlf: true } : {}
}

/** Narrows an IPC payload to an identity to store, rejecting anything else. */
function parseIdentityWrite(value: unknown): IdentityWriteRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, name, email, scope } = value as Record<string, unknown>
  if (typeof repo !== 'string' || typeof name !== 'string' || typeof email !== 'string') return null
  if (scope !== 'local' && scope !== 'global') return null
  return { repo, name, email, scope }
}

/** Narrows an IPC payload to a change of the stored preferences. */
function parseSettingsPatch(value: unknown): SettingsPatch | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const patch: SettingsPatch = {}
  if ('runHooks' in raw) {
    if (typeof raw['runHooks'] !== 'boolean') return null
    patch.runHooks = raw['runHooks']
  }
  if ('language' in raw) {
    if (raw['language'] !== null && typeof raw['language'] !== 'string') return null
    patch.language = raw['language']
  }
  if ('theme' in raw) {
    if (raw['theme'] !== 'dark' && raw['theme'] !== 'light') return null
    patch.theme = raw['theme']
  }
  if ('whitespace' in raw) {
    const whitespace = raw['whitespace']
    if (
      whitespace !== 'none' &&
      whitespace !== 'trim' &&
      whitespace !== 'ignore' &&
      whitespace !== 'ignore-and-blank'
    ) {
      return null
    }
    patch.whitespace = whitespace
  }
  if ('highlight' in raw) {
    const highlight = raw['highlight']
    if (
      highlight !== 'words' &&
      highlight !== 'lines' &&
      highlight !== 'split' &&
      highlight !== 'characters' &&
      highlight !== 'none'
    ) {
      return null
    }
    patch.highlight = highlight
  }
  if ('syntaxTheme' in raw) {
    const syntaxTheme = raw['syntaxTheme']
    if (syntaxTheme !== 'seam' && syntaxTheme !== 'github' && syntaxTheme !== 'vivid') return null
    patch.syntaxTheme = syntaxTheme
  }
  if ('collapse' in raw) {
    if (typeof raw['collapse'] !== 'boolean') return null
    patch.collapse = raw['collapse']
  }
  if ('signoff' in raw) {
    if (typeof raw['signoff'] !== 'boolean') return null
    patch.signoff = raw['signoff']
  }
  if ('historyWidth' in raw) {
    const historyWidth = raw['historyWidth']
    if (typeof historyWidth !== 'number' || !Number.isFinite(historyWidth)) return null
    patch.historyWidth = historyWidth
  }
  return patch
}

/** One window's watch over the repository it currently shows. */
interface WatchEntry {
  readonly repo: string
  readonly watcher: GitWatcher
}

/**
 * Registers the repository channels on the main process. The interface reaches
 * these only through the preload bridge, so `ipcMain` is the whole entry point.
 *
 * It also owns the git-folder watchers: reading a repository's status starts
 * watching it, and every change Git makes on disk is pushed back to the window
 * so an external `git add` shows up without the user asking for it.
 */
export function registerRepositoryHandlers(
  service: RepositoryService,
  recent: RecentRepositories,
  drafts: CommitDrafts,
  history: CommitHistory,
  settings: Settings,
  initialRepository: string | null
): void {
  const watches = new Map<number, WatchEntry>()

  /** Watches `repo` for the window, replacing any watch it already had. */
  async function watch(repo: string, sender: WebContents): Promise<void> {
    const id = sender.id
    if (watches.get(id)?.repo === repo) return

    const watcher = await service.watch(repo, () => {
      if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.repositoryChanged, repo)
    })
    if (watcher === null) return

    // Another call may have set up the same watch while this one awaited.
    const started = watches.get(id)
    if (started?.repo === repo) {
      watcher.close()
      return
    }
    started?.watcher.close()

    const entry: WatchEntry = { repo, watcher }
    watches.set(id, entry)
    sender.once('destroyed', () => {
      if (watches.get(id) !== entry) return
      watcher.close()
      watches.delete(id)
    })
  }

  ipcMain.handle(IPC_CHANNELS.chooseRepository, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const result = parent
      ? await dialog.showOpenDialog(parent, OPEN_DIRECTORY)
      : await dialog.showOpenDialog(OPEN_DIRECTORY)

    if (result.canceled) return null
    const repo = result.filePaths[0]
    if (repo === undefined) return null
    recent.remember(repo)
    return repo
  })

  ipcMain.handle(IPC_CHANNELS.chooseDirectory, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const result = parent
      ? await dialog.showOpenDialog(parent, OPEN_DIRECTORY)
      : await dialog.showOpenDialog(OPEN_DIRECTORY)

    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })

  ipcMain.handle(IPC_CHANNELS.cloneRepository, async (_event, request: unknown) => {
    const parsed = parseCloneRequest(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid clone request' }
    }
    const result = await service.clone(parsed.url, parsed.path)
    // The clone is only worth remembering once Git has made it.
    if (result.ok) recent.remember(result.value)
    return result
  })

  ipcMain.handle(IPC_CHANNELS.listRecentRepositories, () => recent.list())

  ipcMain.handle(IPC_CHANNELS.removeRecentRepository, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid repository path' }
    }
    recent.forget(repo)
    return { ok: true, value: null }
  })

  ipcMain.handle(IPC_CHANNELS.initialRepository, () => initialRepository)

  ipcMain.handle(IPC_CHANNELS.readGitStatus, () => service.gitStatus())

  ipcMain.handle(IPC_CHANNELS.openExternal, async (_event, url: unknown) => {
    if (typeof url !== 'string' || !HELP_URLS.has(url)) {
      return { ok: false, code: 'unknown', message: 'URL not allowed' }
    }
    await shell.openExternal(url)
    return { ok: true, value: null }
  })

  ipcMain.handle(IPC_CHANNELS.readRepositoryStatus, async (event, repo: unknown) => {
    const path = typeof repo === 'string' ? repo : ''
    const result = await service.snapshot(path)
    // Start watching before answering: a Git command that runs as soon as the
    // window shows the repository would otherwise race the watcher and go
    // unnoticed until the next change.
    if (result.ok) await watch(path, event.sender)
    return result
  })

  ipcMain.handle(IPC_CHANNELS.readFileComparison, (_event, request: unknown) => {
    const parsed = parseComparisonRequest(request)
    if (!parsed) {
      return { ok: false, code: 'unknown', message: 'Invalid comparison request' }
    }
    return service.readFileComparison(parsed.repo, parsed.path, parsed.from, parsed.to)
  })

  ipcMain.handle(IPC_CHANNELS.readStagingModel, (_event, request: unknown) => {
    const parsed = parsePathRequest(request)
    if (!parsed) return { ok: false, code: 'unknown', message: 'Invalid staging model request' }
    return service.readStagingModel(parsed.repo, parsed.path)
  })

  ipcMain.handle(IPC_CHANNELS.stageFiles, (_event, request: unknown) => {
    const parsed = parseStagePaths(request)
    if (!parsed) return { ok: false, code: 'unknown', message: 'Invalid staging request' }
    return service.stage(parsed.repo, parsed.paths)
  })

  ipcMain.handle(IPC_CHANNELS.unstageFiles, (_event, request: unknown) => {
    const parsed = parseStagePaths(request)
    if (!parsed) return { ok: false, code: 'unknown', message: 'Invalid staging request' }
    return service.unstage(parsed.repo, parsed.paths)
  })

  ipcMain.handle(IPC_CHANNELS.discardFiles, (_event, request: unknown) => {
    const parsed = parseStagePaths(request)
    if (!parsed) return { ok: false, code: 'unknown', message: 'Invalid discard request' }
    return service.discard(parsed.repo, parsed.paths)
  })

  ipcMain.handle(IPC_CHANNELS.writeHunks, (_event, request: unknown) => {
    const parsed = parseHunkWrite(request)
    if (!parsed) return { ok: false, code: 'unknown', message: 'Invalid hunk write request' }
    return service.writeHunks(parsed.repo, parsed.path, parsed.action, parsed.hunks, parsed.lines)
  })

  ipcMain.handle(IPC_CHANNELS.writeIndex, (_event, request: unknown) => {
    const parsed = parseIndexWrite(request)
    if (!parsed) return { ok: false, code: 'unknown', message: 'Invalid index write request' }
    return service.writeIndex(parsed.repo, parsed.path, parsed.content)
  })

  ipcMain.handle(IPC_CHANNELS.revertHunks, (_event, request: unknown) => {
    const parsed = parseRevertHunks(request)
    if (!parsed) return { ok: false, code: 'unknown', message: 'Invalid hunk revert request' }
    return service.revert(parsed.repo, parsed.path, parsed.hunks)
  })

  ipcMain.handle(IPC_CHANNELS.readCommitDraft, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid commit draft request' }
    }
    return { ok: true, value: drafts.read(repo) }
  })

  ipcMain.handle(IPC_CHANNELS.writeCommitDraft, (_event, request: unknown) => {
    const parsed = parseMessageRequest(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid commit draft request' }
    }
    try {
      drafts.write(parsed.repo, parsed.message)
      return { ok: true, value: null }
    } catch (error) {
      return {
        ok: false,
        code: 'unknown',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.createCommit, async (_event, request: unknown) => {
    const parsed = parseCommitRequest(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid commit request' }
    }
    settings.setRunHooks(parsed.runHooks)
    // A "do not warn again" travels with the commit that answers the warning.
    if (parsed.crlf?.disable === 'repo') settings.setCrlfWarningFor(parsed.repo, false)
    if (parsed.crlf?.disable === 'global') settings.setCrlfWarning(false)

    const result = await service.commit(parsed.repo, parsed.message, {
      amend: parsed.amend,
      author: parsed.author,
      signoff: parsed.signoff,
      noVerify: !parsed.runHooks,
      ...crlfOptionsFor(parsed, settings)
    })

    // A message Seam confirmed joins the repository's history, so the box can
    // offer it again. A failure to write the history must not lose the commit.
    if (result.ok && result.value.created) {
      try {
        history.remember(parsed.repo, parsed.message)
      } catch {
        /* the commit already exists; only remembering it failed */
      }
    }
    return result
  })

  ipcMain.handle(IPC_CHANNELS.cancelCommit, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid cancel request' }
    }
    return service.cancelCommit(repo)
  })

  ipcMain.handle(IPC_CHANNELS.readCommitHistory, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid history request' }
    }
    try {
      return { ok: true, value: history.read(repo) }
    } catch (error) {
      return {
        ok: false,
        code: 'unknown',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.readCommitTemplate, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid template request' }
    }
    return service.readCommitTemplate(repo)
  })

  ipcMain.handle(IPC_CHANNELS.readRepositoryHistory, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid history request' }
    }
    return service.readHistory(repo)
  })

  ipcMain.handle(IPC_CHANNELS.readCommitChanges, (_event, repo: unknown, commit: unknown) => {
    if (typeof repo !== 'string' || typeof commit !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid commit changes request' }
    }
    return service.readCommitChanges(repo, commit)
  })

  ipcMain.handle(IPC_CHANNELS.checkoutCommit, (_event, request: unknown) => {
    const parsed = parseCheckoutCommit(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid checkout request' }
    }
    return service.checkoutCommit(parsed.repo, parsed.commit)
  })

  ipcMain.handle(IPC_CHANNELS.readCommitFileComparison, (_event, request: unknown) => {
    const parsed = parseCommitFileComparison(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid commit file request' }
    }
    return service.readCommitFileComparison(
      parsed.repo,
      parsed.commit,
      parsed.path,
      parsed.previousPath
    )
  })

  ipcMain.handle(IPC_CHANNELS.readSettings, () => ({
    ok: true,
    value: settings.read()
  }))

  ipcMain.handle(IPC_CHANNELS.writeSettings, (_event, value: unknown) => {
    const patch = parseSettingsPatch(value)
    if (patch === null) {
      return { ok: false, code: 'unknown', message: 'Invalid settings' }
    }
    try {
      settings.update(patch)
      return { ok: true, value: null }
    } catch (error) {
      return {
        ok: false,
        code: 'unknown',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.readConflicts, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid conflict request' }
    }
    return service.readConflicts(repo)
  })

  ipcMain.handle(IPC_CHANNELS.acceptConflict, (_event, request: unknown) => {
    const parsed = parseConflictAccept(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid conflict request' }
    }
    return service.acceptConflict(
      parsed.repo,
      parsed.path,
      parsed.side,
      parsed.fingerprint,
      parsed.force === true
    )
  })

  ipcMain.handle(IPC_CHANNELS.resolveSimpleConflicts, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid conflict request' }
    }
    return service.resolveSimpleConflicts(repo)
  })

  ipcMain.handle(IPC_CHANNELS.revertConflict, (_event, request: unknown) => {
    const parsed = parseConflictRevert(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid conflict request' }
    }
    return service.revertConflict(parsed.repo, parsed.path)
  })

  ipcMain.handle(IPC_CHANNELS.readMergeEditor, (_event, request: unknown) => {
    const parsed = parsePathRequest(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid merge editor request' }
    }
    return service.readMergeEditor(parsed.repo, parsed.path)
  })

  ipcMain.handle(IPC_CHANNELS.applyMerge, (_event, request: unknown) => {
    const parsed = parseMergeApply(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid merge write request' }
    }
    return service.applyMerge(parsed)
  })

  ipcMain.handle(IPC_CHANNELS.finishOperation, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid finish request' }
    }
    return service.finishOperation(repo)
  })

  ipcMain.handle(IPC_CHANNELS.skipOperation, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid skip request' }
    }
    return service.skipOperation(repo)
  })

  ipcMain.handle(IPC_CHANNELS.abortOperation, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid abort request' }
    }
    return service.abortOperation(repo)
  })

  ipcMain.handle(IPC_CHANNELS.readMergeMessage, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid merge message request' }
    }
    return service.readMergeMessage(repo)
  })

  ipcMain.handle(IPC_CHANNELS.readPushState, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid push request' }
    }
    return service.readPushState(repo)
  })

  ipcMain.handle(IPC_CHANNELS.listBranches, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid branch list request' }
    }
    return service.listBranches(repo)
  })

  ipcMain.handle(IPC_CHANNELS.checkoutBranch, (_event, request: unknown) => {
    const parsed = parseCheckoutBranch(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid checkout request' }
    }
    return service.checkoutBranch(parsed.repo, parsed.branch, parsed.createTracking)
  })

  ipcMain.handle(IPC_CHANNELS.createBranch, (_event, request: unknown) => {
    const parsed = parseCreateBranch(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid branch creation request' }
    }
    return service.createBranch(parsed.repo, parsed.name, parsed.startPoint, parsed.checkout)
  })

  ipcMain.handle(IPC_CHANNELS.renameBranch, (_event, request: unknown) => {
    const parsed = parseRenameBranch(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid branch rename request' }
    }
    return service.renameBranch(parsed.repo, parsed.name, parsed.newName)
  })

  ipcMain.handle(IPC_CHANNELS.deleteBranch, (_event, request: unknown) => {
    const parsed = parseDeleteBranch(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid branch deletion request' }
    }
    return service.deleteBranch(parsed.repo, parsed.name, parsed.force)
  })

  ipcMain.handle(IPC_CHANNELS.readMergeState, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid merge state request' }
    }
    return service.readMergeState(repo)
  })

  ipcMain.handle(IPC_CHANNELS.startMerge, (_event, request: unknown) => {
    const parsed = parseMergeRequest(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid merge request' }
    }
    return service.mergeBranch(parsed.repo, parsed.source, parsed.strategy, parsed.message)
  })

  ipcMain.handle(IPC_CHANNELS.readGitFlow, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid GitFlow state request' }
    }
    return service.readGitFlow(repo)
  })

  ipcMain.handle(IPC_CHANNELS.initGitFlow, (_event, request: unknown) => {
    const parsed = parseGitFlowInit(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid GitFlow initialization request' }
    }
    const { repo, ...config } = parsed
    return service.initGitFlow(repo, config)
  })

  ipcMain.handle(IPC_CHANNELS.startGitFlow, (_event, request: unknown) => {
    const parsed = parseGitFlowStart(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid GitFlow start request' }
    }
    return service.startGitFlow(parsed.repo, parsed.kind, parsed.name)
  })

  ipcMain.handle(IPC_CHANNELS.finishGitFlow, (_event, request: unknown) => {
    const parsed = parseGitFlowFinish(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid GitFlow finish request' }
    }
    return service.finishGitFlow(parsed.repo, parsed.tag)
  })

  ipcMain.handle(IPC_CHANNELS.runPush, (event, request: unknown) => {
    const parsed = parsePushRequest(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid push request' }
    }
    return service.push(
      parsed.repo,
      {
        remote: parsed.remote,
        branch: parsed.branch,
        remoteBranch: parsed.remoteBranch,
        setUpstream: parsed.setUpstream,
        tags: parsed.tags,
        forceLeaseOid: parsed.forceLeaseOid
      },
      (text) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC_CHANNELS.pushProgress, { repo: parsed.repo, text })
        }
      }
    )
  })

  ipcMain.handle(IPC_CHANNELS.cancelPush, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid cancel push request' }
    }
    return service.cancelPush(repo)
  })

  ipcMain.handle(IPC_CHANNELS.updateForPush, (_event, request: unknown) => {
    const parsed = parsePushUpdate(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid push update request' }
    }
    return service.updateForPush(parsed.repo, parsed.strategy)
  })

  ipcMain.handle(IPC_CHANNELS.fetchRemotes, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid fetch request' }
    }
    return service.fetchRemotes(repo)
  })

  ipcMain.handle(IPC_CHANNELS.pullUpstream, (_event, request: unknown) => {
    const parsed = parsePushUpdate(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid pull request' }
    }
    return service.pull(parsed.repo, parsed.strategy)
  })

  ipcMain.handle(IPC_CHANNELS.writeClipboardText, (_event, text: unknown) => {
    if (typeof text !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid clipboard text' }
    }
    clipboard.writeText(text)
    return { ok: true, value: null }
  })

  ipcMain.handle(IPC_CHANNELS.readHeadCommit, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid head request' }
    }
    return service.readHeadCommit(repo)
  })

  ipcMain.handle(IPC_CHANNELS.readIdentity, (_event, repo: unknown) => {
    if (typeof repo !== 'string') {
      return { ok: false, code: 'unknown', message: 'Invalid identity request' }
    }
    return service.readIdentity(repo)
  })

  ipcMain.handle(IPC_CHANNELS.writeIdentity, (_event, request: unknown) => {
    const parsed = parseIdentityWrite(request)
    if (parsed === null) {
      return { ok: false, code: 'unknown', message: 'Invalid identity request' }
    }
    return service.writeIdentity(
      parsed.repo,
      { name: parsed.name, email: parsed.email },
      parsed.scope
    )
  })
}
