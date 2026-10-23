// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PushOutcome, PushState, PushTagMode } from '../../shared/git'

/** What the dialog sends to `git push`, once its choices are made. */
export interface PushChoice {
  readonly remote: string
  readonly branch: string
  readonly remoteBranch: string
  readonly setUpstream: boolean
  readonly tags: PushTagMode
  /** The commit a force push expects the remote branch to still hold. */
  readonly forceLeaseOid: string | null
}

interface PushDialogProps {
  /** The branch, remotes and commits to show, or null while they are read. */
  readonly state: PushState | null
  /** Whether a push or an update is running, so the buttons wait. */
  readonly busy: boolean
  readonly error: string | null
  /** What the last push did, once it did not simply succeed. */
  readonly outcome: PushOutcome | null
  /** Git's live output, shown while the push runs. */
  readonly progress: string
  /** How an update-and-push integrates the fetched upstream. */
  readonly strategy: 'rebase' | 'merge'
  readonly onStrategyChange: (strategy: 'rebase' | 'merge') => void
  readonly onPush: (choice: PushChoice) => void
  /** Fetches, integrates the upstream and pushes again with these choices. */
  readonly onUpdate: (choice: PushChoice) => void
  /** Stops a push the remote is holding up. */
  readonly onCancelPush: () => void
  readonly onClose: () => void
}

/** The catalogue key for a refusal, whose value uses camelCase names. */
const REFUSAL_KEYS: Record<string, string> = {
  'non-fast-forward': 'nonFastForward',
  'remote-rejected': 'remoteRejected',
  'tag-exists': 'tagExists',
  'stale-info': 'staleInfo',
  other: 'other',
  'auth-or-command': 'other'
}

/** The refusal the dialog is explaining, or null when the push was not refused. */
function refusalOf(outcome: PushOutcome | null): string | null {
  if (outcome === null || outcome.ok || outcome.cancelled || outcome.timedOut) return null
  if (outcome.authFailed) return 'auth'
  const refs = outcome.refs
  const rejected = refs.find((ref) => ref.rejection !== null)
  return rejected?.rejection ?? (refs.length === 0 ? 'auth-or-command' : null)
}

/**
 * The push dialog, laid out like the reference client's: the local branch, the remote branch
 * it goes to, the commits that would travel and the options. A rejection is not
 * an error: it stays in the dialog with the two safe answers - update and push,
 * or a force push guarded by `--force-with-lease` and, on main or master, the
 * branch name typed by hand.
 */
export default function PushDialog({
  state,
  busy,
  error,
  outcome,
  progress,
  strategy,
  onStrategyChange,
  onPush,
  onUpdate,
  onCancelPush,
  onClose
}: PushDialogProps) {
  const { t } = useTranslation()
  // A new reading of the repository refills the choices: App remounts the dialog
  // under a new key when the branch, remote or lease changes. The outcome alone
  // does not, so a rejection leaves the dialog exactly as the user left it.
  const [remote, setRemote] = useState(state?.remote ?? '')
  const [remoteBranch, setRemoteBranch] = useState(state?.remoteBranch ?? state?.branch ?? '')
  const [tags, setTags] = useState<PushTagMode>('none')
  const [force, setForce] = useState(false)
  const [confirmation, setConfirmation] = useState('')

  // Escape closes the dialog, unless a push is running: then the way out is the
  // cancel button, which kills Git instead of leaving it printing into nothing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const branch = state?.branch ?? null
  const refusal = refusalOf(outcome)
  // Only a remote that moved offers the two safe ways out. A server refusal or an
  // existing tag is shown with its message and nothing is retried automatically.
  const canRecover = refusal === 'non-fast-forward'
  const canForce = refusal === 'non-fast-forward' && state !== null && state.remoteOid !== null
  const protectedBranch = state?.protectedBranch === true
  const confirmed = !protectedBranch || confirmation === branch
  const nothingToPush = state !== null && state.commits.length === 0
  const canSubmit =
    !busy &&
    state !== null &&
    branch !== null &&
    state.remotes.length > 0 &&
    remote !== '' &&
    remoteBranch !== '' &&
    !nothingToPush

  const choice = (forceLeaseOid: string | null): PushChoice | null => {
    if (state === null || branch === null) return null
    return {
      remote,
      branch,
      remoteBranch,
      setUpstream: state.upstream === null,
      tags,
      forceLeaseOid
    }
  }

  const submit = (forceLeaseOid: string | null): void => {
    const made = choice(forceLeaseOid)
    if (made !== null) onPush(made)
  }

  return (
    <div
      className="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="push-title"
      data-testid="push-dialog"
    >
      <div className="dialog__panel push__panel">
        <h2 className="dialog__title" id="push-title">
          {t('push.title')}
        </h2>

        {state === null ? (
          <p className="dialog__explain">{t('push.loading')}</p>
        ) : (
          <>
            <div className="push__branches" data-testid="push-branches">
              <div className="push__branch">
                <span className="push__branch-label">{t('push.local')}</span>
                <code className="push__branch-name" data-testid="push-local-branch">
                  {branch ?? '—'}
                </code>
                {state.upstream !== null && (
                  <span className="push__tracking">
                    {t('push.tracking', { upstream: state.upstream })}
                  </span>
                )}
              </div>
              <span className="push__arrow" aria-hidden="true">
                →
              </span>
              <div className="push__branch">
                <span className="push__branch-label">{t('push.target')}</span>
                {state.hasUpstream || state.remotes.length === 0 ? (
                  <code className="push__branch-name" data-testid="push-target-branch">
                    {remote === '' ? '—' : `${remote}/${remoteBranch}`}
                  </code>
                ) : (
                  <span className="push__target-fields">
                    <select
                      className="push__select"
                      aria-label={t('push.remote')}
                      data-testid="push-remote"
                      value={remote}
                      disabled={busy}
                      onChange={(event) => setRemote(event.target.value)}
                    >
                      {state.remotes.map((entry) => (
                        <option key={entry.name} value={entry.name}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className="push__input"
                      aria-label={t('push.branchName')}
                      data-testid="push-target-branch"
                      value={remoteBranch}
                      disabled={busy}
                      onChange={(event) => setRemoteBranch(event.target.value)}
                    />
                  </span>
                )}
              </div>
            </div>

            {state.detached ? (
              <p className="dialog__explain" data-testid="push-detached">
                {t('push.detached')}
              </p>
            ) : state.remotes.length === 0 ? (
              <p className="dialog__explain" data-testid="push-no-remotes">
                {t('push.noRemotes')}
              </p>
            ) : (
              <>
                {!state.hasUpstream && (
                  <p className="dialog__explain" data-testid="push-set-upstream">
                    {t('push.setUpstream')}
                  </p>
                )}

                <p className="push__commit-count" data-testid="push-commit-count">
                  {nothingToPush
                    ? t('push.nothing')
                    : t('push.commits', { count: state.commits.length })}
                </p>
                {state.commits.length > 0 && (
                  <ul className="push__commits" data-testid="push-commits">
                    {state.commits.map((commit) => (
                      <li className="push__commit" key={commit.oid} data-testid="push-commit">
                        <code className="push__commit-id">{commit.shortId}</code>
                        <span className="push__commit-subject" title={commit.subject}>
                          {commit.subject}
                        </span>
                        <span className="push__commit-meta">
                          {commit.author} · {commit.date}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <label className="push__option">
                  <span>{t('push.tags')}</span>
                  <select
                    className="push__select"
                    data-testid="push-tags"
                    value={tags}
                    disabled={busy}
                    onChange={(event) => setTags(event.target.value as PushTagMode)}
                  >
                    <option value="none">{t('push.tagsNone')}</option>
                    <option value="follow">{t('push.tagsFollow')}</option>
                    <option value="all">{t('push.tagsAll')}</option>
                  </select>
                </label>
              </>
            )}

            {refusal !== null && (
              <div className="push__rejected" role="alert" data-testid="push-rejected">
                <p className="push__rejected-title">{t('push.rejected.title')}</p>
                <p className="dialog__explain" data-testid="push-rejected-reason">
                  {t(`push.rejected.${REFUSAL_KEYS[refusal] ?? 'other'}`)}
                </p>

                {canRecover && (
                  <div className="push__recovery">
                    <label className="push__option">
                      <span>{t('push.strategy')}</span>
                      <select
                        className="push__select"
                        data-testid="push-strategy"
                        value={strategy}
                        disabled={busy}
                        onChange={(event) =>
                          onStrategyChange(event.target.value === 'rebase' ? 'rebase' : 'merge')
                        }
                      >
                        <option value="rebase" disabled={state.published}>
                          {t('push.rebase')}
                        </option>
                        <option value="merge">{t('push.merge')}</option>
                      </select>
                    </label>
                    {state.published && <p className="push__hint">{t('push.rebasePublished')}</p>}
                  </div>
                )}

                {canForce && (
                  <div className="push__force">
                    <label className="push__option">
                      <input
                        type="checkbox"
                        data-testid="push-force-check"
                        checked={force}
                        disabled={busy}
                        onChange={(event) => {
                          setForce(event.target.checked)
                          setConfirmation('')
                        }}
                      />
                      <span>{t('push.force')}</span>
                    </label>
                    {force && (
                      <>
                        <p className="push__hint">
                          {t('push.forceExplain', {
                            id: state.remoteOid?.slice(0, 7) ?? ''
                          })}
                        </p>
                        {protectedBranch && (
                          <>
                            <p className="push__hint">
                              {t('push.forceConfirm', { branch: branch ?? '' })}
                            </p>
                            <input
                              className="push__input"
                              data-testid="push-force-confirm"
                              value={confirmation}
                              disabled={busy}
                              onChange={(event) => setConfirmation(event.target.value)}
                            />
                            {confirmation !== '' && !confirmed && (
                              <p className="dialog__error">{t('push.forceMismatch')}</p>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {error !== null && (
              <p className="dialog__error" role="alert" data-testid="push-error">
                {error}
              </p>
            )}

            {(busy || progress !== '') && (
              <div className="push__progress" data-testid="push-progress">
                <p className="push__progress-title">{t('push.progress')}</p>
                <pre className="push__progress-text">{progress}</pre>
              </div>
            )}

            {outcome !== null && !outcome.ok && outcome.output !== '' && (
              <details className="push__output" data-testid="push-output" open>
                <summary className="push__output-summary">{t('push.output')}</summary>
                <pre className="push__output-text">{outcome.output}</pre>
              </details>
            )}

            <div className="dialog__actions push__actions">
              {busy && (
                <button
                  type="button"
                  className="dialog__button"
                  data-testid="push-cancel-push"
                  onClick={onCancelPush}
                >
                  {t('push.cancelPush')}
                </button>
              )}
              <button
                type="button"
                className="dialog__button"
                data-testid="push-close"
                disabled={busy}
                onClick={onClose}
              >
                {t('push.close')}
              </button>

              {canRecover ? (
                <>
                  <button
                    type="button"
                    className="dialog__button"
                    data-testid="push-update"
                    disabled={busy}
                    onClick={() => {
                      const made = choice(null)
                      if (made !== null) onUpdate(made)
                    }}
                  >
                    {t('push.updateAndPush')}
                  </button>
                  {canForce && force && (
                    <button
                      type="button"
                      className="dialog__button push__danger"
                      data-testid="push-force"
                      disabled={busy || !confirmed}
                      onClick={() => submit(state.remoteOid)}
                    >
                      {t('push.forceButton')}
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="dialog__button push__primary"
                  data-testid="push-submit"
                  disabled={!canSubmit}
                  onClick={() => submit(null)}
                >
                  {nothingToPush ? t('push.nothing') : t('push.submit')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
