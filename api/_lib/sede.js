// Decide en qué sede trabaja cada petición y la ejecuta "dentro" de esa sede
// (store.js usa esa sede para leer y guardar los datos que van separados).
//  - Usuario con sede asignada: siempre su sede.
//  - Usuario sin sede asignada: la que escogió en el selector (cookie "sede"); si no, la principal.
//  - Página pública de domicilios: ?sede=<id> en el link; si no, la principal.
import { sesion, leerCookie } from './auth.js';
import { enSede, leerSedes, SEDE_PRINCIPAL } from './store.js';

let cache = { lista: null, en: 0 };
export async function sedesCache(forzar = false) {
  if (forzar || !cache.lista || Date.now() - cache.en > 60000) cache = { lista: await leerSedes(), en: Date.now() };
  return structuredClone(cache.lista);
}
export const olvidarSedes = () => { cache = { lista: null, en: 0 }; };

export async function resolverSede(req, publica = false) {
  const sedes = await sedesCache();
  const valida = (id) => sedes.some((s) => s.id === id && s.activa !== false);
  if (publica) {
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    return valida(q.sede) ? q.sede : SEDE_PRINCIPAL;
  }
  const yo = await sesion(req);
  if (yo?.sede && sedes.some((s) => s.id === yo.sede)) return yo.sede;
  const pedida = req.headers?.['x-sede'] || leerCookie(req, 'sede');
  return valida(pedida) ? pedida : SEDE_PRINCIPAL;
}

// Envuelve un handler de /api para que todo lo que haga quede en la sede que corresponde
export const conSede = (handler, publica = false) => async (req, res) => {
  const id = await resolverSede(req, publica);
  res.setHeader?.('X-Sede', id);
  return enSede(id, () => handler(req, res));
};
