// lib/reports/relatorioHtml.ts — relatório do dia em A4 (puro: devolve strings; quem imprime é lib/print.ts).
import type { PainelDia } from './painelDia';
import { NORTE_SIMBOLO_SVG } from './norteMarca';
import { formatBRL } from '../calc';

export interface RelatorioMeta { loja: string; periodoLabel: string; geradoEm: Date; geradoPor: string; titulo?: string }
export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const brl = (n: number) => `R$ ${formatBRL(Number.isFinite(n) ? n : 0)}`;
const pctTxt = (n: number) => `${(Number.isFinite(n) ? n * 100 : 0).toFixed(1).replace('.', ',')}%`;
const RODAPE = 'Norte Vendas · Norte para Negócios · norteparanegocios.com.br';

export const RELATORIO_STYLES = `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, Helvetica, sans-serif; color: #14163A; margin: 0; font-size: 11px; }
  .topo { display: flex; align-items: center; gap: 8px; background: #2B2E83; color: #DCDEF8; padding: 7px 12px; font-size: 10px; letter-spacing: .04em; }
  .topo svg { width: 18px; height: 18px; fill: #FFFFFF; }
  .topo svg path { fill: #FFFFFF; }
  .capa { background: #484DB5; color: #fff; padding: 12px 12px 14px; }
  .capa h1 { margin: 0; font-size: 22px; }
  .capa p { margin: 3px 0 0; color: #DCDEF8; font-size: 10.5px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 10px 0; }
  .kpi { background: #EEEFFB; border-radius: 6px; padding: 7px 9px; break-inside: avoid; }
  .kpi small { display: block; color: #666A75; font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
  .kpi b { display: block; margin-top: 2px; font-size: 16px; color: #2B2E83; }
  h2 { margin: 12px 0 0; background: #484DB5; color: #fff; font-size: 11.5px; padding: 5px 9px; border-radius: 4px 4px 0 0; break-after: avoid; }
  table { width: 100%; border-collapse: collapse; break-inside: avoid; }
  th { background: #EEEFFB; color: #2B2E83; font-size: 8.5px; text-transform: uppercase; text-align: left; padding: 4px 9px; }
  td { padding: 4px 9px; border-bottom: 1px solid #E4E5F2; }
  td.d, th.d { text-align: right; }
  td.zero { color: #8A8EA0; }
  tr.tot td { font-weight: 700; border-top: 1.5px solid #484DB5; border-bottom: 0; }
  .bar { width: 100%; height: 7px; background: #EEEFFB; border-radius: 4px; overflow: hidden; }
  .bar i { display: block; height: 100%; background: #9DA1E4; }
  .vazio { color: #666A75; font-style: italic; padding: 8px 9px; }
  .duas { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .rodape { margin-top: 14px; padding-top: 6px; border-top: 1px solid #E4E5F2; color: #8A8EA0; font-size: 8px; text-align: center; }
`;

const cabecalho = (m: RelatorioMeta, titulo: string) => `
  <div class="topo">${NORTE_SIMBOLO_SVG}<span>NORTE VENDAS · ${esc(titulo)}</span></div>
  <div class="capa"><h1>${esc(m.loja)}</h1><p>${esc(m.periodoLabel)} · gerado em ${esc(m.geradoEm.toLocaleString('pt-BR'))} por ${esc(m.geradoPor)}</p></div>`;
const rodape = `<div class="rodape">${esc(RODAPE)}</div>`;

function tabela(titulo: string, cols: { rotulo: string; direita?: boolean }[], linhas: { cels: string[]; zero?: boolean; barra?: number }[], total?: string[]): string {
  const comBarra = linhas.some((l) => l.barra != null);
  return `<h2>${esc(titulo)}</h2><table><thead><tr>${cols.map((c) => `<th class="${c.direita ? 'd' : ''}">${esc(c.rotulo)}</th>`).join('')}${comBarra ? '<th style="width:28%"></th>' : ''}</tr></thead><tbody>
    ${linhas.map((l) => `<tr>${l.cels.map((c, i) => `<td class="${cols[i]?.direita ? 'd' : ''} ${l.zero ? 'zero' : ''}">${esc(c)}</td>`).join('')}${comBarra ? `<td><div class="bar"><i style="width:${Math.max(0, Math.min(100, Math.round((l.barra ?? 0) * 100)))}%"></i></div></td>` : ''}</tr>`).join('')}
    ${total ? `<tr class="tot">${total.map((c, i) => `<td class="${cols[i]?.direita ? 'd' : ''}">${esc(c)}</td>`).join('')}${comBarra ? '<td></td>' : ''}</tr>` : ''}
  </tbody></table>`;
}

// Barra relativa à maior linha (a maior ocupa 100%).
const relativas = <T,>(xs: T[], valor: (x: T) => number): number[] => { const max = Math.max(0, ...xs.map(valor)); return xs.map((x) => (max > 0 ? valor(x) / max : 0)); };

export function buildRelatorioHtml(p: PainelDia, m: RelatorioMeta): string {
  const k = p.kpis;
  const cards: [string, string][] = [
    ['Total recebido', brl(k.recebido)], ['Contas pagas', String(k.contas)], ['Ticket médio', k.ticket != null ? brl(k.ticket) : '—'], ['Itens vendidos', String(k.itens)],
    ['Cartão de crédito', brl(k.credito)], ['Cartão de débito', brl(k.debito)], ['Taxa de serviço', brl(k.taxa)], ['Cancelamentos', String(k.cancelamentos)],
  ];
  const somar = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const rel = (xs: { total: number }[]) => relativas(xs, (x) => x.total);
  const sem = p.porHora.length === 0;
  const formas = tabela('Formas de pagamento', [{ rotulo: 'Forma' }, { rotulo: 'Total', direita: true }, { rotulo: '%', direita: true }],
    p.formas.map((f, i) => ({ cels: [f.label, brl(f.total), pctTxt(k.recebido > 0 ? f.total / k.recebido : 0)], zero: f.total === 0, barra: rel(p.formas)[i] })), ['TOTAL', brl(somar(p.formas.map((f) => f.total))), '']);
  const cartoes = tabela('Cartões por bandeira (crédito e débito separados)', [{ rotulo: 'Bandeira' }, { rotulo: 'Total', direita: true }],
    p.cartoes.map((c, i) => ({ cels: [c.label, brl(c.total)], zero: c.total === 0, barra: rel(p.cartoes)[i] })), ['TOTAL EM CARTÕES', brl(somar(p.cartoes.map((c) => c.total)))]);
  const hora = tabela('Vendas por hora', [{ rotulo: 'Hora' }, { rotulo: 'Total', direita: true }, { rotulo: 'Contas', direita: true }, { rotulo: 'Ticket', direita: true }],
    p.porHora.map((r, i) => ({ cels: [r.label, brl(r.total), String(r.orders), brl(r.ticket)], barra: rel(p.porHora)[i] })));
  const oper = tabela('Vendas por operador', [{ rotulo: 'Operador' }, { rotulo: 'Total', direita: true }, { rotulo: 'Contas', direita: true }, { rotulo: 'Ticket', direita: true }],
    p.porOperador.map((r, i) => ({ cels: [r.label, brl(r.total), String(r.orders), brl(r.ticket)], barra: rel(p.porOperador)[i] })));
  const cat = tabela('Vendas por categoria', [{ rotulo: 'Categoria' }, { rotulo: 'Total', direita: true }],
    p.porCategoria.map((r, i) => ({ cels: [r.label, brl(r.total)], barra: rel(p.porCategoria)[i] })));
  const top = tabela('Produtos mais vendidos', [{ rotulo: 'Produto' }, { rotulo: 'Qtd', direita: true }, { rotulo: 'Total', direita: true }],
    p.topProdutos.map((r, i) => ({ cels: [r.nome, String(r.qtd), brl(r.total)], barra: rel(p.topProdutos)[i] })));
  return `${cabecalho(m, m.titulo ?? 'Relatório do dia')}
    <div class="kpis">${cards.map(([l, v]) => `<div class="kpi"><small>${esc(l)}</small><b>${esc(v)}</b></div>`).join('')}</div>
    <div class="duas"><div>${formas}</div><div>${cartoes}</div></div>
    ${sem ? '<p class="vazio">Nenhuma venda neste período.</p>' : `<div class="duas"><div>${hora}</div><div>${oper}</div></div><div class="duas"><div>${cat}</div><div>${top}</div></div>`}
    ${rodape}`;
}

export function buildTabelaHtml(t: { titulo: string; subtitulo?: string; colunas: { rotulo: string; direita?: boolean }[]; linhas: string[][]; rodapeLinha?: string[] }, m: RelatorioMeta): string {
  return `${cabecalho(m, t.titulo)}
    ${t.subtitulo ? `<p style="margin:8px 0 0;color:#666A75">${esc(t.subtitulo)}</p>` : ''}
    ${t.linhas.length === 0 ? '<p class="vazio">Nada para mostrar neste período.</p>' : tabela(t.titulo, t.colunas, t.linhas.map((cels) => ({ cels })), t.rodapeLinha)}
    ${rodape}`;
}
