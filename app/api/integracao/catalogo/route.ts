import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// Catálogo unificado Estoque <-> Vendas (lojas stock_mode='proprio'). Autenticação: Bearer = chave de integração da loja
// (a mesma de /api/integracao/produtos: store_ntb_estoque_secrets.ntb_estoque_api_key).
//   POST: o Estoque entrega mudanças (grupos e produtos) -> aplicar_catalogo_estoque (idempotente, sem eco); ou só `mapa`
//         (códigos que o Estoque criou para produtos que só existiam aqui) -> aplicar_mapa_estoque.
//   GET : snapshot do catálogo do Vendas no formato do Estoque (reconciliação do Estoque).
// Modelo e regras de conflito: ntb-estoque/docs/superpowers/specs/2026-10-06-sync-catalogo-design.md

async function lojaPelaChave(request: NextRequest): Promise<{ storeId: string } | NextResponse> {
  const auth = request.headers.get('authorization') ?? '';
  const chave = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!chave) return NextResponse.json({ ok: false, error: 'Authorization: Bearer <chave> ausente' }, { status: 401 });
  const admin = getSupabaseAdmin();
  const { data: secret } = await admin.from('store_ntb_estoque_secrets').select('store_id, ativo').eq('ntb_estoque_api_key', chave).maybeSingle();
  if (!secret) return NextResponse.json({ ok: false, error: 'Chave de integração inválida' }, { status: 401 });
  if (!secret.ativo) return NextResponse.json({ ok: false, error: 'Integração desativada por essa loja' }, { status: 403 });
  const { data: loja } = await admin.from('stores').select('stock_mode').eq('id', secret.store_id).maybeSingle();
  if (loja?.stock_mode !== 'proprio') return NextResponse.json({ ok: false, error: 'Esta loja não usa estoque próprio' }, { status: 409 });
  return { storeId: secret.store_id as string };
}

export async function POST(request: NextRequest) {
  const r = await lojaPelaChave(request);
  if (r instanceof NextResponse) return r;
  const body = (await request.json().catch(() => null)) as { grupos?: unknown[]; produtos?: unknown[]; mapa?: unknown } | null;
  if (!body) return NextResponse.json({ ok: false, error: 'Corpo inválido' }, { status: 400 });
  const admin = getSupabaseAdmin();
  if (body.mapa) {
    const { error } = await admin.rpc('aplicar_mapa_estoque', { p_store: r.storeId, p_mapa: body.mapa });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (!Array.isArray(body.grupos) && !Array.isArray(body.produtos)) {
    return NextResponse.json({ ok: false, error: 'Informe grupos[] e/ou produtos[]' }, { status: 400 });
  }
  if ((body.grupos?.length ?? 0) + (body.produtos?.length ?? 0) > 1000) {
    return NextResponse.json({ ok: false, error: 'Máximo de 1000 itens por chamada' }, { status: 400 });
  }
  const { data, error } = await admin.rpc('aplicar_catalogo_estoque', { p_store: r.storeId, p_payload: { grupos: body.grupos ?? [], produtos: body.produtos ?? [] } });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function GET(request: NextRequest) {
  const r = await lojaPelaChave(request);
  if (r instanceof NextResponse) return r;
  const { data, error } = await getSupabaseAdmin().rpc('catalogo_para_estoque', { p_store: r.storeId, p_produtos: null, p_categorias: null, p_grupos: null });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...(data as object) });
}
