# Seam

A desktop Git client for Windows and Linux with a staging-area commit flow,
diff viewer and three-pane conflict resolver.

Seam drives the real `git` executable as a child process instead of
reimplementing it, so hooks, configuration, credential helpers and attributes
behave exactly as they do in the terminal. The three-way merge engine and the
line-level diff are the only parts written from scratch, because Git does not
expose the regions the merge editor needs.

## Status

Phase 2 (merge engine). Phases 0 and 1 are done.

Phase 0 lays the foundations: the window opens over a chosen folder and lists
its staged, unstaged, untracked and conflicting changes, read through the real
`git` executable. The interface is translated into English and Spanish, and the
language is detected from the system.

Phase 1 adds the line-level diff engine and its viewer: side-by-side and unified
modes over CodeMirror, word and character diffs, the whitespace options,
collapsed unchanged blocks, and language detection.

Phase 2 adds the three-way merge engine in `src/core/merge`, with no interface.
Given a base and the two sides it builds the merge regions, classifies them
(left-only, right-only, same, conflict), and exposes the operations that build
the result (apply the non-conflicting regions, accept, ignore, revert, resolve
simple conflicts). It is checked against the real `git merge-file -p` with
thousands of random cases, and its own invariants (the sides must be
reconstructible from the regions, and the result ranges must stay sound) hold
over thousands more.

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
