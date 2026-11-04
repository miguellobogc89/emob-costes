/* eMob · Costes de energía — web (Supabase) */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const ST = { vista: 'inicio', base: 'consumo', tension: 'BT', anio: null, admin: false, f: { pag: 1, orden: null, dir: 'asc' }, p: { orden: 'kwh', dir: 'desc' } };
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
// ---------------------------------------------------------------- esqueletos
const sk = (w, h = '0.9em') => `<span class="sk" style="width:${w};height:${h}"></span>`;
const ALTOS = [52, 48, 60, 57, 34, 28, 36, 30, 80, 44, 38, 50];
function skDashboard() {
  $('#vacio').classList.add('hide'); $('#dash').classList.remove('hide');
  $('#kKwh').innerHTML = sk('150px', '44px'); $('#kDelta').innerHTML = ''; $('#kNetoDelta').innerHTML = ''; $('#kEurDelta').innerHTML = ''; $('#kHeroSub').innerHTML = sk('75%');
  for (const id of ['#kNeto', '#kEurKwh', '#kPuntos', '#kExceso']) $(id).innerHTML = sk('110px', '26px');
  for (const id of ['#kTotal', '#kFacturas', '#kExcesoSub']) $(id).innerHTML = sk('80%');
  $('#chMensual').innerHTML = `<div class="sk-cols">${ALTOS.map((h) => `<span class="sk" style="height:${h}%"></span>`).join('')}</div>`;
  $('#chEurKwh').innerHTML = `<div class="sk-line"><span class="sk"></span><span class="sk onda"></span><span class="sk"></span><span class="sk"></span></div>`;
  const filas = (n, anchos) => Array.from({ length: n }, (_, i) => `<div class="hb"><span class="n">${sk('70%')}</span><span class="t">${sk(anchos[i % anchos.length] + '%', '14px')}</span><span class="v">${sk('90px')}</span></div>`).join('');
  $('#lsCostes').innerHTML = filas(8, [95, 18, 5, 8, 6, 3, 2, 30]);
  $('#lsPeriodos').innerHTML = filas(6, [35, 33, 42, 38, 12, 95]);
  $('#lsLecturas').innerHTML = filas(5, [95, 70, 60, 10, 6]);
  $('#hCostes').textContent = ''; $('#notaLect').innerHTML = sk('90%');
  $('#tbTop').innerHTML = `<thead><tr><th>CUPS · dirección</th><th class="num">kWh</th><th class="num">€ sin IVA</th><th class="num">€/kWh</th></tr></thead><tbody>` +
    Array.from({ length: 8 }, () => `<tr class="skr"><td>${sk('170px')}<br>${sk('220px')}</td><td class="num">${sk('90px')}</td><td class="num">${sk('70px')}</td><td class="num">${sk('40px')}</td></tr>`).join('') + '</tbody>';
}
/** Filas de esqueleto en una tabla vacía; si ya tiene datos, solo la atenúa. */
function skTabla(tb, cols = 8, n = 12) {
  if (tb.querySelector('tbody tr:not(.skr)')) { tb.classList.add('loading'); return; }
  const head = tb.querySelector('thead')?.outerHTML || `<thead><tr>${Array.from({ length: cols }, () => `<th>${sk('70px')}</th>`).join('')}</tr></thead>`;
  const nc = tb.querySelectorAll('thead th').length || cols;
  tb.innerHTML = head + '<tbody>' + Array.from({ length: n }, (_, r) => `<tr class="skr">${Array.from({ length: nc }, (_, c) => `<td>${sk(40 + ((r * 7 + c * 13) % 5) * 18 + 'px')}</td>`).join('')}</tr>`).join('') + '</tbody>';
}

/** Ejecuta una llamada y gestiona errores comunes (sesión caducada, red...). */
async function seguro(fn) {
  try { return await fn(); }
  catch (e) {
    if (e.message === 'sin_sesion') { mostrarLogin(); return null; }
    console.error(e); toast('Error: ' + e.message, 6000); return null;
  }
}
const args = () => ({ p_anio: ST.anio, p_base: ST.base, p_tension: ST.tension || null });
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
const hideTip = () => tip.classList.remove('ayuda') || tip.classList.add('hide');
// iconos de ayuda: pasar el ratón, enfocar con teclado o tocar
document.addEventListener('mouseover', (e) => { const b = e.target.closest('.info'); if (b) { showTip(e, esc(b.dataset.info)); tip.classList.add('ayuda'); } });
document.addEventListener('mouseout', (e) => { if (e.target.closest('.info')) hideTip(); });
document.addEventListener('click', (e) => {
  const b = e.target.closest('.info');
  if (!b) { if (tip.classList.contains('ayuda')) hideTip(); return; }
  e.preventDefault(); e.stopPropagation();
  const r = b.getBoundingClientRect(); showTip({ clientX: r.right, clientY: r.top }, esc(b.dataset.info)); tip.classList.add('ayuda');
});
document.addEventListener('focusin', (e) => { const b = e.target.closest?.('.info'); if (b) { const r = b.getBoundingClientRect(); showTip({ clientX: r.right, clientY: r.top }, esc(b.dataset.info)); tip.classList.add('ayuda'); } });
document.addEventListener('focusout', (e) => { if (e.target.closest?.('.info')) hideTip(); });
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
  if (el.clientWidth < 80) return;            // contenedor no visible: se pinta al volver
  const { svg, W, H, m, y } = frame(el, data.flatMap((d) => [d.value, d.g]).filter((v) => v != null), fmtAxis);
  const band = (W - m.l - m.r) / data.length, bw = Math.min(24, band * 0.6);
  data.forEach((d, i) => {
    const cx = m.l + band * i + band / 2;
    const lx = svgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }); lx.textContent = d.label; svg.append(lx);
    barraSvg(svg, y, cx - bw / 2 - 4, bw + 8, d.g, 'ghost');            // año anterior, detrás y algo más ancha
    d._bar = barraSvg(svg, y, cx - bw / 2, bw, d.value, 'bar');
    const hit = svgEl('rect', { x: cx - band / 2, y: m.t, width: band, height: H - m.t - m.b, fill: 'transparent' });
    hit.addEventListener('mousemove', (e) => { el.classList.add('hovering'); d._bar?.classList.add('hl'); showTip(e, tipFn(d)); });
    hit.addEventListener('mouseleave', () => { el.classList.remove('hovering'); d._bar?.classList.remove('hl'); hideTip(); });
    svg.append(hit);
  });
}
/** Barra con el extremo de datos redondeado y la base recta. */
function barraSvg(svg, y, x0, bw, v, cls) {
  if (v == null || v === 0) return null;
  const ya = y(Math.max(0, v)), yb = y(Math.min(0, v)), h = Math.max(1, yb - ya), r = Math.min(4, h / 2, bw / 2), x1 = x0 + bw;
  const d = v > 0 ? `M${x0},${yb} V${ya + r} Q${x0},${ya} ${x0 + r},${ya} H${x1 - r} Q${x1},${ya} ${x1},${ya + r} V${yb} Z`
    : `M${x0},${ya} V${yb - r} Q${x0},${yb} ${x0 + r},${yb} H${x1 - r} Q${x1},${yb} ${x1},${yb - r} V${ya} Z`;
  const p = svgEl('path', { d, class: cls }); svg.append(p); return p;
}

function lineChart(el, data, { fmtAxis = fComp, fmtEnd, tipFn, prev, desdeCero = false, puntos = true, onClick }) {
  if (el.clientWidth < 80) return;
  const vals = data.map((d) => d.value).concat(prev || []).filter((v) => v != null);
  if (!vals.length) { el.innerHTML = '<p class="muted sm">Sin datos</p>'; return; }
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.25 || hi * 0.1 || 1;
  const { svg, W, H, m } = frameRange(el, desdeCero ? Math.min(0, lo) : lo - pad, hi + pad, fmtAxis);
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
  if (prev) {   // año anterior: línea clara, sin puntos
    let tramo = [];
    const fin = () => { if (tramo.length > 1) svg.append(svgEl('path', { class: 'line-prev', d: 'M' + tramo.map(([a, b]) => `${a},${b}`).join(' L') })); tramo = []; };
    prev.forEach((v, i) => { if (v == null) fin(); else tramo.push([X(i), frame.yy(v)]); }); fin();
  }
  data.forEach((d, i) => { if (d.value == null) flush(); else seg.push([X(i), frame.yy(d.value)]); });
  flush();
  const xh = svgEl('line', { class: 'xhair', y1: m.t, y2: H - m.b, visibility: 'hidden' }); svg.append(xh);
  let last = -1;
  data.forEach((d, i) => {
    const lx = svgEl('text', { x: X(i), y: H - 8, 'text-anchor': 'middle' }); lx.textContent = d.label; svg.append(lx);
    if (d.value != null) { if (puntos) svg.append(svgEl('circle', { class: 'dot', cx: X(i), cy: frame.yy(d.value), r: 4 })); last = i; }
  });
  if (last >= 0 && fmtEnd) {
    const t = svgEl('text', { class: 'lbl-end', x: X(last), y: frame.yy(data[last].value) - 10, 'text-anchor': 'middle' });
    t.textContent = fmtEnd(data[last].value); svg.append(t);
  }
  data.forEach((d, i) => {
    const hit = svgEl('rect', { x: X(i) - band / 2, y: m.t, width: band, height: H - m.t - m.b, fill: 'transparent' });
    hit.addEventListener('mousemove', (e) => { xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.setAttribute('visibility', 'visible'); showTip(e, tipFn(d)); });
    hit.addEventListener('mouseleave', () => { xh.setAttribute('visibility', 'hidden'); hideTip(); });
    if (onClick) { hit.style.cursor = 'pointer'; hit.addEventListener('click', () => { hideTip(); onClick(d); }); }
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
  const max = Math.max(...rows.map((r) => Math.max(Math.abs(r.value), Math.abs(r.prev ?? 0))), 1);
  el.innerHTML = rows.map((r, i) => `
    <div class="hb" data-i="${i}">
      <span class="n" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="t">${r.prev != null ? `<span class="f g" style="width:${(Math.abs(r.prev) / max) * 100}%"></span>` : ''}<span class="f ${r.value < 0 ? 'neg' : ''}" style="width:${(Math.abs(r.value) / max) * 100}%"></span></span>
      <span class="v">${fmtV(r)}</span>
    </div>`).join('');
  if (tipFn) el.querySelectorAll('.hb').forEach((n) => {
    n.addEventListener('mousemove', (e) => showTip(e, tipFn(rows[+n.dataset.i])));
    n.addEventListener('mouseleave', hideTip);
  });
}

// ---------------------------------------------------------------- INICIO
let DASH = null;
// memoria en el navegador: se muestra al instante lo último visto y se actualiza por detrás
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem('emob.c.' + k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('emob.c.' + k, JSON.stringify(v)); } catch { /* lleno o no disponible */ } },
};

async function cargarDashboard() {
  const pedido = JSON.stringify(args());
  const clave = 'dash.' + pedido;
  const guardado = LS.get(clave);
  if (ST.anio && !COMP) COMP = LS.get('comp.' + ST.anio);
  if (guardado && !guardado.vacio) mostrarDash(guardado); else skDashboard();
  const [d] = await Promise.all([seguro(() => SB.rpc('dashboard', args())), ST.anio ? seguro(datosComp) : null]);
  if (pedido !== JSON.stringify(args())) return;      // el usuario cambió el filtro mientras cargaba
  if (!d) return;
  LS.set(clave, d);
  if (guardado && JSON.stringify(guardado) === JSON.stringify(d) && !COMP_CAMBIO) return;   // nada nuevo
  mostrarDash(d);
}
let COMP_CAMBIO = false;

function mostrarDash(d) {
  DASH = d;
  if (ST.vista !== 'inicio' || ST.itab !== 'facturas') return;   // se ha cambiado de pantalla mientras cargaba
  if (!d.vacio) cargarCompMini(); else $('#cardComp').classList.add('hide');
  $('#vacio').classList.toggle('hide', !d.vacio);
  $('#dash').classList.toggle('hide', !!d.vacio);
  if (!d.vacio) pintarDashboard();
}

const deltaHtml = (act, ant, ctx, subirEsBueno = true) => {
  if (act == null || !ant) return '';
  const v = (act / ant - 1) * 100, up = v >= 0, bueno = up === subirEsBueno;
  return `<span class="${bueno ? 'up' : 'down'}">${up ? '▲' : '▼'} ${fN(Math.abs(v), 1)} %</span> <span class="ctx">${ctx}</span>`;
};

function pintarDashboard() {
  const d = DASH, k = d.kpi, per = d.anio ? d.anio : 'todo el histórico';
  const ant = d.anio ? d.anio - 1 : null;
  $('#kHeroLbl').textContent = `Consumo facturado · ${per} · ${ST.tension || 'BT + MT'}`;
  $('#kKwh').textContent = fN(k.kwh / 1000, 0);
  $('#kHeroSub').textContent = `${fN(k.facturas)} facturas · ${fN(k.anuladas)} anuladas · ${fN(k.rectificativas)} rectificativas`;
  const pv = d.previo && d.previo.kwh > 0 ? d.previo : null;
  $('#kDelta').className = 'delta';
  $('#kDelta').innerHTML = pv ? deltaHtml(k.kwh, pv.kwh, `vs. mismos meses de ${ant}`) : '';
  $('#kNeto').textContent = fEur(k.neto);
  $('#kNetoDelta').innerHTML = pv ? deltaHtml(k.neto, pv.neto, `vs. ${ant}`, false) : '';
  $('#kTotal').textContent = `${fEur(k.total)} con IVA`;
  $('#kEurKwh').textContent = k.eur_kwh == null ? '—' : fN(k.eur_kwh, 3) + ' €';
  $('#kEurDelta').innerHTML = pv && k.eur_kwh != null ? deltaHtml(k.eur_kwh, pv.neto / pv.kwh, `vs. ${ant} (${fN(pv.neto / pv.kwh, 3)})`, false) : '';
  $('#kPuntos').textContent = fN(k.puntos);
  $('#kFacturas').textContent = `con consumo · ${fN(k.puntos_total)} en total`;
  $('#kExceso').textContent = fEur(k.exceso_eur);
  $('#kExcesoSub').textContent = `${fN(k.puntos_exceso)} CUPS con penalización`;

  const baseTxt = d.base === 'consumo' ? 'por fecha fin del periodo facturado' : 'por fecha de emisión';
  $('#hMens').textContent = `kWh · ${baseTxt}`;
  const prev = d.mensual_prev || null;
  const mens = d.mensual.map((m, i) => ({ ...m, label: MESES[m.mes - 1], value: m.kwh, g: prev?.[i]?.kwh ?? null, p: prev?.[i] || null }));
  // consumo BT del analítico del equipo (solo por mes de consumo y si hay analítico de ese año)
  const eqBT = {};
  if (d.base === 'consumo' && d.tension === 'BT' && d.anio && COMP?.anio === d.anio && COMP.carga)
    for (const v of COMP.equipo) if (v.seg === 'BT' && v.concepto === 'consumo') eqBT[v.mes] = +v.valor;
  const conEquipo = Object.keys(eqBT).length > 0;
  const hayPrev = !!prev && prev.some((m) => m.kwh);
  $('#legMens').classList.toggle('hide', !conEquipo && !hayPrev);
  $('#legMens').innerHTML = `<span><i class="sw1"></i>Facturas ${d.anio ?? ''}</span>` + (hayPrev ? `<span><i class="swg"></i>${ant}</span>` : '') + (conEquipo ? `<span><i class="sw2"></i>Analítico del equipo (BT)</span>` : '');
  const tipMes = (m) => tipRows(`${MESES[m.mes - 1]} ${d.anio ?? ''}`, (m.kwh == null ? [['Facturas', 'sin facturas']] :
    [['Consumo facturas', fN(m.kwh) + ' kWh'], ['Importe sin IVA', fEur(m.neto)], ['€/kWh', m.eur_kwh == null ? '—' : fN(m.eur_kwh, 3)], ['Facturas', fN(m.facturas)]])
    .concat(hayPrev ? [[`Consumo ${ant}`, m.g == null ? '—' : fN(m.g) + ' kWh'], [`vs. ${ant}`, fPct(pct(m.kwh, m.g))]] : [])
    .concat(conEquipo ? [['Equipo (BT)', eqBT[m.mes] == null ? '—' : fN(Math.round(eqBT[m.mes])) + ' kWh'], ['vs. equipo', fPct(pct(m.kwh, eqBT[m.mes]))]] : []));
  if (conEquipo) groupedChart($('#chMensual'), mens.map((m) => ({ ...m, a: m.kwh, b: eqBT[m.mes] ?? null })), { tipFn: tipMes });
  else columnChart($('#chMensual'), mens, { tipFn: tipMes });
  // €/kWh del año anterior; se ignoran meses con valores imposibles (pocos kWh o abonos)
  const prevEur = hayPrev ? prev.map((m) => (m.eur_kwh != null && m.eur_kwh > 0 && m.eur_kwh < 2 ? m.eur_kwh : null)) : null;
  $('#legEur').classList.toggle('hide', !hayPrev);
  $('#legEur').innerHTML = `<span><i class="swl"></i>${d.anio ?? ''}</span><span><i class="swl g"></i>${ant}</span>`;
  lineChart($('#chEurKwh'), mens.map((m) => ({ ...m, value: m.eur_kwh })), {
    fmtAxis: (v) => nf(2).format(v), fmtEnd: (v) => fN(v, 3), prev: prevEur,
    tipFn: (m) => tipRows(`${MESES[m.mes - 1]} ${d.anio ?? ''}`, [['Coste medio', m.eur_kwh == null ? '—' : fN(m.eur_kwh, 3) + ' €/kWh'], ['Importe sin IVA', fEur(m.neto)]]
      .concat(hayPrev ? [[`Coste medio ${ant}`, m.p?.eur_kwh == null ? '—' : fN(m.p.eur_kwh, 3) + ' €/kWh']] : [])),
  });

  const tot = d.costes.reduce((a, c) => a + c.eur, 0);
  const cPrev = Object.fromEntries((d.costes_prev || []).map((c) => [c.concepto, c.eur]));
  $('#hCostes').textContent = `Total ${fEur(tot)} con IVA${d.costes_prev ? ` · barra clara: ${ant}` : ''}`;
  hbars($('#lsCostes'), d.costes.map((c) => ({ label: c.concepto, value: c.eur, prev: d.costes_prev ? (cPrev[c.concepto] ?? 0) : null })), {
    fmtV: (r) => `<b>${fEur(r.value)}</b> · ${fN(tot ? (r.value / tot) * 100 : 0, 1)} %`,
    tipFn: d.costes_prev ? (r) => tipRows(r.label, [[String(d.anio), fEur(r.value)], [String(ant), fEur(r.prev)], ['Variación', fPct(pct(r.value, r.prev))]]) : null,
  });
  const ptot = d.periodos.reduce((a, c) => a + c.kwh, 0);
  const pPrev = Object.fromEntries((d.periodos_prev || []).map((c) => [c.periodo, c.kwh]));
  hbars($('#lsPeriodos'), d.periodos.map((p) => ({ label: p.periodo, value: p.kwh, prev: d.periodos_prev ? (pPrev[p.periodo] ?? 0) : null })), {
    fmtV: (r) => `<b>${fN(r.value)}</b> kWh · ${fN(ptot ? (r.value / ptot) * 100 : 0, 1)} %`,
    tipFn: d.periodos_prev ? (r) => tipRows(r.label, [[String(d.anio), fN(r.value) + ' kWh'], [String(ant), fN(r.prev) + ' kWh'], ['Variación', fPct(pct(r.value, r.prev))]]) : null,
  });
  const ltot = d.lecturas.reduce((a, c) => a + c.facturas, 0);
  hbars($('#lsLecturas'), d.lecturas.map((l) => ({ label: l.tipo, value: l.facturas })), {
    fmtV: (r) => `<b>${fN(r.value)}</b> · ${fN(ltot ? (r.value / ltot) * 100 : 0, 1)} %`,
  });
  const est = d.lecturas.filter((l) => /estimad/i.test(l.tipo)).reduce((a, c) => a + c.facturas, 0);
  $('#notaLect').textContent = est
    ? `${fN(est)} facturas (${fN((est / ltot) * 100, 1)} %) con lectura estimada: son las primeras candidatas a revisar en el cruce con evOS.`
    : 'No hay facturas con lectura estimada en este periodo.';

  const tmax = Math.max(...d.top.map((t) => t.kwh), 1);
  $('#tbTop').innerHTML = `<thead><tr><th>CUPS · dirección</th><th class="num">kWh</th><th class="num">€ sin IVA</th><th class="num">€/kWh</th></tr></thead><tbody>` +
    d.top.map((t) => `<tr><td class="wrap"><span class="cups">${esc(t.cups)}</span><br>${esc(t.direccion)}</td>
      <td class="num"><span class="inbar" style="width:${(t.kwh / tmax) * 70}px"></span>${fN(t.kwh)}</td>
      <td class="num">${fEur(t.neto)}</td><td class="num">${fN(t.eur_kwh, 3)}</td></tr>`).join('') + '</tbody>';
}


// ---------------------------------------------------------------- FACTURAS
const COLS_F = [
  ['mes_emision', 'MES EMISIÓN'], ['id_factura', 'ID PSEUDOFACTURA'], ['estado', 'ESTADO'], ['cups', 'CUPS'], ['direccion', 'DIRECCIÓN PS'],
  ['tarifa', 'TARIFA ATR'], ['tension', 'TENSIÓN'], ['distribuidora', 'DISTRIBUIDORA'], ['fecha_emision', 'FECHA EMISIÓN', 'f'], ['fecha_desde', 'DESDE', 'f'],
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
/** En Tablas, las pestañas BT y MT fijan la tensión; fuera, manda el filtro de arriba. */
const tensionFact = () => (ST.vista === 'tablas' && ['bt', 'mt'].includes(ST.tab) ? ST.tab.toUpperCase() : ST.tension);
function queryFacturas() {
  const q = {}; const conds = [];
  if (ST.anio) { const c = ST.base === 'emision' ? 'fecha_emision' : 'fecha_hasta'; conds.push(`${c}.gte.${ST.anio}-01-01`, `${c}.lt.${ST.anio + 1}-01-01`); }
  const ten = tensionFact(); if (ten) conds.push(`tension.eq.${ten}`);
  const t = $('#fQ').value.trim().replace(/[",()]/g, ' ');
  if (t) conds.push(`or(${['cups', 'direccion', 'id_factura', 'sheet_code'].map((c) => `${c}.ilike."*${t}*"`).join(',')})`);
  if (conds.length) q.and = `(${conds.join(',')})`;
  const est = $('#fEstado').value;
  if (est === 'sust') q.sustituida = 'is.true';
  else if (est) q.estado = 'eq.' + est;
  q.order = ST.f.orden ? `${ST.f.orden}.${ST.f.dir}.nullslast,huella` : 'fecha_emision.asc.nullslast,huella';
  return q;
}
async function cargarFacturas() {
  const todas = $('#fTodas').checked;
  const q = queryFacturas();
  q.select = todas ? COLS_F.map((c) => c[0]).join(',') + ',cabecera_id,valores' : COLS_F.map((c) => c[0]).join(',');
  q.limit = 50; q.offset = (ST.f.pag - 1) * 50;
  const tb = $('#tbFact'); skTabla(tb, 12);
  q.select += ',negativa,excluida,sustituida,motivo_sust,anomala';
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
      if (k === 'estado') return `<td>${v ? `<span class="tag ${esc(v)}">${ESTADOS[v] || esc(v)}</span>` : ''}${f.negativa ? ' <span class="tag neg" title="Corrección: en negativo">−</span>' : ''}${f.excluida ? ' <span class="tag exc" title="Corrección: excluida de los cálculos">Excluida</span>' : ''}${f.sustituida ? ` <span class="tag sust" title="${esc(f.motivo_sust || 'Sustituida')}">Sustituida</span>` : ''}${f.anomala ? ' <span class="tag exc" title="Consumo de más de 1.000.000 kWh (p. ej. vuelta del contador): sus kWh no se cuentan, los importes sí">kWh anómalo</span>' : ''}</td>`;
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
const META_EXPORT = ['MES EMISIÓN', 'TENSIÓN', 'sheet_code', 'archivo_origen', 'CORRECCIÓN'];
const A_NEGATIVO = /^(CONSUMO|IMPORTE|CANTIDAD)/i;   // columnas que cambian de signo con la corrección «negativo»
async function exportarFilas(q, nombre, boton) {
  const txt = boton.textContent; boton.disabled = true;
  try {
    const cabs = await cabeceras();
    q.select = 'mes_emision,tension,sheet_code,archivo_origen,cabecera_id,valores,negativa,excluida,sustituida,motivo_sust,anomala';
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
      const corr = [f.negativa ? 'En negativo' : '', f.excluida ? 'Excluida' : '', f.sustituida ? (f.motivo_sust || 'Sustituida') : '', f.anomala ? 'kWh anómalo (no cuenta)' : ''].filter(Boolean).join(' · ');
      aoa.push([f.mes_emision, f.tension, f.sheet_code, f.archivo_origen, corr || null, ...row]);
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
  ['cups', 'CUPS'], ['direccion', 'Dirección'], ['distribuidora', 'Distribuidora'], ['tarifa', 'Tarifa'],
  ['facturas', 'Facturas', 'n'], ['kwh', 'Consumo kWh', 'n'], ['neto', '€ sin IVA', 'e'], ['total', '€ con IVA', 'e'],
  ['eur_kwh', '€/kWh', 'r'], ['exceso_eur', 'Exceso potencia €', 'e'], ['desde', 'Desde', 'f'], ['hasta', 'Hasta', 'f'],
];
let PUNTOS = { clave: null, filas: [] };
async function datosPuntos() {
  const clave = `${ST.anio}|${ST.base}|${ST.tension}`;
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
  const tb = $('#tbPuntos'); skTabla(tb, 12);
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
  $('#pTotal').textContent = filas.length > vis.length ? `${fN(filas.length)} CUPS (se muestran ${vis.length}; exporta para verlos todos)` : `${fN(filas.length)} CUPS`;
}
async function exportarPuntos() {
  const todos = await seguro(datosPuntos); if (!todos) return;
  const aoa = [P_COLS.map((c) => c[1])].concat(puntosFiltrados(todos).map((f) => P_COLS.map(([k, , n]) =>
    n === 'f' ? (f[k] ? isoASerial(f[k]) : null) : (n ? (f[k] == null ? null : +f[k]) : f[k]))));
  descargar(hoja(aoa, P_COLS.map((c, i) => (c[2] === 'f' ? i : -1)).filter((i) => i >= 0)), 'CUPS', `cups_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---------------------------------------------------------------- COMPARATIVA (analítico del equipo)
function groupedChart(el, data, { fmtAxis = fComp, tipFn, onClick }) {
  if (el.clientWidth < 80) return;
  const vals = data.flatMap((d) => [d.a, d.b, d.c, d.g]).filter((v) => v != null);
  const tres = data.some((d) => d.c != null);   // tercera serie opcional (celeste)
  const { svg, W, H, m, y } = frame(el, vals.length ? vals : [0], fmtAxis);
  const band = (W - m.l - m.r) / data.length, bw = Math.min(tres ? 11 : 14, band * (tres ? 0.24 : 0.32));
  const barra = (x0, v, cls) => {
    if (v == null || v === 0) return null;
    const ya = y(Math.max(0, v)), yb = y(Math.min(0, v)), h = Math.max(1, yb - ya), r = Math.min(4, h / 2, bw / 2), x1 = x0 + bw;
    const d = v > 0 ? `M${x0},${yb} V${ya + r} Q${x0},${ya} ${x0 + r},${ya} H${x1 - r} Q${x1},${ya} ${x1},${ya + r} V${yb} Z`
      : `M${x0},${ya} V${yb - r} Q${x0},${yb} ${x0 + r},${yb} H${x1 - r} Q${x1},${yb} ${x1},${yb - r} V${ya} Z`;
    const p = svgEl('path', { d, class: cls }); svg.append(p); return p;
  };
  data.forEach((d, i) => {
    const cx = m.l + band * i + band / 2;
    const lx = svgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }); lx.textContent = d.label; svg.append(lx);
    const x0 = tres ? cx - bw * 1.5 - 2 : cx - bw - 1;                            // 2px de aire entre barras
    barraSvg(svg, y, x0 - 3, bw + 6, d.g, 'ghost');                              // año anterior detrás de la azul
    const pa = barra(x0, d.a, 'bar'), pb = barra(x0 + bw + 2, d.b, 'bar2'), pc = tres ? barra(x0 + 2 * bw + 4, d.c, 'bar3') : null;
    const hit = svgEl('rect', { x: cx - band / 2, y: m.t, width: band, height: H - m.t - m.b, fill: 'transparent' });
    hit.addEventListener('mousemove', (e) => { el.classList.add('hovering'); for (const p of [pa, pb, pc]) p?.classList.add('hl'); showTip(e, tipFn(d)); });
    hit.addEventListener('mouseleave', () => { el.classList.remove('hovering'); for (const p of [pa, pb, pc]) p?.classList.remove('hl'); hideTip(); });
    if (onClick) { hit.style.cursor = 'pointer'; hit.addEventListener('click', () => { hideTip(); onClick(d); }); }
    svg.append(hit);
  });
}

let COMP = null; ST.seg = 'BT';   // MT descartado por ahora
const pct = (a, b) => (a == null || b == null || !b ? null : (a - b) / Math.abs(b) * 100);
const fPct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${fN(v, 1)} %`);
const desv = (v, umbral = 10) => `<span class="desv ${v != null && Math.abs(v) > umbral ? 'alta' : ''}">${fPct(v)}</span>`;

/** Une lo del equipo y lo de las facturas por mes para un segmento (TOTAL/BT/MT). */
function calcComp(d, seg) {
  const E = {};   // E[seg][concepto][mes]
  for (const v of d.equipo) ((E[v.seg] ??= {})[v.concepto] ??= {})[v.mes] = +v.valor;
  const F = {};   // F[mes] = {kwh, energia, fijo, neto, facturas}
  for (const n of d.nuestro) {
    if (seg !== 'TOTAL' && n.seg !== seg) continue;
    const f = (F[n.mes] ??= { kwh: 0, energia: 0, fijo: 0, neto: 0, facturas: 0 });
    for (const k of ['kwh', 'energia', 'fijo', 'neto', 'facturas']) f[k] += +n[k] || 0;
  }
  const eq = (concepto, mes) => {
    if (seg !== 'TOTAL') return E[seg]?.[concepto]?.[mes] ?? null;
    if (concepto === 'consumo') return E.TOTAL?.consumo?.[mes] ?? null;
    // total: media de BT y MT ponderada por su consumo
    let num = 0, den = 0;
    for (const s of ['BT', 'MT']) { const v = E[s]?.[concepto]?.[mes], k = E[s]?.consumo?.[mes]; if (v != null && k) { num += v * k; den += k; } }
    return den ? num / den : null;
  };
  const meses = [];
  for (let mes = 1; mes <= 12; mes++) {
    const f = F[mes]; const kF = f && f.kwh ? f.kwh : null; const kE = eq('consumo', mes);
    const cv = eq('cv', mes), cf = eq('cf', mes), rs = eq('revshare', mes);
    meses.push({
      mes, label: MESES[mes - 1], kF, kE, a: kF, b: kE, dk: pct(kF, kE),
      cvE: cv, cfE: cf, rsE: rs, totE: cv != null || cf != null ? (cv ?? 0) + (cf ?? 0) : null,
      eneF: kF ? f.energia / kF : null, fijF: kF ? f.fijo / kF : null, totF: kF ? f.neto / kF : null, facturas: f?.facturas || 0,
      comparable: kF != null && kE != null,
    });
  }
  const c = meses.filter((m) => m.comparable);
  const sum = (arr, k) => arr.reduce((a, m) => a + (m[k] ?? 0), 0);
  const kFc = sum(c, 'kF'), kEc = sum(c, 'kE');
  const cc = c.filter((m) => m.totE != null && m.totF != null);
  const totF = cc.length ? cc.reduce((a, m) => a + m.totF * m.kF, 0) / sum(cc, 'kF') : null;
  const totE = cc.length ? cc.reduce((a, m) => a + m.totE * m.kE, 0) / sum(cc, 'kE') : null;
  return { meses, comparables: c.length, kFc, kEc, dk: pct(kFc, kEc), totF, totE, dt: pct(totF, totE), pyc: E[seg]?.pyc?.[0] ?? null, kEanio: sum(meses, 'kE') };
}

function statsComp(r, conTitulo) {
  return [
    `<div><span class="k">Consumo · ${r.comparables} ${r.comparables === 1 ? 'mes comparable' : 'meses comparables'}</span><span class="v">${fN(r.kFc / 1000)} MWh</span><span class="s">equipo: ${fN(r.kEc / 1000)} MWh</span></div>`,
    `<div><span class="k">Desviación de consumo</span><span class="v">${desv(r.dk)}</span><span class="s">facturas vs. equipo</span></div>`,
    `<div><span class="k">Coste €/kWh (sin RevShare)</span><span class="v">${r.totF == null ? '—' : fN(r.totF, 3)}</span><span class="s">equipo CV+CF: ${r.totE == null ? '—' : fN(r.totE, 3)}</span></div>`,
    `<div><span class="k">Desviación de coste</span><span class="v">${desv(r.dt)}</span><span class="s">${conTitulo ? 'mismos meses' : 'ponderada por consumo'}</span></div>`,
  ].join('');
}

let COMP_FRESCO = null;   // año del último COMP traído del servidor en esta sesión
async function datosComp() {
  const anio = ST.anio ?? new Date().getFullYear();
  if (!COMP || COMP.anio !== anio || COMP_FRESCO !== anio) {
    const nuevo = await SB.rpc('comparativa', { p_anio: anio });
    COMP_CAMBIO = !COMP || JSON.stringify(COMP) !== JSON.stringify(nuevo);
    COMP = nuevo; COMP_FRESCO = anio; LS.set('comp.' + anio, nuevo);
  } else COMP_CAMBIO = false;
  return COMP;
}

async function cargarCompMini() {
  const card = $('#cardComp');
  const d = await seguro(datosComp);
  if (!d || !d.carga) { card.classList.add('hide'); return; }
  const r = calcComp(d, 'BT');
  if (!r.comparables) { card.classList.add('hide'); return; }
  card.classList.remove('hide');
  $('#compStats').innerHTML = statsComp(r, true);
}

async function cargarComparativa() {
  $('#compKpis').innerHTML = Array.from({ length: 4 }, () => `<div>${sk('60%')}<span class="v">${sk('90px', '22px')}</span>${sk('70%')}</div>`).join('');
  $('#chComp').innerHTML = `<div class="sk-cols">${ALTOS.map((h) => `<span class="sk" style="height:${h}%"></span>`).join('')}</div>`;
  skTabla($('#tbComp'), 12, 6);
  const d = await seguro(datosComp);
  if (!d) return;
  const anio = d.anio;
  $('#anaUsando').textContent = d.carga ? `Analítico: ${d.carga.archivo || 'sin nombre'}` : '';
  if (!d.carga) {
    $('#compCuerpo').classList.add('hide'); $('#compVacio').classList.remove('hide');
    $('#compVacio').innerHTML = `No hay analítico del equipo para <b>${anio}</b>.<br>Súbelo en «Cargar datos».` +
      (d.anios_equipo.length ? `<br><span class="sm">Hay analítico de: ${d.anios_equipo.join(', ')}. Cambia el año arriba.</span>` : '');
    $('#tbComp').innerHTML = ''; $('#compSeg').textContent = '';
    return;
  }
  $('#compCuerpo').classList.remove('hide'); $('#compVacio').classList.add('hide');
  const r = calcComp(d, ST.seg);
  $('#compKpis').innerHTML = statsComp(r);
  groupedChart($('#chComp'), r.meses, {
    tipFn: (m) => tipRows(`${m.label} ${anio}`, [['Facturas', m.kF == null ? 'sin facturas' : fN(m.kF) + ' kWh'], ['Equipo', m.kE == null ? '—' : fN(Math.round(m.kE)) + ' kWh'], ['Desviación', fPct(m.dk)]]),
  });
  const segTxt = 'Baja tensión (BT)';
  $('#compSeg').textContent = `${segTxt} · ${anio} · por mes de consumo${r.pyc != null ? ` · PYC del equipo: ${fN(r.pyc, 4)} €/kWh` : ''}`;
  const f3 = (v) => (v == null ? '—' : fN(v, 3));
  const fila = (m) => `<tr${m.comparable ? '' : ' class="muted"'}>
    <td>${m.label}</td>
    <td class="num sep">${m.kF == null ? '—' : fN(m.kF)}</td><td class="num">${m.kE == null ? '—' : fN(Math.round(m.kE))}</td><td class="num">${m.comparable ? desv(m.dk) : '—'}</td>
    <td class="num sep">${f3(m.eneF)}</td><td class="num">${f3(m.cvE)}</td>
    <td class="num sep">${f3(m.fijF)}</td><td class="num">${f3(m.cfE)}</td>
    <td class="num sep">${f3(m.totF)}</td><td class="num">${f3(m.totE)}</td><td class="num">${m.totF != null && m.totE != null ? desv(pct(m.totF, m.totE)) : '—'}</td>
    <td class="num sep">${f3(m.rsE)}</td></tr>`;
  $('#tbComp').classList.remove('loading');
  $('#tbComp').innerHTML = `<thead>
    <tr><th></th><th colspan="3" class="grp sep">Consumo (kWh)</th><th colspan="2" class="grp sep">Variable €/kWh</th><th colspan="2" class="grp sep">Fijo €/kWh</th><th colspan="3" class="grp sep">Total €/kWh</th><th class="grp sep">€/kWh</th></tr>
    <tr><th>Mes</th><th class="num sep">Facturas</th><th class="num">Equipo</th><th class="num">Desv.</th>
    <th class="num sep">Energía fact.</th><th class="num">CV equipo</th><th class="num sep">Pot.+alq. fact.</th><th class="num">CF equipo</th>
    <th class="num sep">Facturas</th><th class="num">CV+CF eq.</th><th class="num">Desv.</th><th class="num sep">RevShare eq.</th></tr></thead><tbody>` +
    r.meses.map(fila).join('') +
    `<tr class="tot"><td>Meses comparables</td><td class="num sep">${fN(r.kFc)}</td><td class="num">${fN(Math.round(r.kEc))}</td><td class="num">${desv(r.dk)}</td>
     <td class="sep" colspan="4"></td><td class="num sep">${f3(r.totF)}</td><td class="num">${f3(r.totE)}</td><td class="num">${desv(r.dt)}</td><td class="sep"></td></tr></tbody>`;
}

function pintarAnaEstado(d) {
  const c = d.carga;
  $('#anaEstado').innerHTML = c
    ? `Usando para <b>${d.anio}</b>: <b>${esc(c.archivo || 'sin nombre')}</b><br><span class="sm">subido el ${fFechaHora(c.fecha)}${c.usuario_email ? ' por ' + esc(c.usuario_email) : ''}</span>`
    : `Aún no hay analítico del equipo para <b>${d.anio}</b>.`;
}
async function cargarHistorialAna() {
  const h = await seguro(() => SB.select('analitico_cargas', { select: '*', order: 'fecha.desc', limit: 20 }));
  if (!h) return;
  $('#tbAna').innerHTML = h.length ? `<thead><tr><th>Año</th><th>Archivo</th><th>Subido</th>${ST.admin ? '<th></th>' : ''}</tr></thead><tbody>` +
    h.map((c) => `<tr><td>${c.anio}</td><td class="files" title="${esc(c.archivo)}">${esc(c.archivo)}</td><td class="muted sm">${fFechaHora(c.fecha)}</td>${ST.admin ? `<td><button class="btn mini danger aDel" data-id="${c.id}">Borrar</button></td>` : ''}</tr>`).join('') + '</tbody>' : '';
  $$('.aDel').forEach((b) => b.onclick = async () => {
    if (b.dataset.ok !== '1') { b.dataset.ok = '1'; b.textContent = '¿Seguro?'; setTimeout(() => { b.dataset.ok = ''; b.textContent = 'Borrar'; }, 3000); return; }
    await seguro(() => SB.rest('DELETE', 'analitico_cargas', { query: { id: 'eq.' + b.dataset.id }, prefer: 'return=minimal' }));
    COMP = null; COMP_FRESCO = null; cargarHistorialAna(); seguro(datosComp).then((d) => d && pintarAnaEstado(d)); toast('Analítico borrado');
  });
}
/** Guarda un Excel del analítico del equipo (desde la carga única). */
async function guardarAnalitico(nombre, datos, log) {
  const r = leerAnalitico(datos);
  const [c] = await SB.insert('analitico_cargas', [{ anio: r.anio, archivo: nombre.split('/').pop() }], { query: { select: 'id' } });
  await SB.insert('analitico_valores', r.valores.map((v) => ({ carga_id: c.id, ...v })), { prefer: 'return=minimal' });
  COMP = null; COMP_FRESCO = null;
  log(`✔ ${nombre}: analítico del equipo ${r.anio} guardado (${r.valores.length} valores)${r.avisos.length ? ' · ' + r.avisos.join(' ') : ''}`);
}

// ---------------------------------------------------------------- CORRECCIONES
const CAMPOS = { estado: 'Estado de la factura', id_factura: 'ID factura', cups: 'CUPS', tipo_lectura: 'Tipo de lectura',
  distribuidora: 'Distribuidora', tarifa: 'Tarifa', sheet_code: 'Pestaña', archivo_origen: 'Archivo de origen' };
const ACCIONES = { negativo: 'Poner en negativo', excluir: 'Excluir de los cálculos' };
async function cargarCorrecciones() {
  skTabla($('#tbReglas'), 9, 2);
  if (!$('#lsSust .opcion')) $('#lsSust').innerHTML = Array.from({ length: 3 }, () => `<div class="opcion">${sk('34px', '20px')}<div>${sk('160px')}<br>${sk('80%')}</div><div class="cifra">${sk('80px')}</div></div>`).join('');
  cargarSustituidas();   // en paralelo con las reglas manuales
  const reglas = await seguro(() => SB.rpc('correcciones_resumen'));
  if (!reglas) return;
  const adm = ST.admin;
  $('#cardNuevaRegla').classList.toggle('hide', !adm);
  $('#reglasRO').textContent = adm ? '' : 'Solo un administrador puede añadir o cambiar correcciones.';
  $('#tbReglas').classList.remove('loading');
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
const OPC = { anio_minimo: ['Mostrar desde el año', null], refacturaciones: ['Refacturaciones', 'refacturaciones'], copias_agrupadas: ['Copias en varias agrupadas', 'copias'], consumos_anomalos: ['Consumos anómalos', 'anomalos'] };
async function cargarSustituidas() {
  const r = await seguro(() => SB.rpc('sustituidas_resumen'));
  if (!r) return;
  const orden = Object.keys(OPC);
  const opciones = [...(r.opciones || [])].sort((a, b) => orden.indexOf(a.clave) - orden.indexOf(b.clave));
  $('#lsSust').innerHTML = opciones.map((o) => {
    const [titulo, k] = OPC[o.clave] || [o.clave, null]; const c = (k && r[k]) || { facturas: 0, kwh: 0 };
    if (o.clave === 'anio_minimo') return `<div class="opcion">
      <label class="sw"><input type="checkbox" class="oAct" data-k="anio_minimo" ${o.activa ? 'checked' : ''} ${ST.admin ? '' : 'disabled'}><span></span></label>
      <div><b>${esc(titulo)} <input type="number" class="oAnio" min="2000" max="2100" value="${esc(o.valor || '')}" ${ST.admin ? '' : 'disabled'}></b><span class="muted">${esc(o.descripcion || '')}</span></div>
      <div class="cifra muted">${o.activa ? 'activo' : 'se muestran todos los años'}</div></div>`;
    return `<div class="opcion">
      <label class="sw"><input type="checkbox" class="oAct" data-k="${esc(o.clave)}" ${o.activa ? 'checked' : ''} ${ST.admin ? '' : 'disabled'}><span></span></label>
      <div><b>${esc(titulo)}</b><span class="muted">${esc(o.descripcion || '')}</span></div>
      <div class="cifra"><b>${fN(c.facturas)}</b> facturas<br><span class="muted">${fN(c.kwh)} kWh ${o.clave === 'consumos_anomalos' ? 'ignorados' : 'no contados'}</span></div></div>`;
  }).join('') + `<p class="note">Para revisarlas: en <a href="#facturas">Facturas</a>, filtra por «Sustituidas (no cuentan)»; al pasar el ratón por la etiqueta se ve qué factura la sustituye.</p>`;
  $$('.oAnio').forEach((inp) => inp.onchange = async () => {
    if (!/^\d{4}$/.test(inp.value)) return;
    inp.disabled = true;
    await seguro(() => SB.update('opciones', { clave: 'eq.anio_minimo' }, { valor: inp.value }));
    datosCambiados(); await refrescarAnios(); await cargarSustituidas(); toast(`Ahora se muestra desde ${inp.value}`);
  });
  $$('.oAct').forEach((c) => c.onchange = async () => {
    c.disabled = true;
    await seguro(() => SB.update('opciones', { clave: 'eq.' + c.dataset.k }, { activa: c.checked }));
    datosCambiados(); await refrescarAnios(); await cargarSustituidas(); toast(c.checked ? 'Regla activada y aplicada' : 'Regla desactivada');
  });
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
function datosCambiados() { PUNTOS.clave = null; DASH = null; COMP_FRESCO = null; EVP = { clave: null, filas: [] }; CRUCE = null; CRUCE_T = null; SINC = { clave: null, filas: [] }; }

// ---------------------------------------------------------------- CARGAR
const OK = /\.(xlsx|xlsm|xls|csv|zip)$/i;
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
  skTabla($('#tbCargas'), 7, 4);
  for (const id of ['#dFilas', '#dFact', '#dUlt']) if ($(id).textContent === '—') $(id).innerHTML = sk('70px');
  const [res, h] = await Promise.all([
    seguro(() => SB.rpc('resumen')),
    seguro(() => SB.select('cargas', { select: '*', order: 'fecha.desc', limit: 100 })),
  ]);
  if (!res || !h) return;
  ST.admin = !!res.admin;
  $('#dFilas').textContent = fN(res.filas); $('#dFact').textContent = fN(res.facturas); $('#dUlt').textContent = fFechaHora(res.ultima_carga);
  $('#btnVaciar').classList.toggle('hide', !ST.admin);
  $('#dAdmin').textContent = ST.admin ? 'Eres administrador: puedes vaciar los datos.' : '';
  $('#tbCargas').classList.remove('loading');
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

/** Procesa y guarda fichero a fichero (no acumula todo en memoria: admite cargas grandes).
 *  Cada fichero se reconoce solo: facturas de Endesa, sesiones de evOS o analítico del equipo. */
async function procesar() {
  const b = $('#btnProcesar'); b.disabled = true; b.textContent = 'Procesando…';
  const lineas = []; const log = (l) => { lineas.push(l); $('#resLog').textContent = lineas.join('\n'); $('#resLog').scrollTop = 1e9; };
  $('#resCarga').classList.remove('hide'); $('#resKpis').innerHTML = ''; $('#resLog').textContent = '';
  const tot = { leidas: 0, dup: 0, nuevas: 0, guardadas: 0 };
  const cuenta = { facturas: 0, evos: 0, analitico: 0, error: 0, otros: 0 };
  const pintarKpis = () => { $('#resKpis').innerHTML = (cuenta.facturas ? [['Filas de facturas leídas', tot.leidas], ['Duplicadas en la carga', tot.dup], ['Ya existentes', tot.guardadas - tot.nuevas], ['Facturas: filas nuevas', tot.nuevas]] : [])
    .concat([['Ficheros de evOS', cuenta.evos], ['Analíticos', cuenta.analitico]].filter(([, v]) => v))
    .map(([k, v]) => `<div><b>${fN(v)}</b><span>${k}</span></div>`).join(''); };
  const cola = [...COLA];
  let carga = null; const nombresFact = [];
  try {
    const vistosF = new Map(); const vistas = new Set();
    for (const [k, item] of cola.entries()) {
      const fichs = await recolectar([item], log);          // un fichero de la cola (o el contenido de un ZIP)
      for (const [j, e] of fichs.entries()) {
        const etiqueta = `Fichero ${k + 1} de ${cola.length}${fichs.length > 1 ? ` (${j + 1}/${fichs.length} del ZIP)` : ''}: ${e.nombre.split('/').pop()}`;
        const base = (k + j / fichs.length) / cola.length * 100, ancho = 100 / cola.length / fichs.length;
        progreso(base, `${etiqueta} · leyendo…`);
        await new Promise((r) => setTimeout(r, 20));
        const h = await shaBuf(e.datos);
        if (vistosF.has(h)) { log(`↷ ${e.nombre}: idéntico a ${vistosF.get(h)}, se omite`); continue; }
        vistosF.set(h, e.nombre);
        const tipo = tipoFichero(e.nombre, e.datos);
        if (tipo === 'cruce') { cuenta.otros++; log(`⚠ ${e.nombre}: es un inventario de puntos de recarga (nº de serie → CUPS); el maestro de puntos no se actualiza desde aquí, se omite`); continue; }
        if (!tipo) { cuenta.otros++; log(`⚠ ${e.nombre}: no es un fichero reconocido (facturas de Endesa, evOS o analítico del equipo), se omite`); continue; }
        if (tipo !== 'facturas') {
          // evOS y analítico: un error en uno no detiene el resto de la carga
          try {
            if (tipo === 'evos') await guardarEvos(e, log, (f, t) => progreso(base + f * ancho, `${etiqueta} · ${t}`));
            else await guardarAnalitico(e.nombre, e.datos, log);
            cuenta[tipo]++;
          } catch (err) {
            if (err.message === 'sin_sesion') throw err;
            cuenta.error++; log(`✖ ${e.nombre}: ${err.message}`);
          }
          e.datos = null; pintarKpis(); continue;
        }
        // facturas de Endesa
        cuenta.facturas++; nombresFact.push(item.n);
        if (!carga) [carga] = await SB.insert('cargas', [{ archivos: [item.n] }], { query: { select: 'id' } });
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
          progreso(base + ((i + trozo.length) / filas.length) * ancho, `${etiqueta} · ${fN(i + trozo.length)} / ${fN(filas.length)} filas revisadas · ${fN(tot.nuevas)} nuevas`);
        }
        pintarKpis();
        await SB.update('cargas', { id: 'eq.' + carga.id }, { archivos: [...new Set(nombresFact)], leidas: tot.leidas, duplicadas_en_carga: tot.dup, ya_existentes: tot.guardadas - tot.nuevas, nuevas: tot.nuevas });
      }
    }
    if (cuenta.facturas) {
      progreso(99, 'Revisando refacturaciones y copias…');
      const rs = await SB.rpc('recalcular_sustituidas');
      if (rs?.sustituidas) log(`⇄ ${fN(rs.sustituidas)} filas marcadas como sustituidas (refacturaciones o copias): no se cuentan dos veces`);
      if (tot.guardadas - tot.nuevas) log(`↷ ${fN(tot.guardadas - tot.nuevas)} filas ya estaban guardadas de cargas anteriores, se omiten`);
      log(`＋ ${fN(tot.nuevas)} filas nuevas de facturas guardadas`);
    }
    if (cuenta.evos) {
      progreso(99, 'Emparejando los puntos de evOS con sus CUPS…');
      const rc = await SB.rpc('refrescar_cruce');
      if (rc?.puntos) log(`⇄ Puntos de evOS con CUPS según el cruce: ${fN(rc.exacto + rc.recuperado)} (${fN(rc.recuperado)} recuperados de nº de serie estropeados)`);
    }
    const res = [cuenta.facturas && `${cuenta.facturas} de facturas`, cuenta.evos && `${cuenta.evos} de evOS`, cuenta.analitico && `${cuenta.analitico} analítico(s)`].filter(Boolean).join(' · ');
    log(`— Resumen: ${res || 'ningún fichero guardado'}${cuenta.error ? ` · ${cuenta.error} con error (ver arriba)` : ''}${cuenta.otros ? ` · ${cuenta.otros} no reconocido(s)` : ''}`);
    progreso(100, cuenta.error ? 'Carga terminada con avisos: revisa los ficheros marcados con ✖.' : 'Carga completada'); pintarKpis();
    COLA = []; pintarCola();
  } catch (err) {
    if (err.message === 'sin_sesion') { mostrarLogin(); return; }
    log('✖ Error: ' + err.message);
    progreso(100, 'Error: la carga no se completó. Lo ya guardado se queda; puedes volver a subir los mismos ficheros sin que se duplique nada.');
    pintarKpis();
  } finally {
    b.textContent = 'Procesar y guardar'; b.disabled = !COLA.length;
    datosCambiados(); await refrescarAnios(); cargarDatosCargar();
  }
}

// ---------------------------------------------------------------- evOS
/** Guarda un fichero de evOS: agregados por mes y punto, y por día. Sustituye los días ya cargados. */
async function guardarEvos(fich, log, prog) {
  const r = await leerEvos(fich.nombre.split('/').pop(), fich.datos, log);
  if (!r.sesiones) throw new Error('sin sesiones válidas');
  const prep = await SB.rpc('evos_preparar', { p_dias: r.dias });
  if (!prep.ok) {
    const p = prep.parciales.map((x) => `${x.archivo} (${fFecha(x.desde)}–${fFecha(x.hasta)})`).join(', ');
    throw new Error(`sus días se solapan solo en parte con ${p}. Borra antes ese fichero (abajo, en «Ficheros de evOS cargados») o sube uno que cubra los mismos días.`);
  }
  if (prep.sustituidos) log(`⇄ ${r.nombre}: sustituye a ${prep.sustituidos} carga(s) anterior(es) de esos días`);
  const [lote] = await SB.insert('evos_lotes', [{ archivo: r.nombre, desde: r.dias[0], hasta: r.dias.at(-1), dias: r.dias,
    sesiones: r.sesiones, kwh: Math.round(r.kwh * 10000) / 10000, importe: Math.round(r.importe * 10000) / 10000 }], { query: { select: 'id' } });
  try {
    const N = 500, tot = r.agg.length + r.porDia.length; let ok = 0;
    for (const [tabla, filas] of [['evos_agg', r.agg], ['evos_dia', r.porDia]]) {
      for (let i = 0; i < filas.length; i += N) {
        await SB.insert(tabla, filas.slice(i, i + N).map((f) => ({ ...f, lote_id: lote.id })), { prefer: 'return=minimal' });
        ok += Math.min(N, filas.length - i);
        prog?.(ok / tot, `guardando evOS ${fN(ok)} / ${fN(tot)}`);
      }
    }
  } catch (e) { await SB.rest('DELETE', 'evos_lotes', { query: { id: 'eq.' + lote.id } }).catch(() => {}); throw e; }
}

// --- Inicio: visión general (facturado frente a evOS) y pestaña evOS
let EVOS = null;
const skCols = () => `<div class="sk-cols">${ALTOS.map((h) => `<span class="sk" style="height:${h}%"></span>`).join('')}</div>`;
function skEvos(tab) {
  if (tab === 'general') {
    $('#gFact').innerHTML = sk('140px', '44px');
    for (const id of ['#gEur', '#gBtMt', '#gSinCups']) $(id).innerHTML = sk('100px', '26px');
    for (const id of ['#gMeses', '#gEurSub', '#gBtMtSub', '#gSinCupsSub']) $(id).innerHTML = sk('80%');
    $('#gDifPct').innerHTML = '';
    $('#chGen').innerHTML = skCols();
    $('#chGenPct').innerHTML = `<div class="sk-line"><span class="sk"></span><span class="sk onda"></span><span class="sk"></span><span class="sk"></span></div>`;
    $('#lsAvisos').innerHTML = Array.from({ length: 4 }, () => `<li>${sk('85%')}</li>`).join('');
  } else {
    $('#eKwh').innerHTML = sk('140px', '44px'); $('#eHeroSub').innerHTML = sk('70%');
    for (const id of ['#eSes', '#eHoras', '#eDC', '#ePuntos']) $(id).innerHTML = sk('100px', '26px');
    for (const id of ['#eSesSub', '#eHorasSub', '#eDCSub', '#ePuntosSub']) $(id).innerHTML = sk('80%');
    $('#chEvMes').innerHTML = skCols();
    $('#chEvDia').innerHTML = `<div class="sk-line"><span class="sk"></span><span class="sk onda"></span><span class="sk"></span><span class="sk"></span></div>`;
    const filas = (n) => Array.from({ length: n }, (_, i) => `<div class="hb"><span class="n">${sk('70%')}</span><span class="t">${sk([95, 60, 40, 30, 20, 10][i % 6] + '%', '14px')}</span><span class="v">${sk('90px')}</span></div>`).join('');
    $('#lsEvReg').innerHTML = filas(6); $('#lsEvCpo').innerHTML = filas(4);
    skTabla($('#tbEvTop'), 6, 5);
  }
}
let CRUCE = null;
async function datosCruce() {
  const anio = ST.anio ?? new Date().getFullYear();
  if (!CRUCE || CRUCE.anio !== anio) { CRUCE = await SB.rpc('cruce_resumen', { p_anio: anio }); LS.set('cruce.' + anio, CRUCE); }
  return CRUCE;
}
async function cargarEvosInicio() {
  const anio = ST.anio ?? new Date().getFullYear(), tab = ST.itab;
  const clave = 'evos.' + anio, g = LS.get(clave);
  if (!CRUCE || CRUCE.anio !== anio) { const gc = LS.get('cruce.' + anio); if (gc) CRUCE = gc; }
  if (g && g.diario) pintarEvosInicio(g); else skEvos(tab);
  const fresco = CRUCE; CRUCE = null;
  const [d] = await Promise.all([seguro(() => SB.rpc('evos_dashboard', { p_anio: anio })), tab === 'general' ? seguro(datosCruce) : null]);
  if (!CRUCE) CRUCE = fresco;
  if (!d) return;
  LS.set(clave, d);
  if ((ST.anio ?? new Date().getFullYear()) === anio) pintarEvosInicio(d);
}
function pintarEvosInicio(d) {
  EVOS = d;
  if (ST.vista !== 'inicio') return;
  if (ST.itab === 'general') pintarGeneral(d); else if (ST.itab === 'evos') pintarEvosTab(d);
}
/** Mes comparable: evOS cubre todos sus días y hay facturas repartidas en él. */
const conCruce = (d) => CRUCE && CRUCE.cruce && CRUCE.anio === d.anio;
function mesesGenerales(d) {
  const c = conCruce(d) ? CRUCE : null;
  const n = (v) => (v == null ? null : +v);
  const meses = d.mensual.map((m, i) => {
    const x = c ? c.mensual[i] : null;
    // total contra total: todo lo facturado frente a lo entregado en los puntos Public Infra (todo evOS si aún no hay maestro)
    const F = n(m.pro_kwh), E = c ? n(x.e_pi) : n(m.kwh);
    // celeste: todo evOS con Type = PUBLIC (solo si los ficheros de ese mes ya traen el Type guardado)
    const P = c && +x.e_public ? +x.e_public : null;
    return { ...m, x, label: MESES[m.mes - 1], F, E, P, a: F, b: E, c: P, completo: m.dias >= m.dias_mes, cN: n(m.pro_neto) };
  });
  // referencia de la comparación: evOS Public (celeste); si aún no hay Type guardado, nuestros puntos Public Infra
  const usaP = meses.some((m) => m.P != null);
  for (const m of meses) {
    m.R = usaP ? m.P : m.E; m.refPublic = usaP;
    m.comparable = m.completo && m.F > 0 && m.R > 0;
    m.dif = m.comparable ? (m.F - m.R) / m.F * 100 : null;
  }
  return meses;
}
/** Qué parte de cada lado entra en la comparación (meses comparables). */
function pintarCobertura(d, meses) {
  const c = conCruce(d) ? CRUCE : null;
  if (!c) {
    $('#cobCruce').textContent = '';
    $('#lsCob').innerHTML = '<p class="muted">Falta el maestro de puntos de recarga: mientras tanto se compara todo evOS con todas las facturas.</p>';
    $('#tbCupsTop').innerHTML = '<tbody><tr><td class="muted">Falta el maestro de puntos de recarga con su CUPS.</td></tr></tbody>';
    return;
  }
  $('#cobCruce').textContent = `${fN(c.n.pi)} puntos Public Infra con sesiones en evOS`;
  const comp = meses.filter((m) => m.comparable);
  const S = (k) => comp.reduce((a, m) => a + (+m.x[k] || 0), 0);
  const Et = S('e_tot'), Ep = S('e_pi'), Es = S('e_pi_sin'), Er = S('e_rec');
  const Ft = comp.reduce((a, m) => a + (+m.F || 0), 0), Fm = comp.reduce((a, m) => a + (+m.pro_kwh_mt || 0), 0);
  const fila = (t, v, tot, cls = '', sub = '') => `<div class="cob ${cls}"><span class="n">${t}${sub ? `<small>${sub}</small>` : ''}</span><span class="t"><span class="f" style="width:${tot ? Math.max(0, Math.min(100, v / tot * 100)) : 0}%"></span></span><span class="v">${fN(tot ? v / tot * 100 : 0, 0)} %<small>${fN(v / 1000, 0)} MWh</small></span></div>`;
  $('#lsCob').innerHTML = !comp.length ? '<p class="muted">Aún no hay meses comparables.</p>' :
    `<h4 class="mini-h">Energía entregada (evOS)</h4>` +
    fila('Public Infra con CUPS', Ep - Es, Et, '', Er ? `incluye ${fN(Er / 1000, 0)} MWh por nº de serie recuperado` : '') +
    fila('Public Infra sin CUPS', Es, Et, '', 'cuenta en el total aunque no se pueda emparejar con su factura') +
    fila('Fuera del maestro', Et - Ep, Et, 'fuera', 'no es Public Infra o su nº de serie llega incompleto') +
    `<h4 class="mini-h">Energía facturada</h4>` +
    fila('Baja tensión (BT)', Ft - Fm, Ft) +
    fila('Media tensión (MT)', Fm, Ft, '', Fm ? '' : 'aún no hay facturas de MT');
  // CUPS con más diferencia
  const top = c.cups.map((x) => ({ ...x, dif: (+x.f_kwh || 0) - (+x.e_kwh || 0) })).sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif)).slice(0, 10);
  $('#tbCupsTop').innerHTML = `<thead><tr><th>CUPS · dirección</th><th class="num">Puntos</th><th class="num">Facturado</th><th class="num">Entregado</th><th class="num">Diferencia</th></tr></thead><tbody>` +
    top.map((x) => `<tr class="clic" data-cups="${esc(x.cups20)}"><td class="wrap"><span class="cups">${esc(x.cups || x.cups20)}</span><br>${esc(x.direccion || '')}</td><td class="num">${fN(x.puntos)}</td><td class="num">${fN(x.f_kwh)}</td><td class="num">${fN(x.e_kwh)}</td>
      <td class="num">${desv(x.f_kwh ? x.dif / x.f_kwh * 100 : null, 25)}<br><span class="muted sm">${fN(x.dif)} kWh</span></td></tr>`).join('') + '</tbody>';
  $$('#tbCupsTop tr.clic').forEach((tr) => tr.onclick = () => abrirDetalle(tr.dataset.cups, null));
}
function pintarGeneral(d) {
  const meses = mesesGenerales(d), comp = meses.filter((m) => m.comparable);
  const hayE = +d.kpi.sesiones > 0, hayF = meses.some((m) => m.F);
  $('#genVacio').classList.toggle('hide', hayE && hayF); $('#genPanel').classList.toggle('hide', !(hayE && hayF));
  if (!(hayE && hayF)) {
    $('#genVacioTxt').textContent = !hayE && !hayF ? `No hay facturas ni datos de evOS de ${d.anio}.` : !hayE ? `No hay datos de evOS de ${d.anio}: súbelos en «Cargar datos».` : `No hay facturas de ${d.anio}.`;
    return;
  }
  const sum = (k) => comp.reduce((a, m) => a + (+m[k] || 0), 0);
  const sx = (k) => comp.reduce((a, m) => a + (+m.x?.[k] || 0), 0);
  const F = sum('F'), Rf = sum('R'), N = sum('cN');
  const refTxt = meses[0]?.refPublic ? 'evOS Public' : 'nuestros puntos en evOS';
  const c = conCruce(d) ? CRUCE : null;
  if (comp.length) {
    const dev = (F - Rf) / F * 100;
    $('#gFact').textContent = fN(F / 1000, 1);
    $('#gDifPct').innerHTML = `<b>${dev > 0 ? '+' : ''}${fN(dev, 1)} %</b> frente a ${refTxt} (${fN(Rf / 1000, 1)} MWh)`;
    $('#gMeses').textContent = `${comp.length} ${comp.length === 1 ? 'mes comparable' : 'meses comparables'}: ${comp.map((m) => m.label).join(', ')}`;
    $('#gEur').textContent = fN(N, 0) + ' €';
    $('#gEurSub').textContent = `sin IVA · ${fN(N / F, 3)} €/kWh facturado · ${fN(N / Rf, 3)} €/kWh entregado`;
    if (c) {
      const bt = sx('e_bt'), mt = sx('e_mt'), pi = sx('e_pi');
      $('#gBtMt').textContent = `${fN(bt / 1000, 0)} · ${fN(mt / 1000, 0)}`;
      $('#gBtMtSub').textContent = `MWh BT · MT en nuestros puntos · ${fN((pi - bt - mt) / 1000, 0)} MWh sin tensión (sin CUPS)`;
    } else { $('#gBtMt').textContent = '—'; $('#gBtMtSub').textContent = 'falta el maestro de puntos de recarga'; }
  } else {
    $('#gDifPct').innerHTML = '';
    $('#gMeses').textContent = 'Aún no hay ningún mes con evOS completo y facturas';
    for (const id of ['#gFact', '#gEur', '#gBtMt']) $(id).textContent = '—';
    for (const id of ['#gEurSub', '#gBtMtSub']) $(id).textContent = '';
  }
  if (c?.cruce) {
    const k = c.cruce;
    $('#gSinCups').textContent = fN(k.sin_cups);
    $('#gSinCupsSub').textContent = `de ${fN(k.puntos)} · con CUPS: ${fN(k.bt)} BT · ${fN(k.mt)} MT` + (+k.sin_tension ? ` · ${fN(k.sin_tension)} sin facturas` : '');
  } else { $('#gSinCups').textContent = '—'; $('#gSinCupsSub').textContent = 'falta el maestro de puntos de recarga'; }
  pintarCobertura(d, meses);
  const tip = (m) => tipRows(`${m.label} ${d.anio}`, [
    ['Facturado', m.F == null ? 'sin facturas' : fN(m.F) + ' kWh'],
    ['Nuestros puntos Public Infra', m.E == null ? 'sin datos' : fN(m.E) + ' kWh'],
    ...(m.P != null ? [['evOS Type Public', fN(m.P) + ' kWh']] : m.x && +m.x.e_sin_tipo ? [['evOS Type Public', 'vuelve a subir evOS de este mes']] : []),
    ['Días con evOS', `${m.dias} de ${m.dias_mes}`],
    [m.refPublic ? 'Diferencia con evOS Public' : 'Diferencia', m.comparable ? `${fN(m.F - m.R)} kWh · ${fN(m.dif, 1)} %` : m.F && m.R ? 'mes incompleto en evOS' : '—'],
  ]);
  const irMes = (m) => { if (conCruce(d) && (m.F || m.E)) irACruce(m.mes); };
  $('#lgPublic').classList.toggle('hide', !meses.some((m) => m.P != null));
  groupedChart($('#chGen'), meses, { tipFn: tip, onClick: conCruce(d) ? irMes : null });
  lineChart($('#chGenPct'), meses.map((m) => ({ ...m, value: m.dif })), { fmtAxis: (v) => fN(v, 0) + ' %', fmtEnd: (v) => fN(v, 1) + ' %', tipFn: tip, onClick: conCruce(d) ? irMes : null });
  // avisos
  const media = comp.length ? comp.reduce((a, m) => a + m.dif, 0) / comp.length : null;
  const av = [];
  const bajo = comp.filter((m) => m.dif < 0);
  if (bajo.length > 2) av.push(['alta', `En <b>${bajo.length} de ${comp.length}</b> meses comparables evOS entrega <b>más</b> energía de la facturada (de ${fN(-Math.max(...bajo.map((m) => m.dif)), 0)} % a ${fN(-Math.min(...bajo.map((m) => m.dif)), 0)} % más). Lo normal sería lo contrario: probablemente faltan facturas (por ejemplo, las de media tensión).`]);
  const sinTipo = meses.filter((m) => m.x && +m.x.e_sin_tipo);
  if (sinTipo.length) av.unshift(['', `Para ver la barra celeste (evOS Type Public) en <b>${sinTipo.map((m) => m.label).join(', ')}</b>, vuelve a subir sus ficheros de evOS en «Cargar datos»: se subieron antes de guardar el campo «Type» y sustituyen a los anteriores sin duplicar.`]);
  const sinMT = comp.filter((m) => !+m.pro_kwh_mt);
  if (sinMT.length) av.unshift(['', `${sinMT.length === comp.length ? 'El facturado aún' : `En <b>${sinMT.map((m) => m.label).join(', ')}</b> el facturado`} <b>no incluye facturas de media tensión</b>, pero evOS sí cuenta sus puntos: hasta cargarlas, lo entregado sale de más.`]);
  for (const m of meses) {
    const n = conCruce(d) && (m.F || m.E) ? `<a href="#tablas/cruce/${m.mes}"><b>${m.label}</b></a>` : `<b>${m.label}</b>`;
    if (bajo.length > 2 && m.dif < 0) { /* ya avisado arriba */ }
    else if (m.comparable && m.dif < 0) av.push(['alta', `${n}: se factura <b>menos</b> de lo entregado (${fN(m.dif, 1)} %). Puede faltar alguna factura.`]);
    else if (m.comparable && media != null && comp.length > 2 && m.dif > media + 10) av.push(['alta', `${n}: diferencia del ${fN(m.dif, 1)} %, muy por encima de la media del año (${fN(media, 1)} %).`]);
    if (m.E && !m.completo) av.push(['', `${n}: evOS solo cubre ${m.dias} de ${m.dias_mes} días; no se compara.`]);
    if (m.F && !m.E && meses.some((x) => x.E && x.mes > m.mes)) av.push(['', `${n}: hay facturas pero no datos de evOS.`]);
    if (m.E && !m.F) av.push(['', `${n}: hay sesiones en evOS pero aún no hay facturas de ese mes.`]);
  }
  $('#lsAvisos').innerHTML = av.length ? av.map(([c, t]) => `<li class="${c}">${t}</li>`).join('') : '<li class="ok">Nada que destacar: todos los meses comparables están en línea con la media.</li>';
}
function pintarEvosTab(d) {
  const k = d.kpi, hay = +k.sesiones > 0;
  $('#evVacio').classList.toggle('hide', hay); $('#evPanel').classList.toggle('hide', !hay);
  if (!hay) return;
  $('#eHeroLbl').textContent = `Energía entregada · ${d.anio}`;
  $('#eKwh').textContent = fN(k.kwh / 1000, 1);
  $('#eHeroSub').textContent = `Sesiones del ${fFecha(k.desde)} al ${fFecha(k.hasta)}`;
  $('#eSes').textContent = fN(k.sesiones); $('#eSesSub').textContent = `${fN(k.kwh / k.sesiones, 1)} kWh por sesión`;
  $('#eHoras').textContent = fN(k.horas); $('#eHorasSub').textContent = `${fN(k.horas * 60 / k.sesiones, 0)} min por sesión de media`;
  $('#eDC').textContent = fN(k.kwh ? k.kwh_dc / k.kwh * 100 : 0, 1) + ' %'; $('#eDCSub').textContent = `de la energía · ${fN(k.sesiones ? k.ses_dc / k.sesiones * 100 : 0, 1)} % de las sesiones`;
  $('#ePuntos').textContent = fN(k.puntos); $('#ePuntosSub').textContent = `${fN(k.kwh / k.puntos / 1000, 1)} MWh por punto`;
  const meses = d.mensual.map((m) => ({ ...m, label: MESES[m.mes - 1], a: m.kwh == null ? null : m.kwh - (m.kwh_dc || 0), b: m.kwh_dc == null ? null : +m.kwh_dc }));
  groupedChart($('#chEvMes'), meses, {
    tipFn: (m) => tipRows(`${m.label} ${d.anio}`, [['AC', m.a == null ? '—' : fN(m.a) + ' kWh'], ['DC (rápida)', m.b == null ? '—' : fN(m.b) + ' kWh'],
      ['Sesiones', m.sesiones == null ? '—' : fN(m.sesiones)], ['Días con datos', `${m.dias} de ${m.dias_mes}`]]),
  });
  const DS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const dias = d.diario.map((x) => ({ ...x, value: +x.kwh, label: '' }));
  const paso = Math.max(1, Math.ceil(dias.length / 12));
  dias.forEach((x, i) => { if (i % paso === 0) x.label = fFecha(x.dia).slice(0, 5); });
  lineChart($('#chEvDia'), dias, { desdeCero: true, puntos: dias.length <= 40, fmtEnd: (v) => fComp(v), tipFn: (x) => tipRows(`${DS[new Date(x.dia + 'T12:00').getDay()]} ${fFecha(x.dia)}`, [['Energía', fN(x.kwh) + ' kWh'], ['Sesiones', fN(x.sesiones)], ['DC', fN(x.kwh_dc || 0) + ' kWh']]) });
  hbars($('#lsEvReg'), d.regiones.slice(0, 10).map((r) => ({ ...r, label: r.region || 'Sin comunidad', value: +r.kwh })), {
    fmtV: (r) => `${fN(r.value / 1000, 1)} MWh`, tipFn: (r) => tipRows(r.label, [['Energía', fN(r.value) + ' kWh'], ['Sesiones', fN(r.sesiones)], ['Puntos', fN(r.puntos)]]),
  });
  hbars($('#lsEvCpo'), d.cpos.slice(0, 8).map((r) => ({ ...r, label: r.cpo || 'Sin CPO', value: +r.kwh })), {
    fmtV: (r) => `${fN(r.value / 1000, 1)} MWh`, tipFn: (r) => tipRows(r.label, [['Energía', fN(r.value) + ' kWh'], ['Sesiones', fN(r.sesiones)], ['Puntos', fN(r.puntos)]]),
  });
  $('#tbEvTop').classList.remove('loading');
  $('#tbEvTop').innerHTML = `<thead><tr><th>Punto</th><th>Tipo</th><th class="num">kWh</th><th class="num">Sesiones</th><th class="num">kWh/sesión</th></tr></thead><tbody>` +
    d.puntos.map((p) => `<tr><td class="wrap"><b>${esc(p.direccion || '—')}</b><br><span class="muted sm">${esc([p.cp, p.ciudad].filter(Boolean).join(' '))} · nº serie ${esc(p.serial || '—')}</span></td>
      <td>${esc(p.ac_dc || '')}${p.potencia ? ` · ${fN(p.potencia)} kW` : ''}</td><td class="num">${fN(p.kwh)}</td><td class="num">${fN(p.sesiones)}</td><td class="num">${fN(p.kwh / p.sesiones, 1)}</td></tr>`).join('') + '</tbody>';
}

// --- tabla evOS (mes × punto)
const E_COLS = [
  ['mes', 'Mes', 'm'], ['serial_ok', 'Nº serie'], ['direccion', 'Dirección', 'w'], ['cp', 'CP'], ['ciudad', 'Ciudad'], ['provincia', 'Provincia'],
  ['region', 'Comunidad'], ['ac_dc', 'AC/DC'], ['potencia', 'Potencia kW', 'n'], ['cpo', 'CPO'], ['empresa', 'Empresa'],
  ['sesiones', 'Sesiones', 'n'], ['kwh', 'kWh', 'n2'], ['segundos', 'Horas de carga', 'h'],
  ['primera', 'Primera sesión', 't'], ['ultima', 'Última sesión', 't'],
];
ST.e = { pag: 1, orden: 'kwh', dir: 'desc' };
const fHora = (ts) => (ts ? fFecha(ts) + ' ' + ts.slice(11, 16) : '');
function queryEvos() {
  const q = { anio: 'eq.' + (ST.anio ?? new Date().getFullYear()) };
  const t = $('#eQ').value.trim().replace(/[",()]/g, ' ');
  if (t) q.or = `(${['serial_ok', 'direccion', 'ciudad', 'cp', 'provincia', 'region'].map((c) => `${c}.ilike."*${t}*"`).join(',')})`;
  q.order = `${ST.e.orden}.${ST.e.dir}.nullslast,punto`;
  return q;
}
function celdaEv(f, k, n) {
  const v = f[k];
  if (n === 'm') return `<td>${MESES[f.mes - 1]} ${f.anio}</td>`;
  if (n === 'w') return `<td class="wrap">${esc(v)}</td>`;
  if (n === 'n') return `<td class="num">${v == null ? '' : fN(v)}</td>`;
  if (n === 'n2') return `<td class="num">${v == null ? '' : fN(v, 2)}</td>`;
  if (n === 'h') return `<td class="num">${fN(v / 3600, 1)}</td>`;
  if (n === 't') return `<td>${fHora(v)}</td>`;
  return `<td>${esc(v)}</td>`;
}
async function cargarEvAgg() {
  const tb = $('#tbEvAgg'); skTabla(tb, 12);
  const q = { ...queryEvos(), select: 'anio,' + E_COLS.map((c) => c[0]).join(','), limit: 50, offset: (ST.e.pag - 1) * 50 };
  const r = await seguro(() => SB.select('evos_agg_v', q, { count: true }));
  tb.classList.remove('loading');
  if (!r) return;
  tb.innerHTML = `<thead><tr>${E_COLS.map(([k, t, n]) => `<th data-c="${k}" class="${n && n !== 'w' && n !== 'm' && n !== 't' ? 'num' : ''}">${t}${ST.e.orden === k ? `<span class="ar">${ST.e.dir === 'desc' ? '↓' : '↑'}</span>` : ''}</th>`).join('')}</tr></thead><tbody>` +
    (r.datos.length ? r.datos.map((f) => `<tr>${E_COLS.map(([k, , n]) => celdaEv(f, k, n)).join('')}</tr>`).join('')
      : `<tr><td colspan="${E_COLS.length}" class="muted">No hay datos de evOS para ${ST.anio ?? ''}. Súbelos en «Cargar datos».</td></tr>`) + '</tbody>';
  tb.querySelectorAll('th').forEach((th) => th.onclick = () => {
    const c = th.dataset.c; ST.e.dir = ST.e.orden === c && ST.e.dir === 'desc' ? 'asc' : 'desc'; ST.e.orden = c; ST.e.pag = 1; cargarEvAgg();
  });
  $('#eTotal').textContent = `${fN(r.total)} filas`;
  const np = Math.max(1, Math.ceil(r.total / 50));
  $('#ePager').innerHTML = `<button class="btn" ${ST.e.pag <= 1 ? 'disabled' : ''} data-p="${ST.e.pag - 1}">‹ Anterior</button>
    <span>Página ${ST.e.pag} de ${np}</span>
    <button class="btn" ${ST.e.pag >= np ? 'disabled' : ''} data-p="${ST.e.pag + 1}">Siguiente ›</button>`;
  $$('#ePager button').forEach((b) => b.onclick = () => { ST.e.pag = +b.dataset.p; cargarEvAgg(); });
}
const tsASerial = (ts) => (ts ? isoASerial(ts.slice(0, 10)) + ((+ts.slice(11, 13) || 0) * 3600 + (+ts.slice(14, 16) || 0) * 60) / 86400 : null);
function hojaFechaHora(aoa, cols) {
  const ws = hoja(aoa, []);
  for (let r = 1; r < aoa.length; r++) for (const c of cols) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && cell.t === 'n') cell.z = 'dd/mm/yyyy hh:mm'; }
  return ws;
}
async function exportarEvAgg(e) {
  const bt = e.currentTarget, txt = bt.textContent; bt.disabled = true;
  try {
    const q = { ...queryEvos(), select: 'anio,' + E_COLS.map((c) => c[0]).join(',') };
    const filas = await SB.todo((limit, offset) => SB.select('evos_agg_v', { ...q, limit, offset }), (n) => { bt.textContent = `Descargando… ${fN(n)}`; });
    const aoa = [E_COLS.map((c) => c[1])].concat(filas.map((f) => E_COLS.map(([k, , n]) =>
      n === 'm' ? `${f.anio}-${pad(f.mes)}` : n === 't' ? tsASerial(f[k]) : n === 'h' ? Math.round(f[k] / 36) / 100 : (n ? (f[k] == null ? null : +f[k]) : f[k]))));
    descargar(hojaFechaHora(aoa, E_COLS.map((c, i) => (c[2] === 't' ? i : -1)).filter((i) => i >= 0)), 'evOS', `evos_${ST.anio ?? ''}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (err) { if (err.message === 'sin_sesion') mostrarLogin(); else toast('Error al exportar: ' + err.message, 6000); }
  finally { bt.textContent = txt; bt.disabled = false; }
}

// --- tabla cruce por CUPS
const X_COLS = [
  ['cups', 'CUPS'], ['direccion', 'Dirección', 'w'], ['puntos', 'Puntos evOS', 'n'], ['f_kwh', 'Facturado kWh', 'n'], ['e_kwh', 'Entregado kWh', 'n'],
  ['dif', 'Diferencia kWh', 'n'], ['pct', 'Diferencia %', 'p'], ['f_neto', 'Facturado € sin IVA', 'n2'], ['eur_e', '€/kWh entregado', 'n3'], ['e_ses', 'Sesiones', 'n'],
];
ST.x = { orden: 'dif', dir: 'desc' };
function filasCruce(c) {
  const q = $('#xQ').value.trim().toLowerCase();
  let r = c.cups.map((x) => {
    const f = +x.f_kwh || 0, e = +x.e_kwh || 0;
    return { ...x, cups: x.cups || x.cups20, f_kwh: f, e_kwh: e, dif: f - e, pct: f ? (f - e) / f * 100 : null, eur_e: e ? (+x.f_neto || 0) / e : null };
  });
  if (q) r = r.filter((x) => [x.cups, x.direccion].some((v) => String(v ?? '').toLowerCase().includes(q)));
  const k = ST.x.orden, s = ST.x.dir === 'asc' ? 1 : -1;
  r.sort((a, b) => (a[k] == null) - (b[k] == null) || (typeof a[k] === 'string' ? String(a[k]).localeCompare(b[k]) : a[k] - b[k]) * s);
  return r;
}
ST.xmes = null;
let CRUCE_T = null;
async function datosCruceT() {
  const anio = ST.anio ?? new Date().getFullYear(), mes = ST.xmes;
  if (mes == null) return datosCruce();
  if (!CRUCE_T || CRUCE_T.anio !== anio || CRUCE_T.mes !== mes) CRUCE_T = await SB.rpc('cruce_resumen', { p_anio: anio, p_mes: mes });
  return CRUCE_T;
}
function irACruce(mes) { ST.xmes = mes; location.hash = 'tablas/cruce'; }
function pintarSelMes(c) {
  const sel = $('#xMes'), comp = new Set(c?.comparables || []);
  sel.innerHTML = '<option value="">Meses comparables</option>' + MESES.map((m, i) => `<option value="${i + 1}">${m}${comp.has(i + 1) ? '' : ' (incompleto)'}</option>`).join('');
  sel.value = ST.xmes ?? '';
}
async function cargarCruceTabla() {
  const tb = $('#tbCruce'); skTabla(tb, 10);
  const c = await seguro(datosCruceT);
  pintarSelMes(CRUCE && CRUCE.anio === c?.anio ? CRUCE : c);
  tb.classList.remove('loading');
  if (!c) return;
  if (!c.cruce) { tb.innerHTML = '<tbody><tr><td class="muted">Falta el maestro de puntos de recarga con su CUPS.</td></tr></tbody>'; $('#xTotal').textContent = ''; return; }
  const filas = filasCruce(c);
  tb.innerHTML = `<thead><tr>${X_COLS.map(([k, t, n]) => `<th data-c="${k}" class="${n && n !== 'w' ? 'num' : ''}">${t}${ST.x.orden === k ? `<span class="ar">${ST.x.dir === 'desc' ? '↓' : '↑'}</span>` : ''}</th>`).join('')}</tr></thead><tbody>` +
    (filas.length ? filas.slice(0, 1000).map((f) => `<tr>${X_COLS.map(([k, , n]) => {
      const v = f[k];
      if (k === 'cups') return `<td class="cups">${esc(v)}</td>`;
      if (n === 'w') return `<td class="wrap">${esc(v)}</td>`;
      if (n === 'p') return `<td class="num">${desv(v, 25)}</td>`;
      if (n === 'n2') return `<td class="num">${fN(v, 2)}</td>`;
      if (n === 'n3') return `<td class="num">${v == null ? '—' : fN(v, 3)}</td>`;
      return `<td class="num">${fN(v)}</td>`;
    }).join('')}</tr>`).join('') : `<tr><td colspan="${X_COLS.length}" class="muted">Sin CUPS en el perímetro para ${c.anio}.</td></tr>`) + '</tbody>';
  tb.querySelectorAll('th').forEach((th) => th.onclick = () => {
    const k = th.dataset.c; ST.x.dir = ST.x.orden === k && ST.x.dir === 'desc' ? 'asc' : 'desc'; ST.x.orden = k; cargarCruceTabla();
  });
  tb.querySelectorAll('tbody tr').forEach((tr, i) => { if (filas[i]) { tr.classList.add('clic'); tr.onclick = () => abrirDetalle(filas[i].cups20, ST.xmes); } });
  const meses = c.comparables.map((m) => MESES[m - 1]).join(', ');
  $('#xTotal').textContent = ST.xmes ? `${fN(filas.length)} CUPS · ${MESES[ST.xmes - 1]} ${c.anio}${c.comparables.includes(ST.xmes) ? '' : ` · evOS solo cubre ${c.dias_mes ?? 0} días`}`
    : `${fN(filas.length)} CUPS · meses comparables: ${meses || 'ninguno'}`;
}
async function exportarCruce() {
  const c = await seguro(datosCruceT); if (!c?.cruce) return;
  const aoa = [X_COLS.map((x) => x[1])].concat(filasCruce(c).map((f) => X_COLS.map(([k, , n]) => (n && n !== 'w' ? (f[k] == null ? null : +f[k]) : f[k]))));
  descargar(hoja(aoa, []), 'Cruce por CUPS', `cruce_cups_${c.anio}${ST.xmes ? '_' + pad(ST.xmes) : ''}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// --- detalle de un CUPS (panel lateral)
async function abrirDetalle(cups20, mes) {
  const anio = ST.anio ?? new Date().getFullYear();
  const c = CRUCE && CRUCE.anio === anio ? CRUCE : null;
  // sin mes: el mes comparable con más diferencia para ese CUPS no se conoce aquí; se usa el último comparable
  const m = mes ?? (c?.comparables?.at(-1) ?? new Date().getMonth() + 1);
  const dw = $('#drawer'); dw.classList.remove('hide'); dw.setAttribute('aria-hidden', 'false');
  $('#dwTitulo').textContent = cups20; $('#dwSub').textContent = `${MESES[m - 1]} ${anio}`;
  $('#dwCuerpo').innerHTML = `<div class="comp-stats">${Array.from({ length: 3 }, () => `<div>${sk('60%')}<span class="v">${sk('90px', '22px')}</span></div>`).join('')}</div><table class="tbl" id="dwSk"></table>`;
  skTabla($('#dwSk'), 6, 4);
  abrirDetalle.actual = { cups20, mes: m };
  const d = await seguro(() => SB.rpc('cruce_detalle', { p_anio: anio, p_mes: m, p_cups20: cups20 }));
  if (!d || abrirDetalle.actual?.cups20 !== cups20 || abrirDetalle.actual?.mes !== m) return;
  const F = d.facturas.reduce((a, f) => a + (+f.kwh_mes || 0), 0), E = d.puntos.reduce((a, p) => a + (+p.kwh || 0), 0);
  $('#dwTitulo').textContent = d.direccion || cups20;
  $('#dwSub').innerHTML = `<span class="cups">${esc(cups20)}</span> · <select id="dwMes" aria-label="Mes">${MESES.map((x, i) => `<option value="${i + 1}" ${i + 1 === m ? 'selected' : ''}>${x} ${anio}</option>`).join('')}</select>`;
  $('#dwMes').onchange = (e) => abrirDetalle(cups20, +e.target.value);
  const estado = (f) => [f.estado ? `<span class="tag ${esc(f.estado)}">${ESTADOS[f.estado] || esc(f.estado)}</span>` : '',
    f.sustituida ? `<span class="tag sust" title="${esc(f.motivo_sust || '')}">Sustituida</span>` : '', f.excluida ? '<span class="tag exc">Excluida</span>' : '',
    f.negativa ? '<span class="tag neg">−</span>' : '', f.anomala ? '<span class="tag exc">kWh anómalo</span>' : ''].join(' ');
  $('#dwCuerpo').innerHTML = `
    <div class="comp-stats">
      <div><span class="k">Facturado en ${MESES[m - 1].toLowerCase()}</span><span class="v">${fN(F)} kWh</span><span class="s">parte de las facturas que cae en el mes</span></div>
      <div><span class="k">Entregado (evOS)</span><span class="v">${fN(E)} kWh</span><span class="s">${fN(d.puntos.reduce((a, p) => a + (+p.sesiones || 0), 0))} sesiones en ${d.puntos.length} ${d.puntos.length === 1 ? 'punto' : 'puntos'}</span></div>
      <div><span class="k">Diferencia</span><span class="v">${F ? desv((F - E) / F * 100, 25) : '—'}</span><span class="s">${fN(F - E)} kWh</span></div>
    </div>
    <h4 class="mini-h">Facturas que tocan el mes</h4>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Factura</th><th>Periodo</th><th>Lectura</th><th class="num">kWh factura</th><th class="num">% en el mes</th><th class="num">kWh en el mes</th><th>Estado</th></tr></thead><tbody>` +
    (d.facturas.length ? d.facturas.map((f) => `<tr class="${f.cuenta ? '' : 'muted'}"><td>${esc(f.id_factura)}<br><span class="muted sm">emitida ${fFecha(f.fecha_emision)} · ${esc(f.tarifa || '')}</span></td>
      <td>${fFecha(f.fecha_desde)} – ${fFecha(f.fecha_hasta)}</td><td>${esc(f.tipo_lectura || '')}</td><td class="num">${fN(f.kwh)}</td><td class="num">${fN(f.parte * 100, 0)} %</td>
      <td class="num"><b>${f.kwh_mes == null ? '—' : fN(f.kwh_mes)}</b></td><td>${estado(f)}</td></tr>`).join('')
      : '<tr><td colspan="7" class="muted">Ninguna factura de este CUPS cubre el mes.</td></tr>') + `</tbody></table></div>
    <h4 class="mini-h">Puntos de recarga (evOS)</h4>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nº de serie</th><th>Dirección</th><th>Tipo</th><th class="num">Sesiones</th><th class="num">kWh</th><th class="num">Horas</th></tr></thead><tbody>` +
    (d.puntos.length ? d.puntos.map((p) => `<tr><td>${esc(p.serial_cruce || p.serial)}${p.metodo === 'recuperado' ? ` <span class="tag sust" title="En evOS venía como ${esc(p.serial)}">recuperado</span>` : ''}</td>
      <td class="wrap">${esc(p.direccion || '')}<br><span class="muted sm">${esc([p.cp, p.ciudad].filter(Boolean).join(' '))}</span></td><td>${esc(p.ac_dc || '')}${p.potencia ? ` · ${fN(p.potencia)} kW` : ''}</td>
      <td class="num">${fN(p.sesiones)}</td><td class="num"><b>${fN(p.kwh)}</b></td><td class="num">${fN(p.horas, 1)}</td></tr>`).join('')
      : '<tr><td colspan="6" class="muted">Ningún punto de este CUPS tiene sesiones en evOS este mes.</td></tr>') + `</tbody></table></div>` +
    (d.puntos_sin_sesiones.length ? `<p class="note">Puntos de este CUPS en el maestro <b>sin sesiones</b> en evOS este mes: ${d.puntos_sin_sesiones.map(esc).join(', ')}. Si estuvieron funcionando, puede que evOS los tenga con otro nº de serie.</p>` : '') +
    `<p class="note">Cada factura se reparte entre los días de su periodo: «kWh en el mes» es la parte que corresponde a ${MESES[m - 1].toLowerCase()}. Las facturas sustituidas o excluidas aparecen en gris y no cuentan.</p>`;
}
function cerrarDetalle() { const dw = $('#drawer'); dw.classList.add('hide'); dw.setAttribute('aria-hidden', 'true'); abrirDetalle.actual = null; }

// --- Inicio › Puntos: estado del maestro
let PRES = null;
async function cargarPuntosInicio() {
  const anio = ST.anio ?? new Date().getFullYear(), clave = 'pres.' + anio, g = LS.get(clave);
  if (g) pintarPuntosInicio(g);
  else {
    $('#pPuntos').innerHTML = sk('120px', '44px');
    for (const id of ['#pConCups', '#pSinCups', '#pSes', '#pFact']) $(id).innerHTML = sk('90px', '26px');
    $('#chAltas').innerHTML = skCols();
  }
  const d = await seguro(() => SB.rpc('puntos_resumen', { p_anio: anio }));
  if (!d) return;
  LS.set(clave, d);
  if ((ST.anio ?? new Date().getFullYear()) === anio) pintarPuntosInicio(d);
}
function pintarPuntosInicio(d) {
  PRES = d;
  if (ST.vista !== 'inicio' || ST.itab !== 'puntos') return;
  const k = d.kpi, pc = (v) => (k.puntos ? fN(v / k.puntos * 100, 0) + ' %' : '—');
  $('#pPuntos').textContent = fN(k.puntos); $('#pPuntosSub').textContent = `${fN(k.charging_points)} charging points`;
  $('#pConCups').textContent = fN(k.con_cups); $('#pConCupsSub').textContent = `${pc(k.con_cups)} de los puntos · ${fN(k.cups)} CUPS distintos`;
  $('#pSinCups').textContent = fN(k.sin_cups); $('#pSinCupsSub').innerHTML = `${pc(k.sin_cups)} · <a href="#tablas/sincups" class="link">ver listado</a>`;
  $('#pSes').textContent = fN(k.con_sesiones); $('#pSesSub').textContent = `${pc(k.con_sesiones)} de los puntos en ${d.anio}`;
  $('#pFact').textContent = fN(k.cups_facturados); $('#pFactSub').textContent = `de ${fN(k.cups)} CUPS del maestro en ${d.anio}`;
  $('#pEmbudoAnio').textContent = String(d.anio);
  const paso = (t, v, sub = '') => `<div class="cob"><span class="n">${t}${sub ? `<small>${sub}</small>` : ''}</span><span class="t"><span class="f" style="width:${k.puntos ? v / k.puntos * 100 : 0}%"></span></span><span class="v">${fN(v)}<small>${pc(v)}</small></span></div>`;
  $('#lsEmbudo').innerHTML = paso('Puntos Public Infra', k.puntos) + paso('Con CUPS válido', k.con_cups) +
    paso('Su CUPS se factura', k.con_cups_fact, `en ${d.anio}`) + paso('Y tiene sesiones en evOS', k.perimetro, 'entran en la comparación');
  hbars($('#lsMotivos'), d.motivos.map((m) => ({ label: m.motivo, value: m.n })), { fmtV: (r) => fN(r.value) });
  hbars($('#lsTipos'), d.tipologias.slice(0, 10).map((t) => ({ ...t, label: t.tipologia, value: t.puntos - t.sin_cups, prev: t.puntos })), {
    fmtV: (r) => `${fN(r.puntos)}${r.sin_cups ? ` · <span class="muted">${fN(r.sin_cups)} sin CUPS</span>` : ''}`,
    tipFn: (r) => tipRows(r.label, [['Puntos', fN(r.puntos)], ['Con CUPS', fN(r.puntos - r.sin_cups)], ['Sin CUPS', fN(r.sin_cups)], ['Charging points', fN(r.charging_points)], [`Con sesiones en evOS (${d.anio})`, fN(r.con_sesiones)]]),
  });
  columnChart($('#chAltas'), d.altas.map((a) => ({ ...a, label: String(a.anio), value: a.puntos })), {
    tipFn: (a) => tipRows(`Altas ${a.anio}`, [['Puntos', fN(a.puntos)], ['Charging points', fN(a.charging_points)]]),
  });
  hbars($('#lsProv'), d.provincias.slice(0, 12).map((t) => ({ ...t, label: t.provincia, value: t.puntos - t.sin_cups, prev: t.puntos })), {
    fmtV: (r) => `${fN(r.puntos)}${r.sin_cups ? ` · <span class="muted">${fN(r.sin_cups)} sin CUPS</span>` : ''}`,
  });
}

// --- Tablas › Puntos sin CUPS
const S_COLS = [
  ['nombre_activo', 'Nombre de activo', 'w'], ['numero_serie', 'Nº de serie'], ['nombre_cuenta', 'Nombre de la cuenta', 'w'], ['tipologia', 'Tipología'],
  ['provincia', 'Provincia'], ['direccion', 'Dirección', 'w'], ['charging_points', 'Charging Points', 'n'], ['estado', 'Estado'],
  ['fecha_activacion', 'Fecha de activación', 't'], ['cups', 'CUPS (valor actual)'], ['sesiones', 'Sesiones evOS', 'n'], ['kwh', 'kWh evOS', 'n'],
];
ST.s = { orden: 'kwh', dir: 'desc' };
let SINC = { clave: null, filas: [] };
async function datosSinCups() {
  const anio = ST.anio ?? new Date().getFullYear();
  if (SINC.clave !== anio) SINC = { clave: anio, filas: (await SB.rpc('puntos_sin_cups', { p_anio: anio })) || [] };
  return SINC.filas;
}
function sinCupsFiltrados(todos) {
  const q = $('#sQ').value.trim().toLowerCase(), tipo = $('#sTipo').value;
  let r = todos.filter((p) => (!tipo || (p.tipologia || '') === tipo) && (!q || ['nombre_activo', 'numero_serie', 'nombre_cuenta', 'direccion', 'provincia'].some((k) => String(p[k] ?? '').toLowerCase().includes(q))));
  const k = ST.s.orden, s = ST.s.dir === 'asc' ? 1 : -1;
  r.sort((a, b) => (a[k] == null) - (b[k] == null) || (typeof a[k] === 'string' ? String(a[k]).localeCompare(b[k]) : a[k] - b[k]) * s);
  return r;
}
async function cargarSinCups() {
  const tb = $('#tbSinCups'); skTabla(tb, 12);
  const todos = await seguro(datosSinCups);
  tb.classList.remove('loading');
  if (!todos) return;
  const sel = $('#sTipo'), act = sel.value;
  const tipos = [...new Set(todos.map((p) => p.tipologia || ''))].filter(Boolean).sort();
  sel.innerHTML = '<option value="">Todas las tipologías</option>' + tipos.map((t) => `<option ${t === act ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const filas = sinCupsFiltrados(todos), vis = filas.slice(0, 500);
  tb.innerHTML = `<thead><tr>${S_COLS.map(([k, t, n]) => `<th data-c="${k}" class="${n === 'n' ? 'num' : ''}">${t}${ST.s.orden === k ? `<span class="ar">${ST.s.dir === 'desc' ? '↓' : '↑'}</span>` : ''}</th>`).join('')}</tr></thead><tbody>` +
    (vis.length ? vis.map((f) => `<tr>${S_COLS.map(([k, , n]) => {
      const v = f[k];
      if (n === 'w') return `<td class="wrap">${esc(v)}</td>`;
      if (n === 'n') return `<td class="num">${v == null ? '' : fN(v)}</td>`;
      if (n === 't') return `<td>${v ? fFecha(v) : ''}</td>`;
      if (k === 'cups') return `<td class="muted sm">${esc(v || '(vacío)')}</td>`;
      return `<td>${esc(v)}</td>`;
    }).join('')}</tr>`).join('') : `<tr><td colspan="${S_COLS.length}" class="muted">Todos los puntos tienen CUPS.</td></tr>`) + '</tbody>';
  tb.querySelectorAll('th').forEach((th) => th.onclick = () => {
    const c = th.dataset.c; ST.s.dir = ST.s.orden === c && ST.s.dir === 'desc' ? 'asc' : 'desc'; ST.s.orden = c; cargarSinCups();
  });
  $('#sTotal').textContent = filas.length > vis.length ? `${fN(filas.length)} puntos (se muestran ${vis.length}; exporta para verlos todos)` : `${fN(filas.length)} puntos`;
}
async function exportarSinCups() {
  const todos = await seguro(datosSinCups); if (!todos) return;
  const aoa = [S_COLS.map((c) => c[1])].concat(sinCupsFiltrados(todos).map((f) => S_COLS.map(([k, , n]) =>
    n === 't' ? (f[k] ? tsASerial(f[k].replace('T', ' ')) : null) : n === 'n' ? (f[k] == null ? null : +f[k]) : f[k])));
  descargar(hojaFechaHora(aoa, S_COLS.map((c, i) => (c[2] === 't' ? i : -1)).filter((i) => i >= 0)), 'Puntos sin CUPS', `puntos_sin_cups_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// --- tabla de puntos de recarga (evOS)
const U_COLS = [
  ['serial', 'Nº serie'], ['direccion', 'Dirección', 'w'], ['cp', 'CP'], ['ciudad', 'Ciudad'], ['provincia', 'Provincia'], ['region', 'Comunidad'],
  ['ac_dc', 'AC/DC'], ['potencia', 'Potencia kW', 'n'], ['cups20', 'CUPS'], ['facturado', 'CUPS facturado', 'b'], ['categoria', 'Business Model'], ['tipologia', 'Tipología'], ['cuenta', 'Nombre de la cuenta'], ['estado_activo', 'Estado'], ['meses', 'Meses activos', 'n'],
  ['sesiones', 'Sesiones', 'n'], ['kwh', 'kWh', 'n2'], ['kwh_ses', 'kWh/sesión', 'n1'], ['horas', 'Horas de carga', 'n1'],
  ['primera', 'Primera sesión', 't'], ['ultima', 'Última sesión', 't'],
];
ST.u = { orden: 'kwh', dir: 'desc' };
let EVP = { clave: null, filas: [] };
async function datosPuntosEv() {
  const anio = ST.anio ?? new Date().getFullYear();
  if (EVP.clave !== anio) {
    const filas = (await SB.rpc('evos_puntos', { p_anio: anio })) || [];
    for (const f of filas) f.kwh_ses = f.sesiones ? f.kwh / f.sesiones : null;
    EVP = { clave: anio, filas };
  }
  return EVP.filas;
}
function puntosEvFiltrados(todos) {
  const q = $('#uQ').value.trim().toLowerCase();
  const r = q ? todos.filter((p) => ['serial', 'direccion', 'cp', 'ciudad', 'provincia', 'region', 'cups20', 'cuenta'].some((k) => String(p[k] ?? '').toLowerCase().includes(q))) : [...todos];
  const k = ST.u.orden, s = ST.u.dir === 'asc' ? 1 : -1;
  r.sort((a, b) => (a[k] == null) - (b[k] == null) || (typeof a[k] === 'string' ? String(a[k]).localeCompare(b[k]) : a[k] - b[k]) * s);
  return r;
}
async function cargarPuntosEv() {
  const tb = $('#tbPuntosEv'); skTabla(tb, 12);
  const todos = await seguro(datosPuntosEv);
  tb.classList.remove('loading');
  if (!todos) return;
  const filas = puntosEvFiltrados(todos), vis = filas.slice(0, 500);
  const max = Math.max(...filas.map((f) => +f.kwh || 0), 1);
  tb.innerHTML = `<thead><tr>${U_COLS.map(([k, t, n]) => `<th data-c="${k}" class="${n && n !== 'w' && n !== 't' ? 'num' : ''}">${t}${ST.u.orden === k ? `<span class="ar">${ST.u.dir === 'desc' ? '↓' : '↑'}</span>` : ''}</th>`).join('')}</tr></thead><tbody>` +
    (vis.length ? vis.map((f) => `<tr>${U_COLS.map(([k, , n]) => {
      const v = f[k];
      if (k === 'kwh') return `<td class="num"><span class="inbar" style="width:${Math.max(0, (v / max) * 60)}px"></span>${fN(v)}</td>`;
      if (k === 'serial') return /E\+/i.test(v) ? `<td>${esc(v)} <span class="tag exc" title="evOS trae este nº de serie estropeado (notación científica) y no se ha podido identificar en el maestro">incompleto en evOS</span></td>`
        : `<td>${esc(v)}${f.serial_evos ? ` <span class="tag sust" title="En evOS venía como ${esc(f.serial_evos)}">corregido</span>` : ''}</td>`;
      if (k === 'cups20') return v ? `<td class="cups">${esc(v)}${f.metodo === 'recuperado' ? ' <span class="tag sust" title="Nº de serie estropeado en evOS: emparejado por número aproximado y código postal">recuperado</span>' : ''}</td>`
        : `<td class="muted sm">${f.metodo === 'sin_cups' ? 'sin CUPS en el maestro' : 'no está en el maestro'}</td>`;
      if (n === 'b') return `<td>${f.cups20 ? (v ? 'Sí' : '<span class="tag exc">No</span>') : ''}</td>`;
      if (n === 'w') return `<td class="wrap">${esc(v)}</td>`;
      if (n === 'n') return `<td class="num">${fN(v)}</td>`;
      if (n === 'n1') return `<td class="num">${fN(v, 1)}</td>`;
      if (n === 'n2') return `<td class="num">${fN(v, 2)}</td>`;
      if (n === 't') return `<td>${fHora(v)}</td>`;
      return `<td>${esc(v)}</td>`;
    }).join('')}</tr>`).join('') : `<tr><td colspan="${U_COLS.length}" class="muted">No hay datos de evOS para ${ST.anio ?? ''}. Súbelos en «Cargar datos».</td></tr>`) + '</tbody>';
  tb.querySelectorAll('th').forEach((th) => th.onclick = () => {
    const c = th.dataset.c; ST.u.dir = ST.u.orden === c && ST.u.dir === 'desc' ? 'asc' : 'desc'; ST.u.orden = c; cargarPuntosEv();
  });
  $('#uTotal').textContent = filas.length > vis.length ? `${fN(filas.length)} puntos (se muestran ${vis.length}; exporta para verlos todos)` : `${fN(filas.length)} puntos`;
}
async function exportarPuntosEv() {
  const todos = await seguro(datosPuntosEv); if (!todos) return;
  const aoa = [U_COLS.map((c) => c[1])].concat(puntosEvFiltrados(todos).map((f) => U_COLS.map(([k, , n]) =>
    n === 't' ? tsASerial(f[k]) : n === 'b' ? (f.cups20 ? (f[k] ? 'Sí' : 'No') : null) : (n && n !== 'w' ? (f[k] == null ? null : +f[k]) : f[k]))));
  descargar(hojaFechaHora(aoa, U_COLS.map((c, i) => (c[2] === 't' ? i : -1)).filter((i) => i >= 0)), 'Puntos', `puntos_recarga_${ST.anio ?? ''}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// --- pantalla de carga: lo guardado de cada tipo
function cargarDatosCargar() {
  cargarCargas(); cargarLotesEvos(); cargarHistorialAna(); cargarEstadoCruce();
  seguro(datosComp).then((d) => d && pintarAnaEstado(d));
}
async function cargarEstadoCruce() {
  const [t, c, e] = await Promise.all([
    seguro(() => SB.select('puntos_recarga', { select: 'id_activo', limit: 1 }, { count: true })),
    seguro(() => SB.select('puntos_recarga', { select: 'id_activo', cups: 'like.ES*', limit: 1 }, { count: true })),
    seguro(() => SB.todo((limit, offset) => SB.select('evos_cups', { select: 'metodo', limit, offset }))),
  ]);
  if (!t) return;
  if (!t.total) { $('#cruceEstado').innerHTML = 'El maestro de puntos de recarga está vacío.'; return; }
  const n = (m) => (e || []).filter((x) => x.metodo === m).length;
  $('#cruceEstado').innerHTML = `<b>${fN(t.total)}</b> puntos (${fN(c?.total)} con CUPS)` +
    `<br>Puntos de evOS con CUPS: <b>${fN(n('exacto') + n('recuperado'))}</b> (${fN(n('recuperado'))} recuperados)`;
}
async function cargarLotesEvos() {
  const l = await seguro(() => SB.select('evos_lotes', { select: 'id,archivo,desde,hasta,sesiones,kwh,fecha,usuario_email', order: 'desde.desc', limit: 1000 }));
  if (!l) return;
  const ses = l.reduce((a, x) => a + (+x.sesiones || 0), 0);
  $('#dEvFich').textContent = fN(l.length); $('#dEvSes').textContent = fN(ses);
  $('#dEvRango').textContent = l.length ? `${fFecha(l.at(-1).desde)} – ${fFecha(l[0].hasta)}` : '—';
  $('#evLotesTot').textContent = l.length ? `${fN(l.length)} ficheros` : '';
  $('#tbEvLotes').innerHTML = `<thead><tr><th>Fichero</th><th>Días</th><th class="num">Sesiones</th><th class="num">kWh</th><th>Subido</th>${ST.admin ? '<th></th>' : ''}</tr></thead><tbody>` +
    (l.length ? l.map((x) => `<tr><td>${esc(x.archivo)}</td><td>${fFecha(x.desde)} – ${fFecha(x.hasta)}</td>
      <td class="num">${fN(x.sesiones)}</td><td class="num">${fN(x.kwh)}</td><td class="muted sm">${fFechaHora(x.fecha)}${x.usuario_email ? ' · ' + esc(x.usuario_email) : ''}</td>${ST.admin ? `<td><button class="btn mini danger" data-borrar="${x.id}">Borrar</button></td>` : ''}</tr>`).join('')
      : `<tr><td colspan="6" class="muted">Ningún fichero de evOS cargado todavía</td></tr>`) + '</tbody>';
  $$('#tbEvLotes [data-borrar]').forEach((bt) => bt.onclick = async () => {
    if (bt.dataset.ok !== '1') { bt.dataset.ok = '1'; bt.textContent = '¿Seguro?'; setTimeout(() => { bt.dataset.ok = ''; bt.textContent = 'Borrar'; }, 3000); return; }
    bt.disabled = true;
    const ok = await seguro(() => SB.rest('DELETE', 'evos_lotes', { query: { id: 'eq.' + bt.dataset.borrar, select: 'id' }, prefer: 'return=representation' }));
    if (ok?.length) { toast('Fichero de evOS borrado'); await seguro(() => SB.rpc('refrescar_cruce')); datosCambiados(); cargarLotesEvos(); } else { if (ok) toast('No tienes permiso para borrar.'); bt.disabled = false; }
  });
}

// ---------------------------------------------------------------- navegación y filtros
const TITULOS = {
  inicio: ['Inicio', 'Resumen de consumo y coste de la red de recarga'],
  tablas: ['Tablas', ''],
  cargar: ['Cargar datos', 'Facturas de Endesa, ficheros de evOS y analítico del equipo, en un solo sitio'],
  correcciones: ['Correcciones', 'Reglas para corregir cómo cuentan algunas facturas'],
};
const ITABS = { general: 'Facturado frente a lo entregado según evOS', facturas: 'Resumen de consumo y coste de las facturas de Endesa', evos: 'Sesiones de carga registradas en evOS', puntos: 'Estado del maestro de puntos de recarga (Public Infra)' };
ST.itab = 'general';
const TABS = {
  bt: 'Líneas de factura de baja tensión (tarifas 2.0TD / 3.0TD), sin duplicados',
  mt: 'Líneas de factura de media tensión (tarifas 6.x), sin duplicados',
  cups: 'Consumo y coste agregados por CUPS (un CUPS puede agrupar varios puntos de recarga)',
  evos: 'Sesiones de evOS sumadas por mes y punto de carga',
  puntos: 'Puntos de recarga según evOS (por número de serie)',
  sincups: 'Puntos Public Infra del maestro sin CUPS válido',
  cruce: 'Facturado frente a entregado, CUPS a CUPS (según el maestro de puntos de recarga)',
  analitico: 'Facturas frente al analítico que monta el equipo',
};
// enlaces antiguos -> nueva estructura
const ALIAS = { facturas: 'tablas/bt', cups: 'tablas/cups', puntos: 'tablas/cups', comparativa: 'tablas/analitico', evos: 'tablas/evos', cruce: 'tablas/evos' };
ST.tab = 'bt';
function irA(v) { mostrarVista(v); refrescar(); }
function mostrarVista(v) {
  v = ALIAS[v] || v || 'inicio';
  let [vista, tab, extra] = v.split('/');
  if (vista === 'tablas' && tab === 'cruce' && extra) ST.xmes = +extra || null;
  if (!TITULOS[vista]) vista = 'inicio';
  if (vista === 'tablas') { ST.tab = TABS[tab] ? tab : ST.tab; if (location.hash.slice(1) !== 'tablas/' + ST.tab) history.replaceState(null, '', '#tablas/' + ST.tab); }
  if (vista === 'inicio') { ST.itab = ITABS[tab] ? tab : ST.itab; if (location.hash.slice(1) !== 'inicio/' + ST.itab) history.replaceState(null, '', '#inicio/' + ST.itab); }
  ST.vista = vista;
  $$('nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === vista));
  $$('.vista').forEach((s) => s.classList.toggle('hide', s.id !== 'v-' + vista));
  $('#titulo').textContent = TITULOS[vista][0];
  $('#subtitulo').textContent = vista === 'tablas' ? TABS[ST.tab] : vista === 'inicio' ? ITABS[ST.itab] : TITULOS[vista][1];
  if (vista === 'inicio') {
    $$('#tabsInicio button').forEach((b) => b.classList.toggle('on', b.dataset.t === ST.itab));
    $$('#v-inicio .pane').forEach((p) => p.classList.toggle('hide', p.dataset.p !== ST.itab));
  }
  if (vista === 'tablas') {
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === ST.tab));
    $$('#v-tablas .pane').forEach((p) => p.classList.toggle('hide', !p.dataset.p.split(' ').includes(ST.tab)));
  }
  // filtros de arriba según lo que se ve
  const iFact = vista === 'inicio' && ST.itab === 'facturas';
  const conFact = iFact || (vista === 'tablas' && ['bt', 'mt', 'cups'].includes(ST.tab));
  $('#filtros').classList.toggle('hide', !['inicio', 'tablas'].includes(vista));
  $('#segBase').classList.toggle('hide', !conFact);
  $('#segTension').classList.toggle('hide', !(iFact || (vista === 'tablas' && ST.tab === 'cups')));
  if (iFact) skDashboard();
}
function refrescar() {
  if (ST.vista === 'inicio') { if (ST.itab === 'facturas') cargarDashboard(); else if (ST.itab === 'puntos') cargarPuntosInicio(); else cargarEvosInicio(); }
  else if (ST.vista === 'cargar') cargarDatosCargar();
  else if (ST.vista === 'correcciones') cargarCorrecciones();
  else if (ST.vista === 'tablas') {
    if (ST.tab === 'bt' || ST.tab === 'mt') cargarFacturas();
    else if (ST.tab === 'cups') cargarPuntos();
    else if (ST.tab === 'evos') cargarEvAgg();
    else if (ST.tab === 'puntos') cargarPuntosEv();
    else if (ST.tab === 'analitico') cargarComparativa();
    else if (ST.tab === 'cruce') cargarCruceTabla();
    else if (ST.tab === 'sincups') cargarSinCups();
  }
}
async function refrescarAnios() {
  const claveA = `anios.${ST.base}.${ST.tension}`;
  if (!$('#selAnio').options.length) {
    const g = LS.get(claveA);
    if (g?.length) { $('#selAnio').innerHTML = g.map((a) => `<option value="${a}">${a}</option>`).join('') + '<option value="">Todo el histórico</option>'; if (ST.anio == null && !ST.todo) ST.anio = g[0]; $('#selAnio').value = ST.anio ?? ''; }
  }
  const [anios, res] = await Promise.all([seguro(() => SB.rpc('anios', { p_base: ST.base, p_tension: ST.tension || null })), seguro(() => SB.rpc('resumen'))]);
  if (!anios || !res) {
    // sin respuesta: se usa el año en curso para no bloquear la carga y se reintenta en segundo plano
    if (ST.anio == null && !ST.todo) ST.anio = new Date().getFullYear();
    if (!$('#selAnio').options.length) { $('#selAnio').innerHTML = `<option value="${ST.anio ?? ''}">${ST.anio ?? 'Todo el histórico'}</option>`; }
    clearTimeout(refrescarAnios._t); refrescarAnios._t = setTimeout(refrescarAnios, 4000);
    return false;
  }
  ST.admin = !!res.admin;
  LS.set(claveA, anios);
  // (el traslado de la fila original a su tabla aparte queda en pausa: haría crecer la base
  //  temporalmente por encima del límite del plan gratuito)
  if (res.pendientes > 0) prepararPendientes(res.pendientes, 0);
  const sel = $('#selAnio'), prev = ST.anio;
  sel.innerHTML = anios.map((a) => `<option value="${a}">${a}</option>`).join('') + '<option value="">Todo el histórico</option>';
  ST.anio = (prev === null && ST.todo) ? null : anios.includes(prev) ? prev : (anios[0] ?? null);
  sel.value = ST.anio ?? '';
  $('#sideFoot').innerHTML = res.filas ? `${fN(res.facturas)} facturas guardadas<br>Última carga: ${esc(fFechaHora(res.ultima_carga))}` : 'Sin datos cargados';
  return true;
}

// Facturas guardadas antes de la detección de refacturaciones: se preparan por tandas
let PREPARANDO = false;
async function prepararPendientes(total, porMover = 0) {
  if (PREPARANDO) return; PREPARANDO = true;
  const aviso = $('#aviso'); aviso.classList.remove('hide');
  const pinta = (txt, hecho, de) => { $('#avisoTxt').textContent = `${txt}… ${fN(hecho)} de ${fN(de)}`; $('#avisoBar').style.width = (de ? hecho / de * 100 : 100) + '%'; };
  try {
    // 1) reorganizar el almacenamiento: la fila original completa pasa a su propia tabla
    let q = porMover;
    while (q > 0) { pinta('Optimizando el almacenamiento de las facturas guardadas', porMover - q, porMover); q = await SB.rpc('mover_valores', { p_lote: 3000 }); }
    // 2) preparar los datos para detectar refacturaciones y copias
    q = total;
    while (q > 0) { pinta('Revisando las facturas guardadas para detectar refacturaciones y copias', total - q, total); q = await SB.rpc('rellenar_pendientes', { p_lote: 8000 }); }
    $('#avisoTxt').textContent = 'Aplicando las reglas y actualizando los resúmenes…';
    const r = await SB.rpc('recalcular_sustituidas');
    toast(`Revisión terminada: ${fN(r.sustituidas)} filas sustituidas ya no se cuentan dos veces.`, 7000);
    datosCambiados(); refrescar();
  } catch (e) {
    if (e.message === 'sin_sesion') mostrarLogin(); else toast('No se pudo terminar: ' + e.message + '. Se reintentará al pulsar «Actualizar».', 8000);
  } finally { PREPARANDO = false; aviso.classList.add('hide'); }
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
  mostrarVista(location.hash.slice(1) || 'inicio');   // se ve al instante, con esqueletos
  await refrescarAnios();                              // años disponibles (si falla, se sigue igual)
  refrescar();
}
// filtros recordados en este navegador
function guardarFiltros() { try { localStorage.setItem('emob.filtros', JSON.stringify({ base: ST.base, anio: ST.anio, tension: ST.tension })); } catch { /* sin almacenamiento */ } }
function leerFiltros() {
  try { const f = JSON.parse(localStorage.getItem('emob.filtros') || 'null'); if (f) { ST.base = f.base === 'emision' ? 'emision' : 'consumo'; ST.anio = f.anio ?? null; ST.todo = f.anio === null; if (['BT', 'MT', ''].includes(f.tension)) ST.tension = f.tension; } } catch { /* nada */ }
  $$('#segBase button').forEach((x) => x.classList.toggle('on', x.dataset.b === ST.base));
  $$('#segTension button').forEach((x) => x.classList.toggle('on', x.dataset.t === ST.tension));
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

  // comparativa

  // correcciones y actualizar
  $('#fRegla').onsubmit = guardarRegla;
  $('#rCampo').onchange = sugerirValores;
  $('#btnActualizar').onclick = async (e) => {
    const b = e.currentTarget; b.classList.add('girando'); b.disabled = true;
    const res = await seguro(() => SB.rpc('resumen'));
    if (res && res.pendientes > 0) prepararPendientes(res.pendientes, 0);
    else await seguro(() => SB.rpc('refrescar_cache'));
    datosCambiados(); CABS = null;
    await refrescarAnios(); await Promise.resolve(refrescar());
    setTimeout(() => { b.classList.remove('girando'); b.disabled = false; }, 400);
  };

  // filtros
  $$('#segBase button').forEach((b) => b.onclick = async () => {
    $$('#segBase button').forEach((x) => x.classList.toggle('on', x === b));
    ST.base = b.dataset.b; ST.f.pag = 1; if (ST.vista === 'inicio' && ST.itab === 'facturas') skDashboard(); await refrescarAnios(); guardarFiltros(); refrescar();
  });
  $$('#segTension button').forEach((b) => b.onclick = async () => {
    $$('#segTension button').forEach((x) => x.classList.toggle('on', x === b));
    ST.tension = b.dataset.t; ST.f.pag = 1; if (ST.vista === 'inicio' && ST.itab === 'facturas') skDashboard(); await refrescarAnios(); guardarFiltros(); refrescar();
  });
  $('#selAnio').onchange = (e) => { ST.anio = e.target.value ? +e.target.value : null; ST.todo = !e.target.value; ST.f.pag = 1; guardarFiltros(); refrescar(); };
  let t; const deb = (fn) => () => { clearTimeout(t); t = setTimeout(fn, 300); };
  $('#fQ').oninput = deb(() => { ST.f.pag = 1; cargarFacturas(); });
  $('#fEstado').onchange = $('#fTodas').onchange = () => { ST.f.pag = 1; cargarFacturas(); };
  $('#pQ').oninput = deb(cargarPuntos);
  $('#fExport').onclick = (e) => exportarFilas(queryFacturas(), 'facturas_' + (tensionFact() || 'todas'), e.currentTarget);
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
  $$('#tabsInicio button').forEach((b) => b.onclick = () => { location.hash = 'inicio/' + b.dataset.t; });
  // tablas
  $$('#tabs button').forEach((b) => b.onclick = () => { location.hash = 'tablas/' + b.dataset.t; });
  $('#eQ').oninput = deb(() => { ST.e.pag = 1; cargarEvAgg(); });
  $('#eExport').onclick = exportarEvAgg;
  $('#uQ').oninput = deb(cargarPuntosEv);
  $('#uExport').onclick = exportarPuntosEv;
  $('#xQ').oninput = deb(cargarCruceTabla);
  $('#sQ').oninput = deb(cargarSinCups);
  $('#sTipo').onchange = cargarSinCups;
  $('#sExport').onclick = exportarSinCups;
  $('#xMes').onchange = (e) => { ST.xmes = e.target.value ? +e.target.value : null; cargarCruceTabla(); };
  $$('#drawer [data-cerrar]').forEach((b) => b.onclick = cerrarDetalle);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarDetalle(); });
  $('#xExport').onclick = exportarCruce;
  // vaciar
  $('#btnVaciar').onclick = () => $('#modal').classList.remove('hide');
  $('#mNo').onclick = () => $('#modal').classList.add('hide');
  $('#mSi').onclick = async () => {
    const ok = await seguro(() => SB.rpc('vaciar'));
    $('#modal').classList.add('hide');
    if (ok !== null) { PUNTOS.clave = null; CABS = null; toast('Datos vaciados'); }
    await refrescarAnios(); cargarDatosCargar();
  };

  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => {
    if (ST.vista === 'inicio' && ST.itab === 'facturas' && DASH && !DASH.vacio) pintarDashboard();
    if (ST.vista === 'inicio' && ['general', 'evos'].includes(ST.itab) && EVOS) pintarEvosInicio(EVOS);
    if (ST.vista === 'inicio' && ST.itab === 'puntos' && PRES) pintarPuntosInicio(PRES);
    if (ST.vista === 'tablas' && ST.tab === 'analitico' && COMP?.carga) cargarComparativa();
  }, 150); });
  addEventListener('hashchange', () => { if (!$('#appRoot').classList.contains('hide')) irA(location.hash.slice(1)); });

  leerFiltros();
  // arranque: ¿venimos de un enlace de invitación / recuperación?
  const tipo = SB.leerSesionDeUrl();
  if (tipo === 'invite' || tipo === 'recovery') {
    SB.cargarUsuario().catch(() => {});
    mostrarLogin('nueva');
  } else if (SB.sesion) entrarApp();
  else mostrarLogin();
}
init();
