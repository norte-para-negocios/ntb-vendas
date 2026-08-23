import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

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

  const admin = getSupabaseAdmin();

  const { data, error } = await admin
    .from('orders')
    .update({
      payment_method: body.paymentMethod,
      payment_details: body.paymentDetails,
      updated_at: new Date().toISOString(),
    })
    .eq('id', body.orderId)
    .neq('status', 'delivered')
    .neq('status', 'canceled')
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { success: false, message: 'Pedido de balcão não encontrado ou já estava fechado.' },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}
