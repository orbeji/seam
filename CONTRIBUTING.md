# Contributing to Seam

Thanks for helping. Seam is a small Electron application with a deliberately
plain structure: the Git and merge logic lives in `src/core`, the Electron main
process in `src/main`, the React interface in `src/renderer`, and the types
shared across the boundary in `src/shared`.

## Prerequisites

- Node.js 22 or newer
- Git 2.30 or newer on the `PATH`
- On Linux, `xvfb` for the end-to-end suite (`sudo apt install xvfb`)

## Set up

```bash
npm install
npm run dev
```

`npm run dev` starts the three Electron processes with hot reload for the
renderer.

## Checks before opening a pull request

```bash
npm run lint
npm run format:check
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
```

- `format` rewrites the files with Prettier.
- `test:unit` is the only suite CI runs in the fast check job. It never starts
  Git or Electron.
- `test:integration` drives the real `git` executable in throwaway
  repositories. Name a test file `*.integration.test.ts`.
- `test:e2e` builds the application and drives it with Playwright. Name a test
  file `*.e2e.ts`. On a headless Linux machine run it under `xvfb-run -a`.

CI runs the unit, integration and end-to-end suites on Windows and Ubuntu, and
the integration suite once more against Git 2.30.

## Code style

- TypeScript strict mode is on for the Node and web projects.
- ESLint enforces the import direction: `core` may not import `main` or
  `renderer`; `renderer` may not import `main` or `core/git`. Shared contracts
  live in `src/shared`.
- The Git layer runs the real `git` executable. Do not reimplement a command
  unless Git cannot expose the data the interface needs; the diff and the
  three-way merge are the two exceptions.
- Keep user-visible text in the translation catalogs, never in a component.
- The comments explain _why_ a decision exists, not what the next line does.
  Match the density and tone of the surrounding file.

## Adding a language

1. Copy `src/renderer/i18n/locales/en.json` to a new file named with the
   language's ISO 639-1 code (`fr.json`, for example).
2. Translate every value. Leave Git terms such as `push`, `pull`, `merge`,
   `commit`, `rebase` and `stash` in English; that is how they are used in the
   industry.
3. Add the code to `SUPPORTED_LANGUAGES` and the catalog map in
   `src/renderer/i18n/index.ts`.
4. Run `npm run test:unit`. `catalog.test.ts` fails if a key is missing or
   empty in any catalog.

## Packaging

```bash
npm run pack        # unpacked application in release/ (fast, useful to test)
npm run dist:linux  # AppImage and .deb
npm run dist:win    # NSIS installer
```

The configuration is in `electron-builder.yml`; icons for the three targets are
in `build/`. Git is not bundled in 0.2.0. The `.deb` declares it as a
dependency, and on Windows Seam looks for it on the `PATH` and in the usual Git
for Windows install folders.

## Releases

1. Update `CHANGELOG.md` and the version in `package.json` (they must match).
2. Commit and tag: `git tag -a v0.2.0 -m "Seam 0.2.0"`.
3. Push the tag: `git push origin v0.2.0`.
4. The release workflow builds both installers, runs the package smoke test,
   computes the SHA-256 checksums, and creates a **draft** GitHub Release.
5. Review the draft and publish it by hand.

The workflow refuses a tag that does not match `package.json`.
