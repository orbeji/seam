// SPDX-License-Identifier: MIT

import { useTranslation } from 'react-i18next'
import type { IpcErrorCode } from '../../shared/ipc'

/**
 * The full-window help screen shown when Seam cannot find Git or the installed
 * one is older than the version the application relies on. It explains what is
 * missing, offers the official download page, and lets the user check again
 * after installing without closing the window.
 */
export default function GitRequired({
  code,
  message,
  checking,
  onRetry
}: {
  /** The reason, or null while the first check is still running. */
  readonly code: IpcErrorCode | null
  readonly message: string
  readonly checking: boolean
  readonly onRetry: () => void
}) {
  const { t } = useTranslation()
  const tooOld = code === 'git-too-old'

  return (
    <main className="git-gate" data-testid="git-gate">
      <section className="git-gate__card">
        <div className="git-gate__mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        {code === null ? (
          <h1 className="git-gate__title">{t('gitGate.checking')}</h1>
        ) : (
          <>
            <h1 className="git-gate__title">
              {t(tooOld ? 'gitGate.tooOldTitle' : 'gitGate.missingTitle')}
            </h1>
            <p className="git-gate__body">
              {t(tooOld ? 'gitGate.tooOldBody' : 'gitGate.missingBody')}
            </p>
            <p className="git-gate__detail" data-testid="git-gate-detail">
              {message}
            </p>
            <div className="git-gate__actions">
              <button
                type="button"
                className="git-gate__primary"
                onClick={() => void window.seam.openExternal('https://git-scm.com/downloads')}
              >
                {t('gitGate.download')}
              </button>
              <button
                type="button"
                className="git-gate__secondary"
                onClick={onRetry}
                disabled={checking}
              >
                {checking ? t('gitGate.checking') : t('gitGate.retry')}
              </button>
            </div>
            <p className="git-gate__hint">{t('gitGate.reopenHint')}</p>
          </>
        )}
      </section>
    </main>
  )
}
