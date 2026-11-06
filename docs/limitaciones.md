# What Seam 0.1.0 does not do

This page records the limits of the first version so nobody expects a feature
that is not there. It is a map, not a promise of order: the next version will
pick from it.

## Missing from the first version

- **Starting a rebase, cherry-pick, revert or stash pop.** Seam detects them
  when they are already running (for example, after a `git pull --rebase` in a
  terminal) and can finish, skip or abort them, but it does not start them.
- **Interactive rebase.** There is no todo editor, no reword, squash or drop.
- **Starting a stash.** A conflicted stash pop can be resolved, but Seam does
  not run `git stash`.
- **Remote management.** Remotes are read from the repository; adding,
  renaming or removing one is done with `git remote` in a terminal.
- **Repository creation and GitHub/GitLab integration.** Seam opens and clones
  repositories; it does not create them, list issues, or open pull requests.
- **Credentials and SSH keys.** Seam delegates to Git's credential helper and
  never asks for or stores a password. A credential helper that needs a GUI
  prompt must be configured in Git itself.
- **Bundled Git.** The installers use the system Git. The `.deb` declares it as
  a dependency; on Windows Seam looks on the `PATH` and in the usual Git for
  Windows folders. A missing Git shows a help screen with a download link.
- **Code signing.** The Windows installer is unsigned, so SmartScreen warns
  about an unknown publisher. The release publishes a SHA-256 checksum so the
  download can be verified.
- **Automatic updates.** A new version is installed by downloading and running
  the new installer.
- **macOS, Flatpak and Snap.** 0.1.0 ships NSIS for Windows and AppImage and
  `.deb` for Linux.
- **Submodules, Git LFS, worktrees and sparse checkout.** These repositories
  can be opened, but the specialised views and commands are not implemented.
- **Binary conflicts.** A binary file that conflicts can be accepted from one
  side, but the three-pane editor only edits text.
- **Blame, file history, search and file-level checkout.** The graph shows the
  commit history; it does not trace one line or one path through it.
- **Multiple repositories in one operation.** Tabs hold several repositories,
  but fetch, pull and push act on the active one.

## Platform notes

- **AppImage and FUSE.** Some distributions do not install FUSE 2 by default.
  Either install `libfuse2` or use the `.deb`, which depends on Git and the
  Electron runtime libraries.
- **Git 2.30 or newer.** Older versions are refused with a clear message. The
  integration suite runs against 2.30 in CI to keep that promise honest.
- **Hooks.** Hooks run by default, with their output shown in the commit box.
  A hook that needs a terminal may wait; Cancel kills its process tree. Hooks
  can be turned off in Settings.
- **Large files.** Above the viewer's threshold, inline highlighting and some
  decorations are reduced to keep scrolling responsive.

## Data and privacy

- Seam runs no telemetry and makes no network request of its own. Git talks to
  the remotes the user configured.
- Recent repositories, commit drafts, commit history, settings and GitFlow
  finish state live under Electron's user-data folder. The GitFlow finish state
  additionally lives in `.git/seam/` inside the repository so it survives a
  restart and can be resumed from a terminal clone.
- Uninstalling Seam does not delete the user-data folder. On Windows the
  uninstaller leaves it alone on purpose; on Linux remove
  `~/.config/Seam` to clear it.
