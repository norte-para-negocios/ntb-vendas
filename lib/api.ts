import type { PriceSchedule } from '@/lib/priceSchedule';
import { supabase, supabaseUrlForConnectivityCheck, supabaseKeyForConnectivityCheck } from '@/lib/supabaseClient';
import { cabecalhosApi } from '@/lib/atorAtual';
import { vendaTemCobranca } from '@/lib/calc';
import { dividirEmLotes } from '@/lib/planta';
import type { VendasCanceladas } from '@/lib/vendasCanceladas';
import { impressoraRecebe, type DocPrint } from '@/lib/printDocs';
import { Store, Table, Product, Category, PrintSector, CategoryGroup, OrderItem, OrderStatus, TableStatus, CartItem, StoreUser, Order, TableSession, StoreFiscalCertificateStatus, StoreFiscalConfig, OrderRating, UniversalUser, ProductOptionGroup, OptionVariant, FiscalNota, OperatorCheckin, TableReservation, PrinterConfig, PrintJob } from '@/types';
import { StoreModules, OrderFlow, isDefaultStoreModules } from '@/lib/storeModules';
import { checkAccentColorContrast } from '@/lib/colorContrast';
import { stockModeFields, normalizarModo, type ModoEstoque } from '@/lib/modoEstoque';
import { getCachedMenu, setCachedMenu, getCachedTables, setCachedTables, getCachedCashShift, setCachedCashShift, getCachedSession, setCachedSession, getCachedCashShiftSummary, setCachedCashShiftSummary, getCachedKitchenOrders, setCachedKitchenOrders, getCachedCounterOrders, setCachedCounterOrders } from './offline/cache';
import { enqueue } from './offline/queue';
import { isNetworkError, checkRealConnectivity } from './offline/network';
import { chamarCriarPedido } from './offline/criarPedido';

// App desktop (Electron, ver docs/superpowers/specs/2026-09-07-desktop-app-
// electron-design.md): a interface roda embutida no instalador, mas as
// rotas /api/* (têm a service role key) continuam só no servidor de
// produção — nunca podem ir pro .exe. `window.electronApp` só existe
// quando o código roda dentro do app desktop (setado pelo preload.js,
// ver desktop/electron/preload.js); no navegador normal, `resolverUrlApi`
// devolve o caminho relativo de sempre, sem nenhuma mudança de
// comportamento.
declare global {
  interface Window {
    electronApp?: {
      isElectron: boolean;
      apiBaseUrl: string;
      version?: string;
      onUpdateDownloaded?: (callback: (info: { version: string }) => void) => void;
      installUpdate?: () => Promise<void>;
      onRecuperouDeFalha?: (callback: () => void) => void;
      getUpdateStatus?: () => Promise<{ versaoAtual: string; versaoBaixada: string | null; situacao: string; detalhe: string | null; empacotado: boolean }>;
      checkForUpdate?: () => Promise<{ ok: boolean; empacotado: boolean; versaoDisponivel?: string | null; erro?: string }>;
      startPrintEngine?: (params: { storeId: string; supabaseUrl: string; supabaseAnonKey: string; lembrar?: boolean }) => Promise<{ ok: boolean; reason?: string }>;
      stopPrintEngine?: () => Promise<{ ok: boolean }>;
      printPdfSilent?: (params: { pdfUrl: string; printerName: string }) => Promise<{ ok: boolean; reason?: string }>;
      printDirectUsb?: (params: { printer: PrinterConfig; content: string; owners: string[] }) => Promise<{ ok: boolean; reason?: string }>;
      encryptSecret?: (texto: string) => Promise<string | null>;
      decryptSecret?: (b64: string) => Promise<string | null>;
      localPrinters?: () => Promise<{ hostname: string; impressoras: string[] }>;
      printDirectNetwork?: (params: { ip: string; port: number; content: string; raw: boolean }) => Promise<{ ok: boolean; reason?: string }>;
    };
  }
}

// Liga a impressão de rede (IP) / USB embutida no app desktop (ver
// desktop/electron/print-engine.js). No navegador não faz nada — lá essa
// impressão continua dependendo do print-agent separado, porque página
// web não abre socket cru nem chama o spooler do sistema.
//
// Quem chama é o painel do lojista logo depois do login: a loja logada só
// existe do lado do renderer, e passar URL/chave daqui garante que o
// processo principal use exatamente o mesmo banco que o resto do app (em
// vez de repetir esses valores num segundo lugar, que sairia de sincronia
// no primeiro deploy que trocasse de servidor).
// `lembrar=false` (conta universal da equipe Norte, que troca de loja): o PC não guarda essa loja pra religar
// sozinho no próximo boot — senão o PC do cliente poderia voltar imprimindo a fila de outra loja.
export const iniciarMotorImpressaoDesktop = async (storeId: string, lembrar = true) => {
  if (typeof window === 'undefined' || !window.electronApp?.startPrintEngine) return;
  try {
    await window.electronApp.startPrintEngine({
      storeId,
      supabaseUrl: supabaseUrlForConnectivityCheck,
      supabaseAnonKey: supabaseKeyForConnectivityCheck,
      lembrar,
    });
    // Guarda a lista de impressoras pra poder imprimir direto na rede se a internet cair.
    fetchPrinterConfigs(storeId).catch(() => {});
    fetchDiscoveredPrinters(storeId).catch(() => {});
  } catch (e) {
    // Impressão de rede/USB é um caminho ADITIVO (ver AGENTS.md, aba
    // "Impressão"): falhar aqui nunca pode derrubar o login nem o
    // window.print() que as 6 lojas reais já usam.
    console.error('Falha ao iniciar o motor de impressão do app desktop:', e);
  }
};

export const pararMotorImpressaoDesktop = () => {
  if (typeof window === 'undefined' || !window.electronApp?.stopPrintEngine) return;
  window.electronApp.stopPrintEngine().catch(() => {});
};

export function resolverUrlApi(caminho: string): string {
  if (typeof window !== 'undefined' && window.electronApp?.isElectron) {
    return `${window.electronApp.apiBaseUrl}${caminho}`;
  }
  return caminho;
}

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
export type MotivoFalhaLogin = 'network' | 'locked' | 'wrong' | 'store_inactive';
export const authenticateStoreUser = async (email: string, password: string): Promise<{ success: boolean; user?: StoreUser & { store: Store }; message?: string; reason?: MotivoFalhaLogin }> => {
  try {
    const { data, error } = await supabase.rpc('authenticate_store_user_secure', {
      p_email: email,
      p_password: password,
    });

    if (error || data == null) return { success: false, reason: 'network', message: 'Sem conexão com o servidor. Tente de novo.' };
    if (!data.success) {
      return {
        success: false,
        reason: data.locked ? 'locked' : 'wrong',
        message: data.locked ? 'Muitas tentativas incorretas. Aguarde 5 minutos.' : 'Usuário ou senha incorretos.',
      };
    }

    const store = await fetchStoreById(data.user.store_id);
    // fetchStoreById devolve null também quando a rede falha e não há cache: não é loja inativa, é falta de conexão.
    if (!store) return { success: false, reason: 'network', message: 'Sem conexão com o servidor. Tente de novo.' };
    if (!store.is_active) return { success: false, reason: 'store_inactive', message: 'Esta loja está inativa ou bloqueada.' };

    const user: StoreUser & { store: Store } = {
      ...data.user,
      must_change_password: data.mustChangePass,
      store,
    };

    return { success: true, user };
  } catch (error: any) {
    console.error('Auth Store User Error:', error);
    return { success: false, reason: 'network', message: 'Sem conexão com o servidor. Tente de novo.' };
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
// C4 da revisão final de branch (2026-09-08, ver task-12-report.md): sem
// fallback de cache, qualquer erro de REDE aqui (não só "usuário/loja não
// existe mais") derrubava a sessão restaurada no boot do app — o operador
// ficava travado fora do app justamente offline, quando mais precisava dele
// (login offline é fora de escopo). Mesmo padrão já usado em
// fetchOpenCashShift (Task 11): cacheia o resultado bem-sucedido
// (fire-and-forget) e, numa falha classificada como rede
// (`isNetworkError`), cai pro último valor cacheado em vez de `null`. Erro
// que NÃO é de rede (RPC devolveu vazio, usuário/loja realmente sumiu)
// continua devolvendo `null` exatamente como antes.
export const fetchStoreUserById = async (userId: string): Promise<(StoreUser & { store: Store }) | null> => {
  try {
    const { data, error } = await supabase.rpc('fetch_store_user_by_id_secure', { p_user_id: userId });
    if (error) throw error;
    if (!data) return null;

    const store = await fetchStoreById(data.store_id);
    if (!store || !store.is_active) return null;

    const result = { ...data, store };
    setCachedSession(`store_user:${userId}`, result).catch(() => {});
    return result;
  } catch (error) {
    if (!isNetworkError(error)) return null;
    const cached = await getCachedSession(`store_user:${userId}`);
    return (cached?.value as (StoreUser & { store: Store }) | null) ?? null;
  }
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

// C4 da revisão final (ver task-12-report.md e o comentário de
// fetchStoreUserById acima) — mesmo padrão de fallback via cache num erro de
// rede, chamada tanto direto pela restauração de sessão (universal) quanto
// de dentro de fetchStoreUserById/authenticateStoreUser.
export const fetchStoreById = async (storeId: string): Promise<Store | null> => {
  try {
    const { data, error } = await supabase.from('stores').select('*').eq('id', storeId).single();
    if (error) throw error;
    setCachedSession(`store:${storeId}`, data).catch(() => {});
    return data;
  } catch (error) {
    if (!isNetworkError(error)) {
      console.error('Error fetching store by id:', error);
      return null;
    }
    const cached = await getCachedSession(`store:${storeId}`);
    return (cached?.value as Store | null) ?? null;
  }
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
      price_rule: g.price_rule === 'max' ? 'max' : 'sum',
      options: (g.product_options || []).map((o: any) => ({
        id: o.id, group_id: o.group_id, name: o.name, price_delta: Number(o.price_delta), available: o.available, order: o.order, omie_codigo: o.omie_codigo ?? null,
        variants: o.variants ?? null,
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

// Fix I1 da revisão final (2026-09-22): normaliza toda categoria cujo
// `group_id` não bate com nenhum grupo REALMENTE devolvido nesta chamada —
// vira `group_id: null` (categoria solta) em vez de sumir da tela. Sem
// isso, uma categoria agrupada desaparecia inteira (produtos incluídos)
// sempre que `categoryGroups` vinha vazio/incompleto por qualquer motivo
// não relacionado à categoria em si: cache offline (nunca guarda grupos,
// sempre devolve `categoryGroups: []`), falha isolada na query de
// `category_groups`, ou uma corrida onde um grupo foi apagado entre a
// leitura de categorias e a de grupos. Aplicado em TODO caminho de retorno
// de `fetchMenu` abaixo — nunca um `return` novo pode pular esta chamada.
function normalizeCategoriesAgainstGroups(categories: Category[], groups: CategoryGroup[]): Category[] {
  const groupIds = new Set(groups.map(g => g.id));
  return categories.map(c => (c.group_id && !groupIds.has(c.group_id)) ? { ...c, group_id: null } : c);
}

export const fetchMenu = async (storeId: string, onlyAvailable = true, includeUnavailable = false): Promise<{ categories: Category[]; products: Product[]; categoryGroups: CategoryGroup[]; error?: 'network' }> => {
  try {
    const categoriesQuery = supabase.from('categories').select('*').eq('store_id', storeId).order('order');
    const categoryGroupsQuery = supabase.from('category_groups').select('*').eq('store_id', storeId).order('order');
    let productsQuery = supabase.from('products').select('*').eq('store_id', storeId).order('order', { ascending: true, nullsFirst: false });
    if (onlyAvailable) productsQuery = productsQuery.eq('available', true);

    // Query de adicionais e de recomendações paralelizadas com
    // categorias/produtos (não dependem do resultado delas, só do storeId)
    // — antes rodava sequencialmente depois do Promise.all abaixo.
    const [cats, catGroups, prods, groupsByProduct, recommendedByProduct, priceSchedules] = await Promise.all([
      categoriesQuery,
      categoryGroupsQuery,
      productsQuery,
      fetchOptionGroupsByProduct(storeId, includeUnavailable),
      fetchProductRecommendationsByStore(storeId),
      fetchPriceSchedules(storeId),
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
      const resolved = products.map(p => ({
        ...p,
        recommended_products: [] as Product[],
        // Regras de preço por horário que valem pro produto (dele ou da categoria dele).
        price_schedules: priceSchedules.filter(s => s.active && (s.product_id === p.id || (s.category_id && s.category_id === p.category_id))),
      }));
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
        const cached = await getCachedMenu(storeId);
        if (cached) return { categories: normalizeCategoriesAgainstGroups(cached.categories as Category[], []), products: cached.products as Product[], categoryGroups: [] };
        const fallbackGroups = catGroups.data || [];
        return { categories: normalizeCategoriesAgainstGroups(cats.data || [], fallbackGroups), products: fallbackProds.data || [], categoryGroups: fallbackGroups, error: 'network' };
      }
      const fallbackResult = { categories: normalizeCategoriesAgainstGroups(cats.data || [], catGroups.data || []), products: resolveRecommended(mergeOptionGroups(fallbackProds.data || [], groupsByProduct)), categoryGroups: catGroups.data || [] };
      setCachedMenu(storeId, fallbackResult.categories, fallbackResult.products).catch(() => {});
      return fallbackResult;
    }

    if (cats.error || prods.error) {
      console.error('Error fetching menu:', cats.error || prods.error);
      const cached = await getCachedMenu(storeId);
      if (cached) return { categories: normalizeCategoriesAgainstGroups(cached.categories as Category[], []), products: cached.products as Product[], categoryGroups: [] };
      const errorGroups = catGroups.data || [];
      return { categories: normalizeCategoriesAgainstGroups(cats.data || [], errorGroups), products: prods.data || [], categoryGroups: errorGroups, error: 'network' };
    }

    const resultGroups = catGroups.data || [];
    const result = { categories: normalizeCategoriesAgainstGroups(cats.data || [], resultGroups), products: resolveRecommended(mergeOptionGroups(prods.data || [], groupsByProduct)), categoryGroups: resultGroups };
    setCachedMenu(storeId, result.categories, result.products).catch(() => {});
    return result;
  } catch (error) {
    console.error('Error fetching menu:', error);
    const cached = await getCachedMenu(storeId);
    if (cached) return { categories: normalizeCategoriesAgainstGroups(cached.categories as Category[], []), products: cached.products as Product[], categoryGroups: [] };
    return { categories: [], products: [], categoryGroups: [], error: 'network' };
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
    p_cost_price: product.cost_price ?? null,
    p_stock_alert_threshold: product.stock_alert_threshold ?? null,
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
  price_rule?: 'sum' | 'max'; // migration 140
  options: { name: string; price_delta: number; available?: boolean; omie_codigo?: string | null; variants?: Record<string, OptionVariant> | null }[];
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
      price_rule: g.price_rule === 'max' ? 'max' : 'sum',
      options: g.options.map(o => ({ name: o.name, price_delta: o.price_delta, available: o.available ?? true, omie_codigo: o.omie_codigo ?? null, variants: o.variants ?? null })),
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
    const res = await fetch(resolverUrlApi('/api/integracao/criar-produto-estoque'), {
      method: 'POST',
      headers: cabecalhosApi(),
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
  // promo_price/cost_price/stock_alert_threshold: `null` explicito no objeto
  // significa "o lojista limpou o campo", diferente de "a chave nem veio"
  // (nao mexer). update_product_secure usa coalesce (null = nao mexer) pra
  // todo o resto, entao precisa desses flags separados especificamente pra
  // permitir zerar cada um.
  const clearingPromoPrice = 'promo_price' in updates && updates.promo_price == null;
  const clearingCostPrice = 'cost_price' in updates && updates.cost_price == null;
  const clearingStockThreshold = 'stock_alert_threshold' in updates && updates.stock_alert_threshold == null;
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
    p_cost_price: clearingCostPrice ? null : updates.cost_price,
    p_clear_cost_price: clearingCostPrice,
    p_stock_alert_threshold: clearingStockThreshold ? null : updates.stock_alert_threshold,
    p_clear_stock_alert_threshold: clearingStockThreshold,
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

export const fetchCategoryGroups = async (storeId: string): Promise<CategoryGroup[]> => {
  const { data, error } = await supabase.from('category_groups').select('*').eq('store_id', storeId).order('order');
  if (error) throw error;
  return data || [];
};

export const createCategoryGroup = async (storeId: string, name: string) => {
  const { data: maxOrderData } = await supabase.from('category_groups').select('order').eq('store_id', storeId).order('order', { ascending: false }).limit(1);
  const nextOrder = (maxOrderData?.[0]?.order || 0) + 1;
  const { error } = await supabase.from('category_groups').insert({ store_id: storeId, name, order: nextOrder });
  if (error) throw error;
};

export const deleteCategoryGroup = async (id: string) => {
  const { error } = await supabase.from('category_groups').delete().eq('id', id);
  if (error) throw error;
};

export const updateCategoryGroupAssignment = async (categoryId: string, groupId: string | null) => {
  const { error } = await supabase.from('categories').update({ group_id: groupId }).eq('id', categoryId);
  if (error) throw error;
};

// Setores de produção (migration 087): ex. Pizzaria, além de Cozinha/Bar.
export const fetchPrintSectors = async (storeId: string): Promise<PrintSector[]> => {
  const { data, error } = await supabase.from('print_sectors').select('*').eq('store_id', storeId).order('created_at');
  if (error) {
    try { return JSON.parse(localStorage.getItem(`ntb-sectors-cache:${storeId}`) || '[]'); } catch { return []; }
  }
  try { localStorage.setItem(`ntb-sectors-cache:${storeId}`, JSON.stringify(data || [])); } catch { /* sem cache */ }
  return data || [];
};
// Avisa o hook de notificações e o menu "Produção" (mesma aba ou outra) que os locais mudaram.
const avisarSetoresMudaram = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('ntb-setores-changed')); };
export const createPrintSector = async (storeId: string, name: string, base: 'kitchen' | 'bar'): Promise<{ id: string } | null> => {
  const { data, error } = await supabase.from('print_sectors').insert({ store_id: storeId, name, base }).select('id').maybeSingle();
  if (error) throw error;
  avisarSetoresMudaram();
  return data as { id: string } | null;
};
export const updatePrintSector = async (id: string, patch: { name?: string; base?: 'kitchen' | 'bar' }) => {
  const { error } = await supabase.from('print_sectors').update(patch).eq('id', id);
  if (error) throw error;
  avisarSetoresMudaram();
};
export const deletePrintSector = async (id: string) => {
  const { error } = await supabase.from('print_sectors').delete().eq('id', id);
  if (error) throw error;
  avisarSetoresMudaram();
};
// Mapa categoria -> local de preparo (pra telas que só têm o produto).
export const fetchCategorySectors = async (storeId: string): Promise<Record<string, string | null>> => {
  const { data, error } = await supabase.from('categories').select('id, sector_id').eq('store_id', storeId);
  if (error) return {};
  return Object.fromEntries((data || []).map((c: { id: string; sector_id: string | null }) => [c.id, c.sector_id]));
};
export const updateCategorySector = async (categoryId: string, sectorId: string | null) => {
  const { error } = await supabase.from('categories').update({ sector_id: sectorId }).eq('id', categoryId);
  if (error) throw error;
};
// Marca a categoria inteira como Cozinha ou Bar (migration 155): products.destination de todos os produtos dela
// + categories.sector_id = null. Devolve quantos produtos mudaram. Banco sem a 155 (PGRST202): erro claro.
export const setCategoryDestination = async (storeId: string, categoryId: string, destination: 'kitchen' | 'bar'): Promise<number> => {
  const { data, error } = await supabase.rpc('set_category_destination_secure', { p_store_id: storeId, p_category_id: categoryId, p_destination: destination });
  if (error) {
    if (error.code === 'PGRST202') throw new Error('O banco ainda não tem a atualização 155 (destino da categoria). Peça para aplicarem a migration.');
    throw error;
  }
  return Number(data) || 0;
};
export const updateProductSector = async (productId: string, storeId: string, sectorId: string | null, ignoreCategory = false) => {
  const { error } = await supabase.rpc('set_product_sector_secure', { p_product_id: productId, p_store_id: storeId, p_sector_id: sectorId, p_ignore_category: ignoreCategory });
  if (error) throw error;
};
// Impressora atende o item? Mesmo destino (ou 'all') E mesmo setor
// (impressora sem setor = só itens sem setor).
export const printerServesSector = (printer: { sector_id?: string | null }, itemSectorId: string | null | undefined) =>
  (printer.sector_id || null) === (itemSectorId || null);

export const updateProductOrder = async (updates: { id: string; order: number }[]) => {
  const { error } = await supabase.rpc('update_products_order', { p_updates: updates });
  if (error) {
    if (error.code === '42703' || error.message?.includes('column') || error.message?.includes('does not exist')) {
      throw new Error('schema cache');
    }
    throw error;
  }
};

export interface ProdutoEstoqueBusca {
  codigo: string;
  codigo_produto: number;
  descricao: string;
  valor_unitario: number;
}

// Busca produtos já cadastrados no NTB Estoque por nome (modo "Vincular a um
// código Omie já existente" do modal de produto) — evita o operador ter que
// saber o código de cor. Retorna [] em qualquer falha (loja sem integração
// configurada, NTB Estoque fora do ar, etc.) — nunca lança, o modal cai de
// volta pro campo de texto manual nesse caso.
export const buscarProdutosNoEstoque = async (storeId: string, query: string): Promise<ProdutoEstoqueBusca[]> => {
  try {
    const res = await fetch(`/api/integracao/buscar-produto-estoque?storeId=${storeId}&q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (!res.ok || !data.success) return [];
    return data.produtos as ProdutoEstoqueBusca[];
  } catch {
    return [];
  }
};

// Vincula/desvincula um produto a um omie_codigo já existente (caso
// "Vincular a um código Omie já existente" do modal de produto) — nunca cria
// nada novo no Omie/ntb-estoque, só grava o código informado. `null` limpa o
// vínculo.
export const setProductOmieCodigo = async (id: string, storeId: string, omieCodigo: string | null) => {
  const { error } = await supabase.rpc('set_product_omie_codigo_secure', {
    p_product_id: id,
    p_store_id: storeId,
    p_omie_codigo: omieCodigo,
  });
  if (error) throw error;
};

// Taxa como produto (migration 138, ver lib/taxas.ts). null = produto normal.
export const setProductFee = async (id: string, storeId: string, feeType: 'fixed' | 'percent' | null, feePercent: number | null) => {
  const { error } = await supabase.rpc('set_product_fee_secure', {
    p_product_id: id,
    p_store_id: storeId,
    p_fee_type: feeType,
    p_fee_percent: feeType === 'percent' ? feePercent : null,
  });
  if (error) throw error;
};

// Produtos-taxa da loja (botões "Taxas" no pagamento da mesa). products tem
// select público (mesmo nível do cardápio).
export const fetchFeeProducts = async (storeId: string): Promise<Product[]> => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('store_id', storeId)
    .eq('available', true)
    .not('fee_type', 'is', null)
    .order('order', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data || []) as Product[];
};

// Caixa lança uma taxa na conta da mesa. Preço calculado no servidor; taxa
// percentual já lançada é recalculada (nunca duplica). Permissão de caixa
// conferida na function pelo operador.
export const addFeeItem = async (params: {
  storeId: string;
  tableId: string;
  productId: string;
  quantity?: number;
  operatorUserId: string | null;
  operatorName: string | null;
  /** Taxa editável (migration 141): valor em R$ digitado pelo caixa. Taxa de serviço: 0 = sem taxa. */
  amount?: number | null;
  /** Taxa de serviço editável: percentual digitado (0 a 100). Não combina com `amount`. */
  percent?: number | null;
}): Promise<{ success: boolean; message?: string; price?: number; updated?: boolean; removed?: boolean }> => {
  const { data, error } = await supabase.rpc('add_fee_item_secure', {
    p_store_id: params.storeId,
    p_table_id: params.tableId,
    p_product_id: params.productId,
    p_quantity: params.quantity ?? 1,
    p_operator_user_id: params.operatorUserId,
    p_operator_name: params.operatorName,
    // Só manda quando o caixa editou: app novo + servidor sem a 141 ainda dá erro de assinatura,
    // então o caminho padrão (sem edição) continua com os 6 argumentos de sempre.
    ...(params.amount != null ? { p_amount: params.amount } : {}),
    ...(params.percent != null ? { p_percent: params.percent } : {}),
  });
  if (error) return { success: false, message: error.message };
  return data as { success: boolean; message?: string; price?: number; updated?: boolean; removed?: boolean };
};

export const deleteProduct = async (id: string, storeId: string) => {
  const { error } = await supabase.rpc('delete_product_secure', { p_product_id: id, p_store_id: storeId });
  if (error) throw error;
};

// Resposta de leitura que FALHOU (cache ou vazio): marcada para a tela não trocar uma lista boa por uma lista velha/vazia.
export const leituraFalhou = (lista: unknown): boolean => !!(lista as { __falhou?: boolean } | null)?.__falhou;
const marcarFalha = <T extends unknown[]>(lista: T): T => { Object.defineProperty(lista, '__falhou', { value: true, enumerable: false }); return lista; };

export const fetchTables = async (storeId: string): Promise<Table[]> => {
  const { data, error } = await supabase.rpc('get_tables_secure', { p_store_id: storeId });
  if (error) {
    console.error(error);
    const cached = await getCachedTables(storeId);
    if (cached) return marcarFalha([...(cached.tables as Table[])]);
    return marcarFalha([] as Table[]);
  }
  const tables = (data as any) || [];
  setCachedTables(storeId, { tables }).catch(() => {});
  return tables;
};

// Igual a fetchTables, mas sem a coluna `pin` — usada pelo cardápio do cliente
// (ClientModule), que não deve receber o PIN de mesas que não são as dele.
// Planta de mesas (migration 149): grava a posição (% do mapa) de uma mesa; null/null tira do mapa.
export const updateTablePosition = async (storeId: string, tableId: string, x: number | null, y: number | null): Promise<boolean> => {
  const { data, error } = await supabase.rpc('update_table_position_secure', { p_store_id: storeId, p_table_id: tableId, p_x: x, p_y: y });
  if (error) { console.error('updateTablePosition falhou:', error); return false; }
  return data === true;
};

// Planta em lote (migration 154). x e y andam juntos; área é opcional. Banco sem a 154 (PGRST202): cai na RPC antiga, uma mesa por vez.
export interface PosicaoMesa { id: string; x?: number | null; y?: number | null; area?: string | null }

const posicaoParaJson = (i: PosicaoMesa): Record<string, unknown> => {
  const o: Record<string, unknown> = { id: i.id };
  if (i.x !== undefined) { o.x = i.x; o.y = i.y ?? null; }
  if (i.area !== undefined) o.area = i.area;
  return o;
};

export const updateTablesPositions = async (storeId: string, itens: PosicaoMesa[]): Promise<boolean> => {
  if (itens.length === 0) return true;
  for (const lote of dividirEmLotes(itens, 200)) {
    // eslint-disable-next-line no-await-in-loop -- poucos lotes (500 mesas = 3)
    const { error } = await supabase.rpc('update_tables_positions_secure', { p_store_id: storeId, p_items: lote.map(posicaoParaJson) });
    if (error) {
      if (error.code === 'PGRST202') return updateTablesPositionsLegado(storeId, itens);
      console.error('updateTablesPositions falhou:', error);
      return false;
    }
  }
  return true;
};

async function updateTablesPositionsLegado(storeId: string, itens: PosicaoMesa[]): Promise<boolean> {
  if (itens.some((i) => i.area !== undefined)) { console.warn('Áreas exigem a migration 154 aplicada no banco.'); return false; }
  const comPos = itens.filter((i) => i.x !== undefined);
  for (const grupo of dividirEmLotes(comPos, 10)) {
    // eslint-disable-next-line no-await-in-loop
    const r = await Promise.all(grupo.map((i) => updateTablePosition(storeId, i.id, i.x ?? null, i.y ?? null)));
    if (r.some((ok) => !ok)) return false;
  }
  return true;
}

// Preço por horário (migration 153). Tolerante: banco sem a tabela (app novo, migration ainda não aplicada) = sem regras.
export const fetchPriceSchedules = async (storeId: string): Promise<PriceSchedule[]> => {
  try {
    const { data, error } = await supabase.from('price_schedules').select('*').eq('store_id', storeId).order('created_at');
    if (error) return [];
    return (data as PriceSchedule[]) || [];
  } catch { return []; }
};
export const savePriceSchedule = async (storeId: string, id: string | null, data: Record<string, unknown>): Promise<boolean> => {
  const { data: r, error } = await supabase.rpc('save_price_schedule_secure', { p_store_id: storeId, p_id: id, p_data: data });
  if (error) { console.error('savePriceSchedule falhou:', error); return false; }
  return !!r;
};
export const deletePriceSchedule = async (storeId: string, id: string): Promise<boolean> => {
  const { data, error } = await supabase.rpc('delete_price_schedule_secure', { p_store_id: storeId, p_id: id });
  if (error) { console.error('deletePriceSchedule falhou:', error); return false; }
  return data === true;
};

// Transferir item(ns) entre mesas (migration 152).
export const transferItems = async (storeId: string, itemIds: string[], targetTableId: string, operatorUserId: string | null, operatorName: string, fromTableId: string | null = null): Promise<{ success: boolean; moved?: number; message?: string }> => {
  const { data, error } = await supabase.rpc('transfer_items_v2', { p_store_id: storeId, p_item_ids: itemIds, p_target_table_id: targetTableId, p_operator_user_id: operatorUserId, p_operator_name: operatorName, p_from_table_id: fromTableId });
  if (error) { console.error('transferItems falhou:', error); return { success: false, message: 'Não consegui mover o item.' }; }
  return data as { success: boolean; moved?: number; message?: string };
};

// Esgotado em tempo real (migration 151).
export const setProductSoldOut = async (storeId: string, productId: string, soldOut: boolean, operatorUserId?: string | null): Promise<boolean> => {
  // Só gerente/dono (migration 165): com o operador conhecido usa a função que valida o papel no servidor.
  // Servidor sem a 165 (PGRST202) cai na antiga; conta universal manda null e usa a antiga (já é equipe interna).
  if (operatorUserId) {
    const v2 = await supabase.rpc('set_product_sold_out_v2', { p_store_id: storeId, p_product_id: productId, p_sold_out: soldOut, p_operator_user_id: operatorUserId });
    if (!v2.error) return v2.data === true;
    if (v2.error.code !== 'PGRST202') { console.error('setProductSoldOut falhou:', v2.error); return false; }
  }
  const { data, error } = await supabase.rpc('set_product_sold_out_secure', { p_store_id: storeId, p_product_id: productId, p_sold_out: soldOut });
  if (error) { console.error('setProductSoldOut falhou:', error); return false; }
  return data === true;
};

// Alerta de estoque baixo (2026-10-03): produtos com saldo abaixo do limite que o lojista definiu.
export interface LowStockAlert { name: string; stock: number | null; threshold: number }
export const fetchLowStockAlerts = async (storeId: string): Promise<LowStockAlert[]> => {
  try {
    const res = await fetch(`${resolverUrlApi('/api/estoque/alertas')}?storeId=${encodeURIComponent(storeId)}`);
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.alerts) ? json.alerts : [];
  } catch { return []; }
};

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
  if (error) {
    console.error('Fetch Active Table Orders Error', error);
    const cached = await getCachedTables(storeId);
    if (cached) return marcarFalha([...((cached.activeOrders ?? []) as Order[])]);
    return marcarFalha([] as Order[]);
  }

  const orders = (data as any) || [];
  orders.forEach((order: any) => {
    if (order.order_items) order.order_items = order.order_items.filter((item: any) => item.product);
  });
  setCachedTables(storeId, { activeOrders: orders }).catch(() => {});
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
  if (error) {
    console.error('Kitchen fetch error:', error);
    onError?.(error);
    if (isNetworkError(error)) {
      const cached = await getCachedKitchenOrders(storeId, destination);
      if (cached) return cached.items as OrderItem[];
    }
    return [];
  }
  const items = (data as any) || [];
  setCachedKitchenOrders(storeId, destination, items).catch(() => {});
  return items;
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

// Achado ao vivo (2026-08-28): esta função tem 2 chamadores independentes
// no mesmo navegador (CaixaPrintStation.tsx, sempre montado; e o
// auto-refresh de Histórico de Vendas/Dashboard em Administração,
// StoreModule.tsx) -- com o mesmo `storeId`, os dois abriam canal com o
// MESMO nome fixo (`caixa_print_${storeId}`). Antes, um login sem
// permissão de caixa nunca tinha o primeiro rodando, então nunca colidia;
// ao liberar a impressão automática pra qualquer login (isCaixaRole
// sempre true), os dois passaram a coexistir de verdade e o Supabase
// Realtime rejeita adicionar listener num canal cujo nome já está
// inscrito ("cannot add 'postgres_changes' listener... after
// subscribe()"), quebrando a aba Administração inteira. `channelKey`
// (obrigatório, cada chamador usa o próprio) garante nomes de canal
// nunca colidem entre si, mesmo escutando a mesma tabela pro mesmo storeId.
export const subscribeToStoreOrderChanges = (
  storeId: string,
  onChange: () => void,
  onStatusChange?: (status: StoreOrdersConnectionStatus) => void,
  channelKey: string = 'default',
): (() => void) => {
  const channel = supabase
    .channel(`caixa_print_${storeId}_${channelKey}`)
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
  if (error) {
    console.error('Fetch Counter Orders Error', error);
    if (isNetworkError(error)) {
      const cached = await getCachedCounterOrders(storeId);
      if (cached) return cached.orders as Order[];
    }
    return [];
  }
  const orders = (data as any) || [];
  setCachedCounterOrders(storeId, orders).catch(() => {});
  return orders;
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

export const fetchCanceledSales = async (storeId: string, startDate?: string, endDate?: string): Promise<VendasCanceladas | null> => {
  const { data, error } = await supabase.rpc('fetch_canceled_sales_secure', {
    p_store_id: storeId,
    p_start_date: startDate || null,
    p_end_date: endDate || null,
  });
  if (error) { console.error('Fetch Canceled Sales Error', error); return null; }
  return (data as VendasCanceladas) ?? { pedidos: [], itens: [] };
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
  try {
    if (paymentData) {
      const paymentMethod = paymentData.methods.length === 1 ? paymentData.methods[0].method : 'MULTIPLE';
      const res = await fetch(resolverUrlApi('/api/orders/pagamento-balcao'), {
        method: 'POST',
        headers: cabecalhosApi(),
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
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    await enqueue('close_counter_order', { orderId, paymentData: paymentData || null, destinatario });
  }
};

// "Balcão paga primeiro" (pedido do André, 2026-09-11) — as duas metades de
// `closeCounterOrder` separadas, pra poderem acontecer em momentos
// diferentes. Não é refatoração gratuita: no fluxo novo o cliente paga na
// ENTRADA e o pedido só fecha quando é entregue, minutos depois.
//
// Isso já era possível sem nenhuma mudança de schema porque as duas
// operações sempre foram independentes no banco: `/api/orders/
// pagamento-balcao` grava payment_method/payment_details e NUNCA toca em
// status; `close_counter_order_secure` (migration 021) só mexe em status.
// Elas eram chamadas juntas por hábito, não por acoplamento real.
//
// `closeCounterOrder` acima continua intacta pro fluxo de sempre (cobra no
// fim) — nenhuma loja que não ligar a chave muda de comportamento.

// Passo 1 do fluxo "paga primeiro": registra o pagamento (e emite a nota)
// SEM fechar o pedido — ele segue vivo até ser entregue.
export const registrarPagamentoBalcao = async (
  orderId: string,
  paymentData: { total: number; methods: { method: string; amount: number; brand?: string | null }[]; emitir_nota?: boolean; cash_shift_id?: string },
  destinatario?: { cpfCnpj: string; nome: string },
  // Só usado no caminho OFFLINE, pra achar o cache certo (ver abaixo).
  storeId?: string,
) => {
  try {
    const paymentMethod = paymentData.methods.length === 1 ? paymentData.methods[0].method : 'MULTIPLE';
    const res = await fetch(resolverUrlApi('/api/orders/pagamento-balcao'), {
      method: 'POST',
      headers: cabecalhosApi(),
      body: JSON.stringify({ orderId, paymentMethod, paymentDetails: paymentData }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message || 'Falha ao registrar o pagamento do pedido de balcão.');
    }
    // A venda se consumou aqui (o dinheiro entrou), então é aqui que a nota
    // sai — não na entrega. A Ordem de Produção (baixa de estoque) continua
    // no fechamento, junto da entrega, que é quando a comida de fato saiu.
    triggerEmissaoFiscal({ orderId, destinatario });
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    await enqueue('registrar_pagamento_balcao', { orderId, paymentData, destinatario });
    // Marca como pago TAMBÉM no cache local. Sem isto (achado de revisão
    // independente, 2026-09-13), offline o pedido voltava pra tela ainda
    // como "Receber pagamento": o `load()` seguinte relê do cache, onde o
    // pagamento não existia. O operador, com o dinheiro já no caixa, não
    // tinha como entregar (o botão "Entregar" nunca aparecia) e cobrava de
    // novo achando que não tinha pego — e a fila offline não deduplica, ou
    // seja, N pagamentos enfileirados pro mesmo pedido.
    if (storeId) await marcarPedidoBalcaoPagoNoCache(storeId, orderId, paymentData).catch(() => {});
  }
};

// Espelha no cache offline o pagamento que ficou só na fila de sincronização
// (ver acima). Mesmo shape que `/api/orders/pagamento-balcao` grava, pra tela
// enxergar exatamente o que enxergaria online.
const marcarPedidoBalcaoPagoNoCache = async (
  storeId: string,
  orderId: string,
  paymentData: { total: number; methods: { method: string; amount: number; brand?: string | null }[] },
) => {
  const cached = await getCachedCounterOrders(storeId);
  if (!cached?.orders) return;
  const atualizados = (cached.orders as Order[]).map((o) =>
    o.id === orderId
      ? { ...o, payment_method: paymentData.methods.length === 1 ? paymentData.methods[0].method : 'MULTIPLE', payment_details: paymentData as any }
      : o,
  );
  await setCachedCounterOrders(storeId, atualizados);
};

// Passo final do fluxo "paga primeiro": entrega o pedido já pago.
export const entregarPedidoBalcao = async (orderId: string) => {
  try {
    const { error } = await supabase.rpc('close_counter_order_secure', { p_order_id: orderId });
    if (error) throw error;
    triggerOrdemProducao({ orderId });
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    await enqueue('close_counter_order', { orderId, paymentData: null, destinatario: undefined });
  }
};

// Nota fiscal já autorizada da venda que está sendo estornada — a rota
// devolve isto (409) em vez de estornar, pra tela poder avisar QUAL
// documento fica órfão antes de o operador confirmar.
export interface EstornoNotaAutorizada {
  id: string;
  numero: number | null;
  serie: number | null;
  modelo: string | null;
  chave_acesso: string | null;
}

// Desfaz o pagamento de um pedido de balcão ainda não entregue (ver a rota).
// NÃO é fire-and-forget nem tem caminho offline de propósito: estorno mexe
// em dinheiro já registrado no turno, então ou acontece agora, com a
// confirmação do servidor, ou o operador precisa saber que não aconteceu.
//
// `operatorUserId`/`operatorName` são obrigatórios do lado da rota: o
// estorno vira evento em `cash_shift_audit_events` (migration 074), que é
// o que faz a aba Auditoria do Caixa saber quem tirou o dinheiro do
// esperado do turno. `storeId` existe pra rota (service role) não aceitar
// estornar pedido de outra loja.
//
// Retorno: `{}` quando estornou. `{ notaAutorizada }` quando a rota
// RECUSOU porque a venda tem nota fiscal autorizada e falta o de-acordo
// explícito — a tela mostra a nota e chama de novo com
// `confirmarNotaAutorizada: true`. Qualquer outra recusa é `throw`.
export const estornarPagamentoBalcao = async (
  orderId: string,
  params: {
    storeId: string;
    operatorUserId: string | null;
    operatorName: string;
    confirmarNotaAutorizada?: boolean;
  },
): Promise<{ notaAutorizada?: EstornoNotaAutorizada }> => {
  const res = await fetch(resolverUrlApi('/api/orders/pagamento-balcao'), {
    method: 'POST',
    headers: cabecalhosApi(),
    body: JSON.stringify({ orderId, estornar: true, ...params }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body?.notaAutorizada && !params.confirmarNotaAutorizada) {
      return { notaAutorizada: body.notaAutorizada as EstornoNotaAutorizada };
    }
    throw new Error(body?.message || 'Falha ao estornar o pagamento.');
  }
  return {};
};

// Integração ntb-vendas -> ntb-estoque (2026-07-07, ver AGENTS.md): dispara a
// rota interna (service role, nunca vê chave nem RLS do lado do browser) que
// cria+conclui a Ordem de Produção correspondente no ntb-estoque. Só lojas
// com store_ntb_estoque_secrets configurado participam — as demais recebem
// { skipped: true } e não acontece nada. Fire-and-forget de propósito: um
// erro aqui nunca pode impedir o fechamento do pedido, que já aconteceu.
export const triggerOrdemProducao = (body: { orderId?: string; tableId?: string }) => {
  fetch(resolverUrlApi('/api/integracao/ordem-producao'), {
    method: 'POST',
    headers: cabecalhosApi(),
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
export const triggerEmissaoFiscal = (body: { orderId?: string; tableId?: string; destinatario?: { cpfCnpj: string; nome: string } }) => {
  fetch(resolverUrlApi('/api/fiscal/emitir'), {
    method: 'POST',
    headers: cabecalhosApi(),
    body: JSON.stringify(body),
  }).catch((e) => console.error('Emissão fiscal automática falhou:', e));
};

// Fase 5, Task 19 (plano "Fora do Cardápio"): push real (funciona com o app
// do cliente fechado) — mesmo padrão fire-and-forget de triggerOrdemProducao/
// triggerEmissaoFiscal acima, mas EXPORTADA porque quem dispara é o KDS
// (StoreModule.tsx, advanceStatus), não outra função deste arquivo. Loja/
// ambiente sem VAPID configurado responde `{ok:false}` sem erro nenhum — ver
// app/api/push/send/route.ts.
export const triggerPushForOrder = (orderId: string, title: string, body: string) => {
  fetch(resolverUrlApi('/api/push/send'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, title, body }),
  }).catch((e) => console.error('Push notification falhou:', e));
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

  const rpcPayload = {
    p_table_id: tableId,
    p_store_id: storeId,
    p_order_type: isCounter ? 'counter' : 'table',
    p_customer_name: customerName || null,
    p_items: pItems,
    p_added_by_role: addedByRole,
    p_added_by_name: addedByName || null,
    // Identidade única deste pedido: se ele for reenviado (fila offline depois de a resposta se perder), o servidor
    // reconhece e não cria outro (create_order_v3, migration 162).
    p_client_request_id: crypto.randomUUID(),
  };

  try {
    // Garçom: confirma a conexão de verdade antes de esperar a resposta do servidor
    // (Wi-Fi sem internet deixaria o app pendurado); sem conexão vai direto pra fila local.
    if (addedByRole === 'garcom' && !(await checkRealConnectivity())) throw new TypeError('Failed to fetch (sem conexão)');
    const data = await chamarCriarPedido(rpcPayload);
    if (!data?.success) throw new Error(data?.message || 'Erro ao criar pedido.');
    return { success: true, orderId: data.order_id };
  } catch (error) {
    if (!isNetworkError(error)) {
      // Erro de NEGÓCIO (ex. mesa com PIN errado, item indisponível) —
      // nunca enfileira, sobe normal igual sempre subiu.
      console.error('Create Order Error', error);
      throw error;
    }
    // Achado real e GRAVE (WhatsApp, 2026-09-10): `addedByRole === 'cliente'`
    // roda dentro de `ClientModule.tsx` — o CELULAR DO PRÓPRIO CLIENTE, não
    // um equipamento da loja. Esse app nunca chama `startOfflineSync()`
    // (só `StoreLayout`, do painel do lojista, chama), então um pedido
    // enfileirado aqui NUNCA sincroniza sozinho: o cliente vê "Pedido
    // enviado!" (sucesso falso), fecha a aba/guarda o celular, e o pedido
    // fica preso pra sempre no IndexedDB daquele navegador específico —
    // pior que o comportamento de antes do modo offline existir (que pelo
    // menos mostrava erro na hora e deixava o cliente tentar de novo com
    // internet). Pra garçom (`'garcom'`, equipamento fixo da loja, com
    // `startOfflineSync()` rodando) o enfileiramento continua correto e
    // necessário — só o caminho do cliente final precisa continuar
    // falhando alto, do jeito já testado em produção há meses.
    if (addedByRole === 'cliente') throw error;
    const localOrderId = `local_${crypto.randomUUID()}`;
    await enqueue('create_order', { ...rpcPayload, localOrderId });
    return { success: true, orderId: localOrderId };
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
  try {
    const { error } = await supabase.rpc('update_order_item_status_secure', { p_item_id: itemId, p_status: status });
    if (error) throw error;
    return { success: true };
  } catch (error) {
    if (!isNetworkError(error)) {
      console.error('Update Order Item Status Error:', error);
      return { success: false, message: (error as Error).message };
    }
    await enqueue('update_order_item_status', { p_item_id: itemId, p_status: status });
    return { success: true };
  }
};

// Migration 159: o servidor confere o papel do operador (cancel_order_item_v2). Sem operador = recusado.
export const cancelSpecificOrderItem = async (itemId: string, operatorUserId?: string | null, operatorName?: string, reason?: string | null, acao: 'cancelar_item' | 'cancelar_pedido' = 'cancelar_item'): Promise<boolean> => {
  const { data, error } = await supabase.rpc('cancel_order_item_v2', {
    p_item_id: itemId,
    p_operator_user_id: operatorUserId ?? null,
    p_operator_name: operatorName ?? null,
    p_reason: reason ?? null,
    p_action: acao,
  });
  if (error) { console.error('cancelSpecificOrderItem falhou:', error); return false; }
  return (data as { success?: boolean } | null)?.success === true;
};

// Relatório de exceções do período (migration 150). Vazio se a RPC ainda não existe (app novo, banco antigo).
export const fetchExceptionsReport = async (storeId: string, from: Date, to: Date): Promise<import('@/lib/excecoes').ExceptionsReport> => {
  const vazio = { by_operator: [], events: [], notas_canceladas: { count: 0, valor: 0 } };
  const { data, error } = await supabase.rpc('fetch_exceptions_report_secure', { p_store_id: storeId, p_from: from.toISOString(), p_to: to.toISOString() });
  if (error || !data) { if (error) console.error('fetchExceptionsReport falhou:', error); return vazio; }
  return data as import('@/lib/excecoes').ExceptionsReport;
};

// Abertura manual pelo lojista (ex.: balcão abrindo mesa direto) — sem PIN,
// mas ainda grava a sessão para entrar na métrica de tempo médio de ocupação.
// Devolve `{queued}` pra quem chama saber se a mesa realmente abriu no
// servidor agora ou só ficou na fila offline — achado real (WhatsApp
// 2026-09-09): o call-site usava `navigator.onLine` pra decidir se valia
// a pena recarregar os dados depois, mas esse flag pode ficar `true` com
// wifi conectado sem internet de verdade (mesmo problema documentado em
// `lib/offline/network.ts`), causando o mesmo sintoma de novo em rede
// "falsamente online". Como só existe um call-site hoje
// (`StoreModule.tsx`), mudar o retorno de `void` pra `{queued: boolean}`
// é seguro — nenhum outro lugar depende do formato antigo.
export const openTableManually = async (tableId: string, storeId: string, hostName: string): Promise<{ queued: boolean }> => {
  try {
    const { error } = await supabase.rpc('open_table_manually_secure', { p_table_id: tableId, p_store_id: storeId, p_host_name: hostName });
    if (error) throw error;
    return { queued: false };
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    await enqueue('open_table_manually', { p_table_id: tableId, p_store_id: storeId, p_host_name: hostName });
    return { queued: true };
  }
};

export const requestTableBill = async (tableId: string) => {
  const { error } = await supabase.rpc('request_table_bill_secure', { p_table_id: tableId });
  if (error) throw error;
};

export const cancelTableBillRequest = async (tableId: string) => {
  const { error } = await supabase.rpc('cancel_table_bill_request_secure', { p_table_id: tableId });
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
  const paymentMethod = paymentData
    ? (paymentData.methods.length === 1 ? paymentData.methods[0].method : 'MULTIPLE')
    : null;

  try {
    const { error: closeErr } = await supabase.rpc('close_table_orders_secure', {
      p_table_id: tableId,
      p_payment_method: paymentMethod,
      p_payment_details: paymentData || null,
    });
    if (closeErr) throw closeErr;

    const { error: finalizeErr } = await supabase.rpc('finalize_table_secure', { p_table_id: tableId });
    if (finalizeErr) throw finalizeErr;

    if (vendaTemCobranca(paymentData)) {
      triggerOrdemProducao({ tableId });
      triggerEmissaoFiscal({ tableId, destinatario });
    }
    return { success: true };
  } catch (e) {
    if (!isNetworkError(e)) {
      return { success: false, message: (e as Error).message || 'Erro desconhecido.' };
    }
    // As duas RPCs (close + finalize) E os dois triggers fire-and-forget
    // (Ordem de Produção, emissão fiscal) ficam pra rodar juntos quando
    // a ação sincronizar de verdade (ver Task 8) — nunca no clique offline.
    await enqueue('close_table_session', { tableId, paymentMethod, paymentData: paymentData || null, destinatario });
    return { success: true };
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
  closing_cash_breakdown: Record<string, number> | null;
  approved_by_user_id: string | null;
  status: 'open' | 'closed';
  notes: string | null;
}

// `operatorUserId` obrigatório desde a migration 062 ("caixa por
// operador") — devolve o turno aberto DESTE operador especificamente,
// não "o turno da loja" (agora pode haver mais de um aberto ao mesmo
// tempo, um por operador). `null` pra conta universal (mesmo
// tratamento de sempre, ver openCashShift abaixo).
export const fetchOpenCashShift = async (storeId: string, operatorUserId: string | null): Promise<CashShift | null> => {
  try {
    const { data, error } = await supabase.rpc('fetch_open_cash_shift_secure', { p_store_id: storeId, p_operator_user_id: operatorUserId });
    if (error) throw error;
    const shift = (data as CashShift) || null;
    // Fire-and-forget: cacheia o resultado real (inclusive `null`, que
    // vira "confirmamos que não há turno") pra usar de fallback na
    // próxima falha de rede. Nunca bloqueia o retorno desta função.
    setCachedCashShift(storeId, operatorUserId, shift).catch(() => {});
    return shift;
  } catch (error) {
    if (!isNetworkError(error)) {
      // Mesmo comportamento de sempre pra erro que não é de rede: nunca
      // sobe, só devolve null (esta function nunca lançou pro caller).
      return null;
    }
    // Falha de rede de verdade: usa o último turno conhecido em vez de
    // "sem turno" — é isso que corrige o bug achado na Task 10 (fechar
    // mesa/balcão/abrir aba Caixa offline não pode mais se comportar
    // como se o turno genuinamente aberto não existisse).
    const cached = await getCachedCashShift(storeId, operatorUserId);
    return (cached?.shift as CashShift | null) ?? null;
  }
};

// Lista TODOS os turnos abertos agora numa loja (qualquer operador) — pro
// dashboard/visão gerencial, que precisa saber "quantos caixas estão
// abertos e por quem" desde que deixou de ser sempre 0 ou 1 (migration
// 062). `fetchOpenCashShift` (singular, acima) continua sendo "o MEU
// turno", usado pra liberar pagamento/mostrar a tela de Caixa.
export const fetchOpenCashShifts = async (storeId: string): Promise<(CashShift & { operator_name: string | null })[]> => {
  const { data, error } = await supabase.rpc('fetch_open_cash_shifts_secure', { p_store_id: storeId });
  if (error) { console.error('Error fetching open cash shifts:', error); return []; }
  return (data as (CashShift & { operator_name: string | null })[]) || [];
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
  try {
    const { data, error } = await supabase.rpc('open_cash_shift_secure', {
      p_store_id: storeId,
      p_operator_user_id: operatorUserId,
      p_opening_float: openingFloat,
      p_notes: notes ?? null,
    });
    if (error) throw error;
    return data as { success: boolean; id?: string; message?: string };
  } catch (e) {
    if (!isNetworkError(e)) {
      return { success: false, message: (e as Error).message };
    }
    // Cache otimista: sem isso, um `fetchOpenCashShift` chamado
    // logo em seguida (ex. handleFinishPayment na MESMA sessão
    // offline) ainda veria o cache antigo (sem turno, ou o turno
    // anterior já fechado) e bloquearia o pagamento mesmo com o
    // turno recém-aberto (ainda offline) esperando na fila.
    //
    // C2 da revisão final (2026-09-08, ver task-12-report.md): esse
    // `local_<uuid>` NUNCA era resolvido pro id real do turno depois que a
    // RPC `open_cash_shift_secure` de fato criava um — toda ação seguinte
    // que referenciasse o turno (sangria, fechamento, pagamento de
    // mesa/balcão) ficava enfileirada com o id FALSO pra sempre. Corrigido
    // reusando o MESMO id local (não gerar outro) como `localShiftId` no
    // payload da ação, pro sync engine (lib/offline/sync.ts, case
    // 'open_cash_shift') poder gravar `idMap.set(localShiftId, data.id)`
    // quando a ação sincronizar de verdade — mesmo padrão já usado por
    // `localOrderId` em `createOrder`.
    const localShiftId = `local_${crypto.randomUUID()}`;
    await enqueue('open_cash_shift', {
      p_store_id: storeId,
      p_operator_user_id: operatorUserId,
      p_opening_float: openingFloat,
      p_notes: notes ?? null,
      localShiftId,
    });
    const optimisticShift: CashShift = {
      id: localShiftId,
      store_id: storeId,
      operator_user_id: operatorUserId ?? '',
      opened_at: new Date().toISOString(),
      closed_at: null,
      opening_float: openingFloat,
      closing_counted_cash: null,
      closing_cash_breakdown: null,
      approved_by_user_id: null,
      status: 'open',
      notes: notes ?? null,
    };
    setCachedCashShift(storeId, operatorUserId, optimisticShift).catch(() => {});
    return { success: true };
  }
};

// Task 4 (frente-de-caixa): sangria/suprimento — `register_cash_movement_secure`
// (migration 051) já revalida type/amount/turno aberto no servidor; este
// wrapper só repassa e normaliza o formato de retorno.
export const registerCashMovement = async (
  shiftId: string,
  type: 'sangria' | 'suprimento',
  amount: number,
  reason: string,
  operatorName?: string,
  alertThreshold?: number,
): Promise<{ success: boolean; id?: string; message?: string }> => {
  try {
    const { data, error } = await supabase.rpc('register_cash_movement_secure', {
      p_shift_id: shiftId,
      p_type: type,
      p_amount: amount,
      p_reason: reason,
      p_operator_name: operatorName ?? null,
      p_alert_threshold: alertThreshold ?? null,
    });
    if (error) throw error;
    return data as { success: boolean; id?: string; message?: string };
  } catch (e) {
    if (!isNetworkError(e)) {
      return { success: false, message: (e as Error).message };
    }
    await enqueue('register_cash_movement', {
      p_shift_id: shiftId,
      p_type: type,
      p_amount: amount,
      p_reason: reason,
      p_operator_name: operatorName ?? null,
      p_alert_threshold: alertThreshold ?? null,
    });
    return { success: true };
  }
};

// Task 4: resumo do turno pra tela de fechamento — total por forma de
// pagamento, sangria/suprimento, esperado em dinheiro (fundo de troco +
// vendas em dinheiro + suprimento - sangria) e, se já fechado,
// contado/diferença persistidos. Ver `fetch_cash_shift_summary_secure`
// (migration 051) pro formato exato.
export interface CashShiftSummary {
  shift: CashShift;
  totals_by_method: Record<string, number>;
  // Achado real (auditoria "o que falta", 2026-08-27 — item B11 da
  // reunião): só crédito/débito têm bandeira; pagamento sem bandeira
  // escolhida (campo opcional) não entra aqui.
  totals_by_brand: Record<string, number>;
  /** Crédito e débito separados por bandeira, chave "CREDIT|visa" (migration 147). Ausente antes dela. */
  totals_by_card?: Record<string, number>;
  /** Contas pagas e total recebido no turno, sem dupla contagem (migration 147). Ticket médio = total / contas. */
  payments_count?: number;
  payments_total?: number;
  total_sangria: number;
  total_suprimento: number;
  expected_cash: number;
  closing_counted_cash: number | null;
  difference: number | null;
  /** Taxa de serviço das contas do turno (migration 137). Ausente antes dela. */
  service_fee_total?: number;
  service_fee_count?: number;
  /** Cada produto-taxa lançado no turno (migration 139). Ausente antes dela. */
  fees_by_product?: Record<string, { tipo: 'fixed' | 'percent'; quantidade: number; total: number }>;
}

// Task 13 (fix offline): mesmo padrão de `fetchOpenCashShift` acima — só
// cai pro cache em erro de rede genuíno (`isNetworkError`); erro que não é
// de rede continua devolvendo `null` exatamente como antes. Cache aqui só
// ajuda quando o modal já tinha sido aberto ONLINE antes de cair a conexão
// (não existe cache pra um turno aberto direto offline — esse caso é
// coberto pela UI em StoreModule.tsx, que nunca mais bloqueia o fechamento
// por falta de resumo).
export const fetchCashShiftSummary = async (shiftId: string): Promise<CashShiftSummary | null> => {
  try {
    const { data, error } = await supabase.rpc('fetch_cash_shift_summary_secure', { p_shift_id: shiftId });
    if (error) throw error;
    if (!data) return null;
    setCachedCashShiftSummary(shiftId, data).catch(() => {});
    return data as CashShiftSummary;
  } catch (error) {
    if (!isNetworkError(error)) return null;
    const cached = await getCachedCashShiftSummary(shiftId);
    return (cached?.summary as CashShiftSummary) ?? null;
  }
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
  closingCashBreakdown?: Record<string, number> | null,
  maxTolerance?: number | null,
  approvedByUserId?: string | null,
): Promise<{ success: boolean; requires_approval?: boolean; expected_cash?: number; closing_counted_cash?: number; difference?: number; message?: string }> => {
  try {
    const { data, error } = await supabase.rpc('close_cash_shift_secure', {
      p_shift_id: shiftId,
      p_closing_counted_cash: closingCountedCash,
      p_closing_cash_breakdown: closingCashBreakdown ?? null,
      p_max_tolerance: maxTolerance ?? null,
      p_approved_by_user_id: approvedByUserId ?? null,
    });
    if (error) throw error;
    return data as { success: boolean; requires_approval?: boolean; expected_cash?: number; closing_counted_cash?: number; difference?: number; message?: string };
  } catch (e) {
    if (!isNetworkError(e)) {
      return { success: false, message: (e as Error).message };
    }
    await enqueue('close_cash_shift', {
      p_shift_id: shiftId,
      p_closing_counted_cash: closingCountedCash,
      p_closing_cash_breakdown: closingCashBreakdown ?? null,
      p_max_tolerance: maxTolerance ?? null,
      p_approved_by_user_id: approvedByUserId ?? null,
    });
    return { success: true };
  }
};

export const verifyCashSupervisor = async (
  storeId: string,
  email: string,
  password: string,
): Promise<{ success: boolean; user_id?: string; name?: string; message?: string }> => {
  const { data, error } = await supabase.rpc('verify_cash_supervisor_secure', {
    p_store_id: storeId,
    p_email: email,
    p_password: password,
  });
  if (error) return { success: false, message: error.message };
  return data as { success: boolean; user_id?: string; name?: string; message?: string };
};

export interface CashShiftAuditEvent {
  id: string;
  store_id: string;
  shift_id: string | null;
  operator_user_id: string | null;
  operator_name: string;
  event_type: 'item_cancelado' | 'sangria_grande' | 'tolerancia_excedida' | 'pagamento_estornado';
  details: Record<string, any>;
  created_at: string;
}

export const fetchCashShiftAudit = async (
  storeId: string,
  shiftId?: string | null,
  operatorUserId?: string | null,
  limit: number = 50,
): Promise<CashShiftAuditEvent[]> => {
  const { data, error } = await supabase.rpc('fetch_cash_shift_audit_secure', {
    p_store_id: storeId,
    p_shift_id: shiftId ?? null,
    p_operator_user_id: operatorUserId ?? null,
    p_limit: limit,
  });
  if (error) { console.error('Error fetching cash shift audit:', error); return []; }
  return (data as CashShiftAuditEvent[]) || [];
};

export const toggleTableBlock = async (tableId: string, _currentStatus: TableStatus) => {
  const { error } = await supabase.rpc('toggle_table_block_secure', { p_table_id: tableId });
  if (error) throw error;
};

export const moveTable = async (sourceTableId: string, targetTableId: string, operatorUserId: string | null = null): Promise<{ success: boolean; message?: string }> => {
  const { data, error } = await supabase.rpc('move_table_v2', {
    p_source_table_id: sourceTableId,
    p_target_table_id: targetTableId,
    p_operator_user_id: operatorUserId,
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
// "Meu Perfil" (migration 078) — mesmo mecanismo de upload de sempre, só um
// nome próprio pra deixar claro o que está sendo enviado nos call sites.
export const uploadUserPhoto = async (file: File): Promise<string> => uploadToCloudinary(file);

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
    const res = await fetch(resolverUrlApi('/api/certificado'), { method: 'POST', body: form });
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
  nfceSerieProducao?: number;
  nfceUltimoNumeroProducao?: number;
  nfeSerieProducao?: number;
  nfeUltimoNumeroProducao?: number;
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
    const res = await fetch(resolverUrlApi('/api/integracao/configurar'), {
      method: 'POST',
      headers: cabecalhosApi(),
      body: JSON.stringify({ storeId, ...params }),
    });
    return await res.json();
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

// Baixas de estoque (outbox, migration 156): estado do que a venda mandou para o Estoque. A lista traz só o que NÃO
// está ok. As ações (tentar de novo / já conferi) passam pela rota do servidor, que é quem fala com o Estoque.
export interface BaixaEstoqueItem {
  codigo: string; status: 'ok' | 'erro' | 'incerto'; retentavel: boolean; tentativas: number; erro?: string; detalhe?: string;
}
export interface BaixaEstoque {
  id: string; order_id: string; rotulo: string | null; status: 'pending' | 'parcial' | 'erro' | 'incerto';
  tentativas: number; ultimo_erro: string | null; resultado: (BaixaEstoqueItem | null)[]; total_itens: number;
  proxima_tentativa: string; created_at: string; updated_at: string;
}
export interface BaixasEstoqueResumo { pendentes: number; com_erro: number; itens: BaixaEstoque[] }

export const fetchIntegracaoBaixas = async (storeId: string): Promise<BaixasEstoqueResumo> => {
  const { data, error } = await supabase.rpc('fetch_integracao_baixas_secure', { p_store_id: storeId, p_limite: 50 });
  // Lança em erro (rede, ou a migration 156 ainda não aplicada): quem chama decide. O sino não pode tratar falha de leitura
  // como "sem baixas" (resolveria avisos que ainda valem).
  if (error || !data) throw new Error(error?.message || 'Falha ao ler as baixas de estoque');
  return data as BaixasEstoqueResumo;
};

export const acaoBaixaEstoque = async (
  storeId: string,
  id: string,
  acao: 'reprocessar' | 'conferir',
  quem?: string,
): Promise<{ success: boolean; message?: string; status?: string }> => {
  try {
    const res = await fetch(resolverUrlApi('/api/integracao/baixas'), {
      method: 'POST',
      headers: cabecalhosApi(),
      body: JSON.stringify({ storeId, id, acao, quem }),
    });
    return await res.json();
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

// Chave direta da Omie (store_omie_secrets, migration 071) — pra lojas
// que NÃO usam ntb-estoque, registra a NFC-e autorizada direto na Omie
// (ver app/api/fiscal/emitir/route.ts). Mesmo princípio write-only já
// usado em fetchNtbEstoqueIntegracaoStatus/saveNtbEstoqueIntegracaoConfig
// logo acima: status via RPC (nunca expõe a chave), escrita via rota
// própria (service role).
export interface OmieDiretoStatus {
  configurado: boolean;
}

export const fetchOmieDiretoStatus = async (storeId: string): Promise<OmieDiretoStatus> => {
  const { data, error } = await supabase.rpc('fetch_omie_direto_status_secure', { p_store_id: storeId });
  if (error) {
    console.error('fetchOmieDiretoStatus: falha ao chamar fetch_omie_direto_status_secure (RPC pode não ter sido recarregada pelo PostgREST — ver NOTIFY pgrst, "reload schema" após aplicar a migration):', error);
    return { configurado: false };
  }
  if (!data) return { configurado: false };
  return data as OmieDiretoStatus;
};

export const saveOmieDiretoConfig = async (
  storeId: string,
  params: { omieAppKey: string; omieAppSecret: string }
): Promise<{ success: boolean; message?: string }> => {
  try {
    const res = await fetch(resolverUrlApi('/api/integracao/omie-direto'), {
      method: 'POST',
      headers: cabecalhosApi(),
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
  cnpj?: string,
  stockMode?: ModoEstoque
): Promise<{ success: boolean; message?: string }> => {
  try {
    const res = await fetch(resolverUrlApi('/api/integracao/criar-loja-estoque'), {
      method: 'POST',
      headers: cabecalhosApi(),
      body: JSON.stringify({ storeId, nome, cnpj, stockMode }),
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

// Reunião 2026-09-10 (min 14:34): ao fechar a venda o app só imprimia o
// comprovante SEM valor fiscal — a nota autorizada ficava só em
// Administração → Notas Fiscais, e quem quisesse o cupom tinha que pedir
// pra alguém com acesso administrativo. "Mas ele deveria imprimir a nota
// fiscal automaticamente quando encerra, certo?" — "Deveria."
//
// A emissão é assíncrona (triggerEmissaoFiscal é fire-and-forget e passa
// pela SEFAZ), então no instante do fechamento a nota ainda não existe.
// Esta função espera em poll curto, com teto: estourou o tempo ou a nota
// voltou rejeitada, devolve null e quem chamou segue com o comprovante
// normal — NUNCA trava o caixa.
//
// Lê via `fetch_fiscal_notas_secure` (não `.from('fiscal_notas')`): essa
// tabela não tem policy de SELECT pro anon — confirmado ao vivo, o select
// direto devolve [] sem erro, o mesmo jeito silencioso já documentado no
// AGENTS.md pra `tables`.
export const aguardarNotaFiscalDaVenda = async (
  storeId: string,
  alvo: { orderId?: string; tableId?: string },
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ pdfUrl: string; nota: FiscalNota } | null> => {
  // 60 s: a SEFAZ às vezes leva 20 s+ (Sertão, 29/09: nota nº 6 autorizou 22 s depois do pagamento e o teto de
  // 12 s já tinha estourado — o cupom não saiu sozinho). Rejeição/erro continuam devolvendo na hora.
  const timeoutMs = opts.timeoutMs ?? 60000;
  const intervalMs = opts.intervalMs ?? 1500;
  const limite = Date.now() + timeoutMs;
  // Bug real achado ao vivo (2026-09-15): quando o fechamento usa `tableId`
  // (mesa, não `orderId`), o filtro batia com QUALQUER nota já emitida
  // alguma vez naquela mesa — uma mesa física é reaproveitada por vários
  // pedidos ao longo do dia. Se o primeiro poll rodasse ANTES da nota NOVA
  // desta venda ainda existir no banco (emissão é assíncrona), a nota mais
  // recente ENCONTRADA era uma autorizada antiga de uma venda anterior
  // daquela mesma mesa — e essa nota errada (valor/chave de outro cliente)
  // era devolvida como se fosse a desta venda, sem nenhum aviso. Confirmado
  // ao vivo: imprimiu o cupom de uma venda de R$49,39 de 40 min atrás numa
  // venda de R$206,69 que tinha acabado de fechar na mesma mesa. Corrigido
  // rejeitando qualquer nota cujo `created_at` seja anterior ao início
  // desta espera — só aceita nota genuinamente NOVA desta chamada (folga de
  // 5s pra cobrir clock skew entre o relógio do navegador e o do Postgres).
  const inicioEspera = Date.now() - 5000;

  while (Date.now() < limite) {
    try {
      const notas = await fetchFiscalNotas(storeId);
      const daVenda = notas
        // Só a nota do fechamento inteiro: nota individual por pessoa
        // (migration 055) já é tratada no próprio fluxo "Por pessoa".
        .filter((n: any) => !n.pessoa_identificador)
        .filter((n: any) => (alvo.orderId ? n.order_id === alvo.orderId : n.table_id === alvo.tableId))
        .filter((n: any) => new Date(n.created_at).getTime() >= inicioEspera)
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] as any;

      if ((daVenda?.status === 'autorizada' || daVenda?.status === 'contingencia') && daVenda.pdf_path) {
        const pdfUrl = await fetchFiscalNotaPdfUrl(daVenda.id, daVenda.pdf_path);
        if (pdfUrl) return { pdfUrl, nota: daVenda as FiscalNota };
      }
      // Rejeitada pela SEFAZ ou erro de transmissão: documento definitivo
      // não vai aparecer, não adianta continuar esperando o tempo todo.
      // Achado ao vivo (2026-09-15): só tratava 'erro', então uma
      // REJEIÇÃO (ex.: cStat=899, campo de pagamento inválido) fazia esta
      // função esperar o timeout inteiro (12s) sem motivo antes de
      // devolver null — a mesma coisa acontecia mais rápido tratando os
      // dois estados terminais juntos.
      if (daVenda?.status === 'erro' || daVenda?.status === 'rejeitada' || daVenda?.status === 'pendente') return null;
    } catch {
      // Rede instável não pode travar o fechamento — tenta de novo até o teto.
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
};

// Só lê: devolve o estado da nota MAIS RECENTE desta venda (criada de agora em
// diante) pra o operador saber por que o cupom não abriu. null = ainda não
// existe (SEFAZ demorando).
export const descreverFalhaFiscalDaVenda = async (
  storeId: string,
  alvo: { orderId?: string; tableId?: string },
  desde: number = Date.now() - 60000,
): Promise<{ status: string; motivo: string | null } | null> => {
  const inicio = desde;
  const notas = await fetchFiscalNotas(storeId);
  const nota = notas
    .filter((n: any) => !n.pessoa_identificador)
    .filter((n: any) => (alvo.orderId ? n.order_id === alvo.orderId : n.table_id === alvo.tableId))
    .filter((n: any) => new Date(n.created_at).getTime() >= inicio)
    .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] as any;
  return nota ? { status: nota.status, motivo: nota.motivo_erro ?? null } : null;
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
  const res = await fetch(resolverUrlApi('/api/fiscal/pdf-url'), {
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
  const res = await fetch(resolverUrlApi('/api/fiscal/emitir'), {
    method: 'POST',
    headers: cabecalhosApi(),
    body: JSON.stringify(params),
  });
  return res.json();
};

// Cancelamento de nota fiscal (evento 110111) — botão "Cancelar nota" em
// Administração → Notas fiscais. Chamada síncrona (o lojista espera a
// resposta da SEFAZ na tela). A rota valida loja, status, prazo legal e
// justificativa (15–255) de novo no servidor — nada aqui é só client-side.
export const cancelarFiscalNota = async (params: {
  storeId: string;
  notaId: string;
  justificativa: string;
}): Promise<{ ok: boolean; reason?: string; aviso?: string; mensagem?: string; cStat?: string | null; xMotivo?: string | null; protocolo?: string | null; prazoEncerrado?: boolean }> => {
  const res = await fetch(resolverUrlApi('/api/fiscal/cancelar'), {
    method: 'POST',
    headers: cabecalhosApi(),
    body: JSON.stringify(params),
  });
  return res.json();
};

export interface CreateStoreParams {
  name: string;
  /** Modo de estoque (migration 168). Ausente = não mexe (createStore grava 'omie' só quando a coluna existir: ver stockModeFields). */
  stockMode?: ModoEstoque;
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
  // "Balcão paga primeiro" (pedido do André, 2026-09-11) — ver
  // applyModulesConfigFields e lib/storeModules.ts:isCounterPaymentFirst.
  counterPaymentFirst?: boolean;
  // Cardápio vitrine (2026-09-26): ver applyModulesConfigFields.
  clientOrdering?: boolean;
}

// Perfil de módulos por loja (Task 1): decide se `params.modules`/
// `params.orderFlow`/`params.printTarget` viram `config.modules`/
// `config.order_flow`/`config.print_target` de verdade. Nunca grava o
// default explícito (tudo ligado + 'kds' + 'device') — ausência de chave já
// significa isso (ver lib/storeModules.ts) — e remove a chave de um config
// existente se o admin editar uma loja de volta pro default (senão
// "desfazer" a customização no formulário nunca desfaria no banco).
// Exportada (2026-08-27, painel do lojista ganha a mesma seção "Operação"
// que só existia no Master Admin) — assinatura estreitada pro subconjunto
// que a function realmente usa, pra não obrigar quem chama de fora de
// createStore/updateStore a montar um CreateStoreParams inteiro só pra
// mudar módulos/fluxo.
export const applyModulesConfigFields = (config: Record<string, any>, params: { modules?: StoreModules; orderFlow?: OrderFlow; counterPaymentFirst?: boolean; clientOrdering?: boolean }): Record<string, any> => {
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
  // "Balcão paga primeiro" (pedido do André, 2026-09-11) — mesma regra das
  // chaves acima: só grava quando difere do default, pra loja que não mexe
  // nisso manter o config byte-idêntico ao de antes da feature.
  if (params.counterPaymentFirst === true) {
    next.counter_payment_first = true;
  } else {
    delete next.counter_payment_first;
  }
  // Cardápio vitrine (pedido do Ramon/Sertão, 2026-09-26): só `false` é
  // gravado (ausente = cliente pode pedir). `undefined` = quem chamou não
  // mexe nisso — preserva o que já está no config.
  if (params.clientOrdering === false) {
    next.client_ordering = false;
  } else if (params.clientOrdering === true) {
    delete next.client_ordering;
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
        ...stockModeFields(params.stockMode),
        config: applyModulesConfigFields({ service_fee_rate: params.serviceFeeRate }, params),
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
      .insert({ name: `${originalStore.name} (1)`, cnpj: originalStore.cnpj, slug: newSlug, contract_type: originalStore.contract_type, contract_period_months: originalStore.contract_period_months, is_active: originalStore.is_active, logo_url: originalStore.logo_url, cover_url: originalStore.cover_url, config: originalStore.config, ...stockModeFields(originalStore.stock_mode) })
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
    // Achado real ao vivo (reunião com o Ramon, 2026-08-27): trocar o
    // contrato de uma loja existente de "Balcão + Mesas" pra "Apenas
    // Balcão" só atualizava `contract_type` — as `tables` já cadastradas
    // continuavam lá pra sempre, ambíguas com o próprio contrato da loja
    // ("tirei lá e deixei aqui", nas palavras do usuário). Corrigido:
    // zera as mesas quando o novo contrato é "apenas balcão"
    // (sync_store_tables_secure já suporta target 0 — usado desde sempre,
    // migration 030) — mas só quando nenhuma está OCUPADA/aguardando
    // pagamento agora, nunca apaga silenciosamente uma mesa com gente
    // sentada ou pedido em andamento. Mesa BLOQUEADA (sem atividade de
    // cliente real) pode ser removida normalmente. Checagem ANTES do
    // update de `stores`: se bloquear, a loja continua com o
    // contract_type antigo, nunca um estado pela metade (contrato mudado
    // mas mesa ainda ativa por baixo).
    if (params.contractType === 'balcao') {
      // `tables` não tem policy de SELECT pro anon (migration 031) -- um
      // `.from('tables').select(...)` direto sempre volta vazio sem erro,
      // então essa checagem só funciona via RPC security definer (bug real
      // achado em QA ao vivo 2026-08-27: mesa ocupada não bloqueava o
      // salvar antes desta correção, ver migration 060).
      const { data: activeCount, error: countErr } = await supabase.rpc('count_active_tables_secure', { p_store_id: id });
      if (countErr) console.error('Error checking active tables before clearing:', countErr);
      if (activeCount) {
        return {
          success: false,
          message: `Não foi possível mudar para "Apenas Balcão": ${activeCount} mesa(s) ocupada(s)/aguardando pagamento agora. Feche essas mesas antes de trocar o tipo de contrato.`,
        };
      }
    }

    // Busca o config atual pra só sobrescrever service_fee_rate (e o perfil
    // de módulos, ver applyModulesConfigFields), sem apagar outras flags
    // (require_pin_for_open, charge_service_fee, e as chaves antigas inertes)
    // que o lojista já pode ter configurado.
    const { data: current } = await supabase.from('stores').select('config, stock_mode').eq('id', id).single();
    // Modo de estoque (migration 168): só mexe quando o formulário mandou um modo diferente do atual. Depois da primeira baixa
    // a loja não troca de modo (o histórico ficaria em outro sistema).
    let stockModeUpdate: { stock_mode?: ModoEstoque } = {};
    if (params.stockMode !== undefined && normalizarModo(params.stockMode) !== normalizarModo(current?.stock_mode)) {
      const { data: temBaixas } = await supabase.rpc('store_tem_baixas_secure', { p_store_id: id });
      if (temBaixas) return { success: false, message: 'Esta loja já tem baixas de estoque: o modo de estoque não pode mais ser trocado.' };
      stockModeUpdate = { stock_mode: normalizarModo(params.stockMode) };
    }
    const { error } = await supabase
      .from('stores')
      .update({
        name: params.name, cnpj: params.cnpj, slug: params.slug, contract_type: params.contractType,
        contract_period_months: params.periodMonths, is_active: params.isActive, logo_url: params.logoUrl,
        cover_url: params.coverUrl,
        ...stockModeUpdate,
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
    } else {
      const { error: syncErr } = await supabase.rpc('sync_store_tables_secure', { p_store_id: id, p_target_count: 0 });
      if (syncErr) console.error('Error clearing tables:', syncErr);
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
      const res = await fetch(resolverUrlApi('/api/certificado'), {
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

// "Bater ponto" — ver migration 056. Independente de cash_shifts (turno do
// caixa físico, um só por loja): aqui é o turno pessoal do operador, vários
// podem estar abertos ao mesmo tempo na mesma loja.
export const fetchOpenCheckin = async (storeId: string, userId: string): Promise<OperatorCheckin | null> => {
  const { data, error } = await supabase.from('operator_checkins').select('*').eq('store_id', storeId).eq('user_id', userId).is('checkout_at', null).maybeSingle();
  if (error) { console.error('Error fetching open checkin:', error); return null; }
  return data;
};

// Fase 3, Task 10 (plano "Fora do Cardápio"): lista de quem está com ponto
// aberto AGORA nesta loja (todos os operadores, não um só) — usado pra
// filtrar a sugestão de escala (Task 9) a quem realmente está de plantão.
// Não precisa de RPC: `operator_checkins` já é RLS `allow_all_anon` direto
// (migration 056), mesmo nível de sensibilidade de order_ratings.
export const fetchOpenCheckinUserIds = async (storeId: string): Promise<Set<string>> => {
  const { data, error } = await supabase.from('operator_checkins').select('user_id').eq('store_id', storeId).is('checkout_at', null);
  if (error) { console.error('Error fetching open checkin user ids:', error); return new Set(); }
  return new Set((data || []).map(r => r.user_id));
};

export const startCheckin = async (storeId: string, userId: string, userName: string): Promise<OperatorCheckin | null> => {
  const { data, error } = await supabase.from('operator_checkins').insert({ store_id: storeId, user_id: userId, user_name: userName }).select('*').single();
  if (error) { console.error('Error starting checkin:', error); return null; }
  return data;
};

export const endCheckin = async (checkinId: string): Promise<{ success: boolean; message?: string }> => {
  const { error } = await supabase.from('operator_checkins').update({ checkout_at: new Date().toISOString() }).eq('id', checkinId);
  if (error) return { success: false, message: error.message };
  return { success: true };
};

export const fetchCheckinsHistory = async (storeId: string, startDate?: string, endDate?: string): Promise<OperatorCheckin[]> => {
  let query = supabase.from('operator_checkins').select('*').eq('store_id', storeId).order('checkin_at', { ascending: false }).limit(200);
  if (startDate) query = query.gte('checkin_at', startDate);
  if (endDate) query = query.lte('checkin_at', endDate);
  const { data, error } = await query;
  if (error) { console.error('Error fetching checkins history:', error); return []; }
  return data || [];
};

// Reserva de mesa direto do cardápio (Task 21, plano "Fora do Cardápio",
// 2026-08-27, migration 059) — MVP sem confirmação automática/bloqueio de
// mesa. `createReservation` é chamada pelo cliente (sem login/PIN, mesmo
// princípio de order_ratings); `fetchReservationsByStore`/
// `updateReservationStatus` são do lado do lojista (TablesView).
export const createReservation = async (params: {
  storeId: string;
  customerName: string;
  customerPhone: string;
  partySize: number;
  reservedFor: string;
}): Promise<{ success: boolean; message?: string }> => {
  const { error } = await supabase.from('table_reservations').insert({
    store_id: params.storeId,
    customer_name: params.customerName,
    customer_phone: params.customerPhone,
    party_size: params.partySize,
    reserved_for: params.reservedFor,
  });
  if (error) { console.error('Error creating reservation:', error); return { success: false, message: error.message }; }
  return { success: true };
};

// `sinceDate` opcional: TablesView só precisa das reservas de hoje em
// diante (reservas passadas não fazem sentido de aparecer numa tela
// operacional do dia a dia) — filtro por `reserved_for`, não `created_at`
// (a reserva pode ter sido CRIADA ontem pra HOJE).
export const fetchReservationsByStore = async (storeId: string, sinceDate?: string): Promise<TableReservation[]> => {
  let query = supabase.from('table_reservations').select('*').eq('store_id', storeId).order('reserved_for', { ascending: true }).limit(200);
  if (sinceDate) query = query.gte('reserved_for', sinceDate);
  const { data, error } = await query;
  if (error) { console.error('Error fetching reservations:', error); return []; }
  return data || [];
};

export const updateReservationStatus = async (reservationId: string, status: 'confirmed' | 'canceled'): Promise<{ success: boolean; message?: string }> => {
  const { error } = await supabase.from('table_reservations').update({ status }).eq('id', reservationId);
  if (error) { console.error('Error updating reservation status:', error); return { success: false, message: error.message }; }
  return { success: true };
};

// Aba "Impressão" (2026-08-27, teste na loja no dia seguinte, migration
// 061) — cadastro de impressora (browser_default/network/usb) e a fila
// de print_jobs que o agente local (print-agent/) consome pras
// impressoras 'network'/'usb'. `printer_configs`/`print_jobs` não têm o
// mesmo nível de sensibilidade de orders/tables (nome/IP de impressora,
// texto de ticket já semi-público) — allow_all_anon direto, sem RPC.
export const fetchPrinterConfigs = async (storeId: string): Promise<PrinterConfig[]> => {
  const { data, error } = await supabase.from('printer_configs').select('*').eq('store_id', storeId).order('created_at', { ascending: true });
  if (error) { console.error('Error fetching printer configs:', error); return isNetworkError(error) ? readCachedPrinters(storeId) : []; }
  cachePrinters(storeId, data || []);
  return data || [];
};

// Achado ao vivo na loja Sertão (2026-09-15): o comprovante/conferência
// (printBillReceipt, window.print()) não tinha o mesmo guard que
// CaixaPrintStation.tsx já usa pros tickets de cozinha/bar — sem essa
// checagem, TODA venda imprimia tanto pela impressora térmica cadastrada em
// printer_configs (via print_jobs) QUANTO pela janela de impressão do
// navegador, saindo duplicado (às vezes triplicado, um print_job por
// tentativa de fechar a conta) na mesma impressora física CAIXA. `destination`
// 'all' cobre config antiga/genérica que ainda não distingue destino.
// "Desativar impressões por agora" (aba Impressão, pedido do dono
// 2026-09-26): chave stores.config.printing_paused. Ligada, o app não manda
// NADA pras impressoras da loja — fila, caixa automático, cupom, comprovante
// e impressão sem internet. Serve pra testar no sistema real sem sair papel
// na loja. Cache em localStorage pro caminho sem internet.
const impressaoPausadaKey = (storeId: string) => `ntb_impressao_pausada_${storeId}`;
export const lerImpressaoPausadaCache = (storeId: string): boolean => {
  try { return typeof window !== 'undefined' && window.localStorage.getItem(impressaoPausadaKey(storeId)) === '1'; } catch { return false; }
};
const gravarImpressaoPausadaCache = (storeId: string, pausada: boolean) => {
  try { if (typeof window !== 'undefined') window.localStorage.setItem(impressaoPausadaKey(storeId), pausada ? '1' : '0'); } catch { /* sem armazenamento */ }
};
export const fetchImpressaoPausada = async (storeId: string): Promise<boolean> => {
  const { data, error } = await supabase.from('stores').select('config').eq('id', storeId).single();
  if (error) return lerImpressaoPausadaCache(storeId);
  const pausada = (data?.config as { printing_paused?: boolean } | null)?.printing_paused === true;
  gravarImpressaoPausadaCache(storeId, pausada);
  return pausada;
};
// Interruptor "Imprimir pré-conta (comanda) automaticamente": stores.config.auto_pre_conta (ausente = ligado).
export const setPreContaAutomatica = async (storeId: string, ligada: boolean): Promise<void> => {
  const { data, error } = await supabase.from('stores').select('config').eq('id', storeId).single();
  if (error) throw error;
  const config = { ...((data?.config as Record<string, unknown>) || {}) };
  if (ligada) delete config.auto_pre_conta; else config.auto_pre_conta = false;
  await updateStoreConfig(storeId, config);
};
export const setImpressaoPausada = async (storeId: string, pausada: boolean): Promise<void> => {
  const { data, error } = await supabase.from('stores').select('config').eq('id', storeId).single();
  if (error) throw error;
  const config = { ...((data?.config as Record<string, unknown>) || {}) };
  if (pausada) config.printing_paused = true; else delete config.printing_paused;
  await updateStoreConfig(storeId, config);
  gravarImpressaoPausadaCache(storeId, pausada);
  // O que já estava esperando na fila também não sai.
  if (pausada) {
    await supabase.from('print_jobs').update({ status: 'error', error_message: 'Impressões desativadas' }).eq('store_id', storeId).eq('status', 'pending');
  }
};

// Existe impressora física ativa que recebe este tipo de documento? (respeita a config "documentos" da impressora)
export const hasActivePrinterForDoc = async (storeId: string, doc: DocPrint): Promise<boolean> => {
  const { data, error } = await supabase
    .from('printer_configs')
    .select('destination, documentos')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .in('connection_type', ['network', 'usb']);
  if (error) { console.error('hasActivePrinterForDoc falhou:', error); return false; }
  const lista = (data || []) as { destination: string; documentos?: string[] | null }[];
  // Se alguma impressora já teve "documentos" configurado, o operador assumiu o controle de onde sai cada coisa:
  // um documento sem impressora marcada NÃO deve abrir a janela de impressão do navegador a cada venda.
  return lista.some((p) => impressoraRecebe(p, doc)) || lista.some((p) => p.documentos && p.documentos.length > 0);
};

export const hasActivePrinterForDestination = async (
  storeId: string,
  destination: 'receipt' | 'kitchen' | 'bar',
): Promise<boolean> => {
  const { data, error } = await supabase
    .from('printer_configs')
    .select('id')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .in('connection_type', ['network', 'usb'])
    .in('destination', [destination, 'all'])
    .limit(1);
  if (error) { console.error('hasActivePrinterForDestination falhou:', error); return false; }
  return (data || []).length > 0;
};

// Achado ao vivo, loja Sertão (2026-09-15): a reunião de 2026-09-10 pedia
// "comanda e nota fiscal têm que ir pra mesma coisa, que é a caixa" — mas
// abrirCupomFiscalQuandoSair sempre só ABRIU o PDF (pro operador imprimir
// na mão), nunca mandou de verdade pra impressora física. Só faz sentido
// pro app desktop (Electron), que sabe imprimir um PDF de verdade em
// silêncio numa impressora por nome — o navegador comum não tem essa
// capacidade. Só USB por enquanto: é o tipo de conexão que a impressora do
// caixa dessa loja usa, e é a única que webContents.print() do Electron
// consegue mirar pelo nome exato instalado no Windows.
export const fetchUsbPrinterForAutoprint = async (
  storeId: string,
  destination: 'receipt' | 'kitchen' | 'bar',
  doc?: DocPrint,
): Promise<{ usbSystemName: string; paperWidthMm: 58 | 80 | 210 } | null> => {
  if (await fetchImpressaoPausada(storeId)) return null;
  if (doc) {
    // Escolha por tipo de documento (config "documentos" da impressora).
    const { data: lista, error: erroLista } = await supabase
      .from('printer_configs')
      .select('usb_system_name, paper_width_mm, destination, documentos')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .eq('connection_type', 'usb');
    if (erroLista) { console.error('fetchUsbPrinterForAutoprint falhou:', erroLista); return null; }
    const achada = (lista || []).find((p) => p.usb_system_name && impressoraRecebe(p as { destination: string; documentos?: string[] | null }, doc));
    return achada ? { usbSystemName: achada.usb_system_name as string, paperWidthMm: achada.paper_width_mm as 58 | 80 | 210 } : null;
  }
  const { data, error } = await supabase
    .from('printer_configs')
    .select('usb_system_name, paper_width_mm')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .eq('connection_type', 'usb')
    .in('destination', [destination, 'all'])
    .limit(1)
    .maybeSingle();
  if (error) { console.error('fetchUsbPrinterForAutoprint falhou:', error); return null; }
  if (!data?.usb_system_name) return null;
  return { usbSystemName: data.usb_system_name, paperWidthMm: (data.paper_width_mm ?? 80) as 58 | 80 | 210 };
};

// Impressoras USB detectadas pelo agente local rodando no computador da
// loja (migration 065, achado ao vivo 2026-08-28: digitar o nome exato
// da impressora era fricção/erro desnecessário). Lista vazia = nenhum
// agente rodou ainda nesta loja, ou nenhuma impressora local instalada —
// a UI cai pro campo de texto livre nesse caso.
export const fetchDiscoveredPrinters = async (storeId: string): Promise<{ name: string; machine: string; kind: string; label: string }[]> => {
  const { data, error } = await supabase.from('discovered_printers').select('name, machine, kind, label').eq('store_id', storeId).order('name', { ascending: true });
  if (error) {
    console.error('Error fetching discovered printers:', error);
    try { return JSON.parse(localStorage.getItem(`ntb-discovered-cache:${storeId}`) || '[]'); } catch { return []; }
  }
  const lista = (data || []).map((row) => ({ name: row.name, machine: row.machine || '', kind: row.kind || 'system', label: row.label || '' }));
  try { localStorage.setItem(`ntb-discovered-cache:${storeId}`, JSON.stringify(lista)); } catch { /* sem cache */ }
  return lista;
};

// Achado ao vivo (2026-08-28/29): não havia nenhum jeito de o painel saber
// se o agente local estava mesmo rodando -- migration 066. `null` = agente
// nunca rodou nesta loja (nunca gravou heartbeat nenhum), distinto de
// "rodou mas está atrasado" (a UI decide isso comparando `lastSeenAt`
// contra o relógio do PRÓPRIO navegador, nunca aqui — o relógio do
// computador do agente pode estar errado).
export const fetchPrintAgentStatus = async (storeId: string): Promise<{ lastSeenAt: string; printersLoaded: number } | null> => {
  const { data, error } = await supabase.from('print_agent_status').select('last_seen_at, printers_loaded').eq('store_id', storeId).maybeSingle();
  if (error) { console.error('Error fetching print agent status:', error); return null; }
  if (!data) return null;
  return { lastSeenAt: data.last_seen_at, printersLoaded: data.printers_loaded };
};

export const createPrinterConfig = async (params: {
  storeId: string;
  name: string;
  connectionType: 'browser_default' | 'network' | 'usb';
  ipAddress?: string | null;
  port?: number;
  usbSystemName?: string | null;
  destination: 'kitchen' | 'bar' | 'all' | 'receipt';
  paperWidthMm?: 58 | 80 | 210;
}): Promise<{ success: boolean; message?: string }> => {
  const { error } = await supabase.from('printer_configs').insert({
    paper_width_mm: params.paperWidthMm ?? 80,
    store_id: params.storeId,
    name: params.name,
    connection_type: params.connectionType,
    ip_address: params.ipAddress || null,
    port: params.port || 9100,
    usb_system_name: params.usbSystemName || null,
    destination: params.destination,
  });
  if (error) { console.error('Error creating printer config:', error); return { success: false, message: error.message }; }
  return { success: true };
};

export const updatePrinterConfig = async (id: string, updates: Partial<Pick<PrinterConfig, 'name' | 'is_active' | 'ip_address' | 'port' | 'usb_system_name' | 'destination' | 'paper_width_mm' | 'print_mode' | 'machine_names' | 'bottom_margin' | 'sector_id' | 'documentos'>>): Promise<{ success: boolean; message?: string }> => {
  const { error } = await supabase.from('printer_configs').update(updates).eq('id', id);
  if (error) { console.error('Error updating printer config:', error); return { success: false, message: error.message }; }
  return { success: true };
};

export const deletePrinterConfig = async (id: string): Promise<{ success: boolean; message?: string }> => {
  const { error } = await supabase.from('printer_configs').delete().eq('id', id);
  if (error) { console.error('Error deleting printer config:', error); return { success: false, message: error.message }; }
  return { success: true };
};

// Enfileira um job pro agente local pegar (impressoras 'network'/'usb') —
// também usado pro botão "Imprimir teste" da aba nova, e pode ser
// chamado em paralelo ao window.print() existente (CaixaPrintStation)
// só pra deixar histórico visível na fila, mesmo quando quem imprimiu de
// verdade foi o navegador.
// ── Impressão sem internet (impressoras de rede/IP) ─────────────────────────
// A fila de impressão fica no servidor. Se a internet cair, o app desktop
// manda o texto DIRETO pra impressora de rede (IP:porta, mesma rede local) e
// guarda o registro aqui; quando a internet volta o registro entra no
// histórico de impressões (status 'done', sem imprimir de novo).
const PRINTERS_CACHE_KEY = (storeId: string) => `ntb-printers-cache:${storeId}`;
const PRINT_HISTORY_KEY = 'ntb-print-history-pending';

const cachePrinters = (storeId: string, printers: unknown[]) => {
  try { localStorage.setItem(PRINTERS_CACHE_KEY(storeId), JSON.stringify(printers)); } catch { /* sem cache */ }
};
const readCachedPrinters = (storeId: string): PrinterConfig[] => {
  try { return JSON.parse(localStorage.getItem(PRINTERS_CACHE_KEY(storeId)) || '[]'); } catch { return []; }
};

type PendingPrintHistory = { uid?: string; storeId: string; printerConfigId: string | null; destination: string; title: string; content: string; dedupeKey: string | null; printedAt: string };

const pushPrintHistory = (item: PendingPrintHistory) => {
  try {
    const list: PendingPrintHistory[] = JSON.parse(localStorage.getItem(PRINT_HISTORY_KEY) || '[]');
    list.push({ ...item, uid: item.uid || crypto.randomUUID() });
    localStorage.setItem(PRINT_HISTORY_KEY, JSON.stringify(list.slice(-200)));
  } catch { /* sem histórico local */ }
};

let flushingPrintHistory = false;
export const flushPrintHistory = async (): Promise<number> => {
  if (typeof window === 'undefined') return 0;
  if (flushingPrintHistory) return -1;
  let list: PendingPrintHistory[] = [];
  try { list = JSON.parse(localStorage.getItem(PRINT_HISTORY_KEY) || '[]'); } catch { return 0; }
  if (!list.length) return 0;
  flushingPrintHistory = true;
  try {
    const enviados = new Set<string>();
    for (const it of list) {
      const { error } = await supabase.from('print_jobs').insert({
        store_id: it.storeId, printer_config_id: it.printerConfigId, destination: it.destination,
        title: it.title, content: it.content, dedupe_key: it.dedupeKey, status: 'done', printed_at: it.printedAt,
      });
      if (error && (error as { code?: string }).code !== '23505') {
        if (isNetworkError(error)) continue;
        console.error('Histórico de impressão offline não gravou:', error);
      }
      if (it.uid) enviados.add(it.uid);
    }
    // Relê: marcas criadas DURANTE o envio não podem ser apagadas.
    let atual: PendingPrintHistory[] = [];
    try { atual = JSON.parse(localStorage.getItem(PRINT_HISTORY_KEY) || '[]'); } catch { atual = []; }
    const restantes = atual.filter((it) => !it.uid || !enviados.has(it.uid));
    localStorage.setItem(PRINT_HISTORY_KEY, JSON.stringify(restantes));
    return restantes.length;
  } finally { flushingPrintHistory = false; }
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { flushPrintHistory().catch(() => {}); });
  setInterval(() => { flushPrintHistory().catch(() => {}); }, 60000);
}

// Sem internet: imprime direto na impressora de rede (só no app desktop).
const printDirectOffline = async (params: { storeId: string; printerConfigId?: string | null; destination: string; title: string; content: string; dedupeKey?: string }): Promise<boolean> => {
  if (typeof window === 'undefined' || !window.electronApp?.printDirectNetwork || !params.printerConfigId) return false;
  if (params.content.startsWith('@@PDF@@')) return false;
  const printer = readCachedPrinters(params.storeId).find((p) => p.id === params.printerConfigId);
  if (!printer) return false;
  if (printer.bottom_margin) params = { ...params, content: `${params.content.replace(/\s+$/, '')}\n${'\n'.repeat(2)}.` };
  let r: { ok: boolean; reason?: string };
  if (printer.connection_type === 'network' && printer.ip_address) {
    r = await window.electronApp.printDirectNetwork({ ip: printer.ip_address, port: printer.port || 9100, content: params.content, raw: printer.print_mode === 'raw' });
  } else if (printer.connection_type === 'usb' && printer.usb_system_name && window.electronApp.printDirectUsb) {
    let donos: string[] = [];
    try {
      const cache: { name: string; machine: string; kind: string }[] = JSON.parse(localStorage.getItem(`ntb-discovered-cache:${params.storeId}`) || '[]');
      donos = cache.filter((d) => d.kind !== 'network' && d.name === printer.usb_system_name && d.machine).map((d) => d.machine);
    } catch { /* sem cache */ }
    r = await window.electronApp.printDirectUsb({ printer, content: params.content, owners: donos });
  } else {
    return false;
  }
  if (!r.ok) { console.error('Impressão direta offline falhou:', r.reason); return false; }
  pushPrintHistory({ storeId: params.storeId, printerConfigId: params.printerConfigId ?? null, destination: params.destination, title: params.title, content: params.content, dedupeKey: params.dedupeKey || null, printedAt: new Date().toISOString() });
  return true;
};

// Pedido do garçom feito SEM internet: imprime o pedido direto nas impressoras
// de rede do destino (cache local) e registra no histórico com uma chave
// "offline:<assinatura>#<impressora>" — a Estação de Impressão usa essas chaves
// pra não imprimir de novo o mesmo item quando o pedido sincronizar.
export const printOfflineOrderTicket = async (params: { storeId: string; destination: 'kitchen' | 'bar'; sectorId?: string | null; title: string; content: string; sig: string }): Promise<number> => {
  if (lerImpressaoPausadaCache(params.storeId)) return 0;
  const doDestino = readCachedPrinters(params.storeId).filter((p) => p.is_active && (p.connection_type === 'network' || p.connection_type === 'usb') && (p.destination === params.destination || p.destination === 'all') && impressoraRecebe(p, 'comanda'));
  const doSetor = doDestino.filter((p) => (p.sector_id || null) === (params.sectorId || null));
  const printers = doSetor.length > 0 ? doSetor : doDestino.filter((p) => !p.sector_id);
  let ok = 0;
  for (const printer of printers) {
    const feito = await printDirectOffline({ storeId: params.storeId, printerConfigId: printer.id, destination: params.destination, title: params.title, content: params.content, dedupeKey: `offline:${crypto.randomUUID()}:${printer.id}:${params.sig}` });
    if (feito) ok++;
  }
  return ok;
};

// Assinaturas (mesa|produto|qtd|obs) já impressas offline nas últimas 12h,
// com quantas vezes cada uma saiu (por impressora, pega o maior).
// Marcas de itens impressos sem internet nas últimas 12h: assinatura
// (mesa|produto|qtd|obs) -> ids das marcas (da impressora com mais marcas).
// `null` = não deu pra consultar (quem chama NÃO deve imprimir nessa rodada).
export const fetchOfflinePrintedSigs = async (storeId: string): Promise<Map<string, string[]> | null> => {
  const desde = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
  const { data, error } = await supabase.from('print_jobs').select('dedupe_key').eq('store_id', storeId).like('dedupe_key', 'offline:%').gte('created_at', desde);
  if (error) return null;
  const porSig = new Map<string, Map<string, string[]>>();
  for (const row of data || []) {
    const resto = String(row.dedupe_key || '').slice('offline:'.length);
    const a = resto.indexOf(':'); const b = resto.indexOf(':', a + 1);
    if (a < 0 || b < 0) continue;
    const marca = resto.slice(0, a);
    const imp = resto.slice(a + 1, b);
    const sig = resto.slice(b + 1);
    if (!porSig.has(sig)) porSig.set(sig, new Map());
    const m = porSig.get(sig)!;
    if (!m.has(imp)) m.set(imp, []);
    m.get(imp)!.push(marca);
  }
  const out = new Map<string, string[]>();
  porSig.forEach((m, sig) => { let melhor: string[] = []; m.forEach((l) => { if (l.length > melhor.length) melhor = l; }); out.set(sig, melhor.sort()); });
  return out;
};

export const enqueuePrintJob = async (params: {
  storeId: string;
  printerConfigId?: string | null;
  destination: 'kitchen' | 'bar' | 'all' | 'receipt';
  title: string;
  content: string;
  // Ver migration 073: quando informada, o banco garante que o MESMO
  // trabalho não entra duas vezes na fila — é o que impede dois PCs da
  // mesma loja de mandarem o mesmo pedido pra cozinha (o dedupe antigo era
  // localStorage, por aparelho).
  dedupeKey?: string;
}): Promise<{ success: boolean; id?: string; message?: string; duplicado?: boolean }> => {
  if (await fetchImpressaoPausada(params.storeId)) return { success: false, message: 'Impressões desativadas nesta loja (aba Impressão).' };
  const { data, error } = await supabase.from('print_jobs').insert({
    store_id: params.storeId,
    printer_config_id: params.printerConfigId || null,
    destination: params.destination,
    title: params.title,
    content: params.content,
    dedupe_key: params.dedupeKey || null,
  }).select('id').single();
  if (error) {
    // 23505 = unique_violation: outro aparelho já enfileirou este mesmo
    // trabalho. É o comportamento desejado, não um erro pra reportar.
    if ((error as { code?: string }).code === '23505') return { success: true, duplicado: true };
    if (isNetworkError(error) && await printDirectOffline(params)) return { success: true };
    console.error('Error enqueueing print job:', error);
    return { success: false, message: error.message };
  }
  return { success: true, id: data?.id };
};

// Pedido de CANCELAMENTO: manda pra(s) impressora(s) de rede/USB do destino (mesma
// regra de setor da Estação de Impressão). Devolve quantas impressoras receberam;
// 0 = nenhuma impressora cadastrada pra esse destino (quem chama decide o plano B).
export const enfileirarCancelamento = async (params: {
  storeId: string;
  destination: 'kitchen' | 'bar';
  sectorId?: string | null;
  title: string;
  content: string | ((printer: PrinterConfig) => string);
  dedupeKey: string;
}): Promise<number> => {
  const todas = await fetchPrinterConfigs(params.storeId);
  const doDestino = todas.filter((p) => p.is_active && (p.connection_type === 'network' || p.connection_type === 'usb') && (p.destination === params.destination || p.destination === 'all') && impressoraRecebe(p, 'comanda'));
  const doSetor = doDestino.filter((p) => printerServesSector(p, params.sectorId ?? null));
  const impressoras = doSetor.length > 0 ? doSetor : doDestino.filter((p) => !p.sector_id);
  let enviadas = 0;
  for (const printer of impressoras) {
    const r = await enqueuePrintJob({
      storeId: params.storeId,
      printerConfigId: printer.id,
      destination: params.destination,
      title: params.title,
      content: typeof params.content === 'function' ? params.content(printer) : params.content,
      dedupeKey: `${params.dedupeKey}:${printer.id}`,
    });
    if (r.success) enviadas++;
  }
  return enviadas;
};

// Achado ao vivo (2026-08-28, loja real com 3 impressoras cabeadas —
// Cozinha/Bar/Caixa): enfileira o comprovante de pagamento pra toda
// impressora de rede/USB ativa com destino 'receipt'/'all' da loja.
// Aditivo ao window.print() existente (printBillReceipt em
// StoreModule.tsx) — nunca no lugar dele, mesmo princípio do
// CaixaPrintStation pros tickets de cozinha/bar. Fire-and-forget de
// propósito: falha aqui nunca deve impedir o fechamento, que já
// aconteceu antes desta chamada.
// `dedupeKeyBase` (opcional): achado ao vivo, loja Sertão (2026-09-15) — o
// cupom fiscal saiu impresso 2x com a MESMA nota, 351ms de diferença. Não é
// bug de fila (agente já reserva job atomicamente, ver print-engine.js) —
// é o fechamento da venda sendo disparado 2x quase junto (mesmo clique
// duplo já documentado como causa da nota fiscal duplicada em si), cada
// disparo achando a MESMA nota já autorizada e enfileirando o cupom de
// novo. Sem tocar no código de emissão fiscal (fora de escopo, decisão já
// tomada nesta sessão), a fila em si pode ser deduplicada: quando o
// chamador passa uma chave estável (ex.: o id da nota), o índice único de
// `print_jobs(store_id, dedupe_key)` (migration 073) barra a segunda
// tentativa. Combinado com o id da impressora pra nunca colidir entre
// impressoras diferentes da mesma loja.
export const enqueueReceiptPrintJobs = async (storeId: string, title: string, content: string | ((paperWidthMm: number | null) => string), dedupeKeyBase?: string, doc: DocPrint = 'comprovante', soConfigurado = false): Promise<void> => {
  const { data: printers, error } = await supabase
    .from('printer_configs')
    .select('*')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .in('connection_type', ['network', 'usb']);
  let impressoras = (printers || []).filter((p) => impressoraRecebe(p as { destination: string; documentos?: string[] | null }, doc, { soConfigurado }));
  if (error) {
    if (!isNetworkError(error)) { console.error('Error fetching receipt printers:', error); return; }
    impressoras = readCachedPrinters(storeId).filter((p) => p.is_active && ['network', 'usb'].includes(p.connection_type) && impressoraRecebe(p, doc, { soConfigurado }));
  }
  await Promise.all(
    (impressoras || []).map((printer) =>
      enqueuePrintJob({
        storeId,
        printerConfigId: printer.id,
        destination: printer.destination,
        title,
        // Layout em colunas depende do papel DESTA impressora (80 mm = 48, 58 mm = 32).
        content: typeof content === 'function' ? content((printer as { paper_width_mm?: number | null }).paper_width_mm ?? null) : content,
        dedupeKey: dedupeKeyBase ? `${dedupeKeyBase}:${printer.id}` : undefined,
      })
    )
  );
};

// Cupom fiscal completo (PDF com QR) pela fila: quem finaliza pode estar em
// QUALQUER computador (notebook, navegador); o PC que tem a impressora USB do
// caixa baixa o PDF e imprime (motor de impressão do app desktop). Impressora
// de rede não imprime PDF -- recebe o resumo em texto como antes.
export const enqueueFiscalCupomPrintJobs = async (
  storeId: string,
  title: string,
  textContent: string,
  dedupeKeyBase: string,
  pdfUrlFor: (paperWidthMm: number) => string,
): Promise<number> => {
  const { data: printers, error } = await supabase
    .from('printer_configs')
    .select('*')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .in('connection_type', ['network', 'usb']);
  if (error) { console.error('Error fetching receipt printers:', error); return 0; }
  const impressorasCupom = (printers || []).filter((p) => impressoraRecebe(p as { destination: string; documentos?: string[] | null }, 'cupom_fiscal'));
  const origem = typeof window !== 'undefined' ? window.location.origin : '';
  await Promise.all(
    impressorasCupom.map((printer) => {
      const content = printer.connection_type === 'usb'
        ? `@@PDF@@${new URL(pdfUrlFor(printer.paper_width_mm ?? 80), origem).href}`
        : textContent;
      return enqueuePrintJob({
        storeId,
        printerConfigId: printer.id,
        destination: printer.destination,
        title,
        content,
        dedupeKey: `${dedupeKeyBase}:${printer.id}`,
      });
    })
  );
  // Quantas impressoras receberam o cupom (0 = nenhuma impressora de cupom configurada).
  return impressorasCupom.length;
};

export const fetchRecentPrintJobs = async (storeId: string, limit: number = 30): Promise<PrintJob[]> => {
  const { data, error } = await supabase.from('print_jobs').select('*').eq('store_id', storeId).order('created_at', { ascending: false }).limit(limit);
  if (error) { console.error('Error fetching print jobs:', error); return []; }
  return data || [];
};

// Reenfileira um job que falhou/travou — usado pelo botão "Reenviar" da
// fila na aba Impressão. Volta pro estado 'pending' com um novo
// created_at (mesmo id, timeline continua no mesmo card) pro agente
// local pegar de novo na próxima consulta.
export const retryPrintJob = async (id: string): Promise<{ success: boolean; message?: string }> => {
  const { error } = await supabase.from('print_jobs').update({ status: 'pending', error_message: null, printed_at: null, created_at: new Date().toISOString() }).eq('id', id);
  if (error) { console.error('Error retrying print job:', error); return { success: false, message: error.message }; }
  return { success: true };
};

// Conta universal: um login só que, em vez de estar preso a uma loja
// (como store_users), escolhe qual loja acessar a cada entrada. Tabela
// própria (universal_users), nunca acessada direto pelo client (mesmo
// padrão write-only via RPC do resto da autenticação).
export const authenticateUniversalUser = async (email: string, password: string): Promise<{ success: boolean; user?: UniversalUser; mustChangePass?: boolean; message?: string; reason?: MotivoFalhaLogin }> => {
  try {
    const { data, error } = await supabase.rpc('authenticate_universal_user_secure', { p_email: email, p_password: password });
    if (error) return { success: false, reason: 'network', message: 'Sem conexão com o servidor. Tente de novo.' };
    if (!data?.success) {
      return {
        success: false,
        reason: data?.locked ? 'locked' : 'wrong',
        message: data?.locked ? 'Muitas tentativas incorretas. Tente novamente em alguns minutos.' : 'Usuário ou senha incorretos.',
      };
    }
    return { success: true, user: data.user, mustChangePass: data.mustChangePass };
  } catch (error: any) {
    console.error('Auth Universal User Error:', error);
    return { success: false, reason: 'network', message: 'Sem conexão com o servidor. Tente de novo.' };
  }
};

export const updateUniversalUserPassword = async (userId: string, newPassword: string) => {
  const { error } = await supabase.rpc('update_universal_user_password_secure', { p_user_id: userId, p_new_password: newPassword });
  if (error) throw error;
};

// C4 da revisão final (ver task-12-report.md e o comentário de
// fetchStoreUserById acima) — mesmo padrão de fallback via cache num erro de
// rede, usado pela restauração de sessão da conta universal.
export const fetchUniversalUserById = async (userId: string): Promise<UniversalUser | null> => {
  try {
    const { data, error } = await supabase.rpc('fetch_universal_user_by_id_secure', { p_user_id: userId });
    if (error) throw error;
    if (!data) return null;
    setCachedSession(`universal_user:${userId}`, data).catch(() => {});
    return data;
  } catch (error) {
    if (!isNetworkError(error)) return null;
    const cached = await getCachedSession(`universal_user:${userId}`);
    return (cached?.value as UniversalUser | null) ?? null;
  }
};

// Local de estoque do Omie por destino de preparo (30/09, migration 134) — ver
// app/api/integracao/locais-estoque/route.ts.
export type LocaisEstoqueStatus = { configurado: boolean; locais: { codigo: number; nome: string }[]; mapa: Record<string, number>; erro?: string };

export const fetchLocaisEstoque = async (storeId: string): Promise<LocaisEstoqueStatus> => {
  try {
    const res = await fetch(resolverUrlApi(`/api/integracao/locais-estoque?storeId=${encodeURIComponent(storeId)}`), { cache: 'no-store' });
    return await res.json();
  } catch (e: any) {
    return { configurado: false, locais: [], mapa: {}, erro: e?.message };
  }
};

export const salvarLocalEstoque = async (storeId: string, destino: string, local: { codigo: number; nome: string } | null): Promise<{ success: boolean; message?: string }> => {
  try {
    const res = await fetch(resolverUrlApi('/api/integracao/locais-estoque'), {
      method: 'POST',
      headers: cabecalhosApi(),
      body: JSON.stringify({ storeId, destino, codigo: local?.codigo ?? null, nome: local?.nome ?? null }),
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, message: e?.message };
  }
};

// Modo Aberto (30/09, migration 135): confere só a senha contra as contas da loja, sem
// criar sessão. Bateu com uma conta = o pedido sai no nome dela.
export type ResultadoSenhaEquipe =
  | { success: true; user_id: string; name: string; role: string }
  | { success: false; error: 'invalid' | 'ambiguous' | 'locked' | 'offline'; seconds?: number };

// Cache local das senhas JÁ conferidas neste aparelho (nunca a senha: PBKDF2 com salt aleatório por entrada): sem
// internet o pedido não pode travar na conferência. Vale 12 h e só para quem já passou pela conferência online aqui;
// ao conferir online, a senha antiga da mesma pessoa deixa de valer. Senha nova offline continua recusada.
const CHAVE_SENHAS_OFFLINE = 'ntb-senhas-conferidas-v2';
const VALIDADE_SENHA_OFFLINE_MS = 12 * 60 * 60 * 1000;
type SenhaConferida = { salt: string; hash: string; storeId: string; user_id: string; name: string; role: string; em: number };
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(b instanceof Uint8Array ? b : new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
async function derivarSenha(senha: string, saltHex: string): Promise<string | null> {
  try {
    const salt = new Uint8Array((saltHex.match(/../g) || []).map((h) => parseInt(h, 16)));
    const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 60000, hash: 'SHA-256' }, chave, 256));
  } catch { return null; }
}
function lerSenhasConferidas(): SenhaConferida[] {
  try {
    const lista = JSON.parse(localStorage.getItem(CHAVE_SENHAS_OFFLINE) || '[]');
    return Array.isArray(lista) ? lista.filter((x: SenhaConferida) => Date.now() - x.em < VALIDADE_SENHA_OFFLINE_MS) : [];
  } catch { return []; }
}
// Quem entrou com login online também deixa a própria senha conferida neste aparelho (pedido offline logo depois do login).
export const registrarSenhaConferida = async (storeId: string, senha: string, user: { id: string; name: string; role: string }) => {
  try {
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await derivarSenha(senha, salt);
    if (!hash) return;
    const outras = lerSenhasConferidas().filter((x) => !(x.storeId === storeId && x.user_id === user.id));
    localStorage.setItem(CHAVE_SENHAS_OFFLINE, JSON.stringify([...outras, { salt, hash, storeId, user_id: user.id, name: user.name, role: user.role, em: Date.now() }]));
    localStorage.removeItem('ntb-senhas-conferidas'); // formato antigo (sem salt), nunca mais usado
  } catch { /* sem cache, segue */ }
};
export const verificarSenhaEquipe = async (storeId: string, senha: string): Promise<ResultadoSenhaEquipe> => {
  const { data, error } = await supabase.rpc('verify_store_staff_password_secure', { p_store_id: storeId, p_password: senha });
  if (error || !data) {
    if (error && !isNetworkError(error)) return { success: false, error: 'invalid' };
    for (const x of lerSenhasConferidas().filter((c) => c.storeId === storeId)) {
      // eslint-disable-next-line no-await-in-loop -- poucas pessoas por aparelho
      if ((await derivarSenha(senha, x.salt)) === x.hash) return { success: true, user_id: x.user_id, name: x.name, role: x.role };
    }
    return { success: false, error: 'offline' };
  }
  const r = data as ResultadoSenhaEquipe;
  if (r.success) await registrarSenhaConferida(storeId, senha, { id: r.user_id, name: r.name, role: r.role });
  return r;
};

// Garçom confirma o pedido com NOME + SENHA (migration 166). A lista de nomes vem do servidor e fica guardada no aparelho:
// sem internet o garçom ainda escolhe o nome e a senha é conferida contra o cache (12 h) daquela pessoa.
export type PessoaEquipe = { id: string; name: string; role: string };
const CHAVE_EQUIPE_PEDIDO = 'ntb-equipe-pedido-v1';
export const fetchEquipePedido = async (storeId: string): Promise<PessoaEquipe[]> => {
  const lerCache = (): PessoaEquipe[] => { try { const c = JSON.parse(localStorage.getItem(`${CHAVE_EQUIPE_PEDIDO}:${storeId}`) || '[]'); return Array.isArray(c) ? c : []; } catch { return []; } };
  try {
    const { data, error } = await supabase.rpc('list_store_staff_for_orders_secure', { p_store_id: storeId });
    if (error || !Array.isArray(data)) return lerCache();
    try { localStorage.setItem(`${CHAVE_EQUIPE_PEDIDO}:${storeId}`, JSON.stringify(data)); } catch { /* sem cache */ }
    return data as PessoaEquipe[];
  } catch { return lerCache(); }
};

export const verificarLoginEquipe = async (storeId: string, userId: string, senha: string): Promise<ResultadoSenhaEquipe> => {
  const { data, error } = await supabase.rpc('verify_store_staff_login_secure', { p_store_id: storeId, p_user_id: userId, p_password: senha });
  // Servidor ainda sem a migration 166: confere pela senha (função antiga) e exige que seja a MESMA pessoa escolhida.
  if (error?.code === 'PGRST202') {
    const r = await verificarSenhaEquipe(storeId, senha);
    return r.success && r.user_id !== userId ? { success: false, error: 'invalid' } : r;
  }
  if (error || !data) {
    if (error && !isNetworkError(error)) return { success: false, error: 'invalid' };
    const dela = lerSenhasConferidas().find((c) => c.storeId === storeId && c.user_id === userId);
    if (dela && (await derivarSenha(senha, dela.salt)) === dela.hash) return { success: true, user_id: dela.user_id, name: dela.name, role: dela.role };
    return { success: false, error: 'offline' };
  }
  const r = data as ResultadoSenhaEquipe;
  if (r.success) await registrarSenhaConferida(storeId, senha, { id: r.user_id, name: r.name, role: r.role });
  return r;
};

// --- Cupons de desconto (migration 142/143/144) ---
import { calculateCouponDiscount, type CouponInfo } from './coupons';

export interface DiscountCoupon {
  id: string;
  store_id: string;
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  max_uses: number | null;
  uses_count: number;
  min_order_value: number | null;
  expires_at: string | null;
  active: boolean;
  created_at: string;
}

export const fetchCoupons = async (storeId: string): Promise<DiscountCoupon[]> => {
  const { data } = await supabase
    .from('discount_coupons')
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false });
  return (data || []) as DiscountCoupon[];
};

export const createCoupon = async (storeId: string, coupon: {
  code: string; type: 'percent' | 'fixed'; value: number;
  max_uses?: number | null; min_order_value?: number | null; expires_at?: string | null;
}): Promise<{ success: boolean; message?: string }> => {
  const { error } = await supabase.from('discount_coupons').insert({
    store_id: storeId,
    code: coupon.code.toUpperCase().trim(),
    type: coupon.type,
    value: coupon.value,
    max_uses: coupon.max_uses ?? null,
    min_order_value: coupon.min_order_value ?? null,
    expires_at: coupon.expires_at ?? null,
  });
  if (error) return { success: false, message: error.message.includes('unique') ? 'Já existe um cupom com este código.' : error.message };
  return { success: true };
};

export const updateCoupon = async (id: string, updates: Partial<{
  code: string; type: string; value: number; max_uses: number | null;
  min_order_value: number | null; expires_at: string | null; active: boolean;
}>): Promise<{ success: boolean; message?: string }> => {
  const { error } = await supabase.from('discount_coupons').update(updates).eq('id', id);
  if (error) return { success: false, message: error.message };
  return { success: true };
};

export const deleteCoupon = async (id: string): Promise<{ success: boolean }> => {
  const { error } = await supabase.from('discount_coupons').delete().eq('id', id);
  return { success: !error };
};

export const validateAndApplyCoupon = async (
  storeId: string, code: string, orderTotal: number
): Promise<{ success: boolean; discount?: number; couponId?: string; message?: string }> => {
  const normalizedCode = code.toUpperCase().trim();
  const { data: coupon } = await supabase
    .from('discount_coupons')
    .select('*')
    .eq('store_id', storeId)
    .eq('code', normalizedCode)
    .eq('active', true)
    .maybeSingle();
  if (!coupon) return { success: false, message: 'Cupom não encontrado ou inativo.' };
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date())
    return { success: false, message: 'Cupom expirado.' };
  if (coupon.max_uses != null && coupon.uses_count >= coupon.max_uses)
    return { success: false, message: 'Cupom já atingiu o limite de usos.' };
  if (coupon.min_order_value != null && orderTotal < coupon.min_order_value)
    return { success: false, message: `Pedido mínimo de R$ ${coupon.min_order_value.toFixed(2)} pra usar este cupom.` };
  const discount = calculateCouponDiscount(
    { type: coupon.type, value: Number(coupon.value) },
    orderTotal,
  );
  return { success: true, discount, couponId: coupon.id };
};

export const recordCouponUsage = async (
  couponId: string, orderId: string, discountAmount: number
): Promise<void> => {
  await supabase.from('coupon_usages').insert({
    coupon_id: couponId, order_id: orderId, discount_amount: discountAmount,
  });
  try { await supabase.rpc('increment_coupon_uses', { p_coupon_id: couponId }); } catch { /* silencioso */ }
};
// Prioridade KDS (migration 142/145) — toggle de prioridade de item na cozinha.
export const toggleItemPriority = async (itemId: string): Promise<{ success: boolean }> => {
  const { data, error } = await supabase.rpc('toggle_order_item_priority', { p_item_id: itemId });
  if (error || data === false) return { success: false };
  return { success: true };
};
