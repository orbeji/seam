// SPDX-License-Identifier: MIT

import type { IpcErrorCode } from '../shared/ipc'

/**
 * The translation key of each failure the main process can report. The changes
 * screen and the viewer both show a failure as a heading from here plus Git's
 * own detail, so the mapping lives in one place.
 */
export const ERROR_KEYS: Record<IpcErrorCode, string> = {
  'git-not-found': 'errors.gitNotFound',
  'git-too-old': 'errors.gitTooOld',
  'not-a-repository': 'errors.notARepository',
  'command-failed': 'errors.commandFailed',
  unknown: 'errors.unknown'
}
