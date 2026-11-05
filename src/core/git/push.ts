// SPDX-License-Identifier: MIT

import type {
  BranchStatus,
  PushCommit,
  PushOutcome,
  PushRef,
  PushRefFlag,
  PushRejection,
  PushRemote,
  PushState,
  PushTagMode,
  PushUpdateOutcome
} from '../../shared/git'
import { GitAbortError, GitError, GitTimeoutError } from './errors'
import { detectOperation } from './operation'
import type { GitRunner } from './runner'
import { readStatus } from './status'

/**
 * A push talks to a remote, so it can wait on a network that never answers.
 * Five minutes is the same room the commit hooks get; the interface also
 * offers to cancel, and the runner kills the process tree.
 */
export const PUSH_TIMEOUT_MS = 5 * 60 * 1000

/** The flags `git push --porcelain` puts at the start of a reference line. */
const REF_FLAGS: ReadonlySet<string> = new Set([' ', '*', '!', '=', '+', '-'])

/** The two branches the phase calls protected, where a force push asks for its name. */
const PROTECTED_BRANCHES: ReadonlySet<string> = new Set(['main', 'master'])

/** The options the push dialog passes to {@link push}. */
export interface PushOptions {
  readonly remote: string
  /** The local branch to send. */
  readonly branch: string
  /** The branch name on the remote, which may differ when no upstream exists. */
  readonly remoteBranch: string
  /** Adds `--set-upstream`, for a branch that does not track anything yet. */
  readonly setUpstream: boolean
  readonly tags: PushTagMode
  /**
   * The commit the remote branch must still point at. Present only for a force
   * push, which is always `--force-with-lease`; null or absent never forces.
   */
  readonly forceLeaseOid?: string | null
  /** Kills the push when the caller cancels it. */
  readonly signal?: AbortSignal
  /** Receives the live output as Git prints it. */
  readonly onProgress?: (text: string) => void
}

function combine(stdout: string, stderr: string): string {
  return [stdout.trimEnd(), stderr.trimEnd()].filter((part) => part !== '').join('\n')
}

/** Whether a summary's parenthesised reason is a refusal Seam recognises. */
function rejectionOf(
  flag: PushRefFlag,
  to: string,
  summary: string,
  reason: string | null
): PushRejection | null {
  if (flag !== '!') return null
  const text = `${summary} ${reason ?? ''}`.toLowerCase()

  if (to.startsWith('refs/tags/') && /already exists/.test(text)) return 'tag-exists'
  if (/fetch first|non-fast-forward|remote contains work/.test(text)) return 'non-fast-forward'
  if (/stale info/.test(text)) return 'stale-info'
  if (/remote rejected|hook declined|pre-receive|update hook|refusing to/.test(text)) {
    return 'remote-rejected'
  }
  return 'other'
}

/**
 * Parses the reference lines of `git push --porcelain`. Git prints one line per
 * reference, `<flag>\t<from>:<to>\t<summary>`, and the phase reads the flag
 * instead of the English sentence around it. Lines such as `To <url>`, `Done`
 * and `remote:` are not references and are skipped.
 */
export function parsePushOutput(output: string): PushRef[] {
  const refs: PushRef[] = []
  for (const line of output.split(/\r?\n/)) {
    if (line === '' || !line.includes('\t')) continue
    const flag = line[0] ?? ''
    if (!REF_FLAGS.has(flag)) continue

    const rest = line.slice(2)
    const tab = rest.indexOf('\t')
    if (tab === -1) continue
    const refspec = rest.slice(0, tab)
    const summary = rest.slice(tab + 1)
    const colon = refspec.indexOf(':')
    const from = colon === -1 ? refspec : refspec.slice(0, colon)
    const to = colon === -1 ? refspec : refspec.slice(colon + 1)
    if (from === '' || to === '') continue

    const parentheses = /\(([^)]*)\)\s*$/.exec(summary)
    const reason = parentheses === null ? null : (parentheses[1] ?? null)
    const parsed = flag as PushRefFlag

    refs.push({
      flag: parsed,
      from,
      to,
      summary,
      reason,
      rejection: rejectionOf(parsed, to, summary, reason),
      tag: to.startsWith('refs/tags/') || from.startsWith('refs/tags/')
    })
  }
  return refs
}

/**
 * Recognises a failure to authenticate from Git's own words. Seam never asks
 * for a password, so the dialog explains which credential helper or SSH agent
 * the user has to configure instead of printing a path or a secret.
 */
export function isAuthenticationFailure(output: string): boolean {
  return /authentication failed|could not read (username|password)|terminal prompts disabled|permission denied \(publickey\)|no supported authentication methods|askpass/i.test(
    output
  )
}

/** The configured remotes, one per name, with the URL a fetch would use. */
export async function readPushRemotes(runner: GitRunner, repo: string): Promise<PushRemote[]> {
  const result = await runner.run(['remote', '-v'], { cwd: repo, readOnly: true })
  if (result.code !== 0) return []

  const remotes = new Map<string, string>()
  for (const line of result.stdout.toString('utf8').split(/\r?\n/)) {
    const match = /^(\S+)\t(.*) \(fetch\)$/.exec(line)
    if (match === null) continue
    const [, name = '', url = ''] = match
    if (name !== '' && !remotes.has(name)) remotes.set(name, url)
  }
  return [...remotes].map(([name, url]) => ({ name, url }))
}

/**
 * Splits `origin/feature/x` into the remote and the branch. A remote name may
 * itself contain a slash, so the longest configured prefix wins.
 */
function splitUpstream(
  upstream: string,
  remotes: readonly PushRemote[]
): { remote: string; branch: string } | null {
  const candidates = remotes
    .filter((remote) => upstream.startsWith(`${remote.name}/`))
    .sort((left, right) => right.name.length - left.name.length)
  const match = candidates[0]
  if (match !== undefined) {
    return { remote: match.name, branch: upstream.slice(match.name.length + 1) }
  }

  const slash = upstream.indexOf('/')
  if (slash <= 0 || slash === upstream.length - 1) return null
  return { remote: upstream.slice(0, slash), branch: upstream.slice(slash + 1) }
}

/** The commit a remote-tracking ref points at, or null when it does not exist. */
async function readRemoteOid(
  runner: GitRunner,
  repo: string,
  remote: string,
  branch: string
): Promise<string | null> {
  const result = await runner.run(
    ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${branch}`],
    { cwd: repo, readOnly: true }
  )
  if (result.code !== 0) return null
  const oid = result.stdout.toString('utf8').trim()
  return oid === '' ? null : oid
}

/** Whether HEAD is already contained in a remote branch, so rebasing rewrites it. */
async function isPublished(runner: GitRunner, repo: string): Promise<boolean> {
  const result = await runner.run(['branch', '-r', '--contains', 'HEAD'], {
    cwd: repo,
    readOnly: true
  })
  return result.code === 0 && result.stdout.toString('utf8').trim() !== ''
}

/** One commit per line, NUL-separated fields, as `git log` prints it. */
function parseCommits(output: string): PushCommit[] {
  const commits: PushCommit[] = []
  for (const line of output.split(/\r?\n/)) {
    if (line === '') continue
    const [oid = '', shortId = '', subject = '', author = '', date = ''] = line.split('\0')
    if (oid === '') continue
    commits.push({ oid, shortId, subject, author, date })
  }
  return commits
}

const LOG_FORMAT = '%H%x00%h%x00%s%x00%an%x00%ar'

/**
 * The commits the push would send. With an upstream it is `@{u}..HEAD`; without
 * one, everything HEAD has that no remote branch holds, which is what a new
 * branch would carry.
 */
async function readPendingCommits(
  runner: GitRunner,
  repo: string,
  upstream: string | null,
  remoteOid: string | null
): Promise<PushCommit[]> {
  const ranges: string[][] = []
  if (upstream !== null) ranges.push([`${upstream}..HEAD`])
  else if (remoteOid !== null) ranges.push([`${remoteOid}..HEAD`])
  // The fallback repeats the range without an upstream, so a ref that was never
  // fetched still leaves a useful list instead of an empty dialog.
  ranges.push(['HEAD', '--not', '--remotes'])

  for (const range of ranges) {
    const result = await runner.run(['log', `--format=${LOG_FORMAT}`, ...range], {
      cwd: repo,
      readOnly: true
    })
    if (result.code === 0) return parseCommits(result.stdout.toString('utf8'))
  }
  return []
}

/**
 * How many commits a push would send, for the top bar's count. A branch that
 * tracks an upstream already has the number in its status; a branch that
 * publishes itself counts what no remote branch holds, exactly as the dialog's
 * commit list does. A detached HEAD, or a repository with no commits, has none.
 */
export async function countPushCommits(
  runner: GitRunner,
  repo: string,
  branch: BranchStatus
): Promise<number> {
  if (branch.head === null) return 0
  if (branch.ahead !== undefined) return branch.ahead

  // A branch that publishes itself can only travel when a remote exists. Without
  // one, no push is possible even though every local commit is technically new.
  if (branch.upstream === undefined) {
    const remotes = await runner.run(['remote'], { cwd: repo, readOnly: true })
    if (remotes.code !== 0 || remotes.stdout.toString('utf8').trim() === '') return 0
  }

  const range =
    branch.upstream !== undefined ? [`${branch.upstream}..HEAD`] : ['HEAD', '--not', '--remotes']
  const result = await runner.run(['rev-list', '--count', ...range], {
    cwd: repo,
    readOnly: true
  })
  if (result.code !== 0) return 0
  const count = Number(result.stdout.toString('utf8').trim())
  return Number.isFinite(count) && count > 0 ? count : 0
}

/**
 * Everything the push dialog needs: the branch, its upstream, the remotes, the
 * commits that would travel and the remote commit the lease would use. Every
 * call is read-only, so opening the dialog never touches the index or a ref.
 */
export async function readPushState(runner: GitRunner, repo: string): Promise<PushState> {
  const status = await readStatus(runner, repo)
  const branch = status.branch.head
  const upstream = status.branch.upstream ?? null
  const remotes = await readPushRemotes(runner, repo)

  let remote: string | null = null
  let remoteBranch: string | null = null
  if (upstream !== null) {
    const split = splitUpstream(upstream, remotes)
    if (split !== null) {
      remote = split.remote
      remoteBranch = split.branch
    }
  } else if (branch !== null) {
    remote = remotes.find((entry) => entry.name === 'origin')?.name ?? remotes[0]?.name ?? null
    remoteBranch = branch
  }

  const remoteOid =
    remote !== null && remoteBranch !== null
      ? await readRemoteOid(runner, repo, remote, remoteBranch)
      : null
  const [published, commits] = await Promise.all([
    branch === null ? Promise.resolve(false) : isPublished(runner, repo),
    branch === null
      ? Promise.resolve<PushCommit[]>([])
      : readPendingCommits(runner, repo, upstream, remoteOid)
  ])

  return {
    branch,
    upstream,
    remote,
    remoteBranch,
    remoteOid,
    remotes,
    commits,
    detached: branch === null,
    published,
    protectedBranch: branch !== null && PROTECTED_BRANCHES.has(branch),
    hasUpstream: upstream !== null,
    remoteBranchExists: remoteOid !== null
  }
}

/** The flags for a push, in the order the phase's table lists them. */
function pushArgs(options: PushOptions): string[] {
  const args = ['push', '--porcelain']
  if (options.setUpstream) args.push('--set-upstream')
  if (options.tags === 'follow') args.push('--follow-tags')
  if (options.tags === 'all') args.push('--tags')
  if (options.forceLeaseOid !== undefined && options.forceLeaseOid !== null) {
    args.push(`--force-with-lease=refs/heads/${options.remoteBranch}:${options.forceLeaseOid}`)
  }
  args.push(options.remote, `refs/heads/${options.branch}:refs/heads/${options.remoteBranch}`)
  return args
}

function hasRefusal(refs: readonly PushRef[]): boolean {
  return refs.some((ref) => ref.rejection !== null)
}

/**
 * Runs `git push --porcelain` with the chosen options. The porcelain output is
 * parsed into one typed entry per reference, so the dialog never has to read
 * English. A non-zero exit is a normal outcome here: Git reports a rejected
 * branch that way, and the entries say which one and why.
 */
export async function push(
  runner: GitRunner,
  repo: string,
  options: PushOptions
): Promise<PushOutcome> {
  if (options.remote === '' || options.branch === '' || options.remoteBranch === '') {
    throw new GitError('A push needs a remote and a branch.')
  }

  const runOptions = {
    cwd: repo,
    timeoutMs: PUSH_TIMEOUT_MS,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onProgress === undefined
      ? {}
      : {
          onStdout: options.onProgress,
          onStderr: options.onProgress
        })
  }

  try {
    const result = await runner.run(pushArgs(options), runOptions)
    const stdout = result.stdout.toString('utf8')
    const output = combine(stdout, result.stderr)
    const refs = parsePushOutput(stdout)
    return {
      ok: result.code === 0,
      refs,
      authFailed: result.code !== 0 && !hasRefusal(refs) && isAuthenticationFailure(output),
      cancelled: false,
      timedOut: false,
      output
    }
  } catch (error) {
    if (error instanceof GitAbortError) {
      const output = combine(error.stdout, error.stderr)
      return {
        ok: false,
        refs: parsePushOutput(error.stdout),
        authFailed: false,
        cancelled: true,
        timedOut: false,
        output
      }
    }
    if (error instanceof GitTimeoutError) {
      const output = combine(error.stdout, error.stderr)
      return {
        ok: false,
        refs: parsePushOutput(error.stdout),
        authFailed: false,
        cancelled: false,
        timedOut: true,
        output
      }
    }
    throw error
  }
}

/** How the update integrates the fetched upstream: replaying or joining it. */
export type PushUpdateStrategy = 'rebase' | 'merge'

/**
 * Fetches and then integrates the upstream before a retry. A rebase is refused
 * when HEAD is already published, because it would rewrite a commit others may
 * have; a merge is always allowed.
 *
 * A conflict is not a failure to report as an error: Git leaves the operation
 * in progress, and the result says which one and how many files are unmerged,
 * so the phase 5 list can take over.
 */
export async function updateForPush(
  runner: GitRunner,
  repo: string,
  strategy: PushUpdateStrategy
): Promise<PushUpdateOutcome> {
  const status = await readStatus(runner, repo)
  if (status.branch.upstream === undefined) {
    throw new GitError('This branch has no upstream to update from.')
  }

  if (strategy === 'rebase' && (await isPublished(runner, repo))) {
    throw new GitError('A rebase would rewrite published commits; merge instead.')
  }

  const fetch = await runner.run(['fetch'], { cwd: repo, timeoutMs: PUSH_TIMEOUT_MS })
  const fetchOutput = combine(fetch.stdout.toString('utf8'), fetch.stderr)
  if (fetch.code !== 0) {
    return {
      ok: false,
      fetched: false,
      conflicts: 0,
      operation: await detectOperation(runner, repo),
      output: fetchOutput
    }
  }

  return integrateUpstream(runner, repo, strategy, fetchOutput)
}

/** Runs the chosen integration and reads what stopped. */
async function integrateUpstream(
  runner: GitRunner,
  repo: string,
  strategy: PushUpdateStrategy,
  fetchOutput: string
): Promise<PushUpdateOutcome> {
  const args = strategy === 'merge' ? ['merge', '--no-edit', '@{u}'] : ['rebase', '@{u}']
  const result = await runner.run(args, {
    cwd: repo,
    noEditor: true,
    timeoutMs: PUSH_TIMEOUT_MS,
    env: { GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' }
  })
  const [operation, after] = await Promise.all([
    detectOperation(runner, repo),
    readStatus(runner, repo)
  ])
  const conflicts = after.entries.filter((entry) => entry.kind === 'unmerged').length

  return {
    ok: result.code === 0 && operation === null && conflicts === 0,
    fetched: true,
    conflicts,
    operation,
    output: combine(fetchOutput, combine(result.stdout.toString('utf8'), result.stderr))
  }
}

/**
 * Runs `git fetch --all`, refreshing every configured remote's refs without
 * touching the local branches or the working tree. A thrown {@link GitCommandError}
 * is what the interface shows, so a network failure is an ordinary error.
 */
export async function fetchRemotes(runner: GitRunner, repo: string): Promise<void> {
  await runner.runOrThrow(['fetch', '--all'], { cwd: repo, timeoutMs: PUSH_TIMEOUT_MS })
}

/**
 * Fetches and integrates the branch's upstream, the way `git pull` would. A
 * rebase that would rewrite published history falls back to a merge instead of
 * refusing, so the pull button cannot dead-end; a conflict leaves the operation
 * in progress for the conflicts list to take over.
 */
export async function pull(
  runner: GitRunner,
  repo: string,
  strategy: PushUpdateStrategy
): Promise<PushUpdateOutcome> {
  const status = await readStatus(runner, repo)
  if (status.branch.upstream === undefined) {
    throw new GitError('This branch has no upstream to pull from.')
  }

  const effective = strategy === 'rebase' && (await isPublished(runner, repo)) ? 'merge' : strategy

  const fetch = await runner.run(['fetch'], { cwd: repo, timeoutMs: PUSH_TIMEOUT_MS })
  const fetchOutput = combine(fetch.stdout.toString('utf8'), fetch.stderr)
  if (fetch.code !== 0) {
    return {
      ok: false,
      fetched: false,
      conflicts: 0,
      operation: await detectOperation(runner, repo),
      output: fetchOutput
    }
  }

  return integrateUpstream(runner, repo, effective, fetchOutput)
}
