# Vende Mais II — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 3 features adicionais de baixo esforço, continuação do pacote
"cardápio que vende" (migration 019): "mais vendido" automático (badge
calculado de venda real, não tag manual), "peça também" (cross-sell
manual entre produtos da mesma loja) e favoritar produto (100%
client-side, sem servidor). **Mesmo requisito central do usuário
continua valendo**: tudo que o lojista configura fica em
`MenuManagementView`, nada preso no Master Admin.

**Architecture:** Migration 020 adiciona uma function `security definer`
de leitura agregada (`get_bestseller_product_ids` — nunca expõe
quantidade/receita bruta pro cliente anônimo, só uma lista ordenada de
`product_id`, mesmo princípio de nunca vazar dado de venda granular pro
público) e uma tabela nova + RPC atômica pra "peça também"
(`product_recommendations` / `sync_product_recommendations`, mesmo
padrão de `sync_product_option_groups`: apaga+recria atômico, valida que
os produtos são da mesma loja). Favoritos não tem nenhuma peça de
servidor — é `localStorage` puro no `ClientModule.tsx`. Ordem: M1
(migration) → A1 (lib) → B1+C1 em paralelo (StoreModule / ClientModule)
→ D1 (docs).

**Tech Stack:** igual ao resto — Next.js 16, Supabase, `npm run build`
como rede de segurança.

---

## Task M1: Migration `020_vende_mais_2.sql`

**Files:** Create `supabase/migrations/020_vende_mais_2.sql`

```sql
-- Vende mais II (2026-07-06): mais vendido automatico, peca tambem
-- (cross-sell manual do lojista) e favoritos (100% client-side, sem
-- schema nenhum, nao entra nesta migration).

-- ─── Mais vendido: RPC de leitura agregada, nunca expoe dado bruto ────────
-- order_items/orders nao tem select liberado pro anon (dado de venda e'
-- sensivel — concorrente nao pode raspar quantidade/receita). Esta
-- function devolve so' uma lista ordenada de product_id, security definer
-- pra rodar com privilegio de dono (bypassa RLS) sem abrir select direto
-- nas tabelas de pedido pro client.
create index if not exists idx_order_items_store_product on order_items(store_id, product_id);

create or replace function public.get_bestseller_product_ids(
  p_store_id uuid,
  p_days int default 30,
  p_limit int default 5
) returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(product_id order by total_qty desc), '{}'::uuid[])
  from (
    select oi.product_id, sum(oi.quantity) as total_qty
    from order_items oi
    join orders o on o.id = oi.order_id
    where oi.store_id = p_store_id
      and oi.product_id is not null -- produto excluido (on delete set null) nao pode "vender mais"
      and o.created_at > now() - (greatest(p_days, 1) || ' days')::interval
      and o.status != 'canceled'
    group by oi.product_id
    order by total_qty desc
    limit greatest(p_limit, 1)
  ) top;
$$;

grant execute on function public.get_bestseller_product_ids(uuid, int, int) to anon, authenticated;

-- Toggle do lojista (sem coluna nova): stores.config.show_bestsellers
-- (jsonb ja existente, mesmo padrao de charge_service_fee/note_suggestions).

-- ─── Peca tambem: tabela + RPC atomica ─────────────────────────────────────
create table if not exists product_recommendations (
  product_id uuid not null references products(id) on delete cascade,
  recommended_product_id uuid not null references products(id) on delete cascade,
  position int not null default 0,
  primary key (product_id, recommended_product_id),
  check (product_id != recommended_product_id)
);

alter table product_recommendations enable row level security;

drop policy if exists select_anon_product_recommendations on product_recommendations;
create policy select_anon_product_recommendations on product_recommendations
  for select using (true);
-- Sem policy de insert/update/delete pro anon de proposito: toda escrita
-- passa pela RPC abaixo (mesmo padrao de sync_product_option_groups),
-- que roda como dono da function (bypassa RLS) depois de validar loja.

create or replace function public.sync_product_recommendations(
  p_product_id uuid,
  p_store_id uuid,
  p_recommended_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_count int;
begin
  if not exists (select 1 from products where id = p_product_id and store_id = p_store_id) then
    raise exception 'Produto inválido para esta loja.';
  end if;

  select array(select distinct unnest(coalesce(p_recommended_ids, '{}'::uuid[]))) into v_ids;

  if coalesce(array_length(v_ids, 1), 0) > 3 then
    raise exception 'No máximo 3 produtos recomendados.';
  end if;

  select count(*) into v_count
  from products
  where id = any(v_ids) and store_id = p_store_id and id != p_product_id;

  if v_count != coalesce(array_length(v_ids, 1), 0) then
    raise exception 'Produto recomendado inválido para esta loja.';
  end if;

  delete from product_recommendations where product_id = p_product_id;

  if array_length(v_ids, 1) > 0 then
    insert into product_recommendations (product_id, recommended_product_id, position)
    select p_product_id, rid, ord - 1
    from unnest(v_ids) with ordinality as t(rid, ord);
  end if;
end;
$$;

grant execute on function public.sync_product_recommendations(uuid, uuid, uuid[]) to anon, authenticated;
```

**Step 2:** Aplicar: `node scripts/aplicar-migration.mjs 020_vende_mais_2.sql`
**Step 3:** Verificar via `node scripts/db.mjs`: tabela `product_recommendations`
existe com a PK/CHECK certos; as duas functions existem
(`\df get_bestseller_product_ids`, `\df sync_product_recommendations` ou
equivalente via `information_schema.routines`); testar
`select get_bestseller_product_ids('<id da Bistro Demo>'::uuid, 30, 5)`
direto (deve devolver `{}` se não houver pedidos recentes, sem erro).
Testar `sync_product_recommendations` com um produto real de teste da
Bistrô Demo (criar categoria+2 produtos temporários, sincronizar
recomendação de um pro outro, conferir a linha em
`product_recommendations`, depois **apagar tudo** — mesmo cuidado de
limpeza já usado nos testes da migration 019).
**Step 4:** Commit: `feat: mais vendido automatico, peca tambem (recomendacoes) e infra de bestsellers`

---

## Task A1: `types/index.ts`, `lib/api.ts`

**Files:** Modify os 2

1. `types/index.ts`:
   - `Product` ganha `recommended_products?: Product[]` (anexado em
     runtime por `fetchMenu`, não é coluna de banco — mesmo comentário já
     usado em `option_groups`).
   - `Store.config` ganha `show_bestsellers?: boolean` (mesmo padrão de
     `note_suggestions`/`charge_service_fee`).
2. `lib/api.ts`:
   - `fetchBestsellerProductIds(storeId: string, days = 30, limit = 5): Promise<string[]>`
     — chama `.rpc('get_bestseller_product_ids', { p_store_id: storeId, p_days: days, p_limit: limit })`,
     devolve `[]` em caso de erro (não deve quebrar o carregamento do
     cardápio se essa chamada falhar — é um enfeite, não algo crítico).
   - `updateProductRecommendations(productId: string, storeId: string, recommendedIds: string[]): Promise<void>`
     — chama `.rpc('sync_product_recommendations', { p_product_id: productId, p_store_id: storeId, p_recommended_ids: recommendedIds })`.
   - `fetchProductRecommendationsByStore(storeId: string): Promise<Map<string, string[]>>`
     — segue exatamente o padrão de `fetchOptionGroupsByProduct` (mesmo
     arquivo): `.from('product_recommendations').select('*, product:products!inner(store_id)').eq('product.store_id', storeId).order('position').limit(500)`,
     agrupa em `Map<product_id, recommended_product_id[]>` ordenado.
   - `fetchMenu`: depois de montar a lista de `products`, chama
     `fetchProductRecommendationsByStore` em paralelo com as outras 2
     queries já paralelas (`Promise.all`), e preenche
     `product.recommended_products` de cada produto resolvendo os ids
     contra a própria lista de `products` já carregada (produto
     recomendado que não existir mais/estiver indisponível: `.filter(Boolean)`,
     não quebra).

**Step 2:** `npx tsc --noEmit -p tsconfig.json`. **Step 3:** Commit:
`feat: lib/api e tipos para bestsellers e recomendacoes de produto`

---

## Task B1: `StoreModule.tsx` — configuração pelo lojista

**Files:** Modify `components/modules/StoreModule.tsx`

1. Área de configurações da loja (mesma seção do toggle de taxa de
   serviço / sugestões de observação): toggle "🔥 Mostrar mais vendidos
   automaticamente no cardápio" — salvo em `stores.config.show_bestsellers`
   via `updateStoreConfig`, mesmo padrão otimista já usado nos outros
   toggles dessa seção.
2. No formulário de produto (mesma área dos adicionais/opcionais): seção
   "Sugerir junto (opcional)" — lista dos outros produtos da loja (exceto
   o próprio, e exceto produtos de categoria excluída/órfã se fizer
   sentido excluir), com campo de busca por nome (a loja pode ter dezenas
   de produtos) e seleção por checkbox, **limite de 3** (ao atingir 3,
   checkboxes não selecionados ficam desabilitados até desmarcar algum).
   Estado local do formulário (igual ao rascunho de `option_groups`) —
   funciona tanto criando produto novo quanto editando um existente: ao
   salvar o produto (criar ou atualizar), chama
   `updateProductRecommendations(productId, storeId, selectedIds)` logo
   depois de ter o `productId` definitivo (mesma ordem que já existe hoje
   pra `syncProductOptionGroups`).
3. Na listagem de produtos do lojista, não precisa de indicador visual
   novo (recomendação é um detalhe do form, não do card).

**Step 2:** `npx tsc --noEmit -p tsconfig.json`. **Step 3:** Commit:
`feat: toggle de mais vendidos e selecao de produtos recomendados no formulario`

---

## Task C1: `ClientModule.tsx` — exibição pro cliente

**Files:** Modify `components/modules/ClientModule.tsx`

1. **Mais vendido**: se `currentStore?.config?.show_bestsellers` for
   true, ao carregar o cardápio chama `fetchBestsellerProductIds(store.id)`
   (uma vez, guardar em state) e, pro `ProductCard` de cada produto cujo
   id estiver nessa lista, mostra um badge discreto "🔥 Mais vendido"
   (mesmo estilo/posição dos badges de etiqueta, mas visualmente
   distinguível — não é uma tag do catálogo `PRODUCT_TAGS`, é calculado).
   Se a chamada falhar ou a loja não tiver essa opção ligada, cardápio
   continua funcionando normalmente (nenhum badge aparece).
2. **Peça também**: no `ProductModal`, se
   `product.recommended_products` tiver itens, seção "Peça também" com
   cards compactos (imagem pequena + nome + preço efetivo via
   `getEffectivePrice`) em linha horizontal rolável, abaixo do preço/qty
   e antes do campo de observação. Clicar num card troca o
   `selectedProduct` pro produto recomendado (abre o modal dele no lugar,
   mesmo padrão de navegação que o resto do app já usa pra trocar de
   produto selecionado).
3. **Favoritar produto** (100% client-side, sem mudança de servidor):
   - Ícone de coração no canto do `ProductCard` e no `ProductModal”,
     clicável, alterna favorito. Estado persistido em `localStorage` sob a
     chave `fav_products_${store.id}` (array de `product_id`), lido uma
     vez ao montar o cardápio.
   - Um chip/toggle "❤ Favoritos" na mesma área da busca/ordenação
     (`sortBy`), que quando ativo filtra `filteredProducts` pra só os
     favoritados (client-side puro, sem tocar no filtro de categoria —
     favoritos de categorias diferentes aparecem juntos quando o filtro
     está ligado, category nav fica desabilitada/ignorada enquanto o
     filtro de favoritos estiver ativo, igual a como busca por texto já
     se sobrepõe à categoria ativa).
   - Clique no coração não deve abrir o `ProductModal` (usar
     `stopPropagation` no card, já que o card inteiro é clicável hoje).

**Step 2:** `npx tsc --noEmit -p tsconfig.json` + smoke test. **Step 3:**
Commit: `feat: badge de mais vendido, peca tambem e favoritos no cardapio do cliente`

---

## Task D1: `AGENTS.md`

Documentar as 3 features numa nova seção (ou estender "Cardápio que
vende"), mencionando: `get_bestseller_product_ids` nunca expõe
quantidade/receita bruta pro anônimo (só lista ordenada de id),
`product_recommendations`/`sync_product_recommendations` segue o mesmo
padrão atômico de `sync_product_option_groups`, favoritos é 100%
client-side (localStorage, sem servidor). Atualizar lista de migrations
(020) e a nota "Todas as migrations aplicadas".

Commit: `docs: documenta mais vendidos, peca tambem e favoritos (migration 020)`

---

## Resumo de arquivos tocados

- `supabase/migrations/020_vende_mais_2.sql` (novo)
- `types/index.ts`, `lib/api.ts`
- `components/modules/StoreModule.tsx`
- `components/modules/ClientModule.tsx`
- `AGENTS.md`
