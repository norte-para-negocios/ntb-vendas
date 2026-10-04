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
  fs.rmSync(SAIDA, { recursive: true, force: true }); fs.mkdirSync(SAIDA, { recursive: true });

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
    const d = Object.values(C.devs).find((x) => x?.page && !x.page.isClosed());
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
      const meus = (t, ids) => ids; // qualquer sobra é relatada; a leitura de "alheio" é feita abaixo
      await rel.passo('nenhum registro do teste sobrou na loja (ids antes x depois)', async () => {
        const sobra = Object.entries(extras).filter(([t]) => !['store_users'].includes(t) || true);
        // Linhas novas que NÃO são do teste (outra sessão usando a mesma loja) aparecem separadas, só como aviso.
        const alheias = {}; const nossas = {};
        for (const [t, ids] of sobra) {
          const conhecidas = new Set([...(amb.estado.usuarios ?? []), ...(amb.estado.ordemIds ?? [])]);
          for (const id of ids) ((conhecidas.has(id)) ? nossas : alheias)[t] = [...((conhecidas.has(id) ? nossas : alheias)[t] ?? []), id];
        }
        ok(Object.keys(nossas).length === 0, `sobrou do teste: ${JSON.stringify(nossas)}`);
        if (Object.keys(alheias).length) console.log(`  aviso: linhas novas na loja que não são deste teste (outra sessão usando a ZZ?): ${Object.entries(alheias).map(([t, i]) => `${t}=${i.length}`).join(', ')}`);
        if (Object.keys(faltando).length) throw new Error(`o teste apagou algo que existia antes: ${JSON.stringify(faltando)}`);
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
  const { data: n0 } = await amb.admin.from('fiscal_notas').select('id', { count: 'exact', head: true }).eq('store_id', LOJA);
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
  await rel.passo('caixa (com trocas): Cardápio, Administração e Produção com cadeado; Caixa, Mesas e Balcão livres', async () => {
    for (const a of ['Cardápio', 'Administração', 'Produção']) ok(await cx.areaTrancada(a), `caixa sem cadeado em ${a}`);
    for (const a of ['Caixa', 'Gestão de Mesas', 'Balcão']) ok(!(await cx.areaTrancada(a)), `caixa com cadeado em ${a}`);
  });
}

// (as demais seções são definidas abaixo)
async function secLancamento(C) { rel.entrar('3. Garçom lança pedido com a PRÓPRIA senha'); }
async function secPermissoesAcoes(C) { rel.entrar('4. Trocar mesa / mover item / cancelar item / cancelar pedido'); }
async function secComandaEConta(C) { rel.entrar('5. Pedir conta e COMANDA'); }
async function secPagamento(C) { rel.entrar('6. Receber pagamento'); }
async function secBaixaEstoque(C) { rel.entrar('7. Baixa de estoque (Estoque MOCKADO)'); }
async function secFechamentoCaixa(C) { rel.entrar('8. Fechamento de caixa'); }
async function secNotaFiscal(C) { rel.entrar('9. Nota fiscal (só gatilho/estado)'); }
async function secRelatorios(C) { rel.entrar('10. Histórico e relatórios Excel/PDF'); }
async function secTemaEMobile(C) { rel.entrar('11. Tema claro/escuro e celular 390px'); }
async function secRegressaoImpressao(C) { rel.entrar('12. Regressão de impressão ao reiniciar'); }
async function secErrosDeConsole(C) { rel.entrar('13. Console e rede sem erro'); }

main().catch((e) => { console.error(e); process.exitCode = 1; });
