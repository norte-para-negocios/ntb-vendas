// Cédulas e moedas do Real em circulação — usado no fechamento de caixa
// (contagem por denominação em vez de somar de cabeça, achado da pesquisa
// de mercado: menos erro, e vira registro auditável de como se chegou no
// total). R$0,01 fora de propósito — praticamente fora de circulação.
export const CASH_DENOMINATIONS: number[] = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05];

export function sumDenominationBreakdown(breakdown: Record<string, string>): number {
  return CASH_DENOMINATIONS.reduce((total, value) => {
    const count = parseInt(breakdown[String(value)] || '0', 10);
    return total + (isNaN(count) ? 0 : count * value);
  }, 0);
}
