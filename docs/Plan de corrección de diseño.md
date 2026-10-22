# Plan de corrección de diseño

Alinear la interfaz con los cuatro mockups de `docs/seam_screen_designs.html`: ventana principal, diálogo de conflictos, editor de merge y staging línea a línea. La corrección es visual y estructural; no cambia la lógica de Git, IPC ni el comportamiento de staging/commit.

> Referencia: en `docs/` no hay imágenes sueltas. Los mockups están embebidos en `seam_screen_designs.html` y se pueden abrir directamente en un navegador. Las medidas y colores de este plan salen de esos mockups.

## Estado

- [x] Fase 0: base visual (tokens, tipografía IBM Plex local, estilos de controles).
- [x] Fase 1: shell de la ventana principal (topbar, sidebar, work area, pestaña y barra de estado).
- [x] Fase 2: lista de cambios y commit box (el contador de hunks se omite hasta tener el dato).
- [x] Fase 3: pestaña y toolbar del diff.
- [x] Fase 4: diálogo de conflictos en tabla.
- [x] Fase 5: staging línea a línea.
- [x] Fase 6: editor de merge.

## Diagnóstico

La app actual funciona, pero su presentación es la de un dashboard vertical:

- No hay barra superior, sidebar fijo, pestaña de archivo ni barra de estado.
- El commit box ocupa todo el ancho y está encima de las listas.
- Los cambios se muestran como tarjetas en un grid de tres columnas.
- El acento es azul y la tipografía es del sistema; el diseño usa ámbar e IBM Plex.
- El visor de diff no tiene la toolbar segmentada ni la navegación de diferencias del mockup.
- El diálogo de conflictos es una lista de tarjetas, no una tabla.
- La vista de tres paneles usa `HEAD / Index / Working copy` en lugar de `Yours / Result / Theirs`.

El objetivo es volver al layout de IDE del mockup sin reescribir la lógica existente.

## Principios

1. **No tocar el comportamiento.** Los handlers, el estado de React, las llamadas IPC y los comandos Git se conservan.
2. **Mantener los `data-testid`.** Los tests de extremo a extremo dependen de ellos.
3. **Cambios incrementales.** Cada fase debe dejar la app ejecutable y con los tests en verde.
4. **Un solo sistema visual.** Colores, tipografía, alturas y radios salen de tokens compartidos, no de valores sueltos por componente.
5. **Fidelidad al mockup, no invención.** Si el mockup no muestra una función existente (por ejemplo, el autor del commit), se integra de forma discreta sin romper la jerarquía visual.

## Tokens de diseño

| Token | Valor | Uso |
| --- | --- | --- |
| `--bg` | `#17181b` | Fondo general y panel de diff |
| `--panel` | `#1b1c20` | Sidebar, barras secundarias |
| `--bar` | `#1e2024` | Barra superior, cabeceras, pie |
| `--control` | `#25272c` | Botones e inputs |
| `--control-hover` | `#33363d` | Hover y controles activos |
| `--border` | `#2a2c32` | Separadores normales |
| `--border-strong` | `#3a3d44` | Bordes de controles |
| `--text` | `#e6e7ea` | Texto principal |
| `--muted` | `#9a9ea8` | Texto secundario |
| `--dim` | `#8b909a` | Rutas y metadatos |
| `--accent` | `#e8a33d` | Marca, botón primario, selección |
| `--accent-ink` | `#17181b` | Texto sobre ámbar |
| `--blue` | `#5b9cf0` | Cambios modificados |
| `--green` | `#3fb27f` | Añadidos y estados resueltos |
| `--red` | `#f0674f` | Conflictos y errores |
| `--purple` | `#c4a0ee` | Palabras clave de sintaxis |

Tipografía y medidas:

- UI: `IBM Plex Sans`, con fallback a `system-ui` y sans-serif.
- Código: `IBM Plex Mono`, con fallback a `ui-monospace`.
- Texto UI: 13 px, línea 1,4.
- Código: 12,5 px, línea 20–24 px.
- Barra superior: 40 px.
- Cabecera de sección: 38–44 px.
- Filas de archivo: 30 px.
- Filas de tabla de conflictos: 56 px.
- Controles: 26–34 px de alto; radio de 6 px.
- Barra de estado: 24–30 px.
- Sin padding global de 24/32 px: el layout ocupa toda la ventana.

Fuentes: incluir IBM Plex Sans y Mono como `.woff2` locales en `src/renderer/assets/fonts/` y declararlas con `@font-face`. No usar Google Fonts en tiempo de ejecución porque la CSP de `index.html` bloquea recursos externos.

## Fases de trabajo

### Fase 0: base visual

Objetivo: dejar los cimientos sin cambiar la estructura de la app.

| # | Tarea | Archivos | Resultado |
| --- | --- | --- | --- |
| 0.1 | Sustituir las variables y estilos globales por los tokens del mockup | `src/renderer/styles.css` | Fondo, texto, bordes y acento correctos |
| 0.2 | Añadir IBM Plex Sans/Mono local y sus `@font-face` | `src/renderer/assets/fonts/`, `styles.css` | La UI usa la tipografía del diseño aunque no haya red |
| 0.3 | Normalizar botones, inputs, selects, checkboxes y focos | `styles.css` | Alturas, radios y estados coherentes |
| 0.4 | Igualar el tema de CodeMirror a los colores del diff | `src/renderer/diff/DiffView.tsx` | Añadido verde, modificado azul, borrado gris |
| 0.5 | Revisar contraste y foco visible | `styles.css` | Navegación con teclado legible |

Criterio: la app se ve oscura y ámbar, sin azul como color primario, y sigue compilando.

### Fase 1: shell de la ventana principal

Objetivo: pasar del layout vertical al layout de IDE del mockup.

Estructura de destino:

```text
┌──────────────────────────────────────────────────────────────┐
│ TopBar: logo · repo · rama · refrescar · idioma/ajustes      │ 40 px
├───────────────────────┬──────────────────────────────────────┤
│ Sidebar               │ Work area                            │
│ Changes · N files     │ pestaña del archivo                  │ 34 px
│ Staged                │ toolbar del diff                     │ 40 px
│ Unstaged              │ cabecera HEAD / Working copy         │ 26 px
│ Untracked             │ diff                                 │
│                       │                                      │
│ Commit box            │                                      │
├───────────────────────┴──────────────────────────────────────┤
│ Status bar: hunks · lenguaje · codificación · EOL            │ 24–30 px
└──────────────────────────────────────────────────────────────┘
```

| # | Tarea | Archivos | Resultado |
| --- | --- | --- | --- |
| 1.1 | Crear `TopBar` con logo, selector de repositorio, rama, refrescar e idioma | `App.tsx`, `components/TopBar.tsx`, `styles.css` | Barra superior de 40 px |
| 1.2 | Reorganizar `App` en topbar + body + status bar | `App.tsx` | Sin título/tagline ni padding de dashboard |
| 1.3 | Sidebar fijo de 400 px con `ChangesView` y `CommitBox` | `App.tsx`, `styles.css` | Commit box al fondo del sidebar |
| 1.4 | Mover repositorios recientes a un desplegable del selector de repo | `TopBar.tsx` | No ocupan espacio permanente |
| 1.5 | Work area: pestaña del archivo, contenido y estado vacío | `App.tsx`, `components/WorkArea.tsx` | El diff ya no sustituye toda la app |
| 1.6 | Barra de estado global | `components/StatusBar.tsx` | Hunks y metadatos abajo |
| 1.7 | Conservar carga, error, operación en curso y avisos | `App.tsx` | Mismo comportamiento, nueva posición |

Criterio: con un archivo seleccionado se ven sidebar y diff a la vez, como en el mockup; sin archivo, el work area muestra un estado vacío.

### Fase 2: lista de cambios y commit

Objetivo: reproducir las secciones y el panel de commit del sidebar.

| # | Tarea | Archivos | Resultado |
| --- | --- | --- | --- |
| 2.1 | Cambiar el grid de tarjetas por secciones apiladas | `changes/ChangesView.tsx`, `styles.css` | `Staged`, `Unstaged`, `Untracked` y conflictos en columna |
| 2.2 | Cabecera de sección con chevron, título, contador y acción | `ChangesView.tsx` | Cabeceras de 30 px con `Stage all` / `Unstage all` |
| 2.3 | Filas de archivo: badge, nombre, directorio y acción de icono | `ChangesView.tsx`, `changes/entry-view.ts` | Filas compactas de 30 px; ruta separada en nombre/directorio |
| 2.4 | Contador de hunks por archivo | `ChangesView.tsx` + dato nuevo si hace falta | `5 hunks` junto al archivo; si no hay dato, se omite en la primera iteración |
| 2.5 | Commit box compacto al fondo del sidebar | `commit/CommitBox.tsx`, `styles.css` | Mensaje, opciones y botón primario a ancho completo |
| 2.6 | Botón primario con número de archivos | `CommitBox.tsx`, i18n | `Commit 2 staged files` / `Confirmar 2 archivos` |
| 2.7 | Texto de ayuda bajo el botón | `CommitBox.tsx`, i18n | “Commit uses staged changes only…” |
| 2.8 | Historial y autor sin romper la jerarquía | `CommitBox.tsx` | Historial como botón pequeño; autor en una fila secundaria |
| 2.9 | Mantener `data-testid` de secciones, filas, acciones y commit | `ChangesView.tsx`, `CommitBox.tsx` | Tests existentes sin cambios |

Criterio: el sidebar se parece al mockup y las acciones de staging siguen funcionando igual.

### Fase 3: pestaña y toolbar del diff

Objetivo: que el panel derecho tenga la misma jerarquía que el mockup.

| # | Tarea | Archivos | Resultado |
| --- | --- | --- | --- |
| 3.1 | Pestaña del archivo: badge, nombre, directorio, cerrar | `App.tsx`, `diff/DiffView.tsx` | Pestaña de 34 px; `diff-path` y `diff-close` viven en la pestaña |
| 3.2 | Toolbar de 40 px con `Side-by-side` / `Unified` segmentado | `DiffView.tsx`, `styles.css` | Segmentos visibles; el selector nativo queda oculto para los tests |
| 3.3 | `Highlight: Words`, `Whitespace: None` y `Collapse` como controles del mockup | `DiffView.tsx` | Misma funcionalidad, aspecto de botón/desplegable |
| 3.4 | Contador `Difference N of M` y flechas anterior/siguiente | `DiffView.tsx`, i18n | Navegación visible en la toolbar |
| 3.5 | Cabecera de versiones read-only / editable | `DiffView.tsx` | Cabecera de columnas de 26 px; usa la versión real comparada |
| 3.6 | Mover `Close` a la pestaña o a un icono | `App.tsx` | Menos ruido en la toolbar |
| 3.7 | Popup de hunk con el estilo del mockup | `DiffView.tsx`, `styles.css` | Fondo `#25272c`, borde `#4b4f58`, sombra |
| 3.8 | Barra de estado del archivo | `App.tsx`, `DiffView.tsx` | Hunks preparados/pendientes y lenguaje detectado; EOL/encoding no lo expone el IPC actual |

Criterio: la toolbar y la pestaña se reconocen como el mockup y las opciones siguen cambiando el diff.

### Fase 4: diálogo de conflictos en tabla

Objetivo: convertir la lista de tarjetas en la tabla del mockup.

| # | Tarea | Archivos | Resultado |
| --- | --- | --- | --- |
| 4.1 | Estructura de tabla: `File`, `Kind`, `Status`, `Resolve` | `conflicts/ConflictsDialog.tsx`, `styles.css` | Cabecera y filas alineadas |
| 4.2 | Filas de 56 px con nombre y directorio en dos líneas | `ConflictsDialog.tsx` | Ruta legible sin competir con las acciones |
| 4.3 | Pills `Unresolved` / `Resolved` | `ConflictsDialog.tsx` | Rojo y verde según estado |
| 4.4 | Acciones por fila según el tipo de conflicto | `ConflictsDialog.tsx` | Yours/Theirs, Keep/Delete, Show result, Resolve manually |
| 4.5 | Pie con contadores y acciones globales | `ConflictsDialog.tsx`, `App.tsx` | `3 unresolved, 1 resolved`, Abort merge, Close, Accept and finish |
| 4.6 | Leyenda de colores | `ConflictsDialog.tsx`, i18n | Modified, Deleted, Added, Conflicting |
| 4.7 | Menú contextual para archivos resueltos | `ConflictsDialog.tsx` | Show diff / Revert conflict resolution |
| 4.8 | Conservar el prompt de sobrescritura y todos los `data-testid` | `ConflictsDialog.tsx` | Tests de conflictos siguen pasando |
| 4.9 | `Abort merge` y `Accept and finish` deshabilitados hasta la fase 7 | `ConflictsDialog.tsx` | Mismo criterio que el plan de fases |

Criterio: el diálogo mide 880×560, se lee como una tabla y mantiene las acciones actuales.

### Fase 5: staging línea a línea

Objetivo: dar a la vista de tres paneles la pantalla dedicada del mockup.

| # | Tarea | Archivos | Resultado |
| --- | --- | --- | --- |
| 5.1 | Pantalla propia con barra superior: título, archivo, Close, Done | `diff/ThreePaneView.tsx`, `styles.css` | Cabecera de 44 px |
| 5.2 | Toolbar: `Stage all remaining changes`, `Reset index to HEAD`, estadísticas | `ThreePaneView.tsx`, i18n | Barra de 42 px |
| 5.3 | Cabecera de columnas `HEAD / Index / Working copy` con etiquetas | `ThreePaneView.tsx` | 30 px, etiquetas `read-only` / `editable` |
| 5.4 | Filas con número de línea, color por tipo de cambio y tramado en huecos | `ThreePaneView.tsx`, `styles.css` | Filas de 24 px |
| 5.5 | Flechas por línea y por hunk, y etiqueta `staged` | `ThreePaneView.tsx` | Misma lógica de `takeLine` / `takeHunk` |
| 5.6 | Tarjetas de ayuda inferiores | `ThreePaneView.tsx`, i18n | Explican flecha derecha, izquierda y edición central |
| 5.7 | Barra de estado inferior | `ThreePaneView.tsx` | “Staged lines get a staged label…” + metadatos |
| 5.8 | Entrada desde el visor y salida con `Done` / `Close` | `DiffView.tsx` | Se conserva la semántica actual |

Criterio: la vista de staging por línea se reconoce como el cuarto mockup y escribe el índice exactamente igual que antes.

### Fase 6: editor de merge

Objetivo: cuando se implemente la fase 6, construir la pantalla según el tercer mockup. No es requisito para cerrar las fases 0–5.

| # | Tarea | Archivos | Resultado |
| --- | --- | --- | --- |
| 6.1 | Reutilizar `ThreeWayEditor` con paneles `Yours / Result / Theirs` | Fase 6 | Misma alineación, distintos roles |
| 6.2 | Cabecera con archivo, navegación `Conflict N of M`, Save and close, Apply changes | Fase 6 | 44 px |
| 6.3 | Toolbar: apply all non-conflicting, from left/right, resolve simple, compare, stats | Fase 6 | 42 px |
| 6.4 | Flechas `›` / `‹`, botón `×`, colores de conflicto y tramado | Fase 6 | Interacción por región |
| 6.5 | Barra inferior con leyenda y metadatos | Fase 6 | Igual que el mockup |

Criterio: se cumplen además los criterios de hecho de `docs/Fase 6 editor de merge.md`.

## Orden de ejecución

```text
Fase 0  Base visual y tokens
   ↓
Fase 1  Shell: topbar, sidebar, work area, status bar
   ↓
Fase 2  Cambios y commit box
   ↓
Fase 3  Pestaña y toolbar del diff
   ↓
Fase 4  Diálogo de conflictos
   ↓
Fase 5  Staging línea a línea
   ↓
Fase 6  Editor de merge (al llegar a la fase 6 del plan general)
```

Cada fase se cierra con una captura a 1280×800 (o 880×560 para conflictos) comparada con el mockup y con los tests en verde.

## Pruebas y verificación

### Pruebas existentes

Ejecutar después de cada fase:

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

No se deben renombrar ni eliminar `data-testid`. Si cambia la estructura interna de una fila, los tests deben seguir localizando sección, entrada y acción igual que antes.

### Comprobación visual

Añadir una prueba de layout, separada de las pruebas funcionales, que abra la app con un repositorio de muestra y guarde capturas de referencia:

- Ventana principal a 1280×800.
- Diálogo de conflictos a 880×560.
- Staging línea a línea a 1280×720.

La primera iteración puede ser comparación manual; después se puede automatizar con snapshots de Playwright. Las capturas deben incluir un archivo con cambios preparados y sin preparar, para ver badges, marcadores y colores.

### Comprobaciones concretas por pantalla

- **Main window:** barra superior de 40 px, sidebar de 400 px, commit al fondo, diff a la derecha, barra de estado abajo.
- **Changes:** secciones apiladas, no cards; badge por fila; acciones por archivo; contadores correctos.
- **Diff:** pestaña, toolbar segmentada, contador de diferencias, cabecera HEAD/Working copy, popup de hunk.
- **Conflicts:** tabla de cuatro columnas, filas de 56 px, pills, pie con contadores, leyenda.
- **Line staging:** tres columnas alineadas, flechas, etiqueta `staged`, ayuda inferior, barra de estado.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Reorganizar `App.tsx` rompe el refresco o la navegación entre archivos | Mover estado y handlers sin cambiarlos; probar staging, diff, commit y conflictos después de cada fase |
| Los tests dependen de textos visibles | Mantener las claves de i18n existentes y actualizar solo las nuevas; no cambiar `data-testid` |
| IBM Plex no está instalada en el sistema | Incluir `.woff2` locales; si no se pueden añadir, usar el fallback y dejar la familia declarada |
| La barra lateral de 400 px no cabe en ventanas pequeñas | Añadir un breakpoint que reduzca el sidebar a 320 px o lo colapse; el mockup es el objetivo a 1280 px |
| El tema de CodeMirror no coincide con los tokens | Centralizar los colores del diff en `changeTheme` y en las variables CSS |
| El contador de hunks por archivo no está en `ChangeSummary` | Omitirlo en la primera pasada o añadir una lectura específica; no inventar el dato |
| El editor de merge aún no existe | No simularlo en las fases 0–5; planificarlo junto con la fase 6 |
| Cambios visuales y funcionales mezclados | Una fase por PR/commit, con tests y captura al final |

## Criterio de terminado

- [ ] La ventana principal usa el layout topbar + sidebar + work area + status bar del mockup.
- [ ] El commit box está al fondo del sidebar y el botón primario es ámbar.
- [ ] Las listas de cambios son secciones apiladas, no tarjetas.
- [ ] El diff tiene pestaña, toolbar segmentada, contador de diferencias y cabecera HEAD/Working copy.
- [ ] El diálogo de conflictos es una tabla con columnas, pills, contadores y leyenda.
- [ ] El staging línea a línea tiene barra superior, toolbar, columnas alineadas, flechas y barra de estado.
- [ ] La tipografía es IBM Plex Sans/Mono (o fallback declarado) y el acento es `#e8a33d`.
- [ ] `npm run lint`, `npm run typecheck`, `npm test` y `npm run test:e2e` pasan.
- [ ] Las capturas de las tres pantallas existentes se comparan con los mockups y no quedan desviaciones evidentes.
- [ ] No se ha cambiado ningún comando Git ni el contrato IPC.
