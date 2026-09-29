// "19:23 · há 12 min" — hora em que o item foi pedido + quanto tempo faz (pedido do Ramon/garçons, 2026-09-29).
// Item de outro dia mostra data + hora (não "há 1200 min").
export function descreverHoraDoPedido(criadoEm: string | Date | null | undefined, agora: Date = new Date()): string {
  if (!criadoEm) return '';
  const d = criadoEm instanceof Date ? criadoEm : new Date(criadoEm);
  if (Number.isNaN(d.getTime())) return '';
  const p2 = (n: number) => String(n).padStart(2, '0');
  const hora = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const mesmoDia = d.getFullYear() === agora.getFullYear() && d.getMonth() === agora.getMonth() && d.getDate() === agora.getDate();
  if (!mesmoDia) return `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${hora}`;
  const min = Math.max(0, Math.floor((agora.getTime() - d.getTime()) / 60000));
  if (min < 1) return `${hora} · agora`;
  if (min < 60) return `${hora} · há ${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return `${hora} · há ${h} h${r ? ` ${r} min` : ''}`;
}
