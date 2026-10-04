// lib/notificacoes.ts — central de notificações (sino): tipos, quem vê o quê, deduplicação e som.
// Tudo puro: o hook (useStoreNotifications) só busca dados, chama estas funções e guarda o resultado.
import { resolveStoreModules, resolveOrderFlow } from './storeModules';
import { itemPrecisaAcao } from './producaoNav';

export type TipoNotificacao =
  | 'chamada_garcom' | 'pedido_conta' | 'pedido_novo' | 'item_pronto' | 'item_atrasado'
  | 'estoque_baixo' | 'nota_rejeitada' | 'sangria_alta' | 'impressora_falhou';
export type Publico = 'gerencia' | 'caixa' | 'salao' | 'cozinha' | 'bar';
export type Som = 'mesa' | 'pedido' | 'pronto' | 'atraso' | 'falha';

export interface DefTipo {
  tipo: TipoNotificacao; label: string; desc: string; publicos: Publico[]; som: Som | null;
  /** true = some sozinho quando a condição acaba (mesa atendida, item entregue...). false = acontece uma vez. */
  resolve: boolean;
  /** Só faz sentido em loja com tela de cozinha/bar (KDS). */
  exigeKds?: boolean;
}

export const TIPOS: DefTipo[] = [
  { tipo: 'chamada_garcom', label: 'Chamada de garçom', desc: 'O cliente chamou pelo cardápio digital.', publicos: ['salao', 'caixa', 'gerencia'], som: 'mesa', resolve: true },
  { tipo: 'pedido_conta', label: 'Pedido de conta', desc: 'A mesa pediu a conta.', publicos: ['caixa', 'salao', 'gerencia'], som: 'mesa', resolve: true },
  { tipo: 'pedido_novo', label: 'Pedido novo no local', desc: 'Chegou pedido na Cozinha, Bar ou outro local.', publicos: ['cozinha', 'bar', 'gerencia'], som: 'pedido', resolve: true, exigeKds: true },
  { tipo: 'item_pronto', label: 'Item pronto para entregar', desc: 'A cozinha ou o bar marcou o item como pronto.', publicos: ['salao', 'gerencia'], som: 'pronto', resolve: true, exigeKds: true },
  { tipo: 'item_atrasado', label: 'Item atrasado', desc: 'Passou do tempo de preparo do produto.', publicos: ['cozinha', 'bar', 'gerencia'], som: 'atraso', resolve: true, exigeKds: true },
  { tipo: 'estoque_baixo', label: 'Estoque baixo', desc: 'Produto abaixo do mínimo no estoque.', publicos: ['gerencia'], som: null, resolve: true },
  { tipo: 'nota_rejeitada', label: 'Nota fiscal rejeitada', desc: 'A SEFAZ rejeitou uma nota ou ela deu erro.', publicos: ['gerencia', 'caixa'], som: 'falha', resolve: true },
  { tipo: 'sangria_alta', label: 'Sangria acima do limite', desc: 'Sangria maior que o limite configurado no caixa.', publicos: ['gerencia'], som: 'falha', resolve: false },
  { tipo: 'impressora_falhou', label: 'Impressora com falha', desc: 'Um pedido não saiu na impressora.', publicos: ['gerencia', 'caixa'], som: 'falha', resolve: true },
];
const DEF = Object.fromEntries(TIPOS.map((t) => [t.tipo, t])) as Record<TipoNotificacao, DefTipo>;

export interface EventoNotificacao {
  id: string; tipo: TipoNotificacao; titulo: string; detalhe?: string;
  criadoEm: number; lido: boolean; ativo: boolean;
  /** Chave do local de preparo ('kitchen' | 'bar' | 'setor:<id>') quando o aviso é de um local. */
  localChave?: string;
}
export type Detectado = Pick<EventoNotificacao, 'id' | 'tipo' | 'titulo' | 'detalhe' | 'localChave'>;

// ---- Quem vê o quê ----
export function publicosDoUsuario(user: { role: string; permissions?: { caixa?: boolean; kitchen?: boolean; bar?: boolean } }): Publico[] {
  if (user.role === 'owner' || user.role === 'universal' || user.role === 'manager') return ['gerencia', 'caixa', 'salao', 'cozinha', 'bar'];
  const p = new Set<Publico>(['salao']);
  if (user.role === 'cashier' || user.permissions?.caixa === true) p.add('caixa');
  if (user.permissions?.kitchen === true) p.add('cozinha');
  if (user.permissions?.bar === true) p.add('bar');
  return [...p];
}

// Tipos que existem para esta loja: sem KDS (ou fluxo de impressão direta) não há "pedido novo / pronto / atrasado".
export function tiposAplicaveis(store: { config?: any } | null | undefined): Set<TipoNotificacao> {
  const m = resolveStoreModules(store);
  const kds = (m.kitchen_kds || m.bar_kds) && resolveOrderFlow(store) === 'kds';
  return new Set(TIPOS.filter((t) => !t.exigeKds || kds).map((t) => t.tipo));
}

// ---- Preferências (stores.config.notifications) ----
export interface PrefsNotificacao { som: boolean; tipos: Record<TipoNotificacao, boolean> }
export function resolverPrefs(config: { notifications?: unknown } | null | undefined): PrefsNotificacao {
  const raw = config?.notifications as { som?: unknown; tipos?: Record<string, unknown> } | undefined;
  const tipos = Object.fromEntries(TIPOS.map((t) => [t.tipo, typeof raw?.tipos?.[t.tipo] === 'boolean' ? (raw!.tipos![t.tipo] as boolean) : true])) as Record<TipoNotificacao, boolean>;
  return { som: typeof raw?.som === 'boolean' ? raw.som : true, tipos };
}

// ---- Detecção a partir dos dados que o app já busca ----
export interface MesaLike { id: string; number: number | string; status: string; waiter_requested?: boolean | null }
export function detectarMesas(mesas: MesaLike[]): Detectado[] {
  const out: Detectado[] = [];
  mesas.forEach((t) => {
    const ocupada = t.status === 'occupied' || t.status === 'waiting_bill';
    if (!ocupada) return;
    if (t.waiter_requested) out.push({ id: `chamada_garcom:${t.id}`, tipo: 'chamada_garcom', titulo: `Mesa ${t.number} chama o garçom` });
    if (t.status === 'waiting_bill') out.push({ id: `pedido_conta:${t.id}`, tipo: 'pedido_conta', titulo: `Mesa ${t.number} pediu a conta` });
    // De propósito NÃO há aviso de "cliente sentou e ainda não pediu": era ruído (pedido do dono, 04/10).
  });
  return out;
}

export interface ItemKdsCompleto {
  id: string; order_id?: string | null; status: string; sector_id?: string | null; created_at: string;
  product?: { name?: string; prep_time_minutes?: number | null } | null;
  order?: { order_type?: string; tables?: { number?: number | string } | null; customer_name?: string | null } | null;
}
const onde = (i: ItemKdsCompleto) => (i.order?.order_type === 'counter' ? (i.order?.customer_name || 'Balcão') : `Mesa ${i.order?.tables?.number ?? '?'}`);

export function detectarItens(
  itens: ItemKdsCompleto[],
  base: 'kitchen' | 'bar',
  nomesSetores: Record<string, string>,
  agora: number,
): Detectado[] {
  const out: Detectado[] = [];
  const pedidosVistos = new Set<string>();
  itens.forEach((i) => {
    const setorConhecido = i.sector_id && nomesSetores[i.sector_id] ? i.sector_id : null;
    const localChave = setorConhecido ? `setor:${setorConhecido}` : base;
    const nomeLocal = setorConhecido ? nomesSetores[setorConhecido] : base === 'bar' ? 'Bar' : 'Cozinha';
    if (itemPrecisaAcao(i)) {
      const chavePedido = `${localChave}:${i.order_id ?? i.id}`;
      if (!pedidosVistos.has(chavePedido)) {
        pedidosVistos.add(chavePedido);
        out.push({ id: `pedido_novo:${chavePedido}`, tipo: 'pedido_novo', titulo: `Pedido novo · ${nomeLocal}`, detalhe: onde(i), localChave });
      }
    }
    if (i.status === 'ready') out.push({ id: `item_pronto:${i.id}`, tipo: 'item_pronto', titulo: `Pronto: ${i.product?.name ?? 'item'}`, detalhe: `${onde(i)} · ${nomeLocal}`, localChave });
    const prep = i.product?.prep_time_minutes;
    const ativo = i.status === 'pending' || i.status === 'accepted' || i.status === 'preparing';
    if (ativo && prep && (agora - new Date(i.created_at).getTime()) / 60000 > prep) {
      out.push({ id: `item_atrasado:${i.id}`, tipo: 'item_atrasado', titulo: `Atrasado: ${i.product?.name ?? 'item'}`, detalhe: `${onde(i)} · ${nomeLocal}`, localChave });
    }
  });
  return out;
}

// ---- Fontes lentas (consultadas a cada poucos minutos, só para gerência/caixa) ----
const DUAS_HORAS = 2 * 3600 * 1000;
const VINTE_E_QUATRO_HORAS = 24 * 3600 * 1000;

export function detectarImpressoras(jobs: { id: string; status: string; title: string; created_at: string }[], agora: number): Detectado[] {
  return jobs
    .filter((j) => j.status === 'error' && agora - new Date(j.created_at).getTime() < DUAS_HORAS)
    .map((j) => ({ id: `impressora_falhou:${j.id}`, tipo: 'impressora_falhou' as const, titulo: 'Impressão falhou', detalhe: j.title }));
}

export function detectarNotas(
  notas: { id: string; status: string; modelo: string; numero: number | null; motivo_erro?: string | null; created_at: string }[],
  agora: number,
): Detectado[] {
  return notas
    .filter((n) => (n.status === 'rejeitada' || n.status === 'erro') && agora - new Date(n.created_at).getTime() < VINTE_E_QUATRO_HORAS)
    .map((n) => ({
      id: `nota_rejeitada:${n.id}`, tipo: 'nota_rejeitada' as const,
      titulo: `${n.modelo === '65' ? 'NFC-e' : 'NF-e'}${n.numero ? ` nº ${n.numero}` : ''} ${n.status === 'erro' ? 'com erro' : 'rejeitada'}`,
      detalhe: n.motivo_erro ? n.motivo_erro.slice(0, 120) : undefined,
    }));
}

export function detectarSangrias(eventos: { operator_name: string; event_type: string; created_at: string; details: Record<string, unknown> }[]): Detectado[] {
  return eventos
    .filter((e) => e.event_type === 'sangria_grande')
    .map((e) => ({
      id: `sangria_alta:${e.created_at}:${e.operator_name}`, tipo: 'sangria_alta' as const,
      titulo: `Sangria de R$ ${Number(e.details.valor ?? 0).toFixed(2).replace('.', ',')}`,
      detalhe: [e.operator_name, e.details.motivo ? String(e.details.motivo) : ''].filter(Boolean).join(' · '),
    }));
}

export function detectarEstoque(alertas: { name: string; stock: number | null; threshold: number }[]): Detectado[] {
  return alertas.map((a) => ({
    id: `estoque_baixo:${a.name}`, tipo: 'estoque_baixo' as const, titulo: `Estoque baixo: ${a.name}`,
    detalhe: a.stock == null ? `mínimo ${a.threshold}` : `${a.stock} em estoque · mínimo ${a.threshold}`,
  }));
}

// ---- Reconciliação: dedupe, resolução automática e "novos" (os que tocam som) ----
const SEIS_HORAS = 6 * 3600 * 1000;
export function reconciliar(
  atuais: EventoNotificacao[],
  detectados: Detectado[],
  tiposVistos: TipoNotificacao[],
  agora: number,
  limite = 100,
): { lista: EventoNotificacao[]; novos: EventoNotificacao[] } {
  const vistos = new Set(tiposVistos);
  const porId = new Map(atuais.map((e) => [e.id, e]));
  const detectadosIds = new Set(detectados.map((d) => d.id));
  const novos: EventoNotificacao[] = [];

  detectados.forEach((d) => {
    const antigo = porId.get(d.id);
    if (antigo && antigo.ativo) { porId.set(d.id, { ...antigo, titulo: d.titulo, detalhe: d.detalhe, localChave: d.localChave }); return; }
    const ev: EventoNotificacao = { ...d, criadoEm: agora, lido: false, ativo: true };
    porId.set(d.id, ev);
    novos.push(ev);
  });
  // Só resolve o que veio de uma fonte que respondeu agora (fonte fora do ar não "resolve" nada).
  porId.forEach((e, id) => {
    if (e.ativo && DEF[e.tipo].resolve && vistos.has(e.tipo) && !detectadosIds.has(id)) porId.set(id, { ...e, ativo: false });
  });
  const lista = [...porId.values()]
    .filter((e) => e.ativo || agora - e.criadoEm < SEIS_HORAS)
    .sort((a, b) => b.criadoEm - a.criadoEm)
    .slice(0, limite);
  return { lista, novos };
}

export function filtrarEventos(
  lista: EventoNotificacao[],
  ctx: { prefs: PrefsNotificacao; aplicaveis: Set<TipoNotificacao>; publicos: Publico[]; locaisPermitidos: Set<string> | null },
): EventoNotificacao[] {
  return lista.filter((e) => {
    const def = DEF[e.tipo];
    if (!ctx.aplicaveis.has(e.tipo) || !ctx.prefs.tipos[e.tipo]) return false;
    if (!def.publicos.some((p) => ctx.publicos.includes(p))) return false;
    if (e.localChave && ctx.locaisPermitidos && !ctx.locaisPermitidos.has(e.localChave)) return false;
    return true;
  });
}

export const contarNaoLidos = (lista: EventoNotificacao[]): number => lista.filter((e) => e.ativo && !e.lido).length;
export const marcarLidos = (lista: EventoNotificacao[], ids?: string[]): EventoNotificacao[] =>
  lista.map((e) => (!ids || ids.includes(e.id) ? { ...e, lido: true } : e));

// A tela de cozinha/bar já toca som de pedido novo e de atraso: com ela aberta, o sino não repete.
export function somDoEvento(e: EventoNotificacao, ctx: { prefs: PrefsNotificacao; abaAtual: string }): Som | null {
  if (!ctx.prefs.som || !ctx.prefs.tipos[e.tipo]) return null;
  const kdsAberto = ctx.abaAtual === 'kitchen' || ctx.abaAtual === 'bar' || ctx.abaAtual === 'producao';
  if (kdsAberto && (e.tipo === 'pedido_novo' || e.tipo === 'item_atrasado')) return null;
  return DEF[e.tipo].som;
}

// ---- Persistência (localStorage por loja+usuário): recarregar a página não re-toca nem apaga o histórico ----
export const serializarEventos = (lista: EventoNotificacao[]): string => JSON.stringify(lista.slice(0, 100));
export function restaurarEventos(json: string | null): EventoNotificacao[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter((e): e is EventoNotificacao =>
      e && typeof e.id === 'string' && typeof e.titulo === 'string' && typeof e.criadoEm === 'number'
      && typeof e.lido === 'boolean' && typeof e.ativo === 'boolean' && e.tipo in DEF);
  } catch { return []; }
}

// "agora", "há 3 min", "há 2 h" — texto curto para a linha do aviso.
export function tempoRelativo(desde: number, agora: number): string {
  const min = Math.floor(Math.max(0, agora - desde) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.floor(h / 24)} d`;
}
