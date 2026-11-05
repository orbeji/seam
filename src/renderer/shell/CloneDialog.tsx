// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeRepositoryUrl } from '../../shared/git-url'
import type { CloneRequest } from '../../shared/ipc'
import { cloneTarget, repositoryNameFromUrl } from './clone-path'

interface CloneDialogProps {
  /** Whether Git is cloning, so the fields and buttons wait. */
  readonly busy: boolean
  /** The reason the last clone failed, shown inside the dialog. */
  readonly error: string | null
  readonly onClone: (request: CloneRequest) => void
  readonly onCancel: () => void
}

/**
 * Asks for a repository URL and a parent folder. Git creates a folder named
 * after the URL inside it, so the dialog previews the exact path before the
 * clone starts and never adds a mistyped parent chain.
 */
export default function CloneDialog({ busy, error, onClone, onCancel }: CloneDialogProps) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const [touched, setTouched] = useState(false)

  const repositoryName = repositoryNameFromUrl(url)
  const repositoryUrl = normalizeRepositoryUrl(url)
  const target = cloneTarget(parent, repositoryName)
  const required = url.trim() === '' || target === ''

  // Escape closes like the other dialogs, but never while Git is cloning or the
  // native folder picker is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy && !browsing) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, browsing, onCancel])

  const browse = async (): Promise<void> => {
    setBrowsing(true)
    try {
      const chosen = await window.seam.chooseDirectory()
      if (chosen !== null) setParent(chosen)
    } catch {
      // The native picker could not open; the field can still be typed into.
    } finally {
      setBrowsing(false)
    }
  }

  const submit = (): void => {
    setTouched(true)
    if (busy || browsing || required) return
    onClone({ url: repositoryUrl, path: target })
  }

  return (
    <div className="dialog">
      <form
        className="dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clone-title"
        data-testid="clone-dialog"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <h2 className="dialog__title" id="clone-title">
          {t('clone.title')}
        </h2>
        <p className="dialog__explain">{t('clone.explain')}</p>

        <label className="dialog__label" htmlFor="clone-url">
          {t('clone.url')}
        </label>
        <input
          id="clone-url"
          className="dialog__input"
          data-testid="clone-url"
          value={url}
          autoFocus
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={t('clone.urlPlaceholder')}
          disabled={busy || browsing}
          onChange={(event) => setUrl(event.target.value)}
        />

        <label className="dialog__label" htmlFor="clone-parent">
          {t('clone.destination')}
        </label>
        <div className="clone__path-row">
          <input
            id="clone-parent"
            className="dialog__input clone__path-input"
            data-testid="clone-parent"
            value={parent}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={t('clone.destinationPlaceholder')}
            disabled={busy || browsing}
            onChange={(event) => setParent(event.target.value)}
          />
          <button
            type="button"
            className="dialog__button"
            data-testid="clone-browse"
            disabled={busy || browsing}
            onClick={() => void browse()}
          >
            {t('clone.browse')}
          </button>
        </div>

        <p className="clone__target" data-testid="clone-target">
          {target === '' ? t('clone.targetUnknown') : t('clone.target', { path: target })}
        </p>

        {error !== null && (
          <p className="dialog__error" role="alert" data-testid="clone-error">
            {error}
          </p>
        )}
        {error === null && touched && required && (
          <p className="dialog__error" role="alert" data-testid="clone-required">
            {t('clone.required')}
          </p>
        )}

        <div className="dialog__actions">
          <button
            type="button"
            className="dialog__button"
            data-testid="clone-cancel"
            disabled={busy || browsing}
            onClick={onCancel}
          >
            {t('clone.cancel')}
          </button>
          <button
            type="submit"
            className="button"
            data-testid="clone-submit"
            disabled={busy || browsing}
          >
            {t(busy ? 'clone.cloning' : 'clone.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
