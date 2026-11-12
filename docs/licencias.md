# Dependency licences

Checked on 2026-11-12 for Seam 0.2.0.

The application is MIT-licensed. Its dependency tree may only contain licences
that allow redistribution in a proprietary or MIT project and do not impose a
copyleft obligation on Seam's source. The check runs in CI with:

```bash
npm run licenses:check
```

`license-checker-rseidelsohn` fails if it finds a licence outside this
allowlist: MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, CC0-1.0,
Unlicense, Python-2.0, BlueOak-1.0.0, CC-BY-3.0, CC-BY-4.0 and WTFPL.

## Shipped runtime dependencies

The packages inside the installer's asar (`--production`):

| Licence    | Packages |
| ---------- | -------: |
| MIT        |       52 |
| Apache-2.0 |        1 |

The Apache-2.0 package is `@codemirror/*`; Apache 2.0 is compatible with an MIT
application as long as its notices are kept. Electron itself bundles Chromium
(BSD-style and other permissive licences) and Node.js (MIT); their licence
files are copied into the installer by electron-builder as
`LICENSES.chromium.html` and `LICENSE.electron.txt`.

## Full tree, including development tools

| Licence                    | Packages |
| -------------------------- | -------: |
| MIT                        |      506 |
| ISC                        |       90 |
| Apache-2.0                 |       32 |
| BSD-2-Clause               |       13 |
| BlueOak-1.0.0              |       13 |
| BSD-3-Clause               |       12 |
| Python-2.0                 |        1 |
| CC-BY-4.0                  |        1 |
| CC-BY-3.0                  |        1 |
| CC0-1.0                    |        1 |
| 0BSD                       |        1 |
| WTFPL                      |        1 |
| Compound permissive forms  |        4 |

No GPL, AGPL, LGPL, MPL or other copyleft licence is present. All the licences
above allow redistribution inside an MIT project; the attribution files of the
bundled packages travel with the application as electron-builder includes them.

## Reviewing again

Run `npm run licenses` for the full report, or `npm run licenses -- --summary`
for the counts. Re-run the check whenever a dependency is added or upgraded,
and before a release.
