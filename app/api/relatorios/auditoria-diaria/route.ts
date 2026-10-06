import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { montarRelatorioDia } from '@/lib/relatorioAuditoria';
import { gerarPdfAuditoria } from '@/lib/relatorioAuditoriaPdf';

// Relatório de auditoria de um dia. Protegido por token do servidor (AUDIT_REPORT_TOKEN): o relatório lista tudo que a equipe
// fez, então não pode ficar aberto como as outras rotas do app. GET ?storeId=...&dia=AAAA-MM-DD&formato=pdf|texto
export async function GET(req: NextRequest) {
  const token = process.env.AUDIT_REPORT_TOKEN;
  const recebido = req.headers.get('x-relatorio-token') ?? '';
  if (!token || recebido.length !== token.length || !timingSafeEqual(Buffer.from(recebido), Buffer.from(token))) return NextResponse.json({ ok: false }, { status: 404 });
  const storeId = req.nextUrl.searchParams.get('storeId') ?? '';
  const dia = req.nextUrl.searchParams.get('dia') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(storeId) || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return NextResponse.json({ ok: false, message: 'Parâmetros inválidos.' }, { status: 400 });
  const admin = getSupabaseAdmin();
  const { data: loja } = await admin.from('stores').select('name').eq('id', storeId).maybeSingle();
  if (!loja) return NextResponse.json({ ok: false, message: 'Loja não encontrada.' }, { status: 404 });
  const rel = await montarRelatorioDia(admin, storeId, loja.name, dia);
  if (req.nextUrl.searchParams.get('formato') === 'pdf') {
    const pdf = await gerarPdfAuditoria({ loja: loja.name, dia, secoes: rel.secoes });
    return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json({ ok: true, texto: rel.texto, eventos: rel.eventos.length, secoes: rel.secoes.map((s) => ({ nome: s.nome, papel: s.papel, total: s.total, alertas: s.alertas })) });
}
