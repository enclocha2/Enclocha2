import { sesion } from './_lib/auth.js';
import { leerAjustes, guardarAjustes } from './_lib/store.js';

export const DOM_DEFECTO = { activo: false, soloEnHorario: true, minimo: 0, mensaje: '', whatsapp: '', local: null, tarifas: [], zonas: [] };
const MAX_QR = 900 * 1024; // ~900 KB (la imagen se reduce en el navegador antes de subirla)

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const yo = await sesion(req);
  if (!yo) return res.status(401).json({ error: 'Inicia sesión' });
  const usuario = yo.usuario;

  try {
    if (req.method === 'GET') {
      const a = await leerAjustes();
      return res.status(200).json({ qr: a.qr || null, qrTexto: a.qrTexto || '', domicilio: { ...DOM_DEFECTO, ...(a.domicilio || {}) } });
    }

    if (req.method === 'PUT') {
      if (!yo.puede('configuracion')) return res.status(403).json({ error: 'No tienes permiso para cambiar domicilios ni el QR' });
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
      if (body.domicilio && typeof body.domicilio === 'object') {
        const d = body.domicilio;
        const lat = Number(d.local?.lat), lng = Number(d.local?.lng);
        nuevo.domicilio = {
          activo: !!d.activo,
          soloEnHorario: d.soloEnHorario !== false,
          minimo: Math.max(0, Math.round(Number(d.minimo) || 0)),
          mensaje: String(d.mensaje || '').slice(0, 200).trim(),
          whatsapp: String(d.whatsapp || '').replace(/[^0-9]/g, '').slice(0, 15),
          local: Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng) ? { lat, lng } : null,
          tarifas: (Array.isArray(d.tarifas) ? d.tarifas : []).slice(0, 12)
            .map((t) => ({ hastaKm: Math.round(Math.max(0, Number(t.hastaKm) || 0) * 10) / 10, valor: Math.max(0, Math.round(Number(t.valor) || 0)) }))
            .filter((t) => t.hastaKm > 0).sort((a, b) => a.hastaKm - b.hastaKm),
          zonas: (Array.isArray(d.zonas) ? d.zonas : []).slice(0, 100)
            .map((z) => ({ nombre: String(z.nombre || '').trim().slice(0, 50), valor: Math.max(0, Math.round(Number(z.valor) || 0)) }))
            .filter((z) => z.nombre),
        };
      }

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
