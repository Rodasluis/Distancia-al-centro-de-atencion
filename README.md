# Servicios MIMP — buscador de centros de atención

Aplicación web **estática** para consultar y localizar los servicios y centros de atención
del **Ministerio de la Mujer y Poblaciones Vulnerables (MIMP)** del Perú. Funciona
íntegramente en el navegador y se publica en GitHub Pages sin ningún servidor.

Contiene **826 servicios** en los 25 departamentos, 196 provincias y 433 distritos del país.

---

## Qué permite hacer

| | |
|---|---|
| **Ubicación** | Detecta tu posición con el GPS del navegador, o permite marcar un punto en el mapa si prefieres no dar el permiso. |
| **Ranking de cercanía** | Ordena los centros del más próximo al más lejano y los numera 1, 2, 3… |
| **Distancia y tiempo** | Distancia real sobre el terreno y estimación del trayecto en automóvil. |
| **Radio de búsqueda** | Deslizador de 1 km a 250 km, o sin límite. Sólo se listan los centros dentro del radio. |
| **Filtros territoriales** | Departamento → provincia → distrito, en cascada y con el número de centros de cada uno. |
| **Combinación** | Los filtros territoriales y la búsqueda por cercanía se aplican a la vez. |
| **Tipo de servicio** | 29 tipos: CEM, Hogares de Refugio Temporal, CAR, CEDIF, UPE, SAR, Línea 100… |
| **Búsqueda libre** | Por nombre, dirección, responsable o código, ignorando tildes. |
| **Mapa interactivo** | Límites departamentales, provinciales y distritales del Perú, con agrupación de marcadores. |
| **Ficha detallada** | Dirección, responsable, teléfono, modalidad, servicios básicos del local, ubigeo y coordenadas. |
| **Cómo llegar** | Abre la ruta en Google Maps desde tu ubicación. |
| **Enlace compartible** | El estado de la búsqueda se guarda en la URL. |

Además: tema claro y oscuro, diseño adaptable a móvil, navegación por teclado y acceso
directo a la **Línea 100** en la cabecera.

---

## Puesta en marcha

```bash
npm install     # sólo para reconstruir los datos
npm start       # sirve app/ en http://localhost:8080
```

> La aplicación usa módulos ES y `fetch`, así que **necesita un servidor HTTP**:
> abrir `app/index.html` con doble clic (`file://`) no funciona.

### Reconstruir los datos

```bash
npm run build
```

Ese comando encadena tres pasos:

1. **`fetch:geo`** — descarga la cartografía de
   [Peru-maps](https://github.com/Rodasluis/Peru-maps) (`salida/`) a `.cache/geo`.
2. **`build:data`** — lee `Directorio de servicios.xlsx` y genera `app/data/centros.json`.
3. **`build:geo`** — simplifica y reparte las capas geográficas en `app/data/geo/`.

Los datos generados **están versionados**, así que sólo hace falta ejecutarlo cuando
cambie el Excel de origen.

---

## Publicar en GitHub Pages

El repositorio incluye `.github/workflows/deploy.yml`, que publica la carpeta `app/`
en cada push a `main`.

1. Sube el repositorio a GitHub.
2. Haz push a `main`. El workflow habilita Pages solo (`enablement: true`) y publica
   el sitio; la URL aparece en el resumen de la acción y en **Settings › Pages**.

> **Si la acción falla con `Get Pages site failed … Error: Not Found`**, es que Pages
> todavía no está activado y el repositorio no permite activarlo por API. Ve a
> **Settings › Pages**, en *Source* elige **GitHub Actions**, y vuelve a lanzar el
> workflow desde la pestaña *Actions* (*Re-run jobs*).
>
> En repositorios **privados**, Pages requiere un plan de pago; con la cuenta gratuita
> hay que hacer público el repositorio.

<details>
<summary>Alternativa sin Actions</summary>

Copia el contenido de `app/` a la raíz del repositorio (o a `docs/`) y en
**Settings › Pages** selecciona *Deploy from a branch* apuntando a esa carpeta.
Todas las rutas del proyecto son relativas, así que funciona igual en
`usuario.github.io/repositorio/` que en un dominio propio.
</details>

---

## Estructura

```
├── Directorio de servicios.xlsx   fuente de datos (no se publica)
├── app/                           ← esto es lo que se publica
│   ├── index.html
│   ├── assets/
│   │   ├── css/styles.css
│   │   └── js/
│   │       ├── app.js             estado, filtros y orquestación
│   │       ├── datos.js           carga del directorio y filtrado
│   │       ├── geo.js             distancias y estimación de trayecto
│   │       ├── mapa.js            capa Leaflet
│   │       └── ui.js              listado y ficha detallada
│   └── data/
│       ├── centros.json           826 servicios + catálogo territorial
│       └── geo/
│           ├── departamentos.geojson
│           ├── provincias/<cc>.geojson
│           └── distritos/<cc>.geojson
└── tools/                         scripts de construcción (Node)
```

Las capas provinciales y distritales están **partidas por departamento** y se descargan
sólo cuando hacen falta: la carga inicial son unos 720 KB (directorio + departamentos),
y ningún archivo posterior supera los 272 KB.

---

## Cómo se calculan distancia y tiempo

La **distancia** es la distancia real sobre la superficie terrestre entre tu ubicación y
el centro (fórmula de Haversine), no la distancia por carretera.

El **tiempo en automóvil es una estimación**, porque un sitio estático no puede consultar
un servicio de rutas. El modelo (en [`app/assets/js/geo.js`](app/assets/js/geo.js)) hace:

```
distancia por vía = línea recta × factor de rodeo
tiempo            = distancia por vía ÷ (velocidad base × factor de relieve)
```

| Región | Factor de rodeo | Factor de velocidad |
|---|---|---|
| Costa | 1,25 | 1,00 |
| Sierra | 1,55 | 0,70 |
| Selva | 1,60 | 0,75 |

La velocidad base va de 20 km/h (trayectos urbanos cortos) a 68 km/h (carretera larga).
En la Amazonía, los destinos a más de 60 km avisan de que el acceso puede ser fluvial.

Para el trayecto real, el botón **Cómo llegar** abre Google Maps.

---

## Calidad de los datos

Cada coordenada del directorio se contrastó con los límites distritales del INEI:

| Situación | Registros | Tratamiento |
|---|---:|---|
| El punto cae en el distrito declarado | 739 | Se usa tal cual. |
| El punto cae en otro distrito | 50 | Se usa, y la ficha advierte que puede ser aproximado. |
| El punto no cae en ningún distrito | 2 | Se usa, con la misma advertencia. |
| Sin coordenadas | 35 | Se sitúa en el centroide del distrito y se excluye del ranking. |

Otros ajustes que hace `tools/build-data.mjs`:

- **Dos registros sin punto decimal** (`-80744639` en vez de `-80.744639`) se corrigen
  dividiendo *ambos* ejes por la misma potencia de 10 y comprobando que el resultado cae
  dentro del Perú. Aplicar un factor distinto a cada eje produce puntos verosímiles pero
  equivocados.
- Los **nombres** se normalizan a mayúscula inicial conservando las siglas (`CEM`, `CAR`,
  `CEDIF`…), y los de departamento, provincia y distrito se toman del catálogo oficial de
  ubigeos, con sus tildes.
- **Línea 100** y **Chat 100** se marcan como no presenciales: se atienden por teléfono en
  todo el país, así que quedan fuera del ranking por cercanía y su ficha ofrece *Llamar*
  en lugar de *Cómo llegar*.
- Los **Hogares de Refugio Temporal** no publican dirección por protección de las víctimas;
  aparecen en las búsquedas territoriales, marcados como *ubicación referencial*.
- El ubigeo de 6 dígitos es la clave de unión con la cartografía: los 826 registros cruzan
  correctamente. La etiqueta administrativa del MIMP (*Lima Metropolitana* / *Lima
  Provincias*) se conserva aparte, en el campo `ambito`, mientras que los filtros y el mapa
  usan los 25 departamentos oficiales del INEI.

---

## Privacidad

La ubicación se obtiene con la API de geolocalización del navegador y se usa **sólo en el
dispositivo** para ordenar la lista. No se envía a ningún servidor ni se almacena; sólo se
refleja en la URL si decides compartir el enlace.

---

## Tecnología

Sin framework ni empaquetador: HTML, CSS y JavaScript con módulos ES.

- [Leaflet 1.9.4](https://leafletjs.com/) y
  [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) desde cdnjs,
  con `integrity` (SRI).
- Mapa base: teselas *Light/Dark Gray Canvas* de Esri, que no requieren clave de API.
- Construcción de datos: Node ≥ 18 y `topojson-*` (sólo en desarrollo). El `.xlsx` se lee
  descomprimiéndolo directamente, sin librerías de Excel.

---

## Créditos y fuentes

- **Directorio de Servicios del MIMP** — Ministerio de la Mujer y Poblaciones Vulnerables.
- **Límites territoriales** — [Peru-maps](https://github.com/Rodasluis/Peru-maps), derivados
  de la cartografía oficial del INEI.
- **Mapa base** — Esri, HERE, Garmin, © OpenStreetMap y la comunidad SIG.

---

## Emergencias

**Línea 100** — gratuita, 24 horas, desde cualquier teléfono del Perú.
Emergencias policiales o médicas: **105**.
