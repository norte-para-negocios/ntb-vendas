// lib/baixaEstoqueRetry.ts — job do servidor para a baixa de estoque (instrumentation.ts chama a cada 2 min).
// Três passos por ciclo, sempre com try/catch (um erro aqui nunca pode derrubar o PDV):
//   1. envios interrompidos (servidor caiu no meio): o que estava em voo vira "incerto" — nunca é reenviado sozinho;
//   2. varredura: pedidos entregues (depois do marco da migration 156) que o navegador não chegou a registrar;
//   3. reenvio: SÓ itens com erro comprovadamente não gravado, com backoff e no máximo MAX_TENTATIVAS vezes.
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { enviarFechamentos } from '@/lib/fechamentoFaturamento';
import {
  montarPayloadsPorPedido, registrarBaixa, registrarSemItens, carregarLinha, processarBaixa, tratarInterrompidas,
  MAX_TENTATIVAS, type LinhaBaixa,
} from '@/lib/baixaEstoqueServidor';

// Trava de ciclo (processo único, systemd no Contabo) + trava por linha no banco (iniciar_integracao_baixa_secure).
let cicloEmExecucao = false;

export interface ResumoCiclo { interrompidas: number; varridas: number; reenviadas: number; fechamentos?: number }

/**
 * `soLoja` (ou BAIXA_RETRY_SO_LOJA): restringe o ciclo a UMA loja. Existe para testar o job contra o banco compartilhado
 * sem tocar nas lojas reais.
 */
export async function ciclarBaixasDeEstoque(opts: { soLoja?: string } = {}): Promise<ResumoCiclo | null> {
  const soLoja = opts.soLoja || process.env.BAIXA_RETRY_SO_LOJA || null;
  if (cicloEmExecucao) { console.warn('Baixa de estoque: ciclo anterior ainda rodando, pulando este.'); return null; }
  cicloEmExecucao = true;
  const resumo: ResumoCiclo = { interrompidas: 0, varridas: 0, reenviadas: 0 };
  try {
    const admin = getSupabaseAdmin();

    try { resumo.interrompidas = await tratarInterrompidas(admin, soLoja); }
    catch (e) { console.error('Baixa de estoque: erro ao tratar envios interrompidos:', e); }

    try { resumo.varridas = await varrerPedidosSemBaixa(admin, soLoja); }
    catch (e) { console.error('Baixa de estoque: erro na varredura de pedidos:', e); }

    try {
      const { data } = await admin.rpc('listar_integracao_baixas_prontas_secure', { p_limite: 20, p_max_tentativas: MAX_TENTATIVAS, p_store_id: soLoja });
      for (const linha of (data ?? []) as LinhaBaixa[]) {
        try {
          const r = await processarBaixa(admin, linha);
          if (r.processada) resumo.reenviadas++;
        } catch (e) { console.error(`Baixa de estoque: erro ao reenviar a baixa ${linha.id}:`, e); }
      }
    } catch (e) { console.error('Baixa de estoque: erro ao listar baixas para reenvio:', e); }

    // Lojas de estoque próprio: reenvia ao Estoque a venda fechada que ainda não foi confirmada (faturamento e lucro).
    try { resumo.fechamentos = await reenviarFechamentosPendentes(admin, soLoja); }
    catch (e) { console.error('Fechamento de venda: erro ao reenviar pendentes:', e); }
  } finally {
    cicloEmExecucao = false;
  }
  if (resumo.interrompidas || resumo.varridas || resumo.reenviadas || resumo.fechamentos) console.log('Baixa de estoque, ciclo:', JSON.stringify(resumo));
  return resumo;
}

async function varrerPedidosSemBaixa(admin: ReturnType<typeof getSupabaseAdmin>, soLoja: string | null): Promise<number> {
  const { data } = await admin.rpc('listar_pedidos_sem_baixa_secure', { p_limite: 10, p_store_id: soLoja });
  const achados = (data ?? []) as { order_id: string; store_id: string }[];
  const porLoja = new Map<string, string[]>();
  for (const a of achados) porLoja.set(a.store_id, [...(porLoja.get(a.store_id) ?? []), a.order_id]);
  let n = 0;
  for (const [storeId, ids] of porLoja) {
    const { data: pedidos } = await admin.from('orders').select('id, payment_details').in('id', ids);
    const payloads = await montarPayloadsPorPedido(admin, storeId, (pedidos ?? []) as { id: string; payment_details: Record<string, unknown> | null }[]);
    for (const id of ids) {
      const montado = payloads.get(id);
      if (!montado) continue;
      if (!montado.payload.itens.length) { await registrarSemItens(admin, storeId, id, montado.rotulo, montado.payload); continue; }
      const reg = await registrarBaixa(admin, storeId, id, montado.rotulo, montado.payload);
      if (!reg.criada) continue;
      const linha = await carregarLinha(admin, reg.id, storeId);
      if (linha) { await processarBaixa(admin, linha); n++; }
    }
  }
  return n;
}

/** Pedidos entregues das lojas 'proprio' (últimas 48 h) sem a confirmação do Estoque: reenvia. Nunca mexe em loja Omie ou sem estoque. */
async function reenviarFechamentosPendentes(admin: ReturnType<typeof getSupabaseAdmin>, soLoja: string | null): Promise<number> {
  let lojas = admin.from('stores').select('id').eq('stock_mode', 'proprio').eq('is_active', true);
  if (soLoja) lojas = lojas.eq('id', soLoja);
  const { data: proprias } = await lojas;
  let n = 0;
  for (const loja of (proprias ?? []) as { id: string }[]) {
    const { data: pedidos } = await admin.from('orders').select('id')
      .eq('store_id', loja.id).eq('status', 'delivered').gt('total', 0)
      .is('payment_details->>faturamento_enviado_em', null)
      .lt('updated_at', new Date(Date.now() - 2 * 60 * 1000).toISOString())
      .gt('updated_at', new Date(Date.now() - 48 * 3600 * 1000).toISOString())
      .order('updated_at').limit(20);
    const ids = (pedidos ?? []).map((p: { id: string }) => p.id);
    if (!ids.length) continue;
    n += (await enviarFechamentos(admin, loja.id, ids)).enviados;
  }
  return n;
}
