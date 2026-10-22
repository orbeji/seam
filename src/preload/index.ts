// SPDX-License-Identifier: MIT

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  CommitOutcome,
  ConflictAcceptOutcome,
  ConflictState,
  HeadCommit,
  Identity,
  ResolveSimpleOutcome
} from '../shared/git'
import {
  IPC_CHANNELS,
  IPC_CONTRACT_VERSION,
  type CommitDraftWriteRequest,
  type CommitRequest,
  type ConflictAcceptRequest,
  type ConflictRevertRequest,
  type FileComparison,
  type FileComparisonRequest,
  type HunkWriteRequest,
  type IdentityWriteRequest,
  type IndexWriteRequest,
  type IpcResult,
  type MergeApplyRequest,
  type MergeEditorModel,
  type MergeEditorRequest,
  type RepositorySnapshot,
  type RevertHunksRequest,
  type SeamApi,
  type SettingsData,
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
  writeIndex: (request: IndexWriteRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.writeIndex, request) as Promise<IpcResult<null>>,
  revertHunks: (request: RevertHunksRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.revertHunks, request) as Promise<IpcResult<string>>,
  readCommitDraft: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.readCommitDraft, repo) as Promise<IpcResult<string>>,
  writeCommitDraft: (request: CommitDraftWriteRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.writeCommitDraft, request) as Promise<IpcResult<null>>,
  commit: (request: CommitRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.createCommit, request) as Promise<IpcResult<CommitOutcome>>,
  cancelCommit: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelCommit, repo) as Promise<IpcResult<null>>,
  readHeadCommit: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.readHeadCommit, repo) as Promise<IpcResult<HeadCommit>>,
  readCommitHistory: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.readCommitHistory, repo) as Promise<
      IpcResult<readonly string[]>
    >,
  readCommitTemplate: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.readCommitTemplate, repo) as Promise<IpcResult<string | null>>,
  readIdentity: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.readIdentity, repo) as Promise<IpcResult<Identity>>,
  writeIdentity: (request: IdentityWriteRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.writeIdentity, request) as Promise<IpcResult<null>>,
  readSettings: () =>
    ipcRenderer.invoke(IPC_CHANNELS.readSettings) as Promise<IpcResult<SettingsData>>,
  writeSettings: (settings: SettingsData) =>
    ipcRenderer.invoke(IPC_CHANNELS.writeSettings, settings) as Promise<IpcResult<null>>,
  readConflicts: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.readConflicts, repo) as Promise<IpcResult<ConflictState>>,
  acceptConflict: (request: ConflictAcceptRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.acceptConflict, request) as Promise<
      IpcResult<ConflictAcceptOutcome>
    >,
  resolveSimpleConflicts: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.resolveSimpleConflicts, repo) as Promise<
      IpcResult<ResolveSimpleOutcome>
    >,
  revertConflict: (request: ConflictRevertRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.revertConflict, request) as Promise<IpcResult<null>>,
  readMergeEditor: (request: MergeEditorRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.readMergeEditor, request) as Promise<
      IpcResult<MergeEditorModel>
    >,
  applyMerge: (request: MergeApplyRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.applyMerge, request) as Promise<IpcResult<null>>,
  writeClipboardText: (text: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.writeClipboardText, text) as Promise<IpcResult<null>>,
  onRepositoryChanged: (listener: (repo: string) => void) => {
    const handler = (_event: IpcRendererEvent, repo: string): void => listener(repo)
    ipcRenderer.on(IPC_CHANNELS.repositoryChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.repositoryChanged, handler)
    }
  }
}

contextBridge.exposeInMainWorld('seam', seamApi)
