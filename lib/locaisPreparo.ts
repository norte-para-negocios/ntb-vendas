// lib/locaisPreparo.ts — locais de preparo (Cozinha, Bar e setores como Pizzaria): lista única + checklist de pendências.
// A chave é a MESMA de lib/setores.ts (chaveDestinoEstoque): 'kitchen' | 'bar' | 'setor:<id>'.
export type BaseLocal = 'kitchen' | 'bar';
export interface SetorLike { id: string; name: string; base: BaseLocal }
export interface LocalPreparo { chave: string; nome: string; base: BaseLocal; setorId: string | null }

export const chaveLocal = (setorId: string | null, base: BaseLocal): string => (setorId ? `setor:${setorId}` : base);

// Cozinha e Bar SEMPRE são listados (04/10, pedido do dono): os módulos kitchen_kds/bar_kds só controlam se existe a TELA de KDS.
export function listarLocais(setores: SetorLike[]): LocalPreparo[] {
  const out: LocalPreparo[] = [
    { chave: 'kitchen', nome: 'Cozinha', base: 'kitchen', setorId: null },
    { chave: 'bar', nome: 'Bar', base: 'bar', setorId: null },
  ];
  setores.forEach((s) => out.push({ chave: chaveLocal(s.id, s.base), nome: s.name, base: s.base, setorId: s.id }));
  return out;
}

// Locais que têm TELA de acompanhamento (Produção, avisos): Cozinha/Bar só entram com o módulo KDS ligado; locais criados sempre.
export function listarLocaisComTela(setores: SetorLike[], modulos: { cozinha: boolean; bar: boolean }): LocalPreparo[] {
  return listarLocais(setores).filter((l) => l.setorId !== null || (l.base === 'kitchen' ? modulos.cozinha : modulos.bar));
}

// Modelo de categorias: cada categoria pertence a UM local.
//  - categories.sector_id aponta para um local criado (ex.: Pizzaria) -> esse local;
//  - senão vale o destino (products.destination) dos produtos sem setor próprio; null conta como Cozinha.
// Categoria com produtos de destinos diferentes é "mista": aparece no destino da maioria (empate = Cozinha), marcada como mista.
export interface CatLike { id: string; name?: string; sector_id?: string | null }
export interface ProdLike { category_id?: string | null; sector_id?: string | null; destination?: 'kitchen' | 'bar' | null }
export interface AtribuicaoCategoria { chave: string; misto: boolean; cozinha: number; bar: number; total: number }

export function atribuicaoCategoria(cat: CatLike, produtos: ProdLike[], setorIds: Set<string>): AtribuicaoCategoria {
  const doCat = produtos.filter((p) => p.category_id === cat.id);
  let cozinha = 0; let bar = 0;
  doCat.filter((p) => !p.sector_id).forEach((p) => { if (p.destination === 'bar') bar++; else cozinha++; });
  const total = doCat.length;
  if (cat.sector_id && setorIds.has(cat.sector_id)) return { chave: `setor:${cat.sector_id}`, misto: false, cozinha, bar, total };
  const misto = cozinha > 0 && bar > 0;
  return { chave: bar > cozinha ? 'bar' : 'kitchen', misto, cozinha, bar, total };
}

export function categoriasPorLocal<C extends CatLike>(categorias: C[], produtos: ProdLike[], setores: SetorLike[]): Map<string, { cat: C; atrib: AtribuicaoCategoria }[]> {
  const ids = new Set(setores.map((s) => s.id));
  const mapa = new Map<string, { cat: C; atrib: AtribuicaoCategoria }[]>([['kitchen', []], ['bar', []]]);
  setores.forEach((s) => mapa.set(`setor:${s.id}`, []));
  categorias.forEach((cat) => {
    const atrib = atribuicaoCategoria(cat, produtos, ids);
    mapa.get(atrib.chave)!.push({ cat, atrib });
  });
  return mapa;
}

export function textoMoverCategoria(categoria: string, local: string, n: number): string {
  if (n === 0) return `${categoria} não tem produtos ainda; ela passa a ir para ${local}.`;
  if (n === 1) return `O produto de ${categoria} passa a ir para ${local}.`;
  return `Os ${n} produtos de ${categoria} passam a ir para ${local}.`;
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

  // Um local criado só recebe pedido se alguma categoria ou produto aponta pra ele. Cozinha/Bar recebem o que não tem outro destino.
  const recebe = local.setorId === null || d.categoriasDoLocal + d.produtosDoLocal > 0;
  if (local.setorId !== null) {
    itens.push(recebe
      ? { id: 'categorias', estado: 'ok', texto: `${d.categoriasDoLocal} categoria(s) e ${d.produtosDoLocal} produto(s) enviam pedidos para cá.` }
      : { id: 'categorias', estado: 'falta', texto: 'Nenhuma categoria ou produto aponta para este local — ele não recebe pedidos.' });
  } else {
    itens.push(d.categoriasDoLocal > 0
      ? { id: 'categorias', estado: 'ok', texto: `${d.categoriasDoLocal} categoria(s) enviam pedidos para cá.` }
      : { id: 'categorias', estado: 'aviso', texto: 'Nenhuma categoria envia pedidos para cá. Marque abaixo as categorias deste local.' });
  }

  const ativas = d.impressoras.filter((p) => p.is_active);
  const propria = local.setorId !== null
    ? ativas.some((p) => p.sector_id === local.setorId)
    : ativas.some((p) => !p.sector_id && (p.destination === local.base || p.destination === 'all'));
  if (propria) itens.push({ id: 'impressora', estado: 'ok', texto: 'Tem impressora própria.' });
  else if (local.setorId !== null) itens.push({ id: 'impressora', estado: 'aviso', texto: `Sem impressora própria: o pedido sai na impressora padrão da ${local.base === 'bar' ? 'Bar' : 'Cozinha'}.` });
  else itens.push({ id: 'impressora', estado: 'aviso', texto: 'Sem impressora configurada: o pedido só aparece na tela.' });

  if (d.mapaEstoque !== null) {
    if (d.mapaEstoque[local.chave]) itens.push({ id: 'estoque', estado: 'ok', texto: 'Baixa de estoque vinculada a um local do Omie.' });
    else if (local.setorId !== null && d.mapaEstoque[local.base]) itens.push({ id: 'estoque', estado: 'aviso', texto: `Sem local do Omie próprio: a baixa usa o local da ${local.base === 'bar' ? 'Bar' : 'Cozinha'}.` });
    else itens.push({ id: 'estoque', estado: 'falta', texto: 'Sem local de estoque do Omie: a venda não baixa estoque deste local.' });
  }

  return { itens, completo: itens.every((i) => i.estado === 'ok'), recebePedidos: recebe };
}
