/**
 * Carga del directorio y aplicación de los filtros.
 * Todo ocurre en memoria: el conjunto son ~830 registros.
 */

import { distanciaKm, estimarViaje } from './geo.js';

export const BASE = new URL('../../data/', import.meta.url);

/** Quita tildes y pasa a minúsculas, para buscar sin preocuparse por acentos. */
export const normalizar = (s) => (s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

let DIRECTORIO = null;

export async function cargarDirectorio() {
  if (DIRECTORIO) return DIRECTORIO;
  const res = await fetch(new URL('centros.json', BASE));
  if (!res.ok) throw new Error(`No se pudo cargar el directorio (HTTP ${res.status})`);
  DIRECTORIO = await res.json();

  // Índice de búsqueda precalculado: evita normalizar en cada tecleo.
  for (const c of DIRECTORIO.centros) {
    c._busq = normalizar([c.nombre, c.tipo, c.servicio, c.direccion, c.responsable,
      c.dist, c.prov, c.dep, c.codigo].join(' '));
  }
  return DIRECTORIO;
}

/** Un centro tiene punto real si no se le asignó el centroide del distrito. */
export const tienePuntoExacto = (c) => c.calidad !== 'centroide_distrito';

/**
 * Sólo entran en el ranking por cercanía los servicios presenciales con un
 * punto real. Los de atención telefónica (Línea 100, Chat 100) atienden a
 * todo el país, y los de dirección reservada no publican su punto.
 */
export const entraEnRanking = (c) => c.presencial !== false && tienePuntoExacto(c);

/**
 * Aplica los filtros y devuelve la lista ya ordenada.
 *
 * Los filtros territoriales y la búsqueda por cercanía se combinan: primero
 * se recorta por territorio, tipo y texto, y sobre ese subconjunto se aplica
 * el radio y el orden por distancia.
 */
export function filtrar(centros, estado) {
  const { origen, radioKm, dep, prov, dist, tipo, q, orden } = estado;
  const texto = normalizar(q).trim();
  const terminos = texto ? texto.split(/\s+/) : [];

  let out = centros.filter((c) => {
    if (dep && c.ccdd !== dep) return false;
    if (prov && c.ccpp !== prov) return false;
    if (dist && c.ubigeo !== dist) return false;
    if (tipo && c.tipo !== tipo) return false;
    if (terminos.length && !terminos.every((t) => c._busq.includes(t))) return false;
    return true;
  });

  // Distancia y tiempo estimado respecto del origen.
  let fueraDeRadio = 0;
  let sinPunto = 0;
  const totalTerritorial = out.length;
  if (origen) {
    const conMedidas = [];
    for (const c of out) {
      if (!entraEnRanking(c)) { sinPunto++; continue; }
      const km = distanciaKm(origen.lat, origen.lon, c.lat, c.lon);
      if (radioKm !== null && km > radioKm) { fueraDeRadio++; continue; }
      const viaje = estimarViaje(km, c.ccdd);
      conMedidas.push({ ...c, _km: km, _viaje: viaje });
    }
    out = conMedidas;
  } else {
    out = out.map((c) => ({ ...c, _km: null, _viaje: null }));
  }

  ordenar(out, orden, Boolean(origen));
  return { lista: out, fueraDeRadio, sinPunto, totalTerritorial };
}

const collator = new Intl.Collator('es', { sensitivity: 'base' });

function ordenar(lista, orden, hayOrigen) {
  const porNombre = (a, b) => collator.compare(a.nombre, b.nombre);
  if (orden === 'cercania' && hayOrigen) {
    lista.sort((a, b) => a._km - b._km || porNombre(a, b));
  } else if (orden === 'territorio') {
    lista.sort((a, b) =>
      collator.compare(a.dep, b.dep)
      || collator.compare(a.prov, b.prov)
      || collator.compare(a.dist, b.dist)
      || porNombre(a, b));
  } else {
    lista.sort(porNombre);
  }
}

/* ------------------------------------------------- capas geográficas -- */

const cacheGeo = new Map();

/** Descarga (y memoriza) una capa GeoJSON. */
export async function cargarCapa(ruta) {
  if (cacheGeo.has(ruta)) return cacheGeo.get(ruta);
  const p = fetch(new URL(`geo/${ruta}`, BASE)).then((r) => {
    if (!r.ok) throw new Error(`No se pudo cargar la capa ${ruta}`);
    return r.json();
  });
  cacheGeo.set(ruta, p);
  return p;
}
