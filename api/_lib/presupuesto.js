// Presupuesto mensual para compras.
// Cada mes arranca con un presupuesto; las compras y los gastos de caja (anotados en el
// cierre) lo van gastando en orden de fecha. Cuando se agota, lo demás sale de las ventas
// del mismo mes. Los gastos fijos NO usan el presupuesto: siempre se pagan con las ventas.
import { sesion } from './auth.js';
import { leerPresupuesto, guardarPresupuesto, leerPresupuestoBase, guardarPresupuestoBase,
  comprasEntre, leerPagosFijos, listarCierres, leerResumen } from './store.js';
import { finMes } from '../../fechas.js';
import { repartirPresupuesto, origenDe } from '../../catalog.js';

const MES = /^\d{4}-\d{2}$/;
const leer = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});

export async function presupuestoDe(mes) {
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

      // Compras: el presupuesto se reparte en orden y nunca se pasa; lo que no alcance sale de ventas
      const { reparto, queda } = repartirPresupuesto(compras, presupuesto.monto);
      const movimientos = [
        ...compras.map((c) => { const r = reparto[c.id]; return { fecha: c.fecha, en: c.creado, linea: c.linea || 0, tipo: 'compra', origen: origenDe(c), concepto: c.insumo, proveedor: c.proveedor || '', valor: c.valor, por: c.registradoPor, pago: c.pago, categoria: c.categoria, delPresupuesto: r.pres, deVentas: r.ventas, deCaja: r.caja }; }),
        ...pagos.map((p) => ({ fecha: p.fecha, en: p.creado, tipo: 'fijo', origen: 'ventas', concepto: p.nombre, valor: p.valor, por: p.registradoPor, pago: p.metodo, delPresupuesto: 0, deVentas: p.valor, deCaja: 0 })),
        ...cierres.filter((c) => c.jornada.startsWith(q.mes)).flatMap((c) => (c.gastos || []).map((g, i) => ({
          fecha: c.jornada, en: (c.cerradoEn || 0) + i, tipo: 'caja', origen: 'caja', concepto: g.concepto, valor: g.valor, por: c.cerradoPor, pago: 'caja', delPresupuesto: 0, deVentas: 0, deCaja: g.valor,
        }))),
      ].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.en - b.en || (a.linea || 0) - (b.linea || 0));
      let saldo = presupuesto.monto, agotadoEl = null;
      for (const m of movimientos) {
        m.fueraPresupuesto = m.origen !== 'presupuesto';
        if (!m.fueraPresupuesto) { saldo -= m.delPresupuesto; if (!agotadoEl && m.deVentas > 0) agotadoEl = m.fecha; }
        m.saldo = saldo;
      }
      const suma = (f, k) => movimientos.filter(f).reduce((t, m) => t + m[k], 0);
      const ventasMes = Object.entries(resumen).filter(([d]) => d.startsWith(q.mes)).reduce((t, [, v]) => t + (v.total || 0), 0);
      const delPresupuesto = suma((m) => m.tipo === 'compra', 'delPresupuesto');
      const excedente = suma((m) => m.tipo === 'compra' && m.origen === 'presupuesto', 'deVentas'); // lo que no alcanzó
      const comprasVentas = suma((m) => m.tipo === 'compra' && m.origen === 'ventas', 'deVentas');  // compradas con plata de ventas
      const caja = suma(() => true, 'deCaja');                                                         // cositas del diario
      const fijos = suma((m) => m.tipo === 'fijo', 'valor');
      const gastado = suma((m) => m.tipo !== 'fijo', 'valor');
      const deVentas = excedente + comprasVentas;
      const ahorro = suma((m) => m.tipo === 'compra' && m.origen === 'ahorro', 'valor');
      return res.status(200).json({
        mes: q.mes, presupuesto, base: base || { monto: 0, repetir: false },
        resumen: { gastado, delPresupuesto, deVentas, excedente, comprasVentas, ahorro, caja, fijos, queda, agotadoEl, ventasMes, quedanVentas: ventasMes - deVentas - caja - fijos },
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
