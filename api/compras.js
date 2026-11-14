import { randomUUID } from 'node:crypto';
import { sesion } from './_lib/auth.js';
import gastosFijos from './_lib/gastosfijos.js';
import presupuesto from './_lib/presupuesto.js';
import { guardarCompra, leerCompra, borrarCompra, comprasEntre, leerInventario, moverStock } from './_lib/store.js';
import { CATEGORIAS_COMPRA, UNIDADES, PAGOS_COMPRA } from '../catalog.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const txt = (s, n) => String(s ?? '').trim().slice(0, n);
const leer = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});

function validar(b) {
  const insumo = txt(b.insumo, 80);
  if (!insumo) throw new Error('Escribe qué se compró');
  if (!FECHA.test(b.fecha || '')) throw new Error('Fecha inválida');
  const valor = Math.round(Number(b.valor));
  if (!(valor > 0) || valor > 100_000_000) throw new Error('Escribe el valor total de la compra');
  const cantidad = Math.max(0, Math.round((Number(b.cantidad) || 0) * 100) / 100);
  return {
    fecha: b.fecha, insumo,
    categoria: CATEGORIAS_COMPRA.some((c) => c.id === b.categoria) ? b.categoria : 'otros',
    cantidad: cantidad || null,
    unidad: UNIDADES.includes(b.unidad) ? b.unidad : 'und',
    valor,
    pago: PAGOS_COMPRA.some((p) => p.id === b.pago) ? b.pago : 'caja',
    proveedor: txt(b.proveedor, 60),
    nota: txt(b.nota, 200),
  };
}

// Si la compra entra al inventario: { id, cantidad } (cantidad en la unidad del ítem de inventario)
async function validarInventario(b) {
  if (!b.inventario?.id) return null;
  const items = await leerInventario();
  const it = items.find((x) => x.id === b.inventario.id);
  const cantidad = Math.round((Number(b.inventario.cantidad) || 0) * 1000) / 1000;
  if (!it) throw new Error('El ítem de inventario no existe');
  if (!(cantidad > 0)) throw new Error('Escribe cuánto entra al inventario');
  return { id: it.id, nombre: it.nombre, unidad: it.unidad, cantidad };
}
const entrada = (inv, signo, extra) => inv && moverStock({ [inv.id]: signo * inv.cantidad }, extra);

// Vercel Hobby permite máximo 12 funciones: /api/compras?r=gastosfijos y ?r=presupuesto se atienden aquí
const ruta = (req) => req.query?.r ?? new URL(req.url, 'http://x').searchParams.get('r');

export default async function handler(req, res) {
  const r = ruta(req);
  if (r === 'gastosfijos') return gastosFijos(req, res);
  if (r === 'presupuesto') return presupuesto(req, res);
  res.setHeader('Cache-Control', 'no-store');
  const yo = await sesion(req);
  if (!yo) return res.status(401).json({ error: 'Inicia sesión' });
  const usuario = yo.usuario;
  if (!yo.puede('compras', 'compras_editar', 'presupuesto')) return res.status(403).json({ error: 'No tienes permiso para ver compras' });
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);

  try {
    if (req.method === 'GET') {
      if (!FECHA.test(q.desde || '') || !FECHA.test(q.hasta || '')) return res.status(400).json({ error: 'Fechas inválidas' });
      const compras = (await comprasEntre(q.desde, q.hasta)).sort((a, b) => (b.fecha + b.creado).localeCompare(a.fecha + a.creado));
      return res.status(200).json({ compras, admin: yo.puede('compras_editar') });
    }

    if (req.method === 'POST') {
      if (!yo.puede('compras')) return res.status(403).json({ error: 'No tienes permiso para registrar compras' });
      let datos;
      try { datos = validar(leer(req)); datos.inventario = await validarInventario(leer(req)); } catch (e) { return res.status(400).json({ error: e.message }); }
      const compra = { id: randomUUID(), ...datos, registradoPor: usuario, creado: Date.now() };
      await guardarCompra(compra);
      await entrada(compra.inventario, 1, { tipo: 'compra', nota: compra.insumo, usuario });
      return res.status(201).json({ compra });
    }

    if (req.method === 'PUT' || req.method === 'DELETE') {
      if (!yo.puede('compras_editar')) return res.status(403).json({ error: 'No tienes permiso para editar o borrar compras' });
      const id = req.method === 'DELETE' ? q.id : leer(req).id;
      const actual = id && (await leerCompra(String(id)));
      if (!actual) return res.status(404).json({ error: 'Compra no encontrada' });
      if (req.method === 'DELETE') {
        await borrarCompra(actual.id);
        await entrada(actual.inventario, -1, { tipo: 'compra-borrada', nota: actual.insumo, usuario });
        return res.status(200).json({ ok: true });
      }
      let datos;
      try { datos = validar(leer(req)); datos.inventario = await validarInventario(leer(req)); } catch (e) { return res.status(400).json({ error: e.message }); }
      // reversar la entrada anterior y aplicar la nueva
      await entrada(actual.inventario, -1, { tipo: 'compra-editada', nota: actual.insumo + ' (antes)', usuario });
      await entrada(datos.inventario, 1, { tipo: 'compra-editada', nota: datos.insumo, usuario });
      if (datos.fecha !== actual.fecha) await borrarCompra(actual.id); // reindexar por fecha
      const compra = { ...actual, ...datos, editadoPor: usuario, editado: Date.now() };
      await guardarCompra(compra);
      return res.status(200).json({ compra });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
