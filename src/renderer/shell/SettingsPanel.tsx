// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '../i18n'
import { SETTINGS_CHANGED } from '../settings-events'
import type {
  HighlightPreference,
  SettingsData,
  SettingsPatch,
  SyntaxThemePreference,
  ThemePreference,
  WhitespacePreference
} from '../../shared/ipc'

interface SettingsPanelProps {
  readonly isOpen: boolean
  readonly onClose: () => void
}

const WHITESPACE_OPTIONS: readonly [WhitespacePreference, string][] = [
  ['none', 'settings.whitespaceNone'],
  ['trim', 'settings.whitespaceTrim'],
  ['ignore', 'settings.whitespaceIgnore'],
  ['ignore-and-blank', 'settings.whitespaceIgnoreBlank']
]

const HIGHLIGHT_OPTIONS: readonly [HighlightPreference, string][] = [
  ['words', 'settings.highlightWords'],
  ['lines', 'settings.highlightLines'],
  ['split', 'settings.highlightSplit'],
  ['characters', 'settings.highlightChars'],
  ['none', 'settings.highlightNone']
]

const SYNTAX_OPTIONS: readonly [SyntaxThemePreference, string][] = [
  ['seam', 'settings.syntaxSeam'],
  ['github', 'settings.syntaxGithub'],
  ['vivid', 'settings.syntaxVivid']
]

export default function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const { t, i18n } = useTranslation()
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [theme, setTheme] = useState<ThemePreference>('dark')
  const [language, setLanguage] = useState<string>('')

  useEffect(() => {
    if (!isOpen) return
    let active = true
    void window.seam.readSettings().then((result) => {
      if (!active) return
      if (result.ok) {
        setSettings(result.value)
        setTheme(result.value.theme)
        setLanguage(result.value.language ?? '')
      }
    })
    return () => {
      active = false
    }
  }, [isOpen])

  const changeSetting = useCallback(
    async (patch: SettingsPatch) => {
      if (settings === null) return
      const result = await window.seam.writeSettings(patch)
      if (result.ok) {
        setSettings({ ...settings, ...patch })
        window.dispatchEvent(new Event(SETTINGS_CHANGED))
      }
    },
    [settings]
  )

  const changeTheme = useCallback(
    (next: ThemePreference) => {
      setTheme(next)
      changeSetting({ theme: next })
      document.documentElement.style.setProperty('color-scheme', next)
      document.documentElement.setAttribute('data-theme', next)
    },
    [changeSetting]
  )

  const changeLanguage = useCallback(
    (next: string) => {
      setLanguage(next)
      changeSetting({ language: next === '' ? null : next })
      if (next === '') {
        i18n.changeLanguage(i18n.resolvedLanguage)
      } else {
        i18n.changeLanguage(next)
      }
    },
    [changeSetting, i18n]
  )

  if (!isOpen) return null

  return (
    <div className="dialog dialog--stacked" data-testid="settings-dialog">
      <div
        className="dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <h2 id="settings-title" className="dialog__title">
          {t('settings.title')}
        </h2>

        <div className="dialog__label">{t('settings.language')}</div>
        <select
          className="dialog__input"
          value={language}
          onChange={(e) => changeLanguage(e.target.value)}
        >
          <option value="">{t('settings.languageAuto')}</option>
          {SUPPORTED_LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {t(`language.names.${code}`)}
            </option>
          ))}
        </select>

        <div className="dialog__label">{t('settings.theme')}</div>
        <div className="diff__layout" role="group" aria-label={t('settings.theme')}>
          <button
            type="button"
            className={`diff__layout-button${theme === 'dark' ? ' is-active' : ''}`}
            aria-pressed={theme === 'dark'}
            onClick={() => changeTheme('dark')}
          >
            {t('settings.themeDark')}
          </button>
          <button
            type="button"
            className={`diff__layout-button${theme === 'light' ? ' is-active' : ''}`}
            aria-pressed={theme === 'light'}
            onClick={() => changeTheme('light')}
          >
            {t('settings.themeLight')}
          </button>
        </div>

        <div className="dialog__label">{t('settings.syntaxTheme')}</div>
        <select
          className="dialog__input"
          value={settings?.syntaxTheme ?? 'seam'}
          onChange={(e) => changeSetting({ syntaxTheme: e.target.value as SyntaxThemePreference })}
        >
          {SYNTAX_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </select>

        <div className="dialog__label">{t('settings.whitespace')}</div>
        <select
          className="dialog__input"
          value={settings?.whitespace ?? 'none'}
          onChange={(e) => changeSetting({ whitespace: e.target.value as WhitespacePreference })}
        >
          {WHITESPACE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </select>

        <div className="dialog__label">{t('settings.highlight')}</div>
        <select
          className="dialog__input"
          value={settings?.highlight ?? 'words'}
          onChange={(e) => changeSetting({ highlight: e.target.value as HighlightPreference })}
        >
          {HIGHLIGHT_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </select>

        <label className="diff__control diff__control--check" title={t('settings.hooksHint')}>
          <input
            className="diff__check-input"
            type="checkbox"
            checked={settings?.runHooks ?? true}
            onChange={(e) => changeSetting({ runHooks: e.target.checked })}
          />
          <span className="diff__check-box" aria-hidden="true">
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M1.5 5.2 4 7.5l4.5-5" />
            </svg>
          </span>
          <span>{t('settings.hooks')}</span>
        </label>

        <label className="diff__control diff__control--check" title={t('settings.signoffHint')}>
          <input
            className="diff__check-input"
            type="checkbox"
            checked={settings?.signoff ?? false}
            onChange={(e) => changeSetting({ signoff: e.target.checked })}
          />
          <span className="diff__check-box" aria-hidden="true">
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M1.5 5.2 4 7.5l4.5-5" />
            </svg>
          </span>
          <span>{t('settings.signoff')}</span>
        </label>

        <label className="diff__control diff__control--check" title={t('settings.collapse')}>
          <input
            className="diff__check-input"
            type="checkbox"
            checked={settings?.collapse ?? false}
            onChange={(e) => changeSetting({ collapse: e.target.checked })}
          />
          <span className="diff__check-box" aria-hidden="true">
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M1.5 5.2 4 7.5l4.5-5" />
            </svg>
          </span>
          <span>{t('settings.collapse')}</span>
        </label>

        <div className="dialog__actions">
          <button type="button" className="dialog__button" onClick={onClose}>
            {t('identity.cancel')}
          </button>
          <button type="button" className="dialog__button button" onClick={onClose}>
            {t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
