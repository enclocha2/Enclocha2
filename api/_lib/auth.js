// Usuarios y sesiones.
// Las claves se pueden cambiar SIN tocar código con la variable de entorno
// USUARIOS en Vercel, con este formato:  Stiv:clave1,Angel:clave2,John:clave3,Fofi:clave4
import crypto from 'node:crypto';

const POR_DEFECTO = 'Stiv:Stiv2026*,Angel:Angel2026*,John:John2026*,Fofi:Fofi2026*';
const FUENTE = process.env.USUARIOS || POR_DEFECTO;
const SECRETO = process.env.AUTH_SECRET || crypto.createHash('sha256').update('granizados|' + FUENTE).digest('hex');
const DURACION = 60 * 60 * 14; // 14 horas (un turno)

export function usuarios() {
  const lista = {};
  for (const par of FUENTE.split(',')) {
    const i = par.indexOf(':');
    if (i < 1) continue;
    const u = par.slice(0, i).trim();
    const c = par.slice(i + 1).trim();
    if (u && c) lista[u] = c;
  }
  return lista;
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const hmac = (s) => crypto.createHmac('sha256', SECRETO).update(s).digest('base64url');

export function firmar(usuario) {
  const datos = b64(JSON.stringify({ u: usuario, exp: Date.now() + DURACION * 1000 }));
  return `${datos}.${hmac(datos)}`;
}

function verificar(token) {
  if (!token || !token.includes('.')) return null;
  const [datos, firma] = token.split('.');
  const esperada = hmac(datos);
  if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(datos, 'base64url').toString());
    if (Date.now() > exp || !(u in usuarios())) return null; // si cambian la clave/usuario, se invalida
    return u;
  } catch { return null; }
}

function leerCookie(req, nombre) {
  const raw = req.headers?.cookie || '';
  for (const parte of raw.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return null;
}

export const usuarioDe = (req) => verificar(leerCookie(req, 'sesion'));

export function cookieSesion(req, token) {
  const local = /^localhost|^127\./.test(req.headers?.host || '');
  const base = `sesion=${token}; Path=/; HttpOnly; SameSite=Lax${local ? '' : '; Secure'}`;
  return token ? `${base}; Max-Age=${DURACION}` : `${base}; Max-Age=0`;
}

// Compara usuario (sin importar mayúsculas) y clave. Devuelve el nombre oficial o null.
export function validar(usuario, clave) {
  const lista = usuarios();
  const nombre = Object.keys(lista).find((u) => u.toLowerCase() === String(usuario || '').trim().toLowerCase());
  if (!nombre) return null;
  const a = Buffer.from(String(clave || ''));
  const b = Buffer.from(lista[nombre]);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? nombre : null;
}

// Quién puede editar productos/precios. Variable ADMINS en Vercel, ej: "Stiv,John".
// Si no existe, todos los usuarios pueden editar.
export function esAdmin(usuario) {
  const admins = (process.env.ADMINS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  return !!usuario && (!admins.length || admins.includes(usuario.toLowerCase()));
}
