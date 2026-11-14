// Administración de usuarios, roles y permisos (requiere el permiso "usuarios").
import { sesion, leerUsuarios, guardarUsuarios, cifrar, publico, ROLES, TODOS_PERMISOS } from './_lib/auth.js';
import { permisosDe, slug } from '../catalog.js';

const leer = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});
const txt = (s, n) => String(s ?? '').trim().slice(0, n);
const NOMBRE_USUARIO = /^[\p{L}\p{N}._-]{2,30}$/u;

// Siempre debe quedar al menos un usuario activo que pueda administrar usuarios
const quedaAdmin = (lista) => lista.some((u) => u.activo !== false && permisosDe(u).includes('usuarios'));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const yo = await sesion(req);
  if (!yo) return res.status(401).json({ error: 'Inicia sesión' });
  if (!yo.puede('usuarios')) return res.status(403).json({ error: 'No tienes permiso para administrar usuarios' });

  try {
    // Se trabaja sobre una copia: si algo no es válido, no queda nada a medio cambiar
    const lista = structuredClone(await leerUsuarios(true));

    if (req.method === 'GET') return res.status(200).json({ usuarios: lista.map(publico), roles: ROLES, yo: yo.id });

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
        rol: ROLES.some((r) => r.id === b.rol) ? b.rol : 'vendedor',
        permisos: Array.isArray(b.permisos) ? b.permisos.filter((p) => TODOS_PERMISOS.includes(p)) : null,
        activo: true, hash: cifrar(b.clave), ver: 1, creado: Date.now(), creadoPor: yo.usuario,
      };
      lista.push(nuevo);
      await guardarUsuarios(lista);
      return res.status(201).json({ usuario: publico(nuevo) });
    }

    // Editar (nombre, rol, permisos, activo, clave)
    if (req.method === 'PUT') {
      const u = lista.find((x) => x.id === b.id);
      if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
      if (b.nombre !== undefined) u.nombre = txt(b.nombre, 50) || u.usuario;
      if (b.rol !== undefined && ROLES.some((r) => r.id === b.rol)) u.rol = b.rol;
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
      if (u.id === yo.id && !permisosDe(u).includes('usuarios')) return res.status(400).json({ error: 'No puedes quitarte a ti mismo el permiso de administrar usuarios' });
      if (!quedaAdmin(lista)) return res.status(400).json({ error: 'Debe quedar al menos un usuario que pueda administrar usuarios' });
      u.editado = Date.now(); u.editadoPor = yo.usuario;
      await guardarUsuarios(lista);
      return res.status(200).json({ usuario: publico(u) });
    }

    // Borrar
    if (req.method === 'DELETE') {
      const id = b.id || (req.query?.id ?? new URL(req.url, 'http://x').searchParams.get('id'));
      if (id === yo.id) return res.status(400).json({ error: 'No puedes borrarte a ti mismo' });
      const nueva = lista.filter((u) => u.id !== id);
      if (nueva.length === lista.length) return res.status(404).json({ error: 'Usuario no encontrado' });
      if (!quedaAdmin(nueva)) return res.status(400).json({ error: 'Debe quedar al menos un usuario que pueda administrar usuarios' });
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
