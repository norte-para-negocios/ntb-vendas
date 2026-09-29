# Caixas ao vivo (visão do gerente) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Método escolhido pelo dono ("pode montar"): execução nativa nesta sessão (executing-plans), revisão independente no fim.

**Goal:** O gerente (e dono/universal/quem tem `supervisiona_caixa`) escolhe um operador e vê o caixa dele ao vivo (turno aberto, vendas por forma de pagamento, sangria/suprimento, dinheiro esperado) e o histórico dessa pessoa com o detalhe de cada turno.

**Architecture:** Um componente novo e isolado, `components/modules/CaixasAoVivo.tsx`, monta a tela só com RPCs que já existem (`fetchOpenCashShifts`, `fetchCashShiftsHistory`, `fetchCashShiftSummary`) e atualiza sozinho por dois gatilhos: o ping de pedidos do Realtime (`subscribeToStoreOrderChanges`) e um intervalo de 15 s (sangria/suprimento não geram ping). Ele entra em dois lugares: no topo da aba Caixa (alternância "Meu caixa / Caixas da equipe", só pra quem pode) e no lugar do bloco antigo "Caixa por operador" em Administração → Turnos. Nenhuma migration nova.

**Tech Stack:** Next.js/React 19 + TypeScript, Supabase RPC + Realtime, Tailwind com os tokens `var(--*)` do app, Playwright (verificação ao vivo na loja de laboratório).

**Spec:** conversa de 2026-09-29 ("gerente vê o histórico de cada caixa, cada pessoa, em tempo real, tem uma tela Caixa e seleciona qual caixa quer ver"). Sem arquivo de spec separado.

## Global Constraints

- Textos da interface em português do Brasil; dinheiro sempre `R$ ` + `formatBRL(n)` (`lib/calc.ts`).
- Só usar RPCs existentes; NÃO criar migration (o banco de produção é o Contabo, ver AGENTS.md).
- Testes de escrita só na loja `ZZ Laboratorio (NAO E CLIENTE)` (`f33b4310-ff0a-487c-a3b1-62acd0a58850`); nunca no Sertão. Limpar tudo depois.
- Servidor local de teste sobe SEMPRE com `DISABLE_FISCAL_RETRANSMISSAO=1`.
- Tamanho de celular (390 px) precisa funcionar: alvos de toque ≥ 44 px (`max-sm:h-11`), sem rolagem horizontal da página.
- Quem pode ver a equipe: `role` em `owner|manager|universal` OU `permissions.supervisiona_caixa === true`. Ninguém mais.

## Review Focus

- Operador sem nome (conta universal): `operator_name` nulo aparece como "Conta universal" e continua selecionável.
- Turno aberto há 24 h ou mais: alerta "esqueceu de fechar?", sem quebrar o resto.
- Operador só com histórico (sem turno aberto): mostra "Sem caixa aberto agora" e o histórico, não uma tela vazia.
- Falha de rede numa atualização automática: mantém o último dado na tela, não apaga nem pisca "Carregando".
- Sair da tela com atualização em andamento: nenhuma resposta atrasada escreve estado de componente desmontado; intervalo e canal Realtime são desfeitos.

---

### Task 1: Funções puras (agrupar operadores, tempo aberto, permissão)

**Files:**
- Create: `lib/caixasAoVivo.ts`
- Create: `scripts/testes/caixasAoVivo.test.ts`

**Interfaces:**
- Produces:
  - `type OperadorCaixa = { nome: string; aberto: (CashShift & { operator_name: string | null }) | null; historico: CashShiftHistoryRow[] }`
  - `nomeDoOperador(nome: string | null): string` → `nome?.trim() || 'Conta universal'`
  - `agruparOperadores(abertos, historico): OperadorCaixa[]` — um item por nome; com caixa aberto primeiro, depois ordem alfabética; `historico` de cada um do mais novo pro mais antigo.
  - `tempoAberto(abertoEm: string, agora: number): { horas: number; esquecido: boolean; texto: string }` — `esquecido` quando `horas >= 24`; texto "2 h 05 min", "35 min" ou "1 d 3 h".
  - `podeVerCaixasDaEquipe(user: { role: string; permissions?: Record<string, any> }): boolean`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// scripts/testes/caixasAoVivo.test.ts — rodar com: npx tsx scripts/testes/caixasAoVivo.test.ts
import assert from 'node:assert/strict';
import { agruparOperadores, nomeDoOperador, tempoAberto, podeVerCaixasDaEquipe } from '../../lib/caixasAoVivo';

const aberto = (id: string, nome: string | null, opened_at: string) => ({ id, store_id: 's', operator_user_id: 'u', opened_at, closed_at: null, opening_float: 100, closing_counted_cash: null, closing_cash_breakdown: null, approved_by_user_id: null, status: 'open' as const, notes: null, operator_name: nome });
const hist = (id: string, nome: string | null, opened_at: string) => ({ id, opened_at, closed_at: null, opening_float: 0, closing_counted_cash: null, status: 'closed' as const, notes: null, operator_name: nome, difference: 0 });

assert.equal(nomeDoOperador(null), 'Conta universal');
assert.equal(nomeDoOperador('  '), 'Conta universal');
assert.equal(nomeDoOperador(' Ana '), 'Ana');

const r = agruparOperadores(
  [aberto('a1', 'Zeca', '2026-09-29T10:00:00Z'), aberto('a2', null, '2026-09-29T11:00:00Z')],
  [hist('h1', 'Ana', '2026-09-20T10:00:00Z'), hist('h2', 'Ana', '2026-09-25T10:00:00Z'), hist('h3', 'Zeca', '2026-09-28T10:00:00Z')],
);
assert.deepEqual(r.map(o => o.nome), ['Conta universal', 'Zeca', 'Ana']); // abertos primeiro (alfabético), depois só-histórico
assert.equal(r[2].aberto, null);
assert.deepEqual(r[2].historico.map(h => h.id), ['h2', 'h1']); // mais novo primeiro

const base = Date.parse('2026-09-29T12:05:00Z');
assert.equal(tempoAberto('2026-09-29T12:00:00Z', base).texto, '5 min');
assert.equal(tempoAberto('2026-09-29T10:00:00Z', base).texto, '2 h 05 min');
assert.equal(tempoAberto('2026-09-28T09:05:00Z', base).texto, '1 d 3 h');
assert.equal(tempoAberto('2026-09-28T09:05:00Z', base).esquecido, true);
assert.equal(tempoAberto('2026-09-29T10:00:00Z', base).esquecido, false);

assert.equal(podeVerCaixasDaEquipe({ role: 'owner' }), true);
assert.equal(podeVerCaixasDaEquipe({ role: 'manager' }), true);
assert.equal(podeVerCaixasDaEquipe({ role: 'universal' }), true);
assert.equal(podeVerCaixasDaEquipe({ role: 'waiter', permissions: { supervisiona_caixa: true } }), true);
assert.equal(podeVerCaixasDaEquipe({ role: 'waiter', permissions: { caixa: true } }), false);
assert.equal(podeVerCaixasDaEquipe({ role: 'waiter' }), false);
console.log('ok');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx scripts/testes/caixasAoVivo.test.ts`
Expected: FAIL (módulo `lib/caixasAoVivo` não existe)

- [ ] **Step 3: Implementar**

```ts
// lib/caixasAoVivo.ts
import type { CashShift, CashShiftHistoryRow } from '@/lib/api';

export type CaixaAberto = CashShift & { operator_name: string | null };
export type OperadorCaixa = { nome: string; aberto: CaixaAberto | null; historico: CashShiftHistoryRow[] };

export const nomeDoOperador = (nome: string | null | undefined): string => nome?.trim() || 'Conta universal';

export function agruparOperadores(abertos: CaixaAberto[], historico: CashShiftHistoryRow[]): OperadorCaixa[] {
  const mapa = new Map<string, OperadorCaixa>();
  const pegar = (nome: string) => {
    let o = mapa.get(nome);
    if (!o) { o = { nome, aberto: null, historico: [] }; mapa.set(nome, o); }
    return o;
  };
  abertos.forEach((s) => { pegar(nomeDoOperador(s.operator_name)).aberto = s; });
  historico.forEach((h) => { pegar(nomeDoOperador(h.operator_name)).historico.push(h); });
  mapa.forEach((o) => o.historico.sort((a, b) => b.opened_at.localeCompare(a.opened_at)));
  return [...mapa.values()].sort((a, b) => {
    if (!!a.aberto !== !!b.aberto) return a.aberto ? -1 : 1;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });
}

export function tempoAberto(abertoEm: string, agora: number): { horas: number; esquecido: boolean; texto: string } {
  const min = Math.max(0, Math.floor((agora - new Date(abertoEm).getTime()) / 60000));
  const horas = Math.floor(min / 60);
  let texto: string;
  if (horas >= 24) texto = `${Math.floor(horas / 24)} d ${horas % 24} h`;
  else if (horas >= 1) texto = `${horas} h ${String(min % 60).padStart(2, '0')} min`;
  else texto = `${min} min`;
  return { horas, esquecido: horas >= 24, texto };
}

export function podeVerCaixasDaEquipe(user: { role: string; permissions?: Record<string, any> }): boolean {
  return user.role === 'owner' || user.role === 'manager' || user.role === 'universal' || user.permissions?.supervisiona_caixa === true;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx scripts/testes/caixasAoVivo.test.ts`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add lib/caixasAoVivo.ts scripts/testes/caixasAoVivo.test.ts
git commit -m "Caixas ao vivo: funções puras (agrupar operadores, tempo aberto, permissão)"
```

---

### Task 2: Componente `CaixasAoVivo` (seletor, turno ao vivo, histórico com detalhe)

**Files:**
- Create: `components/modules/CaixasAoVivo.tsx`

**Interfaces:**
- Consumes: `agruparOperadores`, `tempoAberto`, `OperadorCaixa` (Task 1); `fetchOpenCashShifts(storeId)`, `fetchCashShiftsHistory(storeId, limit)`, `fetchCashShiftSummary(shiftId)`, `subscribeToStoreOrderChanges(storeId, onChange, undefined, channelKey)` de `@/lib/api`; `formatBRL` de `@/lib/calc`; `getPaymentMethodLabel` de `@/lib/labels`.
- Produces: `export const CaixasAoVivo: React.FC<{ storeId: string }>`.

- [ ] **Step 1: Implementar o componente**

Comportamento (todo em um arquivo):
1. `carregar()` busca abertos + histórico (100) em paralelo, guarda no estado e `atualizadoEm = Date.now()`. Falha de rede mantém o dado anterior. Usa `ativoRef` pra ignorar resposta depois de desmontar.
2. Gatilhos: `subscribeToStoreOrderChanges(storeId, () => carregar(true), undefined, 'caixas_ao_vivo')` (com debounce de 1 s) + `setInterval(carregar, 15000)`; ambos desfeitos no cleanup.
3. Seletor de operadores em chips (verde = aberto). Primeiro operador é selecionado por padrão; se o selecionado sumir da lista, volta ao primeiro.
4. Painel "Turno de <nome>": se `aberto`, busca `fetchCashShiftSummary(aberto.id)` a cada `carregar` e mostra: aberto há X (alerta se esquecido), fundo, total por forma de pagamento, sangria, suprimento, dinheiro esperado. Se não tem aberto: "Sem caixa aberto agora."
5. Histórico do operador: linhas (data, situação, diferença colorida); tocar numa linha abre/fecha o mesmo resumo (`fetchCashShiftSummary(h.id)`), com contado e diferença.
6. Rodapé discreto: "Ao vivo · atualizado às HH:MM:SS".

- [ ] **Step 2: Checagem de tipos**

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 3: Commit**

```bash
git add components/modules/CaixasAoVivo.tsx
git commit -m "Caixas ao vivo: componente com seletor de operador, turno em tempo real e histórico com detalhe"
```

---

### Task 3: Ligar na tela Caixa e em Administração → Turnos

**Files:**
- Modify: `components/modules/StoreModule.tsx` — `CaixaView` (alternância no topo) e o bloco `activeTab === 'shifts'` "Caixa por operador" (~linha 11037)

**Interfaces:**
- Consumes: `CaixasAoVivo`, `podeVerCaixasDaEquipe` (Tasks 1–2).

- [ ] **Step 1:** importar `CaixasAoVivo` e `podeVerCaixasDaEquipe`.
- [ ] **Step 2:** em `CaixaView`, estado `visao: 'meu' | 'equipe'` (padrão `'meu'`); se `podeVerCaixasDaEquipe(loggedUser)`, renderizar no topo um `SegmentedControl` "Meu caixa / Caixas da equipe"; com `'equipe'` renderiza `<CaixasAoVivo storeId={storeId} />` no lugar do conteúdo normal. Quem não pode não vê o controle.
- [ ] **Step 3:** em Administração → Turnos, trocar o bloco "Caixa por operador" (lista de abertos + chips de histórico) por `<CaixasAoVivo storeId={storeId} />`, e remover os estados/efeito que só ele usava (`openCashShiftsAll`, `cashShiftsHistoryAll`, `isLoadingCashShiftsAll`, `selectedOperatorHistory` e o `useEffect` que os carrega) se nada mais os usar.
- [ ] **Step 4:** `npx tsc --noEmit` sem erros; commit.

```bash
git add components/modules/StoreModule.tsx
git commit -m "Caixas ao vivo: alternância na aba Caixa e substituição do bloco antigo em Administração → Turnos"
```

---

### Task 4: Verificação ao vivo (gerente de teste, celular, tempo real) e entrega

**Files:** nenhum arquivo do app; script temporário em scratchpad.

- [ ] **Step 1:** criar usuário de teste na loja ZZ (`role='manager'`, `permissions` com `caixa: true`) por SQL no Contabo; subir `next dev -p 3100` com `DISABLE_FISCAL_RETRANSMISSAO=1`.
- [ ] **Step 2:** Playwright em 390×844: login como gerente → aba Caixa → aparece "Caixas da equipe" → abrir → chips mostram "QA Caixa" (aberto) → painel mostra fundo, total por forma de pagamento e dinheiro esperado.
- [ ] **Step 3 (tempo real):** com a tela aberta, inserir por SQL uma sangria de R$ 10 no turno aberto da ZZ; em até 20 s o "dinheiro esperado" cai R$ 10 sem recarregar.
- [ ] **Step 4:** tocar numa linha do histórico → detalhe abre; login como garçom (sem permissão) → NÃO existe o controle "Caixas da equipe".
- [ ] **Step 5:** limpar: apagar a sangria, o usuário gerente de teste; parar o servidor local.
- [ ] **Step 6:** push, deploy do Vendas (`/opt/ntb-vendas/deploy.sh`), bump `desktop/package.json` (1.2.58), `npm run dist`, `desktop/scripts/publish.sh`, commit; reconstruir o APK com versionCode 3 / 1.0.2, `mobile/scripts/publish-android.sh`, commit.
