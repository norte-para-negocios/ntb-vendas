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
    // Cardapio que vende (migration 019, Task B1): chips de atalho pro campo
    // de observacao do cliente, editaveis pelo lojista em MenuManagementView.
    // undefined/[] = nenhum chip aparece (comportamento atual, sem mudanca).
    note_suggestions?: string[];
    // Vende mais II (migration 020): liga o badge "mais vendido" automatico
    // no cardapio do cliente. undefined/false = nenhum badge aparece
    // (comportamento atual, sem mudanca).
    show_bestsellers?: boolean;
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
  // Cardapio por horario/turno (migration 018) — NULL nos 3 = sempre
  // disponivel. Ver lib/schedule.ts (isCategoryAvailableNow/formatScheduleLabel).
  available_from?: string | null;
  available_until?: string | null;
  available_days?: number[] | null; // 0=domingo .. 6=sabado
}

export interface ProductOption {
  id: string;
  group_id: string;
  name: string;
  price_delta: number;
  available: boolean; // migration 017 — "acabou o Catupiry" sem apagar a opcao
  order: number;
}

export interface ProductOptionGroup {
  id: string;
  product_id: string;
  name: string;
  type: 'single' | 'multiple';
  required: boolean;
  min_select?: number | null; // migration 017 — so' se aplica a type='multiple', null = sem limite
  max_select?: number | null;
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
  // Cardapio que vende (migration 019). promo_price NULL/undefined = sem
  // promocao; quando setado, o CHECK do banco garante < price e
  // create_order_secure cobra o menor no servidor (ver getEffectivePrice
  // em lib/calc.ts). tags usa o catalogo fixo PRODUCT_TAGS (lib/labels.ts).
  promo_price?: number | null;
  featured: boolean; // migration 019 — alimenta a vitrine "Destaques" no cardapio do cliente
  tags: string[];
  option_groups?: ProductOptionGroup[]; // so populado quando o Product veio de fetchMenu
  // Vende mais II (migration 020): "peca tambem" (cross-sell manual do
  // lojista). Anexado em runtime por fetchMenu, nao e coluna de banco
  // (mesmo padrao de option_groups).
  recommended_products?: Product[];
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

// Campos não-sigilosos de configuração do emissor fiscal (ambiente, série e
// numeração por tipo de documento etc.) — ver
// supabase/migrations/024_config_emissor_fiscal.sql. CSC/CSCID ficam numa
// tabela separada write-only (store_fiscal_config_secrets), não têm leitura
// via client, por isso não aparecem aqui.
export interface StoreFiscalConfig {
  store_id: string;
  ambiente: 'homologacao' | 'producao';
  nfe_serie: number | null;
  nfce_serie: number | null;
  cte_serie: number | null;
  mdfe_serie: number | null;
  nfe_ultimo_numero: number;
  nfce_ultimo_numero: number;
  cte_ultimo_numero: number;
  mdfe_ultimo_numero: number;
  inscricao_municipal: string | null;
  casas_decimais: number;
  cnpj_autorizado: string | null;
  observacao_nfe: string | null;
  observacao_pedido: string | null;
  updated_at: string;
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
