import { NextRequest, NextResponse } from 'next/server';

// Única rota de API deste projeto (ver AGENTS.md). Existe porque TODA
// escrita relacionada ao certificado digital fiscal (arquivo + metadados +
// senha) precisa rodar com a service role key, não com a chave anônima:
//
// 1. O arquivo em si: a API de Storage do Supabase lê a linha de volta
//    depois de gravar (tipo um INSERT...RETURNING) pra montar a resposta,
//    e o `.list()` usado na limpeza (DELETE abaixo) também exige leitura.
//    Dar policy de SELECT em storage.objects pra `anon` deixaria o .pfx
//    baixável por qualquer um com a chave pública.
// 2. A senha (`store_fiscal_certificate_secrets`): mesmo sem `.select()`
//    encadeado, testado direto no banco, um `UPDATE ... WHERE store_id =
//    X` (e também um upsert com ON CONFLICT) numa tabela sem NENHUMA
//    policy de SELECT sempre afeta zero linhas — o Postgres precisa achar
//    a linha existente pra decidir se atualiza, e isso exige a mesma
//    visibilidade de leitura que uma policy de SELECT daria (confirmado
//    com EXPLAIN: o plano vira um "One-Time Filter: false" sem ela). Dar
//    policy de SELECT pra essa tabela exporia a senha em texto puro pra
//    qualquer um com a chave anônima — exatamente o que essa tabela existe
//    pra evitar.
//
// Rodando tudo aqui, com a service role key (ignora RLS por completo), o
// cliente nunca precisa nem consegue ler nenhuma das duas coisas.

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

const CERT_BUCKET = 'store-certificates';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const storeId = form.get('storeId');
  if (typeof storeId !== 'string' || !UUID_RE.test(storeId)) {
    return NextResponse.json({ success: false, message: 'storeId inválido.' }, { status: 400 });
  }

  const file = form.get('file');
  const originalFilename = form.get('originalFilename');
  const expiresAtRaw = form.get('expiresAt');
  const password = form.get('password');

  try {
    const supabaseAdmin = getSupabaseAdmin();

    if (file instanceof File) {
      const path = `${storeId}/certificado.pfx`;
      const { error } = await supabaseAdmin.storage.from(CERT_BUCKET).upload(path, file, { upsert: true });
      if (error) throw new Error(error.message);
    }

    if (typeof originalFilename === 'string' && originalFilename) {
      const expiresAt = typeof expiresAtRaw === 'string' && expiresAtRaw ? expiresAtRaw : null;
      const { error } = await supabaseAdmin.from('store_fiscal_certificates').upsert(
        {
          store_id: storeId,
          file_path: `${storeId}/certificado.pfx`,
          original_filename: originalFilename,
          uploaded_at: new Date().toISOString(),
          expires_at: expiresAt,
        },
        { onConflict: 'store_id' }
      );
      if (error) throw new Error(error.message);
    }

    if (typeof password === 'string' && password) {
      const { error } = await supabaseAdmin.from('store_fiscal_certificate_secrets').upsert(
        { store_id: storeId, password, updated_at: new Date().toISOString() },
        { onConflict: 'store_id' }
      );
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { storeId } = await req.json();

  if (typeof storeId !== 'string' || !UUID_RE.test(storeId)) {
    return NextResponse.json({ success: false, message: 'storeId inválido.' }, { status: 400 });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();

    const { data: certFiles, error: listError } = await supabaseAdmin.storage.from(CERT_BUCKET).list(storeId);
    if (listError) {
      return NextResponse.json({ success: false, message: listError.message }, { status: 500 });
    }
    if (certFiles && certFiles.length > 0) {
      const paths = certFiles.map((f) => `${storeId}/${f.name}`);
      const { error: removeError } = await supabaseAdmin.storage.from(CERT_BUCKET).remove(paths);
      if (removeError) return NextResponse.json({ success: false, message: removeError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
