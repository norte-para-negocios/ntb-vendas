// lib/reports/historicoRotulos.ts — rótulos do Excel/PDF do Histórico de vendas (período, filtros, nome do arquivo). Puro.
import { describeFilters, type SalesFilters } from './salesFilters';

export interface FiltrosHistorico {
  mes?: string; inicio?: string; fim?: string; tipo?: string; cliente?: string;
  minItens?: string; maxItens?: string; minTotal?: string; maxTotal?: string; filtros: SalesFilters;
}

const dataBR = (iso: string): string => { const [a, m, d] = iso.slice(0, 10).split('-'); return a && m && d ? `${d}/${m}/${a}` : iso; };

export function periodoHistorico(f: FiltrosHistorico): { label: string; slug: string } {
  if (f.mes) return { label: `Mês: ${f.mes}`, slug: f.mes };
  if (f.inicio && f.fim) return { label: `De ${dataBR(f.inicio)} até ${dataBR(f.fim)}`, slug: `${f.inicio}_a_${f.fim}` };
  if (f.inicio) return { label: `A partir de ${dataBR(f.inicio)}`, slug: `desde-${f.inicio}` };
  if (f.fim) return { label: `Até ${dataBR(f.fim)}`, slug: `ate-${f.fim}` };
  return { label: 'Todo o histórico', slug: 'todo-historico' };
}

export function filtrosAtivosHistorico(f: FiltrosHistorico): string[] {
  const out: string[] = describeFilters(f.filtros).map((c) => c.label);
  if (f.tipo && f.tipo !== 'all') out.push(f.tipo === 'counter' ? 'Só balcão' : f.tipo === 'table' ? 'Só mesas' : `Tipo: ${f.tipo}`);
  if (f.cliente) out.push(`Cliente/Mesa: ${f.cliente}`);
  if (f.minItens) out.push(`Mín. ${f.minItens} itens`);
  if (f.maxItens) out.push(`Máx. ${f.maxItens} itens`);
  if (f.minTotal) out.push(`Total a partir de R$ ${f.minTotal}`);
  if (f.maxTotal) out.push(`Total até R$ ${f.maxTotal}`);
  return out;
}

/** Subtítulo do relatório: período e, quando há recorte, os filtros aplicados. */
export function subtituloHistorico(f: FiltrosHistorico): string {
  const ativos = filtrosAtivosHistorico(f);
  const { label } = periodoHistorico(f);
  return ativos.length ? `${label} · Filtrado: ${ativos.join(', ')}` : label;
}

export function nomeArquivoHistorico(f: FiltrosHistorico, slugLoja: string): string {
  const { slug } = periodoHistorico(f);
  return `relatorio-vendas_${slug}${filtrosAtivosHistorico(f).length ? '_filtrado' : ''}_${slugLoja}.xlsx`;
}
