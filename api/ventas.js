import { sesion } from './_lib/auth.js';
import estadisticas from './_lib/estadisticas.js';
import { ventasEntre, leerResumen, migrarVentas, recalcularResumenJornadas } from './_lib/store.js';
import { inicioJornada, finJornada } from '../fechas.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86400000;

// GET /api/ventas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD  → ventas de esas JORNADAS (cada una va de 6 a. m. a 5:59 a. m.)
// GET /api/ventas?resumen=1                          → totales por día (todo el historial)
// Vercel Hobby permite máximo 12 funciones: /api/ventas?r=estadisticas atiende las estadísticas mensuales
const ruta = (req) => req.query?.r ?? new URL(req.url, 'http://x').searchParams.get('r');

export default async function handler(req, res) {
  if (ruta(req) === 'estadisticas') return estadisticas(req, res);
  res.setHeader('Cache-Control', 'no-store');
  const yo = await sesion(req);
  if (!yo) return res.status(401).json({ error: 'Inicia sesión' });
  if (!yo.puede('ventas', 'reportes', 'presupuesto')) return res.status(403).json({ error: 'No tienes permiso para ver las ventas' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  try {
    await migrarVentas();
    await recalcularResumenJornadas();
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);

    if (q.resumen) return res.status(200).json({ dias: await leerResumen() });

    if (!FECHA.test(q.desde || '') || !FECHA.test(q.hasta || '')) return res.status(400).json({ error: 'Fechas inválidas' });
    const ini = inicioJornada(q.desde);
    const fin = finJornada(q.hasta);
    if (!(fin >= ini)) return res.status(400).json({ error: 'La fecha final es anterior a la inicial' });
    if (fin - ini > 190 * DIA_MS) return res.status(400).json({ error: 'Escoge un rango de máximo 6 meses' });

    return res.status(200).json({ ventas: await ventasEntre(ini, fin) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
