import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// Exporta em lote (ZIP: XMLs + CSV índice) as notas fiscais de UMA loja num
// intervalo de datas — pro contador baixar tudo de uma vez em vez de nota
// por nota. Mesmo bucket privado (`fiscal-documentos`, sem policy de select
// pra anon) e o mesmo motivo de sensibilidade já documentados em
// app/api/fiscal/pdf-url/route.ts (CNPJ real, e pra NF-e o CPF/nome reais
// do cliente, valor de venda) — só que aqui o "raio de explosão" de um bug
// de escopo é muito maior: em vez de vazar 1 documento por chamada, vazaria
// TODAS as notas de qualquer loja que o atacante conseguisse nomear.
//
// Por isso este endpoint NUNCA aceita uma lista de ids/paths do client
// (nem `noteIds`, nem `paths` — não existe esse parâmetro aqui de
// propósito). O único jeito de o caller influenciar quais notas saem no
// ZIP é `storeId` + intervalo de datas; o conjunto de notas em si é sempre
// resolvido aqui dentro, direto contra `fiscal_notas where store_id = $1
// and created_at between $2 and $3`, usando a service role key (que ignora
// RLS de qualquer forma — o filtro de `store_id` explícito na query é a
// única fronteira real, exatamente como `fetch_fiscal_notas_secure`
// (migration 039) faz do lado das RPCs). Isso torna estruturalmente
// impossível pedir "as notas da loja X" e receber notas de outra loja,
// mesmo que o caller tente forjar um id de nota de outra loja em algum
// outro campo — não existe campo pra isso.
export const maxDuration = 60;

interface FiscalNotaRow {
  chave_acesso: string | null;
  numero: number | null;
  serie: number | null;
  valor_total: number | null;
  status: string;
  xml_path: string | null;
  created_at: string;
}

// Defesa contra CSV injection (Excel/Sheets interpretam célula começando
// com =, +, -, @ como fórmula) — nenhum campo aqui vem de input do
// usuário final (são todos gerados pelo sistema: chave numérica, número
// sequencial, série, valor, status de um enum fixo), mas os campos de
// texto livre mais prováveis de um dia ganhar essa risco (status, se
// virar customizável) já passam por aqui por precaução, e a função fica
// pronta pra qualquer campo novo que vier a ser adicionado ao CSV no
// futuro.
function csvSafe(value: string): string {
  if (/^[=+\-@]/.test(value)) return `'${value}`;
  return value;
}

function csvEscape(value: string): string {
  const safe = csvSafe(value);
  if (/[",\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function formatDateForCsv(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR');
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get('storeId');
  const startDate = searchParams.get('startDate'); // 'YYYY-MM-DD', opcional
  const endDate = searchParams.get('endDate'); // 'YYYY-MM-DD', opcional

  if (typeof storeId !== 'string' || !storeId) {
    return NextResponse.json({ success: false, message: 'storeId inválido.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Única fonte de verdade de "quais notas entram no ZIP" — sempre scoped
  // por store_id, nunca por uma lista que o client tenha mandado. Faixa de
  // data é opcional (exportar o histórico inteiro da loja se nenhuma vier).
  let query = admin
    .from('fiscal_notas')
    .select('chave_acesso, numero, serie, valor_total, status, xml_path, created_at')
    .eq('store_id', storeId)
    .order('created_at', { ascending: true });

  if (startDate) {
    query = query.gte('created_at', `${startDate}T00:00:00`);
  }
  if (endDate) {
    query = query.lte('created_at', `${endDate}T23:59:59.999`);
  }

  const { data: notas, error } = await query;
  if (error) {
    return NextResponse.json({ success: false, message: 'Falha ao buscar notas fiscais.' }, { status: 500 });
  }

  const rows = (notas ?? []) as FiscalNotaRow[];

  const zip = new JSZip();
  const xmlFolder = zip.folder('xmls');

  const csvHeader = 'data,numero,serie,chave_acesso,valor_total,status';
  const csvLines = [csvHeader];

  for (const nota of rows) {
    csvLines.push([
      csvEscape(formatDateForCsv(nota.created_at)),
      csvEscape(String(nota.numero ?? '')),
      csvEscape(String(nota.serie ?? '')),
      csvEscape(nota.chave_acesso ?? ''),
      csvEscape(nota.valor_total != null ? nota.valor_total.toFixed(2) : ''),
      csvEscape(nota.status),
    ].join(','));

    // Nem toda nota tem XML (ex.: 'pendente'/'erro' antes de autorizar) —
    // essas só entram no CSV, sem entrada correspondente na pasta de XMLs.
    if (!nota.xml_path || !nota.chave_acesso) continue;

    const { data: xmlBlob, error: downloadError } = await admin.storage
      .from('fiscal-documentos')
      .download(nota.xml_path);
    if (downloadError || !xmlBlob) {
      // Um XML individual faltando/corrompido no Storage não deve derrubar
      // a exportação inteira — a nota continua no CSV, só sem o arquivo.
      continue;
    }
    const xmlBuffer = Buffer.from(await xmlBlob.arrayBuffer());
    xmlFolder?.file(`${nota.chave_acesso}.xml`, xmlBuffer);
  }

  zip.file('notas.csv', csvLines.join('\n'));

  const zipBuffer = await zip.generateAsync({ type: 'uint8array' });
  const zipBlob = new Blob([zipBuffer as unknown as BlobPart], { type: 'application/zip' });
  const filenameRange = startDate || endDate ? `_${startDate || 'inicio'}_a_${endDate || 'hoje'}` : '';

  return new NextResponse(zipBlob, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="notas-fiscais${filenameRange}.zip"`,
    },
  });
}
