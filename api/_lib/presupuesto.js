// Presupuesto mensual para compras.
// Cada mes arranca con un presupuesto; las compras y los gastos de caja (anotados en el
// cierre) lo van gastando en orden de fecha. Cuando se agota, lo demás sale de las ventas
// del mismo mes. Los gastos fijos NO usan el presupuesto: siempre se pagan con las ventas.
import { sesion } from './auth.js';
import { leerPresupuesto, guardarPresupuesto, leerPresupuestoBase, guardarPresupuestoBase,
  comprasEntre, leerPagosFijos, listarCierres, leerResumen } from './store.js';
import { finMes } from '../../fechas.js';
import { saleDeCaja } from '../../catalog.js';

const MES = /^\d{4}-\d{2}$/;
const leer = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});

async function presupuestoDe(mes) {
  const propio = await leerPresupuesto(mes);
  if (propio) return { ...propio, origen: 'mes' };
  const base = await leerPresupuestoBase();
  if (base?.repetir && base.monto) return { monto: base.monto, nota: '', origen: 'automatico' };
  return { monto: 0, nota: '', origen: 'sin-definir' };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const yo = await sesion(req);
  if (!yo) return res.status(401).json({ error: 'Inicia sesión' });
  const usuario = yo.usuario;
  if (!yo.puede('presupuesto')) return res.status(403).json({ error: 'No tienes permiso para ver el presupuesto' });
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);

  try {
    if (req.method === 'GET') {
      if (!MES.test(q.mes || '')) return res.status(400).json({ error: 'Mes inválido' });
      const desde = `${q.mes}-01`, hasta = finMes(desde);
      const [presupuesto, base, compras, pagos, cierres, resumen] = await Promise.all([
        presupuestoDe(q.mes), leerPresupuestoBase(), comprasEntre(desde, hasta), leerPagosFijos(q.mes), listarCierres(62), leerResumen(),
      ]);

      // Todos los gastos del mes, en orden
      const movimientos = [
        ...compras.map((c) => ({ fecha: c.fecha, en: c.creado, tipo: 'compra', concepto: c.insumo, valor: c.valor, por: c.registradoPor, pago: c.pago, categoria: c.categoria, ...(saleDeCaja(c) ? { deCaja: true } : {}) })),
        ...pagos.map((p) => ({ fecha: p.fecha, en: p.creado, tipo: 'fijo', concepto: p.nombre, valor: p.valor, por: p.registradoPor, pago: p.metodo })),
        ...cierres.filter((c) => c.jornada.startsWith(q.mes)).flatMap((c) => (c.gastos || []).map((g, i) => ({
          fecha: c.jornada, en: (c.cerradoEn || 0) + i, tipo: 'caja', concepto: g.concepto, valor: g.valor, por: c.cerradoPor, pago: 'caja', deCaja: true,
        }))),
      ].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.en - b.en);

      // Repartir: primero sale del presupuesto, después de las ventas
      let queda = presupuesto.monto, agotadoEl = null;
      for (const m of movimientos) {
        if (m.tipo === 'fijo') { m.fueraPresupuesto = true; m.delPresupuesto = 0; m.deVentas = m.valor; m.saldo = queda; continue; }
        // pagado con el efectivo de la caja del día: ya se descontó en el cierre, no gasta presupuesto
        if (m.deCaja) { m.fueraPresupuesto = true; m.delPresupuesto = 0; m.deVentas = 0; m.saldo = queda; continue; }
        m.delPresupuesto = Math.min(queda, m.valor);
        m.deVentas = m.valor - m.delPresupuesto;
        queda -= m.delPresupuesto;
        m.saldo = queda;
        if (!agotadoEl && m.deVentas > 0) agotadoEl = m.fecha;
      }
      const ventasMes = Object.entries(resumen).filter(([d]) => d.startsWith(q.mes)).reduce((s, [, v]) => s + (v.total || 0), 0);
      const conPres = movimientos.filter((m) => !m.fueraPresupuesto);
      const gastado = conPres.reduce((s, m) => s + m.valor, 0);          // lo que cuenta contra el presupuesto
      const deVentas = conPres.reduce((s, m) => s + m.deVentas, 0);      // lo que se pasó del presupuesto
      const fijos = movimientos.filter((m) => m.tipo === 'fijo').reduce((s, m) => s + m.valor, 0);
      const caja = movimientos.filter((m) => m.deCaja).reduce((s, m) => s + m.valor, 0);
      return res.status(200).json({
        mes: q.mes, presupuesto, base: base || { monto: 0, repetir: false },
        resumen: { gastado, delPresupuesto: gastado - deVentas, deVentas, fijos, caja, queda, agotadoEl, ventasMes, quedanVentas: ventasMes - deVentas - fijos - caja },
        movimientos,
      });
    }

    // PUT { mes, monto, nota, repetir } → define el presupuesto del mes (y opcionalmente para todos los meses)
    if (req.method === 'PUT') {
      const b = leer(req);
      if (!MES.test(b.mes || '')) return res.status(400).json({ error: 'Mes inválido' });
      const monto = Math.round(Number(b.monto));
      if (!(monto >= 0) || monto > 1_000_000_000) return res.status(400).json({ error: 'Escribe un valor válido' });
      await guardarPresupuesto(b.mes, { monto, nota: String(b.nota || '').trim().slice(0, 160), por: usuario, en: Date.now() });
      if (b.repetir !== undefined) await guardarPresupuestoBase({ monto, repetir: !!b.repetir, por: usuario, en: Date.now() });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
