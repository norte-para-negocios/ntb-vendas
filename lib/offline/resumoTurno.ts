// Fechamento de caixa SEM servidor (13/10/2026, teste do dono na ODARA: "fechamento do caixa não imprimiu sem internet;
// encerrar caixa é uma operação independente de internet, o app existe para isso").
// O resumo do turno vem do servidor (fetch_cash_shift_summary_secure). Sem servidor, monta-se aqui:
//   cópia guardada no aparelho (atualizada a cada minuto com internet)
//   + pagamentos e sangrias/suprimentos deste turno que ainda estão na fila sem internet (deste aparelho e dos outros da rede).
// Mesmas regras de soma do servidor para o que entra na fila: valor de cada forma já é o líquido (o troco já saiu em
// getPaymentMethodsForRecord), cortesia não é faturamento e não entra no dinheiro esperado.
import type { CashShiftSummary } from '@/lib/api';

type Acao = { type: string; payload: unknown; createdAt?: number };
type Forma = { method: string; amount: number; brand?: string | null };

/** Pagamento da fila, se for deste turno. */
function pagamentoDoTurno(a: Acao, shiftId: string): { methods: Forma[]; id?: string } | null {
  if (a.type !== 'close_table_session' && a.type !== 'registrar_pagamento_balcao' && a.type !== 'close_counter_order') return null;
  const p = (a.payload ?? {}) as { paymentData?: { cash_shift_id?: string; methods?: Forma[]; payment_id?: string } };
  const pd = p.paymentData;
  if (!pd || pd.cash_shift_id !== shiftId || !Array.isArray(pd.methods)) return null;
  return { methods: pd.methods, id: pd.payment_id };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Resumo do turno sem servidor. `base` = cópia guardada (pode faltar: aí parte do fundo de troco do turno).
 * `acoes` = filas sem internet (minha + dos outros aparelhos), já sem repetição.
 */
export function resumoSemServidor(shift: CashShiftSummary['shift'], base: CashShiftSummary | null | undefined, acoes: Acao[]): CashShiftSummary & { semServidor: true; pendentesNaFila: number } {
  const r: CashShiftSummary = base
    ? JSON.parse(JSON.stringify(base))
    : {
        shift, totals_by_method: {}, totals_by_brand: {}, totals_by_card: {}, payments_count: 0, payments_total: 0,
        total_sangria: 0, total_suprimento: 0, expected_cash: Number(shift.opening_float) || 0, closing_counted_cash: null, difference: null,
      };
  r.shift = { ...r.shift, ...shift };
  const vistos = new Set<string>();
  let pendentes = 0;
  for (const a of acoes) {
    const pg = pagamentoDoTurno(a, shift.id);
    if (pg) {
      // A entrega do balcão repete o pagamento já registrado: conta uma vez só por payment_id.
      if (pg.id && vistos.has(pg.id)) continue;
      if (pg.id) vistos.add(pg.id);
      let cobrado = 0;
      for (const f of pg.methods) {
        const v = Number(f.amount) || 0;
        if (!v) continue;
        r.totals_by_method[f.method] = r2((r.totals_by_method[f.method] || 0) + v);
        if (f.method === 'COURTESY') { r.courtesy_total = r2((r.courtesy_total || 0) + v); continue; }
        cobrado += v;
        if (f.method === 'CASH') r.expected_cash = r2(r.expected_cash + v);
        if ((f.method === 'CREDIT' || f.method === 'DEBIT') && f.brand) {
          r.totals_by_brand[f.brand] = r2((r.totals_by_brand[f.brand] || 0) + v);
          if (r.totals_by_card) r.totals_by_card[`${f.method}|${f.brand}`] = r2((r.totals_by_card[`${f.method}|${f.brand}`] || 0) + v);
        }
      }
      if (cobrado > 0) {
        r.payments_count = (r.payments_count || 0) + 1;
        r.payments_total = r2((r.payments_total || 0) + cobrado);
      }
      pendentes++;
      continue;
    }
    if (a.type === 'register_cash_movement') {
      const p = (a.payload ?? {}) as { p_shift_id?: string; p_type?: string; p_amount?: number };
      if (p.p_shift_id !== shift.id) continue;
      const v = Number(p.p_amount) || 0;
      if (p.p_type === 'sangria') { r.total_sangria = r2(r.total_sangria + v); r.expected_cash = r2(r.expected_cash - v); }
      if (p.p_type === 'suprimento') { r.total_suprimento = r2(r.total_suprimento + v); r.expected_cash = r2(r.expected_cash + v); }
      pendentes++;
    }
  }
  return { ...r, semServidor: true, pendentesNaFila: pendentes };
}
