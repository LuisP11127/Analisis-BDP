# Análisis BDP

Página web para analizar partidos de todos los deportes, encontrar las mejores
cuotas de Apuesta Total y Betano por nivel de confianza y llevar el historial de
resultados. Funciona en el **celular y en la PC**:
<https://luisp11127.github.io/Analisis-BDP/>

- **Partidos**: fútbol, básquet, tenis, béisbol, hockey, vóley y más, agrupados
  por país y liga. Marca ligas completas o partidos sueltos. Dos fuentes:
  - **Automático** (celular y PC, sin instalar nada): partidos de hoy y mañana de
    Flashscore con **todos los mercados** de Apuesta Total, últimos partidos, H2H
    y estadísticas promedio de cada equipo (córners, tarjetas, tiros, rebotes,
    aces...) y xG de Understat/Flashscore. GitHub Actions los actualiza **cada 2
    horas**. Los partidos con cuotas llevan la marca *cuotas*.
  - **Sofascore** (PC con la extensión): cualquier día, con forma, bajas y votos
    de Sofascore. Al analizar, la extensión suma las estadísticas de equipo de
    Sofascore **y** de Flashscore, todos los mercados de Betano (abre la página
    de cada partido) y los de Apuesta Total en vivo.
- **Todos los mercados**: resultado, doble oportunidad, más/menos, hándicap
  (también asiático), ambos marcan, mitades, cuartos, periodos, sets y entradas,
  córners, tarjetas, tiros, faltas, rebotes, aces, marcador exacto, margen,
  primer/último gol, minuto del gol, descanso/final y los combinados de la casa.
  No se analizan los de jugador ni los de torneo (campeón, podio...).
- **Análisis estadístico** (datos de Sofascore y Flashscore, sin noticias):
  forma reciente, goles/puntos a favor y en contra, H2H, xG, estadísticas de
  cada equipo y la probabilidad que dan las cuotas. Los mercados principales
  usan su modelo (Poisson en fútbol y hockey, puntos en básquet, ranking en
  tenis); los demás se estiman **simulando el partido** miles de veces con lo
  esperado ya calibrado con las cuotas principales, así todas las
  probabilidades del partido son coherentes entre sí.
- **Análisis con red neuronal** (Sofascore, Flashscore **y noticias** de
  Flashscore, ESPN y FotMob): corrige las probabilidades del análisis
  estadístico con lo que aprende de los resultados reales; además de los datos
  del partido usa las noticias de cada equipo (menciones, lesiones/sanciones y
  tono). Se reentrena cada vez que actualizas resultados y solo corrige cuando
  mejora en partidos que no usó para entrenar (necesita al menos 200 resultados).
- **Picks por nivel de confianza**: alta (≥ 80 %), moderada-alta (70–80 %) y
  moderada (60–70 %), con la mejor cuota entre Apuesta Total y Betano.
- **Combinadas** de cuota 5 o más (y 10 o más) en una misma casa, con la mayor
  probabilidad estimada posible.
- **Ambos análisis**: hace el estadístico y el de red neuronal con los mismos
  partidos (los datos se piden una sola vez). La pestaña Análisis los compara
  (picks por nivel, cuántos coinciden) y deja ver el detalle de cada uno.
- **Historial**: cada análisis se guarda con sus picks y se sigue **por
  separado**: el botón *Actualizar resultados* los marca como ganados o
  perdidos (o medio ganados/perdidos en líneas asiáticas) y calcula aciertos,
  ganancia y ROI por nivel y de las combinadas para el análisis estadístico y
  para el de red neuronal. Se liquidan con el registro completo del partido
  (marcador por periodo, goles con minuto, tarjetas y estadísticas de
  Flashscore y Sofascore). Si un mismo pick sale en dos análisis del mismo día
  y método, cuenta una sola vez; una apuesta cuyo dato no publica ninguna
  fuente queda nula a los 4 días.

Los niveles, la cuota mínima, las cuotas objetivo de las combinadas, **qué tipos
de mercado pueden salir como pick** (principales, periodos, estadísticas,
marcador, combinados, otros), si se abre la página de cada partido en Betano y
el token de GitHub se cambian en **⚙ Ajustes**.

## Cómo se usa

1. Abre <https://luisp11127.github.io/Analisis-BDP/> en el celular o en la PC.
2. Pega tu token de GitHub en **⚙ Ajustes** (una vez en cada dispositivo; ver
   abajo) para que el historial se guarde en el repositorio.
3. Marca partidos o ligas y pulsa **Análisis estadístico**, **Análisis red
   neuronal** o **Ambos análisis**. Cada análisis se guarda solo en el historial.
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
    catalog.js        traduce los mercados de Betano y Apuesta Total a un formato común
    outcomes.js       liquida cualquier mercado con el registro del partido
    simulate.js       simula partidos de cada deporte (probabilidad de cualquier mercado)
    calibrate.js      ajusta goles/puntos esperados a las cuotas principales
    records.js        registro del partido con datos de Flashscore y Sofascore
    teamstats.js      estadísticas promedio de cada equipo
    news.js           señales de las noticias para la red neuronal
  js/flashscore-link.js  partidos de Sofascore + datos de Flashscore (con la extensión)
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
