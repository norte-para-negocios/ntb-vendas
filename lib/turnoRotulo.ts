// Rótulo curto de "desde quando" um turno está aberto: só a hora se for de hoje; com a data (e "há X dias") quando vem de antes.
export function abertoDesde(iso: string, agora: Date = new Date()): string {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === agora.toDateString()) return hora;
  const dias = Math.floor((agora.getTime() - d.getTime()) / 86_400_000);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${data} ${hora}${dias >= 1 ? ` (há ${dias} ${dias === 1 ? 'dia' : 'dias'})` : ''}`;
}
