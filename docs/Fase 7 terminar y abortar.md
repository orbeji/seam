# Fase 7: terminar y abortar

La fase 7 cierra el ciclo de un conflicto: cuando todo está resuelto, «Accept and finish» termina la operación en curso (merge, cherry-pick, revert o rebase), y «Abort» la deshace. Cada operación de Git se termina y se aborta con un comando distinto, por eso esta fase es sobre todo una tabla bien probada.

## Alcance

- Botón «Accept and finish» activo solo con todos los archivos resueltos.
- Botón «Abort» con confirmación, por operación.
- Continuar un rebase y saltar un commit, con el progreso visible (por ejemplo, «commit 3 de 7»).
- Si el rebase se detiene otra vez en el siguiente commit, la lista de conflictos se recarga sola.
- Casos de borde: hooks que fallan, mensaje de commit pendiente, operación terminada desde la terminal mientras Seam está abierto.

## Diseño técnico

### Terminar y abortar, por operación

La operación en curso se detecta con los marcadores de la fase 0. Todos los comandos llevan `GIT_EDITOR=true` para que Git no abra un editor.

| Operación | Terminar | Abortar | Saltar commit |
| --- | --- | --- | --- |
| Merge | `git commit --no-edit` | `git merge --abort` | No aplica |
| Cherry-pick | `git cherry-pick --continue` | `git cherry-pick --abort` | `git cherry-pick --skip` |
| Revert | `git revert --continue` | `git revert --abort` | `git revert --skip` |
| Rebase | `git rebase --continue` | `git rebase --abort` | `git rebase --skip` |
| Stash pop/apply | No hay operación; basta con commit o dejar el árbol | `git checkout -- .` más `git reset` (ver abajo) | No aplica |

### Mensaje del commit

En un merge, «Accept and finish» usa el mensaje que Git ya dejó en `MERGE_MSG`. En una pantalla previa opcional se puede editar, con la misma caja de mensaje de la fase 4. En un rebase se conserva el mensaje del commit que se repite; si el usuario quiere cambiarlo, lo hace después con amend.

### Progreso del rebase

Se lee de `rebase-merge/msgnum` y `rebase-merge/end` (o `rebase-apply/next` y `last`). El resultado se muestra en la cabecera de la lista de conflictos y se actualiza tras cada `--continue`. Si el comando termina con código 0 y ya no existe el directorio de rebase, la operación acabó y se muestra un mensaje de éxito.

### Qué pasa tras continuar

- Con código 0 y sin operación activa: se cierra la ventana de conflictos y se refresca el estado.
- Con código distinto de 0 y marcadores todavía presentes: Git se detuvo en otro commit con conflictos. Se recarga la lista, que ahora refleja el nuevo commit.
- Con código distinto de 0 y sin conflictos: un hook o un error de Git. Se muestra la salida completa en un diálogo, sin perder el estado.

### Stash pop sin operación propia

`git stash pop` con conflictos no deja marcadores de operación y conserva el stash. Seam trata el caso así: cuando el usuario termina de resolver, el stash sigue existiendo y se ofrece borrarlo (`git stash drop`). Abortar no tiene comando nativo; hay que restaurar el árbol al estado previo. Esto necesita un experimento antes de implementarlo (tarea 7.1).

### Cambios hechos fuera de Seam

El observador de la fase 3 detecta que desapareció `MERGE_HEAD` o el directorio de rebase. Si Seam tiene abierta la lista de conflictos, la cierra con un aviso «La operación terminó fuera de Seam».

## Tareas en orden

| # | Tarea | Resultado | Depende de |
| --- | --- | --- | --- |
| 7.1 | Experimento: abortar un stash pop con conflictos | Nota en `docs/spikes/fase-7-stash.md` con el procedimiento seguro | Fase 0 |
| 7.2 | Servicio `finishOperation(repo)` por operación | Tabla anterior implementada y probada en repos de ejemplo | Fase 0 |
| 7.3 | Servicio `abortOperation(repo)` | Restaura el árbol al estado previo en cada operación | 7.1 |
| 7.4 | Lectura del progreso de rebase | «3 de 7» correcto en cada paso | 7.2 |
| 7.5 | Botones y estados en la lista de conflictos | Activos o no según el estado; confirmación de abortar | Fase 5 |
| 7.6 | Recarga tras `--continue` en rebase | La lista cambia al siguiente commit sin cerrar la ventana | 7.4 |
| 7.7 | Diálogo de error con la salida de Git | Los errores de hooks se leen completos | 7.2 |
| 7.8 | Detección de fin externo | Aviso y cierre si la operación acaba desde la terminal | Fase 3 |

## Pruebas

- Para cada fila de la tabla, una prueba de integración con un repositorio de ejemplo: provocar el conflicto, resolver, terminar, y comparar el id del commit resultante con el que produce la terminal.
- Un rebase de cuatro commits con conflicto en el segundo y en el cuarto: la lista se recarga dos veces y el árbol final coincide con el de la terminal.
- Abortar cada operación deja `git status` limpio y el `HEAD` original.
- Un hook `pre-commit` que falla: Seam muestra la salida y no pierde las resoluciones.
- Terminar la operación desde la terminal con Seam abierto: la ventana se cierra con el aviso.

## Criterio de terminado

- [ ] Merge, cherry-pick, revert y rebase se terminan y se abortan desde Seam, con el mismo resultado que en la terminal.
- [ ] El progreso del rebase es correcto en cada paso.
- [ ] Un fallo de hook se muestra y se puede reintentar sin perder trabajo.
- [ ] El caso del stash está documentado y tiene un procedimiento probado.

## Riesgos de la fase

- Abortar descarta trabajo de resolución. Mitigación: confirmación que indica cuántos archivos resueltos se perderán.
- La diferencia entre `rebase-merge` y `rebase-apply` en versiones antiguas de Git. Mitigación: probar con Git 2.30 y con la última versión en integración continua.
- El stash sin comando de aborto puede dejar el árbol a medias. Mitigación: no ofrecer «Abort» en ese caso hasta que el experimento 7.1 lo valide.

## Decisión a confirmar

- [ ] ¿El resultado de «Accept and finish» en un merge crea el commit directamente con el mensaje por defecto, o se abre antes la caja de mensaje de la fase 4? La propuesta es abrirla, para que el usuario pueda editar el mensaje, con el texto por defecto ya rellenado.
