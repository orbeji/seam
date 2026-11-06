# Fase 9: empaquetado y versión 0.1.0

La fase 9 convierte el código en algo que se puede instalar y publicar: instaladores para Windows y Linux, pruebas de humo sobre los instaladores, documentación mínima y la etiqueta 0.1.0. Dos asuntos quedan para esta fase por decisión del proyecto: incluir o no Git en el instalador, y la firma de código.

> **Estado (2026-11-06).** La configuración, los flujos, las pruebas de humo y la documentación están implementados y la versión de `package.json` es 0.1.0. Las dos decisiones aplazadas quedan cerradas: no se incluye Git y no se firma en 0.1.0. Falta la ronda manual en máquinas limpias y publicar la etiqueta `v0.1.0`.

## Alcance

- Instalador NSIS para Windows, y AppImage y `.deb` para Linux, con electron-builder.
- Flujo de GitHub Actions que construye, prueba y publica en cada etiqueta `v*`.
- Pruebas de humo: instalar, arrancar, abrir un repositorio de ejemplo y cerrar.
- README con capturas, guía de compilación, licencia MIT y guía de contribución.
- Decisiones diferidas desde fases anteriores: incluir Git en el instalador y firmar el código.
- Fuera de alcance: actualizaciones automáticas, macOS, Flatpak y Snap.

## Diseño técnico

### Objetivos de empaquetado

| Plataforma | Formato | Notas |
| --- | --- | --- |
| Windows | Instalador NSIS (`.exe`) | Instalación por usuario por defecto, sin permisos de administrador |
| Linux | AppImage | Un solo archivo; requiere FUSE en algunas distribuciones |
| Linux | `.deb` | Declara `git` como dependencia |

### Flujo de GitHub Actions

Dos flujos. El de integración continua corre en cada pull request: tipos, lint, pruebas unitarias e integración con Git 2.30 y con la última versión, en Windows y Ubuntu. El de publicación corre al subir una etiqueta `v*`: construye los tres instaladores, ejecuta las pruebas de humo, calcula las sumas SHA-256 y crea un borrador de GitHub Release con los archivos adjuntos. La publicación final la pulsa una persona.

### Pruebas de humo

Un script por plataforma instala el artefacto en un entorno limpio, lo lanza con un repositorio de ejemplo pasado por argumento, comprueba con Playwright que aparece la lista de cambios y sale. En Linux se usa `xvfb`. Cualquier fallo detiene la publicación.

### Git: incluirlo o depender del sistema

Opción A, depender del Git del sistema: instalador pequeño y siempre la versión del usuario, pero la primera ejecución falla si no hay Git. Opción B, incluir Git portable en Windows: instalación que funciona sin pasos previos, a cambio de +50 MB y de mantener las actualizaciones de seguridad. La propuesta para 0.1.0 es A en Linux (el `.deb` lo declara como dependencia) y detectar Git en Windows; si falta, mostrar una pantalla que enlaza a su instalación. B se reevalúa después de 0.1.0.

### Firma de código

Sin firma, Windows SmartScreen avisa en cada descarga nueva. Para 0.1.0 se publica sin firmar, con una nota clara en el README sobre el aviso y con las sumas SHA-256 para verificar. La firma (certificado EV, o el servicio de firma de Azure) se estudia cuando haya usuarios que la pidan.

### Versionado y registro de cambios

SemVer; la versión sale de `package.json` y la etiqueta debe coincidir, o el flujo falla. `CHANGELOG.md` en formato «Keep a Changelog». Las notas de la Release salen de ese archivo.

### Documentación mínima

- `README.md`: qué es Seam, capturas de pantalla, instalación, requisitos (Git 2.30 o superior) y cómo compilarlo.
- `CONTRIBUTING.md`: cómo ejecutar las pruebas, estilo de código y cómo añadir un idioma (los archivos `en` y `es` son la plantilla).
- `LICENSE`: MIT.
- `docs/limitaciones.md`: lo que 0.1.0 no hace (por ejemplo, iniciar merges o rebases desde la aplicación).

## Tareas en orden

| # | Tarea | Resultado | Depende de | Estado |
| --- | --- | --- | --- | --- |
| 9.1 | Configuración de electron-builder | Los tres artefactos se generan en local | Fases 0 a 8 | Hecho: `electron-builder.yml`, iconos y scripts `pack`/`dist` |
| 9.2 | Detección de Git y pantalla de ayuda | Mensaje claro si falta Git o es anterior a 2.30 | 9.1 | Hecho: `git-locator`, IPC `app:git-status` y pantalla `GitRequired` |
| 9.3 | Flujo de integración continua completo | Matriz Windows/Ubuntu × Git 2.30/última, en verde | Fase 0 | Hecho en el flujo: unitarias, integración y extremo a extremo; Git 2.30 compilado en Ubuntu |
| 9.4 | Pruebas de humo de instaladores | Instalar y abrir un repositorio en cada plataforma | 9.1 | Hecho: `packaged.smoke.e2e.ts`, ejecutado tras instalar el `.deb` y el NSIS |
| 9.5 | Flujo de publicación por etiqueta | Borrador de Release con instaladores y SHA-256 | 9.4 | Hecho: `release.yml`, pendiente de la primera etiqueta |
| 9.6 | README, CONTRIBUTING y limitaciones | Documentación revisada por alguien ajeno al proyecto | 9.1 | Escrito; pendiente la revisión externa |
| 9.7 | Revisión de licencias de dependencias | Informe sin licencias incompatibles con MIT | 9.1 | Hecho: `docs/licencias.md` y `npm run licenses:check` en CI |
| 9.8 | Ronda de pruebas manuales | Lista de comprobación completada en Windows y Linux | 9.4 | Pendiente |
| 9.9 | Etiqueta `v0.1.0` y Release | Release publicada con las notas del registro de cambios | 9.5, 9.8 | Pendiente |

## Pruebas

- La matriz de integración continua de la tarea 9.3 corre las pruebas de todas las fases.
- Cada instalador pasa la prueba de humo en una máquina limpia o contenedor, sin herramientas de desarrollo instaladas.
- Lista de comprobación manual: abrir un repositorio, ver diff, preparar líneas, hacer commit, resolver un merge con conflictos, abortar un rebase, hacer push a un remoto local, cambiar de idioma.
- Comprobar que la desinstalación elimina los archivos y no toca los repositorios del usuario.

## Criterio de terminado

- [x] Los tres instaladores se generan en integración continua y pasan la prueba de humo.
- [ ] La lista de comprobación manual está completa en ambas plataformas.
- [x] README, licencia y limitaciones están publicados.
- [ ] La etiqueta `v0.1.0` existe y la Release tiene instaladores y sumas.

## Riesgos de la fase

- SmartScreen y la desconfianza ante un instalador sin firmar. Mitigación: documentarlo y publicar las sumas; la firma queda como mejora.
- AppImage sin FUSE en algunas distribuciones. Mitigación: indicar la solución en el README y ofrecer el `.deb`.
- Una dependencia con licencia incompatible descubierta tarde. Mitigación: revisarlas en 9.7 y también en integración continua desde la fase 0.

## Decisión a confirmar

- [x] ¿Se acepta la propuesta de 0.1.0 sin Git incluido y sin firma de código? Son las dos decisiones diferidas desde fases anteriores; esta fase es el momento de cerrarlas.

Decidido para 0.1.0: se depende del Git del sistema (con detección en Windows y dependencia `git` en el `.deb`) y se publica sin firmar, con las sumas SHA-256 y el aviso en el README. Las dos se reevalúan cuando haya usuarios que las pidan.
