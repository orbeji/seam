// SPDX-License-Identifier: MIT

import { useTranslation } from 'react-i18next'
import type { ChangeSummary, StatusEntry } from '../../shared/git'
import type { FileVersionSource } from '../../shared/ipc'
import { entryView } from './entry-view'

/** Opens a file in the diff viewer, comparing two of its versions. */
export type OpenDiff = (path: string, from: FileVersionSource, to: FileVersionSource) => void

interface SectionProps {
  testId: string
  titleKey: string
  entries: StatusEntry[]
  from: FileVersionSource
  to: FileVersionSource
  onOpen: OpenDiff
}

function Section({ testId, titleKey, entries, from, to, onOpen }: SectionProps) {
  const { t } = useTranslation()

  return (
    <section className="changes__section" data-testid={testId} aria-labelledby={`${testId}-title`}>
      <h2 className="changes__heading" id={`${testId}-title`}>
        <span className="changes__section-title">{t(titleKey)}</span>
        <span className="changes__count" data-testid={`${testId}-count`}>
          {entries.length}
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
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/**
 * The four lists of the changes screen: staged, unstaged, untracked, conflicts.
 * Each list knows which two versions its rows compare, because the viewer opens
 * straight from a row.
 */
export default function ChangesView({
  summary,
  onOpen
}: {
  summary: ChangeSummary
  onOpen: OpenDiff
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
      />
      <Section
        testId="unstaged"
        titleKey="changes.sections.unstaged"
        entries={summary.unstaged}
        from="index"
        to="worktree"
        onOpen={onOpen}
      />
      <Section
        testId="untracked"
        titleKey="changes.sections.untracked"
        entries={summary.untracked}
        from="head"
        to="worktree"
        onOpen={onOpen}
      />
      <Section
        testId="conflicts"
        titleKey="changes.sections.conflicts"
        entries={summary.conflicts}
        from="stage2"
        to="stage3"
        onOpen={onOpen}
      />
    </div>
  )
}
