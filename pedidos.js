import { randomUUID } from 'node:crypto';
import { armarItem, ESTADOS, METODOS_PAGO, CONFIG_INICIAL } from '../catalog.js';
import { siguienteNumero, guardar, obtener, listar, borrar, usandoRedis, leerConfig } from './_lib/store.js';
import { usuarioDe } from './_lib/auth.js';

class ErrorUsuario extends Error {}
const leer = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});
const metodoValido = (m) => METODOS_PAGO.some((x) => x.id === m);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const usuario = usuarioDe(req);
  if (!usuario) return res.status(401).json({ error: 'Inicia sesión' });

  try {
    // Listar pedidos
    if (req.method === 'GET') {
      const pedidos = await listar();
      return res.status(200).json({ pedidos, usuario, persistente: usandoRedis, ahora: Date.now() });
    }

    // Crear pedido
    if (req.method === 'POST') {
      const body = leer(req);

      const cliente = String(body.cliente || '').slice(0, 60).trim();
      if (!cliente) throw new ErrorUsuario('Escribe el nombre de la persona del pedido');

      const cfg = (await leerConfig()) || CONFIG_INICIAL;
      let items;
      try { items = (body.items || []).map((i) => armarItem(i, cfg)); }
      catch (e) { throw new ErrorUsuario(e.message); }
      if (items.length === 0) throw new ErrorUsuario('El pedido está vacío');
      if (items.length > 60) throw new ErrorUsuario('Demasiados productos en un pedido');

      const ahora = !!body.pago?.ahora;
      const metodo = metodoValido(body.pago?.metodo) ? body.pago.metodo : null;
      if (ahora && !metodo) throw new ErrorUsuario('Escoge efectivo o transferencia');

      const t = Date.now();
      const pedido = {
        id: randomUUID(),
        numero: await siguienteNumero(),
        cliente,
        items,
        total: items.reduce((s, i) => s + i.subtotal, 0),
        estado: 'nuevo',
        pago: { ahora, metodo, pagado: false },
        tomadoPor: usuario,
        creado: t,
        historial: [{ accion: 'tomado', usuario, en: t }],
      };
      await guardar(pedido);
      return res.status(201).json({ pedido });
    }

    // Cambiar estado y/o pago
    if (req.method === 'PATCH') {
      const body = leer(req);
      const pedido = await obtener(body.id);
      if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
      const t = Date.now();
      pedido.historial ||= [];

      if (body.estado !== undefined) {
        if (!ESTADOS.includes(body.estado)) throw new ErrorUsuario('Estado inválido');
        pedido.estado = body.estado;
        pedido.historial.push({ accion: body.estado, usuario, en: t });
      }

      if (body.pago !== undefined) {
        pedido.pago ||= { ahora: false, metodo: null, pagado: false };
        if (body.pago.pagado) {
          if (!metodoValido(body.pago.metodo)) throw new ErrorUsuario('Escoge efectivo o transferencia');
          Object.assign(pedido.pago, { pagado: true, metodo: body.pago.metodo, cobradoPor: usuario, pagadoEn: t });
          pedido.historial.push({ accion: 'pagado', usuario, en: t, metodo: body.pago.metodo });
        } else {
          Object.assign(pedido.pago, { pagado: false, cobradoPor: null, pagadoEn: null });
          pedido.historial.push({ accion: 'pago-deshecho', usuario, en: t });
        }
      }

      pedido.actualizado = t;
      await guardar(pedido);
      return res.status(200).json({ pedido });
    }

    // Borrar pedido
    if (req.method === 'DELETE') {
      const id = req.query?.id || new URL(req.url, 'http://x').searchParams.get('id');
      if (!id) throw new ErrorUsuario('Falta id');
      await borrar(id);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    if (e instanceof ErrorUsuario) return res.status(400).json({ error: e.message });
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
