// SPDX-License-Identifier: MIT

import { existsSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

/** How long to wait after the last event before reporting a change. */
export const WATCH_DEBOUNCE_MS = 150

/**
 * Loose reference folders, watched so a branch or tag update refreshes the
 * header. The empty name is the `refs` folder itself, for `refs/stash` and the
 * like. They are only used when the platform cannot watch `refs` recursively.
 */
const REF_FOLDERS = ['', 'heads', 'remotes', 'tags'] as const

export interface GitWatcherOptions {
  /** Milliseconds to wait after the last event before reporting a change. */
  debounceMs?: number
}

/**
 * Watches the files Git touches inside a repository's git folder and reports a
 * single change per burst of activity. The working tree is deliberately not
 * watched: it can be huge, and the interface refreshes it when the window
 * regains focus instead.
 *
 * The set is the one the phase 3 chapter lists: `index`, `HEAD`, the loose
 * references and Git's operation markers. `index` is what `git add` rewrites,
 * so an external stage shows up here without any polling.
 */
export class GitWatcher {
  private readonly watchers: FSWatcher[] = []
  private readonly debounceMs: number
  private readonly onChange: () => void
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(gitDir: string, onChange: () => void, options: GitWatcherOptions = {}) {
    this.onChange = onChange
    this.debounceMs = options.debounceMs ?? WATCH_DEBOUNCE_MS

    // One non-recursive watch covers `index`, `HEAD`, `packed-refs` and the
    // operation markers, which all sit directly in the git folder.
    this.watchFolder(gitDir)

    // Loose references live under `refs`. Watching it recursively catches
    // branch names with a slash, but recursion is not available on every
    // platform, so the usual subfolders are watched as a fallback.
    const refs = join(gitDir, 'refs')
    if (!this.watchFolder(refs, true)) {
      for (const folder of REF_FOLDERS) {
        this.watchFolder(folder === '' ? refs : join(refs, folder))
      }
    }
  }

  /** Stops watching. A closed watcher never reports another change. */
  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    for (const watcher of this.watchers) watcher.close()
    this.watchers.length = 0
  }

  /** Watches a folder, returning whether a watcher could be set up. */
  private watchFolder(path: string, recursive = false): boolean {
    if (this.closed || !existsSync(path)) return false

    let watcher: FSWatcher
    try {
      watcher = watch(path, { persistent: false, recursive }, () => this.schedule())
    } catch {
      // Recursive watching is not supported on every platform; the caller
      // falls back to the flat list of reference folders.
      return false
    }

    // The folder can disappear while Seam is open; stop watching it quietly.
    watcher.on('error', () => this.drop(watcher))
    this.watchers.push(watcher)
    return true
  }

  private drop(watcher: FSWatcher): void {
    watcher.close()
    const index = this.watchers.indexOf(watcher)
    if (index !== -1) this.watchers.splice(index, 1)
  }

  /** Resets the debounce timer, so a burst of events reports once. */
  private schedule(): void {
    if (this.closed) return
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.closed) this.onChange()
    }, this.debounceMs)
  }
}
