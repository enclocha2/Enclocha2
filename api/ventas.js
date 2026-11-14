import { usuarioDe, esAdmin } from './_lib/auth.js';
import { ventasEntre, leerResumen, migrarVentas } from './_lib/store.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86400000;

// GET /api/ventas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD  → ventas detalladas (hora Colombia)
// GET /api/ventas?resumen=1                          → totales por día (todo el historial)
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const usuario = usuarioDe(req);
  if (!usuario) return res.status(401).json({ error: 'Inicia sesión' });
  if (!esAdmin(usuario)) return res.status(403).json({ error: 'No tienes permiso para ver las ventas' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  try {
    await migrarVentas();
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);

    if (q.resumen) return res.status(200).json({ dias: await leerResumen() });

    if (!FECHA.test(q.desde || '') || !FECHA.test(q.hasta || '')) return res.status(400).json({ error: 'Fechas inválidas' });
    const ini = Date.parse(`${q.desde}T00:00:00-05:00`);
    const fin = Date.parse(`${q.hasta}T23:59:59.999-05:00`);
    if (!(fin >= ini)) return res.status(400).json({ error: 'La fecha final es anterior a la inicial' });
    if (fin - ini > 190 * DIA_MS) return res.status(400).json({ error: 'Escoge un rango de máximo 6 meses' });

    return res.status(200).json({ ventas: await ventasEntre(ini, fin) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
