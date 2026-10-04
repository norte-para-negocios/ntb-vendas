# Backlog geral (análises, drill-down, fichas técnicas, desfazer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o que sobrou da conversa de 03–04/10: análise de vendas agrupada, conferência de turno com drill-down, auditoria das fichas técnicas contra o Omie, "Desfazer" nas ações reversíveis e uma decisão registrada sobre a conta universal.

**Architecture:** Lógica pura em `lib/reports/*` com teste antes (agrupamento, vendas de um turno); telas finas em `ReportsView`; auditoria de fichas como script de leitura que roda no servidor (tem as chaves do Omie) e não grava nada; `Desfazer` como extensão do `toast` existente.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, testes `npx tsx scripts/testes/*.test.ts` com `node:assert/strict`, Omie `v1/geral/malha ConsultarEstrutura` (só leitura).

**Spec:** `docs/plans/2026-10-04-proximas-features.md` e `docs/superpowers/plans/2026-10-04-relatorios-excel-filtros.md` (itens "fora desta rodada").

## Global Constraints

- Português do Brasil na UI. Nada de `window.confirm`/`alert` em fluxo novo (usar estado na tela).
- Nunca escrever no Omie nem no banco do Sertão nos scripts de auditoria: só leitura.
- Fuso do restaurante fixo em `America/Bahia` (UTC-3, sem horário de verão), via `localDayAndMinutes` de `lib/priceSchedule.ts`.
- Venda de uma conta com vários pedidos conta **uma vez** (mesmo pagamento) nos totais.
- Cada task termina com `npx tsc --noEmit` limpo, os testes da task passando e um commit.

## Review Focus

1. **Conta com 2+ pedidos e o mesmo pagamento** não pode inflar o total do agrupamento nem do turno (mesmo bug do fechamento, corrigido na 147). Teste na Task 1.
2. **Venda fora de qualquer turno** (sem `cash_shift_id`) não aparece como se fosse de um turno. Teste na Task 2.
3. **Produto sem código do Omie** não é "sem ficha técnica": é "sem vínculo" e vai em lista separada. Verificado na Task 3.
4. **Desfazer depois que outra pessoa já mexeu** (item já movido de novo, produto já reativado) não pode sobrescrever; falha com aviso. Teste na Task 4.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `lib/reports/groupSales.ts` (novo) | `groupSales(orders, by)` → linhas com total, pedidos e ticket |
| `lib/reports/shiftSales.ts` (novo) | `salesOfShift(orders, shiftId, method?)` |
| `scripts/auditoria/fichas-tecnicas.py` (novo) | lê Omie e lista produtos sem estrutura |
| `components/Toast.tsx` (editar) | `toast.undo(msg, label, onUndo)` |
| `components/modules/ReportsView.tsx` (editar) | seções "Análise de vendas" e "Conferir um turno" |
| `docs/decisoes/2026-10-04-conta-universal.md` (novo) | decisão e perguntas em aberto |

---

### Task 1: Análise de vendas agrupada (por hora, operador, categoria)

**Files:**
- Create: `lib/reports/groupSales.ts`
- Test: `scripts/testes/groupSales.test.ts`
- Modify: `components/modules/ReportsView.tsx`

**Interfaces:**
- Produces: `type GroupBy = 'hour' | 'operator' | 'category' | 'method'`; `interface GroupRow { key: string; label: string; total: number; orders: number; ticket: number }`; `groupSales(orders: Order[], by: GroupBy): GroupRow[]` (ordenado: hora crescente; demais por total decrescente)

- [ ] **Step 1: Teste que falha**

```ts
// rodar com: npx tsx scripts/testes/groupSales.test.ts
import assert from 'node:assert/strict';
import { groupSales } from '../../lib/reports/groupSales';

const pd = (op: string, amount: number, method = 'PIX') => ({ operador_nome: op, methods: [{ method, amount }] });
const o = (id: string, iso: string, extra: any = {}) => ({ id, table_id: id, status: 'delivered', order_type: 'table', total: 100, created_at: iso, order_items: [], payment_details: pd('Claudia', 110), ...extra });

const orders: any[] = [
  o('a', '2026-10-03T22:10:00Z'),                                        // 19h BRT
  o('b', '2026-10-03T22:50:00Z', { payment_details: pd('Renato', 55) }),  // 19h BRT
  o('c', '2026-10-04T02:30:00Z', { payment_details: pd('Claudia', 220, 'CREDIT') }), // 23h BRT
  o('x', '2026-10-03T22:10:00Z', { status: 'canceled' }),                 // cancelada fora
];

const hora = groupSales(orders, 'hour');
assert.deepEqual(hora.map((r) => r.label), ['19h', '23h']);
assert.equal(hora[0].orders, 2);
assert.equal(hora[0].total, 165);
assert.equal(hora[0].ticket, 82.5);

const op = groupSales(orders, 'operator');
assert.deepEqual(op.map((r) => [r.label, r.total]), [['Claudia', 330], ['Renato', 55]]);

const forma = groupSales(orders, 'method');
assert.equal(forma.find((r) => r.label === 'Crédito')!.total, 220);

// Review Focus 1: conta com 2 pedidos e o MESMO pagamento conta uma vez
const dupla: any[] = [
  o('p1', '2026-10-03T22:10:00Z', { table_id: 't', payment_details: pd('Claudia', 487.08) }),
  o('p2', '2026-10-03T22:10:01Z', { table_id: 't', payment_details: pd('Claudia', 487.08) }),
];
const d = groupSales(dupla, 'operator');
assert.equal(d[0].total, 487.08);
assert.equal(d[0].orders, 1, 'a conta é uma venda só');

// categoria: soma pelos itens ativos
const cat = groupSales([o('k', '2026-10-03T22:10:00Z', { order_items: [
  { quantity: 2, price_at_time: 10, status: 'delivered', product: { category_id: 'c1' } },
  { quantity: 1, price_at_time: 30, status: 'canceled', product: { category_id: 'c1' } },
  { quantity: 1, price_at_time: 5, status: 'delivered', product: { category_id: null } },
] }) as any], 'category');
assert.equal(cat.find((r) => r.key === 'c1')!.total, 20, 'item cancelado não entra');
assert.equal(cat.find((r) => r.key === '_sem')!.label, 'Sem categoria');
console.log('groupSales: ok');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas" && npx tsx scripts/testes/groupSales.test.ts`
Expected: FAIL com "Cannot find module '../../lib/reports/groupSales'"

- [ ] **Step 3: Implementação**

```ts
// lib/reports/groupSales.ts
import type { Order } from '@/types';
import { getPaymentMethodLabel } from '../labels';
import { localDayAndMinutes } from '../priceSchedule';

export type GroupBy = 'hour' | 'operator' | 'category' | 'method';
export interface GroupRow { key: string; label: string; total: number; orders: number; ticket: number }

type Pd = { operador_nome?: string; methods?: { method: string; amount: number }[] } | null;
const receivedOf = (o: Order): number => {
  const m = (o.payment_details as Pd)?.methods;
  return Array.isArray(m) ? m.reduce((s, x) => s + Number(x.amount), 0) : 0;
};

export function groupSales(orders: Order[], by: GroupBy): GroupRow[] {
  const acc = new Map<string, { label: string; cents: number; orders: number }>();
  const add = (key: string, label: string, value: number, count: number) => {
    const cur = acc.get(key) ?? { label, cents: 0, orders: 0 };
    cur.cents += Math.round(value * 100);
    cur.orders += count;
    acc.set(key, cur);
  };

  // Uma conta (mesa/pedido + mesmo pagamento) conta uma vez, mesmo com vários pedidos.
  const seen = new Set<string>();
  orders.filter((o) => o.status !== 'canceled').forEach((o) => {
    if (by === 'category') {
      (o.order_items ?? []).filter((i) => i.status !== ('canceled' as never)).forEach((i) => {
        const cid = i.product?.category_id ?? '_sem';
        add(cid, cid === '_sem' ? 'Sem categoria' : cid, Number(i.price_at_time) * i.quantity, 0);
      });
      return;
    }
    const pd = o.payment_details as Pd;
    const conta = `${o.table_id ?? o.id}|${JSON.stringify(pd?.methods ?? [])}`;
    if (seen.has(conta)) return;
    seen.add(conta);
    const valor = receivedOf(o);
    if (by === 'hour') {
      const h = Math.floor(localDayAndMinutes(new Date(o.created_at), 'America/Bahia').minutes / 60);
      add(String(h).padStart(2, '0'), `${h}h`, valor, 1);
    } else if (by === 'operator') {
      const nome = pd?.operador_nome || 'Sem operador';
      add(nome, nome, valor, 1);
    } else {
      (pd?.methods ?? []).forEach((m) => add(m.method, getPaymentMethodLabel(m.method), Number(m.amount), 1));
    }
  });

  const rows: GroupRow[] = Array.from(acc.entries()).map(([key, v]) => {
    const total = v.cents / 100;
    return { key, label: v.label, total, orders: v.orders, ticket: v.orders > 0 ? Math.round((total / v.orders) * 100) / 100 : 0 };
  });
  return by === 'hour' ? rows.sort((a, b) => a.key.localeCompare(b.key)) : rows.sort((a, b) => b.total - a.total);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx scripts/testes/groupSales.test.ts && npx tsc --noEmit`
Expected: `groupSales: ok` e tsc sem saída

- [ ] **Step 5: Tela em `ReportsView`**

Acrescentar abaixo do card do Excel um segundo `Card` "Análise de vendas": seletor de dia (reusa `dia`), seletor "Agrupar por" (Hora, Operador, Forma de pagamento), botão "Ver", e uma tabela com `label`, `total` (R$), `orders` e `ticket` usando a classe `num`. Dados: `fetchSalesHistory(storeId, ini.toISOString(), fim.toISOString())` e `groupSales(vendas, by)`. Estado vazio: "Nenhuma venda nesse dia."

- [ ] **Step 6: Verificar e commitar**

Run: `npx tsc --noEmit`
Commit: `git add lib/reports/groupSales.ts scripts/testes/groupSales.test.ts components/modules/ReportsView.tsx && git commit -m "feat(relatorios): análise de vendas agrupada por hora, operador e forma de pagamento"`

---

### Task 2: Conferir um turno com drill-down

**Files:**
- Create: `lib/reports/shiftSales.ts`
- Test: `scripts/testes/shiftSales.test.ts`
- Modify: `components/modules/ReportsView.tsx`

**Interfaces:**
- Produces: `salesOfShift(orders: Order[], shiftId: string, method?: string): Order[]` (pedidos cujo `payment_details.cash_shift_id === shiftId`, opcionalmente só com aquela forma)

- [ ] **Step 1: Teste que falha**

```ts
// rodar com: npx tsx scripts/testes/shiftSales.test.ts
import assert from 'node:assert/strict';
import { salesOfShift } from '../../lib/reports/shiftSales';

const o = (id: string, pd: any) => ({ id, status: 'delivered', order_type: 'table', total: 10, created_at: '2026-10-03T22:00:00Z', payment_details: pd }) as any;
const orders = [
  o('a', { cash_shift_id: 'S1', methods: [{ method: 'PIX', amount: 10 }] }),
  o('b', { cash_shift_id: 'S1', methods: [{ method: 'CREDIT', amount: 10 }] }),
  o('c', { cash_shift_id: 'S2', methods: [{ method: 'PIX', amount: 10 }] }),
  o('d', null),                                  // Review Focus 2: sem turno
  o('e', { methods: [{ method: 'PIX', amount: 10 }] }), // sem cash_shift_id
];
assert.deepEqual(salesOfShift(orders, 'S1').map((x) => x.id), ['a', 'b']);
assert.deepEqual(salesOfShift(orders, 'S1', 'PIX').map((x) => x.id), ['a']);
assert.deepEqual(salesOfShift(orders, 'S9').map((x) => x.id), []);
assert.equal(salesOfShift(orders, '').length, 0, 'turno vazio não casa com pedido sem turno');
console.log('shiftSales: ok');
```

- [ ] **Step 2: Rodar e ver falhar** (`Cannot find module`)

- [ ] **Step 3: Implementação**

```ts
// lib/reports/shiftSales.ts
import type { Order } from '@/types';

export function salesOfShift(orders: Order[], shiftId: string, method?: string): Order[] {
  if (!shiftId) return [];
  return orders.filter((o) => {
    const pd = o.payment_details as { cash_shift_id?: string; methods?: { method: string }[] } | null;
    if (pd?.cash_shift_id !== shiftId) return false;
    return !method || (Array.isArray(pd.methods) && pd.methods.some((m) => m.method === method));
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx scripts/testes/shiftSales.test.ts && npx tsc --noEmit`

- [ ] **Step 5: Tela**

Em `ReportsView`, card "Conferir um turno": lista os turnos do dia (já carregados por `fetchCashShiftsHistory`); ao tocar num turno, mostra as formas (`completarFormas`) e cartões (`completarCartoes`) do `fetchCashShiftSummary`; ao tocar numa forma, lista as vendas (`salesOfShift(vendas, turno.id, forma)`) com mesa, hora (`horaBahia` não, usar `toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia' })`), operador e valor recebido.

- [ ] **Step 6: Commit**

`git add lib/reports/shiftSales.ts scripts/testes/shiftSales.test.ts components/modules/ReportsView.tsx && git commit -m "feat(relatorios): conferir um turno com drill-down da forma de pagamento até as vendas"`

---

### Task 3: Auditoria das fichas técnicas contra o Omie

**Files:**
- Create: `scripts/auditoria/fichas-tecnicas.py`

**Interfaces:** nenhuma (script de leitura que imprime um relatório).

- [ ] **Step 1: Escrever o script**

Lê as chaves do Omie da loja 4 do estoque (sem imprimir), lista os produtos ativos do Sertão com `omie_codigo` (e as opções com código), resolve o id interno via `ListarProdutos` e chama `v1/geral/malha ConsultarEstrutura {idProduto}` com pausa de 400 ms. Classifica: **com estrutura**, **sem estrutura** (faultcode 103 ou vazia), **sem vínculo** (sem `omie_codigo`), **taxa** (`fee_type` não nulo, ignorada). Imprime só contagens e os nomes dos sem estrutura. Nunca escreve.

- [ ] **Step 2: Rodar no servidor**

Run: `scp scripts/auditoria/fichas-tecnicas.py root@185.193.66.240:/tmp/ && ssh root@185.193.66.240 'python3 /tmp/fichas-tecnicas.py; rm /tmp/fichas-tecnicas.py'`
Expected: contagens e a lista de produtos sem estrutura

- [ ] **Step 3: Commit**

`git add scripts/auditoria/fichas-tecnicas.py && git commit -m "chore(auditoria): script de leitura que lista produtos sem ficha técnica no Omie"`

---

### Task 4: "Desfazer" nas ações reversíveis

**Files:**
- Modify: `components/Toast.tsx` (novo `toast.undo`)
- Modify: `components/modules/StoreModule.tsx` (esgotar e mover item)
- Test: `scripts/testes/undoGuard.test.ts` + `lib/undoGuard.ts`

**Interfaces:**
- Produces: `toast.undo(message: string, label: string, onUndo: () => void | Promise<void>, ms?: number): void`; `canUndo(expected: string, current: string): boolean` em `lib/undoGuard.ts` (só desfaz se o estado atual ainda é o que a ação deixou).

- [ ] **Step 1: Teste que falha**

```ts
// rodar com: npx tsx scripts/testes/undoGuard.test.ts
import assert from 'node:assert/strict';
import { canUndo } from '../../lib/undoGuard';

assert.equal(canUndo('mesa-B', 'mesa-B'), true, 'item ainda está onde a ação deixou');
assert.equal(canUndo('mesa-B', 'mesa-C'), false, 'Review Focus 4: outra pessoa já moveu de novo');
assert.equal(canUndo('esgotado', 'disponivel'), false, 'alguém já reativou');
console.log('undoGuard: ok');
```

- [ ] **Step 2: Rodar e ver falhar; Step 3: implementar**

```ts
// lib/undoGuard.ts
// Desfazer só vale se o estado atual ainda é o que a própria ação deixou; senão alguém mexeu depois.
export const canUndo = (expected: string, current: string): boolean => expected === current;
```

- [ ] **Step 4: `toast.undo`**: botão "Desfazer" dentro do toast, 8 s, chama `onUndo` uma vez e fecha. Em **Esgotar**: antes de desfazer, relê `fetchMenu` do produto e usa `canUndo(String(novo), String(!!atual.sold_out))`. Em **Mover item**: `Desfazer` chama `transferItems` de volta pra mesa de origem, só se o item ainda estiver na mesa de destino.

- [ ] **Step 5: Verificar e commitar**

Run: `npx tsc --noEmit && for t in scripts/testes/*.test.ts; do npx tsx "$t" || echo FALHOU $t; done`
Commit: `git commit -am "feat(ux): Desfazer em esgotar produto e mover item, com guarda contra mudança de outra pessoa"`

---

### Task 5: Conta universal — decisão registrada

**Files:**
- Create: `docs/decisoes/2026-10-04-conta-universal.md`

- [ ] **Step 1: Registrar** o que se sabe (a conta "Equipe Norte Para Negócios" aparece na auditoria de uma loja em produção; hoje ela pode tudo), as três opções (A: modo só leitura em loja de cliente; B: exigir motivo e aprovação para ações de caixa; C: deixar como está e só auditar) e a pergunta ao dono: qual das três, e se a equipe ainda precisa lançar/receber em produção. **Nenhuma mudança de código** até a resposta.
- [ ] **Step 2: Commit** `git add docs/decisoes && git commit -m "docs: decisão pendente sobre a conta universal em produção"`

---

## Self-review

- **Cobertura:** análises agrupadas (T1), drill-down (T2), fichas técnicas (T3), desfazer (T4), conta universal (T5). Fora por decisão explícita: envio automático por e-mail/WhatsApp (precisa de aprovação do dono antes de mandar qualquer mensagem a cliente), Pix e iFood (descartados).
- **Placeholders:** nenhum nas bibliotecas; as telas (T1/T2) e o script (T3) estão descritos por comportamento e arquivos exatos porque seguem padrões já presentes em `ReportsView`.
- **Tipos:** `GroupBy`/`GroupRow`/`groupSales` (T1), `salesOfShift` (T2), `canUndo` (T4) usados com os mesmos nomes nas tasks que os consomem.
- **Review Focus:** 1 em T1, 2 em T2, 3 em T3, 4 em T4.
