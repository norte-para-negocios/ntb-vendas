// PDF do relatório completo (25/10/2026): o painel inteiro ou só as seções escolhidas, no A4 da Norte
// (mesmo cabeçalho/tabela do relatório do dia). Puro: devolve HTML; quem imprime é printRelatorioCompleto (lib/print.ts).
import type { Analise, ContaResumo } from './analiseVendas';
import { brl, cabecalho, esc, rodape, tabela, relativas, type RelatorioMeta } from './relatorioHtml';

export type SecaoRelatorio = 'resumo' | 'dias' | 'horas' | 'produtos' | 'categorias' | 'formas' | 'equipe' | 'mesas' | 'contas';
export const TODAS_AS_SECOES: SecaoRelatorio[] = ['resumo', 'dias', 'horas', 'categorias', 'produtos', 'formas', 'equipe', 'mesas', 'contas'];
export const TITULO_DA_SECAO: Record<SecaoRelatorio, string> = {
  resumo: 'Resumo', dias: 'Faturamento por dia', horas: 'Faturamento por hora', produtos: 'Produtos vendidos', categorias: 'Categorias',
  formas: 'Formas de pagamento', equipe: 'Equipe (quem lançou)', mesas: 'Mesas e balcão', contas: 'Contas',
};
// Tabelas longas (todos os produtos, todas as contas) podem quebrar de página.
export const ESTILO_COMPLETO = `table.longa { break-inside: auto; } table.longa tr { break-inside: avoid; } td.itens { color: #4A4E63; font-size: 9.5px; }`;

const VAZIO = '<p class="vazio">Nada para mostrar neste período.</p>';
const diaBr = (d: string) => new Date(`${d}T12:00:00-03:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
const quandoBr = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const longa = (html: string) => html.replace('<table>', '<table class="longa">');
const pct = (n: number) => `${n.toFixed(1).replace('.', ',')}%`;

export function tabelaContas(titulo: string, contas: ContaResumo[]): string {
  if (contas.length === 0) return `<h2>${esc(titulo)}</h2>${VAZIO}`;
  const total = contas.reduce((s, c) => s + c.total, 0);
  const html = `<h2>${esc(titulo)}</h2><table class="longa"><thead><tr><th>Quando</th><th>Local</th><th>Recebeu</th><th>Pagamento</th><th>Itens</th><th class="d">Total</th></tr></thead><tbody>
    ${contas.map((c) => `<tr><td>${esc(quandoBr(c.quando))}</td><td>${esc(c.local)}</td><td>${esc(c.operador)}</td><td>${esc(c.formas)}</td><td class="itens">${esc(c.itens.map((i) => `${i.qtd}x ${i.nome}`).join(', '))}</td><td class="d">${esc(brl(c.total))}</td></tr>`).join('')}
    <tr class="tot"><td colspan="5">TOTAL (${contas.length} contas)</td><td class="d">${esc(brl(total))}</td></tr></tbody></table>`;
  return html;
}

function secao(a: Analise, s: SecaoRelatorio): string {
  const t = TITULO_DA_SECAO[s];
  const rel = <T extends { total: number }>(xs: T[]) => relativas(xs, (x) => x.total);
  switch (s) {
    case 'resumo': {
      const k = a.kpis;
      const cards: [string, string][] = [
        [a.modoItens ? 'Vendido (itens filtrados)' : 'Faturamento', brl(k.faturamento)], ['Contas', String(k.contas)], ['Ticket médio', brl(k.ticket)], ['Itens vendidos', String(k.itens)],
        ['Taxa de serviço', a.modoItens ? '—' : brl(k.taxaServico)], ['Cortesias', a.modoItens ? '—' : brl(k.cortesia)], ['Itens cancelados', String(k.cancelados.qtd)], ['Valor cancelado', brl(k.cancelados.valor)],
      ];
      return `<div class="kpis">${cards.map(([l, v]) => `<div class="kpi"><small>${esc(l)}</small><b>${esc(v)}</b></div>`).join('')}</div>`;
    }
    case 'dias': return a.porDia.length === 0 ? `<h2>${t}</h2>${VAZIO}` : longa(tabela(t, [{ rotulo: 'Dia' }, { rotulo: 'Total', direita: true }, { rotulo: 'Contas', direita: true }],
      a.porDia.map((d, i) => ({ cels: [diaBr(d.dia), brl(d.total), String(d.contas)], barra: rel(a.porDia)[i] })), ['TOTAL', brl(a.kpis.faturamento), String(a.kpis.contas)]));
    case 'horas': return a.porHora.length === 0 ? `<h2>${t}</h2>${VAZIO}` : tabela(t, [{ rotulo: 'Hora' }, { rotulo: 'Total', direita: true }, { rotulo: 'Contas', direita: true }],
      a.porHora.map((h, i) => ({ cels: [`${String(h.hora).padStart(2, '0')}h`, brl(h.total), String(h.contas)], barra: rel(a.porHora)[i] })));
    case 'produtos': return a.produtos.length === 0 ? `<h2>${t}</h2>${VAZIO}` : longa(tabela(t, [{ rotulo: '#' }, { rotulo: 'Produto' }, { rotulo: 'Categoria' }, { rotulo: 'Qtd', direita: true }, { rotulo: 'Total', direita: true }],
      a.produtos.map((p, i) => ({ cels: [String(i + 1), p.nome, p.categoria, String(p.qtd), brl(p.total)], barra: rel(a.produtos)[i] })), ['', 'TOTAL', '', String(a.kpis.itens), brl(a.produtos.reduce((x, p) => x + p.total, 0))]));
    case 'categorias': return a.categorias.length === 0 ? `<h2>${t}</h2>${VAZIO}` : tabela(t, [{ rotulo: 'Categoria' }, { rotulo: 'Qtd', direita: true }, { rotulo: 'Total', direita: true }, { rotulo: '%', direita: true }],
      a.categorias.map((c, i) => ({ cels: [c.nome, String(c.qtd), brl(c.total), pct(c.pct)], barra: rel(a.categorias)[i] })));
    case 'formas': return a.formas.length === 0 ? `<h2>${t}</h2>${VAZIO}` : tabela(t, [{ rotulo: 'Forma' }, { rotulo: 'Total', direita: true }, { rotulo: 'Contas', direita: true }],
      a.formas.map((f, i) => ({ cels: [f.rotulo, brl(f.total), String(f.contas)], barra: rel(a.formas)[i] })));
    case 'equipe': return a.equipe.length === 0 ? `<h2>${t}</h2>${VAZIO}` : tabela(t, [{ rotulo: 'Quem lançou' }, { rotulo: 'Itens', direita: true }, { rotulo: 'Contas', direita: true }, { rotulo: 'Total', direita: true }],
      a.equipe.map((e, i) => ({ cels: [e.nome, String(e.itens), String(e.contas), brl(e.total)], barra: rel(a.equipe)[i] })));
    case 'mesas': return a.mesas.length === 0 ? `<h2>${t}</h2>${VAZIO}` : longa(tabela(t, [{ rotulo: 'Local' }, { rotulo: 'Contas', direita: true }, { rotulo: 'Total', direita: true }, { rotulo: 'Ticket', direita: true }],
      a.mesas.map((m, i) => ({ cels: [m.rotulo, String(m.contas), brl(m.total), brl(m.ticket)], barra: rel(a.mesas)[i] }))));
    case 'contas': return tabelaContas(t, a.contas);
  }
}

export function buildRelatorioCompletoHtml(a: Analise, m: RelatorioMeta, secoes: SecaoRelatorio[] = TODAS_AS_SECOES): string {
  return `${cabecalho(m, m.titulo ?? 'Relatório completo')}${secoes.map((s) => secao(a, s)).join('\n')}${rodape}`;
}
