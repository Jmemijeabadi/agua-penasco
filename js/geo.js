// Geometría del mapa: hexágonos de js/zonas.js y a qué colonia pertenece cada uno.
// js/zonas.js ya trae la colonia de los hexágonos que caen en un polígono de colonia (INE o INEGI)
// o donde los negocios del DENUE coinciden ('' = condominio, sin colonia). Los demás van a la
// colonia ubicada más cerca sin pasar de su radio (sin radio, como las agregadas en el editor, se
// toma un hexágono). Las zonas son aproximadas; para un punto exacto (GPS) se usan los polígonos.
(function (AP) {
  const Z = window.ZONAS;
  const [LAT0, LNG0] = Z.origen;
  const R = Z.radio;
  const M_LAT = 110574;
  const M_LNG = 111320 * Math.cos(LAT0 * Math.PI / 180);

  const aMetros = (lat, lng) => [(lng - LNG0) * M_LNG, (lat - LAT0) * M_LAT];
  const aLatLng = (x, y) => [LAT0 + y / M_LAT, LNG0 + x / M_LNG];
  const centroCelda = (q, r) => [R * Math.sqrt(3) * (q + r / 2), R * 1.5 * r];

  function celdaDe(x, y) {
    const qf = (Math.sqrt(3) / 3 * x - y / 3) / R;
    const rf = (2 / 3 * y) / R;
    let q = Math.round(qf), r = Math.round(rf);
    const s = Math.round(-qf - rf);
    const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s + qf + rf);
    if (dq > dr && dq > ds) q = -r - s;
    else if (dr > ds) r = -q - s;
    return [q, r];
  }

  // Vértice k a 60k+30 grados; la arista k (del vértice k al k+1) colinda con este vecino.
  const VECINO_DE_ARISTA = [[0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1], [1, 0]];
  function vertice(q, r, k) {
    const [cx, cy] = centroCelda(q, r);
    const a = Math.PI / 180 * (60 * k + 30);
    return aLatLng(cx + R * Math.cos(a), cy + R * Math.sin(a));
  }
  const verticesCelda = (q, r) => [0, 1, 2, 3, 4, 5].map(k => vertice(q, r, k));

  const indiceCelda = new Map(Z.celdas.map(([q, r], i) => [q + ',' + r, i]));

  const geo = {
    celdas: Z.celdas,
    colonias: [],
    porId: new Map(),
    asignacion: [],        // índice de colonia por celda, o -1
    celdasDe: new Map(),   // id de colonia -> índices de sus celdas
    puntos: [],            // { i, xy } para saber la colonia de un punto fuera de la zona habitada
    verticesCelda,
  };

  function dentroDePoligono(x, y, anillo) {
    let dentro = false;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }
  // Polígonos de colonia (del más chico al más grande), en metros.
  const POLIGONOS = (Z.poligonos || []).map(([colonia, anillo]) => ({ colonia, anillo: anillo.map(([la, ln]) => aMetros(la, ln)) }));
  const CON_POLIGONO = new Set(Z.conPoligono || []);

  // Hexágonos de `conjunto` unidos a `inicio` por algún lado.
  function bloque(inicio, conjunto) {
    const vistas = new Set([inicio]), pila = [inicio];
    while (pila.length) {
      const [q, r] = Z.celdas[pila.pop()];
      for (const [dq, dr] of VECINO_DE_ARISTA) {
        const j = indiceCelda.get((q + dq) + ',' + (r + dr));
        if (j !== undefined && conjunto.has(j) && !vistas.has(j)) { vistas.add(j); pila.push(j); }
      }
    }
    return [...vistas];
  }

  // Recalcula a qué colonia pertenece cada hexágono. Se llama al inicio y al ubicar colonias.
  geo.recalcular = function (colonias) {
    geo.colonias = colonias;
    geo.porId = new Map(colonias.map(c => [c.id, c]));
    // Hasta dónde llega cada colonia al repartir por cercanía: su radio más un hexágono.
    const ubicadas = colonias.map((c, i) => ({
      i, xy: c.lat == null ? null : aMetros(c.lat, c.lng),
      alcance: (c.radio || Z.radio) + Z.radio,
    })).filter(c => c.xy);
    const indicePorId = new Map(colonias.map((c, i) => [c.id, i]));
    const sabida = votada => votada === '' ? -1 : votada ? indicePorId.get(AP.util.idDeNombre(votada)) : undefined;
    geo.asignacion = Z.celdas.map(([q, r, votada]) => {
      const fija = sabida(votada);
      if (fija !== undefined) return fija;
      const [x, y] = centroCelda(q, r);
      let mejor = Infinity, idx = -1;
      for (const c of ubicadas) {
        const d = Math.hypot(c.xy[0] - x, c.xy[1] - y);
        if (d <= c.alcance && d < mejor) { mejor = d; idx = c.i; }
      }
      return idx;
    });

    // El hexágono donde cae el punto de una colonia ubicada es de esa colonia, aunque los negocios
    // voten por otra: así los fraccionamientos chicos tienen zona, y ubicar una colonia la pone
    // justo donde se tocó. Dos excepciones:
    //  - un fraccionamiento sin polígono propio que el INE dibuja dentro de otra colonia (Conjunto
    //    Ballenas, San Jorge) no le quita ese hexágono, salvo que se haya ubicado a mano;
    //  - una colonia con zona propia no gana un hexágono suelto lejos de ella.
    const tieneFijas = new Set();
    for (const [, , votada] of Z.celdas) { const i = sabida(votada); if (i >= 0) tieneFijas.add(i); }
    const delPunto = new Map();   // índice de celda -> { i, d }
    for (const c of ubicadas) {
      const [q, r] = celdaDe(c.xy[0], c.xy[1]);
      const k = indiceCelda.get(q + ',' + r);
      if (k === undefined) continue;
      const col = colonias[c.i], fijaA = sabida(Z.celdas[k][2]);
      if (!CON_POLIGONO.has(col.nombre) && !col.movida && !col.nueva && fijaA !== undefined && fijaA !== c.i) continue;
      const propia = j => j !== undefined && sabida(Z.celdas[j][2]) === c.i;
      if (tieneFijas.has(c.i) && !propia(k) && !VECINO_DE_ARISTA.some(([dq, dr]) => propia(indiceCelda.get((q + dq) + ',' + (r + dr))))) continue;
      const [cx, cy] = centroCelda(q, r);
      const d = Math.hypot(c.xy[0] - cx, c.xy[1] - cy);
      if (!delPunto.has(k) || d < delPunto.get(k).d) delPunto.set(k, { i: c.i, d });
    }
    for (const [k, { i }] of delPunto) geo.asignacion[k] = i;
    geo.celdasDelPunto = new Set(delPunto.keys());
    geo.tieneZonaFija = id => tieneFijas.has(indicePorId.get(id));

    // Un hexágono sin voto rodeado (4 o más de sus 6 vecinos) por una misma colonia pasa a ella:
    // así no quedan islas sueltas ni huecos dentro de las zonas votadas.
    const fija = k => delPunto.has(k) || sabida(Z.celdas[k][2]) !== undefined;
    for (let pasada = 0; pasada < 2; pasada++) {
      geo.asignacion = geo.asignacion.map((propia, k) => {
        if (fija(k)) return propia;
        const [q, r] = Z.celdas[k];
        const cuenta = new Map();
        for (const [dq, dr] of VECINO_DE_ARISTA) {
          const j = indiceCelda.get((q + dq) + ',' + (r + dr));
          const a = j === undefined ? -1 : geo.asignacion[j];
          if (a >= 0 && a !== propia) cuenta.set(a, (cuenta.get(a) || 0) + 1);
        }
        for (const [a, n] of cuenta) if (n >= 4) return a;
        return propia;
      });
    }

    // Para coloniaEn lejos de la zona habitada: las colonias ubicadas, con el mismo alcance.
    geo.puntos = ubicadas;

    geo.celdasDe = new Map();
    geo.asignacion.forEach((idx, i) => {
      if (idx < 0) return;
      const id = colonias[idx].id;
      if (!geo.celdasDe.has(id)) geo.celdasDe.set(id, []);
      geo.celdasDe.get(id).push(i);
    });
  };

  // Colonia en un punto (GPS o un toque en el mapa), en este orden:
  //  1. el hexágono del punto de una colonia es de esa colonia (fraccionamientos chicos);
  //  2. dentro de un polígono de colonia, esa colonia, aunque el hexágono sea de la vecina;
  //  3. en la zona habitada o junto a ella (a 1.5 radios del centro de un hexágono), la del hexágono;
  //  4. si no, la colonia ubicada más cercana sin pasar de su alcance, como los hexágonos.
  const idDe = idx => (idx >= 0 ? geo.colonias[idx].id : null);
  geo.coloniaEn = function (lat, lng) {
    const [x, y] = aMetros(lat, lng);
    const [q, r] = celdaDe(x, y);
    let k = indiceCelda.get(q + ',' + r);
    if (k !== undefined && geo.celdasDelPunto.has(k)) return idDe(geo.asignacion[k]);
    const p = POLIGONOS.find(p => dentroDePoligono(x, y, p.anillo));
    if (p) {
      const id = p.colonia && AP.util.idDeNombre(p.colonia);
      return id && geo.porId.has(id) ? id : null;
    }
    if (k === undefined) {
      let dk = 1.5 * R;
      for (const [dq, dr] of VECINO_DE_ARISTA) {
        const j = indiceCelda.get((q + dq) + ',' + (r + dr));
        if (j === undefined) continue;
        const [cx, cy] = centroCelda(q + dq, r + dr);
        const d = Math.hypot(cx - x, cy - y);
        if (d < dk) { dk = d; k = j; }
      }
    }
    if (k !== undefined) return idDe(geo.asignacion[k]);
    let mejor = Infinity, id = null;
    for (const c of geo.puntos) {
      const d = Math.hypot(c.xy[0] - x, c.xy[1] - y);
      if (d <= c.alcance && d < mejor) { mejor = d; id = geo.colonias[c.i].id; }
    }
    return id;
  };

  // Otra colonia cuyo punto cae en el mismo hexágono que (lat, lng), o null (para el editor).
  geo.puntoEnMismaCelda = function (lat, lng, exceptoId) {
    const k = indiceCelda.get(celdaDe(...aMetros(lat, lng)).join(','));
    if (k === undefined) return null;
    const otra = geo.colonias.find(c => c.id !== exceptoId && c.lat != null && indiceCelda.get(celdaDe(...aMetros(c.lat, c.lng)).join(',')) === k);
    return otra ? otra.id : null;
  };

  // Dónde poner el nombre de la colonia: en el bloque de hexágonos que contiene su punto (o en el
  // más grande, si no tiene punto), en el hexágono más cercano al promedio de ese bloque.
  geo.puntoEtiqueta = function (id) {
    const celdas = geo.celdasDe.get(id);
    const c = geo.porId.get(id);
    if (!celdas || !celdas.length) return c && c.lat != null ? [c.lat, c.lng] : null;
    const mias = new Set(celdas);
    const k0 = c && c.lat != null ? indiceCelda.get(celdaDe(...aMetros(c.lat, c.lng)).join(',')) : undefined;
    let propias;
    if (k0 !== undefined && mias.has(k0)) propias = bloque(k0, mias);
    else {
      const pendientes = new Set(celdas);
      propias = [];
      for (const k of celdas) {
        if (!pendientes.has(k)) continue;
        const b = bloque(k, mias);
        b.forEach(j => pendientes.delete(j));
        if (b.length > propias.length) propias = b;
      }
    }
    const centros = propias.map(i => centroCelda(...Z.celdas[i]));
    const mx = centros.reduce((s, p) => s + p[0], 0) / centros.length;
    const my = centros.reduce((s, p) => s + p[1], 0) / centros.length;
    let mejor = centros[0];
    for (const p of centros) {
      if (Math.hypot(p[0] - mx, p[1] - my) < Math.hypot(mejor[0] - mx, mejor[1] - my)) mejor = p;
    }
    // En polígonos con mucho terreno vacío (Bella Vista, Benito Juárez) el centro del bloque queda
    // lejos de donde vive la gente: entonces el nombre va en el hexágono del punto investigado.
    if (k0 !== undefined && mias.has(k0)) {
      const [px, py] = aMetros(c.lat, c.lng);
      if (Math.hypot(mejor[0] - px, mejor[1] - py) > 700) return aLatLng(...centroCelda(...Z.celdas[k0]));
    }
    return aLatLng(mejor[0], mejor[1]);
  };

  // Aristas donde termina una colonia (contra otra colonia o contra zona sin calles).
  // soloDe: limita a las orillas de una colonia (para resaltarla).
  geo.bordes = function (soloDe) {
    const segmentos = [];
    Z.celdas.forEach(([q, r], i) => {
      const propia = geo.asignacion[i];
      if (soloDe != null && (propia < 0 || geo.colonias[propia].id !== soloDe)) return;
      VECINO_DE_ARISTA.forEach(([dq, dr], k) => {
        const j = indiceCelda.get((q + dq) + ',' + (r + dr));
        const vecina = j === undefined ? null : geo.asignacion[j];
        const esOrilla = vecina === null || vecina !== propia;
        // Cada arista interna se ve desde dos celdas: se dibuja solo una vez.
        const repetida = soloDe == null && vecina !== null && j < i;
        if (esOrilla && !repetida) segmentos.push([vertice(q, r, k), vertice(q, r, (k + 1) % 6)]);
      });
    });
    return segmentos;
  };

  geo.limites = () => {
    const xs = Z.celdas.map(([q, r]) => centroCelda(q, r));
    const minX = Math.min(...xs.map(p => p[0])), maxX = Math.max(...xs.map(p => p[0]));
    const minY = Math.min(...xs.map(p => p[1])), maxY = Math.max(...xs.map(p => p[1]));
    return [aLatLng(minX, minY), aLatLng(maxX, maxY)];
  };

  AP.geo = geo;
})(window.AP);
