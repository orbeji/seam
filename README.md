# Seam

A desktop Git client for Windows and Linux with a staging-area commit flow,
diff viewer and three-pane conflict resolver.

Seam drives the real `git` executable as a child process instead of
reimplementing it, so hooks, configuration, credential helpers and attributes
behave exactly as they do in the terminal. The three-way merge engine and the
line-level diff are the only parts written from scratch, because Git does not
expose the regions the merge editor needs.

## Status

Phase 0 (foundations). The window opens over a chosen folder and lists its
staged, unstaged, untracked and conflicting changes, read through the real `git`
executable. The interface is translated into English and Spanish, and the
language is detected from the system.

## Requirements

- Node.js 22 or newer
- Git 2.30 or newer on the `PATH`

## Scripts

| Command             | What it does                                           |
| ------------------- | ------------------------------------------------------ |
| `npm run dev`       | Starts the app with hot reload for all three processes |
| `npm run build`     | Type-checks and builds the production bundles          |
| `npm run start`     | Previews the production build                          |
| `npm run typecheck` | Runs `tsc --noEmit` for the Node and web projects      |
| `npm run lint`      | Runs ESLint                                            |
| `npm run format`    | Formats with Prettier                                  |
| `npm test`          | Runs the Vitest suite once                             |
| `npm run test:e2e`  | Builds and runs the Playwright smoke test              |

`npm run test:e2e` launches the built application, so it needs a display. On a
headless Linux machine run it under `xvfb-run`.

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
  e2e/        Playwright tests
docs/         specification, implementation plan and screen designs
```

The import rules between `core`, `main` and `renderer` are enforced by ESLint.

## Licence

[MIT](./LICENSE)
