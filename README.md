# Agua Peñasco

Mapa comunitario para reportar en qué colonias de Puerto Peñasco falta el agua, con historial.
No es oficial ni compite con el organismo del agua: junta en un solo lugar las quejas que hoy
se pierden en llamadas y grupos de Facebook, y deja evidencia que se puede presentar.

## Abrirla

Doble clic en `index.html`. No necesita internet: el mapa lo dibuja la propia app (ver abajo).
También funciona con la extensión *Live Server* de VS Code.

La primera vez aparecen **datos de ejemplo** (inventados, marcados como tales) para que se vea
cómo funciona. El botón **Borrar ejemplos** los quita.

## Qué hace

- **Reportar** en tres toques: qué pasa (no hay agua, llega muy poca, sale sucia, fuga, ya
  regresó), la colonia (escrita, por GPS o tocando el mapa), desde cuándo y un comentario opcional.
- **Mapa por colonia** con tres vistas:
  - *Últimas 24 h*: rojo sin agua, ámbar poca presión, azul ya regresó. Más intenso = más reportes.
  - *Día por día*: se puede reproducir el último mes como animación.
  - *30 días*: qué colonias pasaron más días sin agua.
- **Ficha de cada colonia**: cuántos días seguidos lleva sin agua, los últimos 30 días y los
  reportes recientes. Botón para compartir por WhatsApp.
- **Historial**: reportes por día de toda la ciudad, ranking de colonias, **resumen listo para
  pegar en Facebook o WhatsApp** y descarga en **CSV** (abre en Excel) como evidencia.
- **Importar de Facebook o WhatsApp**: se copian publicaciones y comentarios de los grupos (o un
  chat exportado de WhatsApp), se pegan, y la app detecta colonia, problema y fecha
  (“en la Obrera no hay agua desde ayer”, “3 h”, “Nueva Esperanza igual”…). Se revisa y se agrega.
  No se guardan nombres ni el texto.
- **Colonias del mapa** (pestaña *Acerca*): para ubicar con un toque las colonias que faltan.

### ¿Por qué pegar y no leer Facebook automáticamente?

Los grupos piden iniciar sesión, Facebook prohíbe el *scraping* en sus condiciones y bloquea las
cuentas que lo hacen, y Meta cerró en 2024 la API que permitía leer grupos. Además, son
publicaciones de vecinos con su nombre. Copiar y pegar lo puede hacer cualquier voluntario o
administrador del grupo, y solo se guarda colonia, problema y fecha.

Lo que más ayuda: pedir a los administradores de los grupos que fijen el enlace de la app y
publicar el resumen diario de vuelta en los grupos.

## Dónde está publicada

**https://jmemijeabadi.github.io/agua-penasco/** (GitHub Pages, gratis). Cada cambio que se sube a
la rama `main` de [este repositorio](https://github.com/Jmemijeabadi/agua-penasco) se publica
solo en uno o dos minutos.

## Lo que falta

1. **Conectar la base de datos compartida** (ver abajo). El código ya está listo: solo hay que
   crear el proyecto de Supabase y poner su dirección y clave pública en `js/config.js`.
2. **Que alguien de Peñasco revise las colonias.** Están todas ubicadas (ver abajo), pero las de
   confianza "media" y los límites entre colonias vecinas conviene que los confirme alguien que
   conozca la ciudad. Se corrigen desde *Acerca → Colonias del mapa* y luego se reemplaza
   `js/colonias.js` con el archivo descargado.
3. Opcional: un captcha ligero (Cloudflare Turnstile) si llegara spam a pesar del límite por
   teléfono, y un número de WhatsApp que reciba reportes ("sin agua obrera") con el mismo detector
   de texto.

## Las colonias

Están las 43 colonias y fraccionamientos urbanos del catálogo oficial de códigos postales (SEPOMEX),
más 2 que tienen polígono propio en el INE o negocios en el DENUE (Bosques de San Rafael e Islas
del Mar). Todas tienen ubicación: 34 con confianza alta y 11 media.

- **Dónde está cada una** (`js/colonias.js`): se investigó una por una con el DENUE de INEGI
  (4,548 negocios de Peñasco, cada uno con su colonia y coordenadas), los polígonos de colonia de
  la cartografía electoral del INE, OpenStreetMap y fuentes públicas (anuncios de casas, obras del
  ayuntamiento, noticias), y cada ubicación la revisó un segundo investigador tratando de
  refutarla. Las fuentes de cada una están en `datos/colonias-fuentes.json`.
- **Sus zonas en el mapa** (`js/zonas.js`): cada hexágono toma la colonia del límite oficial que
  lo contiene: polígono de colonia del INE o de localidad del INEGI (36 de las 45 tienen uno); si no
  hay, la que declaran casi todos sus negocios en el DENUE; y si tampoco, la colonia más cercana sin
  pasar de su tamaño. Los condominios de la zona hotelera quedan sin colonia. Para un punto exacto
  (GPS o un toque en el mapa) se usa el límite oficial, no el hexágono.
- **Una decisión a revisar**: el INE dibuja Josefa Ortiz de Domínguez, La Termoeléctrica y El
  Cárcamo mucho más grandes de lo que la gente las usa: dentro de esos polígonos casi todos los
  negocios dicen ser de Oriente (242 de 251, 42 de 43 y 22 de 22). Ahí el mapa pinta Oriente; las
  tres colonias conservan su punto y se pueden reportar. Se cambia en `herramientas/descargar-ine.js`.
- **Cómo la escribe la gente** (`alias` en `js/colonias.js`): "la Benito", "el Mirador", "la
  Infonavit", "Las Dunas"… El lector de Facebook usa esos alias.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html`, `css/estilos.css` | La página |
| `js/app.js` | Pantallas, formulario, importación, historial y editor de colonias |
| `js/almacen.js` | Dónde se guardan los reportes (lo que se cambia por una base de datos) |
| `js/estado.js` | Reglas: qué color lleva cada colonia y cuántos días lleva sin agua |
| `js/detector.js` | Lee texto de Facebook/WhatsApp y propone reportes |
| `js/mapa.js`, `js/geo.js` | Mapa (Leaflet) y hexágonos por colonia |
| `js/fondo.js`, `js/mapa-base.js` | Mapa de fondo dibujado por la app y sus datos (generado) |
| `js/graficas.js` | Gráficas del historial |
| `js/demo.js` | Datos de ejemplo |
| `js/colonias.js` | Lista de colonias (editable) |
| `js/zonas.js` | Hexágonos de zonas habitadas y su colonia según INE y DENUE (generado) |
| `vendor/leaflet` | Leaflet 1.9.4 |
| `datos/` | Datos de origen: OpenStreetMap, negocios del DENUE, límites del INE y del INEGI, equivalencias de nombres y fuentes de cada colonia |
| `herramientas/generar-mapa-base.js` | Regenera `js/mapa-base.js` |
| `herramientas/generar-zonas.js` | Regenera `js/zonas.js` |
| `herramientas/extraer-denue.js` | Extrae del DENUE de INEGI los negocios de Peñasco con su colonia |
| `herramientas/descargar-ine.js` | Descarga los límites de colonias del INE y los empareja con `js/colonias.js` |
| `herramientas/extraer-inegi-localidades.js` | Saca del Marco Geoestadístico de INEGI los límites de Las Conchas, La Choya, Lomas Campestres e Islas del Mar |

Para actualizar con datos nuevos de OpenStreetMap (calles o costa recién mapeadas):

```
node herramientas/generar-mapa-base.js --descargar
node herramientas/generar-zonas.js --descargar-calles
```

## Datos y licencias

- Calles, costa y lugares: © colaboradores de OpenStreetMap, licencia ODbL.
- Negocios con su colonia y ubicación: INEGI, Directorio Estadístico Nacional de Unidades
  Económicas (DENUE), abril de 2026, bajo los términos de libre uso de INEGI.
- Límites de colonias: INE, Cartografía Electoral (servicio WMS público, capa COLONIA), e INEGI,
  Marco Geoestadístico 2024 (localidades).
- Nombres de colonias: catálogo de códigos postales de SEPOMEX, tomado de una copia pública
  (micodigopostal.org) porque el sitio de Correos de México no respondió. Conviene revisarlo
  contra la descarga oficial.
- Mapa: [Leaflet](https://leafletjs.com) (BSD-2).
