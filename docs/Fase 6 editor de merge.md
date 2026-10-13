# Fase 6: editor de merge

La fase 6 construye la pantalla central de Seam: el editor de merge de tres paneles (Yours, Result, Theirs) donde se resuelve un archivo en conflicto. Une el motor de la fase 2, el componente de tres paneles de la fase 3 y la lista de la fase 5. Es la fase más larga del proyecto.

## Alcance

- Tres editores CodeMirror alineados: Yours a la izquierda, Result en el centro (editable), Theirs a la derecha.
- Cintas que conectan cada región con su zona en Result, con las flechas `»` y `«` y la `x` para ignorar.
- Barra de herramientas: siguiente/anterior conflicto, aplicar todo lo no conflictivo (por lado), resolver los conflictos simples y deshacer.
- Edición libre del panel central, con el estado de cada región recalculado al teclear.
- Botón Apply Changes: escribe el archivo, ejecuta `git add` y vuelve a la lista.
- Fuera de alcance: marcadores de conflicto en el texto, reabrir un archivo ya resuelto desde cero (eso lo cubre «Revert conflict resolution» de la fase 5).

## Diseño técnico

### Componente y datos de entrada

La ventana recibe la ruta del archivo y pide al proceso principal las tres versiones (`:1:` base, `:2:` Yours, `:3:` Theirs, ya normalizadas como en la fase 1) más el texto del working tree. Con ellas llama a `computeMerge()` de la fase 2 y obtiene la lista de `MergeRegion`. Si el archivo ya trae marcadores sin etapas en el índice, se abre en solo lectura con un aviso.

El componente `ThreeWayEditor` es el mismo de la fase 3, con tres diferencias que se pasan por propiedades: qué paneles son editables, de dónde salen las regiones y qué hacen las flechas. En staging el panel central es el índice; aquí es Result.

### Alineación y cintas

Cada región ocupa el mismo número de líneas visuales en los tres paneles. Se consigue con widgets de bloque (spacers) que rellenan el lado más corto, recalculados con un `StateField` cuando cambia el documento o las regiones. El hueco se pinta con la trama rayada del diseño. Las cintas se dibujan en un SVG superpuesto entre paneles; su geometría sale de `coordsAtPos` de cada editor y se repinta al hacer scroll, con un solo `requestAnimationFrame` por fotograma. El scroll de los tres paneles va sincronizado por la posición de la región visible, no por píxeles.

### Estado de las regiones y edición

Result es la fuente de la verdad: el texto de cada región se localiza con `mapResultRanges` (fase 2) tras cada transacción. Las flechas no escriben texto por su cuenta; envían una operación del motor (`applySide`, `ignoreSide`) y el componente aplica el cambio resultante a Result como una transacción. Si el usuario edita dentro de una región, esa región pasa a `edited` y sus flechas se desactivan. Si borra su contenido, vuelve a `pending`.

### Deshacer

El historial de CodeMirror solo recoge los cambios de texto. Para que deshacer también restaure el estado de las regiones (aplicada, ignorada), el estado vive en un `StateField` y cada cambio de estado se registra con `invertedEffects`. Así un único `Ctrl+Z` revierte texto y estado a la vez, y `Ctrl+Shift+Z` los rehace.

### Apply Changes

El botón se activa cuando no queda ninguna región `pending` con conflicto. Pasos: escribir Result en el working tree con la codificación y los saltos de línea originales (fase 1), ejecutar `git add -- <ruta>` a través de la cola de escritura de la fase 3 y cerrar la ventana. Cerrar sin aplicar pregunta si se descartan los cambios; no escribe nada.

### Archivos grandes

Por encima del umbral de la fase 1 (5 MB o 50 000 líneas) el editor no calcula palabra a palabra ni dibuja cintas con curvas; usa rectángulos y avisa de que el resaltado está reducido.

## Tareas en orden

| # | Tarea | Resultado | Depende de |
| --- | --- | --- | --- |
| 6.1 | Carga de versiones y arranque del motor | La ventana abre un archivo y muestra sus regiones en una lista de depuración | Fases 2 y 5 |
| 6.2 | Tres editores con alineación | Spacers correctos con cualquier combinación de regiones | 6.1 |
| 6.3 | Scroll sincronizado | Los tres paneles siguen la misma región al desplazarse | 6.2 |
| 6.4 | Cintas SVG | Cada región se une con su zona en Result | 6.2 |
| 6.5 | Resaltado de sintaxis | Lenguaje autodetectado, igual que en el visor de la fase 1 | 6.2 |
| 6.6 | Flechas y botón de ignorar | `»`, `«` y `x` llaman al motor y actualizan Result | 6.4 |
| 6.7 | Edición libre y estado `edited` | Teclear en Result recalcula el estado de las regiones | 6.6 |
| 6.8 | Deshacer y rehacer unificados | Texto y estado vuelven juntos | 6.6 |
| 6.9 | Barra de herramientas | Siguiente/anterior, aplicar no conflictivos, resolver simples | 6.6 |
| 6.10 | Apply Changes y cierre | Archivo escrito, `git add` ejecutado, lista actualizada | 6.7 |
| 6.11 | Atajos de teclado y accesibilidad | Todo accionable sin ratón; contraste revisado | 6.9 |

## Pruebas

- Unitarias del `StateField` de spacers: el número de líneas visuales de cada región es igual en los tres paneles para 200 combinaciones generadas con fast-check.
- Unitarias de la transacción de una flecha: aplicar Yours y luego Theirs en un conflicto deja las dos versiones en el orden esperado; ignorar vacía la región.
- Prueba de deshacer: aplicar, editar, deshacer dos veces, y comprobar que texto y estado coinciden con el inicio.
- Prueba de extremo a extremo con Playwright: abrir un archivo con tres conflictos, resolver uno con cada método (flecha, edición, ignorar), pulsar Apply Changes y verificar con `git diff --cached` el contenido final y con `ls-files -u` que ya no hay etapas.
- Comparación visual de las cintas con capturas de referencia sobre un archivo fijo.

## Criterio de terminado

- [ ] Un archivo con conflictos reales se resuelve entero con ratón y con teclado.
- [ ] Result coincide con `git merge-file -p` cuando solo se aplican cambios no conflictivos.
- [ ] Un único deshacer revierte texto y estado de la región.
- [ ] Apply Changes deja el archivo sin etapas en el índice y la lista de la fase 5 lo marca como resuelto.
- [ ] Un archivo de 20 000 líneas se desplaza sin saltos visibles.

## Riesgos de la fase

- La alineación con spacers y las cintas se desincronizan al plegar o al cambiar el tamaño de la fuente. Mitigación: recalcular en cada cambio de geometría y probar con zoom distinto.
- Deshacer con estado propio es fácil de romper. Mitigación: toda mutación de estado pasa por un único efecto con inverso, y la prueba de deshacer corre en integración continua.
- El rendimiento con archivos grandes. Mitigación: virtualización de CodeMirror y el modo reducido de la sección anterior.

## Decisión a confirmar

- [ ] ¿Debe «Apply Changes» pedir confirmación cuando quedan regiones con conflicto sin resolver (para guardar un resultado parcial), o se bloquea hasta resolverlas todas, como el botón de commit? La propuesta es bloquearlo, por coherencia con la decisión de la especificación.
