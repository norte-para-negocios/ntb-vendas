# Tamanho pré-selecionado + Cardápio por Horário — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** (1) Reduzir atrito no grupo obrigatório de escolha única (ex.
"Tamanho") pré-selecionando a primeira opção, em vez de deixar o cliente
obrigado a clicar. (2) Deixar uma categoria inteira do cardápio (ex. "Café
da Manhã") disponível só numa janela de horário/dias da semana.

**Architecture:** Migration nova (018) adiciona 3 colunas opcionais em
`categories` (`available_from`, `available_until`, `available_days`) — bem
mais simples que o desenho de adicionais, sem function nova no banco
(enforcement é 100% client-side, decisão explícita — ver nota abaixo). Um
helper puro `isCategoryAvailableNow` calcula a janela, usado tanto pra
filtrar o cardápio do cliente quanto pra mostrar o status no painel do
lojista.

**Decisão de design: enforcement só no client, não no servidor.** Mesmo
princípio já usado pra `required`/min/max de adicionais neste projeto
("regra de UX, não de segurança de preço") — não tem valor financeiro em
jogo aqui (ninguém "trapaceia" pedindo o café da manhã às 14h; na pior das
hipóteses a cozinha só faz mesmo assim). Não vale a complexidade de
validar isso em `create_order_secure`.

**Tech Stack:** igual ao resto — Next.js 16, Supabase, `npm run build` como
rede de segurança.

---

## Task 1: Migration 018 — horário por categoria

**Files:** Create `supabase/migrations/018_categoria_horario.sql`

```sql
-- Cardapio por horario/turno: categoria inteira soh aparece numa janela
-- de horario e/ou dias da semana (ex: "Cafe da Manha" das 7h as 11h).
-- Enforcement e' so client-side (ver AGENTS.md, mesmo principio do
-- required/min/max de adicionais) -- nao ha valor financeiro em jogo.
-- NULL em qualquer um dos 3 campos = sempre disponivel (default,
-- compatibilidade com todas as categorias existentes).

alter table categories add column if not exists available_from time;
alter table categories add column if not exists available_until time;
-- 0=domingo .. 6=sabado. NULL = todos os dias.
alter table categories add column if not exists available_days int[];
```

**Step 2:** Aplicar: `node scripts/aplicar-migration.mjs 018_categoria_horario.sql`

**Step 3:** Verificar:
```
node scripts/db.mjs "select column_name from information_schema.columns where table_name='categories' and column_name like 'available_%'"
```

**Step 4:** Commit: `feat: horario e dias da semana opcionais por categoria`

---

## Task 2: `lib/api.ts`/`types/index.ts` + helper de horário

**Files:** Modify `types/index.ts`, `lib/api.ts`; Create `lib/schedule.ts`

1. `types/index.ts`: `Category` ganha `available_from?: string | null`,
   `available_until?: string | null`, `available_days?: number[] | null`.
2. `lib/api.ts`: `createCategory`/`fetchMenu` já fazem `select('*')` em
   categories, então os campos novos já vêm de graça — sem mudança de
   query necessária. Adicionar `updateCategorySchedule(categoryId, {
   available_from, available_until, available_days })` (update simples,
   mesmo padrão de `updateProduct`) — hoje não existe NENHUM update de
   categoria (só create/delete/reorder), esta é a primeira vez.
3. `lib/schedule.ts` (novo arquivo): função pura
   `isCategoryAvailableNow(category: Pick<Category, 'available_from' |
   'available_until' | 'available_days'>, now = new Date()): boolean`.
   - Se os 3 campos forem `null`/undefined, retorna `true` (sempre
     disponível).
   - Compara `now`'s dia da semana (`now.getDay()`, 0=domingo) contra
     `available_days` se setado.
   - Compara `now`'s hora:minuto contra `available_from`/`available_until`
     (formato "HH:MM:SS" ou "HH:MM" vindo do Postgres `time`) — **tratar o
     caso de virar meia-noite** (ex.: "23:00" até "03:00"): se
     `available_until < available_from`, a janela é
     `now >= available_from OR now <= available_until`; senão é
     `now >= available_from AND now <= available_until`.
   - Exportar também `formatScheduleLabel(category)` retornando uma string
     tipo "Disponível das 07:00 às 11:00" ou "Disponível qui, sex, sáb" pra
     reusar na UI do lojista e (se quiser) do cliente.

**Step 2:** `npm run build`. **Step 3:** Commit: `feat: helper isCategoryAvailableNow + updateCategorySchedule`

---

## Task 3: `StoreModule.tsx` — modal de horário da categoria + pré-seleção

**Files:** Modify `components/modules/StoreModule.tsx`

1. Hoje uma categoria é só um chip (nome + arrastar + excluir), sem nenhum
   modal de edição. Adicionar um ícone de relógio (`Clock`, já importado
   em outro lugar do arquivo — reusar) no chip que abre um `Modal`
   pequeno com: nome da categoria (opcional editar, se já não der pra
   editar hoje — confirme lendo o código atual), um toggle "Disponível o
   dia todo" (default ligado = `available_from`/`until`/`days` todos
   null), e quando desligado: dois inputs `type="time"`
   (`available_from`/`available_until`) + 7 checkboxes de dia da semana
   (Dom-Sáb). Salvar chama `updateCategorySchedule`.
2. No chip da categoria (fora do modal), se a categoria tiver horário
   configurado, mostrar um badge pequeno com `formatScheduleLabel` (ex.
   "07:00-11:00") pro lojista ver de relance quais categorias são
   restritas.
3. **Pré-seleção de "tamanho"**: em `StoreProductModal` (fluxo do garçom,
   já tem seletor de adicionais desde a Task B1 do plano anterior), ao
   abrir o modal (o `useEffect` que reseta `selections` quando o produto
   muda), para cada grupo `type === 'single' && required === true` com
   pelo menos 1 opção `available !== false`, pré-selecionar a PRIMEIRA
   dessas opções em vez de deixar `selections[group.id]` vazio.

**Step 2:** `npm run build` + smoke test (criar categoria "Café da Manhã",
configurar 07:00-11:00, confirmar badge aparece; abrir produto com grupo
obrigatório single no fluxo do garçom e confirmar 1ª opção já vem
marcada).
**Step 3:** Commit: `feat: modal de horario por categoria no painel + pre-selecao da 1a opcao em grupo unico obrigatorio (garcom)`

---

## Task 4: `ClientModule.tsx` — filtro por horário + pré-seleção

**Files:** Modify `components/modules/ClientModule.tsx`

1. Mesma pré-seleção da Task 3, item 3, mas no `ProductModal` do cliente
   (o `useEffect` equivalente que reseta `selections`).
2. Filtrar a lista de categorias mostradas na barra de categorias E os
   produtos derivados delas (`filteredProducts`/categoria ativa) usando
   `isCategoryAvailableNow` — uma categoria fora da janela simplesmente
   não aparece (mesmo comportamento que produto `available=false` já tem
   hoje: some inteiro, não fica desabilitada visível). Cuidado: se a
   categoria ativa (`activeCategory`) deixar de estar disponível
   enquanto o cliente já está com ela selecionada (o relógio virou
   durante a visita), trocar automaticamente pra primeira categoria
   ainda disponível.

**Step 2:** `npm run build` + smoke test (configurar uma categoria de
teste com janela que NÃO inclui o horário atual, confirmar que ela some
do cardápio do cliente; configurar outra que INCLUA o horário atual e
confirmar que aparece normal).
**Step 3:** Commit: `feat: cardapio do cliente respeita horario da categoria + pre-selecao da 1a opcao em grupo unico obrigatorio`

---

## Task 5: `AGENTS.md`

**Files:** Modify `AGENTS.md`

1. Na seção "Adicionais/opcionais de produto", documentar: "grupo único
   obrigatório = como modelar 'Tamanho' (P/M/G)" (já é possível hoje, só
   documentação) + a pré-seleção automática da 1ª opção.
2. Nova seção "Cardápio por horário/turno (migration 018)" documentando
   `categories.available_from/until/days`, `lib/schedule.ts`, e a decisão
   de enforcement só client-side (mesmo princípio do required/min/max).
3. Atualizar a lista de migrations com a 018.
4. Remover/atualizar a entrada "taxa de serviço configurável... cardápio
   por horário" se estiver na lista de standby (conferir se já não tinha
   entrado lá de outra forma — não tinha, é item novo desta conversa).

**Step 2:** `npm run build`. **Step 3:** Commit: `docs: documenta tamanho via grupo unico e cardapio por horario`

---

## Resumo de arquivos tocados

- `supabase/migrations/018_categoria_horario.sql` (novo)
- `lib/api.ts`, `lib/schedule.ts` (novo)
- `types/index.ts`
- `components/modules/StoreModule.tsx`
- `components/modules/ClientModule.tsx`
- `AGENTS.md`
