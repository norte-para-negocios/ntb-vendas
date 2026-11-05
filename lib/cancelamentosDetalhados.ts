// Relatório de cancelamentos detalhado (04/11/2026, pedido do dono: "ver que horas foi pedido e cancelado, cada cancelado
// dentro do local"). Dados de fetch_cancelamentos_secure (migration 193): uma linha por cancelamento de item, inclusive
// os de pedido inteiro. Ocorrências antigas (antes da 193) não têm mesa/hora do pedido gravadas: aparecem "Não registrado".

export type Cancelamento = {
  id: string;
  cancelado_em: string;
  pedido_em: string | null;
  produto: string;
  quantidade: number;
  valor: number;
  motivo: string | null;
  autorizado_por: string | null;
  cancelado_por: string | null;
  sem_senha: boolean;
  parcial: boolean;
  status_anterior: string | null;
  tipo: 'table' | 'counter' | string | null;
  mesa: number | null;
  cliente: string | null;
  lancado_por: string | null;
  lancado_papel: string | null;
  setor: string | null;
};

export type FiltroCancelamentos = { local?: 'todos' | 'mesa' | 'balcao'; pessoa?: string; motivo?: string; setor?: string; busca?: string };

const sem = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const localDoCancelamento = (c: Cancelamento): string => {
  if (c.tipo === 'counter') return c.cliente ? `Balcão · ${c.cliente}` : 'Balcão';
  if (c.mesa != null) return `Mesa ${c.mesa}`;
  if (c.tipo === 'table') return 'Mesa';
  return 'Não registrado';
};

export const minutosAteCancelar = (c: Cancelamento): number | null => {
  if (!c.pedido_em) return null;
  const ms = new Date(c.cancelado_em).getTime() - new Date(c.pedido_em).getTime();
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60000) : null;
};

const STATUS: Record<string, string> = {
  pending: 'Ainda não preparado', accepted: 'Ainda não preparado', preparing: 'Em preparo', ready: 'Pronto', delivered: 'Já entregue',
};
export const statusAnteriorLabel = (s: string | null): string => (s ? STATUS[s] ?? s : '—');

export const quemAutorizou = (c: Cancelamento): string => (c.sem_senha ? 'Sem senha (tempo livre)' : c.autorizado_por ?? '—');

export const filtrarCancelamentos = (lista: Cancelamento[], f: FiltroCancelamentos): Cancelamento[] => {
  const pessoa = sem(f.pessoa);
  const busca = sem(f.busca);
  return lista.filter((c) => {
    if (f.local === 'mesa' && c.tipo !== 'table') return false;
    if (f.local === 'balcao' && c.tipo !== 'counter') return false;
    if (pessoa && ![c.autorizado_por, c.cancelado_por, c.lancado_por].some((p) => sem(p) === pessoa)) return false;
    if (f.motivo && (c.motivo ?? 'Sem motivo') !== f.motivo) return false;
    if (f.setor && (c.setor ?? 'Sem setor') !== f.setor) return false;
    if (busca && !sem(`${c.produto} ${localDoCancelamento(c)} ${c.motivo ?? ''}`).includes(busca)) return false;
    return true;
  });
};

type Grupo = { nome: string; quantidade: number; valor: number };
const agrupar = (lista: Cancelamento[], chave: (c: Cancelamento) => string): Grupo[] => {
  const m = new Map<string, Grupo>();
  for (const c of lista) {
    const k = chave(c);
    const g = m.get(k) ?? { nome: k, quantidade: 0, valor: 0 };
    g.quantidade += 1;
    g.valor += Number(c.valor) || 0;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.quantidade - a.quantidade || b.valor - a.valor);
};

export const resumoCancelamentos = (lista: Cancelamento[]) => ({
  quantidade: lista.length,
  valor: lista.reduce((s, c) => s + (Number(c.valor) || 0), 0),
  semSenha: lista.filter((c) => c.sem_senha).length,
  porMotivo: agrupar(lista, (c) => c.motivo ?? 'Sem motivo'),
  porPessoa: agrupar(lista, (c) => (c.sem_senha ? c.cancelado_por : c.autorizado_por ?? c.cancelado_por) ?? 'Não registrado'),
  porLocal: agrupar(lista, (c) => (c.tipo === 'counter' ? 'Balcão' : localDoCancelamento(c))),
});

const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const brl = (n: number) => (Number(n) || 0).toFixed(2).replace('.', ',');

export const linhasCsvCancelamentos = (lista: Cancelamento[]): string[][] => [
  ['Cancelado em', 'Pedido em', 'Local', 'Setor', 'Produto', 'Qtd', 'Valor', 'Motivo', 'Situação do item', 'Lançado por', 'Pediu o cancelamento', 'Autorizou'],
  ...lista.map((c) => [
    dataHora(c.cancelado_em), dataHora(c.pedido_em), localDoCancelamento(c), c.setor ?? '', c.produto, String(c.quantidade), brl(c.valor),
    c.motivo ?? '', statusAnteriorLabel(c.status_anterior), c.lancado_por ?? '', c.cancelado_por ?? '', quemAutorizou(c),
  ]),
];
