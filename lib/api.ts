import { supabase } from '@/lib/supabaseClient';
import { Store, Table, Product, Category, OrderItem, OrderStatus, TableStatus, CartItem, StoreUser, Order, TableSession, StoreFiscalCertificateStatus, StoreFiscalConfig, OrderRating, UniversalUser, ProductOptionGroup, FiscalNota } from '@/types';
import { StoreModules, OrderFlow, isDefaultStoreModules } from '@/lib/storeModules';
import { checkAccentColorContrast } from '@/lib/colorContrast';

// Autentica via function Postgres security definer (nunca compara senha no
// client) — ver supabase/migrations/008_seguranca_login.sql. A function já
// cobre rate-limit (5 tentativas / 5min de bloqueio); o client não precisa
// distinguir "bloqueado" de "senha errada" pra manter a mesma assinatura de
// retorno de antes.
export const authenticateAdmin = async (username: string, password: string): Promise<{ success: boolean; mustChangePass?: boolean; userId?: string }> => {
  const { data, error } = await supabase.rpc('authenticate_admin_secure', {
    p_username: username,
    p_password: password,
  });

  if (error || !data?.success) return { success: false };

  return { success: true, mustChangePass: data.mustChangePass, userId: data.userId };
};

export const updateAdminPassword = async (userId: string, newPassword: string) => {
  const { error } = await supabase.rpc('update_admin_password_secure', { p_user_id: userId, p_new_password: newPassword });
  if (error) throw error;
};

export const updateStoreConfig = async (storeId: string, config: any) => {
  const { error } = await supabase
    .from('stores')
    .update({ config })
    .eq('id', storeId);
  if (error) throw error;
};

// Cor de destaque por loja (Task 6, stores.config.accent_color) — mesmo padrão
// jsonb de service_fee_rate/note_suggestions (sem coluna nova), mas com uma
// trava de contraste ENFORCED aqui, não só sugerida na UI: qualquer hex que
// não atinja o mínimo legível contra o fundo escuro real do cardápio
// (`.on-glass`, `#15171d` — ver lib/colorContrast.ts) é recusado ANTES de
// chamar updateStoreConfig, nunca persistido. `hexColor: null` limpa a
// config (volta pro WINE_GOLD padrão em ClientModule.tsx, sem trava nenhuma
// já que não há cor nenhuma sendo salva).
export const updateStoreAccentColor = async (storeId: string, currentConfig: any, hexColor: string | null): Promise<any> => {
  if (hexColor) {
    const check = checkAccentColorContrast(hexColor);
    if (!check.legible) {
      throw new Error(check.message || 'Cor de destaque inválida.');
    }
  }
  const newConfig = { ...(currentConfig || {}), accent_color: hexColor };
  await updateStoreConfig(storeId, newConfig);
  return newConfig;
};

// Atualização isolada de `cover_url` (Task 1, imagem de capa do cardápio,
// migration 047). O Master Admin grava `cover_url` como parte do payload
// completo de `createStore`/`updateStore` (mesmo tratamento de `logo_url`,
// já que "Editar Loja" já reúne todos os campos da loja). O lojista, em
// `MenuManagementView` ("Configurações Gerais"), não tem — nem deveria
// precisar montar — esse payload inteiro (nome/CNPJ/slug/contrato/mesas)
// só pra trocar a capa; por isso uma função dedicada, mesmo padrão simples
// de `updateStoreConfig` acima.
export const updateStoreCoverUrl = async (storeId: string, coverUrl: string | null): Promise<{ success: boolean; message?: string }> => {
  try {
    const { error } = await supabase
      .from('stores')
      .update({ cover_url: coverUrl })
      .eq('id', storeId);
    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message || 'Erro desconhecido ao salvar a capa.' };
  }
};

// Idem authenticateAdmin: senha comparada dentro da function security definer
// authenticate_store_user_secure, não mais no client (008_seguranca_login.sql).
// A function não conhece/retorna a loja (só store_id), então busca à parte pra
// preservar a mesma checagem de "loja inativa ou bloqueada" que a query direta
// fazia antes via join. Por não distinguir "não encontrado" de "senha errada"
// (a function devolve success:false pros dois, de propósito, pra não vazar se o
// e-mail existe), as duas mensagens antigas viram uma só, genérica.
export const authenticateStoreUser = async (email: string, password: string): Promise<{ success: boolean; user?: StoreUser & { store: Store }; message?: string }> => {
  try {
    const { data, error } = await supabase.rpc('authenticate_store_user_secure', {
      p_email: email,
      p_password: password,
    });

    if (error) return { success: false, message: 'Erro de conexão.' };
    if (!data?.success) {
      return {
        success: false,
        message: data?.locked ? 'Muitas tentativas incorretas. Tente novamente em alguns minutos.' : 'Usuário ou senha incorretos.',
      };
    }

    const store = await fetchStoreById(data.user.store_id);
    if (!store || !store.is_active) return { success: false, message: 'Esta loja está inativa ou bloqueada.' };

    const user: StoreUser & { store: Store } = {
      ...data.user,
      must_change_password: data.mustChangePass,
      store,
    };

    return { success: true, user };
  } catch (error: any) {
    console.error('Auth Store User Error:', error);
    return { success: false, message: 'Erro de conexão.' };
  }
};

export const updateStoreUserPassword = async (userId: string, newPassword: string) => {
  const { error } = await supabase.rpc('update_store_user_password_secure', { p_user_id: userId, p_new_password: newPassword });
  if (error) throw error;
};

// Restaura a sessão do lojista depois de um F5 (achado de bug #6 — antes o
// login se perdia no meio do turno). Rebusca o store_user pelo id salvo no
// localStorage no login bem-sucedido e revalida a loja com a mesma checagem
// de authenticateStoreUser (loja precisa existir e continuar ativa); nunca
// reautentica por senha, só usada quando já existe uma sessão local salva.
// Passa por uma RPC (nunca select direto): store_users não tem mais policy
// de SELECT pra anon desde a 014_fecha_vazamento_senhas.sql.
export const fetchStoreUserById = async (userId: string): Promise<(StoreUser & { store: Store }) | null> => {
  const { data, error } = await supabase.rpc('fetch_store_user_by_id_secure', { p_user_id: userId });
  if (error || !data) return null;

  const store = await fetchStoreById(data.store_id);
  if (!store || !store.is_active) return null;

  return { ...data, store };
};

// As 4 funções abaixo passam por RPC (nunca acesso direto à tabela):
// store_users não tem mais nenhuma policy pra anon desde a
// 014_fecha_vazamento_senhas.sql (era de onde vazava a senha em texto
// puro de todas as lojas reais).
export const fetchStoreTeamMembers = async (storeId: string): Promise<StoreUser[]> => {
  const { data, error } = await supabase.rpc('fetch_store_team_members_secure', { p_store_id: storeId });
  if (error) { console.error('Error fetching store team:', error); return []; }
  return data || [];
};

// assignedTableIds (Task 3, migration 049): null/undefined = sem restrição
// (todas as mesas) — mesmo default de todo store_user existente.
export const createStoreTeamMember = async (storeId: string, userData: { name: string; email: string; password?: string; role: string; permissions: any; assignedTableIds?: string[] | null }) => {
  const { data, error } = await supabase.rpc('create_store_team_member_secure', {
    p_store_id: storeId,
    p_name: userData.name,
    p_email: userData.email,
    p_password: userData.password || '123456',
    p_role: userData.role,
    p_permissions: userData.permissions,
    p_assigned_table_ids: userData.assignedTableIds ?? null,
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.message || 'Erro ao criar usuário.');
  return data;
};

export const updateStoreTeamMember = async (userId: string, userData: { name?: string; email?: string; role?: string; permissions?: any; password?: string; assigned_table_ids?: string[] | null }) => {
  const { data, error } = await supabase.rpc('update_store_user_secure', { p_user_id: userId, p_updates: userData });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.message || 'Erro ao atualizar usuário.');
  return data;
};

export const deleteStoreTeamMember = async (userId: string) => {
  const { error } = await supabase.rpc('delete_store_user_secure', { p_user_id: userId });
  if (error) throw error;
};

export const fetchAllStores = async (): Promise<Store[]> => {
  const { data, error } = await supabase
    .from('stores')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error('Error fetching stores:', error); return []; }
  return data || [];
};

// Distingue "loja não existe" (PGRST116 do .single(), zero linhas) de erro de
// rede/timeout (achado de UX #4) — antes os dois casos engoliam o erro e
// devolviam null igualmente, então uma falha de conexão aparecia pro cliente
// como se a loja simplesmente não existisse. ClientModule usa esse
// discriminador pra mostrar "Erro de conexão — Tentar de novo" só quando faz
// sentido (network), e "Loja não encontrada" só quando de fato não existe.
export const fetchStoreBySlug = async (slug: string): Promise<{ store: Store | null; error?: 'not_found' | 'network' }> => {
  try {
    const { data, error } = await supabase.from('stores').select('*').eq('slug', slug).single();
    if (error) {
      if (error.code === 'PGRST116') return { store: null, error: 'not_found' };
      console.error('Error fetching store:', error);
      return { store: null, error: 'network' };
    }
    return { store: data };
  } catch (error) {
    console.error('Error fetching store:', error);
    return { store: null, error: 'network' };
  }
};

export const fetchStoreById = async (storeId: string): Promise<Store | null> => {
  const { data, error } = await supabase.from('stores').select('*').eq('id', storeId).single();
  if (error) { console.error('Error fetching store by id:', error); return null; }
  return data;
};

// As 4 funções abaixo (visão do Master Admin) também passam por RPC,
// mesmo motivo das equivalentes do lojista acima.
export const createStoreUser = async (storeId: string, name: string, email: string, password: string): Promise<{ success: boolean; message?: string }> => {
  try {
    const { data, error } = await supabase.rpc('create_store_team_member_secure', {
      p_store_id: storeId,
      p_name: name,
      p_email: email,
      p_password: password,
      p_role: 'owner',
      p_permissions: { tables: true, counter: true, kitchen: true, menu: true, admin: true },
    });
    if (error) throw error;
    if (!data?.success) return { success: false, message: data?.message };
    return { success: true };
  } catch (error: any) {
    console.error('Create User Error:', error);
    return { success: false, message: error.message };
  }
};

export const updateStoreUser = async (userId: string, updates: Partial<StoreUser> & { password?: string }): Promise<{ success: boolean; message?: string }> => {
  try {
    const { data, error } = await supabase.rpc('update_store_user_secure', { p_user_id: userId, p_updates: updates });
    if (error) throw error;
    if (!data?.success) return { success: false, message: data?.message };
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

export const deleteStoreUser = async (userId: string): Promise<{ success: boolean; message?: string }> => {
  try {
    const { error } = await supabase.rpc('delete_store_user_secure', { p_user_id: userId });
    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

export const fetchStoreUsers = async (): Promise<(StoreUser & { store: Store })[]> => {
  const { data, error } = await supabase.rpc('fetch_all_store_users_secure');
  if (error) { console.error('Fetch Users Error:', error); return []; }
  return (data as any) || [];
};

// Idem fetchStoreBySlug: distingue erro de rede/timeout de "cardápio vazio de
// verdade" (0 categorias/produtos é um estado legítimo, não um erro). Antes,
// qualquer erro de rede virava silenciosamente `{ categories: [], products:
// [] }` — indistinguível de uma loja que só ainda não cadastrou nada.
// Busca product_option_groups(+ product_options) da loja inteira (não
// depende da lista de produtos recebida — só do storeId), pra poder rodar
// em paralelo com as queries de categorias/produtos em fetchMenu em vez de
// depois delas. Filtro por loja via !inner em products (mesmo padrão de
// fetchKitchenOrders — sem !inner o filtro não restringe as linhas
// devolvidas, só zera o campo embutido, ver AGENTS.md). `.limit(500)`, mesmo
// padrão de fetchActiveOrdersForTables/fetchKitchenOrders.
// `includeUnavailable`: false/omitido (cardápio do cliente e fluxo de
// pedido do garçom) filtra product_options só `available = true`; true
// (MenuManagementView editando produto) traz todas, inclusive indisponíveis.
//
// Opções vêm via embed de 2 níveis (product_options aninhado direto em
// product_option_groups) — não mais numa 2ª leitura separada com
// `.in('group_id', groupIds)` como antes (2026-08-17, achado real ao
// consolidar o cardápio de uma loja com ~60 produtos-pai/grupos: essa 2ª
// query monta uma URL com TODOS os group_id da loja concatenados em
// `group_id=in.(...)` — cresce direto com o nº de grupos e derrubou o
// `nginx` do `testvendase` (self-hosted) com 502 Bad Gateway assim que a
// loja passou de ~60 grupos, por estourar o limite de tamanho de header/URL
// da requisição. O embed faz o join dentro do próprio Postgres — o tamanho
// da URL não cresce mais com a quantidade de grupos/opções da loja).
async function fetchOptionGroupsByProduct(storeId: string, includeUnavailable = false): Promise<Map<string, ProductOptionGroup[]>> {
  let query = supabase
    .from('product_option_groups')
    .select('*, product:products!inner(store_id), product_options(*)')
    .eq('product.store_id', storeId)
    .order('order')
    .order('order', { referencedTable: 'product_options' })
    .limit(500);
  if (!includeUnavailable) query = query.eq('product_options.available', true);
  const { data: groupsData, error: groupsError } = await query;
  if (groupsError || !groupsData || groupsData.length === 0) {
    if (groupsError) console.error('Fetch product option groups error:', groupsError);
    return new Map();
  }

  const groupsByProduct = new Map<string, ProductOptionGroup[]>();
  for (const g of groupsData as any[]) {
    const list = groupsByProduct.get(g.product_id) || [];
    list.push({
      id: g.id, product_id: g.product_id, name: g.name, type: g.type, required: g.required,
      min_select: g.min_select ?? null, max_select: g.max_select ?? null, order: g.order,
      options: (g.product_options || []).map((o: any) => ({
        id: o.id, group_id: o.group_id, name: o.name, price_delta: Number(o.price_delta), available: o.available, order: o.order,
      })),
    });
    groupsByProduct.set(g.product_id, list);
  }

  return groupsByProduct;
}

function mergeOptionGroups(products: Product[], groupsByProduct: Map<string, ProductOptionGroup[]>): Product[] {
  return products.map(p => ({ ...p, option_groups: groupsByProduct.get(p.id) || [] }));
}

// Vende mais II (migration 020) — "peca tambem": segue exatamente o mesmo
// padrao de fetchOptionGroupsByProduct acima (join !inner em products pra
// filtrar por loja, ver AGENTS.md sobre embed do Postgrest sem !inner nao
// restringir linhas). Sem policy de escrita pro anon nessa tabela (só
// SELECT) — toda escrita passa por sync_product_recommendations (RPC
// security definer). Erro/vazio devolve Map vazio, mesmo fallback de
// fetchOptionGroupsByProduct: recomendação é um detalhe do form do lojista,
// não pode quebrar o carregamento do cardápio.
// Achado real em QA (2026-07-06): `product_recommendations` tem 2 FKs pra
// `products` (product_id e recommended_product_id) — sem nomear qual FK
// usar no embed, o PostgREST devolve PGRST201 (relacionamento ambíguo),
// erro que o catch abaixo engolia silenciosamente, fazendo "Peça também"
// nunca aparecer pra ninguém. Precisa apontar a FK explicitamente.
async function fetchProductRecommendationsByStore(storeId: string): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from('product_recommendations')
    .select('*, product:products!product_recommendations_product_id_fkey!inner(store_id)')
    .eq('product.store_id', storeId)
    .order('position')
    .limit(500);
  if (error || !data || data.length === 0) {
    if (error) console.error('Fetch product recommendations error:', error);
    return new Map();
  }

  const recommendedByProduct = new Map<string, string[]>();
  for (const r of data as any[]) {
    const list = recommendedByProduct.get(r.product_id) || [];
    list.push(r.recommended_product_id);
    recommendedByProduct.set(r.product_id, list);
  }
  return recommendedByProduct;
}

export const fetchMenu = async (storeId: string, onlyAvailable = true, includeUnavailable = false): Promise<{ categories: Category[]; products: Product[]; error?: 'network' }> => {
  try {
    const categoriesQuery = supabase.from('categories').select('*').eq('store_id', storeId).order('order');
    let productsQuery = supabase.from('products').select('*').eq('store_id', storeId).order('order', { ascending: true, nullsFirst: false });
    if (onlyAvailable) productsQuery = productsQuery.eq('available', true);

    // Query de adicionais e de recomendações paralelizadas com
    // categorias/produtos (não dependem do resultado delas, só do storeId)
    // — antes rodava sequencialmente depois do Promise.all abaixo.
    const [cats, prods, groupsByProduct, recommendedByProduct] = await Promise.all([
      categoriesQuery,
      productsQuery,
      fetchOptionGroupsByProduct(storeId, includeUnavailable),
      fetchProductRecommendationsByStore(storeId),
    ]);

    // Resolve os ids de recomendação contra a própria lista de produtos já
    // carregada — produto recomendado que não existe mais na lista (ex.:
    // ficou indisponível, foi excluído) é filtrado silenciosamente, não
    // quebra o cardápio.
    // Achado real (varredura 2026-07-07): a versao anterior montava `byId` a
    // partir do array `products` ORIGINAL (sem recommended_products ainda),
    // entao "Peca tambem" em cadeia quebrava — se A recomenda B, o objeto de
    // B dentro de A.recommended_products nunca tinha recommended_products
    // preenchido (undefined), entao o modal de B nunca mostrava a propria
    // secao. Corrigido criando os objetos finais primeiro e populando
    // recommended_products por cima dos MESMOS objetos (referencia
    // compartilhada) — funciona ate com ciclo A->B->A, porque cada produto
    // referenciado dentro de outro e' o mesmo objeto vivo, nao uma copia.
    const resolveRecommended = (products: Product[]): Product[] => {
      const resolved = products.map(p => ({ ...p, recommended_products: [] as Product[] }));
      const byId = new Map(resolved.map(p => [p.id, p]));
      resolved.forEach(p => {
        p.recommended_products = (recommendedByProduct.get(p.id) || []).map(id => byId.get(id)).filter(Boolean) as Product[];
      });
      return resolved;
    };

    if (prods.error && (prods.error.code === '42703' || prods.error.message?.includes('column') || prods.error.message?.includes('does not exist'))) {
      let fallbackQuery = supabase.from('products').select('*').eq('store_id', storeId);
      if (onlyAvailable) fallbackQuery = fallbackQuery.eq('available', true);
      const fallbackProds = await fallbackQuery;
      if (fallbackProds.error || cats.error) {
        console.error('Error fetching menu (fallback):', fallbackProds.error || cats.error);
        return { categories: cats.data || [], products: fallbackProds.data || [], error: 'network' };
      }
      return { categories: cats.data || [], products: resolveRecommended(mergeOptionGroups(fallbackProds.data || [], groupsByProduct)) };
    }

    if (cats.error || prods.error) {
      console.error('Error fetching menu:', cats.error || prods.error);
      return { categories: cats.data || [], products: prods.data || [], error: 'network' };
    }

    return { categories: cats.data || [], products: resolveRecommended(mergeOptionGroups(prods.data || [], groupsByProduct)) };
  } catch (error) {
    console.error('Error fetching menu:', error);
    return { categories: [], products: [], error: 'network' };
  }
};

export const createCategory = async (storeId: string, name: string) => {
  const { data: maxOrderData } = await supabase.from('categories').select('order').eq('store_id', storeId).order('order', { ascending: false }).limit(1);
  const nextOrder = (maxOrderData?.[0]?.order || 0) + 1;
  const { error } = await supabase.from('categories').insert({ store_id: storeId, name, order: nextOrder });
  if (error) throw error;
};

export const deleteCategory = async (id: string) => {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
};

// Achado critico de seguranca (2026-07-07): insert direto em `products`
// dependia so' de RLS `allow_all_anon`, que tambem liberava UPDATE/DELETE
// pra qualquer um com a anon key publica (confirmado explorando ao vivo).
// Migration 021 criou create_product_secure/update_product_secure/
// delete_product_secure (security definer) — migration 022 revoga o
// insert/update/delete direto de anon na tabela. Ver
// docs/plans/2026-07-07-fecha-rls-orders-products-plan.md.
export const createProduct = async (storeId: string, categoryId: string, product: Partial<Product>): Promise<string> => {
  const { data, error } = await supabase.rpc('create_product_secure', {
    p_store_id: storeId,
    p_category_id: categoryId,
    p_name: product.name,
    p_description: product.description,
    p_price: product.price,
    p_image_url: product.image_url,
    p_prep_time_minutes: product.prep_time_minutes || 15,
    p_destination: product.destination || 'kitchen',
    p_promo_price: product.promo_price ?? null,
    p_featured: product.featured ?? false,
    p_tags: product.tags ?? [],
    p_ncm: product.ncm ?? null,
  });
  if (error) throw error;
  return data as string;
};

export interface ProductOptionGroupInput {
  name: string;
  type: 'single' | 'multiple';
  required: boolean;
  min_select?: number | null;
  max_select?: number | null;
  options: { name: string; price_delta: number; available?: boolean; omie_codigo?: string | null }[];
}

// Sync atomico via function Postgres security definer (migration 017) — antes
// era apaga + loop de inserts separados em varias chamadas REST distintas,
// sem transacao (uma falha no meio perdia grupos silenciosamente). Agora e'
// uma unica chamada RPC; o apaga-e-recria continua acontecendo (dentro da
// function, numa unica transacao) e continua seguro pelo mesmo motivo de
// antes: order_items.selected_options e' snapshot historico (nao FK viva),
// entao recriar com ids novos nao afeta pedido ja feito.
export const syncProductOptionGroups = async (productId: string, groups: ProductOptionGroupInput[]) => {
  const { error } = await supabase.rpc('sync_product_option_groups', {
    p_product_id: productId,
    p_groups: groups.map(g => ({
      name: g.name,
      type: g.type,
      required: g.required,
      min_select: g.min_select ?? null,
      max_select: g.max_select ?? null,
      options: g.options.map(o => ({ name: o.name, price_delta: o.price_delta, available: o.available ?? true, omie_codigo: o.omie_codigo ?? null })),
    })),
  });
  if (error) throw error;
};

// Consolidar produtos soltos já cadastrados num produto-pai com variações
// (2026-08-16, pedido explícito do usuário — "organizar o cardápio",
// retomado depois da correção do bug de grid). Reaproveita
// syncProductOptionGroups (acima) — a única coisa nova é calcular o
// price_delta de cada variação em cima do produto mais barato (obrigatório:
// price_delta nunca pode ser negativo, CHECK do banco) e preservar o
// omie_codigo de cada produto original na opção correspondente. Depois de
// criar o grupo no produto-base, os outros produtos ficam escondidos do
// cardápio (available=false) — nunca apagados, preserva histórico de venda.
export const consolidateProductsIntoVariants = async (
  storeId: string,
  baseProductId: string,
  allSelectedProducts: { id: string; name: string; price: number; omie_codigo?: string | null }[],
  groupName: string
): Promise<{ success: boolean; message?: string }> => {
  try {
    const base = allSelectedProducts.find(p => p.id === baseProductId);
    if (!base) throw new Error('Produto base não encontrado na seleção.');

    const options = allSelectedProducts.map(p => ({
      name: p.name,
      price_delta: Math.max(0, p.price - base.price),
      available: true,
      omie_codigo: p.omie_codigo ?? null,
    }));

    await syncProductOptionGroups(baseProductId, [
      { name: groupName, type: 'single', required: true, options },
    ]);

    const others = allSelectedProducts.filter(p => p.id !== baseProductId);
    for (const p of others) {
      await updateProduct(p.id, storeId, { available: false });
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

// Cadastro de produto unificado, Direção 1 (2026-08-16, pedido explícito do
// usuário) — cria o produto correspondente no NTB Estoque (via Omie) e já
// salva o omie_codigo aqui, tudo num clique só ("Criar no NTB Estoque
// também" no formulário de "Novo Produto"). Reaproveita a mesma
// chave/URL já configurada em store_ntb_estoque_secrets pra Ordem de
// Produção — ver app/api/integracao/criar-produto-estoque/route.ts.
export const criarProdutoNoEstoque = async (
  storeId: string,
  productId: string,
  nome: string,
  preco: number,
  ncm?: string | null
): Promise<{ success: boolean; message?: string }> => {
  try {
    const res = await fetch('/api/integracao/criar-produto-estoque', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, productId, nome, preco, ncm }),
    });
    return await res.json();
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

// Vende mais II (migration 020) — "peca tambem": sync atomico via function
// Postgres security definer, mesmo padrao de syncProductOptionGroups acima
// (apaga+recria numa transação só, valida loja/limite/auto-recomendação
// dentro da própria function). Erro propaga (throw) pro caller (form do
// lojista) poder mostrar toast — diferente de fetchBestsellerProductIds
// abaixo, que é só leitura decorativa.
export const updateProductRecommendations = async (productId: string, storeId: string, recommendedIds: string[]): Promise<void> => {
  const { error } = await supabase.rpc('sync_product_recommendations', {
    p_product_id: productId,
    p_store_id: storeId,
    p_recommended_ids: recommendedIds,
  });
  if (error) throw error;
};

// Vende mais II (migration 020) — "mais vendido": RPC security definer que
// nunca expõe quantidade/receita bruta pro cliente anônimo, só a lista
// ordenada de product_id (ver get_bestseller_product_ids na migration).
// Enfeite visual do cardápio, não algo crítico — erro loga e devolve [],
// não deve quebrar o carregamento do cardápio.
export const fetchBestsellerProductIds = async (storeId: string, days = 30, limit = 5): Promise<string[]> => {
  const { data, error } = await supabase.rpc('get_bestseller_product_ids', {
    p_store_id: storeId,
    p_days: days,
    p_limit: limit,
  });
  if (error) { console.error('Fetch bestseller product ids error:', error); return []; }
  return (data as string[]) || [];
};

// Achado critico de seguranca (2026-07-07): ver comentario de createProduct
// acima. storeId virou obrigatorio aqui (nao era antes) pra RPC validar que
// o produto pertence a loja — precisou atualizar os 3 call sites em
// StoreModule.tsx.
export const updateProduct = async (id: string, storeId: string, updates: Partial<Product>) => {
  // promo_price: `null` explicito no objeto significa "o lojista limpou o
  // campo", diferente de "a chave nem veio" (nao mexer). update_product_secure
  // usa coalesce (null = nao mexer) pra todo o resto, entao precisa desse
  // flag separado especificamente pra permitir zerar a promocao.
  const clearingPromoPrice = 'promo_price' in updates && updates.promo_price == null;
  const { error } = await supabase.rpc('update_product_secure', {
    p_product_id: id,
    p_store_id: storeId,
    p_name: updates.name,
    p_description: updates.description,
    p_price: updates.price,
    p_category_id: updates.category_id,
    p_image_url: updates.image_url,
    p_prep_time_minutes: updates.prep_time_minutes,
    p_destination: updates.destination,
    p_available: updates.available,
    p_promo_price: clearingPromoPrice ? null : updates.promo_price,
    p_clear_promo_price: clearingPromoPrice,
    p_featured: updates.featured,
    p_tags: updates.tags,
    p_ncm: updates.ncm,
  });
  if (error) throw error;
};

export const updateCategoryOrder = async (updates: { id: string; order: number }[]) => {
  const { error } = await supabase.rpc('update_categories_order', { p_updates: updates });
  if (error) throw error;
};

// Cardapio por horario/turno (migration 018). NULL nos 3 campos = categoria
// sempre disponivel. Enforcement e' so client-side (ver AGENTS.md) — usar
// lib/schedule.ts (isCategoryAvailableNow) pra filtrar/exibir.
export const updateCategorySchedule = async (
  categoryId: string,
  updates: { available_from: string | null; available_until: string | null; available_days: number[] | null }
) => {
  const { error } = await supabase.from('categories').update(updates).eq('id', categoryId);
  if (error) throw error;
};

export const updateProductOrder = async (updates: { id: string; order: number }[]) => {
  const { error } = await supabase.rpc('update_products_order', { p_updates: updates });
  if (error) {
    if (error.code === '42703' || error.message?.includes('column') || error.message?.includes('does not exist')) {
      throw new Error('schema cache');
    }
    throw error;
  }
};

export const deleteProduct = async (id: string, storeId: string) => {
  const { error } = await supabase.rpc('delete_product_secure', { p_product_id: id, p_store_id: storeId });
  if (error) throw error;
};

export const fetchTables = async (storeId: string): Promise<Table[]> => {
  const { data, error } = await supabase.rpc('get_tables_secure', { p_store_id: storeId });
  if (error) { console.error(error); return []; }
  return (data as any) || [];
};

// Igual a fetchTables, mas sem a coluna `pin` — usada pelo cardápio do cliente
// (ClientModule), que não deve receber o PIN de mesas que não são as dele.
export const fetchTablesPublic = async (storeId: string): Promise<Table[]> => {
  const { data, error } = await supabase.rpc('get_tables_public_secure', { p_store_id: storeId });
  if (error) { console.error(error); return []; }
  return (data as any) || [];
};

// Abre/entra numa mesa validando o PIN no servidor via Postgres function
// (security definer) — ver supabase/migrations/003_secure_table_pin.sql.
export const openTableSession = async (
  tableId: string,
  hostName: string,
  pin?: string
): Promise<{ success: boolean; message?: string; isHost?: boolean; table?: Table }> => {
  const { data, error } = await supabase.rpc('open_table_session', {
    p_table_id: tableId,
    p_host_name: hostName,
    p_pin: pin || null,
  });
  if (error) return { success: false, message: error.message };
  return { success: data.success, message: data.message, isHost: data.is_host, table: data.table };
};

// Achado critico de seguranca (2026-07-07): as 5 funcoes de leitura abaixo
// (fetchActiveOrdersForTables ... fetchSalesHistory) liam direto de
// orders/order_items via RLS `allow_all_anon`, que tambem liberava SELECT
// sem filtro nenhum pra qualquer um com a anon key publica — confirmado
// testando ao vivo (deu pra ler nome de cliente e forma de pagamento de
// qualquer loja da plataforma numa unica chamada). Migration 021 criou RPCs
// `security definer` que devolvem o mesmo formato jsonb que o `.select()`
// aninhado ja devolvia (pra nao precisar mudar quem consome o retorno);
// migration 022 revoga o select direto. Ver
// docs/plans/2026-07-07-fecha-rls-orders-products-plan.md.
export const fetchActiveOrdersForTables = async (storeId: string): Promise<Order[]> => {
  const { data, error } = await supabase.rpc('fetch_active_table_orders_secure', { p_store_id: storeId });
  if (error) { console.error('Fetch Active Table Orders Error', error); return []; }

  const orders = (data as any) || [];
  orders.forEach((order: any) => {
    if (order.order_items) order.order_items = order.order_items.filter((item: any) => item.product);
  });
  return orders;
};

export const fetchTableOrderSummary = async (tableId: string): Promise<{ total: number; items: any[]; error?: boolean }> => {
  const { data, error } = await supabase.rpc('fetch_table_order_summary_secure', { p_table_id: tableId });
  // `error: true` só aparece quando a chamada em si falhou (rede/RPC) --
  // distinto de "mesa sem nenhum pedido", que também bate no `!data` de
  // um jeito legítimo (RPC sem erro, só não achou nada pra somar) e por
  // isso não marca `error`. Campo opcional: os dois chamadores existentes
  // (BillSplitter, `lib/api-mock.ts`) seguem ignorando-o sem quebrar --
  // só o restore de sessão da mesa (ClientModule, Task 4) precisa
  // distinguir "sem pedido" de "não deu pra saber".
  if (error) return { total: 0, items: [], error: true };
  if (!data) return { total: 0, items: [] };
  return { total: Number((data as any).total) || 0, items: (data as any).items || [] };
};

// Fix round 2 (Group B1): `onError` é opcional e aditivo — todo call site
// existente (KdsView etc.) continua recebendo `[]` em silêncio, exatamente
// como sempre foi. Só a reconciliação de impressão do Caixa (ver
// components/modules/CaixaPrintStation.tsx, sucessora da antiga Estação de
// Impressão dedicada — removida no redesign de 2026-08-23) passa este
// callback: é o único consumidor que precisa DISTINGUIR "0 pedidos
// pendentes" de "a chamada falhou" — sem isso, uma RPC persistentemente
// falhando fica indistinguível de uma cozinha em dia (o indicador continuava
// mostrando "conectado", que reflete só o websocket do Realtime, um
// subsistema separado do REST/RPC que este fetch usa).
export const fetchKitchenOrders = async (
  storeId: string,
  destination: 'kitchen' | 'bar' = 'kitchen',
  onError?: (error: unknown) => void,
): Promise<OrderItem[]> => {
  const { data, error } = await supabase.rpc('fetch_kitchen_orders_secure', { p_store_id: storeId, p_destination: destination });
  if (error) { console.error('Kitchen fetch error:', error); onError?.(error); return []; }
  return (data as any) || [];
};

// Originalmente Task 3 (2026-08-22, Estação de Impressão dedicada) — mesmo
// canal/tabela de ping já usado por KdsView/CounterView/TablesView
// (order_change_pings, filtrado por store_id via migration 029 — ver
// comentário lá pro porquê de existir uma tabela de ping sem dado sensível
// em vez de assinar orders/order_items direto: RLS bloqueia SELECT nessas
// duas desde 022, e o Realtime só entrega postgres_changes pra quem teria
// visibilidade via RLS). Extraído pra cá (em vez de repetir
// supabase.channel(...) inline mais uma vez) porque quem consome isto
// também precisa reportar o STATUS da conexão pra tela ("conectada ou não"
// tem que ficar óbvio) — os consumidores mais antigos (KdsView/CounterView/
// TablesView) não precisavam disso, só chamavam .subscribe() sem callback.
// Redesign 2026-08-23: a Estação dedicada (aparelho fixo, rota `/estacao`)
// foi removida — hoje quem usa `onStatusChange` é a reconciliação de
// impressão do Caixa (`components/modules/CaixaPrintStation.tsx`), rodando
// em segundo plano dentro da sessão normal do caixa.
//
// IMPORTANTE: order_change_pings não tem destino (cozinha/bar/caixa) — o
// filtro por destino é feito depois, no client, ao decidir o que imprimir
// (fetchKitchenOrders(storeId, 'kitchen'|'bar') já filtra isso). Esta
// assinatura é só "algo mudou nesta loja, hora X" — o mesmo ping que já
// aciona loadOrders(true) no KdsView aciona a reconciliação do Caixa.
//
// `onStatusChange` reflete o status bruto do canal Supabase Realtime
// ('SUBSCRIBED'|'CLOSED'|'CHANNEL_ERROR'|'TIMED_OUT'|...), simplificado em 3
// estados: 'connecting' (estado inicial/reconectando), 'connected'
// (SUBSCRIBED), 'disconnected' (qualquer falha). A reconciliação do Caixa
// NÃO confia só nisso pra decidir se perdeu pedido — reconcilia contra o
// servidor (fetchKitchenOrders) em intervalo fixo e em todo reconnect/foco
// de aba, independente do que este status disser (ver
// CaixaPrintStation.tsx). O status aqui é só pra exibir "conectado"/"sem
// conexão" no indicador, não é a garantia de entrega.
export type StoreOrdersConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export const subscribeToStoreOrderChanges = (
  storeId: string,
  onChange: () => void,
  onStatusChange?: (status: StoreOrdersConnectionStatus) => void,
): (() => void) => {
  const channel = supabase
    .channel(`caixa_print_${storeId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'order_change_pings', filter: `store_id=eq.${storeId}` }, onChange)
    .subscribe((status) => {
      if (!onStatusChange) return;
      if (status === 'SUBSCRIBED') onStatusChange('connected');
      else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatusChange('disconnected');
      else onStatusChange('connecting');
    });
  return () => { supabase.removeChannel(channel); };
};

export const fetchCounterOrders = async (storeId: string): Promise<Order[]> => {
  const { data, error } = await supabase.rpc('fetch_counter_orders_secure', { p_store_id: storeId });
  if (error) { console.error('Fetch Counter Orders Error', error); return []; }
  return (data as any) || [];
};

// Fix round 2 (Group B1): mesmo princípio do `onError` opcional em
// fetchKitchenOrders acima — a Estação de Impressão (destino 'caixa') é o
// único consumidor que precisa saber se a RPC falhou, não só receber `[]`.
export const fetchSalesHistory = async (
  storeId: string,
  startDate?: string,
  endDate?: string,
  onError?: (error: unknown) => void,
): Promise<Order[]> => {
  const { data, error } = await supabase.rpc('fetch_sales_history_secure', {
    p_store_id: storeId,
    p_start_date: startDate || null,
    p_end_date: endDate || null,
  });
  if (error) { console.error('Fetch Sales History Error', error); onError?.(error); return []; }
  return (data as any) || [];
};

export const fetchTableSessions = async (storeId: string, sinceDate?: string): Promise<TableSession[]> => {
  const { data, error } = await supabase.rpc('fetch_table_sessions_secure', {
    p_store_id: storeId,
    p_since_date: sinceDate || null,
  });
  if (error) { console.error('Fetch Table Sessions Error', error); return []; }
  return (data as any) || [];
};

// Achado critico de seguranca (2026-07-07): delete direto em `orders` pela
// mesma RLS aberta que permitia SELECT/INSERT sem filtro (ver comentario
// grande acima de fetchActiveOrdersForTables). order_items.order_id
// continua "on delete cascade", so' que agora dentro da RPC.
export const clearSalesHistory = async (storeId: string) => {
  const { error } = await supabase.rpc('clear_sales_history_secure', { p_store_id: storeId });
  if (error) throw error;
};

export const updateOrderStatus = async (orderId: string, status: OrderStatus) => {
  const { error } = await supabase.rpc('update_order_status_secure', { p_order_id: orderId, p_status: status });
  if (error) throw error;
};

export const sendOrderToKitchen = async (orderId: string) => {
  const { error } = await supabase.rpc('send_order_to_kitchen_secure', { p_order_id: orderId });
  if (error) throw error;
};

// Task 5 (2026-08-22, plano perfis-de-loja-e-caixa — fecha o gap do
// Balcão): `paymentData` é novo e opcional — aditivo, todo call site
// existente que só passava `destinatario` continua funcionando idêntico
// (ver StoreModule.tsx `closeOrderNow`, que sempre manda `undefined`
// explícito na posição de `paymentData` quando a loja não tem o módulo
// Caixa ligado; a guarda `if (paymentData)` abaixo então nunca dispara pras
// 7 lojas reais de hoje).
//
// Por que isto não é uma RPC nova (restrição explícita do plano — "no
// migration, no column, no RPC"): `close_counter_order_secure` só grava
// status; `close_table_orders_secure` grava payment_method/payment_details
// mas filtra `where table_id = p_table_id`, e pedido de balcão nasce com
// `table_id = null` (`create_order_secure`, `p_table_id: null` quando
// `isCounter`) — `table_id = null` nunca bate em `p_table_id = null` no
// SQL (NULL = NULL não é true), então não dá pra reaproveitar essa RPC
// passando null. `orders` não tem SELECT/UPDATE público pra `anon` desde a
// correção de segurança de 021/022 (ver AGENTS.md), e não existe nenhuma
// outra RPC que escreva payment_method/payment_details por `order_id`. A
// saída, sem tocar em schema/RPC, é o mesmo padrão já usado pra
// certificado fiscal e Ordem de Produção: uma rota de servidor com a
// service role key (`app/api/orders/pagamento-balcao`, ver lá o porquê
// completo) escrevendo direto na tabela, ignorando RLS.
//
// Ordem importa: o pagamento é gravado ANTES do RPC que marca
// 'delivered'. Se a gravação do pagamento falhar, o pedido continua aberto
// (não vira "fechado sem registrar nada") — o operador tenta de novo. Se a
// gravação funcionar mas o RPC de status falhar depois, o pedido fica com
// pagamento já registrado mas ainda não 'delivered' — reabrir "Entregar"
// de novo reenvia o mesmo paymentData (idempotente, sem risco de cobrança
// duplicada) e tenta fechar de novo.
export const closeCounterOrder = async (
  orderId: string,
  // Task 4 (2026-08-23, resolução backlog pendente): `emitir_nota` é novo e
  // opcional — mesmo padrão aditivo do resto deste objeto. Vai direto pra
  // dentro de `payment_details` (nenhuma coluna nova, ver AGENTS.md), lido
  // por app/api/fiscal/emitir/route.ts ANTES de qualquer trabalho real de
  // emissão. Ausente (todo call site de hoje, toda loja sem o toggle
  // renderizado) = comportamento idêntico ao de sempre, emite normal.
  // Task 2 (2026-08-23, plano frente-de-caixa): `cash_shift_id` idem —
  // opcional, só presente quando a loja tem o módulo caixa ligado (ver
  // StoreModule.tsx, handleFinishCounterPayment). Usado por
  // _cash_shift_expected_cash/fetch_cash_shift_summary_secure (migration
  // 051) pra somar o dinheiro entrado num turno.
  paymentData?: { total: number; methods: { method: string; amount: number; brand?: string | null }[]; emitir_nota?: boolean; cash_shift_id?: string },
  destinatario?: { cpfCnpj: string; nome: string },
) => {
  if (paymentData) {
    const paymentMethod = paymentData.methods.length === 1 ? paymentData.methods[0].method : 'MULTIPLE';
    const res = await fetch('/api/orders/pagamento-balcao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, paymentMethod, paymentDetails: paymentData }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message || 'Falha ao registrar o pagamento do pedido de balcão.');
    }
  }
  const { error } = await supabase.rpc('close_counter_order_secure', { p_order_id: orderId });
  if (error) throw error;
  triggerOrdemProducao({ orderId });
  triggerEmissaoFiscal({ orderId, destinatario });
};

// Integração ntb-vendas -> ntb-estoque (2026-07-07, ver AGENTS.md): dispara a
// rota interna (service role, nunca vê chave nem RLS do lado do browser) que
// cria+conclui a Ordem de Produção correspondente no ntb-estoque. Só lojas
// com store_ntb_estoque_secrets configurado participam — as demais recebem
// { skipped: true } e não acontece nada. Fire-and-forget de propósito: um
// erro aqui nunca pode impedir o fechamento do pedido, que já aconteceu.
const triggerOrdemProducao = (body: { orderId?: string; tableId?: string }) => {
  fetch('/api/integracao/ordem-producao', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch((e) => console.error('Integração ntb-estoque (Ordem de Produção) falhou:', e));
};

// Emissão fiscal automática (2026-08-05) — mesmo padrão fire-and-forget de
// triggerOrdemProducao acima: nunca pode impedir o fechamento do pedido, que
// já aconteceu. Loja sem modelo_emissao_automatica configurado recebe
// { skipped: true } e nada acontece. `destinatario` (Task 17) só é relevante
// pra loja em modelo NF-e — a rota ignora o campo pra NFC-e/nenhuma, então é
// seguro sempre repassar o que a UI capturou (ou undefined), sem checar o
// modelo aqui de novo.
const triggerEmissaoFiscal = (body: { orderId?: string; tableId?: string; destinatario?: { cpfCnpj: string; nome: string } }) => {
  fetch('/api/fiscal/emitir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch((e) => console.error('Emissão fiscal automática falhou:', e));
};

export const callWaiter = async (tableId: string) => {
  const { error } = await supabase.rpc('request_waiter_secure', { p_table_id: tableId });
  if (error) { console.error('Erro ao chamar garçom:', error); throw error; }
};

export const dismissWaiterRequest = async (tableId: string) => {
  const { error } = await supabase.rpc('cancel_waiter_request_secure', { p_table_id: tableId });
  if (error) throw error;
};

export const toggleTableServiceFee = async (tableId: string, removed: boolean) => {
  const { error } = await supabase.rpc('toggle_service_fee_secure', { p_table_id: tableId, p_removed: removed });
  if (error) throw error;
};

// Pedido criado via function Postgres security definer create_order_secure
// (supabase/migrations/007_seguranca_pedidos.sql): o client manda só
// product_id/quantity/notes, NUNCA preço — a function busca o preço real em
// products e monta orders+order_items server-side. Substitui o insert direto
// que mandava price_at_time vindo do client (achado de segurança: preço
// adulterável via console do navegador). Nota: a function sempre cria um
// pedido novo (não reaproveita mais um pedido 'pending' já aberto na mesma
// mesa, como o insert direto fazia) — sem efeito perceptível porque toda
// leitura de pedidos de mesa (fetchActiveOrdersForTables,
// fetchTableOrderSummary) já soma por table_id através de múltiplos pedidos.
export const createOrder = async (
  tableId: string | null,
  storeId: string,
  items: CartItem[],
  customerName?: string,
  addedByRole: 'cliente' | 'garcom' = 'cliente',
  addedByName?: string,
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
      p_added_by_name: addedByName || null,
    });

    if (error) throw error;
    if (!data?.success) throw new Error(data?.message || 'Erro ao criar pedido.');

    return { success: true, orderId: data.order_id };
  } catch (error) {
    console.error('Create Order Error', error);
    throw error;
  }
};

export const fetchOrderById = async (orderId: string): Promise<Order | null> => {
  const { data, error } = await supabase.rpc('fetch_order_by_id_secure', { p_order_id: orderId });
  if (error || !data) return null;
  return data as Order;
};

// OrderTracker (ClientModule) buscava order_items direto via .from() — desde
// a correcao de seguranca de 021/022 isso voltava sempre vazio (RLS bloqueia
// select anon). Migration 029 adicionou esta RPC segura equivalente.
export const fetchOrderItemsById = async (orderId: string): Promise<OrderItem[]> => {
  const { data, error } = await supabase.rpc('fetch_order_items_secure', { p_order_id: orderId });
  if (error || !data) return [];
  return data as OrderItem[];
};

export const updateOrderItemStatus = async (itemId: string, status: OrderStatus): Promise<{ success: boolean; message?: string }> => {
  const { error } = await supabase.rpc('update_order_item_status_secure', { p_item_id: itemId, p_status: status });
  if (error) {
    console.error('Update Order Item Status Error:', error);
    return { success: false, message: error.message };
  }
  return { success: true };
};

export const cancelSpecificOrderItem = async (itemId: string) => {
  await supabase.rpc('cancel_order_item_secure', { p_item_id: itemId });
};

// Abertura manual pelo lojista (ex.: balcão abrindo mesa direto) — sem PIN,
// mas ainda grava a sessão para entrar na métrica de tempo médio de ocupação.
export const openTableManually = async (tableId: string, storeId: string, hostName: string) => {
  const { error } = await supabase.rpc('open_table_manually_secure', { p_table_id: tableId, p_store_id: storeId, p_host_name: hostName });
  if (error) throw error;
};

export const requestTableBill = async (tableId: string) => {
  const { error } = await supabase.rpc('request_table_bill_secure', { p_table_id: tableId });
  if (error) throw error;
};

export const cancelPendingTableItems = async (tableId: string) => {
  await supabase.rpc('cancel_pending_table_items_secure', { p_table_id: tableId });
};

export const closeTableSession = async (
  tableId: string,
  // Fix round 2 (Group A3): `brand` faltava neste tipo declarado — o
  // valor sempre chegou até o banco porque o argumento real passado por
  // StoreModule.tsx (paymentMethods, ver seu próprio useState) já tem
  // `brand?: string`, e TypeScript não aplica excess-property checking
  // quando o valor vem de uma variável (só em objeto literal inline).
  // Sem declarar aqui, um refactor futuro que trocasse o call site por
  // um literal (ex.: `{ total, methods: [{method, amount}] }`) perderia
  // a bandeira do cartão silenciosamente, sem nenhum erro de tipo.
  // Task 4: idem closeCounterOrder acima — `emitir_nota` é novo e opcional.
  // Task 2 (frente-de-caixa): idem `cash_shift_id`, ver closeCounterOrder.
  paymentData?: { total: number; methods: { method: string; amount: number; brand?: string | null }[]; emitir_nota?: boolean; cash_shift_id?: string },
  destinatario?: { cpfCnpj: string; nome: string },
): Promise<{ success: boolean; message?: string }> => {
  try {
    const paymentMethod = paymentData
      ? (paymentData.methods.length === 1 ? paymentData.methods[0].method : 'MULTIPLE')
      : null;

    const { error: closeErr } = await supabase.rpc('close_table_orders_secure', {
      p_table_id: tableId,
      p_payment_method: paymentMethod,
      p_payment_details: paymentData || null,
    });
    if (closeErr) return { success: false, message: 'Falha ao fechar pedidos da mesa: ' + closeErr.message };

    const { error: finalizeErr } = await supabase.rpc('finalize_table_secure', { p_table_id: tableId });
    if (finalizeErr) return { success: false, message: finalizeErr.message };

    triggerOrdemProducao({ tableId });
    triggerEmissaoFiscal({ tableId, destinatario });

    return { success: true };
  } catch (e: any) {
    return { success: false, message: e.message || 'Erro desconhecido.' };
  }
};

// Frente de Caixa (Task 2, plano 2026-08-23-frente-de-caixa; RPC criada na
// Task 1, migration 051). Regra do banco é "um turno aberto por vez, por
// loja" (índice parcial único em cash_shifts) — por isso a RPC só pede
// store_id, não operador: só pode existir um turno pra achar. Devolve
// `null` quando não há nenhum turno aberto (estado normal enquanto ninguém
// abriu o caixa ainda). Usado por handleFinishPayment (mesa) e
// handleFinishCounterPayment (balcão) em StoreModule.tsx pra bloquear
// pagamento sem caixa aberto quando `resolveStoreModules(store).caixa`.
export interface CashShift {
  id: string;
  store_id: string;
  operator_user_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  closing_counted_cash: number | null;
  status: 'open' | 'closed';
  notes: string | null;
}

export const fetchOpenCashShift = async (storeId: string): Promise<CashShift | null> => {
  const { data, error } = await supabase.rpc('fetch_open_cash_shift_secure', { p_store_id: storeId });
  if (error || !data) return null;
  return data as CashShift;
};

// Task 3 (frente-de-caixa): abre um turno novo — chamado pela aba "Caixa"
// (StoreModule.tsx, CaixaView) quando `fetchOpenCashShift` devolve `null`.
// `open_cash_shift_secure` (migration 051) já recusa com
// `{success:false}` (não exception) se já existe turno aberto pra loja —
// tanto no caminho feliz quanto sob concorrência real (unique_violation do
// índice parcial), então este wrapper não precisa de try/catch pra esse
// caso, só pra falha de rede/RPC em si.
// operatorUserId é null pra conta universal (Critical #2 da revisão final,
// ver supabase/migrations/052_frente_de_caixa_criticos.sql): universal_users
// não tem linha em store_users, a FK de cash_shifts.operator_user_id
// estourava (23503) sempre que ela tentava abrir turno — agora a coluna
// aceita null e a function trata foreign_key_violation com mensagem legível
// em vez de deixar o erro cru do Postgres subir. `notes` é usado nesse caso
// pra guardar uma identificação legível do operador universal (a tabela já
// existia, sem uso até então).
export const openCashShift = async (
  storeId: string,
  operatorUserId: string | null,
  openingFloat: number,
  notes?: string,
): Promise<{ success: boolean; id?: string; message?: string }> => {
  const { data, error } = await supabase.rpc('open_cash_shift_secure', {
    p_store_id: storeId,
    p_operator_user_id: operatorUserId,
    p_opening_float: openingFloat,
    p_notes: notes ?? null,
  });
  if (error) return { success: false, message: error.message };
  return data as { success: boolean; id?: string; message?: string };
};

// Task 4 (frente-de-caixa): sangria/suprimento — `register_cash_movement_secure`
// (migration 051) já revalida type/amount/turno aberto no servidor; este
// wrapper só repassa e normaliza o formato de retorno.
export const registerCashMovement = async (
  shiftId: string,
  type: 'sangria' | 'suprimento',
  amount: number,
  reason: string,
): Promise<{ success: boolean; id?: string; message?: string }> => {
  const { data, error } = await supabase.rpc('register_cash_movement_secure', {
    p_shift_id: shiftId,
    p_type: type,
    p_amount: amount,
    p_reason: reason,
  });
  if (error) return { success: false, message: error.message };
  return data as { success: boolean; id?: string; message?: string };
};

// Task 4: resumo do turno pra tela de fechamento — total por forma de
// pagamento, sangria/suprimento, esperado em dinheiro (fundo de troco +
// vendas em dinheiro + suprimento - sangria) e, se já fechado,
// contado/diferença persistidos. Ver `fetch_cash_shift_summary_secure`
// (migration 051) pro formato exato.
export interface CashShiftSummary {
  shift: CashShift;
  totals_by_method: Record<string, number>;
  total_sangria: number;
  total_suprimento: number;
  expected_cash: number;
  closing_counted_cash: number | null;
  difference: number | null;
}

export const fetchCashShiftSummary = async (shiftId: string): Promise<CashShiftSummary | null> => {
  const { data, error } = await supabase.rpc('fetch_cash_shift_summary_secure', { p_shift_id: shiftId });
  if (error || !data) return null;
  return data as CashShiftSummary;
};

// Subprojeto 2 (2026-08-25) — histórico de turnos passados, consultável a
// qualquer momento (não só na hora de fechar). Linha "resumida"; pra ver o
// detalhe completo (total por forma de pagamento, sangria/suprimento) de um
// turno específico, chama `fetchCashShiftSummary(row.id)` de novo — mesma
// function já usada pela tela de fechamento, reaproveitada.
export interface CashShiftHistoryRow {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  closing_counted_cash: number | null;
  status: 'open' | 'closed';
  notes: string | null;
  operator_name: string | null;
  difference: number | null;
}

export const fetchCashShiftsHistory = async (storeId: string, limit = 30): Promise<CashShiftHistoryRow[]> => {
  const { data, error } = await supabase.rpc('fetch_cash_shifts_history_secure', { p_store_id: storeId, p_limit: limit });
  if (error || !data) return [];
  return data as CashShiftHistoryRow[];
};

// Task 4: fecha o turno de vez — `close_cash_shift_secure` grava
// closing_counted_cash/closed_at/status e já devolve a diferença calculada
// no servidor (mesma fórmula de `fetchCashShiftSummary`, sem round-trip
// extra). Depois de `success:true`, a UI volta ao estado "sem turno aberto".
export const closeCashShift = async (
  shiftId: string,
  closingCountedCash: number,
): Promise<{ success: boolean; expected_cash?: number; closing_counted_cash?: number; difference?: number; message?: string }> => {
  const { data, error } = await supabase.rpc('close_cash_shift_secure', {
    p_shift_id: shiftId,
    p_closing_counted_cash: closingCountedCash,
  });
  if (error) return { success: false, message: error.message };
  return data as { success: boolean; expected_cash?: number; closing_counted_cash?: number; difference?: number; message?: string };
};

export const toggleTableBlock = async (tableId: string, _currentStatus: TableStatus) => {
  const { error } = await supabase.rpc('toggle_table_block_secure', { p_table_id: tableId });
  if (error) throw error;
};

export const moveTable = async (sourceTableId: string, targetTableId: string): Promise<{ success: boolean; message?: string }> => {
  const { data, error } = await supabase.rpc('move_table_secure', {
    p_source_table_id: sourceTableId,
    p_target_table_id: targetTableId,
  });
  if (error) return { success: false, message: error.message };
  return (data as any) || { success: false, message: 'Erro desconhecido.' };
};

const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/dmxucnk9a/image/upload';
const UPLOAD_PRESET = 'menu_img';

const uploadToCloudinary = async (file: File): Promise<string> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', UPLOAD_PRESET);

  const response = await fetch(CLOUDINARY_URL, { method: 'POST', body: formData });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Erro no upload: ${errorData.error?.message || 'Falha desconhecida'}`);
  }
  const data = await response.json();
  return data.secure_url;
};

export const uploadStoreLogo = async (file: File): Promise<string> => uploadToCloudinary(file);
export const uploadStoreCover = async (file: File): Promise<string> => uploadToCloudinary(file);
export const uploadProductImage = async (file: File): Promise<string> => uploadToCloudinary(file);

// Certificado digital fiscal: NÃO usa Cloudinary (é público/sem controle de
// acesso). Vai pro bucket privado `store-certificates`, e o upload/remoção
// passam por /api/certificado (service role key) em vez do client direto —
// ver supabase/migrations/006_fiscal_certificado.sql e
// 011_certificado_via_api.sql pro porquê.

// As 3 funções abaixo chamam a mesma rota /api/certificado (service role
// key) em vez de tocar supabase.storage/tabelas direto com a chave
// anônima. Motivo (ver app/api/certificado/route.ts pro detalhe completo):
// o arquivo em si exige leitura de volta pra fazer upload/limpeza, e a
// senha exige leitura pra fazer update/upsert num row já existente — as
// duas leituras, se liberadas pra `anon`, exporiam o .pfx e a senha em
// texto puro pra qualquer um com a chave pública.
const postCertificado = async (fields: Record<string, string | File>): Promise<{ success: boolean; message?: string }> => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  try {
    const res = await fetch('/api/certificado', { method: 'POST', body: form });
    return await res.json();
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

export const uploadStoreCertificate = async (storeId: string, file: File): Promise<{ success: boolean; message?: string }> =>
  postCertificado({ storeId, file });

export const saveStoreCertificateMetadata = async (storeId: string, originalFilename: string, expiresAt: string | null): Promise<{ success: boolean; message?: string }> =>
  postCertificado({ storeId, originalFilename, expiresAt: expiresAt ?? '' });

export const saveStoreCertificateSecret = async (storeId: string, password: string): Promise<{ success: boolean; message?: string }> =>
  postCertificado({ storeId, password });

export const fetchStoreCertificateStatus = async (storeId: string): Promise<StoreFiscalCertificateStatus | null> => {
  const { data, error } = await supabase
    .from('store_fiscal_certificates')
    .select('original_filename, uploaded_at, expires_at')
    .eq('store_id', storeId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
};

// Configuração do emissor fiscal (ambiente, série/numeração, CSC/CSCID —
// ver supabase/migrations/024_config_emissor_fiscal.sql e "Certificado
// digital fiscal" em AGENTS.md). Todos os campos são opcionais: só os que
// vierem preenchidos aqui são enviados pro FormData, e a rota só sobrescreve
// o que veio (mesmo princípio de uploadStoreCertificate/
// saveStoreCertificateSecret acima).
export interface UpdateStoreFiscalConfigParams {
  ambiente?: 'homologacao' | 'producao';
  modeloEmissaoAutomatica?: 'nenhuma' | 'nfce' | 'nfe';
  nfeSerie?: number;
  nfceSerie?: number;
  cteSerie?: number;
  mdfeSerie?: number;
  nfeUltimoNumero?: number;
  nfceUltimoNumero?: number;
  cteUltimoNumero?: number;
  mdfeUltimoNumero?: number;
  inscricaoMunicipal?: string;
  telefone?: string;
  casasDecimais?: number;
  cnpjAutorizado?: string;
  observacaoNfe?: string;
  observacaoPedido?: string;
  cscHomologacao?: string;
  cscidHomologacao?: string;
  cscProducao?: string;
  cscidProducao?: string;
  razaoSocial?: string;
  nomeFantasia?: string;
  tipoPessoa?: string;
  inscricaoEstadual?: string;
  enderecoLogradouro?: string;
  enderecoNumero?: string;
  enderecoComplemento?: string;
  enderecoBairro?: string;
  enderecoCidade?: string;
  enderecoUf?: string;
  enderecoCep?: string;
  cstCsosnPadrao?: string;
  cstPisPadrao?: string;
  cstCofinsPadrao?: string;
  cstIpiPadrao?: string;
  fretePadrao?: string;
  tipoPagamentoPadrao?: string;
  naturezaOperacaoPadrao?: string;
}

export const updateStoreFiscalConfig = async (storeId: string, config: UpdateStoreFiscalConfigParams): Promise<{ success: boolean; message?: string }> => {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined || value === null) continue;
    fields[key] = String(value);
  }
  return postCertificado({ storeId, ...fields });
};

// Campos não-sigilosos (público, mesmo nível de fetchStoreCertificateStatus
// acima) — lido direto da tabela, não precisa passar pela API route.
// `null` = loja ainda não tem nenhuma configuração salva (estado normal,
// não é erro).
export const fetchStoreFiscalConfig = async (storeId: string): Promise<StoreFiscalConfig | null> => {
  const { data, error } = await supabase
    .from('store_fiscal_config')
    .select('*')
    .eq('store_id', storeId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
};

// Integração ntb-vendas -> ntb-estoque (Ordem de Produção automática, ver
// app/api/integracao/ordem-producao/route.ts e migration 042). Status via
// RPC security definer (write-only, nunca expõe a api_key — só se está
// configurada, ativa, e a URL, que não é segredo); escrita via rota própria
// (service role), mesmo princípio de write-only já usado no certificado.
export interface NtbEstoqueIntegracaoStatus {
  configurado: boolean;
  ativo: boolean;
  url?: string;
}

export const fetchNtbEstoqueIntegracaoStatus = async (storeId: string): Promise<NtbEstoqueIntegracaoStatus> => {
  const { data, error } = await supabase.rpc('fetch_ntb_estoque_integracao_status_secure', { p_store_id: storeId });
  if (error || !data) return { configurado: false, ativo: false };
  return data as NtbEstoqueIntegracaoStatus;
};

export const saveNtbEstoqueIntegracaoConfig = async (
  storeId: string,
  params: { url?: string; apiKey?: string; ativo?: boolean }
): Promise<{ success: boolean; message?: string }> => {
  try {
    const res = await fetch('/api/integracao/configurar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, ...params }),
    });
    return await res.json();
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

// Bootstrap cross-sistema (2026-08-16): cria a loja correspondente no
// ntb-estoque e já grava a integração aqui, tudo num clique só ("Criar no
// NTB Estoque também" na criação de loja) — sem o operador ver/copiar
// chave nenhuma. Ver app/api/integracao/criar-loja-estoque/route.ts.
export const criarLojaNoEstoque = async (
  storeId: string,
  nome: string,
  cnpj?: string
): Promise<{ success: boolean; message?: string }> => {
  try {
    const res = await fetch('/api/integracao/criar-loja-estoque', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, nome, cnpj }),
    });
    return await res.json();
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

// Lista de tentativas de emissão fiscal da loja (aba "Notas Fiscais" do
// admin, Task 16) — via RPC `fetch_fiscal_notas_secure` (security definer,
// scoped por store_id), não mais `.from('fiscal_notas').select('*')` direto.
// Achado crítico da revisão final de branch (2026-08-06): fiscal_notas
// tinha SELECT liberado pra qualquer um com a chave anônima, sem filtro de
// loja nenhum (venda detalhada, chave de acesso, protocolo e paths do
// Storage de QUALQUER loja da plataforma) — mesma classe de vazamento já
// corrigida uma vez em orders/order_items (021/022). Migration 039 fecha o
// SELECT direto; a RPC devolve exatamente as mesmas colunas que o
// `.select('*')` antigo devolvia (mesmo `row_to_json` de uma linha inteira
// de `fiscal_notas`), então `FiscalNotasView` continua funcionando sem
// nenhuma mudança de shape.
export const fetchFiscalNotas = async (storeId: string): Promise<FiscalNota[]> => {
  const { data, error } = await supabase.rpc('fetch_fiscal_notas_secure', { p_store_id: storeId });
  if (error) throw error;
  return (data ?? []) as FiscalNota[];
};

// Signed URL sob demanda pro XML/PDF de uma nota — o bucket
// fiscal-documentos é privado (sem policy de select/insert pra anon, ver
// migration 034), então isso precisa passar pela rota de servidor (service
// role) em vez de bater direto no Storage a partir do client. `noteId`
// (achado de revisão, 2026-08-06): a rota de servidor agora exige o id da
// nota específica, não só o path, pra confirmar que o path bate com ESSA
// linha exata (defesa em profundidade — ver comentário em
// app/api/fiscal/pdf-url/route.ts).
export const fetchFiscalNotaPdfUrl = async (noteId: string, pdfPath: string): Promise<string> => {
  const res = await fetch('/api/fiscal/pdf-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ noteId, pdfPath }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Falha ao gerar URL do PDF.');
  return json.url;
};

// Reemissão manual (botão "Reemitir" na aba Notas Fiscais): mesma rota de
// emissão automática (app/api/fiscal/emitir), mas chamada direto — não
// fire-and-forget como no fechamento de pedido (Task 14) — porque aqui é
// uma ação explícita do lojista que precisa de feedback síncrono na tela.
// Faz sentido pra notas com status 'erro'/'rejeitada'/'pendente' — a
// guarda de idempotência da própria rota bloqueia só 'autorizada' (Task
// 17: 'pendente' saiu do bloqueio, migration 037, senão essa reemissão
// nunca conseguiria de fato tentar de novo) com {skipped:true,
// reason:'Nota já existe para esta venda'} — a UI já filtra o botão pra só
// aparecer nesses três status. `destinatario` (Task 17, 2ª rodada) — o
// motivo mais comum de uma nota cair 'pendente' é falta desse dado, então
// a reemissão precisa poder mandar um novo; opcional pra não quebrar o
// caso 'erro'/'rejeitada' (nota que já tinha destinatário e falhou por
// outro motivo, ex. certificado/SEFAZ fora do ar).
export const reemitirFiscalNota = async (params: {
  orderId?: string;
  tableId?: string;
  destinatario?: { cpfCnpj: string; nome: string };
}): Promise<any> => {
  const res = await fetch('/api/fiscal/emitir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
};

export interface CreateStoreParams {
  name: string;
  cnpj: string;
  slug: string;
  contractType: 'balcao' | 'balcao_mesas';
  tableCount: number;
  periodMonths: number | null;
  isActive: boolean;
  logoUrl?: string | null;
  coverUrl?: string | null;
  serviceFeeRate: number;
  // Perfil de módulos por loja (Task 1, plano 2026-08-22). Sempre o perfil
  // completo escolhido no formulário (AdminModule.tsx) — createStore/
  // updateStore são quem decide se isso vira `config.modules`/
  // `config.order_flow` de verdade (só quando difere do default "tudo
  // ligado + kds", ver isDefaultStoreModules em lib/storeModules.ts). Uma
  // loja criada/editada sem tocar nesta seção nunca ganha essas chaves.
  modules?: StoreModules;
  orderFlow?: OrderFlow;
}

// Perfil de módulos por loja (Task 1): decide se `params.modules`/
// `params.orderFlow`/`params.printTarget` viram `config.modules`/
// `config.order_flow`/`config.print_target` de verdade. Nunca grava o
// default explícito (tudo ligado + 'kds' + 'device') — ausência de chave já
// significa isso (ver lib/storeModules.ts) — e remove a chave de um config
// existente se o admin editar uma loja de volta pro default (senão
// "desfazer" a customização no formulário nunca desfaria no banco).
const applyModulesConfigFields = (config: Record<string, any>, params: CreateStoreParams): Record<string, any> => {
  const next = { ...config };
  if (params.modules && !isDefaultStoreModules(params.modules)) {
    next.modules = params.modules;
  } else {
    delete next.modules;
  }
  if (params.orderFlow === 'direct_print') {
    next.order_flow = 'direct_print';
  } else {
    delete next.order_flow;
  }
  // Removido (redesign 2026-08-23): `print_target` deixou de existir (ver
  // lib/storeModules.ts) — apagado incondicionalmente daqui em diante pra
  // limpar qualquer resíduo `'station'` que uma loja editada antes desta
  // sessão possa ainda ter no `config` (nenhuma loja real tinha, mas o
  // update é idempotente de qualquer forma).
  delete next.print_target;
  return next;
};

export const createStore = async (params: CreateStoreParams): Promise<{ success: boolean; message?: string; storeId?: string }> => {
  try {
    const { data: storeData, error: storeError } = await supabase
      .from('stores')
      .insert({
        name: params.name, cnpj: params.cnpj, slug: params.slug, contract_type: params.contractType,
        contract_period_months: params.periodMonths, is_active: params.isActive, logo_url: params.logoUrl || null,
        cover_url: params.coverUrl || null,
        config: applyModulesConfigFields({ use_pin: true, allow_client_open: true, service_fee_rate: params.serviceFeeRate }, params),
      })
      .select()
      .single();

    if (storeError) {
      if (storeError.code === '23505') return { success: false, message: 'Este slug (URL) já está em uso.' };
      throw storeError;
    }

    if (params.contractType === 'balcao_mesas' && params.tableCount > 0) {
      const { error: tablesError } = await supabase.rpc('sync_store_tables_secure', { p_store_id: storeData.id, p_target_count: params.tableCount });
      if (tablesError) console.error('Error creating tables:', tablesError);
    }

    return { success: true, storeId: storeData.id };
  } catch (error: any) {
    return { success: false, message: error.message || 'Erro desconhecido ao criar loja.' };
  }
};

export const duplicateStore = async (storeId: string): Promise<{ success: boolean; message?: string }> => {
  try {
    const { data: originalStore, error: fetchError } = await supabase.from('stores').select('*').eq('id', storeId).single();
    if (fetchError || !originalStore) throw new Error('Loja original não encontrada.');

    let newSlug = `${originalStore.slug}-1`;
    const { data: existingSlug } = await supabase.from('stores').select('id').eq('slug', newSlug).maybeSingle();
    if (existingSlug) newSlug = `${newSlug}-${Math.random().toString(36).substring(2, 7)}`;

    const { data: newStore, error: createError } = await supabase
      .from('stores')
      .insert({ name: `${originalStore.name} (1)`, cnpj: originalStore.cnpj, slug: newSlug, contract_type: originalStore.contract_type, contract_period_months: originalStore.contract_period_months, is_active: originalStore.is_active, logo_url: originalStore.logo_url, cover_url: originalStore.cover_url, config: originalStore.config })
      .select()
      .single();

    if (createError) throw createError;

    // Duplicação completa (categorias + produtos + grupos de opção +
    // opções) numa RPC atômica só, com mapeamento de ID via tabela
    // temporária (migration 043) — substitui o trio anterior (insert de
    // categoria + duplicate_products_secure sem adicionais), que nunca
    // copiava adicionais/opcionais de produto.
    const { error: dupErr } = await supabase.rpc('duplicate_store_completo_secure', { p_store_id_origem: storeId, p_store_id_destino: newStore.id });
    if (dupErr) throw dupErr;

    const { data: originalTables } = await supabase.rpc('get_tables_secure', { p_store_id: storeId });
    const tableCount = (originalTables as any[])?.length || 0;
    if (tableCount > 0) {
      const { error: tablesError } = await supabase.rpc('sync_store_tables_secure', { p_store_id: newStore.id, p_target_count: tableCount });
      if (tablesError) console.error('Error duplicating tables:', tablesError);
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message || 'Erro desconhecido ao duplicar loja.' };
  }
};

export const updateStore = async (id: string, params: CreateStoreParams): Promise<{ success: boolean; message?: string }> => {
  try {
    // Busca o config atual pra só sobrescrever service_fee_rate (e o perfil
    // de módulos, ver applyModulesConfigFields), sem apagar outras flags
    // (use_pin, allow_client_open, require_pin_for_open, charge_service_fee)
    // que o lojista já pode ter configurado.
    const { data: current } = await supabase.from('stores').select('config').eq('id', id).single();
    const { error } = await supabase
      .from('stores')
      .update({
        name: params.name, cnpj: params.cnpj, slug: params.slug, contract_type: params.contractType,
        contract_period_months: params.periodMonths, is_active: params.isActive, logo_url: params.logoUrl,
        cover_url: params.coverUrl,
        config: applyModulesConfigFields({ ...(current?.config || {}), service_fee_rate: params.serviceFeeRate }, params),
      })
      .eq('id', id);

    if (error) {
      if (error.code === '23505') return { success: false, message: 'Este slug (URL) já está em uso por outra loja.' };
      throw error;
    }

    if (params.contractType === 'balcao_mesas') {
      const { error: syncErr } = await supabase.rpc('sync_store_tables_secure', { p_store_id: id, p_target_count: params.tableCount });
      if (syncErr) console.error('Error syncing tables:', syncErr);
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

// Soft-delete (decisão tomada com o usuário em 2026-07-02, ver
// docs/plans/2026-07-02-varredura-correcoes-plan.md): "excluir loja" apagava
// tudo em cascata (pedidos, produtos, mesas, usuários) sem volta. Agora só
// desativa (`is_active = false`) — histórico de vendas/produtos/mesas fica
// preservado. Antes de desativar, limpa o certificado fiscal órfão do Storage
// (a policy de DELETE pro bucket store-certificates foi criada em
// 009_indices_realtime_e_soft_delete.sql).
export const deleteStore = async (id: string): Promise<{ success: boolean; message?: string }> => {
  try {
    // Limpeza do certificado também passa por /api/certificado (mesmo
    // motivo do uploadStoreCertificate acima): listar o que existe no
    // bucket exige a mesma leitura que não pode ser liberada pra `anon`.
    try {
      const res = await fetch('/api/certificado', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: id }),
      });
      const data = await res.json();
      if (!data.success) console.error('Erro ao remover certificado órfão da loja:', data.message);
    } catch (certError) {
      console.error('Erro ao remover certificado órfão da loja:', certError);
    }

    const { error } = await supabase.from('stores').update({ is_active: false }).eq('id', id);
    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message || 'Erro ao excluir loja.' };
  }
};

export const createOrderRating = async (orderId: string, storeId: string, stars: number, comment: string | null): Promise<{ success: boolean; message?: string }> => {
  const { error } = await supabase.from('order_ratings').insert({ order_id: orderId, store_id: storeId, stars, comment: comment || null });
  if (error) return { success: false, message: error.message };
  return { success: true };
};

export const fetchOrderRatings = async (storeId: string, sinceDate?: string): Promise<OrderRating[]> => {
  let query = supabase.from('order_ratings').select('*').eq('store_id', storeId).order('created_at', { ascending: false }).limit(200);
  if (sinceDate) query = query.gte('created_at', sinceDate);
  const { data, error } = await query;
  if (error) { console.error('Error fetching order ratings:', error); return []; }
  return data || [];
};

// Conta universal: um login só que, em vez de estar preso a uma loja
// (como store_users), escolhe qual loja acessar a cada entrada. Tabela
// própria (universal_users), nunca acessada direto pelo client (mesmo
// padrão write-only via RPC do resto da autenticação).
export const authenticateUniversalUser = async (email: string, password: string): Promise<{ success: boolean; user?: UniversalUser; mustChangePass?: boolean; message?: string }> => {
  try {
    const { data, error } = await supabase.rpc('authenticate_universal_user_secure', { p_email: email, p_password: password });
    if (error) return { success: false, message: 'Erro de conexão.' };
    if (!data?.success) {
      return {
        success: false,
        message: data?.locked ? 'Muitas tentativas incorretas. Tente novamente em alguns minutos.' : 'Usuário ou senha incorretos.',
      };
    }
    return { success: true, user: data.user, mustChangePass: data.mustChangePass };
  } catch (error: any) {
    console.error('Auth Universal User Error:', error);
    return { success: false, message: 'Erro de conexão.' };
  }
};

export const updateUniversalUserPassword = async (userId: string, newPassword: string) => {
  const { error } = await supabase.rpc('update_universal_user_password_secure', { p_user_id: userId, p_new_password: newPassword });
  if (error) throw error;
};

export const fetchUniversalUserById = async (userId: string): Promise<UniversalUser | null> => {
  const { data, error } = await supabase.rpc('fetch_universal_user_by_id_secure', { p_user_id: userId });
  if (error || !data) return null;
  return data;
};
