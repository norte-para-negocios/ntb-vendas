// Busca do lançamento (garçom/caixa) que também acha pelo SABOR/opção (15/10/2026, pedido do dono: no Sertão "calabresa"
// dava "Nada encontrado" porque o sabor mora dentro da pizza, nos grupos "Sabor 1"/"Sabor 2").
//  - produto cujo nome/descrição bate: aparece como antes (sem nada marcado);
//  - produto cujo nome não bate mas tem uma OPÇÃO que bate: aparece com "Sabor 1: Calabresa" e, ao abrir, essa opção já
//    vem marcada (no 1º grupo, pela ordem, que tem a opção disponível — o "Sabor 1"; o resto o garçom escolhe).
//    Várias opções do mesmo produto batendo = um resultado para cada.
//  - 2ª rodada (15/10/2026, Ramon: "pesquisa o produto, escolhe e confirma", 3 cliques): o resultado já traz o TAMANHO em
//    botões (P · M · G com o preço). Um toque joga a pizza inteira daquele sabor no carrinho, sem abrir a janela.
//    "Meio a meio" vai para o fim da lista; nele o botão abre a janela com tamanho e 1º sabor marcados, já no 2º sabor.
import { normalizeForSearch } from './search';
import { getEffectivePrice, resolveSelectedOptions } from './calc';
import { visibleOptionGroups } from './optionRules';
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
  // Meio a meio no fim: quem busca um sabor quase sempre quer a pizza inteira dele.
  const meio = porOpcao.filter((r) => ehMeioAMeio(r.product));
  return [...porNome, ...porOpcao.filter((r) => !ehMeioAMeio(r.product)), ...meio];
}

export const ehMeioAMeio = (p: Pick<Product, 'name'>) => normalizeForSearch(p.name).includes('meio a meio');

export type EscolhaRapida = { optionId: string; nome: string; selecoes: Record<string, string[]>; preco: number };

/**
 * Botões de tamanho do resultado da busca por sabor. Só quando, com o sabor marcado, falta escolher UM grupo obrigatório
 * (de escolha única, até 4 opções — o "Tamanho"). Cada botão já leva tudo o que é obrigatório; o resto (2º sabor, borda)
 * fica vazio = pizza inteira daquele sabor. Meio a meio: só os tamanhos que deixam escolher o 2º sabor (Pequena é 1 sabor).
 */
export function escolhasRapidas(product: Product, opcao: ResultadoBusca['opcao'], agora: Date = new Date()): EscolhaRapida[] {
  if (!opcao || product.sold_out) return [];
  const base: Record<string, string[]> = { [opcao.groupId]: [opcao.optionId] };
  const todos = product.option_groups || [];
  const faltando = visibleOptionGroups(todos, base).filter((g) => g.required && !(base[g.id] || []).length);
  if (faltando.length !== 1) return [];
  const g = faltando[0];
  if (g.type !== 'single') return [];
  const ops = [...(g.options || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).filter((o) => o.available !== false);
  if (ops.length === 0 || ops.length > 4) return [];
  const meio = ehMeioAMeio(product);
  const out: EscolhaRapida[] = [];
  for (const o of ops) {
    const selecoes = { ...base, [g.id]: [o.id] };
    const visiveis = visibleOptionGroups(todos, selecoes);
    if (visiveis.some((x) => x.required && !(selecoes[x.id] || []).length)) continue;
    if (meio && !visiveis.some((x) => normalizeForSearch(x.name).startsWith('sabor 2'))) continue;
    const extra = resolveSelectedOptions(visiveis, selecoes).reduce((a, x) => a + x.price_delta, 0);
    out.push({ optionId: o.id, nome: o.name, selecoes, preco: Math.round((getEffectivePrice(product, agora) + extra) * 100) / 100 });
  }
  return out;
}
