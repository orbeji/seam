# Prueba: abortar un `stash pop` con conflictos

Fase 7, tarea 7.1. Comprobado con Git 2.53.0 en Linux, repositorios temporales.

## Para qué sirve esta prueba

`git stash pop` no deja ningún marcador de operación: no hay `MERGE_HEAD`, ni `CHERRY_PICK_HEAD`, ni carpeta de rebase. Cuando el pop choca con el árbol de trabajo, lo único que queda son las entradas sin fusionar en el índice y la propia entrada del stash. Tampoco existe `git stash --abort`. Esta prueba busca un procedimiento que deshaga el pop sin perder cambios ajenos ni la entrada guardada.

## Caso de partida

```
git init -b main
printf 'base\n' > f.txt
printf 'other\n' > other.txt
git add . && git commit -qm Base

printf 'stashed\n' > f.txt
git stash push -m 'Stashed change'

printf 'current\n' > f.txt
git commit -qam 'Current change'
git stash pop
```

El pop termina con código 1, `f.txt` queda en conflicto (`UU`) y `git stash list` sigue mostrando `Stashed change`.

## Qué NO sirve

`git checkout -- .` restaura el árbol entero, pero también borra cualquier cambio que el usuario tuviera en archivos que el stash no tocó. En el ejemplo, una edición en `other.txt` desaparecería. Lo mismo pasa con `git reset --hard`, que además mueve el índice y puede descartar trabajo no relacionado.

## Procedimiento seguro

El pop solo debe deshacerse en las rutas que el stash modifica. Es seguro restaurarlas a `HEAD` porque Git rechaza un pop que sobrescribiría cambios locales en esas mismas rutas.

1. Leer las rutas del stash superior:

   ```
   git diff --name-only -z 'stash@{0}^1' 'stash@{0}'
   ```

   Si el stash se creó con `-u`, las rutas no rastreadas están en el tercer padre:

   ```
   git diff --name-only -z 'stash@{0}^1' 'stash@{0}^3'
   ```

2. Para cada ruta, si existe en `HEAD`, restaurar índice y árbol:

   ```
   git checkout -q HEAD -- <ruta>
   ```

   Si el stash la añadió y no existe en `HEAD`, sacarla del índice y borrarla del árbol:

   ```
   git reset -q HEAD -- <ruta>
   rm -f <ruta>
   ```

3. Limpiar la información de resolución que Git acaba de registrar:

   ```
   git update-index --clear-resolve-undo
   ```

4. **No** borrar el stash. El pop fallido no consumió la entrada; el usuario la conserva para volver a intentarlo.

## Por qué hace falta el paso 3

Al restaurar una ruta en conflicto, Git resuelve su entrada del índice y guarda las tres fases anteriores en `resolve-undo`. Comprobado:

```
git checkout HEAD -- f.txt
git ls-files --resolve-undo
# 100644 … 1  f.txt
# 100644 … 2  f.txt
# 100644 … 3  f.txt
```

La lista de conflictos de Seam lee precisamente `resolve-undo` para ofrecer «Revert conflict resolution». Sin limpiarlo, después de abortar el pop la ventana seguiría mostrando `f.txt` como un archivo resuelto, y además `readStashCandidate` lo usaría para volver a ofrecer el mismo stash. `git update-index --clear-resolve-undo` elimina esa información. Git no ofrece una variante por ruta, así que se borra entera; es aceptable porque el aborto deshace el pop completo, aunque también se pierda el historial de resoluciones anteriores que el índice todavía guardara.

## Terminar el pop

Cuando ya no quedan entradas sin fusionar, el pop está resuelto y basta con descartar la entrada que Git conservó:

```
git stash drop 'stash@{0}'
```

Los cambios resueltos siguen en el índice y en el árbol para que el usuario los confirme con un commit normal. Seam comprueba antes que no queda ningún archivo sin fusionar; si lo hay, no ofrece terminar.

## Resultado en Seam

- `abortStash` restaura solo las rutas del stash y las que están sin fusionar, limpia `resolve-undo` y conserva la entrada.
- `finishStash` descarta `stash@{0}` únicamente cuando ya no hay conflictos.
- El resto de archivos modificados antes del pop quedan intactos; la prueba de integración comprueba que una edición en `other.txt` sobrevive al aborto.
