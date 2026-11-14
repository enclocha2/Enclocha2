import { randomUUID } from 'node:crypto';
import { usuarioDe, esAdmin } from './_lib/auth.js';
import { leerGastosFijos, guardarGastosFijos, leerPagosFijos, guardarPagosFijos, pagosFijosAnio } from './_lib/store.js';
import { CATEGORIAS_FIJO, PERIODOS_FIJO, slug } from '../catalog.js';

const MES = /^\d{4}-\d{2}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const txt = (s, n) => String(s ?? '').trim().slice(0, n);
const leer = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const usuario = usuarioDe(req);
  if (!usuario) return res.status(401).json({ error: 'Inicia sesión' });
  if (!esAdmin(usuario)) return res.status(403).json({ error: 'No tienes permiso para ver los gastos fijos' });
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);

  try {
    // GET ?mes=YYYY-MM  → definiciones + pagos del mes
    // GET ?anio=YYYY    → pagos de los 12 meses (para reportes)
    if (req.method === 'GET') {
      if (q.anio && /^\d{4}$/.test(q.anio)) return res.status(200).json({ porMes: await pagosFijosAnio(q.anio) });
      if (!MES.test(q.mes || '')) return res.status(400).json({ error: 'Mes inválido' });
      const [gastos, pagos] = await Promise.all([leerGastosFijos(), leerPagosFijos(q.mes)]);
      return res.status(200).json({ gastos, pagos });
    }

    // PUT { gastos: [...] } → guarda la lista de gastos fijos
    if (req.method === 'PUT') {
      const b = leer(req);
      if (!Array.isArray(b.gastos) || b.gastos.length > 100) return res.status(400).json({ error: 'Lista inválida' });
      const ids = new Set();
      const gastos = b.gastos.map((g) => {
        const nombre = txt(g.nombre, 60);
        if (!nombre) throw Object.assign(new Error('Hay un gasto sin nombre'), { status: 400 });
        let id = /^[a-z0-9-]{1,48}$/.test(g.id || '') ? g.id : slug(nombre);
        while (ids.has(id)) id += '-2';
        ids.add(id);
        return {
          id, nombre,
          categoria: CATEGORIAS_FIJO.some((c) => c.id === g.categoria) ? g.categoria : 'otros',
          valor: Math.max(0, Math.round(Number(g.valor) || 0)),
          periodo: PERIODOS_FIJO.some((p) => p.id === g.periodo) ? g.periodo : 'mensual',
          dia: Math.min(Math.max(Math.round(Number(g.dia) || 1), 1), 31),
          activo: g.activo !== false,
          nota: txt(g.nota, 120),
        };
      });
      await guardarGastosFijos(gastos);
      return res.status(200).json({ gastos });
    }

    // POST { mes, pago: { gastoId, fecha, valor, metodo, nota } } → registrar un pago
    if (req.method === 'POST') {
      const b = leer(req);
      if (!MES.test(b.mes || '')) return res.status(400).json({ error: 'Mes inválido' });
      const p = b.pago || {};
      const gastos = await leerGastosFijos();
      const g = gastos.find((x) => x.id === p.gastoId);
      if (!g) return res.status(404).json({ error: 'Gasto no encontrado' });
      const valor = Math.round(Number(p.valor));
      if (!(valor > 0)) return res.status(400).json({ error: 'Escribe el valor pagado' });
      if (!FECHA.test(p.fecha || '')) return res.status(400).json({ error: 'Fecha inválida' });
      const pagos = await leerPagosFijos(b.mes);
      const pago = {
        id: randomUUID(), gastoId: g.id, nombre: g.nombre, categoria: g.categoria, fecha: p.fecha, valor,
        metodo: ['caja', 'transferencia', 'otro'].includes(p.metodo) ? p.metodo : 'transferencia',
        nota: txt(p.nota, 120), registradoPor: usuario, creado: Date.now(),
      };
      pagos.push(pago);
      await guardarPagosFijos(b.mes, pagos);
      return res.status(201).json({ pago });
    }

    // DELETE ?mes=YYYY-MM&id=pagoId
    if (req.method === 'DELETE') {
      if (!MES.test(q.mes || '')) return res.status(400).json({ error: 'Mes inválido' });
      const pagos = await leerPagosFijos(q.mes);
      await guardarPagosFijos(q.mes, pagos.filter((p) => p.id !== q.id));
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, PUT, POST, DELETE');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message });
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
