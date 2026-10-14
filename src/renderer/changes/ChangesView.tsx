// SPDX-License-Identifier: MIT

import { useTranslation } from 'react-i18next'
import type { ChangeSummary, StatusEntry } from '../../shared/git'
import { entryView } from './entry-view'

interface SectionProps {
  testId: string
  titleKey: string
  entries: StatusEntry[]
}

function Section({ testId, titleKey, entries }: SectionProps) {
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
              <li className="changes__item" key={view.key} data-testid="entry">
                <span className="changes__badge">{view.badge}</span>
                <span className="changes__path">{view.label}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** The four lists of the changes screen: staged, unstaged, untracked, conflicts. */
export default function ChangesView({ summary }: { summary: ChangeSummary }) {
  return (
    <div className="changes">
      <Section testId="staged" titleKey="changes.sections.staged" entries={summary.staged} />
      <Section testId="unstaged" titleKey="changes.sections.unstaged" entries={summary.unstaged} />
      <Section
        testId="untracked"
        titleKey="changes.sections.untracked"
        entries={summary.untracked}
      />
      <Section
        testId="conflicts"
        titleKey="changes.sections.conflicts"
        entries={summary.conflicts}
      />
    </div>
  )
}
