// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBranchOrder } from './branch-order'
import { compareBranchNames } from './branch-tree'

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
  readonly onClose: () => void
}

/**
 * Creates a local branch from HEAD, a branch or a tag. Checkout stays in the
 * top bar's branch menu, and renaming or deleting lives in that menu's
 * right-click menu, so this dialog never changes an existing branch.
 */
export default function BranchDialog({
  branches,
  loading,
  busy,
  error,
  onCreate,
  onClose
}: BranchDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [startPoint, setStartPoint] = useState('')
  const [checkout, setCheckout] = useState(true)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const order = useBranchOrder()
  const local = [...(branches?.local ?? [])].sort((a, b) =>
    compareBranchNames(a.name, b.name, order)
  )
  const remote = [...(branches?.remote ?? [])].sort((a, b) =>
    compareBranchNames(a.name, b.name, order)
  )
  const startPoints = [
    ...local.map((branch) => branch.name),
    ...remote.map((branch) => branch.name)
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
