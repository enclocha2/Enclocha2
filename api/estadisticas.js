// Estadísticas mensuales: ventas vs gastos de los últimos meses + detalle del mes escogido.
import { sesion } from './_lib/auth.js';
import { leerResumen, comprasEntre, pagosFijosAnio, listarCierres, ventasEntre, migrarVentas, recalcularResumenJornadas } from './_lib/store.js';
import { finMes, sumarMeses, inicioJornada, finJornada, jornadaDe, horaJornada, diaSemana, diasEntre, horarioDe, hoy } from '../fechas.js';

const MES = /^\d{4}-\d{2}$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const yo = await sesion(req);
  if (!yo) return res.status(401).json({ error: 'Inicia sesión' });
  if (!yo.puede('reportes')) return res.status(403).json({ error: 'No tienes permiso para ver reportes' });
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  if (!MES.test(q.mes || '')) return res.status(400).json({ error: 'Mes inválido' });

  try {
    await migrarVentas(); await recalcularResumenJornadas();
    const n = Math.min(Math.max(Number(q.meses) || 12, 3), 24);
    const meses = Array.from({ length: n }, (_, i) => sumarMeses(`${q.mes}-01`, i - n + 1).slice(0, 7));
    const desde = `${meses[0]}-01`, hasta = finMes(`${q.mes}-01`);
    const anios = [...new Set(meses.map((m) => m.slice(0, 4)))];

    const [resumen, compras, pagosPorAnio, cierres] = await Promise.all([
      leerResumen(), comprasEntre(desde, hasta), Promise.all(anios.map(pagosFijosAnio)), listarCierres(800),
    ]);
    const pagosPorMes = Object.assign({}, ...pagosPorAnio);
    const hoyJ = hoy();
    // Si el mes escogido es el actual, para comparar justo se corta el mes anterior en el mismo día
    const corte = q.mes === hoyJ.slice(0, 7) ? Number(hoyJ.slice(8, 10)) : null;

    // ---------- Totales por mes ----------
    const porMes = meses.map((mes) => {
      const dias = Object.entries(resumen).filter(([d]) => d.startsWith(mes));
      const ventas = dias.reduce((s, [, v]) => s + (v.total || 0), 0);
      const c = compras.filter((x) => x.fecha.startsWith(mes));
      const comprasT = c.reduce((s, x) => s + x.valor, 0);
      const fijos = (pagosPorMes[mes] || []).reduce((s, p) => s + p.valor, 0);
      const caja = cierres.filter((x) => x.jornada.startsWith(mes)).reduce((s, x) => s + (x.totalGastos || 0), 0);
      const gastos = comprasT + fijos + caja;
      const programadas = diasEntre(`${mes}-01`, finMes(`${mes}-01`)).filter((d) => horarioDe(d));
      const porCat = {};
      for (const x of c) porCat[x.categoria] = (porCat[x.categoria] || 0) + x.valor;
      // totales hasta el día "corte" (para comparar contra un mes en curso)
      const hastaDia = (f) => !corte || Number(f.slice(8, 10)) <= corte;
      const diasC = dias.filter(([d]) => hastaDia(d));
      const gastosC = c.filter((x) => hastaDia(x.fecha)).reduce((s, x) => s + x.valor, 0)
        + (pagosPorMes[mes] || []).filter((p) => hastaDia(p.fecha)).reduce((s, p) => s + p.valor, 0)
        + cierres.filter((x) => x.jornada.startsWith(mes) && hastaDia(x.jornada)).reduce((s, x) => s + (x.totalGastos || 0), 0);
      const alDia = corte ? {
        ventas: diasC.reduce((s, [, v]) => s + (v.total || 0), 0), gastos: gastosC,
        n: diasC.reduce((s, [, v]) => s + (v.n || 0), 0), jornadas: diasC.filter(([, v]) => (v.total || 0) > 0).length,
      } : null;
      return {
        alDia,
        mes, ventas,
        efectivo: dias.reduce((s, [, v]) => s + (v.efectivo || 0), 0),
        transferencia: dias.reduce((s, [, v]) => s + (v.transferencia || 0), 0),
        n: dias.reduce((s, [, v]) => s + (v.n || 0), 0),
        jornadas: dias.filter(([, v]) => (v.total || 0) > 0).length,
        jornadasProgramadas: programadas.length,
        jornadasTranscurridas: programadas.filter((d) => d <= hoyJ).length,
        compras: comprasT, comprasPorCat: porCat, fijos, caja, gastos, utilidad: ventas - gastos,
      };
    });

    // ---------- Detalle del mes escogido ----------
    const ventas = await ventasEntre(inicioJornada(`${q.mes}-01`), finJornada(hasta));
    const porJornada = {}, porHora = {}, productos = {};
    for (const v of ventas) {
      const j = jornadaDe(v.pa);
      porJornada[j] = (porJornada[j] || 0) + v.t;
      const h = horaJornada(v.pa) % 24;
      porHora[h] = (porHora[h] || 0) + v.t;
      for (const [nom, cant, sub, cat] of v.it || []) {
        if (nom === 'Domicilio') continue;
        const p = (productos[nom] ||= { nombre: nom, cat, cant: 0, total: 0 });
        p.cant += cant; p.total += sub;
      }
    }
    // promedio por día de la semana (solo jornadas con ventas)
    const semana = Array.from({ length: 7 }, () => ({ total: 0, jornadas: 0 }));
    for (const [j, t] of Object.entries(porJornada)) { const d = semana[diaSemana(j)]; d.total += t; d.jornadas++; }
    const mejorJornada = Object.entries(porJornada).sort((a, b) => b[1] - a[1])[0] || null;
    const domicilios = ventas.filter((v) => v.dom).length;

    // Mismo mes del año pasado (si hay datos)
    const mesAnt = `${Number(q.mes.slice(0, 4)) - 1}${q.mes.slice(4)}`;
    const ventasAnioPasado = Object.entries(resumen).filter(([d]) => d.startsWith(mesAnt)).reduce((s, [, v]) => s + (v.total || 0), 0);

    return res.status(200).json({
      mes: q.mes, porMes, corte,
      detalle: {
        porDiaSemana: semana.map((d, i) => ({ dia: i, total: d.total, jornadas: d.jornadas, promedio: d.jornadas ? Math.round(d.total / d.jornadas) : 0 })),
        porHora: Object.entries(porHora).map(([h, t]) => ({ hora: Number(h), total: t })).sort((a, b) => b.total - a.total),
        topProductos: Object.values(productos).sort((a, b) => b.cant - a.cant).slice(0, 8),
        mejorJornada: mejorJornada ? { fecha: mejorJornada[0], total: mejorJornada[1] } : null,
        domicilios, ventasAnioPasado,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
