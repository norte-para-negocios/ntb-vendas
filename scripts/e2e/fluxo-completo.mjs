#!/usr/bin/env node
// PORTÃO DE DEPLOY — teste de fluxo completo do Norte Vendas (Playwright headless, loja ZZ Laboratório).
//
// Uso:  BASE_URL=http://localhost:3777 node scripts/e2e/fluxo-completo.mjs [--loja=zz|donana] [--ate=N] [--limpar] [--manter]
//   --limpar  só desfaz o que uma execução interrompida deixou (usa scripts/e2e/.estado-portao.json) e sai.
//   --ate=N   roda só até a seção N (útil para depurar); a limpeza sempre roda.
//   --manter  NÃO limpa no fim (só para depuração; rode --limpar depois).
//
// Regras duras: nunca o Sertão; sem nota fiscal real; sem Omie real; Estoque sempre MOCKADO por servidor local; sem migrations.
// O banco que o app usa É o de produção (Contabo): por isso tudo é restrito à ZZ, marcado "QA Portao" e removido no fim.
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ, ZZ, DONANA, carregarPlaywright, senhaAleatoria, consulta } from './lib/common.mjs';
import { Ambiente, ehSertao } from './lib/ambiente.mjs';
import { Dispositivo, sleep, esperar, classificarDoc } from './lib/dispositivo.mjs';
import { Relatorio, FALHOU, PASSOU, PENDENTE } from './lib/resultado.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const LOJA = args.loja === 'donana' ? DONANA : ZZ;
const ATE = args.ate ? Number(args.ate) : 99;
const SAIDA = path.join(RAIZ, 'scripts/e2e/.out');
const t00 = Date.now();

const rel = new Relatorio({ saida: path.join(SAIDA, 'relatorio.json') });
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const igual = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: esperado ${JSON.stringify(b)}, obtido ${JSON.stringify(a)}`); };
const brl = (n) => n.toFixed(2).replace('.', ',');

async function main() {
  if (args.limpar) return limparSomente();
  ok(BASE_URL, 'defina BASE_URL (ex.: BASE_URL=http://localhost:3777)');
  const url = new URL(BASE_URL);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  fs.mkdirSync(SAIDA, { recursive: true });
  // limpa só os artefatos de execuções anteriores do fluxo (o portão também guarda aqui os logs do tsc/testes/build)
  for (const f of fs.readdirSync(SAIDA)) if (/^(falha-.*\.png|relatorio\.json|fechamento-dia\.(xlsx|pdf)|erros-console\.txt)$/.test(f)) fs.rmSync(path.join(SAIDA, f), { force: true });

  const amb = new Ambiente({ lojaId: LOJA, baseUrl: BASE_URL });
  const loja = await amb.guardas();
  console.log(`Portão de deploy — loja de teste: ${loja.name} (${loja.id.slice(0, 8)}) | app: ${BASE_URL}${local ? '' : ' (NÃO é local: baixa de estoque com mock será pulada)'}`);
  const resto = await amb.haRestoDeExecucaoAnterior();
  if (resto.length) throw new Error(`há ${resto.length} usuário(s) QA de uma execução anterior (ou de outra sessão rodando o portão agora). Rode: node scripts/e2e/fluxo-completo.mjs --limpar`);

  amb.iniciarEstado();
  const idsAntes = await amb.idsPorTabela();
  const pw = await carregarPlaywright();
  const browser = await pw.chromium.launch();
  const C = { amb, rel, browser, local, BASE_URL, devs: {}, url };
  rel.capturar = async (nome) => {
    const d = (Dispositivo.ultimo?.page && !Dispositivo.ultimo.page.isClosed()) ? Dispositivo.ultimo : Object.values(C.devs).find((x) => x?.page && !x.page.isClosed());
    if (!d) return null;
    const arq = path.join(SAIDA, `falha-${Date.now()}.png`);
    await d.shot(arq).catch(() => null);
    return path.relative(RAIZ, arq);
  };
  let problemasLimpeza = [];
  try {
    await preparar(C);
    const secoes = [secLogin, secCadeados, secLancamento, secPermissoesAcoes, secComandaEConta, secPagamento, secBaixaEstoque, secFechamentoCaixa, secNotaFiscal, secRelatorios, secTemaEMobile, secRegressaoImpressao, secErrosDeConsole];
    for (let i = 0; i < secoes.length && i + 1 <= ATE; i++) {
      try { await secoes[i](C); } catch (e) { rel.registrar(`seção interrompida: ${secoes[i].name}`, FALHOU, e.stack?.split('\n').slice(0, 3).join(' | ') ?? e.message); }
    }
  } catch (e) {
    rel.registrar('preparação', FALHOU, e.stack?.split('\n').slice(0, 4).join(' | ') ?? e.message);
  } finally {
    rel.entrar('Limpeza e conferência no banco');
    for (const d of Object.values(C.devs)) { try { await d.fechar(); } catch { /* */ } }
    await browser.close().catch(() => {});
    await amb.pararMock();
    if (!args.manter) {
      problemasLimpeza = await amb.limpar();
      await rel.passo('limpeza sem erros', async () => ok(problemasLimpeza.length === 0, problemasLimpeza.join(' | ')));
      const idsDepois = await amb.idsPorTabela();
      const { extras, faltando } = amb.diffIds(idsAntes, idsDepois);
      await rel.passo('nenhum registro do teste sobrou na loja (ids antes x depois, tabela por tabela)', async () => {
        const { nossas, alheias } = await amb.classificarExtras(extras);
        if (Object.keys(alheias).length) console.log(`  aviso: linhas novas na loja que não são deste teste (outra sessão usando a ZZ?): ${Object.entries(alheias).map(([t, i]) => `${t}=${i.length}`).join(', ')}`);
        ok(Object.keys(nossas).length === 0, `sobrou do teste: ${Object.entries(nossas).map(([t, i]) => `${t}=${i.length}`).join(', ')}`);
        // O teste só apaga por id/e-mail próprios, então o que sumiu do "antes" é limpeza de OUTRA sessão que usa a mesma loja: só aviso.
        if (Object.keys(faltando).length) console.log(`  aviso: sumiram linhas que existiam antes (provável limpeza de outra sessão; este teste só apaga o que é dele): ${Object.entries(faltando).map(([t, i]) => `${t}=${i.length}`).join(', ')}`);
      });
      await rel.passo('config da loja restaurada e conferida (chaves alteradas voltaram ao valor original)', async () => {
        const { data } = await amb.admin.from('stores').select('config').eq('id', LOJA).single();
        for (const [k, v] of Object.entries(amb.estado.configAlteradaChaves)) {
          if (v.existia) igual(data.config?.[k], v.valor, `config.${k}`); else ok(!(k in (data.config ?? {})), `config.${k} deveria ter sumido`);
        }
      });
      await rel.passo('mesas do teste voltaram ao estado original', async () => {
        for (const m of amb.estado.mesas) {
          const { data } = await amb.admin.from('tables').select('status,current_host_name,guest_count,waiter_requested,service_fee_removed').eq('id', m.id).single();
          igual([data.status, data.current_host_name ?? null, data.guest_count, data.waiter_requested, data.service_fee_removed], [m.status, m.current_host_name ?? null, m.guest_count, m.waiter_requested, m.service_fee_removed], `mesa ${m.number}`);
        }
      });
      await rel.passo('copias em ntb_vendas_frio removidas', async () => { const n = await amb.restoFrio(); ok(n === 0, `restaram ${n} pedido(s) do teste no ntb_vendas_frio`); });
      if (problemasLimpeza.length === 0) { try { fs.rmSync(path.join(RAIZ, 'scripts/e2e/.estado-portao.json'), { force: true }); } catch { /* */ } }
    } else {
      console.log('  --manter: limpeza NÃO executada. Rode: node scripts/e2e/fluxo-completo.mjs --limpar');
    }
    const c = rel.resumo();
    console.log(`\nDuração: ${Math.round((Date.now() - t00) / 1000)}s`);
    process.exitCode = c[FALHOU] > 0 ? 1 : 0;
  }
}

async function limparSomente() {
  const amb = new Ambiente({ lojaId: LOJA, baseUrl: BASE_URL || 'http://localhost' });
  if (!amb.estado) { console.log('nada a limpar (sem .estado-portao.json)'); return; }
  amb.lojaId = amb.estado.lojaId; amb.t0 = amb.estado.t0;
  const antes = amb.lojaId;
  ok(antes === ZZ || antes === DONANA, 'estado aponta para loja não permitida');
  const problemas = await amb.limpar();
  console.log(problemas.length ? `limpeza com problemas: ${problemas.join(' | ')}` : 'limpeza concluída');
  if (!problemas.length) fs.rmSync(path.join(RAIZ, 'scripts/e2e/.estado-portao.json'), { force: true });
}

// ------------------------------------------------------------------------------------------------------------------------------
async function preparar(C) {
  const { amb } = C;
  rel.entrar('0. Preparação (guardas, usuários QA, mesas, locais e impressoras temporárias, mock do Estoque)');
  await amb.reservarMesas(3);
  await amb.escolherProdutos();
  await amb.criarUsuarios({
    garcom: { role: 'waiter', perms: { tables: true, counter: false, kitchen: false, bar: false, menu: false, admin: false } },
    garcom2: { role: 'waiter', perms: { tables: true, counter: false, kitchen: false, bar: false, menu: false, admin: false } },
    caixa: { role: 'cashier', perms: { tables: true, counter: true, kitchen: false, bar: false, menu: false, admin: false, caixa: true, trocas: true } },
    gerente: { role: 'manager', perms: { tables: true, counter: true, kitchen: true, bar: true, menu: true, admin: true, caixa: true, trocas: true, supervisiona_caixa: true } },
  });
  // Estado conhecido da loja: pedido pede a senha, fluxo de impressão direta, sem pausa de impressão, pré-conta automática no padrão (ligada).
  await amb.ajustarConfig({ order_flow: 'direct_print', pedido_pede_senha: true, printing_paused: undefined, auto_pre_conta: undefined, charge_service_fee: true, service_fee_rate: 0.1 });
  await amb.criarLocaisEImpressoras();
  await amb.enviarPizzaParaOLocal();
  if (C.local && !amb.estoqueRealNaLoja) { await amb.iniciarMock(); await amb.vincularCodigosOmie(); }
  await rel.passo('guardas: loja de teste permitida (ZZ/Donana), não é o Sertão, usuários e mesas reservados', async () => {
    ok(!ehSertao(amb.loja.name, amb.loja.slug), 'loja é o Sertão');
    ok(Object.keys(amb.usuarios).length === 4 && amb.mesas.length === 3, 'usuários/mesas');
  });
  await rel.passo('NFC-e da loja de teste desligada (emissão automática "nenhuma") e ambiente de homologação', async () => {
    const { data } = await amb.admin.from('store_fiscal_config').select('ambiente,modelo_emissao_automatica').eq('store_id', LOJA).maybeSingle();
    ok(data, 'loja sem configuração fiscal');
    ok(data.modelo_emissao_automatica === 'nenhuma' && data.ambiente === 'homologacao', `emissão=${data.modelo_emissao_automatica} ambiente=${data.ambiente}`);
  });
    C.fiscalAntes = (await amb.admin.from('fiscal_notas').select('id', { count: 'exact', head: true }).eq('store_id', LOJA)).count ?? 0;
}

// ------------------------------------------------------------------------------------------------------------------------------
const NOVA = () => senhaAleatoria();
async function novoDispositivo(C, chave, nome, opts = {}) {
  const d = await new Dispositivo(C.browser, nome, { baseUrl: C.BASE_URL, ...opts }).iniciar();
  C.devs[nome] = d;
  return d;
}

async function secLogin(C) {
  const { amb } = C;
  rel.entrar('1. Login por perfil');
  const U = amb.usuarios;
  // --- login com senha errada
  const anon = await novoDispositivo(C, 'anon', 'login-errado');
  await anon.ir('/loja');
  await anon.page.waitForSelector('input[type=email]', { timeout: 45000 });
  await rel.passo('senha errada não entra e mostra erro', async () => {
    await anon.tentarLogin(U.garcom.email, 'senha-errada-xyz');
    await sleep(2500);
    ok(await anon.page.locator('input[type=email]').isVisible(), 'saiu da tela de login com senha errada');
    ok(/senha|incorret|inválid|erro/i.test(await anon.texto()), 'sem mensagem de erro');
  });
  // --- primeiro acesso: pede nova senha (mínimo 6, confirmação igual); a senha inicial deixa de valer
  const senhaInicial = U.garcom.senha;
  await rel.passo('primeiro acesso pede para criar a senha (valida mínimo de 6 e confirmação)', async () => {
    await anon.ir('/loja');
    await anon.page.waitForSelector('input[type=email]');
    await anon.tentarLogin(U.garcom.email, senhaInicial);
    await anon.page.waitForSelector('text=Crie sua senha', { timeout: 20000 });
    const campos = anon.page.locator('input[type=password]');
    await campos.nth(0).fill('123'); await campos.nth(1).fill('123');
    await anon.page.click('button[type=submit]');
    await anon.page.waitForSelector('text=mínimo de 6 caracteres', { timeout: 5000 }).catch(() => { throw new Error('sem aviso de senha curta'); });
    await campos.nth(0).fill('abcdef1'); await campos.nth(1).fill('abcdef2');
    await anon.page.click('button[type=submit]');
    await anon.page.waitForSelector('text=não coincidem', { timeout: 5000 }).catch(() => { throw new Error('sem aviso de senhas diferentes'); });
    const nova = NOVA();
    await campos.nth(0).fill(nova); await campos.nth(1).fill(nova);
    await anon.page.click('button[type=submit]');
    await anon.page.waitForSelector('input[type=email]', { timeout: 20000 });
    U.garcom.senha = nova;
  });
  await rel.passo('a senha inicial não vale mais depois de trocada', async () => {
    await anon.ir('/loja');
    await anon.page.waitForSelector('input[type=email]');
    await anon.tentarLogin(U.garcom.email, senhaInicial);
    await sleep(2500);
    ok(await anon.page.locator('input[type=email]').isVisible(), 'a senha inicial ainda entra');
  });
  await anon.fechar(); delete C.devs['login-errado'];
  // --- cada perfil entra (os outros trocam a senha no primeiro acesso) e cai na tela certa
  C.devs.garcom = await novoDispositivo(C, 'garcom', 'garcom', { viewport: { width: 1280, height: 900 } });
  await C.devs.garcom.login(U.garcom.email, U.garcom.senha);
  for (const perfil of ['garcom2', 'caixa', 'gerente']) {
    const d = await novoDispositivo(C, perfil, perfil);
    const nova = NOVA();
    await d.login(U[perfil].email, U[perfil].senha, { trocarPara: nova });
    U[perfil].senha = nova;
  }
  await rel.passo('garçom {tables:true} entra direto em Mesas & Comandas', async () => {
    igual(await C.devs.garcom.titulo(), 'Mesas & Comandas', 'tela inicial do garçom');
  });
  await rel.passo('caixa entra na tela do Caixa', async () => { igual(await C.devs.caixa.titulo(), 'Caixa', 'tela inicial do caixa'); });
  await rel.passo('gerente entra e vê todas as áreas', async () => {
    for (const a of ['Caixa', 'Gestão de Mesas', 'Balcão', 'Produção', 'Cardápio', 'Administração']) {
      ok(await C.devs.gerente.menu(a).count(), `gerente sem a área ${a}`);
      ok(!(await C.devs.gerente.areaTrancada(a)), `gerente com cadeado em ${a}`);
    }
  });
  await C.devs.garcom2.fechar(); delete C.devs.garcom2; // só precisava existir com senha própria já trocada
}

async function secCadeados(C) {
  rel.entrar('2. Áreas sem permissão: cadeado, aviso e nenhum dado carregado');
  const g = C.devs.garcom; const cx = C.devs.caixa;
  const PROIBIDAS_GARCOM = ['Caixa', 'Balcão', 'Produção', 'Cardápio', 'Administração'];
  await rel.passo('garçom: Caixa, Balcão, Produção, Cardápio e Administração com CADEADO; Mesas sem cadeado', async () => {
    for (const a of PROIBIDAS_GARCOM) ok(await g.areaTrancada(a), `garçom sem cadeado em ${a}`);
    ok(!(await g.areaTrancada('Gestão de Mesas')), 'cadeado em Gestão de Mesas');
  }, {});
  // Endpoints que só as áreas bloqueadas usam (a Estação de Impressão e Mesas usam outros): se aparecerem, a área carregou dados.
  const PROIBIDOS = /rpc\/(fetch_open_cash_shifts?_secure|fetch_cash_shifts_history_secure|fetch_cash_shift_summary_secure|fetch_counter_orders_secure|fetch_sales_history_secure|fetch_exceptions_report_secure|fetch_store_team_members_secure|fetch_all_store_users_secure|fetch_integracao_baixas_secure|fetch_fiscal_notas_secure|fetch_canceled_sales_secure|fetch_cash_shift_audit_secure)|rest\/v1\/(categories|products|discount_coupons|price_schedules|fiscal_notas|operator_checkins)\b/;
  await rel.passo('garçom: clicar numa área com cadeado mostra o aviso, não sai de Mesas e NÃO carrega dados da área', async () => {
    const vistas = [];
    const ouvir = (r) => { if (PROIBIDOS.test(r.url())) vistas.push(`${r.method()} ${r.url().split('/v1/')[1]?.slice(0, 60)}`); };
    g.page.on('request', ouvir);
    try {
      for (const a of PROIBIDAS_GARCOM) {
        await g.menu(a).click();
        await g.page.getByText(/Sem permissão para esta área/).first().waitFor({ timeout: 5000 }).catch(() => { throw new Error(`sem o aviso de permissão ao clicar em ${a}`); });
        await sleep(1200);
        igual(await g.titulo(), 'Mesas & Comandas', `a tela mudou ao clicar em ${a}`);
      }
    } finally { g.page.off('request', ouvir); }
    ok(vistas.length === 0, `dados de área bloqueada foram pedidos ao servidor: ${vistas.join(' | ')}`);
  });
  await rel.passo('controle da checagem acima: o gerente abrindo o Caixa e o Balcão DISPARA pedidos de dados dessas áreas (a lista de endpoints proibidos não é vazia de sentido)', async () => {
    const m = C.devs.gerente; const vistas = [];
    const ouvir = (r) => { if (PROIBIDOS.test(r.url())) vistas.push(r.url()); };
    m.page.on('request', ouvir);
    try { await m.irArea('Caixa'); await sleep(2500); await m.irArea('Balcão'); await sleep(2500); } finally { m.page.off('request', ouvir); }
    ok(vistas.length > 0, 'nenhum pedido de dados de área foi visto: a checagem do garçom não prova nada');
  });
  await rel.passo('caixa (com trocas): Cardápio, Administração e Produção com cadeado; Caixa, Mesas e Balcão livres', async () => {
    for (const a of ['Cardápio', 'Administração', 'Produção']) ok(await cx.areaTrancada(a), `caixa sem cadeado em ${a}`);
    for (const a of ['Caixa', 'Gestão de Mesas', 'Balcão']) ok(!(await cx.areaTrancada(a)), `caixa com cadeado em ${a}`);
  });
}

// ------------------------------------------------------------------------------------------------------------------------------
// ORÇAMENTO DE IMPRESSÃO: roda uma ação do fluxo e confere QUANTOS documentos de cada tipo saíram — na fila (print_jobs, que é o que
// o agente/PC do caixa imprime no Sertão) e pelo navegador (window.print/iframe/impressora nativa). Também espera uma janela de silêncio
// maior que o ciclo de 10 s da Estação de Impressão para pegar impressão repetida.
// `esperado`: { pedido: {Cozinha:1,Bar:1} | n, comanda: n, comprovante: n, fechamento: n, cancelamento: {Cozinha:1} | n, cupom_fiscal: n }
// `janela`: documentos esperados pelo navegador (padrão: nenhum), por tipo.
const SOMA = (v) => (typeof v === 'number' ? v : Object.values(v ?? {}).reduce((a, b) => a + b, 0));
function resumirFila(jobs) {
  const por = {};
  for (const j of jobs) {
    const k = j.tipo;
    if (k === 'pedido' || k === 'cancelamento') { por[k] = por[k] ?? {}; por[k][j.local] = (por[k][j.local] ?? 0) + 1; }
    else por[k] = (por[k] ?? 0) + 1;
  }
  return por;
}
function esperadoNormalizado(e) {
  const out = {};
  for (const [k, v] of Object.entries(e ?? {})) { if (SOMA(v) > 0) out[k] = v; }
  return out;
}
async function orcamento(C, nome, acao, esperado = {}, { quieto = 11500, janela = {}, timeout = 30000, pendente } = {}) {
  const { amb } = C;
  return rel.passo(`impressão: ${nome}`, async () => {
    const antes = new Set((await amb.ledgerFila()).map((j) => j.id));
    const marcas = Object.fromEntries(Object.entries(C.devs).map(([k, d]) => [k, d.marcaDocs()]));
    await acao();
    const alvo = SOMA(Object.values(esperado).map((v) => SOMA(v)));
    if (alvo > 0) {
      await esperar(async () => (await amb.ledgerFila()).filter((j) => !antes.has(j.id)).length >= alvo, { timeout, motivo: `${alvo} documento(s) na fila` }).catch(() => {});
    }
    await sleep(quieto);
    const novos = (await amb.ledgerFila()).filter((j) => !antes.has(j.id));
    (C.vistos = C.vistos ?? new Set()); novos.forEach((j) => C.vistos.add(j.id));
    const obtido = resumirFila(novos);
    const doc = {};
    for (const [k, d] of Object.entries(C.devs)) for (const x of d.docsDesde(marcas[k] ?? 0)) doc[x.tipo] = (doc[x.tipo] ?? 0) + 1;
    const falhas = [];
    if (JSON.stringify(sortObj(obtido)) !== JSON.stringify(sortObj(esperadoNormalizado(esperado)))) falhas.push(`fila: esperado ${JSON.stringify(esperadoNormalizado(esperado))}, obtido ${JSON.stringify(obtido)} [${novos.map((j) => `${j.tipo}/${j.local}: ${j.titulo}`).join(' ; ')}]`);
    if (JSON.stringify(sortObj(doc)) !== JSON.stringify(sortObj(esperadoNormalizado(janela)))) falhas.push(`navegador: esperado ${JSON.stringify(esperadoNormalizado(janela))}, obtido ${JSON.stringify(doc)}`);
    if (falhas.length) throw new Error(falhas.join(' | '));
  }, { pendente });
}
function sortObj(o) { return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v && typeof v === 'object' ? sortObj(v) : v])); }

// ---------- operações de tela reaproveitadas
async function abrirMesa(dev, numero) {
  await fecharJanelas(dev);
  await dev.irArea('Gestão de Mesas');
  await dev.page.getByText(`Mesa ${numero}`, { exact: true }).first().click();
  await sleep(1000);
}
// Pergunta de confirmação do app (ConfirmDialog: não é role=dialog): espera o texto e aperta "Confirmar".
async function confirmarPergunta(dev, textoRe, rotulo = 'Confirmar') {
  await dev.page.getByText(textoRe).first().waitFor({ timeout: 8000 });
  await dev.page.getByRole('button', { name: rotulo, exact: true }).last().click();
  await sleep(600);
}
async function fecharJanelas(dev) {
  for (let i = 0; i < 4; i++) { if (await dev.page.locator('[role=dialog]').count() === 0) break; await dev.page.keyboard.press('Escape'); await sleep(500); }
}
async function adicionarItens(dev, nomes) {
  const p = dev.page;
  await p.getByRole('button', { name: 'Adicionar Pedido' }).click();
  await sleep(800);
  for (const nome of nomes) {
    await p.getByPlaceholder(/Buscar no cardápio inteiro/).fill(nome);
    await sleep(700);
    await p.getByText(nome, { exact: true }).first().click();
    await sleep(500);
    await p.getByRole('button', { name: /Adicionar ao pedido/ }).click();
    await sleep(600);
  }
}
// Confirma o pedido digitando `senha` no pedido de senha; devolve a mensagem de erro (ou null se o pedido saiu).
async function confirmarComSenha(dev, senha) {
  const p = dev.page;
  if (!(await p.getByRole('dialog').filter({ hasText: 'Quem está lançando?' }).count())) await p.getByRole('button', { name: /Confirmar pedido ·/ }).click();
  const dlg = p.getByRole('dialog').filter({ hasText: 'Quem está lançando?' });
  await dlg.waitFor({ timeout: 8000 });
  await dlg.getByLabel('Sua senha').fill(senha);
  await dlg.getByRole('button', { name: 'Confirmar pedido' }).click();
  await sleep(2500);
  if (await dlg.count()) return ((await dlg.locator('[role=alert]').first().textContent().catch(() => '')) || '').trim() || 'erro sem mensagem';
  return null;
}
// Abre a mesa (se estiver livre) e lança os itens com a senha de quem está logado.
async function lancar(dev, numero, nomes, senha) {
  await abrirMesa(dev, numero);
  const abrir = dev.page.getByRole('button', { name: 'Abrir Mesa Manualmente' });
  if (await abrir.isVisible().catch(() => false)) { await abrir.click(); await sleep(1500); }
  await adicionarItens(dev, nomes);
  await dev.page.getByRole('button', { name: /Confirmar pedido ·/ }).click();
  const erro = await confirmarComSenha(dev, senha);
  if (erro) throw new Error(`pedido não saiu: ${erro}`);
  await sleep(1200);
}
const trechoDaMesa = (texto, n) => { const i = texto.search(new RegExp(`Mesa ${n}\\b`)); if (i < 0) return ''; const resto = texto.slice(i + 1); const j = resto.search(/Mesa \d+\b/); return texto.slice(i, j < 0 ? undefined : i + 1 + j); };

async function secLancamento(C) {
  rel.entrar('3. Garçom lança pedido com a PRÓPRIA senha (e o pedido sai no nome dele)');
  const { amb } = C; const U = amb.usuarios; const g = C.devs.garcom; const m = C.devs.gerente; const P = amb.produtos;
  const mesaA = amb.mesas[0];
  C.mesaAtual = mesaA;
  await abrirMesa(g, mesaA.number);
  await g.page.getByRole('button', { name: 'Abrir Mesa Manualmente' }).click();
  await sleep(1500);
  await adicionarItens(g, [P.cozinha.name, P.bar.name, P.pizza.name]);
  await g.page.getByRole('button', { name: /Confirmar pedido ·/ }).click();
  await rel.passo('senha ERRADA não lança o pedido', async () => {
    const erro = await confirmarComSenha(g, 'senha-que-ninguem-tem-9');
    ok(erro && /Senha não encontrada/i.test(erro), `mensagem inesperada: ${erro}`);
    igual((await amb.pedidosDasMesas()).length, 0, 'pedidos criados com senha errada');
  });
  await rel.passo('senha de OUTRO usuário (garçom 2) é recusada: "essa senha não é a sua"', async () => {
    const erro = await confirmarComSenha(g, U.garcom2.senha);
    ok(erro && /não é a sua/i.test(erro), `mensagem inesperada: ${erro}`);
    igual((await amb.pedidosDasMesas()).length, 0, 'pedidos criados com a senha de outro usuário');
  });
  await orcamento(C, 'lançar 3 itens de locais diferentes (cozinha, bar, pizzaria) = 3 pedidos, um por local', async () => {
    const erro = await confirmarComSenha(g, U.garcom.senha);
    ok(!erro, `senha própria recusada: ${erro}`);
    await sleep(1500);
  }, { pedido: { Cozinha: 1, Bar: 1, Pizzaria: 1 } });
  await rel.passo('banco: pedido gravado no nome do garçom, 3 itens, valores do cardápio', async () => {
    const ped = await amb.pedidosDasMesas();
    igual(ped.length, 1, 'quantidade de pedidos da mesa');
    const itens = ped[0].order_items;
    igual(itens.length, 3, 'itens');
    ok(itens.every((i) => i.added_by_name === U.garcom.nome && i.added_by_role === 'garcom'), `autor dos itens: ${JSON.stringify(itens.map((i) => i.added_by_name))}`);
    igual(Number(ped[0].total), P.cozinha.price + P.bar.price + P.pizza.price, 'total do pedido (sem taxa)');
    C.pedidoIds = [ped[0].id];
  });
  await fecharJanelas(g);
  await rel.passo('Comanda da mesa mostra cada item com o nome do garçom', async () => {
    await abrirMesa(g, mesaA.number);
    await g.page.getByRole('button', { name: /Ver Comanda/ }).click();
    await sleep(1200);
    const t = await g.page.getByRole('dialog').last().innerText();
    for (const n of [P.cozinha.name, P.bar.name, P.pizza.name]) ok(t.includes(n), `comanda sem ${n}`);
    ok((t.match(new RegExp(U.garcom.nome, 'g')) ?? []).length >= 3, `nome do garçom aparece ${(t.match(new RegExp(U.garcom.nome, 'g')) ?? []).length}x na comanda (esperado 3)`);
    await fecharJanelas(g);
  });
  await rel.passo('Pedidos do Dia mostra os itens "lançado por" o garçom', async () => {
    await abrirMesa(m, mesaA.number).catch(() => {});
    await fecharJanelas(m);
    await m.irArea('Gestão de Mesas');
    await m.page.getByRole('button', { name: /Pedidos do Dia/ }).click();
    await sleep(2500);
    const t = await m.page.getByRole('dialog').filter({ hasText: 'Pedidos do Dia' }).first().innerText();
    const bloco = trechoDaMesa(t, mesaA.number);
    for (const n of [P.cozinha.name, P.bar.name, P.pizza.name]) ok(bloco.includes(n), `Pedidos do Dia sem ${n}: ${bloco.slice(0, 200)}`);
    ok((bloco.match(new RegExp(U.garcom.nome, 'g')) ?? []).length >= 3, `Pedidos do Dia: "${U.garcom.nome}" aparece ${(bloco.match(new RegExp(U.garcom.nome, 'g')) ?? []).length}x (esperado >= 3)`);
    await fecharJanelas(m);
  });
  await rel.passo('Produção/KDS: cada pedido aparece SÓ no local certo (Cozinha, Bar, Pizzaria) com o nome do garçom', async () => {
    await m.irArea('Produção');
    const main = async () => (await m.page.locator('main').innerText());
    const tab = async (re) => { await m.page.locator('button, [role=tab]').filter({ hasText: re }).first().click(); await sleep(1200); return main(); };
    const cozinha = await tab(/^Cozinha/); const bar = await tab(/^Bar/);
    const pizza = await tab(/QA Portao Pizzaria/);
    const em = (txt, n) => new RegExp(`Mesa ${mesaA.number}[\\s\\S]{0,160}${n.replace(/[()]/g, '\\$&')}`).test(txt);
    ok(em(cozinha, P.cozinha.name) && !cozinha.includes(P.bar.name) && !em(cozinha, P.pizza.name), 'Cozinha deveria ter só o pastel');
    ok(em(bar, P.bar.name) && !em(bar, P.cozinha.name) && !em(bar, P.pizza.name), 'Bar deveria ter só a cerveja');
    ok(em(pizza, P.pizza.name) && !em(pizza, P.cozinha.name) && !em(pizza, P.bar.name), 'Pizzaria deveria ter só a pizza');
    ok(cozinha.includes(U.garcom.nome) && bar.includes(U.garcom.nome) && pizza.includes(U.garcom.nome), 'KDS sem o nome do garçom');
  });
}
async function itemDoProduto(amb, produtoId) {
  const ped = await amb.pedidosDasMesas();
  return ped.flatMap((o) => o.order_items.map((i) => ({ ...i, order_table_id: o.table_id }))).filter((i) => i.product_id === produtoId);
}
async function statusItem(amb, id) { return (await amb.admin.from('order_items').select('status,order_id').eq('id', id).single()).data; }
async function pedidoDoItem(amb, id) { const { data: i } = await amb.admin.from('order_items').select('order_id').eq('id', id).single(); return (await amb.admin.from('orders').select('id,table_id,status,total').eq('id', i.order_id).single()).data; }
const linhaDaComanda = (dlg, nome) => dlg.locator('div').filter({ hasText: nome }).filter({ has: dlg.page().locator('button[title="Cancelar Item"]') }).last();

async function secPermissoesAcoes(C) {
  rel.entrar('4. Trocar mesa / mover item / cancelar item / cancelar pedido: só gerente e quem tem "trocas"');
  const { amb } = C; const U = amb.usuarios; const g = C.devs.garcom; const m = C.devs.gerente; const cx = C.devs.caixa; const P = amb.produtos;
  const [mesaA, mesaB, mesaC] = amb.mesas;
  await fecharJanelas(g); await fecharJanelas(m);
  // dois itens descartáveis para as ações (um pedido só do garçom: sai 1 comanda de cozinha com os 2 itens)
  await orcamento(C, 'garçom lança mais 2 itens da cozinha de uma vez = 1 pedido na cozinha', async () => {
    await abrirMesa(g, mesaA.number);
    await adicionarItens(g, [P.extra.name, P.extra2.name]);
    await g.page.getByRole('button', { name: /Confirmar pedido ·/ }).click();
    const e = await confirmarComSenha(g, U.garcom.senha);
    ok(!e, `pedido não saiu: ${e}`);
    await sleep(1500);
  }, { pedido: { Cozinha: 1 } });
  const iExtra = (await itemDoProduto(amb, P.extra.id))[0]; const iExtra2 = (await itemDoProduto(amb, P.extra2.id))[0];
  ok(iExtra && iExtra2, 'itens descartáveis não foram gravados');

  await rel.passo('garçom: a comanda NÃO tem Trocar, Mover item, Cancelar item nem Cancelar pedido (só Imprimir e Pedir conta)', async () => {
    await abrirMesa(g, mesaA.number);
    await g.page.getByRole('button', { name: /Ver Comanda/ }).click();
    await sleep(1000);
    const dlg = g.page.getByRole('dialog').last();
    igual(await dlg.locator('button[title="Cancelar Item"]').count(), 0, 'botões "Cancelar item" visíveis para o garçom');
    igual(await dlg.locator('button[aria-label="Mover item para outra mesa"]').count(), 0, 'botões "Mover item" visíveis para o garçom');
    igual(await dlg.getByRole('button', { name: 'Trocar', exact: true }).count(), 0, 'botão Trocar visível para o garçom');
    igual(await dlg.getByRole('button', { name: /Cancelar pedido/ }).count(), 0, 'botão Cancelar pedido visível para o garçom');
    ok(await dlg.getByRole('button', { name: 'Imprimir' }).count() === 1 && await dlg.getByRole('button', { name: /Pedir conta/ }).count() === 1, 'garçom deveria ter Imprimir e Pedir conta');
    await fecharJanelas(g);
  });
  await rel.passo('garçom chamando direto o servidor (RPCs v2 com o id dele): trocar mesa, mover item, cancelar item e cancelar pedido são RECUSADOS e nada muda', async () => {
    const nome = U.garcom.nome; const id = U.garcom.id;
    const r1 = (await amb.anon.rpc('cancel_order_item_v2', { p_item_id: iExtra.id, p_operator_user_id: id, p_operator_name: nome, p_reason: 'teste', p_action: 'cancelar_item' })).data;
    const r2 = (await amb.anon.rpc('cancel_order_item_v2', { p_item_id: iExtra.id, p_operator_user_id: id, p_operator_name: nome, p_reason: 'teste', p_action: 'cancelar_pedido' })).data;
    const r3 = (await amb.anon.rpc('move_table_v2', { p_source_table_id: mesaA.id, p_target_table_id: mesaB.id, p_operator_user_id: id })).data;
    const r4 = (await amb.anon.rpc('transfer_items_v2', { p_store_id: LOJA, p_item_ids: [iExtra2.id], p_target_table_id: mesaC.id, p_operator_user_id: id, p_operator_name: nome, p_from_table_id: mesaA.id })).data;
    const r5 = (await amb.anon.rpc('cancel_order_item_v2', { p_item_id: iExtra.id, p_operator_user_id: null, p_operator_name: 'x', p_reason: 'teste', p_action: 'cancelar_item' })).data;
    for (const [n, r] of [['cancelar item', r1], ['cancelar pedido', r2], ['trocar mesa', r3], ['mover item', r4], ['sem operador', r5]]) ok(r && r.success === false && /permiss|operador/i.test(r.message ?? ''), `${n}: o servidor deveria recusar (${JSON.stringify(r)})`);
    igual((await statusItem(amb, iExtra.id)).status, 'pending', 'o item foi cancelado apesar da recusa');
    const { data: ped } = await amb.admin.from('orders').select('table_id').eq('id', iExtra.order_id).single();
    igual(ped.table_id, mesaA.id, 'o pedido mudou de mesa apesar da recusa');
  });
  await rel.passo('as funções ANTIGAS (cancelar item / trocar mesa / mover item sem validar o papel) não ficam mais abertas para a chave anônima', async () => {
    const q = (f, a) => `has_function_privilege('anon','public.${f}(${a})','execute')`;
    const out = (await amb.sql(`select ${q('cancel_order_item_secure', 'uuid,uuid,text,text')}, ${q('move_table_secure', 'uuid,uuid')}, ${q('transfer_items_secure', 'uuid,uuid[],uuid,uuid,text,uuid')}, ${q('cancel_pending_table_items_secure', 'uuid')};`)).trim();
    const abertas = out.split('|').map((v, i) => (v === 't' ? ['cancel_order_item_secure', 'move_table_secure', 'transfer_items_secure', 'cancel_pending_table_items_secure'][i] : null)).filter(Boolean);
    ok(abertas.length === 0, `ainda executáveis pela chave anônima (o garçom contorna a regra chamando direto): ${abertas.join(', ')}`);
  }, { pendente: 'permissões/senha única (outra frente): migration 159 deixa as v1 abertas até o deploy do app; falta a migration que revoga o execute delas' });

  await rel.passo('gerente consegue CANCELAR ITEM (motivo obrigatório) e a cozinha recebe o aviso de cancelamento', async () => {
    await abrirMesa(m, mesaA.number);
    await m.page.getByRole('button', { name: /Ver Comanda/ }).click();
    await sleep(1000);
    const dlg = m.page.getByRole('dialog').last();
    await linhaDaComanda(dlg, P.extra.name).locator('button[title="Cancelar Item"]').first().click();
    const dlgC = m.page.getByRole('dialog').filter({ hasText: 'Escolha o motivo' });
    await dlgC.waitFor({ timeout: 5000 });
    await dlgC.getByText('Erro de lançamento').click();
    const antes = new Set((await amb.ledgerFila()).map((j) => j.id));
    await dlgC.getByRole('button', { name: 'Cancelar item' }).click();
    await esperar(async () => (await statusItem(amb, iExtra.id)).status === 'canceled', { timeout: 10000, motivo: 'item cancelado no banco' });
    await esperar(async () => (await amb.ledgerFila()).filter((j) => !antes.has(j.id)).length >= 1, { timeout: 15000, motivo: 'aviso de cancelamento na fila' }).catch(() => {});
    const novos = (await amb.ledgerFila()).filter((j) => !antes.has(j.id));
    (C.vistos = C.vistos ?? new Set()); novos.forEach((j) => C.vistos.add(j.id));
    ok(novos.length === 1 && novos[0].tipo === 'cancelamento' && novos[0].local === 'Cozinha', `esperado 1 cancelamento na cozinha, obtido: ${JSON.stringify(novos.map((j) => [j.tipo, j.local, j.titulo]))}`);
    await fecharJanelas(m);
  });
  await rel.passo('gerente consegue MOVER ITEM para outra mesa (sem reimprimir o pedido)', async () => {
    await abrirMesa(m, mesaA.number);
    await m.page.getByRole('button', { name: /Ver Comanda/ }).click();
    await sleep(1000);
    const dlg = m.page.getByRole('dialog').last();
    const linha = dlg.locator('div').filter({ hasText: P.extra2.name }).filter({ has: m.page.locator('button[aria-label="Mover item para outra mesa"]') }).last();
    await linha.locator('button[aria-label="Mover item para outra mesa"]').first().click();
    const dlgM = m.page.getByRole('dialog').filter({ hasText: 'Mover' }).last();
    await dlgM.getByLabel('Mesa de destino').selectOption({ label: `Mesa ${mesaC.number} (livre)` });
    const antes = new Set((await amb.ledgerFila()).map((j) => j.id));
    await dlgM.getByRole('button', { name: 'Mover item' }).click();
    await esperar(async () => (await pedidoDoItem(amb, iExtra2.id)).table_id === mesaC.id, { timeout: 10000, motivo: 'item na outra mesa' });
    await sleep(6000);
    const novos = (await amb.ledgerFila()).filter((j) => !antes.has(j.id));
    (C.vistos = C.vistos ?? new Set()); novos.forEach((j) => C.vistos.add(j.id));
    igual(novos.length, 0, `mover item mandou ${novos.length} documento(s) para a impressora: ${novos.map((j) => j.titulo).join(' ; ')}`);
    await fecharJanelas(m);
  });
  await rel.passo('caixa com "trocas" consegue CANCELAR O PEDIDO da mesa (cancelamento na cozinha)', async () => {
    await abrirMesa(cx, mesaC.number);
    await cx.page.getByRole('button', { name: /Ver Comanda/ }).click();
    await sleep(1000);
    const antes = new Set((await amb.ledgerFila()).map((j) => j.id));
    await cx.page.getByRole('dialog').last().getByRole('button', { name: /Cancelar pedido/ }).click();
    const dlgC = cx.page.getByRole('dialog').filter({ hasText: 'Cancelar pedido da Mesa' });
    await dlgC.waitFor({ timeout: 5000 });
    await dlgC.getByPlaceholder(/cliente desistiu/i).fill('qa portao');
    await dlgC.getByRole('button', { name: 'Cancelar pedido' }).click();
    await esperar(async () => (await statusItem(amb, iExtra2.id)).status === 'canceled', { timeout: 10000, motivo: 'pedido cancelado no banco' });
    await esperar(async () => (await amb.ledgerFila()).filter((j) => !antes.has(j.id)).length >= 1, { timeout: 15000, motivo: 'aviso de cancelamento na fila' }).catch(() => {});
    const novos = (await amb.ledgerFila()).filter((j) => !antes.has(j.id));
    (C.vistos = C.vistos ?? new Set()); novos.forEach((j) => C.vistos.add(j.id));
    ok(novos.length === 1 && novos[0].tipo === 'cancelamento', `esperado 1 cancelamento, obtido: ${JSON.stringify(novos.map((j) => [j.tipo, j.local, j.titulo]))}`);
    await fecharJanelas(cx);
  });
  await orcamento(C, 'caixa com "trocas" TROCA a mesa A pela B: nenhum documento novo (nada reimprime)', async () => {
    await abrirMesa(cx, mesaA.number);
    await cx.page.getByRole('button', { name: /Ver Comanda/ }).click();
    await sleep(1000);
    await cx.page.getByRole('dialog').last().getByRole('button', { name: 'Trocar', exact: true }).click();
    const dlgT = cx.page.getByRole('dialog').filter({ hasText: 'Trocar de Mesa' });
    await dlgT.getByRole('button', { name: new RegExp(`Mesa ${mesaB.number}\\b`) }).click();
    await dlgT.getByRole('button', { name: 'Confirmar Troca' }).click();
    await confirmarPergunta(cx, /Tem certeza/);
    await esperar(async () => (await pedidoDoItem(amb, iExtra.id)).table_id === mesaB.id, { timeout: 12000, motivo: 'pedido na mesa B' });
    await fecharJanelas(cx);
  }, {});
  C.mesaAtual = mesaB;
  await rel.passo('banco: depois da troca, os 3 itens da conta estão na mesa B e a A ficou livre', async () => {
    const ped = await amb.pedidosDasMesas();
    const vivos = ped.filter((o) => o.table_id === mesaB.id).flatMap((o) => o.order_items).filter((i) => i.status !== 'canceled');
    igual(vivos.map((i) => i.product_id).sort(), [P.cozinha.id, P.bar.id, P.pizza.id].sort(), 'itens vivos na mesa B');
    const { data: a } = await amb.admin.from('tables').select('status').eq('id', mesaA.id).single();
    igual(a.status, 'available', 'mesa A depois da troca');
  });
}

async function secComandaEConta(C) {
  rel.entrar('5. Pedir conta e COMANDA (a conta com preços antes da nota fiscal)');
  const { amb } = C; const g = C.devs.garcom; const mesa = C.mesaAtual;
  await fecharJanelas(g);
  await orcamento(C, 'garçom pede a conta = 1 COMANDA (e nenhum pedido novo)', async () => {
    await abrirMesa(g, mesa.number);
    await g.page.getByRole('button', { name: /Pedir conta/ }).first().click();
    await esperar(async () => (await amb.admin.from('tables').select('status').eq('id', mesa.id).single()).data.status === 'waiting_bill', { timeout: 10000, motivo: 'mesa aguardando conta' });
    await fecharJanelas(g);
  }, { comanda: 1 });
  await orcamento(C, 'botão Imprimir da comanda (gesto manual) = +1 comanda, nunca pela janela do navegador', async () => {
    await abrirMesa(g, mesa.number);
    await g.page.getByRole('button', { name: /Ver Comanda/ }).click();
    await sleep(800);
    await g.page.getByRole('dialog').last().getByRole('button', { name: 'Imprimir' }).click();
    await sleep(1500);
    await fecharJanelas(g);
  }, { comanda: 1 });
  await orcamento(C, 'abrir e fechar a mesa e a comanda de novo várias vezes = nenhum documento', async () => {
    for (let i = 0; i < 3; i++) {
      await abrirMesa(g, mesa.number);
      await g.page.getByRole('button', { name: /Ver Comanda/ }).click();
      await sleep(600);
      await fecharJanelas(g);
    }
  }, {});
  // comanda automática configurável (interruptor em Configurações > Impressão)
  const cx = C.devs.caixa;
  const cancelarContaPeloCaixa = async () => {
    await abrirMesa(cx, mesa.number);
    await cx.page.getByRole('button', { name: /Cancelar pedido de conta/ }).click();
    await esperar(async () => (await amb.admin.from('tables').select('status').eq('id', mesa.id).single()).data.status === 'occupied', { timeout: 10000, motivo: 'mesa voltou a ocupada' });
    await fecharJanelas(cx);
    // o celular do garçom só mostra "Pedir conta" de novo depois de sincronizar a mesa
    await esperar(async () => { await abrirMesa(g, mesa.number); const ok1 = (await g.page.getByRole('button', { name: /Pedir conta/ }).count()) > 0; if (!ok1) await fecharJanelas(g); return ok1; }, { timeout: 40000, intervalo: 3000, motivo: 'botão "Pedir conta" voltar no aparelho do garçom' });
    await fecharJanelas(g);
  };
  await amb.ajustarConfig({ auto_pre_conta: false });
  await cancelarContaPeloCaixa();
  await orcamento(C, 'com a comanda automática DESLIGADA, pedir conta não imprime nada', async () => {
    await abrirMesa(g, mesa.number);
    await g.page.getByRole('button', { name: /Pedir conta/ }).first().click();
    await esperar(async () => (await amb.admin.from('tables').select('status').eq('id', mesa.id).single()).data.status === 'waiting_bill', { timeout: 10000, motivo: 'mesa aguardando conta' });
    await sleep(2500);
    await fecharJanelas(g);
  }, {});
  await amb.ajustarConfig({ auto_pre_conta: undefined });
  await cancelarContaPeloCaixa();
  await orcamento(C, 'religada a comanda automática, pedir conta de novo com a MESMA conta não repete o papel (garçom + cliente pedindo junto)', async () => {
    await abrirMesa(g, mesa.number);
    await g.page.getByRole('button', { name: /Pedir conta/ }).first().click();
    await esperar(async () => (await amb.admin.from('tables').select('status').eq('id', mesa.id).single()).data.status === 'waiting_bill', { timeout: 10000, motivo: 'mesa aguardando conta' });
    await sleep(2500);
    await fecharJanelas(g);
  }, {});
  await rel.passo('vocabulário em Configurações > Impressão: PEDIDO é o papel do local de preparo e COMANDA é a conta com preços (sem "Pré-conta" nem "Comanda (pedidos)")', async () => {
    const m = C.devs.gerente;
    await fecharJanelas(m);
    await abrirAdmin(m, 'Configurações', 'Impressão');
    const t = await m.page.locator('main').innerText();
    const erros = [];
    if (/Pré-conta/i.test(t)) erros.push('a tela ainda chama a comanda de "Pré-conta"');
    if (!/Comanda autom[aá]tica/i.test(t)) erros.push('falta o interruptor "Comanda automática"');
    const editar = m.page.locator('main').getByRole('button', { name: /Editar|Configurar/ }).first();
    if (await editar.count()) {
      await editar.click(); await sleep(1000);
      const f = await m.page.getByRole('dialog').last().innerText().catch(() => '');
      if (/Comanda \(pedidos\)/i.test(f)) erros.push('o cadastro da impressora ainda chama o papel da cozinha/bar de "Comanda (pedidos)" (deveria ser "Pedidos")');
      if (/Pré-conta/i.test(f)) erros.push('o cadastro da impressora ainda usa "Pré-conta"');
      await fecharJanelas(m);
    }
    ok(erros.length === 0, erros.join('; '));
  }, { pendente: 'frente "comanda automática configurável"/vocabulário PEDIDO x COMANDA (outro agente): hoje a tela usa "Pré-conta (comanda)" e "Comanda (pedidos)"' });
}

async function secPagamento(C) {
  rel.entrar('6. Receber pagamento (cartões, troco) e finalizar a mesa');
  const { amb } = C; const cx = C.devs.caixa; const mesa = C.mesaAtual; const P = amb.produtos;
  await fecharJanelas(cx);
  await cx.irArea('Caixa');
  await rel.passo('caixa abre o turno com fundo de troco de R$ 100,00', async () => {
    await cx.page.getByPlaceholder('0.00').fill('100');
    await cx.page.getByRole('button', { name: /Abrir Caixa/ }).click();
    await esperar(async () => (await amb.admin.from('cash_shifts').select('id,status,opening_float').eq('operator_user_id', amb.usuarios.caixa.id).eq('status', 'open')).data?.length === 1, { timeout: 10000, motivo: 'turno aberto' });
    const { data } = await amb.admin.from('cash_shifts').select('id,opening_float').eq('operator_user_id', amb.usuarios.caixa.id).eq('status', 'open').single();
    igual(Number(data.opening_float), 100, 'fundo');
    C.turnoId = data.id;
  });
  const subtotal = P.cozinha.price + P.bar.price + P.pizza.price;
  const total = Math.round(subtotal * 1.1 * 100) / 100;
  C.totalConta = total;
  const lancar$ = async (metodo, bandeira, valor) => {
    const p = cx.page; const dlg = p.getByRole('dialog').filter({ hasText: 'Receber pagamento' }).last();
    await dlg.getByRole('button', { name: metodo, exact: true }).click();
    if (bandeira) await dlg.getByRole('button', { name: bandeira, exact: true }).click();
    await dlg.locator('input[type=number]').last().fill(String(valor));
    await dlg.getByRole('button', { name: 'Lançar pagamento' }).click();
    await sleep(500);
  };
  await rel.passo(`conta da mesa mostra R$ ${brl(total)} (3 itens + 10% de serviço) no modal de pagamento`, async () => {
    await cx.irArea('Caixa');
    await sleep(1500);
    await cx.page.locator('button').filter({ hasText: new RegExp(`^Mesa ${mesa.number}\\s*R\\$`) }).first().click();
    await sleep(1200);
    const modal = cx.page.getByRole('dialog').filter({ hasText: 'Receber pagamento' }).last();
    await modal.waitFor({ timeout: 8000 });
    ok((await modal.innerText()).includes(`R$ ${brl(total)}`), `total esperado R$ ${brl(total)} não aparece no modal: ${(await modal.innerText()).slice(0, 200).replace(/\n/g, ' ')}`);
  });
  await orcamento(C, 'pagar: Crédito/Visa + Débito/Mastercard + Dinheiro com troco = 1 comprovante, nenhum pedido novo', async () => {
    await lancar$('Crédito', 'Visa', (total - 20 - 40).toFixed(2));
    await lancar$('Débito', 'Mastercard', '20');
    await lancar$('Dinheiro', null, '50');
    const modal = cx.page.getByRole('dialog').filter({ hasText: 'Receber pagamento' }).last();
    const t = await modal.innerText();
    ok(/Troco[\s\S]{0,40}10,00/.test(t), `troco de R$ 10,00 não aparece: ${t.replace(/\n/g, ' ').slice(-260)}`);
    await modal.getByRole('button', { name: 'Finalizar mesa' }).click();
    await esperar(async () => (await amb.admin.from('tables').select('status').eq('id', mesa.id).single()).data.status === 'available', { timeout: 20000, motivo: 'mesa liberada' });
    await sleep(2000);
  }, { comprovante: 1 });
  await rel.passo('banco: pedido entregue com os 3 meios de pagamento, troco R$ 10,00, turno do caixa e SEM nota fiscal', async () => {
    const ped = (await amb.pedidosDasMesas()).filter((o) => o.table_id === mesa.id && o.status === 'delivered');
    ok(ped.length >= 1, 'nenhum pedido entregue na mesa');
    const pd = ped[0].payment_details;
    const metodos = (pd.methods ?? []).map((x) => `${String(x.method).toLowerCase()}${x.brand ? ':' + String(x.brand).toLowerCase() : ''}=${Number(x.amount).toFixed(2)}`).sort();
    // o servidor guarda o dinheiro LÍQUIDO (R$ 50 recebidos - R$ 10 de troco = R$ 40) e o troco à parte
    igual(metodos, [`credit:visa=${(total - 60).toFixed(2)}`, 'debit:mastercard=20.00', 'cash=40.00'].sort(), `meios de pagamento gravados (${JSON.stringify(pd).slice(0, 300)})`);
    const troco = Object.entries(pd).filter(([k, v]) => /troco|change/i.test(k) && typeof v === 'number').map(([, v]) => v);
    ok(troco.length === 0 || troco.includes(10), `troco gravado diferente de R$ 10,00: ${JSON.stringify(troco)}`);
    igual(pd.cash_shift_id, C.turnoId, 'turno do caixa no pagamento');
    ok(!pd.emitir_nota, 'o pedido foi marcado para emitir nota fiscal');
    C.pedidoPagoId = ped[0].id; C.pagamento = pd;
  });
}

// ---------- navegação da Administração (área à esquerda, aba em cima)
async function abrirAdmin(dev, area, aba) {
  await fecharJanelas(dev);
  await dev.irArea('Administração');
  const main = dev.page.locator('main');
  // o botão "Impressão" do cabeçalho (estado da impressão automática) tem o mesmo texto da aba: fica de fora
  const alvo = (t) => main.locator('button:not([title*="Impressão automática"]), [role=tab], a').filter({ hasText: new RegExp(`^${t}$`) }).first();
  if (area) { await main.getByText(area, { exact: true }).first().click(); await sleep(900); }
  if (aba) { await alvo(aba).click(); await sleep(1500); }
}

async function secBaixaEstoque(C) {
  rel.entrar('7. Baixa de estoque (Estoque MOCKADO por servidor local; o Estoque real nunca é chamado)');
  const { amb } = C; const m = C.devs.gerente;
  if (!C.local || !amb.mock) { rel.pular('baixa de estoque contra o mock', C.local ? 'a loja de teste já tinha integração real com o Estoque (não sobrescrevo)' : 'o app do teste não é local: o servidor dele não alcança o mock'); return; }
  await rel.passo('venda fechada gera linha em integracao_baixas (ok), com os itens vendidos, SEM os cancelados, e o mock recebeu uma chamada', async () => {
    const linha = await esperar(async () => { const l = await amb.baixaDoPedido(C.pedidoPagoId); return l && ['ok', 'parcial', 'erro', 'incerto'].includes(l.status) ? l : null; }, { timeout: 45000, motivo: 'linha de baixa do pedido' });
    ok(linha.status === 'ok', `status ${linha.status}: ${linha.ultimo_erro}`);
    const cods = linha.payload.itens.map((i) => i.codigo);
    for (const c of ['QA-PORTAO-K', 'QA-PORTAO-B', 'QA-PORTAO-P']) ok(cods.includes(c), `baixa sem ${c}: ${cods.join(',')}`);
    ok(!cods.includes('QA-PORTAO-X') && !cods.includes('QA-PORTAO-Y'), `itens cancelados entraram na baixa: ${cods.join(',')}`);
    const pizza = linha.payload.itens.find((i) => i.codigo === 'QA-PORTAO-P');
    igual(pizza.setor, 'QA Portao Pizzaria', 'local de preparo da pizza na baixa');
    const chamadas = (await amb.mockReq('/__mock/log')).filter((c) => c.pedidoRef === C.pedidoPagoId);
    igual(chamadas.length, 1, 'chamadas ao Estoque (mock) para este pedido');
    ok(['K', 'B', 'P'].every((k) => chamadas[0].itens.includes(`QA-PORTAO-${k}`)), `mock recebeu ${chamadas[0].itens.join(',')}`);
    const { data: o } = await amb.admin.from('orders').select('payment_details').eq('id', C.pedidoPagoId).single();
    ok(!!o.payment_details?.op_enviada_em, 'pedido sem a marca op_enviada_em depois de a baixa dar ok');
    igual(linha.rotulo, `Mesa ${C.mesaAtual.number}`, 'rótulo da baixa');
  });
  await rel.passo('baixa que falha NÃO some: item sem cadastro no Estoque vira erro e aparece em Configurações > Integrações > Baixas de estoque', async () => {
    await amb.mockReq('/__mock/regra', { codigo: 'QA-PORTAO-X', tipo: 'pulada' });
    const { data: o, error } = await amb.admin.from('orders').insert({ store_id: LOJA, table_id: null, order_type: 'counter', customer_name: 'QA Portao baixa com erro', status: 'delivered', total: 19.9, payment_details: { total: 19.9, emitir_nota: false } }).select('id').single();
    ok(o, `pedido de teste: ${error?.message}`);
    amb.estado.ordemIds.push(o.id); amb.salvar();
    const r = await amb.admin.from('order_items').insert({ order_id: o.id, store_id: LOJA, product_id: amb.produtos.extra.id, quantity: 1, price_at_time: 19.9, status: 'delivered', added_by_role: 'garcom' });
    ok(!r.error, `item: ${r.error?.message}`);
    const resp = await fetch(`${C.BASE_URL}/api/integracao/ordem-producao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: o.id }) }).then((x) => x.json());
    const linha = await amb.baixaDoPedido(o.id);
    ok(linha && ['erro', 'parcial'].includes(linha.status), `esperava erro na baixa, obtive ${linha?.status} (${JSON.stringify(resp).slice(0, 160)})`);
    ok(!(await amb.admin.from('orders').select('payment_details').eq('id', o.id).single()).data.payment_details?.op_enviada_em, 'pedido com baixa em erro foi marcado como enviado');
    await abrirAdmin(m, 'Configurações', 'Integrações');
    await esperar(async () => /1 com erro/.test(await m.page.locator('main').innerText()), { timeout: 15000, motivo: 'contador "1 com erro" na tela de Integrações' });
    const t = await m.page.locator('main').innerText();
    ok(/sem cadastro/i.test(t), 'a tela de Integrações não mostra o motivo do erro');
    await amb.mockReq('/__mock/regra', { codigo: 'QA-PORTAO-X', tipo: 'ok' });
  });
}

async function secFechamentoCaixa(C) {
  rel.entrar('8. Fechamento de caixa');
  const { amb } = C; const cx = C.devs.caixa;
  await fecharJanelas(cx);
  await cx.irArea('Caixa');
  await sleep(1500);
  await orcamento(C, 'fechar o caixa conferindo a gaveta = 1 documento de fechamento (impressora do caixa marcada)', async () => {
    await cx.page.getByRole('button', { name: /Fechar caixa/ }).first().click();
    const dlg = cx.page.getByRole('dialog').filter({ hasText: 'Fechar caixa de' }).last();
    await dlg.waitFor({ timeout: 10000 });
    await esperar(async () => /Total por forma de pagamento/.test(await dlg.innerText()), { timeout: 20000, motivo: 'resumo do turno carregado no fechamento' });
    const t = await dlg.innerText();
    ok(/Dinheiro[\s\S]{0,30}40,00/.test(t), `Dinheiro líquido R$ 40,00 não aparece no fechamento: ${t.replace(/\n/g, ' ').slice(0, 400)}`);
    ok(new RegExp(`Visa crédito[\\s\\S]{0,15}${(C.totalConta - 60).toFixed(2).replace('.', ',')}`).test(t), `"Visa crédito" R$ ${(C.totalConta - 60).toFixed(2).replace('.', ',')} não bate no fechamento: ${t.replace(/\n/g, ' ').slice(0, 700)}`);
    ok(/Maestro \(Master débito\)[\s\S]{0,15}20,00/.test(t), 'débito Mastercard ("Maestro (Master débito)") R$ 20,00 não bate no fechamento');
    ok(/Esperado em dinheiro[\s\S]{0,30}140,00/.test(t), `esperado em dinheiro deveria ser R$ 140,00 (fundo 100 + 40): ${t.replace(/\n/g, ' ').slice(0, 500)}`);
    const campos = dlg.locator('input[type=number]');
    await campos.nth(1).fill('1');   // 1 nota de R$ 100
    await campos.nth(3).fill('2');   // 2 notas de R$ 20
    await sleep(500);
    ok(/Total contado[\s\S]{0,20}140,00/.test(await dlg.innerText()), 'total contado não fechou em R$ 140,00');
    ok(/Confere certinho/.test(await dlg.innerText()), 'não mostrou "Confere certinho"');
    await dlg.getByRole('button', { name: /Confirmar Fechamento/ }).click();
    await esperar(async () => (await amb.admin.from('cash_shifts').select('status').eq('id', C.turnoId).single()).data.status === 'closed', { timeout: 15000, motivo: 'turno fechado' });
    await sleep(1500);
  }, { fechamento: 1 });
  await rel.passo('banco: turno fechado com R$ 140,00 contados', async () => {
    const { data } = await amb.admin.from('cash_shifts').select('status,closing_counted_cash,closed_at').eq('id', C.turnoId).single();
    igual([data.status, Number(data.closing_counted_cash)], ['closed', 140], 'turno');
  });
}

async function secNotaFiscal(C) {
  rel.entrar('9. Nota fiscal: só o gatilho e o estado (nenhuma nota real é emitida)');
  const { amb } = C; const m = C.devs.gerente;
  await rel.passo('nenhuma nota fiscal foi criada pela venda (loja de teste com emissão desligada, homologação)', async () => {
    const n = (await amb.admin.from('fiscal_notas').select('id', { count: 'exact', head: true }).eq('store_id', LOJA)).count ?? 0;
    igual(n, C.fiscalAntes, 'notas fiscais da loja de teste');
    const { data: f } = await amb.admin.from('store_fiscal_config').select('ambiente,modelo_emissao_automatica').eq('store_id', LOJA).single();
    igual([f.ambiente, f.modelo_emissao_automatica], ['homologacao', 'nenhuma'], 'config fiscal da loja de teste');
    ok(!(C.pagamento?.emitir_nota), 'o pagamento foi gravado com emitir_nota ligado');
  });
  await rel.passo('Vendas > Notas fiscais abre e não lista nota para a mesa do teste', async () => {
    await abrirAdmin(m, 'Vendas', 'Notas fiscais');
    const t = await m.page.locator('main').innerText();
    ok(/Notas fiscais|Nenhuma nota|nota/i.test(t), 'a tela de Notas fiscais não abriu');
    ok(!new RegExp(`Mesa ${C.mesaAtual.number}\\b`).test(t.split('Notas fiscais').slice(1).join(' ')), 'há nota listada para a mesa do teste');
  });
}

async function secRelatorios(C) {
  rel.entrar('10. Histórico e relatórios (Excel e PDF baixam e batem)');
  const { amb } = C; const m = C.devs.gerente; const mesa = C.mesaAtual;
  const totalTxt = `R$ ${brl(C.totalConta)}`;
  await rel.passo('Histórico de vendas lista a venda do teste (mesa e total)', async () => {
    await abrirAdmin(m, 'Vendas', 'Histórico');
    const t = await m.page.locator('main').innerText();
    ok(new RegExp(`Mesa ${mesa.number}[\\s\\S]{0,80}${totalTxt.replace('$', '\\$')}`).test(t), `venda da mesa ${mesa.number} (${totalTxt}) não aparece no Histórico`);
  });
  await rel.passo('Histórico: a coluna Itens conta só o que foi cobrado (3 itens; o item cancelado não entra)', async () => {
    const t = await m.page.locator('main').innerText();
    const bloco = t.split('\n').join(' ');
    ok(new RegExp(`Mesa ${mesa.number}\\s+3 itens\\s+R\\$ ${brl(C.totalConta)}`).test(bloco), `a linha da mesa ${mesa.number} deveria dizer "3 itens" (1 item foi cancelado): ${(bloco.match(new RegExp(`Mesa ${mesa.number}.{0,40}`)) ?? ['?'])[0]}`);
  });
  const abrirVendaNoHistorico = async () => {
    await m.page.locator('main').getByText(new RegExp(`^Mesa ${mesa.number}$`)).first().click(); // a célula "Cliente / mesa" da linha da venda
    await sleep(1500);
    const dlg = m.page.getByRole('dialog').last();
    ok(await dlg.count(), 'a venda do Histórico não abre detalhes');
    return dlg;
  };
  await rel.passo('Histórico: o detalhe da venda abre e NÃO lista o item cancelado como se tivesse sido vendido', async () => {
    const dlg = await abrirVendaNoHistorico();
    const t = await dlg.innerText();
    for (const n of [amb.produtos.cozinha.name, amb.produtos.bar.name, amb.produtos.pizza.name]) ok(t.includes(n), `o detalhe não lista ${n}`);
    const riscado = t.includes(amb.produtos.extra.name) && await dlg.getByText(amb.produtos.extra.name).first().evaluate((el) => { let e = el; while (e && e !== document.body) { if (getComputedStyle(e).textDecorationLine.includes('line-through')) return true; e = e.parentElement; } return false; });
    ok(!t.includes(amb.produtos.extra.name) || /cancelad/i.test(t) || riscado, `o detalhe da venda lista "${amb.produtos.extra.name}" (cancelado pelo gerente) como item normal, sem riscar nem escrever "cancelado": ${t.replace(/\s+/g, ' ').slice(0, 330)}`);
    await fecharJanelas(m);
  });
  await rel.passo('Histórico: abrir a venda mostra os itens com o nome de quem os lançou (garçom)', async () => {
    const dlg = await abrirVendaNoHistorico();
    const t = await dlg.innerText();
    ok(t.includes(amb.usuarios.garcom.nome), `o detalhe da venda não mostra o garçom "${amb.usuarios.garcom.nome}": ${t.replace(/\s+/g, ' ').slice(0, 300)}`);
    await fecharJanelas(m);
  }, { pendente: 'permissões/senha única (outra frente): o Histórico precisa mostrar quem lançou cada item (hoje só mostra data, tipo, mesa, itens e total)' });
  await abrirAdmin(m, 'Vendas', 'Relatórios');
  let arquivoXlsx = null;
  await rel.passo('Excel do fechamento do dia baixa, abre e as abas batem com a venda (total, formas de pagamento, cartões)', async () => {
    const [download] = await Promise.all([m.page.waitForEvent('download', { timeout: 60000 }), m.page.getByRole('button', { name: 'Baixar Excel' }).click()]);
    arquivoXlsx = path.join(SAIDA, 'fechamento-dia.xlsx');
    await download.saveAs(arquivoXlsx);
    ok(fs.statSync(arquivoXlsx).size > 3000, 'arquivo Excel pequeno demais');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(arquivoXlsx);
    const nomes = wb.worksheets.map((w) => w.name);
    for (const aba of ['Painel', 'Formas de pagamento', 'Cartões', 'Caixa', 'Vendas', 'Itens', 'Exceções']) ok(nomes.includes(aba), `Excel sem a aba ${aba} (tem: ${nomes.join(', ')})`);
    const linhas = (ws) => { const out = []; ws.eachRow((row) => out.push(row.values.slice(1).map((v) => (v && typeof v === 'object' && 'result' in v ? v.result : v)))); return out; };
    const txt = (ws) => linhas(ws).map((r) => r.join(' | ')).join('\n');
    const vendas = linhas(wb.getWorksheet('Vendas'));
    const minha = vendas.filter((r) => r.some((c) => String(c).includes(`Mesa ${mesa.number}`)) || r.some((c) => Math.abs(Number(c) - C.totalConta) < 0.005));
    ok(minha.length >= 1, `a venda da mesa ${mesa.number} (R$ ${brl(C.totalConta)}) não está na aba Vendas:\n${txt(wb.getWorksheet('Vendas')).slice(0, 500)}`);
    ok(minha.some((r) => r.some((c) => typeof c === 'number' && Math.abs(c - C.totalConta) < 0.005)), `a venda aparece na aba Vendas sem o total ${C.totalConta}: ${JSON.stringify(minha[0])}`);
    const formas = linhas(wb.getWorksheet('Formas de pagamento'));
    const valorForma = (re) => { const r = formas.find((x) => re.test(String(x[0]))); return r ? Number(r.slice(1).find((c) => typeof c === 'number')) : NaN; };
    ok(valorForma(/Dinheiro/i) >= 40 - 0.005, `Formas de pagamento: Dinheiro < R$ 40,00 (${valorForma(/Dinheiro/i)})`);
    ok(valorForma(/Cr[eé]dito/i) >= C.totalConta - 60 - 0.005, `Formas de pagamento: Crédito < ${C.totalConta - 60}`);
    ok(valorForma(/D[eé]bito/i) >= 20 - 0.005, 'Formas de pagamento: Débito < R$ 20,00');
    const cartoes = txt(wb.getWorksheet('Cartões'));
    ok(/Visa/i.test(cartoes) && /Mastercard/i.test(cartoes), `aba Cartões sem Visa/Mastercard:\n${cartoes.slice(0, 300)}`);
    const painel = txt(wb.getWorksheet('Painel'));
    ok(painel.length > 20, 'aba Painel vazia');
    const caixa = txt(wb.getWorksheet('Caixa'));
    ok(caixa.includes('QA Portao caixa'), `aba Caixa sem o turno do operador de teste:\n${caixa.slice(0, 300)}`);
    C.xlsx = { vendas, itens: linhas(wb.getWorksheet('Itens')), painel };
  });
  await rel.passo('Excel: o "Total do pedido" da venda bate com a soma dos itens listados na aba Itens (item cancelado não pode inflar o total)', async () => {
    ok(C.xlsx, 'Excel não foi lido');
    const venda = C.xlsx.vendas.find((r) => String(r[1]).includes(`Mesa ${mesa.number}`));
    ok(venda, `a mesa ${mesa.number} não está na aba Vendas`);
    const itens = C.xlsx.itens.filter((r) => String(r[1]).includes(`Mesa ${mesa.number}`));
    const soma = itens.reduce((a, r) => a + Number(r[5] || 0), 0);
    ok(Math.abs(Number(venda[6]) - soma) < 0.005, `Vendas.Total do pedido = ${venda[6]} mas os itens listados somam ${soma.toFixed(2)} (o item cancelado entra no total do pedido)`);
  });
  await rel.passo('PDF / Imprimir do fechamento do dia gera o documento com os valores da venda (PDF real conferido)', async () => {
    const marca = m.marcaDocs();
    await m.page.getByRole('button', { name: /PDF \/ Imprimir/ }).click();
    const doc = await esperar(async () => m.docsDesde(marca).find((d) => d.html && /Fechamento|Painel|Formas de pagamento/i.test(d.texto + d.titulo)), { timeout: 20000, motivo: 'documento do relatório' });
    ok(doc.texto.includes(brl(C.totalConta)) || doc.texto.includes(brl(C.totalConta - 60)), `o relatório não traz os valores da venda do teste (${totalTxt}); trecho: ${doc.texto.replace(/\s+/g, ' ').slice(0, 300)}`);
    const pg = await m.ctx.newPage();
    await pg.setContent(doc.html);
    const pdfPath = path.join(SAIDA, 'fechamento-dia.pdf');
    await pg.pdf({ path: pdfPath, format: 'A4' });
    await pg.close();
    const buf = fs.readFileSync(pdfPath);
    ok(buf.slice(0, 4).toString() === '%PDF' && buf.length > 2000, 'PDF gerado inválido');
  });
}

// ---------- tema claro/escuro e celular
async function larguraOk(dev) {
  return dev.page.evaluate(() => {
    const de = document.documentElement; const largura = de.clientWidth;
    const estourou = de.scrollWidth > largura + 1 || document.body.scrollWidth > largura + 1;
    const culpados = [];
    if (estourou) {
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > largura + 1 && culpados.length < 3) {
          let p = el.parentElement; let rola = false;
          while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { rola = true; break; } p = p.parentElement; }
          if (!rola) culpados.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} (${Math.round(r.right)}px)`);
        }
      });
    }
    return { estourou, largura, scrollWidth: de.scrollWidth, culpados };
  });
}
async function secTemaEMobile(C) {
  rel.entrar('11. Tema claro/escuro e celular 390 px (sem rolagem horizontal)');
  const estado = await C.devs.gerente.ctx.storageState();
  const telas = [
    { nome: 'Caixa', ir: async (d) => d.irAreaMobile('Caixa') },
    { nome: 'Mesas', ir: async (d) => d.irAreaMobile('Mesas') },
    { nome: 'Balcão', ir: async (d) => d.irAreaMobile('Balcão') },
    { nome: 'Produção', ir: async (d) => d.irAreaMobile('Produção') },
    { nome: 'Cardápio', ir: async (d) => d.irAreaMobile('Cardápio') },
    { nome: 'Administração', ir: async (d) => d.irAreaMobile('Administração') },
    { nome: 'Administração > Vendas > Relatórios', ir: async (d) => { await d.irAreaMobile('Administração'); await d.page.locator('main button:visible').filter({ hasText: /^Vendas/ }).first().click(); await sleep(900); await d.page.locator('main button:visible, main [role=tab]:visible').filter({ hasText: /^Relatórios$/ }).first().click(); await sleep(1200); } },
    { nome: 'Administração > Configurações > Impressão', ir: async (d) => { await d.irAreaMobile('Administração'); await d.page.locator('main button:visible').filter({ hasText: /^Configurações/ }).first().click(); await sleep(900); await d.page.locator('main button:not([title*="Impressão automática"]):visible, main [role=tab]:visible').filter({ hasText: /^Impressão$/ }).first().click(); await sleep(1200); } },
  ];
  for (const tema of ['light', 'dark']) {
    const d = await new Dispositivo(C.browser, `mobile-${tema}`, { baseUrl: C.BASE_URL, viewport: { width: 390, height: 844 }, tema, storageState: estado }).iniciar();
    C.devs[`mobile-${tema}`] = d;
    await d.page.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* sem storage */ } }, tema);
    await d.ir('/loja');
    await d.page.locator('h2:visible, header h1:visible').first().waitFor({ timeout: 30000 });
    await sleep(1500);
    await rel.passo(`tema ${tema === 'dark' ? 'ESCURO' : 'CLARO'}: a página aplica o tema pedido`, async () => {
      const dark = await d.page.evaluate(() => document.documentElement.classList.contains('dark'));
      igual(dark, tema === 'dark', 'classe .dark no <html>');
    });
    for (const t of telas) {
      await rel.passo(`celular 390px, tema ${tema === 'dark' ? 'escuro' : 'claro'}: ${t.nome} sem rolagem horizontal`, async () => {
        await t.ir(d);
        await sleep(800);
        const r = await larguraOk(d);
        ok(!r.estourou, `rolagem horizontal: página ${r.scrollWidth}px em tela de ${r.largura}px; elementos: ${r.culpados.join(' ; ')}`);
      });
    }
    await rel.passo(`celular 390px, tema ${tema === 'dark' ? 'escuro' : 'claro'}: janela da mesa/comanda e Pedidos do Dia sem rolagem horizontal`, async () => {
      await d.irAreaMobile('Mesas');
      await d.page.getByRole('button', { name: /Pedidos do Dia/ }).click();
      await sleep(1500);
      const r1 = await larguraOk(d);
      ok(!r1.estourou, `Pedidos do Dia: ${r1.scrollWidth}px em ${r1.largura}px; ${r1.culpados.join(' ; ')}`);
      await fecharJanelas(d);
    });
    await d.fechar(); delete C.devs[`mobile-${tema}`];
  }
}

// ---------- regressão: reiniciar o app / cair e voltar a conexão NÃO reimprime
async function secRegressaoImpressao(C) {
  rel.entrar('12. Regressão de impressão ao reiniciar (recarregar, cair/voltar a internet, trocar de aba, tempo real, aparelho novo, itens velhos)');
  const { amb } = C; const cx = C.devs.caixa; const U = amb.usuarios; const [mesaA, mesaB, mesaC] = amb.mesas;
  await fecharJanelas(cx);
  const estadoCaixa = await cx.ctx.storageState(); // sessão do caixa, guardada para os aparelhos "novos" (o aparelho original é fechado mais adiante)
  await orcamento(C, 'recarregar a página (F5) duas vezes = nenhum documento novo', async () => {
    await cx.page.reload({ waitUntil: 'domcontentloaded' }); await sleep(4000);
    await cx.page.reload({ waitUntil: 'domcontentloaded' }); await sleep(3000);
  }, {});
  await orcamento(C, 'cair a internet e voltar (reconexão) = nenhum documento novo', async () => {
    cx.silencio = true; // erros de rede DURANTE a queda são o esperado
    await cx.ctx.setOffline(true); await sleep(6000);
    await cx.ctx.setOffline(false); await sleep(3000);
    await cx.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await sleep(4000);
    cx.silencio = false;
  }, {});
  await orcamento(C, 'trocar de aba do navegador e voltar = nenhum documento novo', async () => {
    const outra = await cx.ctx.newPage();
    await outra.goto('about:blank'); await outra.bringToFront(); await sleep(2500);
    await cx.page.bringToFront();
    await cx.page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
    await outra.close(); await sleep(2500);
  }, {});
  await orcamento(C, 'receber atualizações em tempo real (mesa e pedido mudam no servidor) = nenhum documento novo', async () => {
    await amb.admin.from('tables').update({ waiter_requested: true }).eq('id', mesaB.id);
    await sleep(2500);
    await amb.admin.from('tables').update({ waiter_requested: false }).eq('id', mesaB.id);
    await amb.admin.from('orders').update({ updated_at: new Date().toISOString() }).eq('id', C.pedidoPagoId);
    await sleep(2500);
  }, {});
  await orcamento(C, 'abrir o app num aparelho NOVO logo depois do pedido = nenhum documento novo (a fila barra a duplicata)', async () => {
    const estado = estadoCaixa;
    const novo = await new Dispositivo(C.browser, 'aparelho-novo', { baseUrl: C.BASE_URL, storageState: estado }).iniciar();
    C.devs['aparelho-novo'] = novo;
    await novo.ir('/loja');
    await novo.page.locator('h2:visible, header h1:visible').first().waitFor({ timeout: 30000 });
    await sleep(14000);
    await novo.fechar(); delete C.devs['aparelho-novo'];
  }, {});

  // ---- o incidente de 04/10: corte antigo salvo no aparelho + itens velhos no servidor
  const velho = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const { data: o } = await amb.admin.from('orders').insert({ store_id: LOJA, table_id: mesaC.id, order_type: 'table', customer_name: 'QA Portao item velho', status: 'pending', total: 19.9, created_at: velho, updated_at: velho }).select('id').single();
  amb.estado.ordemIds.push(o.id); amb.salvar();
  await amb.admin.from('order_items').insert([amb.produtos.cozinha, amb.produtos.bar].map((p) => ({ order_id: o.id, store_id: LOJA, product_id: p.id, quantity: 1, price_at_time: p.price, status: 'pending', added_by_role: 'garcom', added_by_name: 'QA Portao antigo', created_at: velho })));
  await amb.admin.from('tables').update({ status: 'occupied', current_host_name: 'QA Portao antigo' }).eq('id', mesaC.id);
  const aparelhoComCorteAntigo = async (nome, extra = {}) => {
    const estado = estadoCaixa;
    const chaveCorte = `ntb_caixa_print_corte_ativacao_${LOJA}`; const chaveVida = `ntb_caixa_print_ultima_atividade_${LOJA}`;
    const dois = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    const d = await new Dispositivo(C.browser, nome, { baseUrl: C.BASE_URL, storageState: estado, ...extra }).iniciar();
    await d.page.addInitScript(({ a, b, dois, agora }) => { try { localStorage.setItem(a, dois); localStorage.setItem(b, agora); } catch { /* sem storage */ } }, { a: chaveCorte, b: chaveVida, dois, agora: new Date().toISOString() });
    C.devs[nome] = d;
    return d;
  };
  await orcamento(C, 'FILA: aparelho com corte de ativação de 2 dias atrás e itens de 3 horas atrás no servidor = NADA é impresso (teto de idade)', async () => {
    const d = await aparelhoComCorteAntigo('corte-antigo-fila');
    await d.ir('/loja');
    await d.page.locator('h2:visible, header h1:visible').first().waitFor({ timeout: 30000 });
    await sleep(15000);
    const corte = await d.page.evaluate((k) => localStorage.getItem(k), `ntb_caixa_print_corte_ativacao_${LOJA}`);
    ok(corte && Date.now() - Date.parse(corte) > 24 * 3600 * 1000, 'o corte antigo não foi mantido pelo app (o cenário do incidente não foi reproduzido)');
    await d.fechar(); delete C.devs['corte-antigo-fila'];
  }, {});
  await rel.passo('itens velhos continuam visíveis em Pedidos do Dia como "Sem registro" (reimpressão só por gesto humano)', async () => {
    const m = C.devs.gerente;
    await fecharJanelas(m);
    await m.irArea('Gestão de Mesas');
    await m.page.getByRole('button', { name: /Pedidos do Dia/ }).click();
    await sleep(2500);
    const t = await m.page.getByRole('dialog').filter({ hasText: 'Pedidos do Dia' }).first().innerText();
    const bloco = trechoDaMesa(t, mesaC.number);
    ok(/Sem registro/.test(bloco) && /Reimprimir/.test(bloco), `itens velhos da mesa ${mesaC.number} sem "Sem registro"/"Reimprimir": ${bloco.slice(0, 200)}`);
    await fecharJanelas(m);
  });

  // controle positivo (prova que o teste acima não passa "por não ter olhado"): com o MESMO corte antigo, um item de 30 min atrás (dentro do teto) imprime 1 vez
  const trinta = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await amb.admin.from('order_items').insert({ order_id: o.id, store_id: LOJA, product_id: amb.produtos.cozinha.id, quantity: 1, price_at_time: amb.produtos.cozinha.price, status: 'pending', added_by_role: 'garcom', added_by_name: 'QA Portao 30min', created_at: trinta });
  await orcamento(C, 'FILA (controle positivo): com o MESMO corte antigo, um item de 30 minutos atrás (dentro do teto de 60 min) imprime exatamente 1 pedido', async () => {
    const d = await aparelhoComCorteAntigo('corte-antigo-fila-2');
    await d.ir('/loja');
    await d.page.locator('h2:visible, header h1:visible').first().waitFor({ timeout: 30000 });
    await sleep(15000);
    await d.fechar(); delete C.devs['corte-antigo-fila-2'];
  }, { pedido: { Cozinha: 1 } });
  await amb.admin.from('order_items').delete().eq('order_id', o.id).eq('added_by_name', 'QA Portao 30min');

  await rel.passo('banco: TUDO o que está na fila de impressão da loja de teste foi contado por alguma ação medida (nada enfileirado fora do esperado)', async () => {
    const todos = await amb.ledgerFila();
    const soltos = todos.filter((j) => !(C.vistos ?? new Set()).has(j.id));
    ok(soltos.length === 0, `${soltos.length} documento(s) na fila que nenhuma ação medida esperava: ${soltos.map((j) => `${j.tipo}/${j.local}: ${j.titulo}`).join(' ; ')}`);
    const total = todos.length;
    console.log(`  (fila da loja de teste nesta execução: ${total} documentos no total: ${JSON.stringify(resumirFila(todos))})`);
  });

  // ---- caminho da JANELA do navegador (loja sem impressora cadastrada): prova positiva e depois as mesmas proteções.
  // Sem impressora cadastrada CADA aparelho logado imprime na própria impressora padrão (não há fila para barrar a duplicata entre aparelhos),
  // então aqui só pode haver UM aparelho aberto: fecha os outros.
  for (const nome of ['garcom', 'caixa', 'gerente']) { await C.devs[nome]?.fechar(); delete C.devs[nome]; }
  await amb.removerImpressoras();
  await orcamento(C, 'JANELA (sem impressora cadastrada): aparelho com corte antigo e itens de 3 horas atrás = NADA sai na janela de impressão', async () => {
    const d = await aparelhoComCorteAntigo('corte-antigo-janela');
    await d.ir('/loja');
    await d.page.locator('h2:visible, header h1:visible').first().waitFor({ timeout: 30000 });
    await sleep(15000);
    await d.fechar(); delete C.devs['corte-antigo-janela'];
  }, {});
  // controle positivo: um item NOVO (agora) é impresso exatamente 1 vez pelo navegador e não repete ao recarregar
  const { data: o2 } = await amb.admin.from('orders').insert({ store_id: LOJA, table_id: mesaC.id, order_type: 'table', customer_name: 'QA Portao item novo', status: 'pending', total: 19.9 }).select('id').single();
  amb.estado.ordemIds.push(o2.id); amb.salvar();
  let dJanela = null;
  await orcamento(C, 'JANELA: item novo lançado depois de o aparelho abrir = exatamente 1 pedido na cozinha pelo navegador', async () => {
    dJanela = await novoDispositivo(C, 'janela', 'janela-1', { storageState: estadoCaixa });
    await dJanela.ir('/loja');
    await dJanela.page.locator('h2:visible, header h1:visible').first().waitFor({ timeout: 30000 });
    await sleep(4000);
    await amb.admin.from('order_items').insert({ order_id: o2.id, store_id: LOJA, product_id: amb.produtos.cozinha.id, quantity: 1, price_at_time: amb.produtos.cozinha.price, status: 'pending', added_by_role: 'garcom', added_by_name: 'QA Portao novo' });
    await sleep(6000);
  }, {}, { janela: { pedido: 1 }, quieto: 12000 });
  await orcamento(C, 'JANELA: recarregar o aparelho que já imprimiu = não imprime de novo (dedupe do aparelho)', async () => {
    await dJanela.page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(8000);
  }, {});
}

async function secErrosDeConsole(C) {
  rel.entrar('13. Console e rede sem erro (todos os aparelhos do teste)');
  const lista = [...Dispositivo.errosTodos]; // inclui aparelhos que já foram fechados
  // 409 no print_jobs é a fila barrando a duplicata de propósito (índice único do dedupe); aparece no console do navegador, não é falha.
  const esperado = (e) => (e.tipo === 'http' || e.tipo === 'console') && /print_jobs/.test(e.texto) && /409/.test(e.texto) || (e.tipo === 'console' && /status of 409/.test(e.texto)) || (e.tipo === 'http' && e.status === 409 && /print_jobs/.test(e.texto));
  const ruidoDoNavegador = (e) => /Blocked call to navigator\.vibrate/.test(e.texto); // intervenção do Chrome (vibração sem toque na tela), não é erro do app
  const reais = lista.filter((e) => !esperado(e) && !ruidoDoNavegador(e));
  try { fs.writeFileSync(path.join(SAIDA, 'erros-console.txt'), lista.map((e) => `${e.nome} | ${e.tipo} | ${e.texto} | ${e.url}`).join('\n')); } catch { /* sem arquivo */ }
  const resumo = (arr) => { const c = {}; arr.forEach((e) => { const k = `${e.tipo}: ${e.texto.slice(0, 140)}`; c[k] = (c[k] ?? 0) + 1; }); return Object.entries(c).map(([k, v]) => `${v}x ${k}`).join('\n   '); };
  await rel.passo(`nenhum erro de console, de script (pageerror) nem de rede (HTTP >= 400, requisição falha) em todos os aparelhos do teste`, async () => {
    ok(reais.length === 0, `${reais.length} erro(s) (lista completa em scripts/e2e/.out/erros-console.txt):\n   ${resumo(reais).slice(0, 2200)}`);
  });
  const dup = lista.filter(esperado).length;
  if (dup) console.log(`  (informativo: ${dup} resposta(s) 409 da fila de impressão = duplicata barrada pelo índice único, esperado)`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
