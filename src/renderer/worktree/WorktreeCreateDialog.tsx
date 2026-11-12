// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AddWorktreeRequest } from '../../shared/ipc'
import { folderPrefix, withoutTrailingSeparators } from './paths'

interface WorktreeCreateDialogProps {
  /** The local branches a new worktree can check out or start from. */
  readonly branches: readonly string[]
  /** The folder whose tab is showing, which the folder field starts from. */
  readonly currentRepo: string
  /** A worktree operation running, so its buttons and the fields wait. */
  readonly busy: boolean
  /** The reason the last operation failed, shown inside the dialog. */
  readonly error: string | null
  /** Creates the worktree; resolves true when it was created. */
  readonly onCreate: (request: Omit<AddWorktreeRequest, 'repo'>) => Promise<boolean>
  /** Closes the form without creating anything. */
  readonly onCancel: () => void
}

/**
 * The new-worktree form on its own, apart from the manager that lists and
 * operates on the registered worktrees.
 */
export default function WorktreeCreateDialog({
  branches,
  currentRepo,
  busy,
  error,
  onCreate,
  onCancel
}: WorktreeCreateDialogProps) {
  const { t } = useTranslation()
  const [path, setPath] = useState(() => folderPrefix(currentRepo))
  const [branch, setBranch] = useState('')
  const [newBranch, setNewBranch] = useState(true)
  const [startPoint, setStartPoint] = useState('')
  const [detach, setDetach] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy && !browsing) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, browsing, onCancel])

  const currentFolder = withoutTrailingSeparators(currentRepo)
  const isCurrentFolder = currentFolder !== '' && withoutTrailingSeparators(path) === currentFolder
  const canCreate = path.trim() !== '' && !isCurrentFolder && !busy && !browsing

  const browse = async (): Promise<void> => {
    setBrowsing(true)
    try {
      const chosen = await window.seam.chooseDirectory()
      if (chosen !== null) setPath(chosen)
    } catch {
      // The native picker could not open; the field can still be typed into.
    } finally {
      setBrowsing(false)
    }
  }

  const submitCreate = async (): Promise<void> => {
    setTouched(true)
    if (!canCreate) return
    await onCreate({
      path: path.trim(),
      branch: branch.trim(),
      newBranch: newBranch && !detach,
      startPoint: startPoint.trim() === '' ? null : startPoint.trim(),
      detach
    })
  }

  const startFrom = detach || newBranch || branch.trim() === ''

  return (
    <div className="dialog">
      <div
        className="dialog__panel worktree__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="worktree-create-title"
        data-testid="worktree-create-dialog"
      >
        <h2 className="dialog__title" id="worktree-create-title">
          {t('worktree.createTitle')}
        </h2>
        <p className="dialog__explain">{t('worktree.createExplain')}</p>

        <form
          className="worktree__create"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submitCreate()
          }}
        >
          <label className="dialog__label" htmlFor="worktree-path">
            {t('worktree.path')}
          </label>
          <div className="clone__path-row">
            <input
              id="worktree-path"
              className="dialog__input clone__path-input"
              data-testid="worktree-path"
              value={path}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder={t('worktree.pathPlaceholder')}
              disabled={busy || browsing}
              onChange={(event) => setPath(event.target.value)}
            />
            <button
              type="button"
              className="dialog__button"
              data-testid="worktree-browse"
              disabled={busy || browsing}
              onClick={() => void browse()}
            >
              {t('worktree.browse')}
            </button>
          </div>

          <div className="worktree__options">
            <label className="branch__check">
              <input
                type="checkbox"
                checked={detach}
                disabled={busy || browsing}
                onChange={(event) => setDetach(event.target.checked)}
              />
              {t('worktree.detach')}
            </label>
            <label className="branch__check">
              <input
                type="checkbox"
                checked={newBranch && !detach}
                disabled={busy || browsing || detach}
                onChange={(event) => {
                  setNewBranch(event.target.checked)
                  setBranch('')
                }}
              />
              {t('worktree.createBranch')}
            </label>
          </div>

          {!detach && (
            <>
              <label className="dialog__label" htmlFor="worktree-branch">
                {t('worktree.branch')}
              </label>
              {newBranch ? (
                <input
                  id="worktree-branch"
                  className="dialog__input"
                  data-testid="worktree-branch"
                  value={branch}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  placeholder={t('worktree.branchPlaceholder')}
                  disabled={busy || browsing}
                  onChange={(event) => setBranch(event.target.value)}
                />
              ) : (
                <select
                  id="worktree-branch"
                  className="dialog__input"
                  data-testid="worktree-branch"
                  value={branch}
                  disabled={busy || browsing}
                  onChange={(event) => setBranch(event.target.value)}
                >
                  <option value="">{t('worktree.branchFromFolder')}</option>
                  {branches.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}

          {startFrom && (
            <>
              <label className="dialog__label" htmlFor="worktree-start">
                {t('worktree.startPoint')}
              </label>
              <select
                id="worktree-start"
                className="dialog__input"
                data-testid="worktree-start"
                value={startPoint}
                disabled={busy || browsing}
                onChange={(event) => setStartPoint(event.target.value)}
              >
                <option value="">{t('worktree.startPointHead')}</option>
                {branches.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </>
          )}

          {touched && path.trim() === '' && (
            <p className="dialog__error" role="alert">
              {t('worktree.pathRequired')}
            </p>
          )}
          {touched && isCurrentFolder && (
            <p className="dialog__error" role="alert">
              {t('worktree.pathNeedsName')}
            </p>
          )}

          {error !== null && (
            <p className="dialog__error" role="alert" data-testid="worktree-error">
              {error}
            </p>
          )}

          <div className="dialog__actions">
            <button
              type="submit"
              className="button"
              data-testid="worktree-create"
              disabled={!canCreate}
            >
              {t('worktree.create')}
            </button>
            <button
              type="button"
              className="dialog__button"
              disabled={busy || browsing}
              onClick={onCancel}
            >
              {t('worktree.cancel')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
