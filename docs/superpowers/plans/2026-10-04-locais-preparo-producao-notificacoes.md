# Locais de preparo, menu "Produção" e central de notificações — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando o lojista cria um local de preparo (ex.: "Pizzaria"), ele ganha tela própria no menu "Produção", contador próprio, vínculo com impressora e estoque Omie num cadastro único com checklist, e os avisos importantes (chamada, conta, pedido novo, pronto, atraso, estoque, nota rejeitada, sangria, impressora) chegam num sino filtrado por função.

**Architecture:** Três bibliotecas puras e testadas (`lib/locaisPreparo.ts`, `lib/producaoNav.ts`, `lib/notificacoes.ts`) concentram todas as regras (checklist, contagem por local, quem vê o quê, deduplicação, som). Um hook (`lib/useStoreNotifications.ts`) só busca dados e chama essas funções; o resultado vai por um contexto React para o menu lateral, para a nova `ProducaoView` (que reaproveita `KdsView` com um local fixo) e para o sino. Nenhuma migration: locais continuam em `print_sectors`, preferências em `stores.config.notifications`, histórico dos avisos no `localStorage` do aparelho.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4 com os tokens atuais, `motion/react` (`SPRING_UI`, `SPRING_TAP`, `LIST_ITEM_MOTION`, `AnimatedNumber`), Supabase (RPCs existentes), testes `npx tsx scripts/testes/*.test.ts` com `node:assert`.

**Spec:** relato do dono na loja Donana Brotas (04/10/2026): criou o local "pizzaria" e não apareceu botão de KDS ao lado de Cozinha e Bar; não foi pedido vínculo com o Omie (a loja já está ligada ao Estoque); pediu "acompanhamento de pedidos muito bom", "só coisas que notificam" e que cada local novo apareça para acompanhar o pedido. Plano-mãe: `docs/superpowers/plans/2026-10-04-mesa-cardapio-permissoes.md` (adendo, etapa 2). Código lido: `lib/setores.ts`, `lib/storeModules.ts`, `components/modules/StoreModule.tsx` (`useStoreNotifications` 588-701, `StoreLayout` 1003-1420, `allTabs` 1096-1105, `bottomNavTabs` 1126, `KdsView` 1593-1830, Cardápio 9802 e 10139, render das abas 13652-13653), `PrinterSettingsView.tsx` 527-560, `lib/api.ts` 813-845 e 3327-3345, migrations 087 e 089.

## Global Constraints

- **NÃO é redesign (restrição do dono, 04/10).** Manter a identidade atual: tokens CSS (`--brand`, `--surface`, `--surface-2`, `--text`, `--text-muted`, `--border`, `--ok-fill`, `--err-fill`), componentes de `components/ui.tsx` (`Button`, `Card`, `Input`, `Modal`, `Badge`, `SegmentedControl`), fonte e raios atuais. Nenhuma cor, fonte, sombra ou componente-base novo.
- **Animação só com o que já existe:** `SPRING_UI`/`SPRING_TAP`/`SPRING_SHEET` e `LIST_ITEM_MOTION` de `lib/motion.ts`, `AnimatedNumber` para contadores, classes `u-motion`/`u-press`/`u-press-sm`. Duração curta (≤ 400 ms), sem bounce novo, `MotionConfig reducedMotion="user"` já envolve o painel. Contador conta até o valor novo; painel de avisos abre com o spring do `Modal`; item de aviso entra/sai com `LIST_ITEM_MOTION`.
- Português do Brasil na UI; sem `window.confirm`/`alert` novos (usar o `confirm` do app já usado no Cardápio).
- **Loja sem setores = comportamento de hoje:** o menu continua com "Cozinha (KDS)" e "Bar (KDS)" separados, `permissions.kitchen/bar` e módulos `kitchen_kds/bar_kds` continuam mandando. "Produção" só aparece quando existe ao menos um setor.
- Lojas com `order_flow: 'direct_print'`, módulos de KDS desligados, `client_ordering: false` (Sertão), balcão e offline não podem quebrar nem gerar aviso sem sentido (ver Review Focus).
- Nada de migration nova. Nada de Omie em massa: só `fetchLocaisEstoque` (já existente, 1 chamada por abertura da tela).
- Cada task termina com `npx tsc --noEmit` limpo, testes passando e commit. Mensagem de commit termina com:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_01ATqZgryoxRsTeXXM3HR8M7`.
- **QA e deploy:** só em loja de teste (Donana ou ZZ Laboratório), **nunca "O Sertão Vai Virar Mar"** (em produção). Sem emitir nota real. Deploy só com a loja fechada e com OK do dono. Tudo que o QA criar (local, categoria, pedido, usuário) é apagado no fim.

## Review Focus

1. **Loja sem setores** (as 7 de hoje): menu idêntico ao atual, badges de Cozinha/Bar iguais. Teste em `producaoNav.test.ts` (`usaMenuProducao` falso).
2. **Setor apagado com pedido ainda na fila** (`sector_id` vira null): o pedido cai na Cozinha/Bar e não some nem quebra a contagem. Teste em `producaoNav.test.ts` e `notificacoes.test.ts`.
3. **Loja sem KDS / impressão direta / Sertão vitrine:** sem avisos de pedido novo/pronto/atraso; sem erro por falta de local. Teste `tiposAplicaveis`.
4. **Offline ou fonte fora do ar:** avisos ativos não são "resolvidos" por falha de rede nem tocam som duplicado ao voltar; o sino mostra "avisos pausados". Teste `reconciliar` com `tiposVistos` vazio.
5. **Recarregar a página / abrir o app:** não toca som de aviso que já existia, nem apaga o histórico (primeira rodada silenciosa + `restaurarEventos` com lixo). Teste `restaurarEventos`.
6. **Dois PCs abertos / mesmo usuário em abas:** cada aparelho guarda o próprio "lido"; o som não repete dentro da mesma tela de cozinha/bar (`somDoEvento` com `abaAtual`).
7. **Garçom só com permissão de Bar** não vê a Pizzaria (base cozinha) nem avisos dela. Teste `locaisAcessiveis` + `filtrarEventos`.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `lib/locaisPreparo.ts` (novo) | lista única de locais + `statusLocal()` (checklist) |
| `lib/producaoNav.ts` (novo) | `contarPorLocal`, `usaMenuProducao`, `abasProducao`, acesso por base |
| `lib/notificacoes.ts` (novo) | tipos, público por função, detectores, reconciliação, som, persistência |
| `lib/useStoreNotifications.ts` (novo) | busca dados, chama as libs, toca som, devolve contagens/avisos |
| `components/NotificacoesContext.tsx` (novo) | contexto com `counts`, `porLocal`, `locais`, avisos |
| `components/NotificationBell.tsx` (novo) | botão com contador animado + painel de avisos (usa `Modal`) |
| `components/modules/ProducaoView.tsx` (novo) | abas por local + `KdsView` de local fixo |
| `components/modules/LocaisPreparoView.tsx` (novo) | cadastro único (nome, base, impressora, estoque Omie, categorias, checklist) |
| `components/modules/StoreModule.tsx` (editar) | remove o hook antigo (588-701), ajusta `StoreLayout`, `KdsView`, render de abas, remove cartões de Locais/Integração do Cardápio, nova aba "Locais de preparo" em Administração |
| `components/modules/StoreSettingsView.tsx` (editar) | seção "Notificações" |
| `components/modules/PrinterSettingsView.tsx` (editar) | remove o cartão "Locais de preparo" (vai para a nova aba) |
| `lib/api.ts` (editar) | `updatePrintSector` |
| `types/index.ts` (editar) | `StoreConfig.notifications` |

---

### Task 1: Cadastro de local e checklist de pendências (lib pura)

**Files:**
- Create: `lib/locaisPreparo.ts`, `scripts/testes/locaisPreparo.test.ts`

**Interfaces:**
- Produces: `BaseLocal`, `SetorLike`, `LocalPreparo { chave, nome, base, setorId }`, `chaveLocal(setorId, base)`, `listarLocais(setores, {cozinha, bar})`, `statusLocal(DadosStatusLocal): StatusLocal { itens: {id: 'categorias'|'impressora'|'estoque'; estado: 'ok'|'aviso'|'falta'; texto}[]; completo; recebePedidos }`. A chave é a mesma de `chaveDestinoEstoque` (`lib/setores.ts`): `'kitchen' | 'bar' | 'setor:<id>'`.

- [ ] **Step 1: Escrever o teste que falha** — `scripts/testes/locaisPreparo.test.ts`

```ts
// rodar com: npx tsx scripts/testes/locaisPreparo.test.ts
import assert from 'node:assert/strict';
import { chaveLocal, listarLocais, statusLocal, type LocalPreparo } from '../../lib/locaisPreparo';

assert.equal(chaveLocal(null, 'kitchen'), 'kitchen');
assert.equal(chaveLocal('abc', 'kitchen'), 'setor:abc');

const setores = [{ id: 'p1', name: 'Pizzaria', base: 'kitchen' as const }];
assert.deepEqual(listarLocais(setores, { cozinha: true, bar: true }).map((l) => l.chave), ['kitchen', 'bar', 'setor:p1']);
assert.deepEqual(listarLocais(setores, { cozinha: false, bar: false }).map((l) => l.chave), ['setor:p1'], 'módulos desligados somem, setor fica');

const pizzaria: LocalPreparo = { chave: 'setor:p1', nome: 'Pizzaria', base: 'kitchen', setorId: 'p1' };
// Caso real da Donana (04/10): criou "pizzaria", 0 categorias, sem impressora, estoque integrado mas sem vínculo.
const donana = statusLocal({ local: pizzaria, impressoras: [], mapaEstoque: { kitchen: 7 }, categoriasDoLocal: 0, produtosDoLocal: 0 });
assert.equal(donana.recebePedidos, false);
assert.equal(donana.completo, false);
assert.deepEqual(donana.itens.map((i) => [i.id, i.estado]), [['categorias', 'falta'], ['impressora', 'aviso'], ['estoque', 'aviso']]);

const completo = statusLocal({ local: pizzaria, impressoras: [{ sector_id: 'p1', is_active: true }], mapaEstoque: { 'setor:p1': 9 }, categoriasDoLocal: 2, produtosDoLocal: 0 });
assert.equal(completo.completo, true);
assert.equal(completo.recebePedidos, true);

// impressora inativa não conta; sem mapa de estoque (loja sem integração) não gera item de estoque
const semEstoque = statusLocal({ local: pizzaria, impressoras: [{ sector_id: 'p1', is_active: false }], mapaEstoque: null, categoriasDoLocal: 0, produtosDoLocal: 1 });
assert.equal(semEstoque.itens.some((i) => i.id === 'estoque'), false);
assert.equal(semEstoque.itens.find((i) => i.id === 'impressora')!.estado, 'aviso');
assert.equal(semEstoque.recebePedidos, true, 'produto apontando para o local basta');

// estoque integrado e sem nenhum vínculo (nem da base): falta
assert.equal(statusLocal({ local: pizzaria, impressoras: [], mapaEstoque: {}, categoriasDoLocal: 1, produtosDoLocal: 0 }).itens.find((i) => i.id === 'estoque')!.estado, 'falta');

// Cozinha padrão: não exige categorias, impressora 'all' vale
const cozinha: LocalPreparo = { chave: 'kitchen', nome: 'Cozinha', base: 'kitchen', setorId: null };
const c = statusLocal({ local: cozinha, impressoras: [{ sector_id: null, is_active: true, destination: 'all' }], mapaEstoque: { kitchen: 3 }, categoriasDoLocal: 0, produtosDoLocal: 0 });
assert.equal(c.completo, true);
assert.equal(c.itens.some((i) => i.id === 'categorias'), false);
console.log('locaisPreparo: ok');
```

- [ ] **Step 2: Rodar e ver falhar** — `npx tsx scripts/testes/locaisPreparo.test.ts` → `Cannot find module '../../lib/locaisPreparo'`.

- [ ] **Step 3: Implementar** — `lib/locaisPreparo.ts`

```ts
// lib/locaisPreparo.ts — locais de preparo (Cozinha, Bar e setores como Pizzaria): lista única + checklist de pendências.
// A chave é a MESMA de lib/setores.ts (chaveDestinoEstoque): 'kitchen' | 'bar' | 'setor:<id>'.
export type BaseLocal = 'kitchen' | 'bar';
export interface SetorLike { id: string; name: string; base: BaseLocal }
export interface LocalPreparo { chave: string; nome: string; base: BaseLocal; setorId: string | null }

export const chaveLocal = (setorId: string | null, base: BaseLocal): string => (setorId ? `setor:${setorId}` : base);

// Cozinha/Bar só entram se o módulo (kitchen_kds / bar_kds) da loja está ligado; setores sempre entram.
export function listarLocais(setores: SetorLike[], modulos: { cozinha: boolean; bar: boolean }): LocalPreparo[] {
  const out: LocalPreparo[] = [];
  if (modulos.cozinha) out.push({ chave: 'kitchen', nome: 'Cozinha', base: 'kitchen', setorId: null });
  if (modulos.bar) out.push({ chave: 'bar', nome: 'Bar', base: 'bar', setorId: null });
  setores.forEach((s) => out.push({ chave: chaveLocal(s.id, s.base), nome: s.name, base: s.base, setorId: s.id }));
  return out;
}

export type EstadoItem = 'ok' | 'aviso' | 'falta';
export interface ItemChecklist { id: 'categorias' | 'impressora' | 'estoque'; estado: EstadoItem; texto: string }
export interface StatusLocal { itens: ItemChecklist[]; completo: boolean; recebePedidos: boolean }

export interface DadosStatusLocal {
  local: LocalPreparo;
  impressoras: { sector_id?: string | null; is_active: boolean; destination?: string | null }[];
  /** `null` = loja sem integração com o Estoque (nada a vincular). */
  mapaEstoque: Record<string, number> | null;
  categoriasDoLocal: number;
  produtosDoLocal: number;
}

export function statusLocal(d: DadosStatusLocal): StatusLocal {
  const { local } = d;
  const itens: ItemChecklist[] = [];

  // Um setor só recebe pedido se alguma categoria ou produto aponta pra ele. Cozinha/Bar padrão recebem o resto.
  const recebe = local.setorId === null || d.categoriasDoLocal + d.produtosDoLocal > 0;
  if (local.setorId !== null) {
    itens.push(recebe
      ? { id: 'categorias', estado: 'ok', texto: `${d.categoriasDoLocal} categoria(s) e ${d.produtosDoLocal} produto(s) enviam pedidos para cá.` }
      : { id: 'categorias', estado: 'falta', texto: 'Nenhuma categoria ou produto aponta para este local — ele não recebe pedidos.' });
  }

  const ativas = d.impressoras.filter((p) => p.is_active);
  const propria = local.setorId !== null
    ? ativas.some((p) => p.sector_id === local.setorId)
    : ativas.some((p) => !p.sector_id && (p.destination === local.base || p.destination === 'all'));
  if (propria) itens.push({ id: 'impressora', estado: 'ok', texto: 'Tem impressora própria.' });
  else if (local.setorId !== null) itens.push({ id: 'impressora', estado: 'aviso', texto: `Sem impressora própria: os pedidos saem na impressora da ${local.base === 'bar' ? 'Bar' : 'Cozinha'}.` });
  else itens.push({ id: 'impressora', estado: 'aviso', texto: 'Sem impressora configurada: o pedido só aparece na tela.' });

  if (d.mapaEstoque !== null) {
    if (d.mapaEstoque[local.chave]) itens.push({ id: 'estoque', estado: 'ok', texto: 'Baixa de estoque vinculada a um local do Omie.' });
    else if (local.setorId !== null && d.mapaEstoque[local.base]) itens.push({ id: 'estoque', estado: 'aviso', texto: `Sem local de estoque próprio: baixa no mesmo local da ${local.base === 'bar' ? 'Bar' : 'Cozinha'}.` });
    else itens.push({ id: 'estoque', estado: 'falta', texto: 'Sem local de estoque do Omie: a venda não baixa estoque deste local.' });
  }

  return { itens, completo: itens.every((i) => i.estado === 'ok'), recebePedidos: recebe };
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx tsx scripts/testes/locaisPreparo.test.ts && npx tsc --noEmit` → `locaisPreparo: ok`.

- [ ] **Step 5: Commit** — `git add lib/locaisPreparo.ts scripts/testes/locaisPreparo.test.ts && git commit -m "feat(locais): checklist de pendências do local de preparo (lib pura)"` + linhas de atribuição.

---

### Task 2: Menu "Produção" e contagem por local (lib pura)

**Files:**
- Create: `lib/producaoNav.ts`, `scripts/testes/producaoNav.test.ts`

**Interfaces:**
- Consumes: `LocalPreparo`, `chaveLocal` (Task 1).
- Produces: `ItemKds`, `itemPrecisaAcao`, `contarPorLocal({kitchen, bar}, setoresConhecidos): Record<chave, number>`, `usaMenuProducao(locais)`, `producaoAcessivel(Set<tabId>)`, `locaisAcessiveis(locais, Set<tabId>)`, `abasProducao(locais, contagens): (LocalPreparo & {count})[]`, `somaContagens`.

- [ ] **Step 1: Teste que falha** — `scripts/testes/producaoNav.test.ts`

```ts
// rodar com: npx tsx scripts/testes/producaoNav.test.ts
import assert from 'node:assert/strict';
import { contarPorLocal, usaMenuProducao, producaoAcessivel, locaisAcessiveis, abasProducao, somaContagens, itemPrecisaAcao } from '../../lib/producaoNav';
import { listarLocais } from '../../lib/locaisPreparo';

const it = (status: string, sector_id: string | null = null, tipo = 'table') => ({ status, sector_id, order: { order_type: tipo } });

assert.equal(itemPrecisaAcao(it('pending')), true);
assert.equal(itemPrecisaAcao(it('preparing')), false);
assert.equal(itemPrecisaAcao(it('accepted', null, 'counter')), true, 'balcão aceito precisa de ação');
assert.equal(itemPrecisaAcao(it('accepted', null, 'table')), false);

const conhecidos = new Set(['p1']);
const c = contarPorLocal({ kitchen: [it('pending'), it('pending', 'p1'), it('pending', 'p1'), it('preparing', 'p1'), it('pending', 'apagado')], bar: [it('pending')] }, conhecidos);
assert.deepEqual(c, { kitchen: 2, 'setor:p1': 2, bar: 1 }, 'setor apagado cai na Cozinha; preparando não conta');

const semSetor = listarLocais([], { cozinha: true, bar: true });
const comSetor = listarLocais([{ id: 'p1', name: 'Pizzaria', base: 'kitchen' }], { cozinha: true, bar: true });
assert.equal(usaMenuProducao(semSetor), false, 'loja de hoje continua com Cozinha e Bar separados');
assert.equal(usaMenuProducao(comSetor), true);

assert.equal(producaoAcessivel(new Set(['tables'])), false);
assert.equal(producaoAcessivel(new Set(['bar'])), true);
// garçom só com permissão de bar não vê a Pizzaria (base kitchen)
assert.deepEqual(locaisAcessiveis(comSetor, new Set(['bar'])).map((l) => l.chave), ['bar']);

const abas = abasProducao(comSetor, c);
assert.deepEqual(abas.map((a) => [a.chave, a.count]), [['kitchen', 2], ['bar', 1], ['setor:p1', 2]]);
assert.equal(somaContagens(abas), 5);
console.log('producaoNav: ok');
```

- [ ] **Step 2: Rodar e ver falhar** — módulo inexistente.

- [ ] **Step 3: Implementar** — `lib/producaoNav.ts`

```ts
// lib/producaoNav.ts — item de menu "Produção" (abas por local) e contagem de pedidos por local.
import { chaveLocal, type LocalPreparo } from './locaisPreparo';

export interface ItemKds { status: string; sector_id?: string | null; order?: { order_type?: string } | null }

// Mesma regra que o badge de Cozinha/Bar já usava (useStoreNotifications): pedido de mesa pendente, ou balcão aceito.
export const itemPrecisaAcao = (i: ItemKds): boolean =>
  i.status === 'pending' || (i.order?.order_type === 'counter' && i.status === 'accepted');

// Setor apagado (sector_id some por `on delete set null`) ou desconhecido cai no local padrão da base.
export function contarPorLocal(
  porBase: { kitchen: ItemKds[]; bar: ItemKds[] },
  setoresConhecidos: Set<string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  (['kitchen', 'bar'] as const).forEach((base) => {
    porBase[base].filter(itemPrecisaAcao).forEach((i) => {
      const chave = i.sector_id && setoresConhecidos.has(i.sector_id) ? chaveLocal(i.sector_id, base) : base;
      out[chave] = (out[chave] ?? 0) + 1;
    });
  });
  return out;
}

// "Produção" substitui Cozinha/Bar no menu só quando existe pelo menos um setor próprio.
// Loja sem setores (todas as de hoje) continua com os dois botões de sempre — zero mudança.
export const usaMenuProducao = (locais: LocalPreparo[]): boolean => locais.some((l) => l.setorId !== null);

// Acessível se o usuário/loja alcança Cozinha OU Bar (ids de aba de computeAccessibleTabIds).
export const producaoAcessivel = (acessiveis: Set<string>): boolean => acessiveis.has('kitchen') || acessiveis.has('bar');

// Locais que o usuário pode ver na Produção: a permissão da base (kitchen/bar) decide.
export function locaisAcessiveis(locais: LocalPreparo[], acessiveis: Set<string>): LocalPreparo[] {
  return locais.filter((l) => acessiveis.has(l.base));
}

export interface AbaProducao extends LocalPreparo { count: number }
export const abasProducao = (locais: LocalPreparo[], contagens: Record<string, number>): AbaProducao[] =>
  locais.map((l) => ({ ...l, count: contagens[l.chave] ?? 0 }));

export const somaContagens = (abas: { count: number }[]): number => abas.reduce((s, a) => s + a.count, 0);
```

- [ ] **Step 4: Passar** — `npx tsx scripts/testes/producaoNav.test.ts && npx tsc --noEmit`.

- [ ] **Step 5: Commit** — `feat(producao): contagem por local e regra do menu Produção (lib pura)`.

---

### Task 3: Central de notificações (lib pura)

**Files:**
- Create: `lib/notificacoes.ts`, `scripts/testes/notificacoes.test.ts`
- Modify: `types/index.ts` (dentro de `StoreConfig`, depois de `cash_shift_sangria_alert_threshold`, linha ~115)

**Interfaces:**
- Consumes: `itemPrecisaAcao` (Task 2); `resolveStoreModules`, `resolveOrderFlow` (`lib/storeModules.ts`).
- Produces: `TipoNotificacao`, `Publico`, `Som`, `TIPOS`, `EventoNotificacao`, `Detectado`, `publicosDoUsuario`, `tiposAplicaveis`, `resolverPrefs`, `detectarMesas`, `detectarItens`, `detectarImpressoras`, `detectarNotas`, `detectarSangrias`, `detectarEstoque`, `reconciliar(atuais, detectados, tiposVistos, agora, limite?) → {lista, novos}`, `filtrarEventos`, `contarNaoLidos`, `marcarLidos`, `somDoEvento`, `tempoRelativo`, `serializarEventos`, `restaurarEventos`. `StoreConfig.notifications?: { som?: boolean; tipos?: Partial<Record<TipoNotificacao, boolean>> }`.

- [ ] **Step 1: Teste que falha** — `scripts/testes/notificacoes.test.ts`

```ts
// rodar com: npx tsx scripts/testes/notificacoes.test.ts
import assert from 'node:assert/strict';
import {
  publicosDoUsuario, tiposAplicaveis, resolverPrefs, detectarMesas, detectarItens, reconciliar, filtrarEventos,
  contarNaoLidos, marcarLidos, somDoEvento, tempoRelativo, detectarImpressoras, detectarNotas, detectarSangrias, detectarEstoque, serializarEventos, restaurarEventos, type EventoNotificacao,
} from '../../lib/notificacoes';

const AGORA = Date.parse('2026-10-04T22:00:00Z');

// -- quem vê o quê
assert.deepEqual(publicosDoUsuario({ role: 'waiter' }), ['salao']);
assert.ok(publicosDoUsuario({ role: 'cashier' }).includes('caixa'));
assert.ok(publicosDoUsuario({ role: 'waiter', permissions: { caixa: true } }).includes('caixa'));
assert.ok(publicosDoUsuario({ role: 'manager' }).includes('gerencia'));
assert.deepEqual(publicosDoUsuario({ role: 'waiter', permissions: { kitchen: true } }), ['salao', 'cozinha']);

// -- aplicabilidade por loja (Review Focus: lojas sem KDS)
assert.equal(tiposAplicaveis({ config: {} }).has('pedido_novo'), true, 'loja de hoje: KDS ligado');
assert.equal(tiposAplicaveis({ config: { order_flow: 'direct_print' } }).has('pedido_novo'), false, 'impressão direta não tem KDS');
assert.equal(tiposAplicaveis({ config: { modules: { kitchen_kds: false, bar_kds: false } } }).has('item_pronto'), false);
assert.equal(tiposAplicaveis({ config: { order_flow: 'direct_print' } }).has('impressora_falhou'), true);

// -- preferências: ausente = tudo ligado; lixo ignorado
assert.equal(resolverPrefs(undefined).som, true);
assert.equal(resolverPrefs({ notifications: { som: false, tipos: { estoque_baixo: false, pedido_novo: 'sim' } } }).tipos.estoque_baixo, false);
assert.equal(resolverPrefs({ notifications: { tipos: { pedido_novo: 'sim' } } }).tipos.pedido_novo, true);

// -- mesas: sem aviso de "cliente sentou"
const mesas = detectarMesas([
  { id: 'm1', number: 1, status: 'occupied', waiter_requested: true },
  { id: 'm2', number: 2, status: 'waiting_bill' },
  { id: 'm3', number: 3, status: 'occupied' },
  { id: 'm4', number: 4, status: 'available', waiter_requested: true },
]);
assert.deepEqual(mesas.map((m) => m.id), ['chamada_garcom:m1', 'pedido_conta:m2']);

// -- itens: um aviso por pedido e local; setor apagado cai na base
const item = (id: string, status: string, extra: any = {}) => ({ id, order_id: 'o1', status, sector_id: null, created_at: '2026-10-04T21:00:00Z', product: { name: 'Pizza', prep_time_minutes: 30 }, order: { order_type: 'table', tables: { number: 12 } }, ...extra });
const det = detectarItens([
  item('i1', 'pending', { sector_id: 'p1' }), item('i2', 'pending', { sector_id: 'p1' }), item('i3', 'ready'), item('i4', 'preparing', { sector_id: 'apagado' }),
], 'kitchen', { p1: 'Pizzaria' }, AGORA);
assert.equal(det.filter((d) => d.tipo === 'pedido_novo').length, 1, 'dois itens do mesmo pedido/local = 1 aviso');
assert.equal(det.find((d) => d.tipo === 'pedido_novo')!.localChave, 'setor:p1');
assert.equal(det.find((d) => d.tipo === 'item_pronto')!.id, 'item_pronto:i3');
assert.ok(det.some((d) => d.id === 'item_atrasado:i4' && d.localChave === 'kitchen'), '60 min > 30 min de preparo; setor apagado cai na Cozinha');
assert.equal(detectarItens([item('i5', 'pending', { product: { name: 'Água' } })], 'bar', {}, AGORA).some((d) => d.tipo === 'item_atrasado'), false, 'sem tempo de preparo não atrasa');

// -- reconciliar: dedupe, resolução, reativação, fonte fora do ar
let r = reconciliar([], mesas, ['chamada_garcom', 'pedido_conta'], AGORA);
assert.equal(r.novos.length, 2);
r = reconciliar(r.lista, mesas, ['chamada_garcom', 'pedido_conta'], AGORA + 5000);
assert.equal(r.novos.length, 0, 'mesmo aviso no poll seguinte não toca de novo');
r = reconciliar(r.lista, [mesas[1]], ['chamada_garcom', 'pedido_conta'], AGORA + 10000);
assert.equal(r.lista.find((e) => e.id === 'chamada_garcom:m1')!.ativo, false, 'mesa atendida some dos ativos');
assert.equal(r.lista.find((e) => e.id === 'pedido_conta:m2')!.ativo, true);
const fora = reconciliar(r.lista, [], [], AGORA + 15000);   // nenhuma fonte respondeu (offline)
assert.equal(fora.lista.find((e) => e.id === 'pedido_conta:m2')!.ativo, true, 'offline não resolve nada');
r = reconciliar(r.lista, mesas, ['chamada_garcom', 'pedido_conta'], AGORA + 20000);
assert.deepEqual(r.novos.map((e) => e.id), ['chamada_garcom:m1'], 'chamou de novo = toca de novo');
const velho = reconciliar([{ id: 'x', tipo: 'pedido_conta', titulo: 't', criadoEm: AGORA - 7 * 3600e3, lido: true, ativo: false }], [], [], AGORA);
assert.equal(velho.lista.length, 0, 'inativo com mais de 6h sai do histórico');
const muitos = reconciliar([], Array.from({ length: 150 }, (_, k) => ({ id: `chamada_garcom:${k}`, tipo: 'chamada_garcom' as const, titulo: 't' })), ['chamada_garcom'], AGORA);
assert.equal(muitos.lista.length, 100, 'limite de 100');

// -- filtro por função, preferência e local
const lista: EventoNotificacao[] = [
  { id: 'a', tipo: 'estoque_baixo', titulo: 'e', criadoEm: 1, lido: false, ativo: true },
  { id: 'b', tipo: 'pedido_novo', titulo: 'p', criadoEm: 2, lido: false, ativo: true, localChave: 'bar' },
  { id: 'c', tipo: 'pedido_novo', titulo: 'p2', criadoEm: 3, lido: false, ativo: true, localChave: 'setor:p1' },
  { id: 'd', tipo: 'chamada_garcom', titulo: 'c', criadoEm: 4, lido: false, ativo: true },
];
const base = { prefs: resolverPrefs(undefined), aplicaveis: tiposAplicaveis({ config: {} }), locaisPermitidos: null };
assert.deepEqual(filtrarEventos(lista, { ...base, publicos: ['salao'] }).map((e) => e.id), ['d'], 'garçom só vê chamadas');
assert.deepEqual(filtrarEventos(lista, { ...base, publicos: ['bar'], locaisPermitidos: new Set(['bar']) }).map((e) => e.id), ['b'], 'bar só vê o próprio local');
assert.equal(filtrarEventos(lista, { ...base, publicos: publicosDoUsuario({ role: 'manager' }) }).length, 4);
assert.equal(filtrarEventos(lista, { ...base, publicos: ['gerencia'], prefs: resolverPrefs({ notifications: { tipos: { estoque_baixo: false } } }) }).some((e) => e.tipo === 'estoque_baixo'), false);
assert.equal(filtrarEventos(lista, { ...base, publicos: ['gerencia'], aplicaveis: tiposAplicaveis({ config: { order_flow: 'direct_print' } }) }).some((e) => e.tipo === 'pedido_novo'), false);

// -- lidos
assert.equal(contarNaoLidos(lista), 4);
assert.equal(contarNaoLidos(marcarLidos(lista, ['a'])), 3);
assert.equal(contarNaoLidos(marcarLidos(lista)), 0);

// -- som
const pedido = lista[1];
assert.equal(somDoEvento(pedido, { prefs: resolverPrefs(undefined), abaAtual: 'tables' }), 'pedido');
assert.equal(somDoEvento(pedido, { prefs: resolverPrefs(undefined), abaAtual: 'producao' }), null, 'KDS aberto já toca o próprio som');
assert.equal(somDoEvento(lista[3], { prefs: resolverPrefs(undefined), abaAtual: 'producao' }), 'mesa', 'chamada continua tocando no KDS');
assert.equal(somDoEvento(pedido, { prefs: resolverPrefs({ notifications: { som: false } }), abaAtual: 'tables' }), null);
assert.equal(somDoEvento(lista[0], { prefs: resolverPrefs(undefined), abaAtual: 'tables' }), null, 'estoque baixo é silencioso');

// -- persistência
assert.deepEqual(restaurarEventos(serializarEventos(lista)), lista);
assert.deepEqual(restaurarEventos('lixo{'), []);
assert.deepEqual(restaurarEventos('[{"id":1},{"id":"z","tipo":"nada","titulo":"x","criadoEm":1,"lido":false,"ativo":true}]'), []);
assert.deepEqual(restaurarEventos(null), []);
// -- fontes lentas
assert.deepEqual(detectarImpressoras([
  { id: 'j1', status: 'error', title: 'Ticket Mesa 3', created_at: '2026-10-04T21:30:00Z' },
  { id: 'j2', status: 'error', title: 'velho', created_at: '2026-10-04T10:00:00Z' },
  { id: 'j3', status: 'done', title: 'ok', created_at: '2026-10-04T21:59:00Z' },
], AGORA).map((d) => d.id), ['impressora_falhou:j1'], 'só erro recente');
const notas = detectarNotas([
  { id: 'n1', status: 'rejeitada', modelo: '65', numero: 80, motivo_erro: 'cStat 225 Falha no Schema XML', created_at: '2026-10-04T20:00:00Z' },
  { id: 'n2', status: 'autorizada', modelo: '65', numero: 81, created_at: '2026-10-04T20:00:00Z' },
  { id: 'n3', status: 'erro', modelo: '55', numero: null, created_at: '2026-10-01T20:00:00Z' },
], AGORA);
assert.deepEqual(notas.map((n) => n.id), ['nota_rejeitada:n1']);
assert.equal(notas[0].titulo, 'NFC-e nº 80 rejeitada');
const sang = detectarSangrias([
  { operator_name: 'ANE', event_type: 'sangria_grande', created_at: '2026-10-04T21:00:00Z', details: { valor: 1500, motivo: 'cofre' } },
  { operator_name: 'ANE', event_type: 'item_cancelado', created_at: '2026-10-04T21:05:00Z', details: {} },
]);
assert.equal(sang.length, 1);
assert.equal(sang[0].titulo, 'Sangria de R$ 1500,00');
assert.equal(sang[0].detalhe, 'ANE · cofre');
assert.deepEqual(detectarEstoque([{ name: 'Mussarela', stock: 2, threshold: 5 }, { name: 'Calabresa', stock: null, threshold: 3 }]).map((e) => e.detalhe), ['2 em estoque · mínimo 5', 'mínimo 3']);

// -- tempo relativo
assert.equal(tempoRelativo(AGORA, AGORA), 'agora');
assert.equal(tempoRelativo(AGORA - 3 * 60000, AGORA), 'há 3 min');
assert.equal(tempoRelativo(AGORA - 125 * 60000, AGORA), 'há 2 h');
assert.equal(tempoRelativo(AGORA - 50 * 3600e3, AGORA), 'há 2 d');
assert.equal(tempoRelativo(AGORA + 5000, AGORA), 'agora', 'relógio adiantado não vira negativo');
console.log('notificacoes: ok');
```

- [ ] **Step 2: Rodar e ver falhar** — módulo inexistente.

- [ ] **Step 3: Implementar** — `lib/notificacoes.ts`

```ts
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
```

- [ ] **Step 4: Tipar a configuração** — em `types/index.ts`, dentro de `StoreConfig`:

```ts
    // Central de notificações (04/10/2026) — ausente = tudo ligado, com som. Ver lib/notificacoes.ts.
    notifications?: { som?: boolean; tipos?: Partial<Record<import('@/lib/notificacoes').TipoNotificacao, boolean>> };
```

- [ ] **Step 5: Passar** — `npx tsx scripts/testes/notificacoes.test.ts && npx tsc --noEmit`.

- [ ] **Step 6: Commit** — `feat(notificacoes): tipos, filtro por função, dedupe e som (lib pura)`.

---

### Task 4: Hook de notificações + contexto (troca o hook antigo)

**Files:**
- Create: `lib/useStoreNotifications.ts`, `components/NotificacoesContext.tsx`
- Modify: `components/modules/StoreModule.tsx` — remover `useStoreNotifications` antigo (588-701) e o import não usado de `fetchActiveOrdersForTables` se sobrar sem uso; em `StoreLayout` (~1003-1130) mover para ANTES da chamada do hook o cálculo de `storeModules`/`hasPermission`/`accessibleTabIds` (linhas 1118-1122, que só dependem de `user`) e trocar `const notifications = useStoreNotifications(user.store.id)` pelo novo hook.

**Interfaces:**
- Consumes: Tasks 1-3; `fetchTables`, `fetchKitchenOrders(storeId, base, onError)`, `fetchPrintSectors`, `fetchRecentPrintJobs`, `fetchFiscalNotas`, `fetchExceptionsReport`, `fetchLowStockAlerts` (`lib/api.ts`); `play*Alert`/`vibrateAlert` (`lib/audioAlert.ts`).
- Produces: `useStoreNotifications({ store, user, acessiveis, abaAtual }) → { counts: {tables, kitchen, bar}, porLocal, locais: LocalPreparo[], eventos: EventoNotificacao[], naoLidos: number, marcarLidos(ids?: string[]): void, pausado: boolean }` e `NotificacoesContext`/`useNotificacoes()` com o mesmo formato.

Comportamento que muda de propósito: o número do badge de **Mesas** passa a contar só chamada de garçom + conta pedida (some o "cliente sentou e ainda não pediu"); o de Cozinha/Bar continua `itemPrecisaAcao`. A consulta de pedidos ativos (`fetchActiveOrdersForTables`), que só servia ao aviso removido, deixa de ser feita a cada ping.

- [ ] **Step 1: Criar o contexto** — `components/NotificacoesContext.tsx`

```tsx
'use client';
import React, { createContext, useContext } from 'react';
import type { EventoNotificacao } from '@/lib/notificacoes';
import type { LocalPreparo } from '@/lib/locaisPreparo';

export interface NotificacoesValor {
  counts: { tables: number; kitchen: number; bar: number };
  porLocal: Record<string, number>;
  locais: LocalPreparo[];
  eventos: EventoNotificacao[];
  naoLidos: number;
  marcarLidos: (ids?: string[]) => void;
  pausado: boolean;
}
const VAZIO: NotificacoesValor = { counts: { tables: 0, kitchen: 0, bar: 0 }, porLocal: {}, locais: [], eventos: [], naoLidos: 0, marcarLidos: () => {}, pausado: false };
const Ctx = createContext<NotificacoesValor>(VAZIO);
export const NotificacoesProvider = Ctx.Provider;
export const useNotificacoes = () => useContext(Ctx);
```

- [ ] **Step 2: Criar o hook** — `lib/useStoreNotifications.ts`

```ts
'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { fetchTables, fetchKitchenOrders, fetchPrintSectors, fetchRecentPrintJobs, fetchFiscalNotas, fetchExceptionsReport, fetchLowStockAlerts } from '@/lib/api';
import { toast } from '@/components/Toast';
import { playNewOrderAlert, playReadyAlert, playItemLateAlert, playPrintFailureAlert, vibrateAlert } from '@/lib/audioAlert';
import { resolveStoreModules } from '@/lib/storeModules';
import { listarLocais, type SetorLike } from '@/lib/locaisPreparo';
import { contarPorLocal, itemPrecisaAcao, locaisAcessiveis, type ItemKds } from '@/lib/producaoNav';
import {
  resolverPrefs, tiposAplicaveis, publicosDoUsuario, detectarMesas, detectarItens, detectarImpressoras, detectarNotas,
  detectarSangrias, detectarEstoque, reconciliar, filtrarEventos, contarNaoLidos, marcarLidos as marcarLidosLib, somDoEvento,
  serializarEventos, restaurarEventos, type Detectado, type EventoNotificacao, type ItemKdsCompleto, type Som, type TipoNotificacao,
} from '@/lib/notificacoes';
import type { Store, StoreUser } from '@/types';

interface Opcoes {
  store: Store;
  user: Pick<StoreUser, 'id' | 'role'> & { permissions?: { caixa?: boolean; kitchen?: boolean; bar?: boolean } };
  /** Abas acessíveis (computeAccessibleTabIds) — define quais bases (Cozinha/Bar) o usuário enxerga. */
  acessiveis: Set<string>;
  abaAtual: string;
}

function tocar(som: Som) {
  if (som === 'mesa') { playNewOrderAlert(); vibrateAlert([200, 100, 200, 100, 200]); }
  else if (som === 'pedido') { playNewOrderAlert(); vibrateAlert([100, 60, 100]); }
  else if (som === 'pronto') playReadyAlert();
  else if (som === 'atraso') playItemLateAlert();
  else playPrintFailureAlert();
}

export function useStoreNotifications({ store, user, acessiveis, abaAtual }: Opcoes) {
  const storeId = store.id;
  const chave = `ntb-notif:${storeId}:${user.id ?? 'universal'}`;
  const [eventos, setEventos] = useState<EventoNotificacao[]>(() => { try { return restaurarEventos(localStorage.getItem(chave)); } catch { return []; } });
  const [setores, setSetores] = useState<SetorLike[]>([]);
  const [counts, setCounts] = useState({ tables: 0, kitchen: 0, bar: 0 });
  const [porLocal, setPorLocal] = useState<Record<string, number>>({});
  const [pausado, setPausado] = useState(false);

  const modulos = resolveStoreModules(store);
  const prefs = useMemo(() => resolverPrefs(store.config), [store.config]);
  const aplicaveis = useMemo(() => tiposAplicaveis(store), [store]);
  const publicos = useMemo(() => publicosDoUsuario(user), [user]);
  const locais = useMemo(() => listarLocais(setores, { cozinha: modulos.kitchen_kds, bar: modulos.bar_kds }), [setores, modulos.kitchen_kds, modulos.bar_kds]);
  // Gerência vê tudo; as demais funções só os locais cuja base (Cozinha/Bar) elas acessam.
  const locaisPermitidos = useMemo(
    () => (publicos.includes('gerencia') ? null : new Set(locaisAcessiveis(locais, acessiveis).map((l) => l.chave))),
    [publicos, locais, acessiveis],
  );

  // Refs: o poll e os eventos de realtime sempre leem o estado mais novo sem reassinar o canal.
  const ctxRef = useRef({ prefs, aplicaveis, publicos, locaisPermitidos, abaAtual, setores, modulos });
  ctxRef.current = { prefs, aplicaveis, publicos, locaisPermitidos, abaAtual, setores, modulos };
  const eventosRef = useRef(eventos);
  const rodou = useRef<Record<string, boolean>>({});

  const aplicar = useCallback((grupo: string, detectados: Detectado[], vistos: TipoNotificacao[]) => {
    const { lista, novos } = reconciliar(eventosRef.current, detectados, vistos, Date.now());
    eventosRef.current = lista;
    setEventos(lista);
    try { localStorage.setItem(chave, serializarEventos(lista)); } catch { /* sem persistência */ }
    const primeira = !rodou.current[grupo];
    rodou.current[grupo] = true;
    if (primeira) return; // abrir o app não toca som do que já estava lá
    const c = ctxRef.current;
    const meus = filtrarEventos(novos, { prefs: c.prefs, aplicaveis: c.aplicaveis, publicos: c.publicos, locaisPermitidos: c.locaisPermitidos });
    new Set(meus.map((e) => somDoEvento(e, { prefs: c.prefs, abaAtual: c.abaAtual })).filter((s): s is Som => !!s)).forEach(tocar);
    if (meus.some((e) => e.tipo === 'pedido_novo')) toast.info('Novo pedido chegou! 🔔');
    if (meus.some((e) => e.tipo === 'chamada_garcom' || e.tipo === 'pedido_conta')) toast.info('Atenção na mesa! 🔔');
  }, [chave]);

  const carregarSetores = useCallback(() => { fetchPrintSectors(storeId).then((l) => setSetores(l.map((s) => ({ id: s.id, name: s.name, base: s.base })))).catch(() => {}); }, [storeId]);

  const carregarRapido = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) { setPausado(true); return; }
    setPausado(false);
    const detectados: Detectado[] = [];
    const vistos: TipoNotificacao[] = [];
    try {
      const mesas = detectarMesas(await fetchTables(storeId));
      detectados.push(...mesas);
      vistos.push('chamada_garcom', 'pedido_conta');
      setCounts((c) => ({ ...c, tables: mesas.length }));
    } catch { /* mantém o que já tinha */ }

    const { aplicaveis: ap, setores: st, modulos: m } = ctxRef.current;
    if (ap.has('pedido_novo')) {
      let falhou = false;
      const onError = () => { falhou = true; };
      const [k, b] = await Promise.all([
        m.kitchen_kds ? fetchKitchenOrders(storeId, 'kitchen', onError) : Promise.resolve([]),
        m.bar_kds ? fetchKitchenOrders(storeId, 'bar', onError) : Promise.resolve([]),
      ]);
      if (!falhou) {
        const nomes = Object.fromEntries(st.map((s) => [s.id, s.name]));
        const agora = Date.now();
        detectados.push(...detectarItens(k as ItemKdsCompleto[], 'kitchen', nomes, agora), ...detectarItens(b as ItemKdsCompleto[], 'bar', nomes, agora));
        vistos.push('pedido_novo', 'item_pronto', 'item_atrasado');
        setCounts((c) => ({ ...c, kitchen: (k as ItemKds[]).filter(itemPrecisaAcao).length, bar: (b as ItemKds[]).filter(itemPrecisaAcao).length }));
        setPorLocal(contarPorLocal({ kitchen: k as ItemKds[], bar: b as ItemKds[] }, new Set(st.map((s) => s.id))));
      }
    }
    aplicar('rapido', detectados, vistos);
  }, [storeId, aplicar]);

  // Fontes lentas (só gerência/caixa): impressão, notas fiscais, sangria; estoque a cada 10 min.
  const ultimoEstoque = useRef(0);
  const carregarLento = useCallback(async () => {
    const { publicos: pu } = ctxRef.current;
    if (!pu.includes('gerencia') && !pu.includes('caixa')) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const detectados: Detectado[] = [];
    const vistos: TipoNotificacao[] = [];
    const agora = Date.now();
    try { detectados.push(...detectarImpressoras(await fetchRecentPrintJobs(storeId, 30), agora)); vistos.push('impressora_falhou'); } catch { /* fonte fora */ }
    try { detectados.push(...detectarNotas(await fetchFiscalNotas(storeId), agora)); vistos.push('nota_rejeitada'); } catch { /* fonte fora */ }
    try {
      const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
      detectados.push(...detectarSangrias((await fetchExceptionsReport(storeId, inicio, new Date())).events));
      vistos.push('sangria_alta');
    } catch { /* fonte fora */ }
    if (pu.includes('gerencia') && agora - ultimoEstoque.current > 10 * 60000) {
      ultimoEstoque.current = agora;
      try { detectados.push(...detectarEstoque(await fetchLowStockAlerts(storeId))); vistos.push('estoque_baixo'); } catch { /* fonte fora */ }
    }
    aplicar('lento', detectados, vistos);
  }, [storeId, aplicar]);

  useEffect(() => {
    carregarSetores();
    carregarRapido();
    carregarLento();
    const onSetores = () => carregarSetores();
    window.addEventListener('ntb-setores-changed', onSetores);
    const canal = supabase.channel(`notifications_${storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_change_pings', filter: `store_id=eq.${storeId}` }, carregarRapido)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_change_pings', filter: `store_id=eq.${storeId}` }, carregarRapido)
      .subscribe();
    const rapido = window.setInterval(() => { if (document.visibilityState === 'visible') carregarRapido(); }, 30000);
    const lento = window.setInterval(() => { if (document.visibilityState === 'visible') carregarLento(); }, 4 * 60000);
    const setoresTimer = window.setInterval(carregarSetores, 60000);
    return () => {
      supabase.removeChannel(canal);
      window.removeEventListener('ntb-setores-changed', onSetores);
      window.clearInterval(rapido); window.clearInterval(lento); window.clearInterval(setoresTimer);
    };
  }, [storeId, carregarRapido, carregarLento, carregarSetores]);

  const visiveis = useMemo(() => filtrarEventos(eventos, { prefs, aplicaveis, publicos, locaisPermitidos }), [eventos, prefs, aplicaveis, publicos, locaisPermitidos]);
  const marcarLidos = useCallback((ids?: string[]) => {
    const lista = marcarLidosLib(eventosRef.current, ids);
    eventosRef.current = lista;
    setEventos(lista);
    try { localStorage.setItem(chave, serializarEventos(lista)); } catch { /* sem persistência */ }
  }, [chave]);

  return { counts, porLocal, locais, eventos: visiveis, naoLidos: contarNaoLidos(visiveis), marcarLidos, pausado };
}
```

- [ ] **Step 3: Ligar no `StoreLayout`** — em `StoreModule.tsx`: apagar o hook antigo (588-701); mover as linhas 1118-1122 (`storeModules`, `hasPermission`, `accessibleTabIds`) para logo antes da antiga linha 1009; substituir a linha 1009 por:

```tsx
  const notif = useStoreNotifications({ store: user.store, user, acessiveis: accessibleTabIds, abaAtual: currentTab });
  const notifications = notif.counts;
```
e envolver o conteúdo retornado do `StoreLayout` em `<NotificacoesProvider value={notif}>…</NotificacoesProvider>` (o `children` precisa ficar dentro, para `ProducaoView` e o sino lerem). Imports: `useStoreNotifications` de `@/lib/useStoreNotifications`, `NotificacoesProvider` de `@/components/NotificacoesContext`.

- [ ] **Step 4: Verificar** — `npx tsc --noEmit` limpo; `npm run build` passa; abrir a ZZ Laboratório e conferir que os badges de Mesas/Cozinha/Bar aparecem como antes (sem o aviso de "cliente sentou").

- [ ] **Step 5: Commit** — `feat(notificacoes): hook novo (mesas, KDS por local, impressão, notas, sangria, estoque) e contexto`.

---

### Task 5: Menu "Produção" com abas por local

**Files:**
- Create: `components/modules/ProducaoView.tsx`
- Modify: `components/modules/StoreModule.tsx` (`KdsView` 1593; `allTabs` 1096-1105; `visibleTabs` 1123-1126; sidebar 1181 e 1283-1286; bottom nav 1406; título/render 13615-13653; restauração de aba ~13473; `canAccess` 13601)

**Interfaces:**
- Consumes: `useNotificacoes()` (Task 4), `usaMenuProducao`, `producaoAcessivel`, `locaisAcessiveis`, `abasProducao`, `somaContagens` (Task 2).
- Produces: aba `'producao'` (derivada: não entra em `TAB_IDS` nem em `TAB_MODULE_KEY`; é acessível quando `producaoAcessivel(accessibleTabIds)`); `KdsView` ganha a prop opcional `fixedLocal?: string` (`'padrao'` ou id do setor).

- [ ] **Step 1: `KdsView` aceita local fixo** — alterar a assinatura (linha 1593) e a decisão do local ativo (linha 1778) e esconder o seletor interno quando fixo:

```tsx
const KdsView: React.FC<{ destination: 'kitchen' | 'bar'; store: Store; fixedLocal?: string }> = ({ destination, store, fixedLocal }) => {
```
```tsx
  const localAtivo = fixedLocal ?? (localKds === 'todos' || localKds === 'padrao' || locaisKds.some(x => x.id === localKds) ? localKds : 'todos');
```
```tsx
        {locaisKds.length > 0 && !fixedLocal && (
```
(o `SegmentedControl` do bloco 1784-1795 fica igual, só ganha a condição). `escolherLocalKds`/`localStorage` seguem para quem usa Cozinha/Bar sem Produção.

- [ ] **Step 2: Criar `ProducaoView`** — mesmo `SegmentedControl` e o mesmo contador do KDS, número com `AnimatedNumber`:

```tsx
'use client';
import React, { useState } from 'react';
import { SegmentedControl } from '@/components/ui';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { useNotificacoes } from '@/components/NotificacoesContext';
import { abasProducao, locaisAcessiveis } from '@/lib/producaoNav';
import type { Store } from '@/types';

export const ProducaoView: React.FC<{ store: Store; acessiveis: Set<string>; renderKds: (local: { chave: string; base: 'kitchen' | 'bar'; setorId: string | null }) => React.ReactNode }> = ({ store, acessiveis, renderKds }) => {
  const { locais, porLocal } = useNotificacoes();
  const visiveis = locaisAcessiveis(locais, acessiveis);
  const chaveSalva = `ntb-producao-aba:${store.id}`;
  const [ativa, setAtiva] = useState<string>(() => { try { return localStorage.getItem(chaveSalva) || ''; } catch { return ''; } });
  const abas = abasProducao(visiveis, porLocal);
  const atual = abas.find((a) => a.chave === ativa) ?? abas[0];
  if (!atual) return <p className="text-sm text-[var(--text-muted)]">Nenhum local de preparo disponível para o seu usuário.</p>;
  const escolher = (v: string) => { setAtiva(v); try { localStorage.setItem(chaveSalva, v); } catch { /* sem persistência */ } };
  return (
    <div>
      <div className="overflow-x-auto no-scrollbar mb-4 -mx-1 px-1">
        <SegmentedControl
          value={atual.chave}
          onChange={escolher}
          options={abas.map((a) => ({
            value: a.chave,
            label: <>{a.nome} <AnimatedNumber value={a.count} format={(n) => String(Math.round(n))} className="num font-medium text-[var(--text-muted)]" /></>,
          }))}
        />
      </div>
      {renderKds(atual)}
    </div>
  );
};
```
(`renderKds` evita importar `KdsView`, que mora dentro de `StoreModule.tsx`.)

- [ ] **Step 3: Menu lateral e bottom nav** — em `StoreLayout`, usar o contexto/hook já criado (`notif`) para trocar os dois itens por um:

```tsx
  const menuProducao = usaMenuProducao(notif.locais) && producaoAcessivel(accessibleTabIds);
  const tabAcessivel = (id: string) => (id === 'producao' ? producaoAcessivel(accessibleTabIds) : accessibleTabIds.has(id));
  const allTabs = [
    { id: 'caixa', icon: Wallet, label: 'Caixa', permission: 'caixa' },
    { id: 'tables', icon: LayoutDashboard, label: 'Gestão de Mesas', permission: 'tables', count: notifications.tables },
    { id: 'counter', icon: Coffee, label: 'Balcão', permission: 'counter' },
    ...(menuProducao
      ? [{ id: 'producao', icon: ChefHat, label: 'Produção', permission: 'kitchen', count: somaContagens(abasProducao(locaisAcessiveis(notif.locais, accessibleTabIds), notif.porLocal)) }]
      : [
          { id: 'kitchen', icon: ChefHat, label: 'Cozinha (KDS)', permission: 'kitchen', count: notifications.kitchen },
          { id: 'bar', icon: Wine, label: 'Bar (KDS)', permission: 'bar', count: notifications.bar },
        ]),
    { id: 'menu', icon: UtensilsCrossed, label: 'Cardápio', permission: 'menu' },
    { id: 'admin', icon: BarChart3, label: 'Administração', permission: 'admin' },
  ];
```
Trocar `accessibleTabIds.has(item.id)` por `tabAcessivel(item.id)` em `visibleTabs` (1123-1126), no ícone de cadeado da sidebar (1286) e no filtro do bottom nav; incluir `'producao'` na lista `['caixa','tables','counter','kitchen','bar','producao']` do `bottomNavTabs`. Contador no menu lateral/inferior já usa as classes do badge existente; trocar o `{item.count}` do badge da sidebar por `<AnimatedNumber value={item.count} format={(n) => String(Math.round(n))} />`.

Efeito de redirecionamento (loja ganhou/perdeu o primeiro setor com a aba aberta), no `StoreLayout`:

```tsx
  useEffect(() => {
    if (menuProducao && (currentTab === 'kitchen' || currentTab === 'bar')) onTabChange('producao');
    if (!menuProducao && currentTab === 'producao') onTabChange(accessibleTabIds.has('kitchen') ? 'kitchen' : 'bar');
  }, [menuProducao, currentTab]);
```

- [ ] **Step 4: Renderizar a aba** — em `StoreModule` (13601 e 13615-13653): `const canAccess = (t) => t === 'producao' ? producaoAcessivel(accessibleTabIds) : accessibleTabIds.has(t);`, título `tab === 'producao' ? 'Produção' : …`, e:

```tsx
{tab === 'producao' && canAccess('producao') && (
  <ProducaoView store={user.store} acessiveis={accessibleTabIds}
    renderKds={(l) => <KdsView key={l.chave} destination={l.base} store={user.store} fixedLocal={l.setorId ?? 'padrao'} />} />
)}
```
Na restauração de sessão (~13473) trocar `accessible.has(savedTab)` por `savedTab === 'producao' ? producaoAcessivel(accessible) : accessible.has(savedTab)`.

- [ ] **Step 5: Verificar** — `npx tsc --noEmit`; em ZZ Laboratório criar o local "Pizzaria" (base cozinha) com uma categoria: o menu troca Cozinha/Bar por "Produção" com abas Cozinha · Bar · Pizzaria, cada uma com contador; lançar um pedido da categoria e ver o número da aba Pizzaria contar até 1; apagar o local e conferir que volta Cozinha/Bar. Celular (390 px): bottom nav com "Produção".

- [ ] **Step 6: Commit** — `feat(producao): menu Produção com abas por local, contador e KDS de local fixo`.

---

### Task 6: Sino de avisos e preferências em Configurações

**Files:**
- Create: `components/NotificationBell.tsx`
- Modify: `components/modules/StoreModule.tsx` (cabeçalho mobile ~1135-1151 ao lado do `ThemeToggle`; sidebar logo acima do botão "Bater ponto" ~1326), `components/modules/StoreSettingsView.tsx` (seção "Notificações" depois do bloco "Pedir a senha de quem lança o pedido", ~473)

**Interfaces:**
- Consumes: `useNotificacoes()` (Task 4), `tempoRelativo`, `TIPOS`, `resolverPrefs`, `tiposAplicaveis` (Task 3), `Modal`, `Button` (`components/ui.tsx`), `AnimatedNumber`, `LIST_ITEM_MOTION`, `SPRING_TAP`.
- Produces: `<NotificationBell variant="header" | "sidebar" collapsed? />`.

- [ ] **Step 1: Criar o sino** — `components/NotificationBell.tsx`. Usa o `Modal` (que, após a correção de tema do adendo, segue claro/escuro), a lista viva do KDS e o mesmo badge vermelho do menu:

```tsx
'use client';
import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, Hand, Receipt, ChefHat, CheckCircle2, Clock, Package, FileWarning, Wallet, Printer } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { useNotificacoes } from '@/components/NotificacoesContext';
import { LIST_ITEM_MOTION, SPRING_TAP } from '@/lib/motion';
import { tempoRelativo, type TipoNotificacao } from '@/lib/notificacoes';

const ICONE: Record<TipoNotificacao, React.ElementType> = {
  chamada_garcom: Hand, pedido_conta: Receipt, pedido_novo: ChefHat, item_pronto: CheckCircle2, item_atrasado: Clock,
  estoque_baixo: Package, nota_rejeitada: FileWarning, sangria_alta: Wallet, impressora_falhou: Printer,
};

export const NotificationBell: React.FC<{ variant: 'header' | 'sidebar'; collapsed?: boolean }> = ({ variant, collapsed }) => {
  const { eventos, naoLidos, marcarLidos, pausado } = useNotificacoes();
  const [aberto, setAberto] = useState(false);
  const agora = Date.now();
  const botao = variant === 'sidebar'
    ? `flex items-center w-full px-3 h-10 rounded-[10px] text-[13px] font-medium u-motion whitespace-nowrap text-white/60 hover:bg-white/10 hover:text-white ${collapsed ? 'justify-center' : 'gap-3'}`
    : 'w-11 h-11 flex items-center justify-center text-[var(--text)] hover:bg-[var(--surface-2)] rounded-full u-motion u-press shrink-0';
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className={`relative ${botao}`} aria-label={naoLidos > 0 ? `Avisos, ${naoLidos} não lidos` : 'Avisos'}>
        <Bell size={variant === 'sidebar' ? 18 : 20} />
        {variant === 'sidebar' && !collapsed && <span>Avisos</span>}
        <AnimatePresence>
          {naoLidos > 0 && (
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={SPRING_TAP}
              className={`bg-[var(--err-fill)] text-white text-[10px] font-semibold min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center num ${variant === 'sidebar' && !collapsed ? 'ml-auto' : 'absolute top-1 right-1'}`}
            >
              <AnimatedNumber value={Math.min(naoLidos, 99)} format={(n) => String(Math.round(n))} />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <Modal isOpen={aberto} onClose={() => setAberto(false)} title="Avisos" variant="sheet">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-[var(--text-muted)]">{pausado ? 'Sem conexão — os avisos voltam quando a internet voltar.' : 'Só o que pede uma ação sua.'}</p>
            <Button size="sm" variant="ghost" disabled={naoLidos === 0} onClick={() => marcarLidos()}>Marcar todos como lidos</Button>
          </div>
          {eventos.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--text-muted)]">Nada pendente por aqui.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface-2)]/60">
              <AnimatePresence mode="popLayout">
                {eventos.map((e) => {
                  const Icone = ICONE[e.tipo];
                  return (
                    <motion.li key={e.id} {...LIST_ITEM_MOTION}>
                      <button type="button" onClick={() => marcarLidos([e.id])} className={`w-full min-h-11 flex items-start gap-3 px-3 py-3 text-left u-press-sm ${e.ativo ? '' : 'opacity-60'}`}>
                        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--surface)] text-[var(--text)]"><Icone size={16} /></span>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-[15px] text-[var(--text)] ${e.lido ? 'font-medium' : 'font-semibold'}`}>{e.titulo}</span>
                          {e.detalhe && <span className="block text-[13px] text-[var(--text-muted)]">{e.detalhe}</span>}
                        </span>
                        <span className="shrink-0 text-right text-[12px] text-[var(--text-muted)] num">
                          {e.ativo ? tempoRelativo(e.criadoEm, agora) : 'resolvido'}
                          {!e.lido && e.ativo && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-[var(--brand)] align-middle" />}
                        </span>
                      </button>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
};
```

- [ ] **Step 2: Posicionar o sino** — cabeçalho mobile (`StoreModule.tsx` ~1151): `<NotificationBell variant="header" />` antes do `<ThemeToggle />`; sidebar (~1326): `<div className="px-3 pb-1"><NotificationBell variant="sidebar" collapsed={isCollapsed} /></div>` imediatamente acima do bloco do botão "Bater ponto". Esconder no modo Aberto (`isAberto`) como o "Bater ponto".

- [ ] **Step 3: Preferências em Configurações** — em `StoreSettingsView.tsx`, estado e handler no mesmo padrão otimista de `handleTogglePedidoPedeSenha` (233-246), linhas com o mesmo markup de interruptor das vizinhas (`role="switch"`, `bg-[var(--ok-fill)]`):

```tsx
    const prefsNotif = resolverPrefs(currentStoreConfig);
    const aplicaveisNotif = tiposAplicaveis({ config: currentStoreConfig });
    const salvarNotif = async (patch: { som?: boolean; tipo?: [TipoNotificacao, boolean] }) => {
        const anterior = currentStoreConfig;
        const atual = resolverPrefs(anterior);
        const proximo = {
            som: patch.som ?? atual.som,
            tipos: patch.tipo ? { ...atual.tipos, [patch.tipo[0]]: patch.tipo[1] } : atual.tipos,
        };
        const newConfig = { ...anterior, notifications: proximo };
        setCurrentStoreConfig(newConfig);
        try {
            await updateStoreConfig(store.id, newConfig);
            if (onStoreUpdate) onStoreUpdate({ ...store, config: newConfig });
        } catch (e) {
            console.error('Error updating notifications config', e);
            setCurrentStoreConfig(anterior);
            toast.error('Erro ao atualizar as notificações.');
        }
    };
```
Bloco: título "Notificações" (`h4 font-semibold text-[15px]`), interruptor "Tocar som nos avisos" e uma linha por `TIPOS.filter((t) => aplicaveisNotif.has(t.tipo))` com `t.label` + `t.desc` e o interruptor ligado a `prefsNotif.tipos[t.tipo]`. Tipos que a loja não tem (ex.: pedido novo numa loja sem KDS) não aparecem.

- [ ] **Step 4: Verificar** — `npx tsc --noEmit`. Em ZZ Laboratório: chamar garçom pelo cardápio do cliente → o sino mostra o aviso, o número do badge conta (animado), toca o som da mesa; atender a mesa → o aviso vira "resolvido" e some do contador; desligar "Chamada de garçom" em Configurações → novo chamado não aparece nem toca; alternar para tema escuro e conferir o painel; celular 390 px.

- [ ] **Step 5: Commit** — `feat(notificacoes): sino de avisos com painel e preferências por tipo em Configurações`.

---

### Task 7: Cadastro único de Locais de preparo (nome, base, impressora, estoque Omie, categorias)

**Files:**
- Create: `components/modules/LocaisPreparoView.tsx`
- Modify: `lib/api.ts` (junto de `createPrintSector`, linha ~821), `components/modules/StoreModule.tsx` (remover os dois cartões "Locais de preparo" do Cardápio — 9802-9850 e 10139-10165 — e o cartão/integração "Integração com o NTB Estoque" movido para a nova tela como atalho de leitura; novo item `{ id: 'locais', label: 'Locais de preparo' }` no grupo "Operação" de `ADMIN_NAV_GROUPS`, ~11755; render `activeTab === 'locais'` ao lado de `'impressao'`, ~12247), `components/modules/PrinterSettingsView.tsx` (remover o cartão de 526-~620, que passa a viver na nova tela)

**Interfaces:**
- Consumes: Task 1 (`listarLocais`, `statusLocal`, `chaveLocal`), `fetchPrintSectors`, `createPrintSector`, `deletePrintSector`, `updateCategorySector`, `fetchPrinterConfigs`, `updatePrinterConfig`, `fetchLocaisEstoque`, `salvarLocalEstoque`, `fetchMenu(storeId, false, true)`.
- Produces: `updatePrintSector(id, { name?, base? })`; evento `window.dispatchEvent(new Event('ntb-setores-changed'))` depois de criar/editar/apagar (o hook e o menu recarregam na hora).

- [ ] **Step 1: API de edição** — em `lib/api.ts`:

```ts
export const updatePrintSector = async (id: string, patch: { name?: string; base?: 'kitchen' | 'bar' }) => {
  const { error } = await supabase.from('print_sectors').update(patch).eq('id', id);
  if (error) throw error;
};
```
(RLS de `print_sectors` é `allow_all_anon`, migration 087; sem migration nova.) Corrigir também a criação: hoje o Cardápio cria sempre com `'kitchen'` fixo (`createPrintSector(storeId, nome, 'kitchen')`, 9792 e 10146) — na nova tela a base é escolhida.

- [ ] **Step 2: Tela** — `LocaisPreparoView` (props `{ store: Store }`): carrega em paralelo setores, impressoras, categorias/produtos (`fetchMenu(store.id, false, true)`) e `fetchLocaisEstoque(store.id)` (1 chamada; mostra o aviso de erro que a tela de impressão já mostra quando o Omie não responde). Para cada `listarLocais(...)` renderiza um `Card` (mesmos `Card`, `Input`, `Button`, `Badge` e `SegmentedControl` do app):
  - cabeçalho com nome, `Badge` da base e, para setores, "Renomear" / "Excluir" (usa o `confirm` já usado no Cardápio e dispara `ntb-setores-changed`);
  - **checklist** vindo de `statusLocal({ local, impressoras, mapaEstoque: estoque.configurado ? estoque.mapa : null, categoriasDoLocal, produtosDoLocal })`: uma linha por item, ícone de estado com os tokens `--ok`, `--warn`, `--err` já usados nos status do app, texto da lib e, quando `estado !== 'ok'`, o controle para resolver ali mesmo;
  - **Impressora:** `<select>` das impressoras ativas → `updatePrinterConfig(id, { sector_id })` (mesma regra `printerServesSector`);
  - **Estoque (Omie):** o mesmo `<select>` de `PrinterSettingsView` (locais de `estoque.locais`) → `salvarLocalEstoque(store.id, chave, local)`; só aparece se `estoque.configurado`;
  - **Categorias:** multisseleção das categorias da loja → `updateCategorySector(cat.id, setorId | null)`;
  - rodapé "Novo local": nome + base (`SegmentedControl` Cozinha/Bar) + botão "Criar local" → `createPrintSector(store.id, nome, base)`, e o novo cartão já abre com o checklist mostrando o que falta ("Nenhuma categoria aponta para este local", "Sem impressora própria", "Sem local de estoque do Omie") — exatamente o que faltou na Donana.
  Animação: lista de cartões com `LIST_ITEM_MOTION`; trocar de estado do checklist sem salto (só `u-motion`). Nenhum estilo novo.

- [ ] **Step 3: Tirar os cartões duplicados** — remover do Cardápio os dois blocos "Locais de preparo" e a escolha de categoria por local (a escolha por **produto** em 10216/10329 continua no editor de produto), deixando no lugar do primeiro bloco uma linha de texto com atalho "Locais de preparo agora ficam em Administração → Locais de preparo". Remover de `PrinterSettingsView` o cartão "Locais de preparo" (526-~620) e trocar por um texto-atalho equivalente. A seção "Integração com o NTB Estoque" do Cardápio (status "Configurado") vira um item de leitura no topo de `LocaisPreparoView` (e continua editável onde estiver hoje se não for possível mover sem risco — nesse caso só se oculta a duplicata do cabeçalho do Cardápio, nunca a configuração).

- [ ] **Step 4: Nova aba em Administração** — adicionar `{ id: 'locais', label: 'Locais de preparo' }` no grupo "Operação" e `{activeTab === 'locais' && <LocaisPreparoView store={store} />}`; incluir `'locais'` no tipo de `activeTab`. (A reorganização da Administração em 5 áreas, etapa 4 do plano-mãe, move esta aba depois; aqui só garante que ela exista.)

- [ ] **Step 5: Verificar** — `npx tsc --noEmit`; na Donana (ou ZZ): criar "Pizzaria" base Cozinha → o checklist mostra 3 pendências; apontar uma categoria, escolher a impressora e o local do Omie → checklist 100% e o menu passa a mostrar "Produção"; excluir o local → categorias voltam para a Cozinha e o menu volta ao normal. Conferir que o Cardápio não tem mais o cartão duplicado e que `PrinterSettingsView` continua listando impressoras e fila.

- [ ] **Step 6: Commit** — `feat(locais): cadastro único de local de preparo com checklist (impressora, estoque Omie, categorias)`.

---

### Task 8: QA visual e de operação, regressões e documentação

**Files:**
- Modify: `AGENTS.md` (nova seção curta "Locais de preparo, Produção e notificações"), `docs/superpowers/plans/2026-10-04-locais-preparo-producao-notificacoes.md` (marcar tasks)

- [ ] **Step 1: Suíte de testes** — `for t in scripts/testes/*.test.ts; do npx tsx "$t" || echo FALHOU $t; done` e `npx tsc --noEmit && npm run build`.

- [ ] **Step 2: QA de operação (só Donana/ZZ; nunca Sertão)** — perfis: (a) cozinha+bar+pizzaria com Omie/estoque (Donana); (b) loja `direct_print` (sem KDS) e (c) vitrine `client_ordering:false` (ZZ configurada igual ao Sertão, **sem tocar** no Sertão). Roteiro:
  1. Criar "Pizzaria", checar checklist, apontar categoria, lançar pedido: aparece na aba Pizzaria da Produção, contador sobe, aviso "Pedido novo · Pizzaria" no sino (garçom/caixa não o vê; gerência e cozinha sim), imprime na impressora do local, baixa estoque no local do Omie configurado (conferir 1 baixa de teste na loja de teste, sem emitir nota).
  2. Marcar item pronto → garçom vê "Pronto" e toca o som; marcar entregue → aviso "resolvido".
  3. Item além do `prep_time_minutes` → "Atrasado" só para cozinha/gerência; com a aba Produção aberta o sino não repete o som do KDS.
  4. Chamar garçom e pedir conta pelo cardápio do cliente → avisos e som de mesa; sentar sem pedir → **nenhum** aviso.
  5. Derrubar a internet (DevTools offline): avisos ativos continuam, sino mostra "avisos pausados", ao voltar não toca som repetido.
  6. Recarregar a página com avisos ativos: não toca som; "lido" preservado.
  7. Apagar o local com pedido na fila: pedido cai na Cozinha, menu volta a Cozinha/Bar.
  8. Garçom com só permissão de Bar: não vê a aba Pizzaria nem os avisos dela.
  9. Loja `direct_print` e vitrine: sem "Produção", sem avisos de KDS, Configurações não lista tipos de KDS, sem erros no console.
- [ ] **Step 3: QA visual (mesma identidade, sem linguagem nova)** — capturas em **computador (1440 px) e celular (390 px)**, **tema claro e escuro**, de: menu lateral com "Produção" e contador; aba Produção com Cozinha/Bar/Pizzaria; sino fechado (com e sem contador) e painel aberto (vazio, com avisos, resolvidos, offline); seção Notificações em Configurações; aba Locais de preparo (checklist incompleto e completo). Conferir contra uma tela existente do app (ex.: KDS e Configurações): mesmas cores, raios, tipografia, espaçamento e alvos de toque de 44 px; animações curtas (contador conta até o valor, painel abre com o spring do `Modal`, linhas entram com `LIST_ITEM_MOTION`); com "reduzir movimento" ligado nada anima. Qualquer coisa que pareça um componente novo é trocada pelo componente existente.
- [ ] **Step 4: Limpar** — apagar local, categorias vinculadas, pedidos e usuários de teste criados; restaurar `config.notifications` da loja de teste; `git status` limpo.
- [ ] **Step 5: Documentar e commitar** — acrescentar ao `AGENTS.md`: local de preparo = `print_sectors` com `base`; chave `'kitchen'|'bar'|'setor:<id>'`; "Produção" só com setor; central de notificações (regras em `lib/notificacoes.ts`, preferências em `stores.config.notifications`, histórico no localStorage). Commit: `docs: locais de preparo, Produção e notificações`.

---

## Self-review

- **Cobertura do pedido:** local novo vira botão/aba com contador (T2, T5); vínculo com Omie e impressora pedido na criação, com checklist (T1, T7); cartões fora do Cardápio (T7); sino com os 9 tipos, filtro por função, "cliente sentou" removido, preferências e som (T3, T4, T6); lojas sem KDS/impressão direta/vitrine/offline (Review Focus 3-5, T8); restrição de identidade visual e animações existentes (Global Constraints, T5-T8).
- **Placeholders:** nenhum nas libs, no hook e no sino; as edições em `StoreModule.tsx` citam linhas e trazem o código a aplicar.
- **Tipos:** `LocalPreparo`/`chaveLocal`/`listarLocais`/`statusLocal` (T1) usados em T2, T4, T5, T7; `contarPorLocal`/`itemPrecisaAcao`/`abasProducao`/`locaisAcessiveis`/`somaContagens`/`usaMenuProducao`/`producaoAcessivel` (T2) em T4-T5; `EventoNotificacao`/`reconciliar`/`filtrarEventos`/`somDoEvento`/`tempoRelativo`/`TIPOS`/`resolverPrefs`/`tiposAplicaveis` (T3) em T4, T6; `NotificacoesValor` (T4) em T5-T6.
- **Verificação já feita:** as três libs e seus testes foram executados com `npx tsx` fora do repositório e passam (`locaisPreparo: ok`, `producaoNav: ok`, `notificacoes: ok`); o `tsc` do repositório roda no primeiro passo de cada task.
