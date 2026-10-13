// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitRunner, type GitRunResult } from '../../src/core/git'

/**
 * A throwaway repository for a test. Commits use a fixed identity so the
 * environment's Git configuration never leaks into the fixtures.
 */
export class SampleRepository {
  constructor(
    readonly path: string,
    private readonly runner: GitRunner
  ) {}

  /** Runs Git in the repository. Throws when the command exits non-zero. */
  async git(args: readonly string[]): Promise<string> {
    const result = await this.run(args)
    if (result.exitCode !== 0) {
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

  remove(relativePath: string): void {
    rmSync(join(this.path, relativePath))
  }

  /** Runs Git in the repository but fails when the command succeeds. */
  async gitExpectingFailure(args: readonly string[]): Promise<GitRunResult> {
    const result = await this.run(args)
    if (result.exitCode === 0) {
      throw new Error(`git ${args.join(' ')} unexpectedly succeeded`)
    }
    return result
  }

  cleanup(): void {
    rmSync(this.path, { recursive: true, force: true })
  }
}

export async function createRepository(): Promise<SampleRepository> {
  const path = mkdtempSync(join(tmpdir(), 'seam-repo-'))
  const repository = new SampleRepository(path, new GitRunner())
  await repository.git(['init', '-q'])
  return repository
}
