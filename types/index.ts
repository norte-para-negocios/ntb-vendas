export enum UserRole {
  ADMIN = 'admin',
  OWNER = 'owner',
  WAITER = 'waiter',
  KITCHEN = 'kitchen',
  BAR = 'bar',
  CLIENT = 'client'
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
  ACCEPTED = 'accepted',
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
  is_active: boolean;
  contract_type: 'balcao' | 'balcao_mesas';
  contract_period_months: number;
  activation_date: string;
  config: {
    use_pin: boolean;
    allow_client_open: boolean;
    require_pin_for_open: boolean;
    charge_service_fee?: boolean;
    service_fee_rate?: number;
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
  waiter_requested?: boolean;
  service_fee_removed?: boolean;
}

export interface Category {
  id: string;
  store_id: string;
  name: string;
  order: number;
  icon?: string;
}

export interface ProductOption {
  id: string;
  group_id: string;
  name: string;
  price_delta: number;
  order: number;
}

export interface ProductOptionGroup {
  id: string;
  product_id: string;
  name: string;
  type: 'single' | 'multiple';
  required: boolean;
  order: number;
  options: ProductOption[]; // anexado em runtime por fetchMenu, nao e coluna de banco
}

export interface Product {
  id: string;
  category_id: string | null; // FK is `on delete set null` — categoria excluida deixa o produto orfao
  store_id: string;
  name: string;
  description: string;
  price: number;
  image_url: string | null;
  available: boolean;
  prep_time_minutes: number;
  order?: number;
  destination?: 'kitchen' | 'bar';
  option_groups?: ProductOptionGroup[]; // so populado quando o Product veio de fetchMenu
}

export interface Order {
  id: string;
  table_id: string | null;
  store_id: string;
  status: OrderStatus;
  order_type: 'table' | 'counter';
  total: number;
  created_at: string;
  updated_at?: string;
  customer_name?: string;
  tables?: Table;
  order_items?: OrderItem[];
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
  selected_options?: { name: string; price_delta: number }[]; // snapshot gravado por create_order_secure
  order?: Order;
}

// Escolha do cliente ANTES de virar pedido — tem os ids (pro RPC e pro
// dedup do carrinho). Note a assimetria proposital com
// OrderItem.selected_options (snapshot pos-pedido, sem ids, so
// name/price_delta): sao estagios de vida diferentes do mesmo dado.
export interface SelectedOption {
  group_id: string;
  option_id: string;
  name: string;
  price_delta: number;
}

export interface CartItem {
  product: Product;
  quantity: number;
  notes?: string;
  selectedOptions?: SelectedOption[];
}

export interface TableSession {
  id: string;
  table_id: string;
  store_id: string;
  host_name: string | null;
  opened_at: string;
  closed_at: string | null;
}

export interface StoreFiscalCertificateStatus {
  original_filename: string;
  uploaded_at: string;
  expires_at: string | null;
}

export interface OrderRating {
  id: string;
  order_id: string;
  store_id: string;
  stars: number;
  comment: string | null;
  created_at: string;
}

export interface UniversalUser {
  id: string;
  name: string;
  email: string;
}
