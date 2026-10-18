// SPDX-License-Identifier: MIT

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** The stored preferences, with the value a fresh install starts from. */
interface StoredSettings {
  /**
   * Whether the `pre-commit` and `commit-msg` hooks run. They run by default,
   * as they do in a terminal, and turning them off adds `--no-verify`.
   */
  runHooks: boolean
  /**
   * Whether the CRLF warning appears before a commit. It comes on by default,
   * like the reference client's, and a repository can have its own answer.
   */
  crlfWarning: boolean
  /** The answer given in a repository, keyed by its path; wins over the default. */
  crlfWarningRepos: Record<string, boolean>
}

const DEFAULTS: StoredSettings = { runHooks: true, crlfWarning: true, crlfWarningRepos: {} }

/** Narrows what a settings file holds to the per-repository answers in it. */
function parseRepos(value: unknown): Record<string, boolean> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean'
    )
  )
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
