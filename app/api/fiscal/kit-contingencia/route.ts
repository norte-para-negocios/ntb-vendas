import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import {
  carregarConfigFiscalDaLoja,
  carregarMetadadosCertificadoDaLoja,
  extrairCertificadoDaLoja,
} from '@/lib/fiscal/carregarCredenciaisFiscaisDaLoja';
import type { KitContingencia } from '@/lib/fiscal/emitirOffline';

// Kit da nota em contingência no computador da loja (ver lib/fiscal/emitirOffline.ts). Entrega certificado,
// CSC e dados do emitente SÓ para quem prova ser da loja com e-mail + senha (as mesmas funções de login, com o
// rate-limit delas) e pode receber pagamento: dono, gerente, quem tem a permissão de caixa, ou conta universal.
// Só NFC-e (modelo 65). Reserva para o computador (deviceId) uma série própria, 70..89, por loja e ambiente.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERIES_CONTINGENCIA = Array.from({ length: 20 }, (_, i) => 70 + i);

type Body = { storeId?: string; email?: string; password?: string; deviceId?: string };

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const storeId = body?.storeId ?? '';
  const deviceId = String(body?.deviceId ?? '');
  if (!UUID_RE.test(storeId) || !body?.email || !body?.password || !/^[\w-]{8,64}$/.test(deviceId)) {
    return NextResponse.json({ ok: false, reason: 'Parâmetros inválidos.' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();

  // 1. Quem pede: funcionário desta loja que pode receber, ou conta universal.
  let autorizado = false;
  const { data: loja } = await admin.rpc('authenticate_store_user_secure', { p_email: body.email, p_password: body.password });
  const u = (loja as { success?: boolean; user?: { store_id?: string; role?: string; permissions?: Record<string, unknown> } } | null);
  if (u?.success && u.user?.store_id === storeId) {
    const r = u.user.role;
    autorizado = r === 'owner' || r === 'manager' || r === 'gerente' || u.user.permissions?.caixa === true;
  }
  if (!autorizado && !(u?.success)) {
    const { data: uni } = await admin.rpc('authenticate_universal_user_secure', { p_email: body.email, p_password: body.password });
    autorizado = Boolean((uni as { success?: boolean } | null)?.success);
  }
  if (!autorizado) return NextResponse.json({ ok: false, reason: 'Sem permissão para a nota sem internet.' }, { status: 403 });

  // 2. Loja emite NFC-e automática, com CSC e certificado.
  const config = await carregarConfigFiscalDaLoja(admin, storeId);
  if (!config || config.modelo_emissao_automatica !== 'nfce') {
    return NextResponse.json({ ok: true, semNota: true, reason: 'Loja sem NFC-e automática.' });
  }
  const ambiente = config.ambiente;
  const { data: segredo } = await admin
    .from('store_fiscal_config_secrets')
    .select('csc_homologacao, cscid_homologacao, csc_producao, cscid_producao')
    .eq('store_id', storeId)
    .maybeSingle();
  const csc = ambiente === 'homologacao' ? segredo?.csc_homologacao : segredo?.csc_producao;
  const idCsc = ambiente === 'homologacao' ? segredo?.cscid_homologacao : segredo?.cscid_producao;
  if (!csc || !idCsc) return NextResponse.json({ ok: true, semNota: true, reason: 'CSC não cadastrado.' });
  const meta = await carregarMetadadosCertificadoDaLoja(admin, storeId);
  if (!meta) return NextResponse.json({ ok: true, semNota: true, reason: 'Loja sem certificado.' });
  const cert = await extrairCertificadoDaLoja(admin, meta);
  const { data: storeRow } = await admin.from('stores').select('cnpj, name').eq('id', storeId).maybeSingle();
  const cnpjLoja = String(storeRow?.cnpj || '').replace(/\D/g, '');
  if (!cnpjLoja || (cert.cnpjCertificado && cert.cnpjCertificado !== cnpjLoja)) {
    return NextResponse.json({ ok: true, semNota: true, reason: 'Certificado não corresponde ao CNPJ da loja.' });
  }
  const { data: produtoTaxa } = await admin
    .from('products')
    .select('name, omie_codigo, ncm')
    .eq('store_id', storeId)
    .eq('fee_type', 'percent')
    .not('omie_codigo', 'is', null)
    .limit(1)
    .maybeSingle();

  // 3. Série do computador (reaproveita a que ele já tem).
  let { data: serieRow } = await admin
    .from('fiscal_contingencia_series')
    .select('serie, ultimo_numero')
    .eq('store_id', storeId).eq('device_id', deviceId).eq('ambiente', ambiente)
    .maybeSingle();
  if (!serieRow) {
    const { data: usadas } = await admin.from('fiscal_contingencia_series').select('serie').eq('store_id', storeId).eq('ambiente', ambiente);
    const ocupadas = new Set<number>([...(usadas ?? []).map((r) => r.serie as number), Number(config.nfce_serie) || 0, Number(config.nfce_serie_producao) || 0]);
    for (const s of SERIES_CONTINGENCIA.filter((x) => !ocupadas.has(x))) {
      const { data, error } = await admin.from('fiscal_contingencia_series')
        .insert({ store_id: storeId, device_id: deviceId, ambiente, serie: s })
        .select('serie, ultimo_numero').single();
      if (!error && data) { serieRow = data; break; }
    }
    if (!serieRow) return NextResponse.json({ ok: false, reason: 'Sem série livre para este computador.' }, { status: 409 });
  }

  // Número nunca volta: o maior entre o contador da série e qualquer nota já gravada nela (ex.: PC reinstalado).
  const { data: maiorNota } = await admin.from('fiscal_notas').select('numero')
    .eq('store_id', storeId).eq('modelo', '65').eq('ambiente', ambiente).eq('serie', serieRow.serie)
    .order('numero', { ascending: false }).limit(1).maybeSingle();
  const ultimoNumero = Math.max(Number(serieRow.ultimo_numero) || 0, Number(maiorNota?.numero) || 0);

  const endereco = [
    [config.endereco_logradouro, config.endereco_numero].filter(Boolean).join(', '),
    config.endereco_bairro,
    [config.endereco_cidade, config.endereco_uf].filter(Boolean).join('/'),
  ].filter(Boolean).join(' - ');

  const kit: KitContingencia = {
    versao: 1,
    storeId,
    deviceId,
    nomeLoja: storeRow?.name || '',
    cnpjLoja,
    endereco,
    config: {
      ambiente,
      inscricao_estadual: config.inscricao_estadual,
      razao_social: config.razao_social,
      endereco_logradouro: config.endereco_logradouro,
      endereco_numero: config.endereco_numero,
      endereco_bairro: config.endereco_bairro,
      endereco_cidade: config.endereco_cidade,
      endereco_uf: config.endereco_uf,
      endereco_cep: config.endereco_cep,
      cst_csosn_padrao: config.cst_csosn_padrao,
      cst_pis_padrao: config.cst_pis_padrao,
      cst_cofins_padrao: config.cst_cofins_padrao,
      cnpj_autorizado: config.cnpj_autorizado,
      telefone: config.telefone,
    },
    produtoTaxa: (produtoTaxa as KitContingencia['produtoTaxa']) ?? null,
    csc,
    idCsc,
    certPem: cert.certPem,
    keyPem: cert.keyPem,
    serie: serieRow.serie as number,
    ultimoNumero,
    geradoEm: new Date().toISOString(),
  };
  return NextResponse.json({ ok: true, kit }, { headers: { 'Cache-Control': 'no-store' } });
}
