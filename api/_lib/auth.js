// Usuarios, sesiones, roles y permisos.
// Los usuarios viven en la base de datos (clave "usuarios"), con la contraseña cifrada (scrypt).
// La primera vez se crean solos a partir de la variable USUARIOS (o los de fábrica).
import crypto from 'node:crypto';
import { Redis } from '@upstash/redis';
import { ROLES, TODOS_PERMISOS, permisosDe, normalizarRoles, slug } from '../../catalog.js';

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;
const mem = globalThis.__granizadosAuth || (globalThis.__granizadosAuth = { usuarios: null, roles: null });

const POR_DEFECTO = 'Stiv:Stiv2026*,Angel:Angel2026*,John:John2026*,Fofi:Fofi2026*';
const FUENTE = process.env.USUARIOS || POR_DEFECTO;
const SECRETO = process.env.AUTH_SECRET || crypto.createHash('sha256').update('granizados|' + FUENTE).digest('hex');
const DURACION = 60 * 60 * 14; // 14 horas (un turno)

// ---------- Contraseñas ----------
export function cifrar(clave) {
  const sal = crypto.randomBytes(16).toString('hex');
  return `${sal}:${crypto.scryptSync(String(clave), sal, 32).toString('hex')}`;
}
function claveOk(clave, guardada) {
  const [sal, h] = String(guardada || '').split(':');
  if (!sal || !h) return false;
  const a = crypto.scryptSync(String(clave || ''), sal, 32), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Usuarios y roles en la base de datos (con caché de 30 s para no gastar operaciones) ----------
// Se leen juntos en UNA sola operación (mget). Si no hay roles guardados se usan los de fábrica.
let cache = { lista: null, roles: null, en: 0 };
function sembrar() {
  // Primera vez: usuarios de la variable USUARIOS (o de fábrica). Si existe ADMINS, solo esos son administradores.
  const admins = (process.env.ADMINS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  return FUENTE.split(',').map((par) => {
    const i = par.indexOf(':');
    if (i < 1) return null;
    const usuario = par.slice(0, i).trim(), clave = par.slice(i + 1).trim();
    if (!usuario || !clave) return null;
    return {
      id: slug(usuario), usuario, nombre: usuario,
      rol: !admins.length || admins.includes(usuario.toLowerCase()) ? 'admin' : 'cajero',
      permisos: null, activo: true, hash: cifrar(clave), ver: 1, creado: Date.now(),
    };
  }).filter(Boolean);
}
async function leerTodo(forzar) {
  if (!forzar && cache.lista && cache.roles && Date.now() - cache.en < 30000) return cache;
  let lista, roles;
  if (redis) [lista, roles] = await redis.mget('usuarios', 'roles');
  else { lista = mem.usuarios; roles = mem.roles; }
  if (!lista) {
    lista = sembrar();
    if (redis) { const ok = await redis.set('usuarios', lista, { nx: true }); if (ok !== 'OK') lista = await redis.get('usuarios'); }
    else mem.usuarios = structuredClone(lista);
  }
  cache = { lista, roles: normalizarRoles(roles), en: Date.now() };
  return cache;
}
export async function leerUsuarios(forzar = false) { return structuredClone((await leerTodo(forzar)).lista); }
export async function leerRoles(forzar = false) { return structuredClone((await leerTodo(forzar)).roles); }
export async function guardarUsuarios(lista) {
  if (redis) await redis.set('usuarios', lista); else mem.usuarios = structuredClone(lista);
  cache = { ...cache, lista: structuredClone(lista), en: cache.roles ? Date.now() : 0 };
  return lista;
}
export async function guardarRoles(roles) {
  const limpios = normalizarRoles(roles);
  if (redis) await redis.set('roles', limpios); else mem.roles = structuredClone(limpios);
  cache = { ...cache, roles: structuredClone(limpios), en: cache.lista ? Date.now() : 0 };
  return limpios;
}
export const publico = (u, roles) => ({
  id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, permisos: u.permisos ?? null,
  efectivos: permisosDe(u, roles), sede: u.sede || '', activo: u.activo !== false, ultimoIngreso: u.ultimoIngreso || null, creado: u.creado || null,
});

// ---------- Sesión ----------
const b64 = (s) => Buffer.from(s).toString('base64url');
const hmac = (s) => crypto.createHmac('sha256', SECRETO).update(s).digest('base64url');
export function firmar(u) {
  const datos = b64(JSON.stringify({ i: u.id, v: u.ver || 1, exp: Date.now() + DURACION * 1000 }));
  return `${datos}.${hmac(datos)}`;
}
function leerToken(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [datos, firma] = tok.split('.');
  const esperada = hmac(datos);
  if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  try { const d = JSON.parse(Buffer.from(datos, 'base64url').toString()); return Date.now() > d.exp ? null : d; } catch { return null; }
}
export function leerCookie(req, nombre) {
  for (const parte of (req.headers?.cookie || '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return null;
}

// Quién está conectado: { usuario, nombre, rol, permisos, puede(p) } o null.
// Si al usuario lo desactivan o le cambian la clave, su sesión deja de servir.
export async function sesion(req) {
  const d = leerToken(leerCookie(req, 'sesion'));
  if (!d?.i) return null;
  const { lista, roles } = await leerTodo(false);
  const u = lista.find((x) => x.id === d.i);
  if (!u || u.activo === false || (u.ver || 1) !== d.v) return null;
  const permisos = permisosDe(u, roles);
  return { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, sede: u.sede || '', permisos, puede: (...ps) => ps.some((p) => permisos.includes(p)) };
}

export function cookieSesion(req, tok) {
  const local = /^localhost|^127\./.test(req.headers?.host || '');
  const base = `sesion=${tok}; Path=/; HttpOnly; SameSite=Lax${local ? '' : '; Secure'}`;
  return tok ? `${base}; Max-Age=${DURACION}` : `${base}; Max-Age=0`;
}

// Valida usuario + clave. Devuelve el usuario o null.
export async function validar(usuario, clave) {
  const u = (await leerUsuarios(true)).find((x) => x.usuario.toLowerCase() === String(usuario || '').trim().toLowerCase());
  if (!u || u.activo === false || !claveOk(clave, u.hash)) return null;
  return u;
}

export { ROLES, TODOS_PERMISOS };
export { permisosDe };
