// SPDX-License-Identifier: MIT

import {
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  type OpenDialogOptions,
  type WebContents
} from 'electron'
import type {
  CommitRequest,
  CrlfChoice,
  FileVersionSource,
  HunkRange,
  HunkWriteRequest,
  IdentityWriteRequest,
  IndexWriteRequest,
  RevertHunksRequest,
  StagePathsRequest
} from '../../shared/ipc'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { CommitDrafts } from '../session/commit-drafts'
import type { CommitHistory } from '../session/commit-history'
import type { GitWatcher } from '../session/git-watcher'
import type { RecentRepositories } from '../session/recent-repositories'
import type { RepositoryService } from '../session/repository-service'
import type { Settings } from '../session/settings'

const OPEN_DIRECTORY: OpenDialogOptions = { properties: ['openDirectory'] }

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

  ipcMain.handle(IPC_CHANNELS.listRecentRepositories, () => recent.list())

  ipcMain.handle(IPC_CHANNELS.initialRepository, () => initialRepository)

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

  ipcMain.handle(IPC_CHANNELS.readSettings, () => ({
    ok: true,
    value: { runHooks: settings.runHooks }
  }))

  ipcMain.handle(IPC_CHANNELS.writeSettings, (_event, value: unknown) => {
    if (typeof value !== 'object' || value === null) {
      return { ok: false, code: 'unknown', message: 'Invalid settings' }
    }
    const runHooks = (value as Record<string, unknown>)['runHooks']
    if (typeof runHooks !== 'boolean') {
      return { ok: false, code: 'unknown', message: 'Invalid settings' }
    }
    try {
      settings.setRunHooks(runHooks)
      return { ok: true, value: null }
    } catch (error) {
      return {
        ok: false,
        code: 'unknown',
        message: error instanceof Error ? error.message : String(error)
      }
    }
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
