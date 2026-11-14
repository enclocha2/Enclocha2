// Fechas en hora de Colombia, como texto YYYY-MM-DD (sin líos de zona horaria)
export const ZONA = 'America/Bogota';
export const hoyCalendario = () => new Date().toLocaleDateString('en-CA', { timeZone: ZONA });
// "Hoy" para el negocio = la jornada en curso (a la 1 a. m. del sábado, hoy sigue siendo viernes)
export const hoy = () => jornadaDe(Date.now());
export const diaDe = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: ZONA });
export const horaDe = (t) => Number(new Date(t).toLocaleString('en-US', { timeZone: ZONA, hour: 'numeric', hour12: false })) % 24;

const aDate = (s) => new Date(s + 'T00:00:00Z');
const aTexto = (d) => d.toISOString().slice(0, 10);
export const sumarDias = (s, n) => { const d = aDate(s); d.setUTCDate(d.getUTCDate() + n); return aTexto(d); };
export const diaSemana = (s) => (aDate(s).getUTCDay() + 6) % 7; // 0 = lunes
export const inicioSemana = (s) => sumarDias(s, -diaSemana(s));
export const inicioMes = (s) => s.slice(0, 8) + '01';
export const finMes = (s) => { const d = aDate(inicioMes(s)); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return aTexto(d); };
export const sumarMeses = (s, n) => { const d = aDate(inicioMes(s)); d.setUTCMonth(d.getUTCMonth() + n); return aTexto(d); };
export const diasEntre = (a, b) => { const r = []; for (let d = a; d <= b; d = sumarDias(d, 1)) r.push(d); return r; };

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
export const nombreMes = (s) => MESES[Number(s.slice(5, 7)) - 1];
export const nombreDia = (s) => DIAS[diaSemana(s)];
export const fechaLarga = (s) => `${nombreDia(s)} ${Number(s.slice(8, 10))} de ${nombreMes(s)} ${s.slice(0, 4)}`;
export const fechaCorta = (s) => `${Number(s.slice(8, 10))} ${nombreMes(s).slice(0, 3)}`;
export const fechaHora = (t) => new Date(t).toLocaleString('es-CO', { timeZone: ZONA, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

// =====================================================================
// JORNADAS DE TRABAJO
// Una venta pertenece al día en que COMENZÓ la jornada: todo lo que pase
// entre las 12:00 a. m. y las 5:59 a. m. cuenta para el día anterior.
// (La jornada más larga cierra a la 1:00 a. m. del sábado; el corte a las
// 6:00 a. m. deja margen para registrar cobros tarde.)
// =====================================================================
export const CORTE = 6; // hora (a. m.) en que termina una jornada y empieza la siguiente
export const jornadaDe = (t) => diaDe(t - CORTE * 3600000);
export const jornadaActual = () => jornadaDe(Date.now());
// Hora "de jornada": 0-5 a. m. se cuentan como 24-29 para que queden después de las 11 p. m.
export const horaJornada = (t) => { const h = horaDe(t); return h < CORTE ? h + 24 : h; };
// Milisegundos de inicio/fin de una jornada (fecha YYYY-MM-DD)
export const inicioJornada = (s) => Date.parse(`${s}T${String(CORTE).padStart(2, '0')}:00:00-05:00`);
export const finJornada = (s) => inicioJornada(sumarDias(s, 1)) - 1;

// ---------- Festivos de Colombia (Ley 51 de 1983, "Ley Emiliani") ----------
function pascua(anio) {
  const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}
const alLunes = (s) => { const d = diaSemana(s); return d === 0 ? s : sumarDias(s, 7 - d); };
const cacheFestivos = {};
export function festivos(anio) {
  if (cacheFestivos[anio]) return cacheFestivos[anio];
  const f = (m, d) => `${anio}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const p = pascua(anio);
  const lista = [
    f(1, 1), f(5, 1), f(7, 20), f(8, 7), f(12, 8), f(12, 25),                       // fijos
    ...[[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]].map(([m, d]) => alLunes(f(m, d))), // se pasan al lunes
    sumarDias(p, -3), sumarDias(p, -2),                                               // jueves y viernes santo
    alLunes(sumarDias(p, 39)), alLunes(sumarDias(p, 60)), alLunes(sumarDias(p, 68)), // Ascensión, Corpus, Sagrado Corazón
  ];
  return (cacheFestivos[anio] = new Set(lista));
}
export const esFestivo = (s) => festivos(Number(s.slice(0, 4))).has(s);

// ---------- Horario del negocio ----------
// Devuelve { abre, cierra } en horas de jornada (24 = 12 a. m., 25 = 1 a. m.) o null si ese día no se trabaja.
export function horarioDe(s) {
  const d = diaSemana(s); // 0 = lunes ... 6 = domingo
  if (d === 3) return { abre: 16, cierra: 23 };                                  // jueves 4 pm - 11 pm
  if (d === 4) return { abre: 16, cierra: 24 };                                  // viernes 4 pm - 12 am
  if (d === 5) return { abre: 16, cierra: 25 };                                  // sábado 4 pm - 1 am
  if (d === 6) return { abre: 16, cierra: esFestivo(sumarDias(s, 1)) ? 24 : 23 }; // domingo (hasta 12 am si el lunes es festivo)
  if (d === 0 && esFestivo(s)) return { abre: 16, cierra: 23 };                  // lunes festivo 4 pm - 11 pm
  return null;
}
export const textoHora = (h) => { const x = h % 24; return `${x % 12 || 12}:00 ${x < 12 ? 'a. m.' : 'p. m.'}`; };
export const textoHorario = (s) => {
  const h = horarioDe(s);
  return h ? `${textoHora(h.abre)} – ${textoHora(h.cierra)}` : 'sin jornada programada';
};
