// Gráficas del historial, hechas a mano en SVG/HTML (sin librerías).
(function (AP) {
  const { el, fmtDia, fmtDiaCorto, plural } = AP.util;
  const TIPOS = AP.TIPOS;
  const NS = 'http://www.w3.org/2000/svg';
  // Series de la gráfica por día, de abajo hacia arriba.
  const SERIES = ['sin_agua', 'baja_presion'];
  const COLOR = { sin_agua: 'var(--critico)', baja_presion: 'var(--alerta)', agua_sucia: 'var(--serio)', regreso: 'var(--regreso)', fuga: 'var(--tinta-2)' };

  const svgEl = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    return e;
  };

  function pasoBonito(max, marcas) {
    const bruto = Math.max(1, max) / marcas;
    const potencia = 10 ** Math.floor(Math.log10(bruto));
    const f = bruto / potencia;
    return Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * potencia);
  }

  // Rectángulo con las esquinas de arriba redondeadas (el extremo del dato) y la base recta.
  function barra(x, y, w, h, radio) {
    const r = Math.min(radio, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  // ---------- Globo de detalle (compartido por todas las gráficas) ----------

  let globo;
  function mostrarGlobo(titulo, filas, x, y) {
    if (!globo) {
      globo = el('div', { class: 'tooltip-grafica', role: 'status' });
      document.body.append(globo);
    }
    globo.replaceChildren(el('div', { class: 'titulo' }, titulo));
    for (const f of filas) {
      const clave = el('span', { class: 'clave' });
      clave.style.background = f.color || 'transparent';
      globo.append(el('div', { class: 'fila' }, clave, el('b', {}, String(f.valor)), el('span', {}, f.nombre)));
    }
    globo.hidden = false;
    const ancho = globo.offsetWidth, alto = globo.offsetHeight;
    const izq = Math.min(Math.max(8, x - ancho / 2), innerWidth - ancho - 8);
    const arriba = y - alto - 12 < 8 ? y + 16 : y - alto - 12;
    globo.style.left = izq + 'px';
    globo.style.top = arriba + 'px';
  }
  const ocultarGlobo = () => { if (globo) globo.hidden = true; };

  const filasGlobo = conteo => ['sin_agua', 'baja_presion', 'agua_sucia', 'fuga', 'regreso']
    .filter(t => SERIES.includes(t) || conteo[t])
    .map(t => ({ valor: conteo[t], nombre: TIPOS[t].corto, color: COLOR[t] }));

  // ---------- Reportes por día (toda la ciudad) ----------

  function barrasPorDia(contenedor, filas, { elegido, alElegir }) {
    const ancho = Math.max(280, contenedor.clientWidth || 360);
    const alto = 190, m = { izq: 30, der: 6, arr: 10, aba: 24 };
    const anchoPlot = ancho - m.izq - m.der, altoPlot = alto - m.arr - m.aba;
    const total = f => SERIES.reduce((s, t) => s + f.conteo[t], 0);
    const maximo = Math.max(1, ...filas.map(total));
    const paso = pasoBonito(maximo, 4);
    const tope = Math.ceil(maximo / paso) * paso;
    const y = v => m.arr + altoPlot - (v / tope) * altoPlot;
    const banda = anchoPlot / filas.length;
    const anchoBarra = Math.min(24, Math.max(3, banda - 3));

    const svg = svgEl('svg', { viewBox: `0 0 ${ancho} ${alto}`, height: alto, role: 'group', 'aria-label': 'Reportes de falta de agua por día' });
    for (let v = 0; v <= tope; v += paso) {
      svg.append(svgEl('line', { class: v === 0 ? 'base' : 'rejilla', x1: m.izq, x2: ancho - m.der, y1: y(v), y2: y(v) }));
      const t = svgEl('text', { class: 'tick', x: m.izq - 6, y: y(v) + 4, 'text-anchor': 'end' });
      t.textContent = v;
      svg.append(t);
    }

    filas.forEach((f, i) => {
      const x = m.izq + i * banda + (banda - anchoBarra) / 2;
      // Segmentos apilados con 2 px de separación; solo el de arriba lleva la punta redondeada.
      let base = y(0);
      const visibles = SERIES.filter(t => f.conteo[t] > 0);
      visibles.forEach((t, k) => {
        const alturaDato = Math.max(2, y(0) - y(f.conteo[t]));
        const hueco = k > 0 ? 2 : 0;
        const arriba = base - hueco - alturaDato;
        const ultimo = k === visibles.length - 1;
        svg.append(svgEl('path', { class: 'seg-' + t, d: ultimo ? barra(x, arriba, anchoBarra, alturaDato, 4) : `M${x},${arriba}h${anchoBarra}v${alturaDato}h${-anchoBarra}Z` }));
        base = arriba;
      });

      const etiqueta = `${fmtDia(f.clave)}: ${filasGlobo(f.conteo).map(r => `${r.valor} ${r.nombre.toLowerCase()}`).join(', ')}`;
      const toque = svgEl('rect', {
        class: 'zona-toque' + (f.clave === elegido ? ' elegido' : ''),
        x: m.izq + i * banda, y: m.arr, width: banda, height: altoPlot,
        tabindex: 0, role: 'button', 'aria-label': etiqueta + '. Ver ese día en el mapa.',
      });
      const mostrar = (px, py) => mostrarGlobo(fmtDia(f.clave), filasGlobo(f.conteo), px, py);
      toque.addEventListener('pointermove', e => mostrar(e.clientX, e.clientY));
      toque.addEventListener('pointerleave', ocultarGlobo);
      toque.addEventListener('focus', () => { const r = toque.getBoundingClientRect(); mostrar(r.left + r.width / 2, r.top + 20); });
      toque.addEventListener('blur', ocultarGlobo);
      toque.addEventListener('click', () => alElegir(f.clave));
      toque.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alElegir(f.clave); } });
      svg.append(toque);
    });

    // Fechas: una por semana, contando desde hoy hacia atrás.
    for (let i = filas.length - 1; i >= 0; i -= 7) {
      const ultimo = i === filas.length - 1;
      const t = svgEl('text', {
        class: 'tick', y: alto - 6,
        x: ultimo ? ancho - m.der : m.izq + i * banda + banda / 2,
        'text-anchor': ultimo ? 'end' : 'middle',
      });
      t.textContent = ultimo ? 'hoy' : fmtDiaCorto(filas[i].clave);
      svg.append(t);
    }
    contenedor.replaceChildren(svg);
  }

  function tablaDias(contenedor, filas) {
    const tipos = ['sin_agua', 'baja_presion', 'agua_sucia', 'fuga', 'regreso'];
    const tabla = el('table', {},
      el('thead', {}, el('tr', {}, el('th', {}, 'Día'), tipos.map(t => el('th', { class: 'num' }, TIPOS[t].corto)))),
      el('tbody', {}, [...filas].reverse().map(f => el('tr', {}, el('td', {}, fmtDia(f.clave)), tipos.map(t => el('td', { class: 'num' }, f.conteo[t]))))));
    contenedor.replaceChildren(tabla);
  }

  // ---------- Tira de 30 días de una colonia ----------

  function tiraColonia(contenedor, filas, alElegir) {
    const tira = el('div', { class: 'tira-dias', role: 'group', 'aria-label': 'Últimos 30 días' });
    for (const f of filas) {
      const resumen = filasGlobo(f.conteo).filter(r => r.valor).map(r => `${r.valor} ${r.nombre.toLowerCase()}`).join(', ') || 'sin reportes';
      const dia = el('button', {
        class: 'dia ' + (f.peor || ''), type: 'button',
        'aria-label': `${fmtDia(f.clave)}: ${resumen}. Ver ese día en el mapa.`,
        onclick: () => alElegir(f.clave),
        onpointerleave: ocultarGlobo, onblur: ocultarGlobo,
      });
      const mostrar = () => {
        const r = dia.getBoundingClientRect();
        mostrarGlobo(fmtDia(f.clave), filasGlobo(f.conteo).filter(x => x.valor), r.left + r.width / 2, r.top);
      };
      dia.addEventListener('pointerenter', mostrar);
      dia.addEventListener('focus', mostrar);
      tira.append(dia);
    }
    contenedor.replaceChildren(
      tira,
      el('div', { class: 'tira-ejes' }, el('span', {}, fmtDiaCorto(filas[0].clave)), el('span', {}, 'hoy')),
    );
  }

  // ---------- Ranking de colonias (una sola serie: días sin agua) ----------

  function ranking(contenedor, filas, alElegir) {
    if (!filas.length) {
      contenedor.replaceChildren(el('p', { class: 'vacio' }, 'Ninguna colonia con reportes de “no hay agua” en estos días.'));
      return;
    }
    const maximo = Math.max(...filas.map(f => f.valor));
    contenedor.replaceChildren(...filas.map(f => {
      const pista = el('div', { class: 'pista' });
      const b = el('div', { class: 'barra' });
      b.style.width = `calc((100% - 52px) * ${f.valor / maximo})`;
      pista.append(b, el('span', { class: 'valor' }, plural(f.valor, 'día', 'días')));
      return el('div', { class: 'fila' }, el('button', { type: 'button', onclick: () => alElegir(f.id), title: f.nombre }, f.nombre), pista);
    }));
  }

  AP.graficas = { barrasPorDia, tablaDias, tiraColonia, ranking, ocultarGlobo, COLOR };
})(window.AP);
