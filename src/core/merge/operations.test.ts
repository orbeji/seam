// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import {
  accept,
  applyNonConflicting,
  autoResolve,
  ignore,
  isMergeResolved,
  isRegionResolved,
  resolveSimple,
  revert
} from './operations'
import { createMerge } from './regions'

describe('applyNonConflicting', () => {
  const state = createMerge(
    ['a', 'b', 'c', 'd', 'e'],
    ['A', 'b', 'c', 'd', 'e'],
    ['a', 'b', 'c', 'd', 'E']
  )

  it('applies both sides and resolves the file', () => {
    const patch = applyNonConflicting(state)
    expect(patch.state.result).toEqual(['A', 'b', 'c', 'd', 'E'])
    expect(patch.edits).toEqual([
      { from: 0, to: 1, insertedLines: ['A'] },
      { from: 4, to: 5, insertedLines: ['E'] }
    ])
    expect(isMergeResolved(patch.state)).toBe(true)
  })

  it('applies only the chosen side', () => {
    const left = applyNonConflicting(state, 'left')
    expect(left.state.result).toEqual(['A', 'b', 'c', 'd', 'e'])
    const right = applyNonConflicting(state, 'right')
    expect(right.state.result).toEqual(['a', 'b', 'c', 'd', 'E'])
  })

  it('is idempotent', () => {
    const first = applyNonConflicting(state)
    const second = applyNonConflicting(first.state)
    expect(second.edits).toEqual([])
    expect(second.state.result).toEqual(first.state.result)
  })

  it('applies a region both sides changed the same way', () => {
    const same = createMerge(['a', 'b', 'c'], ['a', 'B', 'c'], ['a', 'B', 'c'])
    const patch = applyNonConflicting(same)
    expect(patch.state.result).toEqual(['a', 'B', 'c'])
    expect(patch.state.model.regions[0]?.leftState).toBe('applied')
    expect(patch.state.model.regions[0]?.rightState).toBe('applied')
  })

  it('never touches a conflict, simple or not', () => {
    const simple = createMerge(['hello world'], ['HELLO world'], ['hello there'])
    expect(simple.model.regions[0]?.simple).toBe(true)
    expect(applyNonConflicting(simple).edits).toEqual([])

    const real = createMerge(['a'], ['left'], ['right'])
    expect(applyNonConflicting(real).edits).toEqual([])
  })

  it('leaves a region the user edited alone', () => {
    const edited = createMerge(['a', 'b'], ['A', 'b'], ['a', 'b'])
    edited.model.regions[0]!.edited = true
    expect(applyNonConflicting(edited).edits).toEqual([])
  })
})

describe('accept', () => {
  const conflict = () => createMerge(['a', 'b', 'c'], ['a', 'L', 'c'], ['a', 'R', 'c'])

  it('replaces the region with the chosen side', () => {
    const patch = accept(conflict(), 0, 'left')
    expect(patch.state.result).toEqual(['a', 'L', 'c'])
    expect(patch.state.model.regions[0]?.leftState).toBe('applied')
    expect(patch.state.model.regions[0]?.rightState).toBe('pending')
    expect(isMergeResolved(patch.state)).toBe(false)
  })

  it('keeps both sides when the other one was already applied', () => {
    const first = accept(conflict(), 0, 'left')
    const second = accept(first.state, 0, 'right')
    expect(second.state.result).toEqual(['a', 'L', 'R', 'c'])
    expect(isMergeResolved(second.state)).toBe(true)
  })

  it('appends in the order the sides are accepted', () => {
    const first = accept(conflict(), 0, 'right')
    const second = accept(first.state, 0, 'left')
    expect(second.state.result).toEqual(['a', 'R', 'L', 'c'])
  })

  it('replaces when the other side was ignored, not applied', () => {
    const ignored = ignore(conflict(), 0, 'left')
    const patch = accept(ignored.state, 0, 'right')
    expect(patch.state.result).toEqual(['a', 'R', 'c'])
  })
})

describe('ignore', () => {
  it('marks the side without touching the text', () => {
    const state = createMerge(['a', 'b'], ['a', 'b'], ['a', 'R'])
    const patch = ignore(state, 0, 'right')
    expect(patch.edits).toEqual([])
    expect(patch.state.result).toEqual(['a', 'b'])
    expect(patch.state.model.regions[0]?.rightState).toBe('ignored')
    expect(isMergeResolved(patch.state)).toBe(true)
  })
})

describe('revert', () => {
  it('puts the text back to the base and the changed sides to pending', () => {
    const conflict = createMerge(['a', 'b', 'c'], ['a', 'L', 'c'], ['a', 'R', 'c'])
    const applied = applyNonConflicting(conflict)
    const accepted = accept(applied.state, 0, 'left')
    const back = revert(accepted.state, 0, 'base')
    expect(back.state.result).toEqual(['a', 'b', 'c'])
    expect(back.state.model.regions[0]?.leftState).toBe('pending')
    expect(back.state.model.regions[0]?.rightState).toBe('pending')
  })

  it('can send a region back to one side', () => {
    const conflict = createMerge(['a', 'b', 'c'], ['a', 'L', 'c'], ['a', 'R', 'c'])
    const patch = revert(conflict, 0, 'right')
    expect(patch.state.result).toEqual(['a', 'R', 'c'])
  })

  it('clears the hand-edited flag', () => {
    const conflict = createMerge(['a', 'b', 'c'], ['a', 'L', 'c'], ['a', 'R', 'c'])
    conflict.model.regions[0]!.edited = true
    expect(revert(conflict, 0, 'base').state.model.regions[0]?.edited).toBe(false)
  })
})

describe('resolveSimple', () => {
  it('applies the word-level merge of a simple conflict', () => {
    const state = createMerge(['hello world'], ['HELLO world'], ['hello there'])
    const patch = resolveSimple(state, 0)
    expect(patch.state.result).toEqual(['HELLO there'])
    expect(isMergeResolved(patch.state)).toBe(true)
  })

  it('does nothing for a conflict that is not simple', () => {
    const state = createMerge(['a'], ['left'], ['right'])
    const patch = resolveSimple(state, 0)
    expect(patch.edits).toEqual([])
    expect(patch.state.result).toEqual(['a'])
  })
})

describe('autoResolve', () => {
  it('returns the whole file when every region is non-conflicting or simple', () => {
    const state = createMerge(
      ['hello world', 'tail', 'x'],
      ['HELLO world', 'tail', 'x'],
      ['hello there', 'tail', 'L']
    )
    expect(state.model.regions.map((region) => region.kind)).toEqual(['conflict', 'right-only'])
    expect(autoResolve(state)).toEqual(['HELLO there', 'tail', 'L'])
  })

  it('returns null when a region needs the user', () => {
    const state = createMerge(['a', 'b', 'c'], ['a', 'L', 'c'], ['a', 'R', 'c'])
    expect(autoResolve(state)).toBeNull()
  })

  it('returns the base when nothing changed', () => {
    expect(autoResolve(createMerge(['a', 'b'], ['a', 'b'], ['a', 'b']))).toEqual(['a', 'b'])
  })
})

describe('isRegionResolved', () => {
  it('is true when no side with changes is pending', () => {
    const state = createMerge(['a', 'b'], ['A', 'b'], ['a', 'b'])
    expect(isRegionResolved(state.model.regions[0]!)).toBe(false)
    expect(isRegionResolved(resolveOrIgnore(state))).toBe(true)
  })
})

function resolveOrIgnore(state: ReturnType<typeof createMerge>) {
  return ignore(state, 0, 'left').state.model.regions[0]!
}
