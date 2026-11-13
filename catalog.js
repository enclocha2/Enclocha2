// Catálogo compartido entre el navegador y la API.
// Para cambiar precios, sabores o toppings, edita SOLO este archivo.

export const TAMANOS = [
  { id: '8', nombre: '8 oz', precio: 8000 },
  { id: '12', nombre: '12 oz', precio: 12000 },
  { id: '16', nombre: '16 oz', precio: 16000 },
  { id: '20', nombre: '20 oz', precio: 20000 },
];

export const SABORES = [
  'Mango Loco',
  'Smirnoff de Tamarindo',
  'Smirnoff de Lulo',
  'Limonada de coco SL',
  'Strawberry Passion',
];

// Grupos de toppings incluidos (uno por grupo = 4 toppings sin costo)
export const GRUPOS = [
  { id: 'paleta', nombre: 'Paleta' },
  { id: 'gusano', nombre: 'Gusano o aro' },
  { id: 'chicle', nombre: 'Chicles u Okaloka' },
  { id: 'bandera', nombre: 'Bandera de sandía' },
];

// Precio = valor cuando se pide como topping ADICIONAL
export const TOPPINGS = [
  { id: 'paleta-sandia', nombre: 'Paleta de sandía', grupo: 'paleta', precio: 1000 },
  { id: 'paleta-chamoy', nombre: 'Paleta de chamoy', grupo: 'paleta', precio: 1000 },
  { id: 'gusano', nombre: 'Gusano', grupo: 'gusano', precio: 500 },
  { id: 'aro', nombre: 'Aro', grupo: 'gusano', precio: 500 },
  { id: 'chicle', nombre: 'Chicles', grupo: 'chicle', precio: 800 },
  { id: 'okaloka', nombre: 'Okaloka', grupo: 'chicle', precio: 800 },
  { id: 'bandera', nombre: 'Bandera de sandía', grupo: 'bandera', precio: 500 },
];

export const ESTADOS = ['nuevo', 'preparando', 'entregado', 'cancelado'];

export const pesos = (n) => '$' + Number(n || 0).toLocaleString('es-CO');

const toppingPorId = (id) => TOPPINGS.find((t) => t.id === id);

// Valida y normaliza un granizado. Lanza Error si algo no cuadra.
export function normalizarItem(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Granizado inválido');

  const tamano = TAMANOS.find((t) => t.id === String(raw.tamano));
  if (!tamano) throw new Error('Tamaño inválido');

  const sabores = [...new Set((raw.sabores || []).filter((s) => SABORES.includes(s)))];
  if (sabores.length === 0) throw new Error('Escoge al menos un sabor');

  const incluidos = {};
  for (const g of GRUPOS) {
    const id = raw.incluidos?.[g.id];
    if (!id) { incluidos[g.id] = null; continue; }
    const t = toppingPorId(id);
    if (!t || t.grupo !== g.id) throw new Error('Topping incluido inválido');
    incluidos[g.id] = id;
  }

  const adicionales = {};
  for (const [id, qty] of Object.entries(raw.adicionales || {})) {
    const n = Math.floor(Number(qty));
    if (!toppingPorId(id)) throw new Error('Topping adicional inválido');
    if (n > 0 && n <= 20) adicionales[id] = n;
  }

  const cantidad = Math.min(Math.max(Math.floor(Number(raw.cantidad) || 1), 1), 50);
  const nota = String(raw.nota || '').slice(0, 200).trim();

  const item = { tamano: tamano.id, sabores, incluidos, adicionales, cantidad, nota };
  item.subtotal = calcularItem(item);
  return item;
}

export function precioUnitario(item) {
  const base = TAMANOS.find((t) => t.id === item.tamano)?.precio || 0;
  const extras = Object.entries(item.adicionales || {})
    .reduce((s, [id, n]) => s + (toppingPorId(id)?.precio || 0) * n, 0);
  return base + extras;
}

export const calcularItem = (item) => precioUnitario(item) * (item.cantidad || 1);

// Texto legible de un granizado (para tarjetas y resúmenes)
export function describirItem(item) {
  const tam = TAMANOS.find((t) => t.id === item.tamano)?.nombre || item.tamano;
  const inc = Object.values(item.incluidos || {}).filter(Boolean).map((id) => toppingPorId(id)?.nombre);
  const adi = Object.entries(item.adicionales || {}).map(([id, n]) => `${n}× ${toppingPorId(id)?.nombre}`);
  return { tam, sabores: item.sabores, incluidos: inc, adicionales: adi };
}
