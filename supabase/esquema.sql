-- =====================================================================
--  eMob · Costes de energía — esquema para Supabase
--  Pegar entero en Supabase > SQL Editor > New query > Run.
--  Se puede volver a ejecutar sin perder datos (crea solo lo que falta
--  y redefine funciones y reglas).
-- =====================================================================

-- Margen de tiempo para esta ejecución (la primera vez revisa todas las facturas)
set statement_timeout = '5min';
-- las funciones se comprueban al usarlas, no al crearlas (algunas usan tablas que se crean más abajo)
set check_function_bodies = off;

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
    doc_agrupada   = coalesce(public._entero_txt(nullif(trim(v.val ->> c.p_doc), '')),
                              nullif(trim(v.val ->> c.p_fis), ''), '-'),
    fecha_agrupada = case when v.val ->> c.p_fec ~ '^\d{4}-\d{2}-\d{2}' then left(v.val ->> c.p_fec, 10)::date end,
    ajuste_de      = public._entero_txt(nullif(trim(v.val ->> c.p_aju), ''))
  from c, lote
  cross join lateral (select coalesce(f2.valores, fv.valores) val from public.facturas f2
                      left join public.facturas_valores fv on fv.huella = f2.huella where f2.huella = lote.huella) v
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
alter table public.opciones add column if not exists valor text;
insert into public.opciones (clave, activa, descripcion, valor) values
  ('anio_minimo', true, 'El dashboard, los CUPS y la comparativa solo muestran desde este año (por mes de consumo o de emisión). Las facturas anteriores siguen guardadas.', '2026')
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
begin perform public.recalcular_sustituidas(); return null; end;   -- también refresca los resúmenes
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


-- ---------------------------------------------------------------- fila original aparte
-- La fila original completa (≈3 KB) va en su propia tabla: así la tabla de facturas es
-- estrecha, se lee rápido y las marcas (sustituida, anómala…) no reescriben esos 3 KB.
create table if not exists public.facturas_valores (
  huella  text primary key,
  valores jsonb not null
);
alter table public.facturas alter column valores drop not null;
create index if not exists facturas_por_mover_idx on public.facturas (huella) where valores is not null;
alter table public.facturas_valores enable row level security;
drop policy if exists fv_leer on public.facturas_valores;
drop policy if exists fv_ins  on public.facturas_valores;
create policy fv_leer on public.facturas_valores for select to authenticated using (true);
create policy fv_ins  on public.facturas_valores for insert to authenticated with check (true);
revoke all on public.facturas_valores from anon;
grant select, insert on public.facturas_valores to authenticated;

-- al insertar una factura, su fila original se guarda aparte (se ejecuta el último: «zz»)
create or replace function public.tg_facturas_valores()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.valores is not null then
    insert into public.facturas_valores (huella, valores) values (new.huella, new.valores)
    on conflict (huella) do nothing;
    new.valores := null;
  end if;
  return new;
end;
$$;
drop trigger if exists zz_facturas_valores on public.facturas;
create trigger zz_facturas_valores before insert on public.facturas
  for each row execute function public.tg_facturas_valores();

-- traslado de las filas ya guardadas, por tandas (la web lo llama hasta que devuelve 0)
create or replace function public.mover_valores(p_lote int default 3000)
returns int language plpgsql security definer set search_path = public as $$
declare v_quedan int;
begin
  with l as (select huella, valores from public.facturas where valores is not null limit greatest(p_lote, 1)),
  ins as (insert into public.facturas_valores (huella, valores) select huella, valores from l on conflict (huella) do nothing)
  update public.facturas f set valores = null from l where f.huella = l.huella;
  select count(*) into v_quedan from public.facturas where valores is not null;
  return v_quedan;
end;
$$;
grant execute on function public.mover_valores(int) to authenticated;
revoke execute on function public.mover_valores(int) from anon, public;

-- Tensión según la tarifa de acceso: 6.x = media tensión (MT); el resto, baja tensión (BT)
create or replace function public._tension(tarifa text)
returns text language sql immutable as $$
  select case when upper(trim(coalesce(tarifa, ''))) like '6%' then 'MT' else 'BT' end;
$$;

-- Facturas con las correcciones aplicadas (todas las filas, con marcas)
create or replace view public.facturas_calc with (security_invoker = true) as
select f.huella, f.carga_id, f.cabecera_id, f.sheet_code, f.archivo_origen, f.id_factura, f.estado, f.cups,
       f.direccion, f.distribuidora, f.tarifa, f.tipo_lectura, f.fecha_emision, f.fecha_desde, f.fecha_hasta,
       f.mes_emision, coalesce(f.valores, fv.valores) valores, f.creado,
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
left join public.facturas_valores fv on fv.huella = f.huella
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
-- Facturas repartidas por días de su periodo (para comparar mes a mes con evOS)
create table if not exists public.cache_prorr (anio int, mes int, tension text, kwh numeric, neto numeric, total numeric);
-- lo mismo por CUPS (20 primeros caracteres: el final del CUPS cambia entre fuentes)
create table if not exists public.cache_prorr_cups (anio int, mes int, cups20 text, kwh float8, neto float8);
create index if not exists cache_prorr_cups_idx on public.cache_prorr_cups (anio, cups20);
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
-- Índice «de cobertura»: copia estrecha con solo las columnas que usan los resúmenes. Así el
-- recálculo lee este índice (≈ 1/5 del tamaño) en lugar de la tabla con la fila original completa.
create index if not exists facturas_resumen_idx on public.facturas (huella) include
  (fecha_hasta, fecha_emision, tarifa, estado, tipo_lectura, cups, fecha_desde, direccion, distribuidora, id_factura,
   excluida, negativa, sustituida, kwh, kwh_p1, kwh_p2, kwh_p3, kwh_p4, kwh_p5, kwh_p6,
   imp_neto, imp_total, imp_energia, imp_potencia, imp_exceso, imp_alquiler, imp_ie, imp_otros, imp_iva);
alter table public.cache_mes  enable row level security;
alter table public.cache_cups enable row level security;
alter table public.cache_info enable row level security;
drop policy if exists cm_leer on public.cache_mes;
drop policy if exists cc_leer on public.cache_cups;
drop policy if exists ci_leer on public.cache_info;
create policy cm_leer on public.cache_mes  for select to authenticated using (true);
create policy cc_leer on public.cache_cups for select to authenticated using (true);
create policy ci_leer on public.cache_info for select to authenticated using (true);
alter table public.cache_prorr enable row level security;
drop policy if exists cp_leer on public.cache_prorr;
create policy cp_leer on public.cache_prorr for select to authenticated using (true);
revoke all on public.cache_prorr from anon;
grant select on public.cache_prorr to authenticated;
alter table public.cache_prorr_cups enable row level security;
drop policy if exists cpc_leer on public.cache_prorr_cups;
create policy cpc_leer on public.cache_prorr_cups for select to authenticated using (true);
revoke all on public.cache_prorr_cups from anon;
grant select on public.cache_prorr_cups to authenticated;
revoke all on public.cache_mes, public.cache_cups, public.cache_info from anon;
grant select on public.cache_mes, public.cache_cups, public.cache_info to authenticated;

create or replace function public.refrescar_cache()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t0 timestamptz := clock_timestamp();
  v_min int := (select case when activa and valor ~ '^\d{4}$' then valor::int end from public.opciones where clave = 'anio_minimo');
begin
  -- UNA sola lectura de la tabla de facturas (con correcciones y marcas) a una tabla temporal estrecha.
  -- De ahí salen los resúmenes por mes, por CUPS, las direcciones y los contadores generales.
  -- Importes en coma flotante (sumar es mucho más rápido; se redondea a 4 decimales) y marcas
  -- «primera fila de cada factura» para contar facturas sin COUNT(DISTINCT), que obliga a ordenar.
  drop table if exists pg_temp._cache_src;
  create temp table _cache_src on commit drop as
  select t.*,
         (t.id_factura is not null and row_number() over (partition by t.id_factura order by t.huella) = 1) pri_todas,
         (t.cuenta and t.id_factura is not null
            and row_number() over (partition by t.id_factura, t.cuenta order by t.huella) = 1) primera
  from (
    select f.fecha_hasta, f.fecha_emision, f.tension, f.estado, f.tipo_lectura, f.cups, f.fecha_desde,
           f.direccion, f.distribuidora, f.tarifa, f.id_factura, f.huella,
           f.excluida, f.negativa, f.sustituida, (not f.excluida and not f.sustituida) cuenta,
           f.kwh::float8 kwh, f.kwh_p1::float8 kwh_p1, f.kwh_p2::float8 kwh_p2, f.kwh_p3::float8 kwh_p3,
           f.kwh_p4::float8 kwh_p4, f.kwh_p5::float8 kwh_p5, f.kwh_p6::float8 kwh_p6,
           f.imp_neto::float8 imp_neto, f.imp_total::float8 imp_total, f.imp_energia::float8 imp_energia,
           f.imp_potencia::float8 imp_potencia, f.imp_exceso::float8 imp_exceso, f.imp_alquiler::float8 imp_alquiler,
           f.imp_ie::float8 imp_ie, f.imp_otros::float8 imp_otros, f.imp_iva::float8 imp_iva
    from public.facturas_calc f
  ) t;

  -- contadores generales (todas las filas)
  insert into public.cache_info (id, actualizado, filas, facturas, excluidas, negativas, sustituidas)
  select 1, now(), count(*), count(*) filter (where pri_todas),
         count(*) filter (where excluida), count(*) filter (where negativa), count(*) filter (where sustituida)
  from pg_temp._cache_src
  on conflict (id) do update set actualizado = excluded.actualizado, filas = excluded.filas, facturas = excluded.facturas,
    excluidas = excluded.excluidas, negativas = excluded.negativas, sustituidas = excluded.sustituidas;

  delete from public.cache_mes where true;
  delete from public.cache_cups where true;
  insert into public.cache_mes
  select b.base, extract(year from x.fecha)::int, extract(month from x.fecha)::int, f.tension, f.estado, f.tipo_lectura,
         round(sum(f.kwh)::numeric, 4), round(sum(f.kwh_p1)::numeric, 4), round(sum(f.kwh_p2)::numeric, 4),
         round(sum(f.kwh_p3)::numeric, 4), round(sum(f.kwh_p4)::numeric, 4), round(sum(f.kwh_p5)::numeric, 4),
         round(sum(f.kwh_p6)::numeric, 4), round(sum(f.imp_neto)::numeric, 4), round(sum(f.imp_total)::numeric, 4),
         round(sum(f.imp_energia)::numeric, 4), round(sum(f.imp_potencia)::numeric, 4), round(sum(f.imp_exceso)::numeric, 4),
         round(sum(f.imp_alquiler)::numeric, 4), round(sum(f.imp_ie)::numeric, 4), round(sum(f.imp_otros)::numeric, 4),
         round(sum(f.imp_iva)::numeric, 4), count(*) filter (where f.primera), count(*)
  from pg_temp._cache_src f
  cross join (values ('consumo'), ('emision')) b(base)
  cross join lateral (select case when b.base = 'emision' then f.fecha_emision else f.fecha_hasta end fecha) x
  where f.cuenta and (v_min is null or x.fecha is null or extract(year from x.fecha) >= v_min)
  group by 1, 2, 3, 4, 5, 6;
  insert into public.cache_cups
  select g.base, g.anio, g.tension, g.cups, d.direccion, d.distribuidora, d.tarifa, g.hasta,
         g.facturas, g.kwh, g.neto, g.total, g.exceso, g.desde, g.hasta
  from (
    select b.base, extract(year from x.fecha)::int anio, f.tension, f.cups,
           count(*) filter (where f.primera) facturas,
           coalesce(round(sum(f.kwh)::numeric, 4), 0) kwh, coalesce(round(sum(f.imp_neto)::numeric, 4), 0) neto,
           coalesce(round(sum(f.imp_total)::numeric, 4), 0) total, coalesce(round(sum(f.imp_exceso)::numeric, 4), 0) exceso,
           min(f.fecha_desde) desde, max(f.fecha_hasta) hasta
    from pg_temp._cache_src f
    cross join (values ('consumo'), ('emision')) b(base)
    cross join lateral (select case when b.base = 'emision' then f.fecha_emision else f.fecha_hasta end fecha) x
    where f.cuenta and (v_min is null or x.fecha is null or extract(year from x.fecha) >= v_min)
    group by 1, 2, 3, 4
  ) g
  left join (select distinct on (cups) cups, direccion, distribuidora, tarifa
             from pg_temp._cache_src where cups is not null and cuenta
             order by cups, fecha_hasta desc nulls last) d on d.cups = g.cups;
  -- reparto por días: cada fila se divide entre los meses de su periodo según los días que caen en cada uno
  -- (periodos raros —sin inicio, al revés o de más de 400 días— van enteros al mes en que terminan)
  delete from public.cache_prorr where true;
  insert into public.cache_prorr (anio, mes, tension, kwh, neto, total)
  select extract(year from m.m)::int, extract(month from m.m)::int, f.tension,
         round(sum(f.kwh * w.w)::numeric, 4), round(sum(f.imp_neto * w.w)::numeric, 4), round(sum(f.imp_total * w.w)::numeric, 4)
  from pg_temp._cache_src f
  cross join lateral (select case when f.fecha_desde is not null and f.fecha_hasta - f.fecha_desde between 0 and 400
                                  then f.fecha_desde else f.fecha_hasta end d0, f.fecha_hasta d1) p
  cross join lateral generate_series(date_trunc('month', p.d0), date_trunc('month', p.d1), interval '1 month') m(m)
  cross join lateral (select (least(p.d1, (m.m + interval '1 month')::date - 1) - greatest(p.d0, m.m::date) + 1)::float8
                             / (p.d1 - p.d0 + 1) w) w
  where f.cuenta and f.fecha_hasta is not null and (v_min is null or extract(year from m.m) >= v_min)
  group by 1, 2, 3;
  insert into public.cups (cups20, cups, direccion, distribuidora, tarifa, tension, primera_factura, ultima_factura, actualizado)
  select distinct on (left(cups, 20)) left(cups, 20), cups, direccion, distribuidora, tarifa, tension,
         min(fecha_desde) over (partition by left(cups, 20)), max(fecha_hasta) over (partition by left(cups, 20)), now()
  from pg_temp._cache_src where cups is not null
  order by left(cups, 20), fecha_hasta desc nulls last
  on conflict (cups20) do update set cups = excluded.cups, direccion = excluded.direccion, distribuidora = excluded.distribuidora,
    tarifa = excluded.tarifa, tension = excluded.tension, primera_factura = excluded.primera_factura,
    ultima_factura = excluded.ultima_factura, actualizado = excluded.actualizado;
  delete from public.cache_prorr_cups where true;
  insert into public.cache_prorr_cups (anio, mes, cups20, kwh, neto)
  select extract(year from m.m)::int, extract(month from m.m)::int, left(f.cups, 20), sum(f.kwh * w.w), sum(f.imp_neto * w.w)
  from pg_temp._cache_src f
  cross join lateral (select case when f.fecha_desde is not null and f.fecha_hasta - f.fecha_desde between 0 and 400
                                  then f.fecha_desde else f.fecha_hasta end d0, f.fecha_hasta d1) p
  cross join lateral generate_series(date_trunc('month', p.d0), date_trunc('month', p.d1), interval '1 month') m(m)
  cross join lateral (select (least(p.d1, (m.m + interval '1 month')::date - 1) - greatest(p.d0, m.m::date) + 1)::float8
                             / (p.d1 - p.d0 + 1) w) w
  where f.cuenta and f.fecha_hasta is not null and f.cups is not null and (v_min is null or extract(year from m.m) >= v_min)
  group by 1, 2, 3;
  drop table if exists pg_temp._cache_src;

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
    'por_mover',    (select count(*) from public.facturas where valores is not null),
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
    -- año anterior solo si hay datos y no queda por debajo de «Mostrar desde el año»
    select count(*) > 0 into v_hay_prev from public.cache_mes
    where base = p_base and anio = p_anio - 1 and (p_tension is null or tension = p_tension)
      and p_anio - 1 >= coalesce((select case when activa and valor ~ '^\d{4}$' then valor::int end
                                  from public.opciones where clave = 'anio_minimo'), 0);
    select case when v_hay_prev and sum(facturas) >= 0.5 * v_fact then
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
  delete from public.facturas_valores where true;
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


-- ---------------------------------------------------------------- evOS (sistema técnico)
-- Sesiones de carga exportadas de evOS. Se guardan AGREGADAS por mes y punto de carga
-- (no sesión a sesión: no cabría) y sin datos personales (tarjeta, cliente, vehículo).
-- Cada fichero subido es un «lote»; si se vuelve a subir un periodo, sustituye al anterior.
create table if not exists public.evos_lotes (
  id            bigint generated always as identity primary key,
  archivo       text,
  desde         date,
  hasta         date,
  dias          date[] not null,
  sesiones      int,
  kwh           numeric,
  importe       numeric,
  fecha         timestamptz not null default now(),
  usuario_email text default (auth.jwt() ->> 'email')
);
create table if not exists public.evos_agg (
  lote_id   bigint not null references public.evos_lotes(id) on delete cascade,
  anio      int, mes int,
  punto     text,             -- serie · dirección · CP (la serie viene a veces estropeada por Excel)
  serial    text, ac_dc text, cpo text, empresa text,
  region    text, provincia text, ciudad text, cp text, direccion text,
  potencia  numeric, sesiones int, kwh numeric, importe numeric, segundos bigint,
  primera   timestamp, ultima timestamp
);
alter table public.evos_agg add column if not exists tipo text;   -- «Type» de evOS (PUBLIC…); null en ficheros subidos antes de guardarlo
create index if not exists evos_agg_lote_idx on public.evos_agg (lote_id);
create index if not exists evos_agg_mes_idx  on public.evos_agg (anio, mes);
create table if not exists public.evos_dia (
  lote_id  bigint not null references public.evos_lotes(id) on delete cascade,
  dia      date, ac_dc text, region text,
  sesiones int, kwh numeric, importe numeric
);
create index if not exists evos_dia_idx on public.evos_dia (dia);
create index if not exists evos_lotes_dias_idx on public.evos_lotes using gin (dias);

alter table public.evos_lotes enable row level security;
alter table public.evos_agg   enable row level security;
alter table public.evos_dia   enable row level security;
drop policy if exists el_leer on public.evos_lotes;  drop policy if exists el_ins on public.evos_lotes;  drop policy if exists el_del on public.evos_lotes;
drop policy if exists ea_leer on public.evos_agg;    drop policy if exists ea_ins on public.evos_agg;
drop policy if exists ed_leer on public.evos_dia;    drop policy if exists ed_ins on public.evos_dia;
create policy el_leer on public.evos_lotes for select to authenticated using (true);
create policy el_ins  on public.evos_lotes for insert to authenticated with check (true);
create policy el_del  on public.evos_lotes for delete to authenticated using (public.es_admin());
create policy ea_leer on public.evos_agg   for select to authenticated using (true);
create policy ea_ins  on public.evos_agg   for insert to authenticated with check (true);
create policy ed_leer on public.evos_dia   for select to authenticated using (true);
create policy ed_ins  on public.evos_dia   for insert to authenticated with check (true);
revoke all on public.evos_lotes, public.evos_agg, public.evos_dia from anon;
grant select, insert, delete on public.evos_lotes to authenticated;
grant select, insert on public.evos_agg, public.evos_dia to authenticated;

-- Al subir un fichero: lotes ya guardados que se solapan con sus días.
-- Si todos sus días están dentro del fichero nuevo, se sustituyen (se borran aquí);
-- si solo se solapan en parte, no se toca nada y se devuelven para avisar.
create or replace function public.evos_preparar(p_dias date[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_parciales jsonb; v_borrados int;
begin
  select coalesce(jsonb_agg(jsonb_build_object('archivo', archivo, 'desde', desde, 'hasta', hasta)), '[]')
    into v_parciales
  from public.evos_lotes where dias && p_dias and not (dias <@ p_dias);
  if jsonb_array_length(v_parciales) > 0 then
    return jsonb_build_object('ok', false, 'parciales', v_parciales);
  end if;
  with b as (delete from public.evos_lotes where dias && p_dias and dias <@ p_dias returning 1)
  select count(*) into v_borrados from b;
  return jsonb_build_object('ok', true, 'sustituidos', v_borrados);
end;
$$;

-- Panel de evOS para un año: totales, meses (con lo facturado al lado), regiones y puntos
create or replace function public.evos_dashboard(p_anio int)
returns jsonb language sql stable as $$
  with a as (select * from public.evos_agg where anio = p_anio),
  fac as (   -- por mes de fin de periodo (como el resto del dashboard)
    select mes, sum(kwh) kwh, sum(neto) neto from public.cache_mes
    where base = 'consumo' and anio = p_anio group by mes
  ),
  pro as (   -- repartido por días del periodo facturado
    select mes, sum(kwh) kwh, sum(neto) neto, sum(total) total, sum(kwh) filter (where tension = 'MT') kwh_mt
    from public.cache_prorr where anio = p_anio group by mes
  ),
  dias as (select extract(month from dia)::int mes, count(distinct dia) dias from public.evos_dia
           where dia >= make_date(p_anio, 1, 1) and dia < make_date(p_anio + 1, 1, 1) group by 1)
  select jsonb_build_object(
    'anio', p_anio,
    'anios', (select coalesce(jsonb_agg(distinct anio order by anio desc), '[]') from public.evos_agg),
    'kpi', (select jsonb_build_object(
              'kwh', coalesce(sum(kwh), 0), 'sesiones', coalesce(sum(sesiones), 0), 'importe', coalesce(sum(importe), 0),
              'horas', coalesce(sum(segundos), 0) / 3600.0,
              'puntos', count(distinct punto), 'kwh_dc', coalesce(sum(kwh) filter (where ac_dc = 'DC'), 0),
              'ses_dc', coalesce(sum(sesiones) filter (where ac_dc = 'DC'), 0),
              'desde', min(primera), 'hasta', max(ultima)) from a),
    'mensual', (select jsonb_agg(jsonb_build_object('mes', g.mes, 'kwh', x.kwh, 'sesiones', x.sesiones, 'importe', x.importe,
                                                    'kwh_dc', x.kwh_dc, 'ses_dc', x.ses_dc, 'horas', x.horas,
                                                    'dias', coalesce(d.dias, 0),
                                                    'dias_mes', extract(day from (make_date(p_anio, g.mes, 1) + interval '1 month' - interval '1 day'))::int,
                                                    'fact_kwh', fac.kwh, 'fact_neto', fac.neto,
                                                    'pro_kwh', pro.kwh, 'pro_neto', pro.neto, 'pro_total', pro.total, 'pro_kwh_mt', pro.kwh_mt) order by g.mes)
                from generate_series(1, 12) g(mes)
                left join (select mes, sum(kwh) kwh, sum(sesiones) sesiones, sum(importe) importe, sum(segundos) / 3600.0 horas,
                                  sum(kwh) filter (where ac_dc = 'DC') kwh_dc, sum(sesiones) filter (where ac_dc = 'DC') ses_dc
                           from a group by mes) x on x.mes = g.mes
                left join fac on fac.mes = g.mes
                left join pro on pro.mes = g.mes
                left join dias d on d.mes = g.mes),
    'diario', (select coalesce(jsonb_agg(t order by t.dia), '[]') from (
                 select dia, sum(kwh) kwh, sum(sesiones) sesiones, sum(kwh) filter (where ac_dc = 'DC') kwh_dc
                 from public.evos_dia where dia >= make_date(p_anio, 1, 1) and dia < make_date(p_anio + 1, 1, 1) group by dia) t),
    'regiones', (select coalesce(jsonb_agg(r order by r.kwh desc), '[]') from (
                   select region, sum(kwh) kwh, sum(sesiones) sesiones, count(distinct punto) puntos from a group by region) r),
    'cpos', (select coalesce(jsonb_agg(r order by r.kwh desc), '[]') from (
               select nullif(cpo, '') cpo, sum(kwh) kwh, sum(sesiones) sesiones, sum(importe) importe, count(distinct punto) puntos
               from a group by 1) r),
    'puntos', (select coalesce(jsonb_agg(p order by p.kwh desc), '[]') from (
                 select min(a.punto) punto, coalesce(max(e.serial_cruce), max(a.serial)) serial, max(a.direccion) direccion, max(a.ciudad) ciudad,
                        max(a.provincia) provincia, max(a.cp) cp, string_agg(distinct a.ac_dc, '/') ac_dc, max(a.potencia) potencia,
                        sum(a.kwh) kwh, sum(a.sesiones) sesiones, sum(a.importe) importe
                 from a left join public.evos_cups e on e.punto = a.punto
                 group by coalesce(e.serial_cruce, a.punto) order by sum(a.kwh) desc limit 10) p)
  );
$$;

-- Puntos de recarga (evOS) de un año, uno por punto
create or replace function public.evos_puntos(p_anio int)
returns jsonb language sql stable as $$
  -- un punto por nº de serie real: si evOS lo trae estropeado (6,2E+13) y se ha recuperado, se junta con el bueno
  select coalesce(jsonb_agg(p order by p.kwh desc), '[]') from (
    select min(a.punto) punto, coalesce(max(e.serial_cruce), max(a.serial)) serial,
           string_agg(distinct a.serial, ', ') filter (where a.serial ~* 'E\+') serial_evos,
           max(a.direccion) direccion, max(a.cp) cp, max(a.ciudad) ciudad, max(a.provincia) provincia,
           max(a.region) region, string_agg(distinct nullif(a.ac_dc, ''), '/') ac_dc, max(a.potencia) potencia,
           string_agg(distinct nullif(a.cpo, ''), ', ') cpo, count(distinct a.mes) meses,
           sum(a.sesiones) sesiones, round(sum(a.kwh), 3) kwh, round(sum(a.importe), 2) importe,
           round(sum(a.segundos) / 3600.0, 1) horas, min(a.primera) primera, max(a.ultima) ultima,
           max(e.cups20) cups20, max(e.metodo) metodo,
           max(pr.business_model) categoria, max(pr.tipologia) tipologia, max(pr.nombre_cuenta) cuenta, max(pr.estado) estado_activo,
           exists (select 1 from public.cache_prorr_cups f where f.anio = p_anio and f.cups20 = max(e.cups20) and f.kwh <> 0) facturado
    from public.evos_agg a left join public.evos_cups e on e.punto = a.punto
    left join public.puntos_recarga pr on pr.numero_serie = e.serial_cruce
    where a.anio = p_anio group by coalesce(e.serial_cruce, a.punto)) p;
$$;
-- evos_agg con el nº de serie corregido (para la tabla evOS)
drop view if exists public.evos_agg_v;   -- se recrea: evos_agg puede ganar columnas
create or replace view public.evos_agg_v with (security_invoker = true) as
  select a.*, coalesce(e.serial_cruce, a.serial) serial_ok from public.evos_agg a left join public.evos_cups e on e.punto = a.punto;
grant select on public.evos_agg_v to authenticated;
revoke all on public.evos_agg_v from anon;
grant execute on function public.evos_preparar(date[]), public.evos_dashboard(int), public.evos_puntos(int) to authenticated;
revoke execute on function public.evos_preparar(date[]), public.evos_dashboard(int), public.evos_puntos(int) from anon, public;


-- ---------------------------------------------------------------- cruce nº de serie → CUPS
-- Maestros
--   puntos_recarga: el listado de puntos de recarga (Public Infra), con las mismas columnas que el Excel maestro
--   cups:           un registro por CUPS (20 primeros caracteres), con lo que sabemos de las facturas
-- la primera versión de puntos_recarga tenía otras columnas: se sustituye (se recarga con el SQL del maestro)
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'puntos_recarga' and column_name = 'serial') then
    drop table public.puntos_recarga;
  end if;
end $$;
create table if not exists public.puntos_recarga (
  id_activo          text primary key,  -- Id. del activo
  nombre_activo      text,              -- Nombre de activo
  charging_points    int,               -- Charging Points
  estado             text,              -- Estado
  fecha_instalacion  date,              -- Fecha de instalación
  fecha_activacion   timestamp,         -- Fecha de activación
  order_id           text,              -- Order
  modelo             text,              -- Modelo
  numero_serie       text,              -- Número de serie
  nombre_cuenta      text,              -- Nombre de la cuenta
  direccion          text,              -- Dirección
  provincia          text,              -- Provincia
  business_model     text,              -- Business Model
  tipologia          text,              -- Tipología
  codigo_oportunidad text,              -- Código Oportunidad
  cups               text               -- CUPS (tal cual; solo cuenta si tiene formato de CUPS)
);
create index if not exists puntos_recarga_serie_idx on public.puntos_recarga (numero_serie);
create index if not exists puntos_recarga_cups20_idx on public.puntos_recarga (left(cups, 20));
-- CUPS válido (ES + 16 dígitos + 2 letras) recortado a 20 caracteres; null si no lo es
create or replace function public._cups20(v text) returns text language sql immutable as $$
  select case when upper(btrim(v)) ~ '^ES\d{16}[A-Z]{2}' then left(upper(btrim(v)), 20) end;
$$;
-- código postal dentro de la dirección («C/ Antoni Mulet 43, 7150, Andratx» -> 07150)
create or replace function public._cp(v text) returns text language sql immutable as $$
  select lpad(substring(v from '(?:^|,)\s*(\d{4,5})\s*(?:,|$)'), 5, '0');
$$;
create table if not exists public.cups (
  cups20 text primary key, cups text, direccion text, distribuidora text, tarifa text, tension text,
  primera_factura date, ultima_factura date, actualizado timestamptz not null default now());
-- punto de evOS -> CUPS (se recalcula al subir evOS)
create table if not exists public.evos_cups (punto text primary key, serial_cruce text, cups20 text, metodo text);
alter table public.puntos_recarga enable row level security;
alter table public.cups enable row level security;
alter table public.evos_cups enable row level security;
drop policy if exists pr_leer on public.puntos_recarga; drop policy if exists cu_leer on public.cups; drop policy if exists ec_leer on public.evos_cups;
create policy pr_leer on public.puntos_recarga for select to authenticated using (true);
create policy cu_leer on public.cups for select to authenticated using (true);
create policy ec_leer on public.evos_cups for select to authenticated using (true);
revoke all on public.puntos_recarga, public.cups, public.evos_cups from anon;
grant select on public.puntos_recarga, public.cups, public.evos_cups to authenticated;
-- la primera versión del cruce guardaba el inventario completo en cada carga: ya no hace falta
drop function if exists public.cruce_aplicar(bigint);
drop table if exists public.cruce_puntos;
drop table if exists public.cruce_cargas;

-- Empareja los puntos de evOS con el inventario:
--  1) nº de serie idéntico;
--  2) nº de serie estropeado en notación científica (6,2103E+13): número aproximado + mismo código postal,
--     siempre que todos los candidatos tengan el mismo CUPS.
create or replace function public.refrescar_cruce()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  delete from public.evos_cups where true;
  insert into public.evos_cups (punto, serial_cruce, cups20, metodo)
  select p.punto, c.numero_serie, c.cups20, case when c.cups20 is null then 'sin_cups' else 'exacto' end
  from (select punto, max(serial) serial from public.evos_agg group by punto) p
  join lateral (select numero_serie, public._cups20(cups) cups20 from public.puntos_recarga
                where numero_serie = p.serial order by public._cups20(cups) nulls last limit 1) c on true;
  insert into public.evos_cups (punto, serial_cruce, cups20, metodo)
  select p.punto, m.serial, m.cs[1], 'recuperado'
  from (select punto, max(serial) serial, max(cp) cp from public.evos_agg
        where serial ~* '^\d+([.,]\d+)?E\+\d+$' group by punto) p
  cross join lateral (select split_part(replace(upper(p.serial), ',', '.'), 'E+', 1) mant,
                             split_part(upper(p.serial), 'E+', 2)::int ex) y
  cross join lateral (select y.mant::numeric * power(10::numeric, y.ex) v,
                             power(10::numeric, y.ex - (length(replace(y.mant, '.', '')) - 1)) / 2 tol) z
  join lateral (select array_agg(distinct public._cups20(c.cups)) cs, min(c.numero_serie) serial
                from public.puntos_recarga c
                where public._cups20(c.cups) is not null and public._cp(c.direccion) = p.cp and c.numero_serie ~ '^\d{10,}$'
                  and abs(c.numero_serie::numeric - z.v) <= z.tol) m on array_length(m.cs, 1) = 1
  where not exists (select 1 from public.evos_cups e where e.punto = p.punto);
  return (select jsonb_build_object('puntos', count(*), 'exacto', count(*) filter (where metodo = 'exacto'),
                                    'recuperado', count(*) filter (where metodo = 'recuperado'),
                                    'sin_cups', count(*) filter (where metodo = 'sin_cups'))
          from public.evos_cups);
end;
$$;

-- Comparativa del perímetro cruzado: CUPS facturados que tienen puntos de evOS
drop function if exists public.cruce_resumen(int);
-- p_mes: null = todos los meses comparables; un mes = solo ese mes (aunque evOS no lo cubra entero)
create or replace function public.cruce_resumen(p_anio int, p_mes int default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with
  -- nº de serie del maestro con suministro nuestro: Business Model = Public Infra y Tipología = NNSS (nuevo suministro)
  nnss as (select distinct numero_serie from public.puntos_recarga
           where lower(btrim(business_model)) = 'public infra' and upper(btrim(tipologia)) = 'NNSS'),
  ev as (   -- evOS por mes y CUPS (null = sin CUPS)
    select a.mes, e.cups20, e.metodo, upper(a.tipo) tipo, (n.numero_serie is not null) nn,
           sum(a.kwh)::float8 kwh, sum(a.importe)::float8 importe, sum(a.sesiones) sesiones
    from public.evos_agg a left join public.evos_cups e on e.punto = a.punto
    left join nnss n on n.numero_serie = e.serial_cruce
    where a.anio = p_anio group by 1, 2, 3, 4, 5),
  fa as (select mes, cups20, kwh, neto from public.cache_prorr_cups where anio = p_anio),
  fcups as (select cups20 from fa group by 1 having sum(abs(kwh)) > 0),
  ecups as (select distinct cups20 from ev where cups20 is not null),
  per as (select cups20 from fcups intersect select cups20 from ecups),
  dias as (select extract(month from dia)::int mes, count(distinct dia) dias from public.evos_dia
           where dia >= make_date(p_anio, 1, 1) and dia < make_date(p_anio + 1, 1, 1) group by 1),
  comp as (select d.mes from dias d
           where d.dias >= extract(day from (make_date(p_anio, d.mes, 1) + interval '1 month' - interval '1 day'))),
  fm as (select fa.mes, sum(fa.kwh) f_tot, sum(fa.kwh) filter (where per.cups20 is not null) f_per,
                sum(fa.neto) filter (where per.cups20 is not null) f_neto_per
         from fa left join per using (cups20) group by 1),
  em as (select ev.mes, sum(ev.kwh) e_tot, sum(ev.kwh) filter (where per.cups20 is not null) e_per,
                sum(ev.importe) filter (where per.cups20 is not null) e_imp_per,
                sum(ev.kwh) filter (where ev.cups20 is null) e_sin,
                sum(ev.kwh) filter (where ev.cups20 is not null and fc.cups20 is null) e_nofact,
                sum(ev.kwh) filter (where ev.metodo = 'recuperado' and per.cups20 is not null) e_rec,
                sum(ev.kwh) filter (where ev.metodo is not null) e_pi,                         -- puntos del maestro (Public Infra)
                sum(ev.kwh) filter (where ev.metodo is not null and ev.cups20 is null) e_pi_sin,
                sum(ev.kwh) filter (where ev.tipo = 'PUBLIC') e_public,              -- evOS con Type = PUBLIC
                sum(ev.kwh) filter (where ev.tipo is null) e_sin_tipo,               -- ficheros subidos antes de guardar el Type
                sum(ev.kwh) filter (where ev.nn) e_nn,                                     -- puntos NNSS (suministro nuestro)
                sum(ev.kwh) filter (where ev.nn and ev.cups20 is null) e_nn_sin,
                sum(ev.kwh) filter (where ev.nn and cu.tension = 'BT') e_bt,                -- NNSS por la tensión de su CUPS
                sum(ev.kwh) filter (where ev.nn and cu.tension = 'MT') e_mt
         from ev left join per using (cups20) left join fcups fc using (cups20)
         left join public.cups cu on cu.cups20 = ev.cups20 group by 1),
  sel as (select mes from comp where p_mes is null union select p_mes where p_mes is not null),
  fc_c as (select cups20, sum(kwh) f_kwh, sum(neto) f_neto from fa where mes in (select mes from sel) group by 1),
  ev_c as (select cups20, sum(kwh) e_kwh, sum(sesiones) e_ses from ev where mes in (select mes from sel) and cups20 is not null group by 1),
  pts as (select cups20, count(*) puntos from public.evos_cups where cups20 is not null group by 1),
  dirs as (select left(cups, 20) cups20, max(cups) cups, max(direccion) direccion from public.cache_cups where anio = p_anio group by 1),
  porcups as (select p.cups20, f.f_kwh, f.f_neto, e.e_kwh, e.e_ses, coalesce(t.puntos, 0) puntos, d.direccion, d.cups
              from per p left join fc_c f using (cups20) left join ev_c e using (cups20)
              left join pts t using (cups20) left join dirs d using (cups20))
  select jsonb_build_object(
    'anio', p_anio,
    'cruce', (select case when count(*) > 0 then jsonb_build_object('puntos', count(*), 'con_cups', count(public._cups20(pr.cups)),
                'sin_cups', count(*) filter (where public._cups20(pr.cups) is null),
                'nnss', count(*) filter (where pr.nn),
                'nnss_sin_cups', count(*) filter (where pr.nn and public._cups20(pr.cups) is null),
                'bt', count(*) filter (where pr.nn and cu.tension = 'BT'), 'mt', count(*) filter (where pr.nn and cu.tension = 'MT'),
                'sin_tension', count(*) filter (where pr.nn and public._cups20(pr.cups) is not null and cu.tension is null)) end
              from (select *, lower(btrim(business_model)) = 'public infra' and upper(btrim(tipologia)) = 'NNSS' nn from public.puntos_recarga) pr
              left join public.cups cu on cu.cups20 = public._cups20(pr.cups)),
    'comparables', (select coalesce(jsonb_agg(mes order by mes), '[]') from comp),
    'mes', p_mes,
    'dias_mes', (select dias from dias where mes = p_mes),
    'mensual', (select jsonb_agg(jsonb_build_object('mes', g.mes, 'f_per', fm.f_per, 'f_neto_per', fm.f_neto_per, 'f_tot', fm.f_tot,
                                                    'e_per', em.e_per, 'e_imp_per', em.e_imp_per, 'e_tot', em.e_tot,
                                                    'e_sin', em.e_sin, 'e_nofact', em.e_nofact, 'e_rec', em.e_rec,
                                                    'e_pi', em.e_pi, 'e_pi_sin', em.e_pi_sin,
                                                    'e_public', em.e_public, 'e_sin_tipo', em.e_sin_tipo,
                                                    'e_bt', em.e_bt, 'e_mt', em.e_mt, 'e_nn', em.e_nn, 'e_nn_sin', em.e_nn_sin) order by g.mes)
                from generate_series(1, 12) g(mes) left join fm on fm.mes = g.mes left join em on em.mes = g.mes),
    'n', jsonb_build_object('pi', (select count(distinct coalesce(serial_cruce, punto)) from public.evos_cups), 'per', (select count(*) from per), 'fcups', (select count(*) from fcups), 'ecups', (select count(*) from ecups)),
    'cups', (select coalesce(jsonb_agg(jsonb_build_object(
        'cups20', c.cups20, 'cups', c.cups, 'direccion', c.direccion, 'puntos', c.puntos,
        'f_kwh', round(c.f_kwh::numeric, 1), 'f_neto', round(c.f_neto::numeric, 2),
        'e_kwh', round(c.e_kwh::numeric, 1), 'e_ses', c.e_ses
      ) order by coalesce(c.f_kwh, 0) - coalesce(c.e_kwh, 0) desc), '[]') from porcups c)
  );
$$;
-- Detalle de un CUPS en un mes: sus facturas (con la parte que cae en el mes) y sus puntos de evOS
create or replace function public.cruce_detalle(p_anio int, p_mes int, p_cups20 text)
returns jsonb language sql stable security definer set search_path = public as $$
  with r as (select make_date(p_anio, p_mes, 1) d0, (make_date(p_anio, p_mes, 1) + interval '1 month')::date - 1 d1),
  f as (
    select f.id_factura, max(f.cups) cups, max(f.estado) estado, max(f.tension) tension, max(f.tarifa) tarifa, max(f.tipo_lectura) tipo_lectura,
           max(f.fecha_emision) fecha_emision, max(f.fecha_desde) fecha_desde, max(f.fecha_hasta) fecha_hasta,
           sum(f.kwh) kwh, sum(f.imp_neto) neto, bool_or(f.excluida) excluida, bool_or(f.sustituida) sustituida,
           max(f.motivo_sust) motivo_sust, bool_or(f.negativa) negativa, bool_or(f.anomala) anomala,
           max(f.archivo_origen) archivo
    from public.facturas_calc f, r
    where f.cups >= p_cups20 and f.cups <= p_cups20 || 'ZZZZ' and left(f.cups, 20) = p_cups20
      and f.fecha_hasta >= r.d0 and coalesce(f.fecha_desde, f.fecha_hasta) <= r.d1
    group by f.id_factura),
  fw as (
    select f.*, case when f.fecha_desde is not null and f.fecha_hasta - f.fecha_desde between 0 and 400
                     then (least(f.fecha_hasta, r.d1) - greatest(f.fecha_desde, r.d0) + 1)::numeric / (f.fecha_hasta - f.fecha_desde + 1)
                     else case when f.fecha_hasta between r.d0 and r.d1 then 1 else 0 end end parte
    from f, r)
  select jsonb_build_object(
    'anio', p_anio, 'mes', p_mes, 'cups20', p_cups20,
    'direccion', (select max(direccion) from public.cache_cups where left(cups, 20) = p_cups20),
    'facturas', (select coalesce(jsonb_agg(jsonb_build_object(
        'id_factura', id_factura, 'cups', cups, 'estado', estado, 'tension', tension, 'tarifa', tarifa, 'tipo_lectura', tipo_lectura,
        'fecha_emision', fecha_emision, 'fecha_desde', fecha_desde, 'fecha_hasta', fecha_hasta, 'kwh', kwh, 'neto', neto,
        'parte', round(parte, 4), 'kwh_mes', case when not excluida and not sustituida then round(kwh * parte, 1) end,
        'cuenta', not excluida and not sustituida, 'excluida', excluida, 'sustituida', sustituida, 'motivo_sust', motivo_sust,
        'negativa', negativa, 'anomala', anomala, 'archivo', archivo) order by fecha_desde, fecha_emision), '[]') from fw),
    'puntos', (select coalesce(jsonb_agg(p order by p.kwh desc), '[]') from (
        select a.punto, max(a.serial) serial, max(e.serial_cruce) serial_cruce, max(e.metodo) metodo, max(a.direccion) direccion,
               max(a.cp) cp, max(a.ciudad) ciudad, string_agg(distinct nullif(a.ac_dc, ''), '/') ac_dc, max(a.potencia) potencia,
               sum(a.sesiones) sesiones, round(sum(a.kwh), 1) kwh, round(sum(a.segundos) / 3600.0, 1) horas
        from public.evos_cups e join public.evos_agg a on a.punto = e.punto and a.anio = p_anio and a.mes = p_mes
        where e.cups20 = p_cups20 group by a.punto) p),
    'puntos_sin_sesiones', (select coalesce(jsonb_agg(c.numero_serie order by c.numero_serie), '[]') from public.puntos_recarga c
        where left(c.cups, 20) = p_cups20 and public._cups20(c.cups) = p_cups20
          and not exists (select 1 from public.evos_cups e join public.evos_agg a on a.punto = e.punto and a.anio = p_anio and a.mes = p_mes
                          where e.cups20 = p_cups20 and e.serial_cruce = c.numero_serie))
  );
$$;
grant execute on function public.refrescar_cruce(), public.cruce_resumen(int, int), public.cruce_detalle(int, int, text) to authenticated;
revoke execute on function public.refrescar_cruce(), public.cruce_resumen(int, int), public.cruce_detalle(int, int, text) from anon, public;

-- ---------------------------------------------------------------- estado del maestro de puntos
-- Resumen del maestro de puntos de recarga para la pestaña «Puntos» del inicio
create or replace function public.puntos_resumen(p_anio int)
returns jsonb language sql stable security definer set search_path = public as $$
  with ses as (select e.serial_cruce from public.evos_cups e join public.evos_agg a on a.punto = e.punto and a.anio = p_anio
               where e.serial_cruce is not null group by 1),
  p as (
    select pr.*, public._cups20(pr.cups) c20, (ses.serial_cruce is not null) con_sesiones
    from public.puntos_recarga pr left join ses on ses.serial_cruce = pr.numero_serie),
  fac as (select cups20 from public.cache_prorr_cups where anio = p_anio group by 1 having sum(abs(kwh)) > 0),
  q as (select p.*, (p.c20 is not null and exists (select 1 from fac where fac.cups20 = p.c20)) facturado from p)
  select jsonb_build_object(
    'anio', p_anio,
    'kpi', (select jsonb_build_object(
        'puntos', count(*), 'charging_points', coalesce(sum(charging_points), 0),
        'con_cups', count(*) filter (where c20 is not null), 'sin_cups', count(*) filter (where c20 is null),
        'cups', count(distinct c20), 'cups_facturados', count(distinct c20) filter (where facturado),
        'con_sesiones', count(*) filter (where con_sesiones),
        'con_cups_fact', count(*) filter (where facturado),
        'perimetro', count(*) filter (where facturado and con_sesiones)) from q),
    'motivos', (select coalesce(jsonb_agg(jsonb_build_object('motivo', motivo, 'n', n) order by n desc), '[]') from (
        select case when nullif(btrim(cups), '') is null then 'Sin CUPS informado'
                    when cups ~* 'CPO' then 'Marcado como CPO'
                    when cups ~* 'aplica' then 'No aplica'
                    else 'CUPS con formato erróneo' end motivo, count(*) n
        from q where c20 is null group by 1) m),
    'tipologias', (select coalesce(jsonb_agg(t order by t.puntos desc), '[]') from (
        select coalesce(nullif(btrim(tipologia), ''), 'Sin tipología') tipologia, count(*) puntos,
               count(*) filter (where c20 is null) sin_cups, sum(charging_points) charging_points,
               count(*) filter (where con_sesiones) con_sesiones
        from q group by 1) t),
    'provincias', (select coalesce(jsonb_agg(t order by t.puntos desc), '[]') from (
        select coalesce(nullif(btrim(provincia), ''), 'Sin provincia') provincia, count(*) puntos,
               count(*) filter (where c20 is null) sin_cups
        from q group by 1) t),
    'altas', (select coalesce(jsonb_agg(t order by t.anio), '[]') from (
        select extract(year from fecha_activacion)::int anio, count(*) puntos, sum(charging_points) charging_points
        from q where fecha_activacion is not null group by 1) t),
    'modelos', (select coalesce(jsonb_agg(t order by t.puntos desc), '[]') from (
        select modelo, count(*) puntos from q group by 1 order by 2 desc limit 10) t)
  );
$$;

-- Puntos del maestro sin CUPS válido, con su actividad en evOS en el año
create or replace function public.puntos_sin_cups(p_anio int)
returns jsonb language sql stable security definer set search_path = public as $$
  with ses as (select e.serial_cruce, sum(a.sesiones) sesiones, round(sum(a.kwh), 1) kwh
               from public.evos_cups e join public.evos_agg a on a.punto = e.punto and a.anio = p_anio
               where e.serial_cruce is not null group by 1)
  select coalesce(jsonb_agg(t order by t.kwh desc nulls last, t.nombre_activo), '[]') from (
    select pr.id_activo, pr.nombre_activo, pr.numero_serie, pr.nombre_cuenta, pr.direccion, pr.provincia, pr.tipologia,
           pr.charging_points, pr.estado, pr.fecha_activacion, pr.modelo, pr.codigo_oportunidad, pr.order_id, pr.cups,
           ses.sesiones, ses.kwh
    from public.puntos_recarga pr left join ses on ses.serial_cruce = pr.numero_serie
    where public._cups20(pr.cups) is null) t;
$$;
grant execute on function public.puntos_resumen(int), public.puntos_sin_cups(int) to authenticated;
revoke execute on function public.puntos_resumen(int), public.puntos_sin_cups(int) from anon, public;

-- ---------------------------------------------------------------- ajustes finales
-- Más margen para consultas pesadas (por defecto Supabase corta a los 8 s)
alter role authenticated set statement_timeout = '60s';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';

-- Aplica las reglas de corrección a las facturas ya guardadas (rápido).
-- La revisión de refacturaciones de las facturas antiguas la hace la web al entrar, por tandas.
select public.recalcular_correcciones();
-- Rellena la caché del dashboard
select public.refrescar_cache();
