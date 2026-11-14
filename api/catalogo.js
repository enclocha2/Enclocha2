import { normalizarConfig } from '../catalog.js';
import { configActual, guardarConfig } from './_lib/store.js';
import { sesion } from './_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const yo = await sesion(req);
  if (!yo) return res.status(401).json({ error: 'Inicia sesión' });
  const usuario = yo.usuario;

  try {
    const actual = await configActual();

    if (req.method === 'GET') {
      return res.status(200).json({ config: actual, admin: yo.puede('productos') });
    }

    if (req.method === 'PUT') {
      if (!yo.puede('productos')) return res.status(403).json({ error: 'No tienes permiso para cambiar productos' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      if (body.version !== actual.version) {
        return res.status(409).json({ error: 'Alguien más cambió los productos mientras editabas. Recarga la página.' });
      }
      let nueva;
      try { nueva = normalizarConfig(body.config); }
      catch (e) { return res.status(400).json({ error: e.message }); }
      nueva.version = (actual.version || 1) + 1;
      nueva.migraciones = actual.migraciones || [];
      nueva.actualizadoPor = usuario;
      nueva.actualizado = Date.now();
      await guardarConfig(nueva);
      return res.status(200).json({ config: nueva });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
