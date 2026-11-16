// Catálogo y reglas de precios, compartido entre el navegador y la API.
// Los productos/precios reales se guardan en la base de datos y se editan
// desde la pantalla "Productos". CONFIG_INICIAL es solo el punto de partida.

export const GRUPOS = [
  { id: 'paleta', nombre: 'Paleta' },
  { id: 'gusano', nombre: 'Gusano o aro' },
  { id: 'chicle', nombre: 'Chicles u Okaloka' },
  { id: 'bandera', nombre: 'Bandera de sandía' },
];

export const ESTADOS = ['nuevo', 'preparando', 'encamino', 'entregado', 'cancelado'];

export const METODOS_PAGO = [
  { id: 'efectivo', nombre: 'Efectivo', icono: '💵' },
  { id: 'transferencia', nombre: 'Transferencia', icono: '📲' },
];

export const pesos = (n) => '$' + Number(n || 0).toLocaleString('es-CO');

export const slug = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';

const CERVEZAS = ['Aguila', 'Aguila Light', 'Pilsen', 'Poker', 'Corona', 'Coronita',
  'Club Colombia Dorada', 'Club Colombia Roja', 'Costeñita', '3 Cordilleras'];

const LICOR = ['Litro Aguardiente Tetra Verde', 'Litro Aguardiente Tetra Rojo',
  'Media Aguardiente Verde', 'Media Aguardiente Rojo', 'Media Aguardiente Amarillo M',
  'Media Ron', 'Media Aguardiente Azul', 'Botella Aguardiente Amarillo M',
  'Botella Aguardiente Rojo', 'Botella Aguardiente Verde', 'Media de Whisky B&W',
  'Cuarto Aguardiente Rojo', 'Cuarto Aguardiente Verde', 'Fourloko',
  'Smirnoff Tamarindo en lata', 'Smirnoff Verde Personal', 'Smirnoff Rojo Personal'];

const SABORES = ['Mango Loco', 'Smirnoff de Tamarindo', 'Smirnoff de Lulo', 'Limonada de coco SL', 'Strawberry Passion'];

// Presentaciones agregadas en la v4 (arrancan sin precio: se fijan en "Productos")
const PRESENTACIONES_V4 = [
  ['Promoción 8 onzas', 'Promociones'], ['Promoción 12 onzas', 'Promociones'],
  ['Promoción 16 onzas', 'Promociones'], ['Promoción 20 onzas', 'Promociones'],
  ['Recarga 8 Onzas', 'Recargas'], ['Recarga 12 Onzas', 'Recargas'],
  ['Recarga 16 Onzas', 'Recargas'], ['Recarga 20 Onzas', 'Recargas'],
  ['Granizado 20 Onz Jueves', 'Jueves'], ['Granizado 12 * 2 Onz Jueves', 'Jueves'],
  ['Pecera', 'Especiales'], ['Nevera', 'Especiales'],
].map(([nombre, seccion]) => ({ id: slug(nombre), nombre, seccion, precio: 0, activo: true }));

export const SECCIONES = ['Tamaños', 'Promociones', 'Recargas', 'Jueves', 'Especiales'];

export const CONFIG_INICIAL = {
  version: 1,
  migraciones: ['presentaciones-v4'],
  tamanos: [
    { id: '8', nombre: '8 oz', seccion: 'Tamaños', precio: 8000, activo: true },
    { id: '12', nombre: '12 oz', seccion: 'Tamaños', precio: 12000, activo: true },
    { id: '16', nombre: '16 oz', seccion: 'Tamaños', precio: 16000, activo: true },
    { id: '20', nombre: '20 oz', seccion: 'Tamaños', precio: 20000, activo: true },
    ...PRESENTACIONES_V4,
  ],
  sabores: SABORES.map((n) => ({ id: slug(n), nombre: n, activo: true })),
  // precio = valor cuando se pide como ADICIONAL
  toppings: [
    { id: 'paleta-sandia', nombre: 'Paleta de sandía', grupo: 'paleta', precio: 1000, activo: true },
    { id: 'paleta-chamoy', nombre: 'Paleta de chamoy', grupo: 'paleta', precio: 1000, activo: true },
    { id: 'gusano', nombre: 'Gusano', grupo: 'gusano', precio: 500, activo: true },
    { id: 'aro', nombre: 'Aro', grupo: 'gusano', precio: 500, activo: true },
    { id: 'chicle', nombre: 'Chicles', grupo: 'chicle', precio: 800, activo: true },
    { id: 'okaloka', nombre: 'Okaloka', grupo: 'chicle', precio: 800, activo: true },
    { id: 'bandera', nombre: 'Bandera de sandía', grupo: 'bandera', precio: 500, activo: true },
  ],
  categorias: [
    { id: 'cervezas', nombre: 'Cervezas', icono: '🍺' },
    { id: 'licor', nombre: 'Licor', icono: '🥃' },
  ],
  productos: [
    ...CERVEZAS.map((n) => ({ id: slug(n), nombre: n, categoria: 'cervezas', precio: 0, activo: true })),
    ...LICOR.map((n) => ({ id: slug(n), nombre: n, categoria: 'licor', precio: 0, activo: true })),
  ],
};

// ---------- Migraciones: agrega lo nuevo a un catálogo ya guardado ----------
// Devuelve true si cambió algo (hay que guardarlo).
export function migrar(cfg) {
  let cambio = false;
  cfg.migraciones ||= [];
  for (const t of cfg.tamanos) if (!t.seccion) { t.seccion = 'Tamaños'; cambio = true; }
  if (!cfg.migraciones.includes('presentaciones-v4')) {
    for (const p of PRESENTACIONES_V4) {
      if (!cfg.tamanos.some((t) => t.id === p.id || t.nombre.toLowerCase() === p.nombre.toLowerCase())) cfg.tamanos.push({ ...p });
    }
    cfg.migraciones.push('presentaciones-v4');
    cambio = true;
  }
  return cambio;
}

// ---------- Validación de la configuración (al guardar desde "Productos") ----------
const txt = (s, max = 60) => String(s ?? '').trim().slice(0, max);
const idOk = (id) => /^[a-z0-9-]{1,48}$/.test(id);

function precioOk(n, nombre) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < 0 || v > 50_000_000) throw new Error(`Precio inválido en "${nombre}"`);
  return v;
}

function lista(arr, fn, que) {
  if (!Array.isArray(arr)) throw new Error(`Lista de ${que} inválida`);
  const ids = new Set();
  const nombres = new Set();
  return arr.map((x) => {
    const o = fn(x || {});
    if (!o.nombre) throw new Error(`Hay un elemento sin nombre en ${que}`);
    if (!idOk(o.id)) throw new Error(`Id inválido en ${que}: ${o.nombre}`);
    if (ids.has(o.id)) throw new Error(`Elemento repetido en ${que}: ${o.nombre}`);
    const clave = o.nombre.toLowerCase() + '|' + (o.categoria || o.grupo || '');
    if (nombres.has(clave)) throw new Error(`Nombre repetido en ${que}: ${o.nombre}`);
    ids.add(o.id); nombres.add(clave);
    return o;
  });
}

export function normalizarConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Configuración inválida');
  const grupos = new Set(GRUPOS.map((g) => g.id));

  const tamanos = lista(raw.tamanos, (t) => ({
    id: txt(t.id, 48), nombre: txt(t.nombre, 40), seccion: txt(t.seccion, 30) || 'Tamaños',
    precio: precioOk(t.precio, t.nombre), activo: !!t.activo,
    ...(t.receta && typeof t.receta === 'object' ? { receta: limpiarReceta(t.receta) } : {}),
  }), 'presentaciones');
  if (!tamanos.length) throw new Error('Debe haber al menos una presentación de granizado');

  const sabores = lista(raw.sabores, (s) => ({ id: txt(s.id, 48), nombre: txt(s.nombre, 50), activo: !!s.activo }), 'sabores');

  const toppings = lista(raw.toppings, (t) => {
    if (!grupos.has(t.grupo)) throw new Error(`Grupo inválido en topping ${t.nombre}`);
    return { id: txt(t.id, 48), nombre: txt(t.nombre, 40), grupo: t.grupo, precio: precioOk(t.precio, t.nombre), activo: !!t.activo };
  }, 'toppings');

  const categorias = lista(raw.categorias, (c) => ({ id: txt(c.id, 48), nombre: txt(c.nombre, 30), icono: txt(c.icono, 8) || '🛒', ...(c.sinInventario ? { sinInventario: true } : {}) }), 'categorías');
  if (categorias.some((c) => c.id === 'granizados')) throw new Error('"granizados" es una categoría reservada');
  const cats = new Set(categorias.map((c) => c.id));

  const productos = lista(raw.productos, (p) => {
    const nombre = txt(p.nombre, 60);
    if (!cats.has(p.categoria)) throw new Error(`"${nombre}" no tiene una categoría válida`);
    const extra = {};
    if (p.sinInventario) extra.sinInventario = true;
    else if (p.invItem?.id || p.invItem?.ops?.length) {
      // descuenta de un ítem del inventario (ej. Adición gusano → Gomitas). Con varias opciones se escoge al vender
      // (ej. Adición jeringa → Jeringa de tequila / ginebra / whisky / vodka)
      const ops = (p.invItem.ops?.length ? p.invItem.ops : [{ id: p.invItem.id, nombre: p.invItem.nombre || '' }])
        .map((o) => ({ id: txt(o.id, 48), nombre: txt(o.nombre, 60) })).filter((o) => o.id).slice(0, 20);
      if (ops.length) extra.invItem = { id: ops[0].id, ops, cantidad: Math.max(0.001, Number(p.invItem.cantidad) || 1) };
    }
    else if (Array.isArray(p.usa) && p.usa.length) extra.usa = [...new Set(p.usa.map((x) => txt(x, 48)))].filter((x) => x && x !== p.id).slice(0, 30);
    if (extra.usa && !extra.usa.length) delete extra.usa;
    return { id: txt(p.id, 48), nombre, categoria: p.categoria, precio: precioOk(p.precio, nombre), activo: !!p.activo, ...extra };
  }, 'productos');
  // "usa" solo puede apuntar a productos que existen
  const ids = new Set(productos.map((p) => p.id));
  for (const p of productos) if (p.usa) { p.usa = p.usa.filter((x) => ids.has(x)); if (!p.usa.length) delete p.usa; }

  return { tamanos, sabores, toppings, categorias, productos };
}

// ---------- Lo que gasta cada presentación ----------
// receta: { vasos, vaso (id del tamaño del vaso), pitillos, dulces (por grupo), producto, productoOpcional }
//  · Granizado 8/12/16/20: 1 vaso, 1 pitillo, 1 dulce de cada grupo (4 dulces)
//  · Jueves 2×12: 2 vasos de 12, 2 pitillos, 2 de cada grupo (8 dulces)
//  · Pecera: 4 pitillos, 2 de cada grupo (8 dulces) y 1 Coronita
//  · Nevera (3 o 5 litros): 4 pitillos, 4 de cada grupo (16 dulces) y 1 Corona (si aplica)
const ent = (x, max = 50) => Math.min(max, Math.max(0, Math.round(Number(x) || 0)));
function limpiarReceta(r) {
  return {
    vasos: ent(r.vasos, 20), vaso: r.vaso ? txt(r.vaso, 48) : null, pitillos: ent(r.pitillos, 20), dulces: Math.max(1, ent(r.dulces, 10)),
    producto: r.producto ? txt(r.producto, 48) : null, productoOpcional: !!r.productoOpcional,
    ...(r.litros !== undefined && r.litros !== null && r.litros !== '' ? { litros: Math.min(50, Math.max(0, Math.round(Number(r.litros) * 1000) / 1000 || 0)) } : {}),
  };
}
// Base de granizado: cada bolsa trae 6 litros y rinde (en promedio) 25 de 8 oz, 16 de 12, 12 de 16 y 10 de 20
export const LITROS_BOLSA = 6;
export const RINDE_BOLSA = { 8: 25, 12: 16, 16: 12, 20: 10 };
const litrosOz = (oz) => (RINDE_BOLSA[oz] ? Math.round((LITROS_BOLSA / RINDE_BOLSA[oz]) * 1000) / 1000 : 0);
export function recetaAuto(t, cfg) {
  const n = normalizar(t.nombre);
  const buscarProd = (re) => cfg.productos.find((p) => re.test(normalizar(p.nombre)))?.id || null;
  const oz = (n.match(/\b(8|12|16|20)\b/) || [])[1];
  const vasoDe = (o) => o && (cfg.tamanos.find((x) => (x.seccion || 'Tamaños') === 'Tamaños' && new RegExp(`\\b${o}\\b`).test(normalizar(x.nombre)))?.id || null);
  const litrosNombre = Number((n.match(/(\d+(?:[.,]\d+)?)\s*(l|lt|litro)/) || [])[1]?.replace(',', '.')) || 0; // "Nevera 3 litros"
  // Pecera: se llena con 3 granizados de 12 oz + 1 de 8 oz (≈ 1,365 L de base)
  // Pecera: se llena con 4 granizados de 12 oz (= 1,5 L de base)
  if (/pecera/.test(n)) return { vasos: 0, vaso: null, pitillos: 4, dulces: 2, producto: buscarProd(/^coronita/), productoOpcional: false, litros: litrosNombre || Math.round(4 * litrosOz(12) * 1000) / 1000 };
  if (/nevera/.test(n)) return { vasos: 0, vaso: null, pitillos: 4, dulces: 4, producto: buscarProd(/^corona(?!ita)/), productoOpcional: true, litros: litrosNombre };
  if (/recarga/.test(n)) return { vasos: 0, vaso: null, pitillos: 1, dulces: 1, producto: null, productoOpcional: false, litros: litrosOz(oz) };
  const doble = /(\*|x)\s*2\b|\b2\s*(\*|x)|2\s*granizados/.test(n);
  return { vasos: doble ? 2 : oz ? 1 : 0, vaso: vasoDe(oz), pitillos: doble ? 2 : 1, dulces: doble ? 2 : 1, producto: null, productoOpcional: false, litros: litrosOz(oz) * (doble ? 2 : 1) };
}
export const recetaDe = (t, cfg) => (t.receta ? { ...recetaAuto(t, cfg), ...t.receta } : recetaAuto(t, cfg));

// ---------- Armado de un ítem del pedido ----------
// raw (lo que manda el navegador):
//   granizado: { tipo:'granizado', tamano, sabores:[ids], incluidos:{grupo:id}, adicionales:{id:n}, cantidad, nota }
//   producto:  { tipo:'producto', productoId, cantidad, nota, usa? }
//     · Producto/categoría "sin inventario" (ej. copas): no descuenta ni se bloquea.
//     · Producto que "usa" el inventario de otro (ej. Michelada → la cerveza): descuenta de ese.
//       Si puede hacerse con varios (ej. Michelada con Águila o Poker), al venderlo se escoge cuál (usa).
// Devuelve una "foto" con nombres y precios del momento (así el pedido no cambia si luego cambian precios).
export function armarItem(raw, cfg) {
  if (!raw || typeof raw !== 'object') throw new Error('Ítem inválido');
  const cantidad = Math.min(Math.max(Math.floor(Number(raw.cantidad) || 1), 1), 99);
  const nota = txt(raw.nota, 200);

  if (raw.tipo === 'producto') {
    const p = cfg.productos.find((x) => x.id === raw.productoId);
    if (!p || !p.activo) throw new Error('Hay un producto que ya no está disponible');
    if (!p.precio) throw new Error(`"${p.nombre}" no tiene precio`);
    const cat = cfg.categorias.find((c) => c.id === p.categoria);
    let inv = p.id, nombre = p.nombre, usa;
    let invDirecto;
    if (p.sinInventario || cat?.sinInventario) inv = null;
    else if (p.invItem) {
      inv = null;
      const ops = p.invItem.ops?.length ? p.invItem.ops : [{ id: p.invItem.id, nombre: '' }];
      const op = ops.length === 1 ? ops[0] : ops.find((o) => o.id === raw.usa);
      if (!op) throw new Error(`Escoge cuál "${p.nombre}"`);
      invDirecto = { id: op.id, cantidad: p.invItem.cantidad || 1 };
      if (ops.length > 1) { usa = op.id; nombre = `${p.nombre} (${op.nombre || op.id})`; }
    }
    else if (p.usa?.length) {
      inv = p.usa.length === 1 ? p.usa[0] : p.usa.includes(raw.usa) ? raw.usa : null;
      if (!inv) throw new Error(`Escoge con qué va "${p.nombre}"`);
      if (p.usa.length > 1) { usa = inv; nombre = `${p.nombre} (${cfg.productos.find((x) => x.id === inv)?.nombre || inv})`; }
    }
    return {
      tipo: 'producto', productoId: p.id, nombre, categoria: cat?.nombre || '', inv, ...(usa ? { usa } : {}), ...(invDirecto ? { invDirecto } : {}),
      icono: cat?.icono || '🛒', precioUnit: p.precio, cantidad, nota, subtotal: p.precio * cantidad,
    };
  }

  const tam = cfg.tamanos.find((t) => t.id === String(raw.tamano) && t.activo);
  if (!tam) throw new Error('Escoge un tamaño o presentación disponible');
  if (!tam.precio) throw new Error(`"${tam.nombre}" no tiene precio`);

  const ids = [...new Set(raw.sabores || [])];
  const sabores = ids.map((id) => cfg.sabores.find((s) => s.id === id && s.activo));
  if (sabores.some((s) => !s)) throw new Error('Hay un sabor que ya no está disponible');
  if (!sabores.length) throw new Error('Escoge al menos un sabor');

  const receta = recetaDe(tam, cfg);
  // Toppings incluidos: por grupo, un id (1) o { id: cantidad } cuando la presentación lleva varios (pecera, nevera, 2×12)
  const incluidos = [];
  for (const g of GRUPOS) {
    const v = raw.incluidos?.[g.id];
    if (!v) continue;
    const pares = typeof v === 'string' ? [[v, 1]] : Object.entries(v).map(([id, q]) => [id, Math.floor(Number(q) || 0)]).filter(([, q]) => q > 0);
    if (pares.reduce((s0, [, q]) => s0 + q, 0) > receta.dulces) throw new Error(`Máximo ${receta.dulces} de "${g.nombre}"`);
    for (const [id, q] of pares) {
      const t = cfg.toppings.find((x) => x.id === id && x.grupo === g.id && x.activo);
      if (!t) throw new Error('Hay un topping que ya no está disponible');
      incluidos.push({ id: t.id, nombre: t.nombre, grupo: g.id, ...(q > 1 ? { cantidad: q } : {}) });
    }
  }
  // Producto que va con la presentación (Coronita en la pecera, Corona en la nevera si aplica)
  let producto = null;
  const pInc = receta.producto && cfg.productos.find((x) => x.id === receta.producto);
  if (pInc && (!receta.productoOpcional || raw.conProducto)) {
    const armado = armarItem({ tipo: 'producto', productoId: pInc.id, cantidad: 1 }, { ...cfg, productos: cfg.productos.map((x) => (x.id === pInc.id ? { ...x, activo: true, precio: x.precio || 1 } : x)) });
    producto = { id: pInc.id, nombre: pInc.nombre, inv: armado.inv };
  }

  const adicionales = [];
  for (const [id, q] of Object.entries(raw.adicionales || {})) {
    const n = Math.floor(Number(q));
    if (!(n > 0)) continue;
    if (n > 20) throw new Error('Demasiados toppings adicionales');
    const t = cfg.toppings.find((x) => x.id === id && x.activo);
    if (!t) throw new Error('Hay un topping adicional que ya no está disponible');
    adicionales.push({ id: t.id, nombre: t.nombre, precio: t.precio, cantidad: n });
  }

  const precioUnit = tam.precio + adicionales.reduce((s, a) => s + a.precio * a.cantidad, 0);
  return {
    tipo: 'granizado', tamano: tam.id, tamanoNombre: tam.nombre,
    sabores: sabores.map((s) => ({ id: s.id, nombre: s.nombre })),
    incluidos, adicionales, precioUnit, cantidad, nota, subtotal: precioUnit * cantidad,
    receta: { vaso: receta.vaso, vasos: receta.vasos, pitillos: receta.pitillos, litros: receta.litros || 0 }, ...(producto ? { producto } : {}),
  };
}

// Para mostrar ítems guardados (incluye pedidos viejos de la versión anterior)
export function vistaItem(it) {
  if (it.tipo === 'producto') return { ...it, esGranizado: false };
  if (it.tipo === 'granizado') {
    return {
      esGranizado: true, cantidad: it.cantidad, nota: it.nota, subtotal: it.subtotal,
      tam: it.tamanoNombre, sabores: it.sabores.map((s) => s.nombre),
      incluidos: [...it.incluidos.map((t) => (t.cantidad > 1 ? `${t.cantidad}× ${t.nombre}` : t.nombre)), ...(it.producto ? [`🍺 ${it.producto.nombre}`] : [])],
      adicionales: it.adicionales.map((a) => `${a.cantidad}× ${a.nombre}`),
    };
  }
  // formato v1/v2
  const nom = (id) => CONFIG_INICIAL.toppings.find((t) => t.id === id)?.nombre || id;
  return {
    esGranizado: true, cantidad: it.cantidad || 1, nota: it.nota, subtotal: it.subtotal,
    tam: `${it.tamano} oz`, sabores: it.sabores || [],
    incluidos: Object.values(it.incluidos || {}).filter(Boolean).map(nom),
    adicionales: Object.entries(it.adicionales || {}).map(([id, n]) => `${n}× ${nom(id)}`),
  };
}

// ---------- Cuentas (varios pedidos de la misma persona que se pagan juntos) ----------
export const cuentaDe = (p) => p.cuenta || p.id;
export const normalizar = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function agruparCuentas(pedidos) {
  const m = new Map();
  for (const p of [...pedidos].sort((a, b) => a.creado - b.creado)) {
    const id = cuentaDe(p);
    if (!m.has(id)) m.set(id, { id, cliente: p.cliente, pedidos: [], total: 0, pendiente: 0, desde: p.creado });
    const c = m.get(id);
    c.pedidos.push(p);
    if (p.estado !== 'cancelado') {
      c.total += p.total;
      if (!p.pago?.pagado) c.pendiente += p.total;
    }
  }
  for (const c of m.values()) {
    c.abiertos = c.pedidos.filter((p) => p.estado !== 'cancelado' && !p.pago?.pagado);
    c.abierta = c.abiertos.length > 0;
  }
  return [...m.values()];
}

// ---------- Compras de insumos ----------
export const CATEGORIAS_COMPRA = [
  { id: 'hielo', nombre: 'Hielo', icono: '🧊' },
  { id: 'sabores', nombre: 'Pulpas, jarabes y sabores', icono: '🍓' },
  { id: 'licor-prep', nombre: 'Licor para preparar', icono: '🍸' },
  { id: 'toppings', nombre: 'Toppings y dulces', icono: '🍬' },
  { id: 'desechables', nombre: 'Vasos y desechables', icono: '🥤' },
  { id: 'reventa', nombre: 'Cerveza y licor para vender', icono: '🍺' },
  { id: 'limpieza', nombre: 'Aseo y limpieza', icono: '🧽' },
  { id: 'otros', nombre: 'Otros', icono: '📦' },
];
export const UNIDADES = ['und', 'bolsa', 'paca', 'caja', 'media caja', 'kg', 'lb', 'litro', 'botella', 'paquete'];
export const PAGOS_COMPRA = [
  { id: 'caja', nombre: 'Plata de la caja', icono: '💵' },
  { id: 'transferencia', nombre: 'Transferencia', icono: '📲' },
  { id: 'otro', nombre: 'Otro (bolsillo propio)', icono: '👛' },
];

// ---------- Gastos fijos ----------
export const CATEGORIAS_FIJO = [
  { id: 'arriendo', nombre: 'Arriendo', icono: '🏠' },
  { id: 'servicios', nombre: 'Servicios (luz, agua, gas)', icono: '💡' },
  { id: 'internet', nombre: 'Internet y celular', icono: '📶' },
  { id: 'nomina', nombre: 'Sueldos y pagos a personal', icono: '👥' },
  { id: 'impuestos', nombre: 'Impuestos y permisos', icono: '🧾' },
  { id: 'software', nombre: 'Apps y suscripciones', icono: '💻' },
  { id: 'otros', nombre: 'Otros', icono: '📌' },
];
export const PERIODOS_FIJO = [
  { id: 'mensual', nombre: 'Mensual', veces: 1 },
  { id: 'quincenal', nombre: 'Quincenal', veces: 2 },
  { id: 'semanal', nombre: 'Semanal', veces: 4 },
];

// ---------- Inventario ----------
// Cada ítem de inventario puede tener "reglas de consumo": se descuenta solo cuando se vende algo.
//   { tipo: 'producto', id }  → por cada unidad de ese producto (ej: Aguila)
//   { tipo: 'tamano', id }    → por cada granizado de esa presentación (ej: vasos 16 oz)
//   { tipo: 'topping', id }   → por cada topping (incluido o adicional) de ese tipo
//   { tipo: 'granizado' }     → por cada granizado de cualquier tamaño (ej: pitillos)
// cantidad = cuánto se descuenta por cada uno.
export const UNIDADES_INV = ['und', 'vaso', 'cucharada', 'bolsa', 'kg', 'g', 'litro', 'ml', 'botella', 'lata', 'paquete'];

// ctx.llevar: pedido para llevar o a domicilio → también se gastan las tapas (una por vaso, según su tamaño)
export function consumoDe(items, inventario, ctx = {}) {
  const deltas = {};
  const sumar = (id, n) => { deltas[id] = Math.round(((deltas[id] || 0) - n) * 1000) / 1000; };
  // productos que descuentan directo de un ítem del inventario
  const existe = new Set((inventario || []).filter((i) => i.activo !== false).map((i) => i.id));
  for (const it of items) if (it.tipo === 'producto' && it.invDirecto && existe.has(it.invDirecto.id)) sumar(it.invDirecto.id, (it.cantidad || 1) * it.invDirecto.cantidad);
  for (const inv of inventario || []) {
    for (const r of inv.reglas || []) {
      const k = Number(r.cantidad) || 0;
      if (!k) continue;
      for (const it of items) {
        const q = it.cantidad || 1;
        // "inv" = de qué producto se descuenta (null = no lleva inventario); pedidos viejos: el mismo producto
        if (r.tipo === 'producto' && it.tipo === 'producto' && ('inv' in it ? it.inv : it.productoId) === r.id) sumar(inv.id, q * k);
        if (it.tipo !== 'granizado') continue;
        const rc = it.receta; // pedidos viejos no tienen receta: 1 vaso del tamaño y 1 pitillo
        if (r.tipo === 'producto' && it.producto?.inv === r.id) sumar(inv.id, q * k); // Coronita de la pecera, Corona de la nevera
        if (r.tipo === 'granizado') sumar(inv.id, q * k * (rc ? rc.pitillos : 1));
        if (r.tipo === 'tamano') {
          const n = (it.tamano === r.id && rc?.vaso !== it.tamano ? 1 : 0) + (rc && rc.vaso === r.id ? rc.vasos : 0);
          if (n) sumar(inv.id, q * k * n);
        }
        // Base del sabor: los litros de la presentación se reparten entre los sabores que lleva
        if (r.tipo === 'sabor' && rc?.litros && (it.sabores || []).some((x) => x.id === r.id)) sumar(inv.id, (q * k * rc.litros) / it.sabores.length);
        if (r.tipo === 'tapa' && ctx.llevar) {
          const n = rc ? (rc.vaso === r.id ? rc.vasos : 0) : it.tamano === r.id ? 1 : 0;
          if (n) sumar(inv.id, q * k * n);
        }
        if (r.tipo === 'topping') {
          const n = (it.incluidos || []).filter((t) => t.id === r.id).reduce((s, t) => s + (t.cantidad || 1), 0)
            + (it.adicionales || []).filter((a) => a.id === r.id).reduce((s, a) => s + a.cantidad, 0);
          if (n) sumar(inv.id, q * n * k);
        }
      }
    }
  }
  return deltas; // { idInventario: -cantidad }
}

export function estadoStock(item, stock) {
  if (stock <= 0) return { clase: 'agotado', txt: 'Agotado', icono: '🔴' };
  if (item.minimo && stock <= item.minimo) return { clase: 'bajo', txt: 'Bajo', icono: '🟠' };
  return { clase: 'ok', txt: 'OK', icono: '🟢' };
}

// ---------- Empaques (cómo viene cada cosa al comprarla) ----------
// Ej: bolsa de aros = 100 und. Sirve para comprar/contar "2 bolsas" y que entren 200.
const EMPAQUES_SUGERIDOS = [
  [/^aros?$/, [['bolsa', 100]]],
  [/^gusanos?$/, [['bolsa', 100]]],
  [/paleta de sandia/, [['bolsa', 50]]],
  [/paleta de chamoy/, [['bolsa', 40]]],
  [/bandera/, [['bolsa', 520]]],
  [/pitillo/, [['paquete', 250]]],
  [/vaso/, [['paquete de vasos con tapa', 20, true], ['paquete de vasos', 20]]], // con tapa: 20 vasos + 20 tapas
  [/coron/, [['caja', 24]]],
  [/aguila|pilsen|poker|club colombia|costenita|cordilleras|cerveza/, [['caja', 30], ['media caja', 15]]],
  [/soda/, [['paca 24', 24], ['paca 48', 48]]],
];
export function empaquesSugeridos(nombre) {
  const n = String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  for (const [re, lista] of EMPAQUES_SUGERIDOS) if (re.test(n)) return lista.map(([nombre, unidades, conTapa]) => ({ nombre, unidades, ...(conTapa ? { conTapa: true } : {}) }));
  return [];
}
// "250 und" → "1 paquete" / "42 und" → "1 caja + 12"
export function enEmpaques(cantidad, item) {
  const e = [...(item.empaques || [])].sort((a, b) => b.unidades - a.unidades)[0];
  if (!e || cantidad < e.unidades) return '';
  const n = Math.floor(cantidad / e.unidades), resto = Math.round((cantidad - n * e.unidades) * 100) / 100;
  return `≈ ${n} × ${e.nombre}${resto ? ` + ${resto}` : ''}`;
}

// Revisa si alcanza el inventario para unos descuentos. Devuelve lista de faltantes.
export function faltantes(deltas, stock, inventario) {
  const out = [];
  for (const [id, d] of Object.entries(deltas || {})) {
    if (d >= 0) continue;
    const it = (inventario || []).find((x) => x.id === id);
    if (!it || it.activo === false) continue;
    const hay = Number(stock[id] || 0);
    if (hay + d < 0) out.push({ id, nombre: it.nombre, hay: Math.max(0, hay), unidad: it.unidad, ...(it.reutilizable ? { reu: true } : {}) });
  }
  return out;
}
export const textoFaltantes = (f) => f.map((x) => x.reu ? `${x.nombre} (${x.hay > 0 ? `solo hay ${x.hay} libre${x.hay === 1 ? '' : 's'}` : 'todas están prestadas: marca las devueltas en Pedidos'})` : x.hay > 0 ? `${x.nombre} (solo quedan ${x.hay})` : `${x.nombre} (agotado)`).join(', ');

// ---------- Domicilios: distancia y tarifa ----------
// Distancia en línea recta (km) entre dos puntos {lat, lng}
export function distanciaKm(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// tarifas = [{ hastaKm, valor }] ordenadas. Devuelve el valor o null si está fuera de cobertura.
export function tarifaPorKm(km, tarifas) {
  const t = [...(tarifas || [])].sort((x, y) => x.hastaKm - y.hastaKm).find((x) => km <= x.hastaKm);
  return t ? t.valor : null;
}
export const coordValida = (p) => p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(+p.lat === 0 && +p.lng === 0);

// =====================================================================
// ROLES Y PERMISOS
// =====================================================================
export const PERMISOS = [
  { grupo: 'Pedidos', items: [
    ['tomar', '🧾 Tomar pedidos'],
    ['pedidos', '📋 Ver y despachar pedidos'],
    ['cobrar', '💵 Cobrar (marcar pagado)'],
    ['cancelar', '❌ Cancelar pedidos'],
    ['cuentas', '💳 Cuentas abiertas'],
  ] },
  { grupo: 'Caja y dinero', items: [
    ['cierre', '🔒 Cierre de caja'],
    ['ventas', '💰 Ver ventas'],
    ['reportes', '📊 Ver reportes'],
    ['presupuesto', '💼 Presupuesto del mes'],
    ['compras', '🛒 Registrar compras'],
    ['compras_editar', '✏️ Editar / borrar compras'],
    ['gastos', '🏦 Gastos fijos'],
  ] },
  { grupo: 'Negocio', items: [
    ['inventario', '📦 Inventario (ver, entradas, conteos)'],
    ['inventario_config', '⚙️ Configurar inventario'],
    ['productos', '🛠️ Productos, precios y sabores'],
    ['configuracion', '🛵 Domicilios y QR de pago'],
    ['usuarios', '👥 Usuarios, roles y permisos'],
    ['sedes', '🏢 Crear y editar sedes'],
  ] },
];
export const TODOS_PERMISOS = PERMISOS.flatMap((g) => g.items.map(([id]) => id));

// Roles de fábrica. Se pueden editar y crear más desde Inicio → Usuarios (se guardan en la base de datos).
// El Administrador es fijo: siempre tiene todos los permisos y no se puede borrar.
export const ROLES = [
  { id: 'admin', nombre: 'Administrador', icono: '👑', permisos: TODOS_PERMISOS, fijo: true },
  { id: 'cajero', nombre: 'Cajero', icono: '💵', permisos: ['tomar', 'pedidos', 'cobrar', 'cuentas', 'cierre', 'compras', 'inventario'] },
  { id: 'vendedor', nombre: 'Vendedor', icono: '🧾', permisos: ['tomar', 'pedidos', 'cobrar', 'cuentas'] },
  { id: 'preparacion', nombre: 'Preparación', icono: '🍧', permisos: ['pedidos'] },
];
// Limpia una lista de roles: quita permisos que no existen y garantiza el Administrador con todo
export function normalizarRoles(lista) {
  const roles = (Array.isArray(lista) && lista.length ? lista : ROLES)
    .filter((r) => r && r.id)
    .map((r) => ({ id: String(r.id), nombre: String(r.nombre || r.id), icono: String(r.icono || '🎭'),
      permisos: [...new Set((r.permisos || []).filter((p) => TODOS_PERMISOS.includes(p)))], ...(r.fijo ? { fijo: true } : {}) }));
  const adm = roles.find((r) => r.id === 'admin');
  if (adm) { adm.permisos = [...TODOS_PERMISOS]; adm.fijo = true; } else roles.unshift({ ...ROLES[0], permisos: [...TODOS_PERMISOS] });
  return roles;
}
export const rolDe = (id, roles = ROLES) => roles.find((r) => r.id === id) || roles.find((r) => r.id === 'vendedor') || { id: 'sin-rol', nombre: 'Sin rol', icono: '❔', permisos: [] };
// Permisos efectivos: los propios del usuario (si los personalizaron) o los de su rol
export const permisosDe = (u, roles = ROLES) => (Array.isArray(u?.permisos) ? u.permisos : rolDe(u?.rol, roles).permisos).filter((p) => TODOS_PERMISOS.includes(p));

// ---------- Pagos divididos ----------
// Una venta puede ser en efectivo, transferencia o "mixto" (parte y parte).
// partesDe(venta) → { efectivo, transferencia } (sirve para ventas guardadas "v" y para pedidos "p").
export function partesDe(x) {
  const m = x.m ?? x.pago?.metodo, t = x.t ?? x.total ?? 0;
  if (m === 'mixto') {
    const ef = x.ef ?? x.pago?.efectivo ?? 0;
    return { efectivo: ef, transferencia: t - ef };
  }
  return { efectivo: m === 'efectivo' ? t : 0, transferencia: m === 'transferencia' ? t : 0 };
}
// Reparte lo que pagó cada persona entre varios pedidos de una cuenta.
// partes: [{ metodo, valor }], pedidos: [{ total }] → [{ metodo, efectivo }] por pedido (primero se usa el efectivo)
export function repartirPago(partes, pedidos) {
  let ef = partes.filter((x) => x.metodo === 'efectivo').reduce((s, x) => s + x.valor, 0);
  return pedidos.map((p) => {
    const e = Math.min(ef, p.total); ef -= e;
    return e === p.total ? { metodo: 'efectivo', efectivo: e } : e === 0 ? { metodo: 'transferencia', efectivo: 0 } : { metodo: 'mixto', efectivo: e };
  });
}
// Revisa las partes de un pago dividido; devuelve la lista limpia o lanza un error
export function validarPartes(partes, total) {
  if (!Array.isArray(partes) || !partes.length) throw new Error('Agrega lo que paga cada persona');
  if (partes.length > 30) throw new Error('Máximo 30 personas');
  const l = partes.map((x) => ({ metodo: x.metodo === 'transferencia' ? 'transferencia' : x.metodo === 'efectivo' ? 'efectivo' : null, valor: Math.round(Number(x.valor) || 0), quien: String(x.quien || '').trim().slice(0, 40) }));
  if (l.some((x) => !x.metodo)) throw new Error('Cada parte debe ser efectivo o transferencia');
  if (l.some((x) => x.valor <= 0)) throw new Error('Cada parte debe tener un valor mayor a 0');
  const suma = l.reduce((s, x) => s + x.valor, 0);
  if (suma !== total) throw new Error(`Las partes suman ${suma.toLocaleString('es-CO')} y el total es ${total.toLocaleString('es-CO')}`);
  return l;
}

// ---------- Toppings incluidos en pantalla (tomar pedido y domicilios) ----------
// item.incluidos[grupo] es un id (1 dulce) o { id: cantidad } cuando la presentación lleva varios por grupo.
export const conteoIncluido = (v) => (!v ? {} : typeof v === 'string' ? { [v]: 1 } : { ...v });
// Ajusta los incluidos cuando cambia la presentación (ej. de pecera a 12 oz)
export function ajustarIncluidos(item, dulces) {
  for (const g of Object.keys(item.incluidos)) {
    const c = conteoIncluido(item.incluidos[g]);
    if (dulces <= 1) { item.incluidos[g] = Object.keys(c)[0] || null; continue; }
    let quedan = dulces; const n = {};
    for (const [id, q] of Object.entries(c)) { const x = Math.min(q, quedan); if (x > 0) { n[id] = x; quedan -= x; } }
    item.incluidos[g] = Object.keys(n).length ? n : null;
  }
}
// HTML de los toppings incluidos. agotado(id) opcional. Devuelve botones con data-inc / data-incq.
export function htmlIncluidos({ item, toppings, dulces, agotado = () => false, esc = (x) => x, txtNo = 'Sin' }) {
  return GRUPOS.map((g) => {
    const ops = toppings.filter((t) => t.grupo === g.id);
    if (!ops.length) return '';
    const nom = (t) => esc(t.nombre.replace(/^Paleta de /, ''));
    if (dulces <= 1) {
      const sel = item.incluidos[g.id];
      const botones = ops.length === 1
        ? `<button class="${sel === ops[0].id ? 'on' : ''}" data-inc="${g.id}" data-val="${ops[0].id}" ${agotado(ops[0].id) && sel !== ops[0].id ? 'disabled title="Agotado"' : ''}>${agotado(ops[0].id) && sel !== ops[0].id ? '🔴 Agotado' : 'Sí'}</button>`
        : ops.map((t) => { const ag = agotado(t.id) && sel !== t.id;
            return `<button class="${sel === t.id ? 'on' : ''} ${ag ? 'agot' : ''}" data-inc="${g.id}" data-val="${t.id}" ${ag ? 'disabled title="Agotado"' : ''}>${nom(t)}${ag ? ' 🔴' : ''}</button>`; }).join('');
      return `<div class="grupo"><span class="lbl">${g.nombre}</span><div class="seg">${botones}<button class="none ${!sel ? 'on' : ''}" data-inc="${g.id}" data-val="">${txtNo}</button></div></div>`;
    }
    const c = conteoIncluido(item.incluidos[g.id]), total = Object.values(c).reduce((a, b) => a + b, 0);
    return `<div class="grupo grupo-multi"><span class="lbl">${g.nombre} <small class="${total === dulces ? 'completo' : ''}">${total} de ${dulces}</small></span><div class="multi">` +
      ops.map((t) => { const q = c[t.id] || 0, ag = agotado(t.id);
        return `<div class="multi-op ${q ? 'has' : ''}"><span>${nom(t)}${ag && !q ? ' 🔴' : ''}</span><div class="qty ${q ? 'has' : ''}"><button data-incq="${g.id}" data-val="${t.id}" data-d="-1" ${q ? '' : 'disabled'}>−</button><b>${q}</b><button data-incq="${g.id}" data-val="${t.id}" data-d="1" ${total >= dulces || ag ? 'disabled' : ''}>+</button></div></div>`; }).join('') +
      `</div></div>`;
  }).join('');
}
// Cambia la cantidad de un topping incluido (presentaciones con varios por grupo)
export function cambiarIncluido(item, grupo, id, d, dulces) {
  const c = conteoIncluido(item.incluidos[grupo]);
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  if (d > 0 && total >= dulces) return;
  c[id] = Math.max(0, (c[id] || 0) + d);
  if (!c[id]) delete c[id];
  item.incluidos[grupo] = Object.keys(c).length ? c : null;
}

// Un granizado "mínimo" de una presentación (sin sabores ni dulces): sirve para saber si se puede
// vender según el inventario (vasos, pitillos y la cerveza incluida si no es opcional).
export function itemBase(t, cfg) {
  const rc = recetaDe(t, cfg);
  const p = rc.producto && !rc.productoOpcional && cfg.productos.find((x) => x.id === rc.producto);
  let producto = null;
  if (p) { try { const a = armarItem({ tipo: 'producto', productoId: p.id }, { ...cfg, productos: cfg.productos.map((x) => (x.id === p.id ? { ...x, activo: true, precio: x.precio || 1 } : x)) }); producto = { id: p.id, nombre: p.nombre, inv: a.inv }; } catch { /* sin inventario */ } }
  return { tipo: 'granizado', tamano: t.id, cantidad: 1, sabores: [], incluidos: [], adicionales: [], receta: { vaso: rc.vaso, vasos: rc.vasos, pitillos: rc.pitillos, litros: rc.litros || 0 }, ...(producto ? { producto } : {}) };
}

// ---------- Ítems reutilizables (ej. peceras de vidrio: se lavan y vuelven) ----------
// Se revisa que haya (si se rompen todas, no se puede vender) pero nunca se descuentan.
export function sinReutilizables(consumo, inventario) {
  const reu = new Set((inventario || []).filter((i) => i.reutilizable).map((i) => i.id));
  return Object.fromEntries(Object.entries(consumo).filter(([id]) => !reu.has(id)));
}

// Disponibles de verdad: a los reutilizables (peceras) se les restan los que están prestados
export function stockDisponible(stock, inventario, prestados = {}) {
  const r = { ...stock };
  for (const i of inventario || []) if (i.reutilizable) r[i.id] = (r[i.id] || 0) - (prestados[i.id] || 0);
  return r;
}
// Lo que queda prestado con un pedido (solo los reutilizables): { idItem: cantidad }
export function prestamoDe(consumo, inventario) {
  const reu = new Set((inventario || []).filter((i) => i.reutilizable).map((i) => i.id));
  return Object.fromEntries(Object.entries(consumo).filter(([id, d]) => reu.has(id) && d < 0).map(([id, d]) => [id, -d]));
}

// "Michelada Aguila Light" → el producto "Aguila Light" (de otra categoría). null si no se encuentra.
export function baseMichelada(prod, productos) {
  const resto = normalizar(prod.nombre).replace(/^michelada\s+(de\s+)?/, '').trim();
  if (!resto || resto === normalizar(prod.nombre)) return null;
  const cands = productos.filter((x) => x.id !== prod.id && x.categoria !== prod.categoria && !x.usa?.length);
  return cands.find((x) => normalizar(x.nombre) === resto)
    || cands.find((x) => normalizar(x.nombre).replace(/[^a-z0-9]/g, '') === resto.replace(/[^a-z0-9]/g, ''))
    || cands.filter((x) => normalizar(x.nombre).startsWith(resto) || resto.startsWith(normalizar(x.nombre))).sort((a, b) => Math.abs(a.nombre.length - resto.length) - Math.abs(b.nombre.length - resto.length))[0]
    || null;
}

// ---------- Ítems repetidos del inventario ----------
// Mismo nombre (sin importar plurales, "de", tildes) o la misma regla de descuento → probablemente repetidos.
export const claveNombre = (n) => normalizar(n).replace(/\b(de|del|la|el|los|las|y)\b/g, ' ').split(/[^a-z0-9]+/).filter(Boolean).map((w) => w.replace(/(es|s)$/, '')).join(' ');
export function gruposRepetidos(items) {
  const padre = new Map(items.map((i) => [i.id, i.id]));
  const raiz = (x) => (padre.get(x) === x ? x : raiz(padre.get(x)));
  const unir = (a, b) => padre.set(raiz(a), raiz(b));
  const porClave = new Map();
  for (const i of items) {
    if (i.reutilizable) continue;
    const claves = [`n:${claveNombre(i.nombre)}`, ...(i.reglas || []).filter((r) => r.tipo !== 'granizado').map((r) => `r:${r.tipo}:${r.id}`)];
    for (const k of claves) { if (porClave.has(k)) unir(i.id, porClave.get(k)); else porClave.set(k, i.id); }
  }
  const g = new Map();
  for (const i of items) { if (i.reutilizable) continue; const r = raiz(i.id); g.set(r, [...(g.get(r) || []), i]); }
  return [...g.values()].filter((l) => l.length > 1);
}
