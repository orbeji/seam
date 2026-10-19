// SPDX-License-Identifier: MIT

import { useTranslation } from 'react-i18next'
import type { ChangeSummary, GitOperation, StatusEntry, UnmergedEntry } from '../../shared/git'
import type { FileVersionSource } from '../../shared/ipc'
import { entryView } from './entry-view'

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
}

/**
 * The paths an action sends for one row. A rename is staged or unstaged by
 * naming its old and new paths in the same command, which is what Git needs to
 * record it as a rename instead of a delete plus an add.
 */
function pathsFor(entry: StatusEntry): string[] {
  return entry.kind === 'renamed' ? [entry.path, entry.origPath] : [entry.path]
}

function Section({ testId, titleKey, entries, from, to, onOpen, action, onAction }: SectionProps) {
  const { t } = useTranslation()
  const labelKey = action === 'stage' ? 'changes.actions.stage' : 'changes.actions.unstage'
  const allKey = action === 'stage' ? 'changes.actions.stageAll' : 'changes.actions.unstageAll'

  return (
    <section className="changes__section" data-testid={testId} aria-labelledby={`${testId}-title`}>
      <h2 className="changes__heading" id={`${testId}-title`}>
        <span className="changes__section-title">{t(titleKey)}</span>
        <span className="changes__heading-tools">
          {action !== null && entries.length > 0 && (
            <button
              type="button"
              className="changes__action"
              data-testid={`${testId}-action`}
              onClick={() => onAction(entries.flatMap(pathsFor))}
            >
              {t(allKey)}
            </button>
          )}
          <span className="changes__count" data-testid={`${testId}-count`}>
            {entries.length}
          </span>
        </span>
      </h2>

      {entries.length === 0 ? (
        <p className="changes__none">{t('changes.none')}</p>
      ) : (
        <ul className="changes__list">
          {entries.map((entry) => {
            const view = entryView(entry)
            return (
              <li className="changes__item" key={view.key}>
                <button
                  type="button"
                  className="changes__entry"
                  data-testid="entry"
                  onClick={() => onOpen(entry.path, from, to)}
                >
                  <span className="changes__badge">{view.badge}</span>
                  <span className="changes__path">{view.label}</span>
                </button>
                {action !== null && (
                  <button
                    type="button"
                    className="changes__action"
                    data-testid="entry-action"
                    aria-label={`${t(labelKey)}: ${view.label}`}
                    onClick={() => onAction(pathsFor(entry))}
                  >
                    {t(labelKey)}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
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
  onOpen,
  onResolve
}: {
  entries: UnmergedEntry[]
  onOpen: OpenDiff
  onResolve: () => void
}) {
  const { t } = useTranslation()

  return (
    <section
      className="changes__section"
      data-testid="conflicts"
      aria-labelledby="conflicts-section-title"
    >
      <h2 className="changes__heading" id="conflicts-section-title">
        <span className="changes__section-title">{t('changes.sections.conflicts')}</span>
        <span className="changes__heading-tools">
          <button
            type="button"
            className="changes__action"
            data-testid="conflicts-resolve"
            onClick={onResolve}
          >
            {t('conflicts.resolve')}
          </button>
          <span className="changes__count" data-testid="conflicts-count">
            {entries.length}
          </span>
        </span>
      </h2>

      {entries.length === 0 ? (
        <p className="changes__none">{t('conflicts.noUnresolved')}</p>
      ) : (
        <ul className="changes__list">
          {entries.map((entry) => {
            const view = entryView(entry)
            return (
              <li className="changes__item" key={view.key}>
                <button
                  type="button"
                  className="changes__entry"
                  data-testid="entry"
                  onClick={() => onOpen(entry.path, 'stage2', 'stage3')}
                >
                  <span className="changes__badge">{view.badge}</span>
                  <span className="changes__path">{view.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="conflicts__node-actions">
        <button type="button" className="button" data-testid="conflicts-open" onClick={onResolve}>
          {t('conflicts.resolveConflicts')}
        </button>
        <button
          type="button"
          className="dialog__button"
          data-testid="conflicts-abort"
          disabled
          title={t('conflicts.laterPhase')}
        >
          {t('conflicts.abort')}
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
  onOpen,
  onStage,
  onUnstage,
  onResolve
}: {
  summary: ChangeSummary
  operation: GitOperation | null
  onOpen: OpenDiff
  onStage: StageAction
  onUnstage: StageAction
  onResolve: () => void
}) {
  return (
    <div className="changes">
      <Section
        testId="staged"
        titleKey="changes.sections.staged"
        entries={summary.staged}
        from="index"
        to="worktree"
        onOpen={onOpen}
        action="unstage"
        onAction={onUnstage}
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
      />
      {(operation !== null || summary.conflicts.length > 0) && (
        <ConflictsSection entries={summary.conflicts} onOpen={onOpen} onResolve={onResolve} />
      )}
    </div>
  )
}
