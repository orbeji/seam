// SPDX-License-Identifier: MIT

import { normalizeRepositoryUrl } from '../../shared/git-url'

/**
 * The folder Git would create for a URL: the last path segment without a
 * trailing `.git`. A GitHub branch, file or issue page is reduced to its
 * repository first, so the folder is named after the repository, not the page.
 */
export function repositoryNameFromUrl(url: string): string {
  const withoutTail = normalizeRepositoryUrl(url).replace(/[\\/]+$/, '')
  const withoutQuery = withoutTail.split(/[?#]/)[0] ?? ''
  if (withoutQuery === '') return ''

  const parts = withoutQuery.split(/[\\/:]/).filter((part) => part !== '')
  const last = parts[parts.length - 1] ?? ''
  const name = last.replace(/\.git$/i, '')
  return name === '.' || name === '..' ? '' : name
}

/**
 * Joins a parent folder and a repository name with the separator the parent
 * already uses, so a Windows path stays a Windows path. A trailing separator on
 * the parent is not repeated.
 */
export function cloneTarget(parent: string, repositoryName: string): string {
  const trimmed = parent.trim()
  if (trimmed === '' || repositoryName === '') return ''

  const base = trimmed.replace(/[\\/]+$/, '')
  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/'
  return `${base}${separator}${repositoryName}`
}
