import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { gerarPdfNota, type LarguraPapelMm } from '@/lib/fiscal/pdf';

// Cupom fiscal (NFC-e autorizada) gerado SOB DEMANDA na largura do papel da
// impressora de destino (58/80mm/A4) — o PDF guardado no Storage é gerado uma
// vez só, na emissão, sem saber em qual impressora vai sair. Aqui regeramos a
// partir do XML autorizado já arquivado (nunca reemite nada na SEFAZ).
// Só serve NFC-e (modelo 65) 'autorizada'; qualquer outro caso responde 404 e o
// chamador cai no PDF guardado (ex.: contingência, NF-e).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LARGURAS: LarguraPapelMm[] = [58, 80, 210];

export async function GET(req: NextRequest) {
  const noteId = req.nextUrl.searchParams.get('noteId') ?? '';
  const largura = Number(req.nextUrl.searchParams.get('larguraMm')) as LarguraPapelMm;
  if (!UUID_RE.test(noteId) || !LARGURAS.includes(largura)) {
    return NextResponse.json({ success: false, message: 'Parâmetros inválidos.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: nota, error } = await admin
    .from('fiscal_notas')
    .select('modelo, status, xml_path')
    .eq('id', noteId)
    .maybeSingle();
  if (error) return NextResponse.json({ success: false, message: 'Falha ao buscar a nota.' }, { status: 500 });
  if (!nota || nota.modelo !== '65' || nota.status !== 'autorizada' || !nota.xml_path) {
    return NextResponse.json({ success: false, message: 'Nota não disponível para gerar cupom.' }, { status: 404 });
  }

  const { data: arquivo, error: dlErr } = await admin.storage.from('fiscal-documentos').download(nota.xml_path);
  if (dlErr || !arquivo) {
    return NextResponse.json({ success: false, message: 'XML da nota não encontrado.' }, { status: 404 });
  }

  const pdf = await gerarPdfNota('65', await arquivo.text(), largura);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' },
  });
}
