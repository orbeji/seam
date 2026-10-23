// SPDX-License-Identifier: MIT

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import {
  GitAbortError,
  GitCommandError,
  GitError,
  GitNotFoundError,
  GitTimeoutError,
  GitVersionError
} from './errors'

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * When a write fails because another process holds the index lock, Seam waits
 * and tries again. Three retries with a growing wait, as the phase 3 chapter
 * describes, then the error is returned.
 */
const INDEX_LOCK_ATTEMPTS = 3
const INDEX_LOCK_FIRST_WAIT_MS = 50

/** Matches the message Git prints when the index is locked by another process. */
function isIndexLocked(result: GitRunResult): boolean {
  return result.code !== 0 && /index\.lock/i.test(result.stderr)
}

interface WriteJob {
  readonly args: readonly string[]
  readonly options: GitRunOptions
  readonly resolve: (result: GitRunResult) => void
  readonly reject: (error: unknown) => void
  attempts: number
}

interface WriteQueue {
  readonly jobs: WriteJob[]
  running: boolean
}

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
  /**
   * Receives stdout as it arrives, for commands whose progress the interface
   * shows while they run, such as a push. The whole output is still returned.
   */
  onStdout?: (chunk: string) => void
  /** Receives stderr as it arrives, for the same live progress. */
  onStderr?: (chunk: string) => void
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

function abortReason(signal: AbortSignal, stdout: string, stderr: string): Error {
  return new GitAbortError(stdout, stderr, { cause: signal.reason })
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
  private readonly writeQueues = new Map<string, WriteQueue>()

  constructor(options: GitRunnerOptions = {}) {
    this.gitPath = options.gitPath ?? 'git'
    this.globalArgs = options.globalArgs ?? ['-c', 'core.quotepath=false']
    this.env = options.env ?? {}
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  private getWriteQueue(cwd: string): WriteQueue {
    // Normalise the key so the same repository always shares one queue, even
    // when callers pass the path with a trailing separator.
    const key = resolve(cwd)
    let queue = this.writeQueues.get(key)
    if (queue === undefined) {
      queue = { jobs: [], running: false }
      this.writeQueues.set(key, queue)
    }
    return queue
  }

  /**
   * Runs the queued writes one at a time. Git takes the index lock for the
   * length of a command, so two writes at once would fail; serialising them
   * here means the second simply waits. A write that loses the lock to a
   * terminal Git is retried a few times before its error reaches the caller.
   */
  private async processWriteQueue(queue: WriteQueue): Promise<void> {
    try {
      while (queue.jobs.length > 0) {
        const job = queue.jobs[0]
        if (job === undefined) break

        let result: GitRunResult
        try {
          result = await this.executeGit(job.args, job.options)
        } catch (error) {
          // A failure to start Git, a timeout or an abort is final.
          queue.jobs.shift()
          job.reject(error)
          continue
        }

        if (isIndexLocked(result) && job.attempts < INDEX_LOCK_ATTEMPTS) {
          job.attempts += 1
          const wait = INDEX_LOCK_FIRST_WAIT_MS * 2 ** (job.attempts - 1)
          await new Promise((settle) => setTimeout(settle, wait))
          // Leave the job at the head of the queue and try it again.
          continue
        }

        queue.jobs.shift()
        job.resolve(result)
      }
    } finally {
      queue.running = false
    }
  }

  /**
   * Runs Git and resolves with its output whatever the exit code, because a
   * non-zero status is a normal result for `merge`, `diff --exit-code` and the
   * like. Use {@link runOrThrow} when a non-zero status is an error.
   */
  private executeGit(args: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
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
        windowsHide: true,
        // Its own process group, so a hook that started children can be killed
        // together with them: a `sleep` left behind would keep our pipes open
        // and the command would never look finished.
        detached: process.platform !== 'win32'
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

      /** Kills the command and any children a hook started, not just the shell. */
      const kill = (): void => {
        if (child.pid === undefined) return
        if (process.platform === 'win32') {
          // `child.kill` ends only Git; a hook keeps its own children (sh,
          // sleep, a compiler) holding our pipes open. `taskkill /T` ends the
          // whole tree, which is what lets `close` fire and releases the files.
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
            windowsHide: true,
            stdio: 'ignore'
          })
          killer.on('error', () => child.kill('SIGKILL'))
          killer.on('exit', (code) => {
            if (code !== 0) child.kill('SIGKILL')
          })
          return
        }
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }

      const onAbort = (): void => {
        kill()
      }

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true
          kill()
        }, timeoutMs)
        timer.unref()
      }

      if (signal) {
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }

      // A closed pipe is not fatal: the command may exit before reading stdin.
      child.stdin.on('error', () => undefined)

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk)
        options.onStdout?.(chunk.toString('utf8'))
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk)
        options.onStderr?.(chunk.toString('utf8'))
      })

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
          const stdout = Buffer.concat(stdoutChunks).toString('utf8')
          const stderr = Buffer.concat(stderrChunks).toString('utf8')
          if (timedOut) {
            reject(new GitTimeoutError(timeoutMs, stdout, stderr))
            return
          }
          if (signal?.aborted) {
            reject(abortReason(signal, stdout, stderr))
            return
          }
          resolve({
            stdout: Buffer.concat(stdoutChunks),
            stderr,
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

  run(args: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
    // If it's a read-only operation, run it directly in parallel
    if (options.readOnly) {
      return this.executeGit(args, options)
    }
    // For write operations, queue them per repository (per cwd)
    const cwd = options.cwd
    const queue = this.getWriteQueue(cwd)
    return new Promise<GitRunResult>((resolve, reject) => {
      queue.jobs.push({ args, options, resolve, reject, attempts: 0 })
      if (!queue.running) {
        queue.running = true
        void this.processWriteQueue(queue)
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
