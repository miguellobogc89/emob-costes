/* Lectura de Excels / ZIPs en el navegador y preparación de filas para Supabase. */
const EXT_EXCEL = /\.(xlsx|xlsm|xls)$/i;
const EXT_ZIP = /\.zip$/i;
const EXT_DATOS = /\.(xlsx|xlsm|xls|csv)$/i;   // lo que se puede subir dentro de un ZIP o suelto
const esTemporal = (n) => /(^|\/)(~\$|\._)/.test(n) || n.includes('__MACOSX');

const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- recolección
/** Expande ficheros sueltos y ZIPs (también anidados) en [{nombre, datos:ArrayBuffer}] */
async function recolectar(archivos, log) {
  const out = [];
  async function zip(nombre, buf) {
    let z;
    try { z = await JSZip.loadAsync(buf); } catch { log(`⚠ ZIP no válido, se ignora: ${nombre}`); return; }
    for (const e of Object.values(z.files)) {
      if (e.dir || esTemporal(e.name)) continue;
      if (EXT_DATOS.test(e.name)) out.push({ nombre: `${nombre}/${e.name}`, datos: await e.async('arraybuffer') });
      else if (EXT_ZIP.test(e.name)) await zip(`${nombre}/${e.name}`, await e.async('arraybuffer'));
    }
  }
  for (const { n, f } of archivos) {
    if (esTemporal(n)) continue;
    if (EXT_DATOS.test(n)) out.push({ nombre: n, datos: await f.arrayBuffer() });
    else if (EXT_ZIP.test(n)) await zip(n, await f.arrayBuffer());
  }
  return out;
}

/** Algunos .xls son en realidad una tabla HTML (exportaciones de Salesforce): se leen como texto en su codificación. */
function libro(datos, opts = {}) {
  const b = new Uint8Array(datos);
  const ini = new TextDecoder('latin1').decode(b.slice(0, 64)).trimStart().toLowerCase();
  if (ini.startsWith('<')) {
    let t = new TextDecoder('utf-8').decode(b);
    if (t.includes('\uFFFD')) t = new TextDecoder('windows-1252').decode(b);
    return XLSX.read(t, { type: 'string', raw: true, ...opts });
  }
  return XLSX.read(datos, { type: 'array', cellDates: false, ...opts });
}

/** Qué es un fichero: 'facturas' (Endesa), 'evos' (sesiones), 'analitico' (Excel del equipo) o 'cruce' (nº de serie → CUPS). null si no se reconoce. */
function tipoFichero(nombre, datos) {
  if (/\.csv$/i.test(nombre)) return 'evos';
  let wb;
  try { wb = libro(datos, { sheetRows: 80 }); } catch { return null; }
  let ana = false;
  for (const sh of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sh], { header: 1, raw: true, defval: null, blankrows: false });
    const cab = (aoa[0] || []).map(norm);
    if (cab.includes('ID PSEUDOFACTURA')) return 'facturas';
    if (cab.includes('NUMERO DE SERIE') && cab.some((c) => c.includes('CUPS'))) return 'cruce';
    if (cab.includes('SESSION ID')) return 'evos';
    if (aoa.some((r) => r && norm(r[0]) === 'BT')) ana = true;
  }
  return ana ? 'analitico' : null;
}

// ---------------------------------------------------------------- valores
const pad = (n) => String(n).padStart(2, '0');
function aFechaISO(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && isFinite(v)) {                    // número de serie de Excel
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);          // dd/mm/aaaa
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);                          // aaaa-mm-dd
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
function num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const n = Number(String(v).trim().replace(/\s/g, ''));
  return isFinite(n) ? n : null;
}
/** Representación estable de una celda para la huella (independiente del tipo leído). */
function celda(v) {
  if (v == null) return '';
  if (typeof v === 'number') return isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : '';
  if (typeof v === 'boolean') return String(v);
  return String(v).trim();
}
async function sha(texto) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(b)].slice(0, 20).map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function shaBuf(buf) {
  const b = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- mapeo de columnas
const COSTES = {
  imp_energia: ['IMPORTE TOTAL ACTIVA'],
  imp_potencia: ['IMPORTE POTENCIA CONTRATADA'],
  imp_exceso: ['IMPORTE EXCESO DE POTENCIA'],
  imp_alquiler: ['IMPORTE ALQUILER', 'IMPORTE AJUSTE ALQUILER'],
  imp_ie: ['IMPORTE IE', 'IMPORTE EXENCION/REDUCCION IE', 'IMPORTE CIM'],
  imp_otros: ['IMPORTE CONCEPTO ', 'IMPORTE TOTAL REACTIVA'],
  imp_iva: ['IMPORTE IVA', 'IMPORTE IGIC', 'IMPORTE IPSI'],
};
function plan(columnas) {
  const N = columnas.map(norm);
  const idx = (nombre) => N.indexOf(norm(nombre));
  const pref = (lista) => N.map((c, i) => (lista.some((p) => c === p.trim() || c.startsWith(p)) ? i : -1)).filter((i) => i >= 0);
  const p = {
    fechas: N.map((c, i) => (c.startsWith('FECHA') ? i : -1)).filter((i) => i >= 0),
    id: idx('ID PSEUDOFACTURA'), estado: idx('ESTADO DE LA FACTURA'), cups: idx('CUPS EXTERNO'), dir: idx('DIRECCIÓN PS'),
    distr: idx('EMPRESA DISTRIBUIDORA'), tarifa: idx('TARIFA ATR'), lectura: idx('TIPO LECTURA'),
    f_emi: idx('FECHA EMISIÓN PSEUDOFACTURA'), f_desde: idx('FECHA DESDE PSEUDOFACTURA'), f_hasta: idx('FECHA HASTA PSEUDOFACTURA'),
    kwh: idx('CONSUMO TOTAL ACTIVA'), neto: idx('IMPORTE NETO PSEUDO'), total: idx('IMPORTE TOTAL PSEUDO'),
    p: [1, 2, 3, 4, 5, 6].map((k) => idx('CONSUMOS P' + k)),
    costes: Object.fromEntries(Object.entries(COSTES).map(([k, l]) => [k, pref(l)])),
    orden: columnas.map((_, i) => i).sort((a, b) => (columnas[a] < columnas[b] ? -1 : columnas[a] > columnas[b] ? 1 : 0)),
  };
  if (p.f_emi < 0) p.f_emi = N.findIndex((c) => c.includes('FECHA') && c.includes('EMISION'));
  return p;
}

// ---------------------------------------------------------------- lectura de un Excel
/** Devuelve [{sheet, columnas, filas:[array de valores]}] */
function leerLibro(nombre, datos, log) {
  let wb;
  try { wb = XLSX.read(datos, { type: 'array', dense: true, cellDates: false }); }
  catch (e) { log(`⚠ No se pudo leer ${nombre}: ${e.message}`); return []; }
  const partes = [];
  for (const sh of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sh], { header: 1, raw: true, defval: null, blankrows: false });
    if (aoa.length < 2) { log(`   · ${nombre} › ${sh}: vacía, se omite`); continue; }
    const columnas = aoa[0].map((c, i) => (c == null || String(c).trim() === '' ? `Unnamed: ${i}` : String(c).trim()));
    const N = columnas.map(norm);
    // solo pestañas de facturas (p. ej. en 2025 algunas agrupadas traen una pestaña «Importe factura» de resumen)
    if (!N.includes('ID PSEUDOFACTURA')) { log(`   · ${nombre} › ${sh}: no es una pestaña de facturas (resumen), se omite`); continue; }
    const filas = aoa.slice(1).filter((r) => r.some((v) => v !== null && v !== ''));
    if (!filas.length) continue;
    // control: la suma de las facturas de la pestaña debe cuadrar con el total de la factura agrupada
    const iT = N.indexOf('IMPORTE TOTAL PSEUDO'), iA = N.indexOf('IMPORTE TOTAL FACTURA AGRUPADA');
    if (iT >= 0 && iA >= 0) {
      const suma = filas.reduce((a, r) => a + (num(r[iT]) || 0), 0);
      const agr = num(filas.find((r) => num(r[iA]) != null)?.[iA]);
      if (agr != null && Math.abs(suma - agr) > 1)
        log(`⚠ ${nombre} › ${sh}: las facturas suman ${suma.toFixed(2)} € y la agrupada dice ${agr.toFixed(2)} € (diferencia ${(suma - agr).toFixed(2)} €)`);
    }
    partes.push({ sheet: sh, columnas, filas: filas.map((r) => columnas.map((_, i) => (r[i] === undefined ? null : r[i]))) });
  }
  log(`✔ ${nombre}: ${partes.length} pestañas, ${partes.reduce((a, p) => a + p.filas.length, 0)} filas`);
  return partes;
}

/** Convierte las partes en filas listas para la tabla `facturas` (sin cabecera_id ni carga_id). */
async function prepararFilas(nombreArchivo, partes, vistas, log) {
  const filas = []; let dup = 0;
  const base = nombreArchivo.split('/').pop();
  for (const parte of partes) {
    const p = plan(parte.columnas);
    const claveCab = parte.columnas.join('\u001f');
    for (const r of parte.filas) {
      for (const i of p.fechas) r[i] = aFechaISO(r[i]) ?? (r[i] == null ? null : String(r[i]));
      const h = await sha(p.orden.map((i) => parte.columnas[i] + '\u001f' + celda(r[i])).join('\u001e'));
      if (vistas.has(h)) { dup++; continue; }
      vistas.add(h);
      const g = (i) => (i >= 0 ? r[i] : null);
      const s = (i) => { const v = g(i); return v == null || v === '' ? null : String(v).trim(); };
      const suma = (ids) => { let t = null; for (const i of ids) { const n = num(r[i]); if (n != null) t = (t ?? 0) + n; } return t; };
      const fe = g(p.f_emi);
      const fila = {
        huella: h, _cab: claveCab, _columnas: parte.columnas,
        sheet_code: parte.sheet, archivo_origen: base,
        id_factura: s(p.id), estado: s(p.estado), cups: s(p.cups), direccion: s(p.dir), distribuidora: s(p.distr),
        tarifa: s(p.tarifa), tipo_lectura: s(p.lectura),
        fecha_emision: fe, fecha_desde: g(p.f_desde), fecha_hasta: g(p.f_hasta), mes_emision: fe ? fe.slice(0, 7) : null,
        kwh: num(g(p.kwh)), imp_neto: num(g(p.neto)), imp_total: num(g(p.total)),
        valores: r,
      };
      p.p.forEach((i, k) => { fila['kwh_p' + (k + 1)] = num(g(i)); });
      for (const [k, ids] of Object.entries(p.costes)) fila[k] = suma(ids);
      filas.push(fila);
    }
  }
  if (dup) log(`✂ ${dup} filas duplicadas eliminadas de ${base}`);
  return { filas, dup };
}

// ---------------------------------------------------------------- analítico del equipo
/** Lee el Excel "Costes por BT y MT" que monta el equipo.
 *  Busca por etiquetas (no por celdas fijas): bloques BT y MT en la columna A, filas CONSUMO,
 *  fila de fechas (meses) y filas CV / RevShare / CF, y la columna "de los cuales PYC".
 *  Devuelve { anio, valores: [{segmento, concepto, mes, valor}], avisos: [] } */
function leerAnalitico(datos) {
  const wb = XLSX.read(datos, { type: 'array', cellDates: false });
  const esSerie = (v) => typeof v === 'number' && v > 36000 && v < 60000;            // fecha Excel (2000-2064)
  const mesAnio = (v) => { const d = new Date(Math.round((v - 25569) * 86400000)); return [d.getUTCMonth() + 1, d.getUTCFullYear()]; };
  const txt = (v) => norm(v);
  for (const nombre of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: true, defval: null, blankrows: true });
    const filaBloque = (et) => aoa.findIndex((r) => r && txt(r[0]) === et);
    const iBT = filaBloque('BT'), iMT = filaBloque('MT');
    if (iBT < 0) continue;
    const avisos = []; const valores = []; const anios = {};
    const tieneConsumo = (r) => r && r.some((v) => txt(v) === 'CONSUMO');
    const filaFechas = (desde, hasta) => {
      for (let i = desde; i < hasta; i++) { const r = aoa[i] || []; if (r.filter(esSerie).length >= 6) return i; }
      return -1;
    };
    const mapaMeses = (iF) => {
      const m = {};
      (aoa[iF] || []).forEach((v, c) => { if (esSerie(v)) { const [mes, an] = mesAnio(v); m[c] = mes; anios[an] = (anios[an] || 0) + 1; } });
      return m;
    };
    const leerFila = (r, meses, seg, concepto) => {
      let n = 0;
      for (const [c, mes] of Object.entries(meses)) {
        const v = r[c];
        if (typeof v === 'number' && isFinite(v)) { valores.push({ segmento: seg, concepto, mes, valor: v }); n++; }
      }
      return n;
    };
    const bloques = [['BT', iBT, iMT > iBT ? iMT : aoa.length], ['MT', iMT, iMT >= 0 ? (iBT > iMT ? iBT : aoa.length) : -1]];
    let mesesRef = null;
    for (const [seg, ini, fin] of bloques) {
      if (ini < 0) continue;
      const iF = filaFechas(ini, fin);
      if (iF < 0) { avisos.push(`No encuentro la fila de meses del bloque ${seg}.`); continue; }
      const meses = mapaMeses(iF); mesesRef = mesesRef || meses;
      const iC = aoa.slice(ini, fin).findIndex(tieneConsumo);
      if (iC >= 0) leerFila(aoa[ini + iC], meses, seg, 'consumo');
      const colPyc = (aoa[iF] || []).findIndex((v) => /PYC/.test(txt(v)));
      for (let i = iF + 1; i < fin; i++) {
        const r = aoa[i] || []; const et = txt(r[0]);
        const concepto = { CV: 'cv', REVSHARE: 'revshare', CF: 'cf' }[et];
        if (!concepto) continue;
        if (!leerFila(r, meses, seg, concepto)) avisos.push(`El bloque ${seg} tiene la fila ${r[0]} sin valores.`);
        if (concepto === 'cv' && colPyc >= 0 && typeof r[colPyc] === 'number') valores.push({ segmento: seg, concepto: 'pyc', mes: 0, valor: r[colPyc] });
      }
    }
    // consumo total: fila CONSUMO por encima del primer bloque
    const iPrimero = Math.min(...[iBT, iMT].filter((i) => i >= 0));
    for (let i = iPrimero - 1; i >= 0; i--) if (tieneConsumo(aoa[i])) { if (mesesRef) leerFila(aoa[i], mesesRef, 'TOTAL', 'consumo'); break; }

    const anio = +Object.entries(anios).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!anio) throw new Error('No encuentro los meses (fechas) en el Excel del equipo.');
    if (!valores.some((v) => v.concepto === 'consumo')) throw new Error('No encuentro filas de CONSUMO con números. Si el Excel tiene fórmulas, ábrelo y guárdalo en Excel antes de subirlo.');
    // si no viene el total, se calcula como BT + MT
    if (!valores.some((v) => v.segmento === 'TOTAL')) {
      const t = {}; for (const v of valores) if (v.concepto === 'consumo') t[v.mes] = (t[v.mes] || 0) + v.valor;
      for (const [mes, valor] of Object.entries(t)) valores.push({ segmento: 'TOTAL', concepto: 'consumo', mes: +mes, valor });
    }
    return { anio, valores, avisos, hoja: nombre };
  }
  throw new Error('No parece el Excel del analítico: no encuentro los bloques «BT» / «MT» en la columna A.');
}

// ---------------------------------------------------------------- evOS
/** Separa una línea CSV respetando comillas. */
function camposCSV(linea, sep) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (q) { if (ch === '"') { if (linea[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
}
/** Filas (arrays de texto) de un fichero de evOS: CSV (; o ,) o Excel. */
async function filasEvos(nombre, datos) {
  if (/\.(xlsx|xlsm|xls)$/i.test(nombre)) {
    const wb = XLSX.read(datos, { type: 'array', raw: true, cellText: true, cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  }
  let txt = new TextDecoder('utf-8').decode(datos);
  if (txt.includes('�')) txt = new TextDecoder('windows-1252').decode(datos);   // por si viene en ANSI
  txt = txt.replace(/^﻿/, '');
  const lineas = txt.split(/\r?\n/).filter((l) => l.trim() !== '');
  const sep = (lineas[0].match(/;/g) || []).length >= (lineas[0].match(/,/g) || []).length ? ';' : ',';
  return lineas.map((l) => camposCSV(l, sep));
}
const numEvos = (v) => {
  let t = String(v ?? '').trim(); if (!t || t === '-') return null;
  if (t.includes(',') && !t.includes('.')) t = t.replace(',', '.');
  const n = Number(t); return isFinite(n) ? n : null;
};
/** '25/10/2026 23:58' (o con segundos) -> {dia:'2026-10-25', ts:'2026-10-25 23:58:00'} */
function fechaEvos(v) {
  const m = String(v ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) { const iso = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/); if (!iso) return null;
    return { dia: `${iso[1]}-${iso[2]}-${iso[3]}`, ts: `${iso[1]}-${iso[2]}-${iso[3]} ${iso[4] || '00'}:${iso[5] || '00'}:${iso[6] || '00'}` }; }
  const d = `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return { dia: d, ts: `${d} ${pad(m[4] || 0)}:${m[5] || '00'}:${m[6] || '00'}` };
}
const segundosEvos = (v) => { const m = String(v ?? '').match(/(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };


// Comunidad autónoma a partir del código postal (evOS trae la región en varios idiomas y a veces con la ciudad)
const CCAA_CP = (() => {
  const g = { 'Andalucía': '04 11 14 18 21 23 29 41', 'Aragón': '22 44 50', 'Principado de Asturias': '33', 'Illes Balears': '07', 'Canarias': '35 38',
    'Cantabria': '39', 'Castilla-La Mancha': '02 13 16 19 45', 'Castilla y León': '05 09 24 34 37 40 42 47 49', 'Cataluña': '08 17 25 43',
    'Comunitat Valenciana': '03 12 46', 'Extremadura': '06 10', 'Galicia': '15 27 32 36', 'Comunidad de Madrid': '28', 'Región de Murcia': '30',
    'Navarra': '31', 'País Vasco': '01 20 48', 'La Rioja': '26', 'Ceuta': '51', 'Melilla': '52' };
  const m = {}; for (const [n, l] of Object.entries(g)) for (const c of l.split(' ')) m[c] = n; return m;
})();
const cpEvos = (v) => { const t = String(v ?? '').trim(); return /^\d{4}$/.test(t) ? '0' + t : t; };

/** Lee un fichero de evOS y devuelve sus agregados (por mes y punto, y por día) sin datos personales. */
async function leerEvos(nombre, datos, log) {
  const filas = await filasEvos(nombre, datos);
  if (filas.length < 2) throw new Error(`está vacío`);
  const H = filas[0].map(norm);
  const col = (...nombres) => { for (const n of nombres) { const i = H.indexOf(norm(n)); if (i >= 0) return i; } return -1; };
  const c = {
    id: col('Session ID'), ini: col('Session start', 'Charging Start'), kwh: col('Energy consumption'),
    serial: col('Serial number'), acdc: col('Type of recharge(AC/DC)', 'Type of recharge'), cpo: col('CPO'), emp: col('Company code'),
    reg: col('Region'), prov: col('Province'), ciu: col('City'), cp: col('Postal Code'), dir: col('Address'),
    tipo: col('Type'), pot: col('Nominal Power', 'Max station power'), imp: col('Total Amount CPO'), dur: col('Session duration'), st: col('Status'),
  };
  if (c.id < 0 || c.ini < 0 || c.kwh < 0) throw new Error(`no parece un fichero de evOS (faltan «Session ID», «Session start» o «Energy consumption»)`);
  const vistos = new Set(); const agg = new Map(); const dias = new Map(); let n = 0, dup = 0, malas = 0, kwhT = 0, impT = 0;
  const t = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  for (let k = 1; k < filas.length; k++) {
    const r = filas[k]; const id = t(r, c.id);
    if (!id) continue;
    if (vistos.has(id)) { dup++; continue; } vistos.add(id);
    const f = fechaEvos(r[c.ini]); const kwh = numEvos(r[c.kwh]);
    if (!f || kwh == null) { malas++; continue; }
    const imp = numEvos(r[c.imp]) || 0, seg = segundosEvos(r[c.dur]), pot = numEvos(r[c.pot]);
    const anio = +f.dia.slice(0, 4), mes = +f.dia.slice(5, 7);
    const serial = t(r, c.serial), acdc = t(r, c.acdc).toUpperCase(), dir = t(r, c.dir), cp = cpEvos(r[c.cp]);
    const region = CCAA_CP[cp.slice(0, 2)] || t(r, c.reg), tipo = t(r, c.tipo).toUpperCase() || null;
    const punto = [serial || '¿?', dir || '¿?', cp].join(' · ');
    const clave = [anio, mes, punto, acdc, t(r, c.cpo), t(r, c.emp), tipo].join('\u001f');
    let a = agg.get(clave);
    if (!a) agg.set(clave, a = { anio, mes, punto, serial, ac_dc: acdc, cpo: t(r, c.cpo), empresa: t(r, c.emp), tipo, region,
      provincia: t(r, c.prov), ciudad: t(r, c.ciu), cp, direccion: dir, potencia: null, sesiones: 0, kwh: 0, importe: 0, segundos: 0, primera: f.ts, ultima: f.ts });
    a.sesiones++; a.kwh += kwh; a.importe += imp; a.segundos += seg;
    if (pot != null) a.potencia = Math.max(a.potencia ?? 0, pot);
    if (f.ts < a.primera) a.primera = f.ts; if (f.ts > a.ultima) a.ultima = f.ts;
    const cd = [f.dia, acdc, region].join('\u001f');
    let d = dias.get(cd); if (!d) dias.set(cd, d = { dia: f.dia, ac_dc: acdc, region, sesiones: 0, kwh: 0, importe: 0 });
    d.sesiones++; d.kwh += kwh; d.importe += imp;
    n++; kwhT += kwh; impT += imp;
  }
  const redondea = (o) => { for (const k of ['kwh', 'importe']) o[k] = Math.round(o[k] * 10000) / 10000; return o; };
  const listaDias = [...new Set([...dias.values()].map((d) => d.dia))].sort();
  log(`✔ ${nombre}: ${fN(n)} sesiones · ${fN(kwhT)} kWh · del ${fFecha(listaDias[0])} al ${fFecha(listaDias.at(-1))}` +
      (dup ? ` · ${dup} sesiones repetidas omitidas` : '') + (malas ? ` · ${malas} filas sin fecha o energía` : ''));
  return { nombre, sesiones: n, kwh: kwhT, importe: impT, dias: listaDias, agg: [...agg.values()].map(redondea), porDia: [...dias.values()].map(redondea) };
}
