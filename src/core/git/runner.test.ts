// SPDX-License-Identifier: MIT

import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  GitAbortError,
  GitCommandError,
  GitError,
  GitNotFoundError,
  GitRunner,
  GitTimeoutError,
  parseGitVersion
} from './index'

const cwd = tmpdir()

/** A runner that executes Node instead of Git, to test process handling. */
function nodeRunner(timeoutMs?: number): GitRunner {
  return new GitRunner(
    timeoutMs === undefined
      ? { gitPath: process.execPath, globalArgs: [] }
      : { gitPath: process.execPath, globalArgs: [], timeoutMs }
  )
}

const script = (source: string): string[] => ['-e', source]

describe('parseGitVersion', () => {
  it('reads a plain version', () => {
    expect(parseGitVersion('git version 2.53.0\n')).toEqual({
      major: 2,
      minor: 53,
      patch: 0,
      raw: 'git version 2.53.0'
    })
  })

  it('reads the Windows build suffix', () => {
    const version = parseGitVersion('git version 2.30.0.windows.1')
    expect([version.major, version.minor, version.patch]).toEqual([2, 30, 0])
  })

  it('tolerates a missing patch number', () => {
    const version = parseGitVersion('git version 2.39')
    expect([version.major, version.minor, version.patch]).toEqual([2, 39, 0])
  })

  it('rejects output that is not a Git version', () => {
    expect(() => parseGitVersion('v24.14.1')).toThrow(GitError)
  })
})

describe('GitRunner process handling', () => {
  it('captures stdout and a zero exit code', async () => {
    const result = await nodeRunner().run(script('process.stdout.write("hello")'), { cwd })
    expect(result.stdout.toString('utf8')).toBe('hello')
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
  })

  it('captures stderr and a non-zero exit code without throwing', async () => {
    const result = await nodeRunner().run(script('process.stderr.write("boom"); process.exit(3)'), {
      cwd
    })
    expect(result.exitCode).toBe(3)
    expect(result.stderr).toBe('boom')
  })

  it('throws a typed error from runOrThrow on a non-zero exit', async () => {
    const promise = nodeRunner().runOrThrow(script('process.exit(2)'), { cwd })
    await expect(promise).rejects.toBeInstanceOf(GitCommandError)
    await expect(promise).rejects.toMatchObject({ exitCode: 2 })
  })

  it('writes stdin when input is given', async () => {
    const result = await nodeRunner().run(script('process.stdin.pipe(process.stdout)'), {
      cwd,
      input: 'ping'
    })
    expect(result.stdout.toString('utf8')).toBe('ping')
  })

  it('kills a command once its timeout elapses', async () => {
    const promise = nodeRunner(200).run(script('setTimeout(() => {}, 60000)'), { cwd })
    await expect(promise).rejects.toBeInstanceOf(GitTimeoutError)
  })

  it('kills a command when the caller aborts', async () => {
    const controller = new AbortController()
    const promise = nodeRunner().run(script('setTimeout(() => {}, 60000)'), {
      cwd,
      signal: controller.signal
    })
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(GitAbortError)
  })

  it('reports a missing executable', async () => {
    const runner = new GitRunner({ gitPath: 'seam-definitely-missing-binary', globalArgs: [] })
    await expect(runner.run(['--version'], { cwd })).rejects.toBeInstanceOf(GitNotFoundError)
  })
})
