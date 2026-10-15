// Busca do lançamento (garçom/caixa) que também acha pelo SABOR/opção (15/10/2026, pedido do dono: no Sertão "calabresa"
// dava "Nada encontrado" porque o sabor mora dentro da pizza, nos grupos "Sabor 1"/"Sabor 2").
//  - produto cujo nome/descrição bate: aparece como antes (sem nada marcado);
//  - produto cujo nome não bate mas tem uma OPÇÃO que bate: aparece com "Sabor 1: Calabresa" e, ao abrir, essa opção já
//    vem marcada (no 1º grupo, pela ordem, que tem a opção disponível — o "Sabor 1"; o resto o garçom escolhe).
//    Várias opções do mesmo produto batendo = um resultado para cada.
import { normalizeForSearch } from './search';
import type { Product } from '@/types';

export type ResultadoBusca = { product: Product; opcao?: { groupId: string; groupName: string; optionId: string; optionName: string } };

export function buscarProdutosEOpcoes(produtos: Product[], termo: string): ResultadoBusca[] {
  const nt = normalizeForSearch(termo.trim());
  if (!nt) return [];
  const porNome: ResultadoBusca[] = [];
  const porOpcao: ResultadoBusca[] = [];
  for (const p of produtos) {
    if (normalizeForSearch(p.name).includes(nt) || (!!p.description && normalizeForSearch(p.description).includes(nt))) {
      porNome.push({ product: p });
      continue;
    }
    // 1º grupo (pela ordem) com opção disponível que bate; cada opção que bate vira um resultado
    // ("Calabresa" e "Calabresa c/ Catupiry" aparecem separados).
    const grupos = [...(p.option_groups || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const g of grupos) {
      const ops = [...(g.options || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .filter((x) => x.available !== false && normalizeForSearch(x.name).includes(nt));
      if (ops.length === 0) continue;
      for (const o of ops) porOpcao.push({ product: p, opcao: { groupId: g.id, groupName: g.name, optionId: o.id, optionName: o.name } });
      break;
    }
  }
  return [...porNome, ...porOpcao];
}
