-- =====================================================================
--  eMob · Costes de energía — esquema para Supabase
--  Pegar entero en Supabase > SQL Editor > New query > Run.
--  Se puede volver a ejecutar sin perder datos (crea solo lo que falta
--  y redefine funciones y reglas).
-- =====================================================================

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
  return null;
end;
$$;
drop trigger if exists correcciones_cambio on public.correcciones;
create trigger correcciones_cambio after insert or update or delete on public.correcciones
  for each statement execute function public.tg_correcciones();

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
       public._neg(f.kwh, c.negativa) kwh,
       public._neg(f.kwh_p1, c.negativa) kwh_p1, public._neg(f.kwh_p2, c.negativa) kwh_p2,
       public._neg(f.kwh_p3, c.negativa) kwh_p3, public._neg(f.kwh_p4, c.negativa) kwh_p4,
       public._neg(f.kwh_p5, c.negativa) kwh_p5, public._neg(f.kwh_p6, c.negativa) kwh_p6,
       public._neg(f.imp_neto, c.negativa) imp_neto,         public._neg(f.imp_total, c.negativa) imp_total,
       public._neg(f.imp_energia, c.negativa) imp_energia,   public._neg(f.imp_potencia, c.negativa) imp_potencia,
       public._neg(f.imp_exceso, c.negativa) imp_exceso,     public._neg(f.imp_alquiler, c.negativa) imp_alquiler,
       public._neg(f.imp_ie, c.negativa) imp_ie,             public._neg(f.imp_otros, c.negativa) imp_otros,
       public._neg(f.imp_iva, c.negativa) imp_iva,
       public._tension(f.tarifa) tension
from public.facturas f
cross join lateral (select f.negativa, f.excluida) c;

-- Solo las filas que cuentan (sin excluidas): base de todos los cálculos
create or replace view public.facturas_ok with (security_invoker = true) as
select * from public.facturas_calc where not excluida;

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

create or replace function public.anios(p_base text default 'consumo', p_tension text default null)
returns int[] language sql stable as $$
  select coalesce(array_agg(a order by a desc), '{}')
  from (select distinct extract(year from public._fb(f.fecha_emision, f.fecha_hasta, p_base))::int a
        from public._ft(p_tension) f where public._fb(f.fecha_emision, f.fecha_hasta, p_base) is not null) s;
$$;

create or replace function public.resumen()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'filas',        (select count(*) from public.facturas),
    'excluidas',    (select count(*) from public.facturas where excluida),
    'negativas',    (select count(*) from public.facturas where negativa),
    'facturas',     (select count(distinct id_factura) from public.facturas),
    'ultima_carga', (select max(fecha) from public.cargas),
    'admin',        public.es_admin()
  );
$$;

create or replace function public.puntos(p_anio int default null, p_base text default 'consumo', p_tension text default null)
returns table (cups text, direccion text, distribuidora text, tarifa text, facturas bigint,
               kwh numeric, neto numeric, total numeric, eur_kwh numeric, exceso_eur numeric,
               desde date, hasta date)
language sql stable as $$
  select f.cups,
         (array_agg(f.direccion     order by f.fecha_hasta desc nulls last))[1],
         (array_agg(f.distribuidora order by f.fecha_hasta desc nulls last))[1],
         (array_agg(f.tarifa        order by f.fecha_hasta desc nulls last))[1],
         count(distinct f.id_factura),
         coalesce(sum(f.kwh), 0),
         coalesce(sum(f.imp_neto), 0),
         coalesce(sum(f.imp_total), 0),
         case when sum(f.kwh) > 0 then sum(f.imp_neto) / sum(f.kwh) end,
         coalesce(sum(f.imp_exceso), 0),
         min(f.fecha_desde),
         max(f.fecha_hasta)
  from public._ft(p_tension) f
  where p_anio is null or extract(year from public._fb(f.fecha_emision, f.fecha_hasta, p_base)) = p_anio
  group by f.cups
  order by 6 desc;
$$;

create or replace function public.dashboard(p_anio int default null, p_base text default 'consumo', p_tension text default null)
returns jsonb language plpgsql stable as $$
declare
  r jsonb;
  v_meses int[];
  v_fact bigint;
  v_prev jsonb := null;
begin
  select array_agg(distinct extract(month from public._fb(f.fecha_emision, f.fecha_hasta, p_base))::int),
         count(distinct f.id_factura)
    into v_meses, v_fact
  from public._ft(p_tension) f
  where p_anio is null or extract(year from public._fb(f.fecha_emision, f.fecha_hasta, p_base)) = p_anio;

  if v_fact = 0 then
    return jsonb_build_object('vacio', true);
  end if;

  if p_anio is not null then
    select case when count(distinct f.id_factura) >= 0.5 * v_fact then
             jsonb_build_object('kwh', coalesce(sum(f.kwh), 0), 'neto', coalesce(sum(f.imp_neto), 0))
           end
      into v_prev
    from public._ft(p_tension) f
    where extract(year from public._fb(f.fecha_emision, f.fecha_hasta, p_base)) = p_anio - 1
      and extract(month from public._fb(f.fecha_emision, f.fecha_hasta, p_base))::int = any (v_meses);
  end if;

  with f as (
    select f.*, public._fb(f.fecha_emision, f.fecha_hasta, p_base) as fecha
    from public._ft(p_tension) f
    where p_anio is null or extract(year from public._fb(f.fecha_emision, f.fecha_hasta, p_base)) = p_anio
  ),
  kpi as (
    select jsonb_build_object(
      'kwh',            coalesce(sum(kwh), 0),
      'neto',           coalesce(sum(imp_neto), 0),
      'total',          coalesce(sum(imp_total), 0),
      'eur_kwh',        case when sum(kwh) > 0 then sum(imp_neto) / sum(kwh) end,
      'facturas',       count(distinct id_factura),
      'anuladas',       count(distinct id_factura) filter (where estado in ('A', 'C') or negativa),
      'rectificativas', count(distinct id_factura) filter (where estado = 'R'),
      'puntos',         count(distinct cups) filter (where coalesce(kwh, 0) <> 0),
      'puntos_total',   count(distinct cups),
      'exceso_eur',     coalesce(sum(imp_exceso), 0),
      'puntos_exceso',  count(distinct cups) filter (where imp_exceso > 0),
      'ultima_emision', to_char(max(fecha_emision), 'DD/MM/YYYY')
    ) j from f
  ),
  mens as (
    select m.mes,
           sum(f.kwh) kwh, sum(f.imp_neto) neto, sum(f.imp_total) total,
           count(distinct f.id_factura) facturas
    from generate_series(1, 12) m(mes)
    left join f on extract(month from f.fecha)::int = m.mes
    group by m.mes
  ),
  costes as (
    select sum(imp_energia) e, sum(imp_potencia) p, sum(imp_exceso) x, sum(imp_alquiler) a,
           sum(imp_ie) ie, sum(imp_otros) o, sum(imp_iva) iva, sum(imp_total) t
    from f
  ),
  lect as (
    select tipo_lectura, count(distinct id_factura) n
    from f where tipo_lectura is not null group by tipo_lectura
  )
  select jsonb_build_object(
    'vacio', false,
    'anio',  p_anio,
    'base',  p_base,
    'tension', p_tension,
    'kpi',   (select j from kpi),
    'previo', case when v_prev is not null then v_prev || jsonb_build_object('meses', to_jsonb(v_meses)) end,
    'mensual', (select jsonb_agg(jsonb_build_object(
                  'mes', mes, 'kwh', kwh, 'neto', neto, 'total', total,
                  'eur_kwh', case when kwh > 0 then neto / kwh end,
                  'facturas', facturas) order by mes) from mens),
    'periodos', (select jsonb_build_array(
                  jsonb_build_object('periodo', 'P1', 'kwh', coalesce(sum(kwh_p1), 0)),
                  jsonb_build_object('periodo', 'P2', 'kwh', coalesce(sum(kwh_p2), 0)),
                  jsonb_build_object('periodo', 'P3', 'kwh', coalesce(sum(kwh_p3), 0)),
                  jsonb_build_object('periodo', 'P4', 'kwh', coalesce(sum(kwh_p4), 0)),
                  jsonb_build_object('periodo', 'P5', 'kwh', coalesce(sum(kwh_p5), 0)),
                  jsonb_build_object('periodo', 'P6', 'kwh', coalesce(sum(kwh_p6), 0))) from f),
    'costes', (select jsonb_agg(x) from (
                  select jsonb_build_object('concepto', c.k, 'eur', c.v) x, c.o
                  from costes, lateral (values
                    (1, 'Energía', coalesce(e, 0)),
                    (2, 'Potencia contratada', coalesce(p, 0)),
                    (3, 'Exceso de potencia', coalesce(x, 0)),
                    (4, 'Alquiler de equipos', coalesce(a, 0)),
                    (5, 'Impuesto eléctrico', coalesce(ie, 0)),
                    (6, 'Otros conceptos', coalesce(o, 0)),
                    (7, 'Otros ajustes', coalesce(t, 0) - coalesce(e, 0) - coalesce(p, 0) - coalesce(x, 0)
                                         - coalesce(a, 0) - coalesce(ie, 0) - coalesce(o, 0) - coalesce(iva, 0)),
                    (8, 'IVA / IGIC', coalesce(iva, 0))) c(o, k, v)
                  where c.k <> 'Otros ajustes' or abs(c.v) > 0.5
                  order by c.o) s),
    'top', (select coalesce(jsonb_agg(jsonb_build_object('cups', p.cups, 'direccion', p.direccion,
                    'kwh', p.kwh, 'neto', p.neto, 'eur_kwh', p.eur_kwh)), '[]')
            from (select * from public.puntos(p_anio, p_base, p_tension) limit 10) p),
    'lecturas', (select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo_lectura, 'facturas', n)
                    order by n desc), '[]') from lect)
  ) into r;

  return r;
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
end;
$$;

grant execute on function public.anios(text, text), public.resumen(), public.puntos(int, text, text),
                 public.dashboard(int, text, text), public.vaciar(), public.es_admin(),
                 public.correcciones_resumen(), public.valores_campo(text) to authenticated;
revoke execute on function public.anios(text, text), public.resumen(), public.puntos(int, text, text),
                  public.dashboard(int, text, text), public.vaciar() from anon, public;


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
    select extract(month from f.fecha_hasta)::int mes,
           f.tension seg,
           sum(f.kwh) kwh, sum(f.imp_energia) energia,
           coalesce(sum(f.imp_potencia), 0) + coalesce(sum(f.imp_alquiler), 0) fijo,
           sum(f.imp_neto) neto, count(distinct f.id_factura) facturas
    from public.facturas_ok f
    where extract(year from f.fecha_hasta) = p_anio
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

-- Aplica las reglas actuales a las facturas ya guardadas
select public.recalcular_correcciones();
