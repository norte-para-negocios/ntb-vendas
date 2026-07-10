import { supabase } from '@/lib/supabaseClient';
import { Store, Table, Product, Category, OrderItem, OrderStatus, TableStatus, CartItem, StoreUser, Order, TableSession, StoreFiscalCertificateStatus, StoreFiscalConfig, OrderRating, UniversalUser, ProductOptionGroup } from '@/types';

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

export const createStoreTeamMember = async (storeId: string, userData: { name: string; email: string; password?: string; role: string; permissions: any }) => {
  const { data, error } = await supabase.rpc('create_store_team_member_secure', {
    p_store_id: storeId,
    p_name: userData.name,
    p_email: userData.email,
    p_password: userData.password || '123456',
    p_role: userData.role,
    p_permissions: userData.permissions,
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.message || 'Erro ao criar usuário.');
  return data;
};

export const updateStoreTeamMember = async (userId: string, userData: { name?: string; email?: string; role?: string; permissions?: any; password?: string }) => {
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
// devolvidas, só zera o campo embutido, ver AGENTS.md). Opções vêm numa 2ª
// leitura (dependem dos ids de grupo) em vez de embed de 2 níveis, por
// simplicidade e certeza de comportamento. `.limit(500)` nas duas queries,
// mesmo padrão de fetchActiveOrdersForTables/fetchKitchenOrders.
// `includeUnavailable`: false/omitido (cardápio do cliente e fluxo de
// pedido do garçom) filtra product_options só `available = true`; true
// (MenuManagementView editando produto) traz todas, inclusive indisponíveis.
async function fetchOptionGroupsByProduct(storeId: string, includeUnavailable = false): Promise<Map<string, ProductOptionGroup[]>> {
  const { data: groupsData, error: groupsError } = await supabase
    .from('product_option_groups')
    .select('*, product:products!inner(store_id)')
    .eq('product.store_id', storeId)
    .order('order')
    .limit(500);
  if (groupsError || !groupsData || groupsData.length === 0) {
    if (groupsError) console.error('Fetch product option groups error:', groupsError);
    return new Map();
  }

  const groupIds = groupsData.map((g: any) => g.id);
  let optionsQuery = supabase.from('product_options').select('*').in('group_id', groupIds).order('order').limit(500);
  if (!includeUnavailable) optionsQuery = optionsQuery.eq('available', true);
  const { data: optionsData, error: optionsError } = await optionsQuery;
  if (optionsError) console.error('Fetch product options error:', optionsError);

  const optionsByGroup = new Map<string, { id: string; group_id: string; name: string; price_delta: number; available: boolean; order: number }[]>();
  for (const o of optionsData || []) {
    const list = optionsByGroup.get(o.group_id) || [];
    list.push({ id: o.id, group_id: o.group_id, name: o.name, price_delta: Number(o.price_delta), available: o.available, order: o.order });
    optionsByGroup.set(o.group_id, list);
  }

  const groupsByProduct = new Map<string, ProductOptionGroup[]>();
  for (const g of groupsData as any[]) {
    const list = groupsByProduct.get(g.product_id) || [];
    list.push({
      id: g.id, product_id: g.product_id, name: g.name, type: g.type, required: g.required,
      min_select: g.min_select ?? null, max_select: g.max_select ?? null, order: g.order,
      options: optionsByGroup.get(g.id) || [],
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
  options: { name: string; price_delta: number; available?: boolean }[];
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
      options: g.options.map(o => ({ name: o.name, price_delta: o.price_delta, available: o.available ?? true })),
    })),
  });
  if (error) throw error;
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
  const { data, error } = await supabase.from('tables').select('*').eq('store_id', storeId).order('number');
  if (error) console.error(error);
  return data || [];
};

// Igual a fetchTables, mas sem a coluna `pin` — usada pelo cardápio do cliente
// (ClientModule), que não deve receber o PIN de mesas que não são as dele.
export const fetchTablesPublic = async (storeId: string): Promise<Table[]> => {
  const { data, error } = await supabase
    .from('tables')
    .select('id, store_id, number, status, current_host_name, guest_count, waiter_requested, service_fee_removed')
    .eq('store_id', storeId)
    .order('number');
  if (error) console.error(error);
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

export const fetchTableOrderSummary = async (tableId: string): Promise<{ total: number; items: any[] }> => {
  const { data, error } = await supabase.rpc('fetch_table_order_summary_secure', { p_table_id: tableId });
  if (error || !data) return { total: 0, items: [] };
  return { total: Number((data as any).total) || 0, items: (data as any).items || [] };
};

export const fetchKitchenOrders = async (storeId: string, destination: 'kitchen' | 'bar' = 'kitchen'): Promise<OrderItem[]> => {
  const { data, error } = await supabase.rpc('fetch_kitchen_orders_secure', { p_store_id: storeId, p_destination: destination });
  if (error) { console.error('Kitchen fetch error:', error); return []; }
  return (data as any) || [];
};

export const fetchCounterOrders = async (storeId: string): Promise<Order[]> => {
  const { data, error } = await supabase.rpc('fetch_counter_orders_secure', { p_store_id: storeId });
  if (error) { console.error('Fetch Counter Orders Error', error); return []; }
  return (data as any) || [];
};

export const fetchSalesHistory = async (storeId: string, startDate?: string, endDate?: string): Promise<Order[]> => {
  const { data, error } = await supabase.rpc('fetch_sales_history_secure', {
    p_store_id: storeId,
    p_start_date: startDate || null,
    p_end_date: endDate || null,
  });
  if (error) { console.error('Fetch Sales History Error', error); return []; }
  return (data as any) || [];
};

export const fetchTableSessions = async (storeId: string, sinceDate?: string): Promise<TableSession[]> => {
  let query = supabase
    .from('table_sessions')
    .select('*')
    .eq('store_id', storeId)
    .not('closed_at', 'is', null)
    .order('opened_at', { ascending: false })
    .limit(2000);

  if (sinceDate) query = query.gte('opened_at', sinceDate);

  const { data, error } = await query;
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

export const closeCounterOrder = async (orderId: string) => {
  const { error } = await supabase.rpc('close_counter_order_secure', { p_order_id: orderId });
  if (error) throw error;
  triggerOrdemProducao({ orderId });
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

export const callWaiter = async (tableId: string) => {
  const { error } = await supabase.from('tables').update({ waiter_requested: true }).eq('id', tableId);
  if (error) { console.error('Erro ao chamar garçom:', error); throw error; }
};

export const dismissWaiterRequest = async (tableId: string) => {
  const { error } = await supabase.from('tables').update({ waiter_requested: false }).eq('id', tableId);
  if (error) throw error;
};

export const toggleTableServiceFee = async (tableId: string, removed: boolean) => {
  const { error } = await supabase.from('tables').update({ service_fee_removed: removed }).eq('id', tableId);
  if (error) {
    if (error.code === '42703' || error.message?.includes('column') || error.message?.includes('does not exist')) {
      throw new Error('schema cache');
    }
    throw error;
  }
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

// Fecha a sessão de ocupação em aberto de uma mesa (usada ao fechar conta / mover mesa).
export const closeOpenTableSession = async (tableId: string) => {
  await supabase
    .from('table_sessions')
    .update({ closed_at: new Date().toISOString() })
    .eq('table_id', tableId)
    .is('closed_at', null);
};

// Abertura manual pelo lojista (ex.: balcão abrindo mesa direto) — sem PIN,
// mas ainda grava a sessão para entrar na métrica de tempo médio de ocupação.
export const openTableManually = async (tableId: string, storeId: string, hostName: string) => {
  await supabase.from('tables').update({ status: TableStatus.OCCUPIED, current_host_name: hostName }).eq('id', tableId);
  await supabase.from('table_sessions').insert({ table_id: tableId, store_id: storeId, host_name: hostName });
};

export const requestTableBill = async (tableId: string) => {
  await supabase.from('tables').update({ status: TableStatus.WAITING_BILL }).eq('id', tableId);
};

export const cancelPendingTableItems = async (tableId: string) => {
  await supabase.rpc('cancel_pending_table_items_secure', { p_table_id: tableId });
};

export const closeTableSession = async (
  tableId: string,
  paymentData?: { total: number; methods: { method: string; amount: number }[] },
): Promise<{ success: boolean; message?: string }> => {
  let warningMessage = '';
  try {
    const paymentMethod = paymentData
      ? (paymentData.methods.length === 1 ? paymentData.methods[0].method : 'MULTIPLE')
      : null;

    const { error: closeErr } = await supabase.rpc('close_table_orders_secure', {
      p_table_id: tableId,
      p_payment_method: paymentMethod,
      p_payment_details: paymentData || null,
    });
    if (closeErr) throw new Error('Falha ao fechar pedidos da mesa: ' + closeErr.message);

    const newPin = Math.floor(1000 + Math.random() * 9000).toString();

    const { error: tableErr } = await supabase
      .from('tables')
      .update({ status: TableStatus.AVAILABLE, current_host_name: null, pin: newPin, waiter_requested: false, service_fee_removed: false })
      .eq('id', tableId);

    if (tableErr) {
      if (tableErr.code === '42703' || tableErr.message?.includes('column') || tableErr.message?.includes('does not exist')) {
        const { error: fallbackTableErr } = await supabase
          .from('tables')
          .update({ status: TableStatus.AVAILABLE, current_host_name: null, pin: newPin })
          .eq('id', tableId);
        if (fallbackTableErr) return { success: false, message: fallbackTableErr.message };
      } else {
        return { success: false, message: tableErr.message };
      }
    }

    await closeOpenTableSession(tableId);
    triggerOrdemProducao({ tableId });

    return { success: true, message: warningMessage };
  } catch (e: any) {
    return { success: false, message: e.message || 'Erro desconhecido.' };
  }
};

export const toggleTableBlock = async (tableId: string, currentStatus: TableStatus) => {
  const newStatus = currentStatus === TableStatus.BLOCKED ? TableStatus.AVAILABLE : TableStatus.BLOCKED;
  await supabase.from('tables').update({ status: newStatus }).eq('id', tableId);
};

export const moveTable = async (sourceTableId: string, targetTableId: string): Promise<{ success: boolean; message?: string }> => {
  try {
    const { data: targetTable, error: targetErr } = await supabase.from('tables').select('status').eq('id', targetTableId).single();
    if (targetErr || !targetTable) return { success: false, message: 'Mesa de destino não encontrada.' };
    if (targetTable.status !== TableStatus.AVAILABLE) return { success: false, message: 'Mesa de destino não está disponível.' };

    const { data: sourceTable, error: sourceErr } = await supabase.from('tables').select('*').eq('id', sourceTableId).single();
    if (sourceErr || !sourceTable) return { success: false, message: 'Mesa de origem não encontrada.' };

    const { error: moveErr } = await supabase
      .from('orders')
      .update({ table_id: targetTableId })
      .eq('table_id', sourceTableId)
      .neq('status', OrderStatus.DELIVERED)
      .neq('status', OrderStatus.CANCELED);

    if (moveErr) return { success: false, message: 'Falha ao mover pedidos.' };

    const { error: updateTargetErr } = await supabase
      .from('tables')
      .update({ status: sourceTable.status, current_host_name: sourceTable.current_host_name, waiter_requested: sourceTable.waiter_requested, guest_count: sourceTable.guest_count })
      .eq('id', targetTableId);

    if (updateTargetErr) return { success: false, message: 'Falha ao atualizar mesa de destino.' };

    const newPin = Math.floor(1000 + Math.random() * 9000).toString();
    await supabase.from('tables').update({ status: TableStatus.AVAILABLE, current_host_name: null, waiter_requested: false, guest_count: 0, pin: newPin }).eq('id', sourceTableId);

    // A ocupação continua, só muda de mesa física: transfere a sessão em aberto
    // (mantém o opened_at real) em vez de fechar e perder o tempo já decorrido.
    await supabase.from('table_sessions').update({ table_id: targetTableId }).eq('table_id', sourceTableId).is('closed_at', null);

    return { success: true };
  } catch (e: any) {
    return { success: false, message: e.message || 'Erro desconhecido.' };
  }
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
  nfeSerie?: number;
  nfceSerie?: number;
  cteSerie?: number;
  mdfeSerie?: number;
  nfeUltimoNumero?: number;
  nfceUltimoNumero?: number;
  cteUltimoNumero?: number;
  mdfeUltimoNumero?: number;
  inscricaoMunicipal?: string;
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

export interface CreateStoreParams {
  name: string;
  cnpj: string;
  slug: string;
  contractType: 'balcao' | 'balcao_mesas';
  tableCount: number;
  periodMonths: number;
  isActive: boolean;
  logoUrl?: string | null;
  serviceFeeRate: number;
}

export const createStore = async (params: CreateStoreParams): Promise<{ success: boolean; message?: string }> => {
  try {
    const { data: storeData, error: storeError } = await supabase
      .from('stores')
      .insert({
        name: params.name, cnpj: params.cnpj, slug: params.slug, contract_type: params.contractType,
        contract_period_months: params.periodMonths, is_active: params.isActive, logo_url: params.logoUrl || null,
        config: { use_pin: true, allow_client_open: true, service_fee_rate: params.serviceFeeRate },
      })
      .select()
      .single();

    if (storeError) {
      if (storeError.code === '23505') return { success: false, message: 'Este slug (URL) já está em uso.' };
      throw storeError;
    }

    if (params.contractType === 'balcao_mesas' && params.tableCount > 0) {
      const tablesToInsert = [];
      for (let i = 1; i <= params.tableCount; i++) {
        tablesToInsert.push({ store_id: storeData.id, number: i, pin: Math.floor(1000 + Math.random() * 9000).toString(), status: TableStatus.AVAILABLE });
      }
      const { error: tablesError } = await supabase.from('tables').insert(tablesToInsert);
      if (tablesError) console.error('Error creating tables:', tablesError);
    }

    return { success: true };
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
      .insert({ name: `${originalStore.name} (1)`, cnpj: originalStore.cnpj, slug: newSlug, contract_type: originalStore.contract_type, contract_period_months: originalStore.contract_period_months, is_active: originalStore.is_active, logo_url: originalStore.logo_url, config: originalStore.config })
      .select()
      .single();

    if (createError) throw createError;

    const { data: categories } = await supabase.from('categories').select('*').eq('store_id', storeId);
    const categoryMap: { [oldId: string]: string } = {};

    if (categories && categories.length > 0) {
      // Insert único (era um insert por categoria antes); casa a nova pela posição do array,
      // já que o Postgrest devolve as linhas de um insert em lote na mesma ordem em que foram enviadas.
      const categoriesToInsert = categories.map((cat) => ({ store_id: newStore.id, name: cat.name, order: cat.order }));
      const { data: newCategories, error: categoriesErr } = await supabase.from('categories').insert(categoriesToInsert).select();
      if (categoriesErr) throw categoriesErr;
      newCategories?.forEach((newCat, i) => { categoryMap[categories[i].id] = newCat.id; });
    }

    const { data: products } = await supabase.from('products').select('*').eq('store_id', storeId);
    if (products && products.length > 0) {
      const productsToInsert = products.map((prod) => ({
        category_id: prod.category_id ? categoryMap[prod.category_id] : null,
        name: prod.name, description: prod.description, price: prod.price, image_url: prod.image_url,
        available: prod.available, prep_time_minutes: prod.prep_time_minutes,
      }));
      // Achado critico de seguranca (2026-07-07): insert em lote direto em
      // products, mesma classe do resto (ver comentario de createProduct).
      const { error: dupErr } = await supabase.rpc('duplicate_products_secure', { p_store_id: newStore.id, p_products: productsToInsert });
      if (dupErr) throw dupErr;
    }

    const { data: tables } = await supabase.from('tables').select('*').eq('store_id', storeId);
    if (tables && tables.length > 0) {
      const tablesToInsert = tables.map((t) => ({ store_id: newStore.id, number: t.number, pin: Math.floor(1000 + Math.random() * 9000).toString(), status: TableStatus.AVAILABLE }));
      await supabase.from('tables').insert(tablesToInsert);
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message || 'Erro desconhecido ao duplicar loja.' };
  }
};

export const updateStore = async (id: string, params: CreateStoreParams): Promise<{ success: boolean; message?: string }> => {
  try {
    // Busca o config atual pra só sobrescrever service_fee_rate, sem apagar
    // outras flags (use_pin, allow_client_open, require_pin_for_open,
    // charge_service_fee) que o lojista já pode ter configurado.
    const { data: current } = await supabase.from('stores').select('config').eq('id', id).single();
    const { error } = await supabase
      .from('stores')
      .update({
        name: params.name, cnpj: params.cnpj, slug: params.slug, contract_type: params.contractType,
        contract_period_months: params.periodMonths, is_active: params.isActive, logo_url: params.logoUrl,
        config: { ...(current?.config || {}), service_fee_rate: params.serviceFeeRate },
      })
      .eq('id', id);

    if (error) {
      if (error.code === '23505') return { success: false, message: 'Este slug (URL) já está em uso por outra loja.' };
      throw error;
    }

    if (params.contractType === 'balcao_mesas') {
      const { data: currentTables } = await supabase.from('tables').select('*').eq('store_id', id).order('number', { ascending: true });
      const currentCount = currentTables?.length || 0;
      const targetCount = params.tableCount;

      if (targetCount > currentCount) {
        const tablesToInsert = [];
        for (let i = currentCount + 1; i <= targetCount; i++) {
          tablesToInsert.push({ store_id: id, number: i, pin: Math.floor(1000 + Math.random() * 9000).toString(), status: TableStatus.AVAILABLE });
        }
        await supabase.from('tables').insert(tablesToInsert);
      } else if (targetCount < currentCount) {
        const tablesToDelete = currentTables!.slice(targetCount).map((t) => t.id);
        if (tablesToDelete.length > 0) await supabase.from('tables').delete().in('id', tablesToDelete);
      }
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
