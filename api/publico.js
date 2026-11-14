// API PÚBLICA para la hoja de domicilios (clientes, sin login).
// GET  /api/publico            → menú de granizados + si estamos abiertos + datos de pago
// GET  /api/publico?seguir=ID&t=TOKEN → estado de un pedido
// POST /api/publico            → crear pedido a domicilio
import { randomUUID, randomBytes } from 'node:crypto';
import { armarItem, consumoDe, SECCIONES, faltantes, distanciaKm, tarifaPorKm, coordValida } from '../catalog.js';
import { configActual, siguienteNumero, guardar, obtener, leerAjustes, leerInventario, moverStock, limitar, leerStock } from './_lib/store.js';
import { horarioDe, jornadaActual, horaJornada, textoHorario, hoy } from '../fechas.js';
import { DOM_DEFECTO } from './ajustes.js';
import { conSede, sedesCache } from './_lib/sede.js';
import { sedeActual } from './_lib/store.js';
const nombreSede = async () => { const s = (await sedesCache()).find((x) => x.id === sedeActual()); return s ? { id: s.id, nombre: s.nombre, direccion: s.direccion || '', principal: !!s.principal } : null; };

const txt = (s, n) => String(s ?? '').trim().slice(0, n);
const leer = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});
const ip = (req) => String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();
const SECCIONES_DOMICILIO = SECCIONES.filter((s) => s !== 'Recargas'); // las recargas son para el vaso en el local

// Valor del domicilio según la ubicación del cliente (o su barrio). Devuelve { valor, km, zona } o { error }.
function cotizar(dom, { ubicacion, zona }) {
  if (coordValida(ubicacion) && dom.local && dom.tarifas?.length) {
    const km = Math.round(distanciaKm(dom.local, { lat: +ubicacion.lat, lng: +ubicacion.lng }) * 10) / 10;
    const valor = tarifaPorKm(km, dom.tarifas);
    if (valor === null) {
      const max = Math.max(...dom.tarifas.map((t) => t.hastaKm));
      return { error: `Estás a ${km.toLocaleString('es-CO')} km y solo llevamos hasta ${max.toLocaleString('es-CO')} km. 😔`, fuera: true, km };
    }
    return { valor, km };
  }
  if (zona) {
    const z = (dom.zonas || []).find((x) => x.nombre.toLowerCase() === String(zona).toLowerCase());
    if (z) return { valor: z.valor, zona: z.nombre };
    return { error: 'Escoge un barrio de la lista' };
  }
  return { error: 'Comparte tu ubicación para calcular el domicilio' };
}
const configurado = (dom) => (dom.local && dom.tarifas?.length) || dom.zonas?.length;

function estadoAbierto(dom) {
  if (!dom.activo) return { abierto: false, motivo: dom.mensaje || 'Por ahora no estamos recibiendo domicilios.' };
  if (!configurado(dom)) return { abierto: false, motivo: 'Estamos configurando los domicilios. Vuelve pronto.' };
  if (!dom.soloEnHorario) return { abierto: true };
  const j = jornadaActual(), h = horarioDe(j), ahora = horaJornada(Date.now());
  if (h && ahora >= h.abre && ahora < h.cierra) return { abierto: true, horario: textoHorario(j) };
  return { abierto: false, motivo: 'Estamos cerrados en este momento. Atendemos jueves a domingo y lunes festivos desde las 4:00 p. m.' };
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    const ajustes = await leerAjustes(true);
    const dom = { ...DOM_DEFECTO, ...(ajustes.domicilio || {}) };

    // GET ?lat=..&lng=..  o  ?zona=..  → cuánto vale el domicilio
    if (req.method === 'GET' && (q.lat || q.zona)) {
      if (!(await limitar(`cot:${ip(req)}`, 60, 600))) return res.status(429).json({ error: 'Demasiadas consultas, espera un momento' });
      const c = cotizar(dom, { ubicacion: q.lat ? { lat: q.lat, lng: q.lng } : null, zona: q.zona });
      return res.status(c.error ? 400 : 200).json(c);
    }

    if (req.method === 'GET' && q.seguir) {
      if (!(await limitar(`seg:${ip(req)}`, 120, 600))) return res.status(429).json({ error: 'Demasiadas consultas, espera un momento' });
      const p = await obtener(String(q.seguir));
      if (!p || p.tipo !== 'domicilio' || p.domicilio?.token !== q.t) return res.status(404).json({ error: 'Pedido no encontrado' });
      return res.status(200).json({ numero: p.numero, estado: p.estado, total: p.total, cliente: p.cliente, creado: p.creado, pagado: !!p.pago?.pagado });
    }

    if (req.method === 'GET') {
      const cfg = await configActual();
      const tamanos = cfg.tamanos.filter((t) => t.activo && t.precio && SECCIONES_DOMICILIO.includes(t.seccion || 'Tamaños'));
      // Lo que está agotado según el inventario (para mostrarlo bloqueado)
      const [inventario, stock] = await Promise.all([leerInventario(), leerStock()]);
      const agotado = (tipo, id) => inventario.some((it) => it.activo !== false && (it.reglas || []).some((r) => r.tipo === tipo && r.id === id && (stock[it.id] || 0) < (r.cantidad || 1)));
      const granizadoAgotado = inventario.some((it) => it.activo !== false && (it.reglas || []).some((r) => r.tipo === 'granizado' && (stock[it.id] || 0) < (r.cantidad || 1)));
      const agotados = {
        tamanos: granizadoAgotado ? tamanos.map((t) => t.id) : tamanos.filter((t) => agotado('tamano', t.id)).map((t) => t.id),
        toppings: cfg.toppings.filter((t) => t.activo && agotado('topping', t.id)).map((t) => t.id),
      };
      return res.status(200).json({
        ...estadoAbierto(dom),
        menu: { tamanos, sabores: cfg.sabores.filter((s) => s.activo), toppings: cfg.toppings.filter((t) => t.activo) },
        agotados,
        domicilio: {
          minimo: dom.minimo, mensaje: dom.mensaje, whatsapp: dom.whatsapp,
          porUbicacion: !!(dom.local && dom.tarifas?.length),
          maxKm: dom.tarifas?.length ? Math.max(...dom.tarifas.map((t) => t.hastaKm)) : null,
          zonas: (dom.zonas || []).map((z) => ({ nombre: z.nombre, valor: z.valor })),
        },
        qr: ajustes.qr || null, qrTexto: ajustes.qrTexto || '',
        sede: await nombreSede(),
      });
    }

    if (req.method === 'POST') {
      const b = leer(req);
      if (b.web) return res.status(201).json({ ok: true }); // campo trampa para robots
      if (!(await limitar(`dom:${ip(req)}`, 5, 1800))) return res.status(429).json({ error: 'Ya enviaste varios pedidos. Si necesitas algo más, escríbenos.' });
      const est = estadoAbierto(dom);
      if (!est.abierto) return res.status(400).json({ error: est.motivo });

      const cliente = txt(b.cliente, 60);
      const telefono = String(b.telefono || '').replace(/[^0-9]/g, '');
      const direccion = txt(b.direccion, 120);
      if (!cliente) return res.status(400).json({ error: 'Escribe tu nombre' });
      if (telefono.length < 7 || telefono.length > 12) return res.status(400).json({ error: 'Escribe un número de celular válido' });
      if (direccion.length < 5) return res.status(400).json({ error: 'Escribe tu dirección completa' });

      const cfg = await configActual();
      const raw = Array.isArray(b.items) ? b.items.slice(0, 20) : [];
      if (!raw.length) return res.status(400).json({ error: 'Tu pedido está vacío' });
      let items;
      try {
        items = raw.map((i) => {
          if (i.tipo !== 'granizado') throw new Error('Solo se pueden pedir granizados');
          const it = armarItem(i, cfg);
          const t = cfg.tamanos.find((x) => x.id === it.tamano);
          if (!SECCIONES_DOMICILIO.includes(t?.seccion || 'Tamaños')) throw new Error(`"${t?.nombre}" no está disponible a domicilio`);
          return it;
        });
      } catch (e) { return res.status(400).json({ error: e.message }); }

      const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
      if (dom.minimo && subtotal < dom.minimo) return res.status(400).json({ error: `El pedido mínimo a domicilio es de $${dom.minimo.toLocaleString('es-CO')}` });
      // El valor del domicilio lo calcula el servidor con la ubicación (o el barrio) del cliente
      const cot = cotizar(dom, { ubicacion: b.ubicacion, zona: b.zona });
      if (cot.error) return res.status(400).json({ error: cot.error });
      const metodo = b.pago?.metodo === 'transferencia' ? 'transferencia' : 'efectivo';
      const total = subtotal + cot.valor;
      const pagaCon = metodo === 'efectivo' ? Math.max(0, Math.round(Number(b.pago?.pagaCon) || 0)) : 0;
      if (pagaCon && pagaCon < total) return res.status(400).json({ error: 'El valor con el que pagas es menor que el total' });

      const inventario = await leerInventario();
      const consumo = consumoDe(items, inventario);
      const falta = faltantes(consumo, await leerStock(), inventario);
      if (falta.length) return res.status(400).json({ error: `Lo sentimos, se nos acabó: ${falta.map((x) => x.nombre).join(', ')}. Cambia tu pedido.` });

      const t = Date.now(), id = randomUUID();
      const pedido = {
        id, cuenta: id, tipo: 'domicilio',
        numero: await siguienteNumero(),
        cliente, items, total, estado: 'nuevo',
        pago: { ahora: false, metodo, pagado: false },
        domicilio: {
          telefono, direccion, barrio: txt(b.barrio, 60), referencia: txt(b.referencia, 120),
          costo: cot.valor, km: cot.km ?? null, zona: cot.zona || null,
          ubicacion: cot.km != null ? { lat: +b.ubicacion.lat, lng: +b.ubicacion.lng, precision: Math.round(Number(b.ubicacion.precision) || 0) || null } : null,
          pagaCon, nota: txt(b.nota, 200), token: randomBytes(12).toString('hex'),
        },
        tomadoPor: '🛵 Web', creado: t,
        historial: [{ accion: 'tomado', usuario: '🛵 Cliente (web)', en: t }],
      };
      pedido.inventario = consumo;
      await guardar(pedido);
      await moverStock(pedido.inventario, { tipo: 'venta', pedido: pedido.numero, cliente, usuario: '🛵 Web' });
      return res.status(201).json({ id, token: pedido.domicilio.token, numero: pedido.numero, total });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}

export default conSede(handler, true);
