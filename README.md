# Seam

Seam is a desktop Git client for Windows and Linux with a graphical interface.
It covers the everyday flow (staging, commits, branches, merges and push) and
adds a dedicated three-pane merge conflict resolver for when a merge, rebase,
cherry-pick or stash pop stops. A diff viewer is built into both.

Seam drives the real `git` executable as a child process instead of
reimplementing it, so hooks, configuration, credential helpers and attributes
behave exactly as they do in the terminal. The three-way merge engine and the
line-level diff are the only parts written from scratch, because Git does not
expose the regions the merge editor needs.

## Status

Phases 0 to 8 are implemented, along with branches, merges and GitFlow: the
repository and change list, the diff viewer, the three-way merge engine,
staging, commits, the conflict list, the merge editor, finish and abort for
merge, rebase, cherry-pick and stash pop, push, and the branch operations.
Phase 9 (packaging and the 0.1.0 release) is still pending.

## Requirements

- Node.js 22 or newer
- Git 2.30 or newer on the `PATH`

## Scripts

| Command                    | What it does                                           |
| -------------------------- | ------------------------------------------------------ |
| `npm run dev`              | Starts the app with hot reload for all three processes |
| `npm run build`            | Type-checks and builds the production bundles          |
| `npm run start`            | Previews the production build                          |
| `npm run typecheck`        | Runs `tsc --noEmit` for the Node and web projects      |
| `npm run lint`             | Runs ESLint                                            |
| `npm run format`           | Formats with Prettier                                  |
| `npm test`                 | Runs the unit and integration suites once              |
| `npm run test:unit`        | Runs the unit suite (the one CI runs)                  |
| `npm run test:integration` | Runs the suite that drives real `git`                  |
| `npm run test:e2e`         | Builds and runs the Playwright smoke test              |

The unit suite never starts Git or Electron, so GitHub Actions runs only
`npm run test:unit`. Name a test that needs either one
`*.integration.test.ts` or `*.e2e.ts`; those suites are local only. The
integration suite needs Git on the `PATH`; the end-to-end suite launches the
built application and needs a display. Run both locally, under `xvfb-run` on a
headless Linux machine.

## Opening a repository

Use **Open repository…** to pick a folder; Seam remembers the ten most recent
ones. From a shell, `seam --repo <path>` opens a repository directly.

## Branches, merges and GitFlow

The top bar groups the branch actions before the remote ones:

- **Branch** creates a local branch from HEAD, another branch or a tag, and
  renames or deletes an existing one. Deleting refuses to throw away unmerged
  commits unless the force box is ticked.
- **Merge** merges a local or remote branch into the checked-out one. The
  strategy is a real merge commit (`--no-ff`), a fast-forward only, or a
  squash that leaves the changes staged for the next commit.
- **GitFlow** is one dynamic popup driven by plain `git`. With no
  configuration it asks for the master, develop and prefix names. On a
  feature, release or hotfix branch it offers the finish for that branch; on
  any other branch it starts a new one. A feature is merged into develop; a
  release or hotfix is merged into master, tagged, merged back into develop and
  deleted.

The GitFlow configuration lives in the repository's local Git config, so a
terminal clone keeps working with it. If a finish stops on a conflict, the
remaining steps are stored in `.git/seam/gitflow-finish.json`; resolving the
merge and committing resumes the finish from the popup or on its own.

## Layout

```text
src/
  core/       pure TypeScript, no Electron or DOM (git, diff, merge, text)
  main/       Electron main process
  preload/    typed bridge exposed to the interface
  renderer/   React interface and i18n catalogs
  shared/     IPC types shared by every layer
test/
  fixtures/   scripts that build sample repositories
  *.integration.test.ts  tests that drive real Git
  e2e/        Playwright tests
docs/         specification, implementation plan and screen designs
```

The import rules between `core`, `main` and `renderer` are enforced by ESLint.

## Licence

[MIT](./LICENSE)
