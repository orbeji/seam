// SPDX-License-Identifier: MIT

import { statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where Git for Windows installs itself. The PATH is checked first, because a
 * user who keeps another build (Git from Scoop, Chocolatey or a portable copy)
 * expects that one to win. These are only fallbacks for the common installer,
 * which puts `git.exe` under `cmd` and leaves `cmd` out of the PATH when the
 * "Git from the command line and also from 3rd-party software" option is not
 * chosen.
 */
const WINDOWS_INSTALL_PATHS = [
  ['Git', 'cmd', 'git.exe'],
  ['Git', 'bin', 'git.exe']
] as const

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** Every place a Windows install may keep `git.exe`, in the order to try. */
export function windowsGitCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const extensions = (env['PATHEXT'] ?? '.EXE;.CMD;.BAT')
    .split(';')
    .filter((extension) => extension !== '')
    .map((extension) => extension.toLowerCase())
  const names = extensions.map((extension) => `git${extension}`)

  const fromPath = (env['PATH'] ?? '')
    .split(';')
    .filter((directory) => directory !== '')
    .flatMap((directory) => names.map((name) => join(directory, name)))

  const roots = [
    env['ProgramFiles'],
    env['ProgramFiles(x86)'],
    env['LOCALAPPDATA'] === undefined ? undefined : join(env['LOCALAPPDATA'], 'Programs')
  ].filter((root): root is string => root !== undefined && root !== '')

  const fromInstaller = roots.flatMap((root) =>
    WINDOWS_INSTALL_PATHS.map((segments) => join(root, ...segments))
  )

  return [...fromPath, ...fromInstaller]
}

/**
 * The Git executable Seam should run. On Linux and macOS the PATH is the only
 * location, so `git` is returned and the runner reports a clear error when it
 * is missing. On Windows the PATH and the usual installer folders are tried so
 * a normal install is found even when its `cmd` folder is not on the PATH.
 */
export function findGitExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (platform !== 'win32') return 'git'

  for (const candidate of windowsGitCandidates(env)) {
    if (isFile(candidate)) return candidate
  }
  return null
}
