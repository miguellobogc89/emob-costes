-- =====================================================================
--  eMob · Costes de energía — esquema para Supabase
--  Pegar entero en Supabase > SQL Editor > New query > Run.
--  Se puede volver a ejecutar sin perder datos (crea solo lo que falta
--  y redefine funciones y reglas).
-- =====================================================================

-- Margen de tiempo para esta ejecución (la primera vez revisa todas las facturas)
set statement_timeout = '5min';

-- ---------------------------------------------------------------- tablas
create table if not exists public.cabeceras (
  id        bigint generated always as identity primary key,
  huella    text not null unique,          -- huella de la lista de columnas
  columnas  text[] not null,               -- nombres de columna en su orden original
  creado    timestamptz not null default now()
);

create table if not exists public.cargas (
  id                  bigint generated always as identity primary key,
  fecha               timestamptz not null default now(),
  usuario             uuid default auth.uid(),
  usuario_email       text default (auth.jwt() ->> 'email'),
  archivos            text[] not null default '{}',
  leidas              int not null default 0,
  duplicadas_en_carga int not null default 0,
  ya_existentes       int not null default 0,
  nuevas              int not null default 0
);

create table if not exists public.facturas (
  huella          text primary key,          -- huella del contenido: evita duplicados
  carga_id        bigint references public.cargas(id) on delete set null,
  cabecera_id     bigint not null references public.cabeceras(id),
  sheet_code      text,
  archivo_origen  text,
  id_factura      text,
  estado          text,                      -- N normal · C anulada · R rectificativa
  cups            text,
  direccion       text,
  distribuidora   text,
  tarifa          text,
  tipo_lectura    text,
  fecha_emision   date,
  fecha_desde     date,
  fecha_hasta     date,
  mes_emision     text,                      -- AAAA-MM
  kwh             numeric,                   -- CONSUMO TOTAL ACTIVA
  kwh_p1 numeric, kwh_p2 numeric, kwh_p3 numeric, kwh_p4 numeric, kwh_p5 numeric, kwh_p6 numeric,
  imp_neto        numeric,                   -- IMPORTE NETO PSEUDO (sin IVA)
  imp_total       numeric,                   -- IMPORTE TOTAL PSEUDO (con IVA)
  imp_energia     numeric,
  imp_potencia    numeric,
  imp_exceso      numeric,
  imp_alquiler    numeric,
  imp_ie          numeric,
  imp_otros       numeric,
  imp_iva         numeric,
  valores         jsonb not null,            -- fila original completa (array en el orden de la cabecera)
  creado          timestamptz not null default now()
);

create index if not exists facturas_fecha_hasta_idx   on public.facturas (fecha_hasta);
create index if not exists facturas_fecha_emision_idx on public.facturas (fecha_emision);
create index if not exists facturas_cups_idx          on public.facturas (cups);
create index if not exists facturas_carga_idx         on public.facturas (carga_id);

-- Quién puede vaciar datos
create table if not exists public.admins (
  email text primary key
);

-- ---------------------------------------------------------------- seguridad
create or replace function public.es_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a
                 where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

alter table public.cabeceras enable row level security;
alter table public.cargas    enable row level security;
alter table public.facturas  enable row level security;
alter table public.admins    enable row level security;

drop policy if exists cab_leer      on public.cabeceras;
drop policy if exists cab_insertar  on public.cabeceras;
drop policy if exists cab_borrar    on public.cabeceras;
create policy cab_leer     on public.cabeceras for select to authenticated using (true);
create policy cab_insertar on public.cabeceras for insert to authenticated with check (true);
create policy cab_borrar   on public.cabeceras for delete to authenticated using (public.es_admin());

drop policy if exists car_leer       on public.cargas;
drop policy if exists car_insertar   on public.cargas;
drop policy if exists car_actualizar on public.cargas;
drop policy if exists car_borrar     on public.cargas;
create policy car_leer       on public.cargas for select to authenticated using (true);
create policy car_insertar   on public.cargas for insert to authenticated with check (usuario = auth.uid());
create policy car_actualizar on public.cargas for update to authenticated using (usuario = auth.uid()) with check (usuario = auth.uid());
create policy car_borrar     on public.cargas for delete to authenticated using (public.es_admin());

drop policy if exists fac_leer     on public.facturas;
drop policy if exists fac_insertar on public.facturas;
drop policy if exists fac_borrar   on public.facturas;
create policy fac_leer     on public.facturas for select to authenticated using (true);
create policy fac_insertar on public.facturas for insert to authenticated with check (true);
create policy fac_borrar   on public.facturas for delete to authenticated using (public.es_admin());

drop policy if exists adm_leer on public.admins;
create policy adm_leer on public.admins for select to authenticated using (true);

revoke all on public.cabeceras, public.cargas, public.facturas, public.admins from anon;
grant select, insert, delete          on public.cabeceras to authenticated;
grant select, insert, update, delete  on public.cargas    to authenticated;
grant select, insert, delete          on public.facturas  to authenticated;
grant select                          on public.admins    to authenticated;


-- ---------------------------------------------------------------- correcciones
-- Reglas que modifican cómo cuentan las filas en todos los cálculos (sin tocar el dato original):
--   negativo -> consumos e importes pasan a negativo (p. ej. facturas anuladoras, estado A)
--   excluir  -> la fila no cuenta en ningún cálculo
create table if not exists public.correcciones (
  id         bigint generated always as identity primary key,
  campo      text not null check (campo in ('estado','cups','id_factura','tipo_lectura','distribuidora','tarifa','sheet_code','archivo_origen')),
  valor      text not null,
  accion     text not null check (accion in ('negativo','excluir')),
  nota       text,
  activa     boolean not null default true,
  creado     timestamptz not null default now(),
  creado_por text default (auth.jwt() ->> 'email')
);
insert into public.correcciones (campo, valor, accion, nota, creado_por)
select 'estado', 'A', 'negativo', 'Facturas anuladoras: restan consumo e importes', 'sistema'
where not exists (select 1 from public.correcciones where campo = 'estado' and valor = 'A');

alter table public.correcciones enable row level security;
drop policy if exists cor_leer on public.correcciones;
drop policy if exists cor_admin on public.correcciones;
create policy cor_leer  on public.correcciones for select to authenticated using (true);
create policy cor_admin on public.correcciones for all    to authenticated using (public.es_admin()) with check (public.es_admin());
revoke all on public.correcciones from anon;
grant select, insert, update, delete on public.correcciones to authenticated;

create or replace function public._campo(f public.facturas, campo text)
returns text language sql immutable as $$
  select case campo
    when 'estado' then f.estado when 'cups' then f.cups when 'id_factura' then f.id_factura
    when 'tipo_lectura' then f.tipo_lectura when 'distribuidora' then f.distribuidora
    when 'tarifa' then f.tarifa when 'sheet_code' then f.sheet_code when 'archivo_origen' then f.archivo_origen end;
$$;

create or replace function public._regla(f public.facturas, p_accion text)
returns boolean language sql stable as $$
  select exists (select 1 from public.correcciones r
                 where r.activa and r.accion = p_accion
                   and upper(trim(public._campo(f, r.campo))) = upper(trim(r.valor)));
$$;

create or replace function public._neg(v numeric, neg boolean)
returns numeric language sql immutable as $$ select case when neg then -abs(v) else v end; $$;

create or replace function public._fb(emision date, hasta date, p_base text)
returns date language sql immutable as $$ select case when p_base = 'emision' then emision else hasta end; $$;

-- Las marcas de corrección se guardan en cada fila (rápido de consultar) y se recalculan
-- solo al insertar facturas o al cambiar las reglas.
alter table public.facturas add column if not exists negativa boolean not null default false;
alter table public.facturas add column if not exists excluida boolean not null default false;

create or replace function public.tg_facturas_marcas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.negativa := public._regla(new, 'negativo');
  new.excluida := public._regla(new, 'excluir');
  return new;
end;
$$;
drop trigger if exists facturas_marcas on public.facturas;
create trigger facturas_marcas before insert on public.facturas
  for each row execute function public.tg_facturas_marcas();

create or replace function public.recalcular_correcciones()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.facturas f
     set negativa = m.neg, excluida = m.exc
    from (select f2.huella,
                 coalesce(bool_or(r.accion = 'negativo'), false) neg,
                 coalesce(bool_or(r.accion = 'excluir'), false) exc
            from public.facturas f2
            left join public.correcciones r
              on r.activa and upper(trim(r.valor)) = upper(trim(public._campo(f2, r.campo)))
           group by f2.huella) m
   where m.huella = f.huella
     and (f.negativa <> m.neg or f.excluida <> m.exc);
end;
$$;

create or replace function public.tg_correcciones()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recalcular_correcciones();
  if to_regprocedure('public.refrescar_cache()') is not null then perform public.refrescar_cache(); end if;
  return null;
end;
$$;
drop trigger if exists correcciones_cambio on public.correcciones;
create trigger correcciones_cambio after insert or update or delete on public.correcciones
  for each statement execute function public.tg_correcciones();


-- ---------------------------------------------------------------- facturas sustituidas
-- Endesa a veces vuelve a emitir facturas (refacturación) sin que la original llegue anulada,
-- o la misma pseudofactura aparece en varias facturas agrupadas. Estas reglas marcan como
-- «sustituida» la versión antigua para que no se cuente dos veces (el dato no se borra).
alter table public.facturas add column if not exists doc_agrupada   text;
alter table public.facturas add column if not exists fecha_agrupada date;
alter table public.facturas add column if not exists ajuste_de      text;
alter table public.facturas add column if not exists sustituida     boolean not null default false;
alter table public.facturas add column if not exists motivo_sust    text;
create index if not exists facturas_id_idx      on public.facturas (id_factura);
create index if not exists facturas_periodo_idx on public.facturas (cups, fecha_desde, fecha_hasta);

-- valor de una columna original (por nombre) a partir de valores + cabecera
create or replace function public._valor(p_valores jsonb, p_cabecera bigint, p_col text)
returns text language sql stable as $$
  select nullif(trim(p_valores ->> (array_position(c.columnas, p_col) - 1)), '')
  from public.cabeceras c where c.id = p_cabecera and array_position(c.columnas, p_col) is not null;
$$;

create or replace function public._entero_txt(t text)
returns text language sql immutable as $$
  select case when t ~ '^-?[0-9]+(\.0+)?$' then regexp_replace(t, '\.0+$', '') else t end;
$$;

-- rellena los campos de agrupada/ajuste de las filas que no los tengan, por tandas
-- (devuelve cuántas quedan pendientes; la web lo llama en bucle hasta 0)
create or replace function public.rellenar_pendientes(p_lote int default 8000)
returns int language plpgsql security definer set search_path = public as $$
declare v_quedan int;
begin
  with c as (
    select id,
           array_position(columnas, 'DOCUMENTO IMPRESIÓN') - 1              p_doc,
           array_position(columnas, 'Nº FISCAL DE LA FACTURA AGRUPADA') - 1 p_fis,
           array_position(columnas, 'FECHA EMISIÓN FACTURA AGRUPADA') - 1   p_fec,
           array_position(columnas, 'AJUSTE PSEUDO FACTURA') - 1            p_aju
    from public.cabeceras
  ),
  lote as (select huella from public.facturas where doc_agrupada is null limit greatest(p_lote, 1))
  update public.facturas f set
    doc_agrupada   = coalesce(public._entero_txt(nullif(trim(f.valores ->> c.p_doc), '')),
                              nullif(trim(f.valores ->> c.p_fis), ''), '-'),
    fecha_agrupada = case when f.valores ->> c.p_fec ~ '^\d{4}-\d{2}-\d{2}' then left(f.valores ->> c.p_fec, 10)::date end,
    ajuste_de      = public._entero_txt(nullif(trim(f.valores ->> c.p_aju), ''))
  from c, lote
  where c.id = f.cabecera_id and f.huella = lote.huella;
  select count(*) into v_quedan from public.facturas where doc_agrupada is null;
  return v_quedan;
end;
$$;
drop function if exists public._rellenar_agrupada();

-- al insertar una factura nueva, se rellenan ya sus campos de agrupada/ajuste
create or replace function public.tg_facturas_agrupada()
returns trigger language plpgsql security definer set search_path = public as $$
declare cols text[];
begin
  if new.doc_agrupada is null then
    select columnas into cols from public.cabeceras where id = new.cabecera_id;
    new.doc_agrupada   := coalesce(public._entero_txt(nullif(trim(new.valores ->> (array_position(cols, 'DOCUMENTO IMPRESIÓN') - 1)), '')),
                                   nullif(trim(new.valores ->> (array_position(cols, 'Nº FISCAL DE LA FACTURA AGRUPADA') - 1)), ''), '-');
    new.fecha_agrupada := case when new.valores ->> (array_position(cols, 'FECHA EMISIÓN FACTURA AGRUPADA') - 1) ~ '^\d{4}-\d{2}-\d{2}'
                               then left(new.valores ->> (array_position(cols, 'FECHA EMISIÓN FACTURA AGRUPADA') - 1), 10)::date end;
    new.ajuste_de      := public._entero_txt(nullif(trim(new.valores ->> (array_position(cols, 'AJUSTE PSEUDO FACTURA') - 1)), ''));
  end if;
  return new;
end;
$$;
drop trigger if exists facturas_agrupada on public.facturas;
create trigger facturas_agrupada before insert on public.facturas
  for each row execute function public.tg_facturas_agrupada();

create table if not exists public.opciones (
  clave       text primary key,
  activa      boolean not null default true,
  descripcion text
);
insert into public.opciones (clave, activa, descripcion) values
  ('refacturaciones', true, 'Si un CUPS tiene varias facturas normales (N) para el mismo periodo, solo cuenta la emitida más tarde. Las facturas de ajuste no entran en esta regla.'),
  ('copias_agrupadas', true, 'Si una misma pseudofactura aparece en varias facturas agrupadas, solo cuenta la de la agrupada más reciente.'),
  ('consumos_anomalos', true, 'Si una fila trae un consumo (total o por periodo) de más de 1.000.000 kWh, en positivo o negativo (p. ej. vuelta del contador), sus kWh no se cuentan; los importes sí.')
on conflict (clave) do nothing;
alter table public.opciones enable row level security;
drop policy if exists opc_leer on public.opciones;
drop policy if exists opc_admin on public.opciones;
create policy opc_leer  on public.opciones for select to authenticated using (true);
create policy opc_admin on public.opciones for update to authenticated using (public.es_admin()) with check (public.es_admin());
revoke all on public.opciones from anon;
grant select, update on public.opciones to authenticated;

create or replace function public.recalcular_sustituidas()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_refact boolean := coalesce((select activa from public.opciones where clave = 'refacturaciones'), true);
  v_copias boolean := coalesce((select activa from public.opciones where clave = 'copias_agrupadas'), true);
  n int;
begin
  perform public.rellenar_pendientes(5000);   -- por si queda alguna fila antigua sin preparar
  with
  -- 1) misma pseudofactura en varias agrupadas: gana la agrupada más reciente
  docs as (
    select id_factura, doc_agrupada, max(fecha_agrupada) fa, max(creado) cr
    from public.facturas where v_copias and id_factura is not null
    group by 1, 2
  ),
  doc_ok as (
    select distinct on (id_factura) id_factura, doc_agrupada
    from docs order by id_factura, fa desc nulls last, cr desc, doc_agrupada desc
  ),
  r1 as (
    select f.huella, 'Copia en otra factura agrupada (cuenta la de la agrupada más reciente)'::text motivo
    from public.facturas f join doc_ok d using (id_factura)
    where f.doc_agrupada is distinct from d.doc_agrupada
  ),
  -- 2) refacturación: mismo CUPS y mismo periodo, varias facturas N: gana la emitida más tarde
  inv as (
    select id_factura, cups, fecha_desde, fecha_hasta, max(fecha_emision) fe
    from public.facturas
    where v_refact and estado = 'N' and ajuste_de is null and id_factura is not null
      and cups is not null and fecha_desde is not null and fecha_hasta is not null
    group by 1, 2, 3, 4
  ),
  ganador as (
    select distinct on (cups, fecha_desde, fecha_hasta) cups, fecha_desde, fecha_hasta, id_factura, fe
    from inv order by cups, fecha_desde, fecha_hasta, fe desc nulls last, id_factura desc
  ),
  r2 as (
    select f.huella, 'Refacturada: la sustituye la factura ' || g.id_factura || ' (emitida ' || to_char(g.fe, 'DD/MM/YYYY') || ')' motivo
    from public.facturas f
    join inv i on i.id_factura = f.id_factura
    join ganador g on g.cups = i.cups and g.fecha_desde = i.fecha_desde and g.fecha_hasta = i.fecha_hasta
    where i.id_factura <> g.id_factura
  ),
  marcas as (
    select huella, string_agg(motivo, ' · ') motivo from (select * from r1 union all select * from r2) x group by huella
  )
  update public.facturas f
     set sustituida = m.huella is not null, motivo_sust = m.motivo
    from public.facturas f2 left join marcas m on m.huella = f2.huella
   where f.huella = f2.huella
     and (f.sustituida is distinct from (m.huella is not null) or f.motivo_sust is distinct from m.motivo);
  get diagnostics n = row_count;
  if to_regprocedure('public.refrescar_cache()') is not null then perform public.refrescar_cache(); end if;
  return jsonb_build_object('cambiadas', n,
    'sustituidas', (select count(*) from public.facturas where sustituida),
    'kwh_sustituidos', (select coalesce(sum(kwh), 0) from public.facturas where sustituida));
end;
$$;

create or replace function public.tg_opciones()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.recalcular_sustituidas(); return null; end;
$$;
drop trigger if exists opciones_cambio on public.opciones;
create trigger opciones_cambio after update on public.opciones
  for each statement execute function public.tg_opciones();

-- resumen de lo que hacen las reglas automáticas
create or replace function public.sustituidas_resumen()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'opciones', (select jsonb_agg(to_jsonb(o) order by o.clave) from public.opciones o),
    'refacturaciones', (select jsonb_build_object('filas', count(*), 'facturas', count(distinct id_factura), 'kwh', coalesce(sum(kwh), 0))
                        from public.facturas where sustituida and motivo_sust like '%Refacturada%'),
    'copias', (select jsonb_build_object('filas', count(*), 'facturas', count(distinct id_factura), 'kwh', coalesce(sum(kwh), 0))
               from public.facturas where sustituida and motivo_sust like '%Copia%'),
    'anomalos', (select jsonb_build_object('filas', count(*), 'facturas', count(distinct f.id_factura), 'kwh', coalesce(sum(f.kwh), 0))
                 from public.facturas f
                 where greatest(abs(coalesce(f.kwh, 0)), abs(coalesce(f.kwh_p1, 0)), abs(coalesce(f.kwh_p2, 0)), abs(coalesce(f.kwh_p3, 0)),
                                abs(coalesce(f.kwh_p4, 0)), abs(coalesce(f.kwh_p5, 0)), abs(coalesce(f.kwh_p6, 0))) > 1000000));
$$;
grant execute on function public.recalcular_sustituidas(), public.sustituidas_resumen(), public.rellenar_pendientes(int) to authenticated;
revoke execute on function public.recalcular_sustituidas(), public.sustituidas_resumen(), public.rellenar_pendientes(int) from anon, public;

-- Tensión según la tarifa de acceso: 6.x = media tensión (MT); el resto, baja tensión (BT)
create or replace function public._tension(tarifa text)
returns text language sql immutable as $$
  select case when upper(trim(coalesce(tarifa, ''))) like '6%' then 'MT' else 'BT' end;
$$;

-- Facturas con las correcciones aplicadas (todas las filas, con marcas)
create or replace view public.facturas_calc with (security_invoker = true) as
select f.huella, f.carga_id, f.cabecera_id, f.sheet_code, f.archivo_origen, f.id_factura, f.estado, f.cups,
       f.direccion, f.distribuidora, f.tarifa, f.tipo_lectura, f.fecha_emision, f.fecha_desde, f.fecha_hasta,
       f.mes_emision, f.valores, f.creado,
       c.negativa, c.excluida,
       case when an.anomala then null else public._neg(f.kwh, c.negativa) end kwh,
       case when an.anomala then null else public._neg(f.kwh_p1, c.negativa) end kwh_p1,
       case when an.anomala then null else public._neg(f.kwh_p2, c.negativa) end kwh_p2,
       case when an.anomala then null else public._neg(f.kwh_p3, c.negativa) end kwh_p3,
       case when an.anomala then null else public._neg(f.kwh_p4, c.negativa) end kwh_p4,
       case when an.anomala then null else public._neg(f.kwh_p5, c.negativa) end kwh_p5,
       case when an.anomala then null else public._neg(f.kwh_p6, c.negativa) end kwh_p6,
       public._neg(f.imp_neto, c.negativa) imp_neto,         public._neg(f.imp_total, c.negativa) imp_total,
       public._neg(f.imp_energia, c.negativa) imp_energia,   public._neg(f.imp_potencia, c.negativa) imp_potencia,
       public._neg(f.imp_exceso, c.negativa) imp_exceso,     public._neg(f.imp_alquiler, c.negativa) imp_alquiler,
       public._neg(f.imp_ie, c.negativa) imp_ie,             public._neg(f.imp_otros, c.negativa) imp_otros,
       public._neg(f.imp_iva, c.negativa) imp_iva,
       public._tension(f.tarifa) tension,
       f.sustituida, f.motivo_sust,
       an.anomala
from public.facturas f
cross join lateral (select f.negativa, f.excluida) c
cross join lateral (
  select coalesce((select o.activa from public.opciones o where o.clave = 'consumos_anomalos'), true)
     and greatest(abs(coalesce(f.kwh, 0)), abs(coalesce(f.kwh_p1, 0)), abs(coalesce(f.kwh_p2, 0)), abs(coalesce(f.kwh_p3, 0)),
                  abs(coalesce(f.kwh_p4, 0)), abs(coalesce(f.kwh_p5, 0)), abs(coalesce(f.kwh_p6, 0))) > 1000000 as anomala
) an;

-- Solo las filas que cuentan (sin excluidas): base de todos los cálculos
create or replace view public.facturas_ok with (security_invoker = true) as
select * from public.facturas_calc where not excluida and not sustituida;

-- Filas que cuentan, filtradas por tensión (null = todas)
create or replace function public._ft(p_tension text)
returns setof public.facturas_ok language sql stable as $$
  select * from public.facturas_ok f where p_tension is null or f.tension = p_tension;
$$;

grant select on public.facturas_calc, public.facturas_ok to authenticated;
revoke all on public.facturas_calc, public.facturas_ok from anon;

-- Cuántas filas toca cada regla
create or replace function public.correcciones_resumen()
returns table (id bigint, campo text, valor text, accion text, nota text, activa boolean,
               creado timestamptz, creado_por text, filas bigint, facturas bigint)
language sql stable as $$
  select r.id, r.campo, r.valor, r.accion, r.nota, r.activa, r.creado, r.creado_por,
         count(f.huella), count(distinct f.id_factura)
  from public.correcciones r
  left join public.facturas f on upper(trim(public._campo(f, r.campo))) = upper(trim(r.valor))
  group by r.id order by r.id;
$$;

-- Valores existentes de un campo (para sugerir en el formulario)
create or replace function public.valores_campo(p_campo text)
returns table (valor text, filas bigint)
language sql stable as $$
  select public._campo(f, p_campo) v, count(*) from public.facturas f
  where public._campo(f, p_campo) is not null group by 1 order by 2 desc limit 200;
$$;

-- ---------------------------------------------------------------- funciones de consulta
-- Fecha según la base temporal elegida: 'consumo' (fin del periodo) o 'emision'
create or replace function public._fecha(f public.facturas, p_base text)
returns date language sql immutable as $$
  select case when p_base = 'emision' then f.fecha_emision else f.fecha_hasta end;
$$;

-- (las versiones sin tensión se sustituyen por las nuevas)
drop function if exists public.anios(text);
drop function if exists public.puntos(int, text);
drop function if exists public.dashboard(int, text);

-- ---------------------------------------------------------------- caché de resúmenes
-- El dashboard no recorre las facturas: lee estos resúmenes, que se recalculan
-- (refrescar_cache) al terminar una carga o al cambiar una regla.
create table if not exists public.cache_mes (
  base text not null, anio int, mes int, tension text, estado text, tipo_lectura text,
  kwh numeric, kwh_p1 numeric, kwh_p2 numeric, kwh_p3 numeric, kwh_p4 numeric, kwh_p5 numeric, kwh_p6 numeric,
  neto numeric, total numeric, energia numeric, potencia numeric, exceso numeric, alquiler numeric,
  ie numeric, otros numeric, iva numeric, facturas bigint, filas bigint
);
create index if not exists cache_mes_idx on public.cache_mes (base, anio, tension);
create table if not exists public.cache_cups (
  base text not null, anio int, tension text, cups text,
  direccion text, distribuidora text, tarifa text, ult date,
  facturas bigint, kwh numeric, neto numeric, total numeric, exceso numeric, desde date, hasta date
);
create index if not exists cache_cups_idx on public.cache_cups (base, anio, tension);
create table if not exists public.cache_info (
  id int primary key default 1 check (id = 1),
  actualizado timestamptz, filas bigint, facturas bigint, excluidas bigint, negativas bigint, sustituidas bigint
);
create index if not exists facturas_pend_idx on public.facturas (huella) where doc_agrupada is null;
alter table public.cache_mes  enable row level security;
alter table public.cache_cups enable row level security;
alter table public.cache_info enable row level security;
drop policy if exists cm_leer on public.cache_mes;
drop policy if exists cc_leer on public.cache_cups;
drop policy if exists ci_leer on public.cache_info;
create policy cm_leer on public.cache_mes  for select to authenticated using (true);
create policy cc_leer on public.cache_cups for select to authenticated using (true);
create policy ci_leer on public.cache_info for select to authenticated using (true);
revoke all on public.cache_mes, public.cache_cups, public.cache_info from anon;
grant select on public.cache_mes, public.cache_cups, public.cache_info to authenticated;

create or replace function public.refrescar_cache()
returns jsonb language plpgsql security definer set search_path = public as $$
declare t0 timestamptz := clock_timestamp();
begin
  delete from public.cache_mes where true;
  delete from public.cache_cups where true;
  insert into public.cache_mes
  select b.base, extract(year from x.fecha)::int, extract(month from x.fecha)::int, f.tension, f.estado, f.tipo_lectura,
         sum(f.kwh), sum(f.kwh_p1), sum(f.kwh_p2), sum(f.kwh_p3), sum(f.kwh_p4), sum(f.kwh_p5), sum(f.kwh_p6),
         sum(f.imp_neto), sum(f.imp_total), sum(f.imp_energia), sum(f.imp_potencia), sum(f.imp_exceso), sum(f.imp_alquiler),
         sum(f.imp_ie), sum(f.imp_otros), sum(f.imp_iva), count(distinct f.id_factura), count(*)
  from public.facturas_ok f
  cross join (values ('consumo'), ('emision')) b(base)
  cross join lateral (select case when b.base = 'emision' then f.fecha_emision else f.fecha_hasta end fecha) x
  group by 1, 2, 3, 4, 5, 6;
  insert into public.cache_cups
  select b.base, extract(year from x.fecha)::int, f.tension, f.cups,
         (array_agg(f.direccion     order by f.fecha_hasta desc nulls last))[1],
         (array_agg(f.distribuidora order by f.fecha_hasta desc nulls last))[1],
         (array_agg(f.tarifa        order by f.fecha_hasta desc nulls last))[1],
         max(f.fecha_hasta), count(distinct f.id_factura),
         coalesce(sum(f.kwh), 0), coalesce(sum(f.imp_neto), 0), coalesce(sum(f.imp_total), 0), coalesce(sum(f.imp_exceso), 0),
         min(f.fecha_desde), max(f.fecha_hasta)
  from public.facturas_ok f
  cross join (values ('consumo'), ('emision')) b(base)
  cross join lateral (select case when b.base = 'emision' then f.fecha_emision else f.fecha_hasta end fecha) x
  group by 1, 2, 3, 4;
  insert into public.cache_info (id, actualizado, filas, facturas, excluidas, negativas, sustituidas)
  select 1, now(), count(*), count(distinct id_factura), count(*) filter (where excluida),
         count(*) filter (where negativa), count(*) filter (where sustituida)
  from public.facturas
  on conflict (id) do update set actualizado = excluded.actualizado, filas = excluded.filas, facturas = excluded.facturas,
    excluidas = excluded.excluidas, negativas = excluded.negativas, sustituidas = excluded.sustituidas;
  return jsonb_build_object('ms', round(extract(epoch from clock_timestamp() - t0) * 1000));
end;
$$;

create or replace function public.anios(p_base text default 'consumo', p_tension text default null)
returns int[] language sql stable as $$
  select coalesce(array_agg(distinct anio order by anio desc), '{}') from public.cache_mes
  where base = p_base and anio is not null and (p_tension is null or tension = p_tension);
$$;

create or replace function public.resumen()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'filas',        coalesce(i.filas, 0),
    'excluidas',    coalesce(i.excluidas, 0),
    'negativas',    coalesce(i.negativas, 0),
    'sustituidas',  coalesce(i.sustituidas, 0),
    'facturas',     coalesce(i.facturas, 0),
    'cache',        i.actualizado,
    'pendientes',   (select count(*) from public.facturas where doc_agrupada is null),
    'ultima_carga', (select max(fecha) from public.cargas),
    'admin',        public.es_admin()
  )
  from (select 1) d left join public.cache_info i on i.id = 1;
$$;

create or replace function public.puntos(p_anio int default null, p_base text default 'consumo', p_tension text default null)
returns table (cups text, direccion text, distribuidora text, tarifa text, facturas bigint,
               kwh numeric, neto numeric, total numeric, eur_kwh numeric, exceso_eur numeric,
               desde date, hasta date)
language sql stable as $$
  select c.cups,
         (array_agg(c.direccion     order by c.ult desc nulls last))[1],
         (array_agg(c.distribuidora order by c.ult desc nulls last))[1],
         (array_agg(c.tarifa        order by c.ult desc nulls last))[1],
         sum(c.facturas)::bigint, sum(c.kwh), sum(c.neto), sum(c.total),
         case when sum(c.kwh) > 0 then sum(c.neto) / sum(c.kwh) end,
         sum(c.exceso), min(c.desde), max(c.hasta)
  from public.cache_cups c
  where c.base = p_base and (p_anio is null or c.anio = p_anio) and (p_tension is null or c.tension = p_tension)
  group by c.cups
  order by 6 desc;
$$;

-- piezas del dashboard (un año o todo el histórico si p_anio es null)
create or replace function public._mensual(p_anio int, p_base text, p_tension text)
returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('mes', g.mes, 'kwh', x.kwh, 'neto', x.neto, 'total', x.total,
           'eur_kwh', case when x.kwh > 0 then x.neto / x.kwh end, 'facturas', coalesce(x.facturas, 0)) order by g.mes)
  from generate_series(1, 12) g(mes)
  left join (select mes, sum(kwh) kwh, sum(neto) neto, sum(total) total, sum(facturas) facturas
             from public.cache_mes
             where base = p_base and (p_anio is null or anio = p_anio) and (p_tension is null or tension = p_tension)
             group by mes) x on x.mes = g.mes;
$$;
create or replace function public._periodos(p_anio int, p_base text, p_tension text)
returns jsonb language sql stable as $$
  select jsonb_build_array(
    jsonb_build_object('periodo', 'P1', 'kwh', coalesce(sum(kwh_p1), 0)), jsonb_build_object('periodo', 'P2', 'kwh', coalesce(sum(kwh_p2), 0)),
    jsonb_build_object('periodo', 'P3', 'kwh', coalesce(sum(kwh_p3), 0)), jsonb_build_object('periodo', 'P4', 'kwh', coalesce(sum(kwh_p4), 0)),
    jsonb_build_object('periodo', 'P5', 'kwh', coalesce(sum(kwh_p5), 0)), jsonb_build_object('periodo', 'P6', 'kwh', coalesce(sum(kwh_p6), 0)))
  from public.cache_mes
  where base = p_base and (p_anio is null or anio = p_anio) and (p_tension is null or tension = p_tension);
$$;
create or replace function public._costes(p_anio int, p_base text, p_tension text)
returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('concepto', c.k, 'eur', c.v) order by c.o)
  from (select sum(energia) e, sum(potencia) p, sum(exceso) x, sum(alquiler) a, sum(ie) ie, sum(otros) o, sum(iva) iva, sum(total) t
        from public.cache_mes
        where base = p_base and (p_anio is null or anio = p_anio) and (p_tension is null or tension = p_tension)) s,
  lateral (values
    (1, 'Energía', coalesce(e, 0)), (2, 'Potencia contratada', coalesce(p, 0)), (3, 'Exceso de potencia', coalesce(x, 0)),
    (4, 'Alquiler de equipos', coalesce(a, 0)), (5, 'Impuesto eléctrico', coalesce(ie, 0)), (6, 'Otros conceptos', coalesce(o, 0)),
    (7, 'Otros ajustes', coalesce(t, 0) - coalesce(e, 0) - coalesce(p, 0) - coalesce(x, 0) - coalesce(a, 0) - coalesce(ie, 0) - coalesce(o, 0) - coalesce(iva, 0)),
    (8, 'IVA / IGIC', coalesce(iva, 0))) c(o, k, v)
  where c.k <> 'Otros ajustes' or abs(c.v) > 0.5;
$$;

create or replace function public.dashboard(p_anio int default null, p_base text default 'consumo', p_tension text default null)
returns jsonb language plpgsql stable as $$
declare
  v_meses int[];
  v_fact bigint;
  v_prev jsonb := null;
  v_hay_prev boolean := false;
begin
  select array_agg(distinct mes) filter (where mes is not null), coalesce(sum(facturas), 0)
    into v_meses, v_fact
  from public.cache_mes
  where base = p_base and (p_anio is null or anio = p_anio) and (p_tension is null or tension = p_tension);

  if v_fact = 0 then
    return jsonb_build_object('vacio', true, 'version', (select actualizado from public.cache_info where id = 1));
  end if;

  if p_anio is not null then
    select count(*) > 0 into v_hay_prev from public.cache_mes
    where base = p_base and anio = p_anio - 1 and (p_tension is null or tension = p_tension);
    select case when sum(facturas) >= 0.5 * v_fact then
             jsonb_build_object('kwh', coalesce(sum(kwh), 0), 'neto', coalesce(sum(neto), 0), 'total', coalesce(sum(total), 0),
                                'meses', to_jsonb(v_meses))
           end
      into v_prev
    from public.cache_mes
    where base = p_base and anio = p_anio - 1 and mes = any (v_meses) and (p_tension is null or tension = p_tension);
  end if;

  return (
    with m as (
      select * from public.cache_mes
      where base = p_base and (p_anio is null or anio = p_anio) and (p_tension is null or tension = p_tension)
    ),
    cu as (select * from public.puntos(p_anio, p_base, p_tension))
    select jsonb_build_object(
      'vacio', false, 'anio', p_anio, 'base', p_base, 'tension', p_tension,
      'version', (select actualizado from public.cache_info where id = 1),
      'kpi', (select jsonb_build_object(
          'kwh', coalesce(sum(kwh), 0), 'neto', coalesce(sum(neto), 0), 'total', coalesce(sum(total), 0),
          'eur_kwh', case when sum(kwh) > 0 then sum(neto) / sum(kwh) end,
          'facturas', coalesce(sum(facturas), 0),
          'anuladas', coalesce(sum(facturas) filter (where estado in ('A', 'C')), 0),
          'rectificativas', coalesce(sum(facturas) filter (where estado = 'R'), 0),
          'exceso_eur', coalesce(sum(exceso), 0),
          'puntos', (select count(*) from cu where coalesce(cu.kwh, 0) <> 0),
          'puntos_total', (select count(*) from cu),
          'puntos_exceso', (select count(*) from cu where cu.exceso_eur > 0)) from m),
      'previo', v_prev,
      'mensual', public._mensual(p_anio, p_base, p_tension),
      'mensual_prev', case when v_hay_prev then public._mensual(p_anio - 1, p_base, p_tension) end,
      'periodos', public._periodos(p_anio, p_base, p_tension),
      'periodos_prev', case when v_hay_prev then public._periodos(p_anio - 1, p_base, p_tension) end,
      'costes', public._costes(p_anio, p_base, p_tension),
      'costes_prev', case when v_hay_prev then public._costes(p_anio - 1, p_base, p_tension) end,
      'top', (select coalesce(jsonb_agg(jsonb_build_object('cups', t.cups, 'direccion', t.direccion,
                'kwh', t.kwh, 'neto', t.neto, 'eur_kwh', t.eur_kwh)), '[]') from (select * from cu limit 10) t),
      'lecturas', (select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo_lectura, 'facturas', n) order by n desc), '[]')
                   from (select tipo_lectura, sum(facturas) n from m where tipo_lectura is not null group by 1) l)
    )
  );
end;
$$;

-- Vaciar todo (solo administradores; las reglas de borrado lo impiden al resto)
create or replace function public.vaciar()
returns void language plpgsql as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede vaciar los datos';
  end if;
  delete from public.facturas where true;
  delete from public.cargas where true;
  delete from public.cabeceras where true;
  -- las reglas de corrección se conservan
  perform public.refrescar_cache();
end;
$$;

grant execute on function public.anios(text, text), public.resumen(), public.puntos(int, text, text),
                 public.dashboard(int, text, text), public.vaciar(), public.es_admin(), public.refrescar_cache(),
                 public.correcciones_resumen(), public.valores_campo(text) to authenticated;
revoke execute on function public.anios(text, text), public.resumen(), public.puntos(int, text, text),
                  public.dashboard(int, text, text), public.vaciar(), public.refrescar_cache() from anon, public;


-- ---------------------------------------------------------------- analítico del equipo
-- Excel "Costes por BT y MT" que el equipo monta a mano, para contrastarlo con las facturas.
create table if not exists public.analitico_cargas (
  id            bigint generated always as identity primary key,
  anio          int not null,
  archivo       text,
  fecha         timestamptz not null default now(),
  usuario_email text default (auth.jwt() ->> 'email')
);
create table if not exists public.analitico_valores (
  carga_id  bigint not null references public.analitico_cargas(id) on delete cascade,
  segmento  text not null check (segmento in ('TOTAL', 'BT', 'MT')),
  concepto  text not null check (concepto in ('consumo', 'cv', 'revshare', 'cf', 'pyc')),
  mes       int  not null check (mes between 0 and 12),     -- 0 = valor anual (p. ej. PYC)
  valor     numeric,
  primary key (carga_id, segmento, concepto, mes)
);
alter table public.analitico_cargas  enable row level security;
alter table public.analitico_valores enable row level security;
drop policy if exists ana_c_leer on public.analitico_cargas;
drop policy if exists ana_c_ins  on public.analitico_cargas;
drop policy if exists ana_c_del  on public.analitico_cargas;
drop policy if exists ana_v_leer on public.analitico_valores;
drop policy if exists ana_v_ins  on public.analitico_valores;
create policy ana_c_leer on public.analitico_cargas  for select to authenticated using (true);
create policy ana_c_ins  on public.analitico_cargas  for insert to authenticated with check (true);
create policy ana_c_del  on public.analitico_cargas  for delete to authenticated using (public.es_admin());
create policy ana_v_leer on public.analitico_valores for select to authenticated using (true);
create policy ana_v_ins  on public.analitico_valores for insert to authenticated with check (true);
revoke all on public.analitico_cargas, public.analitico_valores from anon;
grant select, insert, delete on public.analitico_cargas  to authenticated;
grant select, insert         on public.analitico_valores to authenticated;

-- Comparativa de un año: último analítico subido de ese año + lo calculado desde las facturas
-- (siempre por mes de consumo; BT/MT según la tarifa: 6.x = MT, resto = BT)
create or replace function public.comparativa(p_anio int)
returns jsonb language sql stable as $$
  with ult as (
    select * from public.analitico_cargas where anio = p_anio order by fecha desc, id desc limit 1
  ),
  nuestro as (
    select mes, tension seg, sum(kwh) kwh, sum(energia) energia,
           coalesce(sum(potencia), 0) + coalesce(sum(alquiler), 0) fijo, sum(neto) neto, sum(facturas) facturas
    from public.cache_mes
    where base = 'consumo' and anio = p_anio
    group by 1, 2
  )
  select jsonb_build_object(
    'anio', p_anio,
    'anios_equipo', (select coalesce(jsonb_agg(distinct anio), '[]') from public.analitico_cargas),
    'carga', (select to_jsonb(u) from ult u),
    'equipo', (select coalesce(jsonb_agg(jsonb_build_object('seg', v.segmento, 'concepto', v.concepto, 'mes', v.mes, 'valor', v.valor)), '[]')
               from public.analitico_valores v join ult u on u.id = v.carga_id),
    'nuestro', (select coalesce(jsonb_agg(to_jsonb(n)), '[]') from nuestro n)
  );
$$;
grant execute on function public.comparativa(int) to authenticated;
revoke execute on function public.comparativa(int) from anon, public;

-- ---------------------------------------------------------------- ajustes finales
-- Más margen para consultas pesadas (por defecto Supabase corta a los 8 s)
alter role authenticated set statement_timeout = '30s';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';

-- Aplica las reglas de corrección a las facturas ya guardadas (rápido).
-- La revisión de refacturaciones de las facturas antiguas la hace la web al entrar, por tandas.
select public.recalcular_correcciones();
-- Rellena la caché del dashboard
select public.refrescar_cache();
