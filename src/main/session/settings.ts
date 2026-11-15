// SPDX-License-Identifier: MIT

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  DEFAULT_HISTORY_WIDTH,
  GRAPH_PALETTES,
  MAX_HISTORY_WIDTH,
  MIN_HISTORY_WIDTH,
  type BranchOrderPreference,
  type GraphPalettePreference,
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
  /** The colours the commit graph cycles through for its lanes. */
  graphPalette: GraphPalettePreference
  /** The direction the branch menu lists folders and branches in. */
  branchOrder: BranchOrderPreference
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
const DEFAULT_GRAPH_PALETTE: GraphPalettePreference = 'classic'
const DEFAULT_BRANCH_ORDER: BranchOrderPreference = 'ascending'

const DEFAULTS: StoredSettings = {
  runHooks: true,
  language: null,
  theme: DEFAULT_THEME,
  whitespace: DEFAULT_WHITESPACE,
  highlight: DEFAULT_HIGHLIGHT,
  syntaxTheme: DEFAULT_SYNTAX_THEME,
  graphPalette: DEFAULT_GRAPH_PALETTE,
  branchOrder: DEFAULT_BRANCH_ORDER,
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

function parseGraphPalette(value: unknown): GraphPalettePreference {
  return GRAPH_PALETTES.includes(value as GraphPalettePreference)
    ? (value as GraphPalettePreference)
    : DEFAULT_GRAPH_PALETTE
}

function parseBranchOrder(value: unknown): BranchOrderPreference {
  return value === 'ascending' || value === 'descending' ? value : DEFAULT_BRANCH_ORDER
}

/**
 * Narrows an IPC payload to a change of the stored preferences. Every field is
 * checked here, so a renderer cannot store a value the interface would not
 * understand; a field it does not know is ignored, not an error.
 */
export function parseSettingsPatch(value: unknown): SettingsPatch | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const patch: SettingsPatch = {}
  if ('runHooks' in raw) {
    if (typeof raw['runHooks'] !== 'boolean') return null
    patch.runHooks = raw['runHooks']
  }
  if ('language' in raw) {
    if (raw['language'] !== null && typeof raw['language'] !== 'string') return null
    patch.language = raw['language']
  }
  if ('theme' in raw) {
    if (raw['theme'] !== 'dark' && raw['theme'] !== 'light') return null
    patch.theme = raw['theme']
  }
  if ('whitespace' in raw) {
    const whitespace = raw['whitespace']
    if (
      whitespace !== 'none' &&
      whitespace !== 'trim' &&
      whitespace !== 'ignore' &&
      whitespace !== 'ignore-and-blank'
    ) {
      return null
    }
    patch.whitespace = whitespace
  }
  if ('highlight' in raw) {
    const highlight = raw['highlight']
    if (
      highlight !== 'words' &&
      highlight !== 'lines' &&
      highlight !== 'split' &&
      highlight !== 'characters' &&
      highlight !== 'none'
    ) {
      return null
    }
    patch.highlight = highlight
  }
  if ('syntaxTheme' in raw) {
    const syntaxTheme = raw['syntaxTheme']
    if (syntaxTheme !== 'seam' && syntaxTheme !== 'github' && syntaxTheme !== 'vivid') return null
    patch.syntaxTheme = syntaxTheme
  }
  if ('graphPalette' in raw) {
    const graphPalette = raw['graphPalette']
    if (!GRAPH_PALETTES.includes(graphPalette as GraphPalettePreference)) return null
    patch.graphPalette = graphPalette as GraphPalettePreference
  }
  if ('branchOrder' in raw) {
    const branchOrder = raw['branchOrder']
    if (branchOrder !== 'ascending' && branchOrder !== 'descending') return null
    patch.branchOrder = branchOrder
  }
  if ('collapse' in raw) {
    if (typeof raw['collapse'] !== 'boolean') return null
    patch.collapse = raw['collapse']
  }
  if ('signoff' in raw) {
    if (typeof raw['signoff'] !== 'boolean') return null
    patch.signoff = raw['signoff']
  }
  if ('historyWidth' in raw) {
    const historyWidth = raw['historyWidth']
    if (typeof historyWidth !== 'number' || !Number.isFinite(historyWidth)) return null
    patch.historyWidth = historyWidth
  }
  return patch
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
      graphPalette: this.value.graphPalette,
      branchOrder: this.value.branchOrder,
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
    if (patch.graphPalette !== undefined) this.value.graphPalette = patch.graphPalette
    if (patch.branchOrder !== undefined)
      this.value.branchOrder = parseBranchOrder(patch.branchOrder)
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
        graphPalette: parseGraphPalette(stored['graphPalette']),
        branchOrder: parseBranchOrder(stored['branchOrder']),
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
