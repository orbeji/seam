// SPDX-License-Identifier: MIT

import type { ChangeSummary, GitOperation, RepoStatus } from './git'

/**
 * Version of the contract between the main process, the preload bridge and the
 * interface. Bump it whenever a message shape changes so the three layers can
 * detect a mismatch instead of failing silently.
 */
export const IPC_CONTRACT_VERSION = 1

/** Channel names shared by the main process and the preload bridge. */
export const IPC_CHANNELS = {
  chooseRepository: 'repo:choose',
  listRecentRepositories: 'repo:recent:list',
  readRepositoryStatus: 'repo:status',
  initialRepository: 'app:initial-repository'
} as const

/** Why a call failed, so the interface can show a translated message. */
export type IpcErrorCode =
  'git-not-found' | 'git-too-old' | 'not-a-repository' | 'command-failed' | 'unknown'

/** Everything the changes screen needs about one repository, in one message. */
export interface RepositorySnapshot {
  readonly repo: string
  readonly status: RepoStatus
  readonly summary: ChangeSummary
  readonly operation: GitOperation | null
}

/**
 * A call either succeeds with a value or fails with a reason. Errors are data
 * rather than thrown across IPC, because Electron does not preserve an error's
 * class or custom fields.
 */
export type IpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: IpcErrorCode; readonly message: string }

/**
 * Surface the preload script exposes to the renderer on `window.seam`. It grows
 * as the interface needs typed calls: file versions, stage, commit, resolve,
 * continue and abort arrive in later phases.
 */
export interface SeamApi {
  readonly contractVersion: number
  /** Opens the folder picker; resolves with the chosen path, or null if cancelled. */
  chooseRepository(): Promise<string | null>
  /** Recent repository paths, most recent first. */
  listRecentRepositories(): Promise<string[]>
  /** The repository passed on the command line with `--repo`, or null. */
  initialRepository(): Promise<string | null>
  /** Reads a repository's status; never throws, returns an error result instead. */
  readRepositoryStatus(repo: string): Promise<IpcResult<RepositorySnapshot>>
}
