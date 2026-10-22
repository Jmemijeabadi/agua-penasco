// Base de datos compartida (Supabase). Si se dejan vacíos, la app guarda los reportes solo en el
// navegador de cada quien (modo de prueba, con datos de ejemplo).
// La clave es la "anon" (o "publishable") del proyecto: es pública por diseño, va en la página.
// Lo que se puede hacer con ella lo limitan los permisos de supabase/esquema.sql: leer y agregar
// reportes, nunca cambiarlos ni borrarlos. Nunca pongas aquí la clave "service_role" o "secret".
window.AGUA_CONFIG = {
  supabaseUrl: '',   // por ejemplo 'https://abcdefghijklmnop.supabase.co'
  supabaseKey: '',
};
