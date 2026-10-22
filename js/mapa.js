// El mapa: hexágonos pintados según el estado de su colonia, nombres con íconos de estado
// y fugas reportadas con ubicación.
(function (AP) {
  const { iconoHtml, esc, plural, haceCuanto } = AP.util;
  const TIPOS = AP.TIPOS;

  // Más reportes (o más días sin agua) = color más intenso.
  const opacidadReportes = n => (n >= 7 ? 0.74 : n >= 4 ? 0.62 : n >= 2 ? 0.5 : 0.38);
  const ESCALA_DIAS = [[1, 2, 0.26], [3, 5, 0.44], [6, 10, 0.62], [11, null, 0.8]];
  const opacidadDias = n => ESCALA_DIAS.find(([, hasta]) => hasta == null || n <= hasta)[2];

  // El fondo lo dibuja js/fondo.js con datos de OpenStreetMap; las colonias y sus límites vienen
  // de SEPOMEX, el INE (cartografía electoral) y el INEGI (DENUE y Marco Geoestadístico).
  const ATRIBUCION = '&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a> · Colonias: SEPOMEX, INE, INEGI';

  // Si no cargó Leaflet (falta vendor/leaflet), el panel sigue funcionando y el mapa avisa.
  if (!window.L) {
    const nada = () => {};
    AP.mapa = {
      ESCALA_DIAS, opacidadReportes,
      iniciar: c => { c.textContent = 'No se pudo cargar el mapa.'; },
      zonasCambiaron: nada, pintar: nada, seleccionar: nada, elegirPunto: nada, marcador: nada, centrar: nada, ajustarTamano: nada,
    };
    return;
  }

  let mapa, lienzo;
  let etiquetas = [];   // { id, marcador, peso, celdas } para acomodar los nombres de colonia

  // Con dedo no hay "pasar el mouse": tocar una zona abre su ficha, y un globo se quedaría pegado.
  const conMouse = matchMedia('(hover: hover) and (pointer: fine)').matches;

  // Globo que no se sale por los lados del mapa.
  const Globo = L.Tooltip.extend({
    _setPosition(pos) {
      L.Tooltip.prototype._setPosition.call(this, pos);
      const el = this._container, p = L.DomUtil.getPosition(el);
      const x = this._map.layerPointToContainerPoint(p).x, ancho = this._map.getSize().x;
      const dx = Math.max(8 - x, Math.min(0, ancho - 8 - (x + el.offsetWidth)));
      if (dx) L.DomUtil.setPosition(el, p.add([dx, 0]));
    },
  });
  const globo = opciones => new Globo({ className: 'tip-colonia', direction: 'top', opacity: 1, ...opciones });
  let capaCeldas, capaBordes, capaResaltado, capaSeleccion, capaEtiquetas, capaFugas;
  let poligonos = [];
  let bordesPorColonia = new Map();
  let vista = null;
  let seleccion = null;
  let eligiendo = false;
  let colores = {};
  let opciones = {};

  const esOscuro = () => {
    const tema = document.documentElement.dataset.theme;
    return tema ? tema === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  };

  function leerColores() {
    const css = getComputedStyle(document.documentElement);
    const v = nombre => css.getPropertyValue(nombre).trim();
    colores = {
      sin_agua: v('--critico'), baja_presion: v('--alerta'), regreso: v('--regreso'),
      sinDatos: v('--sin-datos'), tinta: v('--tinta'), superficie: v('--superficie'),
    };
  }

  function estiloCelda(i) {
    const base = { stroke: true, color: colores.superficie, weight: 0.7, opacity: 0.9, fill: true };
    const neutro = { ...base, fillColor: colores.sinDatos, fillOpacity: 0.1 };
    const idx = AP.geo.asignacion[i];
    if (idx < 0) return { ...base, fillColor: colores.sinDatos, fillOpacity: 0.04 };
    const r = vista && vista.porColonia.get(AP.geo.colonias[idx].id);
    if (!r) return neutro;
    if (vista.modo === 'acumulado') {
      return r.diasSinAgua ? { ...base, fillColor: colores.sin_agua, fillOpacity: opacidadDias(r.diasSinAgua) } : neutro;
    }
    if (!r.estado) return neutro;
    return { ...base, fillColor: colores[r.estado], fillOpacity: opacidadReportes(r.intensidad) };
  }

  // Texto del globo al pasar el mouse por una zona.
  function textoZona(i) {
    const idx = AP.geo.asignacion[i];
    if (idx < 0) {
      return '<strong>Zona sin colonia asignada</strong><span class="detalle">Ubica las colonias que faltan en la pestaña «Acerca».</span>';
    }
    const c = AP.geo.colonias[idx];
    const r = vista && vista.porColonia.get(c.id);
    let linea;
    if (!r) linea = '<span class="detalle">Sin reportes en este periodo</span>';
    else if (vista.modo === 'acumulado') {
      linea = r.diasSinAgua
        ? `<span class="estado">${iconoHtml('i-sin-agua')} ${plural(r.diasSinAgua, 'día', 'días')} sin agua</span><span class="detalle">en los últimos ${vista.dias} días · ${plural(r.total, 'reporte', 'reportes')}</span>`
        : `<span class="detalle">${plural(r.total, 'reporte', 'reportes')}, ningún día sin agua</span>`;
    } else {
      const estado = r.estado ? `<span class="estado">${iconoHtml(TIPOS[r.estado].icono)} ${TIPOS[r.estado].corto}</span>` : '';
      linea = `${estado}<span class="detalle">${plural(r.total, 'reporte', 'reportes')} · el último ${haceCuanto(r.ultimo)}</span>`;
    }
    return `<strong>${esc(c.nombre)}</strong>${linea}<span class="detalle">Zona aproximada</span>`;
  }

  function construirZonas() {
    capaCeldas.clearLayers();
    poligonos = AP.geo.celdas.map(([q, r], i) => {
      const p = L.polygon(AP.geo.verticesCelda(q, r), { renderer: lienzo, ...estiloCelda(i) });
      if (conMouse) {
        p.bindTooltip(globo({ sticky: true, offset: [0, -10] }).setContent(() => textoZona(i)));
        p.on('mouseover', () => {
          const idx = AP.geo.asignacion[i];
          capaResaltado.setLatLngs(idx >= 0 ? bordesPorColonia.get(AP.geo.colonias[idx].id) || [] : []);
        });
        p.on('mouseout', () => capaResaltado.setLatLngs([]));
      }
      p.on('click', () => {
        const idx = AP.geo.asignacion[i];
        if (!eligiendo && idx >= 0) opciones.alElegirColonia(AP.geo.colonias[idx].id);
      });
      return p.addTo(capaCeldas);
    });
    bordesPorColonia = new Map([...AP.geo.celdasDe.keys()].map(id => [id, AP.geo.bordes(id)]));
    capaBordes.setLatLngs(AP.geo.bordes());
    // En un lienzo se dibuja en el orden en que se agregan las capas: las orillas van arriba de los hexágonos.
    capaBordes.bringToFront();
    capaResaltado.bringToFront();
    capaSeleccion.bringToFront();
  }

  function construirEtiquetas() {
    capaEtiquetas.clearLayers();
    etiquetas = [];
    for (const c of AP.geo.colonias) {
      const punto = AP.geo.puntoEtiqueta(c.id);
      if (!punto) continue;
      const r = vista && vista.porColonia.get(c.id);
      let iconos = '', extra = '', activa = false;
      if (r && vista.modo === 'acumulado') {
        if (r.diasSinAgua) { iconos = iconoHtml('i-sin-agua'); extra = ` · ${r.diasSinAgua} d`; activa = true; }
      } else if (r) {
        if (r.estado) { iconos = iconoHtml(TIPOS[r.estado].icono); activa = true; }
        if (r.conteo.agua_sucia) { extra += iconoHtml('i-sucia'); activa = true; }
        if (r.conteo.fuga) { extra += iconoHtml('i-fuga'); activa = true; }
      }
      const clase = 'etiqueta-colonia' + (activa ? '' : ' tranquila');
      const marcador = L.marker(punto, {
        icon: L.divIcon({ className: clase, html: `<span>${iconos}${esc(c.nombre)}${extra}</span>`, iconSize: null }),
        pane: 'colonias', interactive: false, keyboard: false,
      }).addTo(capaEtiquetas);
      // Entre nombres del mismo peso gana la colonia más afectada (el mismo orden que la lista y el ranking).
      const gravedad = !r ? 0 : vista.modo === 'acumulado' ? r.diasSinAgua
        : ({ sin_agua: 3, baja_presion: 2, regreso: 1 }[r.estado] || 0) * 1e6 + r.intensidad;
      etiquetas.push({ id: c.id, marcador, peso: iconos ? 2 : activa ? 1 : 0, gravedad, celdas: (AP.geo.celdasDe.get(c.id) || []).length });
    }
    acomodarEtiquetas();
  }

  // Si dos nombres de colonia chocan, se esconde el menos importante (la seleccionada y las que
  // tienen reportes van primero). Solo cambia con el zoom, no al mover el mapa.
  function acomodarEtiquetas() {
    if (!mapa || !etiquetas.length) return;
    const z = mapa.getZoom();
    const orden = [...etiquetas].sort((a, b) => (b.id === seleccion) - (a.id === seleccion) || b.peso - a.peso || b.gravedad - a.gravedad || b.celdas - a.celdas);
    const choca = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    // Fugas que se ven a este zoom (de lejos, las de una colonia con nombre las esconde el CSS).
    const fugas = [];
    capaFugas.eachLayer(f => {
      const el = f.getElement();
      if (!el || !el.offsetWidth) return;
      const q = mapa.project(f.getLatLng(), z);
      fugas.push([q.x - 15, q.y - 15, q.x + 15, q.y + 15]);
    });
    // Primero se miden todas (un solo cálculo de diseño) y luego se cambian.
    const medidas = orden.map(e => {
      const el = e.marcador.getElement();
      const span = el && el.firstChild;
      return { el, w: span ? span.offsetWidth : 0, h: span ? span.offsetHeight : 0, p: mapa.project(e.marcador.getLatLng(), z) };
    });
    const puestas = [];
    for (const { el, w, h, p } of medidas) {
      if (!el) continue;
      el.style.marginTop = '';
      if (!w) { el.style.visibility = ''; continue; }   // escondida por CSS a este zoom: no ocupa lugar
      const caja = [p.x - w / 2 - 2, p.y - h / 2 - 2, p.x + w / 2 + 2, p.y + h / 2 + 2];
      // Si el nombre cae sobre una fuga, se pasa abajo de ella (o arriba, si la fuga está más abajo):
      // no se mueve el marcador, que marca el lugar reportado.
      let dy = 0, dir = 0;
      for (let f; (f = fugas.find(o => choca([caja[0], caja[1] + dy, caja[2], caja[3] + dy], o)));) {
        if (!dir) dir = f[1] + f[3] <= 2 * p.y ? 1 : -1;
        dy = dir > 0 ? f[3] - caja[1] : f[1] - caja[3];
      }
      if (dy) { el.style.marginTop = dy + 'px'; caja[1] += dy; caja[3] += dy; }
      const tapada = puestas.some(o => choca(caja, o));
      el.style.visibility = tapada ? 'hidden' : '';
      if (!tapada) puestas.push(caja);
    }
  }

  function construirFugas() {
    capaFugas.clearLayers();
    for (const f of (vista && vista.fugas) || []) {
      L.marker([f.lat, f.lng], {
        icon: L.divIcon({
          className: 'marcador-fuga' + (f.colonia && AP.geo.puntoEtiqueta(f.colonia) ? ' en-etiqueta' : ''),
          html: `<span>${iconoHtml('i-fuga')}</span>`, iconSize: [26, 26], iconAnchor: [13, 13],
        }),
        keyboard: false,
      }).bindTooltip(globo({ offset: [0, -12] }).setContent(`<strong>Fuga reportada</strong><span class="detalle">${haceCuanto(f.t)}</span>`))
        .addTo(capaFugas);
    }
  }

  const aplicarTema = () => mapa.getContainer().classList.toggle('oscuro', esOscuro());

  function clasesZoom() {
    const z = mapa.getZoom();
    const c = mapa.getContainer().classList;
    c.toggle('zoom-bajo', z < 14);
    c.toggle('zoom-medio', z >= 14 && z < 15);
    c.toggle('zoom-alto', z >= 15);
  }

  AP.mapa = {
    ESCALA_DIAS,
    opacidadReportes,

    iniciar(contenedor, opts) {
      opciones = opts;
      leerColores();
      // Se puede mover alrededor de la ciudad, pero no más allá de lo que cubre el mapa de fondo
      // (afuera no hay mar dibujado y se vería "tierra" en el golfo).
      const zonas = L.latLngBounds(AP.geo.limites()).pad(0.6);
      const dibujado = window.MAPA_BASE ? L.latLngBounds(window.MAPA_BASE.recuadro) : zonas;
      const permitido = L.latLngBounds(
        [Math.max(zonas.getSouth(), dibujado.getSouth()), Math.max(zonas.getWest(), dibujado.getWest())],
        [Math.min(zonas.getNorth(), dibujado.getNorth()), Math.min(zonas.getEast(), dibujado.getEast())]);
      mapa = L.map(contenedor, {
        preferCanvas: true, minZoom: 11, maxZoom: 18, zoomSnap: 0.5,
        maxBounds: permitido, maxBoundsViscosity: 1, zoomControl: false,
      });
      L.control.zoom({ zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(mapa);
      contenedor.setAttribute('role', 'group');
      contenedor.setAttribute('aria-label', 'Mapa de reportes por colonia. Flechas para mover; más y menos para acercar o alejar.');
      lienzo = L.canvas({ padding: 0.3 });
      // Empieza en la ciudad; La Choya, Las Conchas y las orillas quedan a un arrastre.
      mapa.setView([31.318, -113.535], contenedor.clientWidth > 700 ? 13.5 : 13);
      // El zoom mínimo es el que hace caber la pantalla dentro del área permitida.
      const ajustarZoomMinimo = () => {
        mapa.options.minZoom = 0;   // getBoundsZoom respeta el mínimo actual: sin esto nunca vuelve a bajar
        mapa.setMinZoom(Math.max(11, mapa.getBoundsZoom(permitido, true)));
      };
      ajustarZoomMinimo();
      mapa.on('resize', ajustarZoomMinimo);
      mapa.attributionControl.addAttribution(ATRIBUCION);
      aplicarTema();
      AP.fondo.iniciar(mapa);
      // Nombres de colonia arriba de los de calles y debajo de las fugas; el panel ya los lista para el lector de pantalla.
      mapa.createPane('colonias').style.zIndex = 550;
      mapa.getPane('colonias').style.pointerEvents = 'none';
      mapa.getPane('colonias').setAttribute('aria-hidden', 'true');

      capaCeldas = L.featureGroup().addTo(mapa);
      capaBordes = L.polyline([], { renderer: lienzo, color: colores.tinta, weight: 1, opacity: 0.35, interactive: false }).addTo(mapa);
      capaResaltado = L.polyline([], { renderer: lienzo, color: colores.tinta, weight: 2.5, opacity: 0.85, interactive: false }).addTo(mapa);
      capaSeleccion = L.polyline([], { renderer: lienzo, color: colores.tinta, weight: 3.5, opacity: 1, interactive: false }).addTo(mapa);
      capaEtiquetas = L.layerGroup().addTo(mapa);
      capaFugas = L.layerGroup().addTo(mapa);

      mapa.on('zoomend', () => { clasesZoom(); acomodarEtiquetas(); });
      clasesZoom();
      mapa.on('click', e => { if (eligiendo) opciones.alTocarMapa(e.latlng); });

      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        leerColores();
        aplicarTema();
        AP.fondo.tema();
        [capaBordes, capaResaltado, capaSeleccion].forEach(c => c.setStyle({ color: colores.tinta }));
        AP.mapa.pintar(vista);
      });
      construirZonas();
    },

    // Las colonias cambiaron de lugar (o se ubicó una nueva): rehacer zonas y orillas.
    zonasCambiaron() {
      construirZonas();
      AP.mapa.pintar(vista);
      AP.mapa.seleccionar(seleccion);
    },

    pintar(nuevaVista) {
      vista = nuevaVista;
      if (!vista) return;
      poligonos.forEach((p, i) => p.setStyle(estiloCelda(i)));
      construirFugas();       // antes que los nombres, para que estos esquiven las fugas
      construirEtiquetas();
    },

    seleccionar(id, centrar) {
      seleccion = id;
      acomodarEtiquetas();
      capaSeleccion.setLatLngs(id ? bordesPorColonia.get(id) || [] : []);
      if (id && centrar) {
        const punto = AP.geo.puntoEtiqueta(id);
        if (punto) mapa.flyTo(punto, Math.max(mapa.getZoom(), 14.5), { duration: 0.6 });
      }
    },

    elegirPunto(activo) {
      eligiendo = activo;
      mapa.getContainer().parentElement.classList.toggle('mapa-eligiendo', activo);
    },

    // Para el marcador temporal al ubicar una colonia.
    marcador(latlng) {
      if (AP.mapa._marca) AP.mapa._marca.remove();
      if (!latlng) return;
      AP.mapa._marca = L.marker(latlng, {
        icon: L.divIcon({ className: 'marcador-nueva-colonia', html: '<span>+</span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
        interactive: false,
      }).addTo(mapa);
    },

    centrar: (latlng, zoom) => mapa.flyTo(latlng, zoom || 15, { duration: 0.6 }),
    ajustarTamano: () => mapa && mapa.invalidateSize(),
  };
})(window.AP);
