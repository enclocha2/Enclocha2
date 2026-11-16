// Utilidades de sesión compartidas por las páginas.

const irALogin = () => {
  const next = encodeURIComponent(location.pathname + location.hash);
  location.replace(`/login?next=${next}`);
};

// Permisos del usuario conectado
let yoActual = { permisos: [] };
export const puede = (...ps) => ps.some((p) => (yoActual.permisos || []).includes(p));

// Revisa la sesión; si no hay, manda al login. Si se pasan permisos y no tiene ninguno, bloquea la página.
// Devuelve { usuario, nombre, rol, permisos, admin }.
export async function requerirSesion(...permisosPagina) {
  try {
    const r = await fetch('/api/login', { cache: 'no-store' });
    if (r.status === 401) { irALogin(); return new Promise(() => {}); }
    const data = await r.json();
    yoActual = data;
    fijarDiasCerrados(data.diasCerrados); // días que no se trabaja: no se consulta nada
    if (permisosPagina.length && !puede(...permisosPagina)) {
      document.body.style.visibility = 'visible';
      montarNav(data);
      const m = document.querySelector('main');
      if (m) m.innerHTML = `<div class="card sin-permiso"><div style="font-size:3rem">🔒</div><h2>No tienes permiso para esta sección</h2>
        <p class="hint">Pídele a un administrador que te lo asigne en Inicio → Usuarios.</p><a class="btn" href="/" style="width:auto;display:inline-block;text-decoration:none">Volver al inicio</a></div>`;
      return new Promise(() => {});
    }
    document.body.style.visibility = 'visible';
    const yo = document.querySelector('#yo');
    if (yo) yo.textContent = data.usuario;
    document.querySelector('#salir')?.addEventListener('click', salir);
    montarNav(data);
    return data;
  } catch {
    document.body.style.visibility = 'visible';
    return { usuario: '', admin: false, permisos: [] };
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
  // Día marcado como "no se trabaja": fuera de servicio, no se consulta nada
  if (cerradoHoy()) { estado.pedidos ||= []; return false; }
  const q = estado.rev != null ? `?rev=${estado.rev}` : '';
  const d = await api('/api/pedidos' + q);
  if (d.sinCambios) return false;
  estado.rev = d.rev;
  estado.pedidos = d.pedidos;
  estado.persistente = d.persistente;
  return true;
}

// Repite fn cada ms, solo con la pestaña visible y en horario de operación
// (fuera de horario no consulta nada; se reactiva sola cuando llega la hora)
export function cadaTanto(fn, ms) {
  setInterval(() => { if (!document.hidden && enHorarioOperacion()) fn(); }, ms);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && enHorarioOperacion()) fn(); });
}
import { enHorarioOperacion, textoPausa, fijarDiasCerrados, cerradoHoy } from '/fechas.js';
// Versión de la app (para saber si ya quedó desplegada la última)
export const VERSION = '52';
export { enHorarioOperacion };

// Aviso "🌙 Fuera de horario" con botón para revisar a mano. Se pone/quita solo.
export function avisoHorario(contenedor, alRevisar) {
  const pintar = () => {
    const fuera = !enHorarioOperacion();
    contenedor.hidden = !fuera;
    if (fuera && cerradoHoy()) contenedor.innerHTML = `<span>🚫 Hoy no se trabaja · la app está fuera de servicio y no consulta nada. Para reactivarla: Inicio → "✅ Sí se trabaja hoy".</span>`;
    else if (fuera) contenedor.innerHTML = `<span>🌙 Fuera de horario · la actualización automática está en pausa (${textoPausa()}).</span>
      <button type="button" class="mini">🔄 Revisar ahora</button>`;
    contenedor.querySelector('button')?.addEventListener('click', alRevisar);
  };
  pintar();
  setInterval(pintar, 60000); // revisa el reloj (no la base de datos) cada minuto
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
    { href: '/tomar', ico: '🧾', txt: 'Tomar pedido', corto: 'Tomar', principal: true, perm: ['tomar'] },
    { href: '/pedidos', ico: '📋', txt: 'Pedidos', principal: true, perm: ['pedidos', 'cobrar'] },
    { href: '/cuentas', ico: '💳', txt: 'Cuentas abiertas', corto: 'Cuentas', principal: true, perm: ['cuentas'] },
  ] },
  { grupo: 'Caja y dinero', items: [
    { href: '/cierre', ico: '🔒', txt: 'Cierre de caja', perm: ['cierre'] },
    { href: '/ventas', ico: '💰', txt: 'Ventas', perm: ['ventas'] },
    { href: '/reportes', ico: '📊', txt: 'Reportes', perm: ['reportes'] },
    { href: '/presupuesto', ico: '💼', txt: 'Presupuesto del mes', perm: ['presupuesto'] },
    { href: '/compras', ico: '🛒', txt: 'Compras', perm: ['compras', 'compras_editar'] },
    { href: '/proveedores', ico: '🚚', txt: 'Proveedores', perm: ['compras', 'compras_editar'] },
    { href: '/compras#costos', ico: '💲', txt: 'Costos', perm: ['compras', 'compras_editar'] },
    { href: '/gastos', ico: '🏦', txt: 'Gastos fijos', perm: ['gastos'] },
  ] },
  { grupo: 'Negocio', items: [
    { href: '/inventario', ico: '📦', txt: 'Inventario', perm: ['inventario', 'inventario_config'] },
    { href: '/productos#productos', ico: '🛠️', txt: 'Productos y precios', perm: ['productos'] },
    { href: '/productos#sabores', ico: '🍧', txt: 'Sabores', perm: ['productos'] },
    { href: '/productos#domicilios', ico: '🛵', txt: 'Domicilios', perm: ['configuracion'] },
    { href: '/productos#qr', ico: '📲', txt: 'QR de pago', perm: ['configuracion'] },
    { href: '/usuarios', ico: '👥', txt: 'Usuarios y roles', perm: ['usuarios'] },
    { href: '/usuarios#sedes', ico: '🏢', txt: 'Sedes', perm: ['sedes'] },
  ] },
];

export const permitido = (i) => !i.perm || puede(...i.perm);
// ---------- Sedes ----------
export const sedeActual = () => (yoActual.sedes || []).find((x) => x.id === yoActual.sede) || null;
export const variasSedes = () => (yoActual.sedes || []).length > 1;
export function cambiarSede(id) {
  document.cookie = `sede=${encodeURIComponent(id)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  location.reload();
}
function htmlSede(clase) {
  if (!variasSedes()) return '';
  if (yoActual.sedeFija) return `<div class="${clase} fija">🏢 <b>${esc(sedeActual()?.nombre || '')}</b></div>`;
  return `<label class="${clase}"><span>🏢</span><select aria-label="Sede">${yoActual.sedes.map((x) => `<option value="${esc(x.id)}" ${x.id === yoActual.sede ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></label>`;
}
// Aviso arriba de cada página: en qué sede se está trabajando (y cambiarla)
function montarSede() {
  if (!variasSedes() || document.querySelector('.sede-actual')) return;
  const m = document.querySelector('main'); if (!m) return;
  const d = document.createElement('div');
  d.className = 'sede-actual-wrap';
  d.innerHTML = htmlSede('sede-actual');
  m.prepend(d);
}

function montarNav({ usuario }) {
  if (document.querySelector('.nav-lateral')) return;
  montarSede();
  const ruta = location.pathname.replace(/\.html$/, '') || '/';
  const activo = (href) => {
    const [h, hash] = href.split('#');
    if (h === '/') return (ruta === '/' || ruta === '/index') && (hash ? location.hash.slice(1) === hash : location.hash !== '#usuarios');
    if (hash) return ruta === h && (location.hash.slice(1) || 'sabores') === hash;
    return ruta === h;
  };
  const secciones = SECCIONES_NAV.map((g) => ({ ...g, items: g.items.filter(permitido) })).filter((g) => g.items.length);
  const link = (i, cls = '') => `<a href="${i.href}" class="${cls} ${activo(i.href) ? 'activo' : ''}"><span class="ni">${i.ico}</span><span class="nt">${i.txt}</span></a>`;

  // Lateral (computador)
  const lateral = document.createElement('nav');
  lateral.className = 'nav-lateral';
  lateral.innerHTML = `<a href="/" class="nl-logo"><img src="/img/logo.png" alt="Enclocha 2"></a>` + htmlSede('sede-sel') +
    secciones.map((g) => `<div class="nl-grupo"><span>${g.grupo}</span>${g.items.map((i) => link(i)).join('')}</div>`).join('') +
    `<div class="nl-pie"><span>👤 ${esc(usuario)}</span><button type="button" class="nl-salir">Salir</button></div><div class="version">versión ${VERSION}</div>`;

  // Inferior (celular): 4 principales + "Más"
  const inferior = document.createElement('nav');
  inferior.className = 'nav-inferior';
  const principales = SECCIONES_NAV[0].items.filter(permitido);
  const enMas = !principales.some((i) => activo(i.href));
  inferior.style.gridTemplateColumns = `repeat(${principales.length + 1}, 1fr)`;
  inferior.innerHTML = principales.map((i) => `<a href="${i.href}" class="${activo(i.href) ? 'activo' : ''}"><span class="ni">${i.ico}</span><span class="nt">${i.corto || i.txt}</span></a>`).join('') +
    `<button type="button" class="ni-mas ${enMas ? 'activo' : ''}"><span class="ni">☰</span><span class="nt">Más</span></button>`;

  // Hoja "Más"
  const hoja = document.createElement('div');
  hoja.className = 'nav-hoja';
  hoja.innerHTML = `<div class="nh-caja"><div class="nh-asa"></div>
    ${secciones.slice(1).map((g) => `<div class="nh-grupo"><span>${g.grupo}</span><div class="nh-grid">${g.items.map((i) => link(i, 'nh-item')).join('')}</div></div>`).join('')}
    <div class="nh-pie"><span>👤 ${esc(usuario)}</span><button type="button" class="nl-salir">Cerrar sesión</button></div><div class="version">versión ${VERSION}</div></div>`;

  document.body.append(lateral, inferior, hoja);
  document.body.classList.add('con-nav');
  inferior.querySelector('.ni-mas').addEventListener('click', () => hoja.classList.add('show'));
  hoja.addEventListener('click', (e) => { if (e.target === hoja) hoja.classList.remove('show'); });
  document.querySelectorAll('.nl-salir').forEach((b) => b.addEventListener('click', salir));
  document.querySelectorAll('.sede-sel select, .sede-actual select').forEach((sel) => sel.addEventListener('change', () => cambiarSede(sel.value)));
  window.addEventListener('hashchange', () => {
    document.querySelectorAll('.nav-lateral a, .nh-item').forEach((a) => a.classList.toggle('activo', activo(a.getAttribute('href'))));
    hoja.classList.remove('show');
  });
}

// ---------- Aviso compacto del presupuesto del mes (Compras, Gastos fijos) ----------
export async function bannerPresupuesto(el, mes) {
  try {
    const r = await api(`/api/compras?r=presupuesto&mes=${mes}`);
    const p = r.presupuesto.monto, s = r.resumen;
    const pesos = (n) => '$' + Number(n || 0).toLocaleString('es-CO');
    if (!p) { el.innerHTML = `<a href="/presupuesto" class="pres-mini sin">💼 Aún no definiste el presupuesto de este mes · <b>Definir →</b></a>`; return r; }
    const pct = Math.min(100, Math.round((s.delPresupuesto / p) * 100));
    const estado = s.deVentas > 0 ? 'agotado' : pct >= 80 ? 'alerta' : 'ok';
    el.innerHTML = `<a href="/presupuesto" class="pres-mini ${estado}">
      <span>💼 ${s.deVentas > 0 ? `<b>Presupuesto agotado</b> · ya van <b>${pesos(s.deVentas)}</b> con plata de las ventas` : `Presupuesto del mes: quedan <b>${pesos(s.queda)}</b> de ${pesos(p)}`}</span>
      <span class="pres-barra"><i style="width:${pct}%"></i></span></a>`;
    return r;
  } catch { el.innerHTML = ''; return null; }
}

// ---------- Ajustes para celular ----------
// 1) Tablas: cada celda recibe el nombre de su columna (data-label) para que en celular
//    cada fila se vea como una tarjetica (ver .tabla.apilar en styles.css).
function etiquetarTabla(t) {
  if (t.classList.contains('roles-tabla')) return;
  const ths = [...t.querySelectorAll('thead th')];
  if (ths.length < 3) { t.classList.remove('apilar'); return; }
  const nombres = []; ths.forEach((th) => { for (let k = 0; k < (th.colSpan || 1); k++) nombres.push(th.textContent.trim()); });
  t.classList.add('apilar');
  t.querySelectorAll('tbody tr, tfoot tr').forEach((tr) => {
    let i = 0;
    [...tr.children].forEach((td) => {
      if (td.colSpan > 1) td.classList.add('ancha');
      else if (nombres[i] && !td.hasAttribute('data-label')) {
        td.setAttribute('data-label', nombres[i]);
        // todo el contenido en un solo bloque, para que quede alineado a la derecha del nombre
        if (td.childNodes.length > 1 && !td.querySelector(':scope > .v')) { const v = document.createElement('div'); v.className = 'v'; v.append(...td.childNodes); td.append(v); }
      }
      i += td.colSpan || 1;
    });
  });
}
// 2) Botones del encabezado: en celular solo se ve el ícono (el texto queda como ayuda)
function compactarEncabezado() {
  document.querySelectorAll('header.top > .row:last-child > a, header.top > .row:last-child > button').forEach((b) => {
    if (b.children.length) return;
    const m = b.textContent.trim().match(/^(\S+)\s+(.+)$/);
    if (!m || /[\p{L}\p{N}+]/u.test(m[1])) return; // solo si empieza con un emoji
    b.title = b.title || m[2];
    b.innerHTML = `${m[1]}<span class="txt"> ${m[2]}</span>`;
  });
}
if (typeof document !== 'undefined') {
  let pendiente = false;
  const revisar = () => {
    if (pendiente) return; pendiente = true;
    requestAnimationFrame(() => { pendiente = false; document.querySelectorAll('table.tabla').forEach(etiquetarTabla); compactarEncabezado(); });
  };
  const iniciar = () => { revisar(); new MutationObserver(revisar).observe(document.body, { childList: true, subtree: true }); };
  if (document.body) iniciar(); else document.addEventListener('DOMContentLoaded', iniciar);
}

// ---------- Pago dividido (cuenta de varias personas) ----------
// Abre una ventana para repartir el total: cada persona paga su parte en efectivo o transferencia.
// Devuelve una promesa con las partes [{ quien, valor, metodo }] o null si se cancela.
const $p = (n) => '$' + Math.round(n).toLocaleString('es-CO');
export function dividirPago({ total, nombre = '' }) {
  return new Promise((resolver) => {
    let partes = [];
    // Partes iguales. Si el total no se puede dividir exacto, se reparte en múltiplos de $50
    // (la moneda más pequeña) y la diferencia entre personas queda en máximo $50.
    const igual = (n) => {
      const base = Math.floor(total / n / 50) * 50;
      let resto = total - base * n;
      partes = Array.from({ length: n }, () => ({ quien: '', valor: base, metodo: 'efectivo' }));
      for (let i = n - 1; resto >= 50; i = (i - 1 + n) % n) { partes[i].valor += 50; resto -= 50; }
      partes[n - 1].valor += resto; // lo que sobre (menos de $50) va a la última persona
    };
    igual(2);
    const m = document.createElement('div');
    m.className = 'modal show modal-dividir';
    m.innerHTML = `<div class="box">
      <h3>➗ Dividir la cuenta${nombre ? ' de ' + esc(nombre) : ''}</h3>
      <div class="total" style="margin:0"><span>Total</span><span>${$p(total)}</span></div>
      <div class="div-rapido">
        <label for="divN">¿Entre cuántas personas?</label>
        <input class="field" id="divN" type="number" inputmode="numeric" min="1" max="30" value="2">
        <button type="button" id="divIgual">Dividir igual</button>
      </div>
      <p class="hint" style="margin:-4px 0 8px">Después puedes cambiar el valor de cada persona.</p>
      <div class="div-partes" id="divPartes"></div>
      <button type="button" class="btn ghost" id="divMas" style="margin:0">+ Otra persona</button>
      <div class="div-estado" id="divEstado"></div>
      <div id="divQR"></div>
      <button type="button" class="btn" id="divOk">Cobrar</button>
      <button type="button" class="btn ghost" id="divNo">Cancelar</button>
    </div>`;
    document.body.appendChild(m);
    const q = (s) => m.querySelector(s);
    const cerrar = (r) => { m.remove(); resolver(r); };
    function estado() {
      const suma = partes.reduce((s, x) => s + (x.valor || 0), 0), dif = total - suma;
      const ef = partes.filter((x) => x.metodo === 'efectivo').reduce((s, x) => s + (x.valor || 0), 0);
      const tr = suma - ef;
      q('#divEstado').innerHTML = `<span>💵 Efectivo <b>${$p(ef)}</b></span><span>📲 Transferencia <b>${$p(tr)}</b></span>` +
        (dif === 0 ? '<span class="ok">✅ Cuadra</span>' : dif > 0 ? `<span class="falta">Faltan ${$p(dif)}</span>` : `<span class="falta">Sobran ${$p(-dif)}</span>`);
      const listo = dif === 0 && partes.every((x) => x.valor > 0);
      q('#divOk').disabled = !listo;
      q('#divOk').textContent = listo ? `Cobrar ${$p(total)}` : 'Cobrar (las partes deben sumar el total)';
      if (tr > 0) leerQR().then((a) => { if (m.isConnected) q('#divQR').innerHTML = htmlQR(a, $p(tr)); }); else q('#divQR').innerHTML = '';
    }
    function pintar() {
      q('#divPartes').innerHTML = partes.map((x, i) => `<div class="div-fila">
        <input class="field" data-i="${i}" data-k="quien" placeholder="Persona ${i + 1}" value="${esc(x.quien)}" maxlength="40">
        <div class="precio"><span>$</span><input class="field" type="number" inputmode="numeric" min="0" step="100" data-i="${i}" data-k="valor" value="${x.valor || ''}"></div>
        <div class="div-met"><button type="button" class="${x.metodo === 'efectivo' ? 'on' : ''}" data-i="${i}" data-met="efectivo" title="Efectivo">💵</button><button type="button" class="${x.metodo === 'transferencia' ? 'on' : ''}" data-i="${i}" data-met="transferencia" title="Transferencia">📲</button></div>
        ${partes.length > 1 ? `<button type="button" class="del" data-quitar="${i}" title="Quitar">✕</button>` : ''}
      </div>`).join('');
      estado();
    }
    m.addEventListener('keydown', (e) => { if (e.target.id === 'divN' && e.key === 'Enter') { e.preventDefault(); q('#divIgual').click(); } });
    m.addEventListener('input', (e) => {
      const el = e.target, i = Number(el.dataset.i); if (!partes[i]) return;
      partes[i][el.dataset.k] = el.dataset.k === 'valor' ? Math.max(0, Math.round(Number(el.value) || 0)) : el.value;
      estado();
    });
    m.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'divIgual') { const n = Math.min(30, Math.max(1, Math.round(Number(q('#divN').value) || 1))); q('#divN').value = n; igual(n); return pintar(); }
      if (b.dataset.met) { partes[Number(b.dataset.i)].metodo = b.dataset.met; return pintar(); }
      if (b.dataset.quitar) { partes.splice(Number(b.dataset.quitar), 1); return pintar(); }
      if (b.id === 'divMas') {
        const falta = total - partes.reduce((s, x) => s + (x.valor || 0), 0);
        partes.push({ quien: '', valor: Math.max(0, falta), metodo: 'efectivo' }); return pintar();
      }
      if (b.id === 'divNo') return cerrar(null);
      if (b.id === 'divOk' && !b.disabled) return cerrar(partes.map((x, i) => ({ quien: x.quien.trim() || `Persona ${i + 1}`, valor: x.valor, metodo: x.metodo })));
    });
    pintar();
  });
}
// Texto corto de cómo se pagó (para mostrar en tarjetas)
export function textoPago(pg, total) {
  if (pg?.metodo !== 'mixto' && !pg?.partes?.length) return null;
  const ef = pg.metodo === 'mixto' ? pg.efectivo || 0 : pg.metodo === 'efectivo' ? total : 0;
  const det = pg.partes?.length ? ' · ' + pg.partes.map((x) => `${x.quien}: ${x.metodo === 'efectivo' ? '💵' : '📲'} ${$p(x.valor)}`).join(', ') : '';
  return `➗ Dividido: 💵 ${$p(ef)} + 📲 ${$p(total - ef)}${det}`;
}
