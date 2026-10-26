// PDF da equipe e de cada pessoa (Relatórios v2, 26/10/2026). Puro: devolve HTML no A4 da Norte; quem imprime é lib/print.ts.
import type { EventoLinha, Pessoa } from './analiseEquipe';
import { getRoleLabel } from '../labels';
import { EXCEPTION_LABELS } from '../excecoes';
import { brl, cabecalho, esc, relativas, rodape, tabela, type RelatorioMeta } from './relatorioHtml';

export const duracao = (min: number) => (min <= 0 ? '—' : min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`);
const quandoBr = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const VAZIO = '<p class="vazio">Nada para mostrar neste período.</p>';
const longa = (html: string) => html.replace('<table>', '<table class="longa">');

export function buildEquipeHtml(pessoas: Pessoa[], m: RelatorioMeta): string {
  const corpo = pessoas.length === 0 ? `<h2>Equipe</h2>${VAZIO}` : longa(tabela('Equipe — o que cada pessoa fez',
    [{ rotulo: 'Pessoa' }, { rotulo: 'Lançou', direita: true }, { rotulo: 'Itens', direita: true }, { rotulo: 'Recebeu', direita: true }, { rotulo: 'Contas', direita: true }, { rotulo: 'Cancelou', direita: true }, { rotulo: 'Tempo logado', direita: true }, { rotulo: 'Pré-contas', direita: true }],
    pessoas.map((p, i) => ({
      cels: [`${p.nome}${p.papel ? ` (${getRoleLabel(p.papel)})` : ''}`, brl(p.lancou.valor), String(p.lancou.itens), brl(p.recebeu.valor), String(p.recebeu.contas), p.excecoes.cancelados.qtd ? `${p.excecoes.cancelados.qtd} · ${brl(p.excecoes.cancelados.valor)}` : '—', duracao(p.login.minutos), String(p.preContas)],
      barra: relativas(pessoas, (x) => x.lancou.valor + x.recebeu.valor)[i],
    }))));
  return `${cabecalho(m, m.titulo ?? 'Equipe')}${corpo}${rodape}`;
}

export function buildPessoaHtml(p: Pessoa, linha: EventoLinha[], m: RelatorioMeta): string {
  const cards: [string, string][] = [
    ['Lançou', brl(p.lancou.valor)], ['Itens lançados', String(p.lancou.itens)], ['Recebeu', brl(p.recebeu.valor)], ['Contas recebidas', String(p.recebeu.contas)],
    ['Tempo logado', duracao(p.login.minutos)], ['Entradas no sistema', String(p.login.entradas)], ['Cancelou', `${p.excecoes.cancelados.qtd} · ${brl(p.excecoes.cancelados.valor)}`], ['Pré-contas', String(p.preContas)],
  ];
  const kpis = `<div class="kpis">${cards.map(([l, v]) => `<div class="kpi"><small>${esc(l)}</small><b>${esc(v)}</b></div>`).join('')}</div>`;
  const papel = p.papel ? `<p>Função: <b>${esc(getRoleLabel(p.papel))}</b> · Mesas atendidas: ${p.lancou.mesas} · Mesas abertas: ${p.mesasAbertas} · Trocas de mesa: ${p.mesasTrocadas}${p.ponto.minutos ? ` · Ponto: ${esc(duracao(p.ponto.minutos))}` : ''}</p>` : '';
  const prods = p.lancou.produtos.length === 0 ? '' : longa(tabela('Produtos que lançou', [{ rotulo: 'Produto' }, { rotulo: 'Qtd', direita: true }, { rotulo: 'Total', direita: true }],
    p.lancou.produtos.map((x, i) => ({ cels: [x.nome, String(x.qtd), brl(x.total)], barra: relativas(p.lancou.produtos, (y) => y.total)[i] }))));
  const formas = p.recebeu.porForma.length === 0 ? '' : tabela('Contas que recebeu, por forma', [{ rotulo: 'Forma' }, { rotulo: 'Total', direita: true }],
    p.recebeu.porForma.map((f, i) => ({ cels: [f.rotulo, brl(f.total)], barra: relativas(p.recebeu.porForma, (y) => y.total)[i] })));
  const exc = Object.keys(p.excecoes.porTipo).length === 0 ? '' : tabela('Exceções', [{ rotulo: 'Tipo' }, { rotulo: 'Quantas', direita: true }],
    Object.entries(p.excecoes.porTipo).map(([t, n]) => ({ cels: [EXCEPTION_LABELS[t] ?? t, String(n)] })));
  const lt = linha.length === 0 ? `<h2>Linha do tempo</h2>${VAZIO}` : `<h2>Linha do tempo</h2><table class="longa"><thead><tr><th>Quando</th><th>O que fez</th><th class="d">Valor</th></tr></thead><tbody>${
    linha.map((e) => `<tr><td>${esc(quandoBr(e.quando))}</td><td>${esc(e.texto)}</td><td class="d">${e.valor != null ? esc(brl(e.valor)) : ''}</td></tr>`).join('')}</tbody></table>`;
  return `${cabecalho(m, m.titulo ?? p.nome)}<h2>${esc(p.nome)}</h2>${papel}${kpis}${prods}${formas}${exc}${lt}${rodape}`;
}
