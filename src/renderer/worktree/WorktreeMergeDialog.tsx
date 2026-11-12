// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChangeSummary, MergeStrategy, WorktreeStatus } from '../../shared/git'

interface WorktreeMergeDialogProps {
  /** The worktree whose branch or commit is merged. */
  readonly worktree: WorktreeStatus
  /** The local branches the merge can target. */
  readonly branches: readonly string[]
  /** Whether this worktree is the one open in the current tab. */
  readonly current: boolean
  /** Whether the merge is running, so the form waits. */
  readonly busy: boolean
  /** The reason the last merge failed, shown inside the popup. */
  readonly error: string | null
  /** Starts the merge with the chosen target, strategy and cleanup. */
  readonly onMerge: (
    target: string,
    strategy: MergeStrategy,
    removeAfter: boolean
  ) => Promise<boolean>
  readonly onClose: () => void
}

/** Whether the worktree still holds anything Git refuses to delete. */
function hasChanges(summary: ChangeSummary | null): boolean {
  if (summary === null) return false
  return (
    summary.staged.length +
      summary.unstaged.length +
      summary.untracked.length +
      summary.conflicts.length >
    0
  )
}

/**
 * Asks which branch receives a worktree's changes, how they are integrated and
 * whether the worktree folder can go once the merge finishes. It is a popup of
 * its own so the manager's rows stay a plain list.
 */
export default function WorktreeMergeDialog({
  worktree,
  branches,
  current,
  busy,
  error,
  onMerge,
  onClose
}: WorktreeMergeDialogProps) {
  const { t } = useTranslation()
  const [target, setTarget] = useState('')
  const [strategy, setStrategy] = useState<MergeStrategy>('merge-commit')
  const [removeAfter, setRemoveAfter] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const sourceLabel = worktree.branch ?? t('worktree.detached')
  // A worktree cannot be merged into its own branch, and a detached worktree
  // has no branch of its own to leave out.
  const targets = branches.filter((name) => name !== worktree.branch)

  // Removing the folder loses nothing once the commits are on the branch, but
  // Git refuses while the worktree still has changes or is the one in use.
  const removable = !current && !worktree.main && !hasChanges(worktree.summary)
  const removeHint = current
    ? t('worktree.removeCurrent')
    : worktree.main
      ? t('worktree.removeMain')
      : hasChanges(worktree.summary)
        ? t('worktree.removeDirty')
        : t('worktree.removeAfterHint')

  const submit = async (): Promise<void> => {
    if (target === '' || busy) return
    if (await onMerge(target, strategy, removeAfter && removable)) onClose()
  }

  return (
    <div className="dialog">
      <div
        className="dialog__panel worktree__panel worktree__merge-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="worktree-merge-title"
        data-testid="worktree-merge-dialog"
      >
        <h2 className="dialog__title" id="worktree-merge-title">
          {t('worktree.mergeTitle')}
        </h2>
        <p className="dialog__explain">{t('worktree.mergeExplain', { branch: sourceLabel })}</p>

        <form
          className="worktree__form worktree__form--merge"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <label className="dialog__label" htmlFor="worktree-merge-target">
            {t('worktree.mergeTarget')}
          </label>
          <select
            id="worktree-merge-target"
            className="dialog__input"
            value={target}
            autoFocus
            disabled={busy}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="">{t('worktree.mergeChoose')}</option>
            {targets.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <label className="dialog__label" htmlFor="worktree-merge-strategy">
            {t('merge.strategy')}
          </label>
          <select
            id="worktree-merge-strategy"
            className="dialog__input"
            value={strategy}
            disabled={busy}
            onChange={(event) => setStrategy(event.target.value as MergeStrategy)}
          >
            <option value="merge-commit">{t('merge.mergeCommit')}</option>
            <option value="fast-forward">{t('merge.fastForward')}</option>
            <option value="squash">{t('merge.squash')}</option>
          </select>

          <label className="branch__check worktree__remove-after" title={removeHint}>
            <input
              type="checkbox"
              checked={removeAfter && removable}
              disabled={busy || !removable}
              onChange={(event) => setRemoveAfter(event.target.checked)}
            />
            {t('worktree.removeAfter')}
          </label>
          <p className="dialog__explain">{removeHint}</p>

          {error !== null && (
            <p className="dialog__error" role="alert" data-testid="worktree-merge-error">
              {error}
            </p>
          )}

          <div className="dialog__actions">
            <button type="submit" className="button" disabled={busy || target === ''}>
              {busy ? t('worktree.merging') : t('worktree.mergeConfirm')}
            </button>
            <button type="button" className="dialog__button" disabled={busy} onClick={onClose}>
              {t('worktree.cancel')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
