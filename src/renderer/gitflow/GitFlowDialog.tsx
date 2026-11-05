// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  GitFlowConfig,
  GitFlowFinishOutcome,
  GitFlowKind,
  GitFlowState
} from '../../shared/git'

interface GitFlowDialogProps {
  /** What the repository says about GitFlow, or null while it is read. */
  readonly state: GitFlowState | null
  readonly busy: boolean
  readonly error: string | null
  /** What the last finish did when it did not simply land. */
  readonly outcome: GitFlowFinishOutcome | null
  readonly onInit: (config: GitFlowConfig) => void
  readonly onStart: (kind: GitFlowKind, name: string) => void
  readonly onFinish: (tag: string | null) => void
  /** Opens the conflicts list when a finish stopped on one. */
  readonly onResolve: () => void
  readonly onClose: () => void
}

const KINDS: readonly GitFlowKind[] = ['feature', 'release', 'hotfix']

const INIT_FIELDS = [
  ['master', 'master'],
  ['develop', 'develop'],
  ['featurePrefix', 'featurePrefix'],
  ['releasePrefix', 'releasePrefix'],
  ['hotfixPrefix', 'hotfixPrefix'],
  ['versionTagPrefix', 'versionTagPrefix']
] as const

/**
 * The GitFlow popup. It is one dialog with three faces: the init form when the
 * repository has no configuration, the finish form when the current branch is a
 * feature, release or hotfix (or an interrupted finish is waiting), and the
 * start form otherwise.
 */
export default function GitFlowDialog({
  state,
  busy,
  error,
  outcome,
  onInit,
  onStart,
  onFinish,
  onResolve,
  onClose
}: GitFlowDialogProps) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<GitFlowKind>('feature')
  const [name, setName] = useState('')
  // The user's tag, or null to follow the release or hotfix name. Deriving the
  // suggestion instead of storing it keeps the field in step with a state read
  // that arrives after the dialog opened.
  const [editedTag, setEditedTag] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const suggestedTag =
    state === null
      ? ''
      : state.pending !== null && state.pending.tag !== null
        ? state.pending.tag
        : state.currentName !== null
          ? `${state.config.versionTagPrefix}${state.currentName}`
          : ''
  const tag = editedTag ?? suggestedTag

  const blocked = busy || state === null
  const finishKind = state?.pending?.kind ?? state?.currentKind ?? null
  const finishBranch = state?.pending?.branch ?? state?.currentBranch ?? null
  const finishName = state?.pending?.name ?? state?.currentName ?? null
  const needsTag = finishKind === 'release' || finishKind === 'hotfix'
  const pending = state?.pending ?? null
  const ready = state !== null && state.operation === null && !state.dirty

  const init = (form: HTMLFormElement): void => {
    const data = new FormData(form)
    const value = (key: string): string => String(data.get(key) ?? '')
    onInit({
      master: value('master'),
      develop: value('develop'),
      featurePrefix: value('featurePrefix'),
      releasePrefix: value('releasePrefix'),
      hotfixPrefix: value('hotfixPrefix'),
      versionTagPrefix: value('versionTagPrefix')
    })
  }

  return (
    <div className="dialog">
      <div
        className="dialog__panel gitflow__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gitflow-title"
        data-testid="gitflow-dialog"
      >
        <h2 className="dialog__title" id="gitflow-title">
          {t('gitflow.title')}
        </h2>

        {state === null ? (
          <p className="dialog__explain">{t('gitflow.loading')}</p>
        ) : !state.initialized ? (
          <form
            className="gitflow__form"
            data-testid="gitflow-init"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              init(event.currentTarget)
            }}
          >
            <p className="dialog__explain">{t('gitflow.initExplain')}</p>
            <div className="gitflow__grid">
              {INIT_FIELDS.map(([field, label]) => (
                <label className="gitflow__field" key={field}>
                  <span className="dialog__label">{t(`gitflow.fields.${label}`)}</span>
                  <input
                    className="dialog__input"
                    name={field}
                    data-testid={`gitflow-${field}`}
                    defaultValue={state.config[field]}
                    spellCheck={false}
                    disabled={busy}
                  />
                </label>
              ))}
            </div>
            <div className="dialog__actions">
              <button type="button" className="dialog__button" disabled={busy} onClick={onClose}>
                {t('gitflow.close')}
              </button>
              <button
                type="submit"
                className="button"
                data-testid="gitflow-init-submit"
                disabled={busy}
              >
                {t('gitflow.init')}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="gitflow__branches">
              <span className="gitflow__branch">
                <span className="gitflow__branch-label">{t('gitflow.master')}</span>
                {state.config.master}
              </span>
              <span className="gitflow__branch">
                <span className="gitflow__branch-label">{t('gitflow.develop')}</span>
                {state.config.develop}
              </span>
              <span className="gitflow__branch">
                <span className="gitflow__branch-label">{t('gitflow.current')}</span>
                {state.currentBranch ?? t('gitflow.detached')}
              </span>
            </div>

            {state.operation !== null && (
              <p className="dialog__notice">
                {t('gitflow.operation', { operation: state.operation })}
              </p>
            )}
            {state.operation === null && state.dirty && (
              <p className="dialog__notice">{t('gitflow.dirty')}</p>
            )}

            {finishKind !== null && finishBranch !== null && finishName !== null ? (
              <form
                className="gitflow__form"
                data-testid="gitflow-finish"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault()
                  onFinish(needsTag ? tag : null)
                }}
              >
                <h3 className="gitflow__heading">
                  {t(pending === null ? 'gitflow.finishTitle' : 'gitflow.resumeTitle', {
                    branch: finishBranch
                  })}
                </h3>
                <p className="dialog__explain">
                  {t(`gitflow.finishExplain.${finishKind}`, {
                    master: state.config.master,
                    develop: state.config.develop
                  })}
                </p>

                {pending !== null && (
                  <p className="gitflow__pending" data-testid="gitflow-pending">
                    {t('gitflow.resumeExplain', {
                      step: t(`gitflow.step.${pending.step}`)
                    })}
                  </p>
                )}

                {needsTag && pending === null && (
                  <>
                    <label className="dialog__label" htmlFor="gitflow-tag">
                      {t('gitflow.tag')}
                    </label>
                    <input
                      id="gitflow-tag"
                      className="dialog__input"
                      data-testid="gitflow-tag"
                      value={tag}
                      spellCheck={false}
                      disabled={busy}
                      onChange={(event) => setEditedTag(event.target.value)}
                    />
                  </>
                )}
                {pending !== null && pending.tag !== null && (
                  <p className="gitflow__tag">{t('gitflow.tagValue', { tag: pending.tag })}</p>
                )}

                <div className="dialog__actions">
                  <button
                    type="button"
                    className="dialog__button"
                    disabled={busy}
                    onClick={onClose}
                  >
                    {t('gitflow.close')}
                  </button>
                  <button
                    type="submit"
                    className="button"
                    data-testid="gitflow-finish-submit"
                    disabled={
                      blocked || !ready || (needsTag && pending === null && tag.trim() === '')
                    }
                  >
                    {t(pending === null ? 'gitflow.finish' : 'gitflow.resume')}
                  </button>
                </div>
              </form>
            ) : (
              <form
                className="gitflow__form"
                data-testid="gitflow-start"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault()
                  if (name.trim() !== '') onStart(kind, name.trim())
                }}
              >
                <h3 className="gitflow__heading">{t('gitflow.startTitle')}</h3>
                <div className="gitflow__kinds" role="tablist">
                  {KINDS.map((value) => (
                    <button
                      type="button"
                      role="tab"
                      key={value}
                      aria-selected={kind === value}
                      className={
                        kind === value ? 'gitflow__kind gitflow__kind--active' : 'gitflow__kind'
                      }
                      disabled={busy}
                      onClick={() => setKind(value)}
                    >
                      {t(`gitflow.kind.${value}`)}
                    </button>
                  ))}
                </div>

                <label className="dialog__label" htmlFor="gitflow-name">
                  {t('gitflow.name')}
                </label>
                <div className="gitflow__name-row">
                  <span className="gitflow__prefix">
                    {kind === 'feature'
                      ? state.config.featurePrefix
                      : kind === 'release'
                        ? state.config.releasePrefix
                        : state.config.hotfixPrefix}
                  </span>
                  <input
                    id="gitflow-name"
                    className="dialog__input"
                    data-testid="gitflow-name"
                    value={name}
                    autoFocus
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    placeholder={t('gitflow.namePlaceholder')}
                    disabled={busy}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <p className="gitflow__hint">
                  {t('gitflow.startFrom', {
                    branch: kind === 'hotfix' ? state.config.master : state.config.develop
                  })}
                </p>

                <div className="dialog__actions">
                  <button
                    type="button"
                    className="dialog__button"
                    disabled={busy}
                    onClick={onClose}
                  >
                    {t('gitflow.close')}
                  </button>
                  <button
                    type="submit"
                    className="button"
                    data-testid="gitflow-start-submit"
                    disabled={blocked || !ready || name.trim() === ''}
                  >
                    {t('gitflow.start')}
                  </button>
                </div>
              </form>
            )}

            <div className="gitflow__families" data-testid="gitflow-families">
              {KINDS.map((value) => {
                const branches = state.branches[value]
                return (
                  <div className="gitflow__family" key={value}>
                    <span className="gitflow__family-name">{t(`gitflow.kind.${value}`)}</span>
                    {branches.length === 0 ? (
                      <span className="gitflow__empty">{t('gitflow.none')}</span>
                    ) : (
                      <span className="gitflow__chips">
                        {branches.map((branch) => (
                          <span className="gitflow__chip" key={branch} title={branch}>
                            {branch.slice(
                              value === 'feature'
                                ? state.config.featurePrefix.length
                                : value === 'release'
                                  ? state.config.releasePrefix.length
                                  : state.config.hotfixPrefix.length
                            )}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {error !== null && (
          <p className="dialog__error" role="alert" data-testid="gitflow-error">
            {error}
          </p>
        )}

        {outcome !== null && !outcome.finished && outcome.conflicts > 0 && (
          <div className="merge__conflicts">
            <p className="dialog__notice">{t('gitflow.conflicts', { count: outcome.conflicts })}</p>
            <button type="button" className="button" onClick={onResolve}>
              {t('gitflow.resolve')}
            </button>
          </div>
        )}

        {outcome !== null &&
          !outcome.finished &&
          outcome.conflicts === 0 &&
          outcome.output !== '' && (
            <>
              <p className="dialog__label">{t('gitflow.output')}</p>
              <pre className="output__text merge__output">{outcome.output}</pre>
            </>
          )}
      </div>
    </div>
  )
}
