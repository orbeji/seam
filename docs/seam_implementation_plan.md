# Seam: plan de implementación

Oct 13, 2026 · @Ender

Seam se construye en diez fases (0 a 9) que siguen los hitos de la [especificación](https://claude.ai/code/artifact/aef8baca-7f6e-4083-ba1b-93cebf681b13): primero el motor de diff y de merge, que es lo más arriesgado, y después las pantallas que dependen de ellos.

Cada fase tiene su propio capítulo con el diseño técnico, las tareas en orden y las pruebas: Capítulos por fase.

## Enfoque

Tres reglas ordenan el plan.

1. **Lo arriesgado primero.** El motor de diff (fase 1) y el de merge (fase 2) se escriben sin interfaz y con pruebas antes de dibujar ninguna pantalla de conflictos. Si el algoritmo falla, se descubre en las primeras semanas y no al final.
2. **Siempre algo usable.** Al terminar la fase 4, Seam ya sirve como cliente de staging y commit, aunque todavía no resuelva conflictos. Eso permite usarlo a diario y encontrar fallos con repositorios reales.
3. **Git de verdad, sin reimplementarlo.** Toda escritura pasa por el ejecutable `git`. El motor propio solo calcula lo que Git no expone: regiones de merge, diff por palabras y texto del índice. Su resultado se contrasta con `git merge-file` y `git diff`.

**Supuestos**

- Una sola persona desarrolla, sin ritmo fijo: se avanza cuando hay tiempo. Los tamaños son relativos y aproximados, medidos como si fuera a tiempo completo: S son 2 a 3 días, M una semana, L dos semanas. No hay fechas y el orden de las fases no cambia.
- Windows y Linux desde la fase 0; no hay macOS.
- Git 2.30 o posterior. Decidido; la fase 0 lo comprueba, porque varios comandos de la especificación (`git restore --staged`, `status --porcelain=v2`) dependen de la versión.
- El alcance es el de la especificación: sin changelists, sin comprobaciones de commit del IDE, sin subida tras commit.

## Stack y herramientas

La especificación fija Electron, TypeScript y CodeMirror 6. React, GitHub Actions y los idiomas de la interfaz ya están decididos; el resto son propuestas que se pueden cambiar sin tocar el plan.

| Área | Elección | Motivo |
| --- | --- | --- |
| Aplicación | Electron, proceso principal en Node | Mismo renderizado en Windows y Linux y un solo lenguaje. Fijado en la especificación. |
| Lenguaje | TypeScript en modo estricto | Los tipos compartidos entre proceso principal e interfaz evitan errores en el IPC. |
| Build | electron-vite (Vite) | Un solo comando de desarrollo con recarga en caliente para los tres procesos. |
| Interfaz | React | Mayor ecosistema y ejemplos de integración con CodeMirror. Decidido. |
| Editor y diff | CodeMirror 6 con su paquete de merge para dos paneles; el de tres paneles se construye aparte | El editor central del merge necesita edición con rangos que siguen al texto. |
| Algoritmo de diff | Librería de diff detrás de una interfaz propia (línea, palabra y carácter) | Permite cambiar de Myers a patience si las pruebas lo piden, sin tocar el resto. |
| Git | Ejecutable `git` como proceso hijo, con `LC_ALL=C` y salida `-z` | Hooks, configuración y atributos se comportan como en la terminal. |
| Observador de archivos | chokidar sobre el árbol de trabajo y el directorio de git | Evita refrescar a mano; el foco de ventana queda como respaldo. |
| Pruebas unitarias y de propiedades | Vitest y fast-check | Rápidas, y fast-check genera las ediciones aleatorias para contrastar con `git merge-file`. |
| Pruebas de extremo a extremo | Playwright con Electron | Maneja la aplicación real contra repositorios de ejemplo. |
| Empaquetado | electron-builder | Instalador para Windows y AppImage y .deb para Linux. |
| Calidad | ESLint, Prettier y `tsc --noEmit` en CI | Barrera mínima desde el primer commit. |
| Lenguajes del editor | Detección por nombre, extensión y shebang; paquete de CodeMirror cargado bajo demanda | Es la decisión de autodetección de la especificación. |
| Traducciones | Catálogos JSON por idioma (inglés y español) y una librería de i18n compatible con React | Los textos viven fuera de los componentes desde la fase 0. Añadir catalán u otro idioma es añadir un archivo. |

## Estructura del repositorio

Un solo paquete con carpetas separadas por reglas de importación. Un monorepo con varios paquetes añade configuración que una sola persona no necesita todavía; las reglas de abajo permiten dividirlo más adelante sin reescribir nada.

```text
seam/
  LICENSE                    MIT
  package.json
  electron.vite.config.ts
  src/
    core/                    sin Electron ni DOM; se prueba con Vitest
      git/                   ejecutor, estado, versiones de archivo, operaciones, índice
      diff/                  diff por línea, palabra y carácter; ignorar espacios
      merge/                 motor de tres vías, regiones, conflictos simples
      text/                  saltos de línea, codificación, BOM, detección de binarios
    main/                    proceso principal de Electron
      ipc/                   manejadores tipados
      session/               cola de escrituras por repositorio, observador
    preload/                 puente tipado hacia la interfaz
    renderer/                interfaz
      changes/               lista Staged, Unstaged, Untracked
      commit/                mensaje, amend, sign-off, hooks
      diff/                  visor lado a lado y unificado
      conflicts/             diálogo de conflictos
      merge-editor/          editor de tres paneles
      staging-view/          vista HEAD, índice, copia de trabajo
      i18n/                  catálogos en.json y es.json; cada idioma nuevo es un archivo
    shared/                  tipos de mensajes IPC
  test/
    fixtures/                scripts que crean repositorios de ejemplo
    e2e/                     pruebas con Playwright
  docs/                      especificación y diseños
```

| Regla de importación | Por qué |
| --- | --- |
| `core/diff`, `core/merge` y `core/text` son funciones puras y no importan nada de Node ni del navegador | El motor de merge se ejecuta en la interfaz, junto al editor, y también en las pruebas. |
| `core/git` usa procesos hijo y solo lo importa `main` | La interfaz nunca ejecuta Git directamente; pide cada acción por IPC. |
| `renderer` importa `shared` y las partes puras de `core`, nunca `main` | Mantiene la frontera de seguridad de Electron: sin acceso a Node en la interfaz. |
| Una regla de ESLint comprueba las tres anteriores | Si no se comprueba en CI, se rompe sin que nadie lo vea. |

## Fases y dependencias

&#91;embedded content: fases 0 a 9 · qué necesita cada fase\]

La fase 6 necesita el motor de merge (la rama de arriba) y la lista de conflictos (la de abajo). Tras la fase 4 Seam ya sirve para preparar y confirmar cambios; el push no depende de los conflictos y puede hacerse en cualquier momento después del commit.

## Plan por fase

En total son unas 14 semanas de trabajo a tiempo completo (estimación aproximada); como el ritmo no es fijo, sirven para comparar fases, no para poner fechas. Las fases 0 a 8 corresponden a los hitos de la especificación; la 9 añade el empaquetado.

| Fase | Entrega | Tamaño | Depende de | Hecho cuando |
| --- | --- | --- | --- | --- |
| 0 | Repositorio, CI y núcleo de Git | M | nada | Un script lista Staged, Unstaged, Untracked y conflictos de tres repositorios de ejemplo, en Windows y Linux |
| 1 | Motor de diff y visor | L | 0 | El visor cumple la sección Diff viewer de la especificación sobre un conjunto de casos |
| 2 | Motor de merge | L | 1 | La prueba de propiedades contra `git merge-file -p` pasa y los casos add/add y delete/modify también |
| 3 | Staging | L | 0, 1 | Un hunk preparado en Seam aparece en `git diff --cached`, y al revés |
| 4 | Commit | M | 3 | Un commit de Seam es idéntico al de la terminal con las mismas opciones |
| 5 | Lista de conflictos | M | 0, 2, 4 | Merge, rebase y cherry-pick se detienen y muestran los lados con la etiqueta correcta |
| 6 | Editor de merge | L | 2, 5 | Un repositorio de ejemplo con conflictos se resuelve entero sin usar la terminal |
| 7 | Terminar y abortar | M | 4, 5, 6 | Cada operación termina o se aborta y el estado coincide con el de Git |
| 8 | Push | M | 4 | Un push rechazado ofrece rebase o merge y se completa con cualquiera |
| 9 | Empaquetado y versión 0.1.0 | M | todas | Los instaladores arrancan y funcionan en Windows y Linux limpios |

### Fase 0: cimientos

- [ ] Crear el repositorio con licencia MIT, TypeScript estricto, ESLint, Prettier y electron-vite.
- [ ] CI en GitHub Actions que compila y ejecuta Vitest en Windows y Linux.
- [ ] Ejecutor de Git: lanza `git` con `LC_ALL=C`, captura salida y errores, cancela procesos y comprueba la versión mínima (2.30).
- [ ] Parser de `status --porcelain=v2 -z`, incluidos los códigos de conflicto UU, AA, DD, AU, UA, DU y UD.
- [ ] Detector de operación en curso: merge, rebase, cherry-pick y revert, por los archivos del directorio de git.
- [ ] Script que crea tres repositorios de ejemplo: limpio, con cambios mezclados y con conflictos.
- [ ] Comprobar que `git checkout --merge -- <ruta>` restaura un conflicto ya resuelto.
- [ ] Traducciones: textos en catálogos por idioma (inglés y español), selector de idioma, detección del idioma del sistema y una regla de ESLint que prohíbe textos escritos directamente en los componentes. **Regla de estilo:** los términos Git (`push`, `pull`, `merge`, `commit`, `branch`, `checkout`, `rebase`, `stash`, `clone`, `fetch`, `amend`...) se dejan sin traducir en el catálogo en español, porque así se usan en la industria y traducirlos sonaría ajeno a quien trabaja con Git.

### Fase 1: motor de diff y visor

- [ ] Interfaz de diff por línea con una implementación y pruebas de casos límite: archivo vacío, sin salto final, CRLF.
- [ ] Diff por palabra y por carácter dentro de cada línea modificada.
- [ ] Opciones de espacios: ninguno, recortar, ignorar, ignorar espacios y líneas vacías.
- [ ] Visor en CodeMirror, lado a lado y unificado, con colores, alineación y desplazamiento sincronizado.
- [ ] Plegado de bloques sin cambios y navegación con F7 y Shift+F7, y entre archivos con Alt+Izquierda y Alt+Derecha.
- [ ] Detección de lenguaje por nombre, extensión y shebang, con el paquete cargado bajo demanda.
- [ ] Archivos grandes y binarios: sin resaltado fino y con los tamaños de cada lado.

### Fase 2: motor de merge

- [ ] Regiones de tres vías: dos diffs contra la base y unión de los hunks que se solapan o se tocan.
- [ ] Clasificación de cada región: solo izquierda, solo derecha, idénticas o conflicto.
- [ ] Estado por región y rangos del resultado que siguen al texto, con deshacer y rehacer.
- [ ] Conflictos simples: cambios que no se solapan por palabra o por carácter, y diferencias solo de espacios.
- [ ] Prueba de propiedades contra `git merge-file -p` con ediciones aleatorias.
- [ ] Casos fijos: add/add, delete/modify, bloques movidos y cambios solo de espacios.

### Fase 3: staging

- [ ] Lista Staged, Unstaged y Untracked con contadores, que se refresca al enfocar la ventana y con el observador.
- [ ] Preparar y deshacer por archivo y por sección; caso de un repositorio sin commits con `git rm --cached`.
- [ ] Escritura del índice desde texto: `hash-object -w` y `update-index --cacheinfo`, con el modo leído de `ls-files -s`.
- [ ] Preparar un hunk desde el margen del diff, con marcadores sólidos y huecos.
- [ ] Preparar líneas sueltas y la vista de tres paneles HEAD, índice y copia de trabajo.
- [ ] Cola de escrituras por repositorio para que Git no bloquee el índice.

### Fase 4: commit

- [ ] Cuadro de mensaje con historial reciente y plantilla `commit.template`.
- [ ] Commit desde el índice con `-F -`, desactivado mientras el índice esté vacío.
- [ ] Amend, autor, sign-off y opción de no ejecutar los hooks.
- [ ] Salida del hook cuando falla, conservando el mensaje.
- [ ] Aviso de CRLF antes de confirmar, con las opciones Commit As Is y Fix and Commit.

### Fase 5: lista de conflictos

- [ ] Diálogo con archivo, tipo, estado y los botones Accept Yours, Accept Theirs y Resolve manually.
- [ ] Correspondencia de Yours y Theirs según la operación, con el nombre de rama o commit en cada lado.
- [ ] Resolve all simple conflicts: aplica el motor de merge a los archivos que no se solapan.
- [ ] Casos sin editor: binarios y archivos eliminados por un lado, con las opciones de conservar o borrar.
- [ ] Revert conflict resolution con `git checkout --merge`.
- [ ] Nodo Merge Conflicts en la lista de cambios al cerrar el diálogo o al empezar la operación desde la terminal.

### Fase 6: editor de merge

- [ ] Tres paneles con desplazamiento sincronizado y un rango por región.
- [ ] Panel central editable que parte de la base.
- [ ] Flechas de aceptar e ignorar por cambio, y menú contextual Resolve using Left y Resolve using Right.
- [ ] Barra de herramientas: aplicar no conflictivos (todos, izquierda, derecha), Resolve simple conflicts y Compare.
- [ ] Barra del margen con Revert por región.
- [ ] Apply Changes escribe el archivo, hace `git add` y abre el siguiente; Save and close vuelve a la lista.
- [ ] Aviso si el resultado aún contiene marcadores `<<<<<<<`.

### Fase 7: terminar y abortar

- [ ] Accept and Finish según la operación: `commit --no-edit`, `rebase --continue` o `cherry-pick --continue`, con `GIT_EDITOR=true`.
- [ ] Abortar cada operación.
- [ ] Rebase de varios commits: reabrir el diálogo cuando el siguiente commit también tenga conflictos.
- [ ] `stash pop` con conflictos, que no deja archivo de marca.
- [ ] Pruebas de extremo a extremo de merge, rebase, cherry-pick y `stash pop`.

### Fase 8: push

- [ ] Diálogo con los commits salientes y los archivos de cada uno.
- [ ] Rama destino, tags (todos o solo los de la rama), `--force-with-lease` y ramas protegidas.
- [ ] Push rechazado: ofrecer rebase o merge y recordar la elección.
- [ ] Credenciales delegadas en el credential helper de Git; Seam no las pide ni las guarda.

### Fase 9: empaquetado y versión 0.1.0

- [ ] Decidir si el instalador incluye Git o exige tenerlo instalado, y si el instalador de Windows se firma.
- [ ] Instalador para Windows y AppImage y .deb para Linux con electron-builder.
- [ ] Prueba de humo de cada instalador en un sistema limpio.
- [ ] Revisar las traducciones al inglés y al español de todas las pantallas, manteniendo los términos Git (`push`, `pull`, `merge`, `commit`...) sin traducir, que es como se usan en la industria.
- [ ] README con capturas, guía de contribución y licencia.
- [ ] Etiqueta 0.1.0 y publicación de los binarios.

## Pruebas

La regla es que cada resultado de Seam se compara con lo que haría Git en la terminal. Si coinciden, la función es correcta; si no, el fallo es de Seam.

| Capa | Qué se prueba | Herramienta | Cuándo corre |
| --- | --- | --- | --- |
| Texto y diff | Casos límite: archivo vacío, sin salto final, CRLF, Unicode, líneas muy largas | Vitest | En cada commit |
| Motor de merge | Con ediciones aleatorias, el resultado sin conflictos es igual al de `git merge-file -p`; las regiones cubren el archivo sin huecos ni solapes | Vitest y fast-check | En cada commit con pocos casos; cada noche con muchos |
| Parsers de Git | Salida real de `status`, `ls-files -s` y `diff` guardada como ejemplo, incluidos nombres con espacios, acentos y renombrados | Vitest | En cada commit |
| Núcleo de Git | Cada comando contra repositorios temporales creados por los scripts de ejemplo | Vitest | En cada commit, en Windows y Linux |
| Estado del editor de merge | Aceptar, ignorar, revertir y deshacer mantienen los rangos de las regiones | Vitest | En cada commit |
| Extremo a extremo | Preparar un hunk, hacer commit, resolver un merge, un rebase y un cherry-pick desde la ventana | Playwright con Electron | En cada pull request, en Windows y Linux (en Linux con pantalla virtual) |
| Contraste con Git | Después de cada flujo extremo a extremo, `git status`, `git diff --cached` y `git log` coinciden con lo esperado | Playwright y la CLI de Git | Dentro de las pruebas anteriores |

**Casos de plataforma.** Las pruebas de Windows incluyen rutas con espacios y acentos, rutas largas, saltos de línea CRLF y renombrados que solo cambian mayúsculas. Los repositorios de ejemplo se crean con scripts en cada ejecución y no se guardan como archivos binarios en el repositorio.

## CI, empaquetado y releases

El repositorio vive en GitHub, así que la CI usa GitHub Actions.

| Tema | Plan |
| --- | --- |
| Integración continua | En cada pull request y cada push a la rama principal, en una matriz de Windows y Linux: instalar, ESLint, `tsc --noEmit`, pruebas unitarias y pruebas de extremo a extremo. |
| Pruebas nocturnas | Las pruebas de propiedades del motor de merge con muchos más casos que en el commit normal. Si fallan, guardan la semilla para reproducir el caso. |
| Empaquetado | electron-builder: instalador de Windows, AppImage y .deb para Linux. Se genera en cada etiqueta de versión y se sube como artefacto. |
| Versiones | Numeración semántica, etiqueta `v0.1.0` para la primera y un archivo de cambios que se rellena desde la fase 4. |
| Git instalado | Se decide en la fase 9. Mientras tanto Seam lo busca en el PATH y en las rutas habituales de Git for Windows, y si no lo encuentra muestra un mensaje que explica cómo instalarlo. |
| Firma de código | Se decide en la fase 9. Sin firma, Windows avisará de editor desconocido al instalar; firmar requiere un certificado de pago. |
| Actualizaciones automáticas | Fuera de 0.1.0. Se añaden después, cuando haya usuarios aparte de ti. |

## Riesgos

La probabilidad y el impacto son juicios míos, no medidas; sirven para decidir qué vigilar primero.

| Riesgo | Prob. | Impacto | Mitigación | Fase |
| --- | --- | --- | --- | --- |
| El motor de merge difiere de Git en casos límite, como hunks que se tocan sin solaparse | Alta | Alto | Prueba de propiedades contra `git merge-file -p` desde la fase 2 y casos fijos para cada diferencia encontrada | 2 |
| Los rangos de las regiones se desincronizan al editar el panel central | Media | Alto | Los rangos se actualizan con cada transacción del editor y se prueban con deshacer y rehacer antes de dibujar el panel | 2, 6 |
| Yours y Theirs al revés en un rebase llevan a descartar el lado equivocado | Media | Alto | Etiquetas con la rama o el commit de cada lado y pruebas de extremo a extremo de rebase | 5, 7 |
| Escribir el índice a mano deja un modo o un tipo de archivo incorrecto | Baja | Alto | Solo archivos regulares por texto; enlaces, submódulos y cambios de modo se preparan enteros con `git add` | 3 |
| Acciones destructivas (Accept Theirs, Revert, Abort) pierden trabajo sin guardar | Media | Alto | Confirmación previa y copia en memoria del archivo durante la sesión | 5, 6, 7 |
| Diferencias entre Windows y Linux: rutas, CRLF, archivos bloqueados | Alta | Medio | CI en los dos sistemas desde la fase 0 y casos de plataforma en las pruebas | todas |
| Un hook o un pedido de credenciales espera una terminal y deja el proceso colgado | Media | Medio | Ejecutar sin terminal, con tiempo límite, mostrar su salida y delegar las credenciales en el credential helper | 4, 8 |
| Archivos grandes o muchos cambios hacen lenta la interfaz | Media | Medio | Umbral para apagar el resaltado fino, listas virtualizadas y plegado de bloques sin cambios | 1 |
| El alcance crece con ideas de la herramienta de referencia que la especificación dejó fuera | Media | Medio | Lista de ideas aparte y nada nuevo hasta cerrar la fase 9 | todas |

## Primera semana

La primera semana cierra la fase 0. Al final hay un repositorio con CI en verde en Windows y Linux y una ventana mínima que lista los cambios de un repositorio real.

- [ ] **Día 1.** Crear el repositorio con licencia MIT, `package.json`, TypeScript estricto, ESLint, Prettier y electron-vite; que `npm run dev` abra una ventana vacía con el catálogo de textos en inglés y español ya conectado.
- [ ] **Día 2.** Configurar la CI en Windows y Linux con instalación, lint, `tsc --noEmit` y Vitest; añadir la regla de ESLint de importaciones entre `core`, `main` y `renderer`.
- [ ] **Día 3.** Escribir el ejecutor de Git (`LC_ALL=C`, salida `-z`, errores tipados, comprobación de versión) y el parser de `status --porcelain=v2`, con las pruebas sobre salida real.
- [ ] **Día 4.** Detector de operación en curso y el script que crea los tres repositorios de ejemplo: limpio, con cambios mezclados y con conflictos.
- [ ] **Día 5.** Comprobar `git checkout --merge -- <ruta>` en los repositorios con conflictos y conectar el IPC: la ventana muestra las listas Staged, Unstaged, Untracked y conflictos de una carpeta elegida.

Si algún comando de la especificación no se comporta como se espera con la versión de Git instalada, se ve el día 5 y se corrige la especificación antes de empezar la fase 1.

## Decisiones

Seis decisiones están tomadas y las restantes se aplazan a la fase 9, cuando se prepare el instalador.

| Decisión | Resultado | Efecto en el plan |
| --- | --- | --- |
| Framework de interfaz | React | Fijado en la tabla de stack. |
| Dedicación | Sin ritmo fijo: se avanza cuando hay tiempo | Los tamaños S, M y L siguen como medida de esfuerzo; no hay fechas. |
| Repositorio y CI | GitHub, con GitHub Actions | La sección de CI deja de ser una suposición. |
| Versión mínima de Git | 2.30 | La fase 0 comprueba que los comandos funcionan con esa versión, y Seam avisa si encuentra una anterior. |
| Idiomas de la interfaz | Inglés y español, con estructura para añadir más, por ejemplo catalán | Los textos van en catálogos desde la fase 0; cada idioma nuevo es un archivo. |
| Terminar un merge | Abrir la caja de mensaje de la fase 4 con `MERGE_MSG` precargado antes de crear el commit | «Accept and finish» de la fase 7 no hace `commit --no-edit`: muestra la caja y crea el commit al confirmarla. |

**Aplazadas a la fase 9**

- [ ] Git en el instalador o instalado aparte. Hasta entonces Seam usa el Git que haya instalado.
- [ ] Firma de código en Windows para la 0.1.0: certificado de pago o publicar sin firma.
- [ ] Yours y Theirs durante un rebase: la propuesta (capítulo de la fase 5) es que Yours sean tus commits repetidos, que Git llama `theirs`.
