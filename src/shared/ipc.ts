// SPDX-License-Identifier: MIT

/**
 * Version of the contract between the main process, the preload bridge and the
 * interface. Bump it whenever a message shape changes so the three layers can
 * detect a mismatch instead of failing silently.
 */
export const IPC_CONTRACT_VERSION = 0

/**
 * Surface the preload script exposes to the renderer on `window.seam`. It is
 * intentionally empty during phase 0 and grows as the interface needs typed
 * calls (status, file versions, stage, commit, resolve, continue, abort).
 */
export interface SeamApi {
  readonly contractVersion: typeof IPC_CONTRACT_VERSION
}
