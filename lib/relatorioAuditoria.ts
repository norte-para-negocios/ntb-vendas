// Relatório diário de auditoria (06/10/2026): tudo o que cada login fez no dia, em ordem de horário, para o gestor.
// Funções puras (descrever/agrupar/alertas) + montagem a partir do banco (staff_audit_log, migration 163).
import type { SupabaseClient } from '@supabase/supabase-js';
import { eventosHistoricos, PRIMEIRO_DIA_COM_AUDITORIA } from '@/lib/relatorioHistorico';

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

const STATUS_MESA: Record<string, string> = { available: 'livre', occupied: 'ocupada', waiting_bill: 'pediu a conta', blocked: 'bloqueada', reserved: 'reservada' };
const METODO: Record<string, string> = { CASH: 'dinheiro', DEBIT: 'débito', CREDIT: 'crédito', PIX: 'Pix', MULTIPLE: 'mais de uma forma' };
const SEGREDO = /^(pin|pin_attempts|pin_locked_until)$/;
const semSegredo = (o: Record<string, any>) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !SEGREDO.test(k)));

function pagamentoTexto(pd: any): string {
  if (!pd || typeof pd !== 'object') return '';
  const ms = Array.isArray(pd.methods) ? pd.methods.map((m: any) => `${BRL(m.amount)} em ${METODO[m.method] || m.method}${m.brand ? ` ${m.brand}` : ''}`).join(' + ') : '';
  return `${pd.total != null ? BRL(pd.total) : ''}${ms ? ` (${ms})` : ''}${pd.operador_nome ? ` — recebido por ${pd.operador_nome}` : ''}`.trim();
}

function camposAlterados(m: Record<string, { de: unknown; para: unknown }>, max = 6): string {
  const partes = Object.entries(m).slice(0, max).map(([k, v]) => {
    const fmt = (x: unknown) => (x === null || x === undefined ? 'vazio' : typeof x === 'object' ? trunc(JSON.stringify(x), 50) : trunc(String(x), 50));
    return `${k}: ${fmt(v.de)} para ${fmt(v.para)}`;
  });
  return partes.join('; ') + (Object.keys(m).length > max ? '; …' : '');
}

export function descreverEvento(ev: EventoAuditoria, n: Nomes = SEM_NOMES): string {
  if (ev.origin === 'app' && ev.summary) return ev.summary;
  const d = ev.details || {};
  const mudou = semSegredo(d.mudou || {}) as Record<string, { de: any; para: any }>;
  const linha = semSegredo(d.linha || {}) as Record<string, any>;
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
      return `Item ${nome}${emMesa}: ${STATUS_ITEM[String(mudou.status.de)] || mudou.status.de} para ${STATUS_ITEM[para] || para}`;
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
      return `Pedido${emMesa}: ${mudou.status.de} para ${para}`;
    }
    if (mudou.table_id) {
      const nm = (id: any) => (id && n.mesas[id] != null ? `mesa ${n.mesas[id]}` : 'outra mesa');
      return `MUDOU o pedido da ${nm(mudou.table_id.de)} para a ${nm(mudou.table_id.para)}`;
    }
    if (mudou.payment_details) return `Registrou pagamento${emMesa}: ${pagamentoTexto(mudou.payment_details.para) || camposAlterados({ payment_details: mudou.payment_details }, 1)}`;
    if (mudou.payment_method) return `Alterou forma de pagamento${emMesa}: ${camposAlterados({ payment_method: mudou.payment_method }, 1)}`;
    return `Alterou pedido${emMesa}: ${camposAlterados(mudou)}`;
  }
  if (tabela === 'tables') {
    if (op === 'update') {
      const num = n.mesas[ev.entity_id || ''] ?? '';
      const partes: string[] = [];
      if (mudou.status) partes.push(`${STATUS_MESA[String(mudou.status.de)] || mudou.status.de} para ${STATUS_MESA[String(mudou.status.para)] || mudou.status.para}`);
      if (mudou.current_host_name) partes.push(mudou.current_host_name.para ? `cliente ${mudou.current_host_name.para}` : 'sem cliente');
      const resto = { ...mudou }; delete (resto as any).status; delete (resto as any).current_host_name;
      if (Object.keys(resto).length) partes.push(camposAlterados(resto));
      return `Mesa ${num}: ${partes.join('; ') || 'alterada'}`;
    }
    return `${op === 'insert' ? 'Criou' : 'Apagou'} mesa`;
  }
  if (tabela === 'table_sessions') {
    const m = (linha.table_id && n.mesas[linha.table_id]) ?? (d.ctx?.table_id && n.mesas[d.ctx.table_id]) ?? '';
    if (op === 'insert') return `Abriu sessão da mesa ${m}${linha.host_name ? ` (cliente ${linha.host_name})` : ''}`;
    if (mudou.closed_at) return `Encerrou a sessão da mesa ${m}`;
    return `Alterou sessão da mesa ${m}: ${camposAlterados(mudou, 3)}`;
  }
  if (tabela === 'fiscal_notas') {
    const nt = ev.entity_id ? n.notas[ev.entity_id] : undefined;
    const rot = nt ? `${nt.modelo === '65' ? 'NFC-e' : 'NF-e'} nº ${nt.numero ?? ''}` : 'nota fiscal';
    if (op === 'insert') return `Nota fiscal emitida: ${rot} (${linha.status ?? ''}) ${linha.valor_total != null ? BRL(linha.valor_total) : ''}`.trim();
    if (mudou.status) return `${rot}: ${mudou.status.de} para ${mudou.status.para}`;
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
    if (!Object.keys(mudou).length) return `Alterou dados de acesso do usuário${nome ? ` ${nome}` : ''} (senha ou login)`;
    return `Alterou usuário${nome ? ` ${nome}` : ''}: ${camposAlterados(mudou)}`;
  }
  if (tabela === 'print_jobs') return `Mandou imprimir: ${linha.title ?? 'documento'}${linha.destination ? ` (${linha.destination})` : ''}`;
  const nomeTab = TABELA[tabela] || tabela;
  if (op === 'update') return `Alterou ${nomeTab.toLowerCase()}: ${camposAlterados(mudou)}`;
  return `${(OP[op] || op).replace(/^./, (c) => c.toUpperCase())} ${nomeTab.toLowerCase()}${linha.name ? ` ${linha.name}` : ''}`;
}

export type Categoria = 'acesso' | 'pedido' | 'pagamento' | 'impressao' | 'mesa' | 'caixa' | 'fiscal' | 'cardapio' | 'equipe' | 'config' | 'ponto' | 'outro';
export type LinhaRelatorio = { hora: string; h: number; texto: string; alerta: boolean; acao: string; categoria: Categoria };
export type SecaoLogin = { chave: string; nome: string; papel: string; total: number; primeira: string; ultima: string; alertas: number; linhas: LinhaRelatorio[]; porHora: number[] };

export function categoriaDe(ev: EventoAuditoria, texto: string): Categoria {
  const a = ev.action;
  if (a.startsWith('login.') || a.startsWith('sessao.')) return 'acesso';
  if (a.startsWith('reimpressao.') || a === 'print_jobs.insert') return 'impressao';
  if (a.startsWith('fiscal')) return 'fiscal';
  if (a.startsWith('cash_')) return 'caixa';
  if (a.startsWith('operator_checkins')) return 'ponto';
  if (a.startsWith('tables.') || a.startsWith('table_sessions.') || /^MUDOU o pedido da/.test(texto)) return 'mesa';
  if (/pagamento|Fechou\/entregou/i.test(texto)) return 'pagamento';
  if (a.startsWith('orders.') || a.startsWith('order_items.')) return 'pedido';
  if (/^(products|categories|category_groups|product_|price_schedules|discount_coupons)/.test(a)) return 'cardapio';
  if (a.startsWith('store_users')) return 'equipe';
  if (/^(stores|printer_configs|print_sectors|store_fiscal_config)/.test(a)) return 'config';
  return 'outro';
}

export const horaDoDia = (iso: string) => Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));

// Ações que o gestor quer ver em destaque.
export function ehAlerta(ev: EventoAuditoria, texto: string): boolean {
  const a = ev.action;
  if (a.startsWith('reimpressao.') || a === 'historico.zerar' || a === 'login.falhou' || a === 'login.bloqueado' || a === 'fiscal.exportar') return true;
  if (/^(CANCELOU|APAGOU|ZEROU|MUDOU|ESTORNOU|REMOVEU)/.test(texto)) return true;      // cancelamento, exclusão, pedido movido de mesa
  if (a.endsWith('.delete')) return true;
  if (a === 'fiscal_notas.update' && /cancelada|rejeitada/.test(texto)) return true;
  if (/^Alterou forma de pagamento/.test(texto)) return true;          // pagamento NORMAL não é alerta; só a troca depois
  if (a === 'products.update' && /price/.test(texto)) return true;     // preço de produto mudou
  if (/taxa|desconto/i.test(texto) && a.endsWith('.update')) return true;
  return false;
}

export function agruparPorLogin(eventos: EventoAuditoria[], n: Nomes = SEM_NOMES): SecaoLogin[] {
  const mapa = new Map<string, SecaoLogin>();
  for (const ev of [...eventos].filter((e) => !e.action.startsWith('relatorio.')).sort((x, y) => x.occurred_at.localeCompare(y.occurred_at))) {
    const sem = !ev.actor_user_id && (!ev.actor_name || ev.actor_name === '(sem login)');
    const chave = ev.actor_user_id || (sem ? '(sistema)' : `nome:${ev.actor_name}`);
    const nome = sem ? 'Sistema / clientes pelo QR (sem login)' : (ev.actor_name || 'Desconhecido');
    let s = mapa.get(chave);
    if (!s) { s = { chave, nome, papel: sem ? '' : rotuloPapel(ev.actor_role), total: 0, primeira: ev.occurred_at, ultima: ev.occurred_at, alertas: 0, linhas: [], porHora: Array(24).fill(0) }; mapa.set(chave, s); }
    const texto = descreverEvento(ev, n);
    const alerta = ehAlerta(ev, texto);
    const h = horaDoDia(ev.occurred_at);
    s.linhas.push({ hora: horaBR(ev.occurred_at), h, texto, alerta, acao: ev.action, categoria: categoriaDe(ev, texto) });
    s.porHora[h]++;
    s.total++; s.ultima = ev.occurred_at; if (alerta) s.alertas++;
  }
  // pessoas primeiro (por nº de ações), o bloco "sistema" por último
  return [...mapa.values()].sort((a, b) => (a.chave === '(sistema)' ? 1 : 0) - (b.chave === '(sistema)' ? 1 : 0) || b.total - a.total);
}

export function textoWhatsApp(opts: { loja: string; dia: string; secoes: SecaoLogin[]; link?: string }): string {
  const [y, m, d] = opts.dia.split('-');
  const linhas: string[] = [`*Auditoria do dia ${d}/${m}/${y} — ${opts.loja}*`];
  if (!opts.secoes.length) return linhas.concat('Nenhuma ação registrada neste dia.').join('\n');
  for (const s of opts.secoes) {
    const alert = s.alertas ? ` · ⚠ ${s.alertas} para conferir` : '';
    linhas.push(`• ${s.nome}${s.papel ? ` (${s.papel})` : ''}: ${s.total} ações (${horaBR(s.primeira).slice(0, 5)}–${horaBR(s.ultima).slice(0, 5)})${alert}`);
  }
  linhas.push('', opts.link ? `Ver o relatório completo, por login e hora a hora:\n${opts.link}` : 'O relatório completo, hora a hora por login, está no PDF.');
  return linhas.join('\n');
}

// ---------- montagem a partir do banco ----------
const diaISO = (dia: string) => ({ de: `${dia}T00:00:00-03:00`, ate: new Date(new Date(`${dia}T00:00:00-03:00`).getTime() + 24 * 3600 * 1000).toISOString() });

export async function buscarEventosDoDia(admin: SupabaseClient, storeId: string, dia: string): Promise<EventoAuditoria[]> {
  // dias anteriores à auditoria nova: remonta pelo que as tabelas já guardavam (itens, pagamentos, cancelamentos, turnos, ponto)
  if (dia < PRIMEIRO_DIA_COM_AUDITORIA) return eventosHistoricos(admin, storeId, dia);
  const { de, ate } = diaISO(dia);
  const todos: EventoAuditoria[] = [];
  for (let off = 0; off < 50000; off += 1000) {
    const { data, error } = await admin.from('staff_audit_log').select('*').eq('store_id', storeId).gte('occurred_at', de).lt('occurred_at', ate).order('occurred_at').order('id').range(off, off + 999);
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
    const tid = e.details?.mudou?.table_id; if (tid?.de) mesaIds.add(tid.de); if (tid?.para) mesaIds.add(tid.para);
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

export async function montarRelatorioDia(admin: SupabaseClient, storeId: string, loja: string, dia: string, link?: string) {
  const eventos = await buscarEventosDoDia(admin, storeId, dia);
  const nomes = await carregarNomes(admin, eventos);
  const secoes = agruparPorLogin(eventos, nomes);
  return { eventos, secoes, texto: textoWhatsApp({ loja, dia, secoes, link }) };
}

// Números do topo do relatório.
export function resumoDoDia(secoes: SecaoLogin[]) {
  const todas = secoes.flatMap((x) => x.linhas);
  const pessoas = secoes.filter((x) => x.chave !== '(sistema)');
  return {
    acoes: pessoas.reduce((t, x) => t + x.total, 0),
    logins: pessoas.length,
    alertas: todas.filter((l) => l.alerta).length,
    reimpressoes: todas.filter((l) => l.acao.startsWith('reimpressao.')).length,
    cancelamentos: todas.filter((l) => /^(CANCELOU|APAGOU)/.test(l.texto)).length,
    pagamentos: todas.filter((l) => l.categoria === 'pagamento' && /Registrou pagamento/.test(l.texto)).length,
  };
}
