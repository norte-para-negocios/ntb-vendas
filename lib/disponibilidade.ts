import { supabase } from '@/lib/supabaseClient';

export type Disponibilidade = { id: string; available: boolean; sold_out: boolean };

// Leitura leve (só 3 colunas) para o refresh de 15 s do cardápio do garçom.
export async function fetchDisponibilidade(storeId: string): Promise<Disponibilidade[] | null> {
  const { data, error } = await supabase.from('products').select('id, available, sold_out').eq('store_id', storeId);
  if (error || !data) return null;
  return data.map((r: any) => ({ id: r.id, available: r.available !== false, sold_out: !!r.sold_out }));
}

// Funde a disponibilidade na lista atual: some quem ficou indisponível, atualiza esgotado; produto novo só aparece ao reabrir.
// Devolve a MESMA lista (referência) se nada mudou, para não re-renderizar à toa.
export function fundirDisponibilidade<P extends { id: string; sold_out?: boolean }>(produtos: P[], disp: Disponibilidade[]): P[] {
  const mapa = new Map(disp.map((d) => [d.id, d]));
  let mudou = false;
  const out: P[] = [];
  for (const p of produtos) {
    const d = mapa.get(p.id);
    if (!d) { out.push(p); continue; }
    if (!d.available) { mudou = true; continue; }
    if (!!p.sold_out !== d.sold_out) { mudou = true; out.push({ ...p, sold_out: d.sold_out }); } else out.push(p);
  }
  return mudou ? out : produtos;
}
