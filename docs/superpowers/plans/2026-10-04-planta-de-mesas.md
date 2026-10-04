# Planta de mesas que o dono entende — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A aba "Mapa" de Gestão de Mesas nunca abre vazia: as mesas já aparecem arrumadas em grade (por área, com rolagem quando são centenas), o gerente organiza com um toque e arrasta com encaixe, e qualquer pessoa entende o que está vendo.

**Architecture:** Toda a conta de posição vira lógica pura em `lib/planta.ts` (grade, preservar posições salvas, encaixe, troca ao soltar, rótulos de área, lotes), testada com `npx tsx`. O mapa mostra a posição salva ou, na falta dela, uma posição automática calculada na hora (nada é gravado até alguém salvar). A gravação passa a ser em lote por uma RPC `security definer` nova (migration 154, aditiva) com fallback para a RPC antiga se o banco ainda não a tem. `FloorPlanView.tsx` é reescrito em cima dessa lib, mantendo o visual atual (mesmo botão-mesa, mesmos tokens); a bandeja "Sem posição" some. As mesas se movem com a mola que o app já usa (`SPRING_UI`): ao organizar, cada mesa desliza e assenta no quadradinho.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4 (tokens), Supabase self-hosted (`ntb_vendas`, PostgREST `rest-vendas`), testes `npx tsx scripts/testes/*.test.ts` + `node:assert`.

**Restrição de design:** manter a identidade atual do app (sem redesign) e reaproveitar as animações existentes; ver Global Constraints.

**Spec:** conversa de 04/10/2026 com o dono ("o que é isso aqui, nem uma mesa dessa planta? … como é que funciona isso? … melhore um pouquinho"). Contexto lido: `components/modules/FloorPlanView.tsx` (mapa só desenha mesas com `floor_x/floor_y`; estado vazio na linha ~149; bandeja "Sem posição" só com `editing`, linhas ~158-173; soltar fora do mapa = tirar da planta), `components/modules/StoreModule.tsx:4895-4960` (`infoDaMesa`, `podeEditarPlanta`, `moverNaPlanta`, abas Lista/Mapa; padrão `tablesViewMode` em ~3056 guardado em `localStorage('tables_view_mode')`, default `'lista'`), `lib/api.ts:972` (`updateTablePosition`), `supabase/migrations/149_posicao_mesa_planta.sql` (RPC de 1 mesa, x/y em % 0–100), `supabase/migrations/142_sete_features_schema.sql:15` (colunas), `supabase/migrations/030_fecha_rls_tables.sql:58` (`get_tables_secure` devolve `row_to_json(t)` da linha inteira, então coluna nova chega sozinha), `types/index.ts:167` (`Table`).

## Decisões (com o porquê)

- **Lista continua sendo o padrão.** Motivos: o garçom usa celular; o Sertão tem 493 mesas livres (mapa de 500 pontos é ruído); a lista já põe as ocupadas no topo. O Mapa vira opção que o aparelho lembra (já existe). Com mais de 60 mesas o Mapa abre com "Só ocupadas" ligado.
- **Mapa nunca vazio:** mesa sem posição salva aparece em posição automática (não gravada). Só grava quando o gerente toca em "Posicionar as que faltam", em "Organizar automaticamente" ou arrasta uma mesa.
- **Áreas = coluna nova `tables.area text` (nullable), não prefixo.** A mesa só tem `number` (inteiro); não há nome nem texto onde pôr um prefixo ("S-12") sem quebrar impressão, KDS, PIN e relatórios que usam o número. Coluna nullable é aditiva, o `row_to_json` já a entrega, e `null` = sem área (comportamento de hoje). A área é atribuída por faixa ("mesas 1 a 20 → Salão"), porque cadastrar 500 mesas uma a uma é inviável.
- **Gravação em lote** (RPC nova) em vez de 500 chamadas da RPC antiga; lote máximo 200 e o app divide em lotes. Fallback para a RPC antiga (erro `PGRST202`) deixa o app novo subir antes da migration.
- **Soltar fora do mapa não tira mais a mesa da planta** (não faz sentido se o mapa sempre mostra todas); só cancela o arrasto. Soltar em cima de outra mesa **troca** as duas de lugar.
- **Mapa com rolagem** quando há muitas mesas: o canvas continua em proporção 16:10 e em porcentagem (as posições salvas continuam válidas em qualquer tela), mas ganha largura mínima em pixels (`larguraMinimaPx`) para cada célula ter ≥ 56 px (alvo de toque 44 px + respiro).

- **Movimento (só o que já existe no app):** cada mesa é um `motion.button`; ao mudar `left/top` (organizar, trocar, encaixar) ela anima com `SPRING_UI` e, ao organizar, entra com `stagger` curto (≈ 6 ms por mesa, teto de 300 ms no total, para 500 mesas não virar espera) — "assentando na grade". Arrastando, a mesa segue o dedo sem mola (instantâneo) e só assenta ao soltar; na troca, a outra mesa desliza para o lugar vazio. Toque = `whileTap` com `SPRING_TAP` (igual aos botões do app). Painel de edição e dica entram/saem com fade curto dentro de `AnimatePresence`, como as outras janelas. Com `prefers-reduced-motion`, nada se move: posição vai direto.

## Global Constraints

- **NÃO é redesign (restrição do dono, 04/10).** A planta tem que parecer parte do app atual: mesmos tokens (`var(--surface)`, `--brand`, `--brand-fill`, `--border`…), mesmos componentes e classes (`components/ui.tsx`, `u-press`, `u-motion`, `eyebrow`, `num`) e **nenhuma linguagem visual nova** (nada de cor, sombra, fonte, ícone ou forma que o app não use hoje). As animações reaproveitam as que já existem: `motion/react` com `SPRING_UI`/`SPRING_SHEET`/`SPRING_TAP` de `lib/motion.ts` e as classes `u-motion`/`u-press`. Animação curta (cada uma ≤ ~300 ms de percepção), só `transform`/`opacity` onde der, e **respeita `prefers-reduced-motion`** (`useReducedMotion` do `motion/react`: sem ele, a mesa vai direto ao lugar).
- Português do Brasil na UI, sem `window.confirm`/`alert`. Tokens de tema (`var(--surface)` etc.), sem cores fixas: o mapa precisa funcionar nos dois temas.
- Alvo de toque ≥ 44 px (`max-sm:h-11` onde já for o padrão da base).
- Autorização continua sendo do app + `store_id` como limite de confiança na RPC (padrão do projeto, sem Supabase Auth). Só dono, gerente e conta universal editam a planta (`podeEditarPlanta`); a matriz de permissões do plano `2026-10-04-mesa-cardapio-permissoes.md` (Task 3) passa a decidir isso quando existir.
- Migration só aditiva (`IF NOT EXISTS`, `CREATE OR REPLACE` de função nova); nada de `DROP`. Aplicar manualmente com `docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas < arquivo.sql` + `NOTIFY pgrst, 'reload schema'`, **só com a loja fechada** (regra do dono).
- **QA somente em loja de teste (Donana ou ZZ Laboratório). NUNCA em "O Sertão Vai Virar Mar"**, que está em produção. Antes de mexer, salvar `id, floor_x, floor_y, area` da loja de teste e restaurar no fim.
- Cada task termina com `npx tsc --noEmit` limpo, testes passando e commit com a atribuição abaixo.

Rodapé de todo commit:

```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATqZgryoxRsTeXXM3HR8M7
```

## Review Focus

1. **Loja que nunca salvou posição** (caso do dono): o mapa mostra todas as mesas em grade, nada de quadro vazio. Teste na Task 1.
2. **Mesa nova cadastrada depois da planta pronta:** as posições já salvas não mudam; só a mesa nova ganha lugar livre. Teste na Task 1.
3. **500 mesas:** todas dentro das margens, sem duas no mesmo lugar, largura mínima do mapa ≥ 1500 px (rolagem), cálculo rápido. Teste na Task 1.
4. **Lote inválido ou de outra loja:** a RPC valida tudo antes de gravar (nada pela metade), recusa lote > 200 e ignora mesa de outra loja. Verificação SQL com `ROLLBACK` na Task 2.
5. **App novo com banco sem a migration 154:** o mapa continua funcionando (fallback para a RPC antiga); áreas avisam que exigem a atualização, sem quebrar. Task 2.
6. **Soltar uma mesa em cima de outra:** troca de lugar, nunca duas empilhadas. Teste na Task 1.
7. **Garçom/caixa:** nunca veem botões de edição. Task 4.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `lib/planta.ts` (novo) | grade automática, posições efetivas, encaixe, troca ao soltar, rótulos de área, faixa de mesas, lotes |
| `scripts/testes/planta.test.ts` (novo) | testes da lib |
| `supabase/migrations/154_planta_posicoes_em_lote_e_areas.sql` (novo) | coluna `tables.area` + RPC `update_tables_positions_secure` |
| `lib/api.ts` (editar, ~972) | `updateTablesPositions` (lotes + fallback), tipo `PosicaoMesa` |
| `types/index.ts` (editar, ~178) | `Table.area` |
| `components/modules/FloorPlanView.tsx` (reescrever) | mapa com rolagem, dica, filtros, edição, áreas, legenda |
| `components/modules/StoreModule.tsx` (editar, ~4930-4960) | liga o mapa à gravação em lote |

---

### Task 1: Lógica pura da planta (`lib/planta.ts`)

**Files:**
- Create: `lib/planta.ts`, `scripts/testes/planta.test.ts`

**Interfaces:**
- Produces:
  - `interface MesaPlanta { id: string; number: number; floor_x?: number | null; floor_y?: number | null; area?: string | null }`
  - `interface Pos { id: string; x: number; y: number }`
  - `const ASPECTO = 1.6; const MARGEM = 4; const CELULA_MIN_PX = 56`
  - `colunasIdeais(n: number): number`
  - `autoLayout(mesas: MesaPlanta[], opts?: { soFaltantes?: boolean }): { pos: Pos[]; cols: number }` (`soFaltantes` padrão `true`: preserva quem já tem posição e devolve só as que faltam; `false`: reorganiza todas)
  - `resolverPosicoes(mesas: MesaPlanta[]): { posicoes: Map<string, { x: number; y: number; salva: boolean }>; cols: number; naoSalvas: number }`
  - `larguraMinimaPx(cols: number): number`
  - `snap(x: number, y: number, cols: number): { x: number; y: number }`
  - `soltar(id: string, destino: { x: number; y: number }, atuais: Pos[], cols: number): Pos[]`
  - `rotulosDeArea(mesas: MesaPlanta[], posicoes: Map<string, { x: number; y: number }>): { area: string; x: number; y: number }[]`
  - `areasDe(mesas: MesaPlanta[]): string[]`
  - `mesasNoIntervalo(mesas: MesaPlanta[], de: number, ate: number): string[]`
  - `dividirEmLotes<T>(itens: T[], tamanho?: number): T[][]`

- [ ] **Step 1: Teste que falha**

```ts
// rodar com: npx tsx scripts/testes/planta.test.ts
import assert from 'node:assert/strict';
import { autoLayout, resolverPosicoes, colunasIdeais, larguraMinimaPx, snap, soltar, rotulosDeArea, areasDe, mesasNoIntervalo, dividirEmLotes, MARGEM, ASPECTO, type MesaPlanta, type Pos } from '../../lib/planta';

const mk = (n: number, extra: Partial<MesaPlanta> = {}): MesaPlanta => ({ id: `m${n}`, number: n, ...extra });
const lista = (q: number) => Array.from({ length: q }, (_, i) => mk(i + 1));
const dentro = (p: Pos) => p.x >= MARGEM && p.x <= 100 - MARGEM && p.y >= MARGEM && p.y <= 100 - MARGEM;
const distintas = (ps: Pos[]) => new Set(ps.map((p) => `${p.x}|${p.y}`)).size === ps.length;
const passoX = (cols: number) => (100 - 2 * MARGEM) / cols;

// 0 mesas
assert.deepEqual(autoLayout([]), { pos: [], cols: colunasIdeais(0) });
assert.equal(resolverPosicoes([]).naoSalvas, 0);

// 1 mesa: dentro das margens
const um = autoLayout(lista(1));
assert.equal(um.pos.length, 1);
assert.ok(dentro(um.pos[0]));

// 12 mesas: distintas, dentro, em grade de pelo menos 6 colunas
const doze = autoLayout(lista(12));
assert.equal(doze.pos.length, 12);
assert.ok(distintas(doze.pos) && doze.pos.every(dentro));
assert.ok(doze.cols >= 6);
assert.ok(doze.pos[0].x < doze.pos[1].x, 'mesa 1 antes da 2, da esquerda para a direita');

// Review Focus 1: ninguém salvou nada -> resolver devolve posição para todas, marcada como não salva
const r0 = resolverPosicoes(lista(12));
assert.equal(r0.posicoes.size, 12);
assert.equal(r0.naoSalvas, 12);
assert.ok([...r0.posicoes.values()].every((p) => p.salva === false));

// 500 mesas (Review Focus 3): cabem, distintas, dentro das margens, mapa com rolagem, rápido
const t0 = Date.now();
const q500 = autoLayout(lista(500));
const ms = Date.now() - t0;
assert.equal(q500.pos.length, 500);
assert.ok(distintas(q500.pos) && q500.pos.every(dentro));
assert.ok(larguraMinimaPx(q500.cols) >= 1500, `largura mínima ${larguraMinimaPx(q500.cols)}`);
assert.ok(ms < 1000, `demorou ${ms}ms`);
assert.ok(larguraMinimaPx(autoLayout(lista(12)).cols) < 600, 'poucas mesas não forçam rolagem');

// Review Focus 2: preservar posições salvas; só as que faltam entram, em lugar livre
const salvas = lista(10).map((m) => (m.number === 3 ? { ...m, floor_x: 50, floor_y: 50 } : m));
const parcial = autoLayout(salvas);
assert.ok(!parcial.pos.some((p) => p.id === 'm3'), 'a mesa salva não é movida');
assert.equal(parcial.pos.length, 9);
const px = passoX(parcial.cols);
assert.ok(parcial.pos.every((p) => Math.abs(p.x - 50) >= px * 0.75 || Math.abs(p.y - 50) >= px * ASPECTO * 0.75), 'ninguém cai em cima da mesa salva');
// tudo salvo -> nada a fazer; idempotente
const todasSalvas = lista(10).map((m, i) => ({ ...m, floor_x: 10 + i * 5, floor_y: 20 }));
assert.deepEqual(autoLayout(todasSalvas).pos, []);
assert.equal(resolverPosicoes(todasSalvas).naoSalvas, 0);
// soFaltantes:false reorganiza tudo e ignora o que estava salvo
assert.equal(autoLayout(todasSalvas, { soFaltantes: false }).pos.length, 10);
// mesa nova depois da planta pronta: as antigas não mudam
const comNova = [...todasSalvas, mk(11)];
const novaPos = autoLayout(comNova).pos;
assert.equal(novaPos.length, 1);
assert.equal(novaPos[0].id, 'm11');

// muitas posições salvas espalhadas: ainda cabem (sobe o nº de colunas se precisar)
const espalhadas = lista(30).map((m, i) => (i < 12 ? { ...m, floor_x: 8 + (i % 6) * 15, floor_y: 10 + Math.floor(i / 6) * 20 } : m));
const esp = autoLayout(espalhadas);
assert.equal(esp.pos.length, 18);
assert.ok(distintas(esp.pos) && esp.pos.every(dentro));

// Áreas: cada área começa numa linha nova
const comAreas = [1, 2, 3].map((n) => mk(n, { area: 'Salão' })).concat([4, 5, 6].map((n) => mk(n, { area: 'Varanda' })));
const ar = autoLayout(comAreas).pos;
const yDe = (ids: string[]) => ar.filter((p) => ids.includes(p.id)).map((p) => p.y);
assert.ok(Math.min(...yDe(['m4', 'm5', 'm6'])) > Math.max(...yDe(['m1', 'm2', 'm3'])), 'Varanda abaixo do Salão');
assert.deepEqual(areasDe(comAreas), ['Salão', 'Varanda']);
assert.deepEqual(areasDe(lista(3)), []);
const mapa = new Map(ar.map((p) => [p.id, { x: p.x, y: p.y }]));
const rot = rotulosDeArea(comAreas, mapa);
assert.equal(rot.length, 2);
assert.ok(rot.find((r) => r.area === 'Varanda')!.y > rot.find((r) => r.area === 'Salão')!.y);

// Encaixe: idempotente e dentro dos limites
const s1 = snap(33.3, 41.7, 6);
assert.deepEqual(snap(s1.x, s1.y, 6), s1);
const canto = snap(-20, 400, 6);
assert.ok(canto.x >= MARGEM && canto.y <= 100 - MARGEM);

// Review Focus 6: soltar em cima de outra mesa troca as duas
const atuais: Pos[] = [{ id: 'a', x: snap(0, 0, 6).x, y: snap(0, 0, 6).y }, { id: 'b', x: snap(60, 0, 6).x, y: snap(60, 0, 6).y }];
const trocou = soltar('a', { x: atuais[1].x + 0.5, y: atuais[1].y }, atuais, 6);
assert.equal(trocou.length, 2);
assert.deepEqual(trocou.find((p) => p.id === 'a'), { id: 'a', x: atuais[1].x, y: atuais[1].y });
assert.deepEqual(trocou.find((p) => p.id === 'b'), { id: 'b', x: atuais[0].x, y: atuais[0].y });
// soltar em lugar vazio move só a mesa
const livre = soltar('a', { x: 90, y: 60 }, atuais, 6);
assert.equal(livre.length, 1);

// Faixa de mesas (para atribuir área)
assert.deepEqual(mesasNoIntervalo(lista(10), 3, 5), ['m3', 'm4', 'm5']);
assert.deepEqual(mesasNoIntervalo(lista(10), 5, 3), ['m3', 'm4', 'm5'], 'de/ate invertidos');
assert.deepEqual(mesasNoIntervalo(lista(10), 20, 30), []);

// Lotes
assert.deepEqual(dividirEmLotes(Array.from({ length: 250 }, (_, i) => i), 100).map((l) => l.length), [100, 100, 50]);
assert.deepEqual(dividirEmLotes([], 100), []);
console.log('planta: ok');
```

- [ ] **Step 2: Rodar e ver falhar** — `npx tsx scripts/testes/planta.test.ts` → `Cannot find module '../../lib/planta'`

- [ ] **Step 3: Implementação**

```ts
// lib/planta.ts — planta de mesas: tudo em % do mapa (0–100), mapa em proporção 16:10.
export interface MesaPlanta { id: string; number: number; floor_x?: number | null; floor_y?: number | null; area?: string | null }
export interface Pos { id: string; x: number; y: number }

export const ASPECTO = 1.6;      // largura / altura do mapa (16:10)
export const MARGEM = 4;         // % livre nas bordas
export const CELULA_MIN_PX = 56; // alvo de toque 44 px + respiro

const round2 = (n: number) => Math.round(n * 100) / 100;
const temPos = (m: MesaPlanta) => m.floor_x != null && m.floor_y != null;

export function colunasIdeais(n: number): number {
  return Math.max(6, Math.ceil(Math.sqrt(Math.max(0, n) * ASPECTO)));
}

// Células quadradas em pixels: passo em Y (em % da altura) = passo em X (em % da largura) × ASPECTO.
const passos = (cols: number) => {
  const stepX = (100 - 2 * MARGEM) / cols;
  const stepY = stepX * ASPECTO;
  const linhas = Math.max(1, Math.floor((100 - 2 * MARGEM) / stepY + 1e-9));
  return { stepX, stepY, linhas };
};

export function larguraMinimaPx(cols: number): number {
  return Math.ceil((cols * CELULA_MIN_PX * 100) / (100 - 2 * MARGEM));
}

function tentar(faltam: MesaPlanta[], fixas: { x: number; y: number }[], cols: number): Pos[] | null {
  const { stepX, stepY, linhas } = passos(cols);
  const centro = (r: number, c: number) => ({ x: MARGEM + (c + 0.5) * stepX, y: MARGEM + (r + 0.5) * stepY });
  const ocupada = (r: number, c: number) => {
    const p = centro(r, c);
    return fixas.some((f) => Math.abs(f.x - p.x) < stepX * 0.75 && Math.abs(f.y - p.y) < stepY * 0.75);
  };
  const out: Pos[] = [];
  let r = 0;
  let c = 0;
  let areaAtual: string | undefined;
  for (const m of faltam) {
    const area = m.area ?? '';
    if (areaAtual !== undefined && area !== areaAtual && c > 0) { r += 1; c = 0; }
    areaAtual = area;
    while (ocupada(r, c)) { c += 1; if (c >= cols) { c = 0; r += 1; } }
    if (r >= linhas) return null;
    const p = centro(r, c);
    out.push({ id: m.id, x: round2(p.x), y: round2(p.y) });
    c += 1;
    if (c >= cols) { c = 0; r += 1; }
  }
  return out;
}

export function autoLayout(mesas: MesaPlanta[], opts: { soFaltantes?: boolean } = {}): { pos: Pos[]; cols: number } {
  const soFaltantes = opts.soFaltantes ?? true;
  const ordenadas = [...mesas].sort((a, b) => (a.area ?? '').localeCompare(b.area ?? '', 'pt-BR') || a.number - b.number);
  const fixas = soFaltantes ? ordenadas.filter(temPos).map((m) => ({ x: Number(m.floor_x), y: Number(m.floor_y) })) : [];
  const faltam = soFaltantes ? ordenadas.filter((m) => !temPos(m)) : ordenadas;
  const base = colunasIdeais(mesas.length);
  if (faltam.length === 0) return { pos: [], cols: base };
  for (let cols = base; cols <= 200; cols += 1) {
    const pos = tentar(faltam, fixas, cols);
    if (pos) return { pos, cols };
  }
  return { pos: [], cols: 200 }; // inalcançável com <= ~2000 mesas
}

export function resolverPosicoes(mesas: MesaPlanta[]): { posicoes: Map<string, { x: number; y: number; salva: boolean }>; cols: number; naoSalvas: number } {
  const { pos, cols } = autoLayout(mesas, { soFaltantes: true });
  const posicoes = new Map<string, { x: number; y: number; salva: boolean }>();
  mesas.filter(temPos).forEach((m) => posicoes.set(m.id, { x: Number(m.floor_x), y: Number(m.floor_y), salva: true }));
  pos.forEach((p) => posicoes.set(p.id, { x: p.x, y: p.y, salva: false }));
  return { posicoes, cols, naoSalvas: pos.length };
}

export function snap(x: number, y: number, cols: number): { x: number; y: number } {
  const { stepX, stepY, linhas } = passos(cols);
  const c = Math.max(0, Math.min(cols - 1, Math.round((x - MARGEM) / stepX - 0.5)));
  const r = Math.max(0, Math.min(linhas - 1, Math.round((y - MARGEM) / stepY - 0.5)));
  return { x: round2(MARGEM + (c + 0.5) * stepX), y: round2(MARGEM + (r + 0.5) * stepY) };
}

// Soltar a mesa `id` em `destino`: encaixa na grade; se já houver outra mesa ali, as duas trocam de lugar.
export function soltar(id: string, destino: { x: number; y: number }, atuais: Pos[], cols: number): Pos[] {
  const alvo = snap(destino.x, destino.y, cols);
  const { stepX, stepY } = passos(cols);
  const origem = atuais.find((p) => p.id === id);
  const ocupante = atuais.find((p) => p.id !== id && Math.abs(p.x - alvo.x) < stepX * 0.5 && Math.abs(p.y - alvo.y) < stepY * 0.5);
  const mov: Pos[] = [{ id, x: alvo.x, y: alvo.y }];
  if (ocupante && origem) mov.push({ id: ocupante.id, x: origem.x, y: origem.y });
  return mov;
}

export function areasDe(mesas: MesaPlanta[]): string[] {
  return Array.from(new Set(mesas.map((m) => (m.area ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// Rótulo de cada área no canto superior esquerdo do bloco de mesas dela.
export function rotulosDeArea(mesas: MesaPlanta[], posicoes: Map<string, { x: number; y: number }>): { area: string; x: number; y: number }[] {
  return areasDe(mesas).map((area) => {
    const ps = mesas.filter((m) => (m.area ?? '').trim() === area).map((m) => posicoes.get(m.id)).filter((p): p is { x: number; y: number } => !!p);
    return { area, x: Math.min(...ps.map((p) => p.x)), y: Math.min(...ps.map((p) => p.y)) };
  });
}

export function mesasNoIntervalo(mesas: MesaPlanta[], de: number, ate: number): string[] {
  const [a, b] = de <= ate ? [de, ate] : [ate, de];
  return mesas.filter((m) => m.number >= a && m.number <= b).sort((x, y) => x.number - y.number).map((m) => m.id);
}

export function dividirEmLotes<T>(itens: T[], tamanho = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push(itens.slice(i, i + tamanho));
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx tsx scripts/testes/planta.test.ts && npx tsc --noEmit`. Se o teste de 500 mesas ou o de "espalhadas" falhar por capacidade, ajustar só o limite do laço de colunas (nunca relaxar o teste).

- [ ] **Step 5: Commit**

```bash
git add lib/planta.ts scripts/testes/planta.test.ts
git commit -m "$(cat <<'EOF'
feat(planta): lógica pura da planta de mesas (grade automática, encaixe, troca, áreas, lotes)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATqZgryoxRsTeXXM3HR8M7
EOF
)"
```

---

### Task 2: Banco (migration 154) e gravação em lote

**Files:**
- Create: `supabase/migrations/154_planta_posicoes_em_lote_e_areas.sql`
- Modify: `lib/api.ts` (logo abaixo de `updateTablePosition`, ~972), `types/index.ts` (`Table`, ~178)

**Interfaces:**
- Consumes: `dividirEmLotes` (Task 1).
- Produces: `interface PosicaoMesa { id: string; x?: number | null; y?: number | null; area?: string | null }`; `updateTablesPositions(storeId: string, itens: PosicaoMesa[]): Promise<boolean>`; `Table.area?: string | null`. Contrato do JSON por item: `x` e `y` sempre juntos (ou nenhum dos dois); `area` opcional (ausente = não mexe).

- [ ] **Step 1: Migration** (não aplicar agora; só no deploy, Task 6)

```sql
-- 154: planta de mesas — gravação em lote e áreas (Salão, Varanda…). Aditiva: não altera nada que já existe.
-- get_tables_secure devolve row_to_json(t) (030), então a coluna nova chega ao app sem mexer na função.
ALTER TABLE public.tables ADD COLUMN IF NOT EXISTS area text;

-- p_items: array de {id, x, y, area?}. x e y vêm juntos (número 0–100 ou null = sem posição); area ausente = não mexe.
-- Valida o lote inteiro ANTES de gravar (nada pela metade); mesa de outra loja é ignorada (store_id é o limite de confiança).
CREATE OR REPLACE FUNCTION public.update_tables_positions_secure(p_store_id uuid, p_items jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare n integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'p_items deve ser um array'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'lote grande demais (máximo 200 mesas)'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(e->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (e ? 'x') <> (e ? 'y')
       or (e ? 'x' and jsonb_typeof(e->'x') not in ('number', 'null'))
       or (e ? 'y' and jsonb_typeof(e->'y') not in ('number', 'null'))
       or (jsonb_typeof(e->'x') = 'number' and (e->>'x')::numeric not between 0 and 100)
       or (jsonb_typeof(e->'y') = 'number' and (e->>'y')::numeric not between 0 and 100)
       or (e ? 'area' and jsonb_typeof(e->'area') not in ('string', 'null'))
       or length(coalesce(e->>'area', '')) > 40
  ) then raise exception 'itens inválidos'; end if;

  update tables t set
    floor_x = case when i.e ? 'x' then nullif(i.e->>'x', '')::numeric else t.floor_x end,
    floor_y = case when i.e ? 'y' then nullif(i.e->>'y', '')::numeric else t.floor_y end,
    area    = case when i.e ? 'area' then nullif(btrim(i.e->>'area'), '') else t.area end
  from (select e from jsonb_array_elements(p_items) e) i
  where t.id = (i.e->>'id')::uuid and t.store_id = p_store_id;
  get diagnostics n = row_count;
  return n;
end;
$$;
GRANT EXECUTE ON FUNCTION public.update_tables_positions_secure(uuid, jsonb) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';

-- Reversão (se precisar): DROP FUNCTION public.update_tables_positions_secure(uuid, jsonb); ALTER TABLE public.tables DROP COLUMN area;
```

- [ ] **Step 2: Tipo** — em `types/index.ts`, dentro de `Table`, depois de `floor_y`:

```ts
  // Área da planta (migration 154), ex.: "Salão", "Varanda". null = sem área.
  area?: string | null;
```

- [ ] **Step 3: API em lote** — em `lib/api.ts`, logo após `updateTablePosition`:

```ts
// Planta em lote (migration 154). x e y andam juntos; área é opcional. Banco sem a 154 (PGRST202): cai na RPC antiga, uma mesa por vez.
export interface PosicaoMesa { id: string; x?: number | null; y?: number | null; area?: string | null }

const posicaoParaJson = (i: PosicaoMesa): Record<string, unknown> => {
  const o: Record<string, unknown> = { id: i.id };
  if (i.x !== undefined) { o.x = i.x; o.y = i.y ?? null; }
  if (i.area !== undefined) o.area = i.area;
  return o;
};

export const updateTablesPositions = async (storeId: string, itens: PosicaoMesa[]): Promise<boolean> => {
  if (itens.length === 0) return true;
  for (const lote of dividirEmLotes(itens, 200)) {
    // eslint-disable-next-line no-await-in-loop -- poucos lotes (500 mesas = 3)
    const { error } = await supabase.rpc('update_tables_positions_secure', { p_store_id: storeId, p_items: lote.map(posicaoParaJson) });
    if (error) {
      if (error.code === 'PGRST202') return updateTablesPositionsLegado(storeId, itens);
      console.error('updateTablesPositions falhou:', error);
      return false;
    }
  }
  return true;
};

async function updateTablesPositionsLegado(storeId: string, itens: PosicaoMesa[]): Promise<boolean> {
  if (itens.some((i) => i.area !== undefined)) { console.warn('Áreas exigem a migration 154 aplicada no banco.'); return false; }
  const comPos = itens.filter((i) => i.x !== undefined);
  for (const grupo of dividirEmLotes(comPos, 10)) {
    // eslint-disable-next-line no-await-in-loop
    const r = await Promise.all(grupo.map((i) => updateTablePosition(storeId, i.id, i.x ?? null, i.y ?? null)));
    if (r.some((ok) => !ok)) return false;
  }
  return true;
}
```

E adicionar no topo do arquivo, junto dos outros imports: `import { dividirEmLotes } from './planta';`.

- [ ] **Step 4: Verificação SQL na hora do deploy** (Task 6; aqui só deixar o roteiro). Em transação com `ROLLBACK`, numa loja de **teste** (substituir `<LOJA_TESTE>` e `<MESA_ID>`; ids vêm de `select id, number from tables where store_id = '<LOJA_TESTE>' limit 3`):

```sql
begin;
select update_tables_positions_secure('<LOJA_TESTE>', '[{"id":"<MESA_ID>","x":10,"y":20,"area":"Salão"}]'::jsonb);   -- 1
select floor_x, floor_y, area from tables where id = '<MESA_ID>';                                                   -- 10 | 20 | Salão
select update_tables_positions_secure('<OUTRA_LOJA_QUALQUER_DE_TESTE>', '[{"id":"<MESA_ID>","x":99,"y":99}]'::jsonb); -- 0 (mesa de outra loja é ignorada)
select update_tables_positions_secure('<LOJA_TESTE>', '[{"id":"<MESA_ID>","x":101,"y":5}]'::jsonb);                   -- ERRO 'itens inválidos' (nada gravado)
select update_tables_positions_secure('<LOJA_TESTE>', '[{"id":"<MESA_ID>","x":5}]'::jsonb);                           -- ERRO (x sem y)
rollback;
```

- [ ] **Step 5: Verificar e commitar** — `npx tsc --noEmit && npx tsx scripts/testes/planta.test.ts`; `git add supabase/migrations/154_planta_posicoes_em_lote_e_areas.sql lib/api.ts types/index.ts` + commit `feat(planta): gravação em lote e áreas (migration 154, fallback para a RPC antiga)` com o rodapé de atribuição.

---

### Task 3: `FloorPlanView` reescrito

**Files:**
- Modify (reescrever): `components/modules/FloorPlanView.tsx`

**Interfaces:**
- Consumes: `resolverPosicoes`, `autoLayout`, `soltar`, `snap`, `larguraMinimaPx`, `rotulosDeArea`, `areasDe`, `mesasNoIntervalo` (Task 1); `PosicaoMesa` (Task 2); `toast` de `@/components/Toast`; `SPRING_UI`/`SPRING_TAP` de `@/lib/motion` e `motion`/`AnimatePresence`/`useReducedMotion` de `motion/react` (já usados em `components/ui.tsx`).
- Produces: `FloorPlanView` com props `{ tables: Table[]; info: (t: Table) => FloorPlanTableInfo; onOpen: (t: Table) => void; canEdit: boolean; onMoveMany: (itens: PosicaoMesa[]) => Promise<boolean> }` (a prop `onMove` some; `FloorPlanTableInfo` não muda).

- [ ] **Step 1: Escrever o componente**

```tsx
'use client';
// Planta de mesas. Cada quadradinho é uma mesa. Toque para abrir a conta; o gerente arruma em "Editar planta".
// O mapa nunca abre vazio: mesa sem posição salva aparece em posição automática (não gravada até alguém salvar).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Check, X, Info, LayoutGrid } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { SPRING_UI, SPRING_TAP } from '@/lib/motion';
import type { Table } from '@/types';
import type { PosicaoMesa } from '@/lib/api';
import { toast } from '@/components/Toast';
import { autoLayout, resolverPosicoes, soltar, larguraMinimaPx, rotulosDeArea, areasDe, mesasNoIntervalo, type Pos } from '@/lib/planta';

export interface FloorPlanTableInfo {
  dotColor: string;
  statusLabel: string;
  inJurisdiction: boolean;
  blocked: boolean;
  /** Há quantos minutos a mesa está ocupada (null = livre/sem itens). */
  minutes?: number | null;
  /** Passou do limite configurado da loja? */
  alerta?: 'warn' | 'err' | null;
}

interface Props {
  tables: Table[];
  info: (table: Table) => FloorPlanTableInfo;
  onOpen: (table: Table) => void;
  canEdit: boolean;
  onMoveMany: (itens: PosicaoMesa[]) => Promise<boolean>;
}

const DICA_KEY = 'ntb-planta-dica-v1';
const clamp = (n: number) => Math.min(100, Math.max(0, n));
const LEGENDA: { cor: string; texto: string }[] = [
  { cor: 'var(--ok)', texto: 'Livre' },
  { cor: 'var(--brand)', texto: 'Ocupada' },
  { cor: 'var(--warn)', texto: 'Pediu a conta' },
  { cor: 'var(--err)', texto: 'Chamando o garçom' },
  { cor: 'var(--text-muted)', texto: 'Bloqueada' },
];

export const FloorPlanView: React.FC<Props> = ({ tables, info, onOpen, canEdit, onMoveMany }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [soOcupadas, setSoOcupadas] = useState(() => tables.length > 60);
  const [areaSel, setAreaSel] = useState<string>('todas');
  const [confirmandoOrg, setConfirmandoOrg] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [mostrarDica, setMostrarDica] = useState(false);
  const [areaNome, setAreaNome] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const reduzMovimento = useReducedMotion();
  // Ao organizar, as mesas "assentam" em sequência curta (teto de 300 ms no total, mesmo com 500 mesas).
  const [assentando, setAssentando] = useState(false);
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);

  useEffect(() => { try { setMostrarDica(localStorage.getItem(DICA_KEY) !== '1'); } catch { setMostrarDica(true); } }, []);
  const fecharDica = () => { setMostrarDica(false); try { localStorage.setItem(DICA_KEY, '1'); } catch { /* sem storage: só reaparece */ } };
  useEffect(() => { if (!confirmandoOrg) return; const t = setTimeout(() => setConfirmandoOrg(false), 5000); return () => clearTimeout(t); }, [confirmandoOrg]);

  const { posicoes, cols, naoSalvas } = useMemo(() => resolverPosicoes(tables), [tables]);
  const areas = useMemo(() => areasDe(tables), [tables]);
  const rotulos = useMemo(() => rotulosDeArea(tables, posicoes), [tables, posicoes]);
  const largura = larguraMinimaPx(cols);

  const filtrarOcupadas = soOcupadas && !editing;
  const visiveis = tables.filter((t) => {
    if (areaSel !== 'todas' && (t.area ?? '') !== areaSel) return false;
    if (filtrarOcupadas && !(t.status === 'occupied' || t.status === 'waiting_bill')) return false;
    return true;
  });

  const pointToPercent = (clientX: number, clientY: number) => {
    const r = mapRef.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return null;
    return { x: clamp(((clientX - r.left) / r.width) * 100), y: clamp(((clientY - r.top) / r.height) * 100) };
  };

  const onPointerDown = (e: React.PointerEvent, t: Table) => {
    if (!editing) return;
    dragRef.current = { id: t.id, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = pointToPercent(e.clientX, e.clientY);
    if (!p) return;
    d.moved = true;
    setDragPos({ id: d.id, ...p });
  };
  const onPointerUp = async (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragPos(null);
    if (!d || !d.moved) return;
    const r = mapRef.current?.getBoundingClientRect();
    const fora = !!r && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
    const p = pointToPercent(e.clientX, e.clientY);
    if (fora || !p) return; // soltou fora do mapa = cancela o arrasto
    const atuais: Pos[] = Array.from(posicoes.entries()).map(([id, v]) => ({ id, x: v.x, y: v.y }));
    await onMoveMany(soltar(d.id, p, atuais, cols).map((m) => ({ id: m.id, x: m.x, y: m.y })));
  };

  const salvar = async (itens: PosicaoMesa[], okMsg: string) => {
    if (itens.length === 0) { toast.info('Nada para salvar.'); return; }
    setSalvando(true);
    setAssentando(true);
    const ok = await onMoveMany(itens);
    setSalvando(false);
    setTimeout(() => setAssentando(false), 600);
    if (ok) toast.success(okMsg);
  };
  const organizarTudo = () => {
    if (!confirmandoOrg) { setConfirmandoOrg(true); return; }
    setConfirmandoOrg(false);
    void salvar(autoLayout(tables, { soFaltantes: false }).pos.map((p) => ({ id: p.id, x: p.x, y: p.y })), 'Mesas organizadas.');
  };
  const posicionarFaltantes = () => void salvar(autoLayout(tables, { soFaltantes: true }).pos.map((p) => ({ id: p.id, x: p.x, y: p.y })), 'Posições salvas.');
  const aplicarArea = () => {
    const a = Number(de);
    const b = Number(ate);
    const ids = Number.isFinite(a) && Number.isFinite(b) && de !== '' && ate !== '' ? mesasNoIntervalo(tables, a, b) : [];
    if (ids.length === 0) { toast.error('Digite de qual mesa até qual mesa (ex.: 1 até 20).'); return; }
    void salvar(ids.map((id) => ({ id, area: areaNome.trim() || null })), areaNome.trim() ? `Área "${areaNome.trim()}" aplicada a ${ids.length} mesas.` : `Área removida de ${ids.length} mesas.`);
  };

  const Pin = ({ t }: { t: Table }) => {
    const i = info(t);
    const base = posicoes.get(t.id);
    if (!base) return null;
    const pos = dragPos?.id === t.id ? dragPos : base;
    const clicavel = !editing && i.inJurisdiction && !i.blocked;
    const arrastando = dragPos?.id === t.id;
    // Mola do app (SPRING_UI); arrastando, segue o dedo sem mola; ao organizar, atraso curto por mesa (teto 300 ms).
    const ordem = assentando ? Math.min(300, (t.number % 50) * 6) : 0;
    const transicao = reduzMovimento || arrastando ? { duration: 0 } : { ...SPRING_UI, delay: ordem / 1000 };
    return (
      <motion.button
        type="button"
        data-mesa
        onPointerDown={(e) => onPointerDown(e, t)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={() => { if (clicavel) onOpen(t); }}
        initial={false}
        animate={{ left: `${pos.x}%`, top: `${pos.y}%` }}
        transition={transicao}
        whileTap={clicavel && !reduzMovimento ? { scale: 0.96, transition: SPRING_TAP } : undefined}
        style={{ x: '-50%', y: '-50%', touchAction: editing ? 'none' : 'auto' }}
        className={`absolute min-w-[44px] min-h-[44px] px-2 rounded-xl border bg-[var(--surface)] shadow-[var(--shadow-sm)] flex flex-col items-center justify-center text-[13px] font-semibold text-[var(--text)] ${
          editing ? 'cursor-grab ring-1 ring-dashed ring-[var(--brand)]' : clicavel ? 'hover:shadow-md' : 'opacity-50'
        }`}
        aria-label={`Mesa ${t.number}${t.area ? `, ${t.area}` : ''}, ${i.statusLabel}${i.minutes != null ? `, ocupada há ${i.minutes} minutos` : ''}`}
        title={`Mesa ${t.number} · ${i.statusLabel}`}
      >
        <span className="leading-none">{t.number}</span>
        {i.minutes != null ? (
          <span className="mt-0.5 text-[10px] leading-none font-medium num" style={{ color: i.alerta === 'err' ? 'var(--err)' : i.alerta === 'warn' ? 'var(--warn)' : 'var(--text-muted)' }}>
            {i.minutes >= 60 ? `${Math.floor(i.minutes / 60)}h${String(i.minutes % 60).padStart(2, '0')}` : `${i.minutes}m`}
          </span>
        ) : null}
        <span className="mt-1 h-1.5 w-1.5 rounded-full" style={{ background: i.dotColor }} />
      </motion.button>
    );
  };

  const chip = (ativo: boolean) => `h-9 max-sm:h-11 px-3 rounded-full text-[13px] font-semibold u-press ${ativo ? 'bg-[var(--brand-fill)] text-white' : 'bg-[var(--surface-2)] text-[var(--text)]'}`;

  return (
    <div className="space-y-3">
      <AnimatePresence initial={false}>
      {mostrarDica && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRING_UI} className="flex items-start gap-3 rounded-[14px] bg-[var(--brand-soft)] px-4 py-3 text-[14px] text-[var(--text)]" role="note">
          <Info size={18} className="mt-0.5 shrink-0 text-[var(--brand)]" />
          <p className="flex-1">
            <b>Como funciona:</b> cada quadradinho é uma mesa — a bolinha mostra se está livre, ocupada ou pedindo atenção, e o número é há quanto tempo está ocupada. Toque numa mesa para abrir a conta.
            {canEdit ? ' Para mudar as mesas de lugar, toque em “Editar planta”.' : ''}
          </p>
          <button type="button" onClick={fecharDica} aria-label="Fechar a explicação" className="min-h-11 min-w-11 -m-2 grid place-items-center text-[var(--text-muted)]"><X size={16} /></button>
        </motion.div>
      )}
      </AnimatePresence>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={soOcupadas} onClick={() => setSoOcupadas((v) => !v)} className={chip(filtrarOcupadas)}>Só ocupadas</button>
        {areas.length > 0 && (
          <>
            <button type="button" aria-pressed={areaSel === 'todas'} onClick={() => setAreaSel('todas')} className={chip(areaSel === 'todas')}>Todas as áreas</button>
            {areas.map((a) => <button key={a} type="button" aria-pressed={areaSel === a} onClick={() => setAreaSel(a)} className={chip(areaSel === a)}>{a}</button>)}
          </>
        )}
        {canEdit && (
          <button type="button" onClick={() => { setEditing((v) => !v); setConfirmandoOrg(false); }} className="ml-auto inline-flex items-center gap-1.5 h-9 max-sm:h-11 px-3 rounded-full bg-[var(--surface-2)] text-[13px] font-semibold text-[var(--text)] u-press">
            {editing ? <><Check size={14} /> Concluir</> : <><Pencil size={14} /> Editar planta</>}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
      {canEdit && editing && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRING_UI} className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-3 space-y-3">
          <p className="text-[13px] text-[var(--text-muted)]">Arraste uma mesa para outro quadradinho (ela encaixa na grade). Soltar em cima de outra mesa troca as duas de lugar.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={salvando} onClick={organizarTudo} className={`${chip(confirmandoOrg)} inline-flex items-center gap-1.5`}>
              <LayoutGrid size={14} /> {confirmandoOrg ? 'Toque de novo para confirmar' : 'Organizar automaticamente'}
            </button>
            {naoSalvas > 0 && (
              <button type="button" disabled={salvando} onClick={posicionarFaltantes} className={chip(false)}>Salvar as {naoSalvas} mesas sem posição</button>
            )}
          </div>
          {confirmandoOrg && <p className="text-[12px] text-[var(--warn)]">Isso coloca TODAS as mesas em grade, por área e número, e perde o arranjo atual.</p>}
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[12px] text-[var(--text-muted)]">Área
              <input value={areaNome} onChange={(e) => setAreaNome(e.target.value)} maxLength={40} placeholder="Ex.: Varanda" className="block h-11 w-36 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[15px] text-[var(--text)]" />
            </label>
            <label className="text-[12px] text-[var(--text-muted)]">Da mesa
              <input value={de} onChange={(e) => setDe(e.target.value)} inputMode="numeric" className="block h-11 w-20 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[15px] text-[var(--text)]" />
            </label>
            <label className="text-[12px] text-[var(--text-muted)]">até a
              <input value={ate} onChange={(e) => setAte(e.target.value)} inputMode="numeric" className="block h-11 w-20 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[15px] text-[var(--text)]" />
            </label>
            <button type="button" disabled={salvando} onClick={aplicarArea} className={chip(false)}>Aplicar área</button>
          </div>
          <p className="text-[12px] text-[var(--text-muted)]">Deixe a área em branco para tirar a área dessas mesas. Depois use “Organizar automaticamente” para agrupar por área.</p>
        </div>
      )}
      {canEdit && !editing && naoSalvas > 0 && (
        <p className="text-[13px] text-[var(--text-muted)]">{naoSalvas} {naoSalvas === 1 ? 'mesa está' : 'mesas estão'} em posição automática (ainda não salva). Toque em “Editar planta” para arrumar e salvar.</p>
      )}

      <div className="overflow-auto rounded-[18px] border border-[var(--border)] max-h-[70vh]">
        <div
          ref={mapRef}
          className="relative w-full aspect-[16/10] min-h-[280px] bg-[var(--surface-2)]"
          style={{ minWidth: largura, backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
        >
          {rotulos.filter((r) => areaSel === 'todas' || r.area === areaSel).map((r) => (
            <span key={r.area} className="pointer-events-none absolute -translate-y-full text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]" style={{ left: `${r.x}%`, top: `calc(${r.y}% - 24px)` }}>{r.area}</span>
          ))}
          {visiveis.map((t) => <Pin key={t.id} t={t} />)}
          {visiveis.length === 0 && (
            <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-[var(--text-muted)]">
              {tables.length === 0 ? 'Esta loja ainda não tem mesas cadastradas.' : filtrarOcupadas ? 'Nenhuma mesa ocupada agora. Desligue “Só ocupadas” para ver todas.' : 'Nenhuma mesa nesta área.'}
            </div>
          )}
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--text-muted)]" aria-label="Legenda">
        {LEGENDA.map((l) => <li key={l.texto} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: l.cor }} />{l.texto}</li>)}
      </ul>
    </div>
  );
};
```

- [ ] **Step 2: Conferir o movimento e a aderência ao app** — `grep -n "SPRING_UI\|SPRING_TAP" lib/motion.ts` (os nomes existem; usar só eles, sem valores de mola novos). Comparar lado a lado com a lista de mesas e o modal "Mesa X": mesmos tokens, raio, sombra e tipografia. Cenários de animação a verificar na Task 5: organizar (mesas assentam em sequência curta), trocar (a outra desliza para o lugar), arrastar (segue o dedo, assenta ao soltar), `prefers-reduced-motion` ligado (sem movimento).
- [ ] **Step 2b: Verificar tipos** — `npx tsc --noEmit` (vai acusar o `StoreModule.tsx` ainda passando `onMove`; resolve na Task 4, então esta task só fecha junto com ela se o tsc for obrigatório por commit — nesse caso fazer Task 3 e 4 no mesmo commit).

- [ ] **Step 3: Commit** (junto com a Task 4 se o tsc exigir) — `feat(planta): mapa nunca vazio, grade com rolagem, encaixe, áreas, dica e legenda`.

---

### Task 4: Ligar o mapa ao app (`StoreModule.tsx`)

**Files:**
- Modify: `components/modules/StoreModule.tsx` (~4925-4953; o import de `updateTablePosition` — localizar com `grep -n "updateTablePosition" components/modules/StoreModule.tsx`)

**Interfaces:**
- Consumes: `updateTablesPositions`, `PosicaoMesa` (Task 2); `FloorPlanView` com `onMoveMany` (Task 3).

- [ ] **Step 1: Trocar o import** — onde `updateTablePosition` é importado de `@/lib/api`, trocar por `updateTablesPositions, type PosicaoMesa` (remover `updateTablePosition` se mais nada o usar: `grep` para conferir).

- [ ] **Step 2: Substituir `moverNaPlanta`** (linhas ~4925-4929) por:

```tsx
                const moverVariasNaPlanta = async (itens: PosicaoMesa[]): Promise<boolean> => {
                    const porId = new Map(itens.map(i => [i.id, i]));
                    setTables(prev => prev.map(t => {
                        const i = porId.get(t.id);
                        if (!i) return t;
                        return { ...t, ...(i.x !== undefined ? { floor_x: i.x, floor_y: i.y ?? null } : {}), ...(i.area !== undefined ? { area: i.area } : {}) };
                    })); // otimista
                    const ok = await updateTablesPositions(storeId, itens);
                    if (!ok) { toast.error('Não consegui salvar a planta. Tente de novo.'); loadData(); }
                    return ok;
                };
```

- [ ] **Step 3: Atualizar o uso** (linhas ~4946-4953): trocar `onMove={moverNaPlanta}` por `onMoveMany={moverVariasNaPlanta}`.

- [ ] **Step 4: Permissão** — manter `podeEditarPlanta` como está (dono, gerente, universal). Quando a Task 3 do plano `2026-10-04-mesa-cardapio-permissoes.md` existir, ela troca essa linha por `roleCan(loggedUser, store, 'editar_planta')`; não duplicar aqui.

- [ ] **Step 5: Verificar e commitar** — `npx tsc --noEmit && for t in scripts/testes/*.test.ts; do npx tsx "$t" || echo FALHOU $t; done`; commit `feat(planta): StoreModule grava a planta em lote` com o rodapé de atribuição.

**Referência cruzada (não duplicar):** "tocar na mesa e já ver os pedidos com adicionar e receber" é a **Task 1** de `docs/superpowers/plans/2026-10-04-mesa-cardapio-permissoes.md`. O toque numa mesa do Mapa já chama `onOpen` → `setSelectedTable(...)`, o mesmo caminho da Lista, então herda essa melhoria sem mudança aqui.

---

### Task 5: QA visual em loja de teste (nunca no Sertão)

**Files:** nenhum arquivo do app; capturas em `~/ClaudeGerado/planta-qa/` (limpar o que sobrar ao final).

- [ ] **Step 1: Escolher a loja de teste e salvar o estado**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -At -c \"select id, slug, name from stores where slug ilike 'zz%' or name ilike '%donana%'\""
# confirmar que NÃO é o Sertão. Depois, com <LOJA_TESTE> escolhida:
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -At -F',' -c \"select id, coalesce(floor_x::text,''), coalesce(floor_y::text,''), coalesce(area,'') from tables where store_id = '<LOJA_TESTE>' order by number\"" > "$TMPDIR/planta-antes.csv"
```

(A coluna `area` só existe depois da migration 154. Se QA antes do deploy, tirar `area` da consulta.)

- [ ] **Step 2: Cenários** (computador e celular — emular 390×844 —, tema claro e escuro; usar a loja de teste logada com usuário de teste, nunca emitir nota fiscal nem mexer em mesa ocupada de verdade):
  1. Loja sem posição salva → Mapa abre com todas as mesas em grade e a dica "Como funciona"; fechar a dica e recarregar → não volta.
  2. "Editar planta" → "Organizar automaticamente" pede confirmação (toque duplo) → as mesas assentam na grade em sequência curta (≤ 300 ms no total) e persistem após F5; repetir com o sistema em "reduzir movimento": sem animação, mesmo resultado.
  3. Arrastar uma mesa para quadradinho vazio → encaixa; arrastar para cima de outra → trocam; soltar fora do mapa → nada muda.
  4. Área: "Varanda" da mesa 4 até a 6 → chip "Varanda" aparece, rótulo no mapa, filtro mostra só elas; "Organizar" deixa a Varanda numa linha abaixo.
  5. Garçom (usuário sem permissão) → sem "Editar planta", sem painel de edição.
  6. Loja com muitas mesas (se a de teste tiver ≥ 60, ou criar temporariamente 150 pela tela de mesas da loja de teste e remover depois): abre com "Só ocupadas"; desligar mostra tudo com rolagem horizontal; nenhum quadradinho menor que 44 px.
  7. Estado vazio: loja sem mesas e filtro "Só ocupadas" sem ocupadas mostram a frase explicativa.
  8. Toque numa mesa livre/ocupada abre o mesmo modal da Lista.
- [ ] **Step 3: Enviar capturas** (computador + celular, claro + escuro) ao usuário (regra: "sempre mandar capturas").
- [ ] **Step 4: Restaurar** — voltar `floor_x/floor_y/area` da loja de teste ao estado salvo no Step 1 (UPDATE a partir do CSV, numa transação, com `where store_id = '<LOJA_TESTE>'`), apagar mesas temporárias criadas, apagar capturas e o CSV do scratch.

---

### Task 6: Deploy (loja fechada), rollback e documentação

**Files:**
- Modify: `AGENTS.md` (uma seção curta "Planta de mesas")

- [ ] **Step 1: Pré-condição** — o dono confirma que as lojas estão fechadas (nunca no horário de funcionamento do Sertão). Conferir `git status` limpo e testes verdes.
- [ ] **Step 2: Backup e migration** (aditiva; roda antes do app)

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db pg_dump -U supabase_admin -d ntb_vendas -Fc -t tables > /root/backups/tables-pre-154.dump"
scp -i ~/.ssh/notebook_contabo_key supabase/migrations/154_planta_posicoes_em_lote_e_areas.sql root@185.193.66.240:/tmp/
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas < /tmp/154_planta_posicoes_em_lote_e_areas.sql && rm /tmp/154_planta_posicoes_em_lote_e_areas.sql"
```
- [ ] **Step 3: Verificação SQL** do roteiro da Task 2 Step 4 numa loja de teste, com `ROLLBACK`; conferir também `select area from tables limit 1` (coluna existe) e que o Sertão continua com `area` nula em todas as mesas.
- [ ] **Step 4: Deploy do app** com o `deploy.sh` do `ntb vendas` (manual, conforme rotina do projeto) e smoke: abrir `/loja` numa loja de teste, aba Mapa, uma mesa arrastada, F5, posição mantida.
- [ ] **Step 5: Rollback pronto** — app: voltar ao commit anterior e rodar `deploy.sh`; banco só se necessário: `DROP FUNCTION public.update_tables_positions_secure(uuid, jsonb); ALTER TABLE public.tables DROP COLUMN area;` + `NOTIFY pgrst, 'reload schema';` (o app antigo ignora a coluna, então o rollback do banco raramente é preciso).
- [ ] **Step 6: Documentar** em `AGENTS.md` (seção "Planta de mesas"): posições em % 16:10, grade automática e por que a posição automática não é gravada, `tables.area` em vez de prefixo, RPC em lote (limite 200) com fallback `PGRST202`, e a regra de QA só em loja de teste. Commit `docs(planta): decisões da planta de mesas` com o rodapé de atribuição.

---

## Self-review

- **Cobertura do pedido:** mapa que nunca começa vazio (T1 `resolverPosicoes` + T3); "Organizar automaticamente" (T1 `autoLayout` + T3 botão com confirmação); persistência em lote segura (T2, RPC 154 com `store_id`, limite 200, validação total); áreas (T2 coluna, T1 `areasDe`/`rotulosDeArea`/`mesasNoIntervalo`, T3 painel e chips); arrastar com encaixe (T1 `snap`/`soltar`, T3); dica na primeira vez (T3 `DICA_KEY`); cor de status e tempo (`info()` preservado em T3); só ocupadas (T3, padrão ligado acima de 60 mesas); celular/44 px (T3 `min-h-[44px]`, chips `max-sm:h-11`, T5); Lista continua padrão (decisão registrada, sem mudança de código porque `tablesViewMode` já é `'lista'`); estado vazio em linguagem simples (T3); referência cruzada ao plano da mesa com pedidos (T4).
- **Placeholders:** nenhum nas bibliotecas, migration, API nem no componente. Os valores `<LOJA_TESTE>`/`<MESA_ID>` dos roteiros de QA/SQL são ids que só existem em tempo de execução e vêm da consulta mostrada no mesmo passo.
- **Tipos:** `MesaPlanta`, `Pos`, `PosicaoMesa`, `autoLayout`, `resolverPosicoes`, `snap`, `soltar`, `larguraMinimaPx`, `rotulosDeArea`, `areasDe`, `mesasNoIntervalo`, `dividirEmLotes` e `onMoveMany` usam os mesmos nomes e assinaturas nas Tasks 1–4.
- **Review Focus:** 1, 2, 3 e 6 em T1 (testes); 4 e 5 em T2 (SQL com ROLLBACK + fallback `PGRST202`); 7 em T4/T5.
- **Fora de escopo:** desenhar paredes/formas, mesas de tamanhos diferentes, uma planta por andar com imagem de fundo; só entram se o dono pedir depois de usar esta versão.
