import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { ciclarCatalogoEstoque } from '@/lib/catalogoSync';

// Estado da sincronização do catálogo com o Estoque (tela "Divergências"). Mesma confiança das demais rotas internas:
// storeId vindo do painel; o segredo nunca sai daqui. GET = estado; POST = "Sincronizar agora".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const storeId = request.nextUrl.searchParams.get('storeId') ?? '';
  if (!UUID_RE.test(storeId)) return NextResponse.json({ ok: false, error: 'storeId inválido' }, { status: 400 });
  const admin = getSupabaseAdmin();
  const [{ data: loja }, { data: fila }, { data: diverg }, { data: ultimo }, { data: secret }] = await Promise.all([
    admin.from('stores').select('stock_mode').eq('id', storeId).maybeSingle(),
    admin.from('sync_estoque_outbox').select('id, entidade, ref, status, tentativas, erro, updated_at').eq('store_id', storeId).in('status', ['pending', 'erro']).order('id', { ascending: false }).limit(50),
    admin.from('sync_estoque_divergencias').select('id, entidade, ref, tipo, detalhe, detectado_em').eq('store_id', storeId).is('resolvido_em', null).order('detectado_em', { ascending: false }).limit(50),
    admin.from('sync_estoque_outbox').select('updated_at').eq('store_id', storeId).eq('status', 'ok').order('updated_at', { ascending: false }).limit(1),
    admin.from('store_ntb_estoque_secrets').select('ativo').eq('store_id', storeId).maybeSingle(),
  ]);
  return NextResponse.json({
    ok: true,
    modo: loja?.stock_mode ?? 'omie',
    ligada: !!secret?.ativo,
    pendentes: (fila ?? []).filter((f) => f.status === 'pending').length,
    erros: (fila ?? []).filter((f) => f.status === 'erro').length,
    ultimaEntrega: ultimo?.[0]?.updated_at ?? null,
    fila: fila ?? [],
    divergencias: diverg ?? [],
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { storeId?: string } | null;
  if (!body?.storeId || !UUID_RE.test(body.storeId)) return NextResponse.json({ ok: false, error: 'storeId inválido' }, { status: 400 });
  const r = await ciclarCatalogoEstoque({ soLoja: body.storeId });
  return NextResponse.json({ ok: true, resumo: r });
}
