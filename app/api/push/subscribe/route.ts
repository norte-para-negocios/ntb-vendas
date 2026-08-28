import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// Fase 5, Task 19 (plano "Fora do Cardápio"): grava a assinatura de push do
// navegador do cliente pra um `orderId` específico (OrderTracker,
// ClientModule.tsx). Não usa a chave anônima direto do client por decisão
// consciente: `push_subscriptions` já é RLS allow_all_anon (dado não
// sensível), mas passar pela rota evita que o formato do payload do
// PushSubscription (aninhado, `keys.p256dh`/`keys.auth`) precise ser
// desmontado no client — mais simples manter essa lógica num lugar só.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { orderId, subscription } = body as {
    orderId?: string;
    subscription?: { endpoint: string; keys: { p256dh: string; auth: string } };
  };
  if (!orderId || !subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return NextResponse.json({ ok: false, reason: 'Payload inválido' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from('push_subscriptions').upsert(
    {
      order_id: orderId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    { onConflict: 'endpoint' }
  );
  if (error) {
    console.error('push/subscribe: falha ao gravar assinatura', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
