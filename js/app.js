// La pantalla: une el mapa, el panel de colonias, el historial, el formulario de reporte,
// la importación desde Facebook/WhatsApp y el editor de colonias.
(function (AP) {
  const {
    H, D, claveDia, inicioDia, sumarDias, ultimosDias, fmtDia, fmtFechaHora, haceCuanto,
    normalizar, idDeNombre, plural, el, icono, insignia, avisar,
  } = AP.util;
  const TIPOS = AP.TIPOS;
  const $ = id => document.getElementById(id);
  const esMovil = () => matchMedia('(max-width: 899px)').matches;

  const ui = {
    modo: 'ahora',        // 'ahora' | 'dia' | 'acumulado'
    dias: ultimosDias(30),
    dia: null,            // día elegido en "Día por día"
    seleccion: null,      // colonia abierta en el panel
    vista: null,
    reproduciendo: null,
    eligiendo: null,      // qué se está ubicando en el mapa: 'reporte' | 'ubicar' | 'nueva'
    ubicacionReporte: null,
    coloniaPorUbicar: null,
  };

  const ORDEN_ESTADO = { sin_agua: 0, baja_presion: 1, agua_sucia: 2, fuga: 3, regreso: 4 };
  const FUENTES = { app: 'App', facebook: 'Facebook', whatsapp: 'WhatsApp', demo: 'Ejemplo' };
  const nombreColonia = id => (AP.geo.porId.get(id) || { nombre: id }).nombre;
  // Una colonia está en el mapa si tiene punto o si los negocios del DENUE le dieron zona.
  const enMapa = c => c.lat != null || AP.geo.celdasDe.has(c.id);
  // "aprox": viene de las opciones "2 o 3 días" (2) y "Más de 3 días" (4) del formulario.
  const textoDesde = (n, aprox) => (n === 0 ? 'desde hoy' : n === 1 ? 'desde ayer'
    : aprox ? `desde hace ${n <= 2 ? '2 o 3' : 'más de 3'} días` : `desde hace ${n} días`);

  // ---------- Colonias: catálogo base + lo que se ubicó en este navegador ----------

  function catalogoColonias() {
    const cambios = AP.almacen.cambiosColonias();
    const lista = window.COLONIAS.map(c => {
      const id = idDeNombre(c.nombre);
      const u = cambios.ubicaciones[id];
      return { ...c, id, lat: u ? u[0] : c.lat, lng: u ? u[1] : c.lng, movida: !!u };
    });
    for (const n of cambios.nuevas) {
      const id = idDeNombre(n.nombre);
      if (!lista.some(c => c.id === id)) {
        lista.push({ nombre: n.nombre, tipo: 'Colonia', cp: null, lat: n.lat, lng: n.lng, alias: [], ubicacion: 'manual', id, nueva: true });
      }
    }
    return lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  function aplicarColonias() {
    resueltas = new Map();
    AP.geo.recalcular(catalogoColonias());
    AP.detector.prepararColonias(AP.geo.colonias);
    $('lista-nombres-colonias').replaceChildren(...AP.geo.colonias.map(c => el('option', { value: c.nombre })));
  }

  // Lo que la persona escribió en "¿En qué colonia?" → id del catálogo (o null).
  function resolverColonia(texto) {
    const n = normalizar(texto).replace(/^(colonia|col|fraccionamiento|fracc) /, '');
    if (!n) return null;
    const exacta = AP.geo.colonias.find(c => {
      const nombre = normalizar(c.nombre);
      return nombre === n || nombre.replace(/^(colonia|fraccionamiento|residencial) /, '') === n || (c.alias || []).includes(n);
    });
    if (exacta) return exacta.id;
    const parecidas = AP.detector.buscarColonias('colonia ' + texto);
    return parecidas.length === 1 ? parecidas[0] : null;
  }

  // Un reporte con la colonia escrita a mano se vuelve a buscar en el catálogo actual, por si después
  // se agregó esa colonia o un alias. No se reescribe: en una base compartida los reportes solo se agregan.
  let resueltas = new Map();
  function reportes_() {
    return AP.almacen.todos().map(r => {
      if (r.colonia || !r.coloniaTexto) return r;
      if (!resueltas.has(r.coloniaTexto)) resueltas.set(r.coloniaTexto, resolverColonia(r.coloniaTexto));
      const id = resueltas.get(r.coloniaTexto);
      return id ? { ...r, colonia: id } : r;
    });
  }

  // ---------- Pintar todo ----------

  function calcularVista() {
    const reportes = reportes_();
    if (ui.modo === 'dia') return AP.estado.delDia(reportes, ui.dia);
    if (ui.modo === 'acumulado') return AP.estado.acumulado(reportes, 30, Date.now());
    return AP.estado.ahora(reportes, Date.now());
  }

  function render() {
    ui.dias = ultimosDias(30);
    ui.vista = calcularVista();
    AP.mapa.pintar(ui.vista);
    pintarLeyenda();
    pintarCifras();
    pintarLista();
    if (ui.seleccion) pintarDetalle();
    if (!$('pestana-historial').hidden) pintarHistorial();
    $('aviso-ejemplo').hidden = !AP.almacen.hayEjemplos();
    pintarConexion();
  }

  // Avisos de la base compartida: sin señal, reportes por enviar, o no se pudo cargar.
  function pintarConexion() {
    const caja = $('aviso-conexion');
    if (AP.almacen.modo !== 'compartido') { caja.hidden = true; return; }
    const { error, pendientes } = AP.almacen.estado();
    const porEnviar = pendientes ? ` ${plural(pendientes, 'reporte tuyo se enviará', 'reportes tuyos se enviarán')} en cuanto haya conexión.` : '';
    const texto = error === 'sin-conexion' ? 'Sin conexión: estás viendo la última copia guardada.' + porEnviar
      : error === 'no-carga' ? 'No se pudieron cargar los reportes de los demás; se vuelve a intentar cada minuto.' + porEnviar
      : pendientes ? `Enviando ${plural(pendientes, 'reporte', 'reportes')}…` : '';
    caja.textContent = texto;
    caja.hidden = !texto;
  }

  function pintarLeyenda() {
    const filas = [];
    if (ui.modo === 'acumulado') {
      filas.push(el('div', { class: 'nota', style: 'margin:0' }, 'Días con reportes de “no hay agua”, últimos 30 días'));
      const escala = el('div', { class: 'escala' });
      for (const [, , opacidad] of AP.mapa.ESCALA_DIAS) {
        const s = el('span');
        s.style.opacity = opacidad;
        escala.append(s);
      }
      filas.push(escala, el('div', { class: 'escala-etiquetas' }, ...AP.mapa.ESCALA_DIAS.map(([d, h]) => el('span', {}, h ? `${d}–${h}` : `${d}+`))));
    } else {
      for (const t of ['sin_agua', 'baja_presion', 'regreso']) {
        const ins = insignia(t);
        ins.style.cssText = 'width:22px;height:22px;border-radius:6px';
        filas.push(el('div', { class: 'fila' }, ins, TIPOS[t].nombre));
      }
      filas.push(el('div', { class: 'nota' }, 'Más intenso = más reportes. ', icono('i-sucia'), ' agua sucia, ', icono('i-fuga'), ' fuga.'));
    }
    filas.push(el('div', { class: 'fila' }, el('span', { class: 'muestra sin-datos' }), 'Sin reportes (no quiere decir que haya agua)'));
    $('leyenda-contenido').replaceChildren(...filas);
  }

  function cifra(etiqueta, valor, iconoId, chico) {
    return el('div', { class: 'cifra' },
      el('div', { class: 'etiqueta' }, iconoId ? icono(iconoId) : null, etiqueta),
      el('div', { class: 'valor' + (chico ? ' chico' : '') }, valor));
  }

  function pintarCifras() {
    const v = ui.vista;
    const lista = [...v.porColonia.values()];
    const totalReportes = lista.reduce((s, r) => s + r.total, 0) + v.sinColonia.length;
    let tarjetas;
    if (v.modo === 'acumulado') {
      const afectadas = lista.filter(r => r.diasSinAgua > 0).length;
      const peor = Math.max(0, ...lista.map(r => r.diasSinAgua));
      tarjetas = [
        cifra('Colonias que se quedaron sin agua', afectadas, 'i-sin-agua'),
        cifra('Más días sin agua en una colonia', peor),
        cifra('Reportes en 30 días', totalReportes),
      ];
    } else {
      const cuantas = estado => lista.filter(r => r.estado === estado).length;
      tarjetas = [
        cifra('Colonias sin agua', cuantas('sin_agua'), 'i-sin-agua'),
        cifra('Con poca presión', cuantas('baja_presion'), 'i-poca'),
        cifra(ui.modo === 'dia' ? 'Reportes ese día' : 'Reportes en 24 h', totalReportes),
      ];
    }
    $('cifras').replaceChildren(...tarjetas);
    $('titulo-lista').textContent = ui.modo === 'ahora' ? 'Colonias con reportes en las últimas 24 h'
      : ui.modo === 'dia' ? `Colonias con reportes el ${fmtDia(ui.dia)}`
      : 'Colonias con reportes en los últimos 30 días';
  }

  function estadoParaLista(r) {
    if (ui.vista.modo === 'acumulado') return r.diasSinAgua ? 'sin_agua' : r.diasPoca ? 'baja_presion' : null;
    if (r.estado) return r.estado;
    return r.conteo.agua_sucia ? 'agua_sucia' : r.conteo.fuga ? 'fuga' : null;
  }

  function descripcionLista(r, c) {
    let texto;
    if (ui.vista.modo === 'acumulado') {
      const partes = [];
      if (r.diasSinAgua) partes.push(`${plural(r.diasSinAgua, 'día', 'días')} sin agua`);
      if (r.diasPoca) partes.push(`${plural(r.diasPoca, 'día', 'días')} con poca presión`);
      texto = partes.join(' · ') || 'Otros reportes';
    } else {
      const estado = estadoParaLista(r);
      texto = `${estado ? TIPOS[estado].corto : 'Reportes'} · el último ${haceCuanto(r.ultimo)}`;
    }
    if (c && !enMapa(c)) texto += ' · aún no ubicada en el mapa';
    return texto;
  }

  function pintarLista() {
    const v = ui.vista;
    const filtro = normalizar($('buscar-colonia').value);
    const pasa = c => !filtro || normalizar(c.nombre).includes(filtro) || (c.alias || []).some(a => normalizar(a).includes(filtro));
    const conReportes = [...v.porColonia.entries()]
      .map(([id, r]) => ({ c: AP.geo.porId.get(id) || { id, nombre: id }, r }))
      .filter(x => pasa(x.c))
      .sort((a, b) => {
        if (v.modo === 'acumulado') return b.r.diasSinAgua - a.r.diasSinAgua || b.r.total - a.r.total;
        const ea = ORDEN_ESTADO[estadoParaLista(a.r)] ?? 9, eb = ORDEN_ESTADO[estadoParaLista(b.r)] ?? 9;
        return ea - eb || b.r.intensidad - a.r.intensidad || b.r.ultimo - a.r.ultimo;
      });

    const items = conReportes.map(({ c, r }) => el('li', {},
      el('button', { type: 'button', 'aria-current': String(c.id === ui.seleccion), onclick: () => abrirColonia(c.id, true) },
        insignia(estadoParaLista(r)),
        el('span', {}, el('div', { class: 'nombre' }, c.nombre), el('div', { class: 'meta' }, descripcionLista(r, c))),
        el('span', { class: 'cuenta' }, String(r.total), el('small', {}, r.total === 1 ? 'reporte' : 'reportes')))));

    // Reportes con una colonia escrita a mano que no está en el catálogo.
    const aMano = new Map();
    for (const r of v.sinColonia) {
      const nombre = (r.coloniaTexto || 'Sin colonia').trim();
      aMano.set(nombre, (aMano.get(nombre) || 0) + 1);
    }
    for (const [nombre, n] of aMano) {
      if (!pasa({ nombre })) continue;
      items.push(el('li', {}, el('button', { type: 'button', disabled: true },
        insignia(null),
        el('span', {}, el('div', { class: 'nombre' }, `“${nombre}”`), el('div', { class: 'meta' }, 'No está en la lista de colonias (agrégala en «Acerca»)')),
        el('span', { class: 'cuenta' }, String(n), el('small', {}, n === 1 ? 'reporte' : 'reportes')))));
    }
    $('lista-colonias').replaceChildren(...(items.length ? items : [el('li', { class: 'vacio' },
      filtro ? 'Ninguna colonia con ese nombre tiene reportes en este periodo.' : 'Nadie ha reportado en este periodo.')]));

    const sinReportes = AP.geo.colonias.filter(c => !v.porColonia.has(c.id) && pasa(c));
    const caja = $('sin-reportes');
    caja.querySelector('summary').textContent = `${plural(sinReportes.length, 'colonia', 'colonias')} sin reportes en este periodo`;
    caja.querySelector('ul').replaceChildren(...sinReportes.map(c => el('li', {},
      el('button', { type: 'button', onclick: () => abrirColonia(c.id, true) }, c.nombre))));
    caja.hidden = !sinReportes.length;
  }

  // ---------- Detalle de una colonia ----------

  function abrirColonia(id, centrar) {
    ui.seleccion = id;
    AP.mapa.seleccionar(id, centrar);
    cambiarPestana('colonias');
    $('vista-lista').hidden = true;
    $('vista-detalle').hidden = false;
    pintarDetalle();
    // Desde el mapa, siempre; desde una lista, solo si el principio de la ficha quedó bajo las pestañas.
    const ficha = $('vista-detalle');
    if (esMovil() && (!centrar || ficha.getBoundingClientRect().top < document.querySelector('.pestanas').getBoundingClientRect().bottom)) {
      ficha.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function cerrarColonia() {
    ui.seleccion = null;
    AP.mapa.seleccionar(null);
    $('vista-detalle').hidden = true;
    $('vista-lista').hidden = false;
    pintarLista();
  }

  function pintarDetalle() {
    const c = AP.geo.porId.get(ui.seleccion);
    if (!c) { cerrarColonia(); return; }
    const ahora = Date.now();
    const todos = reportes_();
    const propios = todos.filter(r => r.colonia === c.id);
    const r24 = AP.estado.resumir(propios.filter(r => r.t > ahora - D));
    const diasSin = AP.estado.diasSinAgua(todos, c.id, ahora);
    const de30 = propios.filter(r => r.t >= inicioDia(ui.dias[0]));
    const ultimo = propios[propios.length - 1];

    let pastilla;
    if (r24.estado) {
      pastilla = el('span', { class: 'estado-pastilla ' + r24.estado }, icono(TIPOS[r24.estado].icono),
        TIPOS[r24.estado].corto + (r24.estado === 'sin_agua' && diasSin ? ` · ${plural(diasSin, 'día', 'días')}` : ''));
    } else {
      pastilla = el('span', { class: 'estado-pastilla' }, 'Sin reportes en las últimas 24 h');
    }
    const extras = ['agua_sucia', 'fuga'].filter(t => r24.conteo[t]).map(t =>
      el('span', { class: 'estado-pastilla' }, icono(TIPOS[t].icono), `${TIPOS[t].corto} (${r24.conteo[t]})`));

    const tira = el('div');
    AP.graficas.tiraColonia(tira, AP.estado.porDia(todos, ui.dias, c.id), irADia);

    const recientes = propios.slice(-8).reverse().map(r => el('li', {},
      insignia(r.tipo),
      el('div', {},
        el('div', { class: 'que' }, TIPOS[r.tipo].nombre),
        el('div', { class: 'cuando' }, [haceCuanto(r.t), fmtFechaHora(r.t), r.desdeDias != null ? textoDesde(r.desdeDias, r.desdeAprox) : null, FUENTES[r.fuente] || r.fuente, r.pendiente ? 'enviando…' : null].filter(Boolean).join(' · ')),
        r.comentario ? el('div', { class: 'comentario' }, r.comentario) : null)));

    const datos = [c.tipo, c.cp ? 'CP ' + c.cp : null].filter(Boolean).join(' · ');
    $('vista-detalle').replaceChildren(
      el('div', { class: 'detalle-cabeza' },
        el('button', { type: 'button', class: 'btn-texto volver', onclick: cerrarColonia }, icono('i-atras'), 'Todas las colonias'),
        el('h2', {}, c.nombre),
        el('div', { class: 'botones' }, pastilla, ...extras),
        el('p', { class: 'sub' }, datos + (enMapa(c) ? ' · Zona aproximada' : ' · Aún no está ubicada en el mapa'))),
      el('div', { class: 'cifras' },
        cifra('Días seguidos sin agua', diasSin || '—', 'i-sin-agua'),
        cifra('Reportes en 30 días', de30.length),
        cifra('Último reporte', ultimo ? haceCuanto(ultimo.t) : '—', null, true)),
      el('h3', {}, 'Últimos 30 días'),
      tira,
      el('div', { class: 'leyenda-linea' },
        ...['sin_agua', 'baja_presion', 'agua_sucia', 'regreso'].map(t => {
          const m = el('span', { class: 'muestra' });
          m.style.background = AP.graficas.COLOR[t];
          return el('span', {}, m, TIPOS[t].corto);
        }),
        el('span', {}, el('span', { class: 'muestra', style: 'background:var(--superficie-2)' }), 'Sin reportes')),
      el('h3', {}, 'Reportes recientes'),
      recientes.length ? el('ul', { class: 'reportes-recientes' }, recientes) : el('p', { class: 'vacio' }, 'Todavía nadie ha reportado en esta colonia.'),
      el('div', { class: 'botones' },
        el('button', { type: 'button', class: 'btn-primario', onclick: () => abrirReporte(c.id) }, icono('i-mas'), 'Reportar en esta colonia'),
        el('button', { type: 'button', class: 'btn-secundario', onclick: () => compartirColonia(c, r24, diasSin) }, icono('i-compartir'), 'Compartir por WhatsApp')),
    );
  }

  const enlaceApp = () => (location.protocol.startsWith('http') ? location.origin + location.pathname : '(aquí va el enlace de la app)');

  function compartirColonia(c, r24, diasSin) {
    let texto;
    if (r24.estado === 'sin_agua') {
      texto = `💧 ${c.nombre}: sin agua (${plural(r24.conteo.sin_agua, 'reporte', 'reportes')} en las últimas 24 h${diasSin > 1 ? `, ya van ${diasSin} días` : ''}).`;
    } else if (r24.estado) {
      texto = `💧 ${c.nombre}: ${TIPOS[r24.estado].corto.toLowerCase()} según los reportes de las últimas 24 h.`;
    } else {
      texto = `💧 ${c.nombre}: sin reportes de agua en las últimas 24 h.`;
    }
    texto += `\n¿En tu calle tampoco hay? Repórtalo aquí: ${enlaceApp()}`;
    window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank', 'noopener');
  }

  // ---------- Modos del mapa ----------

  function cambiarModo(modo) {
    detenerReproduccion();
    ui.modo = modo;
    if (modo === 'dia' && !ui.dia) ui.dia = ui.dias[ui.dias.length - 1];
    document.querySelectorAll('[data-modo]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.modo === modo)));
    $('barra-dia').hidden = modo !== 'dia';
    sincronizarControlDia();
    render();
  }

  function irADia(clave) {
    ui.dia = clave;
    if (ui.modo !== 'dia') cambiarModo('dia');
    else { sincronizarControlDia(); render(); }
    if (esMovil()) document.querySelector('.zona-mapa').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function sincronizarControlDia() {
    if (!ui.dia) return;
    const i = Math.max(0, ui.dias.indexOf(ui.dia));
    $('control-dia').value = i;
    $('etiqueta-dia').textContent = i === ui.dias.length - 1 ? 'Hoy' : fmtDia(ui.dia);
  }

  function reproducir() {
    if (ui.reproduciendo) { detenerReproduccion(); return; }
    let i = ui.dias.indexOf(ui.dia);
    if (i < 0 || i >= ui.dias.length - 1) i = 0;
    ui.dia = ui.dias[i];
    sincronizarControlDia();
    render();
    $('btn-reproducir').querySelector('use').setAttribute('href', '#i-pausa');
    $('btn-reproducir').setAttribute('aria-label', 'Pausar');
    ui.reproduciendo = setInterval(() => {
      const siguiente = ui.dias.indexOf(ui.dia) + 1;
      if (siguiente >= ui.dias.length) { detenerReproduccion(); return; }
      ui.dia = ui.dias[siguiente];
      sincronizarControlDia();
      render();
    }, 700);
  }

  function detenerReproduccion() {
    clearInterval(ui.reproduciendo);
    ui.reproduciendo = null;
    $('btn-reproducir').querySelector('use').setAttribute('href', '#i-play');
    $('btn-reproducir').setAttribute('aria-label', 'Reproducir los últimos 30 días');
  }

  // ---------- Pestañas ----------

  function cambiarPestana(nombre) {
    for (const tab of document.querySelectorAll('[role="tab"]')) {
      const activa = tab.id === 'tab-' + nombre;
      tab.setAttribute('aria-selected', String(activa));
      tab.tabIndex = activa ? 0 : -1;
      $(tab.getAttribute('aria-controls')).hidden = !activa;
    }
    if (nombre === 'historial') pintarHistorial();
    if (nombre === 'acerca') pintarEditorColonias();
  }

  // ---------- Historial ----------

  function pintarHistorial() {
    const todos = reportes_();
    const filas = AP.estado.porDia(todos, ui.dias);
    AP.graficas.barrasPorDia($('grafica-dias'), filas, { elegido: ui.modo === 'dia' ? ui.dia : null, alElegir: irADia });
    AP.graficas.tablaDias($('tabla-dias'), filas);
    const acumulado = AP.estado.acumulado(todos, 30, Date.now());
    const top = [...acumulado.porColonia.entries()]
      .filter(([, r]) => r.diasSinAgua > 0)
      .sort((a, b) => b[1].diasSinAgua - a[1].diasSinAgua)
      .slice(0, 8)
      .map(([id, r]) => ({ id, nombre: nombreColonia(id), valor: r.diasSinAgua }));
    AP.graficas.ranking($('ranking'), top, id => abrirColonia(id, true));
  }

  function textoResumen() {
    const v = AP.estado.ahora(reportes_(), Date.now());
    const grupos = { sin_agua: [], baja_presion: [], regreso: [], agua_sucia: [], fuga: [] };
    for (const [id, r] of v.porColonia) {
      if (r.estado) grupos[r.estado].push([nombreColonia(id), r.intensidad]);
      if (r.conteo.agua_sucia) grupos.agua_sucia.push([nombreColonia(id), r.conteo.agua_sucia]);
      if (r.conteo.fuga) grupos.fuga.push([nombreColonia(id), r.conteo.fuga]);
    }
    const linea = (emoji, titulo, lista, conCuenta) => (lista.length
      ? `${emoji} ${titulo}: ${lista.sort((a, b) => b[1] - a[1]).map(([n, k]) => (conCuenta ? `${n} (${k})` : n)).join(', ')}` : null);
    const lineas = [
      linea('🔴', 'Sin agua', grupos.sin_agua, true),
      linea('🟡', 'Poca presión', grupos.baja_presion, true),
      linea('🔵', 'Ya regresó', grupos.regreso, false),
      linea('🟤', 'Agua sucia', grupos.agua_sucia, false),
      linea('🔧', 'Fugas reportadas', grupos.fuga, false),
    ].filter(Boolean);
    return [
      '💧 Agua en Puerto Peñasco: reportes de vecinos',
      `Últimas 24 horas, al ${fmtFechaHora(Date.now())}`,
      '',
      ...(lineas.length ? lineas : ['Sin reportes en las últimas 24 horas.']),
      '',
      `¿En tu colonia tampoco hay? Repórtalo aquí: ${enlaceApp()}`,
      '(Números = cantidad de reportes. Herramienta comunitaria, no oficial.)',
    ].join('\n');
  }

  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      const area = el('textarea', { style: 'position:fixed;opacity:0' });
      area.value = texto;
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    }
  }

  function descargar(nombre, contenido, tipo) {
    const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
    const a = el('a', { href: url, download: nombre });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function descargarCSV() {
    // Un texto que empieza con = + - @ lo puede ejecutar Excel como fórmula.
    const texto = v => (/^[=+\-@]/.test(v) ? "'" + v : v);
    const celda = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const filas = [['fecha', 'hora', 'colonia', 'problema', 'desde_hace_dias', 'desde_aprox', 'fuente', 'lat', 'lng', 'comentario']];
    for (const r of reportes_()) {
      const local = new Date(r.t - 7 * H).toISOString();
      filas.push([local.slice(0, 10), local.slice(11, 16), texto(r.colonia ? nombreColonia(r.colonia) : r.coloniaTexto || ''),
        TIPOS[r.tipo].nombre, r.desdeDias, r.desdeAprox ? (r.desdeDias <= 2 ? '2 o 3' : 'más de 3') : '',
        FUENTES[r.fuente] || r.fuente, r.lat, r.lng, texto(r.comentario || '')]);
    }
    descargar(`agua-penasco-reportes-${claveDia(Date.now())}.csv`, '﻿' + filas.map(f => f.map(celda).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  }

  // ---------- Formulario de reporte ----------

  function construirFormulario() {
    const grupo = $('opciones-tipo');
    for (const [valor, t] of Object.entries(TIPOS)) {
      grupo.append(el('label', { class: 'opcion' },
        el('input', { type: 'radio', name: 'tipo', value: valor, onchange: actualizarFormulario }),
        insignia(valor), el('span', {}, t.nombre)));
    }
  }

  function actualizarFormulario() {
    const tipo = $('form-reporte').elements.tipo.value;
    $('grupo-desde').hidden = !['sin_agua', 'baja_presion', 'agua_sucia'].includes(tipo);
  }

  function abrirReporte(coloniaId) {
    const form = $('form-reporte');
    form.reset();
    ui.ubicacionReporte = null;
    $('nota-ubicacion').textContent = '';
    $('error-reporte').textContent = '';
    if (coloniaId) form.elements.colonia.value = nombreColonia(coloniaId);
    actualizarFormulario();
    $('dialogo-reporte').showModal();
  }

  function usarUbicacion(lat, lng) {
    ui.ubicacionReporte = { lat, lng };
    const id = AP.geo.coloniaEn(lat, lng);
    if (id) {
      $('form-reporte').elements.colonia.value = nombreColonia(id);
      $('nota-ubicacion').textContent = `Ubicación guardada (aprox. 100 m). Parece ser ${nombreColonia(id)}; corrígelo si no.`;
    } else {
      $('nota-ubicacion').textContent = 'Ubicación guardada (aprox. 100 m), pero no sabemos qué colonia es. Escríbela arriba.';
    }
  }

  function pedirGPS() {
    if (!navigator.geolocation) { $('nota-ubicacion').textContent = 'Este navegador no puede dar tu ubicación.'; return; }
    $('nota-ubicacion').textContent = 'Buscando tu ubicación…';
    navigator.geolocation.getCurrentPosition(
      p => usarUbicacion(p.coords.latitude, p.coords.longitude),
      () => { $('nota-ubicacion').textContent = 'No se pudo obtener tu ubicación. Escribe tu colonia o elígela en el mapa.'; },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }

  function enviarReporte(e) {
    e.preventDefault();
    const form = $('form-reporte');
    const tipo = form.elements.tipo.value;
    const textoColonia = form.elements.colonia.value.trim();
    if (!tipo) { $('error-reporte').textContent = 'Elige qué está pasando.'; return; }
    if (!textoColonia) { $('error-reporte').textContent = 'Escribe o elige tu colonia.'; return; }
    const colonia = resolverColonia(textoColonia);
    const desde = form.elements.desde.value;
    const reporte = AP.almacen.agregar({
      tipo, colonia,
      coloniaTexto: colonia ? undefined : textoColonia,
      lat: ui.ubicacionReporte && ui.ubicacionReporte.lat,
      lng: ui.ubicacionReporte && ui.ubicacionReporte.lng,
      desdeDias: !$('grupo-desde').hidden && desde !== '' ? +desde : null,
      desdeAprox: !$('grupo-desde').hidden && (desde === '2' || desde === '4'),
      comentario: form.elements.comentario.value,
      fuente: 'app',
    });
    $('dialogo-reporte').close();
    if (ui.modo !== 'ahora') cambiarModo('ahora');
    avisar(colonia ? '¡Gracias! Tu reporte ya aparece en el mapa.' : '¡Gracias! Guardamos tu reporte; esa colonia todavía no está en el mapa.');
    if (reporte.colonia) abrirColonia(reporte.colonia, true);
  }

  // ---------- Ubicar cosas en el mapa ----------

  function empezarAElegir(modo, texto) {
    ui.eligiendo = modo;
    $('texto-elegir').textContent = texto;
    $('aviso-elegir').hidden = false;
    AP.mapa.elegirPunto(true);
    document.querySelector('.zona-mapa').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function terminarDeElegir() {
    const modo = ui.eligiendo;
    ui.eligiendo = null;
    $('aviso-elegir').hidden = true;
    AP.mapa.elegirPunto(false);
    AP.mapa.marcador(null);
    if (modo === 'reporte') $('dialogo-reporte').showModal();
  }

  function alTocarMapa(latlng) {
    const modo = ui.eligiendo;
    if (modo === 'reporte') {
      usarUbicacion(latlng.lat, latlng.lng);
      terminarDeElegir();
      return;
    }
    const c = ui.coloniaPorUbicar;
    const id = c.id || idDeNombre(c.nombre);
    const lat = Math.round(latlng.lat * 1e5) / 1e5, lng = Math.round(latlng.lng * 1e5) / 1e5;
    // Dos colonias en el mismo hexágono: una se quedaría sin zona.
    const otra = AP.geo.puntoEnMismaCelda(lat, lng, id);
    if (otra) { avisar(`Ahí ya está el centro de ${nombreColonia(otra)}. Toca un poco más a un lado.`); return; }
    // La zona que viene del límite oficial o de los negocios no sigue al punto: sacarlo la partiría.
    const zonaFija = modo === 'ubicar' && AP.geo.tieneZonaFija(id);
    if (zonaFija && AP.geo.coloniaEn(lat, lng) !== id) {
      avisar(`La zona de ${c.nombre} viene de su límite oficial o de los negocios y no se mueve. Toca dentro de ella para cambiar dónde va su nombre.`);
      return;   // se sigue eligiendo; Cancelar o Esc para salir
    }
    if (modo === 'ubicar') AP.almacen.ubicarColonia(id, lat, lng);
    if (modo === 'nueva') AP.almacen.agregarColonia(c.nombre, lat, lng);
    AP.mapa.marcador(latlng);
    setTimeout(() => {
      terminarDeElegir();
      aplicarColonias();
      AP.mapa.zonasCambiaron();
      render();
      pintarEditorColonias();
      avisar(zonaFija ? `El nombre de ${c.nombre} quedó donde tocaste.` : `${c.nombre} quedó ubicada. Las zonas se recalcularon.`);
    }, 250);
  }

  // ---------- Importar desde Facebook / WhatsApp ----------

  function fechaSinHora() {
    const ahora = Date.now();
    const opcion = $('fecha-importar').value;
    if (opcion === 'ayer') return inicioDia(sumarDias(claveDia(ahora), -1)) + 12 * H;
    if (opcion === 'otra' && $('fecha-importar-otra').value) return Math.min(ahora, inicioDia($('fecha-importar-otra').value) + 12 * H);
    return ahora;
  }

  function analizarTexto() {
    const texto = $('texto-importar').value;
    if (!texto.trim()) { avisar('Primero pega el texto de las publicaciones.'); return; }
    const propuestas = AP.detector.analizar(texto, { fechaSinHora: fechaSinHora() });
    pintarPropuestas(propuestas);
  }

  function selectColonia(valor) {
    return el('select', { 'aria-label': 'Colonia' },
      el('option', { value: '' }, '— Colonia —'),
      AP.geo.colonias.map(c => el('option', { value: c.id, selected: c.id === valor }, c.nombre)));
  }
  function selectTipo(valor) {
    return el('select', { 'aria-label': 'Problema' },
      el('option', { value: '' }, '— Problema —'),
      Object.entries(TIPOS).map(([k, t]) => el('option', { value: k, selected: k === valor }, t.nombre)));
  }

  function pintarPropuestas(propuestas) {
    const caja = $('resultado-importar');
    if (!propuestas.length) {
      caja.replaceChildren(el('p', { class: 'vacio' }, 'No encontramos colonias ni problemas de agua en el texto. Revisa que el texto mencione la colonia (por ejemplo “en la Obrera no hay agua”).'));
      return;
    }
    const filas = propuestas.map(p => {
      const incluir = el('input', { type: 'checkbox', checked: !!(p.colonia && p.tipo), 'aria-label': 'Incluir' });
      const colonia = selectColonia(p.colonia);
      const tipo = selectTipo(p.tipo);
      const avisos = [];
      if (!p.colonia) avisos.push('No encontramos la colonia: elígela.');
      if (!p.tipo) avisos.push('No está claro el problema: elígelo.');
      if (p.tipoPorContexto) avisos.push('El problema se tomó del resto del hilo.');
      const meta = [fmtFechaHora(p.t) + (p.fechaDelTexto ? '' : ' (fecha supuesta)'), p.desdeDias != null ? textoDesde(p.desdeDias) : null].filter(Boolean).join(' · ');
      const tarjeta = el('div', { class: 'detectado' + (!p.colonia || !p.tipo ? ' revisar' : '') },
        el('p', { class: 'texto' }, '“' + (p.texto.length > 180 ? p.texto.slice(0, 180) + '…' : p.texto) + '”'),
        el('div', { class: 'controles' }, incluir, colonia, tipo),
        el('p', { class: 'nota' }, meta),
        avisos.map(a => el('p', { class: 'aviso-revisar' }, a)));
      const actualizar = () => {
        if (colonia.value && tipo.value && !incluir.dataset.tocado) incluir.checked = true;
        tarjeta.classList.toggle('revisar', !colonia.value || !tipo.value);
        contar();
      };
      colonia.addEventListener('change', actualizar);
      tipo.addEventListener('change', actualizar);
      incluir.addEventListener('change', () => { incluir.dataset.tocado = '1'; contar(); });
      return { p, incluir, colonia, tipo, tarjeta };
    });

    const boton = el('button', { type: 'button', class: 'btn-primario' });
    const contar = () => {
      const n = filas.filter(f => f.incluir.checked && f.colonia.value && f.tipo.value).length;
      boton.textContent = n ? `Agregar ${plural(n, 'reporte', 'reportes')} al mapa` : 'Elige qué reportes agregar';
      boton.disabled = !n;
    };
    boton.addEventListener('click', () => {
      // Volver a pegar el mismo hilo no duplica: las horas de Facebook son relativas ("2 h") y se
      // recorren con el reloj, así que se compara con un margen igual a su precisión, uno a uno y
      // con la misma fuente (así los comentarios nuevos de la misma colonia sí entran).
      const elegidas = filas.filter(f => f.incluir.checked && f.colonia.value && f.tipo.value);
      const guardados = AP.almacen.todos();
      const usados = new Set();
      const nuevos = [];
      for (const f of elegidas) {
        const r = { tipo: f.tipo.value, colonia: f.colonia.value, t: f.p.t, desdeDias: f.p.desdeDias, fuente: f.p.origen };
        const margen = f.p.margen ? f.p.margen + 2 * 60e3 : 30e3;
        const ya = guardados.find(g => !usados.has(g) && g.colonia === r.colonia && g.tipo === r.tipo && g.fuente === r.fuente && Math.abs(g.t - r.t) <= margen);
        if (ya) usados.add(ya); else nuevos.push(r);
      }
      const repetidos = elegidas.length - nuevos.length;
      if (nuevos.length) AP.almacen.agregarVarios(nuevos);
      $('texto-importar').value = '';
      $('resultado-importar').replaceChildren();
      avisar(`Se agregaron ${plural(nuevos.length, 'reporte', 'reportes')}` + (repetidos ? ` (${repetidos} ya estaban)` : '') + '.');
    });
    contar();

    const listos = filas.filter(f => f.p.colonia && f.p.tipo).length;
    caja.replaceChildren(
      el('p', {}, `Encontramos ${plural(propuestas.length, 'posible reporte', 'posibles reportes')}` +
        (propuestas.length - listos ? `; ${plural(propuestas.length - listos, 'necesita', 'necesitan')} revisión (en amarillo).` : '.')),
      ...filas.map(f => f.tarjeta),
      el('div', { class: 'botones' }, boton));
  }

  // ---------- Editor de colonias (pestaña Acerca) ----------

  function pintarEditorColonias() {
    const lista = AP.geo.colonias;
    const sinZona = lista.filter(c => !enMapa(c));
    const soloVotos = lista.filter(c => c.lat == null && enMapa(c));
    const conPunto = lista.filter(c => c.lat != null);
    $('resumen-colonias').textContent = `${plural(lista.length, 'colonia', 'colonias')} en la lista: ${conPunto.length + soloVotos.length} en el mapa` +
      (soloVotos.length ? ` (${soloVotos.length} solo por los negocios del DENUE, sin punto central)` : '') +
      `, ${sinZona.length} por ubicar.` + (sinZona.length ? ' Si conoces dónde queda una, ayúdanos a ubicarla.' : '');
    const sel = $('elegir-colonia-ubicar');
    const previa = sel.value;
    const grupo = (etiqueta, colonias) => (colonias.length ? el('optgroup', { label: etiqueta }, colonias.map(c => el('option', { value: c.id }, c.nombre))) : null);
    sel.replaceChildren(...[
      grupo('Por ubicar', sinZona),
      grupo('Sin punto (su zona viene de los negocios)', soloVotos),
      grupo('Ya ubicadas (para moverlas)', conPunto),
    ].filter(Boolean));
    if (previa && lista.some(c => c.id === previa)) sel.value = previa;

    const cambios = lista.filter(c => c.movida || c.nueva);
    $('cambios-colonias').replaceChildren(...cambios.map(c => el('li', {},
      el('span', {}, `${c.nombre} · ${c.nueva ? 'agregada' : 'ubicada'} en este navegador`),
      el('button', {
        type: 'button', class: 'btn-texto',
        onclick: () => {
          AP.almacen.olvidarCambioColonia(c.id);
          aplicarColonias(); AP.mapa.zonasCambiaron(); render(); pintarEditorColonias();
        },
      }, 'Deshacer'))));
  }

  function nuevaColonia() {
    const caja = $('cambios-colonias');
    if (caja.querySelector('.nueva-colonia')) return;
    const campo = el('input', { type: 'text', placeholder: 'Nombre de la colonia', 'aria-label': 'Nombre de la colonia que falta', maxlength: 60 });
    const fila = el('li', { class: 'nueva-colonia' }, campo,
      el('button', {
        type: 'button', class: 'btn-secundario',
        onclick: () => {
          const nombre = campo.value.trim();
          if (!nombre) { campo.focus(); return; }
          // "Mariposa" o "la Benito" ya son colonias de la lista: no crear duplicados.
          const existente = AP.geo.porId.has(idDeNombre(nombre)) ? idDeNombre(nombre) : resolverColonia(nombre);
          if (existente) { avisar(`Ya está en la lista como «${nombreColonia(existente)}»: elígela arriba para ubicarla.`); return; }
          ui.coloniaPorUbicar = { nombre };
          fila.remove();
          empezarAElegir('nueva', `Toca el centro de ${nombre} en el mapa`);
        },
      }, 'Ubicar en el mapa'));
    caja.prepend(fila);
    campo.focus();
  }

  function descargarColonias() {
    // Se conservan todos los campos del catálogo; solo cambia la ubicación de lo que se movió aquí.
    const filas = AP.geo.colonias.map(({ id, movida, nueva, ...c }) => '  ' + JSON.stringify({
      ...c, alias: c.alias || [],
      ...(movida || nueva ? { ubicacion: 'manual', confianza: 'manual' } : {}),
    }));
    // El encabezado del archivo original se conserva tal cual.
    const encabezado = window.COLONIAS_ENCABEZADO || '// Colonias y fraccionamientos urbanos de Puerto Peñasco.';
    descargar('colonias.js', `${encabezado}\nwindow.COLONIAS_ENCABEZADO = ${JSON.stringify(encabezado)};\nwindow.COLONIAS = [\n${filas.join(',\n')}\n];\n`, 'text/javascript;charset=utf-8');
  }

  // ---------- Eventos ----------

  function conectarEventos() {
    $('btn-reportar').addEventListener('click', () => abrirReporte(ui.seleccion));
    $('btn-borrar-ejemplo').addEventListener('click', () => {
      AP.almacen.borrarEjemplos();
      avisar('Se borraron los datos de ejemplo. Lo que veas ahora son reportes reales de este dispositivo.');
    });

    document.querySelectorAll('[data-modo]').forEach(b => b.addEventListener('click', () => cambiarModo(b.dataset.modo)));
    $('control-dia').addEventListener('input', e => {
      detenerReproduccion();
      ui.dia = ui.dias[+e.target.value];
      sincronizarControlDia();
      render();
    });
    $('btn-reproducir').addEventListener('click', reproducir);

    const tabs = [...document.querySelectorAll('[role="tab"]')];
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => cambiarPestana(tab.id.replace('tab-', '')));
      tab.addEventListener('keydown', e => {
        const paso = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!paso) return;
        const siguiente = tabs[(i + paso + tabs.length) % tabs.length];
        siguiente.focus();
        cambiarPestana(siguiente.id.replace('tab-', ''));
      });
    });
    $('buscar-colonia').addEventListener('input', pintarLista);

    // Formulario
    $('form-reporte').addEventListener('submit', enviarReporte);
    document.querySelectorAll('#dialogo-reporte [data-cerrar]').forEach(b => b.addEventListener('click', () => $('dialogo-reporte').close()));
    $('btn-mi-ubicacion').addEventListener('click', pedirGPS);
    $('btn-elegir-en-mapa').addEventListener('click', () => {
      $('dialogo-reporte').close();
      empezarAElegir('reporte', 'Toca el mapa donde está el problema');
    });
    $('btn-cancelar-elegir').addEventListener('click', terminarDeElegir);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.eligiendo) terminarDeElegir(); });

    // Historial
    $('btn-copiar-resumen').addEventListener('click', async () => {
      const texto = textoResumen();
      const ok = await copiar(texto);
      avisar(ok ? 'Resumen copiado. Pégalo en el grupo de Facebook o WhatsApp.' : 'No se pudo copiar automáticamente.');
      let vista = $('vista-resumen');
      if (!vista) {
        vista = el('textarea', { id: 'vista-resumen', rows: 9, readonly: true, 'aria-label': 'Texto del resumen' });
        $('btn-copiar-resumen').parentElement.after(vista);
      }
      vista.value = texto;
    });
    $('btn-csv').addEventListener('click', descargarCSV);

    // Importar
    $('btn-analizar').addEventListener('click', analizarTexto);
    $('fecha-importar').addEventListener('change', e => { $('fecha-importar-otra').hidden = e.target.value !== 'otra'; });

    // Colonias
    $('btn-ubicar-colonia').addEventListener('click', () => {
      const c = AP.geo.porId.get($('elegir-colonia-ubicar').value);
      if (!c) return;
      ui.coloniaPorUbicar = c;
      empezarAElegir('ubicar', `Toca el centro de ${c.nombre} en el mapa`);
    });
    $('btn-nueva-colonia').addEventListener('click', nuevaColonia);
    $('btn-descargar-colonias').addEventListener('click', descargarColonias);

    addEventListener('resize', () => {
      AP.mapa.ajustarTamano();
      if (!$('pestana-historial').hidden) pintarHistorial();
    });
  }

  // ---------- Arranque ----------

  function iniciar() {
    // La primera vez se generan datos de ejemplo; para eso hace falta saber dónde están las colonias.
    AP.almacen.iniciar(() => { aplicarColonias(); return AP.generarEjemplo(); });
    AP.almacen.alAviso(avisar);
    if (AP.almacen.modo === 'compartido') {
      $('pie-modo').textContent = 'Reportes compartidos: todos ven lo mismo y se actualiza cada minuto.';
    }
    aplicarColonias();
    construirFormulario();
    AP.mapa.iniciar($('mapa'), { alElegirColonia: id => abrirColonia(id, false), alTocarMapa });
    if (matchMedia('(max-width: 640px)').matches) $('leyenda').open = false;
    conectarEventos();
    AP.almacen.alCambiar(render);
    render();
    setInterval(render, 60e3);   // "hace 5 minutos" y la ventana de 24 h se mantienen al día
  }

  iniciar();
})(window.AP);
