# Fase 1: diff y visor

La fase 1 entrega el visor de diferencias: dado un archivo y dos versiones suyas, lo muestra lado a lado o unificado, con resaltado por palabra y las opciones de espacios de la herramienta de referencia. Tamaño L, depende de la fase 0.

## Alcance

- **Dentro:** motor de diff por línea, palabra y carácter; carga de versiones (HEAD, índice, copia de trabajo, y las tres versiones de un conflicto); visor lado a lado y unificado; plegado de bloques sin cambios; navegación; detección de lenguaje; archivos binarios y grandes.
- **Fuera:** marcadores de preparación en el margen y acciones de stage (fase 3), editor de tres paneles (fase 6) y anotaciones de blame (después de 0.1.0).

## Diseño técnico

### Motor de diff

Es código puro en `core/diff`, sin dependencias de Node ni del navegador, y se ejecuta en un Web Worker para no bloquear la interfaz con archivos grandes. La línea y la palabra comparten interfaz:

```ts
interface LineHunk { aStart: number; aLines: number; bStart: number; bLines: number }

type WhitespaceMode = 'none' | 'trim' | 'ignore' | 'ignore-and-blank';

function diffLines(a: string[], b: string[], ws: WhitespaceMode): LineHunk[];

interface InlineChange { aFrom: number; aTo: number; bFrom: number; bTo: number }
function diffInline(a: string, b: string, unit: 'word' | 'char'): InlineChange[];
```

El algoritmo es Myers detrás de esta interfaz, con una librería de diff existente o con una implementación propia; si las pruebas muestran diffs poco legibles se cambia a patience sin tocar el resto.

Los modos de espacios no se implementan alterando el texto, sino comparando una clave por línea y devolviendo siempre rangos sobre las líneas originales:

| Modo | Clave de comparación de cada línea |
| --- | --- |
| `none` | La línea tal cual. |
| `trim` | La línea sin espacios ni tabuladores al principio y al final. |
| `ignore` | La línea sin ningún espacio ni tabulador. |
| `ignore-and-blank` | Como `ignore`, y las líneas que solo contienen espacios quedan fuera del diff, así que añadir o quitar líneas en blanco no cuenta. |

El modo de la herramienta de referencia «ignorar importaciones y formato» depende del lenguaje y no entra en 0.1.0.

### Cargar las versiones de un archivo

```ts
type VersionSource = 'head' | 'index' | 'worktree' | 'stage1' | 'stage2' | 'stage3';
interface FileVersion { source: VersionSource; bytes: Uint8Array | null; mode: string | null }
```

Se leen con `git cat-file blob HEAD:<ruta>`, `:0:<ruta>` para el índice y `:1:`, `:2:`, `:3:` para los lados de un conflicto. La copia de trabajo se lee del disco. Una versión que no existe se devuelve como `null`, no como texto vacío, para distinguir un archivo borrado de uno vacío.

**Saltos de línea.** Con `core.autocrlf` o atributos de Git, el índice guarda `LF` aunque el archivo de trabajo tenga `CRLF`. Comparar los bytes tal cual marcaría todo el archivo como modificado. La propuesta es consultar `git ls-files --eol -- <ruta>` y normalizar la copia de trabajo cuando el índice no tiene `CR`. Es lo primero que se comprueba en esta fase, con un archivo `CRLF` en un repositorio con `core.autocrlf=true`.

**Binarios.** Un byte nulo en los primeros 8 000 bytes marca el archivo como binario. No se calcula diff: se muestra que difiere y el tamaño de cada lado.

### Visor

Se construye sobre CodeMirror 6 con tres piezas:

- **Vista lado a lado:** dos editores, el de la derecha editable solo cuando es la copia de trabajo. El paquete de merge de CodeMirror da dos paneles y modo unificado; el primer día se comprueba si acepta un diff calculado por el motor propio. Si no, el visor usa los mismos elementos de base (decoraciones de línea y de rango, y widgets de relleno).
- **Alineación:** los bloques que solo existen en un lado se compensan con widgets de relleno en el otro, para que las líneas correspondientes queden a la misma altura. Con alineación desactivada se quitan los rellenos.
- **Modo unificado:** un editor con las líneas borradas como widgets de solo lectura sobre las añadidas.

Colores: verde para añadido, azul para modificado, gris para borrado, con un tono más fuerte en las palabras que cambian dentro de una línea modificada.

### Lenguaje

Se detecta por nombre de archivo y extensión con `LanguageDescription.matchFilename`, y por la primera línea (`#!`) cuando no hay extensión. El paquete del lenguaje se carga bajo demanda; si no existe, el archivo se muestra como texto.

### Archivos grandes

Por encima de 5 MB o 50 000 líneas (umbral propuesto, a ajustar con archivos reales) se desactiva el resaltado por palabra y el visor trabaja solo por línea.

## Tareas en orden

| N.º | Tarea | Resultado comprobable |
| --- | --- | --- |
| 1 | Interfaz `diffLines` y una implementación | Casos límite: archivo vacío, un solo lado vacío, sin salto final, `CRLF`, caracteres Unicode |
| 2 | Modos de espacios | Una prueba por modo con pares de líneas que difieren solo en espacios |
| 3 | `diffInline` por palabra y carácter | Cambios dentro de una línea con cada unidad |
| 4 | Carga de versiones y normalización de saltos de línea | Un archivo `CRLF` con `core.autocrlf=true` no aparece como modificado entero |
| 5 | Visor lado a lado con alineación y desplazamiento sincronizado | Las líneas correspondientes quedan a la misma altura en el repositorio mixto |
| 6 | Modo unificado | Mismo contenido que el lado a lado, con las líneas borradas visibles |
| 7 | Plegado de bloques sin cambios | Cada pliegue conserva el número de líneas de contexto configurado y se expande al hacer clic |
| 8 | Navegación | F7 y Shift+F7 recorren las diferencias; al llegar a la última pasa al archivo siguiente |
| 9 | Opciones del visor (barra y menú) | Resaltado, espacios, alineación y plegado se cambian sin recargar |
| 10 | Lenguaje, binarios y archivos grandes | Un archivo PHP, uno sin extensión con `#!`, un binario y uno de 6 MB se muestran como se espera |

## Pruebas

- **Propiedad del diff.** Para textos aleatorios, aplicar los hunks a `a` produce exactamente `b`. Es la prueba que más errores encuentra.
- **Comparación con Git.** Para un conjunto de pares de archivos, los hunks de `diffLines` con modo `none` coinciden en número y rangos con `git diff --no-index --unified=0`, salvo diferencias de alineación que se documentan.
- **Visor.** Pruebas de extremo a extremo con Playwright que abren el repositorio mixto y comprueban la cuenta de diferencias y los modos.
- **Rendimiento.** Un archivo de 5 MB se abre sin bloquear la interfaz.

## Criterio de hecho

- [ ] El visor cumple la sección Diff viewer de la especificación sobre el repositorio mixto, lado a lado y unificado.
- [ ] Los cinco modos de resaltado y los cuatro de espacios funcionan desde la barra.
- [ ] Un archivo `CRLF` en un repositorio con `core.autocrlf=true` no se marca como modificado entero.
- [ ] La propiedad «aplicar los hunks reconstruye `b`» pasa con miles de casos aleatorios.

## Riesgos de la fase

- **Alineación en archivos grandes.** Los widgets de relleno pueden ser caros con miles de diferencias. Se mide con un archivo real antes de dar la fase por cerrada.
- **El paquete de merge de CodeMirror no admite diff propio.** El plan alternativo ya está en el diseño: construir el visor con los elementos de base. Cuesta más tiempo, y el tamaño L lo cubre.
