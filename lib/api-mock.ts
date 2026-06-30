// API mock completa — banco em memória, sem Supabase
import { Store, Table, Product, Category, OrderItem, OrderStatus, TableStatus, StoreUser, Order } from '@/types';

// ─── ESTADO INICIAL ────────────────────────────────────────────────────────

const STORE: Store = {
  id: 'mock-store-1',
  name: 'Bistrô Demo',
  slug: 'bistro',
  logo_url: null,
  cnpj: '00.000.000/0001-00',
  is_active: true,
  contract_type: 'balcao_mesas',
  contract_period_months: 12,
  activation_date: '2024-01-01',
  config: { use_pin: false, allow_client_open: true, require_pin_for_open: false, charge_service_fee: true },
};

const STORE2: Store = {
  id: 'mock-store-2',
  name: 'Pizzaria Napoli',
  slug: 'napoli',
  logo_url: null,
  cnpj: '11.111.111/0001-11',
  is_active: true,
  contract_type: 'balcao_mesas',
  contract_period_months: 6,
  activation_date: '2024-03-01',
  config: { use_pin: false, allow_client_open: true, require_pin_for_open: false, charge_service_fee: false },
};

const ADMIN_DB = { id: 'adm-1', username: 'admin', password: 'admin123', must_change_password: false };

let storeUsers: (StoreUser & { password: string; store: Store })[] = [
  {
    id: 'su-1', store_id: 'mock-store-1', name: 'Demo Gerente', email: 'demo@bistro.com', password: 'demo123',
    role: 'owner', must_change_password: false,
    permissions: { tables: true, counter: true, kitchen: true, bar: true, menu: true, admin: true },
    store: STORE,
  },
  {
    id: 'su-2', store_id: 'mock-store-1', name: 'Ana Cozinha', email: 'cozinha@bistro.com', password: 'coz123',
    role: 'kitchen', must_change_password: false,
    permissions: { tables: false, counter: false, kitchen: true, bar: false, menu: false, admin: false },
    store: STORE,
  },
  {
    id: 'su-3', store_id: 'mock-store-2', name: 'Carlos Napoli', email: 'carlos@napoli.com', password: 'napoli123',
    role: 'owner', must_change_password: false,
    permissions: { tables: true, counter: true, kitchen: true, bar: true, menu: true, admin: true },
    store: STORE2,
  },
];

let stores: Store[] = [STORE, STORE2];

let tables: Table[] = [
  { id: 't1', store_id: 'mock-store-1', number: 1, pin: '1111', status: TableStatus.AVAILABLE, guest_count: 0 },
  { id: 't2', store_id: 'mock-store-1', number: 2, pin: '2222', status: TableStatus.OCCUPIED, current_host_name: 'João', guest_count: 3 },
  { id: 't3', store_id: 'mock-store-1', number: 3, pin: '3333', status: TableStatus.OCCUPIED, current_host_name: 'Maria', guest_count: 2 },
  { id: 't4', store_id: 'mock-store-1', number: 4, pin: '4444', status: TableStatus.WAITING_BILL, current_host_name: 'Pedro', guest_count: 4, waiter_requested: false },
  { id: 't5', store_id: 'mock-store-1', number: 5, pin: '5555', status: TableStatus.AVAILABLE, guest_count: 0 },
  { id: 't6', store_id: 'mock-store-1', number: 6, pin: '6666', status: TableStatus.AVAILABLE, guest_count: 0 },
  { id: 't7', store_id: 'mock-store-1', number: 7, pin: '7777', status: TableStatus.BLOCKED, guest_count: 0 },
  { id: 't8', store_id: 'mock-store-1', number: 8, pin: '8888', status: TableStatus.AVAILABLE, guest_count: 0 },
];

let categories: Category[] = [
  { id: 'cat-1', store_id: 'mock-store-1', name: 'Entradas', order: 0 },
  { id: 'cat-2', store_id: 'mock-store-1', name: 'Pratos Principais', order: 1 },
  { id: 'cat-3', store_id: 'mock-store-1', name: 'Bebidas', order: 2 },
  { id: 'cat-4', store_id: 'mock-store-1', name: 'Sobremesas', order: 3 },
];

let products: Product[] = [
  { id: 'p1', category_id: 'cat-1', store_id: 'mock-store-1', name: 'Bruschetta', description: 'Pão torrado com tomate e manjericão', price: 18, image_url: null, available: true, prep_time_minutes: 10, order: 1, destination: 'kitchen' },
  { id: 'p2', category_id: 'cat-1', store_id: 'mock-store-1', name: 'Carpaccio', description: 'Carne fatiada com alcaparras e parmesão', price: 32, image_url: null, available: true, prep_time_minutes: 8, order: 2, destination: 'kitchen' },
  { id: 'p3', category_id: 'cat-2', store_id: 'mock-store-1', name: 'Risoto de Funghi', description: 'Arroz arbóreo cremoso com cogumelos frescos', price: 58, image_url: null, available: true, prep_time_minutes: 25, order: 1, destination: 'kitchen' },
  { id: 'p4', category_id: 'cat-2', store_id: 'mock-store-1', name: 'Filé ao Molho Madeira', description: 'Filé mignon grelhado com arroz e batata', price: 72, image_url: null, available: true, prep_time_minutes: 20, order: 2, destination: 'kitchen' },
  { id: 'p5', category_id: 'cat-2', store_id: 'mock-store-1', name: 'Salmão Grelhado', description: 'Salmão com legumes salteados na manteiga', price: 65, image_url: null, available: true, prep_time_minutes: 18, order: 3, destination: 'kitchen' },
  { id: 'p6', category_id: 'cat-3', store_id: 'mock-store-1', name: 'Água Mineral 500ml', description: 'Com ou sem gás', price: 6, image_url: null, available: true, prep_time_minutes: 1, order: 1, destination: 'bar' },
  { id: 'p7', category_id: 'cat-3', store_id: 'mock-store-1', name: 'Suco de Laranja', description: 'Natural, 300ml', price: 12, image_url: null, available: true, prep_time_minutes: 5, order: 2, destination: 'bar' },
  { id: 'p8', category_id: 'cat-3', store_id: 'mock-store-1', name: 'Caipirinha', description: 'Limão, cachaça artesanal e gelo', price: 22, image_url: null, available: true, prep_time_minutes: 5, order: 3, destination: 'bar' },
  { id: 'p9', category_id: 'cat-3', store_id: 'mock-store-1', name: 'Vinho Tinto Taça', description: 'Malbec argentino, 150ml', price: 28, image_url: null, available: true, prep_time_minutes: 2, order: 4, destination: 'bar' },
  { id: 'p10', category_id: 'cat-4', store_id: 'mock-store-1', name: 'Petit Gâteau', description: 'Bolinho quente com sorvete de baunilha', price: 24, image_url: null, available: true, prep_time_minutes: 12, order: 1, destination: 'kitchen' },
  { id: 'p11', category_id: 'cat-4', store_id: 'mock-store-1', name: 'Tiramisù', description: 'Clássico italiano com mascarpone e café', price: 22, image_url: null, available: true, prep_time_minutes: 5, order: 2, destination: 'kitchen' },
];

const now = () => new Date().toISOString();
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

let orders: Order[] = [
  { id: 'ord-1', table_id: 't2', store_id: 'mock-store-1', status: OrderStatus.ACCEPTED, order_type: 'table', total: 108, created_at: ago(30), customer_name: 'João' },
  { id: 'ord-2', table_id: 't3', store_id: 'mock-store-1', status: OrderStatus.ACCEPTED, order_type: 'table', total: 58, created_at: ago(15), customer_name: 'Maria' },
  { id: 'ord-3', table_id: 't4', store_id: 'mock-store-1', status: OrderStatus.DELIVERED, order_type: 'table', total: 226, created_at: ago(60), customer_name: 'Pedro' },
];

let orderItems: OrderItem[] = [
  { id: 'oi-1', order_id: 'ord-1', product_id: 'p1', product: products[0], quantity: 2, status: OrderStatus.DELIVERED, created_at: ago(29), price_at_time: 18 },
  { id: 'oi-2', order_id: 'ord-1', product_id: 'p3', product: products[2], quantity: 1, status: OrderStatus.PREPARING, created_at: ago(28), price_at_time: 58 },
  { id: 'oi-3', order_id: 'ord-1', product_id: 'p7', product: products[6], quantity: 2, status: OrderStatus.READY, created_at: ago(28), price_at_time: 12 },
  { id: 'oi-4', order_id: 'ord-2', product_id: 'p3', product: products[2], quantity: 1, status: OrderStatus.PENDING, created_at: ago(14), price_at_time: 58 },
  { id: 'oi-5', order_id: 'ord-3', product_id: 'p4', product: products[3], quantity: 2, status: OrderStatus.DELIVERED, created_at: ago(59), price_at_time: 72 },
  { id: 'oi-6', order_id: 'ord-3', product_id: 'p9', product: products[8], quantity: 3, status: OrderStatus.DELIVERED, created_at: ago(59), price_at_time: 28 },
  { id: 'oi-7', order_id: 'ord-3', product_id: 'p10', product: products[9], quantity: 2, status: OrderStatus.DELIVERED, created_at: ago(55), price_at_time: 24 },
];

let idSeq = 200;
const uid = () => `mock-${++idSeq}`;
const delay = () => new Promise(r => setTimeout(r, 120));

// ─── FUNÇÕES EXPORTADAS ────────────────────────────────────────────────────

export const authenticateAdmin = async (username: string, password: string) => {
  await delay();
  if (username === ADMIN_DB.username && password === ADMIN_DB.password)
    return { success: true, mustChangePass: false, userId: ADMIN_DB.id };
  return { success: false };
};

export const updateAdminPassword = async (_userId: string, _newPassword: string) => { await delay(); };

export const authenticateStoreUser = async (email: string, password: string) => {
  await delay();
  const user = storeUsers.find(u => u.email === email);
  if (!user) return { success: false, message: 'Usuário não encontrado.' };
  if (user.password !== password) return { success: false, message: 'Senha incorreta.' };
  return { success: true, user };
};

export const updateStoreUserPassword = async (userId: string, newPassword: string) => {
  await delay();
  const u = storeUsers.find(s => s.id === userId);
  if (u) { u.password = newPassword; u.must_change_password = false; }
};

export const fetchStoreTeamMembers = async (storeId: string): Promise<StoreUser[]> => {
  await delay();
  return storeUsers.filter(u => u.store_id === storeId);
};

export const createStoreTeamMember = async (storeId: string, userData: any) => {
  await delay();
  const store = stores.find(s => s.id === storeId)!;
  const u = { id: uid(), store_id: storeId, ...userData, password: userData.password || '123456', must_change_password: true, store };
  storeUsers.push(u);
  return u;
};

export const updateStoreTeamMember = async (userId: string, userData: any) => {
  await delay();
  const u = storeUsers.find(s => s.id === userId);
  if (u) Object.assign(u, userData);
  return u;
};

export const deleteStoreTeamMember = async (userId: string) => {
  await delay();
  storeUsers = storeUsers.filter(u => u.id !== userId);
};

export const fetchAllStores = async (): Promise<Store[]> => { await delay(); return stores; };

export const fetchStoreBySlug = async (slug: string): Promise<Store | null> => {
  await delay();
  return stores.find(s => s.slug === slug) || null;
};

export const fetchStoreById = async (storeId: string): Promise<Store | null> => {
  await delay();
  return stores.find(s => s.id === storeId) || null;
};

export const createStoreUser = async (storeId: string, name: string, email: string, password: string) => {
  await delay();
  const store = stores.find(s => s.id === storeId)!;
  storeUsers.push({ id: uid(), store_id: storeId, name, email, password, role: 'owner', must_change_password: true, permissions: { tables: true, counter: true, kitchen: true, bar: true, menu: true, admin: true }, store });
  return { success: true };
};

export const updateStoreUser = async (userId: string, updates: any) => {
  await delay();
  const u = storeUsers.find(s => s.id === userId);
  if (u) Object.assign(u, updates);
  return { success: true };
};

export const deleteStoreUser = async (userId: string) => {
  await delay();
  storeUsers = storeUsers.filter(u => u.id !== userId);
  return { success: true };
};

export const fetchStoreUsers = async () => { await delay(); return storeUsers; };

export const fetchMenu = async (storeId: string, onlyAvailable = true) => {
  await delay();
  const cats = categories.filter(c => c.store_id === storeId).sort((a, b) => a.order - b.order);
  let prods = products.filter(p => p.store_id === storeId);
  if (onlyAvailable) prods = prods.filter(p => p.available);
  return { categories: cats, products: prods };
};

export const createCategory = async (storeId: string, name: string) => {
  await delay();
  const maxOrder = Math.max(0, ...categories.filter(c => c.store_id === storeId).map(c => c.order));
  categories.push({ id: uid(), store_id: storeId, name, order: maxOrder + 1 });
};

export const deleteCategory = async (id: string) => {
  await delay();
  categories = categories.filter(c => c.id !== id);
  products = products.filter(p => p.category_id !== id);
};

export const createProduct = async (storeId: string, categoryId: string, product: Partial<Product>) => {
  await delay();
  const maxOrder = Math.max(0, ...products.filter(p => p.category_id === categoryId).map(p => p.order || 0));
  products.push({
    id: uid(), store_id: storeId, category_id: categoryId,
    name: product.name || '', description: product.description || '',
    price: product.price || 0, image_url: product.image_url || null,
    available: true, prep_time_minutes: product.prep_time_minutes || 15,
    order: maxOrder + 1, destination: product.destination || 'kitchen',
  });
};

export const updateProduct = async (id: string, updates: Partial<Product>) => {
  await delay();
  const p = products.find(p => p.id === id);
  if (p) Object.assign(p, updates);
};

export const updateCategoryOrder = async (updates: { id: string; order: number }[]) => {
  await delay();
  updates.forEach(u => { const c = categories.find(c => c.id === u.id); if (c) c.order = u.order; });
};

export const updateProductOrder = async (updates: { id: string; order: number }[]) => {
  await delay();
  updates.forEach(u => { const p = products.find(p => p.id === u.id); if (p) p.order = u.order; });
};

export const deleteProduct = async (id: string) => {
  await delay();
  products = products.filter(p => p.id !== id);
};

export const fetchTables = async (storeId: string): Promise<Table[]> => {
  await delay();
  return tables.filter(t => t.store_id === storeId).sort((a, b) => a.number - b.number);
};

export const fetchActiveOrdersForTables = async (storeId: string): Promise<Order[]> => {
  await delay();
  const active: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.DELIVERED];
  const storeOrders = orders.filter(o => o.store_id === storeId && o.order_type === 'table' && active.includes(o.status));
  return storeOrders.map(o => ({
    ...o,
    tables: tables.find(t => t.id === o.table_id),
    order_items: orderItems.filter(i => i.order_id === o.id),
  }));
};

export const fetchTableOrderSummary = async (tableId: string) => {
  await delay();
  const tableOrders = orders.filter(o => o.table_id === tableId && o.status !== OrderStatus.CANCELED);
  const items = tableOrders.flatMap(o => orderItems.filter(i => i.order_id === o.id && i.status !== OrderStatus.CANCELED));
  const total = items.reduce((sum, i) => sum + i.price_at_time * i.quantity, 0);
  return { total, items };
};

export const fetchKitchenOrders = async (storeId: string, destination: 'kitchen' | 'bar' = 'kitchen'): Promise<OrderItem[]> => {
  await delay();
  const activeOrders = orders.filter(o => o.store_id === storeId && [OrderStatus.ACCEPTED, OrderStatus.PREPARING].includes(o.status));
  const activeIds = activeOrders.map(o => o.id);
  return orderItems.filter(i =>
    activeIds.includes(i.order_id) &&
    [OrderStatus.PENDING, OrderStatus.ACCEPTED, OrderStatus.PREPARING].includes(i.status) &&
    i.product.destination === destination
  ).map(i => ({
    ...i,
    order: orders.find(o => o.id === i.order_id),
  }));
};

export const fetchCounterOrders = async (storeId: string): Promise<Order[]> => {
  await delay();
  return orders.filter(o => o.store_id === storeId && o.order_type === 'counter' && o.status !== OrderStatus.CANCELED)
    .map(o => ({ ...o, order_items: orderItems.filter(i => i.order_id === o.id) }));
};

export const fetchSalesHistory = async (storeId: string): Promise<Order[]> => {
  await delay();
  return orders.filter(o => o.store_id === storeId)
    .map(o => ({ ...o, order_items: orderItems.filter(i => i.order_id === o.id), tables: tables.find(t => t.id === o.table_id) }));
};

export const clearSalesHistory = async (storeId: string) => {
  await delay();
  orders = orders.filter(o => o.store_id !== storeId);
  orderItems = orderItems.filter(i => !orders.some(o => o.id === i.order_id));
};

export const updateOrderStatus = async (orderId: string, status: OrderStatus) => {
  await delay();
  const o = orders.find(o => o.id === orderId);
  if (o) o.status = status;
};

export const sendOrderToKitchen = async (orderId: string) => {
  await delay();
  const o = orders.find(o => o.id === orderId);
  if (o) o.status = OrderStatus.ACCEPTED;
  orderItems.filter(i => i.order_id === orderId && i.status === OrderStatus.PENDING)
    .forEach(i => i.status = OrderStatus.ACCEPTED);
};

export const closeCounterOrder = async (orderId: string) => {
  await delay();
  const o = orders.find(o => o.id === orderId);
  if (o) o.status = OrderStatus.CANCELED;
};

export const callWaiter = async (tableId: string) => {
  await delay();
  const t = tables.find(t => t.id === tableId);
  if (t) t.waiter_requested = true;
};

export const dismissWaiterRequest = async (tableId: string) => {
  await delay();
  const t = tables.find(t => t.id === tableId);
  if (t) t.waiter_requested = false;
};

export const toggleTableServiceFee = async (tableId: string, removed: boolean) => {
  await delay();
  const t = tables.find(t => t.id === tableId);
  if (t) t.service_fee_removed = removed;
};

export const createOrder = async (
  tableId: string | null,
  storeId: string,
  items: { product: Product; quantity: number; notes?: string }[],
  customerName?: string,
): Promise<{ success: boolean; orderId?: string; message?: string }> => {
  await delay();
  const orderType: 'table' | 'counter' = tableId ? 'table' : 'counter';
  const total = items.reduce((s, i) => s + i.product.price * i.quantity, 0);
  const orderId = uid();
  const newOrder: Order = {
    id: orderId, table_id: tableId, store_id: storeId, status: OrderStatus.PENDING,
    order_type: orderType, total, created_at: now(), customer_name: customerName,
  };
  orders.push(newOrder);
  items.forEach(item => {
    orderItems.push({
      id: uid(), order_id: orderId, product_id: item.product.id, product: item.product,
      quantity: item.quantity, status: OrderStatus.PENDING, created_at: now(),
      price_at_time: item.product.price, notes: item.notes,
    });
  });
  if (tableId) {
    const t = tables.find(t => t.id === tableId);
    if (t && t.status === TableStatus.AVAILABLE) {
      t.status = TableStatus.OCCUPIED;
      t.current_host_name = customerName;
      t.guest_count = 1;
    }
  }
  return { success: true, orderId };
};

export const fetchOrderById = async (orderId: string): Promise<Order | null> => {
  await delay();
  const o = orders.find(o => o.id === orderId);
  if (!o) return null;
  return { ...o, order_items: orderItems.filter(i => i.order_id === orderId), tables: tables.find(t => t.id === o.table_id) };
};

export const updateOrderItemStatus = async (itemId: string, status: OrderStatus) => {
  await delay();
  const i = orderItems.find(i => i.id === itemId);
  if (i) i.status = status;
};

export const cancelSpecificOrderItem = async (itemId: string) => {
  await delay();
  const i = orderItems.find(i => i.id === itemId);
  if (i) i.status = OrderStatus.CANCELED;
};

export const updateTableStatus = async (tableId: string, status: TableStatus, hostName?: string) => {
  await delay();
  const t = tables.find(t => t.id === tableId);
  if (t) { t.status = status; if (hostName !== undefined) t.current_host_name = hostName; }
};

export const requestTableBill = async (tableId: string) => {
  await delay();
  const t = tables.find(t => t.id === tableId);
  if (t) t.status = TableStatus.WAITING_BILL;
};

export const cancelPendingTableItems = async (tableId: string) => {
  await delay();
  const tableOrders = orders.filter(o => o.table_id === tableId);
  tableOrders.forEach(o => {
    orderItems.filter(i => i.order_id === o.id && i.status === OrderStatus.PENDING)
      .forEach(i => i.status = OrderStatus.CANCELED);
  });
};

export const closeTableSession = async (
  tableId: string,
  paymentData?: { total: number; methods: { method: string; amount: number }[] },
): Promise<{ success: boolean; message?: string }> => {
  await delay();
  const t = tables.find(t => t.id === tableId);
  if (t) {
    t.status = TableStatus.AVAILABLE;
    t.current_host_name = undefined;
    t.guest_count = 0;
    t.waiter_requested = false;
    t.service_fee_removed = false;
  }
  const paymentMethod = paymentData?.methods?.length === 1 ? paymentData.methods[0].method : 'MULTIPLE';
  orders.filter(o => o.table_id === tableId && o.status !== OrderStatus.CANCELED)
    .forEach(o => { o.status = OrderStatus.DELIVERED; o.payment_method = paymentMethod; o.payment_details = paymentData; });
  return { success: true };
};

export const toggleTableBlock = async (tableId: string, currentStatus: TableStatus) => {
  await delay();
  const t = tables.find(t => t.id === tableId);
  if (!t) return;
  t.status = currentStatus === TableStatus.BLOCKED ? TableStatus.AVAILABLE : TableStatus.BLOCKED;
};

export const moveTable = async (sourceTableId: string, targetTableId: string): Promise<{ success: boolean; message?: string }> => {
  await delay();
  const src = tables.find(t => t.id === sourceTableId);
  const tgt = tables.find(t => t.id === targetTableId);
  if (!src || !tgt) return { success: false, message: 'Mesa não encontrada.' };
  orders.filter(o => o.table_id === sourceTableId).forEach(o => o.table_id = targetTableId);
  tgt.status = src.status;
  tgt.current_host_name = src.current_host_name;
  tgt.guest_count = src.guest_count;
  tgt.waiter_requested = src.waiter_requested;
  src.status = TableStatus.AVAILABLE;
  src.current_host_name = undefined;
  src.guest_count = 0;
  return { success: true };
};

export const uploadProductImage = async (_file: File): Promise<string> => {
  await new Promise(r => setTimeout(r, 500));
  return 'https://placehold.co/400x300/484DB5/white?text=Foto+Mock';
};

export const uploadStoreLogo = async (_file: File): Promise<string> => {
  await new Promise(r => setTimeout(r, 500));
  return 'https://placehold.co/200x200/484DB5/white?text=Logo+Mock';
};

export const updateStoreConfig = async (storeId: string, config: any) => {
  await delay();
  const s = stores.find(s => s.id === storeId);
  if (s) s.config = { ...s.config, ...config };
};

export const createStore = async (params: any): Promise<{ success: boolean; message?: string }> => {
  await delay();
  stores.push({ id: uid(), ...params, is_active: true, logo_url: null, cnpj: '00.000.000/0001-00', contract_type: 'balcao_mesas', contract_period_months: 12, activation_date: now() });
  return { success: true };
};

export const duplicateStore = async (_storeId: string): Promise<{ success: boolean; message?: string }> => {
  await delay();
  return { success: true };
};

export const updateStore = async (id: string, params: any): Promise<{ success: boolean; message?: string }> => {
  await delay();
  const s = stores.find(s => s.id === id);
  if (s) Object.assign(s, params);
  return { success: true };
};

export const deleteStore = async (id: string): Promise<{ success: boolean; message?: string }> => {
  await delay();
  stores = stores.filter(s => s.id !== id);
  return { success: true };
};
