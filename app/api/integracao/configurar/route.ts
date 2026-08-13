import { NextRequest, NextResponse } from 'next/server';

// Configura a integração ntb-vendas -> ntb-estoque (Ordem de Produção
// automática, ver app/api/integracao/ordem-producao/route.ts e migration
// 027) pela UI. store_ntb_estoque_secrets é write-only de verdade (zero
// policy de select pra anon/authenticated, ver 027) — só a service role,
// aqui, consegue gravar. `ativo` liga/desliga sem apagar URL/chave já
// configuradas (migration 042).

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RequestBody {
  storeId?: string;
  url?: string;
  apiKey?: string;
  ativo?: boolean;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (!body?.storeId || !UUID_RE.test(body.storeId)) {
    return NextResponse.json({ success: false, message: 'storeId inválido.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Sem URL/chave enviadas: só está mudando o toggle `ativo` de uma
  // configuração já existente.
  if (!body.url && !body.apiKey) {
    if (typeof body.ativo !== 'boolean') {
      return NextResponse.json({ success: false, message: 'Nada para atualizar.' }, { status: 400 });
    }
    const { error } = await admin
      .from('store_ntb_estoque_secrets')
      .update({ ativo: body.ativo, updated_at: new Date().toISOString() })
      .eq('store_id', body.storeId);
    if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (!body.url || !body.apiKey) {
    return NextResponse.json({ success: false, message: 'URL e chave de API são obrigatórias na primeira configuração.' }, { status: 400 });
  }

  const { error } = await admin.from('store_ntb_estoque_secrets').upsert(
    {
      store_id: body.storeId,
      ntb_estoque_url: body.url,
      ntb_estoque_api_key: body.apiKey,
      ativo: body.ativo ?? true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'store_id' }
  );
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
