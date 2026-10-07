import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { ehProprio } from '@/lib/modoEstoque';

// Cria um local de estoque no Norte Estoque da loja (modo "Estoque próprio", migration 168).
// O local nasce lá (é lá que o saldo mora) e a tela daqui só lista e mapeia. Chamada pelo painel
// (storeId vindo do painel, mesmo modelo de confiança de /api/integracao/locais-estoque); a chave do
// Estoque nunca sai do servidor. Em loja Omie o local é do Omie e esta rota recusa.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { storeId?: string; descricao?: string } | null;
  const descricao = body?.descricao?.trim() ?? '';
  if (!body?.storeId || !UUID_RE.test(body.storeId) || descricao.length < 2 || descricao.length > 60) {
    return NextResponse.json({ success: false, message: 'Informe o nome do local (2 a 60 letras).' }, { status: 400 });
  }
  const admin = getSupabaseAdmin(request.headers.get('x-ntb-actor'));
  const { data: loja } = await admin.from('stores').select('id, stock_mode').eq('id', body.storeId).maybeSingle();
  if (!loja) return NextResponse.json({ success: false, message: 'Loja não encontrada.' }, { status: 404 });
  if (!ehProprio(loja.stock_mode)) {
    return NextResponse.json({ success: false, message: 'Só lojas em modo Estoque próprio criam locais por aqui.' }, { status: 409 });
  }
  const { data: secret } = await admin.from('store_ntb_estoque_secrets').select('ntb_estoque_url, ntb_estoque_api_key, ativo').eq('store_id', body.storeId).maybeSingle();
  if (!secret?.ativo || !secret.ntb_estoque_url || !secret.ntb_estoque_api_key) {
    return NextResponse.json({ success: false, message: 'A integração com o Norte Estoque não está ligada nesta loja.' }, { status: 409 });
  }
  try {
    const res = await fetch(`${secret.ntb_estoque_url.replace(/\/$/, '')}/api/integracao/locais-estoque`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret.ntb_estoque_api_key}` },
      body: JSON.stringify({ descricao, nome: descricao }),
      signal: AbortSignal.timeout(30000),
    });
    const json = (await res.json().catch(() => null)) as { error?: string; message?: string; codigo?: number; nome?: string; local?: { codigo?: number; nome?: string } } | null;
    if (!res.ok) return NextResponse.json({ success: false, message: json?.error || json?.message || `O Estoque respondeu ${res.status}.` }, { status: 502 });
    const codigo = json?.local?.codigo ?? json?.codigo ?? null;
    return NextResponse.json({ success: true, codigo, nome: json?.local?.nome ?? json?.nome ?? descricao });
  } catch (e) {
    return NextResponse.json({ success: false, message: 'Não consegui falar com o Norte Estoque: ' + (e instanceof Error ? e.message : 'fora do ar') }, { status: 502 });
  }
}
