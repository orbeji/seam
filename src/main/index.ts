// SPDX-License-Identifier: MIT

import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerRepositoryHandlers } from './ipc/repository-handlers'
import { CommitDrafts } from './session/commit-drafts'
import { CommitHistory } from './session/commit-history'
import { repositoryFromArgv } from './session/launch-arguments'
import { RecentRepositories } from './session/recent-repositories'
import { RepositoryService } from './session/repository-service'
import { Settings } from './session/settings'

// Lets a portable install, and the end-to-end test, keep its data out of the
// real user profile. Must run before the app is ready.
const userData = process.env['SEAM_USER_DATA']
if (userData !== undefined && userData !== '') {
  app.setPath('userData', userData)
}

/**
 * End-to-end runs set this so the window is never shown: the tests drive the
 * renderer through Playwright while nothing appears under the pointer or takes
 * the desktop's focus.
 */
const HIDDEN_WINDOW = process.env['SEAM_HIDDEN_WINDOW'] === '1'

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#17181b',
    title: 'Seam',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A hidden window would otherwise throttle its animation frames.
      backgroundThrottling: !HIDDEN_WINDOW
    }
  })

  if (!HIDDEN_WINDOW) {
    window.on('ready-to-show', () => {
      window.show()
    })
  }

  // electron-vite exposes the dev server URL while running `npm run dev`.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

void app.whenReady().then(() => {
  const recent = new RecentRepositories(join(app.getPath('userData'), 'recent-repositories.json'))
  const drafts = new CommitDrafts(join(app.getPath('userData'), 'commit-drafts.json'))
  const history = new CommitHistory(join(app.getPath('userData'), 'commit-history.json'))
  const settings = new Settings(join(app.getPath('userData'), 'settings.json'))
  const initialRepository = repositoryFromArgv(process.argv)
  if (initialRepository) recent.remember(initialRepository)
  registerRepositoryHandlers(
    new RepositoryService(),
    recent,
    drafts,
    history,
    settings,
    initialRepository
  )

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
