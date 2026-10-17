// SPDX-License-Identifier: MIT

import type { GitRunResult, GitRunner } from './runner'

/**
 * Git reads a leading `:` in a path as a pathspec magic prefix. The flag turns
 * every pathspec literal, so a file called `:notes.txt` stages like any other.
 */
const LITERAL_PATHSPECS = '--literal-pathspecs'

/**
 * Reads the paths from stdin instead of the command line: one NUL-terminated
 * record each. A section action can carry thousands of paths, which would
 * overflow the command-line length limit on Windows if they were arguments.
 */
const PATHSPEC_FROM_STDIN = ['--pathspec-from-file=-', '--pathspec-file-nul'] as const

/** The NUL-separated stdin Git expects with `--pathspec-file-nul`. */
export function pathspecInput(paths: readonly string[]): Buffer {
  return Buffer.from(`${paths.join('\0')}\0`, 'utf8')
}

function specArgs(command: string, ...args: string[]): string[] {
  return [LITERAL_PATHSPECS, command, ...args, ...PATHSPEC_FROM_STDIN]
}

/** An empty write: nothing to stage, nothing to do. */
function nothing(): GitRunResult {
  return { stdout: Buffer.alloc(0), stderr: '', code: 0 }
}

/** Whether the repository already has a commit. A fresh one has none. */
async function hasCommit(runner: GitRunner, repo: string): Promise<boolean> {
  const result = await runner.run(['rev-parse', '--verify', '--quiet', 'HEAD'], {
    cwd: repo,
    readOnly: true
  })
  return result.code === 0
}

/**
 * Removes the paths from the index without touching the working tree. It is how
 * a prepared hunk that HEAD does not have disappears: writing the empty text
 * would leave an empty file staged, where the path must leave the index.
 *
 * Always `git rm --cached`, never `restore --staged`: these paths are not in
 * HEAD, so there is nothing for `restore` to put back.
 */
export function removeIndexPaths(
  runner: GitRunner,
  repo: string,
  paths: readonly string[]
): Promise<GitRunResult> {
  if (paths.length === 0) return Promise.resolve(nothing())
  return runner.runOrThrow(specArgs('rm', '--cached', '--force'), {
    cwd: repo,
    stdin: pathspecInput(paths)
  })
}

/**
 * Stages the given paths in one write: a single file, a handful or a whole
 * section. A renamed file is staged by passing its old and new paths together,
 * which is what `git add` needs to record the rename.
 */
export function stagePaths(
  runner: GitRunner,
  repo: string,
  paths: readonly string[]
): Promise<GitRunResult> {
  if (paths.length === 0) return Promise.resolve(nothing())
  return runner.runOrThrow(specArgs('add'), { cwd: repo, stdin: pathspecInput(paths) })
}

/**
 * Removes the given paths from the index, leaving the working tree untouched.
 * A repository without a commit cannot resolve `HEAD`, so `restore --staged`
 * fails there; `rm --cached` takes the entries out of the index instead. Its
 * `--force` only overrides Git's refusal to drop staged content, which is what
 * unstaging is: the working copy is never read or written.
 */
export async function unstagePaths(
  runner: GitRunner,
  repo: string,
  paths: readonly string[]
): Promise<GitRunResult> {
  if (paths.length === 0) return nothing()

  const options = { cwd: repo, stdin: pathspecInput(paths) }
  if (await hasCommit(runner, repo)) {
    return runner.runOrThrow(specArgs('restore', '--staged'), options)
  }
  return runner.runOrThrow(specArgs('rm', '--cached', '--force'), options)
}
