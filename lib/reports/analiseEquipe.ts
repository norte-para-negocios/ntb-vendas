// Relatórios → Equipe (26/10/2026, pedido do dono: "ver por login o que cada pessoa fez, o que cada pessoa lançou").
// Junta 4 fontes por pessoa: vendas (quem lançou o item, quem recebeu a conta), atividade do app (migration 189:
// entrou/saiu, pré-conta, troca de mesa, abriu mesa), exceções (cancelou, taxa removida…) e ponto. Pura e testada.
// - O mesmo funcionário aparece com nomes diferentes nas fontes ("Herica" no login, nome completo no item): nome de uma
//   palavra se junta ao ÚNICO nome completo com o mesmo primeiro nome; dois nomes completos diferentes nunca se juntam.
// - "Mesas" (computador do Modo Aberto), "Equipe" (sem operador) e "Cliente pelo QR" são aparelhos, não pessoas.
import type { Order, OperatorCheckin } from '@/types';
import { CORTESIA, chaveContaPaga, metodosDoPagamento, valorFaturado } from '../faturamento';
import { getOrderItemDisplayName, getPaymentMethodLabel } from '../labels';
import { EXCEPTION_LABELS, type ExceptionsReport } from '../excecoes';
import { ehProduto, localDa, partesBahia, quemLancou } from './analiseVendas';

export type EventoAtividade = { quando: string; quem: string; papel: string | null; acao: string; resumo: string | null; detalhe: Record<string, unknown> };
export type AtividadeEquipe = { eventos: EventoAtividade[]; cortado: boolean };

export type Pessoa = {
  nome: string;
  papel: string | null;
  lancou: { itens: number; valor: number; contas: number; mesas: number; porHora: number[]; produtos: { nome: string; qtd: number; total: number }[]; categorias: { nome: string; total: number }[] };
  recebeu: { contas: number; valor: number; porForma: { chave: string; rotulo: string; total: number }[] };
  excecoes: { total: number; cancelados: { qtd: number; valor: number }; porTipo: Record<string, number> };
  login: { entradas: number; minutos: number; primeiro: string | null; ultimo: string | null };
  preContas: number;
  mesasTrocadas: number;
  mesasAbertas: number;
  ponto: { minutos: number };
};
export type EventoLinha = { quando: string; tipo: 'login' | 'logout' | 'lancou' | 'recebeu' | 'cancelou' | 'excecao' | 'pre_conta' | 'mesa' | 'ponto' | 'outro'; texto: string; valor?: number };
export type FontesEquipe = {
  vendas: Order[];
  categorias: { id: string; name: string }[];
  atividade: AtividadeEquipe | null;
  excecoes: ExceptionsReport | null;
  checkins: OperatorCheckin[];
  fimPeriodo: string;
};

type Item = NonNullable<Order['order_items']>[number] & { added_by_role?: string | null; added_by_name?: string | null };
type Pd = { operador_nome?: string } | null;
const APARELHOS = new Set(['mesas', 'equipe', 'cliente pelo qr', '(sem login)']);
const DOZE_HORAS = 12 * 60 * 60 * 1000;
const arred = (n: number) => Math.round(n * 100) / 100;
const ms = (iso: string) => new Date(iso).getTime();

export const normalizarNome = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const recebedor = (o: Order) => ((o.payment_details as Pd)?.operador_nome || '').trim();

/** Todos os nomes crus das fontes → nome de exibição da pessoa (a variante mais longa do grupo). */
function montarResolvedor(f: FontesEquipe): (cru: string) => string {
  const crus: string[] = [];
  for (const o of f.vendas) {
    for (const i of (o.order_items ?? []) as Item[]) crus.push(quemLancou(i, o));
    if (recebedor(o)) crus.push(recebedor(o));
  }
  for (const e of f.atividade?.eventos ?? []) crus.push(e.quem);
  for (const r of f.excecoes?.by_operator ?? []) crus.push(r.operator_name);
  for (const c of f.checkins) crus.push(c.user_name);
  const variantes = new Map<string, Set<string>>();
  for (const c of crus) { const k = normalizarNome(c || ''); if (!k) continue; (variantes.get(k) ?? variantes.set(k, new Set()).get(k)!).add(c.trim()); }
  const chaves = [...variantes.keys()];
  const alvo = new Map<string, string>();
  for (const k of chaves) {
    if (k.includes(' ') || APARELHOS.has(k)) continue;
    const completos = chaves.filter((x) => x.includes(' ') && x.split(' ')[0] === k && !APARELHOS.has(x));
    if (completos.length === 1) alvo.set(k, completos[0]);
  }
  const exibicao = new Map<string, string>();
  for (const [k, vs] of variantes) exibicao.set(k, [...vs].sort((a, b) => b.length - a.length || a.localeCompare(b))[0]);
  return (cru: string) => { const k = normalizarNome(cru || ''); const final = alvo.get(k) ?? k; return exibicao.get(final) ?? cru.trim(); };
}

const pessoaVazia = (nome: string): Pessoa => ({
  nome, papel: null,
  lancou: { itens: 0, valor: 0, contas: 0, mesas: 0, porHora: new Array(24).fill(0), produtos: [], categorias: [] },
  recebeu: { contas: 0, valor: 0, porForma: [] },
  excecoes: { total: 0, cancelados: { qtd: 0, valor: 0 }, porTipo: {} },
  login: { entradas: 0, minutos: 0, primeiro: null, ultimo: null },
  preContas: 0, mesasTrocadas: 0, mesasAbertas: 0, ponto: { minutos: 0 },
});

/**
 * Minutos logados. Cada "entrou" vai até o "saiu" seguinte. Sem saída (app fechado, computador que fica logado), vai até a
 * última coisa que a pessoa fez antes do próximo "entrou" (no máximo 12 h e nunca depois do fim do período); sem nenhuma
 * atividade depois de entrar, não conta tempo.
 */
function minutosLogado(evs: EventoAtividade[], atividades: number[], fim: string): number {
  const ord = evs.filter((e) => e.acao === 'login.entrou' || e.acao === 'login.saiu').sort((a, b) => a.quando.localeCompare(b.quando));
  let total = 0;
  ord.forEach((e, i) => {
    if (e.acao !== 'login.entrou') return;
    const ini = ms(e.quando);
    const prox = ord[i + 1];
    const teto = Math.min(ini + DOZE_HORAS, ms(fim), prox ? ms(prox.quando) : Infinity);
    const ate = prox?.acao === 'login.saiu' ? teto : Math.max(ini, ...atividades.filter((t) => t > ini && t <= teto));
    if (ate > ini) total += ate - ini;
  });
  return Math.round(total / 60000);
}

export function analisarEquipe(f: FontesEquipe): { pessoas: Pessoa[]; aparelhos: { nome: string; eventos: number }[] } {
  const quem = montarResolvedor(f);
  const nomeCat = new Map(f.categorias.map((c) => [c.id, c.name]));
  const pessoas = new Map<string, Pessoa>();
  const aparelhos = new Map<string, number>();
  const papeis = new Map<string, Map<string, number>>();
  const extra = new Map<string, { contasL: Set<string>; mesas: Set<string>; prods: Map<string, { nome: string; qtd: number; total: number }>; cats: Map<string, number>; formas: Map<string, number> }>();
  const ehAparelho = (n: string) => APARELHOS.has(normalizarNome(n));
  const de = (cru: string): Pessoa | null => {
    if (ehAparelho(cru)) { const n = cru.trim(); aparelhos.set(n, (aparelhos.get(n) ?? 0) + 1); return null; }
    const n = quem(cru); if (!n) return null;
    if (!pessoas.has(n)) { pessoas.set(n, pessoaVazia(n)); extra.set(n, { contasL: new Set(), mesas: new Set(), prods: new Map(), cats: new Map(), formas: new Map() }); }
    return pessoas.get(n)!;
  };
  const momentos = new Map<string, number[]>();
  const marca = (n: string, iso: string | null | undefined) => { if (!iso) return; (momentos.get(n) ?? momentos.set(n, []).get(n)!).push(ms(iso)); };
  const anotaPapel = (n: string, papel: string | null | undefined) => { if (!papel) return; const m = papeis.get(n) ?? new Map(); m.set(papel, (m.get(papel) ?? 0) + 1); papeis.set(n, m); };

  for (const o of f.vendas) {
    if (o.status === 'canceled') continue;
    const pago = valorFaturado(o);
    const conta = chaveContaPaga(o);
    const local = localDa(o);
    for (const i of (o.order_items ?? []) as Item[]) {
      if (!ehProduto(i) || pago <= 0) continue;
      const p = de(quemLancou(i, o)); if (!p) continue;
      const x = extra.get(p.nome)!;
      const v = Number(i.price_at_time) * i.quantity;
      p.lancou.itens += i.quantity; p.lancou.valor += v;
      marca(p.nome, i.created_at || o.created_at);
      x.contasL.add(conta); if (local !== 'Balcão') x.mesas.add(local);
      p.lancou.porHora[partesBahia(i.created_at || o.created_at).hora] += i.quantity;
      const nome = getOrderItemDisplayName(i);
      const pr = x.prods.get(nome) ?? { nome, qtd: 0, total: 0 }; pr.qtd += i.quantity; pr.total += v; x.prods.set(nome, pr);
      const cat = nomeCat.get(i.product?.category_id ?? '') ?? 'Sem categoria';
      x.cats.set(cat, (x.cats.get(cat) ?? 0) + v);
    }
    if (pago > 0 && recebedor(o)) {
      const p = de(recebedor(o));
      if (p) {
        p.recebeu.contas += 1; p.recebeu.valor += pago;
        marca(p.nome, (o as { updated_at?: string }).updated_at || o.created_at);
        const x = extra.get(p.nome)!;
        for (const m of metodosDoPagamento(o) ?? []) if (m.method && m.method !== CORTESIA) x.formas.set(m.method, (x.formas.get(m.method) ?? 0) + (Number(m.amount) || 0));
      }
    }
  }

  const evsPorPessoa = new Map<string, EventoAtividade[]>();
  for (const e of f.atividade?.eventos ?? []) {
    const p = de(e.quem); if (!p) continue;
    anotaPapel(p.nome, e.papel === 'open' ? 'waiter' : e.papel);
    if (!e.acao.startsWith('login.')) marca(p.nome, e.quando);
    (evsPorPessoa.get(p.nome) ?? evsPorPessoa.set(p.nome, []).get(p.nome)!).push(e);
    if (e.acao === 'login.entrou' || e.acao === 'login.modo_aberto') {
      p.login.entradas += 1;
      if (!p.login.primeiro || e.quando < p.login.primeiro) p.login.primeiro = e.quando;
    }
    if (e.acao.startsWith('login.') && (!p.login.ultimo || e.quando > p.login.ultimo)) p.login.ultimo = e.quando;
    if (e.acao === 'reimpressao.pre_conta') p.preContas += 1;
    if (e.acao === 'mesa.trocada') p.mesasTrocadas += 1;
    if (e.acao === 'mesa.abriu') p.mesasAbertas += 1;
  }

  for (const r of f.excecoes?.by_operator ?? []) {
    const p = de(r.operator_name); if (!p) continue;
    for (const [tipo, n] of Object.entries(r.counts)) { p.excecoes.porTipo[tipo] = (p.excecoes.porTipo[tipo] ?? 0) + Number(n || 0); p.excecoes.total += Number(n || 0); }
    p.excecoes.cancelados.qtd += Number(r.counts.item_cancelado ?? 0);
    p.excecoes.cancelados.valor = arred(p.excecoes.cancelados.valor + Number(r.values.item_cancelado ?? 0));
  }

  for (const e of f.excecoes?.events ?? []) { if (!ehAparelho(e.operator_name)) marca(quem(e.operator_name), e.created_at); }
  for (const [n, evs] of evsPorPessoa) pessoas.get(n)!.login.minutos = minutosLogado(evs, momentos.get(n) ?? [], f.fimPeriodo);

  for (const c of f.checkins) {
    const p = de(c.user_name); if (!p) continue;
    const ini = ms(c.checkin_at);
    const fim = c.checkout_at ? ms(c.checkout_at) : Math.min(ini + DOZE_HORAS, ms(f.fimPeriodo));
    if (fim > ini) p.ponto.minutos += Math.round((fim - ini) / 60000);
  }

  for (const p of pessoas.values()) {
    const x = extra.get(p.nome)!;
    p.lancou.valor = arred(p.lancou.valor); p.recebeu.valor = arred(p.recebeu.valor);
    p.lancou.contas = x.contasL.size; p.lancou.mesas = x.mesas.size;
    p.lancou.produtos = [...x.prods.values()].map((v) => ({ ...v, total: arred(v.total) })).sort((a, b) => b.qtd - a.qtd || b.total - a.total);
    p.lancou.categorias = [...x.cats.entries()].map(([nome, total]) => ({ nome, total: arred(total) })).sort((a, b) => b.total - a.total);
    p.recebeu.porForma = [...x.formas.entries()].map(([chave, total]) => ({ chave, rotulo: getPaymentMethodLabel(chave), total: arred(total) })).sort((a, b) => b.total - a.total);
    const pp = papeis.get(p.nome); p.papel = pp ? [...pp.entries()].sort((a, b) => b[1] - a[1])[0][0] : p.lancou.itens > 0 ? 'waiter' : null;
  }
  return {
    pessoas: [...pessoas.values()].sort((a, b) => b.lancou.valor + b.recebeu.valor - (a.lancou.valor + a.recebeu.valor) || b.login.entradas - a.login.entradas || a.nome.localeCompare(b.nome)),
    aparelhos: [...aparelhos.entries()].map(([nome, eventos]) => ({ nome, eventos })).sort((a, b) => b.eventos - a.eventos),
  };
}

const TEXTO_ACAO: Record<string, { tipo: EventoLinha['tipo']; texto: string }> = {
  'login.entrou': { tipo: 'login', texto: 'Entrou no sistema' },
  'login.modo_aberto': { tipo: 'login', texto: 'Entrou no Modo Aberto' },
  'login.saiu': { tipo: 'logout', texto: 'Saiu do sistema' },
  'reimpressao.pre_conta': { tipo: 'pre_conta', texto: 'Imprimiu pré-conta' },
  'mesa.abriu': { tipo: 'mesa', texto: 'Abriu mesa' },
  'mesa.trocada': { tipo: 'mesa', texto: 'Trocou de mesa' },
  'mesa.pediu_conta': { tipo: 'mesa', texto: 'Pediu a conta' },
  'pedido.senha_nao_conferida': { tipo: 'outro', texto: 'Pedido sem senha conferida' },
};

const VERBO_EXCECAO: Record<string, string> = {
  item_cancelado: 'Cancelou', nota_cancelada: 'Cancelou a nota', item_transferido: 'Transferiu de mesa', taxa_editada: 'Editou a taxa',
  taxa_removida: 'Tirou a taxa', pagamento_estornado: 'Estornou pagamento', sangria_grande: 'Sangria grande', tolerancia_excedida: 'Diferença no caixa',
};

/** Tudo o que a pessoa fez no período, mais recente primeiro. */
export function linhaDoTempo(nome: string, f: FontesEquipe): EventoLinha[] {
  const quem = montarResolvedor(f);
  const alvo = quem(nome);
  const eu = (cru: string) => !!cru && quem(cru) === alvo;
  const out: EventoLinha[] = [];
  for (const o of f.vendas) {
    if (o.status === 'canceled') continue;
    const pago = valorFaturado(o);
    if (pago <= 0) continue;
    const local = localDa(o);
    const grupos = new Map<string, { quando: string; itens: Map<string, number>; valor: number }>();
    for (const i of (o.order_items ?? []) as Item[]) {
      if (!ehProduto(i) || !eu(quemLancou(i, o))) continue;
      const quando = i.created_at || o.created_at;
      const k = quando.slice(0, 16);
      const g = grupos.get(k) ?? { quando, itens: new Map(), valor: 0 };
      const n = getOrderItemDisplayName(i);
      g.itens.set(n, (g.itens.get(n) ?? 0) + i.quantity); g.valor += Number(i.price_at_time) * i.quantity;
      if (quando < g.quando) g.quando = quando;
      grupos.set(k, g);
    }
    for (const g of grupos.values()) {
      const lista = [...g.itens.entries()].map(([n, q]) => `${q}× ${n}`);
      const txt = lista.slice(0, 4).join(', ') + (lista.length > 4 ? ` e mais ${lista.length - 4}` : '');
      out.push({ quando: g.quando, tipo: 'lancou', texto: `Lançou ${txt} · ${local}`, valor: arred(g.valor) });
    }
    if (eu(recebedor(o))) {
      const formas = [...new Set((metodosDoPagamento(o) ?? []).filter((m) => m.method && m.method !== CORTESIA).map((m) => getPaymentMethodLabel(m.method!)))].join(', ');
      out.push({ quando: (o as { updated_at?: string }).updated_at || o.created_at, tipo: 'recebeu', texto: `Recebeu a conta · ${local}${formas ? ` · ${formas}` : ''}`, valor: arred(pago) });
    }
  }
  for (const e of f.atividade?.eventos ?? []) {
    if (!eu(e.quem)) continue;
    const base = TEXTO_ACAO[e.acao] ?? { tipo: 'outro' as const, texto: e.acao };
    const total = Number((e.detalhe as { total?: number })?.total);
    out.push({ quando: e.quando, tipo: base.tipo, texto: e.resumo || base.texto, ...(base.tipo === 'pre_conta' && Number.isFinite(total) ? { valor: arred(total) } : {}) });
  }
  for (const e of f.excecoes?.events ?? []) {
    if (!eu(e.operator_name)) continue;
    const d = e.details as { produto?: string; motivo?: string; valor?: number };
    const rot = VERBO_EXCECAO[e.event_type] ?? EXCEPTION_LABELS[e.event_type] ?? e.event_type;
    const cancel = e.event_type === 'item_cancelado' || e.event_type === 'nota_cancelada';
    out.push({ quando: e.created_at, tipo: cancel ? 'cancelou' : 'excecao', texto: `${rot}${d.produto ? ` ${d.produto}` : ''}${d.motivo ? ` — ${d.motivo}` : ''}`, ...(Number.isFinite(Number(d.valor)) ? { valor: arred(Number(d.valor)) } : {}) });
  }
  for (const c of f.checkins) {
    if (!eu(c.user_name)) continue;
    out.push({ quando: c.checkin_at, tipo: 'ponto', texto: 'Bateu o ponto (entrada)' });
    if (c.checkout_at) out.push({ quando: c.checkout_at, tipo: 'ponto', texto: 'Bateu o ponto (saída)' });
  }
  return out.sort((a, b) => b.quando.localeCompare(a.quando));
}
