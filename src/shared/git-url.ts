// SPDX-License-Identifier: MIT

/** GitHub's web routes that can follow `owner/repository`. */
const GITHUB_REPOSITORY_ROUTES = new Set([
  'actions',
  'activity',
  'archive',
  'attestations',
  'blame',
  'blob',
  'branches',
  'codespaces',
  'commit',
  'commits',
  'community',
  'compare',
  'contributors',
  'dependency-graph',
  'deployments',
  'discussions',
  'environments',
  'forks',
  'graphs',
  'issues',
  'labels',
  'milestones',
  'network',
  'packages',
  'projects',
  'pull',
  'pulls',
  'pulse',
  'raw',
  'releases',
  'security',
  'settings',
  'stargazers',
  'tags',
  'tree',
  'watchers',
  'wiki'
])

/**
 * Reduces a GitHub web address to the repository Git can clone. A URL copied
 * from a branch, a file, an issue or a release page carries those pages' paths
 * after `owner/repository`; they are not part of the clone URL.
 *
 * Only GitHub is rewritten. Other hosts keep the address exactly as given,
 * because their repository paths cannot be inferred safely from a general
 * shape, and an SSH or scp-like address is already a clone URL.
 */
export function normalizeRepositoryUrl(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '') return ''

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return trimmed
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return trimmed
  if (
    parsed.hostname.toLowerCase() !== 'github.com' &&
    parsed.hostname.toLowerCase() !== 'www.github.com'
  ) {
    return trimmed
  }

  const segments = parsed.pathname.split('/').filter((segment) => segment !== '')
  const owner = segments[0]
  const repository = segments[1]?.replace(/\.git$/i, '')
  if (owner === undefined || repository === undefined || repository === '') return trimmed

  if (segments.length > 2) {
    const route = segments[2]?.toLowerCase()
    if (route === undefined || !GITHUB_REPOSITORY_ROUTES.has(route)) return trimmed
  }

  return `${parsed.protocol}//${parsed.host}/${owner}/${repository}`
}
