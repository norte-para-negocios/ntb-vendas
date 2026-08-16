import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// Rota externa (não-sessão) pro ntb-estoque criar uma loja aqui
// automaticamente ao criar uma loja de lá, com um clique só ("Criar no NTB
// Vendas também"). Autenticada pelo mesmo segredo fixo compartilhado usado
// em ntb-estoque/app/api/integracao/lojas/route.ts (CROSS_SYSTEM_BOOTSTRAP_KEY)
// — pedido explícito do usuário (2026-08-16), simétrico à rota que já existe
// do outro lado.

function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

interface RequestBody {
  nome?: string;
  cnpj?: string;
}

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  const chave = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const segredo = process.env.CROSS_SYSTEM_BOOTSTRAP_KEY;
  if (!segredo || chave !== segredo) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (!body?.nome?.trim()) {
    return NextResponse.json({ error: 'Informe nome' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const baseSlug = generateSlug(body.nome) || 'loja';
  let slug = baseSlug;

  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const { data: store, error } = await admin
      .from('stores')
      .insert({
        name: body.nome.trim(),
        cnpj: body.cnpj?.trim() || null,
        slug,
        contract_type: 'balcao_mesas',
        contract_period_months: 12,
        is_active: true,
        config: { use_pin: true, allow_client_open: true, service_fee_rate: 0.1 },
      })
      .select('id, slug')
      .single();

    if (!error) {
      return NextResponse.json({ ok: true, storeId: store.id, slug: store.slug });
    }
    if (error.code === '23505') {
      // slug já em uso — tenta um sufixo novo (mesmo padrão de duplicateStore em lib/api.ts)
      slug = `${baseSlug}-${Math.random().toString(36).substring(2, 7)}`;
      continue;
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ error: 'Não foi possível gerar um slug único. Tente de novo.' }, { status: 500 });
}
