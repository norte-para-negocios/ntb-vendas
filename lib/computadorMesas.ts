// Computador de mesas preso a uma loja (21/10/2026, pedido do dono: "não faz sentido ter o botão em todos os acessos...
// como a gente vai diferenciar de qual restaurante é? Para que cada computador não entre no restaurante errado").
// Antes, o botão "Mesas · Sem login" aparecia em todo aparelho e abria a loja do ÚLTIMO login (chave `ntb_mesas_loja`):
// quem tem acesso a duas lojas entrava na ODARA num PC do Sertão e as mesas daquele PC viravam as da ODARA.
// Agora a loja das mesas é uma escolha do aparelho (Configurações > Impressão > Tela de Mesas neste computador), e só
// o aparelho marcado mostra o botão, com o nome da loja. Login não muda mais essa escolha.

export type ComputadorMesas = { storeId: string; storeName: string; definidoPor: string; em: string };

const CHAVE = 'ntb-computador-mesas';
const CHAVE_ANTIGA = 'ntb_mesas_loja';
const CHAVE_SESSAO = 'ntb_store_session';

const ls = (): Storage | null => {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
};

export function lerComputadorMesas(): ComputadorMesas | null {
  try {
    const v = JSON.parse(ls()?.getItem(CHAVE) || 'null');
    if (!v || typeof v.storeId !== 'string' || !v.storeId) return null;
    return { storeId: v.storeId, storeName: typeof v.storeName === 'string' ? v.storeName : '', definidoPor: String(v.definidoPor ?? ''), em: String(v.em ?? '') };
  } catch {
    return null;
  }
}

/** null apaga (o botão some deste aparelho). */
export function salvarComputadorMesas(c: ComputadorMesas | null): void {
  try {
    if (c) ls()?.setItem(CHAVE, JSON.stringify(c)); else ls()?.removeItem(CHAVE);
  } catch { /* sem armazenamento */ }
  // A tela de entrada escuta para trocar o botão na hora.
  try { if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event('ntb-computador-mesas')); } catch { /* */ }
}

/**
 * Uma vez, na atualização: o aparelho que JÁ está na tela de Mesas (sessão `aberto`) fica preso à loja dela, para o
 * salão não parar; nos outros (PC do caixa, escritório) a chave antiga some e o botão também.
 * `nomeDaLoja`: string = loja ativa; null = loja desativada (não prende); undefined = não deu para conferir (sem
 * internet: prende assim mesmo, o nome entra depois).
 */
export async function migrarChaveAntiga(nomeDaLoja: (storeId: string) => Promise<string | null | undefined>): Promise<ComputadorMesas | null> {
  const s = ls();
  if (!s) return null;
  const atual = lerComputadorMesas();
  let sessaoMesas: string | null = null;
  try {
    const sessao = JSON.parse(s.getItem(CHAVE_SESSAO) || 'null');
    if (sessao?.aberto && typeof sessao.storeId === 'string') sessaoMesas = sessao.storeId;
  } catch { /* sessão ilegível */ }
  try { s.removeItem(CHAVE_ANTIGA); } catch { /* */ }
  if (atual) return atual;
  if (!sessaoMesas) return null;
  const nome = await nomeDaLoja(sessaoMesas).catch(() => undefined);
  if (nome === null) return null;
  const c: ComputadorMesas = { storeId: sessaoMesas, storeName: nome ?? '', definidoPor: 'atualização', em: new Date().toISOString() };
  salvarComputadorMesas(c);
  return c;
}

export function rotuloBotaoMesas(c: ComputadorMesas): string {
  return c.storeName ? `Mesas · ${c.storeName}` : 'Mesas';
}
