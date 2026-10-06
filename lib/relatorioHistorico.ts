// Relatório de dias ANTERIORES à auditoria nova (staff_audit_log começou em 05/10/2026 22h17): remonta o que a equipe fez
// a partir das tabelas que já guardavam o autor — itens lançados (added_by_name), pagamentos (operador_nome), cancelamentos
// e estornos (cash_shift_audit_events), turnos de caixa e ponto. Só leitura; nada é gravado.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventoAuditoria } from '@/lib/relatorioAuditoria';

export const PRIMEIRO_DIA_COM_AUDITORIA = '2026-10-06';

const BRL = (v: unknown) => `R$ ${Number(v ?? 0).toFixed(2).replace('.', ',')}`;
const METODO: Record<string, string> = { CASH: 'dinheiro', DEBIT: 'débito', CREDIT: 'crédito', PIX: 'Pix', MULTIPLE: 'mais de uma forma' };
const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase();

// As notas do item vêm como "[Cliente] observação": o prefixo entre colchetes é quem pediu (não é observação).
function obsDe(notes: string | null | undefined): string {
  const m = String(notes || '').match(/^\s*(?:\[([^\]]*)\])?\s*([\s\S]*)$/);
  const obs = (m?.[2] || '').trim();
  return obs ? ` — obs: ${obs.slice(0, 80)}` : '';
}

export async function eventosHistoricos(admin: SupabaseClient, storeId: string, dia: string): Promise<EventoAuditoria[]> {
  const de = `${dia}T00:00:00-03:00`;
  const ate = new Date(new Date(de).getTime() + 24 * 3600 * 1000).toISOString();
  const ev: EventoAuditoria[] = [];
  let seq = 0;
  const push = (o: Partial<EventoAuditoria> & { occurred_at: string; action: string; summary: string; nome?: string | null; uid?: string | null; papel?: string | null }) =>
    ev.push({ id: --seq, store_id: storeId, actor_user_id: o.uid ?? null, actor_name: o.nome || '(sem login)', actor_role: o.papel ?? null, entity: null, entity_id: null, details: {}, origin: 'app', ...o } as EventoAuditoria);

  const { data: equipe } = await admin.from('store_users').select('id, name, role').eq('store_id', storeId);
  const porNome = new Map((equipe || []).map((u: any) => [norm(u.name), u]));
  const porId = new Map((equipe || []).map((u: any) => [u.id, u]));
  const ator = (nome?: string | null, uid?: string | null) => {
    const u: any = (uid && porId.get(uid)) || (nome && porNome.get(norm(nome)));
    return u ? { nome: u.name, uid: u.id, papel: u.role } : { nome: nome || null, uid: null, papel: null };
  };

  // mesas dos pedidos do dia
  const { data: itens } = await admin.from('order_items').select('id, order_id, product_id, quantity, notes, created_at, added_by_name, added_by_role, status, products(name)').eq('store_id', storeId).gte('created_at', de).lt('created_at', ate).order('created_at').limit(5000);
  const orderIds = [...new Set((itens || []).map((i: any) => i.order_id))];
  const pedidos: Record<string, { table_id: string | null; order_type: string | null; customer_name: string | null }> = {};
  const mesas: Record<string, number | string> = {};
  const carregaPedidos = async (ids: string[]) => {
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await admin.from('orders').select('id, table_id, order_type, customer_name').in('id', ids.slice(i, i + 200));
      for (const o of data || []) pedidos[o.id] = { table_id: o.table_id, order_type: o.order_type, customer_name: o.customer_name };
    }
  };
  await carregaPedidos(orderIds as string[]);

  const { data: pagos } = await admin.from('orders').select('id, table_id, order_type, customer_name, total, status, payment_method, payment_details, updated_at').eq('store_id', storeId).eq('status', 'delivered').not('payment_details', 'is', null).gte('updated_at', de).lt('updated_at', ate).order('updated_at').limit(3000);
  for (const o of pagos || []) pedidos[o.id] = pedidos[o.id] || { table_id: o.table_id, order_type: o.order_type, customer_name: o.customer_name };
  const tIds = [...new Set(Object.values(pedidos).map((p) => p.table_id).filter(Boolean))] as string[];
  for (let i = 0; i < tIds.length; i += 200) {
    const { data } = await admin.from('tables').select('id, number').in('id', tIds.slice(i, i + 200));
    for (const t of data || []) mesas[t.id] = t.number;
  }
  const onde = (orderId: string) => {
    const p = pedidos[orderId]; if (!p) return '';
    if (p.table_id && mesas[p.table_id] != null) return ` (mesa ${mesas[p.table_id]})`;
    return p.order_type === 'counter' ? ` (balcão${p.customer_name ? ` — ${p.customer_name}` : ''})` : '';
  };

  for (const i of itens || []) {
    const cliente = i.added_by_role === 'cliente';
    const a = cliente ? { nome: null, uid: null, papel: null } : ator(i.added_by_name);
    const prod = (i as any).products?.name || 'item';
    push({ occurred_at: i.created_at, action: 'order_items.insert', summary: `Lançou ${i.quantity}x ${prod}${onde(i.order_id)}${obsDe(i.notes)}${cliente ? ' (pedido feito pelo cliente no QR)' : ''}`, ...a });
  }

  // pagamentos: uma linha por pagamento (a mesma venda se repete em vários pedidos da mesa)
  const vistos = new Set<string>();
  for (const o of pagos || []) {
    const pd: any = o.payment_details || {};
    const chave = `${pd.payment_id || ''}|${o.table_id || o.id}|${pd.total}|${String(o.updated_at).slice(0, 19)}`;
    if (vistos.has(chave)) continue; vistos.add(chave);
    const ms = Array.isArray(pd.methods) ? pd.methods.map((m: any) => `${BRL(m.amount)} em ${METODO[m.method] || m.method}${m.brand ? ` ${m.brand}` : ''}`).join(' + ') : (METODO[o.payment_method] || o.payment_method || '');
    push({ occurred_at: o.updated_at, action: 'orders.update', summary: `Registrou pagamento${onde(o.id)}: ${BRL(pd.total ?? o.total)}${ms ? ` (${ms})` : ''}`, ...ator(pd.operador_nome, pd.operador_id) });
  }

  // cancelamentos, estornos, transferências, taxas
  const { data: aud } = await admin.from('cash_shift_audit_events').select('*').eq('store_id', storeId).gte('created_at', de).lt('created_at', ate).order('created_at');
  for (const e of aud || []) {
    const d: any = e.details || {};
    const a = ator(e.operator_name, e.operator_user_id);
    const mesa = d.mesa ?? d.table_number ?? d.mesa_numero;
    const onde2 = mesa != null ? ` (mesa ${mesa})` : '';
    const motivo = d.motivo ? ` — motivo: ${d.motivo}` : '';
    const base = { occurred_at: e.created_at, ...a };
    if (e.event_type === 'item_cancelado') push({ ...base, action: 'order_items.update', summary: `CANCELOU item ${d.produto ?? ''}${d.quantidade ? ` (${d.quantidade}x)` : ''}${onde2}${d.valor != null ? ` — ${BRL(d.valor)}` : ''}${motivo}` });
    else if (e.event_type === 'pagamento_estornado') push({ ...base, action: 'orders.update', summary: `ESTORNOU pagamento${onde2}${d.valor != null ? ` de ${BRL(d.valor)}` : ''}${motivo}` });
    else if (e.event_type === 'item_transferido') push({ ...base, action: 'order_items.update', summary: `MUDOU item ${d.produto ?? ''} de mesa${d.de != null ? ` (de ${d.de} para ${d.para})` : ''}${motivo}` });
    else if (e.event_type === 'taxa_editada' || e.event_type === 'taxa_removida') push({ ...base, action: 'order_items.update', summary: `${e.event_type === 'taxa_removida' ? 'REMOVEU' : 'Alterou'} taxa${onde2}${d.valor != null ? `: ${BRL(d.valor)}` : ''}${motivo}` });
    else if (e.event_type === 'nota_cancelada') push({ ...base, action: 'fiscal_notas.update', summary: `CANCELOU nota fiscal${motivo}` });
    else push({ ...base, action: `cash_shifts.${e.event_type}`, summary: `${String(e.event_type).replace(/_/g, ' ')}${motivo}` });
  }

  // turnos de caixa
  const { data: turnos } = await admin.from('cash_shifts').select('opened_at, closed_at, operator_user_id, opening_float, closing_counted_cash').eq('store_id', storeId).or(`and(opened_at.gte.${de},opened_at.lt.${ate}),and(closed_at.gte.${de},closed_at.lt.${ate})`);
  for (const t of turnos || []) {
    const a = ator(null, t.operator_user_id);
    if (t.opened_at >= de && t.opened_at < ate) push({ occurred_at: t.opened_at, action: 'cash_shifts.insert', summary: `ABRIU turno de caixa (fundo ${BRL(t.opening_float)})`, ...a });
    if (t.closed_at && t.closed_at >= de && t.closed_at < ate) push({ occurred_at: t.closed_at, action: 'cash_shifts.update', summary: `FECHOU turno de caixa${t.closing_counted_cash != null ? ` (contado ${BRL(t.closing_counted_cash)})` : ''}`, ...a });
  }

  // ponto
  const { data: pontos } = await admin.from('operator_checkins').select('user_id, user_name, checkin_at, checkout_at').eq('store_id', storeId).or(`and(checkin_at.gte.${de},checkin_at.lt.${ate}),and(checkout_at.gte.${de},checkout_at.lt.${ate})`);
  for (const p of pontos || []) {
    const a = ator(p.user_name, p.user_id);
    if (p.checkin_at >= de && p.checkin_at < ate) push({ occurred_at: p.checkin_at, action: 'operator_checkins.insert', summary: 'Bateu ponto de ENTRADA', ...a });
    if (p.checkout_at && p.checkout_at >= de && p.checkout_at < ate) push({ occurred_at: p.checkout_at, action: 'operator_checkins.update', summary: 'Bateu ponto de SAÍDA', ...a });
  }

  // notas fiscais emitidas (o sistema emite sozinho ao receber o pagamento)
  const { data: notas } = await admin.from('fiscal_notas').select('numero, modelo, status, valor_total, created_at').eq('store_id', storeId).gte('created_at', de).lt('created_at', ate).order('created_at');
  for (const n of notas || []) push({ occurred_at: n.created_at, action: 'fiscal_notas.insert', summary: `Nota fiscal emitida: ${n.modelo === '65' ? 'NFC-e' : 'NF-e'} nº ${n.numero ?? ''} (${n.status}) ${BRL(n.valor_total)}` });

  return ev;
}
