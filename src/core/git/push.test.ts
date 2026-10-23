// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { isAuthenticationFailure, parsePushOutput } from './push'

/**
 * The parser reads the porcelain flags, not the English sentences. Each case is
 * a line real Git printed in the phase's experiments, including the tab before
 * the summary and the empty flag of an ordinary update.
 */

describe('parsePushOutput', () => {
  it('reads a new branch, an update and an up-to-date reference', () => {
    const output = [
      'To ../remote',
      '*\trefs/heads/main:refs/heads/main\t[new branch]',
      ' \trefs/heads/main:refs/heads/main\t6e29e4d..f2a553e',
      '=\trefs/heads/main:refs/heads/main\t[up to date]',
      'Done'
    ].join('\n')

    const refs = parsePushOutput(output)
    expect(refs.map((ref) => ref.flag)).toEqual(['*', ' ', '='])
    expect(refs[0]?.from).toBe('refs/heads/main')
    expect(refs[0]?.to).toBe('refs/heads/main')
    expect(refs[1]?.summary).toBe('6e29e4d..f2a553e')
    expect(refs.every((ref) => ref.rejection === null)).toBe(true)
  })

  it('recognises a rejected reference and its reason', () => {
    const refs = parsePushOutput(
      ['To ../remote', '!\trefs/heads/main:refs/heads/main\t[rejected] (fetch first)', 'Done'].join(
        '\n'
      )
    )

    expect(refs).toHaveLength(1)
    expect(refs[0]?.flag).toBe('!')
    expect(refs[0]?.reason).toBe('fetch first')
    expect(refs[0]?.rejection).toBe('non-fast-forward')
    expect(refs[0]?.summary).toBe('[rejected] (fetch first)')
  })

  it('recognises a non-fast-forward refusal and a stale lease', () => {
    const nonFastForward = parsePushOutput(
      '!\trefs/heads/main:refs/heads/main\t[rejected] (non-fast-forward)'
    )
    const stale = parsePushOutput(
      '!\trefs/heads/main:refs/heads/main\t[rejected] (stale info)'
    )

    expect(nonFastForward[0]?.rejection).toBe('non-fast-forward')
    expect(stale[0]?.rejection).toBe('stale-info')
  })

  it('recognises a server hook refusal', () => {
    const refs = parsePushOutput(
      '!\trefs/heads/main:refs/heads/main\t[remote rejected] (pre-receive hook declined)'
    )

    expect(refs[0]?.rejection).toBe('remote-rejected')
    expect(refs[0]?.reason).toBe('pre-receive hook declined')
  })

  it('recognises an existing tag and marks it as a tag', () => {
    const refs = parsePushOutput(
      '!\trefs/tags/v1:refs/tags/v1\t[rejected] (already exists)'
    )

    expect(refs[0]?.rejection).toBe('tag-exists')
    expect(refs[0]?.tag).toBe(true)
  })

  it('ignores the lines that are not references', () => {
    const refs = parsePushOutput(
      [
        'To ../remote',
        'remote: no pushes allowed',
        'error: failed to push some refs',
        'Done',
        '',
        'Everything up-to-date'
      ].join('\n')
    )

    expect(refs).toEqual([])
  })

  it('leaves an unknown refusal as other', () => {
    const refs = parsePushOutput('!\trefs/heads/main:refs/heads/main\t[rejected]')

    expect(refs[0]?.rejection).toBe('other')
  })
})

describe('isAuthenticationFailure', () => {
  it('recognises the ways Git reports missing credentials', () => {
    expect(isAuthenticationFailure('fatal: Authentication failed for https://example.test/x')).toBe(
      true
    )
    expect(isAuthenticationFailure('fatal: could not read Username for https://example.test')).toBe(
      true
    )
    expect(
      isAuthenticationFailure('git@example.test: Permission denied (publickey).')
    ).toBe(true)
    expect(isAuthenticationFailure('fatal: could not read Password: terminal prompts disabled')).toBe(
      true
    )
  })

  it('does not confuse a hook refusal with a credential failure', () => {
    expect(isAuthenticationFailure('remote: no pushes allowed')).toBe(false)
  })
})
