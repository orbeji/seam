// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChangeSummary, GitOperation, StatusEntry, UnmergedEntry } from '../../shared/git'
import type { FileVersionSource } from '../../shared/ipc'
import { splitPath } from '../paths'
import { entryView, fileBadge } from './entry-view'

/** Opens a file in the diff viewer, comparing two of its versions. */
export type OpenDiff = (path: string, from: FileVersionSource, to: FileVersionSource) => void

/** Stages or unstages the given paths: one file or a whole section. */
export type StageAction = (paths: readonly string[]) => void

/** Whether a list stages its files, unstages them, or offers no action. */
type SectionAction = 'stage' | 'unstage' | null

interface SectionProps {
  testId: string
  titleKey: string
  entries: StatusEntry[]
  from: FileVersionSource
  to: FileVersionSource
  onOpen: OpenDiff
  action: SectionAction
  onAction: StageAction
  /** The file open in the viewer, highlighted in the list. */
  selectedPath: string | null
  /** The two versions the selected row compares, so the other list's row stays unmarked. */
  selectedFrom: FileVersionSource | null
  selectedTo: FileVersionSource | null
  /** Throws away a row's working-tree changes. Only the unstaged list sets it. */
  onDiscard?: StageAction
}

/**
 * The paths an action sends for one row. A rename is staged or unstaged by
 * naming its old and new paths in the same command, which is what Git needs to
 * record it as a rename instead of a delete plus an add.
 */
function pathsFor(entry: StatusEntry): string[] {
  return entry.kind === 'renamed' ? [entry.path, entry.origPath] : [entry.path]
}

/** A row's file name and directory, keeping both names of a rename visible. */
function rowPath(entry: StatusEntry): { name: string; dir: string } {
  const { name, dir } = splitPath(entry.path)
  if (entry.kind === 'renamed') {
    return { name: `${splitPath(entry.origPath).name} → ${name}`, dir }
  }
  return { name, dir }
}

/** The chevron that opens and closes a section. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className="changes__chevron"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
      data-open={open}
    >
      <path d="M2 3.5l3 3 3-3" />
    </svg>
  )
}

/** The plus or minus icon that stages or unstages one file. */
function ActionIcon({ action }: { action: Exclude<SectionAction, null> }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {action === 'stage' ? <path d="M7 3v8M3 7h8" /> : <path d="M3 7h8" />}
    </svg>
  )
}

function Section({
  testId,
  titleKey,
  entries,
  from,
  to,
  onOpen,
  action,
  onAction,
  selectedPath,
  selectedFrom,
  selectedTo,
  onDiscard
}: SectionProps) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  // The row whose context menu is open, and where it sits on screen. Only the
  // unstaged list has one for now.
  const [menu, setMenu] = useState<{ entry: StatusEntry; x: number; y: number } | null>(null)
  const labelKey = action === 'stage' ? 'changes.actions.stage' : 'changes.actions.unstage'
  const allKey = action === 'stage' ? 'changes.actions.stageAll' : 'changes.actions.unstageAll'
  const titleId = `${testId}-title`

  // A click outside, Escape, a scroll or the window losing focus closes the
  // menu, so it never lingers over another file.
  useEffect(() => {
    if (menu === null) return
    const close = (event: MouseEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('.changes__context-menu')) return
      setMenu(null)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    const onBlur = (): void => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [menu])

  const openMenu = (entry: StatusEntry, x: number, y: number): void => {
    // The panel must fit on screen even when the pointer is at its edge.
    const width = 220
    const height = 44
    const margin = 8
    setMenu({
      entry,
      x: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - height - margin))
    })
  }

  return (
    <section className="changes__section" data-testid={testId} aria-labelledby={titleId}>
      <h2 className="changes__heading" id={titleId}>
        <button
          type="button"
          className="changes__collapse"
          aria-expanded={!collapsed}
          onClick={() => {
            setCollapsed((value) => !value)
            setMenu(null)
          }}
        >
          <Chevron open={!collapsed} />
        </button>
        <span className="changes__section-title">{t(titleKey)}</span>
        <span className="changes__count" data-testid={`${testId}-count`}>
          {entries.length}
        </span>
        <span className="changes__heading-spacer" />
        {action !== null && entries.length > 0 && (
          <button
            type="button"
            className={`changes__action changes__action--all changes__action--${action}`}
            data-testid={`${testId}-action`}
            onClick={() => onAction(entries.flatMap(pathsFor))}
          >
            {t(allKey)}
          </button>
        )}
      </h2>

      {!collapsed && entries.length > 0 && (
        <ul className="changes__list">
          {entries.map((entry) => {
            const view = entryView(entry)
            const badge = fileBadge(entry)
            const { name, dir } = rowPath(entry)
            const isSelected =
              selectedPath === entry.path && selectedFrom === from && selectedTo === to
            return (
              <li
                className={`changes__item${isSelected ? ' changes__item--selected' : ''}`}
                key={view.key}
                onContextMenu={
                  onDiscard === undefined
                    ? undefined
                    : (event) => {
                        event.preventDefault()
                        openMenu(entry, event.clientX, event.clientY)
                      }
                }
              >
                <button
                  type="button"
                  className="changes__entry"
                  data-testid="entry"
                  title={view.label}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => onOpen(entry.path, from, to)}
                  onKeyDown={(event) => {
                    if (
                      onDiscard === undefined ||
                      (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
                    ) {
                      return
                    }
                    event.preventDefault()
                    const rect = event.currentTarget.getBoundingClientRect()
                    openMenu(entry, rect.left + 16, rect.top + rect.height)
                  }}
                >
                  <span
                    className={`changes__badge changes__badge--${badge.tone}`}
                    aria-hidden="true"
                  >
                    {badge.letter}
                  </span>
                  <span className="changes__name">{name}</span>
                  <span className="changes__dir">{dir}</span>
                </button>
                {action !== null && (
                  <button
                    type="button"
                    className={`icon-button changes__entry-action changes__entry-action--${action}`}
                    data-testid="entry-action"
                    aria-label={`${t(labelKey)}: ${view.label}`}
                    title={`${t(labelKey)}: ${view.label}`}
                    onClick={() => onAction(pathsFor(entry))}
                  >
                    <ActionIcon action={action} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {menu !== null && onDiscard !== undefined && (
        <div
          className="changes__context-menu"
          role="menu"
          aria-label={t('changes.menu.label')}
          data-testid="file-menu"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            type="button"
            role="menuitem"
            className="changes__context-action changes__context-action--discard"
            data-testid="file-discard"
            onClick={() => {
              onDiscard([menu.entry.path])
              setMenu(null)
            }}
          >
            {t('changes.menu.discardAll')}
          </button>
        </div>
      )}
    </section>
  )
}

/**
 * The conflicts node. It replaces the ordinary list during an operation: the
 * rows open the two sides in the viewer, Resolve opens the conflicts dialog,
 * and Abort waits for the phase that implements it. The node stays visible
 * while an operation is in progress even when every file is resolved, so a
 * resolution can still be undone.
 */
function ConflictsSection({
  entries,
  operation,
  onOpen,
  onResolve,
  onAbort,
  selectedPath
}: {
  entries: UnmergedEntry[]
  operation: GitOperation | null
  onOpen: OpenDiff
  onResolve: () => void
  onAbort: () => void
  selectedPath: string | null
}) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <section
      className="changes__section"
      data-testid="conflicts"
      aria-labelledby="conflicts-section-title"
    >
      <h2 className="changes__heading" id="conflicts-section-title">
        <button
          type="button"
          className="changes__collapse"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <Chevron open={!collapsed} />
        </button>
        <span className="changes__section-title">{t('changes.sections.conflicts')}</span>
        <span className="changes__count" data-testid="conflicts-count">
          {entries.length}
        </span>
        <span className="changes__heading-spacer" />
        <button
          type="button"
          className="changes__action changes__action--all"
          data-testid="conflicts-resolve"
          onClick={onResolve}
        >
          {t('conflicts.resolve')}
        </button>
      </h2>

      {!collapsed && entries.length > 0 && (
        <ul className="changes__list">
          {entries.map((entry) => {
            const view = entryView(entry)
            const badge = fileBadge(entry)
            const { name, dir } = rowPath(entry)
            const isSelected = selectedPath === entry.path
            return (
              <li
                className={`changes__item${isSelected ? ' changes__item--selected' : ''}`}
                key={view.key}
              >
                <button
                  type="button"
                  className="changes__entry"
                  data-testid="entry"
                  title={view.label}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => onOpen(entry.path, 'stage2', 'stage3')}
                >
                  <span
                    className={`changes__badge changes__badge--${badge.tone}`}
                    aria-hidden="true"
                  >
                    {badge.letter}
                  </span>
                  <span className="changes__name">{name}</span>
                  <span className="changes__dir">{dir}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {!collapsed && entries.length === 0 && (
        <p className="changes__none">{t('conflicts.noUnresolved')}</p>
      )}

      <div className="conflicts__node-actions">
        <button type="button" className="button" data-testid="conflicts-open" onClick={onResolve}>
          {t('conflicts.resolveConflicts')}
        </button>
        <button
          type="button"
          className="dialog__button"
          data-testid="conflicts-abort"
          onClick={onAbort}
        >
          {t(`conflicts.abort.${operation ?? 'stash'}`)}
        </button>
      </div>
    </section>
  )
}

/**
 * The four lists of the changes screen: staged, unstaged, untracked, conflicts.
 * Each list knows which two versions its rows compare, because the viewer opens
 * straight from a row, and whether it stages or unstages the files it shows.
 */
export default function ChangesView({
  summary,
  operation,
  selectedPath,
  selectedFrom,
  selectedTo,
  onOpen,
  onStage,
  onUnstage,
  onDiscard,
  onResolve,
  onAbort
}: {
  summary: ChangeSummary
  operation: GitOperation | null
  selectedPath: string | null
  selectedFrom: FileVersionSource | null
  selectedTo: FileVersionSource | null
  onOpen: OpenDiff
  onStage: StageAction
  onUnstage: StageAction
  onDiscard: StageAction
  onResolve: () => void
  onAbort: () => void
}) {
  return (
    <div className="changes">
      <Section
        testId="staged"
        titleKey="changes.sections.staged"
        entries={summary.staged}
        from="head"
        to="index"
        onOpen={onOpen}
        action="unstage"
        onAction={onUnstage}
        selectedPath={selectedPath}
        selectedFrom={selectedFrom}
        selectedTo={selectedTo}
      />
      <Section
        testId="unstaged"
        titleKey="changes.sections.unstaged"
        entries={summary.unstaged}
        from="index"
        to="worktree"
        onOpen={onOpen}
        action="stage"
        onAction={onStage}
        onDiscard={onDiscard}
        selectedPath={selectedPath}
        selectedFrom={selectedFrom}
        selectedTo={selectedTo}
      />
      <Section
        testId="untracked"
        titleKey="changes.sections.untracked"
        entries={summary.untracked}
        from="index"
        to="worktree"
        onOpen={onOpen}
        action="stage"
        onAction={onStage}
        selectedPath={selectedPath}
        selectedFrom={selectedFrom}
        selectedTo={selectedTo}
      />
      {(operation !== null || summary.conflicts.length > 0) && (
        <ConflictsSection
          entries={summary.conflicts}
          operation={operation}
          onOpen={onOpen}
          onResolve={onResolve}
          onAbort={onAbort}
          selectedPath={selectedPath}
        />
      )}
    </div>
  )
}
