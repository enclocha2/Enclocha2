import { randomUUID } from 'node:crypto';
import { normalizarItem, ESTADOS } from '../catalog.js';
import { siguienteNumero, guardar, obtener, listar, borrar, usandoRedis } from './_lib/store.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    // Listar pedidos
    if (req.method === 'GET') {
      const pedidos = await listar();
      return res.status(200).json({ pedidos, persistente: usandoRedis, ahora: Date.now() });
    }

    // Crear pedido
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const items = (body.items || []).map(normalizarItem);
      if (items.length === 0) return res.status(400).json({ error: 'El pedido está vacío' });
      if (items.length > 30) return res.status(400).json({ error: 'Demasiados granizados' });

      const pedido = {
        id: randomUUID(),
        numero: await siguienteNumero(),
        cliente: String(body.cliente || '').slice(0, 60).trim(),
        items,
        total: items.reduce((s, i) => s + i.subtotal, 0),
        estado: 'nuevo',
        creado: Date.now(),
      };
      await guardar(pedido);
      return res.status(201).json({ pedido });
    }

    // Cambiar estado
    if (req.method === 'PATCH') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      if (!ESTADOS.includes(body.estado)) return res.status(400).json({ error: 'Estado inválido' });
      const pedido = await obtener(body.id);
      if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
      pedido.estado = body.estado;
      pedido.actualizado = Date.now();
      await guardar(pedido);
      return res.status(200).json({ pedido });
    }

    // Borrar pedido
    if (req.method === 'DELETE') {
      const id = req.query?.id || new URL(req.url, 'http://x').searchParams.get('id');
      if (!id) return res.status(400).json({ error: 'Falta id' });
      await borrar(id);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    const msg = e?.message || 'Error';
    const esValidacion = /inválid|Escoge|vacío/i.test(msg);
    console.error(e);
    return res.status(esValidacion ? 400 : 500).json({ error: esValidacion ? msg : 'Error del servidor' });
  }
}
