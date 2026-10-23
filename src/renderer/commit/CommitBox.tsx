// SPDX-License-Identifier: MIT

import { useState } from 'react'
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
  /** Signs as someone else, written `Name <email>`; empty uses the configured author. */
  readonly author: string
  readonly onAuthorChange: (author: string) => void
  /** Whether the commit carries Git's `Signed-off-by` trailer. */
  readonly signoff: boolean
  readonly onSignoffChange: (signoff: boolean) => void
  /** Whether Git's `pre-commit` and `commit-msg` hooks run. */
  readonly runHooks: boolean
  readonly onRunHooksChange: (runHooks: boolean) => void
  /** Files in the index, ready to be committed. */
  readonly staged: number
  /** Files with unresolved conflicts. */
  readonly conflicts: number
  /** The operation Git has stopped halfway, if any. */
  readonly operation: GitOperation | null
  /** Creates a commit from the index and the message. */
  readonly onCommit: () => void
  /** Creates the commit and opens the push dialog once it exists. */
  readonly onCommitAndPush: () => void
  /** Stops a commit a hook is holding up. */
  readonly onCancel: () => void
  /** Whether a commit is in flight, so the button cannot be pressed twice. */
  readonly busy: boolean
  /** What the last commit's hooks printed, shown under the button. */
  readonly output: string | null
  /** The last messages confirmed from this repository, newest first. */
  readonly history: readonly string[]
  /** Puts a previous message back in the box. */
  readonly onPickHistory: (message: string) => void
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
  author,
  onAuthorChange,
  signoff,
  onSignoffChange,
  runHooks,
  onRunHooksChange,
  staged,
  conflicts,
  operation,
  onCommit,
  onCommitAndPush,
  onCancel,
  busy,
  output,
  history,
  onPickHistory
}: CommitBoxProps) {
  const { t } = useTranslation()
  const availability = commitAvailability({ staged, conflicts, operation, amend })
  // The history list opens and closes like a menu; picking a message closes it.
  const [historyOpen, setHistoryOpen] = useState(false)

  return (
    <section className="commit">
      <div className="commit__heading">
        <label className="commit__label" htmlFor="commit-message">
          {t('commit.message.label')}
        </label>
        {history.length > 0 && (
          <button
            type="button"
            className="commit__history-summary"
            data-testid="commit-history"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="6" cy="6" r="4.5" />
              <path d="M6 3.5V6l1.8 1.1" />
            </svg>
            {t('commit.history')}
          </button>
        )}
      </div>

      {historyOpen && (
        <ul className="commit__history-list">
          {history.map((message, index) => (
            <li key={`${index}-${message}`}>
              <button
                type="button"
                className="commit__history-item"
                data-testid="commit-history-item"
                title={message}
                onClick={() => {
                  onPickHistory(message)
                  setHistoryOpen(false)
                }}
              >
                {message.split('\n')[0]}
              </button>
            </li>
          ))}
        </ul>
      )}

      <textarea
        id="commit-message"
        className="commit__input"
        data-testid="commit-message"
        placeholder={t('commit.message.placeholder')}
        value={value}
        rows={4}
        onChange={(event) => onChange(event.target.value)}
      />

      <div className="commit__options">
        <label className="commit__option">
          <input
            type="checkbox"
            data-testid="commit-amend"
            checked={amend}
            disabled={!canAmend}
            onChange={(event) => onAmendChange(event.target.checked)}
          />
          {t('commit.amend')}
        </label>
        <label className="commit__option">
          <input
            type="checkbox"
            data-testid="commit-signoff"
            checked={signoff}
            onChange={(event) => onSignoffChange(event.target.checked)}
          />
          {t('commit.signoff')}
        </label>
        <label className="commit__option">
          <input
            type="checkbox"
            data-testid="commit-hooks"
            checked={runHooks}
            onChange={(event) => onRunHooksChange(event.target.checked)}
          />
          {t('commit.hooks')}
        </label>
      </div>

      <label className="commit__author" htmlFor="commit-author">
        <span className="commit__author-label">{t('commit.author.label')}</span>
        <input
          id="commit-author"
          className="commit__author-input"
          data-testid="commit-author"
          placeholder={t('commit.author.placeholder')}
          value={author}
          onChange={(event) => onAuthorChange(event.target.value)}
        />
      </label>

      <div className="commit__actions">
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
              className="button commit__submit"
              data-testid="commit-button"
              disabled={availability.kind !== 'ready' || busy}
              onClick={onCommit}
            >
              {operation === 'merge'
                ? t('commit.finishMerge')
                : staged > 0
                  ? t('commit.buttonCount', { count: staged })
                  : t('commit.button')}
            </button>
            <button
              type="button"
              className="button commit__submit commit__submit--secondary"
              data-testid="commit-push-button"
              disabled={availability.kind !== 'ready' || busy}
              onClick={onCommitAndPush}
            >
              {t('commit.commitAndPush')}
            </button>
            {busy && (
              <button
                type="button"
                className="commit__cancel"
                data-testid="commit-cancel"
                onClick={onCancel}
              >
                {t('commit.cancel')}
              </button>
            )}
          </span>
        )}
      </div>

      <p className="commit__help">
        {t(operation === 'merge' ? 'commit.helpMerge' : 'commit.help')}
      </p>

      {output !== null && (
        <details className="commit__output" data-testid="commit-output" open>
          <summary className="commit__output-summary">{t('commit.output')}</summary>
          <pre className="commit__output-text">{output}</pre>
        </details>
      )}

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
