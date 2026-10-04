// lib/omieEnvio.ts — resultado do envio da NFC-e autorizada ao Omie (ImportarNFCe), para gravar na nota (fiscal_notas.omie_status).
// Antes: o fetch ao Estoque não olhava a resposta (a rota dele responde HTTP 200 até quando falha) e o erro só ia pro log.
// Puro e testado em scripts/testes/omieEnvioNfce.test.ts.
export type StatusEnvioOmie = 'ok' | 'na_fila' | 'ignorada' | 'erro';
export interface ResultadoEnvioOmie { status: StatusEnvioOmie; erro?: string }

export const ENVIO_OMIE_OK: ResultadoEnvioOmie = { status: 'ok' };

const corta = (s: string) => (s.length > 480 ? `${s.slice(0, 480)}…` : s);

/** Resposta de POST /api/integracao/nota-fiscal do Estoque. */
export function interpretarEnvioNfceEstoque(httpStatus: number, json: unknown): ResultadoEnvioOmie {
  const b = (json ?? null) as { ok?: boolean; naFila?: boolean; skipped?: boolean; reason?: string; error?: string } | null;
  if (httpStatus !== 200) return { status: 'erro', erro: corta(b?.error || b?.reason || `O Estoque respondeu HTTP ${httpStatus}`) };
  if (b?.skipped) return { status: 'ignorada', erro: corta(b.reason || 'O Estoque não registrou a nota (nada a fazer)') };
  if (b?.ok === true) return ENVIO_OMIE_OK;
  if (b?.ok === false) {
    return b.naFila
      ? { status: 'na_fila', erro: corta(b.reason || 'Falha temporária; o Estoque reenvia sozinho') }
      : { status: 'erro', erro: corta(b.reason || 'O Estoque não conseguiu registrar a nota no Omie') };
  }
  return { status: 'erro', erro: 'Resposta do Estoque não reconhecida: não dá para afirmar que a nota foi registrada no Omie' };
}

/** Exceção (rede fora do ar, Omie direto recusou...). */
export function interpretarErroEnvioNfce(e: unknown): ResultadoEnvioOmie {
  return { status: 'erro', erro: corta(e instanceof Error ? e.message : String(e)) };
}
