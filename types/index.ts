import { StoreModules, OrderFlow } from '@/lib/storeModules';

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
  cover_url: string | null;
  cnpj: string;
  is_active: boolean;
  is_test?: boolean;
  contract_type: 'balcao' | 'balcao_mesas';
  contract_period_months: number | null;
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
    // Perfil de módulos por loja (Task 1, plano 2026-08-22). undefined =
    // todos os módulos ligados e fluxo 'kds' — comportamento atual de todas
    // as 6 lojas reais, nenhuma delas tem essa chave. Ver
    // lib/storeModules.ts (resolveStoreModules/resolveOrderFlow) pra
    // resolução com esse default; nunca ler config.modules/order_flow
    // direto, sempre por essas funções.
    modules?: Partial<StoreModules>;
    order_flow?: OrderFlow;
    // Cor de destaque por loja (Task 6). Hex '#RRGGBB', opcional. Ausente/null
    // = WINE_GOLD padrão em ClientModule.tsx, byte-idêntico ao comportamento
    // anterior a esta feature. Validada contra um piso de contraste (WCAG
    // 2.1, ver lib/colorContrast.ts) em `updateStoreAccentColor` (lib/api.ts)
    // ANTES de persistir — nunca salva uma cor ilegível sobre o fundo escuro
    // do cardápio.
    accent_color?: string | null;
    // Achado real (reunião com o Ramon, 2026-08-25): comanda saía cortada
    // numa impressora térmica maior porque o template estava fixo em 48mm
    // (a impressora antiga da loja). undefined = 48mm (comportamento atual,
    // sem mudança pras 7 lojas reais). Ver lib/print.ts (thermalStyles).
    printer_paper_width_mm?: 48 | 58 | 80;
    // Kit de identidade visual (Task 18, plano "Fora do Cardápio",
    // 2026-08-27) — ver lib/theme.ts (THEME_PRESETS/resolveThemePreset).
    // undefined/null/valor desconhecido = 'classico' (comportamento atual,
    // sem mudança).
    theme_preset?: 'classico' | 'pizzaria' | 'boteco' | 'praia' | null;
    // Melhorias no fluxo de Caixa (2026-08-28), Task 4 — contagem cega no
    // fechamento de turno: undefined/false = comportamento atual (esperado
    // sempre visível durante a contagem, sem mudança pras lojas reais).
    cash_shift_blind_count?: boolean;
    // Avisos de tempo na Gestão de Mesas (pedido do dono, 2026-08-29) —
    // 0/undefined = aviso desligado (comportamento atual). Ver TablesView
    // em StoreModule.tsx.
    table_alert_occupied_minutes?: number;
    table_alert_no_order_minutes?: number;
  };
}

export interface StoreUserPermissions {
  tables: boolean;
  counter: boolean;
  kitchen: boolean;
  bar: boolean;
  menu: boolean;
  admin: boolean;
  // Módulo Caixa (Task 4, plano 2026-08-22-perfis-de-loja-e-caixa). Ao
  // contrário das 6 permissões acima (que já existem em todo store_user real
  // hoje, com valor explícito true/false gravado no banco), esta é NOVA —
  // nenhum store_user das 7 lojas reais tem esta chave. Por isso o código
  // que lê `permissions.caixa` (lib/storeModules.ts, canFinalizeBill) usa
  // comparação estrita (`=== true`), nunca o padrão permissivo
  // (`!== false`) usado pras outras 6: ausência aqui PRECISA significar
  // "não é caixa", senão qualquer garçom já cadastrado ganharia poder de
  // finalizar pagamento sem ninguém ter concedido isso.
  caixa?: boolean;
  // Melhorias no fluxo de Caixa (2026-08-28): vê o valor esperado no
  // fechamento mesmo com contagem cega ligada, e aprova fechamentos com
  // diferença acima da tolerância máxima. Ausência = false (mesmo padrão
  // estrito de `caixa`, nunca o fallback permissivo das 6 chaves antigas).
  supervisiona_caixa?: boolean;
}

export interface StoreUser {
  id: string;
  store_id: string;
  name: string;
  email: string;
  role: string;
  must_change_password: boolean;
  permissions: StoreUserPermissions;
  // Jurisdicao de mesas por garcom (Task 3, migration 049). null/undefined
  // ou array vazio = sem restricao (todas as mesas, comportamento de hoje
  // de TODO store_user real). So' faz sentido pra role 'waiter'/'cashier'
  // na UI de atribuicao, mas o enforcement (lib/storeModules.ts,
  // isTableInJurisdiction) e' generico por role owner/universal, nao por
  // este campo estar presente ou nao.
  assigned_table_ids?: string[] | null;
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
  // Integracao ntb-vendas -> ntb-estoque (migration 026) -- coluna ja existia
  // e ja era selecionada por fetchMenu (`select('*')`), so nao estava tipada
  // aqui ainda (achado ao construir a ferramenta de consolidar produtos em
  // variacao, 2026-08-16).
  omie_codigo?: string | null;
  option_groups?: ProductOptionGroup[]; // so populado quando o Product veio de fetchMenu
  // Vende mais II (migration 020): "peca tambem" (cross-sell manual do
  // lojista). Anexado em runtime por fetchMenu, nao e coluna de banco
  // (mesmo padrao de option_groups).
  recommended_products?: Product[];
  // NCM (Nomenclatura Comum do Mercosul, migration 032) — classificacao
  // fiscal do produto, exigida em qualquer item de NFC-e/NF-e. Nullable:
  // produto pode nao ter NCM configurado ainda (emissao fiscal automatica
  // e' feature futura, cadastro do campo vem antes).
  ncm: string | null;
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
  added_by_role?: 'cliente' | 'garcom'; // migration 046 — quem lançou o item (default 'cliente')
  added_by_name?: string | null; // migration 053 — nome de quem lançou (só populado quando added_by_role === 'garcom')
  fiscal_nota_id?: string | null; // migration 055 — nota fiscal individual que já cobriu este item (null = ainda não faturado)
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
  modelo_emissao_automatica: 'nenhuma' | 'nfce' | 'nfe';
  nfe_serie: number | null;
  nfce_serie: number | null;
  cte_serie: number | null;
  mdfe_serie: number | null;
  nfe_ultimo_numero: number;
  nfce_ultimo_numero: number;
  cte_ultimo_numero: number;
  mdfe_ultimo_numero: number;
  inscricao_municipal: string | null;
  telefone: string | null;
  casas_decimais: number;
  cnpj_autorizado: string | null;
  observacao_nfe: string | null;
  observacao_pedido: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  tipo_pessoa: 'juridica' | 'fisica';
  inscricao_estadual: string | null;
  endereco_logradouro: string | null;
  endereco_numero: string | null;
  endereco_complemento: string | null;
  endereco_bairro: string | null;
  endereco_cidade: string | null;
  endereco_uf: string | null;
  endereco_cep: string | null;
  cst_csosn_padrao: string | null;
  cst_pis_padrao: string | null;
  cst_cofins_padrao: string | null;
  cst_ipi_padrao: string | null;
  frete_padrao: string | null;
  tipo_pagamento_padrao: string | null;
  natureza_operacao_padrao: string | null;
  updated_at: string;
}

// Uma linha por tentativa de emissão fiscal (NFC-e/NF-e) — ver
// supabase/migrations/034_fiscal_notas_e_emissao_automatica.sql,
// 037_fiscal_notas_pendente_nao_bloqueia_idempotencia.sql e
// app/api/fiscal/emitir/route.ts. 'pendente' (gravado desde a Task 17,
// 2026-08-06) é uma NF-e que faltou CPF/CNPJ do destinatário — checado ANTES
// da numeração, nenhum documento chega a existir na SEFAZ. 'erro'/
// 'rejeitada'/'pendente' são todas seguras de reemitir: só 'autorizada'
// representa um documento real, e é a única que a guarda de idempotência da
// rota de emissão (e o índice único do banco) bloqueia.
export interface FiscalNota {
  id: string;
  store_id: string;
  table_id: string | null;
  order_id: string | null;
  modelo: '55' | '65';
  ambiente: 'homologacao' | 'producao';
  status: 'pendente' | 'autorizada' | 'rejeitada' | 'erro';
  chave_acesso: string | null;
  numero: number | null;
  serie: number | null;
  protocolo: string | null;
  motivo_erro: string | null;
  valor_total: number | null;
  xml_path: string | null;
  pdf_path: string | null;
  created_at: string;
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

export interface OperatorCheckin {
  id: string;
  store_id: string;
  user_id: string;
  user_name: string;
  checkin_at: string;
  checkout_at: string | null;
}

// Reserva de mesa direto do cardápio (Task 21, plano "Fora do Cardápio",
// 2026-08-27) — MVP: cliente pede sem escolher mesa específica, lojista
// confirma/cancela manualmente (ver migration 059).
export interface TableReservation {
  id: string;
  store_id: string;
  customer_name: string;
  customer_phone: string;
  party_size: number;
  reserved_for: string;
  status: 'pending' | 'confirmed' | 'canceled';
  created_at: string;
}

// Aba "Impressão" (2026-08-27, teste na loja no dia seguinte) — ver
// migration 061. connection_type='browser_default' é só metadado (a
// impressão continua sendo window.print(), via CaixaPrintStation.tsx);
// 'network'/'usb' são consumidas pelo agente local (print-agent/).
export interface PrinterConfig {
  id: string;
  store_id: string;
  name: string;
  connection_type: 'browser_default' | 'network' | 'usb';
  ip_address: string | null;
  port: number;
  usb_system_name: string | null;
  // 'receipt' (2026-08-28, migration 064): impressora dedicada ao
  // comprovante de pagamento (printBillReceipt), separada da(s) impressora(s)
  // de ticket de cozinha/bar — achado ao vivo, loja real com 3 impressoras
  // cabeadas distintas (cozinha, bar, caixa).
  destination: 'kitchen' | 'bar' | 'all' | 'receipt';
  is_active: boolean;
  created_at: string;
}

export interface PrintJob {
  id: string;
  store_id: string;
  printer_config_id: string | null;
  // 'receipt' (2026-08-28, migration 064): impressora dedicada ao
  // comprovante de pagamento (printBillReceipt), separada da(s) impressora(s)
  // de ticket de cozinha/bar — achado ao vivo, loja real com 3 impressoras
  // cabeadas distintas (cozinha, bar, caixa).
  destination: 'kitchen' | 'bar' | 'all' | 'receipt';
  title: string;
  content: string;
  status: 'pending' | 'printing' | 'done' | 'error';
  error_message: string | null;
  created_at: string;
  printed_at: string | null;
}

export interface UniversalUser {
  id: string;
  name: string;
  email: string;
  pode_ver_lojas_teste?: boolean;
}
