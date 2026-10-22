#!/usr/bin/env node
// Genera js/zonas.js: la cuadrícula de hexágonos que cubre las zonas habitadas de Puerto Peñasco
// y, cuando se sabe, la colonia de cada uno. Un hexágono está habitado si tiene suficientes metros
// de calle (OpenStreetMap), varios negocios (DENUE de INEGI), cae dentro de una colonia del INE o
// junto al punto de una colonia sin polígono.
// La colonia de cada hexágono sale, en este orden, de:
//   1. el polígono de colonia del INE (o de localidad del INEGI) que contiene su centro, el más
//      chico si hay varios;
//   2. los negocios del DENUE, si casi todos declaran la misma colonia;
//   3. si no, la app lo asigna por cercanía al punto de cada colonia (js/colonias.js).
//
// Uso:
//   node herramientas/generar-zonas.js                     usa datos/osm-calles.json (lo descarga si falta)
//   node herramientas/generar-zonas.js --descargar-calles  vuelve a descargar las calles
//
// Usa también datos/ine-colonias.json (herramientas/descargar-ine.js), datos/inegi-localidades.json
// (herramientas/extraer-inegi-localidades.js), js/mapa-base.js (para no poner zonas en el mar), datos/denue-negocios.json
// (herramientas/extraer-denue.js), datos/denue-asentamientos.json (qué colonia oficial es cada nombre
// que escriben los negocios) y js/colonias.js.
//
// Calles: © colaboradores de OpenStreetMap, licencia ODbL. Negocios: INEGI, DENUE.
// Colonias: INE, Cartografía Electoral; INEGI, Marco Geoestadístico.

const fs = require('fs');
const path = require('path');
const { cargarOsm } = require('./osm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVO_CALLES = path.join(RAIZ, 'datos', 'osm-calles.json');
const ARCHIVO_DENUE = path.join(RAIZ, 'datos', 'denue-negocios.json');
const ARCHIVO_EQUIVALENCIAS = path.join(RAIZ, 'datos', 'denue-asentamientos.json');
const ARCHIVO_INE = path.join(RAIZ, 'datos', 'ine-colonias.json');
const ARCHIVO_INEGI = path.join(RAIZ, 'datos', 'inegi-localidades.json');
const ARCHIVO_MAPA_BASE = path.join(RAIZ, 'js', 'mapa-base.js');
const ARCHIVO_COLONIAS = path.join(RAIZ, 'js', 'colonias.js');
const SALIDA = path.join(RAIZ, 'js', 'zonas.js');

// Recuadro de la mancha urbana, de La Choya a Las Conchas: sur, oeste, norte, este.
const BBOX = [31.27, -113.66, 31.39, -113.44];
const RADIO_HEX = 160;            // metros del centro del hexágono a cada vértice
const MIN_CALLE_POR_CELDA = 180;  // metros de calle para considerar habitada una celda
const MAX_DIST_COLONIA = 1000;    // la app no asigna a una colonia celdas más lejanas que esto
const MIN_VOTOS = 3;              // negocios con colonia conocida para que un hexágono vote
const MAYORIA = 0.6;              // parte mínima de esos negocios que debe coincidir
const MAX_ALREDEDOR = 450;        // hasta dónde se agregan hexágonos alrededor de una colonia sin polígono

const CONSULTA_CALLES = `[out:json][timeout:180];
way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road)$"](${BBOX.join(',')});
out tags geom qt;`;

// Las carreteras de paso no cuentan para decidir si una zona está habitada,
// y las calles de servicio (estacionamientos, privadas) cuentan a medias.
const PESO_CALLE = {
  secondary: 1, tertiary: 1, unclassified: 1, residential: 1, living_street: 1, road: 1,
  service: 0.5, trunk: 0, primary: 0,
};

const cargarCalles = forzar => cargarOsm(ARCHIVO_CALLES, CONSULTA_CALLES, forzar);

// --- Geometría: proyección local en metros y hexágonos "punta arriba" en coordenadas axiales.
//     js/geo.js usa exactamente las mismas fórmulas.

const LAT0 = (BBOX[0] + BBOX[2]) / 2;
const LNG0 = (BBOX[1] + BBOX[3]) / 2;
const M_LAT = 110574;
const M_LNG = 111320 * Math.cos(LAT0 * Math.PI / 180);

const aMetros = (lat, lng) => [(lng - LNG0) * M_LNG, (lat - LAT0) * M_LAT];

function celdaDe(x, y) {
  const qf = (Math.sqrt(3) / 3 * x - y / 3) / RADIO_HEX;
  const rf = (2 / 3 * y) / RADIO_HEX;
  let q = Math.round(qf), r = Math.round(rf);
  const s = Math.round(-qf - rf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s + qf + rf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q, r];
}

const VECINOS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const centroCelda = (q, r) => [RADIO_HEX * Math.sqrt(3) * (q + r / 2), RADIO_HEX * 1.5 * r];

// Claves de los hexágonos cuyo centro cae en el rectángulo [minX, minY, maxX, maxY] (metros).
function celdasEnRecuadro(minX, minY, maxX, maxY) {
  const salida = [];
  const paso = RADIO_HEX * 1.5;
  for (let r = Math.floor(minY / paso) - 1; r <= Math.ceil(maxY / paso) + 1; r++) {
    const ancho = RADIO_HEX * Math.sqrt(3);
    for (let q = Math.floor(minX / ancho - r / 2) - 1; q <= Math.ceil(maxX / ancho - r / 2) + 1; q++) {
      const [x, y] = centroCelda(q, r);
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) salida.push([q, r, x, y]);
    }
  }
  return salida;
}

function dentroDePoligono(x, y, anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}
const area = anillo => Math.abs(anillo.reduce((s, p, i) => {
  const q = anillo[(i + 1) % anillo.length];
  return s + (p[0] * q[1] - q[0] * p[1]);
}, 0) / 2);

async function main() {
  const calles = await cargarCalles(process.argv.includes('--descargar-calles'));

  // 1. Metros de calle dentro de cada hexágono (muestreando cada segmento cada ~20 m).
  const metros = new Map();
  for (const via of calles.elements) {
    const peso = PESO_CALLE[via.tags && via.tags.highway] ?? 0;
    if (!peso || !via.geometry) continue;
    for (let i = 1; i < via.geometry.length; i++) {
      const [x1, y1] = aMetros(via.geometry[i - 1].lat, via.geometry[i - 1].lon);
      const [x2, y2] = aMetros(via.geometry[i].lat, via.geometry[i].lon);
      const largo = Math.hypot(x2 - x1, y2 - y1);
      const pasos = Math.max(1, Math.ceil(largo / 20));
      for (let k = 0; k < pasos; k++) {
        const t = (k + 0.5) / pasos;
        const clave = celdaDe(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t).join(',');
        metros.set(clave, (metros.get(clave) || 0) + peso * largo / pasos);
      }
    }
  }

  // 2. Celdas habitadas: suficiente calle, más huecos rellenados (parques, manzanas sin calles
  //    mapeadas) y sin celdas sueltas (un camino aislado en el desierto).
  let celdas = new Set([...metros].filter(([, m]) => m >= MIN_CALLE_POR_CELDA).map(([c]) => c));
  const vecinosEn = (clave, conjunto) => {
    const [q, r] = clave.split(',').map(Number);
    return VECINOS.filter(([dq, dr]) => conjunto.has(`${q + dq},${r + dr}`)).length;
  };
  for (let pasada = 0; pasada < 2; pasada++) {
    const candidatas = new Set();
    for (const c of celdas) {
      const [q, r] = c.split(',').map(Number);
      for (const [dq, dr] of VECINOS) candidatas.add(`${q + dq},${r + dr}`);
    }
    for (const c of candidatas) if (!celdas.has(c) && vecinosEn(c, celdas) >= 4) celdas.add(c);
  }
  celdas = new Set([...celdas].filter(c => vecinosEn(c, celdas) >= 2));

  // 3. Votos del DENUE: qué colonia declaran los negocios de cada hexágono.
  const votos = new Map();
  if (fs.existsSync(ARCHIVO_DENUE) && fs.existsSync(ARCHIVO_EQUIVALENCIAS)) {
    const denue = JSON.parse(fs.readFileSync(ARCHIVO_DENUE, 'utf8'));
    const equivale = JSON.parse(fs.readFileSync(ARCHIVO_EQUIVALENCIAS, 'utf8'));
    for (const [lat, lng, i] of denue.puntos) {
      const colonia = equivale[denue.nombres[i]];
      if (!colonia) continue;
      const clave = celdaDe(...aMetros(lat, lng)).join(',');
      const cuenta = votos.get(clave) || {};
      cuenta[colonia] = (cuenta[colonia] || 0) + 1;
      votos.set(clave, cuenta);
    }
    // Donde hay varios negocios hay gente, aunque OpenStreetMap no tenga esas calles.
    for (const [clave, cuenta] of votos) {
      if (Object.values(cuenta).reduce((a, b) => a + b, 0) >= MIN_VOTOS) celdas.add(clave);
    }
  } else {
    const falta = [ARCHIVO_DENUE, ARCHIVO_EQUIVALENCIAS].filter(a => !fs.existsSync(a)).map(a => path.relative(RAIZ, a)).join(' y ');
    console.warn(`  Falta ${falta}: todas las zonas se asignarán por cercanía.`);
  }
  // El mar: ni los polígonos ni los círculos de las colonias deben poner zonas sobre el agua.
  let enMar = () => false;
  if (fs.existsSync(ARCHIVO_MAPA_BASE)) {
    const v = {};
    new Function('window', fs.readFileSync(ARCHIVO_MAPA_BASE, 'utf8'))(v);
    const anillos = lista => lista.map(cod => {
      const puntos = [];
      for (let i = 0, lat = 0, lng = 0; i < cod.length; i += 2) puntos.push(aMetros((lat += cod[i]) / 1e5, (lng += cod[i + 1]) / 1e5));
      return puntos;
    });
    const mar = anillos(v.MAPA_BASE.mar), islas = anillos(v.MAPA_BASE.islas);
    enMar = (x, y) => mar.some(a => dentroDePoligono(x, y, a)) && !islas.some(a => dentroDePoligono(x, y, a));
  } else {
    console.warn('  Falta js/mapa-base.js: puede haber zonas sobre el mar.');
  }

  // 4. Colonias del INE y localidades del INEGI: un hexágono es de la colonia cuyo polígono contiene
  //    su centro (el más chico, si se enciman). Los de condominios quedan "sin colonia" a propósito ('').
  const poligonosIne = [];
  for (const archivo of [ARCHIVO_INE, ARCHIVO_INEGI]) {
    if (!fs.existsSync(archivo)) {
      console.warn(`  Falta ${path.relative(RAIZ, archivo)}: esas zonas no tendrán sus límites oficiales.`);
      continue;
    }
    for (const p of JSON.parse(fs.readFileSync(archivo, 'utf8')).poligonos) {
      for (const anillo of p.anillos) {
        const enMetros = anillo.map(([lat, lng]) => aMetros(lat, lng));
        poligonosIne.push({ colonia: p.colonia || '', anillo: enMetros, grados: anillo, area: area(enMetros) });
      }
    }
  }
  poligonosIne.sort((a, b) => a.area - b.area);
  // Toda colonia con polígono se ve completa, aunque OpenStreetMap no tenga todas sus calles.
  for (const p of poligonosIne) {
    if (!p.colonia) continue;
    const xs = p.anillo.map(v => v[0]), ys = p.anillo.map(v => v[1]);
    for (const [q, r, x, y] of celdasEnRecuadro(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))) {
      if (dentroDePoligono(x, y, p.anillo) && !enMar(x, y)) celdas.add(q + ',' + r);
    }
  }
  const coloniaIne = (q, r) => {
    const [x, y] = centroCelda(q, r);
    const p = poligonosIne.find(p => dentroDePoligono(x, y, p.anillo));
    return p ? p.colonia : null;
  };

  // 5. Las colonias sin polígono del INE (playas, orillas) también tienen hexágonos: el de su punto
  //    y los que quedan dentro de su radio (hasta MAX_ALREDEDOR).
  const ventana = {};
  new Function('window', fs.readFileSync(ARCHIVO_COLONIAS, 'utf8'))(ventana);
  const conPoligono = new Set(poligonosIne.map(p => p.colonia).filter(Boolean));
  for (const c of ventana.COLONIAS) {
    if (c.lat == null || conPoligono.has(c.nombre)) continue;
    const [px, py] = aMetros(c.lat, c.lng);
    const alcance = Math.min(c.radio || RADIO_HEX, MAX_ALREDEDOR);
    celdas.add(celdaDe(px, py).join(','));
    for (const [q, r, x, y] of celdasEnRecuadro(px - alcance, py - alcance, px + alcance, py + alcance)) {
      if (Math.hypot(x - px, y - py) <= alcance && !enMar(x, y)) celdas.add(q + ',' + r);
    }
  }

  const ganadora = clave => {
    const cuenta = votos.get(clave);
    if (!cuenta) return null;
    const total = Object.values(cuenta).reduce((a, b) => a + b, 0);
    const [colonia, n] = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0];
    return total >= MIN_VOTOS && n / total >= MAYORIA ? colonia : null;
  };

  const origen = { ine: 0, condominio: 0, denue: 0, cercania: 0 };
  const lista = [...celdas].map(clave => {
    const [q, r] = clave.split(',').map(Number);
    const porIne = coloniaIne(q, r);
    if (porIne !== null) { origen[porIne ? 'ine' : 'condominio']++; return [q, r, porIne]; }
    const colonia = ganadora(clave);
    origen[colonia ? 'denue' : 'cercania']++;
    return colonia ? [q, r, colonia] : [q, r];
  }).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const zonas = {
    generado: new Date().toISOString().slice(0, 10),
    origen: [LAT0, LNG0],
    radio: RADIO_HEX,
    maxDistColonia: MAX_DIST_COLONIA,
    // Colonias con polígono propio (INE o INEGI): su zona viene de ahí y no de su punto.
    conPoligono: [...conPoligono].sort(),
    celdas: lista,
    // Los polígonos, del más chico al más grande, para saber la colonia exacta de un punto (GPS).
    poligonos: poligonosIne.map(p => [p.colonia, p.grados.map(([la, ln]) => [Math.round(la * 1e5) / 1e5, Math.round(ln * 1e5) / 1e5])]),
  };
  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  fs.writeFileSync(SALIDA, `// Generado por herramientas/generar-zonas.js. No editar a mano.
// Hexágonos [q, r, colonia?]. Calles: © colaboradores de OpenStreetMap (ODbL). La colonia sale del
// polígono del INE o de los negocios del DENUE (INEGI); '' = condominio, sin colonia; sin tercer
// valor = la app la asigna por cercanía.
window.ZONAS = ${JSON.stringify(zonas)};
`);
  console.log(`js/zonas.js: ${lista.length} hexágonos de ${RADIO_HEX} m. Colonia según: polígono del INE ${origen.ine}, ` +
    `negocios del DENUE ${origen.denue}, cercanía ${origen.cercania}; condominios sin colonia ${origen.condominio}.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
