// Almacenamiento de pedidos.
// En Vercel usa Upstash Redis (Storage > Marketplace). Sin variables de
// entorno cae a memoria (solo sirve para pruebas locales).
import { Redis } from '@upstash/redis';
import { CONFIG_INICIAL, migrar, partesDe } from '../../catalog.js';
import { jornadaDe } from '../../fechas.js';
import { AsyncLocalStorage } from 'node:async_hooks';

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const mem = globalThis.__granizadosMem || (globalThis.__granizadosMem = { seq: 0, rev: 0, pedidos: new Map(), ventas: [], resumen: {} });

// ---------- Sedes ----------
// Cada sede tiene sus propios pedidos, ventas, caja, inventario, compras, gastos, presupuesto
// y ajustes de domicilio. La sede principal (San Pío) usa las llaves de siempre (no se pierde
// nada de lo que ya había); las demás usan llaves con prefijo "s:<sede>:".
// El catálogo (productos y precios), los usuarios y los roles son de todas las sedes.
export const SEDE_PRINCIPAL = 'san-pio';
export const SEDES_INICIALES = [{ id: SEDE_PRINCIPAL, nombre: 'Enclocha 2 San Pío', principal: true, activa: true }];
const ctx = new AsyncLocalStorage();
export const enSede = (sede, fn) => ctx.run({ sede: sede || SEDE_PRINCIPAL }, fn);
export const sedeActual = () => ctx.getStore()?.sede || SEDE_PRINCIPAL;
const K = (nombre) => (sedeActual() === SEDE_PRINCIPAL ? nombre : `s:${sedeActual()}:${nombre}`);
// memoria (solo pruebas locales) separada por sede
const M = () => (sedeActual() === SEDE_PRINCIPAL ? mem
  : ((mem.sedesMem ||= {})[sedeActual()] ||= { seq: 0, rev: 0, pedidos: new Map(), ventas: [], resumen: {} }));

export async function leerSedes() {
  const l = redis ? await redis.get('sedes') : mem.sedes;
  return l?.length ? l : structuredClone(SEDES_INICIALES);
}
export async function guardarSedes(lista) {
  if (redis) await redis.set('sedes', lista); else mem.sedes = structuredClone(lista);
  return lista;
}

const IDX = () => K('pedidos:idx');
const key = (id) => K(`pedido:${id}`);
const TTL = 60 * 60 * 24 * 120; // los pedidos se guardan 120 días (las ventas quedan para siempre)

export const usandoRedis = !!redis;

export async function siguienteNumero() {
  if (redis) return await redis.incr(K('pedidos:seq'));
  return ++M().seq;
}

// "Revisión": número que sube con cada cambio. Las pantallas preguntan solo esto
// (1 operación) y descargan la lista completa únicamente si cambió.
export async function leerRev() {
  if (redis) return Number(await redis.get(K('pedidos:rev'))) || 0;
  return M().rev;
}
async function subirRev() {
  if (redis) await redis.incr(K('pedidos:rev'));
  else M().rev++;
}

export async function guardar(pedido) {
  if (redis) {
    await redis.set(key(pedido.id), pedido, { ex: TTL });
    await redis.zadd(IDX(), { score: pedido.creado, member: pedido.id });
  } else {
    M().pedidos.set(pedido.id, pedido);
  }
  await subirRev();
  return pedido;
}

export async function obtener(id) {
  if (redis) return await redis.get(key(id));
  return M().pedidos.get(id) || null;
}

export async function listar(limite = 150) {
  if (redis) {
    const ids = await redis.zrange(IDX(), 0, limite - 1, { rev: true });
    if (!ids.length) return [];
    const datos = await redis.mget(...ids.map(key));
    const vivos = datos.filter(Boolean);
    // limpiar índices de pedidos expirados
    const muertos = ids.filter((_, i) => !datos[i]);
    if (muertos.length) await redis.zrem(IDX(), ...muertos);
    return vivos;
  }
  return [...M().pedidos.values()].sort((a, b) => b.creado - a.creado).slice(0, limite);
}

export async function borrar(id) {
  if (redis) {
    await redis.del(key(id));
    await redis.zrem(IDX(), id);
  } else {
    M().pedidos.delete(id);
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
    ...(p.pago.metodo === 'mixto' ? { ef: p.pago.efectivo || 0 } : {}),
    ...(p.pago.partes?.length ? { pt: p.pago.partes.map((x) => [x.metodo === 'efectivo' ? 'e' : 't', x.valor, x.quien || '']) } : {}),
    pa: p.pago.pagadoEn, cr: p.creado, u: p.tomadoPor || '', cb: p.pago.cobradoPor || '',
    it: [
      ...p.items.map((i) => { const [nombre, cat] = nombreItem(i); return [nombre, i.cantidad || 1, i.subtotal || 0, cat]; }),
      ...(p.domicilio?.costo ? [['Domicilio', 1, p.domicilio.costo, 'Domicilio']] : []),
    ],
    ...(p.tipo === 'domicilio' ? { dom: 1 } : {}),
  };
}

// Lo que suma una venta en el resumen del día (una venta mixta suma a efectivo y a transferencia)
function camposResumen(v) {
  const pt = partesDe(v);
  return [['total', v.t], ['efectivo', pt.efectivo], ['transferencia', pt.transferencia], ['n', 1]].filter(([, x]) => x);
}
function sumarResumen(dia, v, signo) {
  for (const [c, x] of camposResumen(v)) M().resumen[`${dia}|${c}`] = (M().resumen[`${dia}|${c}`] || 0) + signo * x;
}

export async function registrarVenta(p) {
  if (!p.pago?.pagado || p.pago.registro || p.estado === 'cancelado') return;
  const v = resumenVenta(p);
  const member = JSON.stringify(v);
  p.pago.registro = member;
  const dia = diaBogota(v.pa);
  if (redis) {
    const pl = redis.pipeline();
    pl.zadd(K('ventas'), { score: v.pa, member });
    for (const [c, x] of camposResumen(v)) pl.hincrby(K('ventas:resumen'), `${dia}|${c}`, x);
    await pl.exec();
  } else {
    M().ventas.push({ score: v.pa, member });
    sumarResumen(dia, v, 1);
  }
}

export async function anularVenta(p) {
  const member = p.pago?.registro;
  if (!member) return;
  const v = JSON.parse(member);
  const dia = diaBogota(v.pa);
  if (redis) {
    const pl = redis.pipeline();
    pl.zrem(K('ventas'), member);
    for (const [c, x] of camposResumen(v)) pl.hincrby(K('ventas:resumen'), `${dia}|${c}`, -x);
    await pl.exec();
  } else {
    M().ventas = M().ventas.filter((x) => x.member !== member);
    sumarResumen(dia, v, -1);
  }
  delete p.pago.registro;
}

export async function ventasEntre(ini, fin) {
  let lista;
  if (redis) lista = await redis.zrange(K('ventas'), ini, fin, { byScore: true });
  else lista = M().ventas.filter((x) => x.score >= ini && x.score <= fin).sort((a, b) => a.score - b.score).map((x) => x.member);
  return lista.map((x) => (typeof x === 'string' ? JSON.parse(x) : x));
}

export async function leerResumen() {
  const raw = redis ? (await redis.hgetall(K('ventas:resumen'))) || {} : M().resumen;
  const dias = {};
  for (const [k, val] of Object.entries(raw)) {
    const [dia, campo] = k.split('|');
    (dias[dia] ||= { total: 0, efectivo: 0, transferencia: 0, n: 0 })[campo] = Number(val) || 0;
  }
  return dias;
}

// Una sola vez: pasa a "ventas" los pedidos ya cobrados antes de esta versión
export async function migrarVentas() {
  const hecho = redis ? await redis.get(K('ventas:migrado')) : M().ventasMigrado;
  if (hecho) return;
  for (const p of await listar(1000)) {
    if (p.pago?.pagado && p.estado !== 'cancelado' && !p.pago.registro) {
      await registrarVenta(p);
      await guardar(p);
    }
  }
  if (redis) await redis.set(K('ventas:migrado'), 1); else M().ventasMigrado = true;
}

// Una sola vez: recalcula el resumen por día usando jornadas (antes se usaba el día calendario)
export async function recalcularResumenJornadas() {
  const hecho = redis ? await redis.get(K('ventas:jornadas')) : M().ventasJornadas;
  if (hecho) return;
  const todas = await ventasEntre(0, Date.now() + 86400000);
  const nuevo = {};
  for (const v of todas) {
    const dia = jornadaDe(v.pa);
    for (const [campo, val] of camposResumen(v)) nuevo[`${dia}|${campo}`] = (nuevo[`${dia}|${campo}`] || 0) + val;
  }
  if (redis) {
    await redis.del(K('ventas:resumen'));
    if (Object.keys(nuevo).length) await redis.hset(K('ventas:resumen'), nuevo);
    await redis.set(K('ventas:jornadas'), 1);
  } else {
    M().resumen = nuevo;
    M().ventasJornadas = true;
  }
}

// ---------- Ajustes (QR de transferencia) ----------
// Los AJUSTES (QR de pago, configuración de domicilios…) son los mismos en todas las sedes: lo que se
// cambie en una se aplica en todas. Lo único propio de cada sede es la UBICACIÓN del local (desde ahí se
// mide la distancia de cada domicilio), que se guarda aparte por sede.
export async function leerAjustes() {
  let a = (redis ? await redis.get('ajustes') : mem.ajustes) || {};
  if (sedeActual() !== SEDE_PRINCIPAL) {
    // versiones anteriores: la sede tenía sus propios ajustes → se conserva solo su ubicación
    const vieja = redis ? await redis.get(K('ajustes')) : M().ajustes;
    let local = redis ? await redis.get(K('ajustes:local')) : M().ajustesLocal;
    if (vieja) {
      if (local === null || local === undefined) { local = vieja.domicilio?.local || null; if (redis) await redis.set(K('ajustes:local'), local ?? 0); else M().ajustesLocal = local ?? 0; }
      if (redis) await redis.del(K('ajustes')); else delete M().ajustes;
    }
    a = { ...a, domicilio: a.domicilio ? { ...a.domicilio, local: local || null } : a.domicilio };
  }
  return a;
}
export async function guardarAjustes(a) {
  const { domicilio } = a;
  if (sedeActual() !== SEDE_PRINCIPAL && domicilio) {
    // la ubicación es de esta sede; el resto es para todas (se conserva la ubicación de San Pío)
    const comun = (redis ? await redis.get('ajustes') : mem.ajustes) || {};
    if (redis) await redis.set(K('ajustes:local'), domicilio.local || 0); else M().ajustesLocal = domicilio.local || 0;
    a = { ...a, domicilio: { ...domicilio, local: comun.domicilio?.local || null } };
  }
  if (redis) await redis.set('ajustes', a); else mem.ajustes = a;
  return a;
}

// ---------- Cierres de caja (uno por jornada) ----------
export async function leerCierre(jornada) {
  if (redis) return (await redis.get(K(`cierre:${jornada}`))) || null;
  return (M().cierres ||= {})[jornada] || null;
}
export async function guardarCierre(c) {
  if (redis) {
    await redis.set(K(`cierre:${c.jornada}`), c);
    await redis.zadd(K('cierres'), { score: Date.parse(c.jornada + 'T12:00:00-05:00'), member: c.jornada });
  } else {
    (M().cierres ||= {})[c.jornada] = c;
  }
  return c;
}
export async function listarCierres(limite = 60) {
  if (redis) {
    const js = await redis.zrange(K('cierres'), 0, limite - 1, { rev: true });
    if (!js.length) return [];
    return (await redis.mget(...js.map((j) => K(`cierre:${j}`)))).filter(Boolean);
  }
  return Object.values(M().cierres || {}).sort((a, b) => (a.jornada < b.jornada ? 1 : -1)).slice(0, limite);
}

// ---------- Compras ----------
const scoreFecha = (f) => Date.parse(f + 'T12:00:00-05:00');
export async function guardarCompra(c) {
  if (redis) {
    await redis.set(K(`compra:${c.id}`), c);
    await redis.zadd(K('compras'), { score: scoreFecha(c.fecha), member: c.id });
  } else (M().compras ||= new Map()).set(c.id, c);
  return c;
}
export async function leerCompra(id) {
  if (redis) return (await redis.get(K(`compra:${id}`))) || null;
  return (M().compras ||= new Map()).get(id) || null;
}
export async function borrarCompra(id) {
  if (redis) { await redis.del(K(`compra:${id}`)); await redis.zrem(K('compras'), id); }
  else (M().compras ||= new Map()).delete(id);
}
export async function comprasEntre(desde, hasta) {
  const ini = scoreFecha(desde), fin = scoreFecha(hasta);
  if (redis) {
    const ids = await redis.zrange(K('compras'), ini, fin, { byScore: true });
    const out = [];
    for (let i = 0; i < ids.length; i += 200) out.push(...(await redis.mget(...ids.slice(i, i + 200).map((x) => K(`compra:${x}`)))));
    return out.filter(Boolean);
  }
  return [...(M().compras ||= new Map()).values()].filter((c) => c.fecha >= desde && c.fecha <= hasta);
}

// ---------- Gastos fijos ----------
export async function leerGastosFijos() {
  if (redis) return (await redis.get(K('gastosfijos'))) || [];
  return M().gastosFijos || [];
}
export async function guardarGastosFijos(lista) {
  if (redis) await redis.set(K('gastosfijos'), lista); else M().gastosFijos = lista;
  return lista;
}
export async function leerPagosFijos(mes) {
  if (redis) return (await redis.get(K(`pagosfijos:${mes}`))) || [];
  return (M().pagosFijos ||= {})[mes] || [];
}
export async function guardarPagosFijos(mes, pagos) {
  if (redis) await redis.set(K(`pagosfijos:${mes}`), pagos); else (M().pagosFijos ||= {})[mes] = pagos;
  return pagos;
}
export async function pagosFijosAnio(anio) {
  const meses = Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, '0')}`);
  if (redis) {
    const r = await redis.mget(...meses.map((m) => K(`pagosfijos:${m}`)));
    return Object.fromEntries(meses.map((m, i) => [m, r[i] || []]));
  }
  return Object.fromEntries(meses.map((m) => [m, (M().pagosFijos ||= {})[m] || []]));
}

// ---------- Inventario ----------
// Definiciones (nombre, unidad, mínimo, reglas) en "inventario"; el stock en un hash
// aparte ("inv:stock") que se suma/resta de forma atómica, para que dos ventas al
// mismo tiempo no se pisen. Movimientos en una lista (últimos 3000).
// La LISTA de ítems del inventario (nombres, unidades, empaques, reglas, tapas, reutilizables) es la misma
// para todas las sedes: se guarda en la llave de siempre ("inventario"). Lo que va por sede es el STOCK,
// los movimientos y las peceras prestadas. Si una sede tenía su propia lista (versiones anteriores),
// sus ítems se suman a la lista común una sola vez.
export async function leerInventario() {
  const otraSede = sedeActual() !== SEDE_PRINCIPAL;
  if (redis) {
    let lista = (await redis.get('inventario')) || [];
    if (otraSede) {
      const vieja = await redis.get(K('inventario'));
      if (vieja?.length) {
        const ids = new Set(lista.map((i) => i.id));
        const nuevos = vieja.filter((i) => !ids.has(i.id));
        if (nuevos.length) { lista = [...lista, ...nuevos]; await redis.set('inventario', lista); }
      }
      if (vieja) await redis.del(K('inventario'));
    }
    return lista;
  }
  if (otraSede && M().inventario?.length) {
    const ids = new Set((mem.inventario || []).map((i) => i.id));
    mem.inventario = [...(mem.inventario || []), ...M().inventario.filter((i) => !ids.has(i.id))];
    delete M().inventario;
  }
  return mem.inventario || [];
}
export async function guardarInventario(lista) {
  if (redis) await redis.set('inventario', lista); else mem.inventario = lista;
  return lista;
}
export async function leerStock() {
  const raw = redis ? (await redis.hgetall(K('inv:stock'))) || {} : (M().stock ||= {});
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.round(Number(v) * 1000) / 1000]));
}
// deltas = { id: +n / -n }; mov = descripción del movimiento (se guarda con los deltas)
export async function moverStock(deltas, mov) {
  const ids = Object.keys(deltas).filter((k) => deltas[k]);
  if (!ids.length) return;
  const registro = { ...mov, deltas, en: Date.now() };
  if (redis) {
    const pl = redis.pipeline();
    for (const id of ids) pl.hincrbyfloat(K('inv:stock'), id, deltas[id]);
    pl.lpush(K('inv:movs'), JSON.stringify(registro));
    pl.ltrim(K('inv:movs'), 0, 2999);
    await pl.exec();
  } else {
    M().stock ||= {};
    for (const id of ids) M().stock[id] = (M().stock[id] || 0) + deltas[id];
    (M().movs ||= []).unshift(registro);
  }
}
export async function listarMovs(n = 300) {
  const raw = redis ? await redis.lrange(K('inv:movs'), 0, n - 1) : (M().movs || []).slice(0, n);
  return raw.map((x) => (typeof x === 'string' ? JSON.parse(x) : x));
}
// Reutilizables prestados (peceras que están con clientes): { idItem: cantidad }
export async function leerPrestados() {
  const h = redis ? await redis.hgetall(K('inv:prestados')) : M().prestados;
  return Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k, Number(v) || 0]).filter(([, v]) => v > 0));
}
export async function moverPrestados(deltas) {
  const ids = Object.keys(deltas || {}).filter((k) => deltas[k]);
  if (!ids.length) return;
  if (redis) { const pl = redis.pipeline(); for (const id of ids) pl.hincrby(K('inv:prestados'), id, deltas[id]); await pl.exec(); }
  else { M().prestados ||= {}; for (const id of ids) M().prestados[id] = Math.max(0, (M().prestados[id] || 0) + deltas[id]); }
}
export const invertir = (d) => Object.fromEntries(Object.entries(d || {}).map(([k, v]) => [k, -v]));

// ---------- Límite de intentos (para la página pública) ----------
export async function limitar(clave, max, segundos) {
  if (redis) {
    const n = await redis.incr(`rl:${clave}`);
    if (n === 1) await redis.expire(`rl:${clave}`, segundos);
    return n <= max;
  }
  const m = (mem.rl ||= {}), ahora = Date.now();
  if (!m[clave] || m[clave].hasta < ahora) m[clave] = { n: 0, hasta: ahora + segundos * 1000 };
  return ++m[clave].n <= max;
}

// Devuelve true solo la primera vez que se llama con esa clave (para migraciones únicas)
export async function marcaUnaVez(clave) {
  if (redis) return (await redis.set(K(`hecho:${clave}`), 1, { nx: true })) === 'OK';
  M().hecho ||= {};
  if (M().hecho[clave]) return false;
  return (M().hecho[clave] = true);
}

// ---------- Presupuesto mensual ----------
export async function leerPresupuesto(mes) {
  if (redis) return (await redis.get(K(`presupuesto:${mes}`))) || null;
  return (M().presupuestos ||= {})[mes] || null;
}
export async function guardarPresupuesto(mes, p) {
  if (redis) await redis.set(K(`presupuesto:${mes}`), p); else (M().presupuestos ||= {})[mes] = p;
  return p;
}
export async function leerPresupuestoBase() {
  if (redis) return (await redis.get(K('presupuesto:base'))) || null;
  return M().presupuestoBase || null;
}
export async function guardarPresupuestoBase(p) {
  if (redis) await redis.set(K('presupuesto:base'), p); else M().presupuestoBase = p;
  return p;
}

// ---------- Días que no se trabaja (para todas las sedes) ----------
export async function leerDiasCerrados() {
  const l = redis ? await redis.get('dias:cerrados') : mem.diasCerrados;
  return Array.isArray(l) ? l : [];
}
export async function guardarDiasCerrados(lista) {
  const hoy = jornadaDe(Date.now());
  const l = [...new Set(lista)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= hoy).sort().slice(0, 60); // solo de hoy en adelante
  if (redis) await redis.set('dias:cerrados', l); else mem.diasCerrados = l;
  return l;
}

// ---------- Proveedores (iguales para todas las sedes) ----------
export async function leerProveedores() {
  const l = redis ? await redis.get('proveedores') : mem.proveedores;
  return Array.isArray(l) ? l : [];
}
export async function guardarProveedores(lista) {
  if (redis) await redis.set('proveedores', lista); else mem.proveedores = lista;
  return lista;
}

// ---------- Factura (foto o scan) de cada compra ----------
// El archivo va en su propia llave (no se trae al listar); la lista solo sabe si hay adjunto.
export async function guardarAdjunto(factura, adj) {
  const meta = { nombre: adj.nombre, tipo: adj.tipo, tam: adj.data.length, subidoPor: adj.subidoPor, en: Date.now() };
  if (redis) { const pl = redis.pipeline(); pl.set(K(`factura:archivo:${factura}`), adj.data); pl.hset(K('facturas:adjuntos'), { [factura]: JSON.stringify(meta) }); await pl.exec(); }
  else { (M().adjuntos ||= {})[factura] = { ...meta, data: adj.data }; }
  return meta;
}
export async function leerAdjunto(factura) {
  if (redis) {
    const [data, meta] = await Promise.all([redis.get(K(`factura:archivo:${factura}`)), redis.hget(K('facturas:adjuntos'), factura)]);
    return data ? { data, ...(typeof meta === 'string' ? JSON.parse(meta) : meta || {}) } : null;
  }
  return M().adjuntos?.[factura] || null;
}
export async function borrarAdjunto(factura) {
  if (redis) { const pl = redis.pipeline(); pl.del(K(`factura:archivo:${factura}`)); pl.hdel(K('facturas:adjuntos'), factura); await pl.exec(); }
  else if (M().adjuntos) delete M().adjuntos[factura];
}
export async function metaAdjuntos(ids) {
  if (!ids.length) return {};
  if (redis) {
    const vals = await redis.hmget(K('facturas:adjuntos'), ...ids);
    const o = {}; ids.forEach((id, k) => { const v = Array.isArray(vals) ? vals[k] : vals?.[id]; if (v) o[id] = typeof v === 'string' ? JSON.parse(v) : v; });
    return o;
  }
  const o = {}; for (const id of ids) if (M().adjuntos?.[id]) { const { data, ...m } = M().adjuntos[id]; o[id] = m; } return o;
}

// ---------- Costos puestos a mano (insumos sin compra registrada) — iguales en todas las sedes ----------
export async function leerCostosManual() {
  const o = redis ? await redis.get('costos:manual') : mem.costosManual;
  return o && typeof o === 'object' ? o : {};
}
export async function guardarCostosManual(o) {
  if (redis) await redis.set('costos:manual', o); else mem.costosManual = o;
  return o;
}

// ---------- Comprobantes de transferencias (pedido → archivo) ----------
export async function marcarComprobantes(ids, clave) {
  if (!ids.length) return;
  if (redis) await redis.hset(K('comprobantes'), Object.fromEntries(ids.map((id) => [id, clave])));
  else Object.assign((M().comprobantes ||= {}), Object.fromEntries(ids.map((id) => [id, clave])));
}
export async function comprobantesDe(ids) {
  if (!ids.length) return {};
  if (redis) {
    const out = {};
    for (let i = 0; i < ids.length; i += 300) {
      const parte = ids.slice(i, i + 300), vals = await redis.hmget(K('comprobantes'), ...parte);
      parte.forEach((id, k) => { const v = Array.isArray(vals) ? vals[k] : vals?.[id]; if (v) out[id] = v; });
    }
    return out;
  }
  const o = {}; for (const id of ids) if (M().comprobantes?.[id]) o[id] = M().comprobantes[id]; return o;
}

// ---------- Totales de meses anteriores (antes de usar la app), por sede ----------
// { 'AAAA-MM': { ventasEf, ventasTr, comprasEf, comprasTr } }
export async function leerHistorico() {
  const o = redis ? await redis.get(K('historico')) : M().historico;
  return o && typeof o === 'object' ? o : {};
}
export async function guardarHistorico(o) {
  if (redis) await redis.set(K('historico'), o); else M().historico = o;
  return o;
}
