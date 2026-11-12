// SPDX-License-Identifier: MIT

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  CommitChanges,
  CommitFileChange,
  CommitFileStatus,
  GitOperation,
  HistoryCommit,
  HistoryRef,
  RepositoryHistory
} from '../../shared/git'
import { splitPath } from '../paths'
import { checkoutTarget, type CheckoutTarget } from './checkout'
import { layoutGraph, type GraphEdge, type GraphRow } from './graph'

/** What the history panel is doing: reading, showing, or explaining a failure. */
export type HistoryView =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly data: RepositoryHistory }
  | { readonly state: 'error'; readonly message: string }

/** What the history panel moved to, for the window's notification. */
export interface HistoryCheckout {
  readonly shortId: string
  /** The local branch checked out, or null when HEAD was left detached. */
  readonly branch: string | null
}

interface HistoryPanelProps {
  readonly repo: string
  readonly view: HistoryView
  /** The commit whose files are open, highlighted in the graph. */
  readonly selectedOid: string | null
  /** Selects a commit, or clears the selection when null. */
  readonly onSelect: (commit: HistoryCommit | null) => void
  /** Tells the window a commit or branch was checked out, so it refreshes. */
  readonly onCheckedOut: (result: HistoryCheckout) => void
  /** Whether the panel fills the window instead of sitting beside the sidebar. */
  readonly expanded: boolean
  /** Switches between the full-width graph and the sidebar split. */
  readonly onToggleExpanded: () => void
}

/** What the checkout confirmation needs to know about the picked commit. */
interface CheckoutPrompt {
  readonly commit: HistoryCommit
  /** The branch or detached commit the double click would move to. */
  readonly target: Exclude<CheckoutTarget, { readonly kind: 'current' }>
  /** The branch HEAD is on when the prompt opened, or null when detached. */
  readonly branch: string | null
  /** The operation Git has in progress, which blocks the checkout. */
  readonly operation: GitOperation | null
  /** Whether the working tree has staged, unstaged or untracked changes. */
  readonly dirty: boolean
}

const LANE_WIDTH = 14
const GUTTER_PADDING = 8
const ROW_HEIGHT = 54

const GRAPH_COLORS = [
  'var(--graph-0)',
  'var(--graph-1)',
  'var(--graph-2)',
  'var(--graph-3)',
  'var(--graph-4)',
  'var(--graph-5)',
  'var(--graph-6)',
  'var(--graph-7)'
] as const

/** The letter a terminal shows for each kind of change. */
const STATUS_LETTER: Record<CommitFileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  'type-changed': 'T',
  unmerged: 'U',
  unknown: '?'
}

function colorOf(index: number): string {
  return GRAPH_COLORS[index % GRAPH_COLORS.length] ?? 'var(--accent)'
}

function laneX(lane: number): number {
  return GUTTER_PADDING + lane * LANE_WIDTH
}

/** The path of one edge, curved when it moves sideways between rows. */
function edgePath(edge: GraphEdge, height: number, center: number): string {
  const x1 = laneX(edge.from)
  const x2 = laneX(edge.to)
  if (x1 === x2) {
    const y1 = edge.side === 'bottom' ? center : 0
    const y2 = edge.side === 'top' ? center : height
    return `M ${x1} ${y1} L ${x2} ${y2}`
  }

  if (edge.side === 'through') {
    return `M ${x1} 0 C ${x1} ${height / 3} ${x2} ${(height * 2) / 3} ${x2} ${height}`
  }
  if (edge.side === 'top') {
    return `M ${x1} 0 C ${x1} ${center - 12} ${x2} ${center - 4} ${x2} ${center}`
  }
  return `M ${x1} ${center} C ${x1} ${center + 4} ${x2} ${center + 12} ${x2} ${height}`
}

/**
 * Draws one commit's lines and node. The row grows when its refs wrap, so the
 * cell measures its own height and draws the edges all the way to both borders;
 * a fixed 54px drawing would stop the line at the middle of a taller row.
 */
function GraphCell({ row, lanes }: { readonly row: GraphRow; readonly lanes: number }) {
  const width = Math.max(1, lanes) * LANE_WIDTH + GUTTER_PADDING * 2
  const color = colorOf(row.color)
  const cell = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(ROW_HEIGHT)

  useLayoutEffect(() => {
    const element = cell.current
    if (element === null) return
    const measure = (): void => {
      const next = element.getBoundingClientRect().height
      if (next > 0) setHeight((current) => (Math.abs(current - next) < 0.5 ? current : next))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const center = height / 2

  return (
    <div ref={cell} className="history__graph" style={{ width }} aria-hidden="true">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {row.edges.map((edge, index) => (
          <path
            key={`${edge.side}-${edge.from}-${edge.to}-${index}`}
            d={edgePath(edge, height, center)}
            fill="none"
            stroke={colorOf(edge.color)}
            strokeWidth={2}
            strokeLinecap="round"
          />
        ))}
        <circle
          cx={laneX(row.lane)}
          cy={center}
          r={5.5}
          fill="var(--surface)"
          stroke={color}
          strokeWidth={2}
        />
        <circle cx={laneX(row.lane)} cy={center} r={2.2} fill={color} />
      </svg>
    </div>
  )
}

/** A short date and time in the interface language, from Git's ISO date. */
function formatDate(iso: string, language: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  try {
    return new Intl.DateTimeFormat(language, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date)
  } catch {
    return iso
  }
}

/** The tag or branch pill attached to a commit, with its full name on hover. */
function HistoryRefChip({ reference }: { readonly reference: HistoryRef }) {
  const { t } = useTranslation()
  const synced = reference.remotes !== undefined && reference.remotes.length > 0
  const syncedNames = reference.remotes?.join(', ') ?? ''
  const title =
    reference.kind === 'tag'
      ? t('history.tagTitle', { name: reference.name })
      : reference.kind === 'remote'
        ? t('history.remoteTitle', { name: reference.name })
        : synced
          ? t(reference.kind === 'head' ? 'history.syncedHeadTitle' : 'history.syncedBranchTitle', {
              name: reference.name,
              remote: syncedNames
            })
          : reference.kind === 'head'
            ? t('history.headTitle', { name: reference.name })
            : t('history.branchTitle', { name: reference.name })

  return (
    <span className={`history__ref history__ref--${reference.kind}`} title={title}>
      {reference.kind === 'tag' && (
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M1.5 1.5h4l3 3-4 4-3-3z" />
          <circle cx="3.2" cy="3.2" r="0.7" fill="currentColor" stroke="none" />
        </svg>
      )}
      {synced && (
        <svg
          className="history__ref-sync"
          width="9"
          height="9"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8.4 4.1A3.5 3.5 0 0 0 2.2 2.4" />
          <path d="M1.6 5.9a3.5 3.5 0 0 0 6.2 1.7" />
          <path d="M8.5 1.8v2.2H6.3M1.5 8.2V6h2.2" />
        </svg>
      )}
      {reference.name}
    </span>
  )
}

/** One file the selected commit changed, as a button that opens its diff. */
export function CommitFileRow({
  file,
  active,
  onSelect
}: {
  readonly file: CommitFileChange
  readonly active: boolean
  readonly onSelect: () => void
}) {
  const { t } = useTranslation()
  const { name, dir } = splitPath(file.path)
  const status = t(`history.status.${file.status}`)
  return (
    <button
      type="button"
      className={active ? 'history__file history__file--active' : 'history__file'}
      data-testid="history-file"
      aria-label={`${status}: ${file.path}`}
      title={
        file.previousPath === null
          ? file.path
          : t('history.renamedFrom', { path: file.previousPath })
      }
      onClick={onSelect}
    >
      <span
        className={`history__status history__status--${file.status}`}
        title={status}
        aria-label={status}
      >
        {STATUS_LETTER[file.status]}
      </span>
      <span className="history__file-text">
        <span className="history__file-name">{name}</span>
        {dir !== '' && <span className="history__file-dir">{dir}</span>}
        {file.previousPath !== null && (
          <span className="history__file-note">
            {t('history.renamedFrom', { path: file.previousPath })}
          </span>
        )}
      </span>
    </button>
  )
}

/**
 * The changed files of the selected commit, shown in the file sidebar while a
 * commit is open. The diff itself lives in the work area, next to the panel.
 */
export function CommitFilesPanel({
  commit,
  changes,
  selectedPath,
  onSelect
}: {
  readonly commit: HistoryCommit
  readonly changes: {
    readonly data: CommitChanges | null
    readonly error: string | null
  } | null
  readonly selectedPath: string | null
  readonly onSelect: (path: string) => void
}) {
  const { t, i18n } = useTranslation()
  const files = changes?.data?.files ?? []

  return (
    <div className="commit-files">
      <div className="commit-files__commit">
        <div className="commit-files__id-row">
          <code className="history__id">{commit.shortId}</code>
          <time className="history__date" dateTime={commit.authorDate}>
            {formatDate(commit.authorDate, i18n.language)}
          </time>
        </div>
        <p className="commit-files__subject" title={commit.subject}>
          {commit.subject === '' ? t('history.noSubject') : commit.subject}
        </p>
        <div className="commit-files__meta">
          <span className="history__author" title={commit.authorEmail}>
            {commit.authorName}
          </span>
          {commit.refs.length > 0 && (
            <span className="history__refs commit-files__refs">
              {commit.refs.map((reference) => (
                <HistoryRefChip key={`${reference.kind}:${reference.name}`} reference={reference} />
              ))}
            </span>
          )}
        </div>
      </div>

      {changes === null ? (
        <p className="commit-files__note">{t('history.filesLoading')}</p>
      ) : changes.error !== null ? (
        <p className="commit-files__note commit-files__note--error" role="alert">
          {changes.error}
        </p>
      ) : files.length === 0 ? (
        <p className="commit-files__note">{t('history.filesEmpty')}</p>
      ) : (
        <div className="commit-files__list">
          {files.map((file) => (
            <CommitFileRow
              key={file.path}
              file={file}
              active={file.path === selectedPath}
              onSelect={() => onSelect(file.path)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The persistent commit graph. It stays beside the file sidebar, so the history
 * is browsable while the working tree is being committed. A single click opens
 * a commit's files; a double click offers to check it out.
 */
export function HistoryPanel({
  repo,
  view,
  selectedOid,
  onSelect,
  onCheckedOut,
  expanded,
  onToggleExpanded
}: HistoryPanelProps) {
  const { t, i18n } = useTranslation()
  const [checkoutPrompt, setCheckoutPrompt] = useState<CheckoutPrompt | null>(null)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  // A short note in the panel's header, such as "already at this commit".
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null)
  // Discards a status read whose prompt the user closed before it arrived.
  const checkoutRequest = useRef(0)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || checkoutBusy || checkoutPrompt === null) return
      checkoutRequest.current += 1
      setCheckoutPrompt(null)
      setCheckoutError(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [checkoutPrompt, checkoutBusy])

  const layout = useMemo(
    () => (view.state === 'ready' ? layoutGraph(view.data.commits) : null),
    [view]
  )

  /**
   * Reads the repository before asking to move to a commit, so the warning can
   * name an operation in progress or uncommitted changes. A node that is the
   * tip of a branch is checked out as that branch, not as a detached commit.
   */
  const prepareCheckout = async (commit: HistoryCommit): Promise<void> => {
    if (view.state !== 'ready' || checkoutBusy) return
    const target = checkoutTarget(view.data.commits, view.data.headOid, commit)
    if (target.kind === 'current') {
      // A status read for a previously picked commit must not open its prompt.
      checkoutRequest.current += 1
      setCheckoutPrompt(null)
      setCheckoutError(null)
      setCheckoutNotice(t('history.checkout.alreadyHere'))
      return
    }

    const request = checkoutRequest.current + 1
    checkoutRequest.current = request
    setCheckoutNotice(null)
    setCheckoutError(null)
    const status = await window.seam.readRepositoryStatus(repo)
    if (request !== checkoutRequest.current) return

    const snapshot = status.ok ? status.value : null
    const dirty =
      snapshot !== null &&
      snapshot.summary.staged.length +
        snapshot.summary.unstaged.length +
        snapshot.summary.untracked.length +
        snapshot.summary.conflicts.length >
        0
    setCheckoutPrompt({
      commit,
      target,
      branch: view.data.head,
      operation: snapshot?.operation ?? null,
      dirty
    })
  }

  /** Starts the checkout once the warning is confirmed. */
  const confirmCheckout = async (): Promise<void> => {
    if (checkoutPrompt === null || checkoutBusy) return
    setCheckoutBusy(true)
    setCheckoutError(null)
    const target = checkoutPrompt.target
    const result =
      target.kind === 'branch'
        ? await window.seam.checkoutBranch({
            repo,
            branch: target.branch,
            createTracking: target.remote
          })
        : await window.seam.checkoutCommit({
            repo,
            commit: checkoutPrompt.commit.oid
          })
    if (!result.ok) {
      setCheckoutBusy(false)
      setCheckoutError(result.message || t('history.checkout.failed'))
      return
    }

    const shortId = checkoutPrompt.commit.shortId
    const branch = target.kind === 'branch' ? target.localBranch : null
    checkoutRequest.current += 1
    setCheckoutPrompt(null)
    setCheckoutError(null)
    setCheckoutBusy(false)
    onCheckedOut({ shortId, branch })
  }

  /** Closes the warning without touching the repository. */
  const closeCheckout = (): void => {
    if (checkoutBusy) return
    checkoutRequest.current += 1
    setCheckoutPrompt(null)
    setCheckoutError(null)
  }

  const beginCheckout = (commit: HistoryCommit): void => {
    void prepareCheckout(commit)
  }

  const checkoutBranch =
    checkoutPrompt !== null && checkoutPrompt.target.kind === 'branch'
      ? checkoutPrompt.target
      : null
  const checkoutCommitTarget =
    checkoutPrompt !== null && checkoutPrompt.target.kind === 'commit'
      ? checkoutPrompt.target
      : null
  const tagTips =
    checkoutPrompt === null
      ? []
      : checkoutPrompt.commit.refs
          .filter((reference) => reference.kind === 'tag')
          .map((reference) => reference.name)
  const checkoutTitle =
    checkoutPrompt === null
      ? ''
      : checkoutPrompt.operation !== null
        ? t('history.checkout.blockedTitle')
        : checkoutBranch !== null
          ? t(
              checkoutBranch.remote
                ? 'history.checkout.remoteTitle'
                : 'history.checkout.branchTitle',
              { branch: checkoutBranch.branch }
            )
          : t('history.checkout.title')

  return (
    <>
      <div className="history__sidebar">
        <div className="history__sidebar-header">
          <div className="history__sidebar-heading">
            <span className="history__sidebar-title">{t('history.title')}</span>
            <div className="history__sidebar-actions">
              {view.state === 'ready' && (
                <span className="history__count" data-testid="history-count">
                  {t('history.count', { count: view.data.commits.length })}
                </span>
              )}
              <button
                type="button"
                className="icon-button history__expand"
                data-testid="history-expand"
                title={t(expanded ? 'history.restore' : 'history.maximize')}
                aria-label={t(expanded ? 'history.restore' : 'history.maximize')}
                aria-pressed={expanded}
                onClick={onToggleExpanded}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {expanded ? (
                    <path d="M1.5 4.5h3v-3M10.5 7.5h-3v3M4.5 4.5l-3-3M7.5 7.5l3 3" />
                  ) : (
                    <path d="M4.5 1.5h-3v3M7.5 10.5h3v-3M1.5 1.5l3.5 3.5M10.5 10.5L7 7" />
                  )}
                </svg>
              </button>
            </div>
          </div>
          {checkoutNotice !== null && (
            <p
              className="history__sidebar-notice"
              role="status"
              data-testid="history-checkout-notice"
            >
              {checkoutNotice}
            </p>
          )}
        </div>

        <div className="history__sidebar-scroll">
          {view.state === 'loading' && (
            <p className="history__sidebar-note" data-testid="history-loading">
              {t('history.loading')}
            </p>
          )}

          {view.state === 'error' && (
            <p
              className="history__sidebar-note history__sidebar-note--error"
              role="alert"
              data-testid="history-error"
            >
              {view.message}
            </p>
          )}

          {view.state === 'ready' && view.data.commits.length === 0 && (
            <p className="history__sidebar-note" data-testid="history-empty">
              {t('history.empty')}
            </p>
          )}

          {view.state === 'ready' && view.data.commits.length > 0 && layout !== null && (
            <>
              <ol className="history__sidebar-list" data-testid="history-commits">
                {view.data.commits.map((commit, index) => {
                  const row = layout.rows[index]
                  if (row === undefined) return null
                  return (
                    <li key={commit.oid}>
                      <button
                        type="button"
                        className={
                          selectedOid === commit.oid
                            ? 'history__row history__row--selected'
                            : 'history__row'
                        }
                        data-testid="history-commit"
                        aria-current={selectedOid === commit.oid ? 'true' : undefined}
                        title={t('history.checkout.hint')}
                        onClick={() => onSelect(commit)}
                        onDoubleClick={() => beginCheckout(commit)}
                      >
                        <GraphCell row={row} lanes={layout.lanes} />
                        <div className="history__body">
                          <div className="history__subject-line">
                            <span className="history__subject" title={commit.subject}>
                              {commit.subject === '' ? t('history.noSubject') : commit.subject}
                            </span>
                            {commit.refs.length > 0 && (
                              <span className="history__refs">
                                {commit.refs.map((reference) => (
                                  <HistoryRefChip
                                    key={`${reference.kind}:${reference.name}`}
                                    reference={reference}
                                  />
                                ))}
                              </span>
                            )}
                          </div>
                          <div className="history__details">
                            <code className="history__id">{commit.shortId}</code>
                            <span className="history__author" title={commit.authorEmail}>
                              {commit.authorName}
                            </span>
                            <span className="history__dot" aria-hidden="true" />
                            <time
                              className="history__date"
                              dateTime={commit.authorDate}
                              title={commit.authorDate}
                            >
                              {formatDate(commit.authorDate, i18n.language)}
                            </time>
                          </div>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ol>
              {view.data.truncated && (
                <p className="history__sidebar-note" data-testid="history-truncated">
                  {t('history.truncated', { count: view.data.commits.length })}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {checkoutPrompt !== null && (
        <div
          className="dialog dialog--stacked"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="history-checkout-title"
          data-testid="history-checkout"
        >
          <div className="dialog__panel history__checkout">
            <h2 className="dialog__title" id="history-checkout-title">
              {checkoutTitle}
            </h2>
            <p className="history__checkout-target" data-testid="history-checkout-target">
              <code className="history__id">{checkoutPrompt.commit.shortId}</code>
              <span title={checkoutPrompt.commit.subject}>
                {checkoutPrompt.commit.subject === ''
                  ? t('history.noSubject')
                  : checkoutPrompt.commit.subject}
              </span>
            </p>

            {checkoutPrompt.operation !== null ? (
              <>
                <p className="dialog__error" role="alert" data-testid="history-checkout-blocked">
                  {t('history.checkout.operation', { operation: checkoutPrompt.operation })}
                </p>
                <div className="dialog__actions">
                  <button
                    type="button"
                    className="dialog__button"
                    onClick={closeCheckout}
                    autoFocus
                  >
                    {t('history.close')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="dialog__explain" data-testid="history-checkout-warning">
                  {checkoutBranch !== null
                    ? t(
                        checkoutBranch.remote
                          ? 'history.checkout.remote'
                          : 'history.checkout.branch',
                        { branch: checkoutBranch.localBranch }
                      )
                    : checkoutCommitTarget?.relation === 'past' && checkoutPrompt.branch !== null
                      ? t('history.checkout.past', { branch: checkoutPrompt.branch })
                      : t('history.checkout.other', { id: checkoutPrompt.commit.shortId })}
                </p>
                {tagTips.length > 0 && (
                  <p className="dialog__notice">
                    {t('history.checkout.tagTip', { tags: tagTips.join(', ') })}
                  </p>
                )}
                {checkoutPrompt.dirty && (
                  <p className="dialog__notice" data-testid="history-checkout-dirty">
                    {t('history.checkout.dirty')}
                  </p>
                )}
                {checkoutError !== null && (
                  <p className="dialog__error" role="alert" data-testid="history-checkout-error">
                    {checkoutError}
                  </p>
                )}
                <div className="dialog__actions">
                  <button
                    type="button"
                    className="dialog__button"
                    onClick={closeCheckout}
                    disabled={checkoutBusy}
                    autoFocus
                  >
                    {t('history.checkout.cancel')}
                  </button>
                  <button
                    type="button"
                    className="dialog__button history__checkout-confirm"
                    data-testid="history-checkout-confirm"
                    onClick={() => void confirmCheckout()}
                    disabled={checkoutBusy}
                  >
                    {t(
                      checkoutBusy
                        ? 'history.checkout.checkingOut'
                        : checkoutBranch !== null
                          ? 'history.checkout.confirmBranch'
                          : 'history.checkout.confirm'
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
