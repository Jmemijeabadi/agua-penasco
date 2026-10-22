#!/usr/bin/env node
// Extrae del DENUE de INEGI (Directorio Estadístico Nacional de Unidades Económicas) la colonia que
// declara cada negocio de la zona urbana de Puerto Peñasco y su ubicación. generar-zonas.js usa estos
// puntos para trazar las zonas de cada colonia.
//
// Uso:
//   1. Descargar el DENUE de Sonora en CSV: https://www.inegi.org.mx/contenidos/masiva/denue/denue_26_csv.zip
//   2. Descomprimirlo y correr:
//      node herramientas/extraer-denue.js <ruta>/conjunto_de_datos/denue_inegi_26_.csv
//
// Fuente: INEGI, Directorio Estadístico Nacional de Unidades Económicas (términos de libre uso de INEGI).

const fs = require('fs');
const path = require('path');

const SALIDA = path.join(__dirname, '..', 'datos', 'denue-negocios.json');
const MUNICIPIO = '048';                          // Puerto Peñasco
const RECUADRO = [31.27, -113.66, 31.39, -113.44];  // el mismo de generar-zonas.js

function* filasCSV(texto) {
  let campo = '', fila = [], comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false; }
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo.replace(/\r$/, '')); yield fila; fila = []; campo = ''; }
    else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); yield fila; }
}

const archivo = process.argv[2];
if (!archivo) {
  console.error('Uso: node herramientas/extraer-denue.js <denue_inegi_26_.csv>');
  process.exit(1);
}
// El CSV del DENUE viene en Latin-1.
const texto = new TextDecoder('latin1').decode(fs.readFileSync(archivo));
let encabezado = null;
const nombres = [], indice = new Map(), puntos = [];
for (const f of filasCSV(texto)) {
  if (!encabezado) { encabezado = Object.fromEntries(f.map((k, i) => [k, i])); continue; }
  if (f[encabezado.cve_mun] !== MUNICIPIO) continue;
  const lat = +f[encabezado.latitud], lng = +f[encabezado.longitud];
  if (!(lat >= RECUADRO[0] && lat <= RECUADRO[2] && lng >= RECUADRO[1] && lng <= RECUADRO[3])) continue;
  // Solo el nombre: el tipo ("COLONIA", "CIUDAD", "PUERTO"…) suele venir mal capturado.
  const asentamiento = (f[encabezado.nomb_asent] || '').trim().replace(/\s+/g, ' ');
  if (!asentamiento) continue;
  if (!indice.has(asentamiento)) { indice.set(asentamiento, nombres.length); nombres.push(asentamiento); }
  puntos.push([Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5, indice.get(asentamiento)]);
}
fs.writeFileSync(SALIDA, JSON.stringify({ fuente: 'INEGI, DENUE (Sonora)', nombres, puntos }));
console.log(`datos/denue-negocios.json: ${puntos.length} negocios, ${nombres.length} nombres de asentamiento.`);
