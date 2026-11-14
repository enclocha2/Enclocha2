// Almacenamiento de pedidos.
// En Vercel usa Upstash Redis (Storage > Marketplace). Sin variables de
// entorno cae a memoria (solo sirve para pruebas locales).
import { Redis } from '@upstash/redis';
import { CONFIG_INICIAL, migrar } from '../../catalog.js';
import { jornadaDe } from '../../fechas.js';

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const mem = globalThis.__granizadosMem || (globalThis.__granizadosMem = { seq: 0, rev: 0, pedidos: new Map(), ventas: [], resumen: {} });

const IDX = 'pedidos:idx';
const key = (id) => `pedido:${id}`;
const TTL = 60 * 60 * 24 * 120; // los pedidos se guardan 120 días (las ventas quedan para siempre)

export const usandoRedis = !!redis;

export async function siguienteNumero() {
  if (redis) return await redis.incr('pedidos:seq');
  return ++mem.seq;
}

// "Revisión": número que sube con cada cambio. Las pantallas preguntan solo esto
// (1 operación) y descargan la lista completa únicamente si cambió.
export async function leerRev() {
  if (redis) return Number(await redis.get('pedidos:rev')) || 0;
  return mem.rev;
}
async function subirRev() {
  if (redis) await redis.incr('pedidos:rev');
  else mem.rev++;
}

export async function guardar(pedido) {
  if (redis) {
    await redis.set(key(pedido.id), pedido, { ex: TTL });
    await redis.zadd(IDX, { score: pedido.creado, member: pedido.id });
  } else {
    mem.pedidos.set(pedido.id, pedido);
  }
  await subirRev();
  return pedido;
}

export async function obtener(id) {
  if (redis) return await redis.get(key(id));
  return mem.pedidos.get(id) || null;
}

export async function listar(limite = 150) {
  if (redis) {
    const ids = await redis.zrange(IDX, 0, limite - 1, { rev: true });
    if (!ids.length) return [];
    const datos = await redis.mget(...ids.map(key));
    const vivos = datos.filter(Boolean);
    // limpiar índices de pedidos expirados
    const muertos = ids.filter((_, i) => !datos[i]);
    if (muertos.length) await redis.zrem(IDX, ...muertos);
    return vivos;
  }
  return [...mem.pedidos.values()].sort((a, b) => b.creado - a.creado).slice(0, limite);
}

export async function borrar(id) {
  if (redis) {
    await redis.del(key(id));
    await redis.zrem(IDX, id);
  } else {
    mem.pedidos.delete(id);
  }
  await subirRev();
}

// ---------- Catálogo (productos, sabores, precios) ----------
export async function leerConfig() {
  if (redis) return (await redis.get('config')) || null;
  return mem.config || null;
}

export async function guardarConfig(cfg) {
  if (redis) await redis.set('config', cfg);
  else mem.config = cfg;
  return cfg;
}

// Catálogo vigente (aplica migraciones pendientes y las guarda)
export async function configActual() {
  const cfg = (await leerConfig()) || structuredClone(CONFIG_INICIAL);
  if (migrar(cfg)) await guardarConfig(cfg);
  return cfg;
}

// ---------- Ventas (todo pedido cobrado) ----------
// Cada venta se guarda resumida y para siempre en el índice "ventas" (por fecha de pago),
// y además se suma a un resumen por día ("ventas:resumen") para los reportes anuales.
// El día de una venta es su JORNADA (ver fechas.js): lo vendido de 12 a 6 a. m. cuenta para el día anterior.
export const diaBogota = jornadaDe;

function nombreItem(i) {
  if (i.tipo === 'producto') return [i.nombre, i.categoria || 'Otros'];
  return [`Granizado ${i.tamanoNombre || i.tamano + ' oz'}`, 'Granizados'];
}

function resumenVenta(p) {
  return {
    id: p.id, n: p.numero, c: p.cliente, t: p.total, m: p.pago.metodo,
    pa: p.pago.pagadoEn, cr: p.creado, u: p.tomadoPor || '', cb: p.pago.cobradoPor || '',
    it: p.items.map((i) => { const [nombre, cat] = nombreItem(i); return [nombre, i.cantidad || 1, i.subtotal || 0, cat]; }),
  };
}

function sumarResumen(dia, metodo, total, signo) {
  const k = (x) => `${dia}|${x}`;
  mem.resumen[k('total')] = (mem.resumen[k('total')] || 0) + signo * total;
  mem.resumen[k(metodo)] = (mem.resumen[k(metodo)] || 0) + signo * total;
  mem.resumen[k('n')] = (mem.resumen[k('n')] || 0) + signo;
}

export async function registrarVenta(p) {
  if (!p.pago?.pagado || p.pago.registro || p.estado === 'cancelado') return;
  const v = resumenVenta(p);
  const member = JSON.stringify(v);
  p.pago.registro = member;
  const dia = diaBogota(v.pa);
  if (redis) {
    const pl = redis.pipeline();
    pl.zadd('ventas', { score: v.pa, member });
    pl.hincrby('ventas:resumen', `${dia}|total`, v.t);
    pl.hincrby('ventas:resumen', `${dia}|${v.m}`, v.t);
    pl.hincrby('ventas:resumen', `${dia}|n`, 1);
    await pl.exec();
  } else {
    mem.ventas.push({ score: v.pa, member });
    sumarResumen(dia, v.m, v.t, 1);
  }
}

export async function anularVenta(p) {
  const member = p.pago?.registro;
  if (!member) return;
  const v = JSON.parse(member);
  const dia = diaBogota(v.pa);
  if (redis) {
    const pl = redis.pipeline();
    pl.zrem('ventas', member);
    pl.hincrby('ventas:resumen', `${dia}|total`, -v.t);
    pl.hincrby('ventas:resumen', `${dia}|${v.m}`, -v.t);
    pl.hincrby('ventas:resumen', `${dia}|n`, -1);
    await pl.exec();
  } else {
    mem.ventas = mem.ventas.filter((x) => x.member !== member);
    sumarResumen(dia, v.m, v.t, -1);
  }
  delete p.pago.registro;
}

export async function ventasEntre(ini, fin) {
  let lista;
  if (redis) lista = await redis.zrange('ventas', ini, fin, { byScore: true });
  else lista = mem.ventas.filter((x) => x.score >= ini && x.score <= fin).sort((a, b) => a.score - b.score).map((x) => x.member);
  return lista.map((x) => (typeof x === 'string' ? JSON.parse(x) : x));
}

export async function leerResumen() {
  const raw = redis ? (await redis.hgetall('ventas:resumen')) || {} : mem.resumen;
  const dias = {};
  for (const [k, val] of Object.entries(raw)) {
    const [dia, campo] = k.split('|');
    (dias[dia] ||= { total: 0, efectivo: 0, transferencia: 0, n: 0 })[campo] = Number(val) || 0;
  }
  return dias;
}

// Una sola vez: pasa a "ventas" los pedidos ya cobrados antes de esta versión
export async function migrarVentas() {
  const hecho = redis ? await redis.get('ventas:migrado') : mem.ventasMigrado;
  if (hecho) return;
  for (const p of await listar(1000)) {
    if (p.pago?.pagado && p.estado !== 'cancelado' && !p.pago.registro) {
      await registrarVenta(p);
      await guardar(p);
    }
  }
  if (redis) await redis.set('ventas:migrado', 1); else mem.ventasMigrado = true;
}

// Una sola vez: recalcula el resumen por día usando jornadas (antes se usaba el día calendario)
export async function recalcularResumenJornadas() {
  const hecho = redis ? await redis.get('ventas:jornadas') : mem.ventasJornadas;
  if (hecho) return;
  const todas = await ventasEntre(0, Date.now() + 86400000);
  const nuevo = {};
  for (const v of todas) {
    const dia = jornadaDe(v.pa);
    for (const [campo, val] of [['total', v.t], [v.m, v.t], ['n', 1]]) nuevo[`${dia}|${campo}`] = (nuevo[`${dia}|${campo}`] || 0) + val;
  }
  if (redis) {
    await redis.del('ventas:resumen');
    if (Object.keys(nuevo).length) await redis.hset('ventas:resumen', nuevo);
    await redis.set('ventas:jornadas', 1);
  } else {
    mem.resumen = nuevo;
    mem.ventasJornadas = true;
  }
}

// ---------- Ajustes (QR de transferencia) ----------
export async function leerAjustes() {
  if (redis) return (await redis.get('ajustes')) || {};
  return mem.ajustes || {};
}
export async function guardarAjustes(a) {
  if (redis) await redis.set('ajustes', a);
  else mem.ajustes = a;
  return a;
}

// ---------- Cierres de caja (uno por jornada) ----------
export async function leerCierre(jornada) {
  if (redis) return (await redis.get(`cierre:${jornada}`)) || null;
  return (mem.cierres ||= {})[jornada] || null;
}
export async function guardarCierre(c) {
  if (redis) {
    await redis.set(`cierre:${c.jornada}`, c);
    await redis.zadd('cierres', { score: Date.parse(c.jornada + 'T12:00:00-05:00'), member: c.jornada });
  } else {
    (mem.cierres ||= {})[c.jornada] = c;
  }
  return c;
}
export async function listarCierres(limite = 60) {
  if (redis) {
    const js = await redis.zrange('cierres', 0, limite - 1, { rev: true });
    if (!js.length) return [];
    return (await redis.mget(...js.map((j) => `cierre:${j}`))).filter(Boolean);
  }
  return Object.values(mem.cierres || {}).sort((a, b) => (a.jornada < b.jornada ? 1 : -1)).slice(0, limite);
}
