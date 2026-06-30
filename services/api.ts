import { supabase } from '../supabaseClient';
import { Store, Table, Product, Category, OrderItem, OrderStatus, TableStatus, CartItem, StoreUser, Order } from '../types';

// --- API FUNCTIONS (PRODUCTION READY) ---

export const authenticateAdmin = async (username: string, password: string): Promise<{ success: boolean; mustChangePass?: boolean; userId?: string }> => {
  const { data, error } = await supabase
    .from('system_admins')
    .select('*')
    .eq('username', username)
    .single();

  if (error || !data) {
    return { success: false };
  }

  // In production, compare hashes here. For MVP, plain text check.
  if (data.password === password) {
    return { success: true, mustChangePass: data.must_change_password, userId: data.id };
  }

  return { success: false };
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

// --- STORE USER AUTHENTICATION (NEW) ---

export const authenticateStoreUser = async (email: string, password: string): Promise<{ success: boolean; user?: StoreUser & { store: Store }; message?: string }> => {
    try {
        const { data, error } = await supabase
            .from('store_users')
            .select('*, store:stores(*)')
            .eq('email', email)
            .single();

        if (error || !data) {
            return { success: false, message: 'Usuário não encontrado.' };
        }

        // MVP: Plain text comparison. Production: Use bcrypt/argon2
        if (data.password !== password) {
            return { success: false, message: 'Senha incorreta.' };
        }

        if (!data.store || !data.store.is_active) {
            return { success: false, message: 'Esta loja está inativa ou bloqueada.' };
        }

        return { success: true, user: data as any };

    } catch (error: any) {
        console.error("Auth Store User Error:", error);
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


// --- STORE TEAM MANAGEMENT (FOR STORE OWNERS) ---

export const fetchStoreTeamMembers = async (storeId: string): Promise<StoreUser[]> => {
    const { data, error } = await supabase
        .from('store_users')
        .select('*')
        .eq('store_id', storeId)
        .order('name');
    
    if (error) {
        console.error('Error fetching store team:', error);
        return [];
    }
    return data || [];
};

export const createStoreTeamMember = async (storeId: string, userData: { name: string, email: string, password?: string, role: string, permissions: any }) => {
    const { data, error } = await supabase
        .from('store_users')
        .insert([{
            store_id: storeId,
            name: userData.name,
            email: userData.email,
            password: userData.password || '123456', // Default password if not provided
            role: userData.role,
            permissions: userData.permissions,
            must_change_password: true
        }])
        .select()
        .single();
    
    if (error) throw error;
    return data;
};

export const updateStoreTeamMember = async (userId: string, userData: { name?: string, email?: string, role?: string, permissions?: any, password?: string }) => {
    const updates: any = { ...userData };
    if (updates.password) {
        updates.must_change_password = true;
    }
    
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
    const { error } = await supabase
        .from('store_users')
        .delete()
        .eq('id', userId);
    
    if (error) throw error;
};

// --- STORE MANAGEMENT API ---

export const fetchAllStores = async (): Promise<Store[]> => {
    const { data, error } = await supabase
        .from('stores')
        .select('*')
        .order('created_at', { ascending: false });
    
    if (error) {
        console.error('Error fetching stores:', error);
        return [];
    }
    return data || [];
};

export const fetchStoreBySlug = async (slug: string): Promise<Store | null> => {
  const { data, error } = await supabase
    .from('stores')
    .select('*')
    .eq('slug', slug)
    .single();
  
  if (error) {
    console.error('Error fetching store:', error);
    return null;
  }
  return data;
};

export const fetchStoreById = async (storeId: string): Promise<Store | null> => {
  const { data, error } = await supabase
    .from('stores')
    .select('*')
    .eq('id', storeId)
    .single();
  
  if (error) {
    console.error('Error fetching store by id:', error);
    return null;
  }
  return data;
};

// --- USER MANAGEMENT API ---

export const createStoreUser = async (storeId: string, name: string, email: string, password: string): Promise<{ success: boolean; message?: string }> => {
    try {
        const { error } = await supabase
            .from('store_users')
            .insert({
                store_id: storeId,
                name,
                email,
                password,
                role: 'owner', // Default role for admin creation
                permissions: { tables: true, counter: true, kitchen: true, menu: true, admin: true },
                must_change_password: true
            });

        if (error) {
            if (error.code === '23505') return { success: false, message: 'Este e-mail já está cadastrado nesta loja.' };
            throw error;
        }
        return { success: true };
    } catch (error: any) {
        console.error("Create User Error:", error);
        return { success: false, message: error.message };
    }
};

export const updateStoreUser = async (userId: string, updates: Partial<StoreUser> & { password?: string }): Promise<{ success: boolean; message?: string }> => {
    try {
        const { error } = await supabase
            .from('store_users')
            .update(updates)
            .eq('id', userId);

        if (error) throw error;
        return { success: true };
    } catch (error: any) {
        console.error("Update User Error:", error);
        return { success: false, message: error.message };
    }
};

export const deleteStoreUser = async (userId: string): Promise<{ success: boolean; message?: string }> => {
    try {
        const { error } = await supabase
            .from('store_users')
            .delete()
            .eq('id', userId);

        if (error) throw error;
        return { success: true };
    } catch (error: any) {
        console.error("Delete User Error:", error);
        return { success: false, message: error.message };
    }
};

export const fetchStoreUsers = async (): Promise<(StoreUser & { store: Store })[]> => {
    const { data, error } = await supabase
        .from('store_users')
        .select('*, store:stores(*)')
        .order('created_at', { ascending: false });
    
    if (error) {
        console.error("Fetch Users Error:", error);
        return [];
    }
    return data as any;
};

// --- MENU & ORDERS API ---

export const fetchMenu = async (storeId: string, onlyAvailable = true): Promise<{ categories: Category[], products: Product[] }> => {
  const categoriesQuery = supabase.from('categories').select('*').eq('store_id', storeId).order('order');
  
  let productsQuery = supabase.from('products').select('*').eq('store_id', storeId).order('order', { ascending: true, nullsFirst: false });
  if (onlyAvailable) {
      productsQuery = productsQuery.eq('available', true);
  }

  const [cats, prods] = await Promise.all([
    categoriesQuery,
    productsQuery
  ]);
  
  if (prods.error && (prods.error.code === '42703' || prods.error.message?.includes('column') || prods.error.message?.includes('does not exist'))) {
      // Fallback without order
      let fallbackQuery = supabase.from('products').select('*').eq('store_id', storeId);
      if (onlyAvailable) {
          fallbackQuery = fallbackQuery.eq('available', true);
      }
      const fallbackProds = await fallbackQuery;
      return {
          categories: cats.data || [],
          products: fallbackProds.data || []
      };
  }

  return { 
    categories: cats.data || [], 
    products: prods.data || [] 
  };
};

// --- MENU CRUD OPERATIONS ---

export const createCategory = async (storeId: string, name: string) => {
    // Get max order to append
    const { data: maxOrderData } = await supabase.from('categories').select('order').eq('store_id', storeId).order('order', { ascending: false }).limit(1);
    const nextOrder = (maxOrderData?.[0]?.order || 0) + 1;

    const { error } = await supabase.from('categories').insert({
        store_id: storeId,
        name,
        order: nextOrder
    });
    if(error) throw error;
};

export const deleteCategory = async (id: string) => {
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if(error) throw error;
};

export const createProduct = async (storeId: string, categoryId: string, product: Partial<Product>) => {
    const { data: maxOrderData, error: maxOrderError } = await supabase.from('products').select('order').eq('category_id', categoryId).order('order', { ascending: false }).limit(1);
    const nextOrder = maxOrderError ? 1 : ((maxOrderData?.[0]?.order || 0) + 1);

    const { error } = await supabase.from('products').insert({
        store_id: storeId,
        category_id: categoryId,
        name: product.name,
        description: product.description,
        price: product.price,
        image_url: product.image_url,
        prep_time_minutes: product.prep_time_minutes || 15,
        available: true,
        order: nextOrder,
        destination: product.destination || 'kitchen'
    });
    
    if(error) {
        if (error.code === '42703' || error.message?.includes('column') || error.message?.includes('does not exist')) {
            // Fallback if 'order' or 'destination' column doesn't exist yet
            const { error: fallbackError } = await supabase.from('products').insert({
                store_id: storeId,
                category_id: categoryId,
                name: product.name,
                description: product.description,
                price: product.price,
                image_url: product.image_url,
                prep_time_minutes: product.prep_time_minutes || 15,
                available: true
            });
            if (fallbackError) throw fallbackError;
            if (product.destination && product.destination !== 'kitchen') {
                 throw new Error("schema cache destination");
            }
            return;
        }
        throw error;
    }
};

export const updateProduct = async (id: string, updates: Partial<Product>) => {
    const { error } = await supabase.from('products').update(updates).eq('id', id);
    if(error) {
        if (error.code === '42703' || error.message?.includes('column') || error.message?.includes('does not exist')) {
            if (updates.destination) {
                 throw new Error("schema cache destination");
            }
        }
        throw error;
    }
};

export const updateCategoryOrder = async (updates: { id: string, order: number }[]) => {
    // Supabase doesn't have a bulk update, so we do it sequentially or via RPC.
    // For simplicity, we do it sequentially.
    for (const update of updates) {
        await supabase.from('categories').update({ order: update.order }).eq('id', update.id);
    }
};

export const updateProductOrder = async (updates: { id: string, order: number }[]) => {
    for (const update of updates) {
        const { error } = await supabase.from('products').update({ order: update.order }).eq('id', update.id);
        if (error) {
            if (error.code === '42703' || error.message?.includes('column') || error.message?.includes('does not exist')) {
                throw new Error("schema cache"); // Trigger the modal
            }
            throw error;
        }
    }
};

export const deleteProduct = async (id: string) => {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if(error) throw error;
};

// --- TABLES & ORDERS ---

export const fetchTables = async (storeId: string): Promise<Table[]> => {
  const { data, error } = await supabase
    .from('tables')
    .select('*')
    .eq('store_id', storeId)
    .order('number');
    
  if (error) console.error(error);
  return data || [];
};

export const fetchActiveOrdersForTables = async (storeId: string): Promise<Order[]> => {
    const { data, error } = await supabase
        .from('orders')
        .select('*, order_items(*, product:products(*))')
        .eq('store_id', storeId)
        .eq('order_type', 'table')
        .neq('status', OrderStatus.DELIVERED) 
        .neq('status', OrderStatus.CANCELED);
        
    if (error) {
        console.error("Fetch Active Table Orders Error", error);
        return [];
    }

    // Filter out items with null products (deleted products)
    const orders = (data as any) || [];
    orders.forEach((order: any) => {
        if (order.order_items) {
            order.order_items = order.order_items.filter((item: any) => item.product);
        }
    });

    return orders;
};

export const fetchTableOrderSummary = async (tableId: string): Promise<{ total: number, items: any[] }> => {
    const { data: orders, error } = await supabase
        .from('orders')
        .select('*, order_items(*, product:products(*))')
        .eq('table_id', tableId)
        .neq('status', OrderStatus.DELIVERED)
        .neq('status', OrderStatus.CANCELED);

    if (error || !orders) return { total: 0, items: [] };

    let total = 0;
    let allItems: any[] = [];

    orders.forEach((order: any) => {
        if (order.order_items) {
            order.order_items.forEach((item: any) => {
                if (item.status !== OrderStatus.CANCELED && item.product) {
                    total += (item.price_at_time * item.quantity);
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
    .select('*, product:products(*), order:orders(*, tables(number))')
    .eq('product.store_id', storeId)
    .neq('status', OrderStatus.DELIVERED)
    .neq('status', OrderStatus.CANCELED)
    .order('created_at', { ascending: true });

   if (error) {
       console.error("Kitchen fetch error:", error);
       return [];
   }

   const filtered = (data as any).filter((item: any) => {
       if (!item.product) return false; // Safety check for deleted products
       if ((item.product.destination || 'kitchen') !== destination) return false;
       if (item.order?.order_type === 'counter' && item.status === 'pending') {
           return false;
       }
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
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Fetch Counter Orders Error", error);
        return [];
    }
    return (data as any) || [];
};

export const fetchSalesHistory = async (storeId: string): Promise<Order[]> => {
    const { data, error } = await supabase
        .from('orders')
        .select('*, order_items(*, product:products(*)), tables(*)')
        .eq('store_id', storeId)
        .eq('status', OrderStatus.DELIVERED)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Fetch Sales History Error", error);
        return [];
    }
    return (data as any) || [];
};

export const clearSalesHistory = async (storeId: string) => {
    const { error } = await supabase
        .from('orders')
        .delete()
        .eq('store_id', storeId);

    if (error) {
        // Fallback if ON DELETE CASCADE is not set
        const { data: orders } = await supabase.from('orders').select('id').eq('store_id', storeId);
        if (orders && orders.length > 0) {
            const orderIds = orders.map(o => o.id);
            const chunkSize = 100;
            for (let i = 0; i < orderIds.length; i += chunkSize) {
                const chunk = orderIds.slice(i, i + chunkSize);
                await supabase.from('order_items').delete().in('order_id', chunk);
            }
            const { error: finalError } = await supabase.from('orders').delete().eq('store_id', storeId);
            if (finalError) throw finalError;
        }
    }
};

export const updateOrderStatus = async (orderId: string, status: OrderStatus) => {
    const { error } = await supabase
        .from('orders')
        .update({ status })
        .eq('id', orderId);
        
    if(error) throw error;
};

export const sendOrderToKitchen = async (orderId: string) => {
    const { error: orderError } = await supabase
        .from('orders')
        .update({ status: OrderStatus.ACCEPTED })
        .eq('id', orderId);
    if(orderError) throw orderError;

    const { error: itemsError } = await supabase
        .from('order_items')
        .update({ status: OrderStatus.ACCEPTED })
        .eq('order_id', orderId);
    if(itemsError) throw itemsError;
};

export const closeCounterOrder = async (orderId: string) => {
    const { error } = await supabase
        .from('orders')
        .update({ status: OrderStatus.DELIVERED, updated_at: new Date().toISOString() })
        .eq('id', orderId);
        
    if(error) {
        if (error.code === '42703' || error.message?.includes('column') || error.message?.includes('does not exist')) {
            throw new Error("schema cache updated_at");
        }
        throw error;
    }
    
    await supabase
        .from('order_items')
        .update({ status: OrderStatus.DELIVERED })
        .eq('order_id', orderId);
};

export const callWaiter = async (tableId: string) => {
    // NEW LOGIC: Just update the table flag, do NOT create an order.
    const { error } = await supabase
        .from('tables')
        .update({ waiter_requested: true })
        .eq('id', tableId);
    
    if (error) {
        console.error("Erro ao chamar garçom (Verifique se a coluna waiter_requested existe no DB):", error);
        throw error;
    }
};

export const dismissWaiterRequest = async (tableId: string) => {
    const { error } = await supabase
        .from('tables')
        .update({ waiter_requested: false })
        .eq('id', tableId);
        
    if (error) throw error;
};

export const toggleTableServiceFee = async (tableId: string, removed: boolean) => {
    const { error } = await supabase
        .from('tables')
        .update({ service_fee_removed: removed })
        .eq('id', tableId);
        
    if (error) {
        if (error.code === '42703' || error.message?.includes('column') || error.message?.includes('does not exist')) {
            throw new Error("schema cache"); // Trigger the modal
        }
        throw error;
    }
};

// Returns orderId if success
export const createOrder = async (
  tableId: string | null, 
  storeId: string, 
  items: CartItem[], 
  customerName?: string
): Promise<{ success: boolean, orderId?: string }> => {
  try {
    let orderId: string;
    const isCounter = tableId === null;

    if (!isCounter) {
        // TABLE LOGIC
        const { data: existingOrders } = await supabase
          .from('orders')
          .select('id')
          .eq('table_id', tableId)
          .eq('status', 'pending')
          .limit(1);

        if (existingOrders && existingOrders.length > 0) {
          orderId = existingOrders[0].id;
        } else {
          const { data: newOrder, error: orderError } = await supabase
            .from('orders')
            .insert({ 
              table_id: tableId, 
              store_id: storeId, 
              status: 'pending', 
              order_type: 'table',
              total: 0,
              customer_name: customerName 
            })
            .select()
            .single();
          
          if (orderError) throw orderError;
          orderId = newOrder.id;
        }
    } else {
        // COUNTER LOGIC
        const { data: newOrder, error: orderError } = await supabase
            .from('orders')
            .insert({ 
              table_id: null, 
              store_id: storeId, 
              status: 'pending', 
              order_type: 'counter',
              total: 0,
              customer_name: customerName 
            })
            .select()
            .single();
          
          if (orderError) throw orderError;
          orderId = newOrder.id;
    }

    const orderItemsData = items.map(item => ({
      order_id: orderId,
      product_id: item.product.id,
      quantity: item.quantity,
      status: OrderStatus.PENDING,
      price_at_time: item.product.price,
      notes: item.notes ? `${customerName ? `[${customerName}] ` : ''}${item.notes}` : (customerName ? `[${customerName}]` : '')
    }));

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItemsData);

    if (itemsError) throw itemsError;
    return { success: true, orderId };

  } catch (error) {
    console.error("Create Order Error", error);
    throw error;
  }
};

// NEW: Fetch specific order for Tracking
export const fetchOrderById = async (orderId: string): Promise<Order | null> => {
    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single();
    
    if (error) return null;
    return data;
};

export const updateOrderItemStatus = async (itemId: string, status: OrderStatus) => {
    await supabase
        .from('order_items')
        .update({ status })
        .eq('id', itemId);
};

export const cancelSpecificOrderItem = async (itemId: string) => {
    await supabase
        .from('order_items')
        .update({ status: OrderStatus.CANCELED })
        .eq('id', itemId);
};

export const updateTableStatus = async (tableId: string, status: TableStatus, hostName?: string) => {
    const updateData: any = { status };
    if (hostName !== undefined) {
        updateData.current_host_name = hostName;
    }
    
    await supabase
        .from('tables')
        .update(updateData)
        .eq('id', tableId);
};

export const requestTableBill = async (tableId: string) => {
    await supabase
        .from('tables')
        .update({ status: TableStatus.WAITING_BILL })
        .eq('id', tableId);
};

export const cancelPendingTableItems = async (tableId: string) => {
    const { data: orders } = await supabase
        .from('orders')
        .select('id')
        .eq('table_id', tableId)
        .neq('status', OrderStatus.DELIVERED);

    if (!orders || orders.length === 0) return;
    const orderIds = orders.map(o => o.id);

    await supabase
        .from('order_items')
        .update({ status: OrderStatus.CANCELED })
        .in('order_id', orderIds)
        .in('status', [OrderStatus.PENDING, OrderStatus.ACCEPTED]);
};

export const closeTableSession = async (tableId: string, paymentData?: { total: number, methods: { method: string, amount: number }[] }): Promise<{ success: boolean, message?: string }> => {
    let warningMessage = "";
    try {
        console.log("Iniciando fechamento da mesa:", tableId);
        
        // 1. Busca Pedidos Abertos
        const { data: orders } = await supabase
            .from('orders')
            .select('id')
            .eq('table_id', tableId)
            .neq('status', OrderStatus.DELIVERED)
            .neq('status', OrderStatus.CANCELED);

        if (orders && orders.length > 0) {
            const orderIds = orders.map(o => o.id);
            
            // Prepare update data
            const updatePayload: any = { status: OrderStatus.DELIVERED };
            
            if (paymentData) {
                // We store the primary method as a string for easy querying
                // If multiple methods, we store 'MULTIPLE' or the first one
                const primaryMethod = paymentData.methods.length === 1 ? paymentData.methods[0].method : 'MULTIPLE';
                updatePayload.payment_method = primaryMethod;
                updatePayload.payment_details = paymentData; // Store full breakdown as JSON
            }
            updatePayload.updated_at = new Date().toISOString();

            // 2. Fecha Pedidos
            const { error: orderErr } = await supabase
                .from('orders')
                .update(updatePayload)
                .in('id', orderIds);
            
            if(orderErr) {
                console.error("Erro fechando pedidos (tentativa 1):", orderErr);
                
                // Fallback: Try updating without payment columns if the error is likely due to missing columns
                // Postgres error 42703: undefined_column
                if (orderErr.code === '42703' || orderErr.message?.includes('column') || orderErr.message?.includes('does not exist')) {
                     if (orderErr.message?.includes('updated_at')) {
                         throw new Error("schema cache updated_at");
                     }
                     console.warn("Tentando fallback sem colunas de pagamento...");
                     const fallbackPayload = { status: OrderStatus.DELIVERED };
                     const { error: fallbackErr } = await supabase
                        .from('orders')
                        .update(fallbackPayload)
                        .in('id', orderIds);
                    
                    if (fallbackErr) {
                         console.error("Erro fechando pedidos (fallback):", fallbackErr);
                         throw new Error("Falha ao fechar pedidos (Erro de Banco de Dados: " + fallbackErr.message + ")");
                    } else {
                        // Success on fallback
                        // We continue to close items and table, but return a warning message at the end
                        console.log("Fallback bem sucedido. Pagamento não salvo.");
                        warningMessage = "Aviso: Detalhes do pagamento não foram salvos (Colunas ausentes no Banco de Dados).";
                    }
                } else {
                    throw new Error("Falha ao fechar pedidos da mesa: " + orderErr.message);
                }
            }

            // 3. Fecha Itens (que não foram cancelados)
            const { error: itemsErr } = await supabase
                .from('order_items')
                .update({ status: OrderStatus.DELIVERED })
                .in('order_id', orderIds)
                .neq('status', OrderStatus.CANCELED);
                
            if(itemsErr) {
                console.error("Erro fechando itens:", itemsErr);
                throw new Error("Falha ao atualizar itens.");
            }
        }

        const newPin = Math.floor(1000 + Math.random() * 9000).toString();
        
        // 4. Libera Mesa (Tenta setar host como null)
        const { error: tableErr } = await supabase
            .from('tables')
            .update({ 
                status: TableStatus.AVAILABLE,
                current_host_name: null, // Pode falhar se o DB não aceitar null
                pin: newPin,
                waiter_requested: false, // Pode falhar se coluna não existir
                service_fee_removed: false
            })
            .eq('id', tableId);

        if (tableErr) {
            console.error("Erro liberando mesa:", tableErr);
            // Fallback se as colunas novas não existirem
            if (tableErr.code === '42703' || tableErr.message?.includes('column') || tableErr.message?.includes('does not exist') || tableErr.message?.includes('waiter_requested') || tableErr.message?.includes('service_fee_removed')) {
                console.warn("Tentando fallback para liberar mesa sem colunas novas...");
                const { error: fallbackTableErr } = await supabase
                    .from('tables')
                    .update({ 
                        status: TableStatus.AVAILABLE,
                        current_host_name: null,
                        pin: newPin
                    })
                    .eq('id', tableId);
                
                if (fallbackTableErr) {
                    console.error("Erro liberando mesa (fallback):", fallbackTableErr);
                    return { success: false, message: fallbackTableErr.message };
                }
                // Fallback succeeded, no need to warn the user as it works.
            } else {
                return { success: false, message: tableErr.message };
            }
        }

        return { success: true, message: warningMessage };
    } catch (e: any) {
        console.error("Exceção ao fechar mesa:", e);
        return { success: false, message: e.message || 'Erro desconhecido.' };
    }
};

export const toggleTableBlock = async (tableId: string, currentStatus: TableStatus) => {
    const newStatus = currentStatus === TableStatus.BLOCKED ? TableStatus.AVAILABLE : TableStatus.BLOCKED;
    await supabase
        .from('tables')
        .update({ status: newStatus })
        .eq('id', tableId);
};

export const moveTable = async (sourceTableId: string, targetTableId: string): Promise<{ success: boolean, message?: string }> => {
    try {
        // 1. Verify target table is available
        const { data: targetTable, error: targetErr } = await supabase
            .from('tables')
            .select('status')
            .eq('id', targetTableId)
            .single();

        if (targetErr || !targetTable) {
            return { success: false, message: 'Mesa de destino não encontrada.' };
        }

        if (targetTable.status !== TableStatus.AVAILABLE) {
            return { success: false, message: 'Mesa de destino não está disponível.' };
        }

        // 2. Get source table details
        const { data: sourceTable, error: sourceErr } = await supabase
            .from('tables')
            .select('*')
            .eq('id', sourceTableId)
            .single();

        if (sourceErr || !sourceTable) {
            return { success: false, message: 'Mesa de origem não encontrada.' };
        }

        // 3. Move Orders
        const { error: moveErr } = await supabase
            .from('orders')
            .update({ table_id: targetTableId })
            .eq('table_id', sourceTableId)
            .neq('status', OrderStatus.DELIVERED)
            .neq('status', OrderStatus.CANCELED);

        if (moveErr) {
            console.error("Erro movendo pedidos:", moveErr);
            return { success: false, message: 'Falha ao mover pedidos.' };
        }

        // 4. Update Target Table Status
        const { error: updateTargetErr } = await supabase
            .from('tables')
            .update({
                status: sourceTable.status,
                current_host_name: sourceTable.current_host_name,
                waiter_requested: sourceTable.waiter_requested,
                guest_count: sourceTable.guest_count
            })
            .eq('id', targetTableId);

        if (updateTargetErr) {
            console.error("Erro atualizando mesa destino:", updateTargetErr);
            return { success: false, message: 'Falha ao atualizar mesa de destino.' };
        }

        // 5. Reset Source Table
        const newPin = Math.floor(1000 + Math.random() * 9000).toString();
        const { error: resetSourceErr } = await supabase
            .from('tables')
            .update({
                status: TableStatus.AVAILABLE,
                current_host_name: null,
                waiter_requested: false,
                guest_count: 0,
                pin: newPin
            })
            .eq('id', sourceTableId);

        if (resetSourceErr) {
            console.error("Erro resetando mesa origem:", resetSourceErr);
            // Non-critical, but good to log
        }

        return { success: true };

    } catch (e: any) {
        console.error("Exceção ao mover mesa:", e);
        return { success: false, message: e.message || 'Erro desconhecido.' };
    }
};

// ... Rest of storage/store functions (unchanged)
const CLOUDINARY_URL = "https://api.cloudinary.com/v1_1/dmxucnk9a/image/upload";
const UPLOAD_PRESET = "menu_img";

// Helper function to handle Cloudinary upload
const uploadToCloudinary = async (file: File): Promise<string> => {
    console.log("Iniciando upload para Cloudinary...", file.name);
    
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", UPLOAD_PRESET);
    // Remove "folder" or other parameters that might require signature if your preset is strictly Unsigned

    try {
        const response = await fetch(CLOUDINARY_URL, {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("Cloudinary Error Detail:", errorData);
            throw new Error(`Erro no upload: ${errorData.error?.message || 'Falha desconhecida'}`);
        }

        const data = await response.json();
        console.log("Upload com sucesso! URL:", data.secure_url);
        return data.secure_url;
    } catch (e) {
        console.error("Erro fatal no upload:", e);
        throw e;
    }
};

export const uploadStoreLogo = async (file: File): Promise<string> => {
    return uploadToCloudinary(file);
};

export const uploadProductImage = async (file: File): Promise<string> => {
    return uploadToCloudinary(file);
};

// --- CREATE / UPDATE / DELETE STORE FUNCTIONS ---
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
        // 1. Create the store
        const { data: storeData, error: storeError } = await supabase
            .from('stores')
            .insert({
                name: params.name,
                cnpj: params.cnpj,
                slug: params.slug,
                contract_type: params.contractType,
                contract_period_months: params.periodMonths,
                is_active: params.isActive,
                logo_url: params.logoUrl || null,
                config: {
                    use_pin: true,
                    allow_client_open: true
                }
            })
            .select()
            .single();

        if (storeError) {
            if (storeError.code === '23505') {
                return { success: false, message: 'Este slug (URL) já está em uso.' };
            }
            throw storeError;
        }

        // 2. Generate Tables if necessary
        if (params.contractType === 'balcao_mesas' && params.tableCount > 0) {
            const tablesToInsert = [];
            for (let i = 1; i <= params.tableCount; i++) {
                const simplePin = Math.floor(1000 + Math.random() * 9000).toString();
                tablesToInsert.push({
                    store_id: storeData.id,
                    number: i,
                    pin: simplePin,
                    status: TableStatus.AVAILABLE
                });
            }

            const { error: tablesError } = await supabase
                .from('tables')
                .insert(tablesToInsert);
                
            if (tablesError) console.error("Error creating tables:", tablesError);
        }

        return { success: true };

    } catch (error: any) {
        console.error("Create Store Error:", error);
        return { success: false, message: error.message || 'Erro desconhecido ao criar loja.' };
    }
};

export const duplicateStore = async (storeId: string): Promise<{ success: boolean; message?: string }> => {
    try {
        // 1. Fetch original store
        const { data: originalStore, error: fetchError } = await supabase
            .from('stores')
            .select('*')
            .eq('id', storeId)
            .single();

        if (fetchError || !originalStore) {
            throw new Error('Loja original não encontrada.');
        }

        // 2. Generate new unique slug
        const newName = `${originalStore.name} (1)`;
        let newSlug = `${originalStore.slug}-1`;
        
        // Check if slug exists, if so, append random string
        const { data: existingSlug } = await supabase.from('stores').select('id').eq('slug', newSlug).maybeSingle();
        if (existingSlug) {
            newSlug = `${newSlug}-${Math.random().toString(36).substring(2, 7)}`;
        }

        // 3. Create new store
        const { data: newStore, error: createError } = await supabase
            .from('stores')
            .insert({
                name: newName,
                cnpj: originalStore.cnpj,
                slug: newSlug,
                contract_type: originalStore.contract_type,
                contract_period_months: originalStore.contract_period_months,
                is_active: originalStore.is_active,
                logo_url: originalStore.logo_url,
                config: originalStore.config
            })
            .select()
            .single();

        if (createError) throw createError;

        // 4. Copy Categories
        const { data: categories, error: catError } = await supabase
            .from('categories')
            .select('*')
            .eq('store_id', storeId);

        if (catError) throw catError;

        const categoryMap: { [oldId: string]: string } = {}; // Maps old category ID to new category ID

        if (categories && categories.length > 0) {
            for (const cat of categories) {
                const { data: newCat, error: newCatError } = await supabase
                    .from('categories')
                    .insert({
                        store_id: newStore.id,
                        name: cat.name,
                        order: cat.order
                    })
                    .select()
                    .single();

                if (newCatError) throw newCatError;
                categoryMap[cat.id] = newCat.id;
            }
        }

        // 5. Copy Products
        const { data: products, error: prodError } = await supabase
            .from('products')
            .select('*')
            .eq('store_id', storeId);

        if (prodError) throw prodError;

        if (products && products.length > 0) {
            const productsToInsert = products.map(prod => ({
                store_id: newStore.id,
                category_id: prod.category_id ? categoryMap[prod.category_id] : null,
                name: prod.name,
                description: prod.description,
                price: prod.price,
                image_url: prod.image_url,
                available: prod.available,
                prep_time_minutes: prod.prep_time_minutes
            }));

            const { error: insertProdError } = await supabase
                .from('products')
                .insert(productsToInsert);

            if (insertProdError) throw insertProdError;
        }

        // 6. Copy Tables (if applicable)
        const { data: tables, error: tablesError } = await supabase
            .from('tables')
            .select('*')
            .eq('store_id', storeId);

        if (!tablesError && tables && tables.length > 0) {
            const tablesToInsert = tables.map(t => ({
                store_id: newStore.id,
                number: t.number,
                pin: Math.floor(1000 + Math.random() * 9000).toString(),
                status: TableStatus.AVAILABLE
            }));

            await supabase.from('tables').insert(tablesToInsert);
        }

        return { success: true };
    } catch (error: any) {
        console.error("Duplicate Store Error:", error);
        return { success: false, message: error.message || 'Erro desconhecido ao duplicar loja.' };
    }
};

export const updateStore = async (id: string, params: CreateStoreParams): Promise<{ success: boolean; message?: string }> => {
    try {
        // 1. Update store basic info
        const { error } = await supabase
            .from('stores')
            .update({
                name: params.name,
                cnpj: params.cnpj,
                slug: params.slug,
                contract_type: params.contractType,
                contract_period_months: params.periodMonths,
                is_active: params.isActive,
                logo_url: params.logoUrl
            })
            .eq('id', id);

        if (error) {
            if (error.code === '23505') {
                return { success: false, message: 'Este slug (URL) já está em uso por outra loja.' };
            }
            throw error;
        }

        // 2. Sync Tables if contract type includes tables
        if (params.contractType === 'balcao_mesas') {
            const { data: currentTables, error: fetchError } = await supabase
                .from('tables')
                .select('*')
                .eq('store_id', id)
                .order('number', { ascending: true });

            if (fetchError) throw fetchError;

            const currentCount = currentTables?.length || 0;
            const targetCount = params.tableCount;

            if (targetCount > currentCount) {
                // Add new tables
                const tablesToInsert = [];
                for (let i = currentCount + 1; i <= targetCount; i++) {
                    const simplePin = Math.floor(1000 + Math.random() * 9000).toString();
                    tablesToInsert.push({
                        store_id: id,
                        number: i,
                        pin: simplePin,
                        status: TableStatus.AVAILABLE
                    });
                }
                const { error: insertError } = await supabase.from('tables').insert(tablesToInsert);
                if (insertError) console.error("Error adding tables:", insertError);
            } else if (targetCount < currentCount) {
                // Remove extra tables (highest numbers first)
                const tablesToDelete = currentTables.slice(targetCount).map(t => t.id);
                if (tablesToDelete.length > 0) {
                    const { error: deleteError } = await supabase
                        .from('tables')
                        .delete()
                        .in('id', tablesToDelete);
                    if (deleteError) console.error("Error removing tables:", deleteError);
                }
            }
        } else {
            // If switched to 'balcao' only, we might want to keep or hide tables.
            // For now, let's keep them but they won't be used in the client view if contract_type is 'balcao'.
        }

        return { success: true };
    } catch (error: any) {
        console.error("Update Store Error:", error);
        return { success: false, message: error.message };
    }
};

export const deleteStore = async (id: string): Promise<{ success: boolean; message?: string }> => {
    try {
        console.log("Iniciando exclusão completa da loja:", id);

        // 1. ETAPA CRÍTICA: Limpar Itens de Pedido (Order Items)
        // Precisamos garantir que não sobre nenhum item referenciando produtos desta loja.
        
        // A. Limpar via Pedidos (Orders)
        const { data: orders } = await supabase.from('orders').select('id').eq('store_id', id);
        const orderIds = orders?.map(o => o.id) || [];
        
        if (orderIds.length > 0) {
             // Batch delete to avoid URL length issues
             const batchSize = 20;
             for (let i = 0; i < orderIds.length; i += batchSize) {
                 const batch = orderIds.slice(i, i + batchSize);
                 const { error } = await supabase.from('order_items').delete().in('order_id', batch);
                 if (error) console.error("Erro limpando itens por pedido:", error);
             }
        }

        // B. Limpar via Produtos (Products) - Segunda varredura para garantir
        const { data: products } = await supabase.from('products').select('id').eq('store_id', id);
        const productIds = products?.map(p => p.id) || [];

        if (productIds.length > 0) {
             const batchSize = 20;
             for (let i = 0; i < productIds.length; i += batchSize) {
                 const batch = productIds.slice(i, i + batchSize);
                 const { error } = await supabase.from('order_items').delete().in('product_id', batch);
                 if (error) console.error("Erro limpando itens por produto:", error);
             }
        }

        // 2. Excluir Pedidos (Agora seguro pois itens foram removidos)
        await supabase.from('orders').delete().eq('store_id', id);

        // 3. Excluir Produtos (Agora seguro pois itens foram removidos)
        await supabase.from('products').delete().eq('store_id', id);

        // 4. Limpar Categorias, Mesas e Usuários
        await supabase.from('categories').delete().eq('store_id', id);
        await supabase.from('tables').delete().eq('store_id', id);
        await supabase.from('store_users').delete().eq('store_id', id);

        // 5. Finalmente, excluir a Loja
        const { error } = await supabase.from('stores').delete().eq('id', id);

        if (error) throw error;
        return { success: true };
    } catch (error: any) {
        console.error("Delete Store Error:", error);
        return { success: false, message: error.message || 'Erro ao excluir loja.' };
    }
};