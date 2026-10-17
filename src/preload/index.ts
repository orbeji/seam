// SPDX-License-Identifier: MIT

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC_CHANNELS,
  IPC_CONTRACT_VERSION,
  type FileComparison,
  type FileComparisonRequest,
  type HunkWriteRequest,
  type IpcResult,
  type RepositorySnapshot,
  type SeamApi,
  type StagePathsRequest,
  type StagingModel,
  type StagingModelRequest
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
    >,
  readFileComparison: (request: FileComparisonRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.readFileComparison, request) as Promise<
      IpcResult<FileComparison>
    >,
  readStagingModel: (request: StagingModelRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.readStagingModel, request) as Promise<
      IpcResult<StagingModel | null>
    >,
  stageFiles: (request: StagePathsRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.stageFiles, request) as Promise<IpcResult<null>>,
  unstageFiles: (request: StagePathsRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.unstageFiles, request) as Promise<IpcResult<null>>,
  writeHunks: (request: HunkWriteRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.writeHunks, request) as Promise<IpcResult<null>>,
  onRepositoryChanged: (listener: (repo: string) => void) => {
    const handler = (_event: IpcRendererEvent, repo: string): void => listener(repo)
    ipcRenderer.on(IPC_CHANNELS.repositoryChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.repositoryChanged, handler)
    }
  }
}

contextBridge.exposeInMainWorld('seam', seamApi)
