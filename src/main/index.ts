// SPDX-License-Identifier: MIT

import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerRepositoryHandlers } from './ipc/repository-handlers'
import { repositoryFromArgv } from './session/launch-arguments'
import { RecentRepositories } from './session/recent-repositories'
import { RepositoryService } from './session/repository-service'

// Lets a portable install, and the end-to-end test, keep its data out of the
// real user profile. Must run before the app is ready.
const userData = process.env['SEAM_USER_DATA']
if (userData !== undefined && userData !== '') {
  app.setPath('userData', userData)
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1e1f22',
    title: 'Seam',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.on('ready-to-show', () => {
    window.show()
  })

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
  const initialRepository = repositoryFromArgv(process.argv)
  if (initialRepository) recent.remember(initialRepository)
  registerRepositoryHandlers(new RepositoryService(), recent, initialRepository)

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
