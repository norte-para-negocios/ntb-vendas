// lib/baixaEstoqueServidor.ts — lado servidor do outbox da baixa de estoque (service role; nunca importar do browser).
// Regras puras em lib/baixaEstoque.ts; tabela/funções na migration 156.
import type { SupabaseClient } from '@supabase/supabase-js';
import { setorDoItem, localEstoqueDoItem } from '@/lib/setores';
import {
  indicesParaReenviar, interpretarResposta, resultadoDeFalhaDeRede, mesclarResultados, statusDaBaixa, proximaTentativa,
  resumoDoErro, marcarIncertosComoConferidos, marcarEnvioInterrompido, MAX_TENTATIVAS,
  type ItemBaixa, type ResultadoItem, type StatusBaixa,
} from '@/lib/baixaEstoque';

export interface PayloadBaixa { itens: ItemBaixa[]; pedidoRef: string; ambiente: 'homologacao' | 'producao' | null }

export interface LinhaBaixa {
  id: string; store_id: string; order_id: string; rotulo: string | null; status: StatusBaixa; tentativas: number;
  ultimo_erro: string | null; payload: PayloadBaixa; resultado: (ResultadoItem | null)[]; enviando: number[];
}

export interface PedidoParaBaixa { id: string; payment_details: Record<string, unknown> | null }

/** Tempo máximo esperando o Estoque (ele faz várias chamadas ao Omie por item). Estourou = resultado incerto. */
const timeoutMs = () => Number(process.env.BAIXA_ESTOQUE_TIMEOUT_MS) || 150000;

// ---------------------------------------------------------------------------------------------- montar itens
// Itens de CADA pedido (um pedido = uma baixa, para o registro e o reenvio poderem ser por pedido). Mesma regra
// que a rota usava para o conjunto: código do produto + dos adicionais, destino/setor/local, nota fiscal, taxa
// automática (só quando o pedido não tem a taxa lançada).
export async function montarPayloadsPorPedido(
  admin: SupabaseClient,
  storeId: string,
  pedidos: PedidoParaBaixa[],
): Promise<Map<string, { payload: PayloadBaixa; rotulo: string }>> {
  const ids = pedidos.map((p) => p.id);
  const detalhes = new Map(pedidos.map((p) => [p.id, p.payment_details]));

  const { data: items } = await admin
    .from('order_items')
    .select('order_id, quantity, status, price_at_time, selected_options, product:products(omie_codigo, destination, sector_id, category_id, ignore_category_sector, fee_type)')
    .in('order_id', ids);

  // Regra do dono (30/09): PDV só quando a venda gera nota; sem nota é baixa comum.
  const { data: notas } = await admin.from('fiscal_notas').select('order_id, status').in('order_id', ids);
  const temNota = new Set((notas ?? []).filter((n: { status: string }) => n.status !== 'erro' && n.status !== 'cancelada').map((n: { order_id: string }) => n.order_id));
  const comNotaDoPedido = (orderId: string) => {
    const marca = detalhes.get(orderId)?.emitir_nota;
    return typeof marca === 'boolean' ? marca : temNota.has(orderId);
  };

  const [{ data: setores }, { data: categorias }, { data: locaisEstoque }] = await Promise.all([
    admin.from('print_sectors').select('id, name').eq('store_id', storeId),
    admin.from('categories').select('id, sector_id').eq('store_id', storeId),
    admin.from('store_estoque_locais').select('destino, omie_local_codigo').eq('store_id', storeId),
  ]);
  const mapaLocais: Record<string, number> = Object.fromEntries((locaisEstoque ?? []).map((l: { destino: string; omie_local_codigo: number }) => [l.destino, Number(l.omie_local_codigo)]));
  const nomeSetor = new Map((setores ?? []).map((x: { id: string; name: string }) => [x.id, x.name]));
  const catSetor: Record<string, string | null> = Object.fromEntries((categorias ?? []).map((c: { id: string; sector_id: string | null }) => [c.id, c.sector_id]));

  // Taxa de serviço automática (2026-10-03): quando charge_service_fee=true e o produto de taxa percentual tem omie_codigo
  // e o pedido NÃO tem a taxa lançada, inclui a taxa. (Regra inalterada neste trabalho.)
  const [{ data: storeRow }, { data: feeProduct }] = await Promise.all([
    admin.from('stores').select('config').eq('id', storeId).maybeSingle(),
    admin.from('products').select('id, omie_codigo, fee_percent').eq('store_id', storeId).eq('fee_type', 'percent').maybeSingle(),
  ]);
  const chargeServiceFee = !!(storeRow?.config as { charge_service_fee?: boolean } | null)?.charge_service_fee;
  const feePercent = feeProduct?.fee_percent != null ? Number(feeProduct.fee_percent) : 10;
  const feeOmieCodigo = feeProduct?.omie_codigo ?? null;

  type Linha = { order_id: string; quantity: number; status: string; price_at_time: number; selected_options: { omie_codigo?: string | null }[] | null;
    product: { omie_codigo: string | null; destination: 'kitchen' | 'bar' | null; sector_id?: string | null; category_id?: string | null; ignore_category_sector?: boolean; fee_type?: string | null } | null };
  const todos = (items ?? []) as unknown as Linha[];

  // Rótulo (mesa/balcão) para a lista de baixas.
  const { data: pedidosInfo } = await admin.from('orders').select('id, order_type, customer_name, table:tables(number)').in('id', ids);
  const rotuloDe = new Map<string, string>();
  for (const o of (pedidosInfo ?? []) as unknown as { id: string; order_type: string; customer_name: string | null; table: { number: number | string } | { number: number | string }[] | null }[]) {
    const mesa = Array.isArray(o.table) ? o.table[0] : o.table;
    rotuloDe.set(o.id, o.order_type === 'counter' || !mesa ? `Balcão${o.customer_name ? ` · ${o.customer_name}` : ''}` : `Mesa ${mesa.number}`);
  }

  const { data: fiscalConfig } = await admin.from('store_fiscal_config').select('ambiente').eq('store_id', storeId).maybeSingle();
  const ambiente = (fiscalConfig?.ambiente ?? null) as PayloadBaixa['ambiente'];

  const out = new Map<string, { payload: PayloadBaixa; rotulo: string }>();
  for (const orderId of ids) {
    const linhas = todos.filter((l) => l.order_id === orderId);
    const comNota = comNotaDoPedido(orderId);
    const porCodigo = new Map<string, ItemBaixa>();
    const somar = (codigo: string, quantidade: number, destination: 'kitchen' | 'bar' | null, setor: string | null, localEstoque: number | null) => {
      const atual = porCodigo.get(codigo);
      porCodigo.set(codigo, { codigo, quantidade: (atual?.quantidade ?? 0) + quantidade, destination: atual?.destination ?? destination, setor: atual?.setor ?? setor, localEstoque: atual?.localEstoque ?? localEstoque, comNota });
    };
    let subtotal = 0;
    let temTaxaLancada = false;
    for (const item of linhas) {
      if (item.status === 'canceled') continue;
      const produto = item.product;
      if (produto?.fee_type) temTaxaLancada = true; else subtotal += item.quantity * item.price_at_time;

      // Taxa (rolha, frete, serviço...) baixa no estoque padrão da loja, não em Cozinha/Bar/Pizzaria (pedido do Ramon, 01/10).
      const ehTaxaItem = !!produto?.fee_type;
      const destination = ehTaxaItem ? null : (produto?.destination ?? null);
      const setorId = ehTaxaItem ? null : setorDoItem(produto, catSetor);
      const setor = setorId ? nomeSetor.get(setorId) ?? null : null;
      const localEstoque = localEstoqueDoItem(mapaLocais, setorId, destination);
      if (produto?.omie_codigo) somar(produto.omie_codigo, item.quantity, destination, setor, localEstoque);
      // Adicional/opcional (borda de pizza, sabor) tem o próprio omie_codigo no snapshot e herda o destino do produto pai.
      for (const opcao of item.selected_options ?? []) {
        if (opcao.omie_codigo) somar(opcao.omie_codigo, item.quantity, destination, setor, localEstoque);
      }
    }
    if (chargeServiceFee && feeOmieCodigo && !temTaxaLancada && subtotal > 0) {
      const valorTaxa = Math.round(subtotal * feePercent / 100 * 100) / 100;
      if (valorTaxa > 0) somar(feeOmieCodigo, 1, null, null, null);
    }
    out.set(orderId, { payload: { itens: Array.from(porCodigo.values()), pedidoRef: orderId, ambiente }, rotulo: rotuloDe.get(orderId) ?? 'Pedido' });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- registrar
export async function registrarBaixa(admin: SupabaseClient, storeId: string, orderId: string, rotulo: string, payload: PayloadBaixa): Promise<{ id: string; criada: boolean; status: StatusBaixa }> {
  const { data, error } = await admin.rpc('registrar_integracao_baixa_secure', { p_store_id: storeId, p_order_id: orderId, p_rotulo: rotulo, p_payload: payload });
  if (error) throw new Error(`registrar baixa: ${error.message}`);
  return data as { id: string; criada: boolean; status: StatusBaixa };
}

/** Pedido sem nenhum item com código Omie: nada a baixar. Registra como ok para a varredura não revisitar. */
export async function registrarSemItens(admin: SupabaseClient, storeId: string, orderId: string, rotulo: string, payload: PayloadBaixa) {
  const r = await registrarBaixa(admin, storeId, orderId, rotulo, payload);
  if (r.criada) await salvar(admin, r.id, 'ok', [], 'Sem itens com código Omie vinculado', null, false);
  return r;
}

async function salvar(admin: SupabaseClient, id: string, status: StatusBaixa, resultado: (ResultadoItem | null)[], erro: string | null, proxima: Date | null, incrementa: boolean, zerar = false) {
  const { error } = await admin.rpc('salvar_resultado_integracao_baixa_secure', {
    p_id: id, p_status: status, p_resultado: resultado, p_erro: erro, p_proxima: proxima ? proxima.toISOString() : null, p_incrementa: incrementa, p_zerar: zerar,
  });
  if (error) throw new Error(`salvar resultado da baixa: ${error.message}`);
}

async function marcarPedidoEnviado(admin: SupabaseClient, orderId: string) {
  const { data } = await admin.from('orders').select('payment_details').eq('id', orderId).maybeSingle();
  const pd = (data?.payment_details ?? {}) as Record<string, unknown>;
  if (pd.op_enviada_em) return;
  await admin.from('orders').update({ payment_details: { ...pd, op_enviada_em: new Date().toISOString() } }).eq('id', orderId);
}

// ---------------------------------------------------------------------------------------------- enviar
export interface RespostaEnvio { status: number; json: unknown }
/** Uma chamada ao Estoque. Lança em falha de transporte (classificada por classificarErroDeRede). */
export async function chamarEstoque(url: string, chave: string, corpo: { itens: ItemBaixa[]; pedidoRef: string; ambiente: PayloadBaixa['ambiente'] }): Promise<RespostaEnvio> {
  const res = await fetch(`${url.replace(/\/$/, '')}/api/integracao/ordem-producao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(timeoutMs()),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

export interface ResumoProcessamento { id: string; status: StatusBaixa; processada: boolean; motivo?: string; enviados: number }

/**
 * Envia ao Estoque SÓ os itens que ainda não deram ok (e que são seguros de reenviar) e grava o resultado por item.
 * `manual` = o gerente apertou "Tentar de novo": zera o contador de tentativas automáticas.
 */
export async function processarBaixa(admin: SupabaseClient, linha: LinhaBaixa, opts: { manual?: boolean } = {}): Promise<ResumoProcessamento> {
  const itens = linha.payload.itens ?? [];
  const resultadoAtual = (linha.resultado ?? []) as (ResultadoItem | null)[];
  const indices = indicesParaReenviar(resultadoAtual, itens.length);
  if (!indices.length) return { id: linha.id, status: linha.status, processada: false, motivo: 'Nada a reenviar', enviados: 0 };

  const { data: claim } = await admin.rpc('iniciar_integracao_baixa_secure', { p_id: linha.id, p_enviando: indices });
  if (!claim) return { id: linha.id, status: linha.status, processada: false, motivo: 'Em processamento por outro envio', enviados: 0 };
  const tentativasLinha = (claim as LinhaBaixa).tentativas;

  const { data: secret } = await admin.from('store_ntb_estoque_secrets').select('ntb_estoque_url, ntb_estoque_api_key, ativo').eq('store_id', linha.store_id).maybeSingle();
  const enviados = indices.map((i) => itens[i]);
  const codigos = enviados.map((i) => i.codigo);
  const tentativaDoItem = (i: number) => (resultadoAtual[i]?.tentativas ?? 0) + 1;

  let novos: ResultadoItem[];
  if (!secret?.ativo || !secret.ntb_estoque_url || !secret.ntb_estoque_api_key) {
    novos = codigos.map((codigo, k) => ({
      codigo, status: 'erro' as const, retentavel: true, tentativas: tentativaDoItem(indices[k]),
      erro: !secret ? 'Loja sem integração com o Estoque configurada' : 'Integração com o Estoque desativada',
    }));
  } else {
    try {
      const r = await chamarEstoque(secret.ntb_estoque_url, secret.ntb_estoque_api_key, { itens: enviados, pedidoRef: linha.payload.pedidoRef, ambiente: linha.payload.ambiente });
      novos = interpretarResposta(r.status, r.json, codigos).map((n, k) => ({ ...n, tentativas: tentativaDoItem(indices[k]) }));
    } catch (e) {
      novos = resultadoDeFalhaDeRede(e, codigos).map((n, k) => ({ ...n, tentativas: tentativaDoItem(indices[k]) }));
    }
  }

  const resultado = mesclarResultados(resultadoAtual, indices, novos);
  const status = statusDaBaixa(resultado, itens.length);
  const tentativasDepois = opts.manual ? 1 : tentativasLinha + 1;
  const proxima = status === 'erro' || status === 'parcial' ? proximaTentativa(tentativasDepois) : null;
  await salvar(admin, linha.id, status, resultado, resumoDoErro(resultado) || null, proxima, true, !!opts.manual);
  if (status === 'ok') await marcarPedidoEnviado(admin, linha.order_id);
  return { id: linha.id, status, processada: true, enviados: indices.length };
}

export async function carregarLinha(admin: SupabaseClient, id: string, storeId: string): Promise<LinhaBaixa | null> {
  const { data } = await admin.from('integracao_baixas').select('*').eq('id', id).eq('store_id', storeId).maybeSingle();
  return (data as LinhaBaixa | null) ?? null;
}

/** O gerente conferiu no Estoque o que estava incerto. */
export async function conferirBaixa(admin: SupabaseClient, linha: LinhaBaixa, quem: string): Promise<StatusBaixa> {
  const resultado = marcarIncertosComoConferidos((linha.resultado ?? []) as (ResultadoItem | null)[], quem);
  const status = statusDaBaixa(resultado, linha.payload.itens?.length ?? 0);
  await salvar(admin, linha.id, status, resultado, resumoDoErro(resultado) || null, status === 'erro' || status === 'parcial' ? new Date() : null, false);
  if (status === 'ok') await marcarPedidoEnviado(admin, linha.order_id);
  return status;
}

/** Linhas que ficaram em voo quando o servidor caiu: o que estava sendo enviado vira incerto. */
export async function tratarInterrompidas(admin: SupabaseClient, soLoja: string | null = null): Promise<number> {
  const { data } = await admin.rpc('listar_integracao_baixas_interrompidas_secure', { p_store_id: soLoja });
  const linhas = (data ?? []) as LinhaBaixa[];
  for (const l of linhas) {
    const resultado = marcarEnvioInterrompido((l.resultado ?? []) as (ResultadoItem | null)[], l.enviando ?? [], l.payload.itens ?? []);
    await salvar(admin, l.id, statusDaBaixa(resultado, l.payload.itens?.length ?? 0), resultado, resumoDoErro(resultado) || null, null, false);
  }
  return linhas.length;
}

export { MAX_TENTATIVAS };
