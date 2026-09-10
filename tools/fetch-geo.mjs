/**
 * Descarga la cartografía de referencia del repositorio Peru-maps a .cache/geo.
 * Los archivos ya descargados no se vuelven a pedir (borra .cache para forzarlo).
 *
 * Uso:  node tools/fetch-geo.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = path.join(ROOT, '.cache', 'geo');
const ORIGEN = 'https://raw.githubusercontent.com/Rodasluis/Peru-maps/main/salida';

const ARCHIVOS = [
  'ubigeos_2025.csv',
  'departamento_simplificado.geojson',
  'provincia_simplificado.geojson',
  'distrito_simplificado.geojson',
];

fs.mkdirSync(DESTINO, { recursive: true });

for (const nombre of ARCHIVOS) {
  const destino = path.join(DESTINO, nombre);
  if (fs.existsSync(destino) && fs.statSync(destino).size > 0) {
    console.log(`· ${nombre} ya está descargado (${(fs.statSync(destino).size / 1048576).toFixed(1)} MB)`);
    continue;
  }
  process.stdout.write(`↓ ${nombre} … `);
  const res = await fetch(`${ORIGEN}/${nombre}`);
  if (!res.ok) {
    console.log('ERROR');
    throw new Error(`No se pudo descargar ${nombre}: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destino, buf);
  console.log(`${(buf.length / 1048576).toFixed(1)} MB`);
}

console.log(`\n✓ Cartografía disponible en ${path.relative(ROOT, DESTINO)}`);
