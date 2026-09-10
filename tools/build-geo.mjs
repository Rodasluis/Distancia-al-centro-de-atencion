/**
 * Simplifica y reparte las capas geográficas del Perú por departamento.
 *
 * La simplificación se hace sobre una topología (TopoJSON) construida con
 * TODOS los polígonos de cada nivel a la vez: así los bordes compartidos se
 * simplifican de forma idéntica y no aparecen huecos ni solapamientos entre
 * vecinos, cosa que sí ocurre al simplificar cada polígono por separado.
 * El resultado se vuelve a convertir a GeoJSON para que el navegador no
 * necesite ninguna librería adicional.
 *
 * Uso:  node tools/build-geo.mjs <carpeta-con-geojson-descargado>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { topology } from 'topojson-server';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { feature } from 'topojson-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEO_SRC = process.argv[2];
const OUT = path.join(ROOT, 'app', 'data', 'geo');

if (!GEO_SRC) {
  console.error('Uso: node tools/build-geo.mjs <carpeta-con-geojson>');
  process.exit(1);
}

const readGeo = (n) => JSON.parse(fs.readFileSync(path.join(GEO_SRC, n), 'utf8'));

/** Catálogo de nombres oficiales (con tildes) desde ubigeos_2025.csv */
function parseCsv(txt) {
  const lines = txt.trim().split(/\r?\n/);
  const hdr = lines[0].split(',');
  const split = (l) => {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') {
        if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q;
      } else if (c === ',' && !q) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out;
  };
  return lines.slice(1).map((l) => {
    const p = split(l);
    const o = {};
    hdr.forEach((h, i) => (o[h] = p[i]));
    return o;
  });
}
const ubigeos = parseCsv(fs.readFileSync(path.join(GEO_SRC, 'ubigeos_2025.csv'), 'utf8'));
const nameOf = new Map(ubigeos.map((u) => [u.ubigeo, u.nombre]));

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/** Redondea los vértices e imprime el GeoJSON compacto. */
function writeFC(file, features, precision) {
  const fix = (c) => (Array.isArray(c[0]) ? c.map(fix) : [round(c[0], precision), round(c[1], precision)]);
  const out = {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature',
      properties: f.properties,
      geometry: { type: f.geometry.type, coordinates: fix(f.geometry.coordinates) },
    })),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  return fs.statSync(file).size;
}

/**
 * Simplifica una colección conservando la topología.
 * @param keep fracción de vértices que se conserva (0-1)
 */
function simplifyFC(fc, keep, props) {
  const topo = presimplify(topology({ l: fc }));
  const min = quantile(topo, keep);
  const out = feature(simplify(topo, min), 'l');
  out.features.forEach((f) => { f.properties = props(f.properties); });
  return out.features;
}

const kb = (n) => (n / 1024).toFixed(0) + ' KB';

/* ---------------------------- departamentos ---------------------------- */
console.log('› departamentos');
const depFeats = simplifyFC(readGeo('departamento_simplificado.geojson'), 0.12,
  (p) => ({ ubigeo: p.ubigeo, nombre: nameOf.get(p.ubigeo) || p.nombre }));
console.log('  ✓ departamentos.geojson', kb(writeFC(path.join(OUT, 'departamentos.geojson'), depFeats, 4)));

/* ------------------------------ provincias ----------------------------- */
console.log('› provincias');
const provFeats = simplifyFC(readGeo('provincia_simplificado.geojson'), 0.22,
  (p) => ({ ubigeo: p.ubigeo, nombre: nameOf.get(p.ubigeo) || p.nombre }));

/* ------------------------------- distritos ----------------------------- */
console.log('› distritos');
const distFeats = simplifyFC(readGeo('distrito_simplificado.geojson'), 0.32,
  (p) => ({ ubigeo: p.ubigeo, nombre: nameOf.get(p.ubigeo) || p.nombre }));

const deps = [...new Set(distFeats.map((f) => f.properties.ubigeo.slice(0, 2)))].sort();
let tp = 0, td = 0, maxP = 0, maxD = 0;
for (const dd of deps) {
  const sp = writeFC(path.join(OUT, `provincias/${dd}.geojson`),
    provFeats.filter((f) => f.properties.ubigeo.slice(0, 2) === dd), 5);
  const sd = writeFC(path.join(OUT, `distritos/${dd}.geojson`),
    distFeats.filter((f) => f.properties.ubigeo.slice(0, 2) === dd), 5);
  tp += sp; td += sd;
  maxP = Math.max(maxP, sp); maxD = Math.max(maxD, sd);
}
console.log(`  ✓ provincias/  ${kb(tp)} en ${deps.length} archivos (mayor: ${kb(maxP)})`);
console.log(`  ✓ distritos/   ${kb(td)} en ${deps.length} archivos (mayor: ${kb(maxD)})`);
