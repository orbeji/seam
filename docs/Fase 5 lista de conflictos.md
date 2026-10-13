# Fase 5: lista de conflictos

La fase 5 muestra los conflictos y resuelve los que no necesitan editor: aceptar un lado, conservar o borrar un archivo, resolver los simples de golpe y deshacer una resolución. Tamaño M, depende de las fases 0, 2 y 4: usa la ventana y las listas, el motor de merge para los conflictos simples y el panel de commit.

## Alcance

- **Dentro:** detección de operación y conflictos, diálogo de conflictos, nodo Merge Conflicts en la lista de cambios, Accept Yours y Accept Theirs, casos de borrado, archivos binarios, Resolve all simple conflicts y Revert conflict resolution.
- **Fuera:** el editor de tres paneles (fase 6) y las acciones Accept and Finish y Abort, que se implementan en la fase 7; en esta fase quedan visibles y desactivadas.

## Diseño técnico

### Cómo se llega a un conflicto

La especificación no incluye pantallas para empezar un merge, un rebase, un cherry-pick ni un stash pop. En 0.1.0 empiezan en la terminal o en otra herramienta, y Seam los detecta al refrescar: operación en curso (fase 0) más entradas sin fusionar. La fase 8 ejecuta un rebase o un merge solo en el flujo de push rechazado. La herramienta de referencia sí los lanza desde su interfaz; en Seam sería una ampliación posterior.

El diálogo se abre solo la primera vez que aparecen conflictos en una operación, no en cada refresco. Si se cierra, la lista de cambios muestra un nodo Merge Conflicts con el enlace Resolve y los botones Resolve Conflicts y Abort.

### Tipos de conflicto

Salen del código de dos letras del estado: la primera es el lado de HEAD y la segunda el otro lado.

| Código | Significado | Qué se puede hacer |
| --- | --- | --- |
| `UU` | Ambos modificaron | Editor de merge, Accept Yours o Accept Theirs |
| `AA` | Ambos añadieron | Lo mismo, con la base vacía |
| `DU` | Borrado en el lado de HEAD y modificado en el otro | Conservar el archivo o borrarlo |
| `UD` | Modificado en el lado de HEAD y borrado en el otro | Conservar el archivo o borrarlo |
| `AU`, `UA` | Añadido solo en un lado | Conservar el archivo o borrarlo |
| `DD` | Borrado en los dos | Confirmar el borrado |
| Binario (`UU` o `AA`) | Sin texto que fusionar | Solo Accept Yours o Accept Theirs |

### Yours y Theirs

Git llama `ours` al lado de HEAD y `theirs` al otro. Eso es lo que la herramienta de referencia describe como Yours (la rama activa) y Theirs (la que se une) en un merge. En un rebase la correspondencia se invierte, porque durante el rebase HEAD es la base nueva y el commit que se reaplica es `theirs`.

| Operación | Lado `ours` de Git | Lado `theirs` de Git | Yours en Seam | Theirs en Seam |
| --- | --- | --- | --- | --- |
| merge | Rama actual | Rama que se une | `ours` | `theirs` |
| cherry-pick | Rama actual | Commit que se aplica | `ours` | `theirs` |
| revert | Rama actual | El commit revertido, en forma inversa | `ours` | `theirs` |
| stash pop | Rama actual | El stash | `ours` | `theirs` |
| rebase | La base nueva | El commit que se reaplica | `theirs` (tus commits) | `ours` (la base) |

La fila del rebase es una propuesta de Seam, porque la documentación de la herramienta de referencia solo define Yours como la rama activa. Hay que confirmarla contigo antes de implementarla (ver el final del capítulo). En cualquier caso, cada panel y cada botón muestran el nombre de la rama o el commit de su lado, no solo Yours o Theirs.

### Acciones por archivo

| Acción | Comandos |
| --- | --- |
| Accept Yours o Accept Theirs | `git checkout --ours -- <ruta>` o `--theirs`, según la tabla anterior, y después `git add -- <ruta>` |
| Conservar el archivo (`DU`, `UD`, `AU`, `UA`) | `git add -- <ruta>` |
| Borrar el archivo (`DU`, `UD`, `AU`, `UA`, `DD`) | `git rm -- <ruta>` |
| Revert conflict resolution | `git checkout --merge -- <ruta>`, o el plan alternativo de la fase 0 |

`git checkout --ours` falla si ese lado borró el archivo, por eso los conflictos de borrado tienen sus propias acciones.

### Resolve all simple conflicts

Para cada archivo de texto sin fusionar se leen las tres versiones, se construye el modelo de la fase 2 y se llama a `autoResolve`. Si devuelve texto, se escribe el archivo con su codificación, su BOM y su salto de línea originales y se ejecuta `git add`. Si devuelve `null`, el archivo se deja como estaba. Al terminar se informa de cuántos archivos se resolvieron y cuántos quedan.

### Qué está resuelto

Un archivo sin fusionar sigue unmerged hasta que se ejecuta `git add`. Los ya resueltos desaparecen del estado, pero `git ls-files --resolve-undo` los lista mientras Git conserve la información para deshacerlos, incluso si Seam se reinicia. El diálogo combina las dos listas y muestra Unresolved o Resolved.

### Aviso de sobrescritura

Accept Yours y Accept Theirs descartan lo que haya en el archivo de trabajo. Si el archivo cambió desde que Seam detectó el conflicto (se compara una huella guardada), se pide confirmación antes de sobrescribirlo.

## Tareas en orden

| N.º | Tarea | Resultado comprobable |
| --- | --- | --- |
| 1 | Modelo de conflictos desde el estado, con tipo y archivos resueltos | Un repositorio con un conflicto de cada tipo devuelve la lista correcta |
| 2 | Correspondencia Yours y Theirs y etiquetas por operación | Los repositorios de merge, rebase, cherry-pick y stash muestran en cada lado la rama o commit correctos |
| 3 | Diálogo de conflictos y nodo Merge Conflicts | Se abre solo una vez por operación y se puede reabrir desde la lista |
| 4 | Accept Yours y Accept Theirs, texto y binario | El archivo queda con el contenido del lado elegido y deja de estar sin fusionar |
| 5 | Borrado: conservar, borrar y `DD` | Cada código de borrado termina como se espera |
| 6 | Resolve all simple conflicts | Resuelve los simples, no toca los demás e informa de los números |
| 7 | Revert conflict resolution | El archivo vuelve a estar sin fusionar, con marcadores |
| 8 | Aviso de sobrescritura | Un archivo editado a mano pide confirmación |
| 9 | Repositorios de ejemplo de rebase, cherry-pick y stash | Los scripts los crean igual en Windows y Linux |
| 10 | Pruebas de extremo a extremo | Una por operación, con el diálogo abierto y una acción de cada tipo |

## Pruebas

- **Contra la terminal.** Después de cada acción, `git ls-files -u` ya no lista el archivo y su contenido coincide con la versión del lado elegido (`git show :2:` o `:3:`).
- **Etiquetas.** En el repositorio de rebase, el panel de Yours muestra el commit que se reaplica; en el de merge, la rama actual.
- **Recuperación tras reiniciar.** Resolver un archivo, cerrar y abrir Seam, y comprobar que el archivo aparece como Resolved y se puede revertir.
- **Binarios.** Un binario modificado en las dos ramas solo ofrece Accept Yours y Accept Theirs.

## Criterio de hecho

- [ ] Merge, rebase y cherry-pick se detienen y muestran los lados con la etiqueta correcta.
- [ ] Cada tipo de conflicto de la tabla se puede resolver desde el diálogo, salvo los que requieren el editor.
- [ ] Revert conflict resolution funciona después de reiniciar Seam.
- [ ] Los botones de la fase 7 aparecen desactivados y explican por qué.

## Riesgos de la fase

- **Yours y Theirs en un rebase.** Es el error que más daño puede hacer, porque descarta el lado equivocado. Por eso hay etiquetas con nombres y una prueba por operación.
- **`rerere`.** Si el usuario tiene `rerere.enabled`, Git puede resolver conflictos con resoluciones anteriores. Se prueba con `rerere` activado para ver qué muestra el estado.
- **El plan alternativo de la fase 0.** Si `checkout --merge` no cubre todos los casos, esta fase cuesta más: hay que guardar las tres versiones antes de resolver.

## Decisión a confirmar

- [ ] Durante un rebase, ¿Yours son tus commits (como propone la tabla) o la base que recibes? Con la otra opción, Yours sería siempre el lado `ours` de Git.
