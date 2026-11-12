// SPDX-License-Identifier: MIT

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  CommitChanges,
  CommitOutcome,
  ConflictAcceptOutcome,
  ConflictState,
  GitFlowFinishOutcome,
  GitFlowState,
  HeadCommit,
  Identity,
  MergeOutcome,
  MergeState,
  OperationOutcome,
  PushOutcome,
  PushState,
  PushUpdateOutcome,
  RepositoryHistory,
  ResolveSimpleOutcome,
  WorktreeList,
  MergeWorktreeOutcome
} from '../shared/git'
import {
  IPC_CHANNELS,
  IPC_CONTRACT_VERSION,
  type AddWorktreeRequest,
  type BranchList,
  type CheckoutBranchRequest,
  type CheckoutCommitRequest,
  type CloneRequest,
  type CommitDraftWriteRequest,
  type CommitFileComparisonRequest,
  type CommitRequest,
  type ConflictAcceptRequest,
  type ConflictRevertRequest,
  type CreateBranchRequest,
  type DeleteBranchRequest,
  type FileComparison,
  type FileComparisonRequest,
  type GitFlowFinishRequest,
  type GitFlowInitRequest,
  type GitFlowStartRequest,
  type GitStatus,
  type HunkWriteRequest,
  type IdentityWriteRequest,
  type IndexWriteRequest,
  type IpcResult,
  type LockWorktreeRequest,
  type MergeApplyRequest,
  type MergeEditorModel,
  type MergeEditorRequest,
  type MergeRequest,
  type MergeWorktreeRequest,
  type MoveWorktreeRequest,
  type PushProgress,
  type PushRequest,
  type PushUpdateRequest,
  type RemoveWorktreeRequest,
  type RenameBranchRequest,
  type RepairWorktreesRequest,
  type RepositorySnapshot,
  type RevertHunksRequest,
  type SeamApi,
  type SettingsData,
  type SettingsPatch,
  type StagePathsRequest,
  type StagingModel,
  type StagingModelRequest
} from '../shared/ipc'

const seamApi: SeamApi = {
  contractVersion: IPC_CONTRACT_VERSION,
  chooseRepository: () =>
    ipcRenderer.invoke(IPC_CHANNELS.chooseRepository) as Promise<string | null>,
  chooseDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.chooseDirectory) as Promise<string | null>,
  cloneRepository: (request: CloneRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.cloneRepository, request) as Promise<IpcResult<string>>,
  listRecentRepositories: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listRecentRepositories) as Promise<string[]>,
  removeRecentRepository: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.removeRecentRepository, repo) as Promise<IpcResult<null>>,
  initialRepository: () =>
    ipcRenderer.invoke(IPC_CHANNELS.initialRepository) as Promise<string | null>,
  readGitStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.readGitStatus) as Promise<IpcResult<GitStatus>>,
  openExternal: (url: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.openExternal, url) as Promise<IpcResult<null>>,
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
  discardFiles: (request: StagePathsRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.discardFiles, request) as Promise<IpcResult<null>>,
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
  readRepositoryHistory: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.readRepositoryHistory, repo) as Promise<
      IpcResult<RepositoryHistory>
    >,
  readCommitChanges: (repo: string, commit: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.readCommitChanges, repo, commit) as Promise<
      IpcResult<CommitChanges>
    >,
  checkoutCommit: (request: CheckoutCommitRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.checkoutCommit, request) as Promise<IpcResult<null>>,
  readCommitFileComparison: (request: CommitFileComparisonRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.readCommitFileComparison, request) as Promise<
      IpcResult<FileComparison>
    >,
  readIdentity: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.readIdentity, repo) as Promise<IpcResult<Identity>>,
  writeIdentity: (request: IdentityWriteRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.writeIdentity, request) as Promise<IpcResult<null>>,
  readSettings: () =>
    ipcRenderer.invoke(IPC_CHANNELS.readSettings) as Promise<IpcResult<SettingsData>>,
  writeSettings: (patch: SettingsPatch) =>
    ipcRenderer.invoke(IPC_CHANNELS.writeSettings, patch) as Promise<IpcResult<null>>,
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
  finishOperation: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.finishOperation, repo) as Promise<IpcResult<OperationOutcome>>,
  skipOperation: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.skipOperation, repo) as Promise<IpcResult<OperationOutcome>>,
  abortOperation: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.abortOperation, repo) as Promise<IpcResult<OperationOutcome>>,
  readMergeMessage: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.readMergeMessage, repo) as Promise<IpcResult<string>>,
  readPushState: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.readPushState, repo) as Promise<IpcResult<PushState>>,
  listBranches: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listBranches, repo) as Promise<IpcResult<BranchList>>,
  listWorktrees: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listWorktrees, repo) as Promise<IpcResult<WorktreeList>>,
  addWorktree: (request: AddWorktreeRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.addWorktree, request) as Promise<IpcResult<null>>,
  removeWorktree: (request: RemoveWorktreeRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.removeWorktree, request) as Promise<IpcResult<null>>,
  moveWorktree: (request: MoveWorktreeRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.moveWorktree, request) as Promise<IpcResult<null>>,
  lockWorktree: (request: LockWorktreeRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.lockWorktree, request) as Promise<IpcResult<null>>,
  unlockWorktree: (request: LockWorktreeRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.unlockWorktree, request) as Promise<IpcResult<null>>,
  pruneWorktrees: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.pruneWorktrees, repo) as Promise<IpcResult<null>>,
  repairWorktrees: (request: RepairWorktreesRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.repairWorktrees, request) as Promise<IpcResult<null>>,
  mergeWorktree: (request: MergeWorktreeRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.mergeWorktree, request) as Promise<
      IpcResult<MergeWorktreeOutcome>
    >,
  checkoutBranch: (request: CheckoutBranchRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.checkoutBranch, request) as Promise<IpcResult<null>>,
  createBranch: (request: CreateBranchRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.createBranch, request) as Promise<IpcResult<null>>,
  renameBranch: (request: RenameBranchRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.renameBranch, request) as Promise<IpcResult<null>>,
  deleteBranch: (request: DeleteBranchRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteBranch, request) as Promise<IpcResult<null>>,
  readMergeState: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.readMergeState, repo) as Promise<IpcResult<MergeState>>,
  mergeBranch: (request: MergeRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.startMerge, request) as Promise<IpcResult<MergeOutcome>>,
  readGitFlow: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.readGitFlow, repo) as Promise<IpcResult<GitFlowState>>,
  initGitFlow: (request: GitFlowInitRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.initGitFlow, request) as Promise<IpcResult<null>>,
  startGitFlow: (request: GitFlowStartRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.startGitFlow, request) as Promise<IpcResult<string>>,
  finishGitFlow: (request: GitFlowFinishRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.finishGitFlow, request) as Promise<
      IpcResult<GitFlowFinishOutcome>
    >,
  fetchRemotes: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.fetchRemotes, repo) as Promise<IpcResult<null>>,
  pull: (request: PushUpdateRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.pullUpstream, request) as Promise<IpcResult<PushUpdateOutcome>>,
  push: (request: PushRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.runPush, request) as Promise<IpcResult<PushOutcome>>,
  cancelPush: (repo: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelPush, repo) as Promise<IpcResult<null>>,
  updateForPush: (request: PushUpdateRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateForPush, request) as Promise<
      IpcResult<PushUpdateOutcome>
    >,
  onPushProgress: (listener: (progress: PushProgress) => void) => {
    const handler = (_event: IpcRendererEvent, progress: PushProgress): void => listener(progress)
    ipcRenderer.on(IPC_CHANNELS.pushProgress, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.pushProgress, handler)
    }
  },
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
