// SPDX-License-Identifier: MIT

import { useTranslation } from 'react-i18next'
import type { GitOperation, HeadCommit } from '../../shared/git'
import { commitAvailability } from './activation'

interface CommitBoxProps {
  readonly value: string
  readonly onChange: (message: string) => void
  readonly amend: boolean
  readonly onAmendChange: (amend: boolean) => void
  /** Whether there is a last commit to amend. */
  readonly canAmend: boolean
  /** The commit being amended, once known; null until Amend is read. */
  readonly head: HeadCommit | null
  /** Files in the index, ready to be committed. */
  readonly staged: number
  /** Files with unresolved conflicts. */
  readonly conflicts: number
  /** The operation Git has stopped halfway, if any. */
  readonly operation: GitOperation | null
  /** Creates a commit from the index and the message. */
  readonly onCommit: () => void
  /** Whether a commit is in flight, so the button cannot be pressed twice. */
  readonly busy: boolean
}

/**
 * The commit message box and its actions. It holds one message per repository
 * and stores it as it is typed, so the draft survives switching files and
 * closing Seam.
 */
export default function CommitBox({
  value,
  onChange,
  amend,
  onAmendChange,
  canAmend,
  head,
  staged,
  conflicts,
  operation,
  onCommit,
  busy
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
            disabled={!canAmend}
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
              disabled={availability.kind !== 'ready' || busy}
              onClick={onCommit}
            >
              {t('commit.button')}
            </button>
          </span>
        )}
      </div>

      {amend && head !== null && (
        <p className="commit__head" data-testid="commit-head">
          <code className="commit__head-id">{head.shortId}</code>
          <span className="commit__head-subject">{head.subject}</span>
          {head.published && (
            <span className="commit__published" data-testid="commit-published">
              {t('commit.amendPublished')}
            </span>
          )}
        </p>
      )}
    </section>
  )
}
