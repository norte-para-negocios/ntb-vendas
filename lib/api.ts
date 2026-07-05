import { supabase } from '@/lib/supabaseClient';
import { Store, Table, Product, Category, OrderItem, OrderStatus, TableStatus, CartItem, StoreUser, Order, TableSession, StoreFiscalCertificateStatus, OrderRating, UniversalUser, ProductOptionGroup } from '@/types';

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

export const fetchMenu = async (storeId: string, onlyAvailable = true, includeUnavailable = false): Promise<{ categories: Category[]; products: Product[]; error?: 'network' }> => {
  try {
    const categoriesQuery = supabase.from('categories').select('*').eq('store_id', storeId).order('order');
    let productsQuery = supabase.from('products').select('*').eq('store_id', storeId).order('order', { ascending: true, nullsFirst: false });
    if (onlyAvailable) productsQuery = productsQuery.eq('available', true);

    // Query de adicionais paralelizada com categorias/produtos (não depende
    // do resultado delas, só do storeId) — antes rodava sequencialmente
    // depois do Promise.all abaixo.
    const [cats, prods, groupsByProduct] = await Promise.all([
      categoriesQuery,
      productsQuery,
      fetchOptionGroupsByProduct(storeId, includeUnavailable),
    ]);

    if (prods.error && (prods.error.code === '42703' || prods.error.message?.includes('column') || prods.error.message?.includes('does not exist'))) {
      let fallbackQuery = supabase.from('products').select('*').eq('store_id', storeId);
      if (onlyAvailable) fallbackQuery = fallbackQuery.eq('available', true);
      const fallbackProds = await fallbackQuery;
      if (fallbackProds.error || cats.error) {
        console.error('Error fetching menu (fallback):', fallbackProds.error || cats.error);
        return { categories: cats.data || [], products: fallbackProds.data || [], error: 'network' };
      }
      return { categories: cats.data || [], products: mergeOptionGroups(fallbackProds.data || [], groupsByProduct) };
    }

    if (cats.error || prods.error) {
      console.error('Error fetching menu:', cats.error || prods.error);
      return { categories: cats.data || [], products: prods.data || [], error: 'network' };
    }

    return { categories: cats.data || [], products: mergeOptionGroups(prods.data || [], groupsByProduct) };
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

export const createProduct = async (storeId: string, categoryId: string, product: Partial<Product>): Promise<string> => {
  const { data: maxOrderData, error: maxOrderError } = await supabase.from('products').select('order').eq('category_id', categoryId).order('order', { ascending: false }).limit(1);
  const nextOrder = maxOrderError ? 1 : ((maxOrderData?.[0]?.order || 0) + 1);

  const { data, error } = await supabase.from('products').insert({
    store_id: storeId, category_id: categoryId, name: product.name, description: product.description,
    price: product.price, image_url: product.image_url, prep_time_minutes: product.prep_time_minutes || 15,
    available: true, order: nextOrder, destination: product.destination || 'kitchen',
  }).select('id').single();

  if (error) {
    if (error.code === '42703' || error.message?.includes('column') || error.message?.includes('does not exist')) {
      const { data: fallbackData, error: fallbackError } = await supabase.from('products').insert({
        store_id: storeId, category_id: categoryId, name: product.name, description: product.description,
        price: product.price, image_url: product.image_url, prep_time_minutes: product.prep_time_minutes || 15, available: true,
      }).select('id').single();
      if (fallbackError) throw fallbackError;
      if (product.destination && product.destination !== 'kitchen') throw new Error('schema cache destination');
      return fallbackData.id;
    }
    throw error;
  }
  return data.id;
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

export const updateProduct = async (id: string, updates: Partial<Product>) => {
  const { error } = await supabase.from('products').update(updates).eq('id', id);
  if (error) {
    if (error.code === '42703' || error.message?.includes('column') || error.message?.includes('does not exist')) {
      if (updates.destination) throw new Error('schema cache destination');
    }
    throw error;
  }
};

export const updateCategoryOrder = async (updates: { id: string; order: number }[]) => {
  const { error } = await supabase.rpc('update_categories_order', { p_updates: updates });
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

export const deleteProduct = async (id: string) => {
  const { error } = await supabase.from('products').delete().eq('id', id);
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

export const fetchActiveOrdersForTables = async (storeId: string): Promise<Order[]> => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*, product:products(*))')
    .eq('store_id', storeId)
    .eq('order_type', 'table')
    .neq('status', OrderStatus.DELIVERED)
    .neq('status', OrderStatus.CANCELED)
    .order('created_at')
    .limit(500);

  if (error) { console.error('Fetch Active Table Orders Error', error); return []; }

  const orders = (data as any) || [];
  orders.forEach((order: any) => {
    if (order.order_items) order.order_items = order.order_items.filter((item: any) => item.product);
  });
  return orders;
};

export const fetchTableOrderSummary = async (tableId: string): Promise<{ total: number; items: any[] }> => {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*, order_items(*, product:products(*))')
    .eq('table_id', tableId)
    .neq('status', OrderStatus.DELIVERED)
    .neq('status', OrderStatus.CANCELED)
    .limit(500);

  if (error || !orders) return { total: 0, items: [] };

  let total = 0;
  const allItems: any[] = [];

  orders.forEach((order: any) => {
    if (order.order_items) {
      order.order_items.forEach((item: any) => {
        if (item.status !== OrderStatus.CANCELED && item.product) {
          total += item.price_at_time * item.quantity;
          allItems.push(item);
        }
      });
    }
  });

  return { total, items: allItems };
};

export const fetchKitchenOrders = async (storeId: string, destination: 'kitchen' | 'bar' = 'kitchen'): Promise<OrderItem[]> => {
  const { data, error } = await supabase
    .from('order_items')
    // products!inner (não só products) é obrigatório aqui: sem o !inner o Postgrest só
    // zera o campo embutido de quem não bate o filtro, mas continua lendo/contando as
    // linhas de order_items de TODAS as lojas da plataforma (confirmado testando direto
    // na API - sem !inner vinham 179 linhas incluindo de outras lojas, com !inner só 26,
    // as reais da loja filtrada).
    .select('*, product:products!inner(*), order:orders(*, tables(number))')
    .eq('product.store_id', storeId)
    .neq('status', OrderStatus.DELIVERED)
    .neq('status', OrderStatus.CANCELED)
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) { console.error('Kitchen fetch error:', error); return []; }

  const filtered = (data as any).filter((item: any) => {
    if (!item.product) return false;
    if ((item.product.destination || 'kitchen') !== destination) return false;
    if (item.order?.order_type === 'counter' && item.status === 'pending') return false;
    return true;
  });

  return filtered;
};

export const fetchCounterOrders = async (storeId: string): Promise<Order[]> => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*, product:products(*))')
    .eq('store_id', storeId)
    .eq('order_type', 'counter')
    .neq('status', 'delivered')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) { console.error('Fetch Counter Orders Error', error); return []; }
  return (data as any) || [];
};

export const fetchSalesHistory = async (storeId: string, startDate?: string, endDate?: string): Promise<Order[]> => {
  let query = supabase
    .from('orders')
    .select('*, order_items(*, product:products(*)), tables(*)')
    .eq('store_id', storeId)
    .eq('status', OrderStatus.DELIVERED)
    .order('created_at', { ascending: false })
    .limit(2000);

  if (startDate) query = query.gte('created_at', startDate);
  if (endDate) query = query.lte('created_at', endDate);

  const { data, error } = await query;
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

export const clearSalesHistory = async (storeId: string) => {
  // order_items.order_id tem "on delete cascade" (001_schema_inicial.sql), entao apagar as
  // orders ja cuida dos itens - nao precisa (nem precisava) apagar order_items manualmente.
  // Pagina desde o inicio em vez de tentar um DELETE sem limite pra loja inteira de uma vez.
  const chunkSize = 200;
  while (true) {
    const { data: orders, error: fetchError } = await supabase
      .from('orders')
      .select('id')
      .eq('store_id', storeId)
      .limit(chunkSize);
    if (fetchError) throw fetchError;
    if (!orders || orders.length === 0) break;

    const { error: deleteError } = await supabase
      .from('orders')
      .delete()
      .in('id', orders.map((o) => o.id));
    if (deleteError) throw deleteError;

    if (orders.length < chunkSize) break;
  }
};

export const updateOrderStatus = async (orderId: string, status: OrderStatus) => {
  const { error } = await supabase.from('orders').update({ status }).eq('id', orderId);
  if (error) throw error;
};

export const sendOrderToKitchen = async (orderId: string) => {
  const { error: orderError } = await supabase.from('orders').update({ status: OrderStatus.ACCEPTED }).eq('id', orderId);
  if (orderError) throw orderError;
  const { error: itemsError } = await supabase.from('order_items').update({ status: OrderStatus.ACCEPTED }).eq('order_id', orderId);
  if (itemsError) throw itemsError;
};

export const closeCounterOrder = async (orderId: string) => {
  const { error } = await supabase
    .from('orders')
    .update({ status: OrderStatus.DELIVERED, updated_at: new Date().toISOString() })
    .eq('id', orderId);

  if (error) {
    if (error.code === '42703' || error.message?.includes('column') || error.message?.includes('does not exist')) {
      throw new Error('schema cache updated_at');
    }
    throw error;
  }

  await supabase.from('order_items').update({ status: OrderStatus.DELIVERED }).eq('order_id', orderId);
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
  const { data, error } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (error) return null;
  return data;
};

export const updateOrderItemStatus = async (itemId: string, status: OrderStatus): Promise<{ success: boolean; message?: string }> => {
  const { error } = await supabase.from('order_items').update({ status }).eq('id', itemId);
  if (error) {
    console.error('Update Order Item Status Error:', error);
    return { success: false, message: error.message };
  }
  return { success: true };
};

export const cancelSpecificOrderItem = async (itemId: string) => {
  await supabase.from('order_items').update({ status: OrderStatus.CANCELED }).eq('id', itemId);
};

export const updateTableStatus = async (tableId: string, status: TableStatus, hostName?: string) => {
  const updateData: any = { status };
  if (hostName !== undefined) updateData.current_host_name = hostName;
  await supabase.from('tables').update(updateData).eq('id', tableId);
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
  const { data: orders } = await supabase
    .from('orders')
    .select('id')
    .eq('table_id', tableId)
    .neq('status', OrderStatus.DELIVERED)
    .limit(200);

  if (!orders || orders.length === 0) return;
  const orderIds = orders.map((o) => o.id);

  await supabase
    .from('order_items')
    .update({ status: OrderStatus.CANCELED })
    .in('order_id', orderIds)
    .in('status', [OrderStatus.PENDING, OrderStatus.ACCEPTED]);
};

export const closeTableSession = async (
  tableId: string,
  paymentData?: { total: number; methods: { method: string; amount: number }[] },
): Promise<{ success: boolean; message?: string }> => {
  let warningMessage = '';
  try {
    const { data: orders } = await supabase
      .from('orders')
      .select('id')
      .eq('table_id', tableId)
      .neq('status', OrderStatus.DELIVERED)
      .neq('status', OrderStatus.CANCELED)
      .limit(200);

    if (orders && orders.length > 0) {
      const orderIds = orders.map((o) => o.id);
      const updatePayload: any = { status: OrderStatus.DELIVERED };

      if (paymentData) {
        const primaryMethod = paymentData.methods.length === 1 ? paymentData.methods[0].method : 'MULTIPLE';
        updatePayload.payment_method = primaryMethod;
        updatePayload.payment_details = paymentData;
      }
      updatePayload.updated_at = new Date().toISOString();

      const { error: orderErr } = await supabase.from('orders').update(updatePayload).in('id', orderIds);

      if (orderErr) {
        if (orderErr.code === '42703' || orderErr.message?.includes('column') || orderErr.message?.includes('does not exist')) {
          if (orderErr.message?.includes('updated_at')) throw new Error('schema cache updated_at');
          const fallbackPayload = { status: OrderStatus.DELIVERED };
          const { error: fallbackErr } = await supabase.from('orders').update(fallbackPayload).in('id', orderIds);
          if (fallbackErr) throw new Error('Falha ao fechar pedidos: ' + fallbackErr.message);
          warningMessage = 'Aviso: Detalhes do pagamento não foram salvos.';
        } else {
          throw new Error('Falha ao fechar pedidos da mesa: ' + orderErr.message);
        }
      }

      const { error: itemsErr } = await supabase
        .from('order_items')
        .update({ status: OrderStatus.DELIVERED })
        .in('order_id', orderIds)
        .neq('status', OrderStatus.CANCELED);

      if (itemsErr) throw new Error('Falha ao atualizar itens.');
    }

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
        store_id: newStore.id, category_id: prod.category_id ? categoryMap[prod.category_id] : null,
        name: prod.name, description: prod.description, price: prod.price, image_url: prod.image_url,
        available: prod.available, prep_time_minutes: prod.prep_time_minutes,
      }));
      await supabase.from('products').insert(productsToInsert);
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
