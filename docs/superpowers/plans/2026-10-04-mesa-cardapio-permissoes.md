# Mesa com pedidos à vista, conferência do cardápio e permissões configuráveis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Ao tocar numa mesa ocupada, o garçom/caixa já vê os pedidos dela, com os botões de adicionar e receber; (2) garantia de que todo o cardápio do Sertão está íntegro e posicionado; (3) um lugar em Administração › Configurações para ligar e desligar, por função (Gerente, Caixa, Garçom), o que cada um pode fazer.

**Architecture:** (1) lista de pedidos dentro da visão rápida do modal da mesa, reaproveitando `getTableSummary`. (2) script de auditoria só de leitura (`scripts/auditoria/cardapio.py`) com a mesma lógica de integridade em funções puras testáveis (`lib/cardapioIntegridade.ts`) usadas também por uma tela de "Saúde do cardápio". (3) `lib/rolePermissions.ts` (puro, com testes) lê `stores.config.role_permissions`; os pontos que hoje checam `role === 'manager'` passam a perguntar `roleCan(user, store, ação)`; padrões reproduzem o comportamento de hoje.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, testes `npx tsx scripts/testes/*.test.ts`, Postgres (consulta de leitura), `stores.config` (jsonb, já existe).

**Spec:** pedido do dono em 04/10/2026 (áudio): "clicar na mesa e ver os pedidos", "garantia de que todos os produtos estão posicionados", "verifique realmente todo o cardápio", "local de configurações com as permissões do gerente", "tudo conectado e configurável".

## Global Constraints

- Português do Brasil na UI. Sem `window.confirm`/`alert` novos.
- Padrões de permissão reproduzem o comportamento atual: Gerente tudo ligado; Caixa e Garçom desligados nas ações de risco (o caixa mantém o que já tem via `permissions.trocas` por usuário).
- Dono e conta universal sempre podem tudo (a matriz não os afeta).
- Autorização continua sendo do app (padrão do projeto), sem novas RPCs.
- Auditoria do cardápio é **somente leitura**: nunca altera produto sem decisão explícita; correções seguras entram como SQL pontual conferido.
- Cada task termina com `npx tsc --noEmit` limpo, testes passando e commit.

## Review Focus

1. **Matriz sem configuração salva** (loja nunca abriu a tela): tudo cai nos padrões, nada quebra. Teste na Task 3.
2. **Configuração salva com chave desconhecida ou valor não booleano**: ignorada, usa o padrão. Teste na Task 3.
3. **Dono e universal nunca perdem poder** mesmo se a matriz tentar desligar. Teste na Task 3.
4. **Mesa com pedido cancelado e itens de taxa**: a lista inline não mostra item cancelado como cobrado e agrupa taxa separada. Teste na Task 1.
5. **Produto sem categoria, categoria vazia, preço zero ou nome duplicado** são achados, não erros silenciosos. Teste na Task 2.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `lib/mesaPedidos.ts` (novo) | `resumirPedidosDaMesa(items)` → linhas e total para a lista inline |
| `lib/cardapioIntegridade.ts` (novo) | `auditarCardapio({categorias, produtos, grupos})` → achados |
| `lib/rolePermissions.ts` (novo) | `ACTIONS`, `DEFAULT_ROLE_PERMS`, `roleCan`, `normalizarMatriz` |
| `components/modules/RolePermissionsView.tsx` (novo) | matriz Gerente/Caixa/Garçom × ações, em Configurações |
| `components/modules/StoreModule.tsx` (editar) | lista inline na mesa; ligar `roleCan` nos pontos de checagem; aba Configurações |
| `scripts/auditoria/cardapio.py` (novo) | auditoria de leitura no servidor (inclui comparação com o Omie via `ListarProdutos`) |

---

### Task 1: Pedidos à vista ao tocar na mesa

**Files:**
- Create: `lib/mesaPedidos.ts`, `scripts/testes/mesaPedidos.test.ts`
- Modify: `components/modules/StoreModule.tsx` (visão rápida do modal da mesa)

**Interfaces:**
- Produces: `interface LinhaPedido { id: string; nome: string; qtd: number; valor: number; status: string; quem: string | null; taxa: boolean }`; `resumirPedidosDaMesa(items: OrderItemLike[]): { linhas: LinhaPedido[]; total: number }` onde `OrderItemLike = { id: string; quantity: number; price_at_time: number; status: string; added_by_name?: string | null; product?: { name?: string; fee_type?: string | null } | null; selected_options?: { name: string }[] | null }`

- [ ] **Step 1: Teste que falha**

```ts
// rodar com: npx tsx scripts/testes/mesaPedidos.test.ts
import assert from 'node:assert/strict';
import { resumirPedidosDaMesa } from '../../lib/mesaPedidos';

const it = (id: string, nome: string, qtd: number, preco: number, status = 'pending', extra: any = {}) =>
  ({ id, quantity: qtd, price_at_time: preco, status, added_by_name: 'ANE', product: { name: nome, fee_type: null }, selected_options: [], ...extra });

const r = resumirPedidosDaMesa([
  it('1', 'Heineken 330ml', 2, 16.9),
  it('2', 'Pizza Tradicional', 1, 104.9, 'preparing', { selected_options: [{ name: 'Grande' }, { name: 'Calabresa' }] }),
  it('3', 'Água 350ml', 1, 5.4, 'canceled'),                                   // Review Focus 4: cancelado não soma
  it('4', 'Taxa de Serviço (10%)', 1, 13.9, 'delivered', { product: { name: 'Taxa de Serviço (10%)', fee_type: 'percent' } }),
]);
assert.equal(r.linhas.length, 4);
assert.equal(r.total, 2 * 16.9 + 104.9 + 13.9, 'cancelado fora do total');
assert.equal(r.linhas[1].nome, 'Pizza Tradicional · Grande, Calabresa', 'opções junto do nome');
assert.equal(r.linhas.find((l) => l.id === '3')!.status, 'canceled');
assert.equal(r.linhas.find((l) => l.id === '4')!.taxa, true);
assert.deepEqual(resumirPedidosDaMesa([]), { linhas: [], total: 0 });
console.log('mesaPedidos: ok');
```

- [ ] **Step 2: Rodar e ver falhar** — `npx tsx scripts/testes/mesaPedidos.test.ts` → `Cannot find module '../../lib/mesaPedidos'`

- [ ] **Step 3: Implementação**

```ts
// lib/mesaPedidos.ts
export interface OrderItemLike {
  id: string; quantity: number; price_at_time: number; status: string; added_by_name?: string | null;
  product?: { name?: string; fee_type?: string | null } | null; selected_options?: { name: string }[] | null;
}
export interface LinhaPedido { id: string; nome: string; qtd: number; valor: number; status: string; quem: string | null; taxa: boolean }

export function resumirPedidosDaMesa(items: OrderItemLike[]): { linhas: LinhaPedido[]; total: number } {
  let cents = 0;
  const linhas = items.map((i) => {
    const opcoes = (i.selected_options ?? []).map((o) => o.name).filter(Boolean).join(', ');
    const base = i.product?.name ?? 'Produto indisponível';
    const valor = Math.round(Number(i.price_at_time) * i.quantity * 100) / 100;
    if (i.status !== 'canceled') cents += Math.round(valor * 100);
    return { id: i.id, nome: opcoes ? `${base} · ${opcoes}` : base, qtd: i.quantity, valor, status: i.status, quem: i.added_by_name ?? null, taxa: !!i.product?.fee_type };
  });
  return { linhas, total: cents / 100 };
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx tsx scripts/testes/mesaPedidos.test.ts && npx tsc --noEmit`

- [ ] **Step 5: Lista na visão rápida da mesa**

Em `StoreModule.tsx`, na `VIEW 1` do modal (`!showFullBill`), para mesa `status !== 'available'`, **antes** da grade de botões, renderizar um bloco "Pedidos da mesa" com `resumirPedidosDaMesa(getTableSummary(selectedTable.id).allItems)`: cada linha mostra quantidade, nome, quem lançou e valor (classe `num`); itens cancelados riscados e fora do total; taxa em linha separada; rodapé "Total R$ …"; estado vazio "Nenhum pedido ainda. Toque em Adicionar Pedido." A lista rola (`max-h-[40vh] overflow-y-auto`) para não empurrar os botões. Os botões "Adicionar Pedido", "Ver Comanda" e "Receber e finalizar" continuam logo abaixo, sempre visíveis.

- [ ] **Step 6: Verificar e commitar** — `npx tsc --noEmit`; `git add lib/mesaPedidos.ts scripts/testes/mesaPedidos.test.ts components/modules/StoreModule.tsx && git commit -m "feat(mesas): pedidos da mesa à vista ao tocar nela, com adicionar e receber logo abaixo"`

---

### Task 2: Conferência de integridade do cardápio

**Files:**
- Create: `lib/cardapioIntegridade.ts`, `scripts/testes/cardapioIntegridade.test.ts`, `scripts/auditoria/cardapio.py`

**Interfaces:**
- Produces: `type Achado = { tipo: 'sem_categoria' | 'categoria_vazia' | 'preco_zero' | 'nome_duplicado' | 'ordem_repetida' | 'grupo_obrigatorio_vazio' | 'sem_codigo_omie'; severidade: 'alta' | 'media' | 'baixa'; texto: string }`; `auditarCardapio(d: { categorias: {id: string; name: string}[]; produtos: {id: string; name: string; price: number; category_id: string | null; available: boolean; order?: number | null; omie_codigo?: string | null; fee_type?: string | null; grupos?: { name: string; required: boolean; opcoes: number }[] }[] }): Achado[]`

- [ ] **Step 1: Teste que falha**

```ts
// rodar com: npx tsx scripts/testes/cardapioIntegridade.test.ts
import assert from 'node:assert/strict';
import { auditarCardapio } from '../../lib/cardapioIntegridade';

const cats = [{ id: 'c1', name: 'Drinks' }, { id: 'c2', name: 'Vazia' }];
const prods: any[] = [
  { id: 'p1', name: 'Caipirinha', price: 24.9, category_id: 'c1', available: true, order: 1, omie_codigo: '90001' },
  { id: 'p2', name: 'Caipirinha', price: 24.9, category_id: 'c1', available: true, order: 2, omie_codigo: '90002' },   // nome duplicado
  { id: 'p3', name: 'Órfão', price: 10, category_id: null, available: true, order: 3, omie_codigo: '90003' },        // sem categoria
  { id: 'p4', name: 'Grátis', price: 0, category_id: 'c1', available: true, order: 4, omie_codigo: '90004' },        // preço zero
  { id: 'p5', name: 'Oculto sem categoria', price: 10, category_id: null, available: false },                          // inativo: ignora
  { id: 'p6', name: 'Com grupo vazio', price: 30, category_id: 'c1', available: true, order: 5, omie_codigo: '90006', grupos: [{ name: 'Tamanho', required: true, opcoes: 0 }] },
  { id: 'p7', name: 'Mesma ordem', price: 5, category_id: 'c1', available: true, order: 5, omie_codigo: '90007' },     // ordem repetida
  { id: 'p8', name: 'Taxa', price: 0, category_id: 'c1', available: true, fee_type: 'percent', order: 6 },            // taxa: preço 0 é normal
];
const tipos = (a: ReturnType<typeof auditarCardapio>) => a.map((x) => x.tipo).sort();
const r = auditarCardapio({ categorias: cats, produtos: prods });
assert.ok(r.some((a) => a.tipo === 'sem_categoria' && a.texto.includes('Órfão')), 'produto sem categoria');
assert.ok(!r.some((a) => a.texto.includes('Oculto sem categoria')), 'inativo não entra');
assert.ok(r.some((a) => a.tipo === 'categoria_vazia' && a.texto.includes('Vazia')), 'categoria sem produto ativo');
assert.ok(r.some((a) => a.tipo === 'preco_zero' && a.texto.includes('Grátis')), 'preço zero');
assert.ok(!r.some((a) => a.tipo === 'preco_zero' && a.texto.includes('Taxa')), 'taxa com preço 0 é normal');
assert.ok(r.some((a) => a.tipo === 'nome_duplicado' && a.texto.includes('Caipirinha')), 'nome duplicado');
assert.ok(r.some((a) => a.tipo === 'grupo_obrigatorio_vazio' && a.severidade === 'alta'), 'grupo obrigatório sem opção bloqueia a venda');
assert.ok(r.some((a) => a.tipo === 'ordem_repetida'), 'duas posições iguais na mesma categoria');
assert.ok(r.some((a) => a.tipo === 'sem_codigo_omie' && a.texto.includes('Com grupo vazio') === false), 'sem código só aparece quando falta mesmo');
assert.deepEqual(tipos(auditarCardapio({ categorias: [], produtos: [] })), []);
console.log('cardapioIntegridade: ok');
```

- [ ] **Step 2: Rodar e ver falhar** (módulo inexistente)

- [ ] **Step 3: Implementação**

```ts
// lib/cardapioIntegridade.ts
export interface Achado { tipo: 'sem_categoria' | 'categoria_vazia' | 'preco_zero' | 'nome_duplicado' | 'ordem_repetida' | 'grupo_obrigatorio_vazio' | 'sem_codigo_omie'; severidade: 'alta' | 'media' | 'baixa'; texto: string }
export interface ProdutoAudit { id: string; name: string; price: number; category_id: string | null; available: boolean; order?: number | null; omie_codigo?: string | null; fee_type?: string | null; grupos?: { name: string; required: boolean; opcoes: number }[] }

export function auditarCardapio(d: { categorias: { id: string; name: string }[]; produtos: ProdutoAudit[] }): Achado[] {
  const out: Achado[] = [];
  const ativos = d.produtos.filter((p) => p.available);
  const norm = (s: string) => s.trim().toLowerCase();

  ativos.filter((p) => !p.category_id).forEach((p) => out.push({ tipo: 'sem_categoria', severidade: 'alta', texto: `"${p.name}" está ativo mas sem categoria (fica em "Sem categoria").` }));
  d.categorias.filter((c) => !ativos.some((p) => p.category_id === c.id)).forEach((c) => out.push({ tipo: 'categoria_vazia', severidade: 'baixa', texto: `A categoria "${c.name}" não tem nenhum produto ativo.` }));
  ativos.filter((p) => !p.fee_type && !(p.grupos?.length) && Number(p.price) <= 0).forEach((p) => out.push({ tipo: 'preco_zero', severidade: 'alta', texto: `"${p.name}" está com preço zero.` }));

  const porNome = new Map<string, ProdutoAudit[]>();
  ativos.forEach((p) => porNome.set(norm(p.name), [...(porNome.get(norm(p.name)) ?? []), p]));
  porNome.forEach((l) => { if (l.length > 1) out.push({ tipo: 'nome_duplicado', severidade: 'media', texto: `Nome repetido: "${l[0].name}" (${l.length} produtos).` }); });

  const porPos = new Map<string, ProdutoAudit[]>();
  ativos.filter((p) => p.order != null).forEach((p) => { const k = `${p.category_id ?? '_'}|${p.order}`; porPos.set(k, [...(porPos.get(k) ?? []), p]); });
  porPos.forEach((l) => { if (l.length > 1) out.push({ tipo: 'ordem_repetida', severidade: 'baixa', texto: `Mesma posição na categoria: ${l.map((p) => `"${p.name}"`).join(', ')}.` }); });

  ativos.forEach((p) => (p.grupos ?? []).filter((g) => g.required && g.opcoes === 0).forEach((g) => out.push({ tipo: 'grupo_obrigatorio_vazio', severidade: 'alta', texto: `"${p.name}": o grupo obrigatório "${g.name}" não tem opções (a venda trava).` })));
  ativos.filter((p) => !p.fee_type && !p.omie_codigo && !(p.grupos?.length)).forEach((p) => out.push({ tipo: 'sem_codigo_omie', severidade: 'media', texto: `"${p.name}" não tem código do Omie (a venda não baixa estoque).` }));
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx tsx scripts/testes/cardapioIntegridade.test.ts && npx tsc --noEmit`

- [ ] **Step 5: Script de auditoria no servidor** (`scripts/auditoria/cardapio.py`, só leitura)

Consulta no `ntb_vendas` (via `docker exec supabase-db psql`) categorias, produtos ativos e grupos de opção do Sertão e aplica as mesmas regras do `auditarCardapio` em Python; **além** disso compara cada código com `ListarProdutos` do Omie (poucas chamadas, sem `ConsultarEstrutura`): nome, preço-base, NCM e produto inativo. Imprime só achados, agrupados por severidade.

- [ ] **Step 6: Rodar no servidor, corrigir só o que for seguro, commitar**

Run: `scp scripts/auditoria/cardapio.py root@185.193.66.240:/tmp/ && ssh root@185.193.66.240 'python3 /tmp/cardapio.py; rm /tmp/cardapio.py'`
Cada achado que for dado de cadastro vira SQL pontual conferido e aplicado uma vez; achado que depende de decisão do dono vai para a lista de perguntas.
Commit: `git add lib/cardapioIntegridade.ts scripts/testes/cardapioIntegridade.test.ts scripts/auditoria/cardapio.py && git commit -m "feat(cardapio): auditoria de integridade (posição, categoria, preço, duplicados, grupos, Omie)"`

---

### Task 3: Permissões configuráveis por função

**Files:**
- Create: `lib/rolePermissions.ts`, `scripts/testes/rolePermissions.test.ts`, `components/modules/RolePermissionsView.tsx`
- Modify: `types/index.ts` (`StoreConfig.role_permissions`), `components/modules/StoreModule.tsx`, `lib/storeModules.ts` (`podeTrocarOuExcluir`)

**Interfaces:**
- Produces:
  - `type RoleKey = 'manager' | 'cashier' | 'waiter'`
  - `type ActionKey = 'cancelar_item' | 'trocar_mesa' | 'mover_item' | 'cancelar_pedido' | 'esgotar' | 'editar_planta' | 'ver_excecoes' | 'editar_cardapio' | 'editar_precos_horario'`
  - `const ACTIONS: { key: ActionKey; label: string; desc: string }[]`
  - `const DEFAULT_ROLE_PERMS: Record<RoleKey, Record<ActionKey, boolean>>`
  - `roleCan(user: { role: string; permissions?: { trocas?: boolean } }, store: { config?: { role_permissions?: unknown } } | null | undefined, action: ActionKey): boolean`
  - `normalizarMatriz(raw: unknown): Record<RoleKey, Record<ActionKey, boolean>>`

- [ ] **Step 1: Teste que falha**

```ts
// rodar com: npx tsx scripts/testes/rolePermissions.test.ts
import assert from 'node:assert/strict';
import { roleCan, normalizarMatriz, DEFAULT_ROLE_PERMS, ACTIONS } from '../../lib/rolePermissions';

const loja = (rp?: unknown) => ({ config: { role_permissions: rp } });
const gerente = { role: 'manager' }, caixa = { role: 'cashier' }, garcom = { role: 'waiter' };

// Review Focus 1: sem configuração salva = padrões de hoje
assert.equal(roleCan(gerente, loja(), 'cancelar_item'), true);
assert.equal(roleCan(garcom, loja(), 'cancelar_item'), false);
assert.equal(roleCan(caixa, null, 'trocar_mesa'), false);
assert.equal(roleCan({ role: 'cashier', permissions: { trocas: true } }, loja(), 'trocar_mesa'), true, 'permissão por usuário "trocas" continua valendo');
assert.equal(roleCan({ role: 'cashier', permissions: { trocas: true } }, loja(), 'esgotar'), false, '"trocas" só vale p/ cancelar/trocar/mover');

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
assert.equal(ACTIONS.length, Object.keys(DEFAULT_ROLE_PERMS.manager).length, 'todas as ações têm padrão para cada função');
console.log('rolePermissions: ok');
```

- [ ] **Step 2: Rodar e ver falhar** (módulo inexistente)

- [ ] **Step 3: Implementação**

```ts
// lib/rolePermissions.ts
export type RoleKey = 'manager' | 'cashier' | 'waiter';
export type ActionKey = 'cancelar_item' | 'trocar_mesa' | 'mover_item' | 'cancelar_pedido' | 'esgotar' | 'editar_planta' | 'ver_excecoes' | 'editar_cardapio' | 'editar_precos_horario';

export const ACTIONS: { key: ActionKey; label: string; desc: string }[] = [
  { key: 'cancelar_item', label: 'Cancelar item da comanda', desc: 'Remove um item já lançado (pede o motivo).' },
  { key: 'trocar_mesa', label: 'Trocar de mesa', desc: 'Move a conta inteira para outra mesa.' },
  { key: 'mover_item', label: 'Mover item para outra mesa', desc: 'Passa só um item para outra mesa, sem reimprimir.' },
  { key: 'cancelar_pedido', label: 'Cancelar o pedido da mesa', desc: 'Cancela todos os itens ainda não pagos.' },
  { key: 'esgotar', label: 'Marcar produto como esgotado', desc: 'Tira o produto do lançamento na hora.' },
  { key: 'editar_planta', label: 'Editar a planta de mesas', desc: 'Posiciona as mesas no mapa.' },
  { key: 'ver_excecoes', label: 'Ver exceções por operador', desc: 'Cancelamentos, taxas editadas, estornos e notas canceladas.' },
  { key: 'editar_cardapio', label: 'Editar o cardápio', desc: 'Produtos, preços, categorias e adicionais.' },
  { key: 'editar_precos_horario', label: 'Editar preço por horário', desc: 'Regras de happy hour.' },
];

const GERENTE: Record<ActionKey, boolean> = { cancelar_item: true, trocar_mesa: true, mover_item: true, cancelar_pedido: true, esgotar: true, editar_planta: true, ver_excecoes: true, editar_cardapio: true, editar_precos_horario: true };
const NADA: Record<ActionKey, boolean> = { cancelar_item: false, trocar_mesa: false, mover_item: false, cancelar_pedido: false, esgotar: false, editar_planta: false, ver_excecoes: false, editar_cardapio: false, editar_precos_horario: false };
export const DEFAULT_ROLE_PERMS: Record<RoleKey, Record<ActionKey, boolean>> = { manager: { ...GERENTE }, cashier: { ...NADA }, waiter: { ...NADA } };

const ROLES: RoleKey[] = ['manager', 'cashier', 'waiter'];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function normalizarMatriz(raw: unknown): Record<RoleKey, Record<ActionKey, boolean>> {
  const out = { manager: { ...DEFAULT_ROLE_PERMS.manager }, cashier: { ...DEFAULT_ROLE_PERMS.cashier }, waiter: { ...DEFAULT_ROLE_PERMS.waiter } };
  if (!isRecord(raw)) return out;
  ROLES.forEach((r) => {
    const linha = raw[r];
    if (!isRecord(linha)) return;
    ACTIONS.forEach((a) => { if (typeof linha[a.key] === 'boolean') out[r][a.key] = linha[a.key] as boolean; });
  });
  return out;
}

// "trocas" (permissão por usuário, 03/10) continua valendo só para as ações de cancelar/trocar/mover.
const COBERTAS_POR_TROCAS: ActionKey[] = ['cancelar_item', 'trocar_mesa', 'mover_item'];

export function roleCan(user: { role: string; permissions?: { trocas?: boolean } }, store: { config?: { role_permissions?: unknown } } | null | undefined, action: ActionKey): boolean {
  if (user.role === 'owner' || user.role === 'universal') return true;
  if (user.role === 'open') return false;
  if (user.permissions?.trocas === true && COBERTAS_POR_TROCAS.includes(action)) return true;
  if (!ROLES.includes(user.role as RoleKey)) return false;
  return normalizarMatriz(store?.config?.role_permissions)[user.role as RoleKey][action];
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx tsx scripts/testes/rolePermissions.test.ts && npx tsc --noEmit`

- [ ] **Step 5: Ligar nos pontos de checagem**

`podeTrocarOuExcluir(user)` em `lib/storeModules.ts` passa a chamar `roleCan(user, store, 'cancelar_item')`; em `StoreModule.tsx`: `handleMoveTable`/botão Trocar → `trocar_mesa`; botão e `abrirMoverItem` → `mover_item`; `podeCancelarPedido` → `cancelar_pedido`; `podeEsgotar` → `esgotar`; `podeEditarPlanta` → `editar_planta`; item "Exceções" do menu e render da aba → `ver_excecoes`; edição de produto/categoria (`MenuManagementView`) → `editar_cardapio`; aba "Preço por horário" → `editar_precos_horario`. Cada checagem recebe `store` do contexto.

- [ ] **Step 6: Tela de configuração**

`RolePermissionsView` em Administração › Configurações: tabela com as ações nas linhas e Gerente, Caixa e Garçom nas colunas, cada célula um interruptor (`role="switch"`, alvo de 44 px no celular); descrição curta sob cada ação; botão "Voltar ao padrão"; nota fixa "Dono e conta universal sempre podem tudo". Só dono/universal editam (gerente vê, desabilitado). Salva com `updateStoreConfig(store.id, { ...config, role_permissions })` e atualiza o estado local da loja (`onStoreUpdate`).

- [ ] **Step 7: Verificar e commitar**

Run: `npx tsc --noEmit && for t in scripts/testes/*.test.ts; do npx tsx "$t" || echo FALHOU $t; done`
Commit: `git add lib types components && git commit -m "feat(permissoes): matriz configurável por função (Gerente, Caixa, Garçom) em Administração › Configurações"`

---

## Self-review

- **Cobertura:** pedidos à vista (T1), conferência do cardápio com achados e correção segura (T2), local de configuração das permissões do gerente e demais funções (T3). Filtros novos (histórico) já entregues em 04/10; a garantia de "produtos posicionados" está na T2.
- **Placeholders:** nenhum nas bibliotecas; as telas descrevem arquivo, componente e comportamento exatos.
- **Tipos:** `ActionKey`/`RoleKey`/`roleCan`/`normalizarMatriz` (T3), `Achado`/`auditarCardapio` (T2), `resumirPedidosDaMesa` (T1) usados com os mesmos nomes.
- **Review Focus:** 1, 2 e 3 em T3; 4 em T1; 5 em T2.

---

# Adendo 2026-10-04 (noite) — escopo ampliado após análise com o dono

Ordem de execução acordada (cada etapa mostra captura nos dois temas antes de seguir; deploy só com a loja fechada; QA em Donana/ZZ, **nunca no Sertão**):

1. **Tema coerente + Pedidos do Dia.**
   - Causa raiz: `Modal` usa por padrão `u-glass-modal on-glass` (globals.css:179), que força tokens escuros fixos; 37 de 39 janelas ficam escuras em tela clara (também no cardápio do cliente: carrinho, status, divisão de conta). Regra nova: só a preferência da pessoa decide claro/escuro; janela sólida, blur só no fundo.
   - "Pedidos do Dia" (StoreModule.tsx ~6026): janela larga (até 1100px), nome completo sem corte, colunas (hora, mesa, qtd/produto, quem lançou, local, estado da impressão), agrupar por mesa ou hora, filtros (local, estado, busca, meus/todos), resumo com falhas em destaque.
2. **Locais de preparo + menu "Produção" + notificações.**
   - Hoje: local novo (setor) só vira filtro dentro de Cozinha/Bar; menu lateral fixo (StoreModule.tsx ~1100); contagem de notificação só kitchen/bar; local do estoque Omie só em Administração → Impressão (lib/setores.ts, `MapaLocaisEstoque`).
   - Novo: cadastro único (nome, base, impressora, local Omie, categorias) com checklist de pendências; item "Produção" com abas por local e contador; sino de notificações por tipo/função/local (chamada, conta, pedido novo, pronto para entregar, atraso, estoque baixo, nota rejeitada, sangria, impressora falhou); remover aviso de "cliente sentou"; ligar/desligar em Configurações.
3. **Mesa com pedidos à vista (Task 1 do plano acima) + planta** (abrir já em grade, "Organizar automaticamente", áreas, cor de status e tempo).
4. **Permissões (Task 3) + Administração em 5 áreas** (Vendas, Caixa, Cardápio, Equipe, Configurações com busca e seções; celular em cartões). Tirar do Cardápio os cartões de Locais de preparo e Integração com Estoque.
5. **Relatório:** Excel com aba "Painel" nas cores do Norte (em andamento: `lib/reports/painelDia.ts` + `fechamentoXlsx.ts`) e PDF A4 pelo diálogo de impressão; no Excel de faturamento do dia e no histórico de vendas.
6. **Auditoria do cardápio (Task 2).**

Perfis de teste: Donana (cozinha+bar+pizzaria, Omie+estoque) e ZZ Laboratório; Sertão só leitura.
