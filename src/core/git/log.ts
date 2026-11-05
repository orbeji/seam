// SPDX-License-Identifier: MIT

import type { HistoryCommit, HistoryRef, HistoryRefKind, RepositoryHistory } from '../../shared/git'
import type { GitRunner } from './runner'

/**
 * How many commits the history view reads at once. A repository can hold
 * hundreds of thousands of commits, and the view is a browsing aid rather than
 * a pager, so it keeps a generous window around the newest history. The result
 * says when Git held more.
 */
export const HISTORY_LIMIT = 1000

/** One record per commit: fields separated by NUL, records by a newline. */
const HISTORY_FORMAT = '%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%s'

/** One line per ref: the object, its full name and, for a tag, the peeled target. */
const REF_FORMAT = '%(objectname)%00%(refname)%00%(*objectname)'

const HEADS_PREFIX = 'refs/heads/'
const REMOTES_PREFIX = 'refs/remotes/'
const TAGS_PREFIX = 'refs/tags/'

const REF_ORDER: Record<HistoryRefKind, number> = {
  tag: 0,
  head: 1,
  branch: 2,
  remote: 3
}

/**
 * Parses `git log` output written with {@link HISTORY_FORMAT}. The subject is a
 * single line (Git's `%s`), so a record never spans more than one line even
 * when the commit body is long.
 */
export function parseHistoryLog(output: string): HistoryCommit[] {
  const commits: HistoryCommit[] = []
  for (const line of output.split(/\r?\n/)) {
    if (line === '') continue
    const [
      oid = '',
      shortId = '',
      parents = '',
      authorName = '',
      authorEmail = '',
      authorDate = '',
      subject = ''
    ] = line.split('\0')
    if (oid === '') continue
    commits.push({
      oid,
      shortId,
      parents: parents === '' ? [] : parents.split(' '),
      authorName,
      authorEmail,
      authorDate,
      subject: subject.replace(/\r$/, ''),
      refs: []
    })
  }
  return commits
}

/** Where one ref points and how the history view labels it. */
function describeRef(
  refname: string,
  head: string | null
): { readonly name: string; readonly kind: HistoryRefKind } | null {
  if (refname.startsWith(HEADS_PREFIX)) {
    const name = refname.slice(HEADS_PREFIX.length)
    if (name === '') return null
    return { name, kind: name === head ? 'head' : 'branch' }
  }
  if (refname.startsWith(REMOTES_PREFIX)) {
    const name = refname.slice(REMOTES_PREFIX.length)
    // A remote's symbolic HEAD repeats the commit of its default branch.
    if (name === '' || name.endsWith('/HEAD')) return null
    return { name, kind: 'remote' }
  }
  if (refname.startsWith(TAGS_PREFIX)) {
    const name = refname.slice(TAGS_PREFIX.length)
    if (name === '') return null
    return { name, kind: 'tag' }
  }
  return null
}

/**
 * Folds a remote-tracking ref into the local branch it mirrors when both point
 * at the same commit. Git keeps `develop` and `origin/develop` as two refs even
 * when they are in sync, but showing both pills on one row is noise: the local
 * one stays and carries the remote name in `remotes` for the tooltip.
 */
function collapseSyncedRemotes(refs: readonly HistoryRef[]): HistoryRef[] {
  const locals = new Set<string>()
  for (const ref of refs) {
    if (ref.kind === 'branch' || ref.kind === 'head') locals.add(ref.name)
  }
  if (locals.size === 0) return [...refs]

  // The part after the remote's name is the branch it tracks: `origin/feature/x`
  // mirrors the local branch `feature/x`.
  const localOf = (ref: HistoryRef): string | null => {
    const slash = ref.name.indexOf('/')
    return slash === -1 ? null : ref.name.slice(slash + 1)
  }

  const syncedByLocal = new Map<string, string[]>()
  for (const ref of refs) {
    if (ref.kind !== 'remote') continue
    const local = localOf(ref)
    if (local === null || !locals.has(local)) continue
    const names = syncedByLocal.get(local)
    if (names === undefined) syncedByLocal.set(local, [ref.name])
    else names.push(ref.name)
  }

  const kept: HistoryRef[] = []
  for (const ref of refs) {
    if (ref.kind === 'remote') {
      const local = localOf(ref)
      if (local !== null && locals.has(local)) continue
      kept.push(ref)
      continue
    }
    const synced =
      ref.kind === 'branch' || ref.kind === 'head' ? syncedByLocal.get(ref.name) : undefined
    kept.push(synced === undefined ? ref : { ...ref, remotes: synced })
  }
  return kept
}

/**
 * Parses `git for-each-ref` output written with {@link REF_FORMAT} into the
 * refs of each commit. An annotated tag names a tag object; its peeled target
 * is the commit the history actually contains, so that is the one used.
 */
export function parseHistoryRefs(output: string, head: string | null): Map<string, HistoryRef[]> {
  const byCommit = new Map<string, HistoryRef[]>()
  for (const line of output.split(/\r?\n/)) {
    if (line === '') continue
    const [objectname = '', refname = '', peeled = ''] = line.split('\0')
    const oid = peeled !== '' ? peeled : objectname
    if (oid === '') continue
    const ref = describeRef(refname, head)
    if (ref === null) continue

    const refs = byCommit.get(oid)
    if (refs === undefined) byCommit.set(oid, [{ ...ref }])
    else refs.push({ ...ref })
  }

  for (const [oid, refs] of byCommit) {
    refs.sort((left, right) => REF_ORDER[left.kind] - REF_ORDER[right.kind])
    byCommit.set(oid, collapseSyncedRemotes(refs))
  }
  return byCommit
}

/**
 * Reads the commit graph: the newest commits of every local and remote branch
 * and every tag, newest first, with the refs that point at each one.
 *
 * A repository with no commits yet is not an error: there is simply nothing to
 * draw. Every call is read-only, so opening the history never takes the index
 * lock or changes a ref.
 */
export async function readRepositoryHistory(
  runner: GitRunner,
  repo: string,
  limit: number = HISTORY_LIMIT
): Promise<RepositoryHistory> {
  const [headResult, refsResult, tipResult] = await Promise.all([
    runner.run(['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      cwd: repo,
      readOnly: true
    }),
    runner.run(
      ['for-each-ref', `--format=${REF_FORMAT}`, HEADS_PREFIX, REMOTES_PREFIX, TAGS_PREFIX],
      { cwd: repo, readOnly: true }
    ),
    runner.run(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], {
      cwd: repo,
      readOnly: true
    })
  ])

  const head = headResult.code === 0 ? headResult.stdout.toString('utf8').trim() || null : null
  const refs = parseHistoryRefs(refsResult.stdout.toString('utf8'), head)
  const headOid = tipResult.code === 0 ? tipResult.stdout.toString('utf8').trim() || null : null
  const hasTip = headOid !== null

  // `--all` would also follow stashes and notes; the view follows the branches
  // and tags it can label, plus a detached HEAD when there is one.
  const args = [
    'log',
    '--topo-order',
    `--format=${HISTORY_FORMAT}`,
    '--max-count',
    String(limit + 1),
    '--branches',
    '--remotes',
    '--tags'
  ]
  if (hasTip) args.push('HEAD')

  const result = await runner.run(args, { cwd: repo, readOnly: true })
  // An empty repository exits non-zero with no output; there is nothing to show
  // and no error worth interrupting the window for.
  if (result.code !== 0) return { commits: [], truncated: false, head, headOid }

  const parsed = parseHistoryLog(result.stdout.toString('utf8'))
  const truncated = parsed.length > limit
  const commits = parsed.slice(0, limit).map((commit) => ({
    ...commit,
    refs: refs.get(commit.oid) ?? []
  }))

  return { commits, truncated, head, headOid }
}
