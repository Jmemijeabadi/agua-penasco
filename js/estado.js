// De reportes sueltos a "cómo está cada colonia". Aquí viven las reglas:
//  - Un "ya regresó el agua" cierra los reportes de falta de agua anteriores a él.
//  - Si quedan reportes abiertos, manda el peor: sin agua > poca presión.
//  - Agua sucia y fugas no pintan la zona (son otro tipo de problema); se muestran aparte.
(function (AP) {
  const { D, claveDia, inicioDia, sumarDias } = AP.util;
  const PEOR_A_MEJOR = ['sin_agua', 'baja_presion', 'agua_sucia', 'regreso'];

  const conteoVacio = () => ({ sin_agua: 0, baja_presion: 0, agua_sucia: 0, fuga: 0, regreso: 0 });

  function resumir(lista) {
    const conteo = conteoVacio();
    let ultimoRegreso = -Infinity, ultimo = -Infinity;
    for (const r of lista) {
      conteo[r.tipo]++;
      if (r.tipo === 'regreso' && r.t > ultimoRegreso) ultimoRegreso = r.t;
      if (r.t > ultimo) ultimo = r.t;
    }
    let sinAgua = 0, poca = 0;
    for (const r of lista) {
      if (r.t < ultimoRegreso) continue;
      if (r.tipo === 'sin_agua') sinAgua++;
      else if (r.tipo === 'baja_presion') poca++;
    }
    let estado = null, intensidad = 0;
    if (sinAgua) { estado = 'sin_agua'; intensidad = sinAgua; }
    else if (poca) { estado = 'baja_presion'; intensidad = poca; }
    else if (conteo.regreso) { estado = 'regreso'; intensidad = conteo.regreso; }
    return { estado, intensidad, conteo, ultimo, total: lista.length };
  }

  // Reportes de [desde, hasta) agrupados por colonia.
  function agrupar(reportes, desde, hasta) {
    const grupos = new Map();
    const sinColonia = [];
    for (const r of reportes) {
      if (r.t < desde || r.t >= hasta) continue;
      if (!r.colonia) { sinColonia.push(r); continue; }
      if (!grupos.has(r.colonia)) grupos.set(r.colonia, []);
      grupos.get(r.colonia).push(r);
    }
    return { grupos, sinColonia };
  }

  // Estado de cada colonia en una ventana de tiempo (las últimas 24 h, o un día del historial).
  function ventana(reportes, desde, hasta) {
    const { grupos, sinColonia } = agrupar(reportes, desde, hasta);
    const porColonia = new Map([...grupos].map(([id, lista]) => [id, resumir(lista)]));
    const fugas = reportes.filter(r => r.tipo === 'fuga' && r.lat != null && r.t >= desde && r.t < hasta);
    return { modo: 'estado', desde, hasta, porColonia, sinColonia, fugas };
  }

  // Últimos n días: cuántos días distintos hubo reportes de "no hay agua" en cada colonia.
  function acumulado(reportes, n, ahora) {
    const hasta = inicioDia(claveDia(ahora)) + D;
    const desde = hasta - n * D;
    const { grupos, sinColonia } = agrupar(reportes, desde, hasta);
    const porColonia = new Map();
    for (const [id, lista] of grupos) {
      const conteo = conteoVacio();
      const diasSinAgua = new Set(), diasPoca = new Set();
      let ultimo = -Infinity;
      for (const r of lista) {
        conteo[r.tipo]++;
        if (r.tipo === 'sin_agua') diasSinAgua.add(claveDia(r.t));
        if (r.tipo === 'baja_presion') diasPoca.add(claveDia(r.t));
        if (r.t > ultimo) ultimo = r.t;
      }
      porColonia.set(id, { diasSinAgua: diasSinAgua.size, diasPoca: diasPoca.size, conteo, ultimo, total: lista.length });
    }
    return { modo: 'acumulado', desde, hasta, dias: n, porColonia, sinColonia, fugas: [] };
  }

  // Conteo por tipo para cada día (toda la ciudad o una sola colonia).
  function porDia(reportes, claves, colonia) {
    const filas = new Map(claves.map(c => [c, { clave: c, conteo: conteoVacio() }]));
    for (const r of reportes) {
      if (colonia && r.colonia !== colonia) continue;
      const fila = filas.get(claveDia(r.t));
      if (fila) fila.conteo[r.tipo]++;
    }
    for (const fila of filas.values()) {
      fila.peor = PEOR_A_MEJOR.find(t => fila.conteo[t] > 0) || null;
    }
    return [...filas.values()];
  }

  // Cuántos días seguidos lleva una colonia sin agua según los reportes (0 si ya regresó).
  function diasSinAgua(reportes, colonia, ahora) {
    const lista = reportes.filter(r => r.colonia === colonia);
    const ultimoRegreso = lista.reduce((m, r) => (r.tipo === 'regreso' && r.t > m ? r.t : m), -Infinity);
    const abiertos = lista.filter(r => r.tipo === 'sin_agua' && r.t >= ultimoRegreso);
    const dias = new Set(abiertos.map(r => claveDia(r.t)));
    // La racha tiene que seguir viva: con reportes hoy o, si todavía nadie reporta hoy, ayer.
    let fin = claveDia(ahora);
    if (!dias.has(fin)) fin = sumarDias(fin, -1);
    if (!dias.has(fin)) return 0;
    let inicio = fin;
    while (dias.has(sumarDias(inicio, -1))) inicio = sumarDias(inicio, -1);
    // Quien reportó dijo desde cuándo: eso puede alargar la racha hacia atrás.
    for (const r of abiertos) {
      const dia = claveDia(r.t);
      if (r.desdeDias != null && dia >= inicio) {
        const desde = sumarDias(dia, -r.desdeDias);
        if (desde < inicio) inicio = desde;
      }
    }
    return Math.round((inicioDia(fin) - inicioDia(inicio)) / D) + 1;
  }

  AP.estado = {
    PEOR_A_MEJOR,
    resumir,
    ahora: (reportes, ahora) => ventana(reportes, ahora - D, ahora + 1),
    delDia: (reportes, clave) => ventana(reportes, inicioDia(clave), inicioDia(clave) + D),
    acumulado,
    porDia,
    diasSinAgua,
  };
})(window.AP);
