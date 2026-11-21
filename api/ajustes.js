import { sesion } from './_lib/auth.js';
import { esStiv } from '../catalog.js';
import { leerAjustes, guardarAjustes, leerDiasCerrados, guardarDiasCerrados } from './_lib/store.js';
import { conSede } from './_lib/sede.js';

export const DOM_DEFECTO = { activo: false, soloEnHorario: true, minimo: 0, mensaje: '', whatsapp: '', local: null, tarifas: [], zonas: [] };
const MAX_QR = 900 * 1024; // ~900 KB (la imagen se reduce en el navegador antes de subirla)

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const yo = await sesion(req);
  if (!yo) return res.status(401).json({ error: 'Inicia sesión' });
  const usuario = yo.usuario;

  try {
    // Días que no se trabaja: { dia: 'AAAA-MM-DD', cerrado: true|false }
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    if (q.r === 'dias') {
      if (req.method === 'GET') return res.status(200).json({ dias: await leerDiasCerrados() });
      if (req.method === 'PUT') {
        if (!yo.puede('configuracion', 'cierre')) return res.status(403).json({ error: 'No tienes permiso para cerrar días' });
        const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
        if (!/^\d{4}-\d{2}-\d{2}$/.test(b.dia || '')) return res.status(400).json({ error: 'Fecha no válida' });
        const l = await leerDiasCerrados();
        return res.status(200).json({ dias: await guardarDiasCerrados(b.cerrado ? [...l, b.dia] : l.filter((d) => d !== b.dia)) });
      }
    }

    if (req.method === 'GET') {
      const a = await leerAjustes();
      return res.status(200).json({ sinStock: !!a.sinStock && esStiv(usuario), qr: a.qr || null, qrTexto: a.qrTexto || '', qrDePrincipal: !!a.qrDePrincipal, domicilio: { ...DOM_DEFECTO, ...(a.domicilio || {}) } });
    }

    // Vender sin inventario: solo Stiv lo prende o lo apaga, y solo le aplica a él
    if (q.r === 'sinstock' && req.method === 'PUT') {
      if (!esStiv(usuario)) return res.status(403).json({ error: 'Solo Stiv puede cambiar esta opción' });
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const a = await leerAjustes();
      await guardarAjustes({ ...a, sinStock: !!b.activo });
      return res.status(200).json({ sinStock: !!b.activo });
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

export default conSede(handler);
