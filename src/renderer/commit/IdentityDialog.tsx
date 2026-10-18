// SPDX-License-Identifier: MIT

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { IdentityScope } from '../../shared/git'

interface IdentityDialogProps {
  /** The name Git already has, or an empty string when it is missing. */
  readonly name: string
  /** The address Git already has, or an empty string when it is missing. */
  readonly email: string
  /** Whether the identity is being stored, so the buttons cannot be pressed twice. */
  readonly busy: boolean
  /** The message of a failed write, shown inside the dialog. */
  readonly error: string | null
  readonly onSave: (identity: { name: string; email: string; scope: IdentityScope }) => void
  readonly onCancel: () => void
}

/**
 * Asks for the name and address Git signs a commit with when the configuration
 * is missing either one, and lets the user choose whether to keep them in this
 * repository alone or everywhere.
 */
export default function IdentityDialog({
  name: initialName,
  email: initialEmail,
  busy,
  error,
  onSave,
  onCancel
}: IdentityDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialName)
  const [email, setEmail] = useState(initialEmail)
  const [scope, setScope] = useState<IdentityScope>('local')
  // Whether Save was pressed with a field still empty, so the hint appears only
  // after the user tried, not while the form is still being filled.
  const [touched, setTouched] = useState(false)

  return (
    <div className="dialog" role="dialog" aria-modal="true" data-testid="identity-dialog">
      <div className="dialog__panel">
        <h2 className="dialog__title">{t('identity.title')}</h2>
        <p className="dialog__explain">{t('identity.explain')}</p>

        <label className="dialog__label" htmlFor="identity-name">
          {t('identity.name')}
        </label>
        <input
          id="identity-name"
          className="dialog__input"
          data-testid="identity-name"
          value={name}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />

        <label className="dialog__label" htmlFor="identity-email">
          {t('identity.email')}
        </label>
        <input
          id="identity-email"
          className="dialog__input"
          data-testid="identity-email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <fieldset className="dialog__scope">
          <legend className="dialog__legend">{t('identity.scope')}</legend>
          <label className="dialog__choice">
            <input
              type="radio"
              name="identity-scope"
              data-testid="identity-scope-local"
              checked={scope === 'local'}
              onChange={() => setScope('local')}
            />
            {t('identity.scopeLocal')}
          </label>
          <label className="dialog__choice">
            <input
              type="radio"
              name="identity-scope"
              data-testid="identity-scope-global"
              checked={scope === 'global'}
              onChange={() => setScope('global')}
            />
            {t('identity.scopeGlobal')}
          </label>
        </fieldset>

        {error !== null && (
          <p className="dialog__error" role="alert" data-testid="identity-error">
            {error}
          </p>
        )}
        {error === null && touched && (name.trim() === '' || email.trim() === '') && (
          <p className="dialog__error" role="alert" data-testid="identity-required">
            {t('identity.required')}
          </p>
        )}

        <div className="dialog__actions">
          <button
            type="button"
            className="dialog__button"
            data-testid="identity-cancel"
            disabled={busy}
            onClick={onCancel}
          >
            {t('identity.cancel')}
          </button>
          <button
            type="button"
            className="button"
            data-testid="identity-save"
            disabled={busy}
            onClick={() => {
              setTouched(true)
              if (name.trim() === '' || email.trim() === '') return
              onSave({ name: name.trim(), email: email.trim(), scope })
            }}
          >
            {t('identity.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
