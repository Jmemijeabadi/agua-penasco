// Utilidades compartidas: tipos de reporte, fechas en hora de Sonora, texto y DOM.
window.AP = window.AP || {};

(function (AP) {
  const H = 3600e3;
  const D = 24 * H;

  // Lo que la gente puede reportar. El orden es el de los botones del formulario.
  AP.TIPOS = {
    sin_agua:     { nombre: 'No hay agua',             corto: 'Sin agua',     icono: 'i-sin-agua' },
    baja_presion: { nombre: 'Llega muy poca agua',     corto: 'Poca presión', icono: 'i-poca' },
    agua_sucia:   { nombre: 'Sale sucia o con olor',   corto: 'Agua sucia',   icono: 'i-sucia' },
    fuga:         { nombre: 'Fuga en la calle',        corto: 'Fuga',         icono: 'i-fuga' },
    regreso:      { nombre: 'Ya regresó el agua',      corto: 'Ya regresó',   icono: 'i-regreso' },
  };

  // --- Fechas. Sonora usa UTC-7 todo el año (sin horario de verano), así que los días
  //     se cortan con un desfase fijo y no dependen de la zona horaria del teléfono.
  const DESFASE = -7 * H;
  const ZONA = 'America/Hermosillo';

  const claveDia = t => new Date(t + DESFASE).toISOString().slice(0, 10);
  const inicioDia = clave => Date.parse(clave + 'T00:00:00-07:00');
  const sumarDias = (clave, n) => claveDia(inicioDia(clave) + n * D);

  // Las claves de los últimos n días, de la más antigua a hoy.
  function ultimosDias(n, ahora = Date.now()) {
    const hoy = claveDia(ahora);
    return Array.from({ length: n }, (_, i) => sumarDias(hoy, i - n + 1));
  }

  const formatoDia = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA, weekday: 'short', day: 'numeric', month: 'short' });
  const formatoDiaCorto = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA, day: 'numeric', month: 'short' });
  const formatoFechaHora = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const formatoRelativo = new Intl.RelativeTimeFormat('es-MX', { numeric: 'auto' });

  const fmtDia = clave => formatoDia.format(inicioDia(clave) + 12 * H);
  const fmtDiaCorto = clave => formatoDiaCorto.format(inicioDia(clave) + 12 * H);
  const fmtFechaHora = t => formatoFechaHora.format(t);

  function haceCuanto(t, ahora = Date.now()) {
    const s = Math.round((t - ahora) / 1000);
    const abs = Math.abs(s);
    if (abs < 60) return 'hace un momento';
    if (abs < 3600) return formatoRelativo.format(Math.round(s / 60), 'minute');
    if (abs < 86400) return formatoRelativo.format(Math.round(s / 3600), 'hour');
    return formatoRelativo.format(Math.round(s / 86400), 'day');
  }

  // --- Texto
  const sinAcentos = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const normalizar = s => sinAcentos(String(s).toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim();
  const idDeNombre = nombre => normalizar(nombre).replace(/ /g, '-');
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // --- DOM
  function el(etiqueta, attrs, ...hijos) {
    const e = document.createElement(etiqueta);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat()) {
      if (h != null && h !== false) e.append(h instanceof Node ? h : String(h));
    }
    return e;
  }

  function icono(id, clase = 'ico') {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', clase);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#' + id);
    svg.append(use);
    return svg;
  }
  const iconoHtml = (id, clase = 'ico') => `<svg class="${clase}" aria-hidden="true"><use href="#${id}"/></svg>`;

  // Insignia cuadrada con el ícono del tipo (o estado) y su color.
  const insignia = tipo => el('span', { class: 'insignia ' + (tipo || '') }, icono(tipo ? AP.TIPOS[tipo].icono : 'i-gota'));

  function avisar(mensaje) {
    const caja = document.getElementById('aviso-flotante');
    caja.textContent = mensaje;
    caja.classList.add('visible');
    clearTimeout(avisar.t);
    avisar.t = setTimeout(() => caja.classList.remove('visible'), 3500);
  }

  // Generador pseudoaleatorio con semilla (para que los datos de ejemplo salgan siempre iguales).
  function azarConSemilla(semilla) {
    let a = semilla >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  AP.util = {
    H, D, claveDia, inicioDia, sumarDias, ultimosDias,
    fmtDia, fmtDiaCorto, fmtFechaHora, haceCuanto,
    sinAcentos, normalizar, idDeNombre, plural, esc,
    el, icono, iconoHtml, insignia, avisar, azarConSemilla,
  };
})(window.AP);
