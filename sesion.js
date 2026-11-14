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
