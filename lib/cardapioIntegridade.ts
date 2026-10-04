// Auditoria de integridade do cardápio (04/10/2026). Funções puras, sem I/O:
// usadas pela tela "Saúde do cardápio" e espelhadas em scripts/auditoria/cardapio.py.
export interface Achado {
  tipo: 'sem_categoria' | 'categoria_vazia' | 'preco_zero' | 'nome_duplicado' | 'ordem_repetida' | 'grupo_obrigatorio_vazio' | 'sem_codigo_omie' | 'sem_posicao';
  severidade: 'alta' | 'media' | 'baixa';
  texto: string;
}
export interface ProdutoAudit {
  id: string; name: string; price: number; category_id: string | null; available: boolean;
  order?: number | null; omie_codigo?: string | null; fee_type?: string | null;
  // opcoes = quantidade de opções DISPONÍVEIS do grupo; temCodigoOmie = alguma opção/variante carrega código do Omie.
  grupos?: { name: string; required: boolean; opcoes: number; temCodigoOmie?: boolean }[];
}

const PESO = { alta: 0, media: 1, baixa: 2 } as const;

export function auditarCardapio(d: { categorias: { id: string; name: string; order?: number | null }[]; produtos: ProdutoAudit[] }): Achado[] {
  const out: Achado[] = [];
  const ativos = d.produtos.filter((p) => p.available);
  const norm = (s: string) => s.trim().toLowerCase();

  ativos.filter((p) => !p.category_id).forEach((p) => out.push({ tipo: 'sem_categoria', severidade: 'alta', texto: `"${p.name}" está ativo mas sem categoria (fica em "Sem categoria").` }));
  d.categorias.filter((c) => !ativos.some((p) => p.category_id === c.id)).forEach((c) => out.push({ tipo: 'categoria_vazia', severidade: 'baixa', texto: `A categoria "${c.name}" não tem nenhum produto ativo.` }));
  ativos.filter((p) => !p.fee_type && !(p.grupos?.length) && Number(p.price) <= 0).forEach((p) => out.push({ tipo: 'preco_zero', severidade: 'alta', texto: `"${p.name}" está com preço zero.` }));

  const porNome = new Map<string, ProdutoAudit[]>();
  ativos.forEach((p) => porNome.set(norm(p.name), [...(porNome.get(norm(p.name)) ?? []), p]));
  porNome.forEach((l) => { if (l.length > 1) out.push({ tipo: 'nome_duplicado', severidade: 'media', texto: `Nome repetido: "${l[0].name}" (${l.length} produtos).` }); });

  const porPos = new Map<string, ProdutoAudit[]>();
  ativos.filter((p) => p.order != null).forEach((p) => { const k = `${p.category_id ?? '_'}|${p.order}`; porPos.set(k, [...(porPos.get(k) ?? []), p]); });
  porPos.forEach((l) => { if (l.length > 1) out.push({ tipo: 'ordem_repetida', severidade: 'baixa', texto: `Mesma posição na categoria: ${l.map((p) => `"${p.name}"`).join(', ')}.` }); });

  ativos.forEach((p) => (p.grupos ?? []).filter((g) => g.required && g.opcoes === 0).forEach((g) => out.push({ tipo: 'grupo_obrigatorio_vazio', severidade: 'alta', texto: `"${p.name}": o grupo obrigatório "${g.name}" não tem opções (a venda trava).` })));
  ativos.filter((p) => p.order == null).forEach((p) => out.push({ tipo: 'sem_posicao', severidade: 'baixa', texto: `"${p.name}" não tem posição definida na categoria.` }));

  const catPos = new Map<number, string[]>();
  d.categorias.filter((c) => c.order != null).forEach((c) => catPos.set(c.order as number, [...(catPos.get(c.order as number) ?? []), c.name]));
  catPos.forEach((l) => { if (l.length > 1) out.push({ tipo: 'ordem_repetida', severidade: 'baixa', texto: `Categorias na mesma posição: ${l.map((n) => `"${n}"`).join(', ')}.` }); });

  // Produto com grupos só pede código no produto se nenhuma opção/variante carrega o código.
  const semCodigo = ativos.filter((p) => !p.fee_type && !p.omie_codigo && !(p.grupos ?? []).some((g) => g.temCodigoOmie));
  const comCodigo = ativos.filter((p) => !p.fee_type).length - semCodigo.length;
  if (semCodigo.length > 0 && comCodigo === 0) {
    // Loja inteira sem código = loja sem integração com o estoque; um aviso só, não um por produto.
    out.push({ tipo: 'sem_codigo_omie', severidade: 'baixa', texto: `Nenhum produto tem código do Omie (${semCodigo.length} produtos): a loja não está ligada ao estoque, a venda não baixa estoque.` });
  } else {
    semCodigo.forEach((p) => out.push({ tipo: 'sem_codigo_omie', severidade: 'media', texto: `"${p.name}" não tem código do Omie (a venda não baixa estoque).` }));
  }
  return out.sort((a, b) => PESO[a.severidade] - PESO[b.severidade]);
}
