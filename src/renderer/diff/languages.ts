// SPDX-License-Identifier: MIT

import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'

/**
 * Language detection for the viewer. Each language is a `LanguageDescription`
 * whose support is loaded on demand, so the initial bundle does not carry every
 * grammar.
 */

interface LanguageEntry {
  /** A stable id the interface can translate. */
  id: string
  description: LanguageDescription
}

const ENTRIES: readonly LanguageEntry[] = [
  {
    id: 'javascript',
    description: LanguageDescription.of({
      name: 'JavaScript',
      alias: ['js', 'jsx', 'mjs', 'cjs'],
      extensions: ['js', 'jsx', 'mjs', 'cjs'],
      load: () => import('@codemirror/lang-javascript').then((grammar) => grammar.javascript())
    })
  },
  {
    id: 'typescript',
    description: LanguageDescription.of({
      name: 'TypeScript',
      alias: ['ts'],
      extensions: ['ts', 'mts', 'cts'],
      load: () =>
        import('@codemirror/lang-javascript').then((grammar) =>
          grammar.javascript({ typescript: true })
        )
    })
  },
  {
    id: 'tsx',
    description: LanguageDescription.of({
      name: 'TSX',
      extensions: ['tsx'],
      load: () =>
        import('@codemirror/lang-javascript').then((grammar) =>
          grammar.javascript({ typescript: true, jsx: true })
        )
    })
  },
  {
    id: 'json',
    description: LanguageDescription.of({
      name: 'JSON',
      extensions: ['json'],
      load: () => import('@codemirror/lang-json').then((grammar) => grammar.json())
    })
  },
  {
    id: 'css',
    description: LanguageDescription.of({
      name: 'CSS',
      extensions: ['css', 'scss', 'less'],
      load: () => import('@codemirror/lang-css').then((grammar) => grammar.css())
    })
  },
  {
    id: 'html',
    description: LanguageDescription.of({
      name: 'HTML',
      extensions: ['html', 'htm'],
      load: () => import('@codemirror/lang-html').then((grammar) => grammar.html())
    })
  },
  {
    id: 'xml',
    description: LanguageDescription.of({
      name: 'XML',
      extensions: ['xml', 'xsd', 'xsl', 'svg'],
      load: () => import('@codemirror/lang-xml').then((grammar) => grammar.xml())
    })
  },
  {
    id: 'php',
    description: LanguageDescription.of({
      name: 'PHP',
      extensions: ['php', 'phtml'],
      load: () => import('@codemirror/lang-php').then((grammar) => grammar.php())
    })
  },
  {
    id: 'python',
    description: LanguageDescription.of({
      name: 'Python',
      alias: ['py'],
      extensions: ['py', 'pyi'],
      load: () => import('@codemirror/lang-python').then((grammar) => grammar.python())
    })
  },
  {
    id: 'markdown',
    description: LanguageDescription.of({
      name: 'Markdown',
      alias: ['md'],
      extensions: ['md', 'markdown'],
      load: () => import('@codemirror/lang-markdown').then((grammar) => grammar.markdown())
    })
  },
  {
    id: 'sql',
    description: LanguageDescription.of({
      name: 'SQL',
      extensions: ['sql'],
      load: () => import('@codemirror/lang-sql').then((grammar) => grammar.sql())
    })
  },
  {
    id: 'java',
    description: LanguageDescription.of({
      name: 'Java',
      extensions: ['java'],
      load: () => import('@codemirror/lang-java').then((grammar) => grammar.java())
    })
  },
  {
    id: 'cpp',
    description: LanguageDescription.of({
      name: 'C++',
      extensions: ['c', 'h', 'cc', 'cpp', 'cxx', 'hpp'],
      load: () => import('@codemirror/lang-cpp').then((grammar) => grammar.cpp())
    })
  },
  {
    id: 'rust',
    description: LanguageDescription.of({
      name: 'Rust',
      extensions: ['rs'],
      load: () => import('@codemirror/lang-rust').then((grammar) => grammar.rust())
    })
  },
  {
    id: 'go',
    description: LanguageDescription.of({
      name: 'Go',
      extensions: ['go'],
      load: () => import('@codemirror/lang-go').then((grammar) => grammar.go())
    })
  },
  {
    id: 'yaml',
    description: LanguageDescription.of({
      name: 'YAML',
      alias: ['yml'],
      extensions: ['yaml', 'yml'],
      load: () => import('@codemirror/lang-yaml').then((grammar) => grammar.yaml())
    })
  },
  {
    id: 'shell',
    description: LanguageDescription.of({
      name: 'Shell',
      alias: ['sh', 'bash', 'zsh'],
      extensions: ['sh', 'bash', 'zsh'],
      load: () =>
        import('@codemirror/legacy-modes/mode/shell').then(
          (mode) => new LanguageSupport(StreamLanguage.define(mode.shell))
        )
    })
  }
]

const DESCRIPTIONS = ENTRIES.map((entry) => entry.description)

/** Shebang interpreters we can highlight, by program name. */
const SHEBANGS: Record<string, string> = {
  node: 'javascript',
  nodejs: 'javascript',
  deno: 'typescript',
  bun: 'typescript',
  python: 'python',
  python3: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  dash: 'shell',
  ksh: 'shell',
  php: 'php'
}

/** The program a shebang names, looking through `env`. */
function shebangProgram(firstLine: string): string | null {
  const match = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(firstLine)
  if (!match) return null

  const program = (match[1] as string).split('/').pop() ?? ''
  if (program === 'env') {
    const argument = match[2]
    return argument ? (argument.split('/').pop() ?? null) : null
  }
  return program
}

/**
 * The language id for a path, or null when nothing matches. The file name and
 * extension are tried first, then the first line when it is a shebang.
 */
export function detectLanguageId(path: string, firstLine: string): string | null {
  const byName = LanguageDescription.matchFilename(DESCRIPTIONS, path)
  if (byName) {
    const entry = ENTRIES.find((candidate) => candidate.description === byName)
    if (entry) return entry.id
  }

  const program = shebangProgram(firstLine)
  return program ? (SHEBANGS[program] ?? null) : null
}

/** Loads the CodeMirror support for a language id, or null when unknown. */
export async function loadLanguage(id: string | null): Promise<LanguageSupport | null> {
  if (id === null) return null
  const entry = ENTRIES.find((candidate) => candidate.id === id)
  return entry ? entry.description.load() : null
}
