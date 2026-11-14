// Utilidades de sesión compartidas por las páginas.

const irALogin = () => {
  const next = encodeURIComponent(location.pathname + location.hash);
  location.replace(`/login?next=${next}`);
};

// Revisa la sesión; si no hay, manda al login. Devuelve { usuario, admin }.
export async function requerirSesion() {
  try {
    const r = await fetch('/api/login', { cache: 'no-store' });
    if (r.status === 401) { irALogin(); return new Promise(() => {}); }
    const data = await r.json();
    document.body.style.visibility = 'visible';
    const yo = document.querySelector('#yo');
    if (yo) yo.textContent = data.usuario;
    document.querySelector('#salir')?.addEventListener('click', salir);
    montarNav(data);
    return data;
  } catch {
    document.body.style.visibility = 'visible';
    return { usuario: '', admin: false };
  }
}

// fetch que manda al login si la sesión venció.
export async function api(url, opts = {}) {
  const r = await fetch(url, {
    cache: 'no-store',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (r.status === 401) { irALogin(); throw new Error('Sesión vencida'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || 'Error'); e.status = r.status; throw e; }
  return data;
}

export async function salir() {
  await fetch('/api/login', { method: 'DELETE' }).catch(() => {});
  location.replace('/login');
}

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let tt;
export function toast(msg, err = false) {
  let t = document.querySelector('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.append(t); }
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(tt); tt = setTimeout(() => (t.className = 'toast'), 3200);
}

// ---------- Pedidos con "revisión" (solo descarga si hubo cambios) ----------
// estado = { rev, pedidos, persistente }. Devuelve true si llegaron datos nuevos.
export async function traerPedidos(estado) {
  const q = estado.rev != null ? `?rev=${estado.rev}` : '';
  const d = await api('/api/pedidos' + q);
  if (d.sinCambios) return false;
  estado.rev = d.rev;
  estado.pedidos = d.pedidos;
  estado.persistente = d.persistente;
  return true;
}

// Repite fn cada ms, solo con la pestaña visible (ahorra operaciones de la base de datos)
export function cadaTanto(fn, ms) {
  setInterval(() => { if (!document.hidden) fn(); }, ms);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fn(); });
}

// ---------- QR de transferencia ----------
let ajustesCache = null;
export async function leerQR(forzar = false) {
  if (!ajustesCache || forzar) {
    try { ajustesCache = await api('/api/ajustes'); } catch { ajustesCache = { qr: null, qrTexto: '' }; }
  }
  return ajustesCache;
}

// HTML del QR para meter dentro de otra caja (o '' si no hay QR configurado)
export function htmlQR(a, monto) {
  if (!a?.qr) return `<div class="qr-box sin-qr">📲 No hay QR configurado. Súbelo en Menú → QR de pago.</div>`;
  return `<div class="qr-box">
    <img src="${a.qr}" alt="QR para transferir" />
    ${monto ? `<div class="qr-monto">${monto}</div>` : ''}
    ${a.qrTexto ? `<div class="qr-texto">${esc(a.qrTexto)}</div>` : ''}
    <button type="button" class="mini" data-qr-grande>🔍 Ver en grande</button>
  </div>`;
}

// QR a pantalla completa para mostrarle al cliente
export async function mostrarQR(monto) {
  const a = await leerQR();
  let ov = document.querySelector('#qrGrande');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'qrGrande';
    ov.className = 'qr-grande';
    ov.addEventListener('click', () => ov.classList.remove('show'));
    document.body.append(ov);
  }
  ov.innerHTML = a.qr
    ? `<div class="qr-grande-box"><img src="${a.qr}" alt="QR" />
        ${monto ? `<div class="qr-monto">${monto}</div>` : ''}
        ${a.qrTexto ? `<div class="qr-texto">${esc(a.qrTexto)}</div>` : ''}
        <div class="hint">Toca en cualquier parte para cerrar</div></div>`
    : `<div class="qr-grande-box"><p>No hay QR configurado.<br>Súbelo en Menú → QR de pago.</p></div>`;
  ov.classList.add('show');
}

// Cualquier botón con data-qr-grande abre el QR grande
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-qr-grande]');
  if (b) { e.preventDefault(); mostrarQR(b.dataset.monto || b.closest('.qr-box')?.querySelector('.qr-monto')?.textContent || ''); }
});

// =====================================================================
// NAVEGACIÓN: barra inferior en celular + barra lateral en computador
// =====================================================================
export const SECCIONES_NAV = [
  { grupo: 'Operación', items: [
    { href: '/', ico: '🏠', txt: 'Inicio', principal: true },
    { href: '/tomar', ico: '🧾', txt: 'Tomar pedido', corto: 'Tomar', principal: true },
    { href: '/pedidos', ico: '📋', txt: 'Pedidos', principal: true },
    { href: '/cuentas', ico: '💳', txt: 'Cuentas abiertas', corto: 'Cuentas', principal: true },
  ] },
  { grupo: 'Caja y dinero', items: [
    { href: '/cierre', ico: '🔒', txt: 'Cierre de caja', admin: true },
    { href: '/ventas', ico: '💰', txt: 'Ventas', admin: true },
    { href: '/reportes', ico: '📊', txt: 'Reportes', admin: true },
    { href: '/compras', ico: '🛒', txt: 'Compras' },
    { href: '/gastos', ico: '🏦', txt: 'Gastos fijos', admin: true },
  ] },
  { grupo: 'Negocio', items: [
    { href: '/inventario', ico: '📦', txt: 'Inventario' },
    { href: '/productos#productos', ico: '🛠️', txt: 'Productos y precios', admin: true },
    { href: '/productos#sabores', ico: '🍧', txt: 'Sabores', admin: true },
    { href: '/productos#domicilios', ico: '🛵', txt: 'Domicilios', admin: true },
    { href: '/productos#qr', ico: '📲', txt: 'QR de pago', admin: true },
  ] },
];

function montarNav({ usuario, admin }) {
  if (document.querySelector('.nav-lateral')) return;
  const ruta = location.pathname.replace(/\.html$/, '') || '/';
  const activo = (href) => {
    const [h, hash] = href.split('#');
    if (h === '/') return ruta === '/' || ruta === '/index';
    if (hash) return ruta === h && (location.hash.slice(1) || 'sabores') === hash;
    return ruta === h;
  };
  const secciones = SECCIONES_NAV.map((g) => ({ ...g, items: g.items.filter((i) => admin || !i.admin) })).filter((g) => g.items.length);
  const link = (i, cls = '') => `<a href="${i.href}" class="${cls} ${activo(i.href) ? 'activo' : ''}"><span class="ni">${i.ico}</span><span class="nt">${i.txt}</span></a>`;

  // Lateral (computador)
  const lateral = document.createElement('nav');
  lateral.className = 'nav-lateral';
  lateral.innerHTML = `<a href="/" class="nl-logo"><img src="/img/logo.png" alt="Enclocha 2"></a>` +
    secciones.map((g) => `<div class="nl-grupo"><span>${g.grupo}</span>${g.items.map((i) => link(i)).join('')}</div>`).join('') +
    `<div class="nl-pie"><span>👤 ${esc(usuario)}</span><button type="button" class="nl-salir">Salir</button></div>`;

  // Inferior (celular): 4 principales + "Más"
  const inferior = document.createElement('nav');
  inferior.className = 'nav-inferior';
  const principales = SECCIONES_NAV[0].items;
  const enMas = !principales.some((i) => activo(i.href));
  inferior.innerHTML = principales.map((i) => `<a href="${i.href}" class="${activo(i.href) ? 'activo' : ''}"><span class="ni">${i.ico}</span><span class="nt">${i.corto || i.txt}</span></a>`).join('') +
    `<button type="button" class="ni-mas ${enMas ? 'activo' : ''}"><span class="ni">☰</span><span class="nt">Más</span></button>`;

  // Hoja "Más"
  const hoja = document.createElement('div');
  hoja.className = 'nav-hoja';
  hoja.innerHTML = `<div class="nh-caja"><div class="nh-asa"></div>
    ${secciones.slice(1).map((g) => `<div class="nh-grupo"><span>${g.grupo}</span><div class="nh-grid">${g.items.map((i) => link(i, 'nh-item')).join('')}</div></div>`).join('')}
    <div class="nh-pie"><span>👤 ${esc(usuario)}</span><button type="button" class="nl-salir">Cerrar sesión</button></div></div>`;

  document.body.append(lateral, inferior, hoja);
  document.body.classList.add('con-nav');
  inferior.querySelector('.ni-mas').addEventListener('click', () => hoja.classList.add('show'));
  hoja.addEventListener('click', (e) => { if (e.target === hoja) hoja.classList.remove('show'); });
  document.querySelectorAll('.nl-salir').forEach((b) => b.addEventListener('click', salir));
  window.addEventListener('hashchange', () => {
    document.querySelectorAll('.nav-lateral a, .nh-item').forEach((a) => a.classList.toggle('activo', activo(a.getAttribute('href'))));
    hoja.classList.remove('show');
  });
}
