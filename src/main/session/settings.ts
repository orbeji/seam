// SPDX-License-Identifier: MIT

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  DEFAULT_HISTORY_WIDTH,
  MAX_HISTORY_WIDTH,
  MIN_HISTORY_WIDTH,
  type HighlightPreference,
  type SettingsData,
  type SettingsPatch,
  type SyntaxThemePreference,
  type ThemePreference,
  type WhitespacePreference
} from '../../shared/ipc'

/** The stored preferences, with the value a fresh install starts from. */
interface StoredSettings {
  /** Whether Git's `pre-commit` and `commit-msg` hooks run. */
  runHooks: boolean
  /** The interface language, or null to follow the system. */
  language: string | null
  /** The colour scheme the window and the editors use. */
  theme: ThemePreference
  /** How the viewer compares whitespace by default. */
  whitespace: WhitespacePreference
  /** How finely the viewer highlights changes by default. */
  highlight: HighlightPreference
  /** The syntax colours the code viewers use in the light colour scheme. */
  syntaxTheme: SyntaxThemePreference
  /** Whether unchanged lines are folded in the viewer by default. */
  collapse: boolean
  /** Whether commits include the `Signed-off-by` trailer by default. */
  signoff: boolean
  /** The width of the history panel, in pixels. */
  historyWidth: number
  /**
   * Whether the CRLF warning appears before a commit. It comes on by default,
   * like the reference client's, and a repository can have its own answer.
   */
  crlfWarning: boolean
  /** The answer given in a repository, keyed by its path; wins over the default. */
  crlfWarningRepos: Record<string, boolean>
}

const DEFAULT_THEME: ThemePreference = 'dark'
const DEFAULT_WHITESPACE: WhitespacePreference = 'none'
const DEFAULT_HIGHLIGHT: HighlightPreference = 'words'
const DEFAULT_SYNTAX_THEME: SyntaxThemePreference = 'seam'

const DEFAULTS: StoredSettings = {
  runHooks: true,
  language: null,
  theme: DEFAULT_THEME,
  whitespace: DEFAULT_WHITESPACE,
  highlight: DEFAULT_HIGHLIGHT,
  syntaxTheme: DEFAULT_SYNTAX_THEME,
  collapse: false,
  signoff: false,
  crlfWarning: true,
  crlfWarningRepos: {},
  historyWidth: DEFAULT_HISTORY_WIDTH
}

/** Narrows what a settings file holds to the per-repository answers in it. */
function parseRepos(value: unknown): Record<string, boolean> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean'
    )
  )
}

function parseTheme(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : DEFAULT_THEME
}

function parseWhitespace(value: unknown): WhitespacePreference {
  return value === 'none' || value === 'trim' || value === 'ignore' || value === 'ignore-and-blank'
    ? value
    : DEFAULT_WHITESPACE
}

function parseHighlight(value: unknown): HighlightPreference {
  return value === 'words' ||
    value === 'lines' ||
    value === 'split' ||
    value === 'characters' ||
    value === 'none'
    ? value
    : DEFAULT_HIGHLIGHT
}

function parseSyntaxTheme(value: unknown): SyntaxThemePreference {
  return value === 'seam' || value === 'github' || value === 'vivid' ? value : DEFAULT_SYNTAX_THEME
}

/** Keeps a stored or patched panel width inside the limits the interface draws. */
function parseHistoryWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_HISTORY_WIDTH
  return Math.min(Math.max(Math.round(value), MIN_HISTORY_WIDTH), MAX_HISTORY_WIDTH)
}

/**
 * The preferences that outlive a window, kept in a small JSON file under the
 * application data folder. Every field has a default, so a missing, empty or
 * corrupt file simply means a fresh install.
 */
export class Settings {
  private value: StoredSettings

  constructor(private readonly file: string) {
    this.value = this.load()
  }

  /** Every preference as the interface reads it. */
  read(): SettingsData {
    return {
      runHooks: this.value.runHooks,
      language: this.value.language,
      theme: this.value.theme,
      whitespace: this.value.whitespace,
      highlight: this.value.highlight,
      syntaxTheme: this.value.syntaxTheme,
      collapse: this.value.collapse,
      signoff: this.value.signoff,
      historyWidth: this.value.historyWidth
    }
  }

  /** Stores the preferences a caller changed, leaving the rest where they are. */
  update(patch: SettingsPatch): void {
    if (patch.runHooks !== undefined) this.value.runHooks = patch.runHooks
    if (patch.language !== undefined) this.value.language = patch.language
    if (patch.theme !== undefined) this.value.theme = patch.theme
    if (patch.whitespace !== undefined) this.value.whitespace = patch.whitespace
    if (patch.highlight !== undefined) this.value.highlight = patch.highlight
    if (patch.syntaxTheme !== undefined) this.value.syntaxTheme = patch.syntaxTheme
    if (patch.collapse !== undefined) this.value.collapse = patch.collapse
    if (patch.signoff !== undefined) this.value.signoff = patch.signoff
    if (patch.historyWidth !== undefined)
      this.value.historyWidth = parseHistoryWidth(patch.historyWidth)
    this.save()
  }

  /** Whether Git's commit hooks run. */
  get runHooks(): boolean {
    return this.value.runHooks
  }

  /** Remembers whether Git's commit hooks run. */
  setRunHooks(runHooks: boolean): void {
    this.value.runHooks = runHooks
    this.save()
  }

  /** Whether the CRLF warning shows in a repository; its own answer wins. */
  crlfWarningFor(repo: string): boolean {
    return this.value.crlfWarningRepos[repo] ?? this.value.crlfWarning
  }

  /** Turns the CRLF warning on or off for every repository without an answer. */
  setCrlfWarning(crlfWarning: boolean): void {
    this.value.crlfWarning = crlfWarning
    this.save()
  }

  /** Turns the CRLF warning on or off in one repository, wherever the rest stand. */
  setCrlfWarningFor(repo: string, enabled: boolean): void {
    this.value.crlfWarningRepos = { ...this.value.crlfWarningRepos, [repo]: enabled }
    this.save()
  }

  private load(): StoredSettings {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
        return { ...DEFAULTS }
      const stored = parsed as Record<string, unknown>
      return {
        runHooks: typeof stored['runHooks'] === 'boolean' ? stored['runHooks'] : DEFAULTS.runHooks,
        language: typeof stored['language'] === 'string' ? stored['language'] : DEFAULTS.language,
        theme: parseTheme(stored['theme']),
        whitespace: parseWhitespace(stored['whitespace']),
        highlight: parseHighlight(stored['highlight']),
        syntaxTheme: parseSyntaxTheme(stored['syntaxTheme']),
        collapse: typeof stored['collapse'] === 'boolean' ? stored['collapse'] : DEFAULTS.collapse,
        signoff: typeof stored['signoff'] === 'boolean' ? stored['signoff'] : DEFAULTS.signoff,
        historyWidth: parseHistoryWidth(stored['historyWidth']),
        crlfWarning:
          typeof stored['crlfWarning'] === 'boolean' ? stored['crlfWarning'] : DEFAULTS.crlfWarning,
        crlfWarningRepos: parseRepos(stored['crlfWarningRepos'])
      }
    } catch {
      // First run, or a file that is not readable JSON: start from the defaults.
      return { ...DEFAULTS }
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, `${JSON.stringify(this.value, null, 2)}\n`, 'utf8')
  }
}
