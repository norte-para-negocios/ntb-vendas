import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// Repassa ao Norte Estoque ligado o nome/CNPJ/ativa da loja depois de editar no painel (a chave nunca vai ao navegador).
// Mesmo modelo de confiança das outras rotas de integração (storeId vindo do painel). Achado do QA de 07/10.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { storeId?: string } | null;
  if (!body?.storeId || !UUID_RE.test(body.storeId)) return NextResponse.json({ ok: false, message: 'storeId inválido' }, { status: 400 });
  const admin = getSupabaseAdmin();
  const [{ data: loja }, { data: sec }] = await Promise.all([
    admin.from('stores').select('name, cnpj, is_active').eq('id', body.storeId).maybeSingle(),
    admin.from('store_ntb_estoque_secrets').select('ntb_estoque_url, ntb_estoque_api_key, ativo').eq('store_id', body.storeId).maybeSingle(),
  ]);
  if (!loja || !sec?.ativo || !sec.ntb_estoque_url || !sec.ntb_estoque_api_key) return NextResponse.json({ ok: true, ignorado: true });
  try {
    const r = await fetch(`${String(sec.ntb_estoque_url).replace(/\/$/, '')}/api/integracao/lojas`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sec.ntb_estoque_api_key}` },
      body: JSON.stringify({ nome: loja.name, cnpj: loja.cnpj, ativo: loja.is_active }),
    });
    return NextResponse.json({ ok: r.ok, status: r.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, message: e?.message ?? 'falha ao contatar o Norte Estoque' });
  }
}
