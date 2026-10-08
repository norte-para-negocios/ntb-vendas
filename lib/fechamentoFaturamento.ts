// lib/fechamentoFaturamento.ts — envia ao Norte Estoque a venda fechada (itens, pagamentos, nota) das lojas em modo
// 'proprio', para o Estoque montar faturamento e lucro sem o Omie. Servidor apenas (service role).
// Parte pura (montarFechamento) é testada em scripts/testes/fechamentoFaturamento.test.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveServiceFeeRate } from './calc';

export interface PedidoFechamento {
  id: string; order_type: string | null; customer_name: string | null; created_at: string; updated_at: string;
  payment_details: Record<string, unknown> | null; mesa: string | number | null;
  /** Cupom de desconto do pedido (orders.coupon_discount, migration 143). */
  coupon_discount?: number | string | null;
}
export interface ItemFechamento {
  quantity: number; status: string; price_at_time: number; notes?: string | null;
  /** Snapshot das opções escolhidas: o código de cada uma é componente da baixa (pizza meio a meio, variação, borda). */
  selected_options?: { omie_codigo?: string | null }[] | null;
  product: { name: string; omie_codigo: string | null; ncm: string | null; fee_type: string | null } | null;
}
export interface NotaFechamento { chave_acesso: string | null; numero: number | null; serie: number | null; status: string; created_at: string }
export interface TaxaAutomatica { codigo: string; nome: string; percentual: number }

export interface PayloadFechamento {
  pedidoRef: string; data: string; hora: string; tipo: 'mesa' | 'balcao'; mesa: string | null; cancelado: boolean;
  valor: number; desconto: number; taxa: number; /** Cortesia (já descontada dos itens e da taxa; 08/10/2026). */ cortesia?: number; operador: string | null;
  nota: { chave: string | null; numero: number | null; serie: number | null; status: string | null } | null;
  itens: { linha: number; codigo: string; nome: string; quantidade: number; valorUnitario: number; desconto: number; valor: number; ncm: string | null; componentes?: string[] }[];
  pagamentos: { sequencia: number; metodo: string; valor: number; bandeira: string | null }[];
}

const arred = (v: number) => Math.round(v * 100) / 100;

/** Data e hora de Brasília (America/Sao_Paulo) de um instante ISO. */
export function dataHoraBrasilia(iso: string): { data: string; hora: string } {
  const d = new Date(iso);
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const g = (t: string) => partes.find((p) => p.type === t)?.value ?? '00';
  return { data: `${g('year')}-${g('month')}-${g('day')}`, hora: `${g('hour')}:${g('minute')}:${g('second')}` };
}

export function montarFechamento(pedido: PedidoFechamento, itens: ItemFechamento[], notas: NotaFechamento[], taxaAutomatica: TaxaAutomatica | null = null): PayloadFechamento {
  const detalhes = pedido.payment_details ?? {};
  const nota = notas.filter((n) => n.status !== 'erro' && n.status !== 'cancelada').sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  // Data estável entre reenvios: emissão da nota, senão o pagamento, senão a criação do pedido (updated_at muda a cada marca do outbox).
  const instante = nota?.created_at ?? (typeof detalhes.pago_em === 'string' ? detalhes.pago_em : null) ?? pedido.created_at;
  const { data, hora } = dataHoraBrasilia(instante);

  const linhas = itens.filter((i) => i.status !== 'canceled');
  let subtotal = 0;
  let temTaxaLancada = false;
  const out: PayloadFechamento['itens'] = [];
  let seq = 0;
  for (const it of linhas) {
    seq++;
    const valor = arred(it.quantity * it.price_at_time);
    if (it.product?.fee_type) temTaxaLancada = true; else subtotal += valor;
    // Códigos das opções: o Estoque liga o custo de cada um (que baixou como produto próprio) a esta linha no Lucro.
    const componentes = [...new Set((Array.isArray(it.selected_options) ? it.selected_options : [])
      .map((o) => (o?.omie_codigo ?? '').trim()).filter(Boolean))];
    out.push({
      linha: seq, codigo: it.product?.omie_codigo ?? '', nome: it.product?.name ?? 'Produto não identificado', quantidade: it.quantity,
      valorUnitario: it.price_at_time, desconto: 0, valor, ncm: it.product?.ncm ?? null,
      ...(componentes.length ? { componentes } : {}),
    });
  }
  // Cupom de desconto: rateado nos itens que não são taxa, na proporção do valor (a última linha absorve o arredondamento).
  // Os relatórios do Estoque somam os itens, então o desconto tem que sair deles, não só do cabeçalho.
  const idxProdutos = out.map((_, idx) => idx).filter((idx) => !linhas[idx]?.product?.fee_type && out[idx].valor > 0);
  const desconto = arred(Math.min(Math.max(0, Number(pedido.coupon_discount) || 0), subtotal));
  if (desconto > 0 && subtotal > 0) {
    let restante = desconto;
    idxProdutos.forEach((idx, n) => {
      const l = out[idx];
      const d = n === idxProdutos.length - 1 ? arred(Math.min(restante, l.valor)) : arred(desconto * l.valor / subtotal);
      restante = arred(restante - d);
      l.desconto = d;
      l.valor = arred(l.valor - d);
    });
  }
  const base = arred(subtotal - desconto);

  let taxa = arred(out.filter((_, idx) => linhas[idx]?.product?.fee_type).reduce((s, l) => s + l.valor, 0));
  let idxTaxaAuto = -1;
  // Taxa de serviço automática (loja configurada para cobrar, sem a taxa lançada como item): entra como item, como na NFC-e.
  // Vale o que o cliente PAGOU: com o total do pagamento, taxa = total - itens (respeita "Tirar a taxa" e taxa editada;
  // teto de 30% contra lixo). Sem total gravado, usa o percentual.
  if (taxaAutomatica && !temTaxaLancada && base > 0) {
    // Vale o que foi PAGO (soma das formas, cortesia inclusa aqui; ela sai logo abaixo): payment_details.total às vezes
    // não inclui a taxa (achado 08/10/2026 no Sertão).
    const formasPg = Array.isArray(detalhes.methods) ? (detalhes.methods as { amount?: number }[]) : null;
    const pagoTotal = formasPg && formasPg.length > 0
      ? formasPg.reduce((s2, m) => s2 + (Number(m.amount) || 0), 0)
      : typeof detalhes.total === 'number' && Number.isFinite(detalhes.total) ? (detalhes.total as number) : null;
    const valorTaxa = pagoTotal != null
      ? arred(Math.max(0, Math.min(pagoTotal - base, base * 0.3)))
      : arred(base * taxaAutomatica.percentual / 100);
    if (valorTaxa > 0) {
      seq++;
      idxTaxaAuto = out.length;
      out.push({ linha: seq, codigo: taxaAutomatica.codigo, nome: taxaAutomatica.nome, quantidade: 1, valorUnitario: valorTaxa, desconto: 0, valor: valorTaxa, ncm: null });
      taxa = valorTaxa;
    }
  }

  const metodos = Array.isArray(detalhes.methods) ? (detalhes.methods as { method?: string; amount?: number; brand?: string | null }[]) : [];
  // Cortesia não é faturamento (08/10/2026): sai dos itens e da taxa na proporção do valor, como o cupom acima,
  // e não vai como pagamento. Venda 100% cortesia chega ao Estoque com valor 0 (a baixa de estoque continua pela OP).
  const cortesia = arred(metodos.filter((m) => m?.method === 'COURTESY').reduce((s2, m) => s2 + (Number(m.amount) || 0), 0));
  const totalAntes = arred(out.reduce((s2, l) => s2 + l.valor, 0));
  if (cortesia > 0 && totalAntes > 0) {
    const tirar = Math.min(cortesia, totalAntes);
    const idxComValor = out.map((_, idx) => idx).filter((idx) => out[idx].valor > 0);
    let restante = tirar;
    idxComValor.forEach((idx, n) => {
      const l = out[idx];
      const d = n === idxComValor.length - 1 ? arred(Math.min(restante, l.valor)) : arred(tirar * l.valor / totalAntes);
      restante = arred(restante - d);
      l.desconto = arred(l.desconto + d);
      l.valor = arred(l.valor - d);
    });
    taxa = arred(out.filter((_, idx) => linhas[idx]?.product?.fee_type || idx === idxTaxaAuto).reduce((s2, l) => s2 + l.valor, 0));
  }
  const pagamentos = metodos.filter((m) => m && Number(m.amount) > 0 && m.method !== 'COURTESY').map((m, i) => ({
    sequencia: i + 1, metodo: String(m.method ?? 'OUTRO'), valor: arred(Number(m.amount)), bandeira: m.brand ?? null,
  }));

  return {
    pedidoRef: pedido.id, data, hora, tipo: pedido.order_type === 'counter' || pedido.mesa == null ? 'balcao' : 'mesa',
    mesa: pedido.mesa != null ? String(pedido.mesa) : null, cancelado: false,
    valor: arred(out.reduce((s, l) => s + l.valor, 0)), desconto: arred(desconto + cortesia), taxa, cortesia,
    operador: typeof detalhes.operador_nome === 'string' ? detalhes.operador_nome : null,
    nota: nota ? { chave: nota.chave_acesso, numero: nota.numero, serie: nota.serie, status: nota.status } : null,
    itens: out, pagamentos,
  };
}

async function marcarEnviado(admin: SupabaseClient, orderId: string) {
  // Relê o pedido logo antes de gravar para não pisar numa marca gravada em paralelo (ex.: op_enviada_em).
  const { data } = await admin.from('orders').select('payment_details').eq('id', orderId).maybeSingle();
  const pd = (data?.payment_details ?? {}) as Record<string, unknown>;
  if (pd.faturamento_enviado_em) return;
  await admin.from('orders').update({ payment_details: { ...pd, faturamento_enviado_em: new Date().toISOString() } }).eq('id', orderId);
}

/** Envia o fechamento de cada pedido ao Estoque. Nunca lança; quem não confirmar fica sem a marca e o job reenvia. */
export async function enviarFechamentos(admin: SupabaseClient, storeId: string, orderIds: string[], opts: { reenviar?: boolean } = {}): Promise<{ enviados: number; falhas: number }> {
  if (!orderIds.length) return { enviados: 0, falhas: 0 };
  const { data: secret } = await admin.from('store_ntb_estoque_secrets').select('ntb_estoque_url, ntb_estoque_api_key, ativo').eq('store_id', storeId).maybeSingle();
  if (!secret?.ativo) return { enviados: 0, falhas: 0 };

  const [{ data: pedidos }, { data: itens }, { data: notas }, { data: loja }, { data: feeProduct }] = await Promise.all([
    admin.from('orders').select('id, order_type, customer_name, created_at, updated_at, payment_details, coupon_discount, table:tables(number)').in('id', orderIds),
    admin.from('order_items').select('order_id, quantity, status, price_at_time, notes, selected_options, product:products(name, omie_codigo, ncm, fee_type)').in('order_id', orderIds),
    admin.from('fiscal_notas').select('order_id, chave_acesso, numero, serie, status, created_at').in('order_id', orderIds),
    admin.from('stores').select('config').eq('id', storeId).maybeSingle(),
    admin.from('products').select('name, omie_codigo, fee_percent').eq('store_id', storeId).eq('fee_type', 'percent').maybeSingle(),
  ]);
  const cobraTaxa = !!(loja?.config as { charge_service_fee?: boolean } | null)?.charge_service_fee;
  // Loja que cobra a taxa mas não tem o produto "Taxa de Serviço" cadastrado: a taxa entra mesmo assim (sem código),
  // com o percentual da loja. Antes ela sumia do faturamento, embora o cliente tivesse pago.
  const taxaAuto: TaxaAutomatica | null = cobraTaxa
    ? {
        codigo: feeProduct?.omie_codigo ?? '',
        nome: feeProduct?.name ?? 'Taxa de Serviço',
        percentual: feeProduct?.fee_percent != null ? Number(feeProduct.fee_percent) : resolveServiceFeeRate(loja?.config as Parameters<typeof resolveServiceFeeRate>[0]) * 100,
      }
    : null;

  let enviados = 0, falhas = 0;
  for (const p of (pedidos ?? []) as unknown as (Omit<PedidoFechamento, 'mesa'> & { table: { number: number | string } | { number: number | string }[] | null })[]) {
    if (!opts.reenviar && (p.payment_details as Record<string, unknown> | null)?.faturamento_enviado_em) continue;
    const mesaRel = Array.isArray(p.table) ? p.table[0] : p.table;
    const doPedido = <T extends { order_id: string }>(lista: unknown) => ((lista ?? []) as T[]).filter((x) => x.order_id === p.id);
    const payload = montarFechamento({ ...p, mesa: mesaRel?.number ?? null }, doPedido<ItemFechamento & { order_id: string }>(itens),
      doPedido<NotaFechamento & { order_id: string }>(notas), taxaAuto);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const resp = await fetch(`${String(secret.ntb_estoque_url).replace(/\/$/, '')}/api/integracao/venda/fechamento`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret.ntb_estoque_api_key}` },
        body: JSON.stringify(payload), signal: ctrl.signal,
      });
      clearTimeout(t);
      const json = await resp.json().catch(() => null) as { ok?: boolean } | null;
      if (resp.ok && json?.ok) { await marcarEnviado(admin, p.id); enviados++; } else { falhas++; console.error('Fechamento de venda: Estoque recusou', resp.status, JSON.stringify(json)?.slice(0, 200)); }
    } catch (e) { falhas++; console.error('Fechamento de venda: falha ao enviar ao Estoque (o job reenvia):', e); }
  }
  return { enviados, falhas };
}
