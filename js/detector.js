// Lee texto copiado de Facebook o WhatsApp y propone reportes: qué colonia, qué problema y cuándo.
// No guarda nada ni conserva nombres: devuelve propuestas para que una persona las revise.
(function (AP) {
  const { H, D, normalizar, sinAcentos, claveDia, inicioDia, sumarDias } = AP.util;

  // ---------- Colonias ----------

  // Errores de ortografía comunes (z/s, v/b, ll/y, h muda, c/k…) se pliegan igual en el texto y
  // en los nombres, así "venito juares" encuentra "Benito Juárez".
  const plegar = s => s
    .replace(/puerto penasco/g, 'xpenasco')
    .replace(/h/g, '').replace(/ll/g, 'y').replace(/v/g, 'b').replace(/z/g, 's')
    .replace(/c([ei])/g, 's$1').replace(/qu/g, 'k').replace(/c/g, 'k')
    .replace(/(.)\1+/g, '$1');

  const conjunto = palabras => new Set(palabras.map(plegar));
  const PREFIJOS = /^(colonia|col|fraccionamiento|fracc|frac|residencial|privada) /;
  // Lo que puede ir antes de una palabra "débil" (abajo): un artículo, "en" o el tipo de fraccionamiento.
  const ARTICULOS = conjunto(['la', 'el', 'las', 'los', 'en', 'residencial', 'privada']);
  const ANTES_COLONIA = conjunto(['colonia', 'col', 'fraccionamiento', 'fracc', 'frac']);
  // "Blvd. López Portillo" o "parque Josefa Ortiz" no son la colonia.
  const ANTES_NO_COLONIA = conjunto(['calle', 'blvd', 'bulevar', 'boulevard', 'av', 'avenida', 'callejon', 'parque', 'escuela', 'primaria', 'secundaria', 'kinder', 'jardin', 'unidad']);
  // Palabras que también se usan en otro sentido: necesitan "la/el" o "colonia" antes…
  const DEBILES = conjunto(['centro', 'deportiva', 'portales', 'delfines', 'providencia', 'aurora', 'conchas', 'herradura', 'palmas',
    'brisas', 'lagos', 'mirador', 'sahuaro', 'mediterraneo', 'infonavit', 'mariposa']);
  // "al oriente de la ciudad" o "sector oriente" son direcciones, no la colonia Oriente.
  const ANTES_DIRECCION = conjunto(['al', 'del', 'sector', 'zona', 'lado', 'hacia', 'rumbo', 'parte']);
  const DIRECCIONES = conjunto(['oriente']);
  // …y estas, "colonia" sí o sí ("en el puerto", "se descompuso el cárcamo").
  const MUY_DEBILES = conjunto(['nueva', 'penasco', 'puerto', 'el puerto', 'carcamo', 'el carcamo']);
  // "desde el 4 de marzo" es una fecha, no la colonia 4 de Marzo.
  const MES_FECHA = conjunto(['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']);
  const ANTES_FECHA = conjunto(['el', 'del', 'dia', 'desde', 'hasta']);
  // "el centro de salud", "el centro comercial" no son la colonia Centro.
  const DESPUES_NO_COLONIA = new Map([['centro', ['de', 'comercial']], ['el centro', ['de', 'comercial']]].map(([v, l]) => [plegar(v), conjunto(l)]));

  let variantes = [];   // { id, palabras: [...], texto }

  function prepararColonias(colonias) {
    variantes = [];
    for (const c of colonias) {
      const nombres = new Set();
      let base = normalizar(c.nombre);
      nombres.add(base);
      while (PREFIJOS.test(base)) { base = base.replace(PREFIJOS, ''); nombres.add(base); }
      const sinArticulo = base.replace(/^(la|el|las|los) /, '');
      if (sinArticulo !== base) nombres.add(sinArticulo);
      for (const a of c.alias || []) nombres.add(normalizar(a));
      for (const n of nombres) {
        const texto = plegar(n);
        if (texto.length >= 4) variantes.push({ id: c.id, palabras: texto.split(' '), texto });
      }
    }
    // Primero las más largas: "ampliación benito juárez" gana sobre "benito juárez".
    variantes.sort((a, b) => b.palabras.length - a.palabras.length || b.texto.length - a.texto.length);
  }

  function buscarColonias(texto) {
    const palabras = plegar(normalizar(texto)).split(' ');
    const ocupadas = new Set();
    const hallazgos = [];
    for (const v of variantes) {
      const n = v.palabras.length;
      for (let i = 0; i + n <= palabras.length; i++) {
        if (v.palabras.some((p, k) => palabras[i + k] !== p)) continue;
        if ([...Array(n).keys()].some(k => ocupadas.has(i + k))) continue;
        const antes = palabras[i - 1];
        if (ANTES_NO_COLONIA.has(antes)) continue;
        if (MUY_DEBILES.has(v.texto) && !ANTES_COLONIA.has(antes)) continue;
        if (DEBILES.has(v.texto) && !ANTES_COLONIA.has(antes) && !ARTICULOS.has(antes)) continue;
        if (MES_FECHA.has(v.palabras[n - 1]) && ANTES_FECHA.has(antes)) continue;
        if (DIRECCIONES.has(v.texto) && ANTES_DIRECCION.has(antes)) continue;
        if (DESPUES_NO_COLONIA.has(v.texto) && DESPUES_NO_COLONIA.get(v.texto).has(palabras[i + n])) continue;
        for (let k = 0; k < n; k++) ocupadas.add(i + k);
        hallazgos.push({ id: v.id, posicion: i });
      }
    }
    const ids = [];
    for (const h of hallazgos.sort((a, b) => a.posicion - b.posicion)) if (!ids.includes(h.id)) ids.push(h.id);
    return ids;
  }

  // ---------- Tipo de problema ----------

  // Frases cortas como "no hay" o "ya llegó" solo cuentan si no hablan de otra cosa (luz, gas…).
  const OTRA_COSA = '(?! (de )?(luz|internet|senal|gas|clases|cable|telefono|transporte|camion|basura|recoleccion|recibo))';
  const patron = fuente => new RegExp(fuente.replace(/OTRA_COSA/g, OTRA_COSA));

  const PATRONES = {
    sin_agua: [
      /\b(no|ni|sin)((?: (?!presion\b)\w+){0,4}) agua\b/,
      /\b(sin|ni) (una )?gota\b/,
      /\b(tinacos?|llaves?|tuberia) (sec[oa]s?|vaci[oa]s?)\b/,
      /\b(corte|cortes|cortaron|quitaron|suspendieron)( \w+){0,2} (agua|servicio)\b/,
      patron('\\b(dias?|semanas?|horas?) sin\\bOTRA_COSA'),
      patron('\\b(tampoco|igual)( \\w+){0,2} (hay|tenemos|llega|cae)\\bOTRA_COSA'),
      patron('\\bno (hay|tenemos|llega|cae|ha llegado|ha caido)\\bOTRA_COSA'),
      /\bpipas?\b(?! de gas)/,
    ],
    agua_sucia: [
      /\bagua (sucia|cafe|turbia|amarilla|negra|lodosa|con tierra|con lodo|con olor|apestosa)\b/,
      /\b(sale|salio|llega|llego|viene|cae|esta) (bien |muy )?(sucia|cafe|turbia|amarilla|negra|lodosa|con tierra|con lodo|con olor|apestosa)\b/,
      /\b(agua|llave)\b.{0,30}\b(huele|apesta|mal olor|lodo)\b/,
      /\b(huele|apesta|mal olor|lodo)\b.{0,30}\bagua\b/,
    ],
    baja_presion: [
      /\b(poca|baja|sin|nada de|casi no hay|no hay|no trae) presion\b/,
      /\bpresion (baja|bajisima|muy baja|bien baja)\b/,
      /\b(llega|cae|sale|viene|llego|cayo|salio)( el agua)? (muy |bien )?(poca|poquita|poquito|apenas|despacito|un chorrito|un hilito|un hilo|gotitas|goteando)\b/,
      /\bno (sube|alcanza a subir|llega) al tinaco\b/,
      /\b(chorrito|hilito|goteando|gotitas)\b/,
      /\bmuy (poca|poquita)\b/,
    ],
    regreso: [
      patron('\\bya (hay|tenemos|tengo|llego|cayo|salio|volvio|regreso|esta llegando|esta cayendo|nos llego|nos cayo)\\b(?! (la )?pipa)OTRA_COSA'),
      /\b(regreso|volvio|llego|cayo|restablecieron|restablecio)( el)? (agua|servicio)\b/,
      /\bsi (hay|tenemos|llego|cayo) agua\b/,
    ],
    fuga: [
      /\bfugas?\b(?! de gas)/,
      /\b(se esta|esta|estan) (tirando|desperdiciando|brotando)\b(?! (la )?(basura|escombro))/,
      /\btira(ndo|dero) (de |el |mucha )?agua\b/,
      /\b(tubo|tuberia|toma|cano|valvula) (rot[oa]|reventad[oa]|quebrad[oa]|tronad[oa])\b/,
      /\b(se revento|se rompio|reventon|desperdicio de agua|charco de agua)\b/,
    ],
  };
  // Si un texto encaja en varios, gana el primero de esta lista.
  const PRECEDENCIA = ['sin_agua', 'agua_sucia', 'baja_presion', 'regreso', 'fuga'];

  function buscarTipo(texto) {
    const n = normalizar(texto);
    const encontrados = PRECEDENCIA.filter(t => PATRONES[t].some(p => p.test(n)));
    // "poca presión" también encaja en "sin … agua" de forma laxa; la presión es más precisa.
    if (encontrados.includes('baja_presion') && encontrados.includes('sin_agua') && /\bpresion\b/.test(n)) {
      return 'baja_presion';
    }
    const tipo = encontrados[0] || null;
    // "¿Ya hay agua?" es una pregunta, no un aviso de que regresó.
    if (tipo === 'regreso' && /[¿?]/.test(texto)) return null;
    return tipo;
  }

  // ---------- ¿Desde cuándo? ----------

  const NUMEROS = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15 };
  const SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

  function buscarDesde(texto, t) {
    const n = normalizar(texto);
    let m;
    if (/\bdesde (hoy|la manana|temprano|esta manana|la madrugada)\b/.test(n)) return 0;
    if (/\bdesde (ayer|anoche)\b/.test(n)) return 1;
    if (/\bdesde (antier|anteayer|antiayer)\b/.test(n)) return 2;
    if ((m = n.match(/\b(\d{1,2}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince) (dias?|semanas?)\b/))) {
      const k = /^\d+$/.test(m[1]) ? +m[1] : NUMEROS[m[1]];
      return Math.min(60, m[2].startsWith('semana') ? k * 7 : k);
    }
    if ((m = n.match(/\bdesde el (domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/))) {
      const hoy = new Date(inicioDia(claveDia(t)) + 12 * H).getUTCDay();
      const dif = (hoy - SEMANA.indexOf(m[1]) + 7) % 7;
      return dif || 7;
    }
    return null;
  }

  // ---------- Fechas que trae el texto copiado ----------

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function aHora(clave, h, min, ampm) {
    let hora = +h;
    if (ampm === 'p' && hora < 12) hora += 12;
    if (ampm === 'a' && hora === 12) hora = 0;
    return inicioDia(clave) + hora * H + (+min || 0) * 60e3;
  }

  // Facebook pone la hora en una línea aparte: "3 h", "5 min", "Ayer a las 18:20", "15 de octubre".
  function fechaDeLinea(linea, ahora) {
    const s = sinAcentos(linea.toLowerCase()).replace(/[·•]/g, ' ').replace(/\s+/g, ' ').trim();
    const hoy = claveDia(ahora);
    let m;
    if ((m = s.match(/^(?:hace )?(\d{1,2}) ?(min|mins|minutos?)$/))) return ahora - m[1] * 60e3;
    if ((m = s.match(/^(?:hace )?(\d{1,2}) ?(h|hr|hrs|horas?)$/))) return ahora - m[1] * H;
    if ((m = s.match(/^(?:hace )?(\d{1,2}) ?(d|dias?)$/))) return ahora - m[1] * D;
    if ((m = s.match(/^(?:hace )?(\d{1,2}) ?(sem|semanas?)$/))) return ahora - m[1] * 7 * D;
    const hora = '(?: a las (\\d{1,2}):(\\d{2}) ?([ap])?\\.? ?(?:m\\.?)?)?$';
    if ((m = s.match(new RegExp('^ayer' + hora)))) return aHora(sumarDias(hoy, -1), m[1] || 12, m[2], m[3]);
    if ((m = s.match(new RegExp('^(\\d{1,2}) de ([a-z]+)(?: de (\\d{4}))?' + hora)))) {
      const mes = MESES.indexOf(m[2].slice(0, 3));
      if (mes < 0) return null;
      let anio = +m[3] || +hoy.slice(0, 4);
      let clave = `${anio}-${String(mes + 1).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
      if (!m[3] && clave > hoy) clave = `${anio - 1}${clave.slice(4)}`;
      return aHora(clave, m[4] || 12, m[5], m[6]);
    }
    return null;
  }

  // Qué tan precisa es una hora relativa: "45 min" ±1 minuto, "2 h" ±1 hora, "3 d" ±1 día.
  function margenDeLinea(linea) {
    const s = sinAcentos(linea.toLowerCase()).replace(/[·•]/g, ' ').replace(/\s+/g, ' ').trim();
    const m = s.match(/^(?:hace )?\d{1,2} ?(min|mins|minutos?|h|hr|hrs|horas?|d|dias?|sem|semanas?)$/);
    if (!m) return 0;   // fecha escrita o de WhatsApp: exacta
    return m[1][0] === 'm' ? 60e3 : m[1][0] === 'h' ? H : m[1][0] === 'd' ? D : 7 * D;
  }

  // Chat exportado de WhatsApp: "22/10/26, 9:15 a. m. - Ana: No hay agua" o "[22/10/26, 09:15:33] Ana: …"
  const WHATSAPP = /^\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),? (\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?\s*(?:m\.?)?\]?\s*-?\s*[^:]{1,40}:\s*(.*)$/i;
  function lineaWhatsApp(linea) {
    const m = linea.replace(/ | /g, ' ').match(WHATSAPP);
    if (!m) return null;
    const anio = m[3].length === 2 ? '20' + m[3] : m[3];
    const clave = `${anio}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return { t: aHora(clave, m[4], m[5], m[6] && m[6].toLowerCase()), mensaje: m[7] };
  }

  // Botones y contadores de Facebook que vienen pegados con el texto.
  const RUIDO = /^(me gusta|me encanta|me importa|responder|compartir|comentar|enviar|ver traduccion|ver original|ver mas|ver menos|editado|autor|seguir|unirse|mas relevantes|todos los comentarios|escribe un comentario|escribe una respuesta|ver \d+ respuestas?|ver todas las respuestas|ocultar|traducir|calificar esta traduccion|destacad[oa]|fan destacado|colaborador destacado|nuevo miembro|administrador|moderador|\d+ (comentarios?|veces compartido|reacciones?|respuestas?)|\d+[km]?)$/;

  // ---------- Juntar todo ----------

  function separarBloques(texto, ahora) {
    const bloques = [];
    let actual = null;
    const cerrar = () => { if (actual && actual.lineas.length) bloques.push(actual); actual = null; };
    for (const cruda of texto.split(/\r?\n/)) {
      const linea = cruda.trim();
      if (!linea) { cerrar(); continue; }
      const wa = lineaWhatsApp(linea);
      if (wa) { cerrar(); actual = { lineas: [wa.mensaje], t: wa.t, whatsapp: true }; continue; }
      const t = fechaDeLinea(linea, ahora);
      if (t != null) {
        if (!actual) { actual = { lineas: [], t, margen: margenDeLinea(linea) }; continue; }
        if (actual.t == null) { actual.t = t; actual.margen = margenDeLinea(linea); }
        // En un comentario la hora va al final; en una publicación va después del nombre y antes del texto.
        if (actual.lineas.length > 1 || actual.lineas.join(' ').split(' ').length > 4) cerrar();
        continue;
      }
      const n = normalizar(linea);
      if (!n || RUIDO.test(n)) { cerrar(); continue; }
      if (actual && actual.whatsapp) { actual.lineas.push(linea); continue; }
      if (!actual) actual = { lineas: [], t: null };
      actual.lineas.push(linea);
    }
    cerrar();
    // Un bloque largo sin separaciones suele ser varios comentarios pegados: se lee línea por línea.
    return bloques.flatMap(b => (b.lineas.length > 4 ? b.lineas.map(l => ({ ...b, lineas: [l] })) : [b]));
  }

  // Propuestas de reporte a partir del texto pegado. fechaSinHora: la fecha para los
  // bloques que no traen la suya.
  function analizar(texto, { ahora = Date.now(), fechaSinHora = ahora } = {}) {
    const propuestas = [];
    const vistos = new Set();
    for (const b of separarBloques(texto, ahora)) {
      const contenido = b.lineas.join(' ');
      const clave = normalizar(contenido);
      if (vistos.has(clave)) continue;   // Facebook a veces repite el texto ("Ver traducción")
      vistos.add(clave);
      const colonias = buscarColonias(contenido);
      const tipo = buscarTipo(contenido);
      if (!colonias.length && !tipo) continue;
      const t = Math.min(b.t != null ? b.t : fechaSinHora, ahora);
      const desdeDias = tipo === 'sin_agua' || tipo === 'baja_presion' ? buscarDesde(contenido, t) : null;
      for (const colonia of colonias.length ? colonias : [null]) {
        propuestas.push({
          texto: contenido, colonia, tipo, t, desdeDias,
          fechaDelTexto: b.t != null, origen: b.whatsapp ? 'whatsapp' : 'facebook',
          margen: b.t != null ? b.margen || 0 : D,   // sin fecha en el texto, la fecha es la que se eligió
        });
      }
    }
    // En un hilo, "Nueva Esperanza igual" o "aquí tampoco" repiten el problema de los demás.
    const cuenta = {};
    for (const p of propuestas) if (p.tipo) cuenta[p.tipo] = (cuenta[p.tipo] || 0) + 1;
    const delHilo = Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a])[0];
    for (const p of propuestas) {
      if (!p.tipo && delHilo && /\b(igual|tampoco|tambien|lo mismo|same|x2)\b/.test(normalizar(p.texto))) {
        p.tipo = delHilo;
        p.tipoPorContexto = true;
      }
    }
    return propuestas;
  }

  AP.detector = { prepararColonias, buscarColonias, buscarTipo, buscarDesde, fechaDeLinea, analizar };
})(window.AP);
