// Datos de ejemplo para probar la app: reportes inventados de los últimos 40 días, marcados
// con fuente "demo" y borrables con un botón. Siempre salen iguales (semilla fija),
// pero se acomodan a la fecha de hoy.
(function (AP) {
  const { H, claveDia, inicioDia, sumarDias, azarConSemilla } = AP.util;

  const COMENTARIOS = {
    sin_agua: ['Desde la mañana no cae nada', 'Ni una gota desde ayer', 'Ya se acabó lo del tinaco', 'Llamamos y nadie contesta'],
    baja_presion: ['Llega muy poquita, no sube al tinaco', 'Sale un hilito nomás en la noche'],
    agua_sucia: ['Sale café al abrir la llave', 'Sale turbia y con olor'],
    fuga: ['Se está tirando el agua en la esquina desde hace días', 'Tubo roto frente a la tienda'],
    regreso: ['Ya cayó el agua como a las 6', 'Ya llegó el agua'],
  };

  AP.generarEjemplo = function (ahora = Date.now()) {
    const azar = azarConSemilla(2026);
    const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
    const hoy = claveDia(ahora);
    const horaActual = (ahora - inicioDia(hoy)) / H;
    const reportes = [];

    function momento(diasAtras, desdeHora = 6) {
      const base = inicioDia(sumarDias(hoy, -diasAtras));
      const max = diasAtras === 0 ? Math.max(0.3, horaActual - 0.2) : 22.5;
      const min = Math.min(desdeHora, max * 0.6);
      return base + (min + azar() * (max - min)) * H;
    }
    function reportar(colonia, tipo, diasAtras, extra) {
      const r = { t: momento(diasAtras), tipo, colonia, fuente: 'demo', ...extra };
      if (azar() < 0.3) r.comentario = COMENTARIOS[tipo][entre(0, COMENTARIOS[tipo].length - 1)];
      reportes.push(r);
    }
    function episodio(colonia, tipo, desde, hasta, porDia, regresa) {
      for (let d = desde; d >= hasta; d--) {
        const n = entre(porDia[0], porDia[1]);
        for (let k = 0; k < n; k++) reportar(colonia, tipo, d, { desdeDias: desde - d });
      }
      if (regresa) reportar(colonia, 'regreso', hasta);
    }

    // Colonias con zona de buen tamaño (las de uno o dos hexágonos son fraccionamientos chicos), en
    // un orden revuelto pero fijo.
    const ubicadas = [...AP.geo.celdasDe.entries()].filter(([, celdas]) => celdas.length >= 5).map(([id]) => id).sort()
      .map(id => [azar(), id]).sort((a, b) => a[0] - b[0]).map(p => p[1]);
    const sinUbicar = AP.geo.colonias.filter(c => c.lat == null).map(c => c.id);
    const [c1, c2, c3, o1, o2, o3, ...resto] = ubicadas;

    // Historia: unas colonias se quedan sin agua seguido, otras de vez en cuando.
    for (const id of [c1, c2, c3]) {
      let dia = 40 - entre(0, 3);
      while (dia > 4) {
        const dura = entre(1, 4);
        episodio(id, azar() < 0.8 ? 'sin_agua' : 'baja_presion', dia, Math.max(dia - dura + 1, 4), [2, 7], true);
        dia -= dura + entre(2, 6);
      }
    }
    for (const id of [o1, o2, o3]) {
      let dia = 38 - entre(0, 8);
      while (dia > 4) {
        const dura = entre(1, 2);
        episodio(id, azar() < 0.7 ? 'sin_agua' : 'baja_presion', dia, Math.max(dia - dura + 1, 4), [1, 3], true);
        dia -= dura + entre(7, 14);
      }
    }
    for (const id of resto) {
      const dia = entre(8, 35);
      if (azar() < 0.6) episodio(id, 'sin_agua', dia, dia, [1, 2], true);
    }

    // Lo que está pasando ahora.
    if (c1) episodio(c1, 'sin_agua', 2, 0, [3, 6], false);
    if (c2) episodio(c2, 'sin_agua', 0, 0, [3, 5], false);
    if (c3) episodio(c3, 'baja_presion', 1, 0, [2, 3], false);
    if (o1) episodio(o1, 'sin_agua', 1, 1, [3, 4], true);
    if (o2) { reportar(o2, 'agua_sucia', 0); reportar(o2, 'agua_sucia', 0); }
    if (sinUbicar.length) episodio(sinUbicar[entre(0, sinUbicar.length - 1)], 'sin_agua', 1, 0, [1, 2], false);

    // Fugas con ubicación (cerca del centro de su colonia).
    for (const id of [o3, c3]) {
      const p = id && AP.geo.puntoEtiqueta(id);
      if (p) reportar(id, 'fuga', 0, { lat: p[0] + (azar() - 0.5) * 0.004, lng: p[1] + (azar() - 0.5) * 0.004 });
    }

    // Nada en el futuro: el "ahora" de hoy es la hora actual.
    return reportes.filter(r => r.t <= ahora).map((r, i) => ({ id: 'demo' + i, ...r }));
  };
})(window.AP);
