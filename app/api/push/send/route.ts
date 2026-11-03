import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { exigirSessao } from '@/lib/server/exigirSessao';

// Fase 5, Task 19 (plano "Fora do Cardápio"): dispara push de verdade (chega
// com o app fechado/tela bloqueada) pra todas as assinaturas de um pedido.
// Chamado fire-and-forget por `updateOrderItemStatus`/`updateOrderStatus`
// (lib/api.ts) sempre que o status muda — mesmo padrão de
// `triggerOrdemProducao` (nunca bloqueia a ação principal do lojista, erro
// aqui só vira console.error).
export async function POST(req: NextRequest) {
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    // Loja/ambiente sem push configurado — não é erro, é estado normal
    // (ex.: dev local sem as chaves no .env.local). Nunca derruba quem chamou.
    return NextResponse.json({ ok: false, reason: 'Push não configurado neste ambiente' });
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const { orderId, title, body: message } = (await req.json()) as {
    orderId?: string;
    title?: string;
    body?: string;
  };
  if (!orderId || !message) {
    return NextResponse.json({ ok: false, reason: 'Payload inválido' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  // Task 5: sessão da loja do pedido (só barra com seg_flags.exigir_sessao ligada). Pedido inexistente = nada a enviar.
  if (typeof orderId !== 'string' || !/^[0-9a-f-]{36}$/i.test(orderId)) {
    return NextResponse.json({ ok: false, reason: 'Payload inválido' }, { status: 400 });
  }
  const { data: pedido } = await admin.from('orders').select('store_id').eq('id', orderId).maybeSingle();
  if (!pedido) return NextResponse.json({ ok: true, sent: 0 });
  const semSessao = await exigirSessao(req, pedido.store_id as string);
  if (semSessao) return semSessao;
  const { data: subs } = await admin.from('push_subscriptions').select('*').eq('order_id', orderId);
  if (!subs?.length) return NextResponse.json({ ok: true, sent: 0 });

  const payload = JSON.stringify({ title: title || 'Cardápio Digital', body: message });
  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
    )
  );

  // Assinatura expirada/revogada pelo navegador (410 Gone, o código padrão
  // pra "esse endpoint nunca mais vai receber nada") — limpa em vez de
  // tentar de novo pra sempre a cada mudança de status futura.
  const expiredIds = subs
    .filter((_, i) => {
      const r = results[i];
      return r.status === 'rejected' && (r.reason as any)?.statusCode === 410;
    })
    .map((s) => s.id);
  if (expiredIds.length) {
    await admin.from('push_subscriptions').delete().in('id', expiredIds);
  }

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  return NextResponse.json({ ok: true, sent });
}
