import { usuarioDe, esAdmin } from './_lib/auth.js';
import { ventasEntre, listar, leerCierre, guardarCierre, listarCierres, migrarVentas, comprasEntre } from './_lib/store.js';
import { inicioJornada, finJornada } from '../fechas.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export const DENOMINACIONES = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50];
const entero = (n, max = 1e9) => Math.min(Math.max(Math.round(Number(n) || 0), 0), max);
const txt = (s, max) => String(s ?? '').trim().slice(0, max);

// Lo que dice el sistema para una jornada: ventas cobradas y pedidos sin cobrar
async function sistema(jornada) {
  const ini = inicioJornada(jornada), fin = finJornada(jornada);
  const ventas = await ventasEntre(ini, fin);
  const r = { n: ventas.length, total: 0, efectivo: 0, transferencia: 0, porUsuario: {} };
  for (const v of ventas) {
    r.total += v.t;
    r[v.m] += v.t;
    const u = (r.porUsuario[v.cb || '—'] ||= { efectivo: 0, transferencia: 0, n: 0 });
    u[v.m] += v.t; u.n++;
  }
  const pendientes = (await listar(300)).filter((p) => p.creado >= ini && p.creado <= fin && p.estado !== 'cancelado' && !p.pago?.pagado);
  const compras = (await comprasEntre(jornada, jornada)).filter((c) => c.pago === 'caja');
  r.comprasCaja = { n: compras.length, total: compras.reduce((s, c) => s + c.valor, 0), lista: compras.map((c) => ({ insumo: c.insumo, valor: c.valor, por: c.registradoPor })) };
  r.pendientes = { n: pendientes.length, total: pendientes.reduce((s, p) => s + p.total, 0), clientes: [...new Set(pendientes.map((p) => p.cliente))].slice(0, 20) };
  return r;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const usuario = usuarioDe(req);
  if (!usuario) return res.status(401).json({ error: 'Inicia sesión' });
  if (!esAdmin(usuario)) return res.status(403).json({ error: 'No tienes permiso para el cierre de caja' });

  try {
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);

    if (req.method === 'GET') {
      if (q.lista) return res.status(200).json({ cierres: await listarCierres(Number(q.lista) || 60) });
      if (!FECHA.test(q.jornada || '')) return res.status(400).json({ error: 'Jornada inválida' });
      await migrarVentas();
      const [cierre, actual, historial] = await Promise.all([leerCierre(q.jornada), sistema(q.jornada), listarCierres(10)]);
      const anterior = historial.find((c) => c.jornada < q.jornada) || null;
      // ¿Cambiaron las ventas después de cerrar?
      const cambios = cierre && (cierre.sistema.total !== actual.total || cierre.sistema.efectivo !== actual.efectivo || cierre.sistema.n !== actual.n || (cierre.sistema.comprasCaja?.total || 0) !== actual.comprasCaja.total);
      return res.status(200).json({ cierre, sistema: actual, baseSugerida: anterior?.baseSiguiente ?? null, cambiosDespues: !!cambios });
    }

    if (req.method === 'PUT') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      if (!FECHA.test(b.jornada || '')) return res.status(400).json({ error: 'Jornada inválida' });

      const s = await sistema(b.jornada);
      const conteo = {};
      for (const d of DENOMINACIONES) { const n = entero(b.conteo?.[d], 100000); if (n) conteo[d] = n; }
      const contado = Object.entries(conteo).reduce((t, [d, n]) => t + Number(d) * n, 0);
      const gastos = (Array.isArray(b.gastos) ? b.gastos : []).slice(0, 50)
        .map((g) => ({ concepto: txt(g.concepto, 80) || 'Gasto', valor: entero(g.valor) })).filter((g) => g.valor > 0);
      const totalGastos = gastos.reduce((t, g) => t + g.valor, 0);
      const base = entero(b.base);
      const esperadoEfectivo = base + s.efectivo - totalGastos - s.comprasCaja.total;
      const transferenciasVerificadas = entero(b.transferenciasVerificadas);
      const baseSiguiente = entero(b.baseSiguiente);

      const previo = await leerCierre(b.jornada);
      const cierre = {
        jornada: b.jornada,
        sistema: s,
        base, conteo, contado, gastos, totalGastos,
        esperadoEfectivo, difEfectivo: contado - esperadoEfectivo,
        transferenciasVerificadas, difTransferencias: transferenciasVerificadas - s.transferencia,
        baseSiguiente, retiro: contado - baseSiguiente,
        notas: txt(b.notas, 600),
        cerradoPor: usuario, cerradoEn: Date.now(),
        versiones: (previo?.versiones || 0) + 1,
        primerCierre: previo ? (previo.primerCierre || { por: previo.cerradoPor, en: previo.cerradoEn }) : null,
      };
      await guardarCierre(cierre);
      return res.status(200).json({ cierre });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
