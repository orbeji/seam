// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GitAbortError,
  GitCommandError,
  GitError,
  GitNotFoundError,
  GitRunner,
  GitTimeoutError,
  GitVersionError,
  isAtLeast,
  MINIMUM_GIT_VERSION,
  parseGitVersion,
  type GitVersion
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

/** A runner that reports an older Git version than the machine has. */
class OldGitRunner extends GitRunner {
  override async version(): Promise<GitVersion> {
    return { major: 2, minor: 29, patch: 0, raw: 'git version 2.29.0' }
  }
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

describe('isAtLeast', () => {
  const minimum = MINIMUM_GIT_VERSION

  it('compares major, minor and patch in order', () => {
    expect(isAtLeast({ major: 2, minor: 30, patch: 0, raw: '2.30.0' }, minimum)).toBe(true)
    expect(isAtLeast({ major: 2, minor: 29, patch: 9, raw: '2.29.9' }, minimum)).toBe(false)
    expect(isAtLeast({ major: 3, minor: 0, patch: 0, raw: '3.0.0' }, minimum)).toBe(true)
    expect(isAtLeast({ major: 2, minor: 30, patch: 0, raw: '2.30.0' }, minimum)).toBe(true)
  })
})

describe('ensureVersion', () => {
  it('rejects a Git older than the minimum with a clear message', async () => {
    const promise = new OldGitRunner().ensureVersion(cwd)
    await expect(promise).rejects.toBeInstanceOf(GitVersionError)
    await expect(promise).rejects.toThrow(/2\.30 or newer is required, found git version 2\.29\.0/)
  })
})

describe('GitRunner process handling', () => {
  it('captures stdout and a zero exit code', async () => {
    const result = await nodeRunner().run(script('process.stdout.write("hello")'), { cwd })
    expect(result.stdout.toString('utf8')).toBe('hello')
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
  })

  it('captures stderr and a non-zero exit code without throwing', async () => {
    const result = await nodeRunner().run(script('process.stderr.write("boom"); process.exit(3)'), {
      cwd
    })
    expect(result.code).toBe(3)
    expect(result.stderr).toBe('boom')
  })

  it('keeps stdout as raw bytes, including a NUL', async () => {
    const result = await nodeRunner().run(
      script('process.stdout.write(Buffer.from([0, 1, 2, 255]))'),
      { cwd }
    )
    expect([...result.stdout]).toEqual([0, 1, 2, 255])
  })

  it('throws a typed error from runOrThrow on a non-zero exit', async () => {
    const promise = nodeRunner().runOrThrow(script('process.exit(2)'), { cwd })
    await expect(promise).rejects.toBeInstanceOf(GitCommandError)
    await expect(promise).rejects.toMatchObject({ exitCode: 2 })
  })

  it('writes stdin when it is given', async () => {
    const result = await nodeRunner().run(script('process.stdin.pipe(process.stdout)'), {
      cwd,
      stdin: 'ping'
    })
    expect(result.stdout.toString('utf8')).toBe('ping')
  })

  it('runs in a working directory whose path contains a space', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seam runner '))
    try {
      const result = await nodeRunner().run(script('process.stdout.write(process.cwd())'), {
        cwd: dir
      })
      expect(result.stdout.toString('utf8')).toBe(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('sets GIT_OPTIONAL_LOCKS only for read-only calls', async () => {
    const read = script('process.stdout.write(process.env.GIT_OPTIONAL_LOCKS ?? "unset")')
    const ambient = process.env['GIT_OPTIONAL_LOCKS'] ?? 'unset'

    const plain = await nodeRunner().run(read, { cwd })
    expect(plain.stdout.toString('utf8')).toBe(ambient)

    const query = await nodeRunner().run(read, { cwd, readOnly: true })
    expect(query.stdout.toString('utf8')).toBe('0')
  })

  it('sets GIT_EDITOR when a command could open one', async () => {
    const read = script('process.stdout.write(process.env.GIT_EDITOR ?? "unset")')
    const result = await nodeRunner().run(read, { cwd, noEditor: true })
    expect(result.stdout.toString('utf8')).toBe('true')
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

describe('GitRunner write queue', () => {
  it('runs twenty simultaneous writes one after another, in call order', async () => {
    const runner = nodeRunner()
    const finished: number[] = []

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        runner.run(script('setTimeout(() => {}, 10)'), { cwd }).then(() => finished.push(index))
      )
    )

    expect(finished).toEqual(Array.from({ length: 20 }, (_, index) => index))
  })

  it('lets a read run while a write is still in flight', async () => {
    const runner = nodeRunner()
    let writeFinished = false

    const write = runner.run(script('setTimeout(() => {}, 400)'), { cwd }).then(() => {
      writeFinished = true
    })
    const read = await runner.run(script('process.stdout.write("read")'), {
      cwd,
      readOnly: true
    })

    expect(read.stdout.toString('utf8')).toBe('read')
    expect(writeFinished).toBe(false)
    await write
  })

  it('retries a write that lost the index lock, then succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seam-lock-'))
    const marker = join(dir, 'attempted')
    const source = [
      "const fs = require('fs')",
      `const marker = ${JSON.stringify(marker)}`,
      'if (!fs.existsSync(marker)) {',
      "  fs.writeFileSync(marker, '1')",
      "  process.stderr.write('fatal: Unable to create index.lock: File exists.')",
      '  process.exit(128)',
      '}',
      'process.stdout.write("done")'
    ].join('\n')

    try {
      const result = await nodeRunner().run(script(source), { cwd: dir })
      expect(result.code).toBe(0)
      expect(result.stdout.toString('utf8')).toBe('done')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('gives up after a few retries and returns the lock error', async () => {
    const source =
      "process.stderr.write('fatal: Unable to create index.lock: File exists.'); process.exit(128)"
    const result = await nodeRunner().run(script(source), { cwd })
    expect(result.code).toBe(128)
    expect(result.stderr).toContain('index.lock')
  })
})
