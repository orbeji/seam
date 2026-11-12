// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorktreeStatus } from '../../shared/git'
import { sameFolder } from '../worktree/paths'
import { buildBranchTree, type BranchNode } from './branch-tree'

interface TopBarProps {
  /** The branch to label, or null when there is nothing to show. */
  readonly branch: string | null
  /** Whether there is a repository whose status can be read again. */
  readonly canRefresh: boolean
  /** Whether the open repository has a commit graph to show. */
  readonly canHistory: boolean
  /** Whether the persistent history panel is currently shown. */
  readonly historyVisible: boolean
  /** Whether there is a branch that could be pushed. */
  readonly canPush: boolean
  /** How many commits the push would send, shown next to the label. */
  readonly pushCount: number | null
  /** Whether a fetch or a pull is running, so both buttons wait. */
  readonly syncing: boolean
  /** Whether the remotes can be fetched right now. */
  readonly canFetch: boolean
  /** Whether the branch's upstream can be pulled right now. */
  readonly canPull: boolean
  /** Whether the branch dialog can open for the open repository. */
  readonly canBranch: boolean
  /** Whether the worktree manager can open for the open repository. */
  readonly canWorktree: boolean
  /** Whether a merge can start in the open repository. */
  readonly canMerge: boolean
  /** Whether the GitFlow popup can open for the open repository. */
  readonly canGitFlow: boolean
  readonly onRefresh: () => void
  readonly onHistory: () => void
  readonly onPush: () => void
  readonly onFetch: () => void
  readonly onPull: () => void
  readonly onBranch: () => void
  readonly onWorktrees: () => void
  readonly onMerge: () => void
  readonly onGitFlow: () => void
  readonly onSettings: () => void
  /** Called when a branch is selected for checkout. */
  readonly onCheckoutBranch: (branch: string) => void
  /** Called to load the branch list. */
  readonly onLoadBranches: () => void
  /** Current branch list (local and remote). */
  readonly branches: {
    local: Array<{ name: string; current: boolean }>
    remote: Array<{ name: string; remote: string }>
  } | null
  /** Whether branches are being loaded. */
  readonly loadingBranches: boolean
  /** Error message if branch loading failed. */
  readonly branchesError: string | null
  /** The folder whose tab is showing, marked in the worktree list. */
  readonly currentRepo: string | null
  /** The worktrees Git registered for the open repository. */
  readonly worktrees: readonly WorktreeStatus[] | null
  /** Whether the worktree list is being read. */
  readonly loadingWorktrees: boolean
  /** Error message if reading the worktrees failed. */
  readonly worktreesError: string | null
  /** Called to read the worktree list. */
  readonly onLoadWorktrees: () => void
  /** Called when a worktree is selected, moving to its folder. */
  readonly onOpenWorktree: (path: string) => void
}

/**
 * The menu's own view of one branch: the checkout name plus what to show at
 * either side of the line. Local branches carry the current flag, remote ones
 * carry the owning remote for the right-side badge.
 */
type BranchListItem =
  | { readonly kind: 'local'; readonly name: string; readonly current: boolean }
  | { readonly kind: 'remote'; readonly name: string; readonly remote: string }

/** The branch list's path, with the remote prefix stripped for remote branches. */
function displayPath(item: BranchListItem): string {
  if (item.kind !== 'remote') return item.name
  if (item.remote === '' || !item.name.startsWith(`${item.remote}/`)) return item.name
  return item.name.slice(item.remote.length + 1)
}

/** The last segment of a folder path, which names a worktree's row. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part !== '')
  return parts.at(-1) ?? path
}

function BranchRows({
  nodes,
  folded,
  onFold,
  onSelect,
  showRemote
}: {
  readonly nodes: readonly BranchNode<BranchListItem>[]
  readonly folded: ReadonlySet<string>
  readonly onFold: (path: string) => void
  readonly onSelect: (name: string) => void
  readonly showRemote: boolean
}) {
  const { t } = useTranslation()
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === 'group') {
          return (
            <div className="topbar__branch-group" key={node.path}>
              <div className="topbar__branch-folder">
                <button
                  type="button"
                  className={
                    folded.has(node.path)
                      ? 'topbar__folder-toggle topbar__folder-toggle--folded'
                      : 'topbar__folder-toggle'
                  }
                  aria-expanded={!folded.has(node.path)}
                  onClick={() => onFold(node.path)}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d="M2 3.5l3 3 3-3" />
                  </svg>
                </button>
                <svg
                  className="topbar__folder-icon"
                  width="12"
                  height="12"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M1.5 4.5v7h11v-6H7l-1-1z" />
                </svg>
                <span className="topbar__menu-name">{node.name}</span>
              </div>
              {folded.has(node.path) ? null : (
                <div className="topbar__branch-folder-children">
                  <BranchRows
                    nodes={node.children}
                    folded={folded}
                    onFold={onFold}
                    onSelect={onSelect}
                    showRemote={showRemote}
                  />
                </div>
              )}
            </div>
          )
        }
        const item = node.item
        return (
          <button
            type="button"
            role="menuitem"
            key={item.name}
            title={item.name}
            className={`topbar__menu-item topbar__menu-item--branch ${
              item.kind === 'local' && item.current ? 'topbar__menu-item--current' : ''
            }`}
            onClick={() => onSelect(item.name)}
            disabled={item.kind === 'local' && item.current}
          >
            <span className="topbar__menu-name">{node.label}</span>
            {item.kind === 'local' && item.current ? (
              <span className="topbar__menu-badge">{t('topbar.branch.current')}</span>
            ) : null}
            {item.kind === 'remote' && showRemote ? (
              <span className="topbar__menu-path">{item.remote}</span>
            ) : null}
          </button>
        )
      })}
    </>
  )
}

/**
 * The 40px bar at the top of the window: the brand, the current branch and the
 * actions that work on it. Repositories are chosen in the tab strip under it.
 */
export default function TopBar({
  branch,
  canRefresh,
  canHistory,
  historyVisible,
  canPush,
  pushCount,
  syncing,
  canFetch,
  canPull,
  canBranch,
  canWorktree,
  canMerge,
  canGitFlow,
  onRefresh,
  onHistory,
  onPush,
  onFetch,
  onPull,
  onBranch,
  onWorktrees,
  onMerge,
  onGitFlow,
  onSettings,
  onCheckoutBranch,
  onLoadBranches,
  branches,
  loadingBranches,
  branchesError,
  currentRepo,
  worktrees,
  loadingWorktrees,
  worktreesError,
  onLoadWorktrees,
  onOpenWorktree
}: TopBarProps) {
  const { t } = useTranslation()
  // The badge only makes sense when there is something to send; zero leaves the
  // disabled button with its plain label.
  const pushed = pushCount !== null && pushCount > 0
  const pushLabel = pushed
    ? `${t('push.button')} · ${t('push.commits', { count: pushCount })}`
    : t('push.button')
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const branchMenuRef = useRef<HTMLDivElement | null>(null)
  // Folders the user folded by path, e.g. "feature" or "feature/fix".
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())

  // A click outside the branch menu closes it, and so does Escape.
  useEffect(() => {
    if (!branchMenuOpen) return
    const close = (event: MouseEvent): void => {
      if (branchMenuRef.current !== null && !branchMenuRef.current.contains(event.target as Node)) {
        setBranchMenuOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setBranchMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [branchMenuOpen])

  const handleBranchMenuOpen = () => {
    if (branchMenuOpen) {
      setBranchMenuOpen(false)
      return
    }
    setBranchMenuOpen(true)
    if (branches === null && !loadingBranches) {
      onLoadBranches()
    }
    if (worktrees === null && !loadingWorktrees) {
      onLoadWorktrees()
    }
  }

  const handleBranchSelect = (branchName: string) => {
    setBranchMenuOpen(false)
    onCheckoutBranch(branchName)
  }

  const handleWorktreeSelect = (path: string) => {
    setBranchMenuOpen(false)
    onOpenWorktree(path)
  }

  const handleFold = (path: string) => {
    setFolded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  // The remote badge only earns its place when a branch could exist in more
  // than one remote; with a single remote its name is noise on every line.
  const branchBadgeRemote =
    branches === null ? new Set<string>() : new Set(branches.remote.map((b) => b.remote))
  const showRemote = branchBadgeRemote.size > 1

  // A branch checked out in another worktree cannot be checked out here too,
  // so it belongs only to the worktree list that moves to it. The current
  // worktree's own branch stays, already disabled with its badge.
  const occupiedBranches = new Set(
    (worktrees ?? [])
      .filter((worktree) => worktree.branch !== null && !sameFolder(worktree.path, currentRepo))
      .map((worktree) => worktree.branch as string)
  )
  const localBranches =
    branches === null ? [] : branches.local.filter((branch) => !occupiedBranches.has(branch.name))
  const remoteBranches =
    branches === null
      ? []
      : branches.remote.filter(
          (branch) =>
            !occupiedBranches.has(
              displayPath({ kind: 'remote', name: branch.name, remote: branch.remote })
            )
        )

  return (
    <header className="topbar" data-testid="topbar">
      {branch !== null && (
        <div className="topbar__branch-picker" ref={branchMenuRef}>
          <button
            type="button"
            className="topbar__branch"
            data-testid="branch-label"
            title={branch}
            aria-haspopup="menu"
            aria-expanded={branchMenuOpen}
            onClick={handleBranchMenuOpen}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="4" cy="3" r="1.6" />
              <circle cx="4" cy="11" r="1.6" />
              <circle cx="10" cy="5" r="1.6" />
              <path d="M4 4.6v4.8M10 6.6c0 2-3 1.6-6 3" />
            </svg>
            <span className="topbar__branch-name">{branch}</span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M2 3.5l3 3 3-3" />
            </svg>
          </button>

          {branchMenuOpen && (
            <div className="topbar__branch-menu" role="menu" data-testid="branch-menu">
              {loadingBranches ? (
                <p className="topbar__menu-title">{t('topbar.branch.loading')}</p>
              ) : branchesError ? (
                <p className="topbar__menu-title" style={{ color: 'var(--conflict)' }}>
                  {branchesError}
                </p>
              ) : branches === null ||
                (localBranches.length === 0 && remoteBranches.length === 0) ? (
                <p className="topbar__menu-title">{t('topbar.branch.none')}</p>
              ) : (
                <>
                  {localBranches.length > 0 && (
                    <>
                      <p className="topbar__menu-title">{t('topbar.branch.local')}</p>
                      <BranchRows
                        nodes={buildBranchTree(
                          localBranches.map((b) => ({
                            kind: 'local' as const,
                            name: b.name,
                            current: b.current
                          })),
                          displayPath
                        )}
                        folded={folded}
                        onFold={handleFold}
                        onSelect={handleBranchSelect}
                        showRemote={showRemote}
                      />
                    </>
                  )}
                  {remoteBranches.length > 0 && (
                    <>
                      <p className="topbar__menu-title">{t('topbar.branch.remote')}</p>
                      <BranchRows
                        nodes={buildBranchTree(
                          remoteBranches.map((b) => ({
                            kind: 'remote' as const,
                            name: b.name,
                            remote: b.remote
                          })),
                          displayPath
                        )}
                        folded={folded}
                        onFold={handleFold}
                        onSelect={handleBranchSelect}
                        showRemote={showRemote}
                      />
                    </>
                  )}
                </>
              )}

              <p className="topbar__menu-title">{t('topbar.worktree.list')}</p>
              {loadingWorktrees ? (
                <p className="topbar__menu-title">{t('topbar.worktree.loading')}</p>
              ) : worktreesError !== null ? (
                <p className="topbar__menu-title" style={{ color: 'var(--conflict)' }}>
                  {worktreesError}
                </p>
              ) : worktrees === null || worktrees.length === 0 ? (
                <p className="topbar__menu-title">{t('topbar.worktree.none')}</p>
              ) : (
                worktrees.map((worktree) => {
                  const current = sameFolder(worktree.path, currentRepo)
                  const label = worktree.branch ?? t('worktree.detached')
                  return (
                    <button
                      type="button"
                      role="menuitem"
                      key={worktree.path}
                      title={`${label} — ${worktree.path}`}
                      className={`topbar__menu-item topbar__menu-item--branch ${
                        current ? 'topbar__menu-item--current' : ''
                      }`}
                      disabled={current || worktree.bare || worktree.prunable !== null}
                      onClick={() => handleWorktreeSelect(worktree.path)}
                    >
                      <span className="topbar__menu-name">{folderName(worktree.path)}</span>
                      {current ? (
                        <span className="topbar__menu-badge">{t('topbar.worktree.current')}</span>
                      ) : (
                        <span className="topbar__menu-path">{label}</span>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className="topbar__history"
        data-testid="history-button"
        title={t(historyVisible ? 'topbar.history.hide' : 'topbar.history.title')}
        aria-pressed={historyVisible}
        disabled={!canHistory}
        onClick={onHistory}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="3" cy="3" r="1.6" />
          <circle cx="3" cy="11" r="1.6" />
          <circle cx="10.5" cy="5.5" r="1.6" />
          <path d="M3 4.6v4.8M10.5 7.1c0 2.2-2.5 2.7-7.5 3.9" />
        </svg>
        {t('topbar.history.label')}
      </button>

      <div className="topbar__spacer" />

      <button
        type="button"
        className="button topbar__merge"
        data-testid="merge-button"
        title={t('topbar.merge.title')}
        disabled={!canMerge}
        onClick={onMerge}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="3.5" cy="2.5" r="1.4" />
          <circle cx="3.5" cy="11.5" r="1.4" />
          <circle cx="10.5" cy="7" r="1.4" />
          <path d="M3.5 3.9v6.2M10.5 5.6c0 2.2-2.5 2.3-6.4 1.3" />
        </svg>
        {t('topbar.merge.label')}
      </button>

      <button
        type="button"
        className="button topbar__branch-action"
        data-testid="branch-button"
        title={t('topbar.newBranch.title')}
        disabled={!canBranch}
        onClick={onBranch}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="4" cy="3" r="1.6" />
          <circle cx="4" cy="11" r="1.6" />
          <circle cx="10" cy="5" r="1.6" />
          <path d="M4 4.6v4.8M10 6.6c0 2-3 1.6-6 3" />
        </svg>
        {t('topbar.newBranch.label')}
      </button>

      <button
        type="button"
        className="button topbar__worktrees"
        data-testid="worktree-button"
        title={t('topbar.worktree.title')}
        disabled={!canWorktree}
        onClick={onWorktrees}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M1.5 2.5h4v3h-4zM8.5 2.5h4v3h-4zM1.5 8.5h4v3h-4zM8.5 8.5h4v3h-4z" />
          <path d="M5.5 4h3M3.5 5.5v3M10.5 5.5v3" />
        </svg>
        {t('topbar.worktree.label')}
      </button>

      <span className="topbar__divider" aria-hidden="true" />

      <button
        type="button"
        className="button topbar__fetch"
        data-testid="fetch"
        title={t('topbar.fetch.title')}
        disabled={!canFetch || syncing}
        onClick={onFetch}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 2.5v7.5M5 7l3 3 3-3" />
          <path d="M2.5 13h11" />
        </svg>
        {t('topbar.fetch.label')}
      </button>

      <button
        type="button"
        className="button topbar__pull"
        data-testid="pull"
        title={t('topbar.pull.title')}
        disabled={!canPull || syncing}
        onClick={onPull}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 2.5v7.5M5 7l3 3 3-3" />
          <path d="M2.5 10.5v3h11v-3" />
        </svg>
        {t('topbar.pull.label')}
      </button>

      <button
        type="button"
        className="button topbar__push"
        data-testid="push-button"
        title={pushLabel}
        aria-label={pushLabel}
        disabled={!canPush}
        onClick={onPush}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 10.5V3M4 6l3-3 3 3M2.5 11.5h9" />
        </svg>
        {t('push.button')}
        {pushed && (
          <span className="topbar__count" data-testid="push-count">
            {pushCount}
          </span>
        )}
      </button>

      <span className="topbar__divider" aria-hidden="true" />

      <button
        type="button"
        className="button topbar__gitflow"
        data-testid="gitflow-button"
        title={t('topbar.gitflow.title')}
        disabled={!canGitFlow}
        onClick={onGitFlow}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="3" cy="3" r="1.4" />
          <circle cx="11" cy="3" r="1.4" />
          <circle cx="7" cy="11" r="1.4" />
          <path d="M3 4.4v1.1c0 1.6 1.3 2.1 2.8 2.6M11 4.4v1.1c0 1.6-1.3 2.1-2.8 2.6" />
        </svg>
        {t('topbar.gitflow.label')}
      </button>

      <button
        type="button"
        className="icon-button"
        data-testid="refresh"
        aria-label={t('topbar.refresh')}
        title={t('topbar.refresh')}
        disabled={!canRefresh}
        onClick={onRefresh}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3" />
        </svg>
      </button>

      <button
        type="button"
        className="icon-button"
        data-testid="settings"
        aria-label={t('settings.title')}
        title={t('settings.title')}
        onClick={onSettings}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="3" />
          <path d="M8 2v2M8 12v2M2 8h2M12 8h2M4.34 4.34l1.41 1.41M10.24 10.24l1.41 1.41M11.66 4.34l-1.41 1.41M4.34 11.66l1.41-1.41" />
        </svg>
      </button>
    </header>
  )
}
