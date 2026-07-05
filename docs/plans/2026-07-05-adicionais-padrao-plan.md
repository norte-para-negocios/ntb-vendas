# Adicionais de Produto — Virar Recurso Padrão — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Corrigir os 10 achados de bug/robustez e implementar as 2 melhorias
de completude de produto (min/max de seleção, disponibilidade por opção) da
varredura de 2026-07-05 sobre "Adicionais/opcionais de produto"
(migration 016), pra fazer essa feature funcionar em qualquer contexto do
sistema — não só no fluxo QR do cliente numa loja só.

**Architecture:** Migration nova (017) muda o schema e troca o
apaga-e-recria de `syncProductOptionGroups` por uma function Postgres
atômica. `lib/api.ts`/`lib/api-mock.ts` são atualizados em seguida. Daí em
diante, `StoreModule.tsx` (admin + o fluxo do garçom, que hoje não tem
NENHUM suporte a adicional) e `ClientModule.tsx` (enforcement de
min/max/disponibilidade + acessibilidade) — arquivos diferentes, podem
rodar em paralelo depois que a API estiver pronta.

**Tech Stack:** igual ao resto do projeto — Next.js 16, Supabase, sem
framework de teste (`npm run build` como rede de segurança).

**Fora de escopo (documentar, não construir):** meio-a-meio/combo de
sabores como conceito próprio — esforço alto demais, fica só anotado no
AGENTS.md como limitação conhecida.

---

## Track M — Migration (bloqueante pra tudo depois)

### Task M1: `017_adicionais_padrao.sql`

**Files:** Create `supabase/migrations/017_adicionais_padrao.sql`

```sql
-- Amadurece "Adicionais/opcionais de produto" (016) rumo a virar um recurso
-- padrão de verdade (não só testado numa loja): min/max de seleção em
-- grupo multiple, disponibilidade por opção, sync atômico (era apaga+
-- recria via várias chamadas REST separadas, sem transação — falha no
-- meio perdia grupos silenciosamente), e trava contra abuso via
-- option_ids duplicado/sem limite no create_order_secure (achado: um
-- client malicioso podia repetir o mesmo option_id válido milhares de
-- vezes numa única chamada RPC pública, sem autenticação, forçando
-- milhares de round-trips de query). Ver varredura de 2026-07-05.

alter table product_option_groups add column if not exists min_select int;
alter table product_option_groups add column if not exists max_select int;
-- min/max só se aplicam a type='multiple' (single já é 0 ou 1 por natureza
-- do radio button). NULL = sem limite (comportamento atual preservado).

alter table product_options add column if not exists available boolean not null default true;

-- ─── Sync atômico (substitui múltiplas chamadas REST separadas do client) ──
create or replace function public.sync_product_option_groups(
  p_product_id uuid,
  p_groups jsonb -- [{name, type, required, min_select, max_select, options:[{name, price_delta, available}]}]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group jsonb;
  v_option jsonb;
  v_group_id uuid;
  v_group_order int := 0;
  v_option_order int;
begin
  delete from product_option_groups where product_id = p_product_id; -- cascade cuida de product_options

  for v_group in select * from jsonb_array_elements(p_groups)
  loop
    if coalesce(trim(v_group->>'name'), '') = '' then continue; end if;

    insert into product_option_groups (product_id, name, type, required, min_select, max_select, "order")
    values (
      p_product_id, trim(v_group->>'name'), coalesce(v_group->>'type', 'single'),
      coalesce((v_group->>'required')::boolean, false),
      nullif(v_group->>'min_select', '')::int, nullif(v_group->>'max_select', '')::int,
      v_group_order
    )
    returning id into v_group_id;
    v_group_order := v_group_order + 1;

    v_option_order := 0;
    for v_option in select * from jsonb_array_elements(coalesce(v_group->'options', '[]'::jsonb))
    loop
      if coalesce(trim(v_option->>'name'), '') = '' then continue; end if;
      insert into product_options (group_id, name, price_delta, available, "order")
      values (
        v_group_id, trim(v_option->>'name'), coalesce((v_option->>'price_delta')::numeric, 0),
        coalesce((v_option->>'available')::boolean, true), v_option_order
      );
      v_option_order := v_option_order + 1;
    end loop;
  end loop;
end;
$$;

grant execute on function public.sync_product_option_groups(uuid, jsonb) to anon, authenticated;

-- ─── create_order_secure: dedup + limite em option_ids, limite de itens ────
create or replace function public.create_order_secure(
  p_table_id uuid,
  p_store_id uuid,
  p_order_type text,
  p_customer_name text,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_product products%rowtype;
  v_total numeric := 0;
  v_line_total numeric;
  v_option_ids uuid[];
  v_option_id uuid;
  v_option product_options%rowtype;
  v_options_delta numeric;
  v_selected_options jsonb;
begin
  if jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'message', 'Pedido sem itens.');
  end if;
  if jsonb_array_length(p_items) > 100 then
    return jsonb_build_object('success', false, 'message', 'Pedido excede o limite de itens.');
  end if;

  if p_order_type = 'table' and p_table_id is not null then
    select id into v_order_id from orders
    where table_id = p_table_id and status = 'pending'
    limit 1;
  end if;

  if v_order_id is null then
    insert into orders (table_id, store_id, status, order_type, total, customer_name)
    values (p_table_id, p_store_id, 'pending', p_order_type, 0, p_customer_name)
    returning id into v_order_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_product from products where id = (v_item->>'product_id')::uuid and store_id = p_store_id;
    if not found then
      raise exception 'Produto inválido para esta loja.';
    end if;
    if (v_item->>'quantity')::int <= 0 then
      raise exception 'Quantidade inválida.';
    end if;

    v_options_delta := 0;
    v_selected_options := '[]'::jsonb;

    -- DISTINCT: acha real de 2026-07-05 -- sem isso, option_id repetido no
    -- mesmo item soma o price_delta de novo a cada repeticao (nao deixa o
    -- cliente pagar menos, mas e' um vetor de DoS barato via muitas
    -- repeticoes forcando muitas queries dentro de uma unica chamada RPC
    -- publica sem autenticacao).
    select array(
      select distinct (elem)::uuid
      from jsonb_array_elements_text(coalesce(v_item->'option_ids', '[]'::jsonb)) as elem
    ) into v_option_ids;

    if coalesce(array_length(v_option_ids, 1), 0) > 30 then
      raise exception 'Número de adicionais inválido.';
    end if;

    foreach v_option_id in array v_option_ids
    loop
      select po.* into v_option
      from product_options po
      join product_option_groups pog on pog.id = po.group_id
      where po.id = v_option_id and pog.product_id = v_product.id and po.available = true;

      if not found then
        raise exception 'Opção inválida ou indisponível para este produto.';
      end if;

      v_options_delta := v_options_delta + v_option.price_delta;
      v_selected_options := v_selected_options || jsonb_build_object('name', v_option.name, 'price_delta', v_option.price_delta);
    end loop;

    v_line_total := (v_product.price + v_options_delta) * (v_item->>'quantity')::int;
    v_total := v_total + v_line_total;

    insert into order_items (order_id, product_id, quantity, status, notes, price_at_time, selected_options)
    values (
      v_order_id, v_product.id, (v_item->>'quantity')::int, 'pending', v_item->>'notes',
      v_product.price + v_options_delta, v_selected_options
    );
  end loop;

  update orders set total = total + v_total where id = v_order_id;

  return jsonb_build_object('success', true, 'order_id', v_order_id, 'total', v_total);
exception when others then
  return jsonb_build_object('success', false, 'message', SQLERRM);
end;
$$;

grant execute on function public.create_order_secure(uuid, uuid, text, text, jsonb) to anon, authenticated;
```

**Step 2:** Aplicar: `node scripts/aplicar-migration.mjs 017_adicionais_padrao.sql`
(agora já temos `.env.local`/`SUPABASE_DB_URL` configurado — aplicar de
verdade, não deixar pendente como da vez passada).

**Step 3:** Verificar:
```
node scripts/db.mjs "select proname from pg_proc where proname in ('sync_product_option_groups','create_order_secure')"
node scripts/db.mjs "select column_name from information_schema.columns where table_name='product_option_groups' and column_name in ('min_select','max_select')"
node scripts/db.mjs "select column_name from information_schema.columns where table_name='product_options' and column_name='available'"
```

**Step 4:** Commit: `feat: min/max de selecao, disponibilidade por opcao, sync atomico e trava contra abuso em option_ids`

---

## Track A — Camada de dados (depende de M1 aplicada)

### Task A1: Atualizar `lib/api.ts` e `types/index.ts`

**Files:** Modify `lib/api.ts`, `types/index.ts`

1. `types/index.ts`: `ProductOptionGroup` ganha `min_select?: number | null`,
   `max_select?: number | null`. `ProductOption` ganha `available: boolean`.
   `ProductOptionGroupInput`/o tipo de opção correspondente em `lib/api.ts`
   ganham os mesmos campos.
2. `syncProductOptionGroups`: trocar a implementação (delete + loop de
   inserts separados) por uma única chamada `supabase.rpc('sync_product_option_groups', { p_product_id: productId, p_groups: groups })`.
   Manter a assinatura pública (mesmos parâmetros de entrada) — nenhum
   call site em `StoreModule.tsx` precisa mudar por causa disso.
3. `attachOptionGroups`: mover a query de `product_option_groups` pra
   dentro do `Promise.all` já existente em `fetchMenu` (paralelizar com as
   queries de categorias/produtos, em vez de rodar depois) e adicionar
   `.limit(500)` na query de grupos e na de opções (mesmo padrão de
   `fetchActiveOrdersForTables`/`fetchKitchenOrders`, que já comentam essa
   preocupação). Também filtrar `product_options` só as `available = true`
   quando a chamada for pro cardápio do cliente (`fetchMenu`) — o lojista
   continua vendo todas (inclusive indisponíveis) quando edita o produto,
   então crie um parâmetro `includeUnavailable` opcional em
   `attachOptionGroups`/`fetchMenu` usado só pelo `MenuManagementView`.

**Step 2:** `npm run build`. **Step 3:** Commit: `feat: sync atomico via RPC, disponibilidade por opcao filtrada no cardapio do cliente, query paralelizada`

### Task A2: Corrigir `lib/api-mock.ts`

**Files:** Modify `lib/api-mock.ts`

Achado: `syncProductOptionGroups` **não existe** no mock — quebra TODO
"Salvar Produto" (não só a parte de adicionais) quando `USE_MOCK=true`.
Adicionar um `syncProductOptionGroups` no-op (só resolve a Promise, não
precisa persistir de verdade no mock) e fazer o `fetchMenu` do mock anexar
`option_groups: []` (ou dados fixos de exemplo, se quiser testar a UI) em
cada produto, pra bater com a assinatura que `ClientModule.tsx` espera.

**Step 2:** `npm run build`. **Step 3:** Commit: `fix: adiciona syncProductOptionGroups e option_groups no mock (USE_MOCK=true)`

---

## Track B — `StoreModule.tsx` (sequencial internamente, depende de A1)

### Task B1: Fluxo do garçom ganha suporte a adicionais (o achado mais importante)

**Files:** Modify `components/modules/StoreModule.tsx`

Hoje `StoreProductModal`/`StoreTableMenu` (usados por
`TablesView.handleAddItem`, quando o garçom lança item manualmente na
comanda) são componentes **separados** do `ProductModal` do cliente, sem
nenhum seletor de adicional — se o produto tem grupo obrigatório, o
garçom adiciona sem escolher nada, preço sai errado.

**Abordagem:** replicar no `StoreProductModal` a mesma lógica de seleção
que já existe no `ProductModal` de `ClientModule.tsx` (grupos, tipo
single/multiple, obrigatório, cálculo de preço, bloqueio de "Adicionar" se
faltar obrigatório) — adaptada ao estilo visual do painel do lojista, não
precisa ser idêntica em CSS, só equivalente em capacidade. `onAdd` de
`StoreProductModal` passa a receber `selectedOptions` também;
`handleAddItem`/`onAddItem` em `TablesView` e `StoreTableMenu` propagam
esse parâmetro até o `createOrder` (que já aceita `selectedOptions` no
`CartItem`, não precisa mudar `lib/api.ts` de novo).

Também: usar `getOrderItemDisplayName` (já existe) em qualquer exibição de
item dentro desse fluxo que ainda mostre nome cru.

**Step 2:** `npm run build` + smoke test manual (logar como lojista,
adicionar item de produto com grupo obrigatório direto na comanda de uma
mesa, confirmar que o seletor aparece e o preço soma certo).
**Step 3:** Commit: `fix: garcom consegue escolher adicionais ao lancar item manual na comanda`

### Task B2: Formulário de produto — min/max, disponibilidade, reordenar, ajuda, validação

**Files:** Modify `components/modules/StoreModule.tsx`

Na seção "Adicionais deste produto" (`MenuManagementView`):
1. Quando o tipo do grupo for "multiple", mostrar campos opcionais "Mínimo"
   e "Máximo" de seleção (inputs numéricos, vazio = sem limite).
2. Cada opção ganha um toggle "Disponível" (default ligado) — desligar não
   apaga a opção, só marca indisponível (resolve "acabou o Catupiry" sem
   perder a configuração).
3. Reordenar opções dentro de um grupo via drag-and-drop, reusando o
   padrão `@hello-pangea/dnd` já usado pra categoria/produto no mesmo
   arquivo.
4. Texto de ajuda curto abaixo dos radios "Escolha 1"/"Escolha vários"
   explicando a diferença, e uma nota que "Obrigatório" bloqueia o
   "+"-rápido do cliente.
5. **Validação antes de salvar**: se algum grupo `required` tiver zero
   opções, bloquear o save com um toast de erro claro ("Grupo 'X' está
   marcado como obrigatório mas não tem nenhuma opção — adicione uma opção
   ou desmarque obrigatório"). Resolve o achado de produto ficar
   "brickado" pro cliente sem nenhum aviso.
6. Soft-cap client-side razoável (ex.: 20 grupos, 30 opções por grupo) —
   se ultrapassar, `addOptionGroup`/`addOption` mostram um toast em vez de
   adicionar mais, evitando o cenário de centenas de round-trips numa save
   só.

**Step 2:** `npm run build` + smoke test (criar grupo multiple com
max_select=2, criar opção e desmarcar disponível, reordenar opções,
tentar salvar grupo obrigatório vazio e confirmar bloqueio).
**Step 3:** Commit: `feat: min/max de selecao, disponibilidade por opcao, reordenar e validacao no formulario de adicionais`

### Task B3: Relatório impresso, CSV e "Top 5" mostram produto+adicional

**Files:** Modify `components/modules/StoreModule.tsx`, `components/modules/StoreDashboardView.tsx`, `lib/print.ts`, `lib/csv.ts`

1. `lib/print.ts`: `SalesReportRow` ganha um campo `itemsSummary?: string`
   (ou lista) além do `items: number` — `handlePrintReport`/
   `handleExportCsv` em `StoreModule.tsx` passam a montar isso com
   `getOrderItemDisplayName` por item em vez de só a contagem.
2. `lib/csv.ts`: mesma mudança pro export.
3. `StoreDashboardView.tsx`: `productStats` (Top 5 mais/menos vendidos)
   agrupa hoje só por `product_id` — trocar a chave de agrupamento pra
   incluir a assinatura dos adicionais (mesmo princípio de
   `optionsSignature` já usado no dedup do carrinho em
   `context/AppContext.tsx`), então "Pizza + Catupiry" e "Pizza +
   Mussarela" aparecem como linhas separadas no ranking.

**Step 2:** `npm run build`. **Step 3:** Commit: `fix: relatorio, csv e top-5 do dashboard mostram produto+adicional em vez de so contagem/produto base`

---

## Track C — `components/modules/ClientModule.tsx` (paralelo à Track B, depende de A1)

### Task C1: Enforcement de min/max/disponibilidade + acessibilidade

**Files:** Modify `components/modules/ClientModule.tsx`

1. No `ProductModal`: quando `group.max_select` estiver definido e o
   número de selecionados atingir o limite, desabilitar os checkboxes não
   marcados do grupo (mostrar "X de Y selecionados"). Quando
   `group.min_select`/`required` exigir mais de uma seleção, o cálculo de
   `missingRequired` passa a comparar contra
   `Math.max(group.min_select || (group.required ? 1 : 0), group.required ? 1 : 0)`
   em vez de só `length === 0`.
2. Filtrar `group.options` pra mostrar só `option.available !== false` —
   já deve vir filtrado do servidor (Task A1), mas manter o filtro no
   client como defesa extra.
3. Acessibilidade: envolver cada grupo num `<fieldset>` com `<legend>` (em
   vez de `<h4>` solto) e `aria-required="true"` nos inputs de grupo
   obrigatório. Aumentar a área de toque de cada linha de opção pra pelo
   menos 44px (mesmo padrão já usado nos botões +/- de quantidade e no
   `ProductCard`, achado da auditoria anterior).
4. `CartModal`: trocar a reconstrução manual da label
   `${item.selectedOptions.map(o => o.name).join(', ')}` por uma função
   nova `getCartItemDisplayName` em `lib/labels.ts` (mesmo formato de
   `getOrderItemDisplayName`, mas pro shape de `CartItem.selectedOptions`
   em vez de `OrderItem.selected_options`) — elimina a duplicação de
   formatação que podia divergir silenciosamente.

**Step 2:** `npm run build` + smoke test (produto com grupo multiple
max_select=2: marcar 2, confirmar que a 3ª opção desabilita; navegar só de
teclado até uma opção e confirmar leitura correta do grupo).
**Step 3:** Commit: `feat: enforce min/max e disponibilidade no cardapio do cliente, acessibilidade do seletor de adicionais`

---

## Track D — Documentação (último passo)

### Task D1: Atualizar `AGENTS.md`

**Files:** Modify `AGENTS.md`

1. Atualizar a seção "Adicionais/opcionais de produto" com: min/max de
   seleção, disponibilidade por opção, sync atômico via
   `sync_product_option_groups`, e o suporte novo no fluxo do garçom.
2. Referenciar a migration 017 na seção "Banco de dados".
3. Documentar como **limitação conhecida, não implementada de propósito**:
   meio-a-meio/combo de sabores — motivo (esforço alto, modelo de dados
   diferente) e que fica pra quando/se for pedido explicitamente.
4. Marcar os achados da varredura de 2026-07-05 como resolvidos.

**Step 2:** `npm run build`. **Step 3:** Commit: `docs: atualiza AGENTS.md com adicionais virando recurso padrao (migration 017)`

---

## Resumo de arquivos tocados

- `supabase/migrations/017_adicionais_padrao.sql` (novo)
- `lib/api.ts`, `lib/api-mock.ts`, `lib/print.ts`, `lib/csv.ts`, `lib/labels.ts`
- `types/index.ts`
- `components/modules/StoreModule.tsx`
- `components/modules/StoreDashboardView.tsx`
- `components/modules/ClientModule.tsx`
- `AGENTS.md`
