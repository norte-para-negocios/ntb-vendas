# Grupos de Categoria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agrupar categorias relacionadas (ex.: "Bebidas" contendo Geladas/Vinhos/Drinks, "Pizzas" contendo as variações) num nível hierárquico opcional acima da categoria, refletido no painel do lojista, no cardápio do cliente e no cardápio do garçom.

**Architecture:** Nova tabela `category_groups` (pública, mesma sensibilidade de `categories`) + `categories.group_id` opcional. `fetchMenu` (fonte única de dado do cardápio nas 3 superfícies) passa a devolver também os grupos da loja. Cada superfície aplica sua própria navegação de 2 níveis sobre o mesmo dado — sem componente compartilhado entre painel/cliente/garçom, seguindo a convenção já estabelecida no projeto.

**Tech Stack:** Next.js/React/TypeScript, Supabase Postgres (self-hosted Contabo), `@hello-pangea/dnd` (drag-and-drop já usado pra reordenar categoria).

**Spec:** `docs/superpowers/specs/2026-09-22-grupos-de-categoria-design.md`

## Global Constraints

- Categoria sem grupo (`group_id = null`) precisa continuar funcionando IDENTICAMENTE a hoje em todas as 3 superfícies — nenhuma loja existente pode ter uma regressão visual/funcional.
- Nunca mais de 2 níveis (grupo → categoria → produto) — grupo nunca tem produto direto.
- Migrations neste projeto são aplicadas manualmente no Postgres do Contabo via `docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas`, sempre seguido de `NOTIFY pgrst, 'reload schema'` (ver AGENTS.md, "Banco de dados").
- Deploy é `git push` + `ssh root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"`.
- Sem framework de teste neste projeto (`package.json` não tem jest/vitest) — "testar" aqui significa `npx tsc --noEmit` limpo + verificação SQL direta + QA ao vivo via Playwright contra `testvendase.norteparanegocios.com.br`, igual ao padrão já usado nesta sessão.
- Nunca usar dado de loja real de cliente pra teste que grava — usar a Bistrô Demo (loja de teste sancionada, ver AGENTS.md) pra qualquer CRUD de teste; a loja "O Sertão Vai Virar Mar" só pode ser usada pra verificação visual **sem escrever nada nela** (ela já tem 17+ categorias reais, ótima pra ver o layout, mas atribuir grupo a elas é decisão de conteúdo do dono, fora de escopo deste plano).

---

### Task 1: Migration `category_groups` + tipos TypeScript

**Files:**
- Create: `supabase/migrations/079_grupos_de_categoria.sql`
- Modify: `types/index.ts:167-178` (interface `Category`, nova interface `CategoryGroup`)

**Interfaces:**
- Produces: tabela `category_groups (id, store_id, name, order, created_at)`; coluna `categories.group_id uuid null`; tipo `CategoryGroup { id, store_id, name, order }`; `Category.group_id?: string | null`.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/079_grupos_de_categoria.sql`:

```sql
-- 079_grupos_de_categoria.sql
--
-- Grupo de categoria (2026-09-22, pedido direto): lojas com cardápio
-- grande (ex.: Sertão, 17+ categorias) agrupam categorias relacionadas —
-- "Bebidas" contendo Geladas/Vinhos/Drinks/..., "Pizzas" contendo as
-- variações de pizza. Opt-in: categoria sem grupo continua no primeiro
-- nível, exatamente como hoje. Ver
-- docs/superpowers/specs/2026-09-22-grupos-de-categoria-design.md.

create table category_groups (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  "order" int not null default 0,
  created_at timestamptz not null default now()
);

alter table category_groups enable row level security;
create policy allow_all_anon on category_groups for all using (true) with check (true);

-- on delete set null (não cascade): apagar um grupo nunca apaga a
-- categoria, só desagrupa ela — mesmo princípio de `products.category_id`
-- desde a migration 001.
alter table categories add column if not exists group_id uuid references category_groups(id) on delete set null;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Aplicar no Contabo**

```bash
scp -i ~/.ssh/notebook_contabo_key "supabase/migrations/079_grupos_de_categoria.sql" root@185.193.66.240:/tmp/079.sql
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas < /tmp/079.sql"
```

Esperado: saída limpa com `CREATE TABLE`, `ALTER TABLE` (x2), `CREATE POLICY`, `NOTIFY` — sem nenhum `ERROR`.

- [ ] **Step 3: Verificar via SQL direto**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -c \"select column_name from information_schema.columns where table_name='categories' and column_name='group_id';\""
```

Esperado: 1 linha, `group_id`.

- [ ] **Step 4: Editar `types/index.ts`**

Em `types/index.ts:167-178`, adicionar o campo novo em `Category` e a interface `CategoryGroup` logo depois:

```typescript
export interface Category {
  id: string;
  store_id: string;
  name: string;
  order: number;
  icon?: string;
  // Cardapio por horario/turno (migration 018) — NULL nos 3 = sempre
  // disponivel. Ver lib/schedule.ts (isCategoryAvailableNow/formatScheduleLabel).
  available_from?: string | null;
  available_until?: string | null;
  available_days?: number[] | null; // 0=domingo .. 6=sabado
  // Grupo de categoria (migration 079) — null = categoria solta (1º nível),
  // como sempre foi.
  group_id?: string | null;
}

export interface CategoryGroup {
  id: string;
  store_id: string;
  name: string;
  order: number;
}
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: sem erro novo relacionado a `Category`/`CategoryGroup` (outros arquivos ainda não usam o campo novo, então não deve haver nenhum erro neste ponto).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/079_grupos_de_categoria.sql types/index.ts
git commit -m "$(cat <<'EOF'
Adiciona schema de grupo de categoria (migration 079)

Nova tabela category_groups (pública, mesmo nível de categories) +
categories.group_id opcional. Categoria sem grupo continua idêntica a
hoje — grupo é opt-in por categoria/loja.
EOF
)"
```

---

### Task 2: `lib/api.ts` — CRUD de grupo + `fetchMenu` estendido

**Files:**
- Modify: `lib/api.ts:2` (import), `lib/api.ts:453-522` (`fetchMenu`), `lib/api.ts:719-733` (região de `updateCategoryOrder`/`updateCategorySchedule`, novas funções logo depois)

**Interfaces:**
- Consumes: `Category`, `CategoryGroup` (Task 1).
- Produces: `fetchMenu(storeId, onlyAvailable?, includeUnavailable?): Promise<{ categories: Category[]; products: Product[]; categoryGroups: CategoryGroup[]; error?: 'network' }>`; `fetchCategoryGroups(storeId): Promise<CategoryGroup[]>`; `createCategoryGroup(storeId, name): Promise<void>`; `deleteCategoryGroup(id): Promise<void>`; `updateCategoryGroupOrder(updates: {id, order}[]): Promise<void>`; `updateCategoryGroupAssignment(categoryId, groupId: string | null): Promise<void>`.

- [ ] **Step 1: Importar `CategoryGroup`**

Em `lib/api.ts:2`, adicionar `CategoryGroup` à lista de imports de `@/types`:

```typescript
import { Store, Table, Product, Category, CategoryGroup, OrderItem, OrderStatus, TableStatus, CartItem, StoreUser, Order, TableSession, StoreFiscalCertificateStatus, StoreFiscalConfig, OrderRating, UniversalUser, ProductOptionGroup, FiscalNota, OperatorCheckin, TableReservation, PrinterConfig, PrintJob } from '@/types';
```

- [ ] **Step 2: Estender `fetchMenu` pra buscar `category_groups` em paralelo**

Em `lib/api.ts:453`, mudar a assinatura e o `Promise.all`:

```typescript
export const fetchMenu = async (storeId: string, onlyAvailable = true, includeUnavailable = false): Promise<{ categories: Category[]; products: Product[]; categoryGroups: CategoryGroup[]; error?: 'network' }> => {
  try {
    const categoriesQuery = supabase.from('categories').select('*').eq('store_id', storeId).order('order');
    const categoryGroupsQuery = supabase.from('category_groups').select('*').eq('store_id', storeId).order('order');
    let productsQuery = supabase.from('products').select('*').eq('store_id', storeId).order('order', { ascending: true, nullsFirst: false });
    if (onlyAvailable) productsQuery = productsQuery.eq('available', true);

    // Query de adicionais e de recomendações paralelizadas com
    // categorias/produtos (não dependem do resultado delas, só do storeId)
    // — antes rodava sequencialmente depois do Promise.all abaixo.
    const [cats, catGroups, prods, groupsByProduct, recommendedByProduct] = await Promise.all([
      categoriesQuery,
      categoryGroupsQuery,
      productsQuery,
      fetchOptionGroupsByProduct(storeId, includeUnavailable),
      fetchProductRecommendationsByStore(storeId),
    ]);
```

Agora atualizar TODOS os `return` dentro da função pra incluir `categoryGroups: catGroups.data || []` (nos caminhos com sucesso) ou `categoryGroups: []` (nos caminhos de erro/cache/catch, já que o cache offline — `getCachedMenu`/`setCachedMenu` — não guarda grupo; é uma simplificação deliberada documentada abaixo, não um bug):

```typescript
    if (prods.error && (prods.error.code === '42703' || prods.error.message?.includes('column') || prods.error.message?.includes('does not exist'))) {
      let fallbackQuery = supabase.from('products').select('*').eq('store_id', storeId);
      if (onlyAvailable) fallbackQuery = fallbackQuery.eq('available', true);
      const fallbackProds = await fallbackQuery;
      if (fallbackProds.error || cats.error) {
        console.error('Error fetching menu (fallback):', fallbackProds.error || cats.error);
        const cached = await getCachedMenu(storeId);
        if (cached) return { categories: cached.categories as Category[], products: cached.products as Product[], categoryGroups: [] };
        return { categories: cats.data || [], products: fallbackProds.data || [], categoryGroups: catGroups.data || [], error: 'network' };
      }
      const fallbackResult = { categories: cats.data || [], products: resolveRecommended(mergeOptionGroups(fallbackProds.data || [], groupsByProduct)), categoryGroups: catGroups.data || [] };
      setCachedMenu(storeId, fallbackResult.categories, fallbackResult.products).catch(() => {});
      return fallbackResult;
    }

    if (cats.error || prods.error) {
      console.error('Error fetching menu:', cats.error || prods.error);
      const cached = await getCachedMenu(storeId);
      if (cached) return { categories: cached.categories as Category[], products: cached.products as Product[], categoryGroups: [] };
      return { categories: cats.data || [], products: prods.data || [], categoryGroups: catGroups.data || [], error: 'network' };
    }

    const result = { categories: cats.data || [], products: resolveRecommended(mergeOptionGroups(prods.data || [], groupsByProduct)), categoryGroups: catGroups.data || [] };
    setCachedMenu(storeId, result.categories, result.products).catch(() => {});
    return result;
  } catch (error) {
    console.error('Error fetching menu:', error);
    const cached = await getCachedMenu(storeId);
    if (cached) return { categories: cached.categories as Category[], products: cached.products as Product[], categoryGroups: [] };
    return { categories: [], products: [], categoryGroups: [], error: 'network' };
  }
};
```

- [ ] **Step 3: CRUD de grupo, logo depois de `updateCategorySchedule` (`lib/api.ts:733`)**

```typescript
export const createCategoryGroup = async (storeId: string, name: string) => {
  const { data: maxOrderData } = await supabase.from('category_groups').select('order').eq('store_id', storeId).order('order', { ascending: false }).limit(1);
  const nextOrder = (maxOrderData?.[0]?.order || 0) + 1;
  const { error } = await supabase.from('category_groups').insert({ store_id: storeId, name, order: nextOrder });
  if (error) throw error;
};

export const deleteCategoryGroup = async (id: string) => {
  const { error } = await supabase.from('category_groups').delete().eq('id', id);
  if (error) throw error;
};

// Loop de update simples (não RPC): diferente de update_categories_order/
// update_products_order (que existem por causa do upsert com colunas NOT
// NULL omitidas, ver migration 005), aqui é update puro por id — sem
// problema de upsert, e o volume de grupos por loja é sempre pequeno
// (poucas unidades), então atomicidade não é crítica.
export const updateCategoryGroupOrder = async (updates: { id: string; order: number }[]) => {
  for (const u of updates) {
    const { error } = await supabase.from('category_groups').update({ order: u.order }).eq('id', u.id);
    if (error) throw error;
  }
};

export const updateCategoryGroupAssignment = async (categoryId: string, groupId: string | null) => {
  const { error } = await supabase.from('categories').update({ group_id: groupId }).eq('id', categoryId);
  if (error) throw error;
};
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: novos erros nos 3 arquivos que já chamavam `fetchMenu` esperando o formato antigo (`StoreModule.tsx`, `ClientModule.tsx`) — **isso é esperado nesta etapa**, as próximas tasks corrigem cada call site. Confirme que os erros reportados são exatamente "Property 'categoryGroups' is missing" ou similar nesses 2 arquivos, nada em `lib/api.ts` em si.

- [ ] **Step 5: Commit**

```bash
git add lib/api.ts
git commit -m "$(cat <<'EOF'
Adiciona CRUD de category_groups e estende fetchMenu

fetchMenu agora busca category_groups em paralelo com categorias/
produtos. Call sites em StoreModule/ClientModule ainda não atualizados
(próximas tasks) — tsc vai apontar isso, esperado nesta etapa.
EOF
)"
```

---

### Task 3: Painel do lojista — sidebar agrupada (`MenuManagementView`)

**Files:**
- Modify: `components/modules/StoreModule.tsx` (import em `lib/api.ts`, estado/`loadMenu` ~L7104-7111, sidebar ~L7708-7753)

**Interfaces:**
- Consumes: `fetchCategoryGroups` não é usado aqui — vem embutido no retorno de `fetchMenu` (Task 2); `CategoryGroup` (Task 1).
- Produces: estado `categoryGroups: CategoryGroup[]` disponível pro resto de `MenuManagementView` (Task 4 usa).

- [ ] **Step 1: Import**

Adicionar `CategoryGroup` ao import de `@/types` no topo de `StoreModule.tsx` (mesma linha que já importa `Category`), e `createCategoryGroup, deleteCategoryGroup, updateCategoryGroupOrder, updateCategoryGroupAssignment` ao import gigante de `@/lib/api`.

- [ ] **Step 2: Estado + `loadMenu`**

Em `StoreModule.tsx:7104-7111`, dentro de `MenuManagementView`, adicionar o estado e atualizar `loadMenu`:

```typescript
const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);

const loadMenu = async () => {
    // includeUnavailable=true: o lojista precisa ver e editar opções
    // marcadas como indisponíveis nesta tela (só o cardápio do cliente
    // filtra `available = true`, ver fetchMenu em lib/api.ts).
    const { categories: c, products: p, categoryGroups: g } = await fetchMenu(storeId, false, true);
    setCategories(c);
    setProducts(p);
    setCategoryGroups(g);
};
```

(A declaração de `useState<CategoryGroup[]>([])` deve ficar junto dos outros `useState` já existentes no topo do componente, não literalmente colada em `loadMenu` — colocar ao lado de `const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);`, linha 6934.)

- [ ] **Step 3: Sidebar agrupada**

Em `StoreModule.tsx:7732-7753` (o `<nav className="hidden lg:block...">` criado no redesign anterior), substituir o corpo por uma versão que separa categorias sem grupo das agrupadas:

```tsx
{!isSearchingProducts && productGroupsWithItems.length > 0 && (
    <nav className="hidden lg:block lg:w-56 lg:shrink-0">
        <ul className="space-y-0.5">
            {productGroupsWithItems.filter(cat => !cat.group_id).map(cat => {
                const count = products.filter(p => groupIdOf(p) === cat.id).length;
                const isActive = cat.id === activeMenuCategoryId;
                return (
                    <li key={cat.id}>
                        <button
                            onClick={() => setActiveMenuCategoryId(cat.id)}
                            className={`w-full flex items-center justify-between gap-2 py-2.5 pl-3 pr-2 border-l-2 text-left u-motion ${isActive ? 'border-[var(--brand)] text-[var(--text)] font-bold bg-[var(--surface-2)]/50' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border)]'}`}
                        >
                            <span className="truncate tracking-[-0.01em]">{cat.name}</span>
                            <span className="text-xs opacity-60 shrink-0">{count}</span>
                        </button>
                    </li>
                );
            })}
            {categoryGroups.map(group => {
                const catsInGroup = productGroupsWithItems.filter(cat => cat.group_id === group.id);
                if (catsInGroup.length === 0) return null;
                return (
                    <li key={group.id} className="pt-3 first:pt-0">
                        <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{group.name}</p>
                        <ul className="space-y-0.5">
                            {catsInGroup.map(cat => {
                                const count = products.filter(p => groupIdOf(p) === cat.id).length;
                                const isActive = cat.id === activeMenuCategoryId;
                                return (
                                    <li key={cat.id}>
                                        <button
                                            onClick={() => setActiveMenuCategoryId(cat.id)}
                                            className={`w-full flex items-center justify-between gap-2 py-2.5 pl-3 pr-2 border-l-2 text-left u-motion ${isActive ? 'border-[var(--brand)] text-[var(--text)] font-bold bg-[var(--surface-2)]/50' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border)]'}`}
                                        >
                                            <span className="truncate tracking-[-0.01em]">{cat.name}</span>
                                            <span className="text-xs opacity-60 shrink-0">{count}</span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </li>
                );
            })}
        </ul>
    </nav>
)}
```

(A pílula horizontal mobile em `StoreModule.tsx:7714-7730`, logo acima, **não muda** — continua plana, mesma decisão já tomada no redesign anterior de não inventar um segundo padrão mobile ainda.)

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: os erros de `categoryGroups` ausente em `StoreModule.tsx` relacionados a `fetchMenu` desaparecem (resolvidos por este task); só deve sobrar o erro equivalente em `ClientModule.tsx`, que a Task 5 resolve.

- [ ] **Step 5: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "Sidebar do lojista agrupa categorias por category_groups"
```

---

### Task 4: Painel do lojista — CRUD de grupo no modal "Gerenciar categorias"

**Files:**
- Modify: `components/modules/StoreModule.tsx:7113-7131` (`handleDragEnd`), `~L7203-7215` (handlers de categoria, novos handlers de grupo ao lado), `L7835-7884` (JSX do modal)

**Interfaces:**
- Consumes: `categoryGroups`/`setCategoryGroups` (Task 3), `createCategoryGroup`/`deleteCategoryGroup`/`updateCategoryGroupOrder`/`updateCategoryGroupAssignment` (Task 2).

- [ ] **Step 1: Novo branch em `handleDragEnd` pra reordenar grupo**

Em `StoreModule.tsx:7118-7131`, adicionar um `else if` novo (mantendo os já existentes pra `'category'`/`'product'` intactos):

```typescript
if (type === 'category') {
    // ... inalterado ...
} else if (type === 'category_group') {
    const newGroups = [...categoryGroups];
    const [moved] = newGroups.splice(source.index, 1);
    newGroups.splice(destination.index, 0, moved);

    const updatedGroups = newGroups.map((g, index) => ({ ...g, order: index + 1 }));
    setCategoryGroups(updatedGroups);

    try {
        await updateCategoryGroupOrder(updatedGroups.map(g => ({ id: g.id, order: g.order })));
    } catch (e) {
        console.error("Error updating category group order", e);
        loadMenu();
    }
} else if (type === 'product') {
    // ... inalterado ...
}
```

- [ ] **Step 2: Handlers novos, ao lado de `handleAddCategory`/`handleDeleteCategory` (`StoreModule.tsx:7203-7215`)**

```typescript
const [newGroupName, setNewGroupName] = useState('');

const handleAddCategoryGroup = async () => {
    if (!newGroupName) return;
    await createCategoryGroup(storeId, newGroupName);
    setNewGroupName('');
    loadMenu();
};

const handleDeleteCategoryGroup = async (id: string) => {
    if (await confirm({ message: 'Excluir grupo? As categorias dentro dele ficam sem grupo (não são apagadas).', variant: 'danger', confirmLabel: 'Excluir' })) {
        await deleteCategoryGroup(id);
        loadMenu();
    }
};

const handleChangeCategoryGroup = async (categoryId: string, groupId: string | null) => {
    setCategories(prev => prev.map(c => c.id === categoryId ? { ...c, group_id: groupId } : c));
    try {
        await updateCategoryGroupAssignment(categoryId, groupId);
    } catch (e) {
        console.error('Error updating category group assignment', e);
        loadMenu();
    }
};
```

- [ ] **Step 3: JSX do modal — seção de grupo antes da lista de categoria**

Em `StoreModule.tsx:7835-7884`, envolver o conteúdo existente com uma seção nova de grupo antes, e adicionar o `<select>` de grupo em cada chip de categoria:

```tsx
<Modal isOpen={isCategoryModalOpen} onClose={() => setIsCategoryModalOpen(false)} title="Gerenciar categorias">
    <div className="space-y-5">
        <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)] mb-2">Grupos (opcional)</p>
            <div className="flex gap-2 mb-2">
                <Input placeholder="Novo Grupo (ex.: Bebidas)" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
                <Button onClick={handleAddCategoryGroup}><Plus size={20}/></Button>
            </div>
            <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="category_groups" direction="horizontal" type="category_group">
                    {(provided) => (
                        <div className="flex flex-wrap gap-2" {...provided.droppableProps} ref={provided.innerRef}>
                            {categoryGroups.map((g, index) => (
                                <Draggable key={g.id} draggableId={g.id} index={index}>
                                    {(provided, snapshot) => (
                                        <div
                                            ref={provided.innerRef}
                                            {...provided.draggableProps}
                                            className={`bg-[var(--surface-2)] px-3 py-1.5 rounded-lg flex items-center gap-2 group ${snapshot.isDragging ? 'shadow-md ring-2 ring-[var(--brand)] bg-[var(--surface)]' : ''}`}
                                        >
                                            <div {...provided.dragHandleProps} className="text-[var(--text-muted)] hover:text-[var(--text)] cursor-grab active:cursor-grabbing">
                                                <GripVertical size={16} />
                                            </div>
                                            <span className="font-bold text-[var(--text)]">{g.name}</span>
                                            <button onClick={() => handleDeleteCategoryGroup(g.id)} className="text-[var(--text-muted)]/50 hover:text-[var(--err)] opacity-0 group-hover:opacity-100 u-motion u-press">
                                                <X size={14}/>
                                            </button>
                                        </div>
                                    )}
                                </Draggable>
                            ))}
                            {provided.placeholder}
                            {categoryGroups.length === 0 && <span className="text-[var(--text-muted)] text-sm italic">Nenhum grupo criado — categorias soltas continuam funcionando normal.</span>}
                        </div>
                    )}
                </Droppable>
            </DragDropContext>
        </div>

        <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)] mb-2">Categorias</p>
            <div className="flex gap-2 mb-2">
                <Input placeholder="Nova Categoria" value={newCatName} onChange={e => setNewCatName(e.target.value)} />
                <Button onClick={handleAddCategory}><Plus size={20}/></Button>
            </div>
            <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="categories" direction="horizontal" type="category">
                    {(provided) => (
                        <div
                            className="flex flex-wrap gap-2"
                            {...provided.droppableProps}
                            ref={provided.innerRef}
                        >
                            {categories.map((cat, index) => {
                                const scheduleLabel = formatScheduleLabel(cat);
                                return (
                                <Draggable key={cat.id} draggableId={cat.id} index={index}>
                                    {(provided, snapshot) => (
                                        <div
                                            ref={provided.innerRef}
                                            {...provided.draggableProps}
                                            className={`bg-[var(--surface-2)] px-3 py-1.5 rounded-lg flex items-center gap-2 group ${snapshot.isDragging ? 'shadow-md ring-2 ring-[var(--brand)] bg-[var(--surface)]' : ''}`}
                                        >
                                            <div {...provided.dragHandleProps} className="text-[var(--text-muted)] hover:text-[var(--text)] cursor-grab active:cursor-grabbing">
                                                <GripVertical size={16} />
                                            </div>
                                            <span className="font-bold text-[var(--text)]">{cat.name}</span>
                                            {categoryGroups.length > 0 && (
                                                <select
                                                    value={cat.group_id || ''}
                                                    onChange={e => handleChangeCategoryGroup(cat.id, e.target.value || null)}
                                                    className="text-xs bg-[var(--surface)] border border-[var(--border)] rounded px-1.5 py-1 text-[var(--text-muted)]"
                                                >
                                                    <option value="">Sem grupo</option>
                                                    {categoryGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                                                </select>
                                            )}
                                            {scheduleLabel && (
                                                <Badge color="bg-[var(--info)]/10 text-[var(--info)]">{scheduleLabel}</Badge>
                                            )}
                                            <button onClick={() => openScheduleModal(cat)} className="text-[var(--text-muted)]/50 hover:text-[var(--brand)] opacity-0 group-hover:opacity-100 u-motion u-press">
                                                <Clock size={14}/>
                                            </button>
                                            <button onClick={() => handleDeleteCategory(cat.id)} className="text-[var(--text-muted)]/50 hover:text-[var(--err)] opacity-0 group-hover:opacity-100 u-motion u-press">
                                                <X size={14}/>
                                            </button>
                                        </div>
                                    )}
                                </Draggable>
                                );
                            })}
                            {provided.placeholder}
                            {categories.length === 0 && <span className="text-[var(--text-muted)] text-sm italic">Nenhuma categoria criada.</span>}
                        </div>
                    )}
                </Droppable>
            </DragDropContext>
        </div>
    </div>
</Modal>
```

Nota: o `<select>` só aparece quando existe ao menos 1 grupo (`categoryGroups.length > 0`) — loja sem nenhum grupo criado não vê controle extra nenhum, tela idêntica a antes.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: limpo (nenhum erro relacionado a este arquivo).

- [ ] **Step 5: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "$(cat <<'EOF'
CRUD de grupo de categoria no modal Gerenciar categorias

Criar/reordenar (drag)/apagar grupo, e um seletor de grupo por
categoria — só aparece quando a loja já tem algum grupo criado.
EOF
)"
```

---

### Task 5: Cardápio do cliente — bar de 2 níveis (`ClientModule.tsx`)

**Files:**
- Modify: `components/modules/ClientModule.tsx` (import, estado ~L2496-2501, `visibleCategories`/derivados ~L3026-3046, `handleTabClick` ~L3260-3271, JSX da barra ~L3981-4046)

**Interfaces:**
- Consumes: `CategoryGroup` (Task 1); `categoryGroups` retornado por `fetchMenu` (Task 2).
- Produces: `activeGroupId` state, usado só dentro deste componente.

- [ ] **Step 1: Import + estado**

Adicionar `CategoryGroup` ao import de tipos no topo do arquivo. Em `ClientModule.tsx:2496-2501`, junto dos outros `useState`:

```typescript
const [categories, setCategories] = useState<Category[]>([]);
const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);
// ... (activeCategory, showAllCategories já existentes)
const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
```

- [ ] **Step 2: Capturar `categoryGroups` no load (`ClientModule.tsx:2665`)**

```typescript
const { categories, categoryGroups: groups, products, error: menuError } = await fetchMenu(store.id, true);
// ... (linhas existentes que fazem setCategories(categories)/setProducts(products) continuam)
setCategoryGroups(groups);
```

(Inserir a chamada `setCategoryGroups(groups)` no mesmo bloco em que `setCategories`/`setProducts` já são chamados hoje, renomeando a variável desestruturada de `categoryGroups` pra `groups` só nesse `const` pra não colidir com o state de mesmo nome.)

- [ ] **Step 3: Derivados de navegação, logo depois de `visibleCategories` (`ClientModule.tsx:3026-3029`)**

```typescript
const visibleCategories = useMemo(
    () => categories.filter(cat => isCategoryAvailableNow(cat, scheduleNow)),
    [categories, scheduleNow]
);

// Itens de 1º nível na barra: grupo (se tiver ao menos 1 subcategoria
// visível) + categoria solta, todos ordenados juntos por `order`.
const topLevelItems = useMemo(() => {
    type Item = { key: string; kind: 'category'; category: Category } | { key: string; kind: 'group'; group: CategoryGroup };
    const loose: (Item & { order: number })[] = visibleCategories
        .filter(c => !c.group_id)
        .map(c => ({ key: c.id, kind: 'category' as const, category: c, order: c.order }));
    const groups: (Item & { order: number })[] = categoryGroups
        .filter(g => visibleCategories.some(c => c.group_id === g.id))
        .map(g => ({ key: g.id, kind: 'group' as const, group: g, order: g.order }));
    return [...loose, ...groups].sort((a, b) => a.order - b.order);
}, [visibleCategories, categoryGroups]);

const activeCategoryGroupId = useMemo(
    () => visibleCategories.find(c => c.id === activeCategory)?.group_id ?? null,
    [visibleCategories, activeCategory]
);

const expandedGroupSubcategories = useMemo(
    () => activeGroupId ? visibleCategories.filter(c => c.group_id === activeGroupId) : [],
    [visibleCategories, activeGroupId]
);
```

- [ ] **Step 4: `handleTabClick` fecha a fileira de grupo expandida (`ClientModule.tsx:3260-3271`)**

```typescript
const handleTabClick = (categoryId: string) => {
    const section = sectionRefs.current[categoryId];
    if (!section) return;
    isClickScrollingRef.current = true;
    setActiveCategory(categoryId);
    setActiveGroupId(null);
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (clickScrollTimeoutRef.current) clearTimeout(clickScrollTimeoutRef.current);
    clickScrollTimeoutRef.current = setTimeout(() => {
        isClickScrollingRef.current = false;
        clickScrollTimeoutRef.current = null;
    }, 1000);
};
```

- [ ] **Step 5: JSX da barra — substituir `ClientModule.tsx:3981-4046`**

```tsx
{!hasActiveFilter && topLevelItems.length > 0 && (
    <div className="flex items-start gap-2 pl-4">
    <button
        type="button"
        onClick={() => setShowAllCategories(true)}
        aria-label="Ver todas as categorias"
        className="flex-shrink-0 flex items-center gap-1.5 text-[13px] font-semibold pb-1.5 u-motion u-press-sm"
        style={{ color: IFOOD_RED }}
    >
        <LayoutGrid size={16} /> Categorias
    </button>
    <div role="group" aria-label="Categorias do cardápio" className="flex-1 min-w-0 flex gap-5 overflow-x-auto no-scrollbar pr-4 pb-2.5">
        {topLevelItems.map(item => {
            if (item.kind === 'category') {
                const cat = item.category;
                const isActive = activeCategory === cat.id;
                return (
                    <button
                        key={item.key}
                        type="button"
                        ref={el => { tabButtonRefs.current[cat.id] = el; }}
                        onClick={() => handleTabClick(cat.id)}
                        aria-current={isActive ? 'true' : undefined}
                        className={`relative flex-shrink-0 pb-1.5 text-[14px] whitespace-nowrap u-motion ${isActive ? 'text-[var(--text)] font-semibold' : 'text-[var(--text-muted)]'}`}
                    >
                        {theme.categoryEmoji && <span aria-hidden="true">{theme.categoryEmoji} </span>}
                        {cat.name}
                        {isActive && (
                            <motion.div
                                layoutId="categoryTabUnderline"
                                className="absolute left-0 right-0 -bottom-0 h-0.5 rounded-full"
                                style={{ backgroundColor: IFOOD_RED }}
                                transition={SPRING_TAP}
                            />
                        )}
                    </button>
                );
            }
            const group = item.group;
            const isActive = activeGroupId === group.id || activeCategoryGroupId === group.id;
            return (
                <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveGroupId(prev => prev === group.id ? null : group.id)}
                    aria-current={isActive ? 'true' : undefined}
                    aria-expanded={activeGroupId === group.id}
                    className={`relative flex-shrink-0 pb-1.5 text-[14px] whitespace-nowrap u-motion ${isActive ? 'text-[var(--text)] font-semibold' : 'text-[var(--text-muted)]'}`}
                >
                    {group.name}
                    {isActive && (
                        <motion.div
                            layoutId="categoryTabUnderline"
                            className="absolute left-0 right-0 -bottom-0 h-0.5 rounded-full"
                            style={{ backgroundColor: IFOOD_RED }}
                            transition={SPRING_TAP}
                        />
                    )}
                </button>
            );
        })}
    </div>
    </div>
)}

{!hasActiveFilter && activeGroupId && expandedGroupSubcategories.length > 0 && (
    <div className="flex-1 min-w-0 flex gap-4 overflow-x-auto no-scrollbar pl-4 pr-4 pb-2 -mt-1">
        {expandedGroupSubcategories.map(cat => (
            <button
                key={cat.id}
                type="button"
                onClick={() => handleTabClick(cat.id)}
                className="flex-shrink-0 px-3 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap u-motion bg-[var(--surface-2)] text-[var(--text)]"
            >
                {cat.name}
            </button>
        ))}
    </div>
)}

<Modal isOpen={showAllCategories} onClose={() => setShowAllCategories(false)} title="Categorias" variant="sheet">
    <div className="space-y-4">
        {visibleCategories.filter(c => !c.group_id).length > 0 && (
            <div className="grid grid-cols-2 gap-2">
                {visibleCategories.filter(c => !c.group_id).map(cat => {
                    const qtd = (productsByCategory[cat.id] || []).length;
                    return (
                        <button
                            key={cat.id}
                            type="button"
                            onClick={() => { setShowAllCategories(false); handleTabClick(cat.id); }}
                            className="text-left rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3 u-motion u-press-sm text-[var(--text)]"
                        >
                            <span className="block text-[14px] font-semibold leading-tight">{cat.name}</span>
                            <span className="block text-[12px] text-[var(--text-muted)] mt-0.5">{qtd} {qtd === 1 ? 'item' : 'itens'}</span>
                        </button>
                    );
                })}
            </div>
        )}
        {categoryGroups.map(group => {
            const catsInGroup = visibleCategories.filter(c => c.group_id === group.id);
            if (catsInGroup.length === 0) return null;
            return (
                <div key={group.id}>
                    <p className="text-[12px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-2">{group.name}</p>
                    <div className="grid grid-cols-2 gap-2">
                        {catsInGroup.map(cat => {
                            const qtd = (productsByCategory[cat.id] || []).length;
                            return (
                                <button
                                    key={cat.id}
                                    type="button"
                                    onClick={() => { setShowAllCategories(false); handleTabClick(cat.id); }}
                                    className="text-left rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3 u-motion u-press-sm text-[var(--text)]"
                                >
                                    <span className="block text-[14px] font-semibold leading-tight">{cat.name}</span>
                                    <span className="block text-[12px] text-[var(--text-muted)] mt-0.5">{qtd} {qtd === 1 ? 'item' : 'itens'}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            );
        })}
    </div>
</Modal>
```

Nota de comportamento (documentar no commit): o sheet lista primeiro as categorias soltas, depois cada grupo com seu cabeçalho — não interpola por `order` geral entre solta/grupo dentro do sheet (diferente da barra do topo, que interpola). É uma simplificação deliberada: o sheet já é uma lista vertical rolável, a ordem exata entre "categoria solta X" e "grupo Y" ali importa menos que a barra do topo, onde a ordem lateral é a primeira coisa que o cliente vê.

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: limpo — este era o último call site de `fetchMenu` faltando (`StoreTableMenu`, Task 6, ainda vai gerar erro até lá).

- [ ] **Step 7: Commit**

```bash
git add components/modules/ClientModule.tsx
git commit -m "$(cat <<'EOF'
Cardápio do cliente: barra de categoria em 2 níveis (grupo→subcategoria)

Grupo aparece na barra do topo; tocar nele expande uma fileira com as
subcategorias (nunca mistura produtos de subcategorias diferentes).
Sheet "Categorias" ganha os mesmos cabeçalhos de grupo. Categoria sem
grupo continua idêntica a antes.
EOF
)"
```

---

### Task 6: Cardápio do garçom — bar de 2 níveis (`StoreTableMenu`)

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`StoreTableMenu`, ~L1648-1662 estado/fetch, ~L1699-1731 barra, ~L1734-1760 sheet)

**Interfaces:**
- Consumes: `CategoryGroup` (Task 1), `categoryGroups` de `fetchMenu` (Task 2).

- [ ] **Step 1: Estado + fetch (`StoreModule.tsx:1648-1662`)**

```typescript
const StoreTableMenu: React.FC<{ storeId: string, onAddItem: (product: Product, qty: number, notes: string, selectedOptions: SelectedOption[]) => void }> = ({ storeId, onAddItem }) => {
    const [categories, setCategories] = useState<Category[]>([]);
    const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [activeCategory, setActiveCategory] = useState<string>('');
    const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [showAllCategories, setShowAllCategories] = useState(false);

    useEffect(() => {
        fetchMenu(storeId, true).then(({ categories, categoryGroups, products }) => {
            setCategories(categories);
            setCategoryGroups(categoryGroups);
            setProducts(products);
            if (categories.length > 0) setActiveCategory(categories[0].id);
        });
    }, [storeId]);
```

- [ ] **Step 2: Derivados de navegação, logo antes do `return` (depois de `filteredProducts`, `StoreModule.tsx:1682`)**

```typescript
const topLevelItems = useMemo(() => {
    type Item = { key: string; kind: 'category'; category: Category } | { key: string; kind: 'group'; group: CategoryGroup };
    const loose: (Item & { order: number })[] = categories
        .filter(c => !c.group_id)
        .map(c => ({ key: c.id, kind: 'category' as const, category: c, order: c.order }));
    const groups: (Item & { order: number })[] = categoryGroups
        .filter(g => categories.some(c => c.group_id === g.id))
        .map(g => ({ key: g.id, kind: 'group' as const, group: g, order: g.order }));
    return [...loose, ...groups].sort((a, b) => a.order - b.order);
}, [categories, categoryGroups]);

const activeCategoryGroupId = useMemo(
    () => categories.find(c => c.id === activeCategory)?.group_id ?? null,
    [categories, activeCategory]
);

const expandedGroupSubcategories = useMemo(
    () => activeGroupId ? categories.filter(c => c.group_id === activeGroupId) : [],
    [categories, activeGroupId]
);

const selectSubcategory = (categoryId: string) => {
    setSearchTerm('');
    setActiveCategory(categoryId);
    setActiveGroupId(null);
};
```

- [ ] **Step 3: JSX da barra — substituir `StoreModule.tsx:1699-1731`**

```tsx
<div className="flex items-start gap-2">
<button
    type="button"
    onClick={() => setShowAllCategories(true)}
    aria-label="Ver todas as categorias"
    className="flex-shrink-0 flex items-center gap-1.5 text-[13px] font-semibold pb-1.5 u-motion u-press-sm"
    style={{ color: GARCOM_IFOOD_RED }}
>
    <LayoutGrid size={16} /> Categorias
</button>
<div className="flex-1 min-w-0 flex gap-5 overflow-x-auto no-scrollbar pb-2.5">
    {topLevelItems.map(item => {
        if (item.kind === 'category') {
            const cat = item.category;
            const isActive = activeCategory === cat.id;
            return (
                <button
                    key={item.key}
                    type="button"
                    onClick={() => selectSubcategory(cat.id)}
                    aria-current={isActive ? 'true' : undefined}
                    className={`relative flex-shrink-0 pb-1.5 text-[14px] whitespace-nowrap u-motion ${isActive ? 'text-[var(--text)] font-semibold' : 'text-[var(--text-muted)]'}`}
                >
                    {cat.name}
                    {isActive && (
                        <span className="absolute left-0 right-0 -bottom-0 h-0.5 rounded-full" style={{ backgroundColor: GARCOM_IFOOD_RED }} />
                    )}
                </button>
            );
        }
        const group = item.group;
        const isActive = activeGroupId === group.id || activeCategoryGroupId === group.id;
        return (
            <button
                key={item.key}
                type="button"
                onClick={() => setActiveGroupId(prev => prev === group.id ? null : group.id)}
                aria-current={isActive ? 'true' : undefined}
                aria-expanded={activeGroupId === group.id}
                className={`relative flex-shrink-0 pb-1.5 text-[14px] whitespace-nowrap u-motion ${isActive ? 'text-[var(--text)] font-semibold' : 'text-[var(--text-muted)]'}`}
            >
                {group.name}
                {isActive && (
                    <span className="absolute left-0 right-0 -bottom-0 h-0.5 rounded-full" style={{ backgroundColor: GARCOM_IFOOD_RED }} />
                )}
            </button>
        );
    })}
</div>
</div>
{activeGroupId && expandedGroupSubcategories.length > 0 && (
    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 -mt-1">
        {expandedGroupSubcategories.map(cat => (
            <button
                key={cat.id}
                type="button"
                onClick={() => selectSubcategory(cat.id)}
                className="flex-shrink-0 px-3 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap u-motion bg-[var(--surface-2)] text-[var(--text)]"
            >
                {cat.name}
            </button>
        ))}
    </div>
)}
```

- [ ] **Step 4: JSX do sheet — substituir `StoreModule.tsx:1734-1760`**

```tsx
<Modal isOpen={showAllCategories} onClose={() => setShowAllCategories(false)} title="Categorias">
    <div className="space-y-4">
        <button
            type="button"
            onClick={() => { setSearchTerm(''); setActiveCategory(''); setActiveGroupId(null); setShowAllCategories(false); }}
            className={`w-full text-left rounded-xl border px-3 py-3 text-sm font-bold u-motion u-press-sm ${activeCategory === '' ? 'border-current bg-[var(--surface-2)]' : 'border-[var(--border)] text-[var(--text)]'}`}
            style={activeCategory === '' ? { color: GARCOM_IFOOD_RED } : undefined}
        >
            Ver todos os produtos <span className="font-normal text-[var(--text-muted)]">({products.length})</span>
        </button>
        {categories.filter(c => !c.group_id).length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {categories.filter(c => !c.group_id).map(cat => {
                    const qtd = products.filter(p => p.category_id === cat.id).length;
                    const isActive = activeCategory === cat.id;
                    return (
                        <button
                            key={cat.id}
                            type="button"
                            onClick={() => { selectSubcategory(cat.id); setShowAllCategories(false); }}
                            className={`text-left rounded-xl border px-3 py-3 u-motion u-press-sm ${isActive ? 'border-current bg-[var(--surface-2)]' : 'border-[var(--border)]'}`}
                            style={isActive ? { color: GARCOM_IFOOD_RED } : undefined}
                        >
                            <span className="block text-sm font-bold text-[var(--text)] leading-tight">{cat.name}</span>
                            <span className="block text-xs text-[var(--text-muted)] mt-0.5">{qtd} {qtd === 1 ? 'item' : 'itens'}</span>
                        </button>
                    );
                })}
            </div>
        )}
        {categoryGroups.map(group => {
            const catsInGroup = categories.filter(c => c.group_id === group.id);
            if (catsInGroup.length === 0) return null;
            return (
                <div key={group.id}>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-2">{group.name}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {catsInGroup.map(cat => {
                            const qtd = products.filter(p => p.category_id === cat.id).length;
                            const isActive = activeCategory === cat.id;
                            return (
                                <button
                                    key={cat.id}
                                    type="button"
                                    onClick={() => { selectSubcategory(cat.id); setShowAllCategories(false); }}
                                    className={`text-left rounded-xl border px-3 py-3 u-motion u-press-sm ${isActive ? 'border-current bg-[var(--surface-2)]' : 'border-[var(--border)]'}`}
                                    style={isActive ? { color: GARCOM_IFOOD_RED } : undefined}
                                >
                                    <span className="block text-sm font-bold text-[var(--text)] leading-tight">{cat.name}</span>
                                    <span className="block text-xs text-[var(--text-muted)] mt-0.5">{qtd} {qtd === 1 ? 'item' : 'itens'}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            );
        })}
    </div>
</Modal>
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: limpo — nenhum call site de `fetchMenu` sem `categoryGroups` sobrando.

- [ ] **Step 6: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "$(cat <<'EOF'
Cardápio do garçom: barra de categoria em 2 níveis (grupo→subcategoria)

Mesma lógica do cliente, adaptada ao fluxo sem scroll-spy (tocar numa
subcategoria só troca o filtro ativo, sem scroll).
EOF
)"
```

---

### Task 7: Deploy + QA ao vivo nas 3 superfícies

**Files:** nenhum (deploy + verificação).

- [ ] **Step 1: `npm run build` local**

```bash
npm run build
```

Esperado: build limpo, mesmas rotas de sempre, sem erro de tipo/lint bloqueante.

- [ ] **Step 2: Deploy**

```bash
git push
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```

Esperado: serviço `ntb-vendas.service` reinicia limpo (`Ready in ...ms`).

- [ ] **Step 3: QA de CRUD na Bistrô Demo (loja de teste sancionada)**

Via Playwright (login como universal ou store_user da Bistrô Demo, mesma técnica já usada nesta sessão — senha lida via `docker exec ... psql` pra um arquivo local, nunca impressa):
1. Abrir Gestão de Cardápio → "Categorias" → criar 2 grupos de teste (ex. "Grupo A", "Grupo B").
2. Atribuir 2 categorias reais da Bistrô Demo a "Grupo A" via `<select>`.
3. Fechar o modal, confirmar visualmente que a sidebar agora mostra "Grupo A" como cabeçalho com as 2 categorias embaixo, e as demais categorias da loja continuam soltas no topo.
4. Reordenar os 2 grupos via drag, confirmar que a ordem persiste após F5.
5. Apagar "Grupo B" (sem categoria dentro), confirmar que some sem erro.
6. Desfazer o teste: remover o `group_id` das 2 categorias (voltar "Sem grupo") e apagar "Grupo A" — a Bistrô Demo deve voltar exatamente ao estado de antes do teste.

- [ ] **Step 4: QA visual (sem escrever nada) no Sertão**

Screenshot de `/loja` (Cardápio) e de `/c/sertao-vai-virar-mar` confirmando que, sem nenhum grupo criado ainda pra essa loja, as 3 superfícies continuam exibindo as categorias soltas exatamente como antes desta feature (regressão zero pra quem ainda não usa grupo).

- [ ] **Step 5: Limpar qualquer scratch/credencial temporária**

```bash
rm -rf <pasta de scratch usada no QA>
```

Nenhum arquivo de senha deve sobrar fora do scratchpad da sessão.

---

## Self-Review

**Cobertura da spec:** §2 (modelo de dados) → Task 1. §3 (lojista) → Tasks 3-4. §4 (cliente) → Task 5. §5 (garçom) → Task 6. §6 (fora de escopo) → nenhuma task viola (sem 3º nível, sem produto direto em grupo, sem migração automática de conteúdo do Sertão).

**Placeholders:** nenhum "TBD"/"implementar depois" — todo step tem código completo ou comando exato.

**Consistência de tipos:** `CategoryGroup { id, store_id, name, order }` usado igual nas Tasks 1/2/3/4/5/6. `fetchMenu` retorna `categoryGroups` (nome usado igual em todos os call sites). `updateCategoryGroupAssignment(categoryId, groupId)` só chamado na Task 4 — assinatura bate com a definição da Task 2.
