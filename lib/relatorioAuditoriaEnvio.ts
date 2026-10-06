// Agendamento + envio do relatório diário de auditoria (00:00 America/Sao_Paulo). Ver lib/relatorioAuditoria.ts.
// Configuração por env do servidor (nada disso vai para o repositório):
//   AUDIT_REPORT_SEND=1                  liga o ENVIO (sem isso só gera e registra no log)
//   AUDIT_REPORT_DESTINOS='[{"storeId":"...","numero":"5571...","nome":"Ramon"}]'
//   AUDIT_EVOLUTION_URL / AUDIT_EVOLUTION_KEY / AUDIT_EVOLUTION_INSTANCE   (Evolution API do WhatsApp)
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { montarRelatorioDia } from '@/lib/relatorioAuditoria';
import { gerarPdfAuditoria } from '@/lib/relatorioAuditoriaPdf';

type Destino = { storeId: string; numero: string; nome?: string };

export const diaDeBrasilia = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d); // AAAA-MM-DD
export const ontemDeBrasilia = () => diaDeBrasilia(new Date(Date.now() - 24 * 3600 * 1000));

function destinos(): Destino[] {
  try { const v = JSON.parse(process.env.AUDIT_REPORT_DESTINOS || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

async function evolution(caminho: string, corpo: unknown) {
  const url = process.env.AUDIT_EVOLUTION_URL, key = process.env.AUDIT_EVOLUTION_KEY, inst = process.env.AUDIT_EVOLUTION_INSTANCE;
  if (!url || !key || !inst) throw new Error('Evolution não configurada (AUDIT_EVOLUTION_*)');
  const r = await fetch(`${url}/message/${caminho}/${inst}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`Evolution ${caminho} respondeu ${r.status}`);
}

export async function enviarRelatorioDoDia(dest: Destino, dia: string, opts: { forcar?: boolean } = {}): Promise<{ enviado: boolean; motivo?: string }> {
  const admin = getSupabaseAdmin();
  if (!opts.forcar) {
    const { data: jaFoi } = await admin.from('staff_audit_log').select('id').eq('store_id', dest.storeId).eq('action', 'relatorio.enviado').eq('entity_id', dia).limit(1);
    if (jaFoi && jaFoi.length) return { enviado: false, motivo: 'já enviado' };
  }
  const { data: loja } = await admin.from('stores').select('name').eq('id', dest.storeId).maybeSingle();
  const nomeLoja = loja?.name || 'Loja';
  const rel = await montarRelatorioDia(admin, dest.storeId, nomeLoja, dia);
  const pdf = await gerarPdfAuditoria({ loja: nomeLoja, dia, secoes: rel.secoes });
  await evolution('sendText', { number: dest.numero, text: rel.texto });
  await evolution('sendMedia', { number: dest.numero, mediatype: 'document', mimetype: 'application/pdf', fileName: `Auditoria ${dia}.pdf`, media: pdf.toString('base64') });
  await admin.from('staff_audit_log').insert({ store_id: dest.storeId, actor_name: 'Sistema', action: 'relatorio.enviado', entity: 'relatorio', entity_id: dia, summary: `Relatório do dia ${dia} enviado para ${dest.nome || dest.numero}`, origin: 'server' });
  return { enviado: true };
}

// Chamado a cada minuto: entre 00:00 e 00:30 (Brasília) envia o relatório de ontem, uma vez por loja.
export async function verificarEnvioDiario() {
  if (process.env.AUDIT_REPORT_SEND !== '1') return;
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  const [h, m] = hora.split(':').map(Number);
  if (h !== 0 || m > 30) return;
  for (const d of destinos()) {
    try {
      const r = await enviarRelatorioDoDia(d, ontemDeBrasilia());
      if (r.enviado) console.log(`Relatório de auditoria enviado (${d.storeId}).`);
    } catch (e) { console.error('Relatório de auditoria: falha no envio:', e); }
  }
}
