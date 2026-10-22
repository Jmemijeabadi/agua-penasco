#!/usr/bin/env node
// Genera js/mapa-base.js: el mapa de fondo (mar, costa, esteros, calles, vía del tren, pista y
// nombres) que la app dibuja ella misma. Así no depende de ningún servidor de mosaicos, que puede
// bloquear, pedir clave o cobrar, y el mapa funciona incluso abriendo index.html con doble clic.
//
// Uso:
//   node herramientas/generar-mapa-base.js              usa lo que ya esté en datos/ (descarga lo que falte)
//   node herramientas/generar-mapa-base.js --descargar  vuelve a descargar costa, agua, carreteras y lugares
//
// Datos: © colaboradores de OpenStreetMap, licencia ODbL.

const fs = require('fs');
const path = require('path');
const { cargarOsm } = require('./osm');

const RAIZ = path.join(__dirname, '..');
const DATOS = path.join(RAIZ, 'datos');
const SALIDA = path.join(RAIZ, 'js', 'mapa-base.js');

// Área que cubre el mapa de fondo: sur, oeste, norte, este. Se exporta en MAPA_BASE.recuadro y
// js/mapa.js no deja mover ni alejar el mapa fuera de ella (afuera no habría mar dibujado).
const RECUADRO = [31.20, -113.80, 31.47, -113.31];
const B = RECUADRO.join(',');
const CONSULTA_BASE = `[out:json][timeout:200];(way["natural"="coastline"](${B});way["natural"~"^(water|wetland|beach|bay)$"](${B});relation["natural"~"^(water|wetland|bay)$"](${B});way["highway"~"^(motorway|trunk|primary|secondary)$"](${B});way["railway"="rail"](${B});way["aeroway"~"^(runway|aerodrome)$"](${B}););out body geom qt;`;
const CONSULTA_LUGARES = `[out:json][timeout:120];(nwr["natural"~"^(peak|cape|bay|beach|wetland)$"]["name"](${B});nwr["place"~"^(island|islet|sea)$"]["name"](${B});nwr["aeroway"="aerodrome"]["name"](${B});nwr["tourism"~"^(attraction|viewpoint)$"]["name"](${B});nwr["leisure"~"^(marina|stadium)$"]["name"](${B}););out tags center qt;`;

// Cuánto se puede mover una línea al simplificarla, en metros (menos puntos = archivo más ligero).
const TOLERANCIA = { calle: 1.5, via: 2, costa: 4, agua: 3, tren: 3 };
// Un punto que sabemos que es mar y uno que es tierra, para comprobar el polígono del mar.
const PUNTO_MAR = [31.24, -113.60];
const PUNTO_TIERRA = [31.33, -113.53];
const ETIQUETA_MAR = { texto: 'Mar de Cortés', punto: [31.255, -113.585] };

// Clase de cada calle en el mapa y desde qué zoom se ve su nombre.
const CLASE = {
  motorway: 'principales', trunk: 'principales', primary: 'principales',
  secondary: 'secundarias', tertiary: 'secundarias',
  residential: 'locales', unclassified: 'locales', living_street: 'locales', road: 'locales',
};
// Varias pasadas por clase: al acercar se agregan más nombres (cada vez más juntos) para que
// siempre haya nombres en pantalla.
const NOMBRE = {
  principales: [{ zoom: 14, cada: 1600, minimo: 150 }, { zoom: 16, cada: 600, minimo: 100 }, { zoom: 17.5, cada: 300, minimo: 60 }],
  secundarias: [{ zoom: 15, cada: 1000, minimo: 120 }, { zoom: 16.5, cada: 450, minimo: 80 }, { zoom: 17.5, cada: 250, minimo: 50 }],
  locales: [{ zoom: 17, cada: 500, minimo: 70 }, { zoom: 17.5, cada: 250, minimo: 50 }],
};

// --- Geometría en metros (misma proyección local que herramientas/generar-zonas.js)

const LAT0 = 31.33, LNG0 = -113.55;
const M_LAT = 110574, M_LNG = 111320 * Math.cos(LAT0 * Math.PI / 180);
const aMetros = (lat, lng) => [(lng - LNG0) * M_LNG, (lat - LAT0) * M_LAT];
const aLatLng = ([x, y]) => [LAT0 + y / M_LAT, LNG0 + x / M_LNG];
const geom = g => g.map(p => aMetros(p.lat, p.lon));
const iguales = (a, b) => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;

const [MIN_X, MIN_Y] = aMetros(RECUADRO[0], RECUADRO[1]);
const [MAX_X, MAX_Y] = aMetros(RECUADRO[2], RECUADRO[3]);
const ANCHO = MAX_X - MIN_X, ALTO = MAX_Y - MIN_Y, PERIMETRO = 2 * (ANCHO + ALTO);
const dentro = ([x, y]) => x >= MIN_X && x <= MAX_X && y >= MIN_Y && y <= MAX_Y;

function simplificar(puntos, tol) {
  if (puntos.length < 3) return puntos;
  const conservar = new Uint8Array(puntos.length);
  conservar[0] = conservar[puntos.length - 1] = 1;
  const pila = [[0, puntos.length - 1]];
  while (pila.length) {
    const [i, j] = pila.pop();
    const [ax, ay] = puntos[i], [bx, by] = puntos[j];
    const largo = Math.hypot(bx - ax, by - ay);
    let maxD = -1, k = -1;
    for (let m = i + 1; m < j; m++) {
      const [px, py] = puntos[m];
      // En un anillo cerrado los extremos coinciden: se mide contra ese punto, no contra una "línea" de largo cero.
      const d = largo < 1e-6 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / largo;
      if (d > maxD) { maxD = d; k = m; }
    }
    if (maxD > tol) { conservar[k] = 1; pila.push([i, k], [k, j]); }
  }
  const resultado = puntos.filter((_, i) => conservar[i]);
  // Un anillo cerrado muy chico (una roca, una escollera) no debe quedar aplastado en una línea.
  return iguales(puntos[0], puntos[puntos.length - 1]) && resultado.length < 4 ? puntos : resultado;
}

// Cada vía de OSM se simplifica una sola vez y se reutiliza: así la costa, el mar y los esteros
// que comparten una vía quedan con exactamente la misma orilla.
const viasSimples = new Map();
let idsCosta = new Set();
function viaSimple(id, geometria) {
  if (!viasSimples.has(id)) viasSimples.set(id, simplificar(geom(geometria), idsCosta.has(id) ? TOLERANCIA.costa : TOLERANCIA.agua));
  return viasSimples.get(id);
}

// Coordenadas en enteros de 1e-5 grados (~1 m), cada punto como diferencia con el anterior.
function codificar(puntos) {
  const salida = [];
  let pLat = 0, pLng = 0;
  for (const p of puntos) {
    const [lat, lng] = aLatLng(p);
    const iLat = Math.round(lat * 1e5), iLng = Math.round(lng * 1e5);
    salida.push(iLat - pLat, iLng - pLng);
    pLat = iLat; pLng = iLng;
  }
  return salida;
}

function largo(puntos) {
  let l = 0;
  for (let i = 1; i < puntos.length; i++) l += Math.hypot(puntos[i][0] - puntos[i - 1][0], puntos[i][1] - puntos[i - 1][1]);
  return l;
}

function dentroDePoligono([x, y], anillo) {
  let res = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) res = !res;
  }
  return res;
}

// Une tramos sueltos en anillos cerrados (para polígonos de agua hechos de varias vías).
function armarAnillos(tramos) {
  const pendientes = tramos.map(t => [...t]);
  const anillos = [];
  while (pendientes.length) {
    let anillo = pendientes.shift();
    let crecio = true;
    while (!iguales(anillo[0], anillo[anillo.length - 1]) && crecio) {
      crecio = false;
      const fin = anillo[anillo.length - 1];
      for (let i = 0; i < pendientes.length; i++) {
        const t = pendientes[i];
        if (iguales(t[0], fin)) anillo = anillo.concat(t.slice(1));
        else if (iguales(t[t.length - 1], fin)) anillo = anillo.concat([...t].reverse().slice(1));
        else continue;
        pendientes.splice(i, 1);
        crecio = true;
        break;
      }
    }
    if (iguales(anillo[0], anillo[anillo.length - 1]) && anillo.length >= 4) anillos.push(anillo);
  }
  return anillos;
}

// --- Costa → polígono del mar
// OpenStreetMap dibuja la costa con la tierra a la izquierda y el agua a la derecha. Se unen
// las vías en cadenas, se recortan al recuadro, y el mar se cierra caminando por el borde del
// recuadro en sentido horario desde cada salida hasta la siguiente entrada.

function cadenasDeCosta(vias) {
  const porInicio = new Map(vias.map(v => [v.nodes[0], v]));
  const finales = new Set(vias.map(v => v.nodes[v.nodes.length - 1]));
  const usadas = new Set();
  const seguir = primera => {
    const puntos = [];
    for (let v = primera; v && !usadas.has(v); v = porInicio.get(v.nodes[v.nodes.length - 1])) {
      usadas.add(v);
      const pts = viaSimple(v.id, v.geometry);
      puntos.push(...(puntos.length ? pts.slice(1) : pts));
    }
    return puntos;
  };
  const cadenas = vias.filter(v => !finales.has(v.nodes[0])).map(seguir);
  for (const v of vias) if (!usadas.has(v)) cadenas.push(seguir(v));
  return cadenas;
}

// Liang–Barsky: parte visible [t0, t1] del segmento p→q dentro del recuadro, o null.
function recortarSegmento(p, q) {
  let t0 = 0, t1 = 1;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  for (const [pp, qq] of [[-dx, p[0] - MIN_X], [dx, MAX_X - p[0]], [-dy, p[1] - MIN_Y], [dy, MAX_Y - p[1]]]) {
    if (pp === 0) { if (qq < 0) return null; continue; }
    const r = qq / pp;
    if (pp < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [t0, t1];
}
const interpolar = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

// Pedazos de una cadena dentro del recuadro, marcando si entran y salen por el borde.
function recortarCadena(puntos) {
  const tramos = [];
  let actual = null;
  for (let i = 1; i < puntos.length; i++) {
    const c = recortarSegmento(puntos[i - 1], puntos[i]);
    if (!c) continue;
    const [t0, t1] = c;
    if (!actual) actual = { puntos: [interpolar(puntos[i - 1], puntos[i], t0)], entra: t0 > 0 };
    actual.puntos.push(interpolar(puntos[i - 1], puntos[i], t1));
    if (t1 < 1) { actual.sale = true; tramos.push(actual); actual = null; }
  }
  if (actual) { actual.sale = false; tramos.push(actual); }
  return tramos;
}

// Posición a lo largo del borde del recuadro, en sentido horario desde la esquina noroeste.
function posicionEnBorde([x, y]) {
  const d = [Math.abs(y - MAX_Y), Math.abs(x - MAX_X), Math.abs(y - MIN_Y), Math.abs(x - MIN_X)];
  const lado = d.indexOf(Math.min(...d));
  if (lado === 0) return x - MIN_X;
  if (lado === 1) return ANCHO + (MAX_Y - y);
  if (lado === 2) return ANCHO + ALTO + (MAX_X - x);
  return 2 * ANCHO + ALTO + (y - MIN_Y);
}
const ESQUINAS = [[0, [MIN_X, MAX_Y]], [ANCHO, [MAX_X, MAX_Y]], [ANCHO + ALTO, [MAX_X, MIN_Y]], [2 * ANCHO + ALTO, [MIN_X, MIN_Y]]];

function poligonosDeMar(tramos) {
  const abiertos = tramos.filter(t => t.entra && t.sale);
  const pendientes = new Set(abiertos);
  const poligonos = [];
  const avance = (desde, hasta) => ((hasta - desde) % PERIMETRO + PERIMETRO) % PERIMETRO;
  while (pendientes.size) {
    const primero = pendientes.values().next().value;
    const anillo = [];
    let t = primero;
    for (let guardia = 0; guardia < 1000; guardia++) {
      pendientes.delete(t);
      anillo.push(...t.puntos);
      const salida = posicionEnBorde(t.puntos[t.puntos.length - 1]);
      let siguiente = null, distancia = Infinity;
      for (const u of abiertos) {
        if (u !== primero && !pendientes.has(u)) continue;
        const d = avance(salida, posicionEnBorde(u.puntos[0]));
        if (d < distancia) { distancia = d; siguiente = u; }
      }
      const esquinas = ESQUINAS.map(([s, p]) => [avance(salida, s), p]).filter(([d]) => d > 0 && d < distancia).sort((a, b) => a[0] - b[0]);
      anillo.push(...esquinas.map(([, p]) => p));
      if (siguiente === primero) break;
      t = siguiente;
    }
    anillo.push(anillo[0]);
    poligonos.push(anillo);
  }
  return poligonos;
}

const areaConSigno = anillo => anillo.reduce((s, p, i) => {
  const q = anillo[(i + 1) % anillo.length];
  return s + (p[0] * q[1] - q[0] * p[1]);
}, 0) / 2;

// --- Nombres de calles

function abreviar(nombre) {
  return nombre
    .replace(/^(Boulevard|Bulevar|Bulevard|Blvd\.?)\s+/i, 'Blvd. ')
    .replace(/^Avenida\s+/i, 'Av. ')
    .replace(/^Carretera\s+/i, 'Carr. ')
    .replace(/^Privada\s+/i, 'Priv. ')
    .replace(/^Calle\s+(?!\d+$)/i, '');
}

// Puntos para escribir el nombre a lo largo de una calle: uno cada `cada` metros, en el tramo
// recto más largo de cada pedazo, con el ángulo de ese tramo.
function puntosDeNombre(puntos, { cada, minimo }) {
  const total = largo(puntos);
  if (total < minimo) return [];
  const cuantos = Math.max(1, Math.floor(total / cada));
  const salida = [];
  let recorrido = 0, k = 0;
  const limites = Array.from({ length: cuantos }, (_, i) => (i + 1) * total / cuantos);
  let mejor = null;
  for (let i = 1; i < puntos.length; i++) {
    const [ax, ay] = puntos[i - 1], [bx, by] = puntos[i];
    const l = Math.hypot(bx - ax, by - ay);
    if (!mejor || l > mejor.l) mejor = { l, a: puntos[i - 1], b: puntos[i] };
    recorrido += l;
    if (recorrido >= limites[k] - 1e-6 || i === puntos.length - 1) {
      if (mejor.l >= minimo * 0.6) salida.push(mejor);
      mejor = null;
      k++;
    }
  }
  return salida.map(({ a, b }) => {
    let angulo = -Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
    if (angulo > 90) angulo -= 180;
    if (angulo < -90) angulo += 180;
    return { punto: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], angulo: Math.round(angulo) };
  });
}

// --- Principal

async function main() {
  const forzar = process.argv.includes('--descargar');
  const base = await cargarOsm(path.join(DATOS, 'osm-base.json'), CONSULTA_BASE, forzar);
  const lugares = await cargarOsm(path.join(DATOS, 'osm-lugares.json'), CONSULTA_LUGARES, forzar);
  const calles = JSON.parse(fs.readFileSync(path.join(DATOS, 'osm-calles.json'), 'utf8'));
  const elementos = base.elements;
  const tag = (e, k) => e.tags && e.tags[k];

  // Mar, islas y línea de costa
  const viasCosta = elementos.filter(e => e.type === 'way' && tag(e, 'natural') === 'coastline');
  idsCosta = new Set(viasCosta.map(v => v.id));
  const cadenas = cadenasDeCosta(viasCosta);
  const tramosCosta = [];
  const islas = [];
  for (const c of cadenas) {
    const cerrada = iguales(c[0], c[c.length - 1]);
    if (cerrada && c.every(dentro)) {
      // Anillo completo dentro del recuadro: con la tierra a la izquierda, gira en sentido antihorario.
      if (areaConSigno(c) > 0) islas.push(c);
      tramosCosta.push({ puntos: c, entra: false, sale: false });
      continue;
    }
    let cadena = c;
    if (cerrada) {
      // Un anillo que cruza el borde: empezar en un punto de afuera para cortarlo como cadena abierta.
      const i = c.findIndex(p => !dentro(p));
      cadena = c.slice(i, -1).concat(c.slice(0, i + 1));
    }
    tramosCosta.push(...recortarCadena(cadena));
  }
  const incompletos = tramosCosta.filter(t => (t.entra !== t.sale) || (!t.entra && !t.sale && !iguales(t.puntos[0], t.puntos[t.puntos.length - 1])));
  if (incompletos.length) console.warn(`  Aviso: ${incompletos.length} tramo(s) de costa terminan dentro del recuadro (costa incompleta en OSM).`);
  const mar = poligonosDeMar(tramosCosta);
  const enMar = p => mar.some(a => dentroDePoligono(aMetros(...p), a)) && !islas.some(a => dentroDePoligono(aMetros(...p), a));
  if (!enMar(PUNTO_MAR) || enMar(PUNTO_TIERRA)) {
    throw new Error('El polígono del mar salió al revés o incompleto; revisa la costa descargada.');
  }

  // Agua y esteros (vías cerradas y multipolígonos)
  const poligonosDe = valor => {
    const salida = [];
    for (const e of elementos) {
      if (tag(e, 'natural') !== valor) continue;
      if (e.type === 'way' && e.geometry && iguales(geom([e.geometry[0]])[0], geom([e.geometry[e.geometry.length - 1]])[0])) {
        salida.push([viaSimple(e.id, e.geometry)]);
      } else if (e.type === 'relation') {
        const miembros = rol => e.members.filter(m => m.type === 'way' && m.geometry && (m.role || 'outer') === rol).map(m => viaSimple(m.ref, m.geometry));
        const interiores = armarAnillos(miembros('inner'));
        for (const exterior of armarAnillos(miembros('outer'))) {
          salida.push([exterior, ...interiores.filter(h => dentroDePoligono(h[0], exterior))]);
        }
      }
    }
    return salida.filter(pol => pol[0].some(dentro));
  };

  // Calles: las del área urbana (todas las clases) más las carreteras del recuadro grande.
  const vistas = new Set();
  const clases = { principales: [], secundarias: [], locales: [] };
  const conNombre = [];
  for (const v of [...calles.elements, ...elementos.filter(e => tag(e, 'highway'))]) {
    if (vistas.has(v.id) || !v.geometry) continue;
    vistas.add(v.id);
    const clase = CLASE[v.tags.highway];
    if (!clase) continue;
    const puntos = geom(v.geometry);
    clases[clase].push(simplificar(puntos, clase === 'locales' ? TOLERANCIA.calle : TOLERANCIA.via));
    if (v.tags.name) conNombre.push({ nombre: abreviar(v.tags.name), clase, puntos });
  }

  // Nombres de calles, sin repetir el mismo nombre demasiado cerca. Cada pasada recorre todas las
  // calles antes de la siguiente, para que los nombres de lejos no cambien al agregar los de cerca.
  const nombres = [];
  const porTexto = new Map();
  for (let pasada = 0; pasada < 3; pasada++) {
    for (const { nombre, clase, puntos } of conNombre) {
      const cfg = NOMBRE[clase][pasada];
      if (!cfg) continue;
      const mismos = porTexto.get(nombre) || [];
      for (const { punto, angulo } of puntosDeNombre(puntos, cfg)) {
        if (mismos.some(n => Math.hypot(n.punto[0] - punto[0], n.punto[1] - punto[1]) < cfg.cada * 0.6)) continue;
        const etiqueta = { texto: nombre, punto, angulo, zoom: cfg.zoom };
        nombres.push(etiqueta);
        mismos.push(etiqueta);
      }
      porTexto.set(nombre, mismos);
    }
  }

  // Lugares con nombre que ayudan a ubicarse (cerros, esteros, aeropuerto…). Se omiten los que
  // repiten el nombre de una colonia (esa etiqueta ya la pone la app) y los que no orientan.
  const ventana = {};
  new Function('window', fs.readFileSync(path.join(RAIZ, 'js', 'colonias.js'), 'utf8'))(ventana);
  const normal = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nombresColonias = new Set(ventana.COLONIAS.map(c => normal(c.nombre)));
  const sirve = t => !nombresColonias.has(normal(t.name)) && !/^wayside (shrine|cross)$/i.test(t.name) &&
    (t.aeroway !== 'aerodrome' || t.iata || t.icao);
  const ZOOM_LUGAR = { peak: 13, cape: 13, bay: 12, beach: 14, wetland: 13, island: 13, islet: 14, sea: 11, aerodrome: 12, attraction: 15, viewpoint: 15, marina: 15, stadium: 15 };
  const listaLugares = [{ texto: ETIQUETA_MAR.texto, punto: aMetros(...ETIQUETA_MAR.punto), tipo: 'agua', zoom: 11 }];
  for (const e of lugares.elements) {
    const t = e.tags;
    const tipo = t.natural || t.place || t.aeroway || t.tourism || t.leisure;
    const c = e.center || (e.lat != null ? { lat: e.lat, lon: e.lon } : null);
    if (!c || !t.name || ZOOM_LUGAR[tipo] == null || !sirve(t)) continue;
    const punto = aMetros(c.lat, c.lon);
    if (!dentro(punto) || listaLugares.some(l => l.texto === t.name)) continue;
    const esAgua = ['bay', 'wetland', 'sea'].includes(tipo);
    listaLugares.push({ texto: t.name, punto, tipo: esAgua ? 'agua' : 'lugar', zoom: ZOOM_LUGAR[tipo] });
  }

  const cod = lista => lista.map(codificar);
  // Las vías ya vienen simplificadas (viaSimple): los anillos armados con ellas no se vuelven a simplificar.
  const codPol = lista => lista.map(pol => pol.map(codificar));
  const redondo = p => aLatLng(p).map(v => Math.round(v * 1e5) / 1e5);
  const mapaBase = {
    recuadro: [[RECUADRO[0], RECUADRO[1]], [RECUADRO[2], RECUADRO[3]]],
    mar: mar.map(codificar),
    islas: islas.map(codificar),
    costa: cod(tramosCosta.map(t => t.puntos)),
    agua: codPol(poligonosDe('water')),
    humedal: codPol(poligonosDe('wetland')),
    calles: { principales: cod(clases.principales), secundarias: cod(clases.secundarias), locales: cod(clases.locales) },
    tren: cod(elementos.filter(e => tag(e, 'railway') === 'rail').map(e => simplificar(geom(e.geometry), TOLERANCIA.tren))),
    // Solo pistas pavimentadas (las de tierra son de ultraligeros y confunden).
    pista: cod(elementos.filter(e => tag(e, 'aeroway') === 'runway' && !/dirt|ground|grass|unpaved|sand/.test(tag(e, 'surface') || ''))
      .map(e => simplificar(geom(e.geometry), TOLERANCIA.via))),
    nombres: nombres.map(n => [n.texto, ...redondo(n.punto), n.angulo, n.zoom]),
    lugares: listaLugares.map(l => [l.texto, ...redondo(l.punto), l.tipo, l.zoom]),
  };

  // Comprobar otra vez el mar ya simplificado y codificado, tal como lo leerá la app.
  const decodificar = cod => {
    const puntos = [];
    for (let i = 0, lat = 0, lng = 0; i < cod.length; i += 2) puntos.push(aMetros((lat += cod[i]) / 1e5, (lng += cod[i + 1]) / 1e5));
    return puntos;
  };
  const marFinal = mapaBase.mar.map(decodificar), islasFinal = mapaBase.islas.map(decodificar);
  const enMarFinal = p => marFinal.some(a => dentroDePoligono(aMetros(...p), a)) && !islasFinal.some(a => dentroDePoligono(aMetros(...p), a));
  if (!enMarFinal(PUNTO_MAR) || enMarFinal(PUNTO_TIERRA)) throw new Error('El mar quedó mal después de simplificarlo y codificarlo.');
  const aplastado = [...marFinal, ...islasFinal].findIndex(a => a.length < 4);
  if (aplastado >= 0) throw new Error(`El anillo ${aplastado} (mar o isla) quedó con menos de 4 puntos.`);

  const js = `// Generado por herramientas/generar-mapa-base.js. No editar a mano.
// Mapa de fondo dibujado con datos de © colaboradores de OpenStreetMap (ODbL).
// Líneas y anillos: enteros de 1e-5 grados, cada punto como diferencia con el anterior.
window.MAPA_BASE = ${JSON.stringify(mapaBase)};
`;
  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  fs.writeFileSync(SALIDA, js);
  const kb = n => (n / 1024).toFixed(0) + ' KB';
  console.log(`js/mapa-base.js: ${kb(js.length)}`);
  console.log(`  mar: ${mar.length} polígono(s), islas: ${islas.length}, costa: ${tramosCosta.length} tramo(s)`);
  console.log(`  agua: ${mapaBase.agua.length}, esteros: ${mapaBase.humedal.length}, tren: ${mapaBase.tren.length}, pista: ${mapaBase.pista.length}`);
  console.log(`  calles: ${Object.entries(clases).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
  console.log(`  nombres de calles: ${nombres.length}, lugares: ${listaLugares.map(l => l.texto).join(', ')}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
