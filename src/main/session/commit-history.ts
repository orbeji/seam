// SPDX-License-Identifier: MIT

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** How many messages a repository keeps, newest first. */
const HISTORY_LIMIT = 20

/**
 * The last messages committed from Seam, newest first, kept per repository in a
 * small JSON file under the application data folder. Only Seam's own commits are
 * written here, as the phase asks; the box offers them again by a button.
 */
export class CommitHistory {
  private entries: Record<string, string[]>

  constructor(private readonly file: string) {
    this.entries = this.load()
  }

  /** The remembered messages for a repository, newest first. */
  read(repo: string): string[] {
    return [...(this.entries[repo] ?? [])]
  }

  /** Remembers a message, newest first, without duplicates and capped. */
  remember(repo: string, message: string): void {
    if (message.trim() === '') return
    const previous = this.entries[repo] ?? []
    this.entries[repo] = [message, ...previous.filter((entry) => entry !== message)].slice(
      0,
      HISTORY_LIMIT
    )
    this.save()
  }

  private load(): Record<string, string[]> {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}

      const entries: Record<string, string[]> = {}
      for (const [repo, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
          entries[repo] = value.slice(0, HISTORY_LIMIT)
        }
      }
      return entries
    } catch {
      // First run, or a file that is not readable JSON: start from nothing.
      return {}
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, `${JSON.stringify(this.entries, null, 2)}\n`, 'utf8')
  }
}
