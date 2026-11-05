// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MergeOutcome, MergeState, MergeStrategy } from '../../shared/git'

interface MergeDialogProps {
  /** The branches and readiness of the repository, or null while they are read. */
  readonly state: MergeState | null
  readonly busy: boolean
  readonly error: string | null
  /** What the last merge did when it did not simply land. */
  readonly outcome: MergeOutcome | null
  readonly onMerge: (source: string, strategy: MergeStrategy, message: string) => void
  /** Opens the conflicts list when the merge stopped on one. */
  readonly onResolve: () => void
  readonly onClose: () => void
}

/**
 * Merges a local or remote branch into the checked-out one. The strategy is the
 * user's choice: a real merge commit, a fast-forward only, or a squash that
 * leaves the changes staged for the next commit.
 */
export default function MergeDialog({
  state,
  busy,
  error,
  outcome,
  onMerge,
  onResolve,
  onClose
}: MergeDialogProps) {
  const { t } = useTranslation()
  const [source, setSource] = useState('')
  const [strategy, setStrategy] = useState<MergeStrategy>('merge-commit')
  const [message, setMessage] = useState('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const current = state?.currentBranch ?? null
  const candidates = [
    ...(state?.local ?? []).filter((branch) => branch !== current),
    ...(state?.remote ?? [])
  ]
  const blocked =
    state === null ||
    busy ||
    state.operation !== null ||
    state.dirty ||
    current === null ||
    candidates.length === 0
  const canSubmit = !blocked && source !== ''

  const submit = (): void => {
    setTouched(true)
    if (!canSubmit) return
    onMerge(source, strategy, strategy === 'merge-commit' ? message : '')
  }

  return (
    <div className="dialog">
      <form
        className="dialog__panel merge__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-title"
        data-testid="merge-dialog"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <h2 className="dialog__title" id="merge-title">
          {t('merge.title')}
        </h2>

        {state === null ? (
          <p className="dialog__explain">{t('merge.loading')}</p>
        ) : (
          <>
            <p className="dialog__explain">
              {current === null ? t('merge.detached') : t('merge.into', { branch: current })}
            </p>

            <label className="dialog__label" htmlFor="merge-source">
              {t('merge.source')}
            </label>
            <select
              id="merge-source"
              className="dialog__input"
              data-testid="merge-source"
              value={source}
              autoFocus
              disabled={busy || state.operation !== null}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="">{t('merge.choose')}</option>
              {candidates.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>

            <fieldset className="dialog__scope" disabled={busy || state.operation !== null}>
              <legend className="dialog__legend">{t('merge.strategy')}</legend>
              {(
                [
                  ['merge-commit', 'mergeCommit'],
                  ['fast-forward', 'fastForward'],
                  ['squash', 'squash']
                ] as const
              ).map(([value, key]) => (
                <label className="dialog__choice" key={value}>
                  <input
                    type="radio"
                    name="merge-strategy"
                    value={value}
                    checked={strategy === value}
                    onChange={() => setStrategy(value)}
                  />
                  {t(`merge.${key}`)}
                </label>
              ))}
            </fieldset>

            {strategy === 'merge-commit' && (
              <>
                <label className="dialog__label" htmlFor="merge-message">
                  {t('merge.message')}
                </label>
                <input
                  id="merge-message"
                  className="dialog__input"
                  data-testid="merge-message"
                  value={message}
                  placeholder={t('merge.messagePlaceholder')}
                  disabled={busy || state.operation !== null}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </>
            )}

            {state.operation !== null && (
              <p className="dialog__notice">
                {t('merge.operation', { operation: state.operation })}
              </p>
            )}
            {state.operation === null && state.dirty && (
              <p className="dialog__notice">{t('merge.dirty')}</p>
            )}
            {state.operation === null && !state.dirty && candidates.length === 0 && (
              <p className="dialog__notice">{t('merge.noBranches')}</p>
            )}
            {touched && source === '' && (
              <p className="dialog__error" role="alert">
                {t('merge.required')}
              </p>
            )}
          </>
        )}

        {error !== null && (
          <p className="dialog__error" role="alert" data-testid="merge-error">
            {error}
          </p>
        )}

        {outcome !== null && !outcome.ok && outcome.conflicts > 0 && (
          <div className="merge__conflicts">
            <p className="dialog__notice">{t('merge.conflicts', { count: outcome.conflicts })}</p>
            <button type="button" className="button" onClick={onResolve}>
              {t('merge.resolve')}
            </button>
          </div>
        )}

        {outcome !== null && !outcome.ok && outcome.output !== '' && outcome.conflicts === 0 && (
          <>
            <p className="dialog__label">{t('merge.output')}</p>
            <pre className="output__text merge__output">{outcome.output}</pre>
          </>
        )}

        <div className="dialog__actions">
          <button type="button" className="dialog__button" disabled={busy} onClick={onClose}>
            {t('merge.close')}
          </button>
          <button type="submit" className="button" data-testid="merge-submit" disabled={!canSubmit}>
            {t(busy ? 'merge.merging' : 'merge.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
