/**
 * Extrae los iconos de «Icons para centros de atención.xlsx» y los asocia a los
 * tipos de centro del directorio.
 *
 * El .xlsx guarda las imágenes sueltas en xl/media y las coloca sobre la hoja
 * mediante anclajes (xl/drawings). La etiqueta de cada icono es, por tanto, el
 * texto de la columna A de la fila donde está anclada la imagen.
 *
 * Salida:
 *   app/assets/iconos/<slug>.png
 *   app/data/iconos.json   { tipo del directorio -> { archivo, color } }
 *
 * Requiere que app/data/centros.json ya exista (para cruzar los tipos).
 * Uso:  node tools/build-iconos.mjs
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const XLSX = path.join(ROOT, 'Icons para centros de atención.xlsx');
const DEST_IMG = path.join(ROOT, 'app', 'assets', 'iconos');
const DEST_JSON = path.join(ROOT, 'app', 'data', 'iconos.json');

const dec = (s) => s
  .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/* ------------------------------------------------------------------ *
 * 1. Leer el libro: etiquetas de la columna A + anclajes de imagen
 * ------------------------------------------------------------------ */
const tmp = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'iconos-'));
execFileSync('unzip', ['-o', '-q', XLSX, '-d', tmp]);

const shared = [...fs.readFileSync(path.join(tmp, 'xl/sharedStrings.xml'), 'utf8')
  .matchAll(/<si>([\s\S]*?)<\/si>/g)]
  .map((m) => {
    let t = '';
    for (const x of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += x[1];
    return dec(t);
  });

// Etiqueta por fila (columna A)
const etiquetaPorFila = new Map();
for (const m of fs.readFileSync(path.join(tmp, 'xl/worksheets/sheet1.xml'), 'utf8')
  .matchAll(/<c r="A(\d+)"[^>]*t="s"[^>]*><v>(\d+)<\/v>/g)) {
  etiquetaPorFila.set(Number(m[1]), shared[Number(m[2])]);
}

// Imagen por fila, a través de los anclajes del dibujo
const rels = Object.fromEntries(
  [...fs.readFileSync(path.join(tmp, 'xl/drawings/_rels/drawing1.xml.rels'), 'utf8')
    .matchAll(/Id="([^"]+)"[^>]*Target="\.\.\/([^"]+)"/g)].map((m) => [m[1], m[2]]),
);
const dibujo = fs.readFileSync(path.join(tmp, 'xl/drawings/drawing1.xml'), 'utf8');
const imagenPorFila = new Map();
for (const a of dibujo.matchAll(/<xdr:(oneCellAnchor|twoCellAnchor)[\s\S]*?<\/xdr:\1>/g)) {
  const from = a[0].match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
  const rid = a[0].match(/r:embed="([^"]+)"/);
  if (from && rid && rels[rid[1]]) imagenPorFila.set(Number(from[1]) + 1, rels[rid[1]]);
}

const catalogo = [];
for (const [fila, etiqueta] of [...etiquetaPorFila].sort((a, b) => a[0] - b[0])) {
  const img = imagenPorFila.get(fila);
  if (img && etiqueta) catalogo.push({ etiqueta, archivo: path.join(tmp, 'xl', img) });
}
console.log(`› ${catalogo.length} iconos encontrados en el libro`);

/* ------------------------------------------------------------------ *
 * 2. Color dominante de cada PNG (para el aro del marcador)
 * ------------------------------------------------------------------ */
/** Descodifica un PNG RGBA de 8 bits sin dependencias externas. */
function leerPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('no es un PNG');
  let pos = 8;
  let ancho = 0, alto = 0, prof = 0, tipoColor = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const tipo = buf.toString('ascii', pos + 4, pos + 8);
    const datos = buf.subarray(pos + 8, pos + 8 + len);
    if (tipo === 'IHDR') {
      ancho = datos.readUInt32BE(0); alto = datos.readUInt32BE(4);
      prof = datos[8]; tipoColor = datos[9];
    } else if (tipo === 'IDAT') idat.push(datos);
    else if (tipo === 'IEND') break;
    pos += 12 + len;
  }
  if (prof !== 8 || tipoColor !== 6) return null;   // sólo RGBA de 8 bits
  const bruto = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const linea = ancho * bpp;
  const px = Buffer.alloc(alto * linea);
  let o = 0;
  for (let y = 0; y < alto; y++) {
    const filtro = bruto[o++];
    const ini = y * linea;
    for (let x = 0; x < linea; x++) {
      const cru = bruto[o + x];
      const a = x >= bpp ? px[ini + x - bpp] : 0;          // izquierda
      const b = y > 0 ? px[ini - linea + x] : 0;           // arriba
      const c = (x >= bpp && y > 0) ? px[ini - linea + x - bpp] : 0;  // diagonal
      let v;
      switch (filtro) {
        case 0: v = cru; break;
        case 1: v = cru + a; break;
        case 2: v = cru + b; break;
        case 3: v = cru + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = cru + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error('filtro PNG desconocido: ' + filtro);
      }
      px[ini + x] = v & 0xff;
    }
    o += linea;
  }
  return { ancho, alto, px };
}

/**
 * Color más representativo: se agrupan los píxeles opacos en cubos de color,
 * se descartan los casi blancos y casi negros (contornos y fondos) y se toma
 * el promedio del cubo más poblado.
 */
function colorDominante(buf) {
  const img = leerPng(buf);
  if (!img) return '#8e1b60';
  const cubos = new Map();
  for (let i = 0; i < img.px.length; i += 4) {
    const [r, g, b, a] = [img.px[i], img.px[i + 1], img.px[i + 2], img.px[i + 3]];
    if (a < 200) continue;
    if (r > 235 && g > 235 && b > 235) continue;
    if (r < 30 && g < 30 && b < 30) continue;
    const k = `${r >> 4},${g >> 4},${b >> 4}`;
    if (!cubos.has(k)) cubos.set(k, { n: 0, r: 0, g: 0, b: 0 });
    const c = cubos.get(k);
    c.n++; c.r += r; c.g += g; c.b += b;
  }
  if (!cubos.size) return '#8e1b60';

  const medias = [...cubos.values()]
    .map((c) => ({ n: c.n, r: c.r / c.n, g: c.g / c.n, b: c.b / c.n }))
    .sort((a, b) => b.n - a.n);

  // El aro se dibuja sobre una chapa blanca, así que un tono demasiado claro
  // (el icono del SAU es casi todo crema) desaparecería: se prefiere el cubo
  // más oscuro con presencia suficiente y, si no lo hay, se oscurece el tono.
  const luz = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  let elegido = medias[0];
  if (luz(elegido) > 0.68) {
    const alternativos = medias.filter((c) => c.n >= medias[0].n * 0.15 && luz(c) <= 0.68);
    elegido = alternativos.sort((a, b) => luz(a) - luz(b))[0] || elegido;
  }
  while (luz(elegido) > 0.68) {
    elegido = { n: 1, r: elegido.r * 0.72, g: elegido.g * 0.72, b: elegido.b * 0.72 };
  }

  const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${hex(elegido.r)}${hex(elegido.g)}${hex(elegido.b)}`;
}

/* ------------------------------------------------------------------ *
 * 3. Cruzar las etiquetas del libro con los tipos del directorio
 * ------------------------------------------------------------------ */
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const dir = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/data/centros.json'), 'utf8'));
const tiposDirectorio = [...new Set(dir.centros.map((c) => c.tipo))];

/** Una etiqueta del libro puede cubrir varios tipos ("CAR Básico o CAR Especializado"). */
function tiposQueCubre(etiqueta) {
  const partes = etiqueta.split(/\s+o\s+/i).map((p) => p.trim()).filter(Boolean);
  const encontrados = new Set();
  for (const parte of partes) {
    const n = norm(parte);
    for (const tipo of tiposDirectorio) {
      const t = norm(tipo);
      // coincidencia exacta, o la etiqueta es la sigla final del tipo
      // ("CARPAM" ↔ "Centro de Atención Residencial … - CARPAM")
      if (t === n || t.endsWith(' ' + n) || n.endsWith(' ' + t)) encontrados.add(tipo);
    }
  }
  return [...encontrados];
}

const slug = (s) => norm(s).replace(/\s+/g, '-').slice(0, 48);

fs.mkdirSync(DEST_IMG, { recursive: true });
for (const f of fs.readdirSync(DEST_IMG)) fs.unlinkSync(path.join(DEST_IMG, f));

const mapa = {};
const sinCruzar = [];
for (const { etiqueta, archivo } of catalogo) {
  const tipos = tiposQueCubre(etiqueta);
  if (!tipos.length) { sinCruzar.push(etiqueta); continue; }
  const buf = fs.readFileSync(archivo);
  const nombre = `${slug(etiqueta)}.png`;
  fs.writeFileSync(path.join(DEST_IMG, nombre), buf);
  const color = colorDominante(buf);
  for (const tipo of tipos) mapa[tipo] = { archivo: nombre, color, etiqueta };
  console.log(`  ${color}  ${nombre.padEnd(46)} → ${tipos.join(' + ')}`);
}

if (sinCruzar.length) {
  console.log('\n⚠ etiquetas del libro sin tipo equivalente en el directorio:');
  sinCruzar.forEach((e) => console.log('   ·', e));
}

/* ------------------------------------------------------------------ *
 * 4. Marcador de respaldo para los tipos que el libro no cubre
 *
 * No se les pone un pin genérico común: cada uno recibe su propia sigla y
 * color, para que sigan distinguiéndose entre sí sobre el mapa.
 * ------------------------------------------------------------------ */
const VOCES_MENORES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'el', 'en', 'para', 'con']);

/** «Centro Comunal Familiar» → CCF · «SAIPD» → SAIPD · «Acercándonos» → ACE */
function sigla(tipo) {
  const trasGuion = tipo.match(/-\s*([A-ZÁÉÍÓÚÑ0-9+]{2,10})\s*$/);
  if (trasGuion) return trasGuion[1];
  const mayus = tipo.split(/\s+/).find((p) => /^[A-ZÁÉÍÓÚÑ]{3,10}$/.test(p));
  if (mayus) return mayus;
  const iniciales = tipo.split(/\s+/)
    .filter((p) => p.length > 2 && !VOCES_MENORES.has(p.toLowerCase()))
    .map((p) => p[0].toUpperCase()).join('');
  return iniciales.length >= 2 ? iniciales.slice(0, 4) : tipo.slice(0, 3).toUpperCase();
}

// Paleta de respaldo: tonos que no chocan con los de los iconos del libro.
const PALETA = ['#0f766e', '#7c3aed', '#b45309', '#0369a1', '#9d174d', '#4d7c0f', '#a21caf'];

const sinIcono = tiposDirectorio.filter((t) => !mapa[t]).sort();
console.log(`\n› tipos del directorio con icono propio: ${Object.keys(mapa).length}`);
if (sinIcono.length) {
  console.log(`› tipos sin icono en el libro → marcador con sigla y color propios: ${sinIcono.length}`);
  sinIcono.forEach((t, i) => {
    const s = sigla(t);
    const color = PALETA[i % PALETA.length];
    mapa[t] = { sigla: s, color, etiqueta: t };
    console.log(`   ${color}  ${s.padEnd(6)} ${t}`);
  });
}

fs.mkdirSync(path.dirname(DEST_JSON), { recursive: true });
fs.writeFileSync(DEST_JSON, JSON.stringify({
  fuente: 'Icons para centros de atención.xlsx',
  ruta: 'assets/iconos/',
  tipos: mapa,
}, null, 1));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n✓ app/data/iconos.json  ·  ${Object.keys(mapa).length} tipos mapeados`);
