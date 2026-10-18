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
}

const DEFAULTS: StoredSettings = { runHooks: true }

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

  private load(): StoredSettings {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
        return { ...DEFAULTS }
      const stored = parsed as Record<string, unknown>
      return {
        runHooks: typeof stored['runHooks'] === 'boolean' ? stored['runHooks'] : DEFAULTS.runHooks
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
