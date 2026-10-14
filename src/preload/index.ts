// SPDX-License-Identifier: MIT

import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  IPC_CONTRACT_VERSION,
  type IpcResult,
  type RepositorySnapshot,
  type SeamApi
} from '../shared/ipc'

const seamApi: SeamApi = {
  contractVersion: IPC_CONTRACT_VERSION,
  chooseRepository: () =>
    ipcRenderer.invoke(IPC_CHANNELS.chooseRepository) as Promise<string | null>,
  listRecentRepositories: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listRecentRepositories) as Promise<string[]>,
  initialRepository: () =>
    ipcRenderer.invoke(IPC_CHANNELS.initialRepository) as Promise<string | null>,
  readRepositoryStatus: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.readRepositoryStatus, repo) as Promise<
      IpcResult<RepositorySnapshot>
    >
}

contextBridge.exposeInMainWorld('seam', seamApi)
