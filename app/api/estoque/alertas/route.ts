// app/api/estoque/alertas/route.ts
// Alerta de estoque baixo (2026-10-03): cruza o limite de cada produto (products.stock_alert_threshold,
// definido pelo lojista) com o saldo atual do ntb-estoque (Omie). Sem integração ativa ou sem produto
// com limite, devolve lista vazia — nunca erro, é um aviso opcional do painel.
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { filterLowStockProducts } from '@/lib/calc';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const storeId = request.nextUrl.searchParams.get('storeId') ?? '';
  if (!UUID_RE.test(storeId)) return NextResponse.json({ alerts: [] });

  const admin = getSupabaseAdmin();
  try {
    const [{ data: produtos }, { data: segredo }] = await Promise.all([
      admin.from('products').select('name, omie_codigo, stock_alert_threshold')
        .eq('store_id', storeId).eq('available', true).not('omie_codigo', 'is', null).not('stock_alert_threshold', 'is', null),
      admin.from('store_ntb_estoque_secrets').select('ntb_estoque_url, ntb_estoque_api_key, ativo').eq('store_id', storeId).maybeSingle(),
    ]);
    if (!produtos?.length || !segredo?.ativo) return NextResponse.json({ alerts: [] });

    const codigos = Array.from(new Set(produtos.map((p) => String(p.omie_codigo))));
    const res = await fetch(`${String(segredo.ntb_estoque_url).replace(/\/$/, '')}/api/integracao/saldo?codigos=${encodeURIComponent(codigos.join(','))}`, {
      headers: { Authorization: `Bearer ${segredo.ntb_estoque_api_key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NextResponse.json({ alerts: [] });
    const { saldos } = (await res.json()) as { saldos: { codigo: string; saldo: number }[] };
    const saldoPorCodigo = new Map(saldos.map((s) => [String(s.codigo), Number(s.saldo)]));

    const comSaldo = produtos.map((p) => ({
      name: p.name as string,
      omie_codigo: String(p.omie_codigo),
      stock_alert_threshold: p.stock_alert_threshold as number,
      current_stock: saldoPorCodigo.has(String(p.omie_codigo)) ? saldoPorCodigo.get(String(p.omie_codigo))! : null,
    }));
    const alerts = filterLowStockProducts(comSaldo)
      .map((p) => ({ name: p.name, stock: p.current_stock, threshold: p.stock_alert_threshold }))
      .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0));
    return NextResponse.json({ alerts });
  } catch (e) {
    console.error('alertas de estoque falharam:', e);
    return NextResponse.json({ alerts: [] });
  }
}
