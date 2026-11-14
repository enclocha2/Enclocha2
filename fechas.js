// Fechas en hora de Colombia, como texto YYYY-MM-DD (sin líos de zona horaria)
export const ZONA = 'America/Bogota';
export const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: ZONA });
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
