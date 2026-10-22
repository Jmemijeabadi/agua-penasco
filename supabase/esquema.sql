-- Agua Peñasco: la tabla de reportes compartidos en Supabase.
--
-- Cómo usarlo: en el panel de Supabase, SQL Editor → New query → pegar todo este archivo → Run.
-- Se puede volver a correr sin perder reportes.
--
-- Qué permite: cualquiera con la clave pública de la página puede LEER reportes y AGREGAR reportes
-- nuevos. Nadie puede cambiarlos ni borrarlos desde la página; eso solo se hace desde el panel.
-- Para esconder un reporte falso: Table Editor → reportes → poner "oculto" en true.

create table if not exists public.reportes (
  id           uuid primary key default gen_random_uuid(),
  creado       timestamptz not null default now(),   -- cuándo llegó a la base (lo pone la base)
  t            timestamptz not null,                 -- cuándo pasó (o cuándo se publicó en Facebook)
  tipo         text not null check (tipo in ('sin_agua', 'baja_presion', 'agua_sucia', 'fuga', 'regreso')),
  colonia      text check (char_length(colonia) <= 80),          -- clave de la colonia en js/colonias.js
  colonia_texto text check (char_length(colonia_texto) <= 60),   -- colonia escrita a mano, si no está en la lista
  lat          double precision check (lat between 30.9 and 31.7),        -- redondeada a ~100 m por la app
  lng          double precision check (lng between -114.2 and -113.0),
  desde_dias   smallint check (desde_dias between 0 and 365),
  desde_aprox  boolean not null default false,
  comentario   text check (char_length(comentario) <= 200),
  fuente       text not null default 'app' check (fuente in ('app', 'facebook', 'whatsapp')),
  dispositivo  text check (char_length(dispositivo) <= 40),     -- número al azar por teléfono (contra abusos)
  oculto       boolean not null default false,
  constraint reporte_con_lugar check (colonia is not null or colonia_texto is not null or lat is not null),
  -- Lo importado de Facebook puede ser de días antes, pero no de hace más de un mes ni del futuro.
  constraint reporte_fecha_razonable check (t > creado - interval '31 days' and t < creado + interval '10 minutes')
);

create index if not exists reportes_por_hora on public.reportes (t);
create index if not exists reportes_por_llegada on public.reportes (creado);
create index if not exists reportes_por_dispositivo on public.reportes (dispositivo, creado);

-- Permisos: la página (roles anon y authenticated) solo lee ciertas columnas y solo agrega.
-- "dispositivo" no se puede leer y "oculto"/"creado" no se pueden escribir desde la página.
alter table public.reportes enable row level security;
revoke all on public.reportes from anon, authenticated;
grant select (id, creado, t, tipo, colonia, colonia_texto, lat, lng, desde_dias, desde_aprox, comentario, fuente)
  on public.reportes to anon, authenticated;
grant insert (t, tipo, colonia, colonia_texto, lat, lng, desde_dias, desde_aprox, comentario, fuente, dispositivo)
  on public.reportes to anon, authenticated;

drop policy if exists "leer reportes" on public.reportes;
create policy "leer reportes" on public.reportes
  for select to anon, authenticated using (not oculto);

drop policy if exists "agregar reportes" on public.reportes;
create policy "agregar reportes" on public.reportes
  for insert to anon, authenticated with check (not oculto);

-- Límite contra spam: hasta 60 reportes cada 10 minutos por teléfono (importar un hilo de
-- Facebook manda varios de golpe) y 300 por minuto en total.
create or replace function public.limitar_reportes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  recientes integer;
begin
  new.creado := now();
  new.oculto := false;
  if new.dispositivo is not null then
    select count(*) into recientes from public.reportes
      where dispositivo = new.dispositivo and creado > now() - interval '10 minutes';
    if recientes >= 60 then
      raise exception 'limite_de_reportes' using hint = 'Demasiados reportes seguidos desde este teléfono.';
    end if;
  end if;
  select count(*) into recientes from public.reportes where creado > now() - interval '1 minute';
  if recientes >= 300 then
    raise exception 'limite_de_reportes' using hint = 'Demasiados reportes en este momento.';
  end if;
  return new;
end;
$$;

revoke all on function public.limitar_reportes() from public, anon, authenticated;

drop trigger if exists limitar_reportes on public.reportes;
create trigger limitar_reportes before insert on public.reportes
  for each row execute function public.limitar_reportes();
