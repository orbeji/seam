// SPDX-License-Identifier: MIT

import { diffLines, tokenizeInline } from '../diff'
import { compactHunks } from './compact'
import { groupHunks } from './group'

/**
 * Simple conflicts. A conflict is simple when the word-level three-way merge
 * resolves it, that is, when the two sides changed words that neither share nor
 * sit next to each other. The line algorithm is run again over the region's
 * words, which is what the phase calls "the same algorithm".
 *
 * The word-level answer is never applied in bulk with the non-conflicting
 * regions: merging words can produce code that does not compile, so the
 * interface marks it for review instead.
 */

/** The text without any whitespace, for the whitespace-only rule. */
function withoutSpaces(text: string): string {
  return text.replace(/\s+/g, '')
}

/** The words of a region's text, in order and covering all of it. */
function words(text: string): string[] {
  return tokenizeInline(text, 'word').map((token) => token.text)
}

/**
 * The text a simple conflict resolves to, or null when the two sides changed
 * the same words. `base`, `left` and `right` are the three sides of one region,
 * joined with `LF`.
 */
export function simpleMergeText(base: string, left: string, right: string): string | null {
  if (left === right) return left

  // Two sides that differ only in spaces resolve to the left one.
  if (withoutSpaces(left) === withoutSpaces(right)) return left

  const baseWords = words(base)
  const leftWords = words(left)
  const rightWords = words(right)
  const groups = groupHunks(
    compactHunks(diffLines(baseWords, leftWords, 'none'), baseWords, leftWords),
    compactHunks(diffLines(baseWords, rightWords, 'none'), baseWords, rightWords)
  )

  // A group both sides changed is a real conflict, even at word level.
  if (groups.some((group) => group.left.length > 0 && group.right.length > 0)) return null

  const out: string[] = []
  let cursor = 0
  for (const group of groups) {
    out.push(...baseWords.slice(cursor, group.start))

    const changeLeft = group.left.length > 0
    const hunks = changeLeft ? group.left : group.right
    const sideWords = changeLeft ? leftWords : rightWords
    let inner = group.start
    for (const hunk of hunks) {
      out.push(...baseWords.slice(inner, hunk.aStart))
      out.push(...sideWords.slice(hunk.bStart, hunk.bStart + hunk.bLines))
      inner = hunk.aStart + hunk.aLines
    }

    cursor = group.end
  }
  out.push(...baseWords.slice(cursor))
  return out.join('')
}
