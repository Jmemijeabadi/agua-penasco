// El mapa de fondo: mar, costa, esteros, calles y nombres, dibujados por la app con los datos de
// js/mapa-base.js (OpenStreetMap). No se pide ninguna imagen a servidores externos, así que no hay
// bloqueos, claves ni límites de uso, y funciona abriendo index.html directamente.
(function (AP) {
  const { esc } = AP.util;
  const MB = window.MAPA_BASE;
  // Sin js/mapa-base.js el mapa se queda sin fondo, pero la app sigue funcionando.
  if (!MB) {
    AP.fondo = { iniciar: () => console.warn('Falta js/mapa-base.js: el mapa se muestra sin fondo.'), tema: () => {} };
    return;
  }

  // Grosor de [principales, secundarias, locales] hasta cada zoom (0 = no se dibujan).
  const GROSOR = [[12.5, [1.5, 0.8, 0]], [13.5, [2, 1.1, 0.5]], [14.5, [2.6, 1.6, 0.9]], [15.5, [3.6, 2.3, 1.3]], [16.5, [5, 3.3, 2]], [99, [7, 4.6, 3]]];
  // Más etiquetas que esto a la vez se vuelve ilegible (y lento en teléfonos viejos).
  const MAX_NOMBRES = 220;

  let mapa, capas, capaNombres, nombres;

  function decodificar(cod) {
    const puntos = [];
    let lat = 0, lng = 0;
    for (let i = 0; i < cod.length; i += 2) {
      lat += cod[i];
      lng += cod[i + 1];
      puntos.push([lat / 1e5, lng / 1e5]);
    }
    return puntos;
  }

  function colores() {
    const css = getComputedStyle(document.documentElement);
    const v = n => css.getPropertyValue(n).trim();
    return {
      tierra: v('--mapa-tierra'), mar: v('--mapa-mar'), costa: v('--mapa-costa'), estero: v('--mapa-estero'),
      calle: v('--mapa-calle'), calle2: v('--mapa-calle-2'), via: v('--mapa-via'), tren: v('--mapa-tren'),
    };
  }

  function aplicarEstilos() {
    const c = colores();
    const [principal, secundaria, local] = GROSOR.find(([hasta]) => mapa.getZoom() <= hasta)[1];
    capas.mar.setStyle({ fillColor: c.mar });
    capas.agua.setStyle({ fillColor: c.mar });
    capas.islas.setStyle({ fillColor: c.tierra });
    capas.humedal.setStyle({ fillColor: c.estero });
    capas.costa.setStyle({ color: c.costa });
    capas.secundarias.setStyle({ color: c.calle2, weight: secundaria });
    capas.principales.setStyle({ color: c.via, weight: principal });
    capas.tren.setStyle({ color: c.tren });
    capas.pista.setStyle({ color: c.calle2 });
    capas.locales.setStyle({ color: c.calle, weight: local || 1 });
    // De lejos las calles de colonia son puro ruido: se quitan (y al volver, quedan debajo de las demás).
    if (!local && mapa.hasLayer(capas.locales)) capas.locales.remove();
    if (local && !mapa.hasLayer(capas.locales)) capas.locales.addTo(mapa).bringToBack();
  }

  // Caja que ocupa una etiqueta en pantalla (aprox.), girada con la calle.
  function caja(e, p) {
    const ancho = e.letras * 6 + 8, alto = 14;
    const a = e.angulo * Math.PI / 180;
    const w = Math.abs(ancho * Math.cos(a)) + Math.abs(alto * Math.sin(a));
    const h = Math.abs(ancho * Math.sin(a)) + Math.abs(alto * Math.cos(a));
    return [p.x - w / 2, p.y - h / 2, p.x + w / 2, p.y + h / 2];
  }
  const chocan = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

  // Solo las etiquetas de lo que se ve, empezando por las más importantes y sin encimarse.
  function dibujarNombres() {
    const z = mapa.getZoom();
    const visible = mapa.getBounds().pad(0.15);
    capaNombres.clearLayers();
    const puestas = [];
    for (const e of nombres) {
      if (e.zoom > z + 0.01 || !visible.contains(e.punto)) continue;
      const c = caja(e, mapa.latLngToContainerPoint(e.punto));
      if (puestas.some(o => chocan(o, c))) continue;
      puestas.push(c);
      if (puestas.length > MAX_NOMBRES) break;
      L.marker(e.punto, { icon: e.icono, pane: 'nombres', interactive: false, keyboard: false }).addTo(capaNombres);
    }
  }

  AP.fondo = {
    iniciar(m) {
      mapa = m;
      mapa.getContainer().style.background = 'var(--mapa-tierra)';
      for (const [panel, z] of [['fondo-agua', 240], ['fondo-calles', 250], ['nombres', 450]]) {
        mapa.createPane(panel).style.zIndex = z;
        mapa.getPane(panel).style.pointerEvents = 'none';
      }
      // Los nombres de calles son decorativos: el lector de pantalla no tiene por qué leerlos.
      mapa.getPane('nombres').setAttribute('aria-hidden', 'true');
      const agua = L.canvas({ pane: 'fondo-agua', padding: 0.4 });
      const calles = L.canvas({ pane: 'fondo-calles', padding: 0.4 });
      const relleno = { stroke: false, fill: true, fillOpacity: 1, interactive: false };
      const linea = renderer => ({ renderer, interactive: false, lineCap: 'round', lineJoin: 'round' });
      // Un polígono por cada agua o estero: si dos se enciman, en un solo trazo se cancelarían.
      const poligonos = lista => L.featureGroup(lista.map(pol => L.polygon(pol.map(decodificar), { renderer: agua, ...relleno })));

      capas = {
        mar: L.polygon(MB.mar.map(a => [decodificar(a)]), { renderer: agua, ...relleno }),
        islas: L.polygon(MB.islas.map(a => [decodificar(a)]), { renderer: agua, ...relleno }),
        humedal: poligonos(MB.humedal),
        agua: poligonos(MB.agua),
        costa: L.polyline(MB.costa.map(decodificar), { ...linea(agua), weight: 1.2 }),
        locales: L.polyline(MB.calles.locales.map(decodificar), linea(calles)),
        secundarias: L.polyline(MB.calles.secundarias.map(decodificar), linea(calles)),
        principales: L.polyline(MB.calles.principales.map(decodificar), linea(calles)),
        tren: L.polyline(MB.tren.map(decodificar), { ...linea(calles), weight: 1.5, dashArray: '6 4', lineCap: 'butt' }),
        pista: L.polyline(MB.pista.map(decodificar), { ...linea(calles), weight: 6, lineCap: 'butt' }),
      };
      for (const capa of Object.values(capas)) capa.addTo(mapa);

      const icono = (clase, html) => L.divIcon({ className: clase, html, iconSize: null });
      nombres = [
        ...MB.lugares.map(([t, lat, lng, tipo, zoom]) => ({ punto: L.latLng(lat, lng), zoom, letras: t.length, angulo: 0, icono: icono('nombre-lugar ' + tipo, `<span>${esc(t)}</span>`) })),
        ...MB.nombres.map(([t, lat, lng, angulo, zoom]) => ({ punto: L.latLng(lat, lng), zoom, letras: t.length, angulo, icono: icono('nombre-calle', `<span style="--a:${angulo}deg">${esc(t)}</span>`) })),
      ].sort((a, b) => a.zoom - b.zoom);
      capaNombres = L.layerGroup().addTo(mapa);

      mapa.on('zoomend', aplicarEstilos);
      mapa.on('moveend', dibujarNombres);
      aplicarEstilos();
      dibujarNombres();
    },

    // Al cambiar entre modo claro y oscuro.
    tema: () => aplicarEstilos(),
  };
})(window.AP);
