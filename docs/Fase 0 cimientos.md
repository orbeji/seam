# Fase 0: cimientos

La fase 0 deja un repositorio con la CI en verde en Windows y Linux y una ventana mínima que lista los cambios de un repositorio real. Tamaño M, sin dependencias.

## Alcance

- **Dentro:** repositorio y herramientas, CI, ejecutor de Git, parser de estado, detector de operación en curso, repositorios de ejemplo, prueba de `git checkout --merge`, ventana con las listas y catálogo de textos.
- **Fuera:** diff, staging, commit y todo lo que escriba en el repositorio. En esta fase Seam solo lee.

## Diseño técnico

### Ejecutor de Git

Una sola función lanza `git` como proceso hijo, sin shell, con los argumentos en una lista y la carpeta del repositorio como directorio de trabajo. La salida se devuelve como bytes, porque cada archivo tiene su propia codificación y se decodifica más tarde.

```ts
interface GitRunOptions {
  stdin?: string | Uint8Array;
  env?: Record<string, string>;
  signal?: AbortSignal;      // cancelar el proceso
  timeoutMs?: number;        // 30 000 por defecto
  readOnly?: boolean;        // consulta que no debe tocar el índice
}
interface GitResult { code: number; stdout: Uint8Array; stderr: string }

function runGit(repo: string, args: string[], opts?: GitRunOptions): Promise<GitResult>;
```

Los errores son de cuatro tipos: Git no encontrado, Git demasiado antiguo, comando fallido (con código y `stderr`) y cancelado o agotado el tiempo.

| Variable | Valor | Para qué |
| --- | --- | --- |
| `LC_ALL` | `C` | Mensajes de Git estables en inglés, para reconocer errores concretos. |
| `GIT_TERMINAL_PROMPT` | `0` | Si Git necesita credenciales falla en vez de esperar una terminal que no existe. |
| `GIT_OPTIONAL_LOCKS` | `0`, solo en consultas | `git status` no intenta refrescar el índice, y así no choca con una escritura de Seam ni con la terminal del usuario. |
| `GIT_EDITOR` | `true`, solo en operaciones que podrían abrir un editor | Git nunca abre un editor. |

Git se busca en el `PATH`. En Windows, si no aparece, se prueban las rutas habituales de Git for Windows. La versión se lee de `git --version` y debe ser 2.30 o posterior.

### Parser de estado

Se usa `git status --porcelain=v2 --branch -z --untracked-files=all`. Respecto a la especificación se añade `--branch`, que da la rama actual, su upstream y cuántos commits va por delante o por detrás. El resultado es una lista de entradas con tipo:

```ts
type ConflictCode = 'DD' | 'AU' | 'UD' | 'UA' | 'DU' | 'AA' | 'UU';

type StatusEntry =
  | { kind: 'ordinary'; x: string; y: string; path: string; modes: Modes }
  | { kind: 'renamed'; x: string; y: string; path: string; origPath: string; score: number }
  | { kind: 'unmerged'; xy: ConflictCode; path: string; modes: Modes }
  | { kind: 'untracked'; path: string };

interface RepoStatus {
  branch: { oid: string | null; head: string | null; upstream?: string; ahead?: number; behind?: number };
  entries: StatusEntry[];
}
```

Con `-z` las rutas no se escapan y los renombrados traen la ruta original tras un separador nulo. El parser se escribe sobre salidas reales guardadas como ejemplo, no sobre texto inventado.

### Detector de operación en curso

Para cada marcador se pregunta a Git dónde está con `git rev-parse --git-path <nombre>`, no se asume `.git/`: así funciona en worktrees y submódulos.

| Operación | Marcador |
| --- | --- |
| merge | `MERGE_HEAD` |
| cherry-pick | `CHERRY_PICK_HEAD` |
| revert | `REVERT_HEAD` |
| rebase | carpeta `rebase-merge` o `rebase-apply` |
| stash pop o apply con conflictos | ninguno; solo se ven entradas sin fusionar en el estado |

### Repositorios de ejemplo

Un script crea los repositorios en una carpeta temporal en cada ejecución, con identidad y fechas fijas (`GIT_AUTHOR_DATE`, `GIT_COMMITTER_DATE`) para que los commits sean reproducibles.

1. **limpio:** dos commits y ningún cambio.
2. **mixto:** un archivo preparado, uno modificado, uno borrado, uno renombrado, uno sin seguimiento, uno con permiso de ejecución, uno binario y uno con espacios y acentos en el nombre.
3. **conflictos:** un merge detenido con un archivo de cada tipo de conflicto (UU, AA, DU, UD) y un binario modificado en las dos ramas.

Los de rebase, cherry-pick y stash se añaden en las fases 5 y 7.

### Ventana mínima

Electron con `contextIsolation` activado, `nodeIntegration` desactivado y `sandbox` activado. La interfaz llama a un puente tipado (`window.seam`) que reenvía a manejadores del proceso principal. El primero es `repo:status`. Un selector de carpeta abre un repositorio, y los recientes se guardan en la carpeta de datos de la aplicación. Todos los textos salen del catálogo de traducciones desde la primera pantalla.

## Tareas en orden

| N.º | Tarea | Resultado comprobable |
| --- | --- | --- |
| 1 | Repositorio con licencia MIT, TypeScript estricto, ESLint, Prettier y electron-vite | `npm run dev`, `lint`, `typecheck`, `test` y `build` funcionan sobre un clon limpio |
| 2 | Regla de ESLint de importaciones entre `core`, `main` y `renderer` | Un archivo de `renderer` que importe `core/git` hace fallar el lint |
| 3 | CI en GitHub Actions | Un pull request de prueba queda en verde en ubuntu-latest y windows-latest |
| 4 | Ejecutor de Git | Pruebas de éxito, código distinto de cero, cancelación, tiempo agotado, entrada por `stdin`, salida binaria y ruta con espacios |
| 5 | Comprobación de versión | Con una versión simulada anterior a 2.30 devuelve el error de versión con un mensaje claro |
| 6 | Parser de estado | Pruebas con salidas reales de cada tipo de entrada, incluidas rutas con espacios, acentos y renombrados |
| 7 | Detector de operación | Un repositorio por operación devuelve la operación correcta; uno limpio devuelve ninguna |
| 8 | Script de repositorios de ejemplo | Los tres repositorios se crean igual en Windows y Linux |
| 9 | Prueba de `git checkout --merge` | Resultado escrito en `docs/spikes/fase-0-checkout-merge.md` |
| 10 | Ventana mínima y catálogo de textos | La ventana lista Staged, Unstaged, Untracked y conflictos de una carpeta elegida, en inglés y en español |

### La prueba de `git checkout --merge`

Se resuelve un archivo del repositorio de conflictos con `git add`, y después se ejecuta `git checkout --merge -- <ruta>`. Debe volver el archivo con marcadores de conflicto y las entradas sin fusionar en el índice. Se repite con un archivo borrado por un lado y resuelto con `git rm`. Si Git no restaura alguno de los casos, el plan alternativo es que Seam guarde las tres versiones antes de resolver y regenere los marcadores con `git merge-file -p`. Esa decisión afecta a la fase 5.

## Pruebas

- Vitest sobre cada pieza, con repositorios temporales reales, no con salidas simuladas, salvo la versión de Git.
- Toda prueba corre en Windows y Linux desde el primer pull request.
- Una prueba de humo con Playwright abre la ventana sobre el repositorio mixto y comprueba que aparecen las cuatro listas con el número de archivos esperado.

## Criterio de hecho

- [ ] La CI queda en verde en Windows y Linux.
- [ ] Un script lista Staged, Unstaged, Untracked y conflictos de los tres repositorios de ejemplo en los dos sistemas.
- [ ] La ventana muestra lo mismo para una carpeta elegida a mano.
- [ ] El resultado de la prueba de `checkout --merge` está documentado, con plan alternativo si hace falta.
- [ ] La regla de importaciones falla cuando se incumple.

## Riesgos de la fase

- **`PATH` distinto al abrir la aplicación desde el escritorio.** En Windows y en algunos entornos Linux el `PATH` de una aplicación gráfica no es el de la terminal. Se prueba lanzando la aplicación desde el escritorio, no solo desde la terminal.
- **Un comando de la especificación no se comporta como se espera.** Se descubre aquí, no en la fase 5. Cualquier cambio se anota en la especificación antes de empezar la fase 1.
