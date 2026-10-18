// SPDX-License-Identifier: MIT

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Remembers the commit message the user typed but did not confirm, one per
 * repository, in a small JSON file under the application data folder. The draft
 * outlives the window, so closing Seam does not throw the message away. It takes
 * the file path rather than reading it from Electron so it can be tested on its
 * own, the same way the recent repositories list is.
 */
export class CommitDrafts {
  private drafts: Record<string, string>

  constructor(private readonly file: string) {
    this.drafts = this.load()
  }

  /** The draft kept for a repository, or an empty string when there is none. */
  read(repo: string): string {
    return this.drafts[repo] ?? ''
  }

  /** Stores a draft. An empty message forgets the repository's entry. */
  write(repo: string, message: string): void {
    if (message === '') {
      delete this.drafts[repo]
    } else {
      this.drafts[repo] = message
    }
    this.save()
  }

  private load(): Record<string, string> {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      const entries = Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
      return Object.fromEntries(entries)
    } catch {
      // First run, or a file that is not readable JSON: start from empty.
      return {}
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, `${JSON.stringify(this.drafts, null, 2)}\n`, 'utf8')
  }
}
