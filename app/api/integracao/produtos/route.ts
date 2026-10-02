import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// Rota externa (não-sessão) pro ntb-estoque criar ou ATUALIZAR produtos aqui
// automaticamente. Dois métodos:
//   POST  — cria um produto novo (Direção 2 do cadastro unificado, 2026-08-16)
//   PATCH — atualiza nome/preço de produtos já vinculados por omie_codigo
//           (sync automática Omie → Vendas, 2026-10-02, pedido do usuário)
//
// Autenticação: Bearer = integracao_api_key da loja (mesma chave bidirecional
// usada pra Ordem de Produção e criar produto). Resolve o store_id procurando
// qual store_ntb_estoque_secrets tem essa chave salva.

interface CreateBody {
  nome?: string;
  preco?: number;
  omieCodigo?: string;
}

interface UpdateItem {
  omieCodigo: string;
  nome?: string;
  preco?: number;
}

interface PatchBody {
  updates?: UpdateItem[];
}

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!apiKey) {
    return NextResponse.json({ error: 'Authorization: Bearer <chave> ausente' }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as CreateBody | null;
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

export async function PATCH(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!apiKey) {
    return NextResponse.json({ error: 'Authorization: Bearer <chave> ausente' }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body?.updates?.length) {
    return NextResponse.json({ error: 'Informe updates[] com pelo menos 1 item' }, { status: 400 });
  }
  // Limite de segurança: max 500 updates por chamada (mesmo teto do sync de produtos do Omie)
  if (body.updates.length > 500) {
    return NextResponse.json({ error: 'Máximo de 500 updates por chamada' }, { status: 400 });
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

  // Buscar todos os produtos da loja que têm omie_codigo matching
  const omieCodigos = body.updates.map(u => u.omieCodigo.trim()).filter(Boolean);
  if (!omieCodigos.length) {
    return NextResponse.json({ ok: true, updated: 0, notFound: 0 });
  }

  const { data: existingProducts } = await admin
    .from('products')
    .select('id, omie_codigo, name, price')
    .eq('store_id', secret.store_id)
    .in('omie_codigo', omieCodigos);

  const existingMap = new Map((existingProducts ?? []).map(p => [p.omie_codigo, p]));

  let updated = 0;
  let notFound = 0;
  const errors: string[] = [];

  for (const item of body.updates) {
    const codigo = item.omieCodigo.trim();
    const existing = existingMap.get(codigo);
    if (!existing) {
      notFound++;
      continue;
    }

    // Só atualiza se houve mudança real (evita writes desnecessários)
    const updates: Record<string, any> = {};
    if (item.nome && item.nome.trim() !== existing.name) {
      updates.name = item.nome.trim();
    }
    if (item.preco != null && item.preco > 0 && Number(item.preco) !== Number(existing.price)) {
      updates.price = Number(item.preco);
    }

    if (Object.keys(updates).length === 0) {
      continue; // Nada mudou
    }

    const { error } = await admin
      .from('products')
      .update(updates)
      .eq('id', existing.id);

    if (error) {
      errors.push(`${codigo}: ${error.message}`);
    } else {
      updated++;
    }
  }

  return NextResponse.json({
    ok: true,
    updated,
    notFound,
    errors: errors.length ? errors : undefined,
  });
}