// Computador de mesas preso a uma loja (21/10/2026, pedido do dono: "não faz sentido ter o botão em todos os acessos...
// como a gente vai diferenciar de qual restaurante é? Para que cada computador não entre no restaurante errado").
// Antes, o botão "Mesas · Sem login" aparecia em todo aparelho e abria a loja do ÚLTIMO login (chave `ntb_mesas_loja`):
// quem tem acesso a duas lojas entrava na ODARA num PC do Sertão e as mesas daquele PC viravam as da ODARA.
// Agora a loja das mesas é uma escolha do aparelho (Configurações > Impressão > Tela de Mesas neste computador), e só
// o aparelho marcado mostra o botão, com o nome da loja. Login não muda mais essa escolha.

export type ComputadorMesas = { storeId: string; storeName: string; definidoPor: string; em: string };

const CHAVE = 'ntb-computador-mesas';
const CHAVE_ANTIGA = 'ntb_mesas_loja';

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

/** Loja da chave antiga (`ntb_mesas_loja`) enquanto o aparelho ainda não passou pela migração. */
export function chaveAntiga(): string | null {
  try { return ls()?.getItem(CHAVE_ANTIGA) || null; } catch { return null; }
}

/**
 * Uma vez por aparelho, na primeira vez que se sabe o que ele é depois de atualizar (sessão restaurada ou login):
 * o aparelho que está na tela de Mesas (`lojaEmMesas`) fica preso a essa loja, para o salão não parar; o que entrou
 * com uma pessoa (caixa, escritório) perde o botão. Sem a chave antiga não faz nada: depois de migrado, só a escolha em
 * Configurações muda o aparelho (garçom logar num PC não marca mais).
 */
export function migrarChaveAntiga(lojaEmMesas: { storeId: string; storeName: string } | null): ComputadorMesas | null {
  const s = ls();
  const atual = lerComputadorMesas();
  if (!s || chaveAntiga() == null) return atual;
  try { s.removeItem(CHAVE_ANTIGA); } catch { /* */ }
  if (atual) return atual;
  if (!lojaEmMesas) { salvarComputadorMesas(null); return null; }
  const c: ComputadorMesas = { storeId: lojaEmMesas.storeId, storeName: lojaEmMesas.storeName, definidoPor: 'atualização', em: new Date().toISOString() };
  salvarComputadorMesas(c);
  return c;
}

export function rotuloBotaoMesas(c: ComputadorMesas): string {
  return c.storeName ? `Mesas · ${c.storeName}` : 'Mesas';
}
