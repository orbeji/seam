# Prueba: `git checkout --merge` para deshacer una resolución

Fase 0, tarea 9. Comprobado con Git 2.53.0 en Linux, repositorios temporales.

## Para qué sirve esta prueba

La fase 5 ofrece «Revert conflict resolution»: deshacer la resolución de un archivo y volver a dejarlo en conflicto, con sus marcadores y sus entradas sin fusionar en el índice. La especificación propone `git checkout --merge -- <ruta>`. Esta prueba comprueba para qué casos de conflicto funciona de verdad, porque de ello depende si Seam necesita un plan alternativo.

## Método

Para cada caso se crea un repositorio con una base, una rama `side` y la rama `main`, se provoca el conflicto con `git merge`, se resuelve el archivo y después se ejecuta:

```
git checkout --merge -- <ruta>
```

Se observa el código de salida, el contenido del archivo y `git ls-files --unmerged` para ver si vuelven las tres versiones.

## Resultados

| Conflicto | Resuelto con | Resultado |
| --- | --- | --- |
| `UU` (los dos modifican) | `git add` | Funciona. Sale 0, vuelven los marcadores y las tres fases. |
| `AA` (los dos añaden) | `git add` | Funciona. Sale 0, vuelven los marcadores y las dos fases propias del caso. |
| `UD` (ellos borran) | `git add` (conservar) | **Falla.** Sale 1: `error: path 'g.txt' does not have all necessary versions`. |
| `UD` (ellos borran) | `git rm` | **Falla.** El mismo error. |
| `DU` (nosotros borramos) | `git add` (conservar) | **Falla.** El mismo error. |
| `DU` (nosotros borramos) | `git rm` | **Falla.** El mismo error. |

En los casos que funcionan, el archivo vuelve con:

```
<<<<<<< ours
ours
=======
theirs
>>>>>>> theirs
```

En los que fallan, el índice conserva la resolución (la fase 0 del archivo desaparece) y `git ls-files --unmerged` queda vacío para esa ruta.

### Por qué falla en los conflictos con borrado

Git guarda en `resolve-undo` las fases que había antes de resolver, y eso es lo que reutiliza `checkout --merge`. Pero `checkout --merge` necesita las **tres** fases para reconstruir la fusión, y un conflicto de modificación/borrado solo tiene dos:

- `UD` (ellos borran): fases 1 (base) y 2 (nuestro).
- `DU` (nosotros borramos): fases 1 (base) y 3 (suyo).

Comprobado con `git ls-files --resolve-undo -z` tras `git rm`: quedan registradas las fases 1 y 2, pero `checkout --merge` igualmente se niega con «does not have all necessary versions».

## Conclusión

`git checkout --merge -- <ruta>` sirve para deshacer una resolución **solo cuando el conflicto conservaba las tres fases** (los dos lados presentes, como `UU` y `AA`). Para cualquier conflicto al que le falte una fase (modificación/borrado y borrado en los dos lados) no sirve.

Esto confirma la sospecha de la especificación y obliga al plan alternativo en la fase 5:

1. **Antes de resolver**, guardar las tres versiones del archivo (`git show :1:<ruta>`, `:2:<ruta>`, `:3:<ruta>`), también cuando una falta.
2. **Al deshacer**, regenerar los marcadores con `git merge-file -p` a partir de las tres versiones guardadas y volver a escribir las fases en el índice.

El plan alternativo no es un caso raro: los conflictos de borrado son habituales, así que la fase 5 debe usar el camino propio para ellos, no `checkout --merge`.

## Impacto

- Fase 5: «Revert conflict resolution» usa `checkout --merge` para `UU`/`AA` y el camino con `git merge-file` para los conflictos con borrado. La decisión de guardar las tres versiones antes de resolver afecta a todas las acciones de la fase.
- Fase 6: el editor de tres paneles ya necesita las tres versiones, así que la captura previa que pide este plan se reutiliza.
