// SPDX-License-Identifier: MIT

import type { LineRange, MergeRegion } from '../../src/core/merge'

/**
 * Random three-way cases for the merge engine, plus the helpers the invariant
 * tests share. The alphabet is small on purpose, so repeated lines and
 * colliding hunks are common and the merge has to be right about them. Every
 * generator takes an explicit random function, seeded by the caller, so a
 * failure can be replayed from the seed in the failure message.
 */

/** A small, seeded, deterministic generator (mulberry32). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** The line texts the cases are built from: few, so they repeat a lot. */
export const SMALL_ALPHABET: readonly string[] = ['a', 'b', 'c', 'd', '']

export interface MergeCase {
  base: string[]
  left: string[]
  right: string[]
}

export function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T
}

/** A short list of lines from the alphabet. */
export function randomLines(
  random: () => number,
  alphabet: readonly string[] = SMALL_ALPHABET,
  maxLength = 12
): string[] {
  const length = Math.floor(random() * (maxLength + 1))
  return Array.from({ length }, () => pick(random, alphabet))
}

/** A variant of the lines, made of random insertions, deletions and replacements. */
export function mutateLines(
  random: () => number,
  lines: readonly string[],
  alphabet: readonly string[] = SMALL_ALPHABET
): string[] {
  const out = [...lines]
  const edits = 1 + Math.floor(random() * 3)
  for (let index = 0; index < edits; index += 1) {
    const at = Math.floor(random() * (out.length + 1))
    const roll = random()
    if (roll < 0.4 || out.length === 0) {
      out.splice(at, 0, pick(random, alphabet))
    } else if (roll < 0.7) {
      out.splice(Math.min(at, out.length - 1), 1)
    } else {
      const count = 1 + Math.floor(random() * 2)
      out.splice(Math.min(at, out.length - 1), count, pick(random, alphabet))
    }
  }
  return out
}

/** A base with a variant on each side. */
export function randomMergeCase(
  random: () => number,
  alphabet: readonly string[] = SMALL_ALPHABET,
  maxLength = 12
): MergeCase {
  const base = randomLines(random, alphabet, maxLength)
  return {
    base,
    left: mutateLines(random, base, alphabet),
    right: mutateLines(random, base, alphabet)
  }
}

/**
 * A case whose lines are all distinct, so the alignment of the diff is unique
 * and the engine and Git have to agree exactly. The base labels and every
 * inserted or replacing line come from separate counters.
 */
export function uniqueMergeCase(random: () => number, maxLength = 10): MergeCase {
  const length = Math.floor(random() * (maxLength + 1))
  const base = Array.from({ length }, (_, index) => `b${index}`)
  let counter = 0
  const mutate = (lines: readonly string[]): string[] => {
    const out = [...lines]
    const edits = 1 + Math.floor(random() * 3)
    for (let index = 0; index < edits; index += 1) {
      const at = Math.floor(random() * (out.length + 1))
      const roll = random()
      if (roll < 0.4 || out.length === 0) out.splice(at, 0, `m${counter++}`)
      else if (roll < 0.7) out.splice(Math.min(at, out.length - 1), 1)
      else out.splice(Math.min(at, out.length - 1), 1 + Math.floor(random() * 2), `m${counter++}`)
    }
    return out
  }
  return { base, left: mutate(base), right: mutate(base) }
}

/** The range of a region on one side, as `reconstructSide` needs it. */
export type SideRange = (region: MergeRegion) => LineRange

/**
 * Rebuilds one side out of the lines the regions did not touch (the stretches
 * between their base ranges) and the side's range in each region. The result
 * must equal the side exactly: it is the engine's main invariant and it does not
 * depend on Git.
 */
export function reconstructSide(
  base: readonly string[],
  side: readonly string[],
  regions: readonly MergeRegion[],
  range: SideRange
): string[] {
  const out: string[] = []
  let cursor = 0
  for (const region of regions) {
    out.push(...base.slice(cursor, region.base.start))
    const sideRange = range(region)
    out.push(...side.slice(sideRange.start, sideRange.end))
    cursor = region.base.end
  }
  out.push(...base.slice(cursor))
  return out
}

/** A compact label for a case, so a failure says which seed and input it hit. */
export function describeCase(index: number, mergeCase: MergeCase): string {
  return [
    `case ${index}`,
    `base=${JSON.stringify(mergeCase.base)}`,
    `left=${JSON.stringify(mergeCase.left)}`,
    `right=${JSON.stringify(mergeCase.right)}`
  ].join(' ')
}
