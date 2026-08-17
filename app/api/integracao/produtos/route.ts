import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// Rota externa (não-sessão) pro ntb-estoque criar um produto aqui
// automaticamente ao cadastrar um produto novo lá, com um clique só ("Criar
// no NTB Vendas também") — Direção 2 do cadastro de produto unificado
// (2026-08-16, pedido explícito do usuário). Espelha app/api/integracao/
// criar-produto-estoque/route.ts (Direção 1), mas ao contrário.
//
// Autenticação diferente da rota /api/integracao/lojas (que usa o segredo
// GLOBAL CROSS_SYSTEM_BOOTSTRAP_KEY, porque na hora de criar a loja ainda
// não existe par nenhum): aqui a loja já existe e já está pareada, então o
// Bearer é a MESMA integracao_api_key que o ntb-estoque já guarda pra essa
// loja — a chave é bidirecional por natureza: é o valor que o ntb-vendas
// manda como Bearer ao chamar o ntb-estoque (Ordem de Produção/criar
// produto), e agora também o valor que o ntb-estoque manda de volta pra cá.
// Resolve o storeId procurando qual store_ntb_estoque_secrets tem essa
// chave salva.

interface RequestBody {
  nome?: string;
  preco?: number;
  omieCodigo?: string;
}

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!apiKey) {
    return NextResponse.json({ error: 'Authorization: Bearer <chave> ausente' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (!body?.nome?.trim() || !body.preco || body.preco <= 0 || !body.omieCodigo?.trim()) {
    return NextResponse.json({ error: 'Informe nome, preco (> 0) e omieCodigo' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data: secret } = await admin
    .from('store_ntb_estoque_secrets')
    .select('store_id, ativo')
    .eq('ntb_estoque_api_key', apiKey)
    .maybeSingle();

  if (!secret) {
    return NextResponse.json({ error: 'Chave de integração inválida' }, { status: 401 });
  }
  if (!secret.ativo) {
    return NextResponse.json({ error: 'Integração desativada por essa loja' }, { status: 403 });
  }

  // available=false de propósito: produto vem sem categoria/imagem/descrição
  // (o ntb-estoque não tem nenhum desses conceitos) — fica oculto do
  // cardápio até o lojista completar o cadastro aqui (mesmo texto que
  // "Sem categoria" já usa pra produto órfão).
  const { data: produto, error } = await admin
    .from('products')
    .insert({
      store_id: secret.store_id,
      category_id: null,
      name: body.nome.trim(),
      price: body.preco,
      available: false,
      omie_codigo: body.omieCodigo.trim(),
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, productId: produto.id });
}
