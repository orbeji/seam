# Fase 8: push

La fase 8 permite enviar los commits al remoto desde Seam, con un diálogo parecido al de la herramienta de referencia y tratamiento claro de los rechazos. Es la fase más corta, pero toca autenticación y operaciones destructivas, así que tiene reglas estrictas.

## Alcance

- Botón Push en la barra y en el diálogo de commit («Commit and Push»).
- Diálogo con la rama local, la rama remota de destino y la lista de commits que se enviarán.
- Opción de enviar tags (`--follow-tags` o `--tags`).
- Rechazo por remoto adelantado: ofrece actualizar con rebase o con merge y reintentar.
- Force push solo con `--force-with-lease` y confirmación explícita.
- Fuera de alcance en 0.1.0: gestionar remotos y crear pull requests.

## Diseño técnico

### Datos del diálogo

La rama y su upstream salen de `git status --porcelain=v2 --branch`. Los commits pendientes, de `git log --format=... @{u}..HEAD`. Si no hay upstream, el diálogo ofrece elegir un remoto y un nombre, y usa `git push -u`. Si no hay commits pendientes, el botón queda desactivado con el texto «Nada que enviar».

### Comando y salida

Se ejecuta `git push --porcelain` con las opciones elegidas. La salida porcelain tiene una línea por referencia con una marca: `*` nueva, espacio actualizada, `!` rechazada, `=` sin cambios. Seam lo traduce a un resultado tipado y no depende del texto en inglés de los mensajes.

### Rechazos y cómo se resuelven

| Causa | Cómo se detecta | Qué ofrece Seam |
| --- | --- | --- |
| El remoto tiene commits nuevos | Marca `!` con motivo «fetch first» o «non-fast-forward» | «Update and push» con rebase o con merge, según la elección |
| Rama protegida o hook remoto | Marca `!` con «remote rejected» | Mostrar el mensaje del servidor; no hay reintento automático |
| Sin permisos o credenciales | Código de salida distinto de 0 y mensaje de autenticación | Explicar que Seam usa el asistente de credenciales de Git |
| Tag ya existente | Marca `!` sobre una referencia de tag | Mostrar el tag y no sobrescribirlo |

### Actualizar y reintentar

«Update and push» ejecuta `git fetch` y después `git rebase @{u}` o `git merge @{u}`, según la opción guardada en el diálogo. Si eso genera conflictos, se abre la lista de la fase 5 y, al terminar (fase 7), se vuelve al diálogo de push con la lista actualizada. Un rebase sobre commits ya publicados no se ofrece: si el upstream ya contiene commits propios, solo se ofrece merge.

### Credenciales

Seam no pide ni guarda contraseñas. Con `GIT_TERMINAL_PROMPT=0` Git no se queda esperando una entrada que nadie ve; usa el asistente de credenciales configurado (Git Credential Manager en Windows, el que tenga el usuario en Linux) y SSH con el agente. Si falla por no tener credenciales, el mensaje explica qué configurar. Un `askpass` propio queda para una versión posterior.

### Force push

Solo se ofrece tras un rechazo, con una casilla separada que explica el riesgo, y siempre como `--force-with-lease=<rama>:<id esperado>`, con el id que Seam vio al abrir el diálogo. Nunca `--force` a secas. Nunca se ofrece sobre `main` o `master` sin confirmar escribiendo el nombre de la rama.

## Tareas en orden

| # | Tarea | Resultado | Depende de |
| --- | --- | --- | --- |
| 8.1 | Lectura de upstream y commits pendientes | Datos del diálogo correctos con y sin upstream | Fase 0 |
| 8.2 | Parser de `push --porcelain` | Resultado tipado por referencia | Fase 0 |
| 8.3 | Diálogo de push | Rama, destino, lista de commits y opciones | 8.1 |
| 8.4 | Ejecución con progreso y cancelación | Salida en directo; se puede cancelar | 8.2 |
| 8.5 | Tratamiento de rechazos | Tabla anterior implementada | 8.2 |
| 8.6 | Actualizar y reintentar | Rebase o merge, con paso por la lista de conflictos | Fases 5 y 7 |
| 8.7 | Force push con `--force-with-lease` | Casilla, confirmación y comando exacto | 8.5 |
| 8.8 | «Commit and Push» | El diálogo de commit encadena el push | Fase 4 |

## Pruebas

- Todas las pruebas usan remotos locales: un repositorio `--bare` en un directorio temporal, sin red.
- Parser: una salida de ejemplo por cada marca (`*`, espacio, `!`, `=`) y por cada motivo de rechazo.
- Integración: push normal, push con tags, rechazo por remoto adelantado, update con rebase y con merge, y force-with-lease con el remoto cambiado entre medias (debe fallar).
- Un hook `pre-receive` en el remoto de prueba que rechaza: el mensaje del servidor llega entero al diálogo.

## Criterio de terminado

- [x] Un push normal funciona con y sin upstream.
- [x] Un rechazo por remoto adelantado se resuelve desde Seam hasta enviar.
- [x] Force push solo existe como `--force-with-lease` y requiere confirmación.
- [x] Los errores de credenciales explican qué hacer sin mostrar rutas ni datos sensibles.

## Riesgos de la fase

- La autenticación depende del sistema del usuario y no se puede probar del todo en integración continua. Mitigación: pruebas manuales documentadas con HTTPS y SSH antes de la versión.
- Un push sobre una rama equivocada. Mitigación: el diálogo siempre muestra rama local, remota y número de commits.
- Parsear mensajes de error cambia con la versión y el idioma de Git. Mitigación: `LC_ALL=C` y preferir la salida porcelain y los códigos de salida.

## Decisión tomada

- [x] Se permite enviar a una rama del remoto con distinto nombre que la local solo cuando no hay upstream y el usuario lo elige a mano. Con upstream, el destino es siempre el que Git ya sigue.
