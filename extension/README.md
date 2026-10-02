# Análisis BDP · Conector (extensión de Chrome)

Extensión que obtiene partidos, estadísticas, noticias y cuotas **desde tu navegador**,
con tu conexión de Perú. Así funcionan también los sitios que bloquean a los servidores
(Sofascore) o a quien no está en Perú (Betano).

| Fuente | Qué aporta | ¿Funciona desde servidores de GitHub? |
|---|---|---|
| Sofascore | Partidos, forma, H2H, bajas y lesiones, cuotas de referencia | No, solo desde tu navegador |
| Flashscore | Partidos y resultados del día (hora de Lima), noticias | Sí |
| FotMob | Partidos por liga, noticias destacadas | Sí |
| ESPN | Noticias en español, resultados de Liga 1 | Sí |
| Understat | xG (goles esperados) de las 5 grandes ligas | Sí |
| Betano | Cuotas | No, solo desde Perú |
| Apuesta Total | Cuotas: 1X2, doble oportunidad, total de goles, ambos anotan | Sí |

## Instalación (una sola vez)

1. Descarga el repositorio: en GitHub, elige la rama `claude/zen-lamport-80vu3n`,
   pulsa **Code → Download ZIP** y descomprímelo.
2. En Chrome (o Edge / Brave) abre `chrome://extensions`.
3. Activa **Modo de desarrollador** (arriba a la derecha).
4. Pulsa **Cargar descomprimida** y elige la carpeta `extension` del repositorio.
5. Fija la extensión en la barra (ícono de pieza de rompecabezas → chincheta).

Para actualizarla después de cambios en el repositorio: reemplaza la carpeta y pulsa el
botón de recargar (↻) de la extensión en `chrome://extensions`.

## Diagnóstico

Haz clic en el ícono de la extensión: se abre la página **Diagnóstico de fuentes**.

1. Pulsa **Probar todas**. Para Sofascore y Betano puede abrirse una pestaña del sitio
   en segundo plano unos segundos; se cierra sola.
2. Si Betano falla con una verificación, abre <https://www.betano.pe/> una vez en una
   pestaña normal y vuelve a probar.
3. Pulsa **Copiar reporte** y compártelo para ajustar lo que haga falta.

## Permisos

La extensión solo puede leer los sitios listados en `manifest.json` (`host_permissions`).
No accede a tus otras pestañas ni a otros sitios. La página web del proyecto
(`luisp11127.github.io`) se comunica con ella a través de `bridge.js`.

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
```

Los conectores que funcionan desde servidores se prueban automáticamente en GitHub
Actions (`.github/workflows/probe-sources.yml`, `scripts/test-sources.mjs`).
