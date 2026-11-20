// SPDX-License-Identifier: MIT

/**
 * How long a fetch counts as recent. The Pull badge reads the commits behind
 * the upstream, which only a fetch can update, so Seam fetches on its own; this
 * interval keeps switching windows from hammering the remote.
 */
export const AUTO_FETCH_INTERVAL_MS = 5 * 60 * 1000

/** The last fetch Seam ran or saw, and the repository it belonged to. */
export interface LastFetch {
  readonly repo: string
  /** When the fetch started, in milliseconds since the epoch. */
  readonly at: number
}

/**
 * Whether the open repository should be fetched without being asked. A
 * repository that has just been opened has no fetch on record, so it is due at
 * once; after that, only once the interval since the last one has passed.
 */
export function autoFetchDue(last: LastFetch | null, repo: string, now: number): boolean {
  if (last === null || last.repo !== repo) return true
  return now - last.at >= AUTO_FETCH_INTERVAL_MS
}
