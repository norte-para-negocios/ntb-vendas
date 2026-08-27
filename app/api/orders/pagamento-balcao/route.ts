import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { PAYMENT_METHOD_LABELS, CARD_BRAND_LABELS } from '@/lib/labels';
import { getPaymentMethodsForRecord } from '@/lib/calc';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cap arbitrário mas generoso — nenhuma comanda real de balcão precisa de
// mais que isso; existe só pra impedir um payload absurdo (o resto da
// validação abaixo já rejeita QUALQUER item malformado, este limite é só
// contra volume, mesmo espírito do limite de 100 itens/30 opções em
// create_order_secure, migration 017).
const MAX_METHODS = 20;

// Fix round 4 (Group A2): payload runtime validado contra os dois catálogos
// fechados de lib/labels.ts antes de gravar em jsonb. Sem isto, o
// TypeScript de `RequestBody` é só compile-time — a rota gravaria qualquer
// shape que chegasse por HTTP. Downstream, StoreModule.tsx (linha ~5936)
// renderiza `payment_details.methods.map(...)` e `m.amount.toFixed(2)` sem
// guarda nenhuma: um `methods` truthy não-array, ou um `amount` string,
// quebra o modal de detalhe de venda do lojista assim que ele abrir aquele
// pedido — mesma classe de DoS via jsonb já fechada do lado da Estação
// neste branch (fix round 2, Group A). Já é alcançável hoje via
// close_table_orders_secure (RPC pública, sem validação de shape) — não é
// regressão desta rota, mas é o lugar certo pra parar aqui também.
function isValidPaymentDetails(
  details: unknown
): details is { total: number; methods: { method: string; amount: number; brand?: string | null }[]; emitir_nota?: boolean; cash_shift_id?: string } {
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
    return true;
  });
}

// Módulo Caixa (Task 5, 2026-08-22, plano perfis-de-loja-e-caixa — fecha o
// gap do Balcão): grava payment_method/payment_details de um pedido de
// BALCÃO. Ver o comentário completo em lib/api.ts (closeCounterOrder) pro
// porquê disto não ser uma RPC nova — resumo: close_counter_order_secure só
// grava status; close_table_orders_secure grava pagamento mas filtra por
// table_id, e balcão nasce com table_id null (NULL = NULL nunca bate em
// SQL); e o plano proíbe migration/coluna/RPC nova pra fechar este gap
// (restrição explícita da Task 5). `orders` não tem SELECT/UPDATE público
// pra anon desde a correção de segurança 021/022 (ver AGENTS.md) — esta
// rota (service role, mesmo padrão de /api/certificado e
// /api/integracao/ordem-producao) é o único jeito de escrever aqui sem
// tocar em RLS/RPC/schema.
//
// Chamada síncrona (NÃO fire-and-forget, ao contrário de
// /api/integracao/ordem-producao e /api/fiscal/emitir): registrar o
// pagamento é o próprio propósito desta feature, não um efeito colateral
// best-effort — se isto falhar, closeCounterOrder (lib/api.ts) nunca chama
// close_counter_order_secure, e o pedido continua aberto em vez de "fechado
// sem ninguém saber como foi pago".
//
// Guarda `status not in ('delivered','canceled')` (mesmo espírito do
// `where table_id = p_table_id and status not in (...)` de
// close_table_orders_secure): nunca sobrescreve o pagamento de um pedido já
// fechado por engano (ex.: um retry tardio depois de outro caminho já ter
// fechado o mesmo pedido).
interface RequestBody {
  orderId?: string;
  paymentMethod?: string;
  paymentDetails?: {
    total: number;
    methods: { method: string; amount: number; brand?: string | null }[];
    emitir_nota?: boolean;
    cash_shift_id?: string;
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (!body?.orderId || !body?.paymentMethod || !body?.paymentDetails) {
    return NextResponse.json(
      { success: false, message: 'Dados de pagamento incompletos.' },
      { status: 400 }
    );
  }

  // Fix round 4 (Group A3): mesma validação de app/api/certificado (storeId)
  // — orderId nunca deveria chegar ao Postgres sem ter essa forma; um
  // orderId qualquer (não-UUID) só bateria em zero linhas de qualquer
  // forma, mas validar aqui evita depender do banco pra rejeitar lixo.
  if (typeof body.orderId !== 'string' || !UUID_RE.test(body.orderId)) {
    return NextResponse.json({ success: false, message: 'orderId inválido.' }, { status: 400 });
  }

  if (typeof body.paymentMethod !== 'string' || !(body.paymentMethod in PAYMENT_METHOD_LABELS)) {
    return NextResponse.json({ success: false, message: 'paymentMethod inválido.' }, { status: 400 });
  }

  if (!isValidPaymentDetails(body.paymentDetails)) {
    return NextResponse.json({ success: false, message: 'paymentDetails inválido.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Defesa em profundidade (achado real, reunião com o Ramon, 2026-08-25):
  // não confiar que o client já normalizou o troco embutido no método CASH
  // antes de mandar pra cá — esta rota roda com service role e é a
  // autoridade de escrita real de payment_details do balcão, então
  // reaplicar a mesma normalização aqui (lib/calc.ts,
  // getPaymentMethodsForRecord) garante a invariante mesmo se algum client
  // futuro esquecer de fazer isso. Nunca rejeita — só corrige o valor
  // gravado, mesmo espírito de "nunca impedir o fechamento" já seguido no
  // resto das rotas fire-and-forget deste projeto.
  const paymentDetailsNormalizado = {
    ...body.paymentDetails,
    methods: getPaymentMethodsForRecord(body.paymentDetails.methods, body.paymentDetails.total),
  };

  const { data, error } = await admin
    .from('orders')
    .update({
      payment_method: body.paymentMethod,
      payment_details: paymentDetailsNormalizado,
      updated_at: new Date().toISOString(),
    })
    .eq('id', body.orderId)
    // Fix round 4 (Group A1): sem este filtro, o `id` sozinho bastava pra
    // reescrever payment_method/payment_details de um pedido de MESA — a
    // rota se chama pagamento-balcao e o comentário do topo do arquivo diz
    // "pedido de BALCÃO", mas nada impedia isto na prática (`close_table_
    // orders_secure`, a RPC anon com que esta rota foi comparada, não
    // consegue fazer o equivalente: ela nunca aceita um order_id solto sem
    // passar pelo table_id da mesa).
    .eq('order_type', 'counter')
    .neq('status', 'delivered')
    .neq('status', 'canceled')
    .select('id')
    .maybeSingle();

  if (error) {
    // Fix round 4 (Group A3): não ecoa error.message (PostgREST) no corpo da
    // resposta — mesmo princípio já seguido no resto do projeto (nunca
    // vazar detalhe interno de banco pro client). Log só no servidor.
    console.error('pagamento-balcao: falha ao gravar pagamento:', error);
    return NextResponse.json(
      { success: false, message: 'Falha ao registrar o pagamento.' },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json(
      { success: false, message: 'Pedido de balcão não encontrado ou já estava fechado.' },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}
