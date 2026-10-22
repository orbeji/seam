// SPDX-License-Identifier: MIT

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface OutputDialogProps {
  /** What Git and its hooks printed, shown whole and unwrapped. */
  readonly output: string
  readonly onClose: () => void
}

/**
 * The full output of a Git command that stopped an operation without leaving a
 * conflict: a failing hook, a missing identity, an unmerged file Git would not
 * touch. It sits over the conflicts dialog, so the resolutions behind it stay
 * exactly as they were and the action can be tried again.
 */
export default function OutputDialog({ output, onClose }: OutputDialogProps) {
  const { t } = useTranslation()

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="dialog dialog--stacked"
      role="dialog"
      aria-modal="true"
      aria-labelledby="git-output-title"
      data-testid="git-output-dialog"
    >
      <div className="dialog__panel output__panel">
        <h2 className="dialog__title" id="git-output-title">
          {t('conflicts.gitOutput')}
        </h2>
        <p className="dialog__explain">{t('conflicts.outputHint')}</p>
        <pre className="output__text" data-testid="git-output">
          {output}
        </pre>
        <div className="dialog__actions">
          <button
            type="button"
            className="dialog__button"
            data-testid="git-output-close"
            onClick={onClose}
          >
            {t('conflicts.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
