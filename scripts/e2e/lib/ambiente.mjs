// Ambiente do teste: guardas de segurança, usuários QA, mesas, locais/impressoras temporários, mock do Estoque, medição da fila de
// impressão e LIMPEZA completa (com conferência no banco). Tudo que o teste cria é registrado em disco ANTES de ser criado, para que um
// teste interrompido possa ser desfeito com `node scripts/e2e/fluxo-completo.mjs --limpar`.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { RAIZ, ZZ, DONANA, SERTAO_ID, LOJAS_PERMITIDAS, carregarEnv, psql, consulta, esc, senhaAleatoria } from './common.mjs';

export const ESTADO = path.join(RAIZ, 'scripts/e2e/.estado-portao.json');
const PREFIXO = 'QA Portao';
const EMAIL_DOMINIO = 'zz.invalid';
// Tabelas (por store_id) cujo conteúdo é comparado antes/depois. Fora: ruído volátil que o app regrava sozinho.
const IGNORAR_CONTAGEM = new Set(['order_change_pings', 'table_change_pings', 'app_instances', 'print_agent_status', 'discovered_printers']);

export const ehSertao = (nome, slug) => /sert[aã]o/i.test(`${nome ?? ''} ${slug ?? ''}`);

export function livrePorta() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

export class Ambiente {
  constructor({ lojaId = ZZ, baseUrl }) {
    this.env = carregarEnv();
    this.lojaId = lojaId;
    this.baseUrl = baseUrl;
    this.admin = createClient(this.env.NEXT_PUBLIC_SUPABASE_URL, this.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    this.anon = createClient(this.env.NEXT_PUBLIC_SUPABASE_URL, this.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    this.estado = fs.existsSync(ESTADO) ? JSON.parse(fs.readFileSync(ESTADO, 'utf8')) : null;
    this.t0 = new Date().toISOString();
    this.usuarios = {};     // perfil -> {id,email,senha,nome}
    this.mesas = [];         // [{id, number}]
    this.mock = null;
  }

  // ---------- guardas (nunca o Sertão; só ZZ/Donana)
  async guardas() {
    if (!LOJAS_PERMITIDAS.has(this.lojaId) || this.lojaId === SERTAO_ID) throw new Error(`loja ${this.lojaId} não é permitida neste teste (só ZZ Laboratório e Donana Brotas)`);
    const { data: loja, error } = await this.admin.from('stores').select('id,name,slug,config,is_active').eq('id', this.lojaId).single();
    if (error || !loja) throw new Error(`não achei a loja ${this.lojaId}: ${error?.message}`);
    if (ehSertao(loja.name, loja.slug)) throw new Error(`ABORTADO: a loja ${loja.name} parece ser o Sertão`);
    if (/sert[aã]o/i.test(this.baseUrl)) throw new Error(`ABORTADO: BASE_URL ${this.baseUrl} parece apontar para o Sertão`);
    this.loja = loja;
    // Donana tem a integração REAL com o Estoque ligada: nunca roda a parte de baixa de estoque nela.
    const { data: sec } = await this.admin.from('store_ntb_estoque_secrets').select('store_id,ntb_estoque_url,ativo').eq('store_id', this.lojaId).maybeSingle();
    this.estoqueRealNaLoja = !!sec;
    return loja;
  }

  async haRestoDeExecucaoAnterior() {
    const { data } = await this.admin.from('store_users').select('id,email').eq('store_id', this.lojaId).like('email', `qa-portao-%@${EMAIL_DOMINIO}`);
    return data ?? [];
  }

  salvar() { fs.writeFileSync(ESTADO, JSON.stringify(this.estado, null, 2)); }
  iniciarEstado() {
    this.estado = { lojaId: this.lojaId, t0: this.t0, usuarios: [], mesas: [], configAlteradaChaves: {}, sectorIds: [], printerIds: [], produtos: [], estoqueSecretCriado: false, tabelasSnapshot: [], tentativasSnapshot: null, ordemIds: [], contagens: {}, marcoBaixas: null };
    this.salvar();
  }

  // ---------- fotografia do que existe antes (para comparar no fim)
  async tabelasDaLoja() {
    const linhas = consulta(`select table_name from information_schema.columns where table_schema='public' and column_name='store_id' order by 1`);
    return linhas.map((l) => l.table_name).filter((t) => !IGNORAR_CONTAGEM.has(t));
  }
  async idsPorTabela() {
    const out = {};
    for (const t of await this.tabelasDaLoja()) {
      const chave = t === 'stores' ? 'id' : (t === 'store_fiscal_config' || t === 'store_open_mode_attempts' || t === 'store_ntb_estoque_secrets' || t === 'store_omie_secrets' || t === 'store_fiscal_config_secrets' || t === 'store_fiscal_certificate_secrets' || t === 'print_agent_status') ? 'store_id' : 'id';
      const { data, error } = await this.admin.from(t).select(chave).eq('store_id', this.lojaId).limit(20000);
      if (error) { out[t] = null; continue; }
      out[t] = (data ?? []).map((r) => String(r[chave])).sort();
    }
    // cash_movements não tem store_id: entra via turnos da loja
    const { data: turnos } = await this.admin.from('cash_shifts').select('id').eq('store_id', this.lojaId);
    const ids = (turnos ?? []).map((t) => t.id);
    out.cash_movements = ids.length ? ((await this.admin.from('cash_movements').select('id').in('shift_id', ids).limit(20000)).data ?? []).map((r) => r.id).sort() : [];
    return out;
  }
  diffIds(antes, depois) {
    const extras = {}; const faltando = {};
    for (const t of Object.keys(antes)) {
      if (antes[t] === null || depois[t] == null) continue;
      const a = new Set(antes[t]); const d = new Set(depois[t]);
      const e = [...d].filter((x) => !a.has(x)); const f = [...a].filter((x) => !d.has(x));
      if (e.length) extras[t] = e;
      if (f.length) faltando[t] = f;
    }
    return { extras, faltando };
  }

  // Linhas novas que apareceram na loja depois da limpeza: o que é do teste (nossas) falha o portão; o resto (outra sessão usando a ZZ) só avisa.
  async classificarExtras(extras) {
    const e = this.estado; const mesaIds = new Set((e.mesas ?? []).map((m) => m.id));
    const nossas = {}; const alheias = {};
    const add = (alvo, t, id) => { (alvo[t] = alvo[t] ?? []).push(id); };
    for (const [t, ids] of Object.entries(extras)) {
      let linhas = [];
      if (t === 'order_items') linhas = (await this.admin.from('order_items').select('id,added_by_name,order_id,orders(table_id)').in('id', ids)).data ?? [];
      else if (t === 'orders') linhas = (await this.admin.from('orders').select('id,customer_name,table_id').in('id', ids)).data ?? [];
      else if (t === 'table_sessions') linhas = (await this.admin.from('table_sessions').select('id,table_id').in('id', ids)).data ?? [];
      else if (t === 'print_jobs') linhas = (await this.admin.from('print_jobs').select('id,title,printer_config_id').in('id', ids)).data ?? [];
      else linhas = ids.map((id) => ({ id }));
      for (const l of linhas) {
        let meu = false;
        if (t === 'order_items') meu = /^QA Portao/.test(l.added_by_name ?? '') || mesaIds.has(l.orders?.table_id);
        else if (t === 'orders') meu = /^QA Portao/.test(l.customer_name ?? '') || mesaIds.has(l.table_id);
        else if (t === 'table_sessions') meu = mesaIds.has(l.table_id);
        else if (t === 'print_jobs') meu = /QA Portao/i.test(l.title ?? '') || (e.printerIds ?? []).includes(l.printer_config_id);
        else if (t === 'store_users') meu = (e.usuarios ?? []).includes(l.id);
        else if (t === 'printer_configs') meu = (e.printerIds ?? []).includes(l.id);
        else if (t === 'print_sectors') meu = (e.sectorIds ?? []).includes(l.id);
        else if (t === 'store_ntb_estoque_secrets') meu = !!e.estoqueSecretCriado;
        else if (t === 'integracao_baixas' || t === 'fiscal_notas' || t === 'cash_shifts' || t === 'cash_movements' || t === 'cash_shift_audit_events') meu = true; // só existem por causa de pedidos/usuários do teste
        add(meu ? nossas : alheias, t, l.id);
      }
    }
    return { nossas, alheias };
  }

  // ---------- usuários QA (create_store_team_member_secure via ssh + docker exec psql). Senhas aleatórias, nunca impressas.
  async criarUsuarios(perfis) {
    for (const [chave, p] of Object.entries(perfis)) {
      const senha = senhaAleatoria();
      const email = `qa-portao-${chave}@${EMAIL_DOMINIO}`;
      const nome = `${PREFIXO} ${chave}`;
      const saida = psql(`select create_store_team_member_secure('${this.lojaId}','${esc(nome)}','${email}','${esc(senha)}','${p.role}','${JSON.stringify(p.perms)}'::jsonb, null);`);
      const j = JSON.parse(saida.trim().split('\n').pop());
      if (!j.success) throw new Error(`não criou o usuário ${chave}: ${j.message}`);
      this.usuarios[chave] = { id: j.id, email, senha, nome, role: p.role };
      this.estado.usuarios.push(j.id); this.salvar();
    }
  }

  // ---------- mesas livres para o teste (estado original guardado para restaurar)
  async reservarMesas(n) {
    const { data: todas } = await this.admin.from('tables').select('*').eq('store_id', this.lojaId).order('number');
    const ocupadas = new Set(((await this.admin.from('table_sessions').select('table_id').eq('store_id', this.lojaId).is('closed_at', null)).data ?? []).map((s) => s.table_id));
    // create_order_secure REAPROVEITA qualquer pedido "pending" da mesa (mesmo velho): mesa com pedido pendente fica de fora, para o teste
    // nunca misturar itens num pedido que não é dele.
    const comPedidoAberto = new Set(((await this.admin.from('orders').select('table_id').eq('store_id', this.lojaId).in('status', ['pending', 'accepted', 'preparing', 'ready'])).data ?? []).map((o) => o.table_id));
    const livres = (todas ?? []).filter((t) => t.status === 'available' && !ocupadas.has(t.id) && !comPedidoAberto.has(t.id) && t.number >= 10 && t.number <= 24 && !t.waiter_requested);
    if (livres.length < n) throw new Error(`a loja de teste não tem ${n} mesas livres (10-24) e sem pedido pendente`);
    // sorteio: reduz a chance de colidir com outra sessão que esteja usando a ZZ ao mesmo tempo
    const sorteadas = livres.sort(() => Math.random() - 0.5).slice(0, n);
    this.mesas = sorteadas.map((t) => ({ id: t.id, number: t.number }));
    const { data: antes } = await this.admin.from('orders').select('id,table_id,status,total,payment_details,payment_method,updated_at,customer_name,coupon_id,coupon_discount').in('table_id', sorteadas.map((t) => t.id));
    this.estado.mesas = sorteadas; this.estado.ordensAntes = antes ?? []; this.salvar();
    return this.mesas;
  }

  // ---------- mudar chaves da config e restaurar SÓ elas depois (não pisa em mudanças de outra sessão)
  async ajustarConfig(patch) {
    const { data } = await this.admin.from('stores').select('config').eq('id', this.lojaId).single();
    const cfg = { ...(data.config ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in this.estado.configAlteradaChaves)) this.estado.configAlteradaChaves[k] = k in cfg ? { existia: true, valor: cfg[k] } : { existia: false };
      if (v === undefined) delete cfg[k]; else cfg[k] = v;
    }
    this.salvar();
    const { error } = await this.admin.from('stores').update({ config: cfg }).eq('id', this.lojaId);
    if (error) throw new Error(`config: ${error.message}`);
  }

  // ---------- locais e impressoras temporários (fila print_jobs nunca é consumida: não existe agente/PC ligado à ZZ)
  async criarLocaisEImpressoras({ comCaixa = true } = {}) {
    const { data: setor, error } = await this.admin.from('print_sectors').insert({ store_id: this.lojaId, name: 'QA Portao Pizzaria', base: 'kitchen' }).select('*').single();
    if (error) throw new Error(`setor: ${error.message}`);
    this.setor = setor; this.estado.sectorIds.push(setor.id); this.salvar();
    const base = { store_id: this.lojaId, connection_type: 'network', ip_address: '127.0.0.1', port: 9, is_active: true, paper_width_mm: 80 };
    const lista = [
      { ...base, name: 'QA Portao Cozinha', destination: 'kitchen' },
      { ...base, name: 'QA Portao Bar', destination: 'bar' },
      { ...base, name: 'QA Portao Pizzaria', destination: 'kitchen', sector_id: setor.id },
    ];
    if (comCaixa) lista.push({ ...base, name: 'QA Portao Caixa', destination: 'receipt', documentos: ['pre_conta', 'comprovante', 'fechamento_caixa'] });
    const { data, error: e2 } = await this.admin.from('printer_configs').insert(lista).select('*');
    if (e2) throw new Error(`impressoras: ${e2.message}`);
    this.impressoras = data; data.forEach((p) => this.estado.printerIds.push(p.id)); this.salvar();
    return data;
  }
  async removerImpressoras() {
    const ids = (this.impressoras ?? []).map((p) => p.id);
    if (ids.length) await this.admin.from('printer_configs').delete().in('id', ids);
    this.impressoras = [];
  }

  // ---------- produtos do teste (um por local). Guarda sector/omie originais.
  async escolherProdutos() {
    const q = async (cat, nome) => (await this.admin.from('products').select('id,name,price,sector_id,omie_codigo,category_id,destination,ignore_category_sector').eq('store_id', this.lojaId).eq('name', nome).limit(1)).data?.[0];
    const cozinha = await q('Pastéis', 'Pastel de Queijo');
    const bar = await q('Cervejas', 'Heineken 330ml');
    const pizza = await q('Monte sua Pizza', 'Pizza Meio a Meio (qualquer sabor)');
    const extra = await q('Pastéis', 'Pastel de Carne');
    const extra2 = await q('Pastéis', 'Pastel de Camarão');
    for (const [n, p] of Object.entries({ cozinha, bar, pizza, extra, extra2 })) if (!p) throw new Error(`produto de teste "${n}" não existe na loja (o cardápio da ZZ mudou?)`);
    this.produtos = { cozinha, bar, pizza, extra, extra2 };
    Object.values(this.produtos).forEach((p) => this.estado.produtos.push({ id: p.id, sector_id: p.sector_id, omie_codigo: p.omie_codigo }));
    this.salvar();
    return this.produtos;
  }
  async enviarPizzaParaOLocal() {
    await this.admin.from('products').update({ sector_id: this.setor.id }).eq('id', this.produtos.pizza.id);
  }
  async vincularCodigosOmie() {
    const cod = { cozinha: 'QA-PORTAO-K', bar: 'QA-PORTAO-B', pizza: 'QA-PORTAO-P', extra: 'QA-PORTAO-X', extra2: 'QA-PORTAO-Y' };
    this.codigos = cod;
    for (const [k, p] of Object.entries(this.produtos)) await this.admin.from('products').update({ omie_codigo: cod[k] }).eq('id', p.id);
  }

  // ---------- mock do Estoque (processo filho; o Estoque real nunca é chamado)
  async iniciarMock() {
    if (this.estoqueRealNaLoja) throw new Error('a loja já tem integração com o Estoque; o teste não sobrescreve');
    const porta = await livrePorta();
    this.mock = { porta, chave: `chave-portao-${senhaAleatoria().slice(0, 8)}`, url: `http://127.0.0.1:${porta}` };
    this.mock.proc = spawn(process.execPath, [path.join(RAIZ, 'scripts/testes/mock-estoque.mjs'), String(porta), this.mock.chave], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 700));
    const { error } = await this.admin.from('store_ntb_estoque_secrets').upsert({ store_id: this.lojaId, ntb_estoque_url: this.mock.url, ntb_estoque_api_key: this.mock.chave, ativo: true, updated_at: new Date().toISOString() }, { onConflict: 'store_id' });
    if (error) throw new Error(`secret do Estoque: ${error.message}`);
    this.estado.estoqueSecretCriado = true; this.salvar();
    return this.mock;
  }
  mockReq(rota, corpo) {
    return fetch(`${this.mock.url}${rota}`, corpo === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).then((r) => r.json());
  }
  async pararMock() { try { this.mock?.proc?.kill('SIGTERM'); } catch { /* já parou */ } }

  // ---------- fila de impressão da loja nesta execução, classificada por documento
  async ledgerFila() {
    const { data } = await this.admin.from('print_jobs').select('id,title,destination,printer_config_id,status,created_at,dedupe_key,content').eq('store_id', this.lojaId).gte('created_at', this.t0).order('created_at');
    const mapaImp = Object.fromEntries((this.impressoras ?? []).map((p) => [p.id, p.name.replace('QA Portao ', '')]));
    const nums = this.mesas.map((m) => m.number);
    const meu = (j) => {
      const t = `${j.title} ${j.content ?? ''}`;
      if (/QA Portao/i.test(t)) return true;
      return nums.some((n) => new RegExp(`\\b(MESA|Mesa) ${n}\\b`).test(t));
    };
    return (data ?? []).filter(meu).map((j) => {
      let tipo = 'pedido';
      if (/^Confer[eê]ncia/i.test(j.title)) tipo = 'comanda';
      else if (/^Comprovante/i.test(j.title)) tipo = 'comprovante';
      else if (/^Fechamento/i.test(j.title)) tipo = 'fechamento';
      else if (/^Cupom Fiscal/i.test(j.title)) tipo = 'cupom_fiscal';
      else if (/CANCELAMENTO|cancelad/i.test(`${j.title} ${j.content ?? ''}`)) tipo = 'cancelamento';
      return { id: j.id, tipo, local: mapaImp[j.printer_config_id] ?? '?', titulo: j.title, status: j.status, criado: j.created_at, chave: j.dedupe_key };
    });
  }
  async todosOsJobsDaLoja() {
    return (await this.admin.from('print_jobs').select('id,title,printer_config_id,created_at').eq('store_id', this.lojaId).gte('created_at', this.t0)).data ?? [];
  }

  // ---------- conferência das ordens do teste
  // Pedidos das mesas do teste com SÓ os itens criados nesta execução (um pedido pode ser reaproveitado de antes pelo servidor).
  async pedidosDasMesas() {
    const ids = this.mesas.map((m) => m.id);
    const { data, error } = await this.admin.from('orders').select('*, order_items(*)').eq('store_id', this.lojaId).in('table_id', ids).order('created_at');
    if (error) throw new Error(`pedidos das mesas: ${error.message}`);
    return (data ?? []).map((o) => ({ ...o, order_items: (o.order_items ?? []).filter((i) => i.created_at >= this.t0) })).filter((o) => o.order_items.length > 0 || o.created_at >= this.t0);
  }
  async baixaDoPedido(orderId) { return (await this.admin.from('integracao_baixas').select('*').eq('order_id', orderId).maybeSingle()).data; }

  async sql(texto) { return psql(texto); }

  // ---------- LIMPEZA (idempotente). Retorna lista de problemas.
  async limpar({ idsAntes } = {}) {
    const problemas = [];
    const e = this.estado;
    if (!e) return problemas;
    const loja = e.lojaId;
    const tentar = async (nome, fn) => { try { const r = await fn(); if (r?.error) problemas.push(`${nome}: ${r.error.message}`); } catch (err) { problemas.push(`${nome}: ${err.message}`); } };
    const mesaIds = (e.mesas ?? []).map((m) => m.id);
    const nums = (e.mesas ?? []).map((m) => m.number);

    // 0) pedidos que JÁ EXISTIAM nas mesas do teste (o servidor pode ter reaproveitado um): tira só os itens criados pelo teste e restaura o pedido
    const t0 = e.t0;
    const idsNulos = ['00000000-0000-0000-0000-000000000000'];
    const { data: velhos } = await this.admin.from('orders').select('id,created_at').eq('store_id', loja).in('table_id', mesaIds.length ? mesaIds : idsNulos).lt('created_at', t0);
    for (const v of velhos ?? []) {
      await tentar('itens do teste em pedido antigo', () => this.admin.from('order_items').delete().eq('order_id', v.id).gte('created_at', t0));
      const snap = (e.ordensAntes ?? []).find((o) => o.id === v.id);
      if (snap) await tentar('restaurar pedido antigo', () => this.admin.from('orders').update({ status: snap.status, total: snap.total, payment_details: snap.payment_details, payment_method: snap.payment_method, updated_at: snap.updated_at, customer_name: snap.customer_name, coupon_id: snap.coupon_id, coupon_discount: snap.coupon_discount }).eq('id', v.id));
      else {
        const { data: resto } = await this.admin.from('order_items').select('quantity,price_at_time,status').eq('order_id', v.id);
        const total = (resto ?? []).filter((i) => i.status !== 'canceled').reduce((a, i) => a + i.quantity * Number(i.price_at_time), 0);
        await tentar('recalcular pedido antigo', () => this.admin.from('orders').update({ total, status: 'pending', payment_details: null, payment_method: null }).eq('id', v.id));
      }
    }
    // 1) pedidos do teste (cascade em itens, baixas, cupons, avaliações)
    const { data: pedidos } = await this.admin.from('orders').select('id').eq('store_id', loja).in('table_id', mesaIds.length ? mesaIds : idsNulos).gte('created_at', t0);
    const ordemIds = [...new Set([...(pedidos ?? []).map((p) => p.id), ...(e.ordemIds ?? [])])];
    e.ordemIds = ordemIds; this.salvar();
    if (ordemIds.length) {
      await tentar('notas das ordens', () => this.admin.from('fiscal_notas').delete().in('order_id', ordemIds));
      await tentar('pedidos', () => this.admin.from('orders').delete().in('id', ordemIds));
    }
    // pedidos de balcão criados direto pelo teste (sem mesa) e marcados pelo nome
    await tentar('pedidos de balcão do teste', () => this.admin.from('orders').delete().eq('store_id', loja).like('customer_name', 'QA Portao%').gte('created_at', t0));
    // 2) sessões e estado das mesas
    if (mesaIds.length) await tentar('sessões das mesas', () => this.admin.from('table_sessions').delete().in('table_id', mesaIds).gte('opened_at', t0));
    for (const m of e.mesas ?? []) {
      await tentar(`mesa ${m.number}`, () => this.admin.from('tables').update({ status: m.status, current_host_name: m.current_host_name, guest_count: m.guest_count, waiter_requested: m.waiter_requested, service_fee_removed: m.service_fee_removed, pin_attempts: m.pin_attempts, pin_locked_until: m.pin_locked_until }).eq('id', m.id));
    }
    // 3) turnos de caixa dos usuários QA
    const usuarios = e.usuarios ?? [];
    if (usuarios.length) {
      const { data: turnos } = await this.admin.from('cash_shifts').select('id').in('operator_user_id', usuarios);
      const turnoIds = (turnos ?? []).map((t) => t.id);
      if (turnoIds.length) {
        await tentar('movimentos de caixa', () => this.admin.from('cash_movements').delete().in('shift_id', turnoIds));
        await tentar('auditoria de caixa (turno)', () => this.admin.from('cash_shift_audit_events').delete().in('shift_id', turnoIds));
        await tentar('turnos', () => this.admin.from('cash_shifts').delete().in('id', turnoIds));
      }
      await tentar('auditoria de caixa (operador)', () => this.admin.from('cash_shift_audit_events').delete().in('operator_user_id', usuarios));
      await tentar('pontos', () => this.admin.from('operator_checkins').delete().in('user_id', usuarios));
    }
    // 4) fila de impressão da execução (só a que é do teste)
    const { data: jobs } = await this.admin.from('print_jobs').select('id,title,content,printer_config_id').eq('store_id', loja).gte('created_at', t0);
    const meusJobs = (jobs ?? []).filter((j) => (e.printerIds ?? []).includes(j.printer_config_id) || /QA Portao/i.test(`${j.title} ${j.content ?? ''}`) || nums.some((n) => new RegExp(`\\b(MESA|Mesa) ${n}\\b`).test(`${j.title} ${j.content ?? ''}`)));
    if (meusJobs.length) await tentar('print_jobs', () => this.admin.from('print_jobs').delete().in('id', meusJobs.map((j) => j.id)));
    // 5) impressoras e locais
    if ((e.printerIds ?? []).length) await tentar('impressoras', () => this.admin.from('printer_configs').delete().in('id', e.printerIds));
    // produtos: devolve setor e código originais ANTES de apagar o setor
    for (const p of e.produtos ?? []) await tentar('produto', () => this.admin.from('products').update({ sector_id: p.sector_id, omie_codigo: p.omie_codigo }).eq('id', p.id));
    if ((e.sectorIds ?? []).length) await tentar('locais', () => this.admin.from('print_sectors').delete().in('id', e.sectorIds));
    // 6) integração com o Estoque (só se foi o teste que criou)
    if (e.estoqueSecretCriado) await tentar('secret do Estoque', () => this.admin.from('store_ntb_estoque_secrets').delete().eq('store_id', loja));
    // 7) tentativas de senha (contador de loja) e usuários
    await tentar('tentativas de senha', () => this.admin.from('store_open_mode_attempts').delete().eq('store_id', loja));
    if (usuarios.length) await tentar('usuários', () => this.admin.from('store_users').delete().in('id', usuarios));
    await tentar('usuários por e-mail', () => this.admin.from('store_users').delete().eq('store_id', loja).like('email', `qa-portao-%@${EMAIL_DOMINIO}`));
    // 8) config: restaura só as chaves alteradas
    const chaves = e.configAlteradaChaves ?? {};
    if (Object.keys(chaves).length) {
      const { data: l } = await this.admin.from('stores').select('config').eq('id', loja).single();
      const cfg = { ...(l?.config ?? {}) };
      for (const [k, v] of Object.entries(chaves)) { if (v.existia) cfg[k] = v.valor; else delete cfg[k]; }
      await tentar('config da loja', () => this.admin.from('stores').update({ config: cfg }).eq('id', loja));
    }
    // 9) cópias no histórico frio (só existem se o servidor do app tinha NTB_FRIO_API_URL)
    if (ordemIds.length) {
      try {
        const lista = ordemIds.map((i) => `'${i}'`).join(',');
        psql(`delete from order_items where order_id in (${lista}); delete from orders where id in (${lista});`, { banco: 'ntb_vendas_frio', comoPostgres: true });
      } catch (err) { problemas.push(`frio: ${err.message}`); }
    }
    return problemas;
  }

  async restoFrio() {
    const ids = (this.estado?.ordemIds ?? []);
    if (!ids.length) return 0;
    try {
      const lista = ids.map((i) => `'${i}'`).join(',');
      return Number(psql(`select count(*) from orders where id in (${lista});`, { banco: 'ntb_vendas_frio', comoPostgres: true }).trim()) || 0;
    } catch { return -1; }
  }
}
