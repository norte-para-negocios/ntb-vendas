import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { stockModeFields } from '@/lib/modoEstoque';

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
  /** Modo de estoque da loja nova ('omie' | 'proprio' | 'nenhum'); ausente = 'omie'. */
  stockMode?: string;
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

  // Idempotente por CNPJ (ligação automática Estoque <-> Vendas): se a loja já existe aqui, devolve a existente em vez de duplicar.
  const digitos = (body.cnpj ?? '').replace(/\D/g, '');
  if (digitos.length >= 11) {
    const { data: candidatas } = await admin.from('stores').select('id, slug, cnpj, stock_mode').not('cnpj', 'is', null);
    const existente = (candidatas ?? []).find((c) => String(c.cnpj).replace(/\D/g, '') === digitos);
    if (existente) {
      const alvo = body.stockMode === 'proprio' || body.stockMode === 'nenhum' ? body.stockMode : null;
      if (alvo && existente.stock_mode !== alvo) {
        const { data: tem } = await admin.rpc('store_tem_baixas_secure', { p_store_id: existente.id });
        if (!tem) await admin.from('stores').update({ stock_mode: alvo }).eq('id', existente.id);
      }
      return NextResponse.json({ ok: true, storeId: existente.id, slug: existente.slug, existente: true });
    }
  }
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
        ...stockModeFields(body.stockMode),
        config: { service_fee_rate: 0.1 },
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

// Atualização vinda do Norte Estoque (nome, CNPJ, ativa), autenticada pela chave da própria loja
// (a mesma guardada em store_ntb_estoque_secrets). Achado do QA de 07/10: editar num sistema não mudava o outro.
export async function PATCH(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  const chave = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!chave) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { nome?: string; cnpj?: string | null; ativo?: boolean } | null;
  if (!body) return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 });
  const admin = getSupabaseAdmin();
  const { data: sec } = await admin.from('store_ntb_estoque_secrets').select('store_id').eq('ntb_estoque_api_key', chave);
  if (!sec || sec.length !== 1) return NextResponse.json({ error: 'Chave de integração inválida' }, { status: 401 });
  const upd: Record<string, unknown> = {};
  if (typeof body.nome === 'string' && body.nome.trim()) upd.name = body.nome.trim();
  if (typeof body.cnpj === 'string' && body.cnpj.replace(/\D/g, '').length >= 11) upd.cnpj = body.cnpj.trim();
  if (typeof body.ativo === 'boolean') upd.is_active = body.ativo;
  if (!Object.keys(upd).length) return NextResponse.json({ ok: true, alterado: false });
  const { error } = await admin.from('stores').update(upd).eq('id', sec[0].store_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, alterado: true });
}
