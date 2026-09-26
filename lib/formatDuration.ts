// Tempo legível a partir de minutos (redesign estilo Apple, 2026-09-26):
// "2626" -> "1 d 19 h"; "125" -> "2 h 5 min"; "8" -> "8 min".
export const formatDuration = (min: number): string => {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
};
