import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// Signed URL sob demanda pro PDF (DANFE/DANFCe) de uma nota fiscal já
// autorizada — o bucket fiscal-documentos é privado (sem policy de select
// pra anon, ver supabase/migrations/034_fiscal_notas_e_emissao_automatica.sql,
// mesmo padrão de store-certificates), então baixar o arquivo do painel do
// lojista precisa passar por uma rota de servidor com a service role key.
// 60s de validade: só o tempo de abrir a aba nova que dispara o download,
// não fica vivo depois disso.
//
// Achado de revisão (Task 16, 2026-08-05): sem a checagem abaixo, esta rota
// aceitava QUALQUER string como `pdfPath` e assinava com a service role —
// como `fiscal_notas` tem `select using (true)` pra `anon` (migration 034,
// mesmo nível de sensibilidade de store_fiscal_certificates: CNPJ real,
// venda detalhada, valores), e o bucket é privado especificamente pra
// exigir "download só via signed URL sob demanda, nunca a URL pública
// direta" (comentário original da migration 034), esta rota sem validação
// desfazia essa fronteira: "eu sei/adivinho um caminho de arquivo" virava
// "eu consigo baixar o PDF real", sem precisar de nenhuma referência real
// em fiscal_notas. Corrigido: só assina se o path pedido bater com o
// pdf_path OU xml_path de ALGUMA linha real de fiscal_notas — não precisa
// saber de qual loja (não há sessão/loja autenticada nesta rota mesmo), só
// impede sondar o bucket inteiro com paths arbitrários/adivinhados.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const pdfPath = body?.pdfPath;
  if (typeof pdfPath !== 'string' || !pdfPath) {
    return NextResponse.json({ success: false, message: 'pdfPath inválido.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Duas queries `.eq()` parametrizadas em vez de um único `.or()` com
  // `pdfPath` interpolado na string do filtro — `pdfPath` vem direto do
  // body da requisição (não confiável) e o PostgREST não escapa o valor de
  // dentro de `.or('coluna.eq.<valor>', ...)` sozinho; um valor com vírgula/
  // parênteses poderia distorcer o filtro combinado. `.eq()` normal passa
  // o valor como parâmetro de verdade, sem esse risco.
  const [porPdf, porXml] = await Promise.all([
    admin.from('fiscal_notas').select('id').eq('pdf_path', pdfPath).limit(1).maybeSingle(),
    admin.from('fiscal_notas').select('id').eq('xml_path', pdfPath).limit(1).maybeSingle(),
  ]);
  if (porPdf.error || porXml.error) {
    return NextResponse.json({ success: false, message: 'Falha ao validar o caminho do arquivo.' }, { status: 500 });
  }
  if (!porPdf.data && !porXml.data) {
    return NextResponse.json({ success: false, message: 'Arquivo não encontrado.' }, { status: 404 });
  }

  const { data, error } = await admin.storage.from('fiscal-documentos').createSignedUrl(pdfPath, 60);
  if (error || !data) {
    return NextResponse.json({ success: false, message: error?.message || 'Falha ao gerar URL.' }, { status: 500 });
  }
  return NextResponse.json({ success: true, url: data.signedUrl });
}
