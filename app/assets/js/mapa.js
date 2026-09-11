/**
 * Capa de mapa: Leaflet, marcadores agrupados, límites territoriales
 * y círculo del radio de búsqueda.
 */

import { cargarCapa } from './datos.js';

/** Raíz de la aplicación (app/), para resolver las rutas de los iconos. */
const BASE_APP = new URL('../../', import.meta.url);

const PERU_CENTRO = [-9.6, -75.5];
const PERU_BOUNDS = L.latLngBounds([-18.6, -81.6], [0.2, -68.4]);

/**
 * Mapa base: teselas «Light/Dark Gray Canvas» de Esri. No necesitan clave de
 * API —CARTO y las teselas estándar de OSM sí la exigen o restringen su uso—
 * y su gris neutro deja que resalten los marcadores.
 *
 * Cada tema son dos capas: el fondo y una de referencia con los rótulos.
 * El caché de Esri llega hasta z16, así que a partir de ahí Leaflet reescala
 * la última tesela disponible (maxNativeZoom) en lugar de pedir teselas vacías.
 */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const BASEMAPS = {
  claro: [`${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
  oscuro: [`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
};
const MAX_ZOOM_NATIVO = 16;

/** Hasta este número de resultados, los marcadores no se agrupan. */
const SIN_AGRUPAR_HASTA = 25;

/**
 * Desde este zoom los marcadores dejan de agruparse.
 *
 * Se midió cuántos centros caen en la misma celda del tamaño del icono:
 * a z5 el 88 % se solapa (140 apilados en Breña), a z8 el 62 %, y recién
 * desde z11 baja al 36 % con un máximo de 8 por celda. Por debajo de ese
 * zoom agrupar es inevitable; por encima, estorba.
 */
const ZOOM_SIN_AGRUPAR = 11;

/**
 * Tamaño del marcador según el zoom. Pequeño en vista nacional, donde sólo
 * importa dónde hay centros, y grande al acercarse, donde el icono debe
 * poder distinguirse.
 */
const TAMANOS = [
  { hasta: 7, px: 18 },
  { hasta: 9, px: 22 },
  { hasta: 11, px: 26 },
  { hasta: 13, px: 30 },
  { hasta: Infinity, px: 34 },
];
const tamanoParaZoom = (z) => TAMANOS.find((t) => z <= t.hasta).px;
const ATRIBUCION =
  'Mapa base &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, '
  + '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> y la comunidad SIG';

export class MapaCentros {
  /**
   * @param {string} idContenedor
   * @param {{alSeleccionar:Function, alElegirPunto:Function}} manejadores
   */
  /**
   * @param {string} idContenedor
   * @param {object} manejadores
   * @param {object} iconos  catálogo de app/data/iconos.json
   */
  constructor(idContenedor, manejadores, iconos) {
    this.manejadores = manejadores;
    this.iconos = iconos || { ruta: 'assets/iconos/', tipos: {} };
    this.marcadores = new Map();      // id de centro -> marcador
    this.seleccionado = null;

    this.mapa = L.map(idContenedor, {
      center: PERU_CENTRO,
      zoom: 5,
      minZoom: 4,
      maxBounds: PERU_BOUNDS.pad(0.45),
      maxBoundsViscosity: 0.7,
      zoomControl: false,
      preferCanvas: true,
      attributionControl: true,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.mapa);
    this.mapa.attributionControl.setPrefix('');

    // Orden de pintado, de abajo arriba: fondo (200) · límites (350) ·
    // radio (overlayPane, 400) · rótulos del mapa base (450) · marcadores (600).
    this.mapa.createPane('limites').style.zIndex = 350;
    this.mapa.createPane('rotulos').style.zIndex = 450;
    this.mapa.getPane('rotulos').style.pointerEvents = 'none';

    const [fondo, rotulos] = BASEMAPS.claro;
    const opcTesela = { maxZoom: 19, maxNativeZoom: MAX_ZOOM_NATIVO };
    this.teselaFondo = L.tileLayer(fondo, { ...opcTesela, attribution: ATRIBUCION }).addTo(this.mapa);
    this.teselaRotulos = L.tileLayer(rotulos, { ...opcTesela, pane: 'rotulos' }).addTo(this.mapa);

    this.capaLimites = null;
    this.rendererLimites = L.svg({ pane: 'limites' });
    this.capaRadio = L.layerGroup().addTo(this.mapa);

    this.grupo = L.markerClusterGroup({
      maxClusterRadius: 46,
      // Ni abanico ni acercamiento propio: el zoom lo manda siempre la
      // selección territorial, para que el mapa no se mueva por su cuenta.
      spiderfyOnMaxZoom: false,
      zoomToBoundsOnClick: false,
      showCoverageOnHover: false,
      disableClusteringAtZoom: ZOOM_SIN_AGRUPAR,
      chunkedLoading: true,
      iconCreateFunction: (cluster) => this.#iconoGrupo(cluster),
    });
    this.grupo.addTo(this.mapa);

    // Pulsar un grupo baja de nivel territorial igual que pulsar el mapa: si
    // sólo se limitara a acercar, el usuario quedaría con los límites
    // departamentales fuera de pantalla y sin nada que pulsar.
    this.grupo.on('clusterclick', (e) => this.#alPulsarGrupo(e.layer));

    // El tamaño del marcador depende del zoom, así que hay que repintarlos
    // al terminar cada cambio de escala.
    this.zoomActual = this.mapa.getZoom();
    this.mapa.on('zoomend', () => {
      const z = this.mapa.getZoom();
      if (tamanoParaZoom(z) === tamanoParaZoom(this.zoomActual)) { this.zoomActual = z; return; }
      this.zoomActual = z;
      this.#redimensionarMarcadores();
    });

    // Con pocos resultados agrupar estorba más que ayuda: se usa una capa
    // simple para que cada centro se vea suelto sin depender del zoom.
    this.grupoSimple = L.layerGroup().addTo(this.mapa);
  }

  /** Marca visual de un tipo de centro: icono del libro del MIMP, o su sigla. */
  marcaDe(tipo) {
    const def = this.iconos.tipos[tipo];
    if (!def) return { color: '#8e1b60', html: '<span class="pin__sigla">?</span>' };
    const html = def.archivo
      ? `<img src="${new URL(this.iconos.ruta + def.archivo, BASE_APP)}" alt="" loading="lazy">`
      : `<span class="pin__sigla">${def.sigla}</span>`;
    return { color: def.color, html };
  }

  /* ------------------------------------------------------------ tema -- */
  aplicarTema(oscuro) {
    this.oscuro = oscuro;
    const [fondo, rotulos] = oscuro ? BASEMAPS.oscuro : BASEMAPS.claro;
    this.teselaFondo.setUrl(fondo);
    this.teselaRotulos.setUrl(rotulos);
    if (this.capaLimites) this.capaLimites.setStyle(this.#estiloLimite());
  }

  /**
   * Estilo de los límites. Leaflet escribe estos valores como atributos SVG,
   * que no interpretan var(--…): hay que dar colores literales.
   */
  #estiloLimite() {
    return this.oscuro
      ? { color: '#7d8698', weight: this.#grosorLimite(), opacity: .8, fillColor: '#8fa0bd', fillOpacity: .05 }
      : { color: '#7b8494', weight: this.#grosorLimite(), opacity: .75, fillColor: '#6b7789', fillOpacity: .045 };
  }

  #grosorLimite() {
    return this._nivelLimites === 'departamentos' ? 1.2 : 0.7;
  }

  /**
   * Icono de un grupo: en vez de un globo con el número, se muestra el icono
   * del tipo predominante con el recuento en una esquina, para no perder de
   * vista qué clase de centros hay agrupados ahí.
   */
  #iconoGrupo(cluster) {
    const n = cluster.getChildCount();
    const porTipo = new Map();
    for (const m of cluster.getAllChildMarkers()) {
      const t = m.options.tipoCentro;
      porTipo.set(t, (porTipo.get(t) || 0) + 1);
    }
    const [predominante] = [...porTipo].sort((a, b) => b[1] - a[1])[0];
    const { color, html } = this.marcaDe(predominante);

    // El grupo necesita un mínimo propio: con el tamaño de un pin suelto, la
    // insignia del recuento taparía el icono en vez de acompañarlo.
    const base = tamanoParaZoom(this.zoomActual ?? this.mapa.getZoom());
    const tam = Math.round(Math.max(34, base * (n < 10 ? 1.2 : n < 100 ? 1.35 : 1.5)));

    return L.divIcon({
      html: `<div class="grupo" style="--pin-color:${color};width:${tam}px;height:${tam}px">
               ${html}
               <span class="grupo__n">${n > 999 ? '999+' : n}</span>
             </div>`,
      className: '',
      iconSize: [tam, tam],
    });
  }

  /**
   * Pulsar un grupo equivale a pulsar su territorio: se baja al que comparten
   * todos sus centros —distrito, si no provincia, si no departamento— y el
   * encuadre lo decide esa selección. Si abarca varios departamentos se toma
   * el que aporta más centros, para que el clic nunca quede sin efecto.
   */
  #alPulsarGrupo(grupo) {
    const hijos = grupo.getAllChildMarkers();
    const comun = (clave) => {
      const v = hijos[0].options[clave];
      return hijos.every((m) => m.options[clave] === v) ? v : null;
    };

    let ubigeo = comun('ubigeoCentro') || comun('ccppCentro') || comun('ccddCentro');
    if (!ubigeo) {
      const porDep = new Map();
      for (const m of hijos) {
        porDep.set(m.options.ccddCentro, (porDep.get(m.options.ccddCentro) || 0) + 1);
      }
      ubigeo = [...porDep].sort((a, b) => b[1] - a[1])[0][0];
    }
    this.manejadores.alElegirTerritorio?.(ubigeo, null, { alternar: false });
  }

  /* -------------------------------------------------------- marcador -- */
  #icono(centro, activo) {
    const { color, html } = this.marcaDe(centro.tipo);
    const tam = tamanoParaZoom(this.zoomActual ?? this.mapa.getZoom());
    return L.divIcon({
      html: `<div class="pin${activo ? ' pin--activo' : ''}" style="--pin-color:${color}">${html}</div>`,
      className: '',
      iconSize: [tam, tam],
      iconAnchor: [tam / 2, tam + 4],
      popupAnchor: [0, -tam - 2],
    });
  }

  /**
   * Repinta los iconos tras cruzar un umbral de tamaño.
   *
   * No se refrescan los grupos: sólo existen por debajo de z11, donde su
   * tamaño apenas varía (el mínimo de 34 px domina el cálculo), y llamar a
   * refreshClusters() durante la animación de zoom del propio grupo deja los
   * polígonos de los límites sin reposicionar.
   */
  #redimensionarMarcadores() {
    for (const [id, { marcador, centro }] of this.marcadores) {
      marcador.setIcon(this.#icono(centro, id === this.seleccionado));
    }
  }

  /** Redibuja los marcadores para la lista de centros dada. */
  dibujarCentros(centros) {
    this.grupo.clearLayers();
    this.grupoSimple.clearLayers();
    this.marcadores.clear();

    const marcas = centros.map((c) => {
      const m = L.marker([c.lat, c.lon], {
        icon: this.#icono(c, false),
        title: c.nombre,
        alt: `${c.nombre}, ${c.dist}`,
        keyboard: true,
        riseOnHover: true,
        // los lee el grupo para elegir su icono y su territorio común
        tipoCentro: c.tipo,
        ccddCentro: c.ccdd,
        ccppCentro: c.ccpp,
        ubigeoCentro: c.ubigeo,
      });
      m.on('click', () => this.manejadores.alSeleccionar(c.id));
      m.on('keypress', (e) => {
        if (e.originalEvent.key === 'Enter') this.manejadores.alSeleccionar(c.id);
      });
      this.marcadores.set(c.id, { marcador: m, centro: c });
      return m;
    });

    if (marcas.length <= SIN_AGRUPAR_HASTA) marcas.forEach((m) => m.addTo(this.grupoSimple));
    else this.grupo.addLayers(marcas);

    if (this.seleccionado != null) this.resaltar(this.seleccionado, false);
  }

  /** Marca visualmente un centro y, si se pide, lo lleva al centro del mapa. */
  resaltar(id, centrar = true) {
    if (this.seleccionado != null && this.marcadores.has(this.seleccionado)) {
      const ant = this.marcadores.get(this.seleccionado);
      ant.marcador.setIcon(this.#icono(ant.centro, false));
    }
    this.seleccionado = id;
    const act = this.marcadores.get(id);
    if (!act) return;
    act.marcador.setIcon(this.#icono(act.centro, true));
    if (centrar) {
      // Se evita zoomToShowLayer: si el grupo se redibuja durante su animación,
      // markercluster falla al perder la referencia al mapa. Basta con acercarse
      // más allá de disableClusteringAtZoom para que el marcador quede suelto.
      const zoom = Math.max(this.mapa.getZoom(), 16);
      this.centrarEnVisible(act.marcador.getLatLng(), zoom);
    }
  }

  /**
   * Centra un punto en la parte del mapa que queda a la vista, descontando lo
   * que tape la ficha flotante. Sin esto el centro real queda detrás de la
   * tarjeta y el mapa parece descuadrado.
   */
  centrarEnVisible(latlng, zoom = this.mapa.getZoom()) {
    const tapado = this.#anchoTapado();
    if (!tapado) { this.mapa.setView(latlng, zoom, { animate: true }); return; }
    // Desplazar el centro hacia la derecha deja el punto en el hueco libre.
    const punto = this.mapa.project(latlng, zoom).add([tapado / 2, 0]);
    this.mapa.setView(this.mapa.unproject(punto, zoom), zoom, { animate: true });
  }

  /** Píxeles de mapa que oculta la ficha flotante por la derecha. */
  #anchoTapado() {
    const ficha = document.querySelector('.ficha--flotante:not([hidden]) .ficha__panel');
    if (!ficha) return 0;
    const r = ficha.getBoundingClientRect();
    const m = this.mapa.getContainer().getBoundingClientRect();
    // En móvil la ficha es una hoja inferior: no tapa por el lado.
    if (r.width >= m.width * 0.9) return 0;
    return Math.max(0, m.right - r.left);
  }

  limpiarResaltado() {
    if (this.seleccionado != null && this.marcadores.has(this.seleccionado)) {
      const ant = this.marcadores.get(this.seleccionado);
      ant.marcador.setIcon(this.#icono(ant.centro, false));
    }
    this.seleccionado = null;
  }

  /* ------------------------------------------------- origen y radio -- */
  dibujarOrigen(origen, radioKm) {
    this.capaRadio.clearLayers();
    if (!origen) return;

    if (radioKm) {
      L.circle([origen.lat, origen.lon], {
        radius: radioKm * 1000,
        color: '#1c7ed6', weight: 1.4, opacity: .75,
        fillColor: '#1c7ed6', fillOpacity: .07,
        interactive: false,
      }).addTo(this.capaRadio);
    }

    L.marker([origen.lat, origen.lon], {
      icon: L.divIcon({ html: '<div class="pin-yo"></div>', className: '', iconSize: [18, 18] }),
      zIndexOffset: 1200,
      title: 'Tu ubicación',
      alt: 'Tu ubicación',
    }).addTo(this.capaRadio).bindPopup('<strong>Tu ubicación</strong>');
  }

  /** Encuadra el mapa al origen y su radio. */
  encuadrarRadio(origen, radioKm) {
    if (!origen) return;
    if (radioKm) {
      // getBounds() de un L.circle sin añadir al mapa lanza excepción: necesita
      // el mapa para convertir metros a grados. toBounds() no lo necesita, y
      // toma el diámetro, de ahí el ×2.
      const b = L.latLng(origen.lat, origen.lon).toBounds(radioKm * 2000);
      this.mapa.fitBounds(b, { padding: [40, 40], maxZoom: 15 });
    } else {
      this.mapa.setView([origen.lat, origen.lon], 12);
    }
  }

  /* ------------------------------------------------------- límites --- */
  /**
   * Muestra los límites del nivel pedido. Provincias y distritos se cargan
   * por departamento; sin departamento seleccionado se muestran los
   * departamentos, porque el archivo nacional de distritos sería enorme.
   */
  async mostrarLimites(nivel, ccdd) {
    const quitar = () => {
      if (this.capaLimites) { this.mapa.removeLayer(this.capaLimites); this.capaLimites = null; }
      this._claveLimites = null;
    };
    if (nivel === 'ninguna') { quitar(); return { nivel: 'ninguna' }; }

    let ruta = 'departamentos.geojson';
    let efectivo = 'departamentos';
    if ((nivel === 'provincias' || nivel === 'distritos') && ccdd) {
      ruta = `${nivel}/${ccdd}.geojson`;
      efectivo = nivel;
    }

    if (this._claveLimites === ruta) return { nivel: efectivo };

    let datos;
    try {
      datos = await cargarCapa(ruta);
    } catch {
      return { nivel: efectivo, error: true };
    }
    quitar();
    this._claveLimites = ruta;
    this._nivelLimites = efectivo;

    const estilo = this.#estiloLimite();
    this.capaLimites = L.geoJSON(datos, {
      pane: 'limites',
      // SVG en lugar del canvas del mapa: nunca se cargan más de ~180
      // polígonos a la vez (los distritos de un departamento), y con
      // elementos reales el clic y el resaltado son fiables.
      renderer: this.rendererLimites,
      style: () => estilo,
      onEachFeature: (f, capa) => {
        const nombre = f.properties.nombre;
        capa.bindTooltip(`${nombre}<span class="tooltip__pista">Clic para ver sus centros</span>`, {
          sticky: true, direction: 'top', opacity: .95, className: 'tooltip-territorio',
        });
        capa.on('mouseover', () => capa.setStyle({ fillOpacity: .17, weight: estilo.weight + 1 }));
        capa.on('mouseout', () => capa.setStyle(estilo));
        // Clic en el territorio: baja un nivel en los filtros. Los marcadores
        // viven en un pane superior, así que sus clics no llegan hasta aquí.
        capa.on('click', (e) => {
          L.DomEvent.stop(e);
          this.manejadores.alElegirTerritorio?.(f.properties.ubigeo, nombre);
        });
      },
    }).addTo(this.mapa);

    return { nivel: efectivo };
  }

  /** Capa y zoom máximo con que se dibuja cada nivel territorial. */
  #nivelDe(codigo) {
    const ccdd = codigo.slice(0, 2);
    return {
      2: { ruta: 'departamentos.geojson', maxZoom: 9 },
      4: { ruta: `provincias/${ccdd}.geojson`, maxZoom: 11 },
      6: { ruta: `distritos/${ccdd}.geojson`, maxZoom: 14 },
    }[codigo.length] || null;
  }

  /**
   * Remarca el territorio elegido, o quita el remarcado si no hay ninguno.
   * Va aparte del encuadre porque al limpiar los filtros no se reencuadra
   * el mapa, y el trazo azul se quedaba pegado como si siguiera elegido.
   */
  async resaltarTerritorio(codigo) {
    const cod = codigo || null;
    // Si ya se está pintando ese mismo territorio hay que esperar a que
    // termine, no salir de inmediato: quien encuadra necesita la capa lista.
    if (this._codigoResaltado === cod) { await this._promesaResaltado; return; }
    this._codigoResaltado = cod;
    this._promesaResaltado = this.#pintarResaltado(cod);
    await this._promesaResaltado;
  }

  async #pintarResaltado(codigo) {
    this.capaSeleccion?.remove();
    this.capaSeleccion = null;
    if (!codigo) return;

    const cfg = this.#nivelDe(codigo);
    if (!cfg) return;
    try {
      const datos = await cargarCapa(cfg.ruta);
      const f = datos.features.find((x) => x.properties.ubigeo === codigo);
      if (!f || this._codigoResaltado !== codigo) return;   // llegó tarde

      this.capaSeleccion = L.geoJSON(f, {
        pane: 'limites',
        renderer: this.rendererLimites,   // mismo SVG que los límites
        interactive: false,
        style: {
          color: '#1c7ed6', weight: 2.6, opacity: .95,
          fillColor: '#1c7ed6', fillOpacity: .07,
          dashArray: '5 4',
        },
      }).addTo(this.mapa);
    } catch { /* si la capa falla, se queda sin remarcar */ }
  }

  /**
   * Encuadra el territorio elegido. El zoom máximo depende del nivel para
   * que cada uno llene la pantalla de forma natural: un departamento
   * entero, una provincia más cerca y un distrito aún más.
   */
  async encuadrarTerritorio(codigo) {
    await this.resaltarTerritorio(codigo);

    if (!codigo) {
      this.mapa.fitBounds(PERU_BOUNDS, { padding: [10, 10] });
      return;
    }
    const cfg = this.#nivelDe(codigo);
    if (!cfg || !this.capaSeleccion) return;

    this.mapa.fitBounds(this.capaSeleccion.getBounds(), {
      padding: [30, 30], maxZoom: cfg.maxZoom,
    });
  }

  encuadrarCentros(centros) {
    if (!centros.length) return;
    const b = L.latLngBounds(centros.map((c) => [c.lat, c.lon]));
    this.mapa.fitBounds(b, { padding: [40, 40], maxZoom: 14 });
  }

  invalidar() { this.mapa.invalidateSize(); }
}
