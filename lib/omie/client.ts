// lib/omie/client.ts
// Client Omie mínimo deste projeto — SEM o conceito de "loja de teste"
// que o ntb-estoque tem (ver AGENTS.md, seção "Lojas de Teste"): este
// caminho só é chamado depois de cStat=100 (nota real, autorizada pela
// SEFAZ), então "escrever de verdade" é sempre o comportamento
// desejado aqui. Testar este client precisa de credencial de
// sandbox/teste da própria Omie — nunca da chave de uma loja real.

const OMIE_BASE_URL = 'https://app.omie.com.br/api/';

export class OmieError extends Error {
  constructor(message: string, public readonly faultCode?: string) {
    super(message);
    this.name = 'OmieError';
  }
}

export async function omieRequest<T = unknown>(
  endpoint: string,
  call: string,
  data: Record<string, unknown>,
  credenciais: { appKey: string; appSecret: string }
): Promise<T> {
  const res = await fetch(`${OMIE_BASE_URL}${endpoint}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_key: credenciais.appKey, app_secret: credenciais.appSecret, call, param: [data] }),
  });

  const json = (await res.json().catch(() => null)) as (T & { faultstring?: string; faultcode?: string }) | null;
  if (!res.ok || (json && 'faultstring' in json && json.faultstring)) {
    throw new OmieError(json?.faultstring || `Omie HTTP ${res.status}`, json?.faultcode);
  }
  return json as T;
}
