# Changelog

All notable changes to Seam are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-12

### Added

- Worktrees: a manager that lists every worktree with its pending changes and
  opens one as its own tab. A worktree can be created on an existing branch, a
  new branch or a detached HEAD, and moved, locked, unlocked, repaired, pruned
  or removed.
- Merging one worktree's branch into another branch from the worktree manager,
  with the option to remove the source worktree once the merge finishes.
- The branch menu lists the registered worktrees and hides branches checked out
  in another worktree, so a branch is never checked out twice.
- The commit history can fill the window from a button in its header. The same
  button returns to the split with the file sidebar and the diff.

### Notes

- The 0.2.0 Windows installer is unsigned, so SmartScreen shows an unknown
  publisher warning. Verify the download with the published SHA-256 checksum.
- Git is still not bundled. Seam uses the Git installed on the machine; the
  `.deb` package declares `git` as a dependency.

## [0.1.0] - 2026-11-06

The first public version. Seam is a desktop Git client for Windows and Linux
that drives the system `git` executable, so hooks, credential helpers,
attributes and configuration behave as they do in a terminal.

### Added

- Opening a repository from the folder picker or with `seam --repo <path>`, a
  recent-repository list, tabs, and cloning from a URL.
- The four changes lists: staged, unstaged, untracked and conflicted, with file
  badges, refresh on external changes and a per-file diff viewer.
- A side-by-side diff viewer with syntax highlighting for common languages,
  whitespace comparison, change collapsing, word-level highlighting and line
  numbers.
- Staging and unstaging whole files, hunks and individual lines, plus
  discarding working-tree changes.
- The commit box: message drafts, previous messages, commit templates,
  amend, `Signed-off-by`, hooks with their output, and the CRLF warning with
  Fix and Commit / Commit As Is.
- Branch creation, rename, deletion and checkout, a commit graph with refs,
  and detached checkout of any commit.
- Merging with a real merge commit, fast-forward only or squash, and a
  conflict list that accepts one side or resolves every simple conflict.
- A three-pane merge editor for conflicts, with editable result, line-level
  ribbons and streaming.
- Finish, skip and abort for merge, rebase, cherry-pick, revert and conflicted
  stash pop.
- Push with upstream selection, tags, `--force-with-lease`, live output,
  cancellation, and recovery from a rejected push by rebasing or merging.
- Fetch and pull from the top bar.
- GitFlow: initialise master/develop and prefixes, start feature, release and
  hotfix branches, finish them, and resume a finish that stopped on a conflict.
- Interface in English, Spanish and Catalan, dark and light themes, and
  persistent settings for hooks, whitespace, highlighting, syntax colours and
  collapsed changes.
- A startup check that explains how to install Git when it is missing or older
  than 2.30.
- Installers: NSIS for Windows, AppImage and `.deb` for Linux, built with
  electron-builder.
- GitHub Actions for continuous integration and a draft GitHub Release on every
  `v*` tag, with SHA-256 checksums.

### Notes

- The 0.1.0 Windows installer is unsigned, so SmartScreen shows an unknown
  publisher warning. Verify the download with the published SHA-256 checksum.
- Git is not bundled. Seam uses the Git installed on the machine; the `.deb`
  package declares `git` as a dependency. Windows installs are detected on the
  `PATH` and in the usual Git for Windows folders.
- Automatic updates, macOS, Flatpak and Snap are not part of this version. See
  [docs/limitaciones.md](docs/limitaciones.md).

[0.2.0]: https://github.com/orbeji/seam/releases/tag/v0.2.0
[0.1.0]: https://github.com/orbeji/seam/releases/tag/v0.1.0
