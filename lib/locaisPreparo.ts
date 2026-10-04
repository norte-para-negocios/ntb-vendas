// lib/locaisPreparo.ts — locais de preparo (Cozinha, Bar e setores como Pizzaria): lista única + checklist de pendências.
// A chave é a MESMA de lib/setores.ts (chaveDestinoEstoque): 'kitchen' | 'bar' | 'setor:<id>'.
export type BaseLocal = 'kitchen' | 'bar';
export interface SetorLike { id: string; name: string; base: BaseLocal }
export interface LocalPreparo { chave: string; nome: string; base: BaseLocal; setorId: string | null }

export const chaveLocal = (setorId: string | null, base: BaseLocal): string => (setorId ? `setor:${setorId}` : base);

// Cozinha/Bar só entram se o módulo (kitchen_kds / bar_kds) da loja está ligado; setores sempre entram.
export function listarLocais(setores: SetorLike[], modulos: { cozinha: boolean; bar: boolean }): LocalPreparo[] {
  const out: LocalPreparo[] = [];
  if (modulos.cozinha) out.push({ chave: 'kitchen', nome: 'Cozinha', base: 'kitchen', setorId: null });
  if (modulos.bar) out.push({ chave: 'bar', nome: 'Bar', base: 'bar', setorId: null });
  setores.forEach((s) => out.push({ chave: chaveLocal(s.id, s.base), nome: s.name, base: s.base, setorId: s.id }));
  return out;
}

export type EstadoItem = 'ok' | 'aviso' | 'falta';
export interface ItemChecklist { id: 'categorias' | 'impressora' | 'estoque'; estado: EstadoItem; texto: string }
export interface StatusLocal { itens: ItemChecklist[]; completo: boolean; recebePedidos: boolean }

export interface DadosStatusLocal {
  local: LocalPreparo;
  impressoras: { sector_id?: string | null; is_active: boolean; destination?: string | null }[];
  /** `null` = loja sem integração com o Estoque (nada a vincular). */
  mapaEstoque: Record<string, number> | null;
  categoriasDoLocal: number;
  produtosDoLocal: number;
}

export function statusLocal(d: DadosStatusLocal): StatusLocal {
  const { local } = d;
  const itens: ItemChecklist[] = [];

  // Um setor só recebe pedido se alguma categoria ou produto aponta pra ele. Cozinha/Bar padrão recebem o resto.
  const recebe = local.setorId === null || d.categoriasDoLocal + d.produtosDoLocal > 0;
  if (local.setorId !== null) {
    itens.push(recebe
      ? { id: 'categorias', estado: 'ok', texto: `${d.categoriasDoLocal} categoria(s) e ${d.produtosDoLocal} produto(s) enviam pedidos para cá.` }
      : { id: 'categorias', estado: 'falta', texto: 'Nenhuma categoria ou produto aponta para este local — ele não recebe pedidos.' });
  }

  const ativas = d.impressoras.filter((p) => p.is_active);
  const propria = local.setorId !== null
    ? ativas.some((p) => p.sector_id === local.setorId)
    : ativas.some((p) => !p.sector_id && (p.destination === local.base || p.destination === 'all'));
  if (propria) itens.push({ id: 'impressora', estado: 'ok', texto: 'Tem impressora própria.' });
  else if (local.setorId !== null) itens.push({ id: 'impressora', estado: 'aviso', texto: `Sem impressora própria: os pedidos saem na impressora da ${local.base === 'bar' ? 'Bar' : 'Cozinha'}.` });
  else itens.push({ id: 'impressora', estado: 'aviso', texto: 'Sem impressora configurada: o pedido só aparece na tela.' });

  if (d.mapaEstoque !== null) {
    if (d.mapaEstoque[local.chave]) itens.push({ id: 'estoque', estado: 'ok', texto: 'Baixa de estoque vinculada a um local do Omie.' });
    else if (local.setorId !== null && d.mapaEstoque[local.base]) itens.push({ id: 'estoque', estado: 'aviso', texto: `Sem local de estoque próprio: baixa no mesmo local da ${local.base === 'bar' ? 'Bar' : 'Cozinha'}.` });
    else itens.push({ id: 'estoque', estado: 'falta', texto: 'Sem local de estoque do Omie: a venda não baixa estoque deste local.' });
  }

  return { itens, completo: itens.every((i) => i.estado === 'ok'), recebePedidos: recebe };
}
