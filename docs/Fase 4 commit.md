# Fase 4: commit

La fase 4 permite confirmar lo que hay en el índice, con mensaje, amend, autor, sign-off, hooks y aviso de `CRLF`. Tamaño M, depende de la fase 3. Al terminarla, Seam sirve para el trabajo diario de preparar y confirmar cambios.

## Alcance

- **Dentro:** caja de mensaje con borrador, historial y plantilla, commit desde el índice, bloqueo cuando no hay nada preparado, amend, autor, sign-off, hooks, identidad que falta, salida de errores y aviso de `CRLF`.
- **Fuera:** Commit and Push (fase 8), reglas de longitud del mensaje, comprobaciones de commit propias de un IDE y la gestión de claves para commits firmados, que Git hace con su configuración.

## Diseño técnico

### El comando

El commit se crea siempre con `git commit` y el mensaje por `stdin`, codificado en UTF-8, con `GIT_EDITOR=true` para que Git no abra un editor.

| Opción de Seam | Argumento de Git |
| --- | --- |
| Mensaje | `-F -` |
| Amend | `--amend` |
| Autor distinto | `--author="Nombre <correo>"` |
| Sign-off | `--signoff` |
| No ejecutar hooks | `--no-verify` |

La página de la herramienta de referencia describe el sign-off como una línea «Signed off by»; Git añade el pie `Signed-off-by: Nombre <correo>` y Seam usa el de Git.

### Cuándo se puede confirmar

- El botón Commit se activa cuando hay al menos un archivo preparado, o cuando Amend está marcado (para solo reescribir el mensaje).
- Con entradas sin fusionar el botón queda desactivado con el motivo: hay conflictos sin resolver.
- Mientras hay un merge, rebase, cherry-pick o revert en curso, el botón Commit se sustituye por las acciones de la fase 7.

### Amend

Al marcarlo, el mensaje se rellena con `git log -1 --format=%B` y se muestra el identificador corto y el asunto del commit que se va a enmendar. Con cambios preparados se añaden al commit; sin ellos solo cambia el mensaje. Si `git branch -r --contains HEAD` devuelve alguna rama, se avisa de que el commit ya se publicó y de que enmendarlo obligará a un force push. Ese aviso es una adición de Seam.

### Identidad

Antes del primer commit se leen `user.name` y `user.email`. Si falta alguno, un diálogo los pide y deja elegir entre guardarlos solo en este repositorio o para todos. La herramienta de referencia también pide el nombre la primera vez que se confirma.

### Mensaje, historial y plantilla

- **Borrador.** Lo escrito sin confirmar se conserva al cambiar de archivo y al cerrar la aplicación.
- **Historial.** Los últimos 20 mensajes confirmados desde Seam en ese repositorio, en la carpeta de datos de la aplicación, con un botón para elegir uno.
- **Plantilla.** Si la caja está vacía, se rellena con el archivo de `git config commit.template`, expandiendo `~` al directorio personal.

### Hooks y errores

Los hooks de Git se ejecutan como en la terminal, incluido `core.hooksPath`. Seam no tiene terminal, así que un hook que pida algo por teclado falla o se queda esperando: hay un tiempo límite largo (cinco minutos) y un botón Cancelar. La salida del hook se muestra en un panel plegable bajo el botón. Si el hook falla no se crea el commit, el mensaje se conserva y el índice no cambia.

Con `LC_ALL=C` se reconocen los errores habituales por su texto: identidad desconocida (abre el diálogo de identidad), nada que confirmar y archivos sin fusionar.

### Aviso de `CRLF`

Antes de confirmar se ejecuta `git ls-files --eol -- <rutas preparadas>`. La salida indica el formato del índice (`i/`), el de la copia de trabajo (`w/`) y los atributos (`attr/`). Si algún archivo tiene `i/crlf` o `i/mixed` y no tiene atributos `text` ni `eol`, aparece un diálogo con tres opciones:

- **Commit As Is:** confirma tal cual.
- **Fix and Commit:** pone `core.autocrlf` a `true` en Windows o `input` en Linux, en la configuración del repositorio y no en la global, y vuelve a preparar esos archivos con `git add --renormalize` para que la conversión se aplique antes de confirmar. Se comprueba al final que ya no queda `i/crlf`.
- **Cancelar.**

Los archivos con atributos de Git quedan fuera del análisis, como en la herramienta de referencia. El aviso es un ajuste que viene activado de serie en Seam y se puede desactivar, por repositorio o en general.

### Después del commit

Se refresca el estado, se vacía la caja de mensaje y se desmarca Amend. Una notificación muestra el identificador corto, que se obtiene de `git rev-parse --short HEAD`, con un botón para copiarlo.

## Tareas en orden

| N.º | Tarea | Resultado comprobable |
| --- | --- | --- |
| 1 | Caja de mensaje con borrador | El texto sobrevive a cambiar de archivo y a reiniciar |
| 2 | Regla de activación del botón | Desactivado sin nada preparado y con conflictos; activado con Amend |
| 3 | Commit simple por `stdin` | El commit existe y su mensaje es el escrito, con Unicode incluido |
| 4 | Amend con mensaje previo y aviso de publicado | Reescribir el mensaje y añadir cambios al último commit |
| 5 | Detección de identidad y diálogo | Un repositorio sin `user.*` y con el directorio personal vacío abre el diálogo |
| 6 | Autor distinto y sign-off | El commit muestra el autor y el pie `Signed-off-by` |
| 7 | Hooks: interruptor, salida y errores | Un `pre-commit` que falla impide el commit y muestra su salida |
| 8 | Historial y plantilla | Elegir un mensaje anterior; plantilla cargada con la caja vacía |
| 9 | Aviso de `CRLF` y Fix and Commit | Un archivo `CRLF` sin atributos lanza el aviso; tras Fix and Commit el índice tiene `LF` |
| 10 | Notificación y refresco | Aparece el identificador y las listas se actualizan solas |

## Pruebas

- **Igual que la terminal.** Dos clones del mismo estado, uno confirmado con Seam y otro con `git commit` y las mismas opciones, con identidad y fechas fijas (`GIT_AUTHOR_DATE` y `GIT_COMMITTER_DATE`). Los identificadores de commit deben ser iguales.
- **Hooks.** Un `pre-commit` que falla, uno que imprime, un `commit-msg` que reescribe el mensaje y `--no-verify`.
- **Amend.** Con y sin cambios preparados, y sobre un commit ya publicado.
- **`CRLF`.** Un archivo sin atributos, uno con `* text=auto` en `.gitattributes` y uno que ya estaba normalizado.
- **Identidad.** Sin `user.name`, sin `user.email` y con los dos.

## Criterio de hecho

- [ ] Un commit de Seam es idéntico al de la terminal con las mismas opciones.
- [ ] Un hook que falla deja el índice y el mensaje como estaban.
- [ ] El botón está desactivado sin cambios preparados y con conflictos.
- [ ] El aviso de `CRLF` se muestra solo cuando corresponde.

## Riesgos de la fase

- **Hooks interactivos.** Si piden entrada por teclado, no funcionarán. Se muestra un mensaje que lo explica y se ofrece Cancelar.
- **Commits firmados.** Si `commit.gpgsign` está activo, la petición de contraseña depende de cómo tenga configurado el sistema su programa de firma. Se prueba en Windows y Linux y, si no hay forma limpia, se documenta como limitación de 0.1.0.
- **`--renormalize` y la versión de Git.** Existe desde Git 2.16, así que la versión mínima de 2.30 lo cubre. Se confirma en la prueba del aviso.
