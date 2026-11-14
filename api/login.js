import { validar, firmar, usuarioDe, cookieSesion } from './_lib/auth.js';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // ¿Quién está conectado?
  if (req.method === 'GET') {
    const usuario = usuarioDe(req);
    return usuario ? res.status(200).json({ usuario }) : res.status(401).json({ error: 'Sin sesión' });
  }

  // Iniciar sesión
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const usuario = validar(body.usuario, body.clave);
    if (!usuario) {
      await esperar(700); // frena intentos a lo loco
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    res.setHeader('Set-Cookie', cookieSesion(req, firmar(usuario)));
    return res.status(200).json({ usuario });
  }

  // Cerrar sesión
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', cookieSesion(req, ''));
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Método no permitido' });
}
