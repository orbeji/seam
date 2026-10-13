# Fase 3: staging

La fase 3 permite preparar cambios: por archivo, por hunk y por línea, con la vista de tres paneles para los casos finos. Tamaño L, depende de las fases 0 y 1.

## Alcance

- **Dentro:** acciones sobre la lista Staged, Unstaged y Untracked, escritura del índice desde texto, marcadores del margen, preparar y quitar hunks y líneas, revertir un hunk, vista de tres paneles, cola de escrituras y refresco automático.
- **Fuera:** commit (fase 4). Los archivos sin seguimiento, los enlaces simbólicos, los submódulos y los cambios solo de permisos se preparan enteros, no por hunk.

## Diseño técnico

### Tres estados de cada archivo

Cada archivo tiene tres versiones: HEAD (H), índice (I) y copia de trabajo (W). De ellas salen dos conjuntos de hunks.

| Comparación | Hunks | Marcador en el margen |
| --- | --- | --- |
| H contra I | Preparados | Marcador hueco |
| I contra W | No preparados | Marcador sólido |

El visor de la fase 1 muestra W, así que los hunks preparados, que están en líneas de I, se trasladan a W con las líneas que no cambian entre I y W. Un hunk preparado cuyas líneas se modificaron después en W se dibuja en la posición más cercana. El marcador hueco incluye los cambios preparados desde fuera de Seam, porque se calcula con el índice real.

### Acciones sobre archivos

| Acción | Comando |
| --- | --- |
| Preparar un archivo, uno borrado o uno nuevo | `git add -- <ruta>` |
| Quitar de los preparados | `git restore --staged -- <ruta>` |
| Lo mismo en un repositorio sin commits | `git rm --cached -- <ruta>` |
| Preparar o quitar una sección entera | Las mismas órdenes con `--pathspec-from-file=- --pathspec-file-nul` y las rutas por `stdin`, para no chocar con el límite de longitud de la línea de comandos de Windows |
| Renombrado | Se preparan las dos rutas, la antigua y la nueva, en el mismo comando |

### Escribir el índice desde texto

Preparar un hunk o una línea consiste en construir el texto nuevo del índice y escribirlo sin pasar por el disco.

1. Se construye la lista de líneas del índice nuevo.
2. `git hash-object -w --path=<ruta> --stdin` guarda ese texto como blob y devuelve su identificador. Con `--path`, Git aplica los filtros y la normalización de saltos de línea de esa ruta, así que el blob es el que habría creado `git add`.
3. El modo se lee de `git ls-files -s -- <ruta>`. Si el archivo no está en el índice, se toma 100644 o 100755 según el bit de ejecución de W.
4. `git update-index --cacheinfo <modo>,<id>,<ruta>` apunta la entrada del índice al blob nuevo.

Solo se hace con archivos regulares (modos 100644 y 100755) y sin conflicto. Un archivo con entradas sin fusionar muestra el aviso de conflicto en vez de acciones de staging.

### Hunks y líneas

- **Preparar un hunk.** El índice nuevo es I con las líneas del hunk sustituidas por las de W.
- **Quitar un hunk preparado.** El índice nuevo es I con las líneas del hunk sustituidas por las de H.
- **Preparar líneas.** Dentro de un hunk, cada línea añadida y seleccionada se inserta, cada línea borrada y seleccionada se quita y el resto queda como en I.

```ts
function stageSelection(index: string[], work: string[], hunk: LineHunk, selected: Set<number>): string[];
```

Una línea modificada es un borrado más una adición. Si solo se selecciona la adición, el índice acaba con la línea vieja y la nueva, que es lo que haría Git con una selección parcial.

**Revertir un hunk** (la tercera acción del menú del hunk) sustituye en el archivo de trabajo las líneas de W por las de I. Es destructivo: pide confirmación, escribe el archivo con su codificación y sus saltos de línea originales y se puede deshacer con el editor mientras el visor siga abierto.

### Vista de tres paneles

HEAD a la izquierda, índice editable en el centro y copia de trabajo a la derecha. La flecha entre índice y copia de trabajo prepara esa línea o hunk; la flecha entre HEAD e índice lo quita. Lo que se hace en el panel central, con flechas o escribiendo, queda en el panel y se escribe en el índice al pulsar Done; Close lo descarta.

Se construye como un componente genérico de tres editores con relleno de alineación, bandas de conexión entre paneles y desplazamiento sincronizado, porque la fase 6 lo reutiliza para el editor de merge. Parte del trabajo de esa fase se hace aquí.

### Cola de escrituras y refresco

- **Escrituras.** Una cola por repositorio las ejecuta de una en una, porque Git bloquea el índice y dos escrituras a la vez fallan. Las lecturas siguen en paralelo y usan `GIT_OPTIONAL_LOCKS=0`. Si una escritura encuentra `index.lock` porque el usuario está usando la terminal, se reintenta tres veces con espera creciente y después se muestra el error.
- **Refresco.** Se vigilan los archivos de la carpeta de git (`index`, `HEAD`, referencias y los marcadores de operación) con una espera de unos 150 ms para agrupar eventos. No se vigila el árbol de trabajo: se refresca al recuperar el foco la ventana y después de cada escritura de Seam. Evita los límites de inotify en Linux y el coste en repositorios grandes.
- **Bucles.** Las escrituras de Seam generan eventos propios, que se agrupan con un solo refresco al vaciarse la cola.

## Tareas en orden

| N.º | Tarea | Resultado comprobable |
| --- | --- | --- |
| 1 | Sesión de repositorio con cola de escrituras | Veinte escrituras simultáneas terminan en orden, y una lectura durante una escritura no falla |
| 2 | Observador de la carpeta de git y refresco al enfocar | Un `git add` desde la terminal actualiza las listas sin intervención |
| 3 | Acciones por archivo y sección con rutas por `stdin` | Preparar 5 000 archivos funciona en Windows |
| 4 | Repositorio sin commits | Preparar y quitar un archivo en un repositorio recién creado |
| 5 | Escritura del índice desde texto | El índice coincide con el que deja `git add` del mismo contenido, también en un repositorio con `CRLF` y `core.autocrlf=true` |
| 6 | Modelo H, I y W y traslado de hunks preparados | Propiedad: los hunks de H contra I y de I contra W reconstruyen H, I y W |
| 7 | Marcadores sólidos y huecos y menú del hunk | Se ven los dos tipos en un archivo con cambios preparados y sin preparar |
| 8 | Preparar y quitar hunks | Un hunk preparado aparece en `git diff --cached`, y al quitarlo desaparece |
| 9 | Preparar líneas | Preparar una sola línea de un hunk deja el resto sin preparar |
| 10 | Vista de tres paneles con Done y Close | Close no cambia el índice; Done escribe lo que hay en el panel central |
| 11 | Revertir un hunk | El archivo recupera las líneas del índice y el cambio se puede deshacer |

## Pruebas

- **Contra Git, como oráculo.** Se hacen cambios aleatorios en W, se eligen hunks al azar para preparar, y el resultado se compara con el de preparar los mismos hunks con `git apply --cached` sobre el parche de `git diff -U0`. Se comparan los árboles con `git write-tree`: deben ser idénticos.
- **Ida y vuelta.** Preparar y quitar lo mismo deja un `git write-tree` igual al inicial.
- **Saltos de línea.** Los mismos casos en un repositorio con `core.autocrlf=true`, con atributos `eol` y sin nada.
- **Concurrencia.** Una prueba que lanza un `git add` externo mientras Seam escribe.

## Criterio de hecho

- [ ] Un hunk preparado en Seam aparece en `git diff --cached`, y uno preparado en la terminal aparece como marcador hueco en Seam.
- [ ] Preparar y quitar un hunk deja el índice como estaba.
- [ ] Preparar una sola línea funciona en el visor y en la vista de tres paneles.
- [ ] La prueba contra Git pasa en Windows y Linux.

## Riesgos de la fase

- **Saltos de línea y filtros.** Si el blob difiere del que crea `git add`, el commit muestra líneas modificadas que el usuario no tocó. Es la razón de usar `--path` y de probar con `CRLF`.
- **Filtros externos** (por ejemplo Git LFS). `hash-object --path` los aplica, pero hay que probarlo con al menos uno antes de dar la fase por cerrada.
- **Marcadores huecos mal colocados** cuando I y W difieren mucho. Se acepta una posición aproximada, y se prueba que nunca falte un hunk preparado.
