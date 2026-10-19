// SPDX-License-Identifier: MIT

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitRunner, type GitRunnerOptions, type GitRunResult } from '../../src/core/git'

/**
 * A throwaway repository for a test. Commits use a fixed identity and line
 * endings are pinned to `LF`, so the environment's Git configuration never
 * leaks into the fixtures: on Windows a global `core.autocrlf=true` is common
 * and would normalise the working copies a test wrote on purpose.
 */
export class SampleRepository {
  constructor(
    readonly path: string,
    private readonly runner: GitRunner
  ) {}

  /** Runs Git in the repository. Throws when the command exits non-zero. */
  async git(args: readonly string[]): Promise<string> {
    const result = await this.run(args)
    if (result.code !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
    }
    return result.stdout.toString('utf8')
  }

  /** Runs Git and returns the raw result, for commands that may fail. */
  run(args: readonly string[]): Promise<GitRunResult> {
    return this.runner.run(
      [
        '-c',
        'user.name=Seam',
        '-c',
        'user.email=seam@example.com',
        '-c',
        'init.defaultBranch=main',
        ...args
      ],
      { cwd: this.path }
    )
  }

  write(relativePath: string, contents: string): void {
    writeFileSync(join(this.path, relativePath), contents)
  }

  /** Reads a working-copy file as text, for assertions. */
  read(relativePath: string): string {
    return readFileSync(join(this.path, relativePath), 'utf8')
  }

  remove(relativePath: string): void {
    rmSync(join(this.path, relativePath))
  }

  /** Runs Git in the repository but fails when the command succeeds. */
  async gitExpectingFailure(args: readonly string[]): Promise<GitRunResult> {
    const result = await this.run(args)
    if (result.code === 0) {
      throw new Error(`git ${args.join(' ')} unexpectedly succeeded`)
    }
    return result
  }

  cleanup(): void {
    rmSync(this.path, { recursive: true, force: true })
  }
}

export async function createRepository(options: GitRunnerOptions = {}): Promise<SampleRepository> {
  const path = mkdtempSync(join(tmpdir(), 'seam-repo-'))
  const repository = new SampleRepository(path, new GitRunner(options))
  await repository.git(['init', '-q'])
  // The fixtures decide their own line endings; a global `core.autocrlf=true`,
  // as Git for Windows installs, must not override them.
  await repository.git(['config', 'core.autocrlf', 'false'])
  return repository
}
