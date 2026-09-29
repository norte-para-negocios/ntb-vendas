import type { SupabaseClient } from '@supabase/supabase-js';

// Quando a nota fiscal da venda inteira é cancelada, a venda deixa de existir: sai do
// histórico, o dinheiro recebido sai do caixa e o estoque volta (pedido do dono,
// 2026-09-29). Espelha o estorno de pagamento do balcão (app/api/orders/pagamento-balcao):
// auditoria ANTES da alteração, falha fechada, caixa já fechado é decisão do supervisor.

export type ResultadoEstorno = {
  estornada: boolean;
  motivo?: string;
  estoque?: { ok: boolean; ajustesExcluidos?: number; opsExcluidas?: number; falhas?: number; erro?: string } | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function estornarVendaDaNota(
  admin: SupabaseClient,
  p: { storeId: string; orderId: string; notaId: string; justificativa: string },
): Promise<ResultadoEstorno> {
  const { data: pedido } = await admin
    .from('orders')
    .select('id, status, payment_details')
    .eq('id', p.orderId)
    .eq('store_id', p.storeId)
    .maybeSingle();
  if (!pedido) return { estornada: false, motivo: 'pedido não encontrado nesta loja' };
  if (pedido.status === 'canceled') return { estornada: false, motivo: 'pedido já cancelado' };

  const detalhes = pedido.payment_details as Record<string, any> | null;
  if (!detalhes || !Array.isArray(detalhes.methods)) return { estornada: false, motivo: 'pedido sem pagamento registrado' };

  // O esperado do turno é recalculado ao vivo (inclusive de turno fechado): estornar
  // dinheiro de um caixa já conferido faria aparecer uma sobra que nunca existiu.
  const turnoId = typeof detalhes.cash_shift_id === 'string' && UUID.test(detalhes.cash_shift_id) ? detalhes.cash_shift_id : null;
  if (turnoId) {
    const { data: turno } = await admin.from('cash_shifts').select('id, status').eq('id', turnoId).maybeSingle();
    if (turno?.status === 'closed') return { estornada: false, motivo: 'caixa já fechado — o ajuste é do supervisor' };
  }

  const { data: evento, error: erroEvento } = await admin
    .from('cash_shift_audit_events')
    .insert({
      store_id: p.storeId,
      shift_id: turnoId,
      operator_user_id: null,
      operator_name: 'Sistema (cancelamento de nota)',
      event_type: 'pagamento_estornado',
      details: {
        order_id: p.orderId,
        valor: Number.isFinite(detalhes.total) ? detalhes.total : null,
        methods: detalhes.methods,
        cash_shift_id: turnoId,
        nota_fiscal_cancelada_id: p.notaId,
        motivo: p.justificativa,
      },
    })
    .select('id')
    .single();
  if (erroEvento) return { estornada: false, motivo: 'não consegui registrar a auditoria do estorno' };

  // Guarda `delivered` + `methods` presente: nunca estorna duas vezes nem pedido em outro estado.
  const { data: estornado, error: erroUpdate } = await admin
    .from('orders')
    .update({
      status: 'canceled',
      payment_method: null,
      payment_details: { estornado_por_cancelamento_de_nota: detalhes, estornado_em: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq('id', p.orderId)
    .eq('store_id', p.storeId)
    .eq('status', 'delivered')
    .not('payment_details', 'is', null)
    .select('id')
    .maybeSingle();
  if (erroUpdate) {
    // Resultado incerto: o evento FICA, marcado, pra quem auditar conferir o pedido.
    await admin.from('cash_shift_audit_events').update({ details: { order_id: p.orderId, resultado: 'incerto' } }).eq('id', evento.id);
    return { estornada: false, motivo: 'não deu pra confirmar o estorno — confira o pedido' };
  }
  if (!estornado) {
    await admin.from('cash_shift_audit_events').delete().eq('id', evento.id);
    return { estornada: false, motivo: 'o pedido mudou de estado — nada foi estornado' };
  }

  await admin.from('order_items').update({ status: 'canceled' }).eq('order_id', p.orderId);

  // Estoque/Omie: exclui as saídas (e ordens de produção) geradas por esta venda.
  let estoque: ResultadoEstorno['estoque'] = null;
  try {
    const { data: segredo } = await admin
      .from('store_ntb_estoque_secrets')
      .select('ntb_estoque_url, ntb_estoque_api_key, ativo')
      .eq('store_id', p.storeId)
      .maybeSingle();
    if (segredo?.ativo) {
      const r = await fetch(`${String(segredo.ntb_estoque_url).replace(/\/$/, '')}/api/integracao/venda/estornar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${segredo.ntb_estoque_api_key}` },
        body: JSON.stringify({ pedidoRef: p.orderId }),
        signal: AbortSignal.timeout(45000),
      });
      const j = await r.json().catch(() => null);
      estoque = r.ok && j?.ok !== false ? { ok: true, ...(j ?? {}) } : { ok: false, erro: j?.reason ?? j?.error ?? `HTTP ${r.status}` };
    }
  } catch (e) {
    estoque = { ok: false, erro: e instanceof Error ? e.message : 'falha ao falar com o estoque' };
  }
  return { estornada: true, estoque };
}
