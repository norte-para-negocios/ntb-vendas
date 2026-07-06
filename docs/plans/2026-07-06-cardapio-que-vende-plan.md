# Cardápio que Vende — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 5 features de baixo esforço que elevam o cardápio de "digital
básico" pra "cardápio que vende mais": preço promocional riscado,
etiquetas/badges, vitrine de destaques, busca por descrição, e chips de
observação rápida. **Requisito central do usuário: TUDO configurável pelo
dono da loja** (`MenuManagementView` no painel do lojista) — nada preso no
Master Admin, nada hardcoded.

**Architecture:** Migration 019 adiciona `promo_price`, `featured` e
`tags` em `products`, e atualiza `create_order_secure` pra cobrar o preço
promocional no servidor (mesmo princípio que já protege o preço base —
client nunca dita preço). Chips de observação ficam em `stores.config`
(jsonb já existente), editáveis na mesma área de configurações do lojista
onde já mora o toggle de taxa de serviço. Busca por descrição é mudança
client-side pura. Ordem: M1 (migration) → A1 (lib) → B1+C1 em paralelo
(StoreModule / ClientModule) → D1 (docs).

**Tech Stack:** igual ao resto — Next.js 16, Supabase, `npm run build`
como rede de segurança.

---

## Task M1: Migration `019_cardapio_que_vende.sql`

**Files:** Create `supabase/migrations/019_cardapio_que_vende.sql`

```sql
-- Cardapio que vende (2026-07-06): preco promocional, destaque e
-- etiquetas por produto -- tudo configuravel pelo LOJISTA no proprio
-- formulario de produto (requisito explicito do usuario), nada no Master
-- Admin. Chips de observacao ficam em stores.config (jsonb ja existente),
-- sem coluna nova.

alter table products add column if not exists promo_price numeric(10,2);
alter table products add column if not exists featured boolean not null default false;
alter table products add column if not exists tags text[] not null default '{}';

-- Promocao so vale se for menor que o preco cheio (CHECK evita promocao
-- "maior que o preco", que seria so confusao/bug de cadastro).
alter table products drop constraint if exists products_promo_price_check;
alter table products add constraint products_promo_price_check
  check (promo_price is null or (promo_price >= 0 and promo_price < price));

-- ─── create_order_secure: cobra o preco promocional NO SERVIDOR ───────────────
-- Mesmo principio de sempre (007/016/017): o client nunca dita preco.
-- Se promo_price estiver setado (e o CHECK acima ja garante < price), o
-- preco efetivo do item vira promo_price. coalesce cobre o caso normal.
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
  v_preco_efetivo numeric;
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
      v_selected_options := v_selected_options || jsonb_build_object('name', v_option.name, 'price_delta', v_option.price_delta);
    end loop;

    v_line_total := (v_preco_efetivo + v_options_delta) * (v_item->>'quantity')::int;
    v_total := v_total + v_line_total;

    insert into order_items (order_id, product_id, quantity, status, notes, price_at_time, selected_options)
    values (
      v_order_id, v_product.id, (v_item->>'quantity')::int, 'pending', v_item->>'notes',
      v_preco_efetivo + v_options_delta, v_selected_options
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

**Step 2:** Aplicar: `node scripts/aplicar-migration.mjs 019_cardapio_que_vende.sql`
**Step 3:** Verificar colunas + function via `node scripts/db.mjs`.
**Step 4:** Commit: `feat: promo_price, featured e tags em products; preco promocional cobrado no servidor`

---

## Task A1: `types/index.ts`, `lib/api.ts`, `lib/calc.ts`, `lib/labels.ts`

**Files:** Modify os 4

1. `types/index.ts`: `Product` ganha `promo_price?: number | null`,
   `featured: boolean`, `tags: string[]`. Exportar também o catálogo de
   badges conhecidos (num lugar compartilhado — pode ser `lib/labels.ts`):
   ```ts
   export const PRODUCT_TAGS: Record<string, { label: string; emoji: string }> = {
     picante:      { label: 'Picante',      emoji: '🌶️' },
     vegano:       { label: 'Vegano',       emoji: '🌱' },
     vegetariano:  { label: 'Vegetariano',  emoji: '🥬' },
     sem_gluten:   { label: 'Sem Glúten',   emoji: '🌾' },
     sem_lactose:  { label: 'Sem Lactose',  emoji: '🥛' },
     novo:         { label: 'Novo',         emoji: '✨' },
     da_casa:      { label: 'Da Casa',      emoji: '⭐' },
   };
   ```
   (armazenado como `text[]` com essas chaves; UI só oferece o catálogo,
   não texto livre — consistência visual.)
2. `lib/calc.ts`: nova função `getEffectivePrice(product: { price: number;
   promo_price?: number | null }): number` retornando
   `promo_price ?? price` (com guarda `promo_price < price` por
   segurança). `calculateCartItemUnitPrice` passa a usar
   `getEffectivePrice` em vez de `product.price` direto — assim carrinho,
   modal e total ficam automaticamente certos.
3. `lib/api.ts`: `createProduct`/`updateProduct` aceitam/persistem os 3
   campos novos (conferir se já passam `Partial<Product>` direto — se sim,
   pode ser que só o fallback de schema-cache precise de atenção).
4. Sem mudança de query em `fetchMenu` (usa `select('*')`, os campos vêm
   de graça).

**Step 2:** `npm run build`. **Step 3:** Commit: `feat: preco efetivo (promo) no calc compartilhado, catalogo de badges, tipos`

---

## Task B1: `StoreModule.tsx` — tudo configurável pelo lojista

**Files:** Modify `components/modules/StoreModule.tsx`

No formulário de produto (`MenuManagementView`, mesmo modal que já tem
preço/adicionais):
1. Campo "Preço promocional (opcional)" — input numérico ao lado do preço;
   validação client-side: se preenchido, tem que ser menor que o preço
   cheio (o CHECK do banco é a rede de segurança, mas o toast de erro
   amigável vem do client).
2. Toggle "⭐ Destacar no topo do cardápio" (campo `featured`).
3. Seletor de etiquetas: chips clicáveis do catálogo `PRODUCT_TAGS`
   (multi-seleção, salva como `tags`).
4. Na listagem de produtos do lojista, indicar visualmente promo ativa
   (preço riscado + novo) e destaque (estrela), pro lojista ver de relance
   o que está configurado.

Na área de configurações da loja (mesma seção do toggle de taxa de
serviço em `MenuManagementView`):
5. Editor de "Sugestões de observação" — lista editável de chips (ex.:
   "Sem cebola", "Bem passado", "Sem gelo"), adicionar/remover, salvo em
   `stores.config.note_suggestions: string[]` via `updateStoreConfig` (já
   existe). Default: lista vazia (sem chips = campo de observação fica
   como é hoje).

**Step 2:** `npm run build` + `npx tsc --noEmit`. **Step 3:** Commit:
`feat: promo, destaque, etiquetas e sugestoes de observacao configuraveis pelo lojista`

---

## Task C1: `ClientModule.tsx` — exibição pro cliente

**Files:** Modify `components/modules/ClientModule.tsx`

1. **Preço promocional**: onde o preço é exibido (`ProductCard`,
   `ProductModal`, carrinho), se `promo_price` ativo: preço cheio riscado
   (`line-through`, cor muted) + promocional em destaque (o dourado
   `WINE_GOLD` da identidade já existente). Total do carrinho já sai certo
   via `getEffectivePrice` (Task A1).
2. **Badges**: no `ProductCard` (linha editorial), mostrar os emojis das
   tags ao lado do nome (só emoji na lista, emoji+label no `ProductModal`)
   — discreto, não pode poluir a estética "carta de vinhos".
3. **Vitrine de destaques**: se a loja tiver 1+ produto `featured` (e
   disponível/na janela de horário), renderizar uma faixa horizontal
   rolável "Destaques" no topo, antes das categorias, usando o mesmo
   `ProductCard` (ou variante compacta). Produtos destacados continuam
   aparecendo na categoria deles também.
4. **Busca por descrição**: no filtro de busca (`filteredProducts`),
   incluir `p.description?.toLowerCase().includes(term)` além do nome.
5. **Chips de observação**: no `ProductModal`, acima do campo de
   observação, renderizar os chips de `currentStore.config.note_suggestions`
   (se houver) — clicar num chip adiciona o texto à observação (append
   com vírgula se já tiver texto). Chips togglables não são necessários,
   é só atalho de digitação.

**Step 2:** `npm run build` + smoke test. **Step 3:** Commit:
`feat: promo riscada, badges, vitrine de destaques, busca por descricao e chips de observacao no cardapio`

---

## Task D1: `AGENTS.md`

Documentar as 5 features na seção do cardápio (ou nova subseção),
mencionando: preço promocional é cobrado no servidor
(`create_order_secure`, migration 019), catálogo fixo de badges em
`PRODUCT_TAGS`, chips de observação em `stores.config.note_suggestions`,
e o requisito de que tudo é configurável pelo lojista. Atualizar lista de
migrations (019) e a nota "Todas as migrations aplicadas".

Commit: `docs: documenta pacote cardapio-que-vende (migration 019)`

---

## Resumo de arquivos tocados

- `supabase/migrations/019_cardapio_que_vende.sql` (novo)
- `types/index.ts`, `lib/calc.ts`, `lib/api.ts`, `lib/labels.ts`
- `components/modules/StoreModule.tsx`
- `components/modules/ClientModule.tsx`
- `AGENTS.md`
