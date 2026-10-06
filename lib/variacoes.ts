// "Preço por escolha" (06/10/2026): o lojista cadastra o produto principal e só lista as escolhas com o preço FINAL de cada uma
// (ex.: Moqueca R$ 159,90 / Ensopado R$ 149,90). Por baixo continua sendo um grupo de opção obrigatório (single): o preço do
// produto é o da escolha mais barata e cada opção soma a diferença. O código do Omie fica em cada escolha (baixa de estoque).
export type Variacao = { tempId: string; name: string; price: string; omie_codigo: string; available: boolean };
export type GrupoSalvo = {
  name: string; type: 'single'; required: true; price_rule: 'sum'; min_select: null; max_select: null;
  options: { name: string; price_delta: number; available: boolean; omie_codigo: string | null; variants: null }[];
};

const centavos = (v: number) => Math.round(v * 100) / 100;
export const numero = (s: string) => { const n = parseFloat(String(s).replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

export function validarVariacoes(vars: Variacao[]): string | null {
  const v = vars.filter((x) => x.name.trim());
  if (v.length < 2) return 'Cadastre pelo menos 2 escolhas (ex.: Moqueca e Ensopado).';
  const nomes = new Set<string>();
  for (const x of v) {
    const n = numero(x.price);
    if (!Number.isFinite(n) || n < 0) return `Informe o preço da escolha "${x.name.trim()}".`;
    const k = x.name.trim().toLowerCase();
    if (nomes.has(k)) return `A escolha "${x.name.trim()}" está repetida.`;
    nomes.add(k);
  }
  return null;
}

export function variacoesParaGrupo(nomeGrupo: string, vars: Variacao[]): { precoBase: number; grupo: GrupoSalvo } {
  const v = vars.filter((x) => x.name.trim());
  const base = Math.min(...v.map((x) => numero(x.price)));
  return {
    precoBase: centavos(base),
    grupo: {
      name: nomeGrupo.trim() || 'Escolha', type: 'single', required: true, price_rule: 'sum', min_select: null, max_select: null,
      options: v.map((x) => ({ name: x.name.trim(), price_delta: centavos(numero(x.price) - base), available: x.available, omie_codigo: x.omie_codigo.trim() || null, variants: null })),
    },
  };
}

// Um grupo existente vira "escolhas com preço" se for o 1º grupo, único, obrigatório, com 2+ opções, a mais barata a R$ 0 de acréscimo
// e sem preço/código por tamanho (variants), que esta tela não edita.
type GrupoLido = { name: string; type: string; required: boolean; price_rule?: string | null; options: { name: string; price_delta: number | string; available: boolean; omie_codigo?: string | null; variants?: unknown }[] };
export function grupoViraVariacoes(precoProduto: number, g: GrupoLido | undefined): { nome: string; vars: Variacao[] } | null {
  if (!g || g.type !== 'single' || !g.required || g.price_rule === 'max' || g.options.length < 2) return null;
  if (g.options.some((o) => o.variants)) return null;
  const deltas = g.options.map((o) => Number(o.price_delta));
  if (!deltas.includes(0) || deltas.some((d) => !(d >= 0))) return null;
  return {
    nome: g.name,
    vars: g.options.map((o, i) => ({ tempId: `v${i}-${o.name}`, name: o.name, price: centavos(precoProduto + Number(o.price_delta)).toFixed(2), omie_codigo: o.omie_codigo ?? '', available: o.available })),
  };
}
