import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// Signed URL sob demanda pro PDF (DANFE/DANFCe) de uma nota fiscal já
// autorizada — o bucket fiscal-documentos é privado (sem policy de select
// pra anon, ver supabase/migrations/034_fiscal_notas_e_emissao_automatica.sql,
// mesmo padrão de store-certificates), então baixar o arquivo do painel do
// lojista precisa passar por uma rota de servidor com a service role key.
// 60s de validade: só o tempo de abrir a aba nova que dispara o download,
// não fica vivo depois disso.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const pdfPath = body?.pdfPath;
  if (typeof pdfPath !== 'string' || !pdfPath) {
    return NextResponse.json({ success: false, message: 'pdfPath inválido.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.storage.from('fiscal-documentos').createSignedUrl(pdfPath, 60);
  if (error || !data) {
    return NextResponse.json({ success: false, message: error?.message || 'Falha ao gerar URL.' }, { status: 500 });
  }
  return NextResponse.json({ success: true, url: data.signedUrl });
}
