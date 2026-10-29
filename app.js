/* eMob · Costes de energía — web (Supabase) */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const ST = { vista: 'inicio', base: 'consumo', anio: null, admin: false, f: { pag: 1, orden: null, dir: 'asc' }, p: { orden: 'kwh', dir: 'desc' } };
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const SB = new Supabase(EMOB_CONFIG.supabaseUrl, EMOB_CONFIG.supabaseKey);

// ---------------------------------------------------------------- formato
const nf = (d = 0) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' });
const fN = (v, d = 0) => (v == null || isNaN(v) ? '—' : nf(d).format(v));
const fEur = (v, d = 0) => (v == null ? '—' : fN(v, d) + ' €');
const fComp = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return nf(a >= 1e7 ? 0 : 1).format(v / 1e6) + ' M';
  if (a >= 1e3) return nf(0).format(v / 1e3) + ' k';
  return nf(a < 1 && a > 0 ? 2 : 0).format(v);
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fFecha = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const fFechaHora = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function toast(msg, ms = 4000) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hide');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hide'), ms);
}
/** Ejecuta una llamada y gestiona errores comunes (sesión caducada, red...). */
async function seguro(fn) {
  try { return await fn(); }
  catch (e) {
    if (e.message === 'sin_sesion') { mostrarLogin(); return null; }
    console.error(e); toast('Error: ' + e.message, 6000); return null;
  }
}
const args = () => ({ p_anio: ST.anio, p_base: ST.base });
/** Filtro de año para consultas REST sobre la columna de fecha de la base elegida */
function filtroAnio(q) {
  if (!ST.anio) return q;
  const c = ST.base === 'emision' ? 'fecha_emision' : 'fecha_hasta';
  q.and = `(${c}.gte.${ST.anio}-01-01,${c}.lt.${ST.anio + 1}-01-01)`;
  return q;
}

// ---------------------------------------------------------------- tooltip
const tip = $('#tip');
function showTip(e, html) {
  tip.innerHTML = html; tip.classList.remove('hide');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + 14, y = e.clientY - h - 10;
  if (x + w > innerWidth - 8) x = e.clientX - w - 14;
  if (y < 8) y = e.clientY + 16;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
const hideTip = () => tip.classList.add('hide');
const tipRows = (title, rows) => `<b>${esc(title)}</b>` + rows.map(([k, v]) => `<div class="r"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('');

// ---------------------------------------------------------------- gráficos SVG
function niceTicks(min, max, n = 4) {
  if (min === max) { max = min + 1; }
  const span = max - min, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const t = []; for (let v = lo; v <= hi + step / 2; v += step) t.push(+v.toFixed(10));
  return t;
}
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

function frame(el, values, fmtAxis) {
  el.innerHTML = '';
  const W = el.clientWidth, H = el.clientHeight, m = { l: 52, r: 14, t: 14, b: 26 };
  const vals = values.filter((v) => v != null);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const y0 = ticks[0], y1 = ticks.at(-1);
  const y = (v) => m.t + (H - m.t - m.b) * (1 - (v - y0) / (y1 - y0));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}` });
  ticks.forEach((t) => {
    svg.append(svgEl('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: t === 0 ? 'base-l' : 'grid-l' }));
    const tx = svgEl('text', { x: m.l - 8, y: y(t) + 4, 'text-anchor': 'end' }); tx.textContent = fmtAxis(t); svg.append(tx);
  });
  el.append(svg);
  return { svg, W, H, m, y };
}

function columnChart(el, data, { fmtAxis = fComp, tipFn }) {
  const { svg, W, H, m, y } = frame(el, data.map((d) => d.value), fmtAxis);
  const band = (W - m.l - m.r) / data.length, bw = Math.min(24, band * 0.6);
  data.forEach((d, i) => {
    const cx = m.l + band * i + band / 2;
    const lx = svgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }); lx.textContent = d.label; svg.append(lx);
    if (d.value != null && d.value !== 0) {
      const ya = y(Math.max(0, d.value)), yb = y(Math.min(0, d.value)), h = Math.max(1, yb - ya), r = Math.min(4, h / 2, bw / 2);
      const x0 = cx - bw / 2, x1 = cx + bw / 2;
      // extremo de datos redondeado, base recta
      const p = d.value > 0
        ? `M${x0},${yb} V${ya + r} Q${x0},${ya} ${x0 + r},${ya} H${x1 - r} Q${x1},${ya} ${x1},${ya + r} V${yb} Z`
        : `M${x0},${ya} V${yb - r} Q${x0},${yb} ${x0 + r},${yb} H${x1 - r} Q${x1},${yb} ${x1},${yb - r} V${ya} Z`;
      d._bar = svgEl('path', { d: p, class: 'bar' }); svg.append(d._bar);
    }
    const hit = svgEl('rect', { x: cx - band / 2, y: m.t, width: band, height: H - m.t - m.b, fill: 'transparent' });
    hit.addEventListener('mousemove', (e) => { el.classList.add('hovering'); d._bar?.classList.add('hl'); showTip(e, tipFn(d)); });
    hit.addEventListener('mouseleave', () => { el.classList.remove('hovering'); d._bar?.classList.remove('hl'); hideTip(); });
    svg.append(hit);
  });
}

function lineChart(el, data, { fmtAxis = fComp, fmtEnd, tipFn }) {
  const vals = data.map((d) => d.value).filter((v) => v != null);
  if (!vals.length) { el.innerHTML = '<p class="muted sm">Sin datos</p>'; return; }
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.25 || hi * 0.1 || 1;
  const { svg, W, H, m } = frameRange(el, lo - pad, hi + pad, fmtAxis);
  const band = (W - m.l - m.r) / data.length;
  const X = (i) => m.l + band * i + band / 2;
  // segmentos (se corta donde no hay dato)
  let seg = [];
  const flush = () => {
    if (seg.length > 1) {
      svg.append(svgEl('path', { class: 'area', d: `M${seg[0][0]},${H - m.b} ` + seg.map(([a, b]) => `L${a},${b}`).join(' ') + ` L${seg.at(-1)[0]},${H - m.b} Z` }));
      svg.append(svgEl('path', { class: 'line', d: 'M' + seg.map(([a, b]) => `${a},${b}`).join(' L') }));
    }
    seg = [];
  };
  data.forEach((d, i) => { if (d.value == null) flush(); else seg.push([X(i), frame.yy(d.value)]); });
  flush();
  const xh = svgEl('line', { class: 'xhair', y1: m.t, y2: H - m.b, visibility: 'hidden' }); svg.append(xh);
  let last = -1;
  data.forEach((d, i) => {
    const lx = svgEl('text', { x: X(i), y: H - 8, 'text-anchor': 'middle' }); lx.textContent = d.label; svg.append(lx);
    if (d.value != null) { svg.append(svgEl('circle', { class: 'dot', cx: X(i), cy: frame.yy(d.value), r: 4 })); last = i; }
  });
  if (last >= 0 && fmtEnd) {
    const t = svgEl('text', { class: 'lbl-end', x: X(last), y: frame.yy(data[last].value) - 10, 'text-anchor': 'middle' });
    t.textContent = fmtEnd(data[last].value); svg.append(t);
  }
  data.forEach((d, i) => {
    const hit = svgEl('rect', { x: X(i) - band / 2, y: m.t, width: band, height: H - m.t - m.b, fill: 'transparent' });
    hit.addEventListener('mousemove', (e) => { xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.setAttribute('visibility', 'visible'); showTip(e, tipFn(d)); });
    hit.addEventListener('mouseleave', () => { xh.setAttribute('visibility', 'hidden'); hideTip(); });
    svg.append(hit);
  });
}
function frameRange(el, lo, hi, fmtAxis) {
  el.innerHTML = '';
  const W = el.clientWidth, H = el.clientHeight, m = { l: 52, r: 14, t: 18, b: 26 };
  const ticks = niceTicks(lo, hi);
  const y0 = ticks[0], y1 = ticks.at(-1);
  frame.yy = (v) => m.t + (H - m.t - m.b) * (1 - (v - y0) / (y1 - y0));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}` });
  ticks.forEach((t, i) => {
    svg.append(svgEl('line', { x1: m.l, x2: W - m.r, y1: frame.yy(t), y2: frame.yy(t), class: i === 0 ? 'base-l' : 'grid-l' }));
    const tx = svgEl('text', { x: m.l - 8, y: frame.yy(t) + 4, 'text-anchor': 'end' }); tx.textContent = fmtAxis(t); svg.append(tx);
  });
  el.append(svg);
  return { svg, W, H, m };
}

function hbars(el, rows, { fmtV, tipFn }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  el.innerHTML = rows.map((r, i) => `
    <div class="hb" data-i="${i}">
      <span class="n" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="t"><span class="f ${r.value < 0 ? 'neg' : ''}" style="width:${(Math.abs(r.value) / max) * 100}%"></span></span>
      <span class="v">${fmtV(r)}</span>
    </div>`).join('');
  if (tipFn) el.querySelectorAll('.hb').forEach((n) => {
    n.addEventListener('mousemove', (e) => showTip(e, tipFn(rows[+n.dataset.i])));
    n.addEventListener('mouseleave', hideTip);
  });
}


// ---------------------------------------------------------------- INICIO
let DASH = null;
async function cargarDashboard() {
  $('#dash').classList.add('loading');
  const d = await seguro(() => SB.rpc('dashboard', args()));
  $('#dash').classList.remove('loading');
  if (!d) return;
  DASH = d;
  $('#vacio').classList.toggle('hide', !d.vacio);
  $('#dash').classList.toggle('hide', !!d.vacio);
  if (!d.vacio) pintarDashboard();
}

function pintarDashboard() {
  const d = DASH, k = d.kpi, per = d.anio ? d.anio : 'todo el histórico';
  $('#kHeroLbl').textContent = `Consumo facturado · ${per}`;
  $('#kKwh').textContent = fN(k.kwh / 1000, 0);
  $('#kHeroSub').textContent = `${fN(k.facturas)} facturas · ${fN(k.anuladas)} anuladas · ${fN(k.rectificativas)} rectificativas`;
  const dl = $('#kDelta');
  if (d.previo && d.previo.kwh > 0) {
    const pct = (k.kwh / d.previo.kwh - 1) * 100, up = pct >= 0;
    dl.className = 'delta ' + (up ? 'up' : 'down');
    dl.innerHTML = `${up ? '▲' : '▼'} ${fN(Math.abs(pct), 1)} % <span class="ctx">vs. mismos meses de ${d.anio - 1}</span>`;
  } else { dl.className = 'delta'; dl.innerHTML = ''; }
  $('#kNeto').textContent = fEur(k.neto);
  $('#kTotal').textContent = `${fEur(k.total)} con IVA`;
  $('#kEurKwh').textContent = k.eur_kwh == null ? '—' : fN(k.eur_kwh, 3) + ' €';
  $('#kPuntos').textContent = fN(k.puntos);
  $('#kFacturas').textContent = `con consumo · ${fN(k.puntos_total)} CUPS en total`;
  $('#kExceso').textContent = fEur(k.exceso_eur);
  $('#kExcesoSub').textContent = `${fN(k.puntos_exceso)} puntos con penalización`;

  const baseTxt = d.base === 'consumo' ? 'por fecha fin del periodo facturado' : 'por fecha de emisión';
  $('#hMens').textContent = `kWh · ${baseTxt}`;
  const mens = d.mensual.map((m) => ({ ...m, label: MESES[m.mes - 1], value: m.kwh }));
  columnChart($('#chMensual'), mens, {
    tipFn: (m) => tipRows(`${MESES[m.mes - 1]} ${d.anio ?? ''}`, m.kwh == null ? [['Sin facturas', '']] :
      [['Consumo', fN(m.kwh) + ' kWh'], ['Importe sin IVA', fEur(m.neto)], ['€/kWh', m.eur_kwh == null ? '—' : fN(m.eur_kwh, 3)], ['Facturas', fN(m.facturas)]]),
  });
  lineChart($('#chEurKwh'), mens.map((m) => ({ ...m, value: m.eur_kwh })), {
    fmtAxis: (v) => nf(2).format(v), fmtEnd: (v) => fN(v, 3),
    tipFn: (m) => tipRows(`${MESES[m.mes - 1]} ${d.anio ?? ''}`, [['Coste medio', m.eur_kwh == null ? '—' : fN(m.eur_kwh, 3) + ' €/kWh'], ['Importe sin IVA', fEur(m.neto)]]),
  });

  const tot = d.costes.reduce((a, c) => a + c.eur, 0);
  $('#hCostes').textContent = `Total ${fEur(tot)} con IVA`;
  hbars($('#lsCostes'), d.costes.map((c) => ({ label: c.concepto, value: c.eur })), {
    fmtV: (r) => `<b>${fEur(r.value)}</b> · ${fN(tot ? (r.value / tot) * 100 : 0, 1)} %`,
  });
  const ptot = d.periodos.reduce((a, c) => a + c.kwh, 0);
  hbars($('#lsPeriodos'), d.periodos.map((p) => ({ label: p.periodo, value: p.kwh })), {
    fmtV: (r) => `<b>${fN(r.value)}</b> kWh · ${fN(ptot ? (r.value / ptot) * 100 : 0, 1)} %`,
  });
  const ltot = d.lecturas.reduce((a, c) => a + c.facturas, 0);
  hbars($('#lsLecturas'), d.lecturas.map((l) => ({ label: l.tipo, value: l.facturas })), {
    fmtV: (r) => `<b>${fN(r.value)}</b> · ${fN(ltot ? (r.value / ltot) * 100 : 0, 1)} %`,
  });
  const est = d.lecturas.filter((l) => /estimad/i.test(l.tipo)).reduce((a, c) => a + c.facturas, 0);
  $('#notaLect').textContent = est
    ? `${fN(est)} facturas (${fN((est / ltot) * 100, 1)} %) con lectura estimada: son las primeras candidatas a revisar en el cruce con el sistema técnico.`
    : 'No hay facturas con lectura estimada en este periodo.';

  const tmax = Math.max(...d.top.map((t) => t.kwh), 1);
  $('#tbTop').innerHTML = `<thead><tr><th>Punto de recarga</th><th class="num">kWh</th><th class="num">€ sin IVA</th><th class="num">€/kWh</th></tr></thead><tbody>` +
    d.top.map((t) => `<tr><td class="wrap">${esc(t.direccion)}<br><span class="cups">${esc(t.cups)}</span></td>
      <td class="num"><span class="inbar" style="width:${(t.kwh / tmax) * 70}px"></span>${fN(t.kwh)}</td>
      <td class="num">${fEur(t.neto)}</td><td class="num">${fN(t.eur_kwh, 3)}</td></tr>`).join('') + '</tbody>';
}


// ---------------------------------------------------------------- FACTURAS
const COLS_F = [
  ['mes_emision', 'MES EMISIÓN'], ['id_factura', 'ID PSEUDOFACTURA'], ['estado', 'ESTADO'], ['cups', 'CUPS'], ['direccion', 'DIRECCIÓN PS'],
  ['tarifa', 'TARIFA ATR'], ['distribuidora', 'DISTRIBUIDORA'], ['fecha_emision', 'FECHA EMISIÓN', 'f'], ['fecha_desde', 'DESDE', 'f'],
  ['fecha_hasta', 'HASTA', 'f'], ['tipo_lectura', 'TIPO LECTURA'], ['kwh', 'CONSUMO TOTAL kWh', 'n'],
  ['kwh_p1', 'P1 kWh', 'n'], ['kwh_p2', 'P2 kWh', 'n'], ['kwh_p3', 'P3 kWh', 'n'], ['kwh_p4', 'P4 kWh', 'n'], ['kwh_p5', 'P5 kWh', 'n'], ['kwh_p6', 'P6 kWh', 'n'],
  ['imp_neto', 'IMPORTE NETO €', 'e'], ['imp_total', 'IMPORTE TOTAL €', 'e'], ['sheet_code', 'sheet_code'], ['archivo_origen', 'archivo_origen'],
];
const ESTADOS = { N: 'Normal', A: 'Anuladora', C: 'Anulada', R: 'Rectificativa' };
let CABS = null;
async function cabeceras() {
  if (!CABS) {
    const l = await SB.select('cabeceras', { select: 'id,columnas' });
    CABS = Object.fromEntries(l.map((c) => [c.id, c.columnas]));
  }
  return CABS;
}
function queryFacturas() {
  const q = filtroAnio({});
  const t = $('#fQ').value.trim().replace(/[",()]/g, ' ');
  if (t) q.or = `(${['cups', 'direccion', 'id_factura', 'sheet_code'].map((c) => `${c}.ilike."*${t}*"`).join(',')})`;
  if ($('#fEstado').value) q.estado = 'eq.' + $('#fEstado').value;
  q.order = ST.f.orden ? `${ST.f.orden}.${ST.f.dir}.nullslast,huella` : 'fecha_emision.asc.nullslast,huella';
  return q;
}
async function cargarFacturas() {
  const todas = $('#fTodas').checked;
  const q = queryFacturas();
  q.select = todas ? COLS_F.map((c) => c[0]).join(',') + ',cabecera_id,valores' : COLS_F.map((c) => c[0]).join(',');
  q.limit = 50; q.offset = (ST.f.pag - 1) * 50;
  const tb = $('#tbFact'); tb.classList.add('loading');
  q.select += ',negativa,excluida';
  const r = await seguro(() => SB.select('facturas_calc', q, { count: true }));
  tb.classList.remove('loading');
  if (!r) return;
  let extra = [];
  if (todas && r.datos.length) {
    const cabs = await cabeceras();
    extra = cabs[r.datos[0].cabecera_id] || [];
  }
  tb.innerHTML = `<thead><tr>${COLS_F.map(([k, t, n]) => `<th data-c="${k}" class="${n === 'n' || n === 'e' ? 'num' : ''}">${esc(t)}${ST.f.orden === k ? `<span class="ar">${ST.f.dir === 'desc' ? '↓' : '↑'}</span>` : ''}</th>`).join('')}${extra.map((c) => `<th class="raw">${esc(c)}</th>`).join('')}</tr></thead><tbody>` +
    r.datos.map((f) => `<tr>${COLS_F.map(([k, , n]) => {
      const v = f[k];
      if (k === 'estado') return `<td>${v ? `<span class="tag ${esc(v)}">${ESTADOS[v] || esc(v)}</span>` : ''}${f.negativa ? ' <span class="tag neg" title="Corrección: en negativo">−</span>' : ''}${f.excluida ? ' <span class="tag exc" title="Corrección: excluida de los cálculos">Excluida</span>' : ''}</td>`;
      if (k === 'cups') return `<td class="cups">${esc(v)}</td>`;
      if (n === 'f') return `<td>${fFecha(v)}</td>`;
      if (n === 'n') return `<td class="num">${v == null ? '' : fN(v, Number.isInteger(+v) ? 0 : 2)}</td>`;
      if (n === 'e') return `<td class="num">${v == null ? '' : fN(v, 2)}</td>`;
      return `<td>${esc(v)}</td>`;
    }).join('')}${todas ? (CABS[f.cabecera_id] === extra ? f.valores : []).map((v) => `<td>${esc(v)}</td>`).join('') : ''}</tr>`).join('') + '</tbody>';
  tb.querySelectorAll('th[data-c]').forEach((th) => th.onclick = () => {
    const c = th.dataset.c; ST.f.dir = ST.f.orden === c && ST.f.dir === 'asc' ? 'desc' : 'asc'; ST.f.orden = c; ST.f.pag = 1; cargarFacturas();
  });
  $('#fTotal').textContent = `${fN(r.total)} filas`;
  const np = Math.max(1, Math.ceil(r.total / 50));
  $('#fPager').innerHTML = `<button class="btn" ${ST.f.pag <= 1 ? 'disabled' : ''} data-p="${ST.f.pag - 1}">‹ Anterior</button>
    <span>Página ${ST.f.pag} de ${np}</span>
    <button class="btn" ${ST.f.pag >= np ? 'disabled' : ''} data-p="${ST.f.pag + 1}">Siguiente ›</button>`;
  $$('#fPager button').forEach((b) => b.onclick = () => { ST.f.pag = +b.dataset.p; cargarFacturas(); });
}

// ---------------------------------------------------------------- EXPORTAR
// Fechas como número de serie de Excel (evita desfases por zona horaria)
const isoASerial = (iso) => { const [y, m, d] = iso.split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };
function hoja(aoa, colsFecha) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (let r = 1; r < aoa.length; r++) for (const c of colsFecha) {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (cell && cell.t === 'n') cell.z = 'dd/mm/yyyy';
  }
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(aoa.length - 1, 0), c: aoa[0].length - 1 } }) };
  return ws;
}
function descargar(ws, nombreHoja, fichero) {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, nombreHoja);
  XLSX.writeFile(wb, fichero);
}
const META_EXPORT = ['MES EMISIÓN', 'sheet_code', 'archivo_origen', 'CORRECCIÓN'];
const A_NEGATIVO = /^(CONSUMO|IMPORTE|CANTIDAD)/i;   // columnas que cambian de signo con la corrección «negativo»
async function exportarFilas(q, nombre, boton) {
  const txt = boton.textContent; boton.disabled = true;
  try {
    const cabs = await cabeceras();
    q.select = 'mes_emision,sheet_code,archivo_origen,cabecera_id,valores,negativa,excluida';
    const filas = await SB.todo((limit, offset) => SB.select('facturas_calc', { ...q, limit, offset }),
      (n) => { boton.textContent = `Descargando… ${fN(n)}`; });
    // columnas: unión de las cabeceras usadas, en orden de aparición
    const cols = []; const pos = new Map();
    for (const id of new Set(filas.map((f) => f.cabecera_id))) for (const c of cabs[id] || []) if (!pos.has(c)) { pos.set(c, cols.length); cols.push(c); }
    const esFecha = cols.map((c) => /^FECHA/i.test(c));
    const cambiaSigno = cols.map((c) => A_NEGATIVO.test(c));
    const aoa = [META_EXPORT.concat(cols)];
    for (const f of filas) {
      const row = new Array(cols.length).fill(null);
      (cabs[f.cabecera_id] || []).forEach((c, i) => {
        let v = f.valores[i];
        const j = pos.get(c);
        if (esFecha[j] && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) v = isoASerial(v);
        else if (f.negativa && cambiaSigno[j]) { const x = num(v); if (x != null) v = -Math.abs(x); }
        row[j] = v;
      });
      const corr = [f.negativa ? 'En negativo' : '', f.excluida ? 'Excluida' : ''].filter(Boolean).join(' · ');
      aoa.push([f.mes_emision, f.sheet_code, f.archivo_origen, corr || null, ...row]);
    }
    boton.textContent = 'Generando Excel…';
    await new Promise((r) => setTimeout(r, 30));
    const ws = hoja(aoa, esFecha.map((f, j) => (f ? j + META_EXPORT.length : -1)).filter((j) => j >= 0));
    descargar(ws, 'Datos', `${nombre}_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.xlsx`);
  } catch (e) { if (e.message === 'sin_sesion') mostrarLogin(); else toast('Error al exportar: ' + e.message, 6000); }
  finally { boton.textContent = txt; boton.disabled = false; }
}

// ---------------------------------------------------------------- PUNTOS
const P_COLS = [
  ['direccion', 'Punto de recarga'], ['cups', 'CUPS'], ['distribuidora', 'Distribuidora'], ['tarifa', 'Tarifa'],
  ['facturas', 'Facturas', 'n'], ['kwh', 'Consumo kWh', 'n'], ['neto', '€ sin IVA', 'e'], ['total', '€ con IVA', 'e'],
  ['eur_kwh', '€/kWh', 'r'], ['exceso_eur', 'Exceso potencia €', 'e'], ['desde', 'Desde', 'f'], ['hasta', 'Hasta', 'f'],
];
let PUNTOS = { clave: null, filas: [] };
async function datosPuntos() {
  const clave = `${ST.anio}|${ST.base}`;
  if (PUNTOS.clave !== clave) {
    const filas = await SB.todo((limit, offset) => SB.rpc('puntos', args(), { limit, offset }));
    PUNTOS = { clave, filas };
  }
  return PUNTOS.filas;
}
function puntosFiltrados(todos) {
  const q = $('#pQ').value.trim().toLowerCase();
  let r = q ? todos.filter((p) => [p.cups, p.direccion, p.distribuidora].some((v) => String(v ?? '').toLowerCase().includes(q))) : [...todos];
  const k = ST.p.orden, s = ST.p.dir === 'asc' ? 1 : -1;
  r.sort((a, b) => (a[k] == null) - (b[k] == null) || (typeof a[k] === 'string' ? String(a[k]).localeCompare(b[k]) : a[k] - b[k]) * s);
  return r;
}
async function cargarPuntos() {
  const tb = $('#tbPuntos'); tb.classList.add('loading');
  const todos = await seguro(datosPuntos);
  tb.classList.remove('loading');
  if (!todos) return;
  const filas = puntosFiltrados(todos);
  const max = Math.max(...filas.map((f) => +f.kwh || 0), 1);
  const vis = filas.slice(0, 500);
  tb.innerHTML = `<thead><tr>${P_COLS.map(([k, t, n]) => `<th data-c="${k}" class="${n && n !== 'f' ? 'num' : ''}">${t}${ST.p.orden === k ? `<span class="ar">${ST.p.dir === 'desc' ? '↓' : '↑'}</span>` : ''}</th>`).join('')}</tr></thead><tbody>` +
    vis.map((f) => `<tr>${P_COLS.map(([k, , n]) => {
      const v = f[k];
      if (k === 'cups') return `<td class="cups">${esc(v)}</td>`;
      if (k === 'direccion') return `<td class="wrap">${esc(v)}</td>`;
      if (k === 'kwh') return `<td class="num"><span class="inbar" style="width:${Math.max(0, (v / max) * 60)}px"></span>${fN(v)}</td>`;
      if (n === 'e') return `<td class="num">${fN(v, 2)}</td>`;
      if (n === 'r') return `<td class="num">${fN(v, 3)}</td>`;
      if (n === 'n') return `<td class="num">${fN(v)}</td>`;
      if (n === 'f') return `<td>${fFecha(v)}</td>`;
      return `<td>${esc(v)}</td>`;
    }).join('')}</tr>`).join('') + '</tbody>';
  tb.querySelectorAll('th').forEach((th) => th.onclick = () => {
    const c = th.dataset.c; ST.p.dir = ST.p.orden === c && ST.p.dir === 'desc' ? 'asc' : 'desc'; ST.p.orden = c; cargarPuntos();
  });
  $('#pTotal').textContent = filas.length > vis.length ? `${fN(filas.length)} puntos (se muestran ${vis.length}; exporta para verlos todos)` : `${fN(filas.length)} puntos`;
}
async function exportarPuntos() {
  const todos = await seguro(datosPuntos); if (!todos) return;
  const aoa = [P_COLS.map((c) => c[1])].concat(puntosFiltrados(todos).map((f) => P_COLS.map(([k, , n]) =>
    n === 'f' ? (f[k] ? isoASerial(f[k]) : null) : (n ? (f[k] == null ? null : +f[k]) : f[k]))));
  descargar(hoja(aoa, P_COLS.map((c, i) => (c[2] === 'f' ? i : -1)).filter((i) => i >= 0)), 'Puntos', `puntos_recarga_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---------------------------------------------------------------- CORRECCIONES
const CAMPOS = { estado: 'Estado de la factura', id_factura: 'ID factura', cups: 'CUPS', tipo_lectura: 'Tipo de lectura',
  distribuidora: 'Distribuidora', tarifa: 'Tarifa', sheet_code: 'Pestaña', archivo_origen: 'Archivo de origen' };
const ACCIONES = { negativo: 'Poner en negativo', excluir: 'Excluir de los cálculos' };
async function cargarCorrecciones() {
  const reglas = await seguro(() => SB.rpc('correcciones_resumen'));
  if (!reglas) return;
  const adm = ST.admin;
  $('#cardNuevaRegla').classList.toggle('hide', !adm);
  $('#reglasRO').textContent = adm ? '' : 'Solo un administrador puede añadir o cambiar correcciones.';
  $('#tbReglas').innerHTML = `<thead><tr><th>Activa</th><th>Cuando</th><th>Es igual a</th><th>Entonces</th><th>Nota</th><th class="num">Filas afectadas</th><th class="num">Facturas</th><th>Creada</th><th></th></tr></thead><tbody>` +
    (reglas.length ? reglas.map((r) => `<tr>
      <td><label class="sw"><input type="checkbox" data-id="${r.id}" class="rAct" ${r.activa ? 'checked' : ''} ${adm ? '' : 'disabled'}><span></span></label></td>
      <td>${esc(CAMPOS[r.campo] || r.campo)}</td><td><b>${esc(r.valor)}</b></td><td>${esc(ACCIONES[r.accion] || r.accion)}</td>
      <td class="wrap">${esc(r.nota || '')}</td><td class="num">${fN(r.filas)}</td><td class="num">${fN(r.facturas)}</td>
      <td class="muted sm">${fFechaHora(r.creado)}${r.creado_por ? ' · ' + esc(r.creado_por) : ''}</td>
      <td>${adm ? `<button class="btn mini danger rDel" data-id="${r.id}">Borrar</button>` : ''}</td></tr>`).join('')
      : '<tr><td colspan="9" class="muted">No hay correcciones</td></tr>') + '</tbody>';
  $$('.rAct').forEach((c) => c.onchange = async () => {
    await seguro(() => SB.update('correcciones', { id: 'eq.' + c.dataset.id }, { activa: c.checked }));
    datosCambiados(); cargarCorrecciones(); toast(c.checked ? 'Corrección activada' : 'Corrección desactivada');
  });
  $$('.rDel').forEach((b) => b.onclick = async () => {
    if (b.dataset.ok !== '1') { b.dataset.ok = '1'; b.textContent = '¿Seguro?'; setTimeout(() => { b.dataset.ok = ''; b.textContent = 'Borrar'; }, 3000); return; }
    await seguro(() => SB.rest('DELETE', 'correcciones', { query: { id: 'eq.' + b.dataset.id }, prefer: 'return=minimal' }));
    datosCambiados(); cargarCorrecciones(); toast('Corrección borrada');
  });
  sugerirValores();
}
async function sugerirValores() {
  const v = await seguro(() => SB.rpc('valores_campo', { p_campo: $('#rCampo').value }));
  if (v) $('#rValores').innerHTML = v.map((x) => `<option value="${esc(x.valor)}">${fN(x.filas)} filas</option>`).join('');
}
async function guardarRegla(e) {
  e.preventDefault();
  const fila = { campo: $('#rCampo').value, valor: $('#rValor').value.trim(), accion: $('#rAccion').value, nota: $('#rNota').value.trim() || null };
  if (!fila.valor) return;
  const ok = await seguro(() => SB.insert('correcciones', [fila], { prefer: 'return=minimal' }));
  if (ok === null) return;
  $('#rValor').value = ''; $('#rNota').value = '';
  datosCambiados(); await cargarCorrecciones(); toast('Corrección guardada y aplicada');
}
/** Tras cambiar datos o correcciones: olvidar cachés y recalcular lo visible */
function datosCambiados() { PUNTOS.clave = null; DASH = null; }

// ---------------------------------------------------------------- CARGAR
const OK = /\.(xlsx|xlsm|xls|zip)$/i;
let COLA = [];
function encolar(list) {
  for (const f of list) {
    const n = f._path || f.webkitRelativePath || f.name;
    if (!OK.test(n) || /(^|\/)~\$/.test(n)) continue;
    if (COLA.some((x) => x.n === n && x.f.size === f.size)) continue;
    COLA.push({ n, f });
  }
  pintarCola();
}
function pintarCola() {
  $('#cola').innerHTML = COLA.map((x) => `<li>${esc(x.n)}<span>${fN(x.f.size / 1048576, 2)} MB</span></li>`).join('');
  $('#btnProcesar').disabled = !COLA.length;
}
async function cargarCargas() {
  const [res, h] = await Promise.all([
    seguro(() => SB.rpc('resumen')),
    seguro(() => SB.select('cargas', { select: '*', order: 'fecha.desc', limit: 100 })),
  ]);
  if (!res || !h) return;
  ST.admin = !!res.admin;
  $('#dFilas').textContent = fN(res.filas); $('#dFact').textContent = fN(res.facturas); $('#dUlt').textContent = fFechaHora(res.ultima_carga);
  $('#btnVaciar').classList.toggle('hide', !ST.admin);
  $('#dAdmin').textContent = ST.admin ? 'Eres administrador: puedes vaciar los datos.' : '';
  $('#tbCargas').innerHTML = `<thead><tr><th>Fecha</th><th>Usuario</th><th>Ficheros</th><th class="num">Leídas</th><th class="num">Duplicadas en la carga</th><th class="num">Ya existentes</th><th class="num">Nuevas</th></tr></thead><tbody>` +
    (h.length ? h.map((c) => `<tr><td>${fFechaHora(c.fecha)}</td><td>${esc(c.usuario_email || '')}</td><td class="files" title="${esc(c.archivos.join('\n'))}">${c.archivos.length} · ${esc(c.archivos[0] || '')}${c.archivos.length > 1 ? '…' : ''}</td>
      <td class="num">${fN(c.leidas)}</td><td class="num">${fN(c.duplicadas_en_carga)}</td><td class="num">${fN(c.ya_existentes)}</td><td class="num"><b>${fN(c.nuevas)}</b></td></tr>`).join('')
      : '<tr><td colspan="7" class="muted">Sin cargas todavía</td></tr>') + '</tbody>';
}

function progreso(pct, txt) {
  $('#progreso').classList.remove('hide');
  $('#progBar').style.width = Math.round(pct) + '%';
  $('#progTxt').textContent = txt;
}
const idCabCache = new Map();   // clave de columnas -> id en la tabla cabeceras
async function idCabecera(clave, columnas) {
  if (idCabCache.has(clave)) return idCabCache.get(clave);
  const huella = await sha(clave);
  let r = await SB.select('cabeceras', { select: 'id', huella: 'eq.' + huella });
  if (!r.length) {
    try { r = await SB.insert('cabeceras', [{ huella, columnas }], { query: { select: 'id' } }); }
    catch { r = await SB.select('cabeceras', { select: 'id', huella: 'eq.' + huella }); }
  }
  idCabCache.set(clave, r[0].id); CABS = null;
  return r[0].id;
}

/** Procesa y guarda fichero a fichero (no acumula todo en memoria: admite cargas grandes). */
async function procesar() {
  const b = $('#btnProcesar'); b.disabled = true; b.textContent = 'Procesando…';
  const lineas = []; const log = (l) => { lineas.push(l); $('#resLog').textContent = lineas.join('\n'); $('#resLog').scrollTop = 1e9; };
  $('#resCarga').classList.remove('hide'); $('#resKpis').innerHTML = ''; $('#resLog').textContent = '';
  const tot = { leidas: 0, dup: 0, nuevas: 0, guardadas: 0 };
  const pintarKpis = () => { $('#resKpis').innerHTML = [['Filas leídas', tot.leidas], ['Duplicadas en la carga', tot.dup], ['Ya existentes', tot.guardadas - tot.nuevas], ['Nuevas guardadas', tot.nuevas]]
    .map(([k, v]) => `<div><b>${fN(v)}</b><span>${k}</span></div>`).join(''); };
  const cola = [...COLA];
  let carga = null;
  try {
    [carga] = await SB.insert('cargas', [{ archivos: cola.map((x) => x.n) }], { query: { select: 'id' } });
    const vistosF = new Map(); const vistas = new Set();
    for (const [k, item] of cola.entries()) {
      const excels = await recolectar([item], log);          // un fichero de la cola (o el contenido de un ZIP)
      for (const [j, e] of excels.entries()) {
        const etiqueta = `Fichero ${k + 1} de ${cola.length}${excels.length > 1 ? ` (${j + 1}/${excels.length} del ZIP)` : ''}: ${e.nombre.split('/').pop()}`;
        const base = (k + j / excels.length) / cola.length * 100;
        progreso(base, `${etiqueta} · leyendo…`);
        await new Promise((r) => setTimeout(r, 20));
        const h = await shaBuf(e.datos);
        if (vistosF.has(h)) { log(`↷ ${e.nombre}: idéntico a ${vistosF.get(h)}, se omite`); continue; }
        vistosF.set(h, e.nombre);
        const partes = leerLibro(e.nombre, e.datos, log);
        e.datos = null;
        tot.leidas += partes.reduce((a, p) => a + p.filas.length, 0);
        const { filas, dup } = await prepararFilas(e.nombre, partes, vistas, log);
        tot.dup += dup;
        const LOTE = 150;
        for (let i = 0; i < filas.length; i += LOTE) {
          const trozo = filas.slice(i, i + LOTE);
          // primero se pregunta qué filas existen ya (solo huellas): esas no se vuelven a enviar
          const ya = new Set((await SB.select('facturas', { select: 'huella', huella: `in.(${trozo.map((f) => f.huella).join(',')})` })).map((x) => x.huella));
          const lote = [];
          for (const { _cab, _columnas, ...f } of trozo) if (!ya.has(f.huella)) lote.push({ ...f, cabecera_id: await idCabecera(_cab, _columnas), carga_id: carga.id });
          if (lote.length) {
            const ins = await SB.insert('facturas', lote, { query: { on_conflict: 'huella', select: 'huella' }, prefer: 'return=representation,resolution=ignore-duplicates' });
            tot.nuevas += ins.length;
          }
          tot.guardadas += trozo.length;
          progreso(base + ((i + trozo.length) / filas.length) * (100 / cola.length / excels.length), `${etiqueta} · ${fN(i + trozo.length)} / ${fN(filas.length)} filas revisadas · ${fN(tot.nuevas)} nuevas`);
        }
        pintarKpis();
      }
      await SB.update('cargas', { id: 'eq.' + carga.id }, { leidas: tot.leidas, duplicadas_en_carga: tot.dup, ya_existentes: tot.guardadas - tot.nuevas, nuevas: tot.nuevas });
    }
    if (!tot.leidas) log('✖ No se encontró ningún dato.');
    if (tot.guardadas - tot.nuevas) log(`↷ ${fN(tot.guardadas - tot.nuevas)} filas ya estaban guardadas de cargas anteriores, se omiten`);
    log(`＋ ${fN(tot.nuevas)} filas nuevas guardadas`);
    progreso(100, 'Carga completada'); pintarKpis();
    COLA = []; pintarCola();
  } catch (err) {
    if (err.message === 'sin_sesion') { mostrarLogin(); return; }
    log('✖ Error: ' + err.message);
    progreso(100, 'Error: la carga no se completó. Lo ya guardado se queda; puedes volver a subir los mismos ficheros sin que se duplique nada.');
    pintarKpis();
  } finally {
    b.textContent = 'Procesar y guardar'; b.disabled = !COLA.length;
    datosCambiados(); await refrescarAnios(); cargarCargas();
  }
}

// ---------------------------------------------------------------- navegación y filtros
const TITULOS = {
  inicio: ['Inicio', 'Resumen de consumo y coste de los puntos de recarga'],
  facturas: ['Facturas', 'Todas las líneas de factura unificadas, sin duplicados'],
  puntos: ['Puntos de recarga', 'Consumo y coste agregados por CUPS'],
  cruce: ['Cruce con sistema técnico', 'Facturado vs. medido'],
  correcciones: ['Correcciones', 'Reglas para corregir cómo cuentan algunas facturas'],
  cargar: ['Cargar datos', 'Sube Excels, carpetas o ZIPs de facturación agrupada'],
};
function irA(v) {
  if (!TITULOS[v]) v = 'inicio';
  ST.vista = v;
  $$('nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === v));
  $$('.vista').forEach((s) => s.classList.toggle('hide', s.id !== 'v-' + v));
  $('#titulo').textContent = TITULOS[v][0]; $('#subtitulo').textContent = TITULOS[v][1];
  $('#filtros').classList.toggle('hide', !['inicio', 'facturas', 'puntos'].includes(v));
  refrescar();
}
function refrescar() {
  if (ST.vista === 'inicio') cargarDashboard();
  else if (ST.vista === 'facturas') cargarFacturas();
  else if (ST.vista === 'puntos') cargarPuntos();
  else if (ST.vista === 'cargar') cargarCargas();
  else if (ST.vista === 'correcciones') cargarCorrecciones();
}
async function refrescarAnios() {
  const [anios, res] = await Promise.all([seguro(() => SB.rpc('anios', { p_base: ST.base })), seguro(() => SB.rpc('resumen'))]);
  if (!anios || !res) return false;
  ST.admin = !!res.admin;
  const sel = $('#selAnio'), prev = ST.anio;
  sel.innerHTML = anios.map((a) => `<option value="${a}">${a}</option>`).join('') + '<option value="">Todo el histórico</option>';
  ST.anio = anios.includes(prev) ? prev : (anios[0] ?? null);
  sel.value = ST.anio ?? '';
  $('#sideFoot').innerHTML = res.filas ? `${fN(res.facturas)} facturas guardadas<br>Última carga: ${esc(fFechaHora(res.ultima_carga))}` : 'Sin datos cargados';
  return true;
}

// ---------------------------------------------------------------- acceso
let MODO_LOGIN = 'login';
function mostrarLogin(modo = 'login') {
  MODO_LOGIN = modo;
  $('#appRoot').classList.add('hide'); $('#login').classList.remove('hide');
  const nueva = modo === 'nueva';
  $('#lTitulo').textContent = nueva ? 'Elige tu contraseña' : 'Iniciar sesión';
  $('#lEmailBox').classList.toggle('hide', nueva); $('#lEmail').required = !nueva;
  $('#lPass2Box').classList.toggle('hide', !nueva); $('#lPass2').required = nueva;
  $('#lPass').autocomplete = nueva ? 'new-password' : 'current-password';
  $('#lBtn').textContent = nueva ? 'Guardar contraseña' : 'Entrar';
  $('#lOlvido').classList.toggle('hide', nueva);
  $('#lErr').textContent = '';
}
async function entrarApp() {
  $('#login').classList.add('hide'); $('#appRoot').classList.remove('hide');
  $('#meEmail').textContent = SB.email || '';
  if (await refrescarAnios()) irA(location.hash.slice(1) || 'inicio');
}

function init() {
  // acceso
  $('#fLogin').onsubmit = async (e) => {
    e.preventDefault(); const b = $('#lBtn'); b.disabled = true; $('#lErr').textContent = '';
    try {
      if (MODO_LOGIN === 'nueva') {
        if ($('#lPass').value !== $('#lPass2').value) throw new Error('Las contraseñas no coinciden.');
        await SB.cambiarPassword($('#lPass').value);
        await SB.cargarUsuario();
      } else {
        await SB.login($('#lEmail').value.trim(), $('#lPass').value);
      }
      $('#lPass').value = $('#lPass2').value = '';
      await entrarApp();
    } catch (err) { $('#lErr').textContent = err.message === 'sin_sesion' ? 'El enlace ha caducado. Pide uno nuevo.' : err.message; }
    finally { b.disabled = false; }
  };
  $('#lOlvido').onclick = async (e) => {
    e.preventDefault();
    const email = $('#lEmail').value.trim();
    if (!email) { $('#lErr').textContent = 'Escribe tu email y vuelve a pulsar.'; return; }
    try { await SB.recuperar(email); $('#lErr').textContent = ''; toast('Te hemos enviado un email para restablecer la contraseña.'); }
    catch (err) { $('#lErr').textContent = err.message; }
  };
  $('#btnSalir').onclick = async () => { await SB.logout(); mostrarLogin(); };

  // correcciones y actualizar
  $('#fRegla').onsubmit = guardarRegla;
  $('#rCampo').onchange = sugerirValores;
  $('#btnActualizar').onclick = async (e) => {
    const b = e.currentTarget; b.classList.add('girando'); b.disabled = true;
    datosCambiados(); CABS = null;
    await refrescarAnios(); await Promise.resolve(refrescar());
    setTimeout(() => { b.classList.remove('girando'); b.disabled = false; }, 400);
  };

  // filtros
  $$('#segBase button').forEach((b) => b.onclick = async () => {
    $$('#segBase button').forEach((x) => x.classList.toggle('on', x === b));
    ST.base = b.dataset.b; ST.f.pag = 1; await refrescarAnios(); refrescar();
  });
  $('#selAnio').onchange = (e) => { ST.anio = e.target.value ? +e.target.value : null; ST.f.pag = 1; refrescar(); };
  let t; const deb = (fn) => () => { clearTimeout(t); t = setTimeout(fn, 300); };
  $('#fQ').oninput = deb(() => { ST.f.pag = 1; cargarFacturas(); });
  $('#fEstado').onchange = $('#fTodas').onchange = () => { ST.f.pag = 1; cargarFacturas(); };
  $('#pQ').oninput = deb(cargarPuntos);
  $('#fExport').onclick = (e) => exportarFilas(queryFacturas(), 'facturas', e.currentTarget);
  $('#pExport').onclick = exportarPuntos;
  $('#btnExportAll').onclick = (e) => exportarFilas({ order: 'fecha_emision.asc.nullslast,huella' }, 'facturas_unificadas', e.currentTarget);

  // subida
  $('#inFiles').onchange = (e) => { encolar(e.target.files); e.target.value = ''; };
  $('#inDir').onchange = (e) => { encolar(e.target.files); e.target.value = ''; };
  $('#btnLimpiar').onclick = () => { COLA = []; pintarCola(); $('#resCarga').classList.add('hide'); $('#progreso').classList.add('hide'); };
  $('#btnProcesar').onclick = procesar;
  const d = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => d.addEventListener(ev, (e) => { e.preventDefault(); d.classList.add('on'); }));
  ['dragleave', 'drop'].forEach((ev) => d.addEventListener(ev, (e) => { e.preventDefault(); d.classList.remove('on'); }));
  d.addEventListener('drop', async (e) => {
    const items = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    const acc = [];
    async function walk(en, p) {
      if (en.isFile) { const f = await new Promise((r) => en.file(r)); f._path = p + f.name; acc.push(f); }
      else if (en.isDirectory) { const r = en.createReader(); let b; do { b = await new Promise((res) => r.readEntries(res)); for (const c of b) await walk(c, p + en.name + '/'); } while (b.length); }
    }
    for (const en of items) await walk(en, '');
    encolar(acc);
  });
  // vaciar
  $('#btnVaciar').onclick = () => $('#modal').classList.remove('hide');
  $('#mNo').onclick = () => $('#modal').classList.add('hide');
  $('#mSi').onclick = async () => {
    const ok = await seguro(() => SB.rpc('vaciar'));
    $('#modal').classList.add('hide');
    if (ok !== null) { PUNTOS.clave = null; CABS = null; toast('Datos vaciados'); }
    await refrescarAnios(); cargarCargas();
  };

  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (ST.vista === 'inicio' && DASH && !DASH.vacio) pintarDashboard(); }, 150); });
  addEventListener('hashchange', () => { if (!$('#appRoot').classList.contains('hide')) irA(location.hash.slice(1)); });

  // arranque: ¿venimos de un enlace de invitación / recuperación?
  const tipo = SB.leerSesionDeUrl();
  if (tipo === 'invite' || tipo === 'recovery') {
    SB.cargarUsuario().catch(() => {});
    mostrarLogin('nueva');
  } else if (SB.sesion) entrarApp();
  else mostrarLogin();
}
init();
