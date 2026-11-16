// SPDX-License-Identifier: MIT

import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { GitRunner } from '../../src/core/git'

/** Fixed timestamps make every commit reproducible on Windows and Linux. */
const FIXED_DATE = '2001-02-03T04:05:06 +0000'

export interface SampleRepositories {
  /** Two commits, no changes. */
  clean: string
  /** One of every kind of change, staged and unstaged. */
  mixed: string
  /** A merge stopped on one file of each conflict kind, plus a binary. */
  conflicts: string
  /** A rebase stopped on the commit being replayed. */
  rebase: string
  /** A cherry-pick stopped on the picked commit. */
  cherryPick: string
  /** A stash pop that conflicted with the working copy. */
  stash: string
  /** A GitFlow history: master, develop, features, fixes, releases and tags. */
  showcase: string
}

/** Identity and dates are pinned so the fixtures never depend on the machine. */
function sampleRunner(): GitRunner {
  return new GitRunner({
    globalArgs: [
      '-c',
      'core.quotepath=false',
      '-c',
      'core.autocrlf=false',
      '-c',
      'user.name=Seam Sample',
      '-c',
      'user.email=sample@example.com',
      '-c',
      'init.defaultBranch=main',
      '-c',
      'commit.gpgsign=false'
    ],
    env: { GIT_AUTHOR_DATE: FIXED_DATE, GIT_COMMITTER_DATE: FIXED_DATE }
  })
}

async function git(
  runner: GitRunner,
  repo: string,
  args: readonly string[],
  env?: Record<string, string>
): Promise<string> {
  const result = await runner.run(args, env === undefined ? { cwd: repo } : { cwd: repo, env })
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${repo}: ${result.stderr.trim()}`)
  }
  return result.stdout.toString('utf8')
}

/**
 * Initialises a sample repository with line endings pinned in its own config.
 * The application runs Git without the fixture's `-c` arguments, so a Windows
 * runner whose global `core.autocrlf` is true would otherwise check files out
 * with CRLF and every assertion that reads a working copy would fail.
 */
async function initRepository(runner: GitRunner, repo: string): Promise<void> {
  await git(runner, repo, ['init', '-q'])
  await git(runner, repo, ['config', 'core.autocrlf', 'false'])
}

function write(repo: string, name: string, contents: string | Uint8Array): void {
  writeFileSync(join(repo, name), contents)
}

/**
 * A file comfortably over 5 MB but under 50 000 lines, so the viewer's large
 * file path is triggered by size alone. `tail` differs between the two versions
 * the tests compare.
 */
function largeFile(tail: string): string {
  const lines: string[] = []
  for (let index = 0; index < 31_000; index += 1) {
    lines.push(`line ${index} `.padEnd(199, 'x'))
  }
  lines.push(tail)
  return `${lines.join('\n')}\n`
}

/** A file of short numbered lines, optionally changing one of them. */
function numberedLines(count: number, changedLine: number | null): string {
  const lines: string[] = []
  for (let index = 0; index < count; index += 1) {
    const number = index + 1
    lines.push(number === changedLine ? `line ${number} changed` : `line ${number}`)
  }
  return `${lines.join('\n')}\n`
}

async function makeClean(runner: GitRunner, repo: string): Promise<void> {
  await initRepository(runner, repo)
  write(repo, 'a.txt', 'first\n')
  await git(runner, repo, ['add', 'a.txt'])
  await git(runner, repo, ['commit', '-qm', 'First commit'])

  write(repo, 'b.txt', 'second\n')
  await git(runner, repo, ['add', 'b.txt'])
  await git(runner, repo, ['commit', '-qm', 'Second commit'])
}

async function makeMixed(runner: GitRunner, repo: string): Promise<void> {
  await initRepository(runner, repo)
  write(repo, 'tracked.txt', 'tracked\n')
  write(repo, 'renamed.txt', 'to be renamed\n')
  write(repo, 'deleted.txt', 'to be deleted\n')
  write(repo, 'binary.dat', new Uint8Array([0, 1, 2, 3]))
  write(repo, 'café con leche.txt', 'accents\n')
  write(repo, 'page.php', '<?php\n\necho "hello";\n')
  write(repo, 'tool', '#!/usr/bin/env python3\nprint("hi")\n')
  write(repo, 'spaces.txt', 'alpha\nbeta\n')
  write(repo, 'context.txt', numberedLines(30, null))
  write(repo, 'large.txt', largeFile('end'))
  await git(runner, repo, ['add', '.'])
  await git(runner, repo, ['commit', '-qm', 'Base'])

  // Staged addition.
  write(repo, 'staged.txt', 'staged addition\n')
  await git(runner, repo, ['add', 'staged.txt'])

  // Unstaged modification.
  write(repo, 'tracked.txt', 'tracked changed\n')

  // Staged deletion.
  await git(runner, repo, ['rm', '-q', 'deleted.txt'])

  // Staged rename.
  await git(runner, repo, ['mv', 'renamed.txt', 'renamed-away.txt'])

  // Untracked file.
  write(repo, 'untracked.txt', 'untracked\n')

  // Executable, staged. `chmod` sets the working-tree bit on Linux and
  // `update-index --chmod` sets it in the index on both systems, where the
  // file-mode bit alone would not survive on Windows.
  write(repo, 'run.sh', '#!/bin/sh\necho hi\n')
  if (process.platform !== 'win32') chmodSync(join(repo, 'run.sh'), 0o755)
  await git(runner, repo, ['add', 'run.sh'])
  await git(runner, repo, ['update-index', '--chmod=+x', 'run.sh'])

  // Unstaged binary change.
  write(repo, 'binary.dat', new Uint8Array([0, 1, 2, 3, 0, 255]))

  // Unstaged change to a name with spaces and accents.
  write(repo, 'café con leche.txt', 'accents changed\n')

  // Unstaged changes used by the viewer tests: a language from the extension,
  // one from a shebang with no extension, and a file over 5 MB.
  write(repo, 'page.php', '<?php\n\necho "hello";\necho "again";\n')
  write(repo, 'tool', '#!/usr/bin/env python3\nprint("hi")\nprint("again")\n')
  // Only a trailing space differs, so the whitespace modes have something to ignore.
  write(repo, 'spaces.txt', 'alpha \nbeta\n')
  // A change in the middle, so the unchanged blocks around it can be folded.
  write(repo, 'context.txt', numberedLines(30, 16))
  write(repo, 'large.txt', largeFile('end changed'))
}

async function makeConflicts(runner: GitRunner, repo: string): Promise<void> {
  await initRepository(runner, repo)
  write(repo, 'both.txt', 'base\n')
  write(repo, 'deleted-by-us.txt', 'base\n')
  write(repo, 'deleted-by-them.txt', 'base\n')
  write(repo, 'simple.txt', 'alpha beta gamma\n')
  write(repo, 'binary.dat', new Uint8Array([0, 1, 2, 3]))
  await git(runner, repo, ['add', '.'])
  await git(runner, repo, ['commit', '-qm', 'Base'])

  await git(runner, repo, ['checkout', '-q', '-b', 'side'])
  write(repo, 'both.txt', 'theirs\n')
  write(repo, 'added-by-both.txt', 'added by them\n')
  write(repo, 'deleted-by-us.txt', 'modified by them\n')
  rmSync(join(repo, 'deleted-by-them.txt'))
  write(repo, 'simple.txt', 'alpha beta GAMMA\n')
  write(repo, 'binary.dat', new Uint8Array([0, 1, 2, 3, 4, 5]))
  await git(runner, repo, ['add', '-A'])
  await git(runner, repo, ['commit', '-qm', 'Side'])

  await git(runner, repo, ['checkout', '-q', 'main'])
  write(repo, 'both.txt', 'ours\n')
  write(repo, 'added-by-both.txt', 'added by us\n')
  rmSync(join(repo, 'deleted-by-us.txt'))
  write(repo, 'deleted-by-them.txt', 'modified by us\n')
  write(repo, 'simple.txt', 'ALPHA beta gamma\n')
  write(repo, 'binary.dat', new Uint8Array([0, 1, 2, 3, 9, 9]))
  await git(runner, repo, ['add', '-A'])
  await git(runner, repo, ['commit', '-qm', 'Main'])

  // Expected to exit non-zero: the point is the stopped merge.
  await git(runner, repo, ['merge', '--no-edit', 'side']).catch(() => undefined)
}

/** Commits a base and two branches that change the same line. */
async function competingBranches(runner: GitRunner, repo: string): Promise<void> {
  await initRepository(runner, repo)
  write(repo, 'f.txt', 'base\n')
  await git(runner, repo, ['add', '.'])
  await git(runner, repo, ['commit', '-qm', 'Base'])

  await git(runner, repo, ['checkout', '-q', '-b', 'side'])
  write(repo, 'f.txt', 'side\n')
  await git(runner, repo, ['add', '.'])
  await git(runner, repo, ['commit', '-qm', 'Side change'])

  await git(runner, repo, ['checkout', '-q', 'main'])
  write(repo, 'f.txt', 'main\n')
  await git(runner, repo, ['add', '.'])
  await git(runner, repo, ['commit', '-qm', 'Main change'])
}

async function makeRebase(runner: GitRunner, repo: string): Promise<void> {
  await competingBranches(runner, repo)
  await git(runner, repo, ['checkout', '-q', 'side'])
  // Expected to exit non-zero: the point is the stopped rebase.
  await git(runner, repo, ['rebase', 'main']).catch(() => undefined)
}

async function makeCherryPick(runner: GitRunner, repo: string): Promise<void> {
  await competingBranches(runner, repo)
  const picked = (await git(runner, repo, ['rev-parse', 'side'])).trim()
  // Expected to exit non-zero: the point is the stopped cherry-pick.
  await git(runner, repo, ['cherry-pick', picked]).catch(() => undefined)
}

async function makeStash(runner: GitRunner, repo: string): Promise<void> {
  await initRepository(runner, repo)
  write(repo, 'f.txt', 'base\n')
  await git(runner, repo, ['add', '.'])
  await git(runner, repo, ['commit', '-qm', 'Base'])
  write(repo, 'f.txt', 'stashed\n')
  await git(runner, repo, ['stash', 'push', '-m', 'Stashed change'])
  write(repo, 'f.txt', 'current\n')
  await git(runner, repo, ['add', '.'])
  await git(runner, repo, ['commit', '-qm', 'Current change'])
  // Expected to exit non-zero: the point is the stopped stash pop.
  await git(runner, repo, ['stash', 'pop']).catch(() => undefined)
}

/**
 * Builds a small project that follows GitFlow: a `master` line that only
 * receives releases, a `develop` line with features and fixes, release and
 * hotfix branches, and a tag at every version. The branches are left in place
 * so the graph shows them beside their commits, and every commit gets its own
 * fixed date so the history reads in order.
 */
async function makeShowcase(runner: GitRunner, repo: string): Promise<void> {
  await initRepository(runner, repo)
  // The fixture runner initialises `main`; this repository uses the classic
  // GitFlow names. Renaming the unborn branch keeps the first commit on master.
  await git(runner, repo, ['checkout', '-q', '-b', 'master'])

  const start = Date.UTC(2025, 0, 6, 9, 0, 0)
  let step = 0
  const date = (): Record<string, string> => {
    const stamp = new Date(start + step * 8 * 60 * 60 * 1000)
    const pad = (value: number): string => String(value).padStart(2, '0')
    const formatted =
      `${stamp.getUTCFullYear()}-${pad(stamp.getUTCMonth() + 1)}-${pad(stamp.getUTCDate())} ` +
      `${pad(stamp.getUTCHours())}:${pad(stamp.getUTCMinutes())}:00 +0000`
    step += 1
    return { GIT_AUTHOR_DATE: formatted, GIT_COMMITTER_DATE: formatted }
  }

  const ada = 'Ada Lovelace <ada@example.com>'
  const grace = 'Grace Hopper <grace@example.com>'
  const linus = 'Linus Torvalds <linus@example.com>'
  const margaret = 'Margaret Hamilton <margaret@example.com>'

  const commit = async (
    message: string,
    files: Readonly<Record<string, string>>,
    author: string
  ): Promise<void> => {
    for (const [name, contents] of Object.entries(files)) write(repo, name, contents)
    await git(runner, repo, ['add', '-A'])
    await git(runner, repo, ['commit', '-qm', message, `--author=${author}`], date())
  }

  const merge = async (branch: string, message: string): Promise<void> => {
    await git(runner, repo, ['merge', '--no-ff', '-q', '-m', message, branch], date())
  }

  const branch = async (name: string, from?: string): Promise<void> => {
    if (from !== undefined) await git(runner, repo, ['checkout', '-q', from])
    await git(runner, repo, ['checkout', '-q', '-b', name])
  }

  const tag = async (name: string): Promise<void> => {
    await git(runner, repo, ['tag', name])
  }

  await commit('Initial project scaffold', { 'README.md': 'demo\n' }, ada)
  await branch('develop')
  await commit('Add user model and migrations', { 'users.txt': 'users\n' }, grace)

  await branch('feature/login', 'develop')
  await commit('Build login form', { 'login.txt': 'login\n' }, grace)
  await commit('Add password reset flow', { 'reset.txt': 'reset\n' }, grace)
  await git(runner, repo, ['checkout', '-q', 'develop'])
  await commit('Add application shell', { 'shell.txt': 'shell\n' }, ada)
  await merge('feature/login', "Merge branch 'feature/login' into develop")

  await branch('feature/checkout', 'develop')
  await commit('Create checkout page', { 'cart.txt': 'cart\n' }, linus)
  await commit('Add payment provider', { 'payment.txt': 'payment\n' }, linus)
  await git(runner, repo, ['checkout', '-q', 'develop'])
  await merge('feature/checkout', "Merge branch 'feature/checkout' into develop")

  await branch('fix/session-timeout', 'develop')
  await commit('Fix session timeout', { 'timeout.txt': 'timeout\n' }, margaret)
  await git(runner, repo, ['checkout', '-q', 'develop'])
  await merge('fix/session-timeout', "Merge branch 'fix/session-timeout' into develop")

  // Release 1.0: cut from develop, merged into master, tagged and merged back.
  await branch('release/1.0', 'develop')
  await commit('Bump version to 1.0.0', { VERSION: '1.0.0\n' }, ada)
  await git(runner, repo, ['checkout', '-q', 'master'])
  await merge('release/1.0', "Merge branch 'release/1.0'")
  await tag('v1.0.0')
  await git(runner, repo, ['checkout', '-q', 'develop'])
  await merge('release/1.0', "Merge branch 'release/1.0' into develop")

  // Hotfix 1.0.1: cut from master, merged into both lines and tagged.
  await branch('hotfix/1.0.1', 'master')
  await commit('Escape user input in reports', { 'escape.txt': 'escape\n' }, margaret)
  await git(runner, repo, ['checkout', '-q', 'master'])
  await merge('hotfix/1.0.1', "Merge branch 'hotfix/1.0.1'")
  await tag('v1.0.1')
  await git(runner, repo, ['checkout', '-q', 'develop'])
  await merge('hotfix/1.0.1', "Merge branch 'hotfix/1.0.1' into develop")

  await branch('feature/search', 'develop')
  await commit('Add fuzzy search', { 'search.txt': 'search\n' }, linus)
  await commit('Index search results', { 'index.txt': 'index\n' }, linus)
  await git(runner, repo, ['checkout', '-q', 'develop'])
  await merge('feature/search', "Merge branch 'feature/search' into develop")

  await branch('fix/cart-total', 'develop')
  await commit('Fix cart total rounding', { 'round.txt': 'round\n' }, grace)
  await git(runner, repo, ['checkout', '-q', 'develop'])
  await merge('fix/cart-total', "Merge branch 'fix/cart-total' into develop")

  await branch('release/1.1', 'develop')
  await commit('Bump version to 1.1.0', { VERSION: '1.1.0\n' }, ada)
  await git(runner, repo, ['checkout', '-q', 'master'])
  await merge('release/1.1', "Merge branch 'release/1.1'")
  await tag('v1.1.0')
  await git(runner, repo, ['checkout', '-q', 'develop'])
  await merge('release/1.1', "Merge branch 'release/1.1' into develop")

  await branch('feature/api-tokens', 'develop')
  await commit('Add API tokens', { 'tokens.txt': 'tokens\n' }, grace)
  await commit('Document API authentication', { 'api.md': 'docs\n' }, grace)
  await git(runner, repo, ['checkout', '-q', 'develop'])
  await merge('feature/api-tokens', "Merge branch 'feature/api-tokens' into develop")

  await branch('hotfix/1.1.1', 'master')
  await commit('Fix token expiry check', { 'expiry.txt': 'expiry\n' }, margaret)
  await git(runner, repo, ['checkout', '-q', 'master'])
  await merge('hotfix/1.1.1', "Merge branch 'hotfix/1.1.1'")
  await tag('v1.1.1')
  await git(runner, repo, ['checkout', '-q', 'develop'])
  await merge('hotfix/1.1.1', "Merge branch 'hotfix/1.1.1' into develop")

  await branch('release/1.2', 'develop')
  await commit('Bump version to 1.2.0', { VERSION: '1.2.0\n' }, ada)
  await git(runner, repo, ['checkout', '-q', 'master'])
  await merge('release/1.2', "Merge branch 'release/1.2'")
  await tag('v1.2.0')
  await git(runner, repo, ['checkout', '-q', 'develop'])
  await merge('release/1.2', "Merge branch 'release/1.2' into develop")

  await branch('feature/analytics', 'develop')
  await commit('Add analytics events', { 'events.txt': 'events\n' }, ada)
  await commit('Build analytics dashboard', { 'dashboard.txt': 'dashboard\n' }, ada)
  await git(runner, repo, ['checkout', '-q', 'develop'])
  await merge('feature/analytics', "Merge branch 'feature/analytics' into develop")
}

/**
 * Creates the sample repositories under `baseDir`, which should be a fresh
 * temporary directory. Returns their paths.
 */
export async function createSampleRepositories(baseDir: string): Promise<SampleRepositories> {
  const runner = sampleRunner()
  const clean = join(baseDir, 'clean')
  const mixed = join(baseDir, 'mixed')
  const conflicts = join(baseDir, 'conflicts')
  const rebase = join(baseDir, 'rebase')
  const cherryPick = join(baseDir, 'cherry-pick')
  const stash = join(baseDir, 'stash')
  const showcase = join(baseDir, 'showcase')
  for (const directory of [clean, mixed, conflicts, rebase, cherryPick, stash, showcase]) {
    mkdirSync(directory, { recursive: true })
  }

  await makeClean(runner, clean)
  await makeMixed(runner, mixed)
  await makeConflicts(runner, conflicts)
  await makeRebase(runner, rebase)
  await makeCherryPick(runner, cherryPick)
  await makeStash(runner, stash)
  await makeShowcase(runner, showcase)

  return { clean, mixed, conflicts, rebase, cherryPick, stash, showcase }
}
