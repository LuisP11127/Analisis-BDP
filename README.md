# Análisis BDP

Página web para analizar partidos de todos los deportes, encontrar las mejores
cuotas de Apuesta Total y Betano por nivel de confianza y llevar el historial de
resultados. Funciona en el **celular y en la PC**:
<https://luisp11127.github.io/Analisis-BDP/>

- **Partidos**: fútbol, básquet, tenis, béisbol, hockey, vóley y más, agrupados
  por país y liga. Marca ligas completas o partidos sueltos. Dos fuentes:
  - **Automático** (celular y PC, sin instalar nada): partidos de hoy y mañana de
    Flashscore con las cuotas de Apuesta Total, últimos partidos y H2H de cada
    equipo y xG de Understat. GitHub Actions los actualiza **cada 2 horas**.
    Los partidos con cuotas llevan la marca *cuotas*.
  - **Sofascore** (PC con la extensión): cualquier día, con forma, bajas y votos
    de Sofascore. Al analizar, la extensión suma las cuotas de Betano y las de
    Apuesta Total en vivo (también para los partidos automáticos).
- **Análisis estadístico**: forma reciente, goles/puntos a favor y en contra, H2H,
  xG (5 grandes ligas) y la probabilidad que dan las cuotas. Fútbol con modelo de
  Poisson (1X2, doble oportunidad, más/menos goles, ambos marcan); básquet con
  modelo de puntos (ganador, total, hándicap); tenis con ranking y forma.
- **Análisis con red neuronal**: corrige las probabilidades del análisis
  estadístico con lo que aprende de los resultados reales. Se reentrena cada vez
  que actualizas resultados y solo corrige cuando mejora en partidos que no usó
  para entrenar (necesita al menos 200 resultados).
- **Picks por nivel de confianza**: alta (≥ 80 %), moderada-alta (70–80 %) y
  moderada (60–70 %), con la mejor cuota entre Apuesta Total y Betano.
- **Combinadas** de cuota 5 o más (y 10 o más) en una misma casa, con la mayor
  probabilidad estimada posible.
- **Historial**: cada análisis se guarda con sus picks; el botón *Actualizar
  resultados* los marca como ganados o perdidos y calcula aciertos, ganancia y
  ROI por nivel, por método y de las combinadas.

Los niveles, la cuota mínima, las cuotas objetivo de las combinadas y el token de
GitHub se cambian en **⚙ Ajustes**.

## Cómo se usa

1. Abre <https://luisp11127.github.io/Analisis-BDP/> en el celular o en la PC.
2. Pega tu token de GitHub en **⚙ Ajustes** (una vez en cada dispositivo; ver
   abajo) para que el historial se guarde en el repositorio.
3. Marca partidos o ligas y pulsa **Análisis estadístico** o **Análisis red
   neuronal**. El análisis se guarda solo en el historial.
4. Al día siguiente, en **Historial**, pulsa **Actualizar resultados**. Los
   partidos automáticos se liquidan con los resultados publicados (cada 2 horas);
   los de Sofascore necesitan la extensión.

### Guardar en GitHub

Sin token, el historial y la red neuronal se guardan solo en ese navegador. Con
el token se guardan en `docs/data/` del repositorio y los ves igual en el
celular y en la PC:

1. En GitHub: **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**. Acceso solo a este repositorio,
   permiso **Contents: Read and write**.
2. En la página: **⚙ Ajustes → Guardar el historial en GitHub** → pega el token →
   **Guardar y probar**. Repite en cada dispositivo.
3. Si ya tenías datos en el navegador, en Historial aparece el botón para
   subirlos.

El token se guarda solo en ese navegador (lo pueden leer las páginas de
`luisp11127.github.io`, que son tuyas) y la página solo lo usa para escribir
archivos JSON dentro de `docs/data/`. Para quitarlo: **Olvidar token**. El
repositorio es público, así que el historial también lo es. En la PC también
puedes guardar el token en la extensión (clic en su ícono → Guardar en GitHub).

### Extensión (opcional, solo PC)

Sofascore y Betano solo responden desde tu navegador en Perú. Con la extensión
la página suma Sofascore (cualquier día) y Betano. Instrucciones en
[`extension/README.md`](extension/README.md).

## Publicar la página

En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub
Actions**. El workflow **Página** (`.github/workflows/pagina.yml`) publica
`docs/` junto con los datos automáticos cada 2 horas y cada vez que cambia la
página en `main`. Para publicar en el momento: **Actions → Página → Run
workflow**.

## Estructura

```
docs/                 página web (GitHub Pages)
  index.html, css/    interfaz
  js/app.js           une todo
  js/views/           pestañas Partidos, Análisis e Historial
  js/analysis/        modelos, cuotas, emparejamiento, picks, combinadas, red neuronal
  js/provider.js      lee los datos automáticos (data/fuente/)
  js/data-format.js   formato compacto de esos datos
  js/github.js        guardar en GitHub con el token del navegador
  js/history.js       guardar, liquidar resultados, entrenar la red
  data/               historial y red neuronal (cuando se guarda en GitHub)
extension/            extensión de Chrome (Sofascore, Betano) y conectores de las fuentes
scripts/              recolección de datos y prueba de las fuentes (GitHub Actions)
tests/                pruebas unitarias y de punta a punta
```

## Pruebas

```
node --test tests/*.test.mjs                 # cálculo: modelos, cuotas, combinadas, red
node tests/e2e/run.cjs                       # página completa, con y sin extensión (requiere Playwright)
node scripts/collect-data.mjs site           # recolecta los datos automáticos en site/data/fuente/
```

Las probabilidades son estimaciones, no garantías. Apuesta solo lo que estés
dispuesto a perder.
