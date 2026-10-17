// SPDX-License-Identifier: MIT

import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions, type WebContents } from 'electron'
import type { FileVersionSource, StagePathsRequest } from '../../shared/ipc'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { GitWatcher } from '../session/git-watcher'
import type { RecentRepositories } from '../session/recent-repositories'
import type { RepositoryService } from '../session/repository-service'

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

/** Narrows an IPC payload to a repository and a path, rejecting anything else. */
function parsePathRequest(value: unknown): { repo: string; path: string } | null {
  if (typeof value !== 'object' || value === null) return null
  const { repo, path } = value as Record<string, unknown>
  if (typeof repo !== 'string' || typeof path !== 'string') return null
  return { repo, path }
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
    if (result.ok) void watch(path, event.sender)
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
}
