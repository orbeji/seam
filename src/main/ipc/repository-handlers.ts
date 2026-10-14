// SPDX-License-Identifier: MIT

import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import type { FileVersionSource } from '../../shared/ipc'
import { IPC_CHANNELS } from '../../shared/ipc'
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

/**
 * Registers the repository channels on the main process. The interface reaches
 * these only through the preload bridge, so `ipcMain` is the whole entry point.
 */
export function registerRepositoryHandlers(
  service: RepositoryService,
  recent: RecentRepositories,
  initialRepository: string | null
): void {
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

  ipcMain.handle(IPC_CHANNELS.readRepositoryStatus, (_event, repo: unknown) =>
    service.snapshot(typeof repo === 'string' ? repo : '')
  )

  ipcMain.handle(IPC_CHANNELS.readFileComparison, (_event, request: unknown) => {
    const parsed = parseComparisonRequest(request)
    if (!parsed) {
      return { ok: false, code: 'unknown', message: 'Invalid comparison request' }
    }
    return service.readFileComparison(parsed.repo, parsed.path, parsed.from, parsed.to)
  })
}
