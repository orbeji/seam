# Ramas, fusiones y GitFlow

## Barra superior

La barra agrupa las operaciones de rama antes de las de remoto y deja GitFlow
aparte, después de Push:

`Merge · Branch | Fetch · Pull · Push | GitFlow`

- **Branch** abre el gestor de ramas: crea una rama local desde HEAD, desde
  otra rama o desde una etiqueta, y permite renombrar o eliminar las existentes.
  Una rama con commits sin fusionar solo se borra si se marca la casilla de
  forzar.
- **Merge** fusiona una rama local o remota en la rama actual. Estrategias:
  commit de fusión (`--no-ff`), solo avance rápido (`--ff-only`) o squash, que
  deja los cambios preparados para el siguiente commit.
- **GitFlow** es un único diálogo dinámico.

## Diálogo GitFlow

El diálogo tiene tres caras:

1. **Sin configurar**: pide las ramas master y develop, los prefijos de feature,
   release y hotfix, y el prefijo de las etiquetas de versión. Al inicializar,
   crea develop desde master si no existe y guarda todo en la configuración
   local del repositorio (`gitflow.*`).
2. **En una rama feature, release o hotfix**: ofrece terminarla. Feature se
   fusiona con `--no-ff` en develop y se elimina. Release y hotfix se fusionan
   en master, se etiquetan, master se fusiona de vuelta en develop y la rama se
   elimina. La etiqueta propuesta es `<prefijo><nombre>` y se puede editar.
3. **En cualquier otra rama**: permite iniciar una feature o release desde
   develop, o un hotfix desde master.

No se depende del ejecutable `git-flow`: Seam ejecuta `git` directamente. No se
hacen push automáticos.

## Terminaciones interrumpidas

Si una fusión del finish se detiene por conflictos, los pasos que faltan se
guardan en `<git-dir>/seam/gitflow-finish.json`. La lista de conflictos toma el
control; al resolver y confirmar el commit de fusión, Seam continúa el finish
desde el paso guardado. Si se aborta la operación, el registro pendiente se
borra para que no se reanude por error.

## Contrato

Las nuevas operaciones viven en `src/core/git` (`branch`, `merge`, `gitflow`) y
se exponen por IPC con el contrato 28:

- `branch:create`, `branch:rename`, `branch:delete`
- `merge:state`, `merge:start`
- `gitflow:read`, `gitflow:init`, `gitflow:start`, `gitflow:finish`
