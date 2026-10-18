// SPDX-License-Identifier: MIT

import type { GitOperation } from '../../shared/git'

/** What the commit box knows about the repository it belongs to. */
export interface CommitContext {
  /** Files in the index, ready to be committed. */
  readonly staged: number
  /** Files with unresolved conflicts. */
  readonly conflicts: number
  /** The operation Git has stopped halfway, if any. */
  readonly operation: GitOperation | null
  /** Whether Amend is checked. */
  readonly amend: boolean
}

/** Whether the commit button can be used, and when it cannot, why. */
export type CommitAvailability =
  | { readonly kind: 'ready' }
  | { readonly kind: 'disabled'; readonly reason: 'nothing-staged' | 'conflicts' }
  | { readonly kind: 'replaced'; readonly operation: GitOperation }

/**
 * Decides whether the commit button is usable.
 *
 * An operation that stopped halfway replaces the button, because finishing it -
 * continuing or aborting - is a step of its own. Unresolved conflicts block the
 * commit with a reason. Amend alone is enough: the last commit can be rewritten
 * without staging anything.
 */
export function commitAvailability(context: CommitContext): CommitAvailability {
  if (context.operation !== null) return { kind: 'replaced', operation: context.operation }
  if (context.conflicts > 0) return { kind: 'disabled', reason: 'conflicts' }
  if (context.staged > 0 || context.amend) return { kind: 'ready' }
  return { kind: 'disabled', reason: 'nothing-staged' }
}
