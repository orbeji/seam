// SPDX-License-Identifier: MIT

import { useTranslation } from 'react-i18next'

/**
 * The commit message box. It holds one message per repository and stores it as
 * it is typed, so the draft survives switching files and closing Seam. Reading
 * the message back to create the commit is a later task.
 */
export default function CommitBox({
  value,
  onChange
}: {
  value: string
  onChange: (message: string) => void
}) {
  const { t } = useTranslation()
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
    </section>
  )
}
