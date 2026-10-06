import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { montarRelatorioDia, resumoDoDia } from '@/lib/relatorioAuditoria';
import { validarTokenRelatorio } from '@/lib/relatorioLink';
import RelatorioView from './RelatorioView';

// Relatório diário de auditoria — página privada (link assinado, ver lib/relatorioLink.ts). Nunca indexada.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Auditoria do dia · Norte Vendas', robots: { index: false, follow: false } };

export default async function RelatorioPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ok = validarTokenRelatorio(decodeURIComponent(token));
  if (!ok) notFound();
  const admin = getSupabaseAdmin();
  const { data: loja } = await admin.from('stores').select('name').eq('id', ok.storeId).maybeSingle();
  if (!loja) notFound();
  const rel = await montarRelatorioDia(admin, ok.storeId, loja.name, ok.dia);
  const geradoEm = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date());
  return <RelatorioView loja={loja.name} dia={ok.dia} geradoEm={geradoEm} secoes={rel.secoes} resumo={resumoDoDia(rel.secoes)} />;
}
