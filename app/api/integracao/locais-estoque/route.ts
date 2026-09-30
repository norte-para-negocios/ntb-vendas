import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// Local de estoque do Omie por destino de preparo (30/09, pedido do dono; migration 134).
// GET: lista os locais da loja no Omie (via ntb-estoque, com a chave da integração que
// só a service role lê) + o que já foi escolhido. POST: grava/limpa a escolha de 1 destino.
// Mesmo modelo de confiança de /api/integracao/configurar (storeId vindo do painel).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DESTINO_RE = /^(kitchen|bar|setor:[0-9a-f-]{36})$/i;

export async function GET(request: NextRequest) {
  const storeId = request.nextUrl.searchParams.get('storeId') ?? '';
  if (!UUID_RE.test(storeId)) return NextResponse.json({ configurado: false, locais: [], mapa: {} }, { status: 400 });

  const admin = getSupabaseAdmin();
  const [{ data: secret }, { data: linhas }] = await Promise.all([
    admin.from('store_ntb_estoque_secrets').select('ntb_estoque_url, ntb_estoque_api_key, ativo').eq('store_id', storeId).maybeSingle(),
    admin.from('store_estoque_locais').select('destino, omie_local_codigo').eq('store_id', storeId),
  ]);
  const mapa = Object.fromEntries((linhas ?? []).map((l: { destino: string; omie_local_codigo: number }) => [l.destino, Number(l.omie_local_codigo)]));

  if (!secret?.ativo || !secret.ntb_estoque_url || !secret.ntb_estoque_api_key) {
    return NextResponse.json({ configurado: false, locais: [], mapa });
  }
  try {
    const res = await fetch(`${secret.ntb_estoque_url.replace(/\/$/, '')}/api/integracao/locais-estoque`, {
      headers: { Authorization: `Bearer ${secret.ntb_estoque_api_key}` },
      cache: 'no-store',
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return NextResponse.json({ configurado: true, locais: [], mapa, erro: json?.error || `Estoque respondeu ${res.status}` });
    return NextResponse.json({ configurado: true, locais: json?.locais ?? [], mapa });
  } catch (e) {
    return NextResponse.json({ configurado: true, locais: [], mapa, erro: e instanceof Error ? e.message : 'Estoque fora do ar' });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { storeId?: string; destino?: string; codigo?: number | null; nome?: string | null } | null;
  if (!body?.storeId || !UUID_RE.test(body.storeId) || !body.destino || !DESTINO_RE.test(body.destino)) {
    return NextResponse.json({ success: false, message: 'Dados inválidos.' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();
  if (!body.codigo) {
    const { error } = await admin.from('store_estoque_locais').delete().eq('store_id', body.storeId).eq('destino', body.destino);
    if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }
  const { error } = await admin.from('store_estoque_locais').upsert({
    store_id: body.storeId,
    destino: body.destino,
    omie_local_codigo: Number(body.codigo),
    local_nome: body.nome ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
