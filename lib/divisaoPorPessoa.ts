// Aba "Por pessoa" do pagamento (31/10/2026, ODARA). O prefixo "[Nome]" das observações do item é de quem lançou: em item
// de garçom é o GARÇOM, não quem paga. Só o que o cliente pediu pelo QR já tem dono (o nome dele); o resto o garçom
// escolhe para Pessoa 1, Pessoa 2..., até por unidade (2 cervejas, uma para cada).
export type ItemDaConta = { id: string; quantity: number; price_at_time: number; notes?: string | null; added_by_role?: string | null; status?: string | null };
export type Atribuicao = Record<string, Record<string, number>>;
export type LinhaDaPessoa<T> = { item: T; qtd: number };
export type PessoaDaConta<T> = { nome: string; linhas: LinhaDaPessoa<T>[]; subtotal: number };
export type DivisaoDaConta<T> = { pessoas: PessoaDaConta<T>[]; soltos: { item: T; restante: number }[] };

export function clienteDoItem(item: ItemDaConta): string | null {
  if (item.added_by_role !== 'cliente') return null;
  const nome = item.notes?.match(/^\[(.*?)\]/)?.[1]?.trim();
  return nome || null;
}

export function atribuirUnidade(at: Atribuicao, item: ItemDaConta, pessoa: string): Atribuicao {
  const doItem = at[item.id] ?? {};
  const usadas = Object.values(doItem).reduce((s, n) => s + n, 0);
  if (usadas >= item.quantity) return at;
  return { ...at, [item.id]: { ...doItem, [pessoa]: (doItem[pessoa] ?? 0) + 1 } };
}

export function devolverUnidade(at: Atribuicao, itemId: string, pessoa: string): Atribuicao {
  const qtd = at[itemId]?.[pessoa] ?? 0;
  if (qtd <= 0) return at;
  const doItem = { ...at[itemId] };
  if (qtd === 1) delete doItem[pessoa]; else doItem[pessoa] = qtd - 1;
  return { ...at, [itemId]: doItem };
}

export function montarDivisao<T extends ItemDaConta>(itens: T[], at: Atribuicao, pessoasManuais: string[]): DivisaoDaConta<T> {
  const validos = itens.filter((i) => i.status !== 'canceled');
  const linhas = new Map<string, LinhaDaPessoa<T>[]>();
  const incluir = (nome: string, item: T, qtd: number) => { if (qtd > 0) linhas.set(nome, [...(linhas.get(nome) ?? []), { item, qtd }]); };
  const soltos: { item: T; restante: number }[] = [];
  const clientes: string[] = [];
  for (const item of validos) {
    const cliente = clienteDoItem(item);
    if (cliente) {
      if (!clientes.includes(cliente)) clientes.push(cliente);
      incluir(cliente, item, item.quantity);
      continue;
    }
    let restante = item.quantity;
    for (const nome of pessoasManuais) {
      const qtd = Math.min(at[item.id]?.[nome] ?? 0, restante);
      incluir(nome, item, qtd);
      restante -= qtd;
    }
    if (restante > 0) soltos.push({ item, restante });
  }
  const pessoas = [...clientes, ...pessoasManuais].map((nome) => {
    const doNome = linhas.get(nome) ?? [];
    return { nome, linhas: doNome, subtotal: doNome.reduce((s, l) => s + l.item.price_at_time * l.qtd, 0) };
  });
  return { pessoas, soltos };
}
