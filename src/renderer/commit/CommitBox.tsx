// SPDX-License-Identifier: MIT

import { useTranslation } from 'react-i18next'
import type { GitOperation } from '../../shared/git'
import { commitAvailability } from './activation'

interface CommitBoxProps {
  readonly value: string
  readonly onChange: (message: string) => void
  readonly amend: boolean
  readonly onAmendChange: (amend: boolean) => void
  /** Files in the index, ready to be committed. */
  readonly staged: number
  /** Files with unresolved conflicts. */
  readonly conflicts: number
  /** The operation Git has stopped halfway, if any. */
  readonly operation: GitOperation | null
}

/**
 * The commit message box and its actions. It holds one message per repository
 * and stores it as it is typed, so the draft survives switching files and
 * closing Seam. The commit itself is a later task, so the button here only
 * shows whether confirming is possible, and why it is not.
 */
export default function CommitBox({
  value,
  onChange,
  amend,
  onAmendChange,
  staged,
  conflicts,
  operation
}: CommitBoxProps) {
  const { t } = useTranslation()
  const availability = commitAvailability({ staged, conflicts, operation, amend })

  return (
    <section className="commit">
      <label className="commit__label" htmlFor="commit-message">
        {t('commit.message.label')}
      </label>
      <textarea
        id="commit-message"
        className="commit__input"
        data-testid="commit-message"
        placeholder={t('commit.message.placeholder')}
        value={value}
        rows={3}
        onChange={(event) => onChange(event.target.value)}
      />

      <div className="commit__actions">
        <label className="commit__amend">
          <input
            type="checkbox"
            data-testid="commit-amend"
            checked={amend}
            onChange={(event) => onAmendChange(event.target.checked)}
          />
          {t('commit.amend')}
        </label>

        {availability.kind === 'replaced' ? (
          <p
            className="commit__reason"
            data-testid="commit-blocked"
            data-operation={availability.operation}
          >
            {t('commit.operation', {
              operation: t(`changes.operation.${availability.operation}`)
            })}
          </p>
        ) : (
          <span className="commit__tools">
            {availability.kind === 'disabled' && (
              <span
                className="commit__reason"
                data-testid="commit-reason"
                data-reason={availability.reason}
              >
                {t(`commit.reason.${availability.reason}`)}
              </span>
            )}
            <button
              type="button"
              className="button"
              data-testid="commit-button"
              disabled={availability.kind !== 'ready'}
            >
              {t('commit.button')}
            </button>
          </span>
        )}
      </div>
    </section>
  )
}
