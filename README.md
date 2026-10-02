# Análisis BDP

Página web para analizar partidos de todos los deportes de Sofascore, encontrar
las mejores cuotas de Apuesta Total y Betano por nivel de confianza y llevar el
historial de resultados.

- **Partidos**: todos los deportes de Sofascore (fútbol, básquet, tenis, béisbol,
  hockey, vóley…) del día que elijas, agrupados por país y liga. Marca ligas
  completas o partidos sueltos.
- **Análisis estadístico**: forma reciente, goles/puntos a favor y en contra, H2H,
  bajas, votos de Sofascore, xG de Understat (5 grandes ligas) y la probabilidad
  que dan las cuotas. Fútbol con modelo de Poisson (1X2, doble oportunidad,
  más/menos goles, ambos marcan); básquet con modelo de puntos (ganador, total,
  hándicap); tenis con ranking y forma.
- **Análisis con red neuronal**: corrige las probabilidades del análisis
  estadístico con lo que aprende de los resultados reales. Se reentrena cada vez
  que actualizas resultados y solo corrige cuando mejora en partidos que no usó
  para entrenar (necesita al menos 200 resultados).
- **Picks por nivel de confianza**: alta (≥ 80 %), moderada-alta (70–80 %) y
  moderada (60–70 %), con la mejor cuota entre Apuesta Total y Betano.
- **Combinadas** de cuota 5 o más (y 10 o más) en una misma casa, con la mayor
  probabilidad estimada posible.
- **Historial**: cada análisis se guarda con sus picks; el botón *Actualizar
  resultados* los marca como ganados o perdidos con los marcadores de Sofascore y
  calcula aciertos, ganancia y ROI por nivel, por método y de las combinadas.

Los niveles, la cuota mínima y las cuotas objetivo de las combinadas se cambian en
**⚙ Ajustes**.

## Cómo se usa

1. **Instala la extensión** (`extension/`): Sofascore y Betano solo responden
   desde tu navegador en Perú. Instrucciones en
   [`extension/README.md`](extension/README.md).
2. **Abre la página**: <https://luisp11127.github.io/Analisis-BDP/> (ver
   *Publicar la página* abajo).
3. Marca partidos o ligas y pulsa **Análisis estadístico** o **Análisis red
   neuronal**.
4. Al día siguiente, en **Historial**, pulsa **Actualizar resultados**.

### Guardar en GitHub (recomendado)

Sin configurar nada, el historial y la red neuronal se guardan solo en el
navegador. Para verlos desde cualquier dispositivo (también el celular) y no
perderlos:

1. En GitHub: **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**. Acceso solo a este repositorio,
   permiso **Contents: Read and write**.
2. Clic en el ícono de la extensión → **Guardar en GitHub** → pega el token →
   **Guardar y probar**.
3. Si ya tenías datos en el navegador, en Historial aparece el botón para
   subirlos.

El token queda solo en la extensión; la página no lo ve y solo puede escribir
archivos dentro de `docs/data/`. El repositorio es público, así que el historial
también lo es.

## Publicar la página

En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from
a branch**, rama `claude/zen-lamport-80vu3n` (o `main` cuando se fusione), carpeta
`/docs`, **Save**. En uno o dos minutos queda en
<https://luisp11127.github.io/Analisis-BDP/>.

## Estructura

```
docs/                 página web (GitHub Pages)
  index.html, css/    interfaz
  js/app.js           une todo
  js/views/           pestañas Partidos, Análisis e Historial
  js/analysis/        modelos, cuotas, emparejamiento, picks, combinadas, red neuronal
  js/history.js       guardar, liquidar resultados, entrenar la red
  data/               historial y red neuronal (cuando se guarda en GitHub)
extension/            extensión de Chrome que obtiene los datos
tests/                pruebas unitarias y de punta a punta
scripts/              prueba de las fuentes desde GitHub Actions
```

## Pruebas

```
node --test tests/*.test.mjs                 # cálculo: modelos, cuotas, combinadas, red
node tests/e2e/run.cjs                       # página completa con extensión simulada (requiere Playwright)
```

Las probabilidades son estimaciones, no garantías. Apuesta solo lo que estés
dispuesto a perder.
