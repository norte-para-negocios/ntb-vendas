// rodar com: npx tsx scripts/testes/rolePermissions.test.ts
import assert from 'node:assert/strict';
import { roleCan, roleCanOr, normalizarMatriz, DEFAULT_ROLE_PERMS, ACTIONS, matrizEfetiva, alterarPermissaoEsparso, SEGUE_ABA } from '../../lib/rolePermissions';
import { podeTrocarOuExcluir } from '../../lib/storeModules';

const loja = (rp?: unknown) => ({ config: { role_permissions: rp } });
const gerente = { role: 'manager' }, caixa = { role: 'cashier' }, garcom = { role: 'waiter' };

// Review Focus 1: sem configuração salva = padrões de hoje
assert.equal(roleCan(gerente, loja(), 'cancelar_item'), true);
assert.equal(roleCan(garcom, loja(), 'cancelar_item'), false);
assert.equal(roleCan(caixa, null, 'trocar_mesa'), false);
assert.equal(roleCan({ role: 'cashier', permissions: { trocas: true } }, loja(), 'trocar_mesa'), true, 'permissão por usuário "trocas" continua valendo');
assert.equal(roleCan({ role: 'cashier', permissions: { trocas: true } }, loja(), 'esgotar'), false, '"trocas" só vale p/ cancelar/trocar/mover');
assert.equal(roleCan({ role: 'cashier', permissions: { supervisiona_caixa: true } }, loja(), 'ver_excecoes'), true, 'supervisiona_caixa cobre exceções');
assert.equal(roleCan({ role: 'cashier', permissions: { supervisiona_caixa: true } }, loja(), 'cancelar_pedido'), true);
assert.equal(roleCan({ role: 'cashier', permissions: { supervisiona_caixa: true } }, loja(), 'trocar_mesa'), false);
assert.equal(roleCan({ role: 'open' }, loja(), 'esgotar'), false, 'modo aberto nunca');

// matriz salva desliga o gerente e liga o garçom
const rp = { manager: { cancelar_item: false }, waiter: { esgotar: true } };
assert.equal(roleCan(gerente, loja(rp), 'cancelar_item'), false);
assert.equal(roleCan(gerente, loja(rp), 'trocar_mesa'), true, 'o que não foi tocado segue o padrão');
assert.equal(roleCan(garcom, loja(rp), 'esgotar'), true);

// Review Focus 3: dono e universal nunca perdem poder
assert.equal(roleCan({ role: 'owner' }, loja({ manager: { cancelar_item: false } }), 'cancelar_item'), true);
assert.equal(roleCan({ role: 'universal' }, loja({ waiter: {} }), 'ver_excecoes'), true);

// Review Focus 2: lixo na configuração é ignorado
const lixo = normalizarMatriz({ manager: { cancelar_item: 'sim', inexistente: true }, chefe: { esgotar: true }, waiter: 7 });
assert.deepEqual(lixo, normalizarMatriz(undefined));
assert.equal(lixo.manager.cancelar_item, DEFAULT_ROLE_PERMS.manager.cancelar_item);
assert.deepEqual(normalizarMatriz([1, 2]), normalizarMatriz(undefined));
assert.equal(ACTIONS.length, Object.keys(DEFAULT_ROLE_PERMS.manager).length, 'todas as ações têm padrão para cada função');

// roleCanOr: sem valor salvo vale o legado (comportamento de hoje); valor salvo vence
assert.equal(roleCanOr(garcom, loja(), 'editar_cardapio', true), true, 'sem config: legado (aba cardápio) preservado');
assert.equal(roleCanOr(garcom, loja({ waiter: { editar_cardapio: false } }), 'editar_cardapio', true), false, 'config explícita restringe');
assert.equal(roleCanOr(caixa, loja({ cashier: { esgotar: true } }), 'esgotar', false), true);
assert.equal(roleCanOr({ role: 'owner' }, loja({ manager: {} }), 'esgotar', false), true);

// podeTrocarOuExcluir com a loja: padrões idênticos aos de hoje
assert.equal(podeTrocarOuExcluir(gerente), true);
assert.equal(podeTrocarOuExcluir(garcom), false);
assert.equal(podeTrocarOuExcluir({ role: 'waiter', permissions: { trocas: true } }), true);
assert.equal(podeTrocarOuExcluir({ role: 'owner' }), true);
assert.equal(podeTrocarOuExcluir({ role: 'open' }), false);
assert.equal(podeTrocarOuExcluir(gerente, loja({ manager: { cancelar_item: false } })), false);

// Matriz mostra o efetivo REAL: as 3 ações que seguem a aba de cardápio aparecem ligadas quando nada foi salvo
assert.deepEqual([...SEGUE_ABA].sort(), ['editar_cardapio', 'editar_precos_horario', 'esgotar']);
const ef = matrizEfetiva(undefined);
assert.equal(ef.cashier.editar_cardapio, true, 'sem config: quem tem a aba edita, então a matriz mostra ligado');
assert.equal(ef.waiter.esgotar, true);
assert.equal(ef.cashier.cancelar_item, false);
assert.equal(ef.manager.cancelar_item, true);
assert.equal(matrizEfetiva({ waiter: { esgotar: false } }).waiter.esgotar, false, 'valor salvo vence');

// Gravação esparsa: só o que difere do efetivo
let cfg = alterarPermissaoEsparso(undefined, 'cashier', 'cancelar_item', true);
assert.deepEqual(cfg, { cashier: { cancelar_item: true } }, 'ligar uma chave grava só ela');
cfg = alterarPermissaoEsparso(cfg, 'cashier', 'cancelar_item', false);
assert.equal(cfg, undefined, 'voltar ao efetivo apaga a chave e, vazio, remove role_permissions');
cfg = alterarPermissaoEsparso(undefined, 'waiter', 'editar_cardapio', false);
assert.deepEqual(cfg, { waiter: { editar_cardapio: false } }, 'desligar uma das 3 dependentes da aba grava false explícito');
assert.equal(roleCanOr(garcom, loja(cfg), 'esgotar', true), true, 'as outras dependentes seguem a aba (não foram tocadas)');
cfg = alterarPermissaoEsparso(cfg, 'waiter', 'editar_cardapio', true);
assert.equal(cfg, undefined, 'religar = efetivo = apaga');
cfg = alterarPermissaoEsparso({ manager: { trocar_mesa: false }, cashier: { esgotar: false }, lixo: 1 }, 'cashier', 'esgotar', true);
assert.deepEqual(cfg, { manager: { trocar_mesa: false } }, 'mantém o resto, limpa lixo e linhas vazias');
console.log('rolePermissions: ok');
