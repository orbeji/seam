// SPDX-License-Identifier: MIT

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import type { SyntaxThemePreference } from '../../shared/ipc'

/**
 * Light theme for CodeMirror, matching the application's light colour scheme.
 * The colours mirror the CSS variables defined in styles.css for the light theme.
 */
export const oneLight = EditorView.theme({
  '&': {
    backgroundColor: '#ffffff',
    color: '#1d1d1f'
  },
  '.cm-content': {
    caretColor: '#b8860b'
  },
  '.cm-gutters': {
    backgroundColor: '#ffffff',
    color: '#86868b',
    borderRight: '1px solid #d1d1d6'
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(0, 0, 0, 0.03)'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: '#1d1d1f'
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(26, 115, 232, 0.25)'
  },
  // One background per kind of line: old text red, new text green. The base
  // theme also tints the deleted block and the changed words, which stacked
  // into a double shade, so those extra layers are turned off below.
  '&.cm-merge-a .cm-changedLine': {
    backgroundColor: 'rgba(192, 106, 106, 0.14)'
  },
  '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
    backgroundColor: 'rgba(91, 157, 120, 0.14)'
  },
  '&.cm-merge-a .cm-changedLineGutter': {
    backgroundColor: 'rgba(192, 106, 106, 0.5)'
  },
  '&.cm-merge-b .cm-changedLineGutter': {
    backgroundColor: 'rgba(91, 157, 120, 0.5)'
  },
  '.cm-deletedLineGutter': {
    backgroundColor: 'rgba(192, 106, 106, 0.5)'
  },
  '.cm-inlineChangedLineGutter': {
    backgroundColor: 'rgba(91, 157, 120, 0.5)'
  },
  '& .cm-deletedChunk': {
    backgroundColor: 'rgba(192, 106, 106, 0.1)'
  },
  // The words inside a changed line only keep the line's own background; these
  // selectors outrank the merge package's base gradient.
  '&.cm-merge-a .cm-changedText, &.cm-merge-b .cm-changedText, & .cm-deletedChunk .cm-deletedText, .cm-changedText, .cm-deletedText':
    {
      background: 'none'
    }
})

/** The shared wording of a light syntax palette, applied tag by tag. */
interface Palette {
  readonly keyword: string
  readonly string: string
  readonly number: string
  readonly comment: string
  readonly function: string
  readonly type: string
  readonly property: string
  readonly variable: string
  readonly operator: string
  readonly heading: string
  readonly link: string
  readonly invalid: string
}

/** Builds the CodeMirror highlight style for one light palette. */
function highlightStyle(palette: Palette): HighlightStyle {
  return HighlightStyle.define([
    { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword], color: palette.keyword },
    { tag: [tags.definitionKeyword, tags.operatorKeyword], color: palette.keyword },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: palette.string },
    {
      tag: [tags.number, tags.bool, tags.null, tags.atom, tags.constant(tags.name)],
      color: palette.number
    },
    {
      tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
      color: palette.comment,
      fontStyle: 'italic'
    },
    {
      tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
      color: palette.function
    },
    { tag: [tags.typeName, tags.className, tags.namespace], color: palette.type },
    {
      tag: [tags.propertyName, tags.attributeName, tags.definition(tags.propertyName)],
      color: palette.property
    },
    { tag: [tags.variableName, tags.definition(tags.variableName)], color: palette.variable },
    {
      tag: [tags.operator, tags.punctuation, tags.bracket, tags.separator],
      color: palette.operator
    },
    { tag: tags.tagName, color: palette.keyword },
    { tag: [tags.heading, tags.strong], color: palette.heading, fontWeight: 'bold' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: [tags.link, tags.url], color: palette.link, textDecoration: 'underline' },
    { tag: tags.invalid, color: palette.invalid, textDecoration: 'underline' }
  ])
}

/**
 * The light syntax palettes. The viewer in the light scheme can wear any of
 * them; the dark scheme keeps its own out-of-the-box palette.
 */
const PALETTES: Record<SyntaxThemePreference, Palette> = {
  /** The application's own colours: amber, green, blue and violet. */
  seam: {
    keyword: '#b8860b',
    string: '#2e7d32',
    number: '#1a73e8',
    comment: '#86868b',
    function: '#7b2dbf',
    type: '#996e09',
    property: '#1a73e8',
    variable: '#1d1d1f',
    operator: '#6e6e73',
    heading: '#1d1d1f',
    link: '#1a73e8',
    invalid: '#c0392b'
  },
  /** GitHub's light palette: the one the web renders snippets with. */
  github: {
    keyword: '#cf222e',
    string: '#0a3069',
    number: '#0550ae',
    comment: '#6e7781',
    function: '#8250df',
    type: '#953800',
    property: '#0550ae',
    variable: '#1f2328',
    operator: '#1f2328',
    heading: '#1f2328',
    link: '#0969da',
    invalid: '#cf222e'
  },
  /** VS Code's Light+ palette: brighter and more saturated. */
  vivid: {
    keyword: '#af00db',
    string: '#a31515',
    number: '#098658',
    comment: '#008000',
    function: '#795e26',
    type: '#267f99',
    property: '#001080',
    variable: '#001080',
    operator: '#000000',
    heading: '#800000',
    link: '#0000ff',
    invalid: '#cd3131'
  }
}

/** The syntax colours a light viewer wears for the chosen palette. */
export function lightSyntax(theme: SyntaxThemePreference): Extension {
  return syntaxHighlighting(highlightStyle(PALETTES[theme]))
}

/**
 * Whether the window currently wears the light scheme: the stored answer when
 * it is set, and the system's while it is not.
 */
export function readsLight(): boolean {
  const scheme = document.documentElement.getAttribute('data-theme')
  if (scheme === 'light' || scheme === 'dark') return scheme === 'light'
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  )
}
