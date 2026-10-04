// lib/omieEnvioServidor.ts — envio da NFC-e autorizada ao Omie e registro do resultado na nota (migration 157).
// Servidor apenas (service role). Regras de interpretação em lib/omieEnvio.ts (testadas).
import type { SupabaseClient } from '@supabase/supabase-js';
import { incluirNfceDireto, type IncluirNfcePayload } from '@/lib/omie/nota-fiscal';
import { interpretarEnvioNfceEstoque, interpretarErroEnvioNfce, ENVIO_OMIE_OK, type ResultadoEnvioOmie } from '@/lib/omieEnvio';

/** Grava o resultado do envio ao Omie na nota. Nunca muda o status fiscal da nota. */
export async function registrarEnvioOmie(admin: SupabaseClient, notaId: string | null, r: ResultadoEnvioOmie) {
  if (!notaId) { console.error('Envio da NFC-e ao Omie: nota sem id para registrar o resultado:', r); return; }
  const { error } = await admin.from('fiscal_notas').update({ omie_status: r.status, omie_erro: r.erro ?? null, omie_em: new Date().toISOString() }).eq('id', notaId);
  if (error) console.error('Envio da NFC-e ao Omie: falha ao gravar o resultado na nota:', error.message);
}

/**
 * Caminho A: loja com NTB Estoque ativo (rota /api/integracao/nota-fiscal dele, que responde 200 até quando falha: o corpo
 * é que manda). Caminho B: loja só com chave Omie direta. Nem A nem B: loja sem Omie, nada a registrar.
 * O resultado (ok / na fila do Estoque / erro) é gravado na nota; nunca lança.
 */
export async function enviarNfceAutorizadaAoOmie(admin: SupabaseClient, storeId: string, notaId: string | null, payload: IncluirNfcePayload): Promise<ResultadoEnvioOmie | null> {
  try {
    const { data: ntbEstoqueSecret } = await admin
      .from('store_ntb_estoque_secrets')
      .select('ntb_estoque_url, ntb_estoque_api_key, ativo')
      .eq('store_id', storeId)
      .maybeSingle();

    if (ntbEstoqueSecret?.ativo) {
      const res = await fetch(`${ntbEstoqueSecret.ntb_estoque_url.replace(/\/$/, '')}/api/integracao/nota-fiscal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ntbEstoqueSecret.ntb_estoque_api_key}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      });
      const json = await res.json().catch(() => null);
      const r = interpretarEnvioNfceEstoque(res.status, json);
      await registrarEnvioOmie(admin, notaId, r);
      return r;
    }

    const { data: omieSecret } = await admin
      .from('store_omie_secrets')
      .select('omie_app_key, omie_app_secret')
      .eq('store_id', storeId)
      .maybeSingle();
    if (omieSecret) {
      await incluirNfceDireto({ appKey: omieSecret.omie_app_key, appSecret: omieSecret.omie_app_secret }, payload);
      await registrarEnvioOmie(admin, notaId, ENVIO_OMIE_OK);
      return ENVIO_OMIE_OK;
    }
    return null;
  } catch (e) {
    console.error('Envio de NFC-e pra Omie falhou (nota já autorizada, sem impacto no status):', e);
    const r = interpretarErroEnvioNfce(e);
    await registrarEnvioOmie(admin, notaId, r).catch(() => {});
    return r;
  }
}
