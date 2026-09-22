# Grupos de categoria (Bebidas → Geladas/Vinhos/..., Pizzas → variações)

## 1. Motivação

Lojas com cardápio grande (ex.: "O Sertão Vai Virar Mar", 17+ categorias:
Geladas, Artesanais, Long, Geladas sem Álcool, Quentes, Conhaques, Whisky,
Drinks, Drinks Especiais, Licor, Vinhos, Vinhos Tintos, Vinhos Brancos,
Vinhos Rosés, Vinhos Espumante, Entradas - Caldos, Entradas - Petiscos...)
ficam com uma lista de categoria longa demais pra navegar bem, tanto no
painel do lojista quanto no cardápio do cliente. Pedido explícito do dono
(2026-09-22): agrupar categorias relacionadas (ex. "Bebidas" contendo
Geladas/Vinhos/Vinhos Tintos/Drinks/..., "Pizzas" contendo as variações de
pizza) — clicar num grupo revela as subcategorias, escolher uma delas
mostra os produtos. Vale pras 3 superfícies que hoje navegam categoria:
painel do lojista (`MenuManagementView`), cardápio do cliente
(`ClientModule.tsx`) e o cardápio do garçom lançando pedido na mesa
(`StoreTableMenu`, réplica visual do cliente por convenção do projeto).

## 2. Modelo de dados

Nova tabela **`category_groups`**, mesmo nível de sensibilidade de
`categories` (pública, `allow_all_anon`, sem RPC — segue o padrão já usado
por `createCategory`/`deleteCategory`/`updateCategoryOrder` em `lib/api.ts`):

```sql
create table category_groups (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  "order" int not null default 0,
  created_at timestamptz not null default now()
);
alter table category_groups enable row level security;
create policy allow_all_anon on category_groups for all using (true) with check (true);

alter table categories add column group_id uuid references category_groups(id) on delete set null;
```

`categories.group_id` é **nullable** — categoria sem grupo continua
aparecendo como item de primeiro nível, exatamente como hoje. Nenhuma loja
existente precisa migrar nada; o recurso é opt-in por loja/categoria.
`on delete set null` (não cascade): apagar um grupo nunca apaga a
categoria, só desagrupa ela.

`fetchMenu` (`lib/api.ts:453`) passa a buscar `category_groups` da loja
numa segunda query paralela às já existentes (categorias/produtos), e
`fetchCategories`/o que o `MenuManagementView` usa hoje ganha o mesmo
tratamento. `renomear` a variável local `productGroupsWithItems`
(`StoreModule.tsx:7500+`) para `categoriesWithItems` durante a
implementação — nome coincidente com o "grupo" novo que confundiria
qualquer leitura futura do código (achado no research, sem relação com o
grupo de categoria, só uma categoria com contagem de produto).

## 3. Painel do lojista — `MenuManagementView`

**Sidebar** (a lista lateral criada em 2026-09-22, `StoreModule.tsx`
~L7709-7745): categorias sem grupo continuam como item direto da lista.
Categorias com grupo ficam agrupadas sob um cabeçalho com o nome do grupo
(texto pequeno, maiúsculo, não-clicável, cor `--text-muted`, mesmo padrão
visual de um rótulo de seção), com suas categorias indentadas embaixo. A
ordem dos grupos entre si segue `category_groups.order`; ordem das
categorias sem grupo e a ordem das categorias dentro de um grupo seguem
`categories.order` como hoje.

**Modal "Gerenciar categorias"** (`StoreModule.tsx:7835-7884`): cada linha
de categoria ganha um `<select>` "Grupo" (opções: "Sem grupo" + grupos
existentes da loja) ao lado do nome — muda `categories.group_id` direto,
sem precisar de tela própria de "editar categoria". CRUD de **grupo** (criar
nome, reordenar via drag como já existe pra categoria, apagar) entra como
uma seção nova no topo do mesmo modal, antes da lista de categorias —
reaproveita o mesmo padrão de `<Input>` + botão "+" já usado pra criar
categoria. Apagar um grupo com categorias dentro não apaga as categorias
(vira `group_id = null`, aviso simples "N categorias vão ficar sem grupo").

## 4. Cardápio do cliente — `ClientModule.tsx`

**Abordagem escolhida: bar de 2 níveis** (decisão do dono: clicar num
grupo obriga escolher uma subcategoria antes de ver produto — nunca
mistura produtos de subcategorias diferentes numa lista só).

- **Barra horizontal do topo** (`ClientModule.tsx:3981-4026`): passa a
  listar só itens de primeiro nível — grupos e categorias sem grupo,
  misturados na ordem configurada (`category_groups.order` e
  `categories.order` intercalados por posição, mesmo critério visual de
  "ordem geral" que o lojista já define ao arrastar). Tocar numa
  categoria sem grupo: comportamento idêntico a hoje (scroll-spy, sublinha
  a aba, rola até a seção). Tocar num grupo: abre uma segunda fileira fina
  logo abaixo da barra principal, com chips das subcategorias daquele
  grupo (mesmo estilo de aba, só menor); tocar numa subcategoria fecha
  essa fileira, rola até a seção dela e marca o GRUPO como "aba ativa" na
  barra principal (sublinhado no grupo, não numa subcategoria — a barra
  principal só conhece nível 1).
- **Sheet "Categorias"** (`ClientModule.tsx:4029`, já existe): a grade
  2-colunas ganha cabeçalhos de grupo (texto, não clicável) entre as
  categorias daquele grupo — mesma ideia da sidebar do lojista. Categoria
  sem grupo continua aparecendo solta na grade, na posição de sempre.
- **`isCategoryAvailableNow`** continua igual — categoria fora do horário
  some da lista (inclusive de dentro do grupo); se TODAS as subcategorias
  de um grupo saírem do horário, o grupo inteiro some da barra/sheet (não
  aparece grupo vazio).
- **Scroll-spy**: nenhuma mudança na renderização das seções em si —
  todas as categorias (agrupadas ou não) continuam sendo seções
  sequenciais na mesma página, só a NAVEGAÇÃO até elas ganha o nível
  extra. `activeCategory` continua guardando a categoria (folha), nunca o
  grupo — o grupo é só um estado de UI (`activeGroupId`, mostrando a
  segunda fileira), sem afetar o scroll-spy existente.

## 5. Cardápio do garçom — `StoreTableMenu` (`StoreModule.tsx:1710/1745`)

Réplica funcional do padrão acima, adaptado ao visual do painel do
lojista (mesmo princípio de sempre neste componente: cópia própria, sem
compartilhar componente com `ClientModule`). Bar de 2 níveis idêntica em
comportamento (grupo expande subcategorias, categoria sem grupo direto);
sem "Destaques"/scroll-spy nesse fluxo (ele já usa lista simples com
`max-h`/scroll interno, não seção-por-scroll), então tocar numa
subcategoria só troca o filtro ativo da lista, sem scroll — mais simples
que o cliente.

## 6. Fora de escopo (não pedido, não fazer sem pedido explícito)

- Mais de 2 níveis de hierarquia (grupo dentro de grupo) — o pedido é
  claramente 2 níveis (grupo → categoria → produto).
- Grupo com produto direto (sem categoria) — todo produto continua preso
  a uma categoria; grupo nunca tem produto próprio.
- Migrar automaticamente as categorias existentes do Sertão pros grupos
  sugeridos pelo dono ("Bebidas", "Pizzas") — isso é dado/conteúdo, não
  schema; fica pra depois que a feature estiver no ar, como um passo
  separado de cadastro (o dono ou alguém da loja monta os grupos reais
  pela UI nova).
- Tela de destaques (`featured`) e busca por nome/descrição no cliente
  continuam ignorando grupo — já cruzam categoria livremente hoje, sem
  necessidade de mudar.
