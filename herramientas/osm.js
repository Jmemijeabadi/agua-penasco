// Descarga de datos de OpenStreetMap (Overpass) con reintentos y caché en datos/.
// Lo usan generar-zonas.js y generar-mapa-base.js. Datos: © colaboradores de OpenStreetMap, ODbL.
const fs = require('fs');
const path = require('path');

const SERVIDORES = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function consultarOverpass(consulta) {
  let espera = 15;
  for (let ronda = 1; ronda <= 7; ronda++) {
    for (const url of SERVIDORES) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'aguapenasco/0.1 (mapa comunitario de reportes de agua)',
            Accept: 'application/json',
          },
          body: 'data=' + encodeURIComponent(consulta),
          signal: AbortSignal.timeout(200000),
        });
        const texto = await res.text();
        if (res.ok && texto.trimStart().startsWith('{')) return JSON.parse(texto);
        console.warn(`  ${url} respondió ${res.status}`);
      } catch (e) {
        console.warn(`  ${url} falló: ${e.message}`);
      }
    }
    console.warn(`  Ronda ${ronda} sin éxito; reintentando en ${espera} s…`);
    await new Promise(r => setTimeout(r, espera * 1000));
    espera *= 2;
  }
  throw new Error('Ningún servidor de Overpass respondió. Intenta más tarde.');
}

// Lee el archivo si ya existe; si no (o si forzar), lo descarga y lo guarda.
async function cargarOsm(archivo, consulta, forzar) {
  if (!forzar && fs.existsSync(archivo)) return JSON.parse(fs.readFileSync(archivo, 'utf8'));
  console.log(`Descargando ${path.basename(archivo)} de OpenStreetMap…`);
  const datos = await consultarOverpass(consulta);
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(datos));
  return datos;
}

module.exports = { consultarOverpass, cargarOsm };
