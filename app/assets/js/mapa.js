/**
 * Capa de mapa: Leaflet, marcadores agrupados, límites territoriales
 * y círculo del radio de búsqueda.
 */

import { cargarCapa, tienePuntoExacto } from './datos.js';

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
const ATRIBUCION =
  'Mapa base &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, '
  + '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> y la comunidad SIG';

export class MapaCentros {
  /**
   * @param {string} idContenedor
   * @param {{alSeleccionar:Function, alElegirPunto:Function}} manejadores
   */
  constructor(idContenedor, manejadores) {
    this.manejadores = manejadores;
    this.marcadores = new Map();      // id de centro -> marcador
    this.seleccionado = null;
    this.modoPin = false;

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
    this.capaRadio = L.layerGroup().addTo(this.mapa);

    this.grupo = L.markerClusterGroup({
      maxClusterRadius: 46,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      disableClusteringAtZoom: 15,
      chunkedLoading: true,
      iconCreateFunction: (cluster) => {
        const n = cluster.getChildCount();
        const tam = n < 10 ? 34 : n < 100 ? 40 : 46;
        const mod = n < 10 ? '' : n < 100 ? ' cluster--md' : ' cluster--lg';
        return L.divIcon({
          html: `<div class="cluster${mod}" style="width:${tam}px;height:${tam}px">${n}</div>`,
          className: '', iconSize: [tam, tam],
        });
      },
    });
    this.grupo.addTo(this.mapa);

    this.mapa.on('click', (e) => {
      if (!this.modoPin) return;
      this.activarModoPin(false);
      this.manejadores.alElegirPunto({ lat: e.latlng.lat, lon: e.latlng.lng });
    });
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

  /* -------------------------------------------------------- marcador -- */
  #icono(centro, activo) {
    const clases = ['pin'];
    if (activo) clases.push('pin--activo');
    if (!tienePuntoExacto(centro)) clases.push('pin--aprox');
    return L.divIcon({
      html: `<div class="${clases.join(' ')}"></div>`,
      className: '',
      iconSize: [22, 22],
      iconAnchor: [11, 21],
      popupAnchor: [0, -19],
    });
  }

  /** Redibuja los marcadores para la lista de centros dada. */
  dibujarCentros(centros) {
    this.grupo.clearLayers();
    this.marcadores.clear();

    const marcas = centros.map((c) => {
      const m = L.marker([c.lat, c.lon], {
        icon: this.#icono(c, false),
        title: c.nombre,
        alt: `${c.nombre}, ${c.dist}`,
        keyboard: true,
        riseOnHover: true,
      });
      m.on('click', () => this.manejadores.alSeleccionar(c.id));
      m.on('keypress', (e) => {
        if (e.originalEvent.key === 'Enter') this.manejadores.alSeleccionar(c.id);
      });
      this.marcadores.set(c.id, { marcador: m, centro: c });
      return m;
    });

    this.grupo.addLayers(marcas);
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
      this.mapa.setView(act.marcador.getLatLng(), zoom, { animate: true });
    }
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

  /* -------------------------------------------------- modo "elegir" -- */
  activarModoPin(activo) {
    this.modoPin = activo;
    const el = this.mapa.getContainer();
    el.style.cursor = activo ? 'crosshair' : '';
    this.manejadores.alCambiarModoPin?.(activo);
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
      style: () => estilo,
      onEachFeature: (f, capa) => {
        capa.bindTooltip(f.properties.nombre, { sticky: true, direction: 'top', opacity: .95 });
        capa.on('mouseover', () => capa.setStyle({ fillOpacity: .17, weight: estilo.weight + 1 }));
        capa.on('mouseout', () => capa.setStyle(estilo));
      },
    }).addTo(this.mapa);

    return { nivel: efectivo };
  }

  /** Ajusta el encuadre al territorio seleccionado. */
  async encuadrarTerritorio(nivel, codigo) {
    if (!codigo) { this.mapa.fitBounds(PERU_BOUNDS, { padding: [10, 10] }); return; }
    const ccdd = codigo.slice(0, 2);
    const ruta = nivel === 'departamentos' ? 'departamentos.geojson'
      : nivel === 'provincias' ? `provincias/${ccdd}.geojson`
        : `distritos/${ccdd}.geojson`;
    try {
      const datos = await cargarCapa(ruta);
      const f = datos.features.find((x) => x.properties.ubigeo === codigo);
      if (!f) return;
      this.mapa.fitBounds(L.geoJSON(f).getBounds(), { padding: [26, 26], maxZoom: 14 });
    } catch { /* si la capa falla, se deja el encuadre actual */ }
  }

  encuadrarCentros(centros) {
    if (!centros.length) return;
    const b = L.latLngBounds(centros.map((c) => [c.lat, c.lon]));
    this.mapa.fitBounds(b, { padding: [40, 40], maxZoom: 14 });
  }

  invalidar() { this.mapa.invalidateSize(); }
}
