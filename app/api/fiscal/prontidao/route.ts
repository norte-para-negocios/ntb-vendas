import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// Checklist "pronto pra emitir" por ambiente. Os CSC ficam em
// store_fiscal_config_secrets (write-only pro painel): aqui só devolve SE
// existem, nunca o valor.
export async function GET(request: NextRequest) {
  const storeId = request.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ ok: false, reason: 'storeId ausente' }, { status: 400 });
  const admin = getSupabaseAdmin();
  const [{ data: cfg }, { data: sec }, { data: cert }] = await Promise.all([
    admin.from('store_fiscal_config').select('ambiente, modelo_emissao_automatica, nfce_serie, nfce_serie_producao, nfe_serie, nfe_serie_producao').eq('store_id', storeId).maybeSingle(),
    admin.from('store_fiscal_config_secrets').select('csc_homologacao, cscid_homologacao, csc_producao, cscid_producao').eq('store_id', storeId).maybeSingle(),
    admin.from('store_fiscal_certificates').select('expires_at').eq('store_id', storeId).maybeSingle(),
  ]);
  const certificadoValido = Boolean(cert && (!cert.expires_at || new Date(cert.expires_at).getTime() > Date.now()));
  return NextResponse.json({
    ok: true,
    ambiente: cfg?.ambiente ?? 'homologacao',
    certificadoValido,
    certificadoVenceEm: cert?.expires_at ?? null,
    cscHomologacao: Boolean(sec?.csc_homologacao && sec?.cscid_homologacao),
    cscProducao: Boolean(sec?.csc_producao && sec?.cscid_producao),
    serieHomologacao: cfg?.modelo_emissao_automatica === 'nfe' ? cfg?.nfe_serie ?? null : cfg?.nfce_serie ?? null,
    serieProducao: cfg?.modelo_emissao_automatica === 'nfe' ? cfg?.nfe_serie_producao ?? null : cfg?.nfce_serie_producao ?? null,
  });
}
