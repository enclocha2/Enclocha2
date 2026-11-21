import { randomUUID } from 'node:crypto';
import { sesion } from './_lib/auth.js';
import gastosFijos from './_lib/gastosfijos.js';
import presupuesto, { presupuestoDe } from './_lib/presupuesto.js';
import { guardarCompra, leerCompra, borrarCompra, comprasEntre, leerInventario, guardarInventario, moverStock, leerProveedores, guardarProveedores, guardarAdjunto, leerAdjunto, borrarAdjunto, metaAdjuntos, leerCostosManual, guardarCostosManual } from './_lib/store.js';
import { CATEGORIAS_COMPRA, UNIDADES, UNIDADES_INV, PAGOS_COMPRA, normalizar, slug, empaquesSugeridos } from '../catalog.js';
import { repartirPresupuesto } from '../catalog.js';
import { conSede } from './_lib/sede.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const txt = (s, n) => String(s ?? '').trim().slice(0, n);
const leer = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});

function validar(b) {
  const insumo = txt(b.insumo, 80) || (b.insumoId ? '…' : '');
  if (!insumo) throw new Error('Escoge qué se compró');
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
    origen: b.origen === 'ventas' || b.origen === 'caja' ? 'ventas' : 'presupuesto',
    proveedor: txt(b.proveedor, 60),
    nota: txt(b.nota, 200),
  };
}

// ---------- Compras estandarizadas ----------
// La compra se hace sobre un INSUMO de la lista (los ítems del inventario + los insumos "solo compras"),
// en una PRESENTACIÓN (la unidad o uno de sus empaques: "paquete con tapa x20"...). Así todas las compras
// del mismo insumo quedan con el mismo nombre y se pueden comparar (homologar).
// b = { insumoId, presentacion (nombre del empaque o ''), cantidad, ... }
async function estandarizar(b, datos) {
  if (!b.insumoId) return datos; // compra antigua de texto libre
  const items = await leerInventario();
  const it = items.find((x) => x.id === b.insumoId);
  if (!it) throw new Error('Ese insumo ya no existe. Escoge otro de la lista.');
  const emp = b.presentacion ? (it.empaques || []).find((e) => e.nombre === b.presentacion) : null;
  if (b.presentacion && !emp) throw new Error('Esa presentación ya no existe para este insumo');
  if (!emp && it.reglas?.some((r) => r.tipo === 'sabor') && it.empaques?.length) throw new Error('Los sabores se compran por bolsa: escoge "bolsa de 6 litros" o "bolsa de 3 litros"');
  if (!emp && (it.tapa || /vaso/.test(normalizar(it.nombre))) && it.empaques?.length) throw new Error('Los vasos se compran por paquete: escoge "paquete de vasos" o "paquete de vasos con tapa"');
  const cantidad = Math.round((Number(b.cantidad) || 0) * 1000) / 1000;
  if (!(cantidad > 0)) throw new Error('Escribe la cantidad que se compró');
  const unidades = Math.round(cantidad * (emp ? emp.unidades : 1) * 1000) / 1000;
  const tapa = emp?.conTapa && it.tapa && items.find((x) => x.id === it.tapa);
  return {
    ...datos, insumoId: it.id, insumo: it.nombre, categoria: it.categoria,
    cantidad, unidad: emp ? emp.nombre : it.unidad, presentacion: emp ? emp.nombre : '', unidades, unidadBase: it.unidad,
    ...(tapa ? { tapas: unidades } : {}),
    // los que llevan stock entran solos al inventario (y sus tapas si el paquete las trae)
    inventario: it.soloCompras ? null : { id: it.id, nombre: it.nombre, unidad: it.unidad, cantidad: unidades, ...(tapa ? { tapa: tapa.id } : {}) },
  };
}

// ---------- Presupuesto con tope ----------
// Trae las compras del rango con su reparto (cuánto sale del presupuesto y cuánto de ventas).
// El reparto se calcula con TODO el mes, en orden, así el presupuesto nunca se pasa.
const mesesEntre = (d, h) => { const out = []; let m = d.slice(0, 7); while (m <= h.slice(0, 7)) { out.push(m); const [y, mm] = m.split('-').map(Number); m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`; } return out; };
async function conReparto(desde, hasta) {
  const meses = mesesEntre(desde, hasta);
  const todas = await comprasEntre(`${meses[0]}-01`, `${meses.at(-1)}-31`);
  const montos = await Promise.all(meses.map((m) => presupuestoDe(m)));
  const out = [];
  meses.forEach((m, i) => {
    const delMes = todas.filter((c) => c.fecha.startsWith(m));
    const { reparto } = repartirPresupuesto(delMes, montos[i].monto);
    for (const c of delMes) if (c.fecha >= desde && c.fecha <= hasta) out.push({ ...c, reparto: reparto[c.id] });
  });
  return out;
}
async function repartoFactura(compras) {
  if (!compras.length) return null;
  const f = compras[0].fecha, ids = new Set(compras.map((c) => c.id));
  const delMes = await conReparto(`${f.slice(0, 7)}-01`, `${f.slice(0, 7)}-31`);
  const t = { pres: 0, ventas: 0, caja: 0 };
  for (const c of delMes) if (ids.has(c.id)) { t.pres += c.reparto.pres; t.ventas += c.reparto.ventas; t.caja += c.reparto.caja; }
  return t;
}

// ---------- Proveedores ----------
// Proveedor fijo: nombre + NIT (y si se quiere teléfono y contacto). La tienda de barrio no necesita nada.
const limpiarNit = (n) => String(n || '').replace(/[^0-9kK-]/g, '').slice(0, 20);
async function conProveedor(b, datos) {
  if (!b.proveedorId) return { ...datos, proveedorId: null, nit: '' };
  const p = (await leerProveedores()).find((x) => x.id === b.proveedorId);
  if (!p) throw new Error('Ese proveedor ya no existe');
  return { ...datos, proveedorId: p.id, proveedor: p.nombre, nit: p.nit || '' };
}

// Crear un insumo nuevo desde Compras (queda en la lista para siempre)
async function crearInsumo(b) {
  const nombre = txt(b.nombre, 60);
  if (nombre.length < 2) throw new Error('Escribe el nombre del insumo');
  const items = await leerInventario();
  if (items.some((x) => normalizar(x.nombre) === normalizar(nombre))) throw new Error('Ya existe un insumo con ese nombre');
  let id = slug(nombre) || 'insumo'; while (items.some((x) => x.id === id)) id += '-2';
  const empaques = (Array.isArray(b.empaques) ? b.empaques : empaquesSugeridos(nombre)).slice(0, 6)
    .map((e) => ({ nombre: txt(e.nombre, 30), unidades: Math.max(0, Number(e.unidades) || 0), ...(e.conTapa ? { conTapa: true } : {}) })).filter((e) => e.nombre && e.unidades > 0);
  const it = {
    id, nombre, categoria: CATEGORIAS_COMPRA.some((c) => c.id === b.categoria) ? b.categoria : 'otros',
    unidad: UNIDADES_INV.includes(b.unidad) ? b.unidad : 'und', minimo: 0, reglas: [], activo: true, empaques,
    ...(b.soloCompras ? { soloCompras: true } : {}),
  };
  await guardarInventario([...items, it]);
  return it;
}

// Si la compra entra al inventario: { id, cantidad } (cantidad en la unidad del ítem de inventario)
async function validarInventario(b) {
  if (!b.inventario?.id) return null;
  const items = await leerInventario();
  const it = items.find((x) => x.id === b.inventario.id);
  const cantidad = Math.round((Number(b.inventario.cantidad) || 0) * 1000) / 1000;
  if (!it) throw new Error('El ítem de inventario no existe');
  if (!(cantidad > 0)) throw new Error('Escribe cuánto entra al inventario');
  const tapa = b.inventario.conTapas && it.tapa && items.some((x) => x.id === it.tapa) ? it.tapa : null; // vasos con tapa
  return { id: it.id, nombre: it.nombre, unidad: it.unidad, cantidad, ...(tapa ? { tapa } : {}) };
}
const entrada = (inv, signo, extra) => inv && moverStock({ [inv.id]: signo * inv.cantidad, ...(inv.tapa ? { [inv.tapa]: signo * inv.cantidad } : {}) }, extra);

// Vercel Hobby permite máximo 12 funciones: /api/compras?r=gastosfijos y ?r=presupuesto se atienden aquí
const ruta = (req) => req.query?.r ?? new URL(req.url, 'http://x').searchParams.get('r');

async function handler(req, res) {
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
    // ---------- Proveedores ----------
    if (r === 'proveedores') {
      const lista = await leerProveedores();
      if (req.method === 'GET') return res.status(200).json({ proveedores: lista });
      if (!yo.puede('compras')) return res.status(403).json({ error: 'No tienes permiso' });
      const b = leer(req);
      if (req.method === 'DELETE') return res.status(200).json({ proveedores: await guardarProveedores(lista.filter((p) => p.id !== (q.id || b.id))) });
      const nombre = txt(b.nombre, 80), nit = limpiarNit(b.nit);
      if (nombre.length < 2) return res.status(400).json({ error: 'Escribe el nombre del proveedor' });
      if (!nit) return res.status(400).json({ error: 'Escribe el NIT (para la tienda de barrio no hace falta registrar proveedor)' });
      const datos = { nombre, nit, telefono: txt(b.telefono, 20), contacto: txt(b.contacto, 60), nota: txt(b.nota, 120) };
      if (req.method === 'POST') {
        if (lista.some((p) => p.nit === nit)) return res.status(400).json({ error: 'Ya hay un proveedor con ese NIT' });
        const p = { id: randomUUID().slice(0, 8), ...datos, creado: Date.now(), creadoPor: usuario };
        await guardarProveedores([...lista, p]);
        return res.status(201).json({ proveedor: p, proveedores: [...lista, p] });
      }
      if (req.method === 'PUT') {
        const p = lista.find((x) => x.id === b.id); if (!p) return res.status(404).json({ error: 'Proveedor no encontrado' });
        if (lista.some((x) => x.id !== p.id && x.nit === nit)) return res.status(400).json({ error: 'Ya hay un proveedor con ese NIT' });
        Object.assign(p, datos);
        await guardarProveedores(lista);
        return res.status(200).json({ proveedor: p, proveedores: lista });
      }
    }
    // ---------- Costos a mano (por unidad del insumo) ----------
    if (r === 'costos') {
      if (req.method === 'GET') return res.status(200).json({ manual: await leerCostosManual() });
      if (req.method === 'PUT') {
        if (!yo.puede('compras_editar') && !yo.puede('compras')) return res.status(403).json({ error: 'No tienes permiso' });
        const b = leer(req), o = await leerCostosManual(), id = String(b.id || '').slice(0, 80);
        if (!id) return res.status(400).json({ error: 'Falta el insumo' });
        const v = Number(b.costo);
        if (b.costo === null || b.costo === '' || !(v >= 0)) delete o[id]; else o[id] = Math.round(v * 100) / 100;
        return res.status(200).json({ manual: await guardarCostosManual(o) });
      }
    }
    // ---------- Foto o scan de la factura ----------
    if (r === 'adjunto') {
      const factura = String(q.factura || leer(req).factura || '').slice(0, 64);
      if (!factura) return res.status(400).json({ error: 'Falta la factura' });
      if (req.method === 'GET') { const a = await leerAdjunto(factura); return a ? res.status(200).json(a) : res.status(404).json({ error: 'Esta compra no tiene factura adjunta' }); }
      if (!yo.puede('compras') && !(factura.startsWith('fijo-') && yo.puede('gastos'))) return res.status(403).json({ error: 'No tienes permiso' });
      if (req.method === 'DELETE') { await borrarAdjunto(factura); return res.status(200).json({ ok: true }); }
      if (req.method === 'PUT') {
        const b = leer(req);
        if (typeof b.data !== 'string' || !/^data:(image\/(jpeg|png|webp)|application\/pdf);base64,/.test(b.data)) return res.status(400).json({ error: 'El archivo debe ser una foto (JPG/PNG) o un PDF' });
        if (b.data.length > 950 * 1024) return res.status(400).json({ error: 'El archivo es muy pesado (máx. ~700 KB). Si es PDF, toma mejor una foto.' });
        const meta = await guardarAdjunto(factura, { data: b.data, nombre: txt(b.nombre, 80) || 'factura', tipo: b.data.slice(5, b.data.indexOf(';')), subidoPor: usuario });
        return res.status(200).json({ adjunto: meta });
      }
    }

    // Nuevo insumo desde Compras
    if (r === 'insumo' && req.method === 'POST') {
      if (!yo.puede('compras')) return res.status(403).json({ error: 'No tienes permiso' });
      try { return res.status(201).json({ insumo: await crearInsumo(leer(req)) }); } catch (e) { return res.status(400).json({ error: e.message }); }
    }
    // Homologar: compras viejas escritas a mano → un insumo de la lista
    if (r === 'homologar') {
      if (!yo.puede('compras_editar')) return res.status(403).json({ error: 'No tienes permiso' });
      const todas = await comprasEntre('2000-01-01', '2100-12-31');
      if (req.method === 'GET') {
        const m = new Map();
        for (const c of todas) if (!c.insumoId) { const k = c.insumo; const v = m.get(k) || { nombre: k, n: 0, total: 0, categoria: c.categoria }; v.n++; v.total += c.valor; m.set(k, v); }
        return res.status(200).json({ pendientes: [...m.values()].sort((a, b) => b.n - a.n) });
      }
      if (req.method === 'PUT') {
        const b = leer(req);
        const it = (await leerInventario()).find((x) => x.id === b.insumoId);
        if (!it) return res.status(400).json({ error: 'Escoge el insumo de la lista' });
        let n = 0;
        for (const c of todas) if (!c.insumoId && c.insumo === b.nombre) {
          await guardarCompra({ ...c, insumoId: it.id, insumo: it.nombre, categoria: it.categoria, insumoOriginal: c.insumo, homologadoPor: usuario });
          n++;
        }
        return res.status(200).json({ homologadas: n });
      }
    }

    if (req.method === 'GET') {
      if (!FECHA.test(q.desde || '') || !FECHA.test(q.hasta || '')) return res.status(400).json({ error: 'Fechas inválidas' });
      const compras = (await conReparto(q.desde, q.hasta)).sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.creado || 0) - (a.creado || 0) || (a.linea || 0) - (b.linea || 0));
      const facturas = [...new Set(compras.map((c) => c.factura || c.id))];
      const adjuntos = await metaAdjuntos(facturas);
      return res.status(200).json({ compras, adjuntos, admin: yo.puede('compras_editar') });
    }

    if (req.method === 'POST') {
      if (!yo.puede('compras')) return res.status(403).json({ error: 'No tienes permiso para registrar compras' });
      const b = leer(req);
      // Compra grande: varias líneas con la misma fecha, pago, proveedor y nota → se validan TODAS antes de guardar
      if (Array.isArray(b.lineas)) {
        if (!b.lineas.length) return res.status(400).json({ error: 'La compra no tiene productos' });
        if (b.lineas.length > 60) return res.status(400).json({ error: 'Máximo 60 productos por compra' });
        const comun = { fecha: b.fecha, pago: b.pago, origen: b.origen, proveedor: b.proveedor, nota: b.nota };
        const lista = [];
        for (const [k, l] of b.lineas.entries()) {
          try { const x = { ...comun, ...l, proveedorId: b.proveedorId }; let d = validar(x); d.inventario = await validarInventario(x); d = await estandarizar(x, d); d = await conProveedor(x, d); lista.push(d); }
          catch (e) { return res.status(400).json({ error: `Producto ${k + 1}: ${e.message}` }); }
        }
        const factura = randomUUID(), t = Date.now(), compras = [];
        for (const [k, d] of lista.entries()) {
          const compra = { id: randomUUID(), ...d, factura, linea: k, registradoPor: usuario, creado: t };
          await guardarCompra(compra);
          await entrada(compra.inventario, 1, { tipo: 'compra', nota: compra.insumo, usuario });
          compras.push(compra);
        }
        return res.status(201).json({ compras, factura, reparto: await repartoFactura(compras) });
      }
      let datos;
      try { datos = validar(b); datos.inventario = await validarInventario(b); datos = await estandarizar(b, datos); datos = await conProveedor(b, datos); } catch (e) { return res.status(400).json({ error: e.message }); }
      const idc = randomUUID();
      const compra = { id: idc, ...datos, factura: idc, registradoPor: usuario, creado: Date.now() };
      await guardarCompra(compra);
      await entrada(compra.inventario, 1, { tipo: 'compra', nota: compra.insumo, usuario });
      return res.status(201).json({ compra, reparto: await repartoFactura([compra]) });
    }

    if (req.method === 'PUT' || req.method === 'DELETE') {
      if (!yo.puede('compras_editar')) return res.status(403).json({ error: 'No tienes permiso para editar o borrar compras' });
      const id = req.method === 'DELETE' ? q.id : leer(req).id;
      const actual = id && (await leerCompra(String(id)));
      if (!actual) return res.status(404).json({ error: 'Compra no encontrada' });
      if (req.method === 'DELETE') {
        await borrarCompra(actual.id);
        if (actual.factura === actual.id) await borrarAdjunto(actual.id);
        await entrada(actual.inventario, -1, { tipo: 'compra-borrada', nota: actual.insumo, usuario });
        return res.status(200).json({ ok: true });
      }
      let datos;
      try { const b = leer(req); datos = validar(b); datos.inventario = await validarInventario(b); datos = await estandarizar(b, datos); datos = await conProveedor(b, datos); } catch (e) { return res.status(400).json({ error: e.message }); }
      // reversar la entrada anterior y aplicar la nueva
      await entrada(actual.inventario, -1, { tipo: 'compra-editada', nota: actual.insumo + ' (antes)', usuario });
      await entrada(datos.inventario, 1, { tipo: 'compra-editada', nota: datos.insumo, usuario });
      if (datos.fecha !== actual.fecha) await borrarCompra(actual.id); // reindexar por fecha
      const compra = { ...actual, ...datos, editadoPor: usuario, editado: Date.now() };
      await guardarCompra(compra);
      return res.status(200).json({ compra, reparto: await repartoFactura([compra]) });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}

export default conSede(handler);
