# Changelog

All notable changes to Seam are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The changes list can group its files into a folder tree, so a deep working
  tree folds away instead of pushing the files around it out of reach. The
  toggle beside the list's count switches between the tree and the flat list,
  and Seam remembers the choice.

### Changed

- The diff viewer is read-only in both layouts. It still shows the working copy
  and stages hunks from its margin, but it no longer accepts typing, so a file
  changes only from outside the viewer or through the staging actions.

### Fixed

- Resizing the history panel or its graph column follows the cursor on Windows
  through WSLg again. The drag now listens to plain mouse moves as well as
  pointer moves, so a session that delivers the press but loses the
  `pointermove` events no longer leaves both handles stuck.
- The right-click menus of a changed file, a local branch and a conflict region
  open from the right-button press as well as from the `contextmenu` event,
  which WSLg and some Wayland sessions drop. A secondary press no longer closes
  the menu it is opening.

## [0.5.1] - 2026-11-24

### Changed

- Lanes sit 16 px apart instead of 20, so more parallel branches fit in the
  same graph width.

### Fixed

- A connection between distant lanes in the history graph no longer thins into
  a hairline as it moves sideways. A line that crosses four or more lanes runs
  horizontally on a whole pixel between two short curves, so it keeps the same
  weight as a vertical lane.
- The history graph can use every pixel the list has to spare, so a repository
  with many parallel branches, such as Symfony, shows all of its lanes instead
  of clipping the rightmost ones.

## [0.5.0] - 2026-11-20

### Added

- The Pull button shows how many commits the upstream has that the current
  branch lacks, the same way the Push button counts the commits it would send.
  Seam fetches on its own when a repository opens and when the window regains
  focus, at most once every five minutes, so the count is current without
  pressing Fetch first.
- The history graph keeps `main`/`master` in the leftmost column and
  `develop`/`dev` beside it, each with a fixed colour in every palette. Lanes no
  longer move sideways, so a branch is seen leaving the trunk and joining it
  again, and the edges curve smoothly between rows.

### Changed

- The history list no longer draws a separator between rows; the row under the
  pointer is highlighted instead.

### Fixed

- Local and remote branch folders that share a path fold independently instead
  of folding together.

## [0.4.0] - 2026-11-17

### Added

- Branches and tags appear as pills beside their commit node in the history
  graph. Local branches, remote branches and tags all use the same pill, the
  graph column widens to fit them, and the full names stay in the tooltip when
  the column is too narrow.
- The README screenshots are regenerated with the current interface, including
  a full-width commit history that shows the branch and tag pills.

### Fixed

- Resizing the history panel or its graph column keeps working on Linux
  sessions and WSLg, where the handle can lose the pointer capture as soon as
  the cursor leaves it, and a drag ends when the window loses focus instead of
  following the pointer.

## [0.3.1] - 2026-11-15

### Fixed

- The worktree manager works again on the Git 2.30 to 2.35 releases that Seam
  supports. The list command no longer asks for `-z`, which `git worktree list`
  only learned in 2.36, and the lock reason and prune state are read from Git's
  worktree records when the older releases do not print them. Paths and lock
  reasons Git has to quote still parse.

## [0.3.0] - 2026-11-15

### Added

- The commit history reads in pages of 500 and loads the next one when the
  list reaches its end, so a large repository can be browsed back to its first
  commit.
- The commit graph's column can be dragged wider or narrower, and a double
  click restores its automatic width. The lanes keep their spacing, so a narrow
  column hides the rightmost ones instead of squeezing them.
- Three commit graph palettes — Classic, High contrast and Pastel — in Settings.
- Local branches can be renamed or deleted from the branch menu's right-click
  menu; the Branch dialog only creates them.
- Settings can list the branch menu ascending, in Git's order, or descending,
  so the newest numbered branch comes first.
- Repository tabs carry the repository's initial, so narrow tabs stay
  recognisable.

### Changed

- The history rows are half as tall, and the sidebar shows only the date and
  the message; the author, hash and full date appear in the full-width view.
- Lane colours follow the branch a line comes from across joins, instead of
  switching to the colour of the lane it merges into.

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
