#!/usr/bin/env node
// Descarga los límites de colonias de la cartografía electoral del INE (servicio WMS público, capa
// COLONIA) y los guarda en datos/ine-colonias.json con la colonia de js/colonias.js a la que
// corresponde cada uno. generar-zonas.js los usa para pintar las zonas con sus límites reales.
//
// Uso: node herramientas/descargar-ine.js
//
// Fuente: Instituto Nacional Electoral (INE), Cartografía Electoral.

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const SALIDA = path.join(RAIZ, 'datos', 'ine-colonias.json');

// Área pedida (oeste, sur, este, norte) y tamaño de la imagen: el servicio devuelve las coordenadas
// en píxeles de esa imagen (x de oeste a este, y de sur a norte) y aquí se pasan a grados.
const [OESTE, SUR, ESTE, NORTE] = [-113.72, 31.20, -113.30, 31.46];
const ANCHO = 3000, ALTO = 1860;
const URL = 'https://cartografia.ine.mx/wms/index?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=COLONIA&STYLES='
  + `&SRS=EPSG:4326&BBOX=${OESTE},${SUR},${ESTE},${NORTE}&WIDTH=${ANCHO}&HEIGHT=${ALTO}`
  + '&FORMAT=application/vnd.google-earth.kml%2Bxml';

// Nombres del INE que no son iguales al de js/colonias.js. null = sin colonia (condominios).
// Los subfraccionamientos van con la colonia que los rodea, según lo que declaran sus negocios.
const EQUIVALENCIAS = {
  'CENTRO': 'Puerto Peñasco Centro',
  'FERROCARRILERO': 'Ferrocarrilera',
  'LA DEPORTIVA': 'Deportiva',
  'RESIDENCIAL PROVIDENCIA': 'Residencial la Providencia',
  'INFONAVIT': 'José López Portillo',
  'LAS DUNAS I': 'San Rafael',
  'LAS DUNAS II': 'San Rafael',
  'VILLA BONITA': 'San Rafael',
  'CONDOMINIOS CORONADO': 'San Rafael',
  'RESIDENCIAL SAHUARO': 'Nueva Esperanza',
  'RESIDENCIAL MEDITERRANEO': 'Nueva Esperanza',
  'ESPACIOS GIVA': 'Nueva Esperanza',
  'RESIDENCIAL LOS AGAVES': 'Brisas Del Golfo',
  'VILLAS DE ALTAR II': 'Villas de Altar',
  'VILLAS DE ALTAR III': 'Villas de Altar',
  // El INE dibuja estas tres más grandes de lo que la gente las usa: dentro de sus polígonos casi
  // todos los negocios dicen ser de Oriente (242 de 251, 42 de 43 y 22 de 22 en el DENUE). Esas
  // zonas se pintan como Oriente; las tres colonias conservan su punto y se pueden reportar.
  'JOSEFA ORTIZ DE DOMINGUEZ': 'Oriente',
  'LA TERMOELECTRICA': 'Oriente',
  'EL CARCAMO': 'Oriente',
};

const normalizar = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function main() {
  const res = await fetch(URL, { headers: { 'User-Agent': 'aguapenasco/0.1 (mapa comunitario de reportes de agua)' }, signal: AbortSignal.timeout(120000) });
  const kml = await res.text();
  if (!res.ok || !kml.includes('<Placemark>')) throw new Error(`El INE respondió ${res.status} sin polígonos.`);

  const ventana = {};
  new Function('window', fs.readFileSync(path.join(RAIZ, 'js', 'colonias.js'), 'utf8'))(ventana);
  const porNombre = new Map(ventana.COLONIAS.map(c => [normalizar(c.nombre), c.nombre]));

  const poligonos = [], sinPareja = [];
  for (const pm of kml.split('<Placemark>').slice(1)) {
    const nombreIne = ((pm.match(/<name>([^<]*)<\/name>/) || [])[1] || '').trim();
    const anillos = [...pm.matchAll(/<LineString>\s*<coordinates>([\s\S]*?)<\/coordinates>/g)].map(m =>
      m[1].trim().split(/\s+/).map(t => t.split(',').map(Number)).map(([x, y]) => {
        // Por si algún día el servicio devuelve grados en vez de píxeles.
        const lng = x < 0 ? x : OESTE + x / ANCHO * (ESTE - OESTE);
        const lat = x < 0 ? y : SUR + y / ALTO * (NORTE - SUR);
        return [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6];
      }));
    if (!anillos.length) continue;
    let colonia = nombreIne in EQUIVALENCIAS ? EQUIVALENCIAS[nombreIne] : porNombre.get(normalizar(nombreIne)) || null;
    if (colonia === null && !nombreIne.startsWith('CONDOMINIOS') && !(nombreIne in EQUIVALENCIAS)) sinPareja.push(nombreIne);
    if (colonia && !porNombre.has(normalizar(colonia))) throw new Error(`"${colonia}" no está en js/colonias.js`);
    poligonos.push({ nombreIne, colonia, anillos });
  }
  fs.writeFileSync(SALIDA, JSON.stringify({ fuente: 'INE, Cartografía Electoral (capa COLONIA)', descargado: new Date().toISOString().slice(0, 10), poligonos }));
  const cubiertas = new Set(poligonos.map(p => p.colonia).filter(Boolean));
  console.log(`datos/ine-colonias.json: ${poligonos.length} polígonos, ${cubiertas.size} colonias de la lista.`);
  if (sinPareja.length) console.warn(`  Sin colonia en la lista (se dejan sin asignar): ${sinPareja.join(', ')}`);
  const faltan = ventana.COLONIAS.filter(c => !cubiertas.has(c.nombre)).map(c => c.nombre);
  console.log(`  Sin polígono de colonia del INE (usan el de localidad del INEGI, o punto y radio): ${faltan.join(', ')}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
