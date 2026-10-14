// SPDX-License-Identifier: MIT

import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { RecentRepositories } from '../session/recent-repositories'
import type { RepositoryService } from '../session/repository-service'

const OPEN_DIRECTORY: OpenDialogOptions = { properties: ['openDirectory'] }

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
}
