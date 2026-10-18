// SPDX-License-Identifier: MIT

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/** What the dialog answers: whether to fix the endings, and where to keep it. */
export interface EolAnswer {
  readonly fix: boolean
  /** Where the "do not warn again" goes, or null when the warning stays. */
  readonly disable: 'repo' | 'global' | null
}

interface EolDialogProps {
  /** The staged files whose index copy carries CRLF without attributes. */
  readonly files: readonly string[]
  readonly onAnswer: (answer: EolAnswer) => void
  readonly onCancel: () => void
}

/**
 * Asks what to do about staged files that would commit CRLF into the index:
 * commit them as they are, fix the endings first, or leave the commit alone.
 * The warning can also stop showing, in this repository or in every one, the
 * same way the identity is kept.
 */
export default function EolDialog({ files, onAnswer, onCancel }: EolDialogProps) {
  const { t } = useTranslation()
  const [disable, setDisable] = useState(false)
  const [scope, setScope] = useState<'repo' | 'global'>('repo')

  return (
    <div className="dialog" role="dialog" aria-modal="true" data-testid="eol-dialog">
      <div className="dialog__panel">
        <h2 className="dialog__title">{t('eol.title')}</h2>
        <p className="dialog__explain">{t('eol.explain')}</p>

        <ul className="dialog__files" data-testid="eol-files">
          {files.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>

        <label className="dialog__choice">
          <input
            type="checkbox"
            data-testid="eol-disable"
            checked={disable}
            onChange={(event) => setDisable(event.target.checked)}
          />
          {t('eol.disable')}
        </label>

        {disable && (
          <fieldset className="dialog__scope">
            <legend className="dialog__legend">{t('eol.scope')}</legend>
            <label className="dialog__choice">
              <input
                type="radio"
                name="eol-scope"
                data-testid="eol-scope-repo"
                checked={scope === 'repo'}
                onChange={() => setScope('repo')}
              />
              {t('eol.scopeRepo')}
            </label>
            <label className="dialog__choice">
              <input
                type="radio"
                name="eol-scope"
                data-testid="eol-scope-global"
                checked={scope === 'global'}
                onChange={() => setScope('global')}
              />
              {t('eol.scopeGlobal')}
            </label>
          </fieldset>
        )}

        <div className="dialog__actions">
          <button
            type="button"
            className="dialog__button"
            data-testid="eol-cancel"
            onClick={onCancel}
          >
            {t('eol.cancel')}
          </button>
          <button
            type="button"
            className="dialog__button"
            data-testid="eol-as-is"
            onClick={() => onAnswer({ fix: false, disable: disable ? scope : null })}
          >
            {t('eol.asIs')}
          </button>
          <button
            type="button"
            className="button"
            data-testid="eol-fix"
            onClick={() => onAnswer({ fix: true, disable: disable ? scope : null })}
          >
            {t('eol.fix')}
          </button>
        </div>
      </div>
    </div>
  )
}
