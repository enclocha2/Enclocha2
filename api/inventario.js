import { sesion } from './_lib/auth.js';
import { leerInventario, guardarInventario, leerStock, moverStock, listarMovs, marcaUnaVez, leerPrestados } from './_lib/store.js';
import { UNIDADES_INV, CATEGORIAS_COMPRA, slug, empaquesSugeridos, stockDisponible, normalizar } from '../catalog.js';
import { conSede } from './_lib/sede.js';

const txt = (s, n) => String(s ?? '').trim().slice(0, n);
const num = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
const leer = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});
const TIPOS_REGLA = ['producto', 'tamano', 'topping', 'granizado', 'tapa'];

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const yo = await sesion(req);
  if (!yo) return res.status(401).json({ error: 'Inicia sesión' });
  const usuario = yo.usuario;

  try {
    // GET → ítems con su stock + últimos movimientos
    if (req.method === 'GET') {
      const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      let items = await leerInventario();
      // Una sola vez: ponerle empaques sugeridos (bolsa x100, caja x30...) a los ítems que no tengan
      if (items.length && (await marcaUnaVez('inv:empaques-v1'))) {
        let cambio = false;
        items = items.map((it) => { if (it.empaques?.length) return it; const e = empaquesSugeridos(it.nombre); if (e.length) cambio = true; return { ...it, empaques: e }; });
        if (cambio) await guardarInventario(items);
      }
      // Una sola vez: los vasos quedan con solo dos formas de compra (paquete de vasos / paquete de vasos con tapa)
      if (items.length && (await marcaUnaVez('inv:vasos-v2'))) {
        let cambio = false;
        items = items.map((it) => {
          const esVaso = !it.reutilizable && it.reglas?.some((r) => r.tipo === 'tamano') && (it.tapa || /vaso/.test(normalizar(it.nombre)));
          if (!esVaso) return it;
          cambio = true;
          return { ...it, unidad: 'vaso', empaques: [{ nombre: 'paquete de vasos con tapa', unidades: 20, ...(it.tapa ? { conTapa: true } : {}) }, { nombre: 'paquete de vasos', unidades: 20 }].filter((e) => it.tapa || !/con tapa/.test(e.nombre)) };
        });
        if (cambio) await guardarInventario(items);
      }
      const [stock, movs, prestados] = await Promise.all([leerStock(), q.lite ? [] : listarMovs(300), leerPrestados()]);
      // lite (tomar pedido): el stock de los reutilizables ya viene sin los prestados
      return res.status(200).json({ items, stock: q.lite ? stockDisponible(stock, items, prestados) : stock, prestados, movs, admin: yo.puede('inventario_config') });
    }

    // PUT { items } → guardar definiciones (solo administradores)
    if (req.method === 'PUT') {
      if (!yo.puede('inventario_config')) return res.status(403).json({ error: 'No tienes permiso para configurar el inventario' });
      const b = leer(req);
      if (!Array.isArray(b.items) || b.items.length > 300) return res.status(400).json({ error: 'Lista inválida' });
      const ids = new Set();
      const items = [];
      for (const it of b.items) {
        const nombre = txt(it.nombre, 60);
        if (!nombre) return res.status(400).json({ error: 'Hay un ítem sin nombre' });
        let id = /^[a-z0-9-]{1,48}$/.test(it.id || '') ? it.id : slug(nombre);
        while (ids.has(id)) id += '-2';
        ids.add(id);
        items.push({
          id, nombre,
          categoria: CATEGORIAS_COMPRA.some((c) => c.id === it.categoria) ? it.categoria : 'otros',
          unidad: UNIDADES_INV.includes(it.unidad) ? it.unidad : 'und',
          minimo: Math.max(0, num(it.minimo)),
          reglas: (Array.isArray(it.reglas) ? it.reglas : []).slice(0, 30)
            .filter((r) => TIPOS_REGLA.includes(r.tipo) && (r.tipo === 'granizado' || r.id))
            .map((r) => ({ tipo: r.tipo, id: r.tipo === 'granizado' ? null : txt(r.id, 48), cantidad: Math.max(0, num(r.cantidad)) || 1 })),
          activo: it.activo !== false,
          ...(it.reutilizable ? { reutilizable: true } : {}),
          ...(it.soloCompras ? { soloCompras: true } : {}), // insumo que se compra pero no se le lleva stock (gas, bolsas de basura...)
          ...(it.tapa ? { tapa: txt(it.tapa, 48) } : {}), // vasos: ítem de las tapas que a veces vienen con ellos
          empaques: (Array.isArray(it.empaques) ? it.empaques : []).slice(0, 6)
            .map((e) => ({ nombre: txt(e.nombre, 30), unidades: Math.max(0, num(e.unidades)), ...(e.conTapa ? { conTapa: true } : {}) }))
            .filter((e) => e.nombre && e.unidades > 0),
        });
      }
      await guardarInventario(items);
      return res.status(200).json({ items });
    }

    // POST { id, tipo: entrada|salida|merma|conteo, cantidad, nota } → movimiento manual
    if (req.method === 'POST') {
      if (!yo.puede('inventario', 'inventario_config')) return res.status(403).json({ error: 'No tienes permiso para mover el inventario' });
      const b = leer(req);
      const items = await leerInventario();
      const it = items.find((x) => x.id === b.id);
      if (!it) return res.status(404).json({ error: 'Ítem no encontrado' });
      const cantidad = num(b.cantidad);
      if (!['entrada', 'salida', 'merma', 'conteo'].includes(b.tipo)) return res.status(400).json({ error: 'Tipo inválido' });
      if (b.tipo !== 'conteo' && !(cantidad > 0)) return res.status(400).json({ error: 'Escribe una cantidad' });
      if (b.tipo === 'conteo' && cantidad < 0) return res.status(400).json({ error: 'Cantidad inválida' });
      let delta = cantidad;
      if (b.tipo === 'salida' || b.tipo === 'merma') delta = -cantidad;
      if (b.tipo === 'conteo') {
        const actual = (await leerStock())[it.id] || 0;
        delta = num(cantidad - actual);
        if (!delta) return res.status(200).json({ ok: true, sinCambio: true });
      }
      const deltas = { [it.id]: delta };
      // Vasos que vienen con tapa: entran también las tapas
      if (b.tipo === 'entrada' && b.conTapas && it.tapa && items.some((x) => x.id === it.tapa)) deltas[it.tapa] = (deltas[it.tapa] || 0) + delta;
      await moverStock(deltas, { tipo: b.tipo, nota: txt(b.nota, 120) + (deltas[it.tapa] && it.tapa !== it.id ? ' (con tapas)' : ''), usuario, nombre: it.nombre });
      return res.status(200).json({ ok: true, delta });
    }

    res.setHeader('Allow', 'GET, PUT, POST');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}

export default conSede(handler);
