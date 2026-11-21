import { randomUUID } from 'node:crypto';
import { esStiv, vaParaLlevar, armarItem, ESTADOS, METODOS_PAGO, agruparCuentas, cuentaDe, consumoDe, faltantes, textoFaltantes, repartirPago, validarPartes, sinReutilizables, stockDisponible, prestamoDe } from '../catalog.js';
import { siguienteNumero, guardar, obtener, listar, borrar, usandoRedis, configActual, leerRev, registrarVenta, anularVenta, leerInventario, moverStock, invertir, leerStock, leerPrestados, moverPrestados, leerAjustes, guardarAdjunto, leerAdjunto, marcarComprobantes, comprobantesDe } from './_lib/store.js';
import { sesion } from './_lib/auth.js';
import { conSede } from './_lib/sede.js';
import { hoyCalendario } from '../fechas.js';

class ErrorUsuario extends Error {}
const leer = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});
const metodoValido = (m) => METODOS_PAGO.some((x) => x.id === m);
const partesOk = (partes, total) => { try { return validarPartes(partes, total); } catch (e) { throw new ErrorUsuario(e.message); } };

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const yo = await sesion(req);
  if (!yo) return res.status(401).json({ error: 'Inicia sesión' });
  const usuario = yo.usuario;
  const prohibido = (msg) => res.status(403).json({ error: msg });

  try {
    // ---------- Comprobantes de transferencia ----------
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    if (q.r === 'comprobante') {
      if (req.method === 'GET') {
        if (q.ids) return res.status(200).json({ comprobantes: await comprobantesDe(String(q.ids).split(',').slice(0, 500)) });
        const clave = String(q.clave || '').slice(0, 80) || (await comprobantesDe([String(q.id)]))[q.id];
        const a = clave && (await leerAdjunto(clave));
        return a ? res.status(200).json(a) : res.status(404).json({ error: 'No tiene comprobante' });
      }
      if (req.method === 'PUT') {
        if (!yo.puede('cobrar') && !yo.puede('tomar')) return prohibido('No tienes permiso');
        const b = leer(req);
        const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter(Boolean).slice(0, 60);
        if (!ids.length) throw new ErrorUsuario('Falta el pedido');
        if (typeof b.data !== 'string' || !/^data:(image\/(jpeg|png|webp)|application\/pdf);base64,/.test(b.data)) throw new ErrorUsuario('Debe ser una foto o un PDF');
        if (b.data.length > 950 * 1024) throw new ErrorUsuario('El archivo es muy pesado');
        const clave = `pago-${ids[0]}-${Date.now().toString(36)}`;
        await guardarAdjunto(clave, { data: b.data, nombre: String(b.nombre || 'comprobante').slice(0, 80), tipo: b.data.slice(5, b.data.indexOf(';')), subidoPor: usuario });
        await marcarComprobantes(ids, clave);
        return res.status(200).json({ ok: true, clave });
      }
    }

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
      const metodo = ahora && (metodoValido(body.pago?.metodo) || body.pago?.metodo === 'mixto') ? body.pago.metodo : null;
      if (ahora && !metodo) throw new ErrorUsuario('Escoge efectivo o transferencia');
      const efectivoMixto = metodo === 'mixto' ? Math.round(Number(body.pago.efectivo) || 0) : null;

      // Inventario: si algo está agotado o no alcanza, no se deja tomar el pedido
      const inventario = await leerInventario();
      const llevar = !!body.llevar && items.some(vaParaLlevar); // solo granizados y neveras
      const consumo = consumoDe(items, inventario, { llevar });
      const [stockAct, prestados] = await Promise.all([leerStock(), leerPrestados()]);
      const falta = faltantes(consumo, stockDisponible(stockAct, inventario, prestados), inventario);
      // Stiv puede vender aunque no haya inventario (si tiene la opción prendida)
      const sinControl = esStiv(usuario) && !!(await leerAjustes()).sinStock;
      if (falta.length && !sinControl) throw new ErrorUsuario(`No hay suficiente inventario: ${textoFaltantes(falta)}`);

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
        pago: { ahora, metodo, pagado: false, ...(metodo === 'mixto' ? { efectivo: efectivoMixto } : {}) },
        tomadoPor: usuario,
        creado: t,
        historial: [{ accion: 'tomado', usuario, en: t }],
      };
      // Inventario: descontar lo que consume este pedido
      pedido.inventario = sinReutilizables(consumo, inventario); // las peceras de vidrio no se descuentan…
      const prestamo = prestamoDe(consumo, inventario);           // …quedan prestadas hasta que vuelvan
      if (Object.keys(prestamo).length) { pedido.prestamo = prestamo; await moverPrestados(prestamo); }
      if (llevar) pedido.llevar = true;
      // ---------- Venta de otro día (ya pagada y entregada) ----------
      if (body.fecha) {
        if (!yo.puede('configuracion') && !esStiv(usuario)) return prohibido('No tienes permiso para registrar ventas de otros días');
        if (cuenta) throw new ErrorUsuario('Una venta de otro día no se puede agregar a una cuenta abierta');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.fecha) || body.fecha > hoyCalendario() || body.fecha < '2020-01-01') throw new ErrorUsuario('Escoge una fecha válida (hoy o antes)');
        const hora = /^\d{2}:\d{2}$/.test(body.hora || '') ? body.hora : '20:00';
        const tv = Date.parse(`${body.fecha}T${hora}:00-05:00`);
        if (!Number.isFinite(tv) || tv > Date.now()) throw new ErrorUsuario('Esa hora todavía no ha pasado');
        let partes = null, m = body.pago?.metodo;
        if (Array.isArray(body.pago?.partes)) partes = partesOk(body.pago.partes, pedido.total);
        else if (m === 'mixto') { const ef = Math.round(Number(body.pago.efectivo) || 0); if (!(ef > 0 && ef < pedido.total)) throw new ErrorUsuario('El efectivo debe ser menos que el total'); partes = [{ metodo: 'efectivo', valor: ef, quien: cliente }, { metodo: 'transferencia', valor: pedido.total - ef, quien: cliente }]; }
        else if (!metodoValido(m)) throw new ErrorUsuario('Escoge cómo pagó: efectivo, transferencia o las dos');
        const r = partes ? repartirPago(partes, [pedido])[0] : { metodo: m };
        pedido.creado = tv; pedido.estado = 'entregado'; pedido.otroDia = { registrada: t, por: usuario };
        pedido.pago = { ahora: true, metodo: r.metodo, pagado: true, cobradoPor: usuario, pagadoEn: tv, ...(r.metodo === 'mixto' ? { efectivo: r.efectivo } : {}), ...(partes ? { partes } : {}) };
        pedido.historial = [{ accion: 'tomado', usuario, en: tv }, { accion: 'pagado', usuario, en: tv, metodo: r.metodo }, { accion: 'entregado', usuario, en: tv }, { accion: 'registrada-otro-dia', usuario, en: t }];
        await registrarVenta(pedido);
      }
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
        if (!body.partes && !metodoValido(body.metodo)) throw new ErrorUsuario('Escoge efectivo o transferencia');
        const todos = await listar(300);
        const abiertos = todos.filter((p) => cuentaDe(p) === body.cobrarCuenta && p.estado !== 'cancelado' && !p.pago?.pagado);
        if (!abiertos.length) throw new ErrorUsuario('Esa cuenta ya está pagada');
        const t = Date.now();
        // Pago dividido: cada persona paga su parte en efectivo o transferencia
        const total = abiertos.reduce((s, p) => s + p.total, 0);
        const partes = body.partes ? partesOk(body.partes, total) : null;
        const reparto = partes ? repartirPago(partes, abiertos) : null;
        for (const [i, p] of abiertos.entries()) {
          p.pago ||= { ahora: false, metodo: null, pagado: false };
          const metodo = reparto ? reparto[i].metodo : body.metodo;
          Object.assign(p.pago, { pagado: true, metodo, cobradoPor: usuario, pagadoEn: t });
          if (metodo === 'mixto') p.pago.efectivo = reparto[i].efectivo; else delete p.pago.efectivo;
          if (partes && i === 0) p.pago.partes = partes; // el detalle de quién pagó qué queda en el primer pedido
          (p.historial ||= []).push({ accion: 'pagado', usuario, en: t, metodo, ...(partes && i === 0 ? { partes } : {}) });
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
      // Pecera devuelta (se lavó y queda disponible otra vez)
      if (body.devolver) {
        if (!yo.puede('pedidos', 'cobrar')) return prohibido('No tienes permiso');
        if (pedido.prestamo && !pedido.devuelto) {
          await moverPrestados(invertir(pedido.prestamo));
          pedido.devuelto = t; pedido.historial.push({ accion: 'devuelto', usuario, en: t });
          await guardar(pedido);
        }
        return res.status(200).json({ pedido });
      }
      if (body.estado !== undefined) {
        if (!ESTADOS.includes(body.estado)) throw new ErrorUsuario('Estado inválido');
        pedido.estado = body.estado;
        pedido.historial.push({ accion: body.estado, usuario, en: t });
        if (body.estado === 'cancelado') {
          await anularVenta(pedido); // un pedido cancelado no cuenta como venta
          if (pedido.prestamo && !pedido.devuelto) { await moverPrestados(invertir(pedido.prestamo)); pedido.devuelto = t; } // la pecera queda libre
          if (pedido.inventario && !pedido.inventarioDevuelto) { // y lo que consumió vuelve al inventario
            await moverStock(invertir(pedido.inventario), { tipo: 'cancelado', pedido: pedido.numero, cliente: pedido.cliente, usuario });
            pedido.inventarioDevuelto = true;
          }
        }
      }

      if (body.pago !== undefined) {
        pedido.pago ||= { ahora: false, metodo: null, pagado: false };
        if (body.pago.pagado) {
          const partes = body.pago.partes ? partesOk(body.pago.partes, pedido.total) : null;
          if (!partes && !metodoValido(body.pago.metodo)) throw new ErrorUsuario('Escoge efectivo o transferencia');
          if (pedido.pago.pagado) await anularVenta(pedido);
          const r = partes ? repartirPago(partes, [pedido])[0] : { metodo: body.pago.metodo };
          Object.assign(pedido.pago, { pagado: true, metodo: r.metodo, cobradoPor: usuario, pagadoEn: t });
          if (r.metodo === 'mixto') pedido.pago.efectivo = r.efectivo; else delete pedido.pago.efectivo;
          if (partes) pedido.pago.partes = partes; else delete pedido.pago.partes;
          pedido.historial.push({ accion: 'pagado', usuario, en: t, metodo: r.metodo, ...(partes ? { partes } : {}) });
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
