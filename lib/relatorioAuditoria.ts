// Relatório diário de auditoria (06/10/2026): tudo o que cada login fez no dia, em ordem de horário, para o gestor.
// Funções puras (descrever/agrupar/alertas) + montagem a partir do banco (staff_audit_log, migration 163).
import type { SupabaseClient } from '@supabase/supabase-js';

export type EventoAuditoria = {
  id: number; store_id: string | null; occurred_at: string; actor_user_id: string | null; actor_name: string | null; actor_role: string | null;
  action: string; entity: string | null; entity_id: string | null; summary: string | null; details: Record<string, any>; origin: string;
};

export type Nomes = {
  produtos: Record<string, string>;
  mesas: Record<string, string | number>;          // table_id -> número
  pedidos: Record<string, { table_id: string | null; order_type: string | null; customer_name: string | null }>;
  notas: Record<string, { numero: number | null; modelo: string }>;
};

export const SEM_NOMES: Nomes = { produtos: {}, mesas: {}, pedidos: {}, notas: {} };

const PAPEL: Record<string, string> = { owner: 'Dono', manager: 'Gerente', waiter: 'Garçom', cashier: 'Caixa', kitchen: 'Cozinha', bar: 'Bar', open: 'Modo Aberto', universal: 'Conta universal' };
export const rotuloPapel = (r: string | null | undefined) => (r ? PAPEL[r] || r : '');

const TABELA: Record<string, string> = {
  orders: 'Pedido', order_items: 'Item de pedido', tables: 'Mesa', table_sessions: 'Sessão de mesa', products: 'Produto', categories: 'Categoria',
  category_groups: 'Grupo de categorias', product_option_groups: 'Grupo de adicionais', product_options: 'Adicional', product_recommendations: 'Sugestão de produto',
  store_users: 'Usuário', stores: 'Configuração da loja', printer_configs: 'Impressora', print_sectors: 'Local de preparo', discount_coupons: 'Cupom',
  price_schedules: 'Preço por horário', fiscal_notas: 'Nota fiscal', cash_shifts: 'Turno de caixa', cash_movements: 'Movimento de caixa',
  table_reservations: 'Reserva', store_fiscal_config: 'Config. fiscal', operator_checkins: 'Ponto', print_jobs: 'Impressão',
};
const OP: Record<string, string> = { insert: 'criou', update: 'alterou', delete: 'apagou' };
const STATUS_ITEM: Record<string, string> = { pending: 'pendente', accepted: 'aceito', preparing: 'em preparo', ready: 'pronto', delivered: 'entregue', canceled: 'cancelado', cancelled: 'cancelado' };
const BRL = (v: unknown) => `R$ ${Number(v ?? 0).toFixed(2).replace('.', ',')}`;
const trunc = (s: string, n = 120) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export const horaBR = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

function mesaDe(ev: EventoAuditoria, n: Nomes): string {
  const ctx = ev.details?.ctx || {};
  let tid: string | null = ctx.table_id ?? ev.details?.linha?.table_id ?? null;
  if (!tid && ctx.order_id && n.pedidos[ctx.order_id]) tid = n.pedidos[ctx.order_id].table_id;
  if (!tid && ev.entity === 'orders' && ev.entity_id && n.pedidos[ev.entity_id]) tid = n.pedidos[ev.entity_id].table_id;
  if (!tid && ev.entity === 'tables') tid = ev.entity_id;
  if (tid && n.mesas[tid] != null) return `mesa ${n.mesas[tid]}`;
  const ped = ctx.order_id ? n.pedidos[ctx.order_id] : ev.entity === 'orders' && ev.entity_id ? n.pedidos[ev.entity_id] : undefined;
  if (ped?.order_type === 'counter') return `balcão${ped.customer_name ? ` (${ped.customer_name})` : ''}`;
  return '';
}

function camposAlterados(m: Record<string, { de: unknown; para: unknown }>, max = 6): string {
  const partes = Object.entries(m).slice(0, max).map(([k, v]) => {
    const fmt = (x: unknown) => (x === null || x === undefined ? 'vazio' : typeof x === 'object' ? trunc(JSON.stringify(x), 50) : trunc(String(x), 50));
    return `${k}: ${fmt(v.de)} → ${fmt(v.para)}`;
  });
  return partes.join('; ') + (Object.keys(m).length > max ? '; …' : '');
}

export function descreverEvento(ev: EventoAuditoria, n: Nomes = SEM_NOMES): string {
  if (ev.origin === 'app' && ev.summary) return ev.summary;
  const d = ev.details || {};
  const mudou = (d.mudou || {}) as Record<string, { de: any; para: any }>;
  const linha = (d.linha || {}) as Record<string, any>;
  const mesa = mesaDe(ev, n);
  const emMesa = mesa ? ` (${mesa})` : '';
  const [tabela, op] = ev.action.split('.');
  const prod = (id: any) => (id && n.produtos[id]) || 'item';

  if (tabela === 'order_items') {
    if (op === 'insert') return `Lançou ${linha.quantity ?? 1}x ${prod(linha.product_id)}${emMesa}${linha.notes ? ` — obs: ${trunc(String(linha.notes), 60)}` : ''}`;
    if (op === 'delete') return `Apagou item ${prod(d.ctx?.product_id)}${emMesa}`;
    if (mudou.status) {
      const para = String(mudou.status.para);
      const nome = prod(d.ctx?.product_id);
      if (para === 'canceled' || para === 'cancelled') return `CANCELOU item ${nome}${emMesa}`;
      return `Item ${nome}${emMesa}: ${STATUS_ITEM[String(mudou.status.de)] || mudou.status.de} → ${STATUS_ITEM[para] || para}`;
    }
    if (mudou.quantity || mudou.price_at_time) return `Alterou item ${prod(d.ctx?.product_id)}${emMesa}: ${camposAlterados(mudou)}`;
    if (mudou.fiscal_nota_id) return `Item vinculado a nota fiscal${emMesa}`;
    return `Alterou item ${prod(d.ctx?.product_id)}${emMesa}: ${camposAlterados(mudou)}`;
  }
  if (tabela === 'orders') {
    if (op === 'insert') return `Abriu pedido${emMesa || (linha.order_type === 'counter' ? ' (balcão)' : '')}`;
    if (op === 'delete') return `APAGOU pedido${emMesa}`;
    if (mudou.status) {
      const para = String(mudou.status.para);
      const pg = d.mudou?.payment_method?.para || linha.payment_method;
      if (para === 'cancelled' || para === 'canceled') return `CANCELOU pedido${emMesa}`;
      if (para === 'delivered') return `Fechou/entregou pedido${emMesa}${pg ? ` — pagamento ${pg}` : ''}${mudou.total ? ` ${BRL(mudou.total.para)}` : ''}`;
      return `Pedido${emMesa}: ${mudou.status.de} → ${para}`;
    }
    if (mudou.payment_details || mudou.payment_method) return `Registrou/alterou pagamento${emMesa}: ${camposAlterados(mudou, 3)}`;
    return `Alterou pedido${emMesa}: ${camposAlterados(mudou)}`;
  }
  if (tabela === 'tables') {
    if (op === 'update') return `Mesa ${n.mesas[ev.entity_id || ''] ?? ''}: ${camposAlterados(mudou)}`.replace('Mesa : ', 'Mesa: ');
    return `${op === 'insert' ? 'Criou' : 'Apagou'} mesa`;
  }
  if (tabela === 'fiscal_notas') {
    const nt = ev.entity_id ? n.notas[ev.entity_id] : undefined;
    const rot = nt ? `${nt.modelo === '65' ? 'NFC-e' : 'NF-e'} nº ${nt.numero ?? ''}` : 'nota fiscal';
    if (op === 'insert') return `Nota fiscal emitida: ${rot} (${linha.status ?? ''}) ${linha.valor_total != null ? BRL(linha.valor_total) : ''}`.trim();
    if (mudou.status) return `${rot}: ${mudou.status.de} → ${mudou.status.para}`;
    return `Alterou ${rot}: ${camposAlterados(mudou, 3)}`;
  }
  if (tabela === 'cash_shifts') {
    if (op === 'insert') return `ABRIU turno de caixa (fundo ${BRL(linha.opening_amount ?? linha.initial_amount ?? 0)})`;
    if (mudou.closed_at || mudou.status) return `FECHOU turno de caixa: ${camposAlterados(mudou, 4)}`;
    return `Alterou turno de caixa: ${camposAlterados(mudou, 4)}`;
  }
  if (tabela === 'cash_movements') return `Movimento de caixa (${linha.type ?? linha.kind ?? ''}) ${BRL(linha.amount)}${linha.reason ? ` — ${trunc(String(linha.reason), 60)}` : ''}`;
  if (tabela === 'operator_checkins') return op === 'insert' ? 'Bateu ponto de ENTRADA' : 'Bateu ponto de SAÍDA';
  if (tabela === 'products') {
    const nome = linha.name || (ev.entity_id && n.produtos[ev.entity_id]) || '';
    if (op === 'insert') return `Criou produto ${nome} (${BRL(linha.price)})`;
    if (op === 'delete') return `APAGOU produto ${nome}`;
    return `Alterou produto ${nome || (ev.entity_id && n.produtos[ev.entity_id]) || ''}: ${camposAlterados(mudou)}`;
  }
  if (tabela === 'store_users') {
    const nome = linha.name || '';
    if (op === 'insert') return `Criou usuário ${nome} (${rotuloPapel(linha.role)})`;
    if (op === 'delete') return `APAGOU usuário ${nome}`;
    return `Alterou usuário${nome ? ` ${nome}` : ''}: ${camposAlterados(mudou)}`;
  }
  if (tabela === 'print_jobs') return `Mandou imprimir: ${linha.title ?? 'documento'}${linha.destination ? ` (${linha.destination})` : ''}`;
  const nomeTab = TABELA[tabela] || tabela;
  if (op === 'update') return `Alterou ${nomeTab.toLowerCase()}: ${camposAlterados(mudou)}`;
  return `${(OP[op] || op).replace(/^./, (c) => c.toUpperCase())} ${nomeTab.toLowerCase()}${linha.name ? ` ${linha.name}` : ''}`;
}

export type LinhaRelatorio = { hora: string; texto: string; alerta: boolean; acao: string };
export type SecaoLogin = { chave: string; nome: string; papel: string; total: number; primeira: string; ultima: string; alertas: number; linhas: LinhaRelatorio[] };

// Ações que o gestor quer ver em destaque.
export function ehAlerta(ev: EventoAuditoria, texto: string): boolean {
  const a = ev.action;
  if (a.startsWith('reimpressao.') || a === 'historico.zerar' || a === 'login.falhou' || a === 'login.bloqueado' || a === 'fiscal.exportar') return true;
  if (/^(CANCELOU|APAGOU|ZEROU|ABRIU turno|FECHOU turno)/.test(texto)) return true;
  if (a.endsWith('.delete')) return true;
  if (a === 'fiscal_notas.update' && /cancelada|rejeitada/.test(texto)) return true;
  if (/pagamento|taxa|desconto/i.test(texto) && a.endsWith('.update')) return true;
  return false;
}

export function agruparPorLogin(eventos: EventoAuditoria[], n: Nomes = SEM_NOMES): SecaoLogin[] {
  const mapa = new Map<string, SecaoLogin>();
  for (const ev of [...eventos].sort((x, y) => x.occurred_at.localeCompare(y.occurred_at))) {
    const sem = !ev.actor_user_id && (!ev.actor_name || ev.actor_name === '(sem login)');
    const chave = ev.actor_user_id || (sem ? '(sistema)' : `nome:${ev.actor_name}`);
    const nome = sem ? 'Sistema / clientes pelo QR (sem login)' : (ev.actor_name || 'Desconhecido');
    let s = mapa.get(chave);
    if (!s) { s = { chave, nome, papel: sem ? '' : rotuloPapel(ev.actor_role), total: 0, primeira: ev.occurred_at, ultima: ev.occurred_at, alertas: 0, linhas: [] }; mapa.set(chave, s); }
    const texto = descreverEvento(ev, n);
    const alerta = ehAlerta(ev, texto);
    s.linhas.push({ hora: horaBR(ev.occurred_at), texto, alerta, acao: ev.action });
    s.total++; s.ultima = ev.occurred_at; if (alerta) s.alertas++;
  }
  // pessoas primeiro (por nº de ações), o bloco "sistema" por último
  return [...mapa.values()].sort((a, b) => (a.chave === '(sistema)' ? 1 : 0) - (b.chave === '(sistema)' ? 1 : 0) || b.total - a.total);
}

export function textoWhatsApp(opts: { loja: string; dia: string; secoes: SecaoLogin[]; limite?: string }): string {
  const [y, m, d] = opts.dia.split('-');
  const linhas: string[] = [`*Auditoria do dia ${d}/${m}/${y} — ${opts.loja}*`];
  if (!opts.secoes.length) return linhas.concat('Nenhuma ação registrada neste dia.').join('\n');
  for (const s of opts.secoes) {
    const alert = s.alertas ? ` · ⚠ ${s.alertas} para conferir` : '';
    linhas.push(`• ${s.nome}${s.papel ? ` (${s.papel})` : ''}: ${s.total} ações (${horaBR(s.primeira).slice(0, 5)}–${horaBR(s.ultima).slice(0, 5)})${alert}`);
  }
  linhas.push('', 'O relatório completo, hora a hora por login, está no PDF.');
  return linhas.join('\n');
}

// ---------- montagem a partir do banco ----------
const diaISO = (dia: string) => ({ de: `${dia}T00:00:00-03:00`, ate: new Date(new Date(`${dia}T00:00:00-03:00`).getTime() + 24 * 3600 * 1000).toISOString() });

export async function buscarEventosDoDia(admin: SupabaseClient, storeId: string, dia: string): Promise<EventoAuditoria[]> {
  const { de, ate } = diaISO(dia);
  const todos: EventoAuditoria[] = [];
  for (let off = 0; off < 50000; off += 1000) {
    const { data, error } = await admin.from('staff_audit_log').select('*').eq('store_id', storeId).gte('occurred_at', de).lt('occurred_at', ate).order('occurred_at').range(off, off + 999);
    if (error) throw new Error('Falha ao ler a auditoria: ' + error.message);
    todos.push(...((data || []) as EventoAuditoria[]));
    if (!data || data.length < 1000) break;
  }
  // tentativas de login sem loja identificada (e-mail errado): casa pelo e-mail com a equipe da loja
  const { data: equipe } = await admin.from('store_users').select('email').eq('store_id', storeId);
  const emails = new Set((equipe || []).map((u: any) => String(u.email || '').toLowerCase()).filter(Boolean));
  if (emails.size) {
    const { data: falhas } = await admin.from('staff_audit_log').select('*').is('store_id', null).like('action', 'login.%').gte('occurred_at', de).lt('occurred_at', ate);
    for (const f of (falhas || []) as EventoAuditoria[]) if (emails.has(String(f.details?.email || '').toLowerCase())) todos.push(f);
  }
  return todos;
}

export async function carregarNomes(admin: SupabaseClient, eventos: EventoAuditoria[]): Promise<Nomes> {
  const n: Nomes = { produtos: {}, mesas: {}, pedidos: {}, notas: {} };
  const prodIds = new Set<string>(), mesaIds = new Set<string>(), pedIds = new Set<string>(), notaIds = new Set<string>();
  for (const e of eventos) {
    const c = e.details?.ctx || {}, l = e.details?.linha || {};
    if (c.product_id) prodIds.add(c.product_id); if (l.product_id) prodIds.add(l.product_id);
    if (c.table_id) mesaIds.add(c.table_id); if (l.table_id) mesaIds.add(l.table_id);
    if (c.order_id) pedIds.add(c.order_id);
    if (e.entity === 'orders' && e.entity_id) pedIds.add(e.entity_id);
    if (e.entity === 'tables' && e.entity_id) mesaIds.add(e.entity_id);
    if (e.entity === 'products' && e.entity_id) prodIds.add(e.entity_id);
    if (e.entity === 'fiscal_notas' && e.entity_id) notaIds.add(e.entity_id);
  }
  const em = async (tabela: string, cols: string, ids: Set<string>, cb: (r: any) => void) => {
    const lista = [...ids];
    for (let i = 0; i < lista.length; i += 200) {
      const { data } = await admin.from(tabela).select(cols).in('id', lista.slice(i, i + 200));
      (data || []).forEach(cb);
    }
  };
  await em('orders', 'id, table_id, order_type, customer_name', pedIds, (r) => { n.pedidos[r.id] = { table_id: r.table_id, order_type: r.order_type, customer_name: r.customer_name }; if (r.table_id) mesaIds.add(r.table_id); });
  await em('products', 'id, name', prodIds, (r) => { n.produtos[r.id] = r.name; });
  await em('tables', 'id, number', mesaIds, (r) => { n.mesas[r.id] = r.number; });
  await em('fiscal_notas', 'id, numero, modelo', notaIds, (r) => { n.notas[r.id] = { numero: r.numero, modelo: r.modelo }; });
  return n;
}

export async function montarRelatorioDia(admin: SupabaseClient, storeId: string, loja: string, dia: string) {
  const eventos = await buscarEventosDoDia(admin, storeId, dia);
  const nomes = await carregarNomes(admin, eventos);
  const secoes = agruparPorLogin(eventos, nomes);
  return { eventos, secoes, texto: textoWhatsApp({ loja, dia, secoes }) };
}
