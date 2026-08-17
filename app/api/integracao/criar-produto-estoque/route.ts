import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// Chamada pelo browser (StoreModule.tsx, checkbox "Criar no NTB Estoque
// também" no formulário de "Novo Produto") — cadastro de produto unificado,
// Direção 1 (2026-08-16, pedido explícito do usuário). Usa a MESMA chave/URL
// já configurada em store_ntb_estoque_secrets pra Ordem de Produção — não
// precisa de segredo novo.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RequestBody {
  storeId?: string;
  productId?: string;
  nome?: string;
  preco?: number;
  ncm?: string | null;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (!body?.storeId || !UUID_RE.test(body.storeId) || !body.productId || !UUID_RE.test(body.productId) || !body.nome?.trim() || !body.preco) {
    return NextResponse.json({ success: false, message: 'storeId, productId, nome e preco são obrigatórios.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data: secret } = await admin
    .from('store_ntb_estoque_secrets')
    .select('ntb_estoque_url, ntb_estoque_api_key, ativo')
    .eq('store_id', body.storeId)
    .maybeSingle();

  if (!secret) {
    return NextResponse.json({ success: false, message: 'Loja sem integração com o NTB Estoque configurada.' }, { status: 400 });
  }
  if (!secret.ativo) {
    return NextResponse.json({ success: false, message: 'Integração com o NTB Estoque está desativada.' }, { status: 400 });
  }

  let resposta: { ok?: boolean; codigo?: string; codigoProduto?: number; error?: string };
  try {
    const res = await fetch(`${secret.ntb_estoque_url.replace(/\/$/, '')}/api/integracao/produtos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret.ntb_estoque_api_key}` },
      body: JSON.stringify({ nome: body.nome, precoVenda: body.preco, ncm: body.ncm || undefined }),
    });
    resposta = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok || !resposta.ok) {
      return NextResponse.json({ success: false, message: resposta.error || 'Falha ao criar produto no NTB Estoque.' }, { status: 502 });
    }
  } catch (e: any) {
    return NextResponse.json({ success: false, message: 'Não foi possível contatar o NTB Estoque: ' + e.message }, { status: 502 });
  }

  const { error } = await admin
    .from('products')
    .update({ omie_codigo: resposta.codigo })
    .eq('id', body.productId)
    .eq('store_id', body.storeId);
  if (error) {
    return NextResponse.json({ success: false, message: 'Produto criado no NTB Estoque, mas falhou salvar o código aqui: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, omieCodigo: resposta.codigo });
}
