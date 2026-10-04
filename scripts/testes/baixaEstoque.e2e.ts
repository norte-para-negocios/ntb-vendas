// E2E do outbox da baixa de estoque contra o MOCK do Estoque (scripts/testes/mock-estoque.mjs) e a loja ZZ Laboratório.
// NUNCA toca em outra loja nem no Estoque/Omie reais: o job roda restrito à ZZ (soLoja) e a integração da ZZ aponta pro mock.
// Pré-requisitos (ver AGENTS.md): mock em :9191 e dev server em :3150 com
//   DISABLE_FISCAL_RETRANSMISSAO=1 DISABLE_BAIXA_RETRY=1 NTB_FRIO_API_URL= BAIXA_ESTOQUE_TIMEOUT_MS=3000
// rodar com: npx tsx --env-file=.env.local scripts/testes/baixaEstoque.e2e.ts
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { ciclarBaixasDeEstoque } from '../../lib/baixaEstoqueRetry';

const ZZ = 'f33b4310-ff0a-487c-a3b1-62acd0a58850';
const APP = 'http://localhost:3150';
const MOCK = 'http://localhost:9191';
const CHAVE = 'chave-mock-estoque';
process.env.BAIXA_ESTOQUE_TIMEOUT_MS = '3000';

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const mock = (path: string, body?: unknown) => fetch(`${MOCK}${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const regra = (codigo: string, tipo: string, vezes?: number) => mock('/__mock/regra', { codigo, tipo, vezes });
const chamadas = async () => (await mock('/__mock/log')) as { pedidoRef: string; itens: string[]; decisoes: string[] }[];
const rota = (orderId: string) => fetch(`${APP}/api/integracao/ordem-producao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId }) }).then((r) => r.json());
const ciclo = () => ciclarBaixasDeEstoque({ soLoja: ZZ });

const CODIGOS = ['T-OK', 'T-SEMEST', 'T-NOREG', 'T-NOREG2', 'T-500', 'T-HANG', 'T-OPERR', 'T-SEMLOCAL'];
const criados: string[] = [];
let produtos: Record<string, string> = {};
let falhas = 0;
let marcoSalvo: string | null = null;
const passo = (nome: string, ok: boolean, extra?: unknown) => { if (!ok) falhas++; console.log(`${ok ? 'OK  ' : 'FALHOU'} ${nome}${!ok && extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`); };

async function pedido(codigos: string[], opts: { minutosAtras?: number; mesa?: string | null } = {}): Promise<string> {
  const quando = new Date(Date.now() - (opts.minutosAtras ?? 0) * 60000).toISOString();
  const { data: o, error } = await admin.from('orders').insert({
    store_id: ZZ, table_id: opts.mesa ?? null, order_type: opts.mesa ? 'table' : 'counter', customer_name: opts.mesa ? null : 'Teste Outbox',
    status: 'delivered', total: 50, payment_details: { total: 50, emitir_nota: false }, created_at: quando, updated_at: quando,
  }).select('id').single();
  assert.ok(o, `pedido: ${error?.message}`);
  criados.push(o.id);
  const { error: e2 } = await admin.from('order_items').insert(codigos.map((c) => ({ order_id: o.id, store_id: ZZ, product_id: produtos[c], quantity: 1, price_at_time: 10, status: 'delivered', added_by_role: 'garcom' })));
  assert.ok(!e2, `itens: ${e2?.message}`);
  return o.id;
}
const linha = async (orderId: string) => (await admin.from('integracao_baixas').select('*').eq('order_id', orderId).maybeSingle()).data as any;
const enviada = async (orderId: string) => !!((await admin.from('orders').select('payment_details').eq('id', orderId).single()).data?.payment_details as any)?.op_enviada_em;
const adiantar = (orderId: string) => admin.from('integracao_baixas').update({ proxima_tentativa: new Date(Date.now() - 1000).toISOString() }).eq('order_id', orderId);
const secret = (url: string) => admin.from('store_ntb_estoque_secrets').upsert({ store_id: ZZ, ntb_estoque_url: url, ntb_estoque_api_key: CHAVE, ativo: true, updated_at: new Date().toISOString() }, { onConflict: 'store_id' });

async function main() {
  // ---------- preparação (tudo desfeito no finally)
  const { data: lojaProd } = await admin.from('products').select('id').eq('store_id', ZZ).is('fee_type', null).eq('available', true).is('omie_codigo', null).limit(CODIGOS.length);
  assert.ok(lojaProd && lojaProd.length >= CODIGOS.length, 'ZZ precisa de produtos sem código para o teste');
  produtos = Object.fromEntries(CODIGOS.map((c, i) => [c, lojaProd[i].id]));
  for (const c of CODIGOS) await admin.from('products').update({ omie_codigo: c }).eq('id', produtos[c]);
  const { data: antes } = await admin.from('store_ntb_estoque_secrets').select('*').eq('store_id', ZZ).maybeSingle();
  assert.equal(antes, null, 'ZZ já tinha integração: abortando para não sobrescrever');
  await secret(MOCK);
  await mock('/__mock/reset', {});
  const { data: marcoOriginal } = await admin.from('integracao_baixas_marco').select('desde').eq('id', 1).single();
  marcoSalvo = marcoOriginal!.desde;
  await admin.from('integracao_baixas_marco').update({ desde: new Date(Date.now() - 3 * 3600_000).toISOString() }).eq('id', 1);
  const { data: mesa } = await admin.from('tables').select('id, number').eq('store_id', ZZ).limit(1).single();

  // ---------- S1: tudo ok
  const s1 = await pedido(['T-OK', 'T-SEMEST'], { mesa: mesa!.id });
  const r1 = await rota(s1);
  const l1 = await linha(s1);
  passo('S1 pedido ok: linha ok, 2 itens ok, op_enviada_em gravado', l1?.status === 'ok' && l1.resultado.length === 2 && l1.resultado.every((x: any) => x.status === 'ok') && (await enviada(s1)) && r1.ok === true, { l1, r1 });
  passo('S1 rótulo da mesa', l1?.rotulo === `Mesa ${mesa!.number}`, l1?.rotulo);

  // ---------- S9: segunda chamada do mesmo pedido não reenvia nada
  const antesLog = (await chamadas()).length;
  const r9 = await rota(s1);
  passo('S9 repetir a rota para o mesmo pedido não chama o Estoque', (await chamadas()).length === antesLog && r9.skipped === true, r9);

  // ---------- S2: um item falha (sem cadastro), o outro ok -> parcial; o job reenvia SÓ o que falhou
  await regra('T-NOREG', 'pulada', 1);
  const s2 = await pedido(['T-OK', 'T-NOREG']);
  await rota(s2);
  const l2 = await linha(s2);
  passo('S2 parcial: T-OK ok, T-NOREG erro retentável, sem op_enviada_em', l2?.status === 'parcial' && l2.resultado[0].status === 'ok' && l2.resultado[1].status === 'erro' && l2.resultado[1].retentavel === true && !(await enviada(s2)), l2);
  await ciclo();
  passo('S2 backoff: ciclo imediato NÃO reenvia (proxima_tentativa no futuro)', (await linha(s2)).status === 'parcial' && (await chamadas()).filter((c) => c.pedidoRef === s2).length === 1);
  await adiantar(s2);
  await ciclo();
  const l2b = await linha(s2);
  const cs2 = (await chamadas()).filter((c) => c.pedidoRef === s2);
  passo('S2 job reenviou SÓ T-NOREG (T-OK não foi reenviado) e fechou ok', cs2.length === 2 && cs2[1].itens.join() === 'T-NOREG' && l2b.status === 'ok' && (await enviada(s2)), { cs2, l2b });

  // ---------- S3: 200 com todos os itens falhando
  await regra('T-NOREG', 'pulada'); await regra('T-NOREG2', 'pulada');
  const s3 = await pedido(['T-NOREG', 'T-NOREG2']);
  await rota(s3);
  const l3 = await linha(s3);
  passo('S3 200 com todos os itens falhando: status erro, NÃO marca enviado', l3?.status === 'erro' && !(await enviada(s3)) && /sem cadastro/i.test(l3.ultimo_erro ?? ''), l3);
  // tentativas automáticas esgotam: depois de MAX não reenvia mais
  await admin.from('integracao_baixas').update({ tentativas: 6, proxima_tentativa: new Date(Date.now() - 1000).toISOString() }).eq('order_id', s3);
  const antesS3 = (await chamadas()).length;
  await ciclo();
  passo('S3 depois de MAX_TENTATIVAS o job para (fica visível como erro)', (await chamadas()).length === antesS3 && (await linha(s3)).status === 'erro');
  await regra('T-NOREG', 'ok'); await regra('T-NOREG2', 'ok');

  // ---------- S4: HTTP 500 -> incerto, nunca reenvia sozinho
  await regra('T-500', 'http500', 1);
  const s4 = await pedido(['T-OK', 'T-500']);
  await rota(s4);
  const l4 = await linha(s4);
  passo('S4 HTTP 500: baixa incerta, itens incertos, sem op_enviada_em', l4?.status === 'incerto' && l4.resultado.every((x: any) => x.status === 'incerto') && !(await enviada(s4)), l4);
  await adiantar(s4);
  const antesS4 = (await chamadas()).length;
  await ciclo();
  passo('S4 o job NÃO reenvia baixa incerta (não duplica OP)', (await chamadas()).length === antesS4 && (await linha(s4)).status === 'incerto');

  // ---------- S5: timeout -> incerto
  await regra('T-HANG', 'hang', 1);
  const s5 = await pedido(['T-HANG']);
  await rota(s5);
  const l5 = await linha(s5);
  passo('S5 timeout: baixa incerta, não reenvia', l5?.status === 'incerto' && /a tempo|n.o respondeu/i.test(l5.ultimo_erro ?? ''), l5);

  // ---------- S6: OP criada e conclusão falhou -> incerto; S6b: OP criada sem local -> incerto
  await regra('T-OPERR', 'op_erro', 1);
  const s6 = await pedido(['T-OPERR']);
  await rota(s6);
  passo('S6 OP criada com conclusão falha: incerto', (await linha(s6))?.status === 'incerto');
  await regra('T-SEMLOCAL', 'sem_local', 1);
  const s6b = await pedido(['T-SEMLOCAL']);
  await rota(s6b);
  passo('S6b OP criada sem local para a saída: incerto (não reenvia, duplicaria a OP)', (await linha(s6b))?.status === 'incerto');

  // ---------- S7: Estoque fora do ar (conexão recusada): nada chegou lá -> erro retentável -> job recupera
  await secret('http://127.0.0.1:9292');
  const s7 = await pedido(['T-OK']);
  await rota(s7);
  const l7 = await linha(s7);
  passo('S7 Estoque fora do ar (ECONNREFUSED): erro retentável, não incerto', l7?.status === 'erro' && l7.resultado[0].retentavel === true, l7);
  await secret(MOCK);
  const antesS7 = (await chamadas()).length;
  await adiantar(s7);
  await ciclo();
  passo('S7 Estoque voltou: o job entrega e fecha ok', (await linha(s7)).status === 'ok' && (await chamadas()).length === antesS7 + 1 && (await enviada(s7)));

  // ---------- S8: varredura (navegador nunca chamou a rota); pedido anterior ao marco NÃO é varrido
  const s8 = await pedido(['T-OK'], { minutosAtras: 5 });
  const antigo = await pedido(['T-OK'], { minutosAtras: 5 });
  const velho = new Date(Date.now() - 5 * 3600_000).toISOString(); // antes do marco (que o teste põe 3 h atrás)
  await admin.from('orders').update({ updated_at: velho }).eq('id', antigo);
  await ciclo();
  passo('S8 varredura registrou e enviou o pedido que ficou sem baixa', (await linha(s8))?.status === 'ok' && (await enviada(s8)));
  passo('S8 pedido anterior ao marco NÃO é reprocessado', (await linha(antigo)) === null && !(await enviada(antigo)));
  const s8b = await pedido(['T-OK'], { minutosAtras: 1 });
  await ciclo();
  passo('S8 pedido recém-fechado (<3 min) fica para o navegador, a varredura espera', (await linha(s8b)) === null);

  // ---------- S10: envio interrompido (servidor caiu) -> incerto
  const s10 = await pedido(['T-OK', 'T-OK'.replace('OK', 'SEMEST')]);
  await admin.from('integracao_baixas').insert({ store_id: ZZ, order_id: s10, rotulo: 'Balcão', status: 'pending', payload: { itens: [{ codigo: 'T-OK', quantidade: 1 }, { codigo: 'T-SEMEST', quantidade: 1 }], pedidoRef: s10, ambiente: null },
    resultado: [], enviando: [0, 1], iniciada_em: new Date(Date.now() - 600000).toISOString(), em_processamento_ate: new Date(Date.now() - 300000).toISOString() });
  const antesS10 = (await chamadas()).length;
  await ciclo();
  const l10 = await linha(s10);
  passo('S10 envio interrompido vira incerto e não é reenviado', l10.status === 'incerto' && (await chamadas()).length === antesS10, l10);

  // ---------- S11: trava: linha em processamento por outro envio não é pega
  const s11 = await pedido(['T-OK']);
  await admin.from('integracao_baixas').insert({ store_id: ZZ, order_id: s11, rotulo: 'Balcão', status: 'erro', payload: { itens: [{ codigo: 'T-OK', quantidade: 1 }], pedidoRef: s11, ambiente: null },
    resultado: [{ codigo: 'T-OK', status: 'erro', retentavel: true, tentativas: 1, erro: 'x' }], em_processamento_ate: new Date(Date.now() + 120000).toISOString(), proxima_tentativa: new Date(Date.now() - 1000).toISOString() });
  const antesS11 = (await chamadas()).length;
  await ciclo();
  passo('S11 linha travada por outro processo não é enviada', (await chamadas()).length === antesS11);

  // ---------- S12: rota do gerente: Tentar de novo / Já conferi
  const acao = (id: string, a: string) => fetch(`${APP}/api/integracao/baixas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId: ZZ, id, acao: a, quem: 'Gerente Teste' }) }).then((r) => r.json());
  // S3 estava esgotada (tentativas=6): o gerente reabre
  const rS3 = await acao(l3.id, 'reprocessar');
  const l3c = await linha(s3);
  passo('S12 "Tentar de novo" do gerente reenvia item com erro comprovado e zera as tentativas', rS3.success === true && l3c.status === 'ok' && (await enviada(s3)), { rS3, l3c });
  // incerto: tentar de novo recusa e NÃO chama o Estoque
  const antesS12 = (await chamadas()).length;
  const rInc = await acao(l4.id, 'reprocessar');
  passo('S12 "Tentar de novo" em baixa incerta é recusado e não chama o Estoque', rInc.success === false && (await chamadas()).length === antesS12 && /conferi/i.test(rInc.message ?? ''), rInc);
  const rConf = await acao(l4.id, 'conferir');
  const l4c = await linha(s4);
  passo('S12 "Já conferi" fecha a baixa incerta (registra quem)', rConf.success === true && l4c.status === 'ok' && /Gerente Teste/.test(JSON.stringify(l4c.resultado)) && (await enviada(s4)), l4c);

  // ---------- RPC de leitura da tela
  const { data: resumo } = await admin.rpc('fetch_integracao_baixas_secure', { p_store_id: ZZ });
  passo('RPC de leitura devolve contadores e lista só do que não está ok', typeof resumo.pendentes === 'number' && typeof resumo.com_erro === 'number' && resumo.itens.every((i: any) => i.status !== 'ok'), resumo);
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  passo('anon não lê a tabela direto', ((await anon.from('integracao_baixas').select('id').limit(1)).data ?? []).length === 0);
  passo('anon NÃO executa a função interna de registro', !!(await anon.rpc('registrar_integracao_baixa_secure', { p_store_id: ZZ, p_order_id: s1, p_rotulo: 'x', p_payload: {} })).error);
  passo('anon lê o resumo pela RPC pública', !(await anon.rpc('fetch_integracao_baixas_secure', { p_store_id: ZZ })).error);
}

main().catch((e) => { falhas++; console.error(e); }).finally(async () => {
  // ---------- limpeza: pedidos (a linha do outbox cai por cascade), produtos e integração da ZZ
  if (criados.length) await admin.from('orders').delete().in('id', criados);
  await admin.from('products').update({ omie_codigo: null }).eq('store_id', ZZ).in('omie_codigo', CODIGOS);
  await admin.from('store_ntb_estoque_secrets').delete().eq('store_id', ZZ);
  if (marcoSalvo) await admin.from('integracao_baixas_marco').update({ desde: marcoSalvo }).eq('id', 1);
  const { count } = await admin.from('integracao_baixas').select('id', { count: 'exact', head: true }).eq('store_id', ZZ);
  console.log(`limpeza feita (${criados.length} pedidos de teste removidos; baixas restantes na ZZ: ${count})`);
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CENARIOS PASSARAM');
  process.exit(falhas ? 1 : 0);
});
