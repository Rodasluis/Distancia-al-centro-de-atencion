/**
 * Genera los datos estáticos de la aplicación a partir de:
 *   - "Directorio de servicios.xlsx"  (hoja "SERVICIOS MIMP")
 *   - GeoJSON de https://github.com/Rodasluis/Peru-maps (carpeta salida/)
 *
 * Salida: app/data/centros.json  (las capas geográficas las genera build-geo.mjs)
 *
 * El GeoJSON de distritos se usa aquí sólo para auditar las coordenadas del
 * directorio y para situar los centros sin coordenadas en su distrito.
 *
 * Uso:  node tools/build-data.mjs <carpeta-con-geojson-descargado>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEO_SRC = process.argv[2];
const OUT = path.join(ROOT, 'app', 'data');
const XLSX = path.join(ROOT, 'Directorio de servicios.xlsx');

if (!GEO_SRC) {
  console.error('Uso: node tools/build-data.mjs <carpeta-con-geojson>');
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * 1. Lectura del .xlsx (sin dependencias: un .xlsx es un ZIP con XML)
 * ------------------------------------------------------------------ */
function readXlsx(file) {
  const tmp = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'xlsx-'));
  execFileSync('unzip', ['-o', '-q', file, '-d', tmp]);

  const dec = (s) => s
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

  const shared = [];
  const ssPath = path.join(tmp, 'xl/sharedStrings.xml');
  if (fs.existsSync(ssPath)) {
    for (const m of fs.readFileSync(ssPath, 'utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      let t = '';
      for (const x of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += x[1];
      shared.push(dec(t));
    }
  }

  const colIdx = (ref) => {
    const L = ref.match(/^[A-Z]+/)[0];
    let n = 0;
    for (const c of L) n = n * 26 + (c.charCodeAt(0) - 64);
    return n - 1;
  };

  const xml = fs.readFileSync(path.join(tmp, 'xl/worksheets/sheet1.xml'), 'utf8');
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    // El cuantificador debe ser perezoso ([^>]*?): con uno voraz, una celda
    // vacía autocerrada (<c r="D2" s="31"/>) se fusiona con la siguiente y
    // desplaza todas las columnas de la fila.
    for (const cm of rm[2].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] || '';
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
      if (!ref) continue;
      const t = (attrs.match(/t="([^"]+)"/) || [])[1];
      let val = '';
      if (t === 'inlineStr') {
        for (const x of inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) val += x[1];
        val = dec(val);
      } else {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (v !== undefined) val = t === 's' ? shared[parseInt(v)] : dec(v);
      }
      cells[colIdx(ref)] = val;
    }
    rows[parseInt(rm[1]) - 1] = cells;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return rows;
}

/* ------------------------------------------------------------------ *
 * 2. Utilidades geométricas
 * ------------------------------------------------------------------ */
const ringsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

function bboxOf(g) {
  const b = [180, 90, -180, -90];
  for (const poly of ringsOf(g)) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < b[0]) b[0] = x;
        if (y < b[1]) b[1] = y;
        if (x > b[2]) b[2] = x;
        if (y > b[3]) b[3] = y;
      }
    }
  }
  return b;
}

function inRing(pt, ring) {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function inGeom(pt, g) {
  for (const poly of ringsOf(g)) {
    if (!inRing(pt, poly[0])) continue;
    let hole = false;
    for (let k = 1; k < poly.length; k++) {
      if (inRing(pt, poly[k])) { hole = true; break; }
    }
    if (!hole) return true;
  }
  return false;
}

/** Centroide por área, con respaldo al promedio de vértices. */
function centroidOf(g) {
  let A = 0, cx = 0, cy = 0, n = 0, sx = 0, sy = 0;
  for (const poly of ringsOf(g)) {
    const ring = poly[0];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x0, y0] = ring[j];
      const [x1, y1] = ring[i];
      const f = x0 * y1 - x1 * y0;
      A += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
      sx += x1; sy += y1; n++;
    }
  }
  if (Math.abs(A) < 1e-12) return n ? [sx / n, sy / n] : null;
  A *= 0.5;
  return [cx / (6 * A), cy / (6 * A)];
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/* ------------------------------------------------------------------ *
 * 3. Normalización de textos
 * ------------------------------------------------------------------ */
const clean = (v) => (v === undefined || v === null ? '' : String(v).replace(/\s+/g, ' ').trim());

const MINOR = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'el', 'en', 'a', 'al', 'para', 'con', 'por']);

// Siglas de los servicios del MIMP: deben quedar en mayúsculas, no capitalizadas.
const SIGLAS = new Set(['cem', 'car', 'ct', 'sec', 'sar', 'hrt', 'upe', 'cedif', 'sau', 'cai',
  'pias', 'cad', 'can', 'saipd', 'soufcat', 'carpam', 'pcd', 'mimp', 'inabif', 'ufcat',
  'demuna', 'crf', 'ccf', 'uae', 'ua', 'sdf', 'aec', 'effa']);

/** "CEM REGULAR SATIPO" -> "CEM Regular Satipo" */
function titleCase(s) {
  if (!s) return '';
  return s.toLowerCase().split(/(\s+|-|\/)/).map((w, i) => {
    if (!w || /^(\s+|-|\/)$/.test(w)) return w;
    if (SIGLAS.has(w)) return w.toUpperCase();
    if (/^(?:[a-zñ]\.){2,}$/.test(w)) return w.toUpperCase();   // "c.a.i." -> "C.A.I."
    if (i > 0 && MINOR.has(w)) return w;
    if (/^\d/.test(w)) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join('');
}

const yesNo = (v) => {
  const s = clean(v).toLowerCase();
  return s === 'si' || s === 'sí' ? 1 : s === 'no' ? 0 : null;
};

/* ------------------------------------------------------------------ *
 * 4. Construcción
 * ------------------------------------------------------------------ */
console.log('› Leyendo', path.basename(XLSX));
const rows = readXlsx(XLSX);
const data = rows.slice(1).filter((r) => r && r.some((c) => c !== undefined && c !== ''));
console.log('  filas de datos:', data.length);

console.log('› Leyendo GeoJSON de referencia');
const readGeo = (n) => JSON.parse(fs.readFileSync(path.join(GEO_SRC, n), 'utf8'));
const gDist = readGeo('distrito_simplificado.geojson');

/** Catálogo oficial de ubigeos (INEI 2025): nombres con tildes correctas. */
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
const catDist = new Map(ubigeos.filter((u) => u.nivel === 'distrito').map((u) => [u.ubigeo, u]));
const catProv = new Map(ubigeos.filter((u) => u.nivel === 'provincia').map((u) => [u.ubigeo, u]));
const catDep = new Map(ubigeos.filter((u) => u.nivel === 'departamento').map((u) => [u.ubigeo, u]));

// Índice espacial de distritos, para validar las coordenadas del directorio.
const distFeats = gDist.features.map((f) => ({
  ub: f.properties.ubigeo,
  nom: f.properties.nombre,
  g: f.geometry,
  bb: bboxOf(f.geometry),
}));
const distByUb = new Map(distFeats.map((f) => [f.ub, f]));
const distCentroid = new Map(gDist.features.map((f) => [f.properties.ubigeo, centroidOf(f.geometry)]));

/**
 * Corrige coordenadas a las que les falta el punto decimal.
 * Ambos ejes se dividen por la MISMA potencia de 10: aplicar un factor
 * distinto a cada eje produce puntos plausibles pero equivocados.
 */
function repairPair(xr, yr) {
  const X = parseFloat(xr);
  const Y = parseFloat(yr);
  if (!Number.isFinite(X) || !Number.isFinite(Y)) return null;
  for (let k = 0; k <= 9; k++) {
    const x = X / 10 ** k;
    const y = Y / 10 ** k;
    if (x >= -82 && x <= -68 && y >= -19 && y <= 0.5) return { x, y, shifted: k > 0 };
  }
  return null;
}

const C = {
  ORDEN: 0, SERV: 1, CENTRO: 2, MOD: 3, VRAEM: 4, COD: 5, UB: 6, DEP: 7, PROV: 8, DIST: 9,
  NOM: 10, DIR: 11, RESP: 12, TEL: 13, CANT: 14, TIPO: 15, X: 16, Y: 17,
  TELS: 18, INT: 19, LUZ: 20, AGUA: 21, DES: 22,
};

const stats = { verificada: 0, otroDistrito: 0, referencial: 0, sinCoordenadas: 0, reparadas: 0 };

/**
 * Servicios de alcance nacional que se atienden por teléfono o chat. Tienen
 * una dirección administrativa, pero nadie "va" a ellos: se dejan fuera del
 * ranking por cercanía para no presentarlos como el centro más próximo.
 */
const NO_PRESENCIAL = new Set(['Chat 100', 'Linea 100']);

const centros = data.map((r) => {
  const ub = clean(r[C.UB]).padStart(6, '0');
  const cd = catDist.get(ub);
  const ccdd = ub.slice(0, 2);
  const ccpp = ub.slice(0, 4);

  let lat = null, lon = null, calidad = 'sin_coordenadas';
  const rep = repairPair(r[C.X], r[C.Y]);
  if (rep) {
    lon = round(rep.x, 6);
    lat = round(rep.y, 6);
    if (rep.shifted) stats.reparadas++;
    const f = distByUb.get(ub);
    if (f && inGeom([lon, lat], f.g)) {
      calidad = 'verificada';
      stats.verificada++;
    } else {
      const hit = distFeats.find((ff) =>
        lon >= ff.bb[0] && lon <= ff.bb[2] && lat >= ff.bb[1] && lat <= ff.bb[3] && inGeom([lon, lat], ff.g));
      if (hit) { calidad = 'otro_distrito'; stats.otroDistrito++; } else { calidad = 'referencial'; stats.referencial++; }
    }
  } else {
    stats.sinCoordenadas++;
    // Sin punto exacto (p. ej. hogares de refugio, cuya dirección es
    // confidencial): se ubica en el centroide del distrito, sólo como
    // referencia visual. Se excluye del ranking por cercanía.
    const c = distCentroid.get(ub);
    if (c) { lon = round(c[0], 6); lat = round(c[1], 6); calidad = 'centroide_distrito'; }
  }

  return {
    id: Number(clean(r[C.ORDEN])),
    nombre: titleCase(clean(r[C.NOM])),
    tipo: clean(r[C.CENTRO]),
    servicio: clean(r[C.SERV]),
    modalidad: clean(r[C.MOD]) || null,
    codigo: clean(r[C.COD]) || null,
    ubigeo: ub,
    ccdd,
    ccpp,
    dep: cd ? cd.nombre_departamento : titleCase(clean(r[C.DEP])),
    prov: cd ? cd.nombre_provincia : titleCase(clean(r[C.PROV])),
    dist: cd ? cd.nombre : titleCase(clean(r[C.DIST])),
    ambito: clean(r[C.DEP]),   // etiqueta administrativa MIMP (Lima Metropolitana / Lima Provincias)
    direccion: clean(r[C.DIR]),
    responsable: clean(r[C.RESP]) || null,
    telefono: clean(r[C.TEL]) || null,
    vraem: yesNo(r[C.VRAEM]) === 1,
    presencial: !NO_PRESENCIAL.has(clean(r[C.CENTRO])),
    lat,
    lon,
    calidad,
    equip: {
      telefono: yesNo(r[C.TELS]),
      internet: yesNo(r[C.INT]),
      luz: yesNo(r[C.LUZ]),
      agua: yesNo(r[C.AGUA]),
      desague: yesNo(r[C.DES]),
    },
  };
});

console.log('  coordenadas → verificadas:', stats.verificada,
  '| otro distrito:', stats.otroDistrito,
  '| referencial:', stats.referencial,
  '| sin coord (centroide):', stats.sinCoordenadas,
  '| reparadas:', stats.reparadas);

/* --- catálogo territorial: sólo lugares que efectivamente tienen centros --- */
const depSet = new Map();
const provSet = new Map();
const distSet = new Map();
for (const c of centros) {
  depSet.set(c.ccdd, catDep.get(c.ccdd)?.nombre || c.dep);
  provSet.set(c.ccpp, { nombre: catProv.get(c.ccpp)?.nombre || c.prov, ccdd: c.ccdd });
  distSet.set(c.ubigeo, { nombre: c.dist, ccpp: c.ccpp, ccdd: c.ccdd });
}
const collator = new Intl.Collator('es');
const catalogo = {
  departamentos: [...depSet].map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => collator.compare(a.nombre, b.nombre)),
  provincias: [...provSet].map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => collator.compare(a.nombre, b.nombre)),
  distritos: [...distSet].map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => collator.compare(a.nombre, b.nombre)),
  tipos: [...new Set(centros.map((c) => c.tipo))].sort(collator.compare),
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'centros.json'), JSON.stringify({
  meta: {
    fuente: 'Directorio de Servicios del MIMP',
    generado: new Date().toISOString().slice(0, 10),
    total: centros.length,
    calidadCoordenadas: stats,
  },
  catalogo,
  centros,
}));
console.log('✓ app/data/centros.json', (fs.statSync(path.join(OUT, 'centros.json')).size / 1024).toFixed(0) + ' KB');

console.log('  (las capas geográficas las genera tools/build-geo.mjs)');
