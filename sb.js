/* Cliente mínimo de Supabase (Auth + REST), sin dependencias. */
class Supabase {
  constructor(url, key) {
    this.url = url.replace(/\/$/, '');
    this.key = key;
    this.KEY_SES = 'emob.sesion.' + new URL(this.url).host;
    try { this.sesion = JSON.parse(localStorage.getItem(this.KEY_SES) || 'null'); } catch { this.sesion = null; }
  }

  // ------------------------------------------------------------ sesión
  _guardar(s) {
    if (s && !s.expires_at) s.expires_at = Math.floor(Date.now() / 1000) + (s.expires_in || 3600);
    this.sesion = s;
    try { s ? localStorage.setItem(this.KEY_SES, JSON.stringify(s)) : localStorage.removeItem(this.KEY_SES); } catch { /* sin almacenamiento */ }
  }
  get email() { return this.sesion?.user?.email || null; }

  async _auth(path, body, conToken = false) {
    const h = { apikey: this.key, 'Content-Type': 'application/json' };
    if (conToken && this.sesion) h.Authorization = 'Bearer ' + this.sesion.access_token;
    const r = await fetch(`${this.url}/auth/v1/${path}`, { method: body === undefined ? 'GET' : (path === 'user' ? 'PUT' : 'POST'), headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(traducirError(j.error_description || j.msg || j.message || j.error || r.statusText));
    return j;
  }

  async login(email, password) {
    this._guardar(await this._auth('token?grant_type=password', { email, password }));
  }

  /** Tras un enlace de invitación o recuperación, Supabase vuelve con #access_token=... */
  leerSesionDeUrl() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.get('access_token')) return null;
    const tipo = h.get('type');
    const s = { access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_in: +h.get('expires_in') || 3600, expires_at: +h.get('expires_at') || 0, user: null };
    this._guardar(s);
    history.replaceState(null, '', location.pathname + location.search);
    return tipo;
  }
  async cargarUsuario() { const u = await this._auth('user', undefined, true); this.sesion.user = u; this._guardar(this.sesion); return u; }
  async cambiarPassword(password) { await this._token(); await this._auth('user', { password }, true); }
  async recuperar(email) { await this._auth('recover', { email }); }

  async logout() {
    try { if (this.sesion) await this._auth('logout', {}, true); } catch { /* da igual */ }
    this._guardar(null);
  }

  async _token() {
    if (!this.sesion) throw new Error('sin_sesion');
    if (this.sesion.expires_at - Date.now() / 1000 < 60) {
      try { this._guardar(await this._auth('token?grant_type=refresh_token', { refresh_token: this.sesion.refresh_token })); }
      catch (e) { this._guardar(null); throw new Error('sin_sesion'); }
    }
    return this.sesion.access_token;
  }

  // ------------------------------------------------------------ REST (PostgREST)
  async rest(method, path, { query = {}, body, prefer, count = false } = {}) {
    const token = await this._token();
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.append(k, v);
    const h = { apikey: this.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const pref = [prefer, count ? 'count=exact' : null].filter(Boolean).join(',');
    if (pref) h.Prefer = pref;
    const r = await fetch(`${this.url}/rest/v1/${path}${qs.toString() ? '?' + qs : ''}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 401) { this._guardar(null); throw new Error('sin_sesion'); }
    const txt = await r.text();
    const j = txt ? JSON.parse(txt) : null;
    if (!r.ok) throw new Error(traducirError(j?.message || j?.hint || r.statusText));
    if (count) { const cr = r.headers.get('Content-Range') || ''; return { datos: j, total: +(cr.split('/')[1] || 0) }; }
    return j;
  }
  select(tabla, query, opts = {}) { return this.rest('GET', tabla, { query, ...opts }); }
  insert(tabla, filas, { query, prefer = 'return=representation' } = {}) { return this.rest('POST', tabla, { body: filas, query, prefer }); }
  update(tabla, query, cambios) { return this.rest('PATCH', tabla, { query, body: cambios, prefer: 'return=minimal' }); }
  rpc(fn, args = {}, query) { return this.rest('POST', 'rpc/' + fn, { body: args, query }); }

  /** Descarga todas las filas paginando de 1000 en 1000 (límite de Supabase). */
  async todo(fn, onPagina) {
    const out = []; const N = 1000;
    for (let off = 0; ; off += N) {
      const p = await fn(N, off);
      out.push(...p); onPagina?.(out.length);
      if (p.length < N) return out;
    }
  }
}

function traducirError(m) {
  const t = String(m || '');
  if (/invalid login credentials/i.test(t)) return 'Email o contraseña incorrectos.';
  if (/email not confirmed/i.test(t)) return 'El email aún no está confirmado.';
  if (/password should be at least/i.test(t)) return 'La contraseña es demasiado corta (mínimo 6 caracteres).';
  if (/row-level security|permission denied/i.test(t)) return 'No tienes permiso para esta acción.';
  if (/Failed to fetch|NetworkError/i.test(t)) return 'No se puede conectar con el servidor. Revisa la conexión.';
  return t;
}
