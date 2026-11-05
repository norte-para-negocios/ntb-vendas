// Produto novo cadastrado no Omie entra sozinho no cardápio (03/11/2026, pedido do Ramon: "cadastrei o Mousse de coco
// aniversário e ele não apareceu no Norte Vendas"). Quem escolhe O QUE é novo é o Norte Estoque (só tipo 00/04 e só o
// que foi incluído no Omie depois do início da regra); aqui decide a categoria e garante que nada duplica.
// Categoria: a que tem o mesmo nome da família do Omie; senão, a mais usada entre os produtos do cardápio da mesma família
// ("irmãos"); senão, sem categoria. O preço é o do Omie, inclusive R$ 0,01 (brinde).

export type NovoOmie = { omieCodigo: string; nome: string; preco: number; familia?: string | null; irmaos?: string[] };
export type ProdutoLoja = { omie_codigo: string | null; name: string; category_id: string | null };
export type CategoriaLoja = { id: string; name: string };
export type PlanoCriar = { omieCodigo: string; nome: string; preco: number; categoryId: string | null };
export type Pulado = { omieCodigo: string; motivo: 'ja_existe' | 'mesmo_nome' | 'sem_preco' };

export function normalizarNome(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function categoriaDosIrmaos(irmaos: string[], porCodigo: Map<string, ProdutoLoja>, validas: Set<string>): string | null {
  const contagem = new Map<string, number>();
  for (const c of irmaos) {
    const cat = porCodigo.get(c)?.category_id;
    if (cat && validas.has(cat)) contagem.set(cat, (contagem.get(cat) ?? 0) + 1);
  }
  let melhor: string | null = null;
  let max = 0;
  for (const [cat, n] of contagem) if (n > max) { melhor = cat; max = n; }
  return melhor;
}

export function planejarNovos(novos: NovoOmie[], produtos: ProdutoLoja[], categorias: CategoriaLoja[]): { criar: PlanoCriar[]; pulados: Pulado[] } {
  const porCodigo = new Map<string, ProdutoLoja>();
  for (const p of produtos) if (p.omie_codigo) porCodigo.set(p.omie_codigo.trim(), p);
  const nomes = new Set(produtos.map((p) => normalizarNome(p.name)));
  const validas = new Set(categorias.map((c) => c.id));
  const catPorNome = new Map(categorias.map((c) => [normalizarNome(c.name), c.id]));
  const vistos = new Set<string>();
  const criar: PlanoCriar[] = [];
  const pulados: Pulado[] = [];

  for (const n of novos) {
    const codigo = (n.omieCodigo ?? '').trim();
    const nome = (n.nome ?? '').trim();
    if (!codigo || !nome) continue;
    if (porCodigo.has(codigo) || vistos.has(codigo)) { pulados.push({ omieCodigo: codigo, motivo: 'ja_existe' }); continue; }
    if (nomes.has(normalizarNome(nome))) { pulados.push({ omieCodigo: codigo, motivo: 'mesmo_nome' }); continue; }
    const preco = Math.round(Number(n.preco) * 100) / 100;
    if (!(preco > 0)) { pulados.push({ omieCodigo: codigo, motivo: 'sem_preco' }); continue; }
    // Categoria com o nome da família vem primeiro (05/11: a família SOBREMESAS do Sertão tem mais embalagem que doce e o
    // mousse caiu em Embalagens); senão, a mais usada pelos irmãos.
    const categoryId = catPorNome.get(normalizarNome(n.familia)) ?? categoriaDosIrmaos(n.irmaos ?? [], porCodigo, validas) ?? null;
    vistos.add(codigo);
    nomes.add(normalizarNome(nome));
    criar.push({ omieCodigo: codigo, nome, preco, categoryId });
  }
  return { criar, pulados };
}
