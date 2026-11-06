// SPDX-License-Identifier: MIT

/**
 * Prints the CHANGELOG section for the version in package.json, so the release
 * workflow can use it as the GitHub Release body. Run with `npm run release:notes`.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')

const heading = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\].*$`, 'm')
const start = changelog.search(heading)
if (start === -1) {
  console.error(`CHANGELOG.md has no section for ${version}`)
  process.exit(1)
}

const rest = changelog.slice(start)
const next = rest.slice(1).search(/^## \[/m)
const section = next === -1 ? rest : rest.slice(0, next + 1)

process.stdout.write(`${section.trim()}\n`)
