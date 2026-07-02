import { supabase } from '@/lib/supabaseClient';
import { Store, Table, Product, Category, OrderItem, OrderStatus, TableStatus, CartItem, StoreUser, Order, TableSession, StoreFiscalCertificateStatus } from '@/types';

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
  const { error } = await supabase
    .from('system_admins')
    .update({ password: newPassword, must_change_password: false })
    .eq('id', userId);
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
  const { error } = await supabase
    .from('store_users')
    .update({ password: newPassword, must_change_password: false })
    .eq('id', userId);
  if (error) throw error;
};

export const fetchStoreTeamMembers = async (storeId: string): Promise<StoreUser[]> => {
  const { data, error } = await supabase
    .from('store_users')
    .select('*')
    .eq('store_id', storeId)
    .order('name');
  if (error) { console.error('Error fetching store team:', error); return []; }
  return data || [];
};

export const createStoreTeamMember = async (storeId: string, userData: { name: string; email: string; password?: string; role: string; permissions: any }) => {
  const { data, error } = await supabase
    .from('store_users')
    .insert([{
      store_id: storeId,
      name: userData.name,
      email: userData.email,
      password: userData.password || '123456',
      role: userData.role,
      permissions: userData.permissions,
      must_change_password: true,
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const updateStoreTeamMember = async (userId: string, userData: { name?: string; email?: string; role?: string; permissions?: any; password?: string }) => {
  const updates: any = { ...userData };
  if (updates.password) updates.must_change_password = true;
  const { data, error } = await supabase
    .from('store_users')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const deleteStoreTeamMember = async (userId: string) => {
  const { error } = await supabase.from('store_users').delete().eq('id', userId);
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

export const fetchStoreBySlug = async (slug: string): Promise<Store | null> => {
  const { data, error } = await supabase.from('stores').select('*').eq('slug', slug).single();
  if (error) { console.error('Error fetching store:', error); return null; }
  return data;
};

export const fetchStoreById = async (storeId: string): Promise<Store | null> => {
  const { data, error } = await supabase.from('stores').select('*').eq('id', storeId).single();
  if (error) { console.error('Error fetching store by id:', error); return null; }
  return data;
};

export const createStoreUser = async (storeId: string, name: string, email: string, password: string): Promise<{ success: boolean; message?: string }> => {
  try {
    const { error } = await supabase.from('store_users').insert({
      store_id: storeId, name, email, password,
      role: 'owner',
      permissions: { tables: true, counter: true, kitchen: true, menu: true, admin: true },
      must_change_password: true,
    });
    if (error) {
      if (error.code === '23505') return { success: false, message: 'Este e-mail já está cadastrado nesta loja.' };
      throw error;
    }
    return { success: true };
  } catch (error: any) {
    console.error('Create User Error:', error);
    return { success: false, message: error.message };
  }
};

export const updateStoreUser = async (userId: string, updates: Partial<StoreUser> & { password?: string }): Promise<{ success: boolean; message?: string }> => {
  try {
    const { error } = await supabase.from('store_users').update(updates).eq('id', userId);
    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

export const deleteStoreUser = async (userId: string): Promise<{ success: boolean; message?: string }> => {
  try {
    const { error } = await supabase.from('store_users').delete().eq('id', userId);
    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

export const fetchStoreUsers = async (): Promise<(StoreUser & { store: Store })[]> => {
  const { data, error } = await supabase
    .from('store_users')
    .select('*, store:stores(*)')
    .order('created_at', { ascending: false });
  if (error) { console.error('Fetch Users Error:', error); return []; }
  return data as any;
};

export const fetchMenu = async (storeId: string, onlyAvailable = true): Promise<{ categories: Category[]; products: Product[] }> => {
  const categoriesQuery = supabase.from('categories').select('*').eq('store_id', storeId).order('order');
  let productsQuery = supabase.from('products').select('*').eq('store_id', storeId).order('order', { ascending: true, nullsFirst: false });
  if (onlyAvailable) productsQuery = productsQuery.eq('available', true);

  const [cats, prods] = await Promise.all([categoriesQuery, productsQuery]);

  if (prods.error && (prods.error.code === '42703' || prods.error.message?.includes('column') || prods.error.message?.includes('does not exist'))) {
    let fallbackQuery = supabase.from('products').select('*').eq('store_id', storeId);
    if (onlyAvailable) fallbackQuery = fallbackQuery.eq('available', true);
    const fallbackProds = await fallbackQuery;
    return { categories: cats.data || [], products: fallbackProds.data || [] };
  }

  return { categories: cats.data || [], products: prods.data || [] };
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

export const createProduct = async (storeId: string, categoryId: string, product: Partial<Product>) => {
  const { data: maxOrderData, error: maxOrderError } = await supabase.from('products').select('order').eq('category_id', categoryId).order('order', { ascending: false }).limit(1);
  const nextOrder = maxOrderError ? 1 : ((maxOrderData?.[0]?.order || 0) + 1);

  const { error } = await supabase.from('products').insert({
    store_id: storeId, category_id: categoryId, name: product.name, description: product.description,
    price: product.price, image_url: product.image_url, prep_time_minutes: product.prep_time_minutes || 15,
    available: true, order: nextOrder, destination: product.destination || 'kitchen',
  });

  if (error) {
    if (error.code === '42703' || error.message?.includes('column') || error.message?.includes('does not exist')) {
      const { error: fallbackError } = await supabase.from('products').insert({
        store_id: storeId, category_id: categoryId, name: product.name, description: product.description,
        price: product.price, image_url: product.image_url, prep_time_minutes: product.prep_time_minutes || 15, available: true,
      });
      if (fallbackError) throw fallbackError;
      if (product.destination && product.destination !== 'kitchen') throw new Error('schema cache destination');
      return;
    }
    throw error;
  }
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
// acesso). Vai pro bucket privado `store-certificates` — ver
// supabase/migrations/006_fiscal_certificado.sql pro porquê.
const CERT_BUCKET = 'store-certificates';

export const uploadStoreCertificate = async (storeId: string, file: File): Promise<{ success: boolean; message?: string }> => {
  const path = `${storeId}/certificado.pfx`;
  const { error } = await supabase.storage.from(CERT_BUCKET).upload(path, file, { upsert: true });
  if (error) return { success: false, message: error.message };
  return { success: true };
};

export const saveStoreCertificateMetadata = async (storeId: string, originalFilename: string, expiresAt: string | null): Promise<{ success: boolean; message?: string }> => {
  const { error } = await supabase.from('store_fiscal_certificates').upsert({
    store_id: storeId,
    file_path: `${storeId}/certificado.pfx`,
    original_filename: originalFilename,
    uploaded_at: new Date().toISOString(),
    expires_at: expiresAt,
  }, { onConflict: 'store_id' });
  if (error) return { success: false, message: error.message };
  return { success: true };
};

export const saveStoreCertificateSecret = async (storeId: string, password: string): Promise<{ success: boolean; message?: string }> => {
  // SEM .select() de propósito: a tabela não tem policy de SELECT pra anon
  // (write-only, ver a migration). supabase-js só pede a linha de volta
  // (Prefer: return=representation) quando .select() é encadeado — sem
  // isso, o upsert funciona como INSERT/UPDATE puro mesmo sem permissão
  // de leitura nenhuma.
  const { error } = await supabase.from('store_fiscal_certificate_secrets').upsert({
    store_id: storeId,
    password,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'store_id' });
  if (error) return { success: false, message: error.message };
  return { success: true };
};

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
}

export const createStore = async (params: CreateStoreParams): Promise<{ success: boolean; message?: string }> => {
  try {
    const { data: storeData, error: storeError } = await supabase
      .from('stores')
      .insert({
        name: params.name, cnpj: params.cnpj, slug: params.slug, contract_type: params.contractType,
        contract_period_months: params.periodMonths, is_active: params.isActive, logo_url: params.logoUrl || null,
        config: { use_pin: true, allow_client_open: true },
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
    const { error } = await supabase
      .from('stores')
      .update({ name: params.name, cnpj: params.cnpj, slug: params.slug, contract_type: params.contractType, contract_period_months: params.periodMonths, is_active: params.isActive, logo_url: params.logoUrl })
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
    const { data: certFiles, error: listError } = await supabase.storage.from(CERT_BUCKET).list(id);
    if (listError) {
      console.error('Erro ao listar certificado da loja no Storage:', listError);
    } else if (certFiles && certFiles.length > 0) {
      const paths = certFiles.map((f) => `${id}/${f.name}`);
      const { error: removeError } = await supabase.storage.from(CERT_BUCKET).remove(paths);
      if (removeError) console.error('Erro ao remover certificado órfão da loja:', removeError);
    }

    const { error } = await supabase.from('stores').update({ is_active: false }).eq('id', id);
    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message || 'Erro ao excluir loja.' };
  }
};
