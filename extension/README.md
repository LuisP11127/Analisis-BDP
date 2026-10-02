# Análisis BDP · Conector (extensión de Chrome)

Extensión que obtiene partidos, estadísticas, noticias y cuotas **desde tu navegador**,
con tu conexión de Perú. Así funcionan también los sitios que bloquean a los servidores
(Sofascore) o a quien no está en Perú (Betano).

Es opcional: sin ella la página funciona en el celular y en la PC con los datos
automáticos (Flashscore y Apuesta Total, actualizados cada 2 horas). Con ella se suman
Sofascore (cualquier día) y Betano.

| Fuente | Qué aporta | ¿Funciona desde servidores de GitHub? |
|---|---|---|
| Sofascore | Partidos de todos los deportes, forma, últimos resultados, H2H, bajas y lesiones, votos, cuotas de referencia, estadísticas de los últimos partidos de cada equipo y, al liquidar, estadísticas e incidencias del partido | No, solo desde tu navegador |
| Flashscore | Partidos y resultados del día (hora de Lima), H2H, estadísticas de los últimos partidos de cada equipo, incidencias y estadísticas del partido terminado, noticias. Con la extensión se lee desde una pestaña de flashscore.pe (por la misma vía que usa la página, funciona desde cualquier red) | Sí |
| FotMob | Partidos por liga, noticias destacadas | Sí |
| ESPN | Noticias en español (fútbol y ligas grandes de otros deportes), resultados de Liga 1 | Sí |
| Understat | xG (goles esperados) de las 5 grandes ligas | Sí |
| Betano | Cuotas: la lista de cada deporte y, abriendo la página de cada partido, todos sus mercados (goles, córners, tarjetas, mitades, combinados...) | No, solo desde Perú |
| Apuesta Total | Cuotas: todos los tipos de mercado de cada deporte (resultado, totales, hándicap, mitades, cuartos, sets, córners, combinados...) | Sí |
| GitHub | Guarda el historial y la red neuronal en el repositorio (opcional, con token) | — |

## Instalación (una sola vez)

1. Descarga el repositorio: en GitHub, rama `main`, pulsa **Code → Download ZIP** y
   descomprímelo.
2. En Chrome (o Edge / Brave) abre `chrome://extensions`.
3. Activa **Modo de desarrollador** (arriba a la derecha).
4. Pulsa **Cargar descomprimida** y elige la carpeta `extension` del repositorio.
5. Fija la extensión en la barra (ícono de pieza de rompecabezas → chincheta).

Para actualizarla después de cambios en el repositorio: reemplaza la carpeta y pulsa el
botón de recargar (↻) de la extensión en `chrome://extensions`. La versión 0.2.0 pide
permisos nuevos (alarmas y almacenamiento de la extensión, y acceso a `api.github.com`).

## Guardar en GitHub (opcional)

Haz clic en el ícono de la extensión → sección **Guardar en GitHub**:

1. Crea un token en GitHub → Settings → Developer settings → Personal access tokens →
   **Fine-grained tokens**, con acceso solo a este repositorio y permiso
   **Contents: Read and write**.
2. Pégalo, revisa el repositorio y la rama, y pulsa **Guardar y probar**.

El token se guarda solo en la extensión (no en la página ni en el repositorio) y solo
permite escribir archivos JSON dentro de `docs/data/`. Sin token, la página guarda
todo en el navegador. Si prefieres, pega el token en la página (**⚙ Ajustes**): así
también guardas desde el celular.

## Pestañas en segundo plano

Si un sitio bloquea las consultas directas (Sofascore con algunas conexiones, Betano
con su verificación), la extensión las hace dentro de una pestaña del sitio. Si ya
tienes una abierta, la usa; si no, abre una en segundo plano que se cierra sola tras
un minuto sin uso.

## Diagnóstico

Haz clic en el ícono de la extensión: se abre la página **Diagnóstico de fuentes**.

1. Pulsa **Probar todas**. Para Sofascore y Betano puede abrirse una pestaña del sitio
   en segundo plano unos segundos; se cierra sola.
2. Si Betano falla con una verificación, abre <https://www.betano.pe/> una vez en una
   pestaña normal y vuelve a probar. El diagnóstico de Betano también abre la página
   de un partido e informa cuántos mercados encontró en total.
3. Pulsa **Copiar reporte** y compártelo para ajustar lo que haga falta.

## Permisos

La extensión solo puede leer los sitios listados en `manifest.json` (`host_permissions`).
No accede a tus otras pestañas ni a otros sitios. Solo la página web del proyecto
(`luisp11127.github.io/Analisis-BDP`) se comunica con ella, a través de `bridge.js`.

## Estructura

```
extension/
  manifest.json        permisos y configuración
  background.js        recibe pedidos y los reparte a cada fuente
  bridge.js            puente con la página web (GitHub Pages)
  diagnostico.html/js  página de diagnóstico
  lib/net.js           pedidos directos o dentro de una pestaña del sitio
  lib/model.js         formato común y utilidades
  sources/*.js         un conector por fuente
  sources/github.js    guardar y leer el historial en el repositorio
```

Los conectores que funcionan desde servidores se prueban automáticamente en GitHub
Actions (`.github/workflows/probe-sources.yml`, `scripts/test-sources.mjs`).
