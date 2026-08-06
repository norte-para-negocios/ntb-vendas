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
// como `fiscal_notas` tinha `select using (true)` pra `anon` (migration 034,
// mesmo nível de sensibilidade de store_fiscal_certificates: CNPJ real,
// venda detalhada, valores), e o bucket é privado especificamente pra
// exigir "download só via signed URL sob demanda, nunca a URL pública
// direta" (comentário original da migration 034), esta rota sem validação
// desfazia essa fronteira: "eu sei/adivinho um caminho de arquivo" virava
// "eu consigo baixar o PDF real", sem precisar de nenhuma referência real
// em fiscal_notas.
//
// Achado de revisão MAIS FORTE (revisão final de branch, 2026-08-06): a
// correção original só checava "ALGUMA linha de fiscal_notas referencia
// esse path" — insuficiente por si só, porque `fiscal_notas` tinha SELECT
// público (migration 034), então bastava ler qualquer linha de QUALQUER
// loja pra descobrir um path válido e passar nessa checagem. A migration
// 039 já fecha esse SELECT público (fiscal_notas só é lida via
// `fetch_fiscal_notas_secure`, scoped por store_id), mas defesa em
// profundidade importa numa rota que lida com dado fiscal/pessoal real
// (CNPJ, endereço, e pra NF-e o CPF/nome reais do cliente): agora o caller
// precisa mandar o `noteId` específico, e a checagem confirma que o path
// pedido bate com o `pdf_path`/`xml_path` DAQUELA nota exata — não mais "de
// alguma nota qualquer". Isso também deixa pronto o lugar certo pra
// acrescentar uma checagem de `storeId` no futuro, se este projeto ganhar
// autenticação real por loja.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const pdfPath = body?.pdfPath;
  const noteId = body?.noteId;
  if (typeof pdfPath !== 'string' || !pdfPath) {
    return NextResponse.json({ success: false, message: 'pdfPath inválido.' }, { status: 400 });
  }
  if (typeof noteId !== 'string' || !noteId) {
    return NextResponse.json({ success: false, message: 'noteId inválido.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Busca a nota específica pelo id e confere que o path pedido é
  // EXATAMENTE o pdf_path OU xml_path gravado NESSA linha — não basta
  // existir em alguma linha qualquer da tabela.
  const { data: nota, error: notaErr } = await admin
    .from('fiscal_notas')
    .select('pdf_path, xml_path')
    .eq('id', noteId)
    .maybeSingle();
  if (notaErr) {
    return NextResponse.json({ success: false, message: 'Falha ao validar o caminho do arquivo.' }, { status: 500 });
  }
  if (!nota || (nota.pdf_path !== pdfPath && nota.xml_path !== pdfPath)) {
    return NextResponse.json({ success: false, message: 'Arquivo não encontrado.' }, { status: 404 });
  }

  const { data, error } = await admin.storage.from('fiscal-documentos').createSignedUrl(pdfPath, 60);
  if (error || !data) {
    return NextResponse.json({ success: false, message: error?.message || 'Falha ao gerar URL.' }, { status: 500 });
  }
  return NextResponse.json({ success: true, url: data.signedUrl });
}
