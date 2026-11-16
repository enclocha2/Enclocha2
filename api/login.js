import { validar, firmar, sesion, cookieSesion, leerUsuarios, guardarUsuarios } from './_lib/auth.js';
import { limitar } from './_lib/store.js';
import { sedesCache, resolverSede } from './_lib/sede.js';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const ip = (req) => String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);

  if (req.method === 'GET') {
    // Botones del login: solo los nombres de usuario activos
    // Ya no se muestra la lista de usuarios en el login (por seguridad no se publica)
    if (q.lista) return res.status(200).json({ usuarios: [] });
    const yo = await sesion(req);
    if (!yo) return res.status(401).json({ error: 'Sin sesión' });
    const sedes = (await sedesCache()).filter((s) => s.activa !== false || s.id === yo.sede).map(({ id, nombre, principal }) => ({ id, nombre, principal: !!principal }));
    return res.status(200).json({ usuario: yo.usuario, nombre: yo.nombre, rol: yo.rol, permisos: yo.permisos, admin: yo.rol === 'admin',
      sede: await resolverSede(req), sedeFija: !!yo.sede, sedes });
  }

  if (req.method === 'POST') {
    if (!(await limitar(`login:${ip(req)}`, 15, 600))) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const u = await validar(body.usuario, body.clave);
    if (!u) { await esperar(700); return res.status(401).json({ error: 'Usuario o contraseña incorrectos' }); }
    // registrar último ingreso
    const lista = structuredClone(await leerUsuarios(true));
    const x = lista.find((y) => y.id === u.id);
    if (x) { x.ultimoIngreso = Date.now(); await guardarUsuarios(lista); }
    res.setHeader('Set-Cookie', cookieSesion(req, firmar(u)));
    return res.status(200).json({ usuario: u.usuario });
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', cookieSesion(req, ''));
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Método no permitido' });
}
