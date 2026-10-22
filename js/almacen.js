// Dónde viven los reportes. Si js/config.js trae los datos de Supabase, se comparten con todos
// (modo "compartido"); si no, se guardan solo en este navegador (modo "local", con datos de
// ejemplo para probar). El resto de la app solo usa AP.almacen.
(function (AP) {
  const CONFIG = window.AGUA_CONFIG || {};
  const COMPARTIDO = !!(CONFIG.supabaseUrl && CONFIG.supabaseKey);
  const CLAVE_REPORTES = 'aguapenasco.reportes.v1';        // modo local
  const CLAVE_COPIA = 'aguapenasco.compartidos.v1';        // modo compartido: copia para abrir rápido o sin señal
  const CLAVE_PENDIENTES = 'aguapenasco.pendientes.v1';    // modo compartido: reportes que faltan por enviar
  const CLAVE_DISPOSITIVO = 'aguapenasco.dispositivo';
  const CLAVE_COLONIAS = 'aguapenasco.colonias.v1';
  const DIA = 24 * 3600e3;
  const DIAS_A_CARGAR = 62;            // el historial muestra 30 días; con margen
  const CADA_MINUTO = 60e3;            // buscar reportes nuevos
  const RECARGA_COMPLETA = 15 * 60e3;  // de vez en cuando, todo (por si se ocultó alguno)
  const COLUMNAS = 'id,creado,t,tipo,colonia,colonia_texto,lat,lng,desde_dias,desde_aprox,comentario,fuente';
  const oyentes = new Set();
  const avisos = new Set();

  function leer(clave) {
    try { return JSON.parse(localStorage.getItem(clave)); } catch { return null; }
  }
  function escribir(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento: solo dura esta visita */ }
  }

  let locales = [];      // modo local
  let servidor = [];     // modo compartido: lo que ya está en la base
  let pendientes = [];   // modo compartido: hechos aquí, todavía sin confirmar por la base
  let reportes = [];     // lo que ve la app, ordenado por hora
  let ultimoCreado = 0;
  let enviando = false;
  const estado = { error: null, actualizado: null };
  let cambiosColonias = { ubicaciones: {}, nuevas: [] };

  const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const avisarCambio = () => oyentes.forEach(f => f());
  const avisar = texto => avisos.forEach(f => f(texto));
  function combinar() {
    reportes = COMPARTIDO ? [...servidor, ...pendientes.map(p => ({ ...p, pendiente: true }))] : locales.slice();
    reportes.sort((a, b) => a.t - b.t);
  }

  // Lo mínimo que se guarda de cada reporte. Las coordenadas se redondean (~100 m) para no
  // publicar la ubicación exacta de una casa.
  function limpiar(r) {
    return {
      id: r.id || nuevoId(),
      t: r.t || Date.now(),
      tipo: r.tipo,
      colonia: r.colonia || null,
      coloniaTexto: r.colonia ? undefined : (r.coloniaTexto || '').slice(0, 60) || undefined,
      lat: r.lat != null ? Math.round(r.lat * 1000) / 1000 : undefined,
      lng: r.lng != null ? Math.round(r.lng * 1000) / 1000 : undefined,
      desdeDias: r.desdeDias != null ? r.desdeDias : undefined,
      desdeAprox: r.desdeAprox ? true : undefined,   // del formulario: "2 o 3 días", "más de 3 días"
      comentario: (r.comentario || '').trim().slice(0, 200) || undefined,
      fuente: r.fuente || 'app',
    };
  }

  // ---------- Supabase (API REST de la tabla "reportes", ver supabase/esquema.sql) ----------

  // Un número al azar por teléfono, solo para frenar abusos (la base limita cuántos reportes
  // seguidos manda cada uno). No dice quién es la persona y no se muestra a nadie.
  function idDispositivo() {
    let id = leer(CLAVE_DISPOSITIVO);
    if (!id) {
      id = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : nuevoId() + nuevoId()).slice(0, 36);
      escribir(CLAVE_DISPOSITIVO, id);
    }
    return id;
  }

  function cabeceras(extra) {
    const h = { apikey: CONFIG.supabaseKey, 'Content-Type': 'application/json', ...extra };
    // La clave "anon" clásica es un JWT y va también como Authorization; la "publishable" nueva no.
    if (/^eyJ/.test(CONFIG.supabaseKey)) h.Authorization = 'Bearer ' + CONFIG.supabaseKey;
    return h;
  }

  async function pedir(consulta, opciones = {}) {
    const res = await fetch(CONFIG.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/reportes' + consulta, {
      ...opciones, headers: cabeceras(opciones.headers),
    });
    const cuerpo = await res.text();
    let datos = null;
    try { datos = cuerpo ? JSON.parse(cuerpo) : null; } catch { /* respuesta que no es JSON */ }
    if (!res.ok) {
      const e = new Error((datos && (datos.message || datos.hint)) || `Error ${res.status}`);
      e.estado = res.status;
      e.codigo = datos && datos.code;   // código de PostgreSQL o de la API (PGRST…)
      throw e;
    }
    return datos;
  }

  const deFila = f => ({
    id: f.id, t: Date.parse(f.t), creado: Date.parse(f.creado), tipo: f.tipo,
    colonia: f.colonia || null, coloniaTexto: f.colonia_texto || undefined,
    lat: f.lat ?? undefined, lng: f.lng ?? undefined,
    desdeDias: f.desde_dias ?? undefined, desdeAprox: f.desde_aprox || undefined,
    comentario: f.comentario || undefined, fuente: f.fuente,
  });
  const aFila = r => ({
    t: new Date(r.t).toISOString(), tipo: r.tipo, colonia: r.colonia,
    colonia_texto: r.coloniaTexto ?? null, lat: r.lat ?? null, lng: r.lng ?? null,
    desde_dias: r.desdeDias ?? null, desde_aprox: !!r.desdeAprox,
    comentario: r.comentario ?? null, fuente: r.fuente, dispositivo: idDispositivo(),
  });

  // propios: los que acaba de guardar este teléfono. No mueven la marca de "lo último que se vio",
  // para no saltarse lo que otros mandaron justo antes.
  function recibir(filas, todo, propios) {
    const nuevos = filas.map(deFila);
    if (todo) servidor = nuevos;
    else {
      const porId = new Map(servidor.map(r => [r.id, r]));
      for (const r of nuevos) porId.set(r.id, r);
      servidor = [...porId.values()];
    }
    // Solo se guardan los últimos DIAS_A_CARGAR días.
    const limite = Date.now() - DIAS_A_CARGAR * DIA;
    servidor = servidor.filter(r => r.t >= limite);
    if (!propios) for (const r of nuevos) if (r.creado > ultimoCreado) ultimoCreado = r.creado;
    estado.error = null;
    estado.actualizado = Date.now();
    escribir(CLAVE_COPIA, { reportes: servidor, ultimoCreado });
  }

  // La API devuelve de a 1000 filas como máximo: se pide por páginas.
  async function paginas(consulta) {
    const filas = [];
    for (let desde = 0; ; desde += 1000) {
      const pagina = await pedir(`${consulta}&limit=1000&offset=${desde}`);
      filas.push(...pagina);
      if (pagina.length < 1000) return filas;
    }
  }

  async function cargarTodo() {
    const desde = new Date(Date.now() - DIAS_A_CARGAR * DIA).toISOString();
    recibir(await paginas(`?select=${COLUMNAS}&t=gte.${encodeURIComponent(desde)}&order=t.asc,id.asc`), true);
  }

  async function traerNuevos() {
    if (!ultimoCreado) return cargarTodo();
    const desde = new Date(ultimoCreado).toISOString();
    recibir(await paginas(`?select=${COLUMNAS}&creado=gte.${encodeURIComponent(desde)}&order=creado.asc,id.asc`), false);
  }

  async function actualizar(todo) {
    try {
      await (todo ? cargarTodo() : traerNuevos());
    } catch (e) {
      estado.error = navigator.onLine === false ? 'sin-conexion' : 'no-carga';
    }
    combinar();
    avisarCambio();
  }

  async function enviarPendientes() {
    if (enviando || !pendientes.length) return;
    enviando = true;
    try {
      while (pendientes.length) {
        const lote = pendientes.slice(0, 50);
        let filas;
        try {
          filas = await pedir(`?select=${COLUMNAS}`, {
            method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(lote.map(aFila)),
          });
        } catch (e) {
          if (/limite_de_reportes/.test(e.message)) {
            avisar('Se mandaron muchos reportes seguidos desde este teléfono. Los que faltan se enviarán en unos minutos.');
            throw e;
          }
          if (/^2[23]/.test(e.codigo || '')) {
            // La base no los acepta por los datos (códigos 22… y 23… de PostgreSQL): reintentar no
            // serviría. Cualquier otro problema (tabla que falta, permisos) se reintenta después.
            const quitar = new Set(lote);
            pendientes = pendientes.filter(p => !quitar.has(p));
            console.warn('La base rechazó reportes:', e.message);
            avisar(`No se pudo guardar ${lote.length === 1 ? 'un reporte' : lote.length + ' reportes'}: la base de datos no lo aceptó.`);
            continue;
          }
          throw e;   // sin conexión o la base no respondió: se reintenta después
        }
        const enviados = new Set(lote);
        pendientes = pendientes.filter(p => !enviados.has(p));
        recibir(filas, false, true);
      }
    } catch (e) {
      estado.error = navigator.onLine === false ? 'sin-conexion' : estado.error || 'no-envia';
    } finally {
      enviando = false;
      escribir(CLAVE_PENDIENTES, pendientes);
      combinar();
      avisarCambio();
    }
  }

  AP.almacen = {
    modo: COMPARTIDO ? 'compartido' : 'local',

    // Carga lo guardado. En modo local, la primera vez llena con datos de ejemplo para probar.
    iniciar(generarEjemplo) {
      cambiosColonias = Object.assign({ ubicaciones: {}, nuevas: [] }, leer(CLAVE_COLONIAS));
      if (COMPARTIDO) {
        const copia = leer(CLAVE_COPIA);
        if (copia && Array.isArray(copia.reportes)) { servidor = copia.reportes; ultimoCreado = copia.ultimoCreado || 0; }
        pendientes = leer(CLAVE_PENDIENTES) || [];
        combinar();
        actualizar(true).then(enviarPendientes);
        setInterval(() => actualizar(false).then(enviarPendientes), CADA_MINUTO);
        setInterval(() => actualizar(true), RECARGA_COMPLETA);
        addEventListener('online', () => actualizar(false).then(enviarPendientes));
        document.addEventListener('visibilitychange', () => { if (!document.hidden) actualizar(false).then(enviarPendientes); });
        return;
      }
      const guardados = leer(CLAVE_REPORTES);
      locales = Array.isArray(guardados) ? guardados : generarEjemplo();
      if (!Array.isArray(guardados)) escribir(CLAVE_REPORTES, locales);
      combinar();
      // Si la app está abierta en otra pestaña, mantener ambas al día.
      addEventListener('storage', e => {
        if (e.key === CLAVE_REPORTES) { locales = leer(CLAVE_REPORTES) || []; combinar(); avisarCambio(); }
      });
    },
    todos: () => reportes,
    agregar(r) { return AP.almacen.agregarVarios([r])[0]; },
    agregarVarios(lista) {
      const nuevos = lista.map(limpiar);
      if (COMPARTIDO) {
        // Se ve de inmediato y se envía en segundo plano (o cuando vuelva la señal).
        pendientes.push(...nuevos);
        escribir(CLAVE_PENDIENTES, pendientes);
        enviarPendientes();
      } else {
        locales.push(...nuevos);
        escribir(CLAVE_REPORTES, locales);
      }
      combinar();
      avisarCambio();
      return nuevos;
    },
    hayEjemplos: () => !COMPARTIDO && locales.some(r => r.fuente === 'demo'),
    borrarEjemplos() {
      locales = locales.filter(r => r.fuente !== 'demo');
      escribir(CLAVE_REPORTES, locales);
      combinar();
      avisarCambio();
    },
    // Estado de la conexión con la base compartida: error ('sin-conexion', 'no-carga', 'no-envia'
    // o null), cuántos reportes faltan por enviar y cuándo se actualizó.
    estado: () => ({ ...estado, pendientes: pendientes.length }),
    actualizar: () => actualizar(false).then(enviarPendientes),
    alCambiar: f => oyentes.add(f),
    alAviso: f => avisos.add(f),

    // Ajustes locales a js/colonias.js: ubicaciones puestas a mano y colonias que faltaban.
    cambiosColonias: () => cambiosColonias,
    ubicarColonia(id, lat, lng) {
      const punto = [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5];
      // Una colonia agregada en este navegador se mueve en su propia entrada.
      const nueva = cambiosColonias.nuevas.find(c => AP.util.idDeNombre(c.nombre) === id);
      if (nueva) [nueva.lat, nueva.lng] = punto;
      else cambiosColonias.ubicaciones[id] = punto;
      escribir(CLAVE_COLONIAS, cambiosColonias);
    },
    agregarColonia(nombre, lat, lng) {
      cambiosColonias.nuevas.push({ nombre, lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 });
      escribir(CLAVE_COLONIAS, cambiosColonias);
    },
    olvidarCambioColonia(id) {
      delete cambiosColonias.ubicaciones[id];
      cambiosColonias.nuevas = cambiosColonias.nuevas.filter(c => AP.util.idDeNombre(c.nombre) !== id);
      escribir(CLAVE_COLONIAS, cambiosColonias);
    },
  };
})(window.AP);
