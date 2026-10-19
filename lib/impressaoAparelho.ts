// Onde cada papel sai, POR COMPUTADOR (19/10/2026, pedido do dono: "se eu imprimir no notebook e botei para a comanda sair
// no bar, vai sair no bar; se eu tô no computador do caixa e botei pra comanda sair no caixa, vai sair no caixa").
// A escolha fica guardada no próprio aparelho (localStorage, por loja) e vale para os papéis que o aparelho manda imprimir:
// comanda (conta do cliente), comprovante, cupom fiscal e fechamento de caixa. Os PEDIDOS continuam saindo no local de
// preparo (Cozinha/Bar/Pizzaria), que é o mesmo para a loja toda.
// Sem escolha no aparelho (ou "Igual à loja"), vale a marcação de cada impressora, como sempre foi.
import type { DocPrint } from '@/lib/printDocs';

export const DOCS_DO_APARELHO: DocPrint[] = ['pre_conta', 'comprovante', 'cupom_fiscal', 'fechamento_caixa'];

/** doc -> ids das impressoras escolhidas neste aparelho. Lista vazia = não imprimir neste aparelho. Ausente = igual à loja. */
export type ImpressaoDoAparelho = Partial<Record<DocPrint, string[]>>;

const chave = (storeId: string) => `ntb-impressao-aparelho:${storeId}`;

export function lerImpressaoDoAparelho(storeId: string): ImpressaoDoAparelho {
  try {
    if (typeof window === 'undefined') return {};
    const bruto = JSON.parse(window.localStorage.getItem(chave(storeId)) || '{}');
    const mapa: ImpressaoDoAparelho = {};
    for (const doc of DOCS_DO_APARELHO) {
      const v = bruto?.[doc];
      if (Array.isArray(v)) mapa[doc] = v.filter((x: unknown) => typeof x === 'string');
    }
    return mapa;
  } catch {
    return {};
  }
}

/** `ids` null = volta a seguir a loja. */
export function salvarImpressaoDoAparelho(storeId: string, doc: DocPrint, ids: string[] | null): ImpressaoDoAparelho {
  const mapa = lerImpressaoDoAparelho(storeId);
  if (ids === null) delete mapa[doc]; else mapa[doc] = ids;
  try { window.localStorage.setItem(chave(storeId), JSON.stringify(mapa)); } catch { /* sem armazenamento: fica igual à loja */ }
  return mapa;
}

/**
 * Impressoras que recebem o papel a partir deste aparelho.
 * `ativas`: impressoras de rede/USB ativas da loja; `daLoja`: as marcadas para o papel (regra antiga).
 * Escolha do aparelho apontando só para impressora apagada/desativada cai na regra da loja (o papel nunca some calado).
 */
export function escolherImpressorasDoAparelho<P extends { id: string }>(
  mapa: ImpressaoDoAparelho,
  doc: DocPrint,
  ativas: P[],
  daLoja: P[],
): { impressoras: P[]; doAparelho: boolean } {
  const ids = DOCS_DO_APARELHO.includes(doc) ? mapa[doc] : undefined;
  if (!ids) return { impressoras: daLoja, doAparelho: false };
  if (ids.length === 0) return { impressoras: [], doAparelho: true };
  const escolhidas = ativas.filter((p) => ids.includes(p.id));
  return escolhidas.length > 0 ? { impressoras: escolhidas, doAparelho: true } : { impressoras: daLoja, doAparelho: false };
}

/**
 * Chave anti-duplicata do papel em cada impressora. Comanda AUTOMÁTICA (pedir conta) é um evento da loja: todo computador
 * aberto e o celular de quem pediu tentam imprimir, e só o primeiro pode sair. Por isso, na automática, a chave da posição
 * i é a mesma que um aparelho sem escolha usaria (id da i-ésima impressora da loja), seja qual for a impressora deste
 * aparelho: com escolhas diferentes em cada computador, a comanda sai uma vez, na escolha de quem chegou primeiro.
 */
export function chaveDoPapel(base: string, impressora: { id: string }, i: number, daLoja: { id: string }[], doAparelho: boolean, automatica: boolean): string {
  if (!doAparelho || !automatica) return `${base}:${impressora.id}`;
  return `${base}:${daLoja[i]?.id ?? `aparelho${i}`}`;
}
