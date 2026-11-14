// Administración de usuarios, roles y permisos (requiere el permiso "usuarios").
// /api/usuarios            → usuarios
// /api/usuarios?r=roles    → roles (crear, editar permisos, borrar)
// /api/usuarios?r=sedes    → sedes (ver: cualquiera con sesión; crear/editar: permiso "sedes")
import { leerSedes, guardarSedes, SEDE_PRINCIPAL } from './_lib/store.js';
import { sedesCache, olvidarSedes, resolverSede } from './_lib/sede.js';
import { sesion, leerUsuarios, guardarUsuarios, leerRoles, guardarRoles, cifrar, publico, TODOS_PERMISOS } from './_lib/auth.js';
import { permisosDe, slug } from '../catalog.js';

const leer = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});
const txt = (s, n) => String(s ?? '').trim().slice(0, n);
const NOMBRE_USUARIO = /^[\p{L}\p{N}._-]{2,30}$/u;

// Siempre debe quedar al menos un usuario activo que pueda administrar usuarios
const quedaAdmin = (lista, roles) => lista.some((u) => u.activo !== false && permisosDe(u, roles).includes('usuarios'));
const ruta = (req) => req.query?.r ?? new URL(req.url, 'http://x').searchParams.get('r');
const limpiarPermisos = (ps) => [...new Set((Array.isArray(ps) ? ps : []).filter((p) => TODOS_PERMISOS.includes(p)))];

// ---------- Sedes ----------
async function manejarSedes(req, res, yo) {
  if (req.method === 'GET') {
    const sedes = await sedesCache();
    return res.status(200).json({ sedes, actual: await resolverSede(req), fija: !!yo.sede });
  }
  if (!yo.puede('sedes')) return res.status(403).json({ error: 'No tienes permiso para crear o editar sedes' });
  const b = leer(req);
  const sedes = await leerSedes();
  if (req.method === 'POST') {
    const nombre = txt(b.nombre, 50);
    if (nombre.length < 2) return res.status(400).json({ error: 'Escribe el nombre de la sede' });
    if (sedes.some((s) => s.nombre.toLowerCase() === nombre.toLowerCase())) return res.status(400).json({ error: 'Ya existe una sede con ese nombre' });
    if (sedes.length >= 20) return res.status(400).json({ error: 'Máximo 20 sedes' });
    let id = slug(nombre) || 'sede'; while (sedes.some((s) => s.id === id) || id === 's') id += '-2';
    const nueva = { id, nombre, direccion: txt(b.direccion, 120), activa: true, creada: Date.now(), creadaPor: yo.usuario };
    sedes.push(nueva);
    await guardarSedes(sedes); olvidarSedes();
    return res.status(201).json({ sede: nueva, sedes });
  }
  if (req.method === 'PUT') {
    const s = sedes.find((x) => x.id === b.id);
    if (!s) return res.status(404).json({ error: 'Sede no encontrada' });
    if (b.nombre !== undefined) {
      const nombre = txt(b.nombre, 50);
      if (nombre.length < 2) return res.status(400).json({ error: 'Escribe el nombre de la sede' });
      if (sedes.some((x) => x.id !== s.id && x.nombre.toLowerCase() === nombre.toLowerCase())) return res.status(400).json({ error: 'Ya existe una sede con ese nombre' });
      s.nombre = nombre;
    }
    if (b.direccion !== undefined) s.direccion = txt(b.direccion, 120);
    if (b.activa !== undefined) {
      if (s.id === SEDE_PRINCIPAL && !b.activa) return res.status(400).json({ error: 'La sede principal no se puede desactivar' });
      s.activa = !!b.activa;
    }
    await guardarSedes(sedes); olvidarSedes();
    return res.status(200).json({ sede: s, sedes });
  }
  res.setHeader('Allow', 'GET, POST, PUT');
  return res.status(405).json({ error: 'Método no permitido' });
}

// ---------- Roles ----------
async function manejarRoles(req, res, yo, lista, roles) {
  const b = leer(req);
  const usanRol = (id) => lista.filter((u) => u.rol === id);

  if (req.method === 'POST') {
    const nombre = txt(b.nombre, 30);
    if (nombre.length < 2) return res.status(400).json({ error: 'Ponle un nombre al rol (mínimo 2 letras)' });
    if (roles.some((r) => r.nombre.toLowerCase() === nombre.toLowerCase())) return res.status(400).json({ error: 'Ya existe un rol con ese nombre' });
    let id = slug(nombre) || 'rol'; while (roles.some((r) => r.id === id)) id += '-2';
    const nuevo = { id, nombre, icono: txt(b.icono, 8) || '🎭', permisos: limpiarPermisos(b.permisos) };
    roles.push(nuevo);
    const guardados = await guardarRoles(roles);
    return res.status(201).json({ rol: nuevo, roles: guardados });
  }

  if (req.method === 'PUT') {
    const rol = roles.find((r) => r.id === b.id);
    if (!rol) return res.status(404).json({ error: 'Rol no encontrado' });
    if (b.nombre !== undefined) {
      const nombre = txt(b.nombre, 30);
      if (nombre.length < 2) return res.status(400).json({ error: 'El nombre del rol debe tener mínimo 2 letras' });
      if (roles.some((r) => r.id !== rol.id && r.nombre.toLowerCase() === nombre.toLowerCase())) return res.status(400).json({ error: 'Ya existe un rol con ese nombre' });
      rol.nombre = nombre;
    }
    if (b.icono !== undefined) rol.icono = txt(b.icono, 8) || rol.icono;
    if (b.permisos !== undefined) {
      if (rol.fijo) return res.status(400).json({ error: 'El Administrador siempre tiene todos los permisos' });
      rol.permisos = limpiarPermisos(b.permisos);
    }
    if (!permisosDe(lista.find((u) => u.id === yo.id), roles).includes('usuarios')) return res.status(400).json({ error: 'Con ese cambio perderías el permiso de administrar usuarios' });
    if (!quedaAdmin(lista, roles)) return res.status(400).json({ error: 'Debe quedar al menos un usuario que pueda administrar usuarios' });
    const guardados = await guardarRoles(roles);
    return res.status(200).json({ rol: guardados.find((r) => r.id === rol.id), roles: guardados });
  }

  if (req.method === 'DELETE') {
    const id = b.id || new URL(req.url, 'http://x').searchParams.get('id');
    const rol = roles.find((r) => r.id === id);
    if (!rol) return res.status(404).json({ error: 'Rol no encontrado' });
    if (rol.fijo) return res.status(400).json({ error: 'El rol Administrador no se puede borrar' });
    const lo = usanRol(id);
    if (lo.length) return res.status(400).json({ error: `Lo tienen ${lo.map((u) => u.nombre).join(', ')}. Cámbiales el rol primero.` });
    const guardados = await guardarRoles(roles.filter((r) => r.id !== id));
    return res.status(200).json({ ok: true, roles: guardados });
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  return res.status(405).json({ error: 'Método no permitido' });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const yo = await sesion(req);
  if (!yo) return res.status(401).json({ error: 'Inicia sesión' });
  if (ruta(req) === 'sedes') { try { return await manejarSedes(req, res, yo); } catch (e) { console.error(e); return res.status(500).json({ error: 'Error del servidor' }); } }
  if (!yo.puede('usuarios')) return res.status(403).json({ error: 'No tienes permiso para administrar usuarios' });

  try {
    // Se trabaja sobre una copia: si algo no es válido, no queda nada a medio cambiar
    const lista = await leerUsuarios(true);
    const roles = await leerRoles();
    const existeRol = (id) => roles.some((r) => r.id === id);
    const rolPorDefecto = existeRol('vendedor') ? 'vendedor' : (roles.find((r) => !r.fijo) || roles[0]).id;

    const sedes = await sedesCache();
    const sedeValida = (id) => id === '' || sedes.some((x) => x.id === id);
    if (req.method === 'GET') return res.status(200).json({ usuarios: lista.map((u) => publico(u, roles)), roles, sedes, yo: yo.id });
    if (ruta(req) === 'roles') return manejarRoles(req, res, yo, lista, roles);

    const b = leer(req);

    // Crear
    if (req.method === 'POST') {
      const usuario = txt(b.usuario, 30);
      if (!NOMBRE_USUARIO.test(usuario)) return res.status(400).json({ error: 'El usuario debe tener de 2 a 30 letras o números, sin espacios' });
      if (lista.some((u) => u.usuario.toLowerCase() === usuario.toLowerCase())) return res.status(400).json({ error: 'Ese usuario ya existe' });
      if (String(b.clave || '').length < 4) return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
      let id = slug(usuario); while (lista.some((u) => u.id === id)) id += '-2';
      const nuevo = {
        id, usuario, nombre: txt(b.nombre, 50) || usuario,
        rol: existeRol(b.rol) ? b.rol : rolPorDefecto,
        permisos: Array.isArray(b.permisos) ? b.permisos.filter((p) => TODOS_PERMISOS.includes(p)) : null,
        sede: sedeValida(b.sede ?? '') ? (b.sede ?? '') : '',
        activo: true, hash: cifrar(b.clave), ver: 1, creado: Date.now(), creadoPor: yo.usuario,
      };
      lista.push(nuevo);
      await guardarUsuarios(lista);
      return res.status(201).json({ usuario: publico(nuevo, roles) });
    }

    // Editar (nombre, rol, permisos, activo, clave)
    if (req.method === 'PUT') {
      const u = lista.find((x) => x.id === b.id);
      if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
      if (b.nombre !== undefined) u.nombre = txt(b.nombre, 50) || u.usuario;
      if (b.rol !== undefined && existeRol(b.rol)) u.rol = b.rol;
      if (b.sede !== undefined && sedeValida(b.sede)) u.sede = b.sede;
      if (b.permisos !== undefined) u.permisos = Array.isArray(b.permisos) ? b.permisos.filter((p) => TODOS_PERMISOS.includes(p)) : null;
      if (b.activo !== undefined) {
        if (!b.activo && u.id === yo.id) return res.status(400).json({ error: 'No puedes desactivarte a ti mismo' });
        if (u.activo !== false && !b.activo) u.ver = (u.ver || 1) + 1; // cierra su sesión
        u.activo = !!b.activo;
      }
      if (b.clave) {
        if (String(b.clave).length < 4) return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
        u.hash = cifrar(b.clave);
        if (u.id !== yo.id) u.ver = (u.ver || 1) + 1; // cierra sus sesiones abiertas
      }
      if (u.id === yo.id && !permisosDe(u, roles).includes('usuarios')) return res.status(400).json({ error: 'No puedes quitarte a ti mismo el permiso de administrar usuarios' });
      if (!quedaAdmin(lista, roles)) return res.status(400).json({ error: 'Debe quedar al menos un usuario que pueda administrar usuarios' });
      u.editado = Date.now(); u.editadoPor = yo.usuario;
      await guardarUsuarios(lista);
      return res.status(200).json({ usuario: publico(u, roles) });
    }

    // Borrar
    if (req.method === 'DELETE') {
      const id = b.id || (req.query?.id ?? new URL(req.url, 'http://x').searchParams.get('id'));
      if (id === yo.id) return res.status(400).json({ error: 'No puedes borrarte a ti mismo' });
      const nueva = lista.filter((u) => u.id !== id);
      if (nueva.length === lista.length) return res.status(404).json({ error: 'Usuario no encontrado' });
      if (!quedaAdmin(nueva, roles)) return res.status(400).json({ error: 'Debe quedar al menos un usuario que pueda administrar usuarios' });
      await guardarUsuarios(nueva);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
