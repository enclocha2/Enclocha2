import { usuarioDe, esAdmin } from './_lib/auth.js';
import { leerAjustes, guardarAjustes } from './_lib/store.js';

const MAX_QR = 900 * 1024; // ~900 KB (la imagen se reduce en el navegador antes de subirla)

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const usuario = usuarioDe(req);
  if (!usuario) return res.status(401).json({ error: 'Inicia sesión' });

  try {
    if (req.method === 'GET') {
      const a = await leerAjustes();
      return res.status(200).json({ qr: a.qr || null, qrTexto: a.qrTexto || '' });
    }

    if (req.method === 'PUT') {
      if (!esAdmin(usuario)) return res.status(403).json({ error: 'No tienes permiso' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const actual = await leerAjustes();
      const nuevo = { ...actual };

      if ('qr' in body) {
        if (body.qr === null) delete nuevo.qr;
        else {
          if (typeof body.qr !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(body.qr)) {
            return res.status(400).json({ error: 'La imagen del QR no es válida' });
          }
          if (body.qr.length > MAX_QR) return res.status(400).json({ error: 'La imagen es muy pesada' });
          nuevo.qr = body.qr;
        }
      }
      if ('qrTexto' in body) nuevo.qrTexto = String(body.qrTexto || '').slice(0, 160).trim();

      nuevo.actualizadoPor = usuario;
      nuevo.actualizado = Date.now();
      await guardarAjustes(nuevo);
      return res.status(200).json({ ok: true, qr: nuevo.qr || null, qrTexto: nuevo.qrTexto || '' });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
