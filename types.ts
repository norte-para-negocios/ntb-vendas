
export enum UserRole {
  ADMIN = 'admin',
  OWNER = 'owner',
  WAITER = 'waiter',
  KITCHEN = 'kitchen',
  BAR = 'bar',
  CLIENT = 'client' // Virtual role for logic
}

export enum TableStatus {
  AVAILABLE = 'available',
  OCCUPIED = 'occupied',
  WAITING_BILL = 'waiting_bill',
  CLOSED = 'closed',
  BLOCKED = 'blocked'
}

export enum OrderStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted', // Pedido aceito pelo balcão, aguardando início do preparo
  PREPARING = 'preparing',
  READY = 'ready',
  DELIVERED = 'delivered',
  CANCELED = 'canceled'
}

export interface Store {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  cnpj: string;
  
  // New Contract Fields
  is_active: boolean;
  contract_type: 'balcao' | 'balcao_mesas';
  contract_period_months: number;
  activation_date: string;
  
  config: {
    use_pin: boolean;
    allow_client_open: boolean;
    require_pin_for_open: boolean;
    charge_service_fee?: boolean;
  };
}

export interface StoreUserPermissions {
  tables: boolean;
  counter: boolean;
  kitchen: boolean;
  bar: boolean;
  menu: boolean;
  admin: boolean;
}

export interface StoreUser {
  id: string;
  store_id: string;
  name: string;
  email: string;
  role: string;
  must_change_password: boolean;
  permissions: StoreUserPermissions;
}

export interface Table {
  id: string;
  store_id: string;
  number: number;
  pin: string;
  status: TableStatus;
  current_host_name?: string;
  guest_count: number;
  waiter_requested?: boolean; // Novo campo
  service_fee_removed?: boolean;
}

export interface Category {
  id: string;
  store_id: string;
  name: string;
  order: number;
  icon?: string;
}

export interface Product {
  id: string;
  category_id: string;
  store_id: string;
  name: string;
  description: string;
  price: number;
  image_url: string | null;
  available: boolean;
  prep_time_minutes: number;
  order?: number;
  destination?: 'kitchen' | 'bar';
}

export interface Order {
  id: string;
  table_id: string | null; // Nullable for Counter
  store_id: string;
  status: OrderStatus; // Aggregate status
  order_type: 'table' | 'counter';
  total: number;
  created_at: string;
  updated_at?: string;
  customer_name?: string;
  
  // Expanded relations
  tables?: Table;
  order_items?: OrderItem[];
  
  // Payment Info
  payment_method?: string;
  payment_details?: any;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product: Product;
  quantity: number;
  status: OrderStatus;
  notes?: string;
  created_at: string;
  price_at_time: number;
  // Expanded relation fields
  order?: Order;
}

export interface CartItem {
  product: Product;
  quantity: number;
  notes?: string;
}