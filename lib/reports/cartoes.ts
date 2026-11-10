// Cartões por bandeira (10/11/2026, cliente: "na baixa das comandas são inseridas as bandeiras, mas no ADM não consegue
// essa apuração"). Regra única para o painel de Relatórios, o PDF do painel e o relatório do dia (painelDia.ts):
// só CREDIT/DEBIT de payment_details.methods; cortesia, desconto, PIX e dinheiro nunca são cartão.
import { getCardBrandLabel } from '../labels';

type MetodoCartao = { method?: string | null; amount?: number | string | null; brand?: string | null };
export type LinhaBandeira = { chave: string; bandeira: string; rotulo: string; qtd: number; total: number };
export type GrupoCartao = { total: number; qtd: number; linhas: LinhaBandeira[] };
export type CartoesPorBandeira = { credito: GrupoCartao; debito: GrupoCartao };
export type SomaCartoes = Map<string, { qtd: number; total: number }>;

const arred = (n: number) => Math.round(n * 100) / 100;

/** Chave "CREDIT|visa" (a mesma de totals_by_card); "CREDIT|" = cartão lançado sem bandeira; null se não é cartão. */
export function chaveDoCartao(m: MetodoCartao): string | null {
  return m.method === 'CREDIT' || m.method === 'DEBIT' ? `${m.method}|${m.brand ?? ''}` : null;
}

/** Soma um pagamento no acumulado (quantidade = pagamentos no cartão, total = valor pago). Ignora o que não é cartão. */
export function somarCartao(acc: SomaCartoes, m: MetodoCartao): void {
  const k = chaveDoCartao(m);
  if (!k) return;
  const c = acc.get(k) ?? { qtd: 0, total: 0 };
  c.qtd += 1; c.total += Number(m.amount) || 0;
  acc.set(k, c);
}

/** Crédito e débito separados, cada bandeira com quantidade e total, da maior para a menor. */
export function resumoCartoes(acc: SomaCartoes): CartoesPorBandeira {
  const grupo = (metodo: 'CREDIT' | 'DEBIT'): GrupoCartao => {
    const linhas = [...acc.entries()].filter(([k]) => k.startsWith(`${metodo}|`)).map(([chave, v]) => {
      const bandeira = chave.slice(metodo.length + 1);
      return { chave, bandeira, rotulo: getCardBrandLabel(bandeira) || 'Sem bandeira', qtd: v.qtd, total: arred(v.total) };
    }).filter((l) => l.total !== 0).sort((a, b) => b.total - a.total || a.rotulo.localeCompare(b.rotulo));
    return { total: arred(linhas.reduce((s, l) => s + l.total, 0)), qtd: linhas.reduce((s, l) => s + l.qtd, 0), linhas };
  };
  return { credito: grupo('CREDIT'), debito: grupo('DEBIT') };
}
