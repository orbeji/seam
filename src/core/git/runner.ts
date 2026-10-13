// SPDX-License-Identifier: MIT

import { spawn } from 'node:child_process'
import {
  GitAbortError,
  GitCommandError,
  GitError,
  GitNotFoundError,
  GitTimeoutError,
  GitVersionError
} from './errors'

const DEFAULT_TIMEOUT_MS = 30_000

/** Environment every Git call runs with, so output is stable and parsable. */
const BASE_ENV = {
  LC_ALL: 'C',
  // Never wait for a terminal prompt: fail instead of hanging the process.
  GIT_TERMINAL_PROMPT: '0'
}

export interface GitVersion {
  major: number
  minor: number
  patch: number
  /** The version line exactly as Git printed it. */
  raw: string
}

export interface GitRunnerOptions {
  /** Path to the Git executable. Defaults to `git` from the PATH. */
  gitPath?: string
  /** Arguments prepended to every call. Defaults to `-c core.quotepath=false`. */
  globalArgs?: readonly string[]
  /** Extra environment variables for every call. */
  env?: Record<string, string>
  /** Default timeout in milliseconds. `0` disables the timeout. */
  timeoutMs?: number
}

export interface GitRunOptions {
  /** Working directory the command runs in. */
  cwd: string
  /** Bytes or text written to the command's stdin, for example `commit -F -`. */
  stdin?: string | Uint8Array
  /** Kills the command when the caller aborts. */
  signal?: AbortSignal
  /** Overrides the runner's default timeout for this call. */
  timeoutMs?: number
  /** Extra environment variables for this call only. */
  env?: Record<string, string>
  /**
   * A query that must not refresh the index. Sets `GIT_OPTIONAL_LOCKS=0` so a
   * read never takes the index lock and never collides with a write.
   */
  readOnly?: boolean
  /** A command that could otherwise open an editor. Sets `GIT_EDITOR=true`. */
  noEditor?: boolean
}

export interface GitRunResult {
  /** Raw stdout as bytes; text is decoded later because each file has its own encoding. */
  stdout: Buffer
  stderr: string
  /** Process exit code, or -1 when the process was killed before it exited. */
  code: number
}

const VERSION_PATTERN = /^git version (\d+)\.(\d+)(?:\.(\d+))?/

/** Git 2.30 introduced `git restore --staged` and the assumptions in the spec. */
export const MINIMUM_GIT_VERSION: GitVersion = {
  major: 2,
  minor: 30,
  patch: 0,
  raw: '2.30.0'
}

export function parseGitVersion(output: string): GitVersion {
  const raw = output.trim()
  const match = VERSION_PATTERN.exec(raw)
  if (!match) {
    throw new GitError(`Unrecognised git version output: ${raw}`)
  }
  const [, major = '0', minor = '0', patch = '0'] = match
  return { major: Number(major), minor: Number(minor), patch: Number(patch), raw }
}

export function isAtLeast(version: GitVersion, required: GitVersion): boolean {
  if (version.major !== required.major) return version.major > required.major
  if (version.minor !== required.minor) return version.minor > required.minor
  return version.patch >= required.patch
}

function abortReason(signal: AbortSignal): Error {
  return new GitAbortError({ cause: signal.reason })
}

/**
 * Runs the real `git` executable as a child process. Hooks, configuration,
 * credential helpers and attributes therefore behave exactly as in a terminal.
 * Callers use one runner per repository when they need to serialise writes.
 *
 * The phase 0 chapter documents this as a `runGit(repo, args, opts)` function;
 * it is a class here because phase 3 needs a per-repository write queue, so the
 * repository is the call's `cwd` and each command is one `run`.
 */
export class GitRunner {
  private readonly gitPath: string
  private readonly globalArgs: readonly string[]
  private readonly env: Record<string, string>
  private readonly timeoutMs: number

  constructor(options: GitRunnerOptions = {}) {
    this.gitPath = options.gitPath ?? 'git'
    this.globalArgs = options.globalArgs ?? ['-c', 'core.quotepath=false']
    this.env = options.env ?? {}
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /**
   * Runs Git and resolves with its output whatever the exit code, because a
   * non-zero status is a normal result for `merge`, `diff --exit-code` and the
   * like. Use {@link runOrThrow} when a non-zero status is an error.
   */
  run(args: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs
    const argv = [...this.globalArgs, ...args]
    const signal = options.signal

    return new Promise<GitRunResult>((resolve, reject) => {
      const child = spawn(this.gitPath, argv, {
        cwd: options.cwd,
        env: {
          ...process.env,
          ...BASE_ENV,
          ...(options.readOnly ? { GIT_OPTIONAL_LOCKS: '0' } : {}),
          ...(options.noEditor ? { GIT_EDITOR: 'true' } : {}),
          ...this.env,
          ...options.env
        },
        windowsHide: true
      })

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let settled = false
      let timedOut = false
      let timer: ReturnType<typeof setTimeout> | undefined

      const finish = (settle: () => void): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        settle()
      }

      const onAbort = (): void => {
        child.kill('SIGKILL')
      }

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
        }, timeoutMs)
        timer.unref()
      }

      if (signal) {
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }

      // A closed pipe is not fatal: the command may exit before reading stdin.
      child.stdin.on('error', () => undefined)

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

      child.on('error', (error: NodeJS.ErrnoException) => {
        finish(() => {
          if (error.code === 'ENOENT') {
            reject(new GitNotFoundError(this.gitPath, { cause: error }))
          } else {
            reject(new GitError(`Failed to start Git: ${error.message}`, { cause: error }))
          }
        })
      })

      child.on('close', (code) => {
        finish(() => {
          if (timedOut) {
            reject(new GitTimeoutError(timeoutMs))
            return
          }
          if (signal?.aborted) {
            reject(abortReason(signal))
            return
          }
          resolve({
            stdout: Buffer.concat(stdoutChunks),
            stderr: Buffer.concat(stderrChunks).toString('utf8'),
            code: code ?? -1
          })
        })
      })

      if (options.stdin === undefined) {
        child.stdin.end()
      } else {
        child.stdin.end(options.stdin)
      }
    })
  }

  /** Like {@link run} but rejects with a {@link GitCommandError} on non-zero. */
  async runOrThrow(args: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
    const result = await this.run(args, options)
    if (result.code !== 0) {
      throw new GitCommandError(
        [...this.globalArgs, ...args],
        result.code,
        result.stderr,
        result.stdout.toString('utf8')
      )
    }
    return result
  }

  async version(cwd: string): Promise<GitVersion> {
    const result = await this.runOrThrow(['--version'], { cwd })
    return parseGitVersion(result.stdout.toString('utf8'))
  }

  /** Fails when the installed Git is older than {@link MINIMUM_GIT_VERSION}. */
  async ensureVersion(
    cwd: string,
    required: GitVersion = MINIMUM_GIT_VERSION
  ): Promise<GitVersion> {
    const found = await this.version(cwd)
    if (!isAtLeast(found, required)) {
      throw new GitVersionError(found, required)
    }
    return found
  }
}
