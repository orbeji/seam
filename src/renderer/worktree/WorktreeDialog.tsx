// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChangeSummary, MergeStrategy, WorktreeStatus } from '../../shared/git'
import { entryView } from '../changes/entry-view'
import { sameFolder } from './paths'
import WorktreeMergeDialog from './WorktreeMergeDialog'

interface WorktreeDialogProps {
  /** The worktrees Git reported, or null while they are read. */
  readonly worktrees: readonly WorktreeStatus[] | null
  /** The local branches a merge can target. */
  readonly branches: readonly string[]
  /** The folder the dialog was opened from, marked as the current one. */
  readonly currentRepo: string
  /** Whether the list is being read, so the dialog can say so. */
  readonly loading: boolean
  /** A worktree operation running, so its buttons and the fields wait. */
  readonly busy: boolean
  /** The reason the last operation failed, shown inside the dialog. */
  readonly error: string | null
  /** Opens the separate form that creates a worktree. */
  readonly onCreateWorktree: () => void
  /** Merges one worktree's changes into a local branch, removing it afterwards. */
  readonly onMergeWorktree: (
    path: string,
    target: string,
    strategy: MergeStrategy,
    removeAfter: boolean
  ) => Promise<boolean>
  readonly onRemove: (path: string, force: boolean) => Promise<boolean>
  readonly onPrune: () => Promise<boolean>
  /** Opens the worktree as a repository tab, where every Git action works. */
  readonly onOpen: (path: string) => void
  readonly onClose: () => void
}

/** The action whose small form is open under a worktree row. */
type RowForm = { readonly kind: 'remove'; readonly path: string } | null

/** How many files of one worktree the card lists before folding the rest. */
const FILE_LIMIT = 12

/** The four lists of a summary, with each file listed once. */
function changedFiles(summary: ChangeSummary): string[] {
  const seen = new Set<string>()
  const paths: string[] = []
  for (const entry of [
    ...summary.staged,
    ...summary.unstaged,
    ...summary.untracked,
    ...summary.conflicts
  ]) {
    if (seen.has(entry.path)) continue
    seen.add(entry.path)
    paths.push(entry.path)
  }
  return paths
}

/** The one-letter badge of a path, read from whichever list holds it. */
function badgeFor(summary: ChangeSummary, path: string): string {
  const entry = [
    ...summary.conflicts,
    ...summary.untracked,
    ...summary.unstaged,
    ...summary.staged
  ].find((candidate) => candidate.path === path)
  return entry === undefined ? '?' : entryView(entry).badge
}

function ChangeCard({
  worktree,
  current,
  branches,
  busy,
  rowForm,
  onRowForm,
  onMerge,
  onRemove,
  onOpen
}: {
  readonly worktree: WorktreeStatus
  readonly current: boolean
  readonly branches: readonly string[]
  readonly busy: boolean
  readonly rowForm: RowForm
  readonly onRowForm: (form: RowForm) => void
  readonly onMerge: () => void
  readonly onRemove: (path: string, force: boolean) => Promise<boolean>
  readonly onOpen: (path: string) => void
}) {
  const { t } = useTranslation()
  const [force, setForce] = useState(false)

  const summary = worktree.summary
  const files = summary === null ? [] : changedFiles(summary)
  const shown = files.slice(0, FILE_LIMIT)
  const hidden = files.length - shown.length
  const form = rowForm?.path === worktree.path ? rowForm : null
  const shortHead = worktree.head === null ? null : worktree.head.slice(0, 7)
  // A worktree cannot be merged into its own branch, and a detached worktree
  // has no branch of its own to leave out.
  const targets = branches.filter((name) => name !== worktree.branch)

  const submitRemove = async (): Promise<void> => {
    if (await onRemove(worktree.path, force)) onRowForm(null)
  }

  return (
    <li className="worktree__card" data-testid="worktree-row">
      <div className="worktree__head">
        <div className="worktree__identity">
          <span className="worktree__branch" title={worktree.branch ?? worktree.path}>
            {worktree.branch ?? t('worktree.detached')}
          </span>
          {worktree.main && <span className="worktree__badge">{t('worktree.main')}</span>}
          {worktree.locked !== null && (
            <span className="worktree__badge worktree__badge--locked">{t('worktree.locked')}</span>
          )}
          {worktree.prunable !== null && (
            <span className="worktree__badge worktree__badge--warn">{t('worktree.prunable')}</span>
          )}
          {current && <span className="worktree__badge">{t('worktree.current')}</span>}
        </div>
        <span className="worktree__head-id" title={worktree.head ?? undefined}>
          {shortHead ?? t('worktree.noCommits')}
        </span>
      </div>

      <p className="worktree__path" title={worktree.path}>
        {worktree.path}
      </p>

      {worktree.locked !== null && worktree.locked !== '' && (
        <p className="worktree__note">{t('worktree.lockReason', { reason: worktree.locked })}</p>
      )}
      {worktree.prunable !== null && (
        <p className="worktree__note">
          {worktree.prunable === '' ? t('worktree.prunableHint') : worktree.prunable}
        </p>
      )}
      {current && !worktree.main && (
        <p className="worktree__note worktree__note--warn">{t('worktree.removeCurrent')}</p>
      )}
      {worktree.error !== null && worktree.prunable === null && (
        <p className="worktree__note worktree__note--error">{worktree.error}</p>
      )}

      {summary !== null && (
        <>
          <div className="worktree__counts">
            <span>{t('worktree.counts.staged', { count: summary.staged.length })}</span>
            <span>{t('worktree.counts.unstaged', { count: summary.unstaged.length })}</span>
            <span>{t('worktree.counts.untracked', { count: summary.untracked.length })}</span>
            {summary.conflicts.length > 0 && (
              <span className="worktree__conflict">
                {t('worktree.counts.conflicts', { count: summary.conflicts.length })}
              </span>
            )}
            {worktree.operation !== null && (
              <span className="worktree__conflict">
                {t(`changes.operation.${worktree.operation}`)}
              </span>
            )}
          </div>

          {files.length === 0 ? (
            <p className="worktree__clean">{t('worktree.clean')}</p>
          ) : (
            <ul className="worktree__files">
              {shown.map((path) => (
                <li key={path} title={path}>
                  <span className="worktree__file-badge">{badgeFor(summary, path)}</span>
                  <span className="worktree__file-path">{path}</span>
                </li>
              ))}
              {hidden > 0 && (
                <li className="worktree__more">{t('worktree.moreFiles', { count: hidden })}</li>
              )}
            </ul>
          )}
        </>
      )}

      <div className="worktree__actions">
        <button
          type="button"
          className="button"
          data-testid="worktree-open"
          disabled={busy || current}
          title={current ? t('worktree.alreadyOpen') : t('worktree.openHint')}
          onClick={() => onOpen(worktree.path)}
        >
          {current ? t('worktree.opened') : t('worktree.open')}
        </button>
        <button
          type="button"
          className="dialog__button"
          data-testid="worktree-merge"
          disabled={busy || worktree.head === null || targets.length === 0}
          title={targets.length === 0 ? t('merge.noBranches') : t('worktree.mergeHint')}
          onClick={onMerge}
        >
          {t('worktree.merge')}
        </button>
        <button
          type="button"
          className="dialog__button worktree__danger"
          data-testid="worktree-remove"
          disabled={busy || worktree.main || current}
          title={
            worktree.main
              ? t('worktree.removeMain')
              : current
                ? t('worktree.removeCurrent')
                : undefined
          }
          onClick={() => {
            setForce(false)
            onRowForm(form?.kind === 'remove' ? null : { kind: 'remove', path: worktree.path })
          }}
        >
          {t('worktree.remove')}
        </button>
      </div>

      {form?.kind === 'remove' && (
        <div className="worktree__form worktree__form--remove">
          <p className="dialog__explain">{t('worktree.removeExplain')}</p>
          <label className="branch__check">
            <input
              type="checkbox"
              checked={force}
              disabled={busy}
              onChange={(event) => setForce(event.target.checked)}
            />
            {t('worktree.removeForce')}
          </label>
          <div className="worktree__form-actions">
            <button
              type="button"
              className="dialog__button worktree__danger"
              disabled={busy}
              onClick={() => void submitRemove()}
            >
              {t('worktree.removeConfirm')}
            </button>
            <button
              type="button"
              className="dialog__button"
              disabled={busy}
              onClick={() => onRowForm(null)}
            >
              {t('worktree.cancel')}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * Lists the worktrees Git registered for a repository and the changes each one
 * has pending. A worktree opens as a repository tab, where the full staging,
 * commit and push flow of the main window applies to it, and can be merged into
 * another branch or removed from here. Creation lives in its own form.
 */
export default function WorktreeDialog({
  worktrees,
  branches,
  currentRepo,
  loading,
  busy,
  error,
  onCreateWorktree,
  onMergeWorktree,
  onRemove,
  onPrune,
  onOpen,
  onClose
}: WorktreeDialogProps) {
  const { t } = useTranslation()
  const [rowForm, setRowForm] = useState<RowForm>(null)
  const [mergeTarget, setMergeTarget] = useState<WorktreeStatus | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // The merge popup has its own listener and closes itself first.
      if (event.key === 'Escape' && !busy && mergeTarget === null) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, mergeTarget, onClose])

  return (
    <>
      <div className="dialog">
        <div
          className="dialog__panel worktree__panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="worktree-title"
          data-testid="worktree-dialog"
        >
          <h2 className="dialog__title" id="worktree-title">
            {t('worktree.title')}
          </h2>
          <p className="dialog__explain">{t('worktree.explain')}</p>

          <div className="dialog__actions worktree__new">
            <button
              type="button"
              className="button"
              data-testid="worktree-new"
              disabled={busy}
              onClick={onCreateWorktree}
            >
              {t('worktree.new')}
            </button>
          </div>

          <div className="worktree__list-heading">
            <span>{t('worktree.list')}</span>
            <span className="branch__count">{worktrees?.length ?? 0}</span>
          </div>

          {loading ? (
            <p className="dialog__explain">{t('worktree.loading')}</p>
          ) : worktrees === null || worktrees.length === 0 ? (
            <p className="dialog__explain">{t('worktree.none')}</p>
          ) : (
            <ul className="worktree__list" data-testid="worktree-list">
              {worktrees.map((worktree) => (
                <ChangeCard
                  key={worktree.path}
                  worktree={worktree}
                  current={sameFolder(worktree.path, currentRepo)}
                  branches={branches}
                  busy={busy}
                  rowForm={rowForm}
                  onRowForm={setRowForm}
                  onMerge={() => setMergeTarget(worktree)}
                  onRemove={onRemove}
                  onOpen={onOpen}
                />
              ))}
            </ul>
          )}

          <div className="worktree__maintenance">
            <button
              type="button"
              className="dialog__button"
              data-testid="worktree-prune"
              disabled={busy}
              title={t('worktree.pruneHint')}
              onClick={() => void onPrune()}
            >
              {t('worktree.prune')}
            </button>
          </div>

          {error !== null && mergeTarget === null && (
            <p className="dialog__error" role="alert" data-testid="worktree-error">
              {error}
            </p>
          )}

          <div className="dialog__actions">
            <button type="button" className="dialog__button" disabled={busy} onClick={onClose}>
              {t('worktree.close')}
            </button>
          </div>
        </div>
      </div>

      {mergeTarget !== null && (
        <WorktreeMergeDialog
          worktree={mergeTarget}
          branches={branches}
          current={sameFolder(mergeTarget.path, currentRepo)}
          busy={busy}
          error={error}
          onMerge={(target, strategy, removeAfter) =>
            onMergeWorktree(mergeTarget.path, target, strategy, removeAfter)
          }
          onClose={() => setMergeTarget(null)}
        />
      )}
    </>
  )
}
