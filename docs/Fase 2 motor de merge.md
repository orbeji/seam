# Fase 2: motor de merge

La fase 2 entrega el motor de tres vías: dadas la base y los dos lados de un archivo, calcula las regiones del merge, las clasifica y ofrece las operaciones que construyen el resultado. No tiene interfaz. Tamaño L, depende de la fase 1, de la que reutiliza el diff por línea y por palabra.

## Alcance

- **Dentro:** regiones y clasificación, resultado inicial desde la base, aplicar cambios no conflictivos (todos, solo izquierda, solo derecha), aceptar, ignorar y revertir por región, conflictos simples, seguimiento de los rangos del resultado.
- **Fuera:** pantallas (fase 6), lectura de las tres versiones del repositorio (ya resuelta en la fase 1) y escritura del archivo resuelto (fases 5 y 6).

## Diseño técnico

### Modelo

El código vive en `core/merge` y es puro, como el del diff. Las líneas se separan de su salto de línea (`LF` o `CRLF`), que se guarda aparte para escribirlo igual al final.

```ts
interface LineRange { start: number; end: number }   // [start, end) en líneas

type RegionKind = 'left-only' | 'right-only' | 'same' | 'conflict';
type SideState = 'none' | 'pending' | 'applied' | 'ignored';

interface MergeRegion {
  id: number;
  kind: RegionKind;
  base: LineRange;
  left: LineRange;
  right: LineRange;
  result: LineRange;        // rango en el texto del resultado
  leftState: SideState;     // 'none' si ese lado no cambió la región
  rightState: SideState;
  edited: boolean;          // el usuario cambió el texto de la región a mano
  simple: boolean;          // conflicto que se resuelve por palabra o carácter
}

interface MergeModel { base: string[]; left: string[]; right: string[]; regions: MergeRegion[] }
```

Una región está resuelta cuando ninguno de sus lados con cambios sigue en `pending`, o cuando el usuario editó su texto. El archivo está resuelto cuando lo están todas las regiones.

### Algoritmo

1. **Dos diffs.** `diffLines` de la base contra la izquierda y de la base contra la derecha, con el modo de espacios `none`. Cada hunk indica su rango en la base y las líneas que lo sustituyen.
2. **Barrido.** Se recorren los hunks de ambos lados en el orden de la base. Un hunk abre una región; mientras el siguiente hunk de cualquier lado solape o toque el rango actual, se une a ella. Tocar cuenta, porque Git trata los cambios en líneas contiguas como conflicto.
3. **Rango en cada lado.** El rango de la base se traslada a cada lado con el desplazamiento acumulado de los hunks anteriores de ese lado. Un lado sin hunks en la región copia las líneas de la base.
4. **Clasificación.** Solo cambió la izquierda: `left-only`. Solo la derecha: `right-only`. Cambiaron los dos y las líneas resultantes son iguales: `same`. Cambiaron los dos y son distintas: `conflict`.
5. **Resultado inicial.** El texto de la base, como en el panel central de la herramienta de referencia.
6. **Conflictos simples.** Para cada conflicto se parte la región en palabras y se repite el mismo algoritmo sobre las palabras. Si los cambios de los dos lados no se solapan, la región es simple y se guarda el texto fusionado. También es simple cuando los dos lados solo difieren en espacios, y en ese caso se toma el lado izquierdo (decisión de Seam, no documentada por la herramienta de referencia).

### Operaciones

Cada operación devuelve una lista de ediciones sobre el texto del resultado y el nuevo estado de la región, para que la interfaz las aplique en una sola transacción del editor.

| Operación | Efecto |
| --- | --- |
| `applyNonConflicting(model, 'all' \| 'left' \| 'right')` | Aplica las regiones `left-only`, `right-only` y `same` que siguen pendientes. No toca conflictos ni conflictos simples. |
| `accept(region, side)` | Sustituye el texto de la región por el de ese lado. Si el otro lado ya se aplicó en un conflicto, añade las líneas detrás en vez de sustituir. |
| `ignore(region, side)` | Marca el lado como tratado sin cambiar el texto. |
| `revert(region, to)` | Devuelve el texto de la región a la base o a cualquiera de los lados y vuelve los lados con cambios a `pending`. |
| `resolveSimple(region)` | Aplica el texto fusionado de un conflicto simple. |
| `autoResolve(model)` | Devuelve el archivo completo si todas las regiones son no conflictivas o simples; si no, `null`. Es lo que usa Resolve all simple conflicts en la fase 5. |

### Seguimiento de rangos

El resultado se edita a mano, así que `result` de cada región debe seguir al texto. La función pura `mapResultRanges(regions, edits)` recibe las ediciones como `{from, to, insertedLines}` y devuelve los rangos nuevos: una edición antes de la región la desplaza, una dentro la amplía o la reduce y marca `edited`, y una que toca un borde se asigna a un lado según la regla de afinidad que se fije aquí y se pruebe. En la fase 6 el editor llama a esta función en cada transacción; se deja aquí, sin editor, para poder probarla.

## Tareas en orden

| N.º | Tarea | Resultado comprobable |
| --- | --- | --- |
| 1 | Tipos y partición en líneas con su salto de línea | Leer y volver a unir un texto devuelve los mismos bytes, con `LF`, `CRLF` y sin salto final |
| 2 | Barrido y agrupación de hunks, incluido tocar | Casos con hunks que se solapan, se tocan y están separados por una línea |
| 3 | Rango de cada región en cada lado | Para cualquier entrada, las líneas de cada lado se reconstruyen con las regiones y los tramos sin cambios |
| 4 | Clasificación | Un caso por tipo: `left-only`, `right-only`, `same`, `conflict` |
| 5 | Operaciones sobre el resultado | Aplicar, ignorar y revertir en cualquier orden deja un texto coherente con el estado de las regiones |
| 6 | `mapResultRanges` | Ediciones antes, dentro, en el borde y después de una región |
| 7 | Conflictos simples y `autoResolve` | Cambios en el principio y el final de la misma línea se fusionan; dos cambios en la misma palabra no |
| 8 | Generadores de casos aleatorios | Las tres versiones se generan a partir de un alfabeto pequeño de líneas, para provocar repeticiones y colisiones |
| 9 | Prueba contra `git merge-file -p` | Ver abajo |
| 10 | Casos fijos | add/add con base vacía, delete/modify, bloques movidos, solo espacios, saltos de línea distintos, primera y última línea |

## Pruebas

- **Cobertura.** Con cualquier entrada, la base, la izquierda y la derecha se reconstruyen exactamente a partir de las regiones y los tramos sin cambios. Es la invariante principal y no depende de Git.
- **Contra Git.** Con tres versiones aleatorias se escribe cada una en un archivo temporal y se ejecuta `git merge-file -p`. Si Git termina sin conflictos, el motor no debe tener regiones `conflict` y `applyNonConflicting('all')` debe dar el mismo texto. Si Git encuentra conflictos, el motor debe tener al menos uno. Git une y recorta conflictos con sus propias reglas, así que el número y los límites de las regiones pueden diferir: esas diferencias no hacen fallar la prueba, se registran y cada patrón sistemático pasa a ser un caso fijo documentado.
- **Idempotencia.** Aplicar dos veces los no conflictivos da lo mismo que una.
- **Rangos.** Tras cualquier secuencia de ediciones, los rangos siguen siendo ordenados, sin huecos ni solapes y dentro del texto.
- **Volumen.** Pocos casos en cada commit y muchos cada noche, siempre con la semilla guardada si falla.

## Criterio de hecho

- [ ] La prueba contra `git merge-file -p` pasa con miles de casos.
- [ ] La invariante de cobertura pasa con miles de casos.
- [ ] Los casos add/add y delete/modify pasan.
- [ ] Cada diferencia sistemática con Git está documentada como caso fijo.
- [ ] Un archivo de 5 000 líneas se procesa en menos de un segundo en el Web Worker (umbral a confirmar con la medición).

## Riesgos de la fase

- **Diferencias con Git en los bordes de las regiones.** Es el riesgo principal. Se acota con el registro de diferencias y con la regla de que lo que Git resuelve sin conflicto, el motor también.
- **Conflictos simples que parecen correctos y no lo son.** Fusionar por palabra puede producir código que no compila. Por eso nunca se aplican en bloque con los no conflictivos y la interfaz los marca para revisar.
- **Coste con archivos grandes.** Son dos diffs completos más uno por palabra en cada conflicto. Se ejecuta en un Web Worker y se mide pronto.
