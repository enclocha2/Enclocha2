// Almacenamiento de pedidos.
// En Vercel usa Upstash Redis (Storage > Marketplace). Sin variables de
// entorno cae a memoria (solo sirve para pruebas locales).
import { Redis } from '@upstash/redis';
import { CONFIG_INICIAL, migrar } from '../../catalog.js';

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const mem = globalThis.__granizadosMem || (globalThis.__granizadosMem = { seq: 0, pedidos: new Map() });

const IDX = 'pedidos:idx';
const key = (id) => `pedido:${id}`;
const TTL = 60 * 60 * 24 * 30; // 30 días

export const usandoRedis = !!redis;

export async function siguienteNumero() {
  if (redis) return await redis.incr('pedidos:seq');
  return ++mem.seq;
}

export async function guardar(pedido) {
  if (redis) {
    await redis.set(key(pedido.id), pedido, { ex: TTL });
    await redis.zadd(IDX, { score: pedido.creado, member: pedido.id });
  } else {
    mem.pedidos.set(pedido.id, pedido);
  }
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
