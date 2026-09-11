# Servicios MIMP — buscador de centros de atención

Aplicación web estática que localiza los centros de atención del **Ministerio de la Mujer
y Poblaciones Vulnerables (MIMP)** del Perú. Se ejecuta íntegramente en el navegador y se
sirve como contenido estático, sin componente de servidor.

**704 centros de atención físicos** en los 25 departamentos del país.

🔗 https://rodasluis.github.io/Distancia-al-centro-de-atencion/

---

## Arquitectura

Sin framework ni empaquetador: HTML, CSS y JavaScript con módulos ES nativos. Todo el
estado vive en memoria y se refleja en el fragmento de la URL.

```
app/                              raíz publicada
├── index.html
├── assets/
│   ├── css/styles.css
│   ├── iconos/                   14 PNG, uno por tipo de centro
│   └── js/
│       ├── app.js                estado, filtros y orquestación
│       ├── datos.js              carga del directorio y filtrado
│       ├── geo.js                distancias y estimación de trayecto
│       ├── mapa.js               capa Leaflet
│       └── ui.js                 listado y ficha detallada
└── data/
    ├── centros.json              704 centros + catálogo territorial
    ├── iconos.json               tipo de centro → icono y color
    └── geo/
        ├── departamentos.geojson
        ├── provincias/<cc>.geojson
        └── distritos/<cc>.geojson

tools/                            generación de datos (Node, sólo desarrollo)
```

### Dependencias de ejecución

| Componente | Origen | Notas |
|---|---|---|
| Leaflet 1.9.4 | cdnjs, con `integrity` SRI | |
| Leaflet.markercluster 1.5.3 | cdnjs, con `integrity` SRI | |
| Teselas del mapa base | Esri *Light/Dark Gray Canvas* | Sin clave de API. El caché llega a z16; por encima se reescala vía `maxNativeZoom` |

No se usan CARTO ni las teselas estándar de OSM: las primeras exigen clave y las segundas
restringen este tipo de uso.

### Carga

La carga inicial son unos 650 KB (directorio, iconos y capa de departamentos). Las capas
provinciales y distritales están partidas por departamento y se descargan sólo al
seleccionarlos; el archivo más pesado son los distritos de Lima, con 272 KB.

---

## Puesta en marcha

```bash
npm install     # sólo necesario para regenerar los datos
npm start       # sirve app/ en http://localhost:8080
```

La aplicación usa módulos ES y `fetch`, de modo que **requiere un servidor HTTP**: abrir
`app/index.html` mediante `file://` no funciona.

### Regeneración de datos

```bash
npm run build
```

Encadena cuatro pasos:

1. `fetch:geo` — descarga la cartografía de [Peru-maps](https://github.com/Rodasluis/Peru-maps) a `.cache/geo`.
2. `build:data` — lee `Directorio de servicios.xlsx` y genera `app/data/centros.json`.
3. `build:iconos` — extrae los iconos de `Icons para centros de atención.xlsx` y los cruza con los tipos del directorio.
4. `build:geo` — simplifica las capas geográficas y las reparte por departamento.

La salida de `build:data` detalla cuántos centros se publican, cuáles se excluyen y por
qué, y **advierte de cualquier tipo de servicio sin clasificar**. Los datos generados están
versionados, por lo que sólo es necesario reconstruirlos cuando cambien los archivos de
origen.

### Publicación

`.github/workflows/deploy.yml` publica la carpeta `app/` en GitHub Pages en cada push a
`main`. El flujo habilita Pages por API (`enablement: true`); si el repositorio no lo
permite, debe activarse manualmente en *Settings › Pages* con origen *GitHub Actions*.
Todas las rutas son relativas, así que el sitio funciona igual bajo un subdirectorio
(`usuario.github.io/repositorio/`) que en un dominio propio.

---

## Criterio de publicación de los datos

De los 826 registros del directorio se publican **704**: los que constituyen un centro de
atención físico *y* disponen de coordenadas propias. El criterio se compone de tres reglas,
definidas en `tools/build-data.mjs`:

1. **Automática** — sin coordenadas propias no hay punto que representar.
2. **Revisada** — cada valor de la columna `CENTRO` se clasificó a partir de su columna
   `Servicio`, sus nombres y sus direcciones. El motivo queda registrado junto a cada regla
   en la tabla `CLASIFICACION`, de modo que la decisión es auditable.
3. **Exclusión por defecto** — un tipo de servicio ausente de esa tabla no se publica y el
   build lo advierte. Un servicio nuevo no puede aparecer en el mapa sin revisión previa.

| Excluido | Registros | Motivo |
|---|---:|---|
| Hogares de Refugio Temporal | 29 | Dirección reservada por protección de las víctimas |
| Coordinación Territorial | 26 | Oficina administrativa, sin atención al público |
| SOUFCAT | 24 | Sede de operación de la UFCAT |
| Educadores de Calle | 23 | Intervención en vía pública |
| Familias Igualitarias | 10 | Programa por zonas, opera dentro de un CEDIF |
| CAR Especializado | 6 | Sin coordenadas en el directorio |
| Línea 100 · Chat 100 | 2 | Atención telefónica y virtual de alcance nacional |
| Inabif en Acción | 1 | Equipo móvil de emergencias |
| Unidad de Asistencia Económica | 1 | Unidad administrativa |

### Calidad de las coordenadas

Cada coordenada se contrastó con los límites distritales del INEI:

| Situación | Registros | Tratamiento |
|---|---:|---|
| El punto cae en el distrito declarado | 739 | Se usa sin observaciones |
| El punto cae en otro distrito | 50 | Se usa; la ficha advierte que puede ser aproximado |
| El punto no cae en ningún distrito | 2 | Se usa, con la misma advertencia |
| Sin coordenadas | 35 | Se excluyen del mapa |

### Transformaciones aplicadas

- **Coordenadas sin punto decimal.** Dos registros traen valores como `-80744639` en lugar
  de `-80.744639`. Se corrigen dividiendo *ambos* ejes por la misma potencia de diez y
  verificando que el resultado cae dentro del Perú: aplicar un factor distinto a cada eje
  produce puntos verosímiles pero erróneos.
- **Nombres.** Se normalizan a mayúscula inicial conservando las siglas (`CEM`, `CAR`,
  `CEDIF`…). Los nombres de departamento, provincia y distrito provienen del catálogo
  oficial de ubigeos, con su acentuación correcta.
- **Iconos.** Se extraen del `.xlsx` leyendo los anclajes de dibujo del libro —la etiqueta
  de cada imagen es el texto de la fila donde está anclada— y se cruzan con los tipos del
  directorio por nombre normalizado. El color del aro es el tono dominante del propio PNG,
  descodificado sin dependencias externas; si resulta demasiado claro para distinguirse
  sobre el marcador blanco, se oscurece.
- **Clave de unión.** El ubigeo de seis dígitos enlaza el directorio con la cartografía; los
  826 registros cruzan correctamente. La etiqueta administrativa del MIMP (*Lima
  Metropolitana* / *Lima Provincias*) se conserva en el campo `ambito`, mientras que los
  filtros y el mapa emplean los 25 departamentos oficiales del INEI.

---

## Distancia y tiempo de viaje

La **distancia** es la separación real sobre la superficie terrestre entre el origen y el
centro, calculada con la fórmula de Haversine. No es distancia por carretera.

El **tiempo en automóvil es una estimación**: un sitio estático no puede consultar un
servicio de rutas. El modelo, en [`app/assets/js/geo.js`](app/assets/js/geo.js), aplica:

```
distancia por vía = línea recta × factor de rodeo
tiempo            = distancia por vía ÷ (velocidad base × factor de relieve)
```

| Región | Factor de rodeo | Factor de velocidad |
|---|---|---|
| Costa | 1,25 | 1,00 |
| Sierra | 1,55 | 0,70 |
| Selva | 1,60 | 0,75 |

La velocidad base va de 20 km/h en trayectos urbanos cortos a 68 km/h en carretera. En la
Amazonía, los destinos a más de 60 km advierten de que el acceso puede ser fluvial. El
botón *Cómo llegar* deriva el trayecto real a Google Maps.

---

## Comportamiento del mapa

- **Agrupación de marcadores.** Se desactiva a partir del zoom 11. El umbral procede de
  medir el solapamiento real por celda del tamaño del icono: 88 % a z5 —con 140 marcadores
  apilados en Breña—, 62 % a z8 y 36 % a z11, ya manejable. Con 25 resultados o menos no se
  agrupa en ningún zoom.
- **Tamaño de los marcadores.** Escala con el zoom en cinco tramos, de 18 px en vista
  nacional a 34 px en distrito.
- **Grupos.** Son informativos: muestran el icono del tipo predominante y el recuento, no
  capturan el puntero y no modifican el encuadre. El zoom depende siempre de la selección
  territorial.
- **Límites territoriales.** Se renderizan en SVG, no en canvas: nunca hay más de ~180
  polígonos simultáneos —los distritos de un departamento— y con elementos reales el clic
  y el resaltado son fiables. El nivel de detalle sigue al filtro activo.
- **Simplificación.** Las capas se simplifican sobre una topología construida con todos los
  polígonos de cada nivel a la vez, de modo que los bordes compartidos se simplifican de
  forma idéntica y no aparecen huecos entre vecinos.

---

## Filtros

Los desplegables territoriales encadenan departamento → provincia → distrito, y el de
tipo de centro se recalcula con cada cambio: sólo ofrece los tipos con sedes en el
territorio elegido, con su recuento. Si el tipo seleccionado deja de existir al cambiar de
territorio, se descarta y se indica el motivo en los resultados.

---

## Origen de la búsqueda por cercanía

El origen procede de la API de geolocalización del navegador. Cuando la detección
automática falla —permiso denegado, dispositivo sin servicio de localización o tiempo de
espera agotado— la interfaz ofrece marcar el punto directamente sobre el mapa; el resto de
la aplicación se comporta igual, con el mismo ranking, radio y estimaciones de trayecto.

Mientras el modo de marcado está activo, las pulsaciones sobre el mapa fijan el punto en
lugar de seleccionar territorio o abrir una ficha. Se cancela con `Escape`.

---

## Privacidad

La ubicación se obtiene mediante la API de geolocalización del navegador y se utiliza
exclusivamente en el dispositivo para ordenar los resultados. No se transmite a ningún
servidor ni se almacena; sólo se refleja en la URL cuando el usuario decide compartir el
enlace.

---

## Accesibilidad

Interfaz en español, navegable por teclado, con contraste conforme a WCAG AA, marcadores
enfocables, cierre con `Escape` en los diálogos y soporte de tema claro y oscuro. El diseño
es adaptable a partir de 390 px de ancho.

---

## Fuentes

- **Directorio de Servicios del MIMP** — Ministerio de la Mujer y Poblaciones Vulnerables.
- **Límites territoriales** — [Peru-maps](https://github.com/Rodasluis/Peru-maps), derivados
  de la cartografía oficial del INEI.
- **Mapa base** — Esri, HERE, Garmin, © OpenStreetMap y la comunidad SIG.

---

## Emergencias

**Línea 100** — gratuita, 24 horas, desde cualquier teléfono del Perú.
Emergencias policiales o médicas: **105**.
