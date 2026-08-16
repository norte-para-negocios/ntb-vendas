import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// Chamada pelo browser (AdminModule.tsx, checkbox "Criar no NTB Estoque
// também" na criação de loja) — nunca expõe CROSS_SYSTEM_BOOTSTRAP_KEY pro
// client, essa rota é quem fala com o ntb-estoque usando o segredo (só
// server-side). Pedido explícito do usuário (2026-08-16): criar a loja nos
// dois sistemas com um clique só, sem o operador mexer em chave nenhuma.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RequestBody {
  storeId?: string;
  nome?: string;
  cnpj?: string;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (!body?.storeId || !UUID_RE.test(body.storeId) || !body.nome?.trim()) {
    return NextResponse.json({ success: false, message: 'storeId e nome são obrigatórios.' }, { status: 400 });
  }

  const segredo = process.env.CROSS_SYSTEM_BOOTSTRAP_KEY;
  const estoqueUrl = process.env.NTB_ESTOQUE_INTERNAL_URL;
  if (!segredo || !estoqueUrl) {
    return NextResponse.json({ success: false, message: 'Integração cross-sistema não configurada neste servidor.' }, { status: 500 });
  }

  let resposta: { ok?: boolean; lojaId?: number; integracaoApiKey?: string; url?: string; error?: string };
  try {
    const res = await fetch(`${estoqueUrl.replace(/\/$/, '')}/api/integracao/lojas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${segredo}` },
      body: JSON.stringify({ nome: body.nome, cnpj: body.cnpj || undefined }),
    });
    resposta = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok || !resposta.ok) {
      return NextResponse.json({ success: false, message: resposta.error || 'Falha ao criar loja no NTB Estoque.' }, { status: 502 });
    }
  } catch (e: any) {
    return NextResponse.json({ success: false, message: 'Não foi possível contatar o NTB Estoque: ' + e.message }, { status: 502 });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from('store_ntb_estoque_secrets').upsert(
    {
      store_id: body.storeId,
      ntb_estoque_url: resposta.url,
      ntb_estoque_api_key: resposta.integracaoApiKey,
      ativo: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'store_id' }
  );
  if (error) {
    return NextResponse.json({ success: false, message: 'Loja criada no NTB Estoque, mas falhou salvar a integração aqui: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, lojaEstoqueId: resposta.lojaId });
}
