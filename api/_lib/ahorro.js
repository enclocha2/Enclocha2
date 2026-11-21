// Ahorro: plata que se va guardando. Se le mete plata, se saca para gastos y se puede comprar con ella (Compras → 🐷 Ahorro).
// Saldo = lo que entró − lo que salió − compras pagadas con el ahorro. Nunca puede quedar negativo.
import { randomUUID } from 'node:crypto';
import { sesion } from './auth.js';
import { leerAhorroMovs, guardarAhorroMovs, leerAhorroCompras, leerAhorroMeta, guardarAhorroMeta } from './store.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const leer = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});
const txt = (s, n) => String(s ?? '').trim().slice(0, n);
export const DESDE_AHORRO = { cajon: '💵 Efectivo del cajón de hoy', ventas: '💰 Plata de ventas guardada', transferencia: '📲 Transferencia', otro: '👛 Otro' };

// saldo actual; "sinCompra" deja por fuera una compra (para validar cuando se edita)
export async function saldoAhorro(sinCompra = null) {
  const [movs, compras] = await Promise.all([leerAhorroMovs(), leerAhorroCompras()]);
  const entra = movs.filter((m) => m.tipo === 'entra').reduce((t, m) => t + m.valor, 0);
  const sale = movs.filter((m) => m.tipo === 'sale').reduce((t, m) => t + m.valor, 0);
  const comp = Object.entries(compras).filter(([id]) => id !== sinCompra).reduce((t, [, c]) => t + c.valor, 0);
  return { saldo: entra - sale - comp, entra, sale, compras: comp, movs, listaCompras: compras };
}
// plata que se pasó del cajón al ahorro en una jornada (se descuenta en el cierre de caja)
export async function ahorroDelCajon(jornada) {
  return (await leerAhorroMovs()).filter((m) => m.tipo === 'entra' && m.desde === 'cajon' && m.fecha === jornada);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const yo = await sesion(req);
  if (!yo) return res.status(401).json({ error: 'Inicia sesión' });
  if (!yo.puede('presupuesto')) return res.status(403).json({ error: 'No tienes permiso para ver el ahorro' });
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  try {
    if (req.method === 'GET') {
      const s = await saldoAhorro();
      // todo junto, lo más nuevo primero
      const movimientos = [
        ...s.movs,
        ...Object.entries(s.listaCompras).map(([id, c]) => ({ id: 'c-' + id, compraId: id, fecha: c.fecha, tipo: 'compra', valor: c.valor, concepto: c.insumo, proveedor: c.proveedor, factura: c.factura })),
      ].sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.creado || 0) - (a.creado || 0));
      return res.status(200).json({ saldo: s.saldo, entra: s.entra, sale: s.sale, compras: s.compras, meta: await leerAhorroMeta(), movimientos, desde: DESDE_AHORRO });
    }
    const b = leer(req);
    if (q.meta) {
      const monto = Math.round(Number(b.monto) || 0);
      return res.status(200).json({ meta: await guardarAhorroMeta(monto > 0 ? { monto, nombre: txt(b.nombre, 60) } : null) });
    }
    if (req.method === 'POST') {
      const tipo = b.tipo === 'sale' ? 'sale' : 'entra';
      const valor = Math.round(Number(b.valor) || 0);
      if (!(valor > 0) || valor > 1_000_000_000) return res.status(400).json({ error: 'Escribe un valor válido' });
      if (!FECHA.test(b.fecha || '')) return res.status(400).json({ error: 'Fecha inválida' });
      const concepto = txt(b.concepto, 80);
      if (tipo === 'sale' && !concepto) return res.status(400).json({ error: 'Escribe en qué se gastó' });
      if (tipo === 'sale') { const { saldo } = await saldoAhorro(); if (valor > saldo) return res.status(400).json({ error: `En el ahorro solo hay $${saldo.toLocaleString('es-CO')}` }); }
      const movs = await leerAhorroMovs();
      const m = { id: randomUUID(), fecha: b.fecha, tipo, valor, concepto: concepto || 'Ahorro', desde: tipo === 'entra' && DESDE_AHORRO[b.desde] ? b.desde : tipo === 'sale' && ['efectivo', 'transferencia'].includes(b.desde) ? b.desde : '', nota: txt(b.nota, 120), por: yo.usuario, creado: Date.now() };
      await guardarAhorroMovs([...movs, m]);
      return res.status(201).json({ movimiento: m });
    }
    if (req.method === 'DELETE') {
      const movs = await leerAhorroMovs(), m = movs.find((x) => x.id === q.id);
      if (!m) return res.status(404).json({ error: 'Movimiento no encontrado' });
      if (m.tipo === 'entra') { const { saldo } = await saldoAhorro(); if (saldo - m.valor < 0) return res.status(400).json({ error: 'No se puede borrar: el ahorro quedaría en negativo (ya se gastó esa plata)' }); }
      await guardarAhorroMovs(movs.filter((x) => x.id !== q.id));
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
