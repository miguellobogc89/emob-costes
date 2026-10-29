/* Lectura de Excels / ZIPs en el navegador y preparación de filas para Supabase. */
const EXT_EXCEL = /\.(xlsx|xlsm|xls)$/i;
const EXT_ZIP = /\.zip$/i;
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
      if (EXT_EXCEL.test(e.name)) out.push({ nombre: `${nombre}/${e.name}`, datos: await e.async('arraybuffer') });
      else if (EXT_ZIP.test(e.name)) await zip(`${nombre}/${e.name}`, await e.async('arraybuffer'));
    }
  }
  for (const { n, f } of archivos) {
    if (esTemporal(n)) continue;
    if (EXT_EXCEL.test(n)) out.push({ nombre: n, datos: await f.arrayBuffer() });
    else if (EXT_ZIP.test(n)) await zip(n, await f.arrayBuffer());
  }
  return out;
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
    const filas = aoa.slice(1).filter((r) => r.some((v) => v !== null && v !== ''));
    if (!filas.length) continue;
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
