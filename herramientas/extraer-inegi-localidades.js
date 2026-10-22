#!/usr/bin/env node
// Extrae del Marco Geoestadístico de INEGI los polígonos de las localidades que en la app son
// colonias y que no tienen polígono de colonia en el INE (Las Conchas, Bahía la Choya, Lomas
// Campestres, Islas del Mar), y los guarda en datos/inegi-localidades.json con el mismo formato que
// datos/ine-colonias.json. generar-zonas.js usa los dos.
//
// Uso:
//   1. Descargar el Marco Geoestadístico de Sonora (versión 2024, archivo 26_sonora.zip) desde
//      https://www.inegi.org.mx/temas/mg/ y descomprimirlo.
//   2. node herramientas/extraer-inegi-localidades.js <carpeta conjunto_de_datos>
//
// Fuente: INEGI, Marco Geoestadístico 2024 (capa de localidades, 26l).

const fs = require('fs');
const path = require('path');

const SALIDA = path.join(__dirname, '..', 'datos', 'inegi-localidades.json');

// Clave de localidad del INEGI → colonia de js/colonias.js.
const LOCALIDADES = {
  '260480090': 'Las Conchas',
  '260480004': 'Bahía la Choya',
  '260480250': 'Lomas Campestres',
  '260480268': 'Islas del Mar',
};

// --- Lectura mínima de shapefile (.shp con polígonos y .dbf con atributos)

function leerDbf(buf) {
  const n = buf.readUInt32LE(4), largoEncabezado = buf.readUInt16LE(8), largoFila = buf.readUInt16LE(10);
  const campos = [];
  for (let off = 32; buf[off] !== 0x0d; off += 32) {
    campos.push({ nombre: buf.toString('latin1', off, off + 11).replace(/\0.*$/, ''), largo: buf[off + 16] });
  }
  const filas = [];
  for (let i = 0; i < n; i++) {
    let p = largoEncabezado + i * largoFila + 1;
    const fila = {};
    for (const c of campos) { fila[c.nombre] = buf.toString('latin1', p, p + c.largo).trim(); p += c.largo; }
    filas.push(fila);
  }
  return filas;
}

function leerShp(buf) {
  const figuras = [];
  for (let off = 100; off < buf.length;) {
    const largo = buf.readInt32BE(off + 4) * 2;
    const tipo = buf.readInt32LE(off + 8);
    if (tipo === 5) {   // polígono
      const b = off + 8;
      const partes = buf.readInt32LE(b + 36), total = buf.readInt32LE(b + 40);
      const inicios = Array.from({ length: partes }, (_, i) => buf.readInt32LE(b + 44 + 4 * i));
      const base = b + 44 + 4 * partes;
      const puntos = Array.from({ length: total }, (_, i) => [buf.readDoubleLE(base + 16 * i), buf.readDoubleLE(base + 16 * i + 8)]);
      figuras.push(inicios.map((s, i) => puntos.slice(s, i + 1 < partes ? inicios[i + 1] : total)));
    } else figuras.push(null);
    off += 8 + largo;
  }
  return figuras;
}

// --- Cónica conforme de Lambert del INEGI (ITRF2008, elipsoide GRS80) a latitud y longitud

const A = 6378137, F_ = 1 / 298.257222101, E = Math.sqrt(2 * F_ - F_ * F_);
const rad = d => d * Math.PI / 180;
const m = p => Math.cos(p) / Math.sqrt(1 - E * E * Math.sin(p) ** 2);
const t = p => Math.tan(Math.PI / 4 - p / 2) / ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2);
const P1 = rad(17.5), P2 = rad(29.5), P0 = rad(12), L0 = rad(-102), FALSO_ESTE = 2500000;
const N = (Math.log(m(P1)) - Math.log(m(P2))) / (Math.log(t(P1)) - Math.log(t(P2)));
const FF = m(P1) / (N * t(P1) ** N);
const R0 = A * FF * t(P0) ** N;

function aLatLng(x, y) {
  const xp = x - FALSO_ESTE, yp = R0 - y;
  const r = Math.sign(N) * Math.hypot(xp, yp);
  const tt = (r / (A * FF)) ** (1 / N);
  const lam = Math.atan2(xp, yp) / N + L0;
  let phi = Math.PI / 2 - 2 * Math.atan(tt);
  for (let i = 0; i < 10; i++) phi = Math.PI / 2 - 2 * Math.atan(tt * ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2));
  return [Math.round(phi * 180 / Math.PI * 1e6) / 1e6, Math.round(lam * 180 / Math.PI * 1e6) / 1e6];
}

const carpeta = process.argv[2];
if (!carpeta) {
  console.error('Uso: node herramientas/extraer-inegi-localidades.js <carpeta conjunto_de_datos del Marco Geoestadístico>');
  process.exit(1);
}
const filas = leerDbf(fs.readFileSync(path.join(carpeta, '26l.dbf')));
const figuras = leerShp(fs.readFileSync(path.join(carpeta, '26l.shp')));
const poligonos = [];
filas.forEach((fila, i) => {
  const colonia = LOCALIDADES[fila.CVEGEO];
  if (!colonia || !figuras[i]) return;
  poligonos.push({ nombreInegi: `${fila.CVEGEO} ${colonia}`, colonia, anillos: figuras[i].map(anillo => anillo.map(([x, y]) => aLatLng(x, y))) });
});
fs.writeFileSync(SALIDA, JSON.stringify({ fuente: 'INEGI, Marco Geoestadístico 2024 (localidades)', poligonos }));
console.log(`datos/inegi-localidades.json: ${poligonos.map(p => `${p.colonia} (${p.anillos.reduce((s, a) => s + a.length, 0)} vértices)`).join(', ')}`);
const faltan = Object.values(LOCALIDADES).filter(c => !poligonos.some(p => p.colonia === c));
if (faltan.length) console.warn('  No se encontraron: ' + faltan.join(', '));
