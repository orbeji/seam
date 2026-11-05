// SPDX-License-Identifier: MIT

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  GitFlowConfig,
  GitFlowFinishOutcome,
  GitFlowFinishStep,
  GitFlowKind,
  GitFlowPendingFinish,
  GitFlowState
} from '../../shared/git'
import { listBranches, validateBranchName } from './branch'
import { COMMIT_TIMEOUT_MS } from './commit'
import { GitError } from './errors'
import { detectOperation, gitStatePath } from './operation'
import type { GitRunner } from './runner'
import { readStatus } from './status'

const DEFAULTS = {
  develop: 'develop',
  featurePrefix: 'feature/',
  releasePrefix: 'release/',
  hotfixPrefix: 'hotfix/',
  versionTagPrefix: 'v'
} as const

const CONFIG_KEYS = {
  master: 'gitflow.branch.master',
  develop: 'gitflow.branch.develop',
  featurePrefix: 'gitflow.prefix.feature',
  releasePrefix: 'gitflow.prefix.release',
  hotfixPrefix: 'gitflow.prefix.hotfix',
  versionTagPrefix: 'gitflow.prefix.versiontag'
} as const

const FINISH_STEPS: readonly GitFlowFinishStep[] = [
  'merge-master',
  'tag',
  'merge-develop',
  'delete'
]

const PENDING_FILE = 'seam/gitflow-finish.json'

function combine(stdout: string, stderr: string): string {
  return [stdout.trimEnd(), stderr.trimEnd()].filter((part) => part !== '').join('\n')
}

function joinOutput(parts: readonly string[]): string {
  return parts.filter((part) => part !== '').join('\n')
}

/** A prefix always ends in `/`, so `feature` and `feature/` mean the same. */
function normalisePrefix(value: string, fallback: string): string {
  const text = value.trim()
  if (text === '') return fallback
  return text.endsWith('/') ? text : `${text}/`
}

/** Reads one Git config value, or null when Git does not set it. */
async function configValue(runner: GitRunner, repo: string, key: string): Promise<string | null> {
  const result = await runner.run(['config', '--get', key], { cwd: repo, readOnly: true })
  if (result.code !== 0) return null
  return result.stdout.toString('utf8').trimEnd()
}

interface StoredConfig {
  readonly master: string | null
  readonly develop: string | null
  readonly featurePrefix: string | null
  readonly releasePrefix: string | null
  readonly hotfixPrefix: string | null
  readonly versionTagPrefix: string | null
}

async function readStoredConfig(runner: GitRunner, repo: string): Promise<StoredConfig> {
  const [master, develop, featurePrefix, releasePrefix, hotfixPrefix, versionTagPrefix] =
    await Promise.all([
      configValue(runner, repo, CONFIG_KEYS.master),
      configValue(runner, repo, CONFIG_KEYS.develop),
      configValue(runner, repo, CONFIG_KEYS.featurePrefix),
      configValue(runner, repo, CONFIG_KEYS.releasePrefix),
      configValue(runner, repo, CONFIG_KEYS.hotfixPrefix),
      configValue(runner, repo, CONFIG_KEYS.versionTagPrefix)
    ])
  return { master, develop, featurePrefix, releasePrefix, hotfixPrefix, versionTagPrefix }
}

/** The default main branch: main, then master, then whatever is checked out. */
function defaultMaster(local: readonly string[], current: string | null): string {
  if (local.includes('main')) return 'main'
  if (local.includes('master')) return 'master'
  return current ?? 'main'
}

function effectiveConfig(
  stored: StoredConfig,
  local: readonly string[],
  current: string | null
): GitFlowConfig {
  return {
    master: stored.master ?? defaultMaster(local, current),
    develop: stored.develop ?? DEFAULTS.develop,
    featurePrefix: normalisePrefix(stored.featurePrefix ?? '', DEFAULTS.featurePrefix),
    releasePrefix: normalisePrefix(stored.releasePrefix ?? '', DEFAULTS.releasePrefix),
    hotfixPrefix: normalisePrefix(stored.hotfixPrefix ?? '', DEFAULTS.hotfixPrefix),
    versionTagPrefix: stored.versionTagPrefix ?? DEFAULTS.versionTagPrefix
  }
}

function kindOf(
  branch: string | null,
  config: GitFlowConfig
): { kind: GitFlowKind; name: string } | null {
  if (branch === null) return null
  const families: ReadonlyArray<readonly [GitFlowKind, string]> = [
    ['feature', config.featurePrefix],
    ['release', config.releasePrefix],
    ['hotfix', config.hotfixPrefix]
  ]
  for (const [kind, prefix] of families) {
    if (prefix !== '' && branch.startsWith(prefix) && branch.length > prefix.length) {
      return { kind, name: branch.slice(prefix.length) }
    }
  }
  return null
}

function familyBranches(local: readonly string[], prefix: string): string[] {
  return local.filter((branch) => branch.startsWith(prefix) && branch.length > prefix.length)
}

async function pendingPath(runner: GitRunner, repo: string): Promise<string> {
  return gitStatePath(runner, repo, PENDING_FILE)
}

function isPending(value: unknown): value is GitFlowPendingFinish {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (
    candidate['kind'] !== 'feature' &&
    candidate['kind'] !== 'release' &&
    candidate['kind'] !== 'hotfix'
  ) {
    return false
  }
  if (typeof candidate['branch'] !== 'string' || typeof candidate['name'] !== 'string') return false
  if (candidate['tag'] !== null && typeof candidate['tag'] !== 'string') return false
  return FINISH_STEPS.includes(candidate['step'] as GitFlowFinishStep)
}

/** The interrupted finish stored next to the Git directory, or null. */
export async function readPendingGitFlow(
  runner: GitRunner,
  repo: string
): Promise<GitFlowPendingFinish | null> {
  try {
    const text = await readFile(await pendingPath(runner, repo), 'utf8')
    const value: unknown = JSON.parse(text)
    return isPending(value) ? value : null
  } catch {
    return null
  }
}

async function writePendingGitFlow(
  runner: GitRunner,
  repo: string,
  pending: GitFlowPendingFinish
): Promise<void> {
  const path = await pendingPath(runner, repo)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(pending, null, 2)}\n`, 'utf8')
}

/** Forgets an interrupted finish, for example when its merge is aborted. */
export async function clearPendingGitFlow(runner: GitRunner, repo: string): Promise<void> {
  await rm(await pendingPath(runner, repo), { force: true })
}

/**
 * Reads the GitFlow configuration, the branches it manages and the current
 * position. A configuration only counts as initialized once both main branches
 * exist, so a repository whose develop branch was deleted gets the init form
 * again instead of a finish that cannot work.
 */
export async function readGitFlowState(runner: GitRunner, repo: string): Promise<GitFlowState> {
  const [status, operation, branches, stored, pending] = await Promise.all([
    readStatus(runner, repo),
    detectOperation(runner, repo),
    listBranches(runner, repo),
    readStoredConfig(runner, repo),
    readPendingGitFlow(runner, repo)
  ])
  const local = branches.local.map((branch) => branch.name)
  const current = status.branch.head
  const config = effectiveConfig(stored, local, current)
  const initialized =
    stored.master !== null &&
    stored.develop !== null &&
    local.includes(config.master) &&
    local.includes(config.develop)
  const currentKind = kindOf(current, config)
  const conflicts = status.entries.filter((entry) => entry.kind === 'unmerged').length

  return {
    initialized,
    config,
    currentBranch: current,
    currentKind: currentKind?.kind ?? null,
    currentName: currentKind?.name ?? null,
    branches: {
      feature: familyBranches(local, config.featurePrefix),
      release: familyBranches(local, config.releasePrefix),
      hotfix: familyBranches(local, config.hotfixPrefix)
    },
    operation,
    conflicts,
    dirty: status.entries.some((entry) => entry.kind !== 'untracked'),
    pending
  }
}

/** The form values GitFlow init stores in the repository's local config. */
export interface InitGitFlowOptions extends GitFlowConfig {
  /** Whether to check out develop after writing the configuration. Defaults to true. */
  readonly checkoutDevelop?: boolean
}

function validatePrefix(value: string, label: string): string {
  const prefix = normalisePrefix(value, '')
  if (prefix === '') throw new GitError(`${label} cannot be empty.`)
  return prefix
}

/**
 * Writes the GitFlow configuration and creates develop from master when it
 * does not exist. It never rewrites an existing develop branch.
 */
export async function initGitFlow(
  runner: GitRunner,
  repo: string,
  options: InitGitFlowOptions
): Promise<void> {
  const master = options.master.trim()
  const develop = options.develop.trim()
  if (master === '' || develop === '') {
    throw new GitError('Choose a master branch and a develop branch.')
  }
  if (master === develop) throw new GitError('Master and develop must be different branches.')

  await validateBranchName(runner, repo, develop)
  const featurePrefix = validatePrefix(options.featurePrefix, 'The feature prefix')
  const releasePrefix = validatePrefix(options.releasePrefix, 'The release prefix')
  const hotfixPrefix = validatePrefix(options.hotfixPrefix, 'The hotfix prefix')

  const branches = await listBranches(runner, repo)
  const local = branches.local.map((branch) => branch.name)
  if (!local.includes(master)) {
    throw new GitError(`The master branch “${master}” does not exist.`)
  }

  const checkout = options.checkoutDevelop !== false
  const status = await readStatus(runner, repo)
  if (checkout && status.entries.some((entry) => entry.kind !== 'untracked')) {
    throw new GitError('Commit or stash your changes before initializing GitFlow.')
  }

  if (!local.includes(develop)) {
    await runner.runOrThrow(['branch', develop, master], { cwd: repo })
  }

  const values: ReadonlyArray<readonly [string, string]> = [
    [CONFIG_KEYS.master, master],
    [CONFIG_KEYS.develop, develop],
    [CONFIG_KEYS.featurePrefix, featurePrefix],
    [CONFIG_KEYS.releasePrefix, releasePrefix],
    [CONFIG_KEYS.hotfixPrefix, hotfixPrefix],
    [CONFIG_KEYS.versionTagPrefix, options.versionTagPrefix.trim()]
  ]
  for (const [key, value] of values) {
    await runner.runOrThrow(['config', '--local', key, value], { cwd: repo })
  }

  if (checkout) await runner.runOrThrow(['checkout', develop], { cwd: repo })
}

/**
 * Creates a feature, release or hotfix branch and checks it out. Features and
 * releases start from develop, hotfixes from master, as GitFlow expects.
 */
export async function startGitFlow(
  runner: GitRunner,
  repo: string,
  kind: GitFlowKind,
  name: string
): Promise<string> {
  const state = await readGitFlowState(runner, repo)
  if (!state.initialized) throw new GitError('Initialize GitFlow first.')
  if (state.operation !== null) {
    throw new GitError(`A ${state.operation} is already in progress. Finish or abort it first.`)
  }
  if (state.dirty) throw new GitError('Commit or stash your changes before starting a branch.')

  const prefix =
    kind === 'feature'
      ? state.config.featurePrefix
      : kind === 'release'
        ? state.config.releasePrefix
        : state.config.hotfixPrefix
  const clean = name.trim().startsWith(prefix) ? name.trim().slice(prefix.length) : name.trim()
  if (clean === '') throw new GitError('Give the new branch a name.')

  const branch = `${prefix}${clean}`
  await validateBranchName(runner, repo, branch)
  const branches = await listBranches(runner, repo)
  if (branches.local.some((item) => item.name === branch)) {
    throw new GitError(`The branch “${branch}” already exists.`)
  }

  const base = kind === 'hotfix' ? state.config.master : state.config.develop
  if (!branches.local.some((item) => item.name === base)) {
    throw new GitError(`The ${base} branch does not exist.`)
  }
  await runner.runOrThrow(['checkout', '-b', branch, base], { cwd: repo })
  return branch
}

async function isAncestor(
  runner: GitRunner,
  repo: string,
  ancestor: string,
  descendant: string
): Promise<boolean> {
  const result = await runner.run(['merge-base', '--is-ancestor', ancestor, descendant], {
    cwd: repo,
    readOnly: true
  })
  if (result.code === 0) return true
  if (result.code === 1) return false
  throw new GitError(result.stderr.trim() || 'Git could not compare the branches.')
}

async function tagExists(runner: GitRunner, repo: string, tag: string): Promise<boolean> {
  const result = await runner.run(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], {
    cwd: repo,
    readOnly: true
  })
  return result.code === 0
}

async function validateTag(runner: GitRunner, repo: string, tag: string): Promise<void> {
  if (tag.trim() === '') throw new GitError('A release or hotfix needs a tag name.')
  await runner.runOrThrow(['check-ref-format', `refs/tags/${tag}`], { cwd: repo, readOnly: true })
}

async function mergeNoFf(
  runner: GitRunner,
  repo: string,
  source: string,
  message: string
): Promise<{ code: number; output: string }> {
  const result = await runner.run(['merge', '--no-ff', '-m', message, '--', source], {
    cwd: repo,
    noEditor: true,
    timeoutMs: COMMIT_TIMEOUT_MS,
    env: { GIT_EDITOR: 'true' }
  })
  return { code: result.code, output: combine(result.stdout.toString('utf8'), result.stderr) }
}

async function checkout(runner: GitRunner, repo: string, branch: string): Promise<string> {
  const result = await runner.runOrThrow(['checkout', branch], { cwd: repo })
  return combine(result.stdout.toString('utf8'), result.stderr)
}

/**
 * Finishes the current feature, release or hotfix. A release or hotfix is
 * merged into master, tagged, merged back into develop and deleted; a feature
 * is merged into develop and deleted. When a merge conflicts, the pending
 * record keeps the remaining steps so a later call can resume after the
 * conflicts are resolved.
 */
export async function finishGitFlow(
  runner: GitRunner,
  repo: string,
  requestedTag?: string
): Promise<GitFlowFinishOutcome> {
  const state = await readGitFlowState(runner, repo)
  if (!state.initialized) throw new GitError('Initialize GitFlow first.')
  if (state.operation !== null) {
    throw new GitError(`A ${state.operation} is in progress. Resolve it before finishing GitFlow.`)
  }
  if (state.dirty) throw new GitError('Commit or stash your changes before finishing GitFlow.')

  let pending = state.pending
  if (pending === null) {
    if (state.currentKind === null || state.currentBranch === null || state.currentName === null) {
      throw new GitError('Check out a feature, release or hotfix branch to finish it.')
    }
    const kind = state.currentKind
    const tag =
      kind === 'feature'
        ? null
        : (requestedTag?.trim() ?? '') !== ''
          ? requestedTag!.trim()
          : `${state.config.versionTagPrefix}${state.currentName}`
    if (tag !== null) {
      await validateTag(runner, repo, tag)
      if (await tagExists(runner, repo, tag)) {
        throw new GitError(`The tag “${tag}” already exists.`)
      }
    }
    pending = {
      kind,
      branch: state.currentBranch,
      name: state.currentName,
      tag,
      step: kind === 'feature' ? 'merge-develop' : 'merge-master'
    }
    await writePendingGitFlow(runner, repo, pending)
  }

  const output: string[] = []
  const branches = await listBranches(runner, repo)
  const local = branches.local.map((branch) => branch.name)

  while (true) {
    await writePendingGitFlow(runner, repo, pending)

    if (pending.step === 'merge-master') {
      if (await isAncestor(runner, repo, pending.branch, state.config.master)) {
        pending = { ...pending, step: 'tag' }
        continue
      }
      output.push(await checkout(runner, repo, state.config.master))
      const result = await mergeNoFf(
        runner,
        repo,
        pending.branch,
        `Merge branch '${pending.branch}' into ${state.config.master}`
      )
      output.push(result.output)
      if (result.code !== 0) {
        return finishFailure(runner, repo, pending, output)
      }
      pending = { ...pending, step: 'tag' }
      continue
    }

    if (pending.step === 'tag') {
      // The tag belongs on master, even when the merge was already committed
      // outside this call and the ancestor check skipped its checkout.
      output.push(await checkout(runner, repo, state.config.master))
      if (pending.tag !== null && !(await tagExists(runner, repo, pending.tag))) {
        const result = await runner.runOrThrow(
          ['tag', '-a', pending.tag, '-m', `Release ${pending.tag}`],
          { cwd: repo, noEditor: true }
        )
        output.push(combine(result.stdout.toString('utf8'), result.stderr))
      }
      pending = { ...pending, step: 'merge-develop' }
      continue
    }

    if (pending.step === 'merge-develop') {
      const source = pending.kind === 'feature' ? pending.branch : state.config.master
      if (await isAncestor(runner, repo, source, state.config.develop)) {
        pending = { ...pending, step: 'delete' }
        continue
      }
      output.push(await checkout(runner, repo, state.config.develop))
      const result = await mergeNoFf(
        runner,
        repo,
        source,
        `Merge branch '${source}' into ${state.config.develop}`
      )
      output.push(result.output)
      if (result.code !== 0) {
        return finishFailure(runner, repo, pending, output)
      }
      pending = { ...pending, step: 'delete' }
      continue
    }

    // delete: the branch is fully merged into develop by now.
    if (local.includes(pending.branch) && pending.branch !== state.config.develop) {
      output.push(await checkout(runner, repo, state.config.develop))
      const result = await runner.runOrThrow(['branch', '-d', pending.branch], { cwd: repo })
      output.push(combine(result.stdout.toString('utf8'), result.stderr))
    }
    await clearPendingGitFlow(runner, repo)
    return {
      finished: true,
      failed: false,
      conflicts: 0,
      operation: null,
      step: null,
      tag: pending.tag,
      output: joinOutput(output)
    }
  }
}

async function finishFailure(
  runner: GitRunner,
  repo: string,
  pending: GitFlowPendingFinish,
  output: readonly string[]
): Promise<GitFlowFinishOutcome> {
  const [operation, status] = await Promise.all([
    detectOperation(runner, repo),
    readStatus(runner, repo)
  ])
  return {
    finished: false,
    failed: operation === null,
    conflicts: status.entries.filter((entry) => entry.kind === 'unmerged').length,
    operation,
    step: pending.step,
    tag: pending.tag,
    output: joinOutput(output)
  }
}
