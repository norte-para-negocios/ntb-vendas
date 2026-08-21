# Correções pré-lançamento (O Sertão Vai Virar Mar) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os 4 bugs/gaps concretos achados ao vivo na reunião de teste de 2026-08-19 com Ramon/André/João na loja "O Sertão Vai Virar Mar" (`/c/sertao-vai-virar-mar`), antes da virada de produção marcada pro dia 1º de setembro de 2026.

**Architecture:** Todas as mudanças são cirúrgicas em código já existente — sem tabela nova além de 1 coluna, sem rota nova. Task 1 e 2 são puramente aditivas (não mudam comportamento de nenhum item que já funciona certo hoje). Task 3 é 1 linha de lógica em um hook já existente. Task 4 adiciona 1 coluna + 1 parâmetro de RPC + 1 badge visual.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Supabase Postgres (self-hosted, `testvendase.norteparanegocios.com.br`) — migrations aplicadas via `node scripts/aplicar-migration.mjs <arquivo>.sql`.

**Spec:** Não existe documento de design separado — a fonte de verdade é a transcrição da reunião de 2026-08-19 (`/tmp/etl-raw-reuniao.md`, arquivo local temporário da sessão que gerou este plano) cruzada com investigação de código feita na mesma sessão. Cada task abaixo cita o timestamp exato da reunião de onde veio o pedido.

## Global Constraints

- **Este projeto não tem suite de testes automatizada** (sem jest/vitest/playwright configurado, `package.json` só tem `dev`/`build`/`start`/`lint`). Por isso os passos de cada task abaixo substituem "escreva o teste falho / rode o teste" por **verificação manual** com procedimento exato (via `npm run dev` local + navegador, ou consulta direta ao Postgres com `node scripts/db.mjs "..."`) — nunca pular a verificação, só o formato dela é diferente do template padrão desta skill.
- **Loja de teste**: "O Sertão Vai Virar Mar" está com `store_fiscal_config.ambiente = 'homologacao'` (confirmado por query direta em 2026-08-20) — seguro pra testar emissão fiscal de ponta a ponta sem gerar documento fiscal real. **Nunca mudar esse campo pra `'producao'` como parte deste plano.**
- **Nunca rodar `npm run dev` local pra testar fluxo que persiste dado de venda de verdade contra a loja real** — o `.env.local` aponta pro mesmo Supabase self-hosted de produção (`AGENTS.md`, seção "Decisões de arquitetura"). Qualquer teste manual que crie pedido/mesa deve limpar o dado de teste depois (mesmo princípio já seguido em todo o histórico deste repo, ver `AGENTS.md`).
- Migrations deste repo são aplicadas manualmente, sem tracking automático (`node scripts/aplicar-migration.mjs NNN_x.sql`) — depois de aplicar, sempre confirmar com `node scripts/db.mjs "\d nome_da_tabela"` ou equivalente, nunca assumir que rodou só porque o arquivo existe no repo.
- Rodar `npm run build` antes de cada commit que mude `.ts`/`.tsx` (valida tipos) — convenção já estabelecida no `AGENTS.md` deste repo.
- Próxima migration livre: **`046_*.sql`** (última existente é `045_contrato_sem_prazo.sql`).

---

### Task 1: Descrição do item (com adicionais/variação) na nota fiscal e no cupom

**Origem:** reunião 2026-08-19, ~21:47–22:35 — "o código vem, mas a descrição não vem", classificado como algo a corrigir "essa semana".

**Causa raiz confirmada:** `app/api/fiscal/emitir/route.ts` monta o `xProd` (descrição do item no XML fiscal) só com `product.name` (linha 385), sem nunca incluir os adicionais/variação escolhidos (ex.: "Tamanho: Grande", "Sabor: Calabresa") — diferente do recibo/comanda impressa, que já usa `getOrderItemDisplayName` (`lib/labels.ts`) e mostra isso corretamente. A query que busca os itens (linha 213) nem sequer traz a coluna `selected_options`, que é onde esses adicionais ficam gravados (snapshot no momento do pedido). Junto disso, o acesso a `product.name`/`.ncm`/`.omie_codigo` nas linhas 384-386 não usa optional chaining (`(i as any).product.name`), diferente da checagem de NCM da linha 221 (`(i as any).product?.ncm`) — se `product` vier `null` (produto excluído depois do pedido, `order_items.product_id` tem `on delete set null`), a rota quebra com exceção não tratada em vez de cair no fluxo já existente de "erro, sem NCM" com mensagem clara.

**Files:**
- Modify: `app/api/fiscal/emitir/route.ts:213` (query), `:221` (guarda de NCM), `:380-389` (montagem de `itensXml`)

**Interfaces:**
- Consome: `lib/labels.ts` já exporta `getOrderItemDisplayName(item: { product: {name}; selected_options?: {name; price_delta}[] })` — reaproveitar a MESMA lógica de formatação (não duplicar), mas sem os R$ de adicionais (o XML fiscal não tem espaço pra isso, só o nome).
- Produz: nenhuma interface nova — o formato de retorno da rota não muda.

- [ ] **Passo 1: Ampliar a query de itens pra trazer `selected_options`**

Em `app/api/fiscal/emitir/route.ts:213`, trocar:
```ts
    .select('quantity, status, price_at_time, product:products(id, name, ncm, omie_codigo)')
```
por:
```ts
    .select('quantity, status, price_at_time, selected_options, product:products(id, name, ncm, omie_codigo)')
```

- [ ] **Passo 2: Corrigir o acesso inseguro a `product` na guarda de NCM (linha 221) — já está seguro, só confirmar que continua assim**

A linha 221 já usa `(i as any).product?.ncm` — não precisa de mudança. Deixado aqui só pra deixar explícito que o Passo 3 abaixo precisa seguir o MESMO padrão de segurança, não o padrão inseguro da linha 384-386 antiga.

- [ ] **Passo 3: Montar a descrição com adicionais e corrigir o null-safety, em `app/api/fiscal/emitir/route.ts:380-389`**

Trocar:
```ts
    const itensXml: ItemNota[] = itensValidos.map((i) => ({
      // omie_codigo é o SKU real (ex.: "90935"), legível no cupom impresso.
      // Fallback pro UUID truncado só cobre produtos cadastrados manualmente
      // sem vínculo com o Omie (omie_codigo null) — nunca deve faltar código.
      cProd: (i as any).product.omie_codigo || String((i as any).product.id).slice(0, 8),
      xProd: (i as any).product.name,
      ncm: (i as any).product.ncm,
      qCom: i.quantity,
      vUnCom: Number(i.price_at_time),
    }));
```
por:
```ts
    const itensXml: ItemNota[] = itensValidos.map((i) => {
      const produto = (i as any).product;
      // Descrição do item precisa incluir a variação/adicional escolhido
      // (ex.: "Pizza Calabresa (Grande)") — sem isso, duas linhas de pedido
      // do mesmo produto-base com tamanhos/sabores diferentes aparecem
      // idênticas na nota/cupom (achado real, reunião 2026-08-19). Mesmo
      // princípio de `getOrderItemDisplayName` (lib/labels.ts), sem o R$ dos
      // adicionais (não cabe no xProd fiscal).
      const adicionais = ((i as any).selected_options as { name: string }[] | null | undefined) || [];
      const nomeComVariacao = adicionais.length
        ? `${produto?.name ?? 'Produto'} (${adicionais.map((o) => o.name).join(', ')})`
        : (produto?.name ?? 'Produto');
      return {
        // omie_codigo é o SKU real (ex.: "90935"), legível no cupom impresso.
        // Fallback pro UUID truncado só cobre produtos cadastrados manualmente
        // sem vínculo com o Omie (omie_codigo null) — nunca deve faltar código.
        cProd: produto?.omie_codigo || String(produto?.id ?? i.product_id ?? '').slice(0, 8),
        xProd: nomeComVariacao,
        ncm: produto?.ncm,
        qCom: i.quantity,
        vUnCom: Number(i.price_at_time),
      };
    });
```

Nota: `montarXProd` (`lib/fiscal/xml.ts:90-93`) já trunca em 120 caracteres e escapa XML — não precisa mexer lá, só garantir que o texto que chega em `item.xProd` já inclui a variação.

- [ ] **Passo 4: Verificação manual (sem teste automatizado neste repo)**

1. `npm run build` — confirma que o `as any` continua compilando limpo (nenhum tipo novo introduzido, só leitura defensiva).
2. Em `npm run dev` local, criar um pedido de teste na loja "O Sertão Vai Virar Mar" com um item que tenha adicional/variação (ex.: uma pizza com grupo "Tamanho"), fechar a conta com o toggle de emissão automática em `'nfce'` (confirmar antes que `store_fiscal_config.ambiente = 'homologacao'` pra essa loja — ver Global Constraints).
3. Consultar a nota gerada em `fiscal_notas`/o cupom (aba "Notas Fiscais" do lojista) e confirmar que a descrição do item mostra o nome do produto + a variação escolhida entre parênteses, não só o nome base.
4. Apagar o pedido/nota de teste ao final (mesmo princípio de limpeza já seguido em todo o histórico deste repo).

- [ ] **Passo 5: Commit**

```bash
git add app/api/fiscal/emitir/route.ts
git commit -m "fix: inclui adicionais/variacao na descricao do item fiscal e corrige acesso inseguro a product"
```

---

### Task 2: "A partir de R$X" em produtos com variação de tamanho/sabor

**Origem:** reunião 2026-08-19, ~25:20–28:10 — card de produto mostrando um preço fixo do lado, mesmo quando o produto tem variações com preços diferentes (ex.: pizza com Tamanho M/G, cada um com preço diferente); decidiram ao vivo: "acho que o ideal é não aparecer o preço do lado... bota lá a partir disso".

**Causa raiz confirmada:** `ProductCard` (`components/modules/ClientModule.tsx:884`) sempre renderiza `R$ {getEffectivePrice(product).toFixed(2)}` sem checar se o produto tem `option_groups` com variação de preço real. Como a ferramenta "Agrupar como variações" (`consolidateProductsIntoVariants`, `lib/api.ts:441-458`) sempre usa o produto MAIS BARATO como base e grava `price_delta: Math.max(0, p.price - base.price)` (nunca negativo — `CHECK` do banco), **`product.price` já é sempre o menor preço da variação** — não precisa nenhum cálculo novo, só decidir SE mostra o prefixo "A partir de".

**Files:**
- Modify: `components/modules/ClientModule.tsx` (`ProductCard`, em torno da linha 884)

**Interfaces:**
- Consome: `product.option_groups: ProductOptionGroup[]`, cada grupo com `options: { price_delta: number }[]` (já existe, `lib/api.ts:240-266`).
- Produz: nenhuma interface nova.

- [ ] **Passo 1: Escrever o helper de decisão (sem coluna nova, é lógica pura sobre dado já carregado)**

Em `components/modules/ClientModule.tsx`, perto de onde `ProductCard` está definido (ou em `lib/calc.ts`, se preferir centralizar com `getEffectivePrice` — mais consistente com a convenção já documentada no `AGENTS.md`, "fonte única da fórmula"), adicionar:
```ts
// Produto com grupo de opção que tem ALGUMA variação de preço real (ex.:
// "Tamanho" G custa mais que M) precisa do prefixo "A partir de" — senão o
// preço fixo do card é enganoso (mostra só o preço da variação mais barata
// como se fosse o preço do produto inteiro). Grupos só com price_delta=0 em
// todas as opções (ex.: "Ponto da carne", sem custo extra) não contam.
function hasVariablePricing(product: { option_groups?: { options: { price_delta: number }[] }[] }): boolean {
  return (product.option_groups || []).some((g) => g.options.some((o) => o.price_delta > 0));
}
```

- [ ] **Passo 2: Aplicar o prefixo no render do preço**

Em `components/modules/ClientModule.tsx:884`, trocar:
```tsx
                            <span className="font-bold num text-[15px]" style={{ color: WINE_GOLD }}>R$ {getEffectivePrice(product).toFixed(2)}</span>
```
por:
```tsx
                            <span className="font-bold num text-[15px]" style={{ color: WINE_GOLD }}>
                                {hasVariablePricing(product) && <span className="font-normal text-[11px] mr-0.5">A partir de</span>} R$ {getEffectivePrice(product).toFixed(2)}
                            </span>
```

- [ ] **Passo 3: Verificação manual**

1. `npm run build`.
2. Em `npm run dev` local, abrir `/c/sertao-vai-virar-mar` (ou outra loja com variação real de tamanho, ex. família de pizzas já consolidada em 2026-08-16) e confirmar visualmente: produto com grupo de tamanho cujas opções têm `price_delta > 0` mostra "A partir de R$X"; produto sem variação, ou com variação só de `price_delta = 0` (ex. "Ponto da carne"), continua mostrando só "R$X" como hoje.

- [ ] **Passo 4: Commit**

```bash
git add components/modules/ClientModule.tsx
git commit -m "fix: mostra 'A partir de' no preco de produtos com variacao de tamanho/sabor com custo real"
```

---

### Task 3: Alerta sonoro/visual distinto pra chamada de garçom

**Origem:** reunião 2026-08-19, ~24:36–24:59 — notificação de "chamar garçom"/mesa não estava chamando atenção do jeito esperado ("deve estar com bug").

**Causa raiz confirmada:** o recurso já existe fim-a-fim (RPC `request_waiter_secure`, badge no card da mesa, contador no menu lateral) — o que falta é o **alerta sonoro/toast**. Em `useStoreNotifications` (`components/modules/StoreModule.tsx:241-320`), o `tableCount` (que inclui chamada de garçom, linha 263) É computado, mas só `kitchenCount + barCount` (linha 295) dispara `playNewOrderAlert()`/`vibrateAlert()`/toast (linhas 296-302). Uma chamada de garçom sozinha, sem cozinha/bar mudando ao mesmo tempo, produz só uma mudança silenciosa de número no badge — ninguém que não estiver olhando pra tela percebe.

**Files:**
- Modify: `components/modules/StoreModule.tsx:241-320` (`useStoreNotifications`)

**Interfaces:**
- Consome: `playNewOrderAlert`/`vibrateAlert` (já importados/usados no mesmo arquivo).
- Produz: nenhuma interface nova.

- [ ] **Passo 1: Rastrear o `tableCount` anterior separadamente do total de cozinha/bar**

Em `components/modules/StoreModule.tsx`, logo abaixo de `const prevTotalRef = useRef<number | null>(null);` (linha 245), adicionar:
```ts
    // Rastreado separado de prevTotalRef (kitchen+bar) porque "mesa" precisa
    // de um alerta com texto diferente ("chamada de mesa" vs "pedido novo") —
    // ver achado real, reuniao 2026-08-19: chamada de garcom so mudava um
    // numero no badge, sem som, porque só kitchen+bar disparavam alerta.
    const prevTableCountRef = useRef<number | null>(null);
```

- [ ] **Passo 2: Disparar o alerta também quando `tableCount` aumenta, com mensagem distinta**

Logo depois do bloco existente (após a linha 302, `toast.info('Novo pedido chegou! 🔔');` e seu `}` de fechamento), adicionar:
```ts
                const prevTableCount = prevTableCountRef.current;
                prevTableCountRef.current = tableCount;
                if (prevTableCount !== null && tableCount > prevTableCount) {
                    playNewOrderAlert();
                    vibrateAlert([100, 60, 100]);
                    toast.info('Atenção na mesa! 🔔');
                }
```

- [ ] **Passo 3: Verificação manual**

1. `npm run build`.
2. Em `npm run dev` local, com o painel do lojista aberto numa aba de mesas, abrir o cardápio do cliente (`/c/<slug>`) em outra aba/dispositivo numa mesa já ocupada e clicar "Chamar garçom". Confirmar que a aba do lojista toca o alerta sonoro e mostra o toast "Atenção na mesa! 🔔", mesmo sem nenhum pedido novo de cozinha/bar acontecendo ao mesmo tempo.
3. Confirmar que o alerta de cozinha/bar (`'Novo pedido chegou! 🔔'`) continua dessincronizado da mesa — os dois podem tocar juntos ou separados, sem um mascarar o outro.

- [ ] **Passo 4: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "fix: chamada de garcom/mesa dispara alerta sonoro proprio, nao so muda contador silencioso"
```

---

### Task 4: Diferenciar pedido lançado pelo cliente do lançado pelo garçom

**Origem:** reunião 2026-08-19, ~43:39–43:58 — durante o teste ao vivo, o pedido feito pelo próprio Ramon (logado como garçom/staff) aparecia com o nome de login dele, sem nenhuma indicação de que foi lançamento manual de staff em vez de pedido real do cliente na mesa ("aqui vai ser o nome do garçom e com aviso que foi o garçom, pra poder diferenciar do cliente e do garçom").

**Causa raiz confirmada:** `order_items` não tem nenhuma coluna que registre quem/como o item foi lançado. Os dois fluxos (`ClientModule.tsx:2240`, checkout do cliente, e `StoreModule.tsx:1487`, `handleAddItem` do garçom) chamam a MESMA função `createOrder`/RPC `create_order_secure` sem nenhuma flag — pior, o fluxo do garçom passa `loggedUser.name` (o nome de login do funcionário) no mesmo parâmetro `customerName` que o cliente usa pro próprio nome, então não dá pra diferenciar nem heuristicamente pelo `notes`/`customer_name`.

**Files:**
- Create: `supabase/migrations/046_added_by_role_order_items.sql`
- Modify: `supabase/migrations/028_omie_codigo_em_selected_options.sql` — **não**, migrations antigas nunca são editadas retroativamente neste repo (cada mudança é uma migration nova); a `046` recria `create_order_secure` do zero com o `CREATE OR REPLACE` de sempre, copiando o corpo da 028 + a mudança.
- Modify: `lib/api.ts` (`createOrder`)
- Modify: `components/modules/StoreModule.tsx:1487` (`handleAddItem`)
- Modify: `components/modules/ClientModule.tsx:2240` (`submitOrder`)
- Modify: `components/modules/StoreModule.tsx` (`TablesView`, onde os itens do pedido de uma mesa são listados — badge visual)

**Interfaces:**
- Consome: nada novo de outra task.
- Produz: `order_items.added_by_role: 'cliente' | 'garcom'` (nova coluna, lida por qualquer tela que listar itens de pedido); `createOrder(tableId, storeId, items, customerName?, addedByRole?: 'cliente' | 'garcom')` — 5º parâmetro novo, **opcional com default `'cliente'`** pra não quebrar nenhum outro call site além dos 2 já mapeados.

- [ ] **Passo 1: Migration — coluna nova + `create_order_secure` atualizada**

Criar `supabase/migrations/046_added_by_role_order_items.sql`:
```sql
-- Achado real, reuniao 2026-08-19: o fluxo do garcom (StoreModule.tsx,
-- handleAddItem) manda o NOME DE LOGIN do funcionario no mesmo parametro
-- customerName que o cliente usa pro proprio nome no checkout -- nao dava
-- pra diferenciar "pedido feito pelo cliente na mesa" de "item lancado
-- manualmente pelo garcom" nem heuristicamente. Coluna nova + parametro novo
-- na RPC, default 'cliente' pra nunca quebrar nenhuma chamada existente que
-- nao passe o parametro.
alter table order_items
  add column added_by_role text not null default 'cliente'
  check (added_by_role in ('cliente', 'garcom'));

create or replace function public.create_order_secure(
  p_table_id uuid,
  p_store_id uuid,
  p_order_type text,
  p_customer_name text,
  p_items jsonb,
  p_added_by_role text default 'cliente'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_product products%rowtype;
  v_preco_efetivo numeric;
  v_total numeric := 0;
  v_line_total numeric;
  v_option_ids uuid[];
  v_option_id uuid;
  v_option product_options%rowtype;
  v_options_delta numeric;
  v_selected_options jsonb;
begin
  if p_added_by_role not in ('cliente', 'garcom') then
    return jsonb_build_object('success', false, 'message', 'added_by_role inválido.');
  end if;

  if jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'message', 'Pedido sem itens.');
  end if;
  if jsonb_array_length(p_items) > 100 then
    return jsonb_build_object('success', false, 'message', 'Pedido excede o limite de itens.');
  end if;

  if p_order_type = 'table' and p_table_id is not null then
    if not exists (select 1 from tables t where t.id = p_table_id and t.store_id = p_store_id) then
      return jsonb_build_object('success', false, 'message', 'Mesa inválida para esta loja.');
    end if;
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

    v_preco_efetivo := coalesce(v_product.promo_price, v_product.price);

    v_options_delta := 0;
    v_selected_options := '[]'::jsonb;

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
      v_selected_options := v_selected_options || jsonb_build_object(
        'name', v_option.name,
        'price_delta', v_option.price_delta,
        'omie_codigo', v_option.omie_codigo
      );
    end loop;

    v_line_total := (v_preco_efetivo + v_options_delta) * (v_item->>'quantity')::int;
    v_total := v_total + v_line_total;

    insert into order_items (order_id, product_id, quantity, status, notes, price_at_time, selected_options, added_by_role)
    values (
      v_order_id, v_product.id, (v_item->>'quantity')::int, 'pending', v_item->>'notes',
      v_preco_efetivo + v_options_delta, v_selected_options, p_added_by_role
    );
  end loop;

  update orders set total = total + v_total where id = v_order_id;

  return jsonb_build_object('success', true, 'order_id', v_order_id, 'total', v_total);
exception when others then
  return jsonb_build_object('success', false, 'message', SQLERRM);
end;
$$;

grant execute on function public.create_order_secure(uuid, uuid, text, text, jsonb, text) to anon, authenticated;
```

Aplicar com:
```bash
node scripts/aplicar-migration.mjs 046_added_by_role_order_items.sql
```

Confirmar que aplicou de verdade (convenção deste repo — nunca assumir só porque o arquivo existe):
```bash
node scripts/db.mjs "select column_name from information_schema.columns where table_name = 'order_items' and column_name = 'added_by_role';"
node scripts/db.mjs "select pg_get_functiondef('create_order_secure'::regproc);" | grep -c "p_added_by_role"
```

- [ ] **Passo 2: `lib/api.ts` — `createOrder` ganha o parâmetro novo**

Localizar `export const createOrder = async (...)` (linha 765) e trocar a assinatura + a chamada RPC:
```ts
export const createOrder = async (
  tableId: string | null,
  storeId: string,
  items: CartItem[],
  customerName?: string,
  addedByRole: 'cliente' | 'garcom' = 'cliente',
): Promise<{ success: boolean; orderId?: string }> => {
  try {
    const isCounter = tableId === null;

    const pItems = items.map((item) => ({
      product_id: item.product.id,
      quantity: item.quantity,
      notes: item.notes
        ? `${customerName ? `[${customerName}] ` : ''}${item.notes}`
        : customerName
        ? `[${customerName}]`
        : '',
      option_ids: (item.selectedOptions || []).map(o => o.option_id),
    }));

    const { data, error } = await supabase.rpc('create_order_secure', {
      p_table_id: tableId,
      p_store_id: storeId,
      p_order_type: isCounter ? 'counter' : 'table',
      p_customer_name: customerName || null,
      p_items: pItems,
      p_added_by_role: addedByRole,
    });
```
(resto da função sem mudança).

- [ ] **Passo 3: Marcar o fluxo do garçom explicitamente**

Em `components/modules/StoreModule.tsx:1487` (`handleAddItem`), trocar:
```ts
            await createOrder(selectedTable.id, storeId, [{
                product, quantity: qty, notes: finalNotes, selectedOptions
            }], loggedUser.name);
```
por:
```ts
            await createOrder(selectedTable.id, storeId, [{
                product, quantity: qty, notes: finalNotes, selectedOptions
            }], loggedUser.name, 'garcom');
```

- [ ] **Passo 4: Marcar o fluxo do cliente explicitamente (redundante com o default, mas deixa a intenção legível no call site)**

Em `components/modules/ClientModule.tsx:2240` (`submitOrder`), trocar:
```ts
            const result = await createOrder(tableId, currentStore.id, cart, clientName);
```
por:
```ts
            const result = await createOrder(tableId, currentStore.id, cart, clientName, 'cliente');
```

- [ ] **Passo 5: Badge visual em `TablesView` — mostrar quando um item foi lançado pelo garçom**

Localizar em `components/modules/StoreModule.tsx` (`TablesView`) o ponto onde os itens de uma mesa aberta são listados na comanda (mesmo lugar de onde vem o `getOrderItemDisplayName` já usado hoje pra nome+adicionais). Ao lado do nome do item, quando `item.added_by_role === 'garcom'`, adicionar um badge pequeno:
```tsx
{item.added_by_role === 'garcom' && (
    <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-[var(--info)]/15 text-[var(--info)]">
        Garçom
    </span>
)}
```
Ajustar o nome exato da variável de item local nesse ponto do JSX conforme o código real (o campo `added_by_role` já vem pronto de `fetch_active_table_orders_secure`/`fetch_table_order_summary_secure`, que devolvem `order_items.*` — não precisa mudar as RPCs de leitura, `select *` já inclui a coluna nova).

- [ ] **Passo 6: Verificação manual**

1. `npm run build`.
2. Em `npm run dev` local: (a) abrir uma mesa como cliente via `/c/<slug>`, pedir um item — confirmar no painel do lojista que o item NÃO mostra o badge "Garçom"; (b) logado como staff, usar "Adicionar item" na mesma mesa pra lançar outro item manualmente — confirmar que ESSE item mostra o badge "Garçom" na comanda.
3. `node scripts/db.mjs "select id, added_by_role from order_items order by created_at desc limit 5;"` — confirmar os dois valores gravados corretamente.
4. Apagar a mesa/pedido de teste ao final.

- [ ] **Passo 7: Commit**

```bash
git add supabase/migrations/046_added_by_role_order_items.sql lib/api.ts components/modules/StoreModule.tsx components/modules/ClientModule.tsx
git commit -m "feat: diferencia pedido lancado pelo cliente do lancado pelo garcom (added_by_role)"
```

---

## Fora de escopo desta rodada (registrado pra não se perder, não implementar sem pedido explícito)

- **Impressão automática de comanda na cozinha/bar** (reunião, ~15:39–17:26 e ~41:41–41:58, confirmado ao vivo "esse aí não tá funcionando"). Investigação confirmou que **não existe nenhum código de impressora hoje** (`grep` por `impressora|printer|escpos` no repo inteiro: zero resultados) — o único mecanismo existente é impressão manual via `window.print()` do navegador (`lib/print.ts`). A própria reunião não fechou o desenho (ativo/inativo por lojista foi mencionado, mas não qual mecanismo técnico: impressora de rede/USB via ESC-POS, ou impressão silenciosa do navegador). Precisa de uma sessão de brainstorming própria antes de virar plano — não é bounded.
- **Redesign visual completo do cardápio estilo iFood** (reunião, ~09:13–11:20 e ~43:19–44:51 — hierarquia visual, fundo/logo customizável por loja). Já existe um plano de redesign separado e não-executado (`docs/superpowers/plans/2026-08-16-cardapio-material-motion-apple.md`) — revisar se ele já cobre o pedido desta reunião ou se precisa de um plano novo é decisão de uma sessão de design própria (com skill de design + mockup/screenshot antes de codar, por padrão já estabelecido neste projeto), não deste plano de correções pontuais.
- **Fila/anti-duplicidade de envio de Ordem de Produção pro Omie** (reunião, ~36:33–37:25) — André confirmou ao vivo que já está construindo esse controle do lado do `ntb-estoque` ("já estou fazendo já... criou a fila, respeita os limites do Omie"). Nenhuma mudança correspondente é necessária neste repo agora.
- **Confirmar baixa de matéria-prima na loja de teste "Sertão"** (reunião, ~33:18–35:19 — não conseguiram confirmar ao vivo se a Ordem de Produção estava debitando o estoque local) — isso é investigação/trabalho no repo `ntb-estoque` (`estoque_local_saldos`/`ficha_tecnica_local`), não `ntb-vendas`.
- **Login de cliente via Google/celular** (reunião, ~45:30–46:08) — explicitamente adiado na própria reunião ("depois a gente vai criar o login").
- **Cardápio personalizado pago (white-label por cliente)** (reunião, ~11:26–12:06) — ideia de produto futuro, não especificada tecnicamente.
- **Ícone/texto "gerando em mesa" sobrepondo algo perto do botão "Conta"** (reunião, ~43:58–44:34, classificado como "besteira" pelo próprio grupo) — não foi possível localizar a string exata no código (`grep` por "gerando": zero resultados) nem confirmar o elemento visual exato só pela transcrição. Pedir print/gravação de tela do momento específico antes de investigar mais.
