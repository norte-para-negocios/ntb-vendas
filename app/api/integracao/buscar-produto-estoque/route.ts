import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// Chamada pelo browser (StoreModule.tsx, modo "Vincular a um código Omie já
// existente" no formulário de produto) — pesquisa por nome direto na base do
// NTB Estoque, pra não exigir que o operador saiba o código Omie de cor.
// Mesma URL/chave já configurada em store_ntb_estoque_secrets (nenhum segredo
// novo), mesmo padrão de app/api/integracao/criar-produto-estoque/route.ts.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const storeId = request.nextUrl.searchParams.get('storeId') ?? '';
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!UUID_RE.test(storeId)) {
    return NextResponse.json({ success: false, message: 'storeId inválido.' }, { status: 400 });
  }
  if (q.length < 2) {
    return NextResponse.json({ success: false, message: 'Informe ao menos 2 caracteres.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: secret } = await admin
    .from('store_ntb_estoque_secrets')
    .select('ntb_estoque_url, ntb_estoque_api_key, ativo')
    .eq('store_id', storeId)
    .maybeSingle();

  if (!secret) {
    return NextResponse.json({ success: false, message: 'Loja sem integração com o NTB Estoque configurada.' }, { status: 400 });
  }
  if (!secret.ativo) {
    return NextResponse.json({ success: false, message: 'Integração com o NTB Estoque está desativada.' }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${secret.ntb_estoque_url.replace(/\/$/, '')}/api/integracao/produtos?q=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${secret.ntb_estoque_api_key}` } }
    );
    const resposta = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok || !resposta.ok) {
      return NextResponse.json({ success: false, message: resposta.error || 'Falha ao buscar produtos no NTB Estoque.' }, { status: 502 });
    }
    return NextResponse.json({ success: true, produtos: resposta.produtos ?? [] });
  } catch (e: any) {
    return NextResponse.json({ success: false, message: 'Não foi possível contatar o NTB Estoque: ' + e.message }, { status: 502 });
  }
}
