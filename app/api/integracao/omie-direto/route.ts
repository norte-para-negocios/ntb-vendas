// app/api/integracao/omie-direto/route.ts
import { NextRequest, NextResponse } from 'next/server';

// Configura a chave direta da Omie (ver store_omie_secrets, migration
// 071) pra lojas que NÃO usam ntb-estoque. Write-only de verdade —
// só a service role, aqui, consegue gravar; a UI nunca lê de volta.

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RequestBody {
  storeId?: string;
  omieAppKey?: string;
  omieAppSecret?: string;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (!body?.storeId || !UUID_RE.test(body.storeId)) {
    return NextResponse.json({ success: false, message: 'storeId inválido.' }, { status: 400 });
  }
  if (!body.omieAppKey || !body.omieAppSecret) {
    return NextResponse.json({ success: false, message: 'App Key e App Secret da Omie são obrigatórios.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from('store_omie_secrets').upsert(
    {
      store_id: body.storeId,
      omie_app_key: body.omieAppKey,
      omie_app_secret: body.omieAppSecret,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'store_id' }
  );
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
