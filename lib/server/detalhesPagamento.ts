// Validação de shape de orders.payment_details (extraída de app/api/orders/pagamento-balcao/route.ts para ser testável; rota Next
// não pode exportar outra coisa além dos handlers). Ver o comentário original na rota sobre o porquê da validação estrita.
import { PAYMENT_METHOD_LABELS, CARD_BRAND_LABELS, MAQUININHA_LABELS } from '@/lib/labels';

// Cap arbitrário mas generoso — só impede payload absurdo.
const MAX_METHODS = 20;

export function isValidPaymentDetails(
  details: unknown
): details is { total: number; methods: { method: string; amount: number; brand?: string | null; acquirer?: string | null }[]; emitir_nota?: boolean; cash_shift_id?: string } {
  if (!details || typeof details !== 'object') return false;
  const d = details as Record<string, unknown>;
  if (!Number.isFinite(d.total)) return false;
  if (!Array.isArray(d.methods)) return false;
  if (d.methods.length === 0 || d.methods.length > MAX_METHODS) return false;
  // Task 4 (2026-08-23): `emitir_nota`, quando presente, precisa ser
  // boolean de verdade — mesmo princípio de validação estrita de shape já
  // seguido no resto desta function (nunca confiar que o JSON que chegou
  // bate com o tipo TypeScript só porque o compilador achou bonito).
  if (d.emitir_nota !== undefined && typeof d.emitir_nota !== 'boolean') return false;
  // Task 2 (2026-08-23, plano frente-de-caixa, correção pós-revisão):
  // `cash_shift_id`, quando presente, precisa ser string — mesmo princípio
  // do `emitir_nota` acima. Sem esta checagem, o campo atravessava a
  // validação "de graça" (chaves desconhecidas não são rejeitadas aqui) e
  // qualquer shape (número, objeto, array) chegaria intacto até
  // `orders.payment_details`. Não valida formato UUID estrito — só o tipo,
  // suficiente pra impedir o shape errado de ser persistido.
  if (d.cash_shift_id !== undefined && typeof d.cash_shift_id !== 'string') return false;

  return d.methods.every((m) => {
    if (!m || typeof m !== 'object') return false;
    const method = m as Record<string, unknown>;
    if (typeof method.method !== 'string' || !(method.method in PAYMENT_METHOD_LABELS)) return false;
    if (!Number.isFinite(method.amount)) return false;
    if (method.brand !== undefined && method.brand !== null) {
      if (typeof method.brand !== 'string' || !(method.brand in CARD_BRAND_LABELS)) return false;
    }
    // Maquininha (migration 195): opcional, catálogo fechado, só em cartão de crédito/débito.
    if (method.acquirer !== undefined && method.acquirer !== null) {
      if (typeof method.acquirer !== 'string' || !Object.prototype.hasOwnProperty.call(MAQUININHA_LABELS, method.acquirer)) return false;
      if (method.method !== 'CREDIT' && method.method !== 'DEBIT') return false;
    }
    return true;
  });
}
