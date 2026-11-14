import { randomUUID } from 'node:crypto';
import { armarItem, ESTADOS, METODOS_PAGO, agruparCuentas, cuentaDe, consumoDe, faltantes, textoFaltantes } from '../catalog.js';
import { siguienteNumero, guardar, obtener, listar, borrar, usandoRedis, configActual, leerRev, registrarVenta, anularVenta, leerInventario, moverStock, invertir, leerStock } from './_lib/store.js';
import { sesion } from './_lib/auth.js';
import { conSede } from './_lib/sede.js';

class ErrorUsuario extends Error {}
const leer = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});
const metodoValido = (m) => METODOS_PAGO.some((x) => x.id === m);

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const yo = await sesion(req);
  if (!yo) return res.status(401).json({ error: 'Inicia sesión' });
  const usuario = yo.usuario;
  const prohibido = (msg) => res.status(403).json({ error: msg });

  try {
    // Listar pedidos
    if (req.method === 'GET') {
      const rev = await leerRev();
      const revCliente = req.query?.rev ?? new URL(req.url, 'http://x').searchParams.get('rev');
      if (revCliente != null && String(rev) === String(revCliente)) {
        return res.status(200).json({ sinCambios: true, rev });
      }
      const pedidos = await listar();
      return res.status(200).json({ pedidos, rev, usuario, persistente: usandoRedis, ahora: Date.now() });
    }

    // Crear pedido
    if (req.method === 'POST') {
      if (!yo.puede('tomar')) return prohibido('No tienes permiso para tomar pedidos');
      const body = leer(req);

      // ¿Se agrega a una cuenta abierta?
      let cuenta = null;
      let cliente = String(body.cliente || '').slice(0, 60).trim();
      if (body.cuenta) {
        const base = await obtener(String(body.cuenta));
        if (!base || base.estado === 'cancelado' || base.pago?.pagado) throw new ErrorUsuario('Esa cuenta ya está cerrada o pagada');
        cuenta = cuentaDe(base);
        cliente = base.cliente;
      }
      if (!cliente) throw new ErrorUsuario('Escribe el nombre de la persona del pedido');

      const cfg = await configActual();
      let items;
      try { items = (body.items || []).map((i) => armarItem(i, cfg)); }
      catch (e) { throw new ErrorUsuario(e.message); }
      if (items.length === 0) throw new ErrorUsuario('El pedido está vacío');
      if (items.length > 60) throw new ErrorUsuario('Demasiados productos en un pedido');

      const ahora = !cuenta && !!body.pago?.ahora;
      const metodo = ahora && metodoValido(body.pago?.metodo) ? body.pago.metodo : null;
      if (ahora && !metodo) throw new ErrorUsuario('Escoge efectivo o transferencia');

      // Inventario: si algo está agotado o no alcanza, no se deja tomar el pedido
      const inventario = await leerInventario();
      const consumo = consumoDe(items, inventario);
      const falta = faltantes(consumo, await leerStock(), inventario);
      if (falta.length) throw new ErrorUsuario(`No hay suficiente inventario: ${textoFaltantes(falta)}`);

      const t = Date.now();
      const id = randomUUID();
      const pedido = {
        id,
        cuenta: cuenta || id,
        agregadoACuenta: !!cuenta,
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
      // Inventario: descontar lo que consume este pedido
      pedido.inventario = consumo;
      await guardar(pedido);
      await moverStock(pedido.inventario, { tipo: 'venta', pedido: pedido.numero, cliente, usuario });
      const resp = { pedido };
      if (cuenta) {
        const c = agruparCuentas(await listar(300)).find((x) => x.id === cuenta);
        resp.cuentaPendiente = c?.pendiente ?? pedido.total;
        resp.cuentaPedidos = c?.abiertos.length ?? 1;
      }
      return res.status(201).json(resp);
    }

    // Cambiar estado y/o pago
    if (req.method === 'PATCH') {
      const body = leer(req);

      // Cobrar una cuenta completa (todos sus pedidos sin pagar)
      if (body.cobrarCuenta && !yo.puede('cobrar')) return prohibido('No tienes permiso para cobrar');
      if (body.cobrarCuenta) {
        if (!metodoValido(body.metodo)) throw new ErrorUsuario('Escoge efectivo o transferencia');
        const todos = await listar(300);
        const abiertos = todos.filter((p) => cuentaDe(p) === body.cobrarCuenta && p.estado !== 'cancelado' && !p.pago?.pagado);
        if (!abiertos.length) throw new ErrorUsuario('Esa cuenta ya está pagada');
        const t = Date.now();
        for (const p of abiertos) {
          p.pago ||= { ahora: false, metodo: null, pagado: false };
          Object.assign(p.pago, { pagado: true, metodo: body.metodo, cobradoPor: usuario, pagadoEn: t });
          (p.historial ||= []).push({ accion: 'pagado', usuario, en: t, metodo: body.metodo });
          p.actualizado = t;
          await registrarVenta(p);
          await guardar(p);
        }
        return res.status(200).json({ pagados: abiertos.length, total: abiertos.reduce((s, p) => s + p.total, 0) });
      }

      const pedido = await obtener(body.id);
      if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
      const t = Date.now();
      pedido.historial ||= [];

      if (body.estado === 'cancelado' && !yo.puede('cancelar')) return prohibido('No tienes permiso para cancelar pedidos');
      if (body.estado !== undefined && body.estado !== 'cancelado' && !yo.puede('pedidos')) return prohibido('No tienes permiso para despachar pedidos');
      if (body.pago !== undefined && !yo.puede('cobrar')) return prohibido('No tienes permiso para cobrar');
      if (body.estado !== undefined) {
        if (!ESTADOS.includes(body.estado)) throw new ErrorUsuario('Estado inválido');
        pedido.estado = body.estado;
        pedido.historial.push({ accion: body.estado, usuario, en: t });
        if (body.estado === 'cancelado') {
          await anularVenta(pedido); // un pedido cancelado no cuenta como venta
          if (pedido.inventario && !pedido.inventarioDevuelto) { // y lo que consumió vuelve al inventario
            await moverStock(invertir(pedido.inventario), { tipo: 'cancelado', pedido: pedido.numero, cliente: pedido.cliente, usuario });
            pedido.inventarioDevuelto = true;
          }
        }
      }

      if (body.pago !== undefined) {
        pedido.pago ||= { ahora: false, metodo: null, pagado: false };
        if (body.pago.pagado) {
          if (!metodoValido(body.pago.metodo)) throw new ErrorUsuario('Escoge efectivo o transferencia');
          if (pedido.pago.pagado) await anularVenta(pedido);
          Object.assign(pedido.pago, { pagado: true, metodo: body.pago.metodo, cobradoPor: usuario, pagadoEn: t });
          pedido.historial.push({ accion: 'pagado', usuario, en: t, metodo: body.pago.metodo });
          await registrarVenta(pedido);
        } else {
          await anularVenta(pedido);
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
      if (!yo.puede('cancelar')) return prohibido('No tienes permiso para borrar pedidos');
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

export default conSede(handler);
