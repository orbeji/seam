// SPDX-License-Identifier: MIT

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** How many repositories to keep in the list. */
const LIMIT = 10

/**
 * Remembers the repositories the user opened, most recent first, in a small
 * JSON file under the application data folder. It takes the file path rather
 * than reading it from Electron so it can be tested on its own.
 */
export class RecentRepositories {
  private paths: string[]

  constructor(private readonly file: string) {
    this.paths = this.load()
  }

  list(): string[] {
    return [...this.paths]
  }

  remember(repo: string): void {
    this.paths = [repo, ...this.paths.filter((entry) => entry !== repo)].slice(0, LIMIT)
    this.save()
  }

  private load(): string[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      if (!Array.isArray(parsed)) return []
      return parsed.filter((entry): entry is string => typeof entry === 'string')
    } catch {
      // First run, or a file that is not readable JSON: start from empty.
      return []
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, `${JSON.stringify(this.paths, null, 2)}\n`, 'utf8')
  }
}
