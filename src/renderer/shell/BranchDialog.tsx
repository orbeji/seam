// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** The branch names the top bar and this dialog share. */
interface BranchOption {
  readonly name: string
  readonly current?: boolean
  readonly remote?: string
}

interface BranchDialogProps {
  /** The local and remote branches, or null while they are read. */
  readonly branches: {
    readonly local: readonly BranchOption[]
    readonly remote: readonly BranchOption[]
  } | null
  /** Whether the list is being read, so the dialog can say so. */
  readonly loading: boolean
  /** A branch operation running, so its buttons and the fields wait. */
  readonly busy: boolean
  /** The reason the last operation failed, shown inside the dialog. */
  readonly error: string | null
  /** Creates a branch; resolves true when it was created. */
  readonly onCreate: (
    name: string,
    startPoint: string | null,
    checkout: boolean
  ) => Promise<boolean>
  /** Renames a branch; resolves true when it was renamed. */
  readonly onRename: (name: string, newName: string) => Promise<boolean>
  /** Deletes a branch; resolves true when it was deleted. */
  readonly onDelete: (name: string, force: boolean) => Promise<boolean>
  readonly onClose: () => void
}

/**
 * Manages local branches: creates one from HEAD, a branch or a tag, and renames
 * or deletes an existing one. Checkout stays in the top bar's branch menu, so
 * this dialog never changes the working tree unless the create asks for it.
 */
export default function BranchDialog({
  branches,
  loading,
  busy,
  error,
  onCreate,
  onRename,
  onDelete,
  onClose
}: BranchDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [startPoint, setStartPoint] = useState('')
  const [checkout, setCheckout] = useState(true)
  // The branch being renamed or deleted; both open a small form under the list.
  const [renaming, setRenaming] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [force, setForce] = useState(false)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const local = branches?.local ?? []
  const startPoints = [
    ...local.map((branch) => branch.name),
    ...(branches?.remote ?? []).map((branch) => branch.name)
  ]
  const canCreate = name.trim() !== '' && !busy

  const submitCreate = async (): Promise<void> => {
    setTouched(true)
    if (!canCreate) return
    const created = await onCreate(name.trim(), startPoint === '' ? null : startPoint, checkout)
    if (created) {
      setName('')
      setStartPoint('')
      setTouched(false)
    }
  }

  const submitRename = async (branch: string): Promise<void> => {
    if (newName.trim() === '' || busy) return
    const renamed = await onRename(branch, newName.trim())
    if (renamed) {
      setRenaming(null)
      setNewName('')
    }
  }

  const submitDelete = async (branch: string): Promise<void> => {
    if (busy) return
    const deleted = await onDelete(branch, force)
    if (deleted) {
      setDeleting(null)
      setForce(false)
    }
  }

  return (
    <div className="dialog">
      <div
        className="dialog__panel branch__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="branch-title"
        data-testid="branch-dialog"
      >
        <h2 className="dialog__title" id="branch-title">
          {t('branch.title')}
        </h2>
        <p className="dialog__explain">{t('branch.explain')}</p>

        <form
          className="branch__create"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submitCreate()
          }}
        >
          <label className="dialog__label" htmlFor="branch-name">
            {t('branch.name')}
          </label>
          <input
            id="branch-name"
            className="dialog__input"
            data-testid="branch-name"
            value={name}
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={t('branch.namePlaceholder')}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />

          <label className="dialog__label" htmlFor="branch-start">
            {t('branch.startPoint')}
          </label>
          <select
            id="branch-start"
            className="dialog__input"
            data-testid="branch-start"
            value={startPoint}
            disabled={busy}
            onChange={(event) => setStartPoint(event.target.value)}
          >
            <option value="">{t('branch.head')}</option>
            {startPoints.map((point) => (
              <option key={point} value={point}>
                {point}
              </option>
            ))}
          </select>

          <label className="branch__check">
            <input
              type="checkbox"
              checked={checkout}
              disabled={busy}
              onChange={(event) => setCheckout(event.target.checked)}
            />
            {t('branch.checkout')}
          </label>

          {touched && name.trim() === '' && (
            <p className="dialog__error" role="alert">
              {t('branch.nameRequired')}
            </p>
          )}

          <div className="dialog__actions">
            <button
              type="submit"
              className="button"
              data-testid="branch-create"
              disabled={!canCreate}
            >
              {t('branch.create')}
            </button>
          </div>
        </form>

        <div className="branch__list-heading">
          <span>{t('branch.local')}</span>
          <span className="branch__count">{local.length}</span>
        </div>

        {loading ? (
          <p className="dialog__explain">{t('branch.loading')}</p>
        ) : local.length === 0 ? (
          <p className="dialog__explain">{t('branch.none')}</p>
        ) : (
          <ul className="branch__list" data-testid="branch-list">
            {local.map((branch) => (
              <li className="branch__row" key={branch.name}>
                <div className="branch__row-main">
                  <span className="branch__row-name" title={branch.name}>
                    {branch.name}
                  </span>
                  {branch.current && <span className="branch__badge">{t('branch.current')}</span>}
                </div>
                <div className="branch__row-actions">
                  <button
                    type="button"
                    className="dialog__button"
                    disabled={busy}
                    onClick={() => {
                      setDeleting(null)
                      setRenaming(branch.name)
                      setNewName(branch.name)
                    }}
                  >
                    {t('branch.rename')}
                  </button>
                  <button
                    type="button"
                    className="dialog__button"
                    disabled={busy || branch.current}
                    title={branch.current ? t('branch.deleteCurrent') : undefined}
                    onClick={() => {
                      setRenaming(null)
                      setDeleting(branch.name)
                      setForce(false)
                    }}
                  >
                    {t('branch.delete')}
                  </button>
                </div>

                {renaming === branch.name && (
                  <form
                    className="branch__row-form"
                    noValidate
                    onSubmit={(event) => {
                      event.preventDefault()
                      void submitRename(branch.name)
                    }}
                  >
                    <input
                      className="dialog__input"
                      value={newName}
                      aria-label={t('branch.newName')}
                      spellCheck={false}
                      disabled={busy}
                      onChange={(event) => setNewName(event.target.value)}
                    />
                    <button
                      type="submit"
                      className="button"
                      disabled={busy || newName.trim() === ''}
                    >
                      {t('branch.saveRename')}
                    </button>
                    <button
                      type="button"
                      className="dialog__button"
                      disabled={busy}
                      onClick={() => setRenaming(null)}
                    >
                      {t('branch.cancel')}
                    </button>
                  </form>
                )}

                {deleting === branch.name && (
                  <div className="branch__row-form branch__row-form--delete">
                    <p className="dialog__explain">{t('branch.deleteExplain')}</p>
                    <label className="branch__check">
                      <input
                        type="checkbox"
                        checked={force}
                        disabled={busy}
                        onChange={(event) => setForce(event.target.checked)}
                      />
                      {t('branch.force')}
                    </label>
                    <div className="branch__row-actions">
                      <button
                        type="button"
                        className="dialog__button branch__danger"
                        disabled={busy}
                        onClick={() => void submitDelete(branch.name)}
                      >
                        {t('branch.confirmDelete')}
                      </button>
                      <button
                        type="button"
                        className="dialog__button"
                        disabled={busy}
                        onClick={() => setDeleting(null)}
                      >
                        {t('branch.cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {error !== null && (
          <p className="dialog__error" role="alert" data-testid="branch-error">
            {error}
          </p>
        )}

        <div className="dialog__actions">
          <button type="button" className="dialog__button" disabled={busy} onClick={onClose}>
            {t('branch.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
