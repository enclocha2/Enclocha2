// Catálogo y reglas de precios, compartido entre el navegador y la API.
// Los productos/precios reales se guardan en la base de datos y se editan
// desde la pantalla "Productos". CONFIG_INICIAL es solo el punto de partida.

export const GRUPOS = [
  { id: 'paleta', nombre: 'Paleta' },
  { id: 'gusano', nombre: 'Gusano o aro' },
  { id: 'chicle', nombre: 'Chicles u Okaloka' },
  { id: 'bandera', nombre: 'Bandera de sandía' },
];

export const ESTADOS = ['nuevo', 'preparando', 'entregado', 'cancelado'];

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
  }), 'presentaciones');
  if (!tamanos.length) throw new Error('Debe haber al menos una presentación de granizado');

  const sabores = lista(raw.sabores, (s) => ({ id: txt(s.id, 48), nombre: txt(s.nombre, 50), activo: !!s.activo }), 'sabores');

  const toppings = lista(raw.toppings, (t) => {
    if (!grupos.has(t.grupo)) throw new Error(`Grupo inválido en topping ${t.nombre}`);
    return { id: txt(t.id, 48), nombre: txt(t.nombre, 40), grupo: t.grupo, precio: precioOk(t.precio, t.nombre), activo: !!t.activo };
  }, 'toppings');

  const categorias = lista(raw.categorias, (c) => ({ id: txt(c.id, 48), nombre: txt(c.nombre, 30), icono: txt(c.icono, 8) || '🛒' }), 'categorías');
  if (categorias.some((c) => c.id === 'granizados')) throw new Error('"granizados" es una categoría reservada');
  const cats = new Set(categorias.map((c) => c.id));

  const productos = lista(raw.productos, (p) => {
    const nombre = txt(p.nombre, 60);
    if (!cats.has(p.categoria)) throw new Error(`"${nombre}" no tiene una categoría válida`);
    return { id: txt(p.id, 48), nombre, categoria: p.categoria, precio: precioOk(p.precio, nombre), activo: !!p.activo };
  }, 'productos');

  return { tamanos, sabores, toppings, categorias, productos };
}

// ---------- Armado de un ítem del pedido ----------
// raw (lo que manda el navegador):
//   granizado: { tipo:'granizado', tamano, sabores:[ids], incluidos:{grupo:id}, adicionales:{id:n}, cantidad, nota }
//   producto:  { tipo:'producto', productoId, cantidad, nota }
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
    return {
      tipo: 'producto', productoId: p.id, nombre: p.nombre, categoria: cat?.nombre || '',
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

  const incluidos = [];
  for (const g of GRUPOS) {
    const id = raw.incluidos?.[g.id];
    if (!id) continue;
    const t = cfg.toppings.find((x) => x.id === id && x.grupo === g.id && x.activo);
    if (!t) throw new Error('Hay un topping que ya no está disponible');
    incluidos.push({ id: t.id, nombre: t.nombre, grupo: g.id });
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
  };
}

// Para mostrar ítems guardados (incluye pedidos viejos de la versión anterior)
export function vistaItem(it) {
  if (it.tipo === 'producto') return { ...it, esGranizado: false };
  if (it.tipo === 'granizado') {
    return {
      esGranizado: true, cantidad: it.cantidad, nota: it.nota, subtotal: it.subtotal,
      tam: it.tamanoNombre, sabores: it.sabores.map((s) => s.nombre),
      incluidos: it.incluidos.map((t) => t.nombre),
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
