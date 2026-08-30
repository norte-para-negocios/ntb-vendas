'use client';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import { SPRING_TAP } from '@/lib/motion';
import { resolveStoreModules, resolveOrderFlow, computeAccessibleTabIds, TAB_IDS, hasTabPermission, canFinalizeBill, isTableInJurisdiction } from '@/lib/storeModules';
import { useCaixaPrintStation, CaixaPrintStationIndicator, CaixaPrintStationOfflineBanner, wasKitchenTicketPrinted, printPendingKitchenTicket, isCaixaRole } from '@/components/modules/CaixaPrintStation';
import PrinterSettingsView from '@/components/modules/PrinterSettingsView';
import StoreSettingsView from '@/components/modules/StoreSettingsView';
import { LayoutDashboard, UtensilsCrossed, ChefHat, LogOut, CheckCircle, Clock, RotateCcw, Lock, Store as StoreIcon, AlertCircle, Plus, Edit2, Trash2, Image as ImageIcon, ToggleLeft, ToggleRight, X, Coffee, Receipt, LayoutGrid, RefreshCw, Upload, Camera, Settings, Ban, Unlock, User, BellRing, Search, Minus, BarChart3, Printer, Wallet, CreditCard, Banknote, QrCode, Gift, ArrowRight, ArrowRightLeft, ChevronLeft, ChevronRight, Eye, EyeOff, GripVertical, Wine, Users, List, Calculator, CheckSquare, Square, Menu, Download, Star, FileText, TrendingDown, TrendingUp, History, Shield } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { differenceInDays, format, parseISO } from 'date-fns';
import { Button, Card, Badge, Modal, Input, Collapsible } from '@/components/ui';
import { AuthBackdrop } from '@/components/AuthBackdrop';
import { fetchKitchenOrders, updateOrderItemStatus, fetchTables, authenticateStoreUser, updateStoreUserPassword, fetchMenu, createCategory, deleteCategory, createProduct, updateProduct, deleteProduct, fetchCounterOrders, closeCounterOrder, uploadProductImage, updateOrderStatus, sendOrderToKitchen, fetchActiveOrdersForTables, toggleTableBlock, closeTableSession, dismissWaiterRequest, createOrder, cancelSpecificOrderItem, fetchSalesHistory, clearSalesHistory, moveTable, updateStoreConfig, fetchStoreTeamMembers, createStoreTeamMember, updateStoreTeamMember, deleteStoreTeamMember, toggleTableServiceFee, updateCategoryOrder, updateCategorySchedule, updateProductOrder, openTableManually, fetchTableSessions, fetchStoreUserById, fetchOrderRatings, authenticateUniversalUser, updateUniversalUserPassword, fetchUniversalUserById, fetchAllStores, fetchStoreById, syncProductOptionGroups, ProductOptionGroupInput, updateProductRecommendations, consolidateProductsIntoVariants, criarProdutoNoEstoque, uploadStoreCertificate, saveStoreCertificateMetadata, saveStoreCertificateSecret, fetchStoreCertificateStatus, fetchStoreFiscalConfig, updateStoreFiscalConfig, UpdateStoreFiscalConfigParams, fetchFiscalNotas, fetchFiscalNotaPdfUrl, reemitirFiscalNota, fetchNtbEstoqueIntegracaoStatus, saveNtbEstoqueIntegracaoConfig, NtbEstoqueIntegracaoStatus, requestTableBill, fetchOpenCashShift, openCashShift, registerCashMovement, fetchCashShiftSummary, closeCashShift, verifyCashSupervisor, CashShiftSummary, CashShift, fetchCashShiftsHistory, CashShiftHistoryRow, fetchCashShiftAudit, CashShiftAuditEvent, fetchOpenCheckin, startCheckin, endCheckin, fetchCheckinsHistory, fetchOpenCheckinUserIds, subscribeToStoreOrderChanges, triggerPushForOrder, fetchReservationsByStore, updateReservationStatus, enqueueReceiptPrintJobs } from '@/lib/api';
import { OrderItem, OrderStatus, Table, TableStatus, StoreUser, StoreUserPermissions, Store, Category, Product, Order, TableSession, OrderRating, UniversalUser, ProductOptionGroup, SelectedOption, StoreFiscalCertificateStatus, FiscalNota, OperatorCheckin, TableReservation } from '@/types';
import { CASH_DENOMINATIONS, sumDenominationBreakdown } from '@/lib/cashDenominations';
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/components/Toast';
import { confirm } from '@/components/ConfirmDialog';
import { Skeleton, stagger } from '@/components/Skeleton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getRoleLabel, getTableStatusLabel, getPaymentMethodLabel, getOrderItemDisplayName, PRODUCT_TAGS, getTagDisplay, CARD_BRAND_LABELS, getCardBrandLabel, TABLE_OUT_OF_JURISDICTION_LABEL, parseItemNote } from '@/lib/labels';
import { printKitchenTicket, printBillReceipt, printSalesReport, buildBillReceiptText } from '@/lib/print';
import { downloadSalesReportCsv } from '@/lib/csv';
import { playPreparingAlert, playNewOrderAlert, playItemLateAlert, vibrateAlert } from '@/lib/audioAlert';
import { calculateServiceFee, calculateOrderTotal, calculateSplitByPerson, calculateChangeForMethods, getPaymentMethodsForRecord, SplitItem, getEffectivePrice, SERVICE_FEE_RATE, formatServiceFeeRate, formatBRL, getOrderDisplayTotal } from '@/lib/calc';
import { normalizeForSearch } from '@/lib/search';
import { formatScheduleLabel } from '@/lib/schedule';
import { MeuLinkView } from '@/components/modules/MeuLinkView';

// StoreDashboardView importa recharts (bundle pesado); cozinha/bar/balcão
// nunca abrem essa aba, então carregamos sob demanda e só no client
// (achado de performance #6).
const StoreDashboardView = dynamic(
    () => import('@/components/modules/StoreDashboardView').then(mod => mod.StoreDashboardView),
    { ssr: false, loading: () => <Skeleton className="h-64 w-full rounded-xl" /> }
);

// --- COMPONENTS ---

// Permissões da conta universal: era um objeto fixo com as 6 permissões
// `true` (acesso total sempre) — motivo real de a aba Bar aparecer no
// Sertão mesmo sem nenhum store_user cadastrado lá (Task 1, plano
// 2026-08-22: perfil de módulos por loja). Agora deriva do perfil da
// própria loja (resolveStoreModules) — a conta universal continua vendo
// tudo que a loja tem, e nada do que ela não tem. Não é uma linha de
// store_users (a loja pode nem ter usuário nenhum), é sintetizada no client
// depois de escolher a loja na tela de seleção.
const universalPermissionsFor = (store: Store): StoreUserPermissions => {
    const modules = resolveStoreModules(store);
    return {
        tables: modules.tables,
        counter: modules.counter,
        kitchen: modules.kitchen_kds,
        bar: modules.bar_kds,
        menu: modules.menu,
        admin: modules.admin,
        // Módulo Caixa (Task 4): a conta universal já finaliza mesmo sem
        // isto (canFinalizeBill dá bypass explícito a role==='universal',
        // igual sempre foi) — mas `permissions.caixa` NÃO é só um campo
        // decorativo: `isCaixaRole` (CaixaPrintStation.tsx) e o gate do botão
        // "Reimprimir" (StoreModule.tsx, `sentHistoryItems`/linha do
        // histórico) leem `permissions.caixa` de verdade. A exclusão
        // explícita de `role === 'owner' | 'universal'` nesses dois lugares
        // é o que evita que este campo (que só espelha se a LOJA tem o
        // módulo Caixa ligado, não se este usuário é operador de caixa)
        // ligue o loop de auto-impressão ou o botão de reimpressão manual
        // pra qualquer conta universal — a leitura acontece só pra decidir
        // "roda o gatilho automático de impressão" / "mostra o botão
        // manual", nunca pra acesso de aba nem pra finalizar conta (isso
        // continua sendo o bypass explícito de `canFinalizeBill` acima).
        caixa: modules.caixa,
    };
};

const StoreLogin: React.FC<{ onLogin: (user: StoreUser & { store: Store }) => void }> = ({ onLogin }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // Reset Password State
    const [needsChange, setNeedsChange] = useState(false);
    const [userId, setUserId] = useState('');
    const [isUniversalChange, setIsUniversalChange] = useState(false);
    const [newPass, setNewPass] = useState('');
    const [confirmPass, setConfirmPass] = useState('');

    // Conta universal: autentica numa tabela separada (universal_users) e,
    // em vez de entrar direto numa loja, mostra um seletor com todas as
    // lojas ativas. Ver supabase/migrations/015_universal_login.sql.
    const [universalUser, setUniversalUser] = useState<UniversalUser | null>(null);
    const [stores, setStores] = useState<Store[]>([]);
    const [storeFilter, setStoreFilter] = useState('');
    const [isLoadingStores, setIsLoadingStores] = useState(false);

    const handleLogin = async () => {
        setError('');
        setIsLoading(true);
        const result = await authenticateStoreUser(email, password);

        if (result.success && result.user) {
            if (result.user.must_change_password) {
                setNeedsChange(true);
                setUserId(result.user.id);
                setIsUniversalChange(false);
            } else {
                onLogin(result.user);
            }
            setIsLoading(false);
            return;
        }

        // Não bateu em nenhum store_user: tenta a conta universal antes de
        // mostrar erro (tabelas separadas, sem custo extra de segurança em
        // tentar as duas em sequência).
        const universalResult = await authenticateUniversalUser(email, password);
        if (universalResult.success && universalResult.user) {
            if (universalResult.mustChangePass) {
                setNeedsChange(true);
                setUserId(universalResult.user.id);
                setIsUniversalChange(true);
            } else {
                setUniversalUser(universalResult.user);
            }
        } else {
            setError(result.message || 'Erro ao entrar.');
        }
        setIsLoading(false);
    };

    const handleChangePassword = async () => {
        if (newPass.length < 6) return setError('A senha deve ter no mínimo 6 caracteres.');
        if (newPass !== confirmPass) return setError('As senhas não coincidem.');

        setIsLoading(true);
        try {
            if (isUniversalChange) {
                await updateUniversalUserPassword(userId, newPass);
            } else {
                await updateStoreUserPassword(userId, newPass);
            }
            toast.success('Senha atualizada com sucesso! Faça login novamente.');
            setNeedsChange(false);
            setPassword('');
        } catch (e) {
            setError('Erro ao atualizar senha.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (!universalUser) return;
        setIsLoadingStores(true);
        fetchAllStores().then((data) => {
            setStores(data.filter(s => s.is_active && (!s.is_test || universalUser?.pode_ver_lojas_teste)));
            setIsLoadingStores(false);
        });
    }, [universalUser]);

    const handleSelectStore = (store: Store) => {
        if (!universalUser) return;
        onLogin({
            id: universalUser.id,
            store_id: store.id,
            name: universalUser.name,
            email: universalUser.email,
            role: 'universal',
            must_change_password: false,
            permissions: universalPermissionsFor(store),
            store,
        });
    };

    if (needsChange) {
         return (
            <AuthBackdrop>
                <Card className="u-grow-in w-full max-w-sm p-8" style={{ boxShadow: '0 30px 60px -18px rgba(30,27,75,0.5)' }}>
                    <div className="text-center mb-6">
                        <div className="bg-[var(--warn)]/10 w-14 h-14 rounded-[var(--r-lg)] flex items-center justify-center mx-auto mb-4 text-[var(--warn)]">
                            <Lock size={24} />
                        </div>
                        <h2 className="text-xl font-bold text-[var(--text)]">Crie sua Senha</h2>
                        <p className="text-[var(--text-muted)] text-sm mt-1">Primeiro acesso. Defina uma senha segura para continuar.</p>
                    </div>

                    <div className="space-y-4">
                        <Input label="Nova Senha" type="password" value={newPass} onChange={e => setNewPass(e.target.value)} />
                        <Input label="Confirmar Nova Senha" type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} />

                        {error && <p className="text-[var(--err)] text-sm text-center font-medium">{error}</p>}

                        <Button className="w-full" onClick={handleChangePassword} isLoading={isLoading}>
                            Salvar Senha
                        </Button>
                    </div>
                </Card>
            </AuthBackdrop>
        );
    }

    if (universalUser) {
        const filteredStores = stores.filter(s => s.name.toLowerCase().includes(storeFilter.toLowerCase()));
        return (
            <AuthBackdrop>
                <div className="max-w-md w-full">
                    <div className="text-center mb-6">
                        <div className="w-14 h-14 rounded-[1.25rem] flex items-center justify-center mx-auto mb-4 text-white bg-white/12 backdrop-blur-sm border border-white/25" style={{ animation: '3s ease-in-out infinite icon-float' }}>
                            <StoreIcon size={24} />
                        </div>
                        <h1 className="text-2xl font-bold text-white">Qual loja você quer acessar?</h1>
                        <p className="text-white/75 text-sm mt-1">Logado como {universalUser.name}</p>
                    </div>
                    <Card className="u-grow-in p-4" style={{ boxShadow: '0 30px 60px -18px rgba(30,27,75,0.5)' }}>
                        <Input placeholder="Buscar loja..." value={storeFilter} onChange={e => setStoreFilter(e.target.value)} className="mb-3" />
                        <div className="max-h-96 overflow-y-auto space-y-1">
                            {isLoadingStores && <p className="text-sm text-[var(--text-muted)] text-center py-6">Carregando lojas...</p>}
                            {!isLoadingStores && filteredStores.map((store, i) => (
                                <button
                                    key={store.id}
                                    onClick={() => handleSelectStore(store)}
                                    className="u-grow-in group/store w-full text-left p-3 rounded-[var(--r-md)] hover:bg-[var(--brand-soft)] u-motion flex items-center justify-between"
                                    style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
                                >
                                    <span className="font-medium text-[var(--text)] group-hover/store:text-[var(--brand)]">{store.name}</span>
                                    <ArrowRight size={16} className="text-[var(--text-muted)] u-motion group-hover/store:translate-x-1 group-hover/store:text-[var(--brand)]" />
                                </button>
                            ))}
                            {!isLoadingStores && filteredStores.length === 0 && (
                                <p className="text-sm text-[var(--text-muted)] text-center py-6">Nenhuma loja encontrada.</p>
                            )}
                        </div>
                    </Card>
                    <button onClick={() => setUniversalUser(null)} className="w-full text-center text-sm text-white/70 hover:text-white mt-4 u-motion">
                        Sair
                    </button>
                </div>
            </AuthBackdrop>
        );
    }

    return (
        <AuthBackdrop>
            <div className="max-w-sm w-full">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 rounded-[1.4rem] flex items-center justify-center mx-auto mb-5 text-white bg-white/12 backdrop-blur-sm border border-white/25" style={{ boxShadow: '0 20px 40px -12px rgba(0,0,0,0.35)', animation: '3s ease-in-out infinite icon-float' }}>
                        <StoreIcon size={26} />
                    </div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Área do Lojista</h1>
                    <p className="text-white/75 text-sm mt-1.5">Gerencie seus pedidos e mesas</p>
                </div>
                <Card className="u-grow-in p-6" style={{ boxShadow: '0 30px 60px -18px rgba(30,27,75,0.5)' }}>
                    <div className="space-y-4">
                        <Input label="Email de Acesso" placeholder="seu@email.com" type="email" value={email} onChange={e => setEmail(e.target.value)} />
                        <Input label="Senha" placeholder="••••••" type="password" value={password} onChange={e => setPassword(e.target.value)} />

                        {error && (
                            <div className="bg-[var(--err)]/10 text-[var(--err)] p-3 rounded text-sm flex items-center gap-2">
                                <AlertCircle size={16} /> {error}
                            </div>
                        )}

                        <Button className="w-full group" onClick={handleLogin} isLoading={isLoading}>
                            Acessar Painel
                            {!isLoading && <ArrowRight size={18} className="u-motion group-hover:translate-x-1" />}
                        </Button>
                    </div>
                </Card>
            </div>
        </AuthBackdrop>
    );
};

const useStoreNotifications = (storeId: string | undefined) => {
    const [counts, setCounts] = useState({ tables: 0, kitchen: 0, bar: 0 });
    // Baseline pra so' tocar som quando o total AUMENTA (pedido novo chegando),
    // nunca ao abrir a tela nem quando o total cai (item concluido/entregue).
    const prevTotalRef = useRef<number | null>(null);

    // Rastreado separado de prevTotalRef (kitchen+bar) porque "mesa" precisa
    // de um alerta com texto diferente ("chamada de mesa" vs "pedido novo") —
    // ver achado real, reuniao 2026-08-19: chamada de garcom so mudava um
    // numero no badge, sem som, porque só kitchen+bar disparavam alerta.
    //
    // Rastreado como CONJUNTO de table_id (nao so o numero agregado) --
    // achado na revisao final: um numero liquido pode esconder uma chamada
    // nova. Se, no mesmo poll, uma mesa e' dispensada (-1) e outra chama o
    // garcom (+1) no mesmo tick, o numero liquido fica igual e nenhum alerta
    // dispara -- exatamente o "miss silencioso" que esta feature existe pra
    // evitar. Comparando os IDs (nao so a contagem), qualquer mesa NOVA no
    // conjunto dispara o alerta, independente do que aconteceu com as outras.
    const prevTableIdsRef = useRef<Set<string>>(new Set());
    // Mesmo papel do "prevTotal !== null" abaixo (nao disparar no primeiro
    // loadCounts() apos o mount) -- Set vazio por si so nao diferencia
    // "nunca calculado" de "calculado e vazio", entao precisa de um flag
    // proprio em vez de inferir isso do tamanho do Set.
    const hasLoadedTableIdsRef = useRef(false);

    useEffect(() => {
        if (!storeId) return;

        let isMounted = true;

        const loadCounts = async () => {
            try {
                // Fetch tables and active orders
                const tablesData = await fetchTables(storeId);
                const activeOrdersData = await fetchActiveOrdersForTables(storeId);
                
                let tableCount = 0;
                const tableIdsNeedingAttention = new Set<string>();
                tablesData.forEach(t => {
                    const isOccupied = t.status === 'occupied' || t.status === 'waiting_bill';
                    if (!isOccupied) return;

                    if (t.waiter_requested || t.status === 'waiting_bill') {
                        tableCount++;
                        tableIdsNeedingAttention.add(t.id);
                    } else if (t.status === 'occupied') {
                         // Check if new client entered (no active orders)
                         let hasActiveItems = false;
                         activeOrdersData.filter(o => o.table_id === t.id).forEach(o => {
                             if (o.order_items && o.order_items.some(i => i.status !== 'canceled')) {
                                 hasActiveItems = true;
                             }
                         });
                         // No items ordered yet = new customer waiting to be acknowledged / waiting for menu / just entered
                         if (!hasActiveItems && t.current_host_name) {
                             tableCount++;
                             tableIdsNeedingAttention.add(t.id);
                         }
                    }
                });

                // Fetch kitchen & bar orders via RPC segura (fetch_kitchen_orders_secure) --
                // antes usava supabase.from('order_items') direto, que desde a correcao de
                // seguranca 021/022 (RLS sem select publico) sempre voltava vazio: o badge
                // de notificacao da Cozinha/Bar nunca acendia, mesmo com pedido esperando.
                const needsAction = (item: any) =>
                    item.status === 'pending' || (item.order?.order_type === 'counter' && item.status === 'accepted');

                const [kitchenItems, barItems] = await Promise.all([
                    fetchKitchenOrders(storeId, 'kitchen'),
                    fetchKitchenOrders(storeId, 'bar'),
                ]);

                const kitchenCount = kitchenItems.filter(needsAction).length;
                const barCount = barItems.filter(needsAction).length;

                const total = kitchenCount + barCount;
                const prevTotal = prevTotalRef.current;
                prevTotalRef.current = total;
                if (prevTotal !== null && total > prevTotal) {
                    playNewOrderAlert();
                    vibrateAlert([100, 60, 100]);
                    toast.info('Novo pedido chegou! 🔔');
                }

                const prevTableIds = prevTableIdsRef.current;
                const hasNewTableAttention = [...tableIdsNeedingAttention].some(id => !prevTableIds.has(id));
                prevTableIdsRef.current = tableIdsNeedingAttention;
                if (hasLoadedTableIdsRef.current && hasNewTableAttention) {
                    playNewOrderAlert();
                    // Padrao distinto do kitchen/bar (acima: 2 pulsos curtos) --
                    // 3 pulsos mais longos, pra dar pra reconhecer "mesa/garcom"
                    // vs "cozinha/bar" só pela vibracao, sem olhar o toast.
                    vibrateAlert([200, 100, 200, 100, 200]);
                    toast.info('Atenção na mesa! 🔔');
                }
                hasLoadedTableIdsRef.current = true;

                if (isMounted) setCounts({ tables: tableCount, kitchen: kitchenCount, bar: barCount });
            } catch (err) {
                console.error("Erro ao carregar notificações", err);
            }
        };

        loadCounts();
        
        const channel = supabase.channel(`notifications_${storeId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'table_change_pings', filter: `store_id=eq.${storeId}` }, loadCounts)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'order_change_pings', filter: `store_id=eq.${storeId}` }, loadCounts)
            .subscribe();

        return () => {
            isMounted = false;
            supabase.removeChannel(channel);
        };
    }, [storeId]);

    return counts;
};

// Lê o canal de Presence que o cliente na mesa usa (ClientModule,
// useWatchingPresence) pra sinalizar "painel de acompanhamento aberto" --
// nenhum dado gravado no banco, só estado efêmero da conexão websocket.
// Devolve o conjunto de table_id sendo observados agora, pro card da mesa
// mostrar um indicador "cliente acompanhando".
function useWatchedTables(storeId: string | undefined): Set<string> {
    const [watched, setWatched] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!storeId) return;
        const channel = supabase.channel(`presence_${storeId}`);

        const sync = () => {
            const state = channel.presenceState<{ tableId: string; watching: boolean }>();
            const tableIds = new Set<string>();
            Object.values(state).forEach((presences) => {
                presences.forEach((p) => { if (p.tableId) tableIds.add(p.tableId); });
            });
            setWatched(tableIds);
        };

        channel.on('presence', { event: 'sync' }, sync).subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [storeId]);

    return watched;
}

const StoreLayout: React.FC<{ children: React.ReactNode, title: string, currentTab: string, onTabChange: (t: string) => void, storeName: string, onLogout: () => void, onSwitchStore?: () => void, user: StoreUser & { store: Store } }> = ({ children, title, currentTab, onTabChange, storeName, onLogout, onSwitchStore, user }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const notifications = useStoreNotifications(user.store.id);

  // "Bater ponto" (migration 056) — turno pessoal do operador, sem relação
  // com cash_shifts (turno do caixa físico, um só por loja). Carregado uma
  // vez ao entrar no painel; sobrevive à troca de aba porque StoreLayout não
  // desmonta entre abas (mesmo raciocínio do caixaPrintStatus acima).
  const [openCheckin, setOpenCheckin] = useState<OperatorCheckin | null>(null);
  const [checkinBusy, setCheckinBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchOpenCheckin(user.store.id, user.id).then(c => { if (!cancelled) setOpenCheckin(c); });
    return () => { cancelled = true; };
  }, [user.store.id, user.id]);
  const handleToggleCheckin = async () => {
    if (checkinBusy) return;
    setCheckinBusy(true);
    try {
      if (openCheckin) {
        const result = await endCheckin(openCheckin.id);
        if (result.success) setOpenCheckin(null);
      } else {
        const created = await startCheckin(user.store.id, user.id, user.name);
        if (created) setOpenCheckin(created);
      }
    } finally {
      setCheckinBusy(false);
    }
  };
  // Reconciliação de impressão do Caixa (redesign 2026-08-23) — montada
  // aqui, não dentro de TablesView/CounterView, de propósito: StoreLayout é
  // o único componente que sobrevive à troca de aba (Mesas↔Balcão), então é
  // o único lugar onde "roda em segundo plano independente da aba" é
  // literalmente verdade. `active` (dentro do hook) já é `false` pras 6
  // lojas reais (sem `order_flow: 'direct_print'`) — nesse caso o hook não
  // liga nenhum efeito, e o indicador abaixo não renderiza nada.
  const caixaPrintStatus = useCaixaPrintStation(user.store, user);

  const allTabs = [
    // Aba Caixa (Task 3, frente-de-caixa) — primeira da lista de propósito,
    // mesmo raciocínio do TAB_IDS em lib/storeModules.ts.
    { id: 'caixa', icon: Wallet, label: 'Caixa', permission: 'caixa' },
    { id: 'tables', icon: LayoutDashboard, label: 'Gestão de Mesas', permission: 'tables', count: notifications.tables },
    { id: 'counter', icon: Coffee, label: 'Balcão', permission: 'counter' },
    { id: 'kitchen', icon: ChefHat, label: 'Cozinha (KDS)', permission: 'kitchen', count: notifications.kitchen },
    { id: 'bar', icon: Wine, label: 'Bar (KDS)', permission: 'bar', count: notifications.bar },
    { id: 'menu', icon: UtensilsCrossed, label: 'Cardápio', permission: 'menu' },
    { id: 'admin', icon: BarChart3, label: 'Administração', permission: 'admin' }
  ];

  // Task 1 (perfil de módulos por loja): uma aba só aparece se o USUÁRIO tem
  // permissão E a LOJA tem o módulo ligado — antes só a permissão era
  // checada aqui, então uma loja sem nenhum store_user (como o Sertão hoje)
  // sempre via as 6 abas via conta universal, mesmo sem cozinha/bar.
  // Fix round 1 (Task 1 review, Important #1): usa computeAccessibleTabIds
  // (lib/storeModules.ts) em vez de repetir a checagem de módulo aqui — ela
  // garante que 'admin' nunca fica fora do alcance de todo mundo ao mesmo
  // tempo (ver comentário lá pro porquê).
  const storeModules = resolveStoreModules(user.store);
  const hasPermission = (tabId: string) => hasTabPermission(user, tabId, user.store);
  const accessibleTabIds = computeAccessibleTabIds(storeModules, hasPermission);
  const visibleTabs = allTabs.filter(tab => accessibleTabIds.has(tab.id));
  const bottomNavTabs = visibleTabs.filter(item => ['caixa', 'tables', 'counter', 'kitchen', 'bar'].includes(item.id));

  return (
    <div className={`min-h-screen bg-[var(--bg)] pb-20 md:pb-0 transition-all duration-[var(--dur-slow)] ${isCollapsed ? 'md:pl-20' : 'md:pl-64'}`}>
      <CaixaPrintStationOfflineBanner status={caixaPrintStatus} />

      {/* Mobile Header */}
      <header className="md:hidden bg-[var(--surface)] border-b border-[var(--border)] px-4 py-3 sticky top-0 z-30 flex items-center gap-3" style={{boxShadow:'var(--shadow-sm)'}}>
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-1.5 -ml-1.5 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] rounded-[var(--r-sm)] u-motion shrink-0"
          >
             <Menu size={20} />
          </button>
          <div className="flex items-center gap-2.5 flex-1 overflow-hidden">
             <div className="h-7 w-7 rounded-[var(--r-sm)] bg-[var(--brand)] flex items-center justify-center text-white font-semibold text-[11px] shrink-0">
                {storeName.slice(0,2).toUpperCase()}
             </div>
             <h1 className="font-semibold text-[var(--text)] text-[15px] truncate flex-1">{title}</h1>
          </div>
          <CaixaPrintStationIndicator status={caixaPrintStatus} storeName={storeName} />
          <ThemeToggle />
      </header>

      {/* Mobile Menu Drawer (Off-canvas) */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setIsMobileMenuOpen(false)}></div>
            <div className="absolute left-0 top-0 bottom-0 w-64 bg-[var(--ink)] shadow-2xl flex flex-col animate-[slideRight_0.25s_cubic-bezier(0.22,1,0.36,1)] text-left">
                <div className="px-4 py-4 border-b border-white/10 flex justify-between items-center">
                    <span className="font-semibold text-white text-[15px]">Menu Lojista</span>
                    <div className="flex items-center gap-1">
                        <ThemeToggle variant="sidebar" />
                        <button onClick={() => setIsMobileMenuOpen(false)} className="p-1.5 text-white/40 hover:text-white/80 hover:bg-white/10 rounded-[var(--r-sm)] u-motion">
                            <X size={18}/>
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-1">
                    {visibleTabs.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => { onTabChange(item.id); setIsMobileMenuOpen(false); }}
                          className={`flex items-center w-full px-3 py-2.5 rounded-[var(--r-md)] text-[14px] font-medium u-motion gap-3
                            ${currentTab === item.id ? 'bg-white/12 text-white' : 'text-white/50 hover:bg-white/8 hover:text-white/80'}
                          `}
                        >
                          <div className="relative">
                              <item.icon size={18} className="shrink-0" />
                              {!!item.count && item.count > 0 && (
                                 <div className="absolute -top-1.5 -right-1.5 bg-[var(--err)] text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full num">
                                    {item.count > 9 ? '9+' : item.count}
                                 </div>
                              )}
                          </div>
                          <div className="flex-1 flex items-center justify-between truncate">
                              <span className="truncate">{item.label}</span>
                              {!!item.count && item.count > 0 && (
                                 <span className="bg-white/10 text-white/70 text-[11px] font-semibold px-1.5 py-0.5 rounded-full num ml-2 shrink-0">
                                    {item.count}
                                 </span>
                              )}
                          </div>
                        </button>
                    ))}
                </div>
                <div className="p-3 border-t border-white/10">
                    <button
                        onClick={handleToggleCheckin}
                        disabled={checkinBusy}
                        className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-[var(--r-md)] u-motion text-[14px] disabled:opacity-50 ${openCheckin ? 'bg-[var(--ok)]/15 text-[var(--ok)]' : 'text-white/70 hover:text-white hover:bg-white/8'}`}
                    >
                        <Clock size={18}/> {openCheckin ? `Encerrar turno (${format(parseISO(openCheckin.checkin_at), 'HH:mm')})` : 'Bater ponto'}
                    </button>
                    {user.role === 'universal' && onSwitchStore && (
                        <button onClick={onSwitchStore} className="flex items-center gap-3 w-full px-3 py-2.5 text-white/70 hover:text-white hover:bg-white/8 rounded-[var(--r-md)] u-motion text-[14px]">
                            <RefreshCw size={18}/> Trocar de Loja
                        </button>
                    )}
                    <button onClick={onLogout} className="flex items-center gap-3 w-full px-3 py-2.5 text-[var(--err)]/80 hover:text-[var(--err)] hover:bg-white/8 rounded-[var(--r-md)] u-motion text-[14px]">
                        <LogOut size={18}/> Sair
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className={`fixed left-0 top-0 h-full bg-[var(--ink)] border-r border-white/8 hidden md:flex flex-col z-10 transition-all duration-[var(--dur-slow)] ${isCollapsed ? 'w-20' : 'w-64'}`} style={{boxShadow:'4px 0 20px rgba(0,0,0,0.15)'}}>
        <div className={`px-4 py-4 border-b border-white/8 flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
          {!isCollapsed && (
            <div className="overflow-hidden">
              <h1 className="text-[15px] font-semibold text-white truncate">{storeName}</h1>
              <p className="eyebrow mt-0.5 truncate" style={{color:'rgba(255,255,255,0.35)'}}>Painel Lojista</p>
            </div>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={`text-white/30 hover:text-white/70 hover:bg-white/8 p-1.5 rounded-[var(--r-sm)] u-motion ${isCollapsed ? '' : 'ml-2'}`}
            title={isCollapsed ? "Expandir Menu" : "Recolher Menu"}
          >
            {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
        
        <nav className={`flex-1 p-3 space-y-1 overflow-y-auto no-scrollbar`}>
          {visibleTabs.map((item) => (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`flex items-center w-full px-3 py-2.5 rounded-[var(--r-md)] text-[13px] font-medium u-motion group relative
                ${currentTab === item.id ? 'bg-white/12 text-white' : 'text-white/45 hover:bg-white/8 hover:text-white/75'}
                ${isCollapsed ? 'justify-center' : 'gap-3'}
              `}
              title={isCollapsed ? item.label : ''}
            >
              <div className="relative shrink-0">
                <item.icon size={18} />
                {isCollapsed && !!item.count && item.count > 0 && (
                   <div className="absolute -top-1.5 -right-1.5 bg-[var(--err)] text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full num">
                      {item.count > 9 ? '9+' : item.count}
                   </div>
                )}
              </div>
              {!isCollapsed && (
                  <div className="flex-1 flex items-center justify-between truncate">
                      <span className="truncate">{item.label}</span>
                      {!!item.count && item.count > 0 && (
                          <span className="bg-[var(--err)] text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full ml-2 shrink-0 num">
                              {item.count}
                          </span>
                      )}
                  </div>
              )}

              {/* Tooltip para estado colapsado */}
              {isCollapsed && (
                <div className="absolute left-full ml-2 px-2.5 py-1.5 bg-[var(--text)] text-[var(--bg)] text-[12px] font-medium rounded-[var(--r-sm)] opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
                  {item.label}{!!item.count && ` (${item.count})`}
                </div>
              )}
            </button>
          ))}
        </nav>

        <div className="px-3 pb-1">
          <button
            onClick={handleToggleCheckin}
            disabled={checkinBusy}
            className={`flex items-center w-full px-3 py-2.5 rounded-[var(--r-md)] text-[13px] font-medium u-motion disabled:opacity-50
              ${openCheckin ? 'bg-[var(--ok)]/15 text-[var(--ok)] hover:bg-[var(--ok)]/25' : 'text-white/60 hover:bg-white/8 hover:text-white'}
              ${isCollapsed ? 'justify-center' : 'gap-3'}
            `}
            title={isCollapsed ? (openCheckin ? `Encerrar turno (desde ${format(parseISO(openCheckin.checkin_at), 'HH:mm')})` : 'Bater ponto') : ''}
          >
            <Clock size={18} className="shrink-0" />
            {!isCollapsed && (
              <span className="truncate">
                {openCheckin ? `Encerrar turno (${format(parseISO(openCheckin.checkin_at), 'HH:mm')})` : 'Bater ponto'}
              </span>
            )}
          </button>
        </div>

        <div className={`p-3 border-t border-white/8 ${isCollapsed ? 'space-y-1' : 'flex items-center gap-1'}`}>
          <ThemeToggle variant="sidebar" className={isCollapsed ? 'mx-auto' : ''} />
          {user.role === 'universal' && onSwitchStore && (
            <button
              onClick={onSwitchStore}
              className={`flex items-center w-full px-3 py-2.5 text-white/60 hover:text-white hover:bg-white/8 rounded-[var(--r-md)] u-motion text-[13px] ${isCollapsed ? 'justify-center' : 'gap-3'}`}
              title={isCollapsed ? "Trocar de Loja" : ""}
            >
              <RefreshCw size={18} />
              {!isCollapsed && <span>Trocar de Loja</span>}
            </button>
          )}
          <button
            onClick={onLogout}
            className={`flex items-center w-full px-3 py-2.5 text-[var(--err)]/60 hover:text-[var(--err)] hover:bg-white/8 rounded-[var(--r-md)] u-motion text-[13px] ${isCollapsed ? 'justify-center' : 'gap-3'}`}
            title={isCollapsed ? "Sair" : ""}
          >
            <LogOut size={18} />
            {!isCollapsed && <span>Sair</span>}
          </button>
        </div>
      </aside>

    {/* Mobile Bottom Nav */}
    {bottomNavTabs.length > 0 && (
        <div className="fixed bottom-0 left-0 w-full bg-[var(--ink)] border-t border-white/8 flex justify-around px-2 pt-2 pb-4 md:hidden z-40">
           {bottomNavTabs.map(item => (
            <button key={item.id} onClick={() => onTabChange(item.id)} className={`relative flex flex-col items-center gap-1 text-[10px] font-medium px-3 py-1.5 rounded-[var(--r-md)] u-motion ${currentTab === item.id ? 'text-white' : 'text-white/40'}`}>
              <div className="relative">
                  <item.icon size={20} />
                  {!!item.count && item.count > 0 && (
                       <div className="absolute -top-1.5 -right-2 bg-[var(--err)] text-white text-[9px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded-full px-0.5 num">
                          {item.count > 9 ? '9+' : item.count}
                       </div>
                  )}
              </div>
              <span className="truncate max-w-[56px] text-center">
                  {item.id === 'caixa' ? 'Caixa' :
                   item.id === 'tables' ? 'Mesas' :
                   item.id === 'kitchen' ? 'Cozinha' :
                   item.id === 'bar' ? 'Bar' :
                   item.label.split(' ')[0]}
              </span>
            </button>
           ))}
        </div>
    )}

    {/* Main Content Area */}
    <main className="p-4 md:p-8 pt-4 md:pt-6 pb-24 md:pb-8 max-w-7xl mx-auto">
      <header className="mb-6 hidden md:flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text)]">{title}</h2>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">Gerencie seu estabelecimento</p>
        </div>
        <div className="flex items-center gap-3">
           <CaixaPrintStationIndicator status={caixaPrintStatus} storeName={storeName} />
           <div className="h-8 w-8 rounded-[var(--r-sm)] bg-[var(--brand)] flex items-center justify-center text-white font-semibold text-[12px]">
              {storeName.slice(0,2).toUpperCase()}
           </div>
           <div className="text-[13px] text-[var(--text-muted)]">{new Date().toLocaleDateString('pt-BR')}</div>
        </div>
      </header>
      
      {children}
    </main>
  </div>
);
};

// --- SUB-MODULE: KDS (Kitchen / Bar) ---
const KdsView: React.FC<{ destination: 'kitchen' | 'bar'; store: Store }> = ({ destination, store }) => {
  const storeId = store.id;
  const storeName = store.name;
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());

  // Snapshot do fetch anterior — usado só pra diff (detectar item novo em
  // 'pending' e disparar o alerta sonoro), nunca renderizado. null = ainda
  // não carregou nenhuma vez (evita alertar no load inicial). Mesmo padrão
  // do prevItemsRef no OrderTracker (ClientModule.tsx).
  const prevOrdersRef = useRef<OrderItem[] | null>(null);

  // Relógio "agora" só pra recalcular o indicador de atraso periodicamente
  // sem precisar de um novo fetch — 30s é granularidade suficiente pra um
  // indicador medido em minutos.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
      const tick = setInterval(() => setNow(Date.now()), 30000);
      return () => clearInterval(tick);
  }, []);

  const notifyNewPendingItems = (nextOrders: OrderItem[]) => {
      const prevIds = new Set((prevOrdersRef.current || []).map(o => o.id));
      const hasNewPending = nextOrders.some(o => o.status === OrderStatus.PENDING && !prevIds.has(o.id));
      if (hasNewPending) playPreparingAlert();
      prevOrdersRef.current = nextOrders;
  };

  const loadOrders = async (notify = false) => {
      if(!storeId) return;
      const data = await fetchKitchenOrders(storeId, destination);
      if (notify) {
          notifyNewPendingItems(data);
      } else {
          // Baseline do load inicial: guarda o snapshot sem disparar som.
          prevOrdersRef.current = data;
      }
      setOrders(data);
  };

  useEffect(() => {
    loadOrders();
    const channel = supabase.channel(`${destination}_updates_${storeId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'order_change_pings', filter: `store_id=eq.${storeId}` }, () => {
            loadOrders(true); // Refresh on any change + alerta sonoro se surgiu item novo
        })
        .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [storeId, destination]);

  const isItemLate = (item: OrderItem) => {
      const prepMinutes = item.product?.prep_time_minutes;
      if (!prepMinutes) return false;
      const elapsedMinutes = (now - new Date(item.created_at).getTime()) / 60000;
      return elapsedMinutes > prepMinutes;
  };

  // Fase 3, Task 7: cronômetro visual do item — cor conforme proporção
  // decorrida/esperado (verde <70%, amarelo 70-100%, vermelho >=100%).
  // Sem prep_time_minutes cadastrado no produto, não dá pra calcular
  // proporção nenhuma — só mostra o tempo cru, sem cor de urgência.
  const getPrepProgress = (item: OrderItem) => {
      const prepMinutes = item.product?.prep_time_minutes;
      const elapsedMinutes = (now - new Date(item.created_at).getTime()) / 60000;
      const ratio = prepMinutes ? elapsedMinutes / prepMinutes : null;
      return { elapsedMinutes, ratio };
  };

  // Fase 3, Task 7 (plano "Fora do Cardápio"): som distinto (playItemLateAlert)
  // na primeira vez que um item cruza pra atrasado — diferente do som de
  // "pedido novo" (notifyNewPendingItems acima). O ref evita repetir o som a
  // cada re-render/tick de 30s enquanto o item continua atrasado.
  const lateAlertedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
      orders.forEach(item => {
          if (isItemLate(item) && !lateAlertedIdsRef.current.has(item.id)) {
              lateAlertedIdsRef.current.add(item.id);
              playItemLateAlert();
          }
      });
      const currentIds = new Set(orders.map(o => o.id));
      lateAlertedIdsRef.current.forEach(id => {
          if (!currentIds.has(id)) lateAlertedIdsRef.current.delete(id);
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps -- isItemLate é recriada a cada render mas só lê `now`/`orders`, já nas deps.
  }, [orders, now]);

  const advanceStatus = async (item: OrderItem) => {
      let nextStatus = OrderStatus.PENDING;

      // Order State Machine
      if (item.status === OrderStatus.PENDING) nextStatus = OrderStatus.PREPARING; // Table (Pending -> Preparing)
      else if (item.status === OrderStatus.ACCEPTED) nextStatus = OrderStatus.PREPARING; // Counter (Accepted -> Preparing)
      else if (item.status === OrderStatus.PREPARING) nextStatus = OrderStatus.READY;
      else if (item.status === OrderStatus.READY) nextStatus = OrderStatus.DELIVERED;

      const previousStatus = item.status;

      // Optimistic UI
      setOrders(prev => prev.map(o => o.id === item.id ? { ...o, status: nextStatus } : o).filter(o => o.status !== OrderStatus.DELIVERED));

      const result = await updateOrderItemStatus(item.id, nextStatus);
      if (result.success && (nextStatus === OrderStatus.PREPARING || nextStatus === OrderStatus.READY)) {
          // Fase 5, Task 19: push real (funciona com o app do cliente fechado),
          // mesmos 2 momentos que já disparam som/toast local no OrderTracker
          // (ClientModule.tsx) — nunca bloqueia o avanço de status do lojista
          // se falhar (fire-and-forget, mesmo padrão de triggerOrdemProducao).
          triggerPushForOrder(
              item.order_id,
              nextStatus === OrderStatus.READY ? 'Seu pedido está pronto! 🔔' : 'Preparando seu pedido...',
              `${item.quantity}x ${getOrderItemDisplayName(item)}`,
          );
      }
      if (!result.success) {
          // Reverte o update otimista — recoloca o item com o status anterior
          // (inclusive quando tinha sumido da tela por ter virado DELIVERED).
          setOrders(prev => {
              const stillThere = prev.some(o => o.id === item.id);
              if (stillThere) {
                  return prev.map(o => o.id === item.id ? { ...o, status: previousStatus } : o);
              }
              return [...prev, { ...item, status: previousStatus }];
          });
          toast.error('Não foi possível atualizar o status. Tente novamente.');
      }
  };

  const getStatusColor = (status: OrderStatus) => {
      switch(status) {
          case OrderStatus.PENDING: return 'bg-[var(--warn)]/8 border-[var(--warn)]/35';
          case OrderStatus.ACCEPTED: return 'bg-[var(--warn)]/8 border-[var(--warn)]/35';
          case OrderStatus.PREPARING: return 'bg-[var(--info)]/8 border-[var(--info)]/35';
          case OrderStatus.READY: return 'bg-[var(--ok)]/8 border-[var(--ok)]/40';
          default: return 'bg-[var(--surface-2)] border-[var(--border)]';
      }
  };

  const printOrderTicket = (item: OrderItem) => {
      const { client, observation } = parseItemNote(item.notes || '');
      const orderType = item.order?.order_type === 'counter' ? 'BALCÃO' : 'MESA';
      const identifier = item.order?.order_type === 'counter'
          ? (item.order?.customer_name || 'Balcão')
          : `MESA ${item.order?.tables?.number || '?'}`;

      printKitchenTicket({
          kind: destination === 'kitchen' ? 'COZINHA' : 'BAR',
          storeName,
          paperWidthMm: store.config?.printer_paper_width_mm,
          orderType,
          identifier,
          client,
          quantity: item.quantity,
          productName: item.product?.name || 'Produto Indisponível',
          addons: (item.selected_options || []).map(o => o.name).join(', ') || undefined,
          observation,
          orderIdShort: item.order_id.slice(0, 8),
      });
  };

  return (
    <div>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 items-start">
            <AnimatePresence>
            {orders.map(item => {
                const { client, observation } = parseItemNote(item.notes || '');
                const late = isItemLate(item);
                const { elapsedMinutes, ratio } = getPrepProgress(item);
                const timerColorClass = ratio === null ? 'text-[var(--text-muted)]' : ratio >= 1 ? 'text-[var(--err)] font-bold' : ratio >= 0.7 ? 'text-[var(--warn)] font-bold' : 'text-[var(--ok)]';

                return (
                    <motion.div
                        key={item.id}
                        layout
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.92 }}
                        transition={SPRING_TAP}
                    >
                    <Card className={`${getStatusColor(item.status)} p-4 border-2 transition-all duration-300 shadow-sm hover:shadow-md ${late ? 'border-[var(--err)] ring-2 ring-[var(--err)]/30' : ''}`}>
                        <div className="flex justify-between items-start mb-3 border-b border-[var(--border)]/50 pb-2">
                            <span className="font-bold text-[var(--text)] flex items-center gap-2">
                                {item.order?.order_type === 'counter' ? (
                                    <>
                                        <Coffee size={18} className="text-[var(--warn)]"/>
                                        <span className="truncate max-w-[150px]">{item.order?.customer_name || 'Balcão'}</span>
                                    </>
                                ) : (
                                    <>
                                        <LayoutGrid size={18} className="text-[var(--info)]"/>
                                        Mesa {item.order?.tables?.number || '?'}
                                    </>
                                )}
                                {late && (
                                    <span className="flex items-center gap-1 text-xs font-bold text-white bg-[var(--err)] px-2 py-0.5 rounded-full">
                                        <AlertCircle size={11}/> Atrasado
                                    </span>
                                )}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    disabled={cancellingIds.has(item.id)}
                                    onClick={async () => {
                                        if (cancellingIds.has(item.id)) return;
                                        if (await confirm({ message: 'Tem certeza que deseja CANCELAR este item?', variant: 'danger' })) {
                                            setCancellingIds(prev => new Set(prev).add(item.id));
                                            await cancelSpecificOrderItem(item.id);
                                            setOrders(prev => prev.filter(o => o.id !== item.id));
                                        }
                                    }}
                                    className="p-2 rounded-full bg-[var(--err)]/10 text-[var(--err)] hover:bg-[var(--err)]/15 border border-[var(--err)]/20 u-motion u-press disabled:opacity-50 disabled:pointer-events-none"
                                    title="Cancelar Item"
                                >
                                    <X size={18} />
                                </button>
                                <button
                                    onClick={() => printOrderTicket(item)}
                                    className="p-2 rounded-full bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] border border-[var(--border)] u-motion u-press"
                                    title="Imprimir Ticket"
                                >
                                    <Printer size={18} />
                                </button>
                                <div
                                    className={`flex items-center gap-1 text-sm font-mono bg-[var(--surface)]/50 px-2 py-1 rounded-[var(--r-sm)] ${timerColorClass}`}
                                    title={`Pedido às ${new Date(item.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`}
                                >
                                    <Clock size={12}/>
                                    {Math.floor(elapsedMinutes)}min
                                </div>
                            </div>
                        </div>
                        <h3 className="font-black text-[var(--text)] leading-tight mb-2 text-lg">
                            {item.quantity}x {getOrderItemDisplayName(item)}
                        </h3>

                        {/* Customer Name Badge (Neutral) */}
                        {client && (
                            <div className="mb-2">
                                <span className="text-xs font-bold text-[var(--text-muted)] bg-[var(--surface)]/60 px-2 py-1 rounded-[var(--r-sm)] border border-[var(--border)] flex items-center gap-1 w-fit">
                                    <User size={12}/> {client}
                                </span>
                            </div>
                        )}

                        {/* Actual Warning Notes */}
                        {observation && (
                            <div className="bg-[var(--warn)]/8 text-[var(--warn)] p-2 rounded-[var(--r-md)] text-sm font-bold border border-[var(--warn)]/20 mb-4 animate-pulse">
                                ⚠️ {observation}
                            </div>
                        )}

                        <div className="mt-auto pt-2">
                            <Button onClick={() => advanceStatus(item)} className={`w-full shadow-sm font-bold ${
                                item.status === 'pending' ? 'bg-[var(--warn)] hover:opacity-90 text-white' :
                                item.status === 'accepted' ? 'bg-[var(--warn)] hover:opacity-90 text-white' :
                                item.status === 'preparing' ? 'bg-[var(--info)] hover:opacity-90 text-white' :
                                'bg-[var(--ok)] hover:opacity-90 text-white'
                            }`}>
                                {(item.status === 'pending' || item.status === 'accepted') && 'Iniciar Preparo'}
                                {item.status === 'preparing' && 'Marcar Pronto'}
                                {item.status === 'ready' && 'Entregar'}
                            </Button>
                        </div>
                    </Card>
                    </motion.div>
                );
            })}
            </AnimatePresence>
            {orders.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center py-32 text-[var(--text-muted)] bg-[var(--surface)] rounded-[var(--r-lg)] border-2 border-dashed border-[var(--border)]">
                    <CheckCircle className="mb-4 h-20 w-20 opacity-20 text-[var(--ok)]" />
                    <p className="text-xl font-medium">{destination === 'kitchen' ? 'Tudo tranquilo na cozinha!' : 'Tudo tranquilo no bar!'}</p>
                    <p className="text-sm">Aguardando novos pedidos...</p>
                </div>
            )}
        </div>
    </div>
  );
};

// --- SUB-MODULE: TABLES ---

// Réplica, adaptada ao estilo do painel do lojista, do seletor de
// adicionais do ProductModal do cliente (ClientModule.tsx) — mesma
// capacidade (grupos single=radio/multiple=checkbox, obrigatório bloqueia
// o "Lançar Pedido", preço somado em tempo real), só o visual muda.
// Achado real (varredura 2026-07-05): antes o garçom conseguia lançar um
// produto com grupo obrigatório sem escolher nada e o preço saía sem o
// price_delta.
const StoreProductModal: React.FC<{ product: Product | null, onClose: () => void, onAdd: (qty: number, notes: string, selectedOptions: SelectedOption[]) => void }> = ({ product, onClose, onAdd }) => {
    const [qty, setQty] = useState(1);
    const [notes, setNotes] = useState('');
    const [selections, setSelections] = useState<Record<string, string[]>>({}); // group_id -> option_id[]

    useEffect(() => {
        if (product) {
            setQty(1);
            setNotes('');
            // Grupo unico obrigatorio (ex: "Tamanho" P/M/G) vem pre-selecionado
            // na 1a opcao disponivel, em vez de forcar o garcom a clicar antes
            // de poder lancar o item.
            const initialSelections: Record<string, string[]> = {};
            (product.option_groups || []).forEach(group => {
                if (group.type === 'single' && group.required) {
                    const firstAvailable = group.options.find(o => o.available !== false);
                    if (firstAvailable) initialSelections[group.id] = [firstAvailable.id];
                }
            });
            setSelections(initialSelections);
        }
    }, [product]);

    if (!product) return null;

    const groups = product.option_groups || [];

    const toggleOption = (group: ProductOptionGroup, optionId: string) => {
        setSelections(prev => {
            const current = prev[group.id] || [];
            if (group.type === 'single') return { ...prev, [group.id]: current[0] === optionId ? [] : [optionId] };
            const next = current.includes(optionId) ? current.filter(id => id !== optionId) : [...current, optionId];
            return { ...prev, [group.id]: next };
        });
    };

    const selectedOptions: SelectedOption[] = groups.flatMap(g =>
        (selections[g.id] || []).flatMap(optId => {
            const opt = g.options.find(o => o.id === optId);
            return opt ? [{ group_id: g.id, option_id: opt.id, name: opt.name, price_delta: opt.price_delta }] : [];
        })
    );
    const unitPrice = getEffectivePrice(product) + selectedOptions.reduce((a, o) => a + o.price_delta, 0);
    const missingRequired = groups.some(g => g.required && (selections[g.id] || []).length === 0);

    return (
        <Modal isOpen={!!product} onClose={onClose} title="Adicionar Item" size="md">
            <div className="space-y-4">
                <div className="flex gap-4">
                    {product.image_url && (
                        <Image src={product.image_url} alt={product.name} width={96} height={96} className="w-24 h-24 object-cover rounded-lg shadow-sm" />
                    )}
                    <div>
                        <h4 className="font-bold text-lg">{product.name}</h4>
                        <p className="text-[var(--text-muted)] text-sm line-clamp-2">{product.description}</p>
                        {/* Preço promocional (migration 019): garçom precisa ver/calcular
                            o mesmo preço efetivo que create_order_secure cobra no servidor,
                            senão diverge do que é dito ao cliente na mesa. Mesmo padrão
                            visual (cheio riscado + efetivo em destaque) já usado na
                            listagem de produtos do MenuManagementView acima. */}
                        {(() => {
                            const effectivePrice = getEffectivePrice(product);
                            const hasActivePromo = effectivePrice < product.price;
                            return hasActivePromo ? (
                                <span className="flex items-baseline gap-1.5 mt-1">
                                    <span className="text-xs text-[var(--text-muted)] line-through">R$ {formatBRL(product.price)}</span>
                                    <span className="text-[var(--brand)] font-bold">R$ {formatBRL(effectivePrice)}</span>
                                </span>
                            ) : (
                                <span className="text-[var(--brand)] font-bold mt-1 block">R$ {formatBRL(product.price)}</span>
                            );
                        })()}
                    </div>
                </div>

                <div className="flex items-center justify-between bg-[var(--surface-2)] p-3 rounded-xl border border-[var(--border)]">
                    <span className="text-sm font-bold text-[var(--text)]">Quantidade</span>
                    <div className="flex items-center gap-4 bg-[var(--surface)] px-2 py-1 rounded-lg shadow-sm border border-[var(--border)]">
                        <button onClick={() => setQty(Math.max(1, qty - 1))} className="p-2 text-[var(--brand)] hover:bg-[var(--surface-2)] rounded-md u-motion u-press-sm"><Minus size={18} /></button>
                        <span className="font-bold text-lg w-8 text-center">{qty}</span>
                        <button onClick={() => setQty(qty + 1)} className="p-2 text-[var(--brand)] hover:bg-[var(--surface-2)] rounded-md u-motion u-press-sm"><Plus size={18} /></button>
                    </div>
                </div>

                {groups.map(group => (
                    <div key={group.id} className="border border-[var(--border)] rounded-xl p-3 bg-[var(--surface-2)]">
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="font-bold text-sm text-[var(--text)]">{group.name}</h4>
                            {group.required && <Badge color="bg-[var(--warn)]/10 text-[var(--warn)]">Obrigatório</Badge>}
                        </div>
                        {group.options.map(opt => (
                            <label key={opt.id} className="flex items-center justify-between py-2 px-1 cursor-pointer min-h-11">
                                <span className="flex items-center gap-2 text-sm text-[var(--text)]">
                                    <input
                                        type={group.type === 'single' ? 'radio' : 'checkbox'}
                                        name={`store-group-${group.id}`}
                                        checked={(selections[group.id] || []).includes(opt.id)}
                                        onChange={() => toggleOption(group, opt.id)}
                                        className="w-4 h-4 accent-[var(--brand)]"
                                    />
                                    {opt.name}
                                </span>
                                {opt.price_delta > 0 && <span className="text-[var(--text-muted)] text-xs font-semibold">+R$ {formatBRL(opt.price_delta)}</span>}
                            </label>
                        ))}
                    </div>
                ))}

                <Input
                    label="Observação (Opcional)"
                    placeholder="Ex: Lojista: Sem cebola"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                />

                <Button className="w-full mt-4 h-12 text-lg" disabled={missingRequired} onClick={() => { onAdd(qty, notes, selectedOptions); onClose(); }}>
                    Lançar Pedido • R$ {formatBRL(unitPrice * qty)}
                </Button>
                {missingRequired && <p className="text-xs text-center text-[var(--err)]">Escolha uma opção obrigatória para continuar.</p>}
            </div>
        </Modal>
    );
};

const StoreTableMenu: React.FC<{ storeId: string, onAddItem: (product: Product, qty: number, notes: string, selectedOptions: SelectedOption[]) => void }> = ({ storeId, onAddItem }) => {
    const [categories, setCategories] = useState<Category[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [activeCategory, setActiveCategory] = useState<string>('');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

    useEffect(() => {
        fetchMenu(storeId, true).then(({ categories, products }) => {
            setCategories(categories);
            setProducts(products);
            if (categories.length > 0) setActiveCategory(categories[0].id);
        });
    }, [storeId]);

    // Achado real (reunião com o Ramon, 2026-08-25): buscar "camarão" só
    // trazia resultado da categoria ativa (ex.: Entradas), mesmo tendo
    // "camarão" em outras categorias — porque o filtro de categoria rodava
    // incondicionalmente, antes do termo de busca sequer entrar. Com termo
    // de busca preenchido, ignora a categoria ativa e busca em todo o
    // cardápio; sem termo, continua restrito à categoria como sempre.
    // normalizeForSearch (lib/search.ts) também resolve o segundo achado da
    // mesma reunião: busca ignorando acento.
    const filteredProducts = useMemo(() => {
        let prods = [...products];
        const term = searchTerm.trim();
        if (term) {
            const normalizedTerm = normalizeForSearch(term);
            prods = prods.filter(p => normalizeForSearch(p.name).includes(normalizedTerm));
        } else if (activeCategory) {
            prods = prods.filter(p => p.category_id === activeCategory);
        }
        return prods;
    }, [products, activeCategory, searchTerm]);

    return (
        <div className="flex flex-col h-full min-h-[400px]">
            <div className="sticky top-0 bg-[var(--surface)] z-10 space-y-2 pb-2">
                <Input
                    placeholder="Buscar produto..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="bg-[var(--surface-2)]"
                />
                <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                    {categories.map(cat => (
                        <button
                            key={cat.id}
                            onClick={() => setActiveCategory(cat.id)}
                            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold u-motion u-press-sm border ${
                                activeCategory === cat.id ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]'
                            }`}
                        >
                            {cat.name}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredProducts.map(product => (
                    <Card key={product.id} onClick={() => setSelectedProduct(product)} className="flex flex-col gap-2 p-2 cursor-pointer hover:border-[var(--brand)] transition-colors">
                        {product.image_url ? (
                             <div className="relative w-full h-24 rounded-lg overflow-hidden bg-[var(--surface-2)]">
                                 <Image src={product.image_url} alt={product.name} fill sizes="(max-width: 640px) 50vw, 240px" className="object-cover" />
                             </div>
                        ) : (
                             <div className="w-full h-24 bg-[var(--surface-2)] rounded-lg flex items-center justify-center text-[var(--border)] font-bold text-xs">Sem Foto</div>
                        )}
                        <div>
                            <h4 className="font-bold text-sm text-[var(--text)] leading-tight line-clamp-1">{product.name}</h4>
                            {(() => {
                                const effectivePrice = getEffectivePrice(product);
                                const hasActivePromo = effectivePrice < product.price;
                                return hasActivePromo ? (
                                    <span className="flex items-baseline gap-1">
                                        <span className="text-[10px] text-[var(--text-muted)] line-through">R$ {formatBRL(product.price)}</span>
                                        <span className="text-[var(--brand)] font-bold text-xs">R$ {formatBRL(effectivePrice)}</span>
                                    </span>
                                ) : (
                                    <span className="text-[var(--brand)] font-bold text-xs">R$ {formatBRL(product.price)}</span>
                                );
                            })()}
                        </div>
                    </Card>
                ))}
              </div>
            </div>

            <StoreProductModal
                product={selectedProduct}
                onClose={() => setSelectedProduct(null)}
                onAdd={(qty, notes, selectedOptions) => {
                    if (selectedProduct) {
                        onAddItem(selectedProduct, qty, notes, selectedOptions);
                    }
                }}
            />
        </div>
    );
};

// Módulo Caixa (Task 5, 2026-08-22, plano perfis-de-loja-e-caixa — fecha o
// gap do Balcão): núcleo de captura de pagamento extraído da aba
// "Pagamento" do modal "Receber Pagamento" de TablesView (era JSX inline
// ali, único consumidor) pra ser reaproveitado por CounterView também — o
// brief da Task 5 é explícito: "Do not build a second payment mechanism;
// if the table flow's components cannot be reused as they stand, say so".
// Aqui deu pra reusar como está: botões de método, seletor de bandeira,
// campo de valor, lista de pagamentos lançados, restante/troco e o botão
// de finalizar — nenhum cálculo (troco, remaining) foi copiado pra dentro
// deste componente, ele só recebe os valores já calculados via
// lib/calc.ts (calculateChangeForMethods) pelo caller, exatamente como
// TablesView já fazia.
//
// NÃO extraído (fica só em TablesView, de propósito): as abas "Divisão"/
// "Por Cliente"/"Calculadora" do mesmo modal — são rateio por pessoa de
// uma COMANDA DE MESA (múltiplos clientes na mesma conta); um pedido de
// balcão é uma venda única, sem esse conceito, então forjar essas abas pro
// balcão seria inventar produto novo, não reuso.
//
// `children` é renderizado entre a lista de pagamentos e o resumo/botão de
// finalizar — é onde TablesView já colocava o bloco opcional de
// destinatário da NF-e (Task 17); CounterView reaproveita a mesma posição
// pro próprio bloco de destinatário.
const PaymentCaptureFields: React.FC<{
    total: number;
    methods: { method: string; amount: number; brand?: string }[];
    currentMethod: string;
    onMethodChange: (m: string) => void;
    currentBrand: string;
    onBrandChange: (b: string) => void;
    currentAmount: string;
    onAmountChange: (a: string) => void;
    onAddPayment: () => void;
    onRemovePayment: (idx: number) => void;
    remainingToPay: number;
    changeDue: number;
    onFinish: () => void;
    finishDisabled: boolean;
    finishLabel: string;
    // Fase 2, Task 5 (plano "Fora do Cardápio"): fechar uma conta com 1 método
    // só e valor exato ainda levava 3 toques (escolher método → lançar →
    // finalizar). Só aparece com a lista de pagamentos vazia (`methods.length
    // === 0`) — não faz sentido em split, onde o valor nunca é o total
    // inteiro. Cada botão já finaliza direto, sem passar pela lista.
    onOneClickFinish?: (method: string) => void;
    // Task 4 (2026-08-23, resolução backlog pendente): opt-out por venda,
    // em cima do default por loja (`modelo_emissao_automatica`) que já
    // existe. Só aparece quando o CALLER já confirmou que a loja tem
    // emissão automática configurada (`showEmitirNotaToggle`) — loja sem
    // isso continua sem ganhar nada de novo aqui. `emitirNota` sempre
    // nasce `true` no caller (mesmo comportamento de hoje: toda venda
    // emite); só um `false` explícito muda o resultado, ver o early-exit
    // em app/api/fiscal/emitir/route.ts.
    showEmitirNotaToggle?: boolean;
    emitirNota?: boolean;
    onEmitirNotaChange?: (value: boolean) => void;
    children?: React.ReactNode;
}> = ({
    total, methods, currentMethod, onMethodChange, currentBrand, onBrandChange,
    currentAmount, onAmountChange, onAddPayment, onRemovePayment, remainingToPay,
    changeDue, onFinish, finishDisabled, finishLabel,
    showEmitirNotaToggle, emitirNota, onEmitirNotaChange, onOneClickFinish, children,
}) => (
    <div className="space-y-6 pt-2">
        <div className="bg-[var(--surface-2)] p-4 rounded-xl border border-[var(--border)] text-center">
            <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Total a Receber</p>
            <p className="text-4xl font-black text-[var(--text)] mt-1">R$ {formatBRL(total)}</p>
        </div>

        {/* Payment Methods */}
        <div className="grid grid-cols-3 gap-2">
            {[
                { id: 'CREDIT', label: 'Crédito', icon: CreditCard },
                { id: 'DEBIT', label: 'Débito', icon: CreditCard },
                { id: 'PIX', label: 'PIX', icon: QrCode },
                { id: 'CASH', label: 'Dinheiro', icon: Banknote },
                { id: 'COURTESY', label: 'Cortesia', icon: Gift },
            ].map(m => (
                <button
                    key={m.id}
                    onClick={() => onMethodChange(m.id)}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 u-motion u-press-sm ${
                        currentMethod === m.id
                        ? 'border-[var(--brand)] bg-[var(--brand)]/5 text-[var(--brand)]'
                        : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--border)]'
                    }`}
                >
                    <m.icon size={24} className="mb-1" />
                    <span className="text-xs font-bold">{m.label}</span>
                </button>
            ))}
        </div>

        {/* Achado real ao vivo (2026-08-28): o atalho de 1 toque abaixo
            finaliza direto sem passar pela lista (ver comentário de
            handleFinishPayment) — pra CREDIT/DEBIT isso pulava a bandeira
            do cartão inteiramente, quebrando a conferência por bandeira no
            fechamento de caixa. Removido daqui: cartão sempre passa pelo
            fluxo normal (lançar → bandeira obrigatória → finalizar).
            CASH/PIX não têm bandeira, continuam com o atalho. */}
        {onOneClickFinish && methods.length === 0 && total > 0 && (
            <div className="flex flex-wrap gap-2">
                {[
                    { id: 'CASH', label: 'Dinheiro' },
                    { id: 'PIX', label: 'PIX' },
                ].map(m => (
                    <button
                        key={m.id}
                        onClick={async () => {
                            // Task 4 (2026-08-30) + achado #9 da revisão final de branch: variant
                            // 'danger' pra bater com o mesmo padrão já usado em toda ação
                            // financeira irreversível deste arquivo (excluir produto/usuário etc.)
                            if (await confirm({ message: `Finalizar em ${m.label} — R$ ${formatBRL(total)}? Essa ação fecha a conta e não pode ser desfeita.`, variant: 'danger' })) {
                                onOneClickFinish(m.id);
                            }
                        }}
                        className="flex-1 min-w-[calc(50%-0.25rem)] px-3 py-2 rounded-lg border-2 border-[var(--ok)]/30 bg-[var(--ok)]/5 text-[var(--ok)] text-xs font-bold u-motion u-press-sm hover:bg-[var(--ok)]/10"
                    >
                        {m.label} • R$ {formatBRL(total)} • Finalizar
                    </button>
                ))}
            </div>
        )}

        {/* Bandeira do cartão — só faz sentido pra CREDIT/DEBIT. Catálogo
            fechado (lib/labels.ts CARD_BRAND_LABELS), nunca texto livre.
            Obrigatória (2026-08-28, achado ao vivo): sem ela, a conferência
            por bandeira no fechamento de caixa fica incompleta — handleAddPayment
            bloqueia lançar pagamento de cartão sem bandeira escolhida. */}
        {(currentMethod === 'CREDIT' || currentMethod === 'DEBIT') && (
            <div className="animate-fade-in">
                <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Bandeira</p>
                <div className="grid grid-cols-3 gap-2">
                    {Object.entries(CARD_BRAND_LABELS).map(([id, label]) => (
                        <button
                            key={id}
                            onClick={() => onBrandChange(currentBrand === id ? '' : id)}
                            className={`py-2 rounded-lg border-2 text-xs font-bold u-motion u-press-sm ${
                                currentBrand === id
                                ? 'border-[var(--brand)] bg-[var(--brand)]/5 text-[var(--brand)]'
                                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>
        )}

        {/* Amount Input */}
        <div className="flex gap-2">
            <div className="flex-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] font-bold">R$</span>
                <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-[var(--border)] focus:border-[var(--brand)] focus:outline-none font-bold text-lg"
                    placeholder="0.00"
                    value={currentAmount}
                    onChange={e => onAmountChange(e.target.value)}
                />
            </div>
            <Button onClick={onAddPayment} className="px-6 bg-[var(--ink)] text-white">
                <Plus size={20} />
            </Button>
        </div>

        {/* Payment List */}
        <div className="bg-[var(--surface-2)] rounded-xl p-3 border border-[var(--border)] min-h-[100px]">
            {methods.length > 0 ? (
                <ul className="space-y-2">
                    {methods.map((p, idx) => (
                        <li key={idx} className="flex justify-between items-center text-sm bg-[var(--surface)] p-2 rounded border border-[var(--border)] shadow-sm">
                            <div className="flex items-center gap-2">
                                <span className="font-bold text-[var(--text)]">
                                    {getPaymentMethodLabel(p.method)}
                                    {p.brand && <span className="font-normal text-[var(--text-muted)]"> · {getCardBrandLabel(p.brand)}</span>}
                                </span>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="font-mono font-bold">R$ {formatBRL(p.amount)}</span>
                                <button onClick={() => onRemovePayment(idx)} className="text-[var(--err)]/60 hover:text-[var(--err)] u-motion u-press">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-center text-[var(--text-muted)] text-xs py-8">Nenhum pagamento lançado</p>
            )}
        </div>

        {/* Task 4 (2026-08-23): toggle "Emitir nota fiscal desta venda" —
            rótulo neutro de propósito, nunca menciona imposto/carga
            tributária (ver AGENTS.md/backlog item 13). Usos legítimos já
            documentados: cortesia interna, loja sem módulo fiscal
            contratado, emissão por outro sistema, contingência SEFAZ —
            nenhum precisa de texto explicativo aqui, o toggle já é
            autoexplicativo. */}
        {showEmitirNotaToggle && (
            <div className="flex items-center justify-between bg-[var(--surface-2)] p-3 rounded-xl border border-[var(--border)]">
                <span className="text-sm font-bold text-[var(--text)]">Emitir nota fiscal desta venda</span>
                <button
                    type="button"
                    onClick={() => onEmitirNotaChange?.(!emitirNota)}
                    role="switch"
                    aria-checked={!!emitirNota}
                    aria-label="Emitir nota fiscal desta venda"
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${emitirNota ? 'bg-[var(--ok)]' : 'bg-[var(--border)]'}`}
                >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${emitirNota ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
            </div>
        )}

        {children}

        {/* Summary & Action */}
        <div className="border-t border-[var(--border)] pt-4">
            <div className="space-y-1 mb-4 px-2">
                <div className="flex justify-between text-sm">
                    <span className="text-[var(--text-muted)]">Restante a Pagar:</span>
                    <span className="font-bold text-[var(--err)]">
                        R$ {formatBRL(remainingToPay)}
                    </span>
                </div>
                {changeDue > 0 && (
                    <div className="flex justify-between text-sm">
                        <span className="text-[var(--text-muted)]">Troco:</span>
                        <span className="font-bold text-[var(--ok)]">
                            R$ {formatBRL(changeDue)}
                        </span>
                    </div>
                )}
            </div>
            <Button
                onClick={onFinish}
                className="w-full h-12 text-lg font-bold bg-[var(--ok)] hover:bg-[var(--ok)]/90 text-white shadow-lg shadow-[var(--ok)]/20"
                disabled={finishDisabled}
            >
                <CheckCircle size={20} className="mr-2"/> {finishLabel}
            </Button>
        </div>
    </div>
);

const TablesView: React.FC<{
    store: Store;
    loggedUser: StoreUser;
    // Task 3 (frente-de-caixa): CaixaView (aba "Caixa") navega até aqui pra
    // abrir o modal "Receber Pagamento" já existente de uma mesa da fila
    // consolidada, em vez de duplicar o fluxo de pagamento — ver
    // handleOpenPayment abaixo e o efeito que consome estas duas props.
    // Ambas opcionais: todo outro caller de TablesView (StoreModule.tsx,
    // tab==='tables' normal) não passa nenhuma das duas, comportamento
    // idêntico ao de sempre.
    autoOpenTableId?: string;
    onAutoOpenTableHandled?: () => void;
}> = ({ store, loggedUser, autoOpenTableId, onAutoOpenTableHandled }) => {
    const storeId = store.id;
    const serviceFeeRate = store.config?.service_fee_rate ?? SERVICE_FEE_RATE;
    // Task 2 (2026-08-22, plano perfis-de-loja-e-caixa): loja sem `config`
    // (as 6 lojas reais de hoje) resolve pra 'kds' — nada aqui muda o
    // comportamento delas. Só o Sertão (order_flow: 'direct_print') entra
    // nos ramos novos abaixo (impressão no clique de handleAddItem, gate de
    // fechamento sem exigir status, histórico de envios).
    const orderFlow = resolveOrderFlow(store);
    // Módulo Caixa (Task 4, 2026-08-22): quem pode finalizar (fechar +
    // receber pagamento) em vez de só pedir a conta. Ver
    // lib/storeModules.ts (canFinalizeBill) pro porquê de ser restritivo
    // (ausência de permissão 'caixa' = false, ao contrário do padrão
    // permissivo usado nas outras permissões) — confirmado em produção que
    // nenhum store_user real hoje tem essa chave, então isto não muda nada
    // nas 7 lojas reais por padrão.
    const canFinalize = canFinalizeBill(loggedUser, store);
    // Subprojeto 3 (2026-08-25) — "trocar responsável" rápido: mesmo padrão
    // de acesso já usado pra decidir quem vê a aba Administração (onde a
    // edição completa de jurisdição já vivia, dentro de Gestão de
    // Usuários) — não inventa uma regra nova de permissão só pra esta ação
    // menor.
    const canReassignJurisdiction = loggedUser.role === 'owner' || loggedUser.role === 'universal' || hasTabPermission(loggedUser, 'admin', store);
    // Achado real (auditoria "o que falta", 2026-08-27): a reunião com o
    // Ramon (2026-08-25, item confirmado "nem garçom, nem caixa devem poder
    // bloquear/desbloquear PIN") tinha essa regra combinada, mas nunca
    // chegou a ser travada no código — qualquer um com acesso à aba Mesas
    // conseguia. Mesmo critério de "gerente" já usado em
    // canReassignJurisdiction acima.
    const canManagePin = loggedUser.role === 'owner' || loggedUser.role === 'manager' || loggedUser.role === 'universal' || hasTabPermission(loggedUser, 'admin', store);
    // Critical #2 (revisão de branch 2026-08-23 — "Reimprimir pode mentir
    // sucesso num aparelho sem impressora"): gate pra OFERECER o botão manual
    // "Reimprimir" em "Pedidos do Dia" abaixo, mesmo critério exato que
    // decide se o loop automático de impressão roda neste aparelho
    // (`isCaixaRole`, CaixaPrintStation.tsx — dono/universal excluídos pelo
    // mesmo motivo já documentado lá: `permissions.caixa` sintético da conta
    // universal só espelha se a LOJA tem o módulo ligado, não se este usuário
    // é operador de caixa de verdade). Sem isso, um garçom (permissions.tables
    // mas não caixa) abrindo o mesmo modal no próprio celular tocava
    // "Reimprimir" e `window.print()` resolvia "com sucesso" sem nenhuma
    // impressora de cozinha configurada ali — o toast mentia "Reimpresso com
    // sucesso" e nada chegava na cozinha. Continuam vendo a lista e o status
    // de impressão de cada linha (view-only, pedido original), só perdem a
    // AÇÃO que pode mentir sucesso.
    const canReprint = orderFlow === 'direct_print' && isCaixaRole(loggedUser);
    const watchedTables = useWatchedTables(storeId);

    // Task 21 (plano "Fora do Cardápio"): reservas de hoje em diante — MVP
    // sem realtime (reserva é um evento raro comparado a pedido/mesa, um
    // refresh manual/no load da aba já é suficiente, não justifica mais um
    // canal de Realtime).
    const [reservations, setReservations] = useState<TableReservation[]>([]);
    const [isLoadingReservations, setIsLoadingReservations] = useState(false);
    const [savingReservationIds, setSavingReservationIds] = useState<Set<string>>(new Set());

    const loadReservations = async () => {
        setIsLoadingReservations(true);
        try {
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            const data = await fetchReservationsByStore(storeId, startOfToday.toISOString());
            setReservations(data);
        } finally {
            setIsLoadingReservations(false);
        }
    };

    useEffect(() => { loadReservations(); }, [storeId]);

    const handleUpdateReservation = async (reservationId: string, status: 'confirmed' | 'canceled') => {
        setSavingReservationIds(prev => new Set(prev).add(reservationId));
        try {
            const result = await updateReservationStatus(reservationId, status);
            if (!result.success) throw new Error(result.message);
            setReservations(prev => prev.map(r => r.id === reservationId ? { ...r, status } : r));
        } catch (e: any) {
            toast.error('Erro ao atualizar reserva: ' + e.message);
        } finally {
            setSavingReservationIds(prev => { const copy = new Set(prev); copy.delete(reservationId); return copy; });
        }
    };
    const isFinishingRef = useRef(false);
    // Fix round 1 (Task 2 review, Minor #3): mesmo estilo de guarda que
    // isFinishingRef já usa em handleFinishPayment — sem isso, um duplo
    // toque rápido em "Lançar Pedido" dispara duas createOrder e, em
    // direct_print, imprime dois tickets físicos + duplica o pedido na
    // cozinha.
    const isAddingItemRef = useRef(false);
    const [tables, setTables] = useState<Table[]>([]);
    const [activeOrders, setActiveOrders] = useState<Order[]>([]);
    // "Pedidos do Dia" (extensão do antigo "Pedidos Enviados", redesign
    // 2026-08-23) — mesas JÁ FECHADAS hoje, buscadas à parte porque
    // fetch_active_table_orders_secure exclui `status = 'delivered'` por
    // design (é o mesmo filtro que faz o card de mesa sumir da lista quando
    // a conta fecha). Ver sentHistoryItems abaixo pra como os dois se
    // combinam.
    const [closedTodayOrders, setClosedTodayOrders] = useState<Order[]>([]);
    const [selectedTable, setSelectedTable] = useState<Table | null>(null);
    const [showFullBill, setShowFullBill] = useState(false);
    
    // Menu Mode State
    const [showMenuMode, setShowMenuMode] = useState(false);

    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [showFixDbModal, setShowFixDbModal] = useState(false);
    const [showMoveTableModal, setShowMoveTableModal] = useState(false);
    const [targetTableId, setTargetTableId] = useState('');
    const [visiblePins, setVisiblePins] = useState<Set<string>>(new Set());
    const [areCardsCollapsed, setAreCardsCollapsed] = useState(false);
    const [pinBlockEnabled, setPinBlockEnabled] = useState(store.config?.require_pin_for_open || false);

    // Avisos de tempo (pedido do dono, 2026-08-29) — 0 = desligado. Não
    // existe timestamp de "mesa aberta desde" na tabela `tables`; usa o
    // item mais ANTIGO dos pedidos ativos como aproximação de "ocupada
    // desde" e o mais NOVO como "último pedido em" (mesmo `allItems`, já
    // ordenado do mais novo pro mais antigo, que getTableSummary monta
    // logo abaixo). `nowTick` força recálculo periódico sem refetch —
    // mesmo princípio de lib/schedule.ts (categoria por horário).
    const tableAlertOccupiedMin = store.config?.table_alert_occupied_minutes || 0;
    const tableAlertNoOrderMin = store.config?.table_alert_no_order_minutes || 0;
    const [nowTick, setNowTick] = useState(() => Date.now());
    useEffect(() => {
        if (!tableAlertOccupiedMin && !tableAlertNoOrderMin) return;
        const id = window.setInterval(() => setNowTick(Date.now()), 30000);
        return () => window.clearInterval(id);
    }, [tableAlertOccupiedMin, tableAlertNoOrderMin]);

    const togglePin = (e: React.MouseEvent, tableId: string, inJurisdiction: boolean = true) => {
        e.stopPropagation();
        // Trava de jurisdicao (Task 3): `disabled` no <button> ja tira o
        // elemento do tab order e bloqueia Enter/Space nativamente, mas o
        // handler tambem no-opa por defesa em profundidade — nunca confiar
        // só no atributo pra impedir a acao (ex.: gesto de ativacao de leitor
        // de tela nao passa necessariamente por keydown/click do DOM).
        if (!inJurisdiction) return;
        setVisiblePins(prev => {
            const next = new Set(prev);
            if (next.has(tableId)) next.delete(tableId);
            else next.add(tableId);
            return next;
        });
    };

    const handlePinBlockToggle = async () => {
        const newValue = !pinBlockEnabled;
        setPinBlockEnabled(newValue);
        try {
            await updateStoreConfig(store.id, {
                ...store.config,
                require_pin_for_open: newValue
            });
        } catch (e) {
            console.error("Error updating config", e);
            setPinBlockEnabled(!newValue); // Revert on error
            toast.error("Erro ao atualizar configuração.");
        }
    };

    // Task 2 (2026-08-22): "Histórico de Pedidos Enviados" — substituto do
    // KDS pra lojas em direct_print. `activeOrders` (mesas ainda abertas) é
    // derivado sem busca própria; `closedTodayOrders` (mesas fechadas hoje)
    // É buscado à parte, só quando este modal abre — ver efeito abaixo
    // (Important #I3, revisão de código 2026-08-23).
    const [showSentHistory, setShowSentHistory] = useState(false);
    // Subprojeto 3 (2026-08-25) — "Meus pedidos do dia": um garçom numa loja
    // com vários lançando na mesma "Pedidos do Dia" tinha que caçar os
    // próprios itens numa lista misturada de todo mundo. Default ligado só
    // pra quem é `waiter` de verdade (não `owner`/`universal`/`cashier`,
    // que fazem sentido ver tudo por padrão) — reaproveita `added_by_name`
    // (migration 053) já gravado por item, sem query nova.
    const [showOnlyMine, setShowOnlyMine] = useState(loggedUser.role === 'waiter');

    // Subprojeto 3 (2026-08-25) — reatribuir a mesa selecionada pra outro
    // garçom sem precisar abrir Gestão de Usuários. Só afeta quem JÁ tem
    // alguma restrição configurada (assigned_table_ids não vazio) — um
    // garçom sem restrição ("todas as mesas") já vê esta mesa por padrão, e
    // restringi-lo aqui seria um efeito colateral inesperado de uma ação
    // pensada pra ser rápida, não pra configurar jurisdição do zero (isso
    // continua em Gestão de Usuários, de propósito).
    const [showReassignModal, setShowReassignModal] = useState(false);
    const [reassignTeam, setReassignTeam] = useState<StoreUser[]>([]);
    const [isLoadingReassignTeam, setIsLoadingReassignTeam] = useState(false);
    const [savingReassignIds, setSavingReassignIds] = useState<Set<string>>(new Set());
    // Fase 3, Task 10: quem bateu ponto agora nesta loja (fetchOpenCheckin
    // já existia da Fase 4 do ponto pessoal, mas só pra UM usuário — aqui
    // precisa de todos de uma vez, ver fetchOpenCheckinUserIds em lib/api.ts).
    const [openCheckinUserIds, setOpenCheckinUserIds] = useState<Set<string>>(new Set());

    const handleOpenReassign = async () => {
        setShowReassignModal(true);
        setIsLoadingReassignTeam(true);
        try {
            const [members, checkedInIds] = await Promise.all([
                fetchStoreTeamMembers(storeId),
                fetchOpenCheckinUserIds(storeId),
            ]);
            setReassignTeam(members.filter(m => m.role !== 'owner' && m.role !== 'universal' && m.permissions?.tables !== false));
            setOpenCheckinUserIds(checkedInIds);
        } finally {
            setIsLoadingReassignTeam(false);
        }
    };

    const handleToggleReassign = async (member: StoreUser) => {
        if (!selectedTable) return;
        const current = member.assigned_table_ids || [];
        const next = current.includes(selectedTable.id)
            ? current.filter(id => id !== selectedTable.id)
            : [...current, selectedTable.id];
        setSavingReassignIds(prev => new Set(prev).add(member.id));
        try {
            await updateStoreTeamMember(member.id, { assigned_table_ids: next });
            setReassignTeam(prev => prev.map(m => m.id === member.id ? { ...m, assigned_table_ids: next } : m));
            toast.success(`Mesa ${next.includes(selectedTable.id) ? 'atribuída a' : 'removida de'} ${member.name}.`);
        } catch (e: any) {
            toast.error('Erro ao atualizar: ' + e.message);
        } finally {
            setSavingReassignIds(prev => { const copy = new Set(prev); copy.delete(member.id); return copy; });
        }
    };

    // Fase 3, Task 9 (plano "Fora do Cardápio"): escala inteligente de mesa
    // — sugestão visual (nunca automática, o operador continua escolhendo),
    // ordenando quem já tem jurisdição restrita configurada do MENOS pro
    // MAIS ocupado agora. "Ocupado agora" cruza `assigned_table_ids` do
    // garçom com as mesas dessa jurisdição que estão `OCCUPIED` neste
    // instante — não é o total de mesas atribuídas (isso já aparecia antes),
    // é quantas dessas estão com gente sentada AGORA.
    // Fase 3, Task 10: "ligada ao ponto" — um garçom SEM ponto aberto some da
    // sugestão de NOVA atribuição (não é candidato a pegar mais uma mesa
    // agora), mas continua aparecendo normalmente se já é responsável pela
    // mesa selecionada (jurisdição de mesa em andamento nunca é removida só
    // por isso — o operador ainda pode desmarcar manualmente se quiser).
    const reassignTeamByLoad = useMemo(() => {
        return reassignTeam
            .filter(m => m.assigned_table_ids && m.assigned_table_ids.length > 0)
            .map(m => ({
                ...m,
                activeTableCount: tables.filter(t => t.status === TableStatus.OCCUPIED && (m.assigned_table_ids || []).includes(t.id)).length,
                hasOpenCheckin: openCheckinUserIds.has(m.id),
            }))
            .filter(m => m.hasOpenCheckin || (!!selectedTable && (m.assigned_table_ids || []).includes(selectedTable.id)))
            .sort((a, b) => a.activeTableCount - b.activeTableCount);
    }, [reassignTeam, tables, openCheckinUserIds, selectedTable]);

    // Important #I3: antes, `fetchSalesHistory` (RPC `limit 2000` com
    // `order_items` aninhado) rodava dentro de `loadData` — chamada a cada
    // ping Realtime de `order_change_pings`/`table_change_pings`, mesmo com
    // o modal fechado. Movida pra cá: só busca quando o caixa realmente abre
    // "Pedidos do Dia", uma vez por abertura (não fica reassinando Realtime
    // pro histórico — é view-only, reabrir o modal já traz o estado atual).
    useEffect(() => {
        if (!showSentHistory || orderFlow !== 'direct_print' || !storeId) return;
        let cancelled = false;
        (async () => {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const closed = await fetchSalesHistory(storeId, startOfDay.toISOString());
            if (!cancelled) setClosedTodayOrders(closed.filter(ord => ord.order_type === 'table'));
        })();
        return () => { cancelled = true; };
    }, [showSentHistory, orderFlow, storeId]);

    // Task 4 (2026-08-22, módulo Caixa): `brand` é novo — opcional, só
    // preenchido quando currentPaymentMethod é CREDIT/DEBIT (ver seletor de
    // bandeira abaixo). Aditivo: cada entrada continua valendo como estava
    // (método + valor) pra quem não usa cartão.
    const [paymentMethods, setPaymentMethods] = useState<{ method: string, amount: number, brand?: string }[]>([]);
    const [currentPaymentAmount, setCurrentPaymentAmount] = useState('');
    const [removedServiceFees, setRemovedServiceFees] = useState<Set<string>>(new Set());
    const [currentPaymentMethod, setCurrentPaymentMethod] = useState('CREDIT');
    const [currentPaymentBrand, setCurrentPaymentBrand] = useState('');

    // StorePaymentModal Tabs & Calculators
    const [paymentTab, setPaymentTab] = useState<'payment' | 'split' | 'users' | 'calculator'>('payment');
    const [paymentPeople, setPaymentPeople] = useState(1);
    const [paymentSelectedItems, setPaymentSelectedItems] = useState<{ [itemId: string]: number }>({});

    // Destinatário da NF-e (Task 17) — opcional, só relevante quando a loja
    // está configurada em modelo_emissao_automatica === 'nfe' (NFC-e não tem
    // <dest>, não precisa de nada disso). `nfeModeloAtivo` é buscado à parte
    // (fetchStoreFiscalConfig) porque esta view não tem acesso ao state de
    // MenuManagementView (onde a config fiscal já é carregada pra edição) —
    // são componentes irmãos, sem estado compartilhado.
    const [nfeModeloAtivo, setNfeModeloAtivo] = useState(false);
    const [paymentDestCpfCnpj, setPaymentDestCpfCnpj] = useState('');
    const [paymentDestNome, setPaymentDestNome] = useState('');

    // Task 4 (2026-08-23): idem, mas pra decidir se mostra o toggle
    // "Emitir nota fiscal desta venda" — qualquer modelo configurado
    // (nfce OU nfe), não só nfe como `nfeModeloAtivo` acima (aquele é
    // específico do campo de destinatário, que só existe pra NF-e).
    // `emitirNotaFiscal` nasce sempre `true` (default ligado — mesmo
    // comportamento de hoje) e é resetado a cada abertura do modal de
    // pagamento, nunca herda o valor da venda anterior.
    const [emissaoFiscalConfigurada, setEmissaoFiscalConfigurada] = useState(false);
    const [emitirNotaFiscal, setEmitirNotaFiscal] = useState(true);

    const currentTableSummary = useMemo(() => {
        if (!selectedTable) return null;
        const tableOrders = activeOrders.filter(o => o.table_id === selectedTable.id);
        let subtotal = 0;
        let items: OrderItem[] = [];
        tableOrders.forEach(o => {
            if(o.order_items) {
                o.order_items.forEach(i => {
                    if(i.status !== 'canceled') {
                        subtotal += (i.price_at_time * i.quantity);
                        items.push(i);
                    }
                });
            }
        });
        items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        const isServiceFeeEnabled = !!(store.config?.charge_service_fee && !removedServiceFees.has(selectedTable.id));
        // Task 3: distingue "loja nunca cobra" de "loja cobra, mas foi
        // removida desta mesa" (mesmo botão "Remover Taxa" da comanda) —
        // os dois zeram isServiceFeeEnabled, mas o texto explicativo pro
        // garçom precisa dizer qual dos dois é, não só "sem taxa".
        const isServiceFeeRemovedForTable = !!(store.config?.charge_service_fee && removedServiceFees.has(selectedTable.id));
        const serviceFee = isServiceFeeEnabled ? calculateServiceFee(subtotal, serviceFeeRate) : 0;
        const total = calculateOrderTotal(subtotal, isServiceFeeEnabled, serviceFeeRate);
        return { subtotal, serviceFee, total, allItems: items, isServiceFeeEnabled, isServiceFeeRemovedForTable };
    }, [selectedTable, activeOrders, store, removedServiceFees]);

    const usersBreakdown = useMemo(() => {
        if (!currentTableSummary) return {};
        const breakdown: { [name: string]: { subtotal: number, serviceFee: number, total: number, items: any[] } } = {};

        currentTableSummary.allItems.forEach(item => {
            const match = item.notes ? item.notes.match(/^\[(.*?)\]/) : null;
            const userName = match ? match[1] : 'Mesa / Geral';

            if (!breakdown[userName]) {
                breakdown[userName] = { subtotal: 0, serviceFee: 0, total: 0, items: [] };
            }
            breakdown[userName].items.push(item);
            breakdown[userName].subtotal += (item.price_at_time * item.quantity);
        });

        const splitItems: SplitItem[] = Object.entries(breakdown).map(([userName, data]) => ({ userName, subtotal: data.subtotal }));
        const totalsByUser = calculateSplitByPerson(splitItems, currentTableSummary.isServiceFeeEnabled, serviceFeeRate);

        Object.keys(breakdown).forEach(userName => {
            const userSubtotal = breakdown[userName].subtotal;
            breakdown[userName].serviceFee = currentTableSummary.isServiceFeeEnabled ? calculateServiceFee(userSubtotal, serviceFeeRate) : 0;
            breakdown[userName].total = totalsByUser.get(userName) ?? userSubtotal;
        });

        return breakdown;
    }, [currentTableSummary]);

    // Nota fiscal individualizada por pessoa (migration 055, pedido real da
    // reunião com o Ramon, 2026-08-25): "se a pessoa paga separado, não vai
    // ser só uma nota... hoje você não consegue individualizar" — antes só
    // dava pra emitir o pedido inteiro de uma vez, no fechamento da mesa.
    // Reaproveita o mesmo agrupamento de usersBreakdown; itens já cobertos
    // por essa chamada saem pendentes de faturamento no fechamento final
    // automático da mesa (route.ts filtra fiscal_nota_id is null).
    const [emitindoNotaDe, setEmitindoNotaDe] = useState<string | null>(null);
    const handleEmitirNotaIndividual = async (userName: string, items: OrderItem[]) => {
        if (!selectedTable) return;
        setEmitindoNotaDe(userName);
        try {
            const destinatario = buildDestinatario(paymentDestCpfCnpj, paymentDestNome);
            const res = await fetch('/api/fiscal/emitir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tableId: selectedTable.id,
                    itemIds: items.map(i => i.id),
                    pessoaNome: userName,
                    destinatario,
                }),
            });
            const data = await res.json();
            if (data.ok) {
                toast.success(`Nota fiscal de ${userName} autorizada (chave ${data.chave?.slice(-6) ?? ''}).`);
            } else if (data.skipped) {
                toast.info(data.reason || 'Nada pra faturar.');
            } else {
                toast.error(`Falha ao emitir nota de ${userName}: ${data.reason || data.xMotivo || 'erro desconhecido'}`);
            }
        } catch (e: any) {
            toast.error(`Falha ao emitir nota de ${userName}: ${e.message}`);
        } finally {
            setEmitindoNotaDe(null);
        }
    };

    // "Pedidos do Dia" (Task 2, 2026-08-22 — "Histórico de Pedidos Enviados"
    // original, expandido no redesign de 2026-08-23 a pedido do dono: "o
    // histórico desaparecia quando a mesa fechava, ele quer o dia inteiro,
    // mesa fechada incluída, só visualização"). Sem RPC/migration nova:
    // combina `activeOrders` (mesas ainda abertas, já assinado via Realtime
    // pelo canal `tables_dashboard_*` acima) com `closedTodayOrders` (mesas
    // fechadas HOJE, buscado à parte só quando o modal abre — ver efeito de
    // `showSentHistory` acima, Important #I3 — `fetch_active_table_
    // orders_secure` exclui `status='delivered'` por design, não dá pra
    // reaproveitar sem herdar esse filtro). Só existe a visão, sem nenhum
    // controle de confirmação de entrega — pedido explícito ("view only").
    //
    // `printed`: melhor esforço, não garantia — reflete o dedupe local da
    // reconciliação do Caixa (`wasKitchenTicketPrinted`, CaixaPrintStation.tsx),
    // que só sabe o que ESTE navegador confirmou ter impresso. Sem isso (ex.:
    // outro aparelho imprimiu, ou o item ainda não foi reconciliado) o badge
    // mostra "sem registro", nunca afirma "não imprimiu" (não dá pra provar
    // um negativo sem estado no servidor, e não há migration nesta task pra
    // isso).
    //
    // Redesign 2026-08-23 (revisão crítica, dois achados): (1) item de
    // garçom NÃO é mais assumido como "sempre impresso" — `handleAddItem`
    // parou de imprimir no próprio aparelho do garçom (achado "waiter-
    // launched orders print nowhere real"), então ele passa pelo MESMO
    // dedupe de QR/Balcão agora. (2) `printedRefreshTick` força este useMemo
    // a recalcular depois de uma reimpressão manual (`handleManualReprint`
    // abaixo) — `wasKitchenTicketPrinted` lê localStorage direto, que não é
    // uma dependência que o React observa sozinho.
    const [printedRefreshTick, setPrintedRefreshTick] = useState(0);
    const [reprintingIds, setReprintingIds] = useState<Set<string>>(new Set());
    const sentHistoryItems = useMemo(() => {
        if (orderFlow !== 'direct_print') return [];
        const tableNumberById = new Map(tables.map(t => [t.id, t.number]));
        const rows: {
            id: string;
            orderId: string;
            time: string;
            tableNumber: number | string;
            productName: string;
            quantity: number;
            destination: 'kitchen' | 'bar';
            addons?: string;
            observation?: string;
            client?: string | null;
            closed: boolean;
            printed: boolean;
            addedByName?: string | null;
        }[] = [];
        const pushOrder = (order: Order, closed: boolean) => {
            (order.order_items || []).forEach(item => {
                if (item.status === OrderStatus.CANCELED) return;
                const destination: 'kitchen' | 'bar' = item.product?.destination === 'bar' ? 'bar' : 'kitchen';
                const { client, observation } = parseItemNote(item.notes || '');
                rows.push({
                    id: item.id,
                    orderId: item.order_id,
                    time: item.created_at,
                    tableNumber: (order.table_id && tableNumberById.get(order.table_id)) ?? order.tables?.number ?? '?',
                    productName: item.product?.name || 'Produto indisponível',
                    quantity: item.quantity,
                    destination,
                    addons: (item.selected_options || []).map(o => o.name).join(', ') || undefined,
                    observation: observation || undefined,
                    client,
                    closed,
                    printed: wasKitchenTicketPrinted(storeId, destination, item.id),
                    addedByName: item.added_by_role === 'garcom' ? item.added_by_name : null,
                });
            });
        };
        activeOrders.forEach(order => pushOrder(order, false));
        closedTodayOrders.forEach(order => pushOrder(order, true));
        return rows.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
        // eslint-disable-next-line react-hooks/exhaustive-deps -- printedRefreshTick é só um gatilho de recálculo (lê localStorage via wasKitchenTicketPrinted), não um valor usado no corpo.
    }, [orderFlow, activeOrders, closedTodayOrders, tables, storeId, printedRefreshTick]);

    // Reimpressão manual (Critical #1 — corte de ativação): item que a
    // reconciliação automática do Caixa não pegou sozinha (o caso mais comum
    // sendo criado antes do `activatedAt` desta sessão, mas serve pra
    // qualquer linha "sem registro") ganha aqui um jeito de recuperação com
    // toque humano — nunca fica só invisível na lista.
    const handleManualReprint = async (row: { id: string; orderId: string; tableNumber: number | string; productName: string; quantity: number; destination: 'kitchen' | 'bar'; addons?: string; observation?: string; client?: string | null }) => {
        // Guarda redundante ao gate visual (`canReprint` no botão acima) —
        // Critical #2: a ação em si nunca deve rodar fora do aparelho de
        // caixa de verdade, mesmo se algo chamar isto por outro caminho no
        // futuro. `window.print()` "tem sucesso" mesmo sem impressora real
        // configurada — não é aceitável depender só de esconder o botão.
        if (!canReprint) return;
        if (reprintingIds.has(row.id)) return;
        setReprintingIds(prev => new Set(prev).add(row.id));
        try {
            const ok = await printPendingKitchenTicket({
                storeId,
                storeName: store.name,
                paperWidthMm: store.config?.printer_paper_width_mm,
                destination: row.destination,
                itemId: row.id,
                orderId: row.orderId,
                tableNumber: row.tableNumber,
                quantity: row.quantity,
                productName: row.productName,
                addons: row.addons,
                observation: row.observation,
                client: row.client,
            });
            if (ok) {
                toast.success('Reimpresso com sucesso.');
                setPrintedRefreshTick(t => t + 1);
            } else {
                toast.error('A reimpressão falhou. Verifique a impressora.');
            }
        } finally {
            setReprintingIds(prev => {
                const copy = new Set(prev);
                copy.delete(row.id);
                return copy;
            });
        }
    };

    const toggleSelection = (itemId: string, maxQty: number) => {
        setPaymentSelectedItems(prev => {
            const current = prev[itemId] || 0;
            if (current > 0) {
                const copy = { ...prev };
                delete copy[itemId];
                return copy;
            } else {
                return { ...prev, [itemId]: maxQty };
            }
        });
    };

    const updateSelectionQty = (itemId: string, delta: number, maxQty: number) => {
        setPaymentSelectedItems(prev => {
            const current = prev[itemId] || 0;
            const newQty = Math.min(Math.max(0, current + delta), maxQty);
            if (newQty === 0) {
                const copy = { ...prev };
                delete copy[itemId];
                return copy;
            }
            return { ...prev, [itemId]: newQty };
        });
    };

    const calculatorSubtotal = useMemo(() => {
        if (!currentTableSummary || !currentTableSummary.allItems) return 0;
        let sum = 0;
        currentTableSummary.allItems.forEach(item => {
            if (paymentSelectedItems[item.id]) {
                sum += (item.price_at_time * paymentSelectedItems[item.id]);
            }
        });
        return sum;
    }, [currentTableSummary, paymentSelectedItems]);

    const calculatorServiceFee = (currentTableSummary?.isServiceFeeEnabled) ? calculateServiceFee(calculatorSubtotal, serviceFeeRate) : 0;
    const calculatorTotal = calculateOrderTotal(calculatorSubtotal, !!currentTableSummary?.isServiceFeeEnabled, serviceFeeRate);

    const SQL_FIX_SCRIPT = `-- Rode este script no SQL Editor do Supabase
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='payment_method') THEN
        ALTER TABLE orders ADD COLUMN payment_method TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='payment_details') THEN
        ALTER TABLE orders ADD COLUMN payment_details JSONB;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tables' AND column_name='service_fee_removed') THEN
        ALTER TABLE tables ADD COLUMN service_fee_removed BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';`;

    const loadData = async () => {
        if(!storeId) return;
        // Nao rebusca `stores` aqui (achado de performance #9): os eventos
        // Realtime assinados abaixo sao de `tables`/`orders`/`order_items`,
        // nenhum deles muda dado de `stores` — a config da loja ja vem
        // atualizada via prop `store` (StoreModule mantem `user.store` em
        // sincronia sempre que algo em `stores` muda de fato, ex.:
        // MenuManagementView.handleToggleServiceFee → onStoreUpdate).
        const [t, o] = await Promise.all([
            fetchTables(storeId),
            fetchActiveOrdersForTables(storeId),
        ]);
        setTables(t);
        setActiveOrders(o);

        // "Pedidos do Dia" (mesas fechadas hoje) NÃO é mais buscado aqui —
        // ver o efeito de `showSentHistory` abaixo (Important #I3, revisão
        // de código 2026-08-23): `fetchSalesHistory` é uma RPC `limit 2000`
        // com `order_items` aninhado, e `loadData` roda a cada ping Realtime
        // de `order_change_pings`/`table_change_pings` — MUITO mais vezes
        // por minuto do que alguém realmente abre o modal "Pedidos do Dia".
        // Rodar essa RPC toda vez era trabalho pago pra uma tela que, na
        // prática, fica fechada quase sempre.

        // Update selected table if open to reflect latest service_fee_removed state
        setSelectedTable(prev => {
            if (!prev) return null;
            const updated = t.find(table => table.id === prev.id);
            return updated || prev;
        });
    };

    useEffect(() => {
        loadData();
        // Subscribe to relevant tables to keep card summary updated
        const channel = supabase.channel(`tables_dashboard_${storeId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'table_change_pings', filter: `store_id=eq.${storeId}` }, () => loadData())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'order_change_pings', filter: `store_id=eq.${storeId}` }, () => loadData())
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [storeId]);

    // Config fiscal (Task 17) — só pra saber se mostra o campo opcional de
    // CPF/CNPJ do destinatário ao fechar a mesa. Falha silenciosa de
    // propósito (catch vazio): sem config fiscal configurada é o estado
    // normal da maioria das lojas, não um erro pra atrapalhar o fechamento.
    useEffect(() => {
        fetchStoreFiscalConfig(storeId)
            .then((cfg) => {
                setNfeModeloAtivo(cfg?.modelo_emissao_automatica === 'nfe');
                // Task 4: qualquer modelo configurado (nfce OU nfe) já é
                // "emissão automática ligada" pra fins do toggle de opt-out
                // — loja sem NENHUMA config (cfg null) ou com
                // 'nenhuma' explícito não ganha o toggle.
                setEmissaoFiscalConfigurada(!!cfg && cfg.modelo_emissao_automatica !== 'nenhuma');
            })
            .catch(() => {
                setNfeModeloAtivo(false);
                setEmissaoFiscalConfigurada(false);
            });
    }, [storeId]);

    // SYNC MODAL WITH REALTIME TABLE DATA
    useEffect(() => {
        if (selectedTable) {
            const updatedTable = tables.find(t => t.id === selectedTable.id);
            if (updatedTable) {
                // If important properties changed, update the selected modal
                if (updatedTable.status !== selectedTable.status || 
                    updatedTable.waiter_requested !== selectedTable.waiter_requested ||
                    updatedTable.current_host_name !== selectedTable.current_host_name) {
                    setSelectedTable(updatedTable);
                }
            }
        }
    }, [tables, selectedTable]);

    const getTableSummary = (tableId: string) => {
        const tableOrders = activeOrders.filter(o => o.table_id === tableId);
        let subtotal = 0;
        let items: OrderItem[] = [];
        tableOrders.forEach(o => {
            if(o.order_items) {
                o.order_items.forEach(i => {
                    if(i.status !== 'canceled') {
                        subtotal += (i.price_at_time * i.quantity);
                        items.push(i);
                    }
                });
            }
        });
        // Sort by newest
        items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        
        const table = tables.find(t => t.id === tableId);
        const isServiceFeeEnabled = !!(store.config?.charge_service_fee && !removedServiceFees.has(tableId));
        const isServiceFeeRemovedForTable = !!(store.config?.charge_service_fee && removedServiceFees.has(tableId));
        const serviceFee = isServiceFeeEnabled ? calculateServiceFee(subtotal, serviceFeeRate) : 0;
        const total = calculateOrderTotal(subtotal, isServiceFeeEnabled, serviceFeeRate);

        return { subtotal, serviceFee, total, count: items.length, items: items.slice(0, 3), allItems: items, isServiceFeeEnabled, isServiceFeeRemovedForTable }; // Show top 3
    };

    // Totais da aba de Pagamento: quanto falta pagar e, quando o dinheiro
    // lançado excede o total, quanto de troco dar (achado de bug #4).
    const paymentTotalDue = selectedTable ? getTableSummary(selectedTable.id).total : 0;
    const totalPaidSoFar = paymentMethods.reduce((acc, p) => acc + p.amount, 0);
    const remainingToPay = Math.max(0, paymentTotalDue - totalPaidSoFar);
    // Fix round 2 (Group A2): extraído para lib/calc.ts
    // (calculateChangeForMethods) — antes duplicado aqui e em
    // EstacaoModule.tsx (reconcileCaixa), a fórmula do troco (achado real
    // testando ao vivo uma conta dividida, parte cartão parte dinheiro:
    // troco é sobre o que o dinheiro precisava cobrir, não sobre o total
    // cheio da conta) já tinha exatamente o formato que deixou a fórmula
    // de taxa de serviço duplicada em 7+ lugares antes de virar lib/calc.ts.
    const changeDue = calculateChangeForMethods(paymentMethods, paymentTotalDue);

    // Fix round 3 (Group C1): antes esta função não fazia `await` nem
    // tratava o retorno de printBillReceipt() — printHtmlDocument
    // (lib/print.ts) devolve `new Promise((resolve) => {...})` com
    // appendChild/doc.open()/doc.write() dentro do executor, então um throw
    // ali REJEITA a promise em vez de resolver `false`. Sem await/catch,
    // isso vira uma unhandled promise rejection silenciosa em vez de um
    // aviso visível pro operador — reabrindo uma fresta da mesma classe de
    // "impressão falha sem ninguém saber" que o resto deste branch fechou
    // (ver toast.error nos outros call sites de printBillReceipt).
    const printTableBill = async (tableId: string) => {
        const summary = getTableSummary(tableId);
        const table = tables.find(t => t.id === tableId);
        if (!table || summary.allItems.length === 0) return;

        try {
            const receiptOpts = {
                storeName: store.name,
                cnpj: store.cnpj,
                paperWidthMm: store.config?.printer_paper_width_mm,
                label: `MESA ${table.number}`,
                items: summary.allItems.map(item => ({
                    quantity: item.quantity,
                    name: getOrderItemDisplayName(item),
                    client: parseItemNote(item.notes || '').client,
                    total: item.price_at_time * item.quantity,
                })),
                subtotal: summary.subtotal,
                // Task 3: sempre manda o objeto (nunca `undefined`) pra
                // printBillReceipt sempre enunciar o estado da taxa nesta
                // comanda — cobrando, removida desta mesa, ou loja sem taxa.
                // Ausente só faz sentido pro comprovante de balcão
                // (printCounterReceipt), que estruturalmente nunca tem taxa.
                serviceFee: {
                    charged: summary.isServiceFeeEnabled,
                    rate: serviceFeeRate,
                    amount: summary.serviceFee,
                    removedForTable: summary.isServiceFeeRemovedForTable,
                },
                total: summary.total,
            };
            const printed = await printBillReceipt(receiptOpts);
            // Achado ao vivo (2026-08-28): esta é a "conferência da conta"
            // impressa ANTES de pagar (dono pede pra ver o extrato na mesa) —
            // faltava o mesmo enfileiramento pra impressora USB/rede do
            // caixa que handleFinishPayment já tem, então só o comprovante
            // PÓS-pagamento saía na impressora física; este nunca saía.
            enqueueReceiptPrintJobs(store.id, `Conferência - ${receiptOpts.label}`, buildBillReceiptText(receiptOpts))
                .catch((e) => console.error('enqueueReceiptPrintJobs (conferência) falhou:', e));
            if (!printed) {
                toast.error('A conferência da conta não imprimiu. Confira a impressora.');
            }
        } catch (e) {
            console.error('printBillReceipt (conferência de conta) lançou:', e);
            toast.error('A conferência da conta não imprimiu. Confira a impressora.');
        }
    };

    const handleMoveTable = async () => {
        if (!selectedTable || !targetTableId) return;
        
        if (await confirm(`Tem certeza que deseja mover a Mesa ${selectedTable.number} para a nova mesa?`)) {
            const result = await moveTable(selectedTable.id, targetTableId);
            if (result.success) {
                toast.success("Mesa trocada com sucesso!");
                setShowMoveTableModal(false);
                setSelectedTable(null);
                setShowFullBill(false);
                loadData();
            } else {
                toast.error("Erro ao trocar mesa: " + (result.message || 'Erro desconhecido'));
            }
        }
    };

    const handleOpenPayment = (tableOverride?: Table) => {
        // Task 3 (frente-de-caixa): `tableOverride` é novo — usado pelo
        // efeito de auto-abertura (autoOpenTableId, abaixo) pra abrir o
        // modal de pagamento de uma mesa que ainda não é `selectedTable`
        // (o operador chegou aqui direto da fila do Caixa, não clicou no
        // card da mesa). Sem argumento, comportamento idêntico a sempre:
        // opera sobre `selectedTable`.
        const table = tableOverride || selectedTable;
        if (!table) return;
        // Task 4 (módulo Caixa): defesa em profundidade — o botão que chama
        // isto já não renderiza pra quem não pode finalizar (ver JSX
        // abaixo), mas travar aqui também garante que nenhum outro caminho
        // futuro abra o modal de pagamento pra quem só pode pedir a conta.
        if (!canFinalize) return;
        const summary = getTableSummary(table.id);
        setSelectedTable(table);
        setPaymentMethods([]);
        setCurrentPaymentAmount(summary.total.toFixed(2));
        setCurrentPaymentMethod('CREDIT');
        setCurrentPaymentBrand('');
        setPaymentTab('payment');
        setPaymentPeople(1);
        setPaymentSelectedItems({});
        setPaymentDestCpfCnpj('');
        setPaymentDestNome('');
        // Task 4: sempre nasce ligado — default de hoje (emite normal),
        // nunca herda o valor escolhido na venda anterior desta mesma mesa.
        setEmitirNotaFiscal(true);
        setShowPaymentModal(true);
    };

    // Task 3 (frente-de-caixa): consome autoOpenTableId — assim que a lista
    // de mesas estiver carregada (tables.length > 0), acha a mesa pedida
    // pela fila do Caixa e abre o MESMO modal "Receber Pagamento" que o
    // clique manual no card da mesa já abre (handleOpenPayment acima).
    // Sempre avisa o caller (onAutoOpenTableHandled) depois de tentar, ache
    // ou não a mesa — evita ficar "preso" pedindo pra sempre uma mesa que já
    // foi paga/fechada por outra pessoa entre o toque na fila e o load
    // desta view.
    useEffect(() => {
        if (!autoOpenTableId || tables.length === 0) return;
        const table = tables.find(t => t.id === autoOpenTableId);
        if (table) handleOpenPayment(table);
        onAutoOpenTableHandled?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoOpenTableId, tables]);

    const handleAddPayment = () => {
        const amount = parseFloat(currentPaymentAmount.replace(',', '.'));
        if (isNaN(amount) || amount <= 0) return;

        const isCard = currentPaymentMethod === 'CREDIT' || currentPaymentMethod === 'DEBIT';
        // Achado real ao vivo (2026-08-28): bandeira era opcional, quebrando
        // a conferência por bandeira no fechamento de caixa quando alguém
        // esquecia de escolher. Agora obrigatória pra cartão.
        if (isCard && !currentPaymentBrand) {
            toast.error('Escolha a bandeira do cartão antes de lançar o pagamento.');
            return;
        }
        setPaymentMethods(prev => [...prev, {
            method: currentPaymentMethod,
            amount,
            ...(isCard ? { brand: currentPaymentBrand } : {}),
        }]);
        setCurrentPaymentBrand('');

        // Calculate remaining
        const summary = selectedTable ? getTableSummary(selectedTable.id) : { total: 0 };
        const currentTotalPaid = paymentMethods.reduce((acc, p) => acc + p.amount, 0) + amount;
        const remaining = Math.max(0, summary.total - currentTotalPaid);
        
        setCurrentPaymentAmount(remaining.toFixed(2));
    };

    const handleRemovePayment = (index: number) => {
        setPaymentMethods(prev => prev.filter((_, i) => i !== index));
    };

    // Fase 2, Task 5 (plano "Fora do Cardápio"): `methodsOverride` existe só
    // pro atalho de 1 toque (handleOneClickFinish abaixo) — chamar
    // setPaymentMethods() e handleFinishPayment() em sequência no mesmo
    // clique leria o state ANTIGO (setState é assíncrono), por isso o
    // atalho nunca passa pela lista — monta o método/valor direto aqui.
    const handleFinishPayment = async (methodsOverride?: { method: string; amount: number; brand?: string }[]) => {
        if (!selectedTable) return;
        if (isFinishingRef.current) return;
        isFinishingRef.current = true;

        try {
            const summary = getTableSummary(selectedTable.id);
            const methods = methodsOverride ?? paymentMethods;

            // Task 2 (2026-08-22): este gate existe pra impedir fechar a
            // mesa com item ainda "em preparo" no KDS — status só avança
            // pending/accepted→preparing→ready→delivered através de um
            // clique no KdsView. Fluxo direct_print não tem KDS nenhum: o
            // item nasce 'pending' e é assim que fica pra sempre (sem RPC
            // nova pra "marcar entregue" — decisão do plano, ver
            // handleAddItem abaixo), porque a única confirmação de envio
            // que existe é o ticket já ter saído impresso no clique. Manter
            // este gate ligado aqui prenderia a mesa pra sempre, sem
            // nenhuma tela onde apertar o botão que ele está pedindo.
            if (orderFlow !== 'direct_print') {
                const pendingCount = summary.allItems.filter(
                    (item) => item.status !== OrderStatus.DELIVERED && item.status !== OrderStatus.CANCELED
                ).length;
                if (pendingCount > 0) {
                    toast.error(`Ainda tem ${pendingCount} item(ns) em preparo — marque como entregue ou cancele antes de fechar a mesa.`);
                    return;
                }
            }

            const totalPaid = methods.reduce((acc, p) => acc + p.amount, 0);

            if (totalPaid < summary.total - 0.01) { // Tolerance for float
                toast.error('O valor pago é menor que o total da conta.');
                return;
            }

            // Task 2 (2026-08-23, plano frente-de-caixa) — "sem caixa
            // aberto, não recebe pagamento": só entra em jogo quando a loja
            // tem o módulo caixa ligado (o `if` inteiro nunca executa pras
            // 7 lojas reais de hoje, que resolvem `caixa: false`). Desde a
            // migration 062 ("caixa por operador"), o turno é sempre O DE
            // QUEM ESTÁ FINALIZANDO ESTE PAGAMENTO agora (`loggedUser`) —
            // antes bastava existir QUALQUER turno aberto na loja, o que
            // atribuía a venda ao operador errado quando dois caixas
            // estavam abertos ao mesmo tempo.
            let cashShiftId: string | undefined;
            if (resolveStoreModules(store).caixa) {
                const openShift = await fetchOpenCashShift(store.id, loggedUser.role === 'universal' ? null : loggedUser.id);
                if (!openShift) {
                    toast.error('Você não tem um turno de caixa aberto. Abra o seu caixa antes de receber pagamentos.');
                    return;
                }
                cashShiftId = openShift.id;
            }

            // Task 4: `emitir_nota` só entra no payload quando a loja tem
            // emissão automática configurada — pra loja sem isso, o objeto
            // fica idêntico ao de sempre (sem a chave), então
            // payment_details.emitir_nota nunca existe pras 7 lojas reais
            // de hoje. Ver early-exit em app/api/fiscal/emitir/route.ts.
            // Task 2: `cash_shift_id` idem — só presente quando o módulo
            // caixa está ligado (ver bloco acima).
            // Achado real (reunião com o Ramon, 2026-08-25): `paymentMethods`
            // guarda o dinheiro BRUTO entregue pelo cliente (pode ter troco
            // embutido) — persistir isso sem ajuste inflava a nota fiscal
            // pelo valor do troco, divergindo do histórico de vendas. Ver
            // lib/calc.ts (getPaymentMethodsForRecord) pro porquê completo.
            // `paymentMethods` cru continua indo pro recibo impresso abaixo
            // (payment.methods), que precisa mostrar o valor bruto + troco.
            // Painel de recebimento por garçom (pedido real da reunião com o
            // Ramon, 2026-08-25): "quero ver quantas vezes o Ramon recebeu,
            // quantas vezes foi o giro... visão gerencial do recebimento
            // dessas mesas" — nada registrava QUEM de fato clicou em
            // finalizar/receber uma mesa (só `added_by_name` de item, não de
            // pagamento). Aditivo dentro de payment_details (jsonb, sem
            // migration), mesmo padrão de cash_shift_id acima.
            const paymentData = {
                total: summary.total,
                methods: getPaymentMethodsForRecord(methods, summary.total),
                operador_nome: loggedUser.name,
                operador_id: loggedUser.id,
                ...(emissaoFiscalConfigurada ? { emitir_nota: emitirNotaFiscal } : {}),
                ...(cashShiftId ? { cash_shift_id: cashShiftId } : {}),
            };

            // Destinatário (Task 17) — opcional mesmo em modelo NF-e; deixado
            // em branco, a rota de emissão grava a nota como 'pendente' (não
            // 'erro') com motivo claro, retomável depois via "Reemitir".
            const destinatario = buildDestinatario(paymentDestCpfCnpj, paymentDestNome);

            const result = await closeTableSession(selectedTable.id, paymentData, destinatario);

            if (result.success) {
                if (result.message && result.message.includes("Colunas ausentes")) {
                    setShowFixDbModal(true);
                } else if (result.message) {
                    toast.info(result.message);
                }

                // Módulo Caixa (Task 4, Passo 3 — "ao receber a conta,
                // imprime o comprovante"): só dispara quando quem finalizou
                // é de fato um CAIXA (permissão explícita, não dono/
                // universal usando o bypass de canFinalizeBill de sempre).
                // Sem esta distinção, as 6 lojas reais — onde o dono
                // finaliza mesa o dia inteiro exatamente como sempre fez —
                // passariam a imprimir um papel novo do nada em toda mesa
                // fechada, o que é mudar comportamento (a garantia central
                // deste plano). Imprime sempre no aparelho de quem finalizou
                // (redesign 2026-08-23: não existe mais um "alvo" separado —
                // o único equipamento fixo é o do próprio caixa, ver
                // lib/storeModules.ts).
                const isCaixaOperator = loggedUser.role !== 'owner' && loggedUser.role !== 'universal' && loggedUser.permissions?.caixa === true;
                if (isCaixaOperator) {
                    const receiptOpts = {
                        storeName: store.name,
                        cnpj: store.cnpj,
                        paperWidthMm: store.config?.printer_paper_width_mm,
                        label: `MESA ${selectedTable.number} - PAGO`,
                        items: summary.allItems.map(item => ({
                            quantity: item.quantity,
                            name: getOrderItemDisplayName(item),
                            client: parseItemNote(item.notes || '').client,
                            total: item.price_at_time * item.quantity,
                        })),
                        subtotal: summary.subtotal,
                        serviceFee: {
                            charged: summary.isServiceFeeEnabled,
                            rate: serviceFeeRate,
                            amount: summary.serviceFee,
                            removedForTable: summary.isServiceFeeRemovedForTable,
                        },
                        total: summary.total,
                        // Reaproveita `changeDue` já calculado acima (com a
                        // correção do achado real de troco em pagamento
                        // dividido) — nunca recalcular a fórmula de novo aqui.
                        // Exceção: atalho de 1 toque paga o valor exato, então
                        // troco é sempre 0 por construção (sem round-trip de
                        // state pra evitar ler `changeDue` desatualizado).
                        payment: { methods, changeDue: methodsOverride ? 0 : changeDue },
                    };
                    const printed = await printBillReceipt(receiptOpts);
                    if (!printed) {
                        toast.error('A conta foi fechada, mas o comprovante não imprimiu. Confira a impressora do caixa.');
                    }
                    // Aditivo (2026-08-28, achado ao vivo — loja com
                    // impressora de rede/USB dedicada ao caixa): nunca
                    // bloqueia nem afeta o resultado do fechamento.
                    enqueueReceiptPrintJobs(store.id, `Comprovante - ${receiptOpts.label}`, buildBillReceiptText(receiptOpts))
                        .catch((e) => console.error('enqueueReceiptPrintJobs falhou:', e));
                }

                setRemovedServiceFees(prev => {
                    const next = new Set(prev);
                    next.delete(selectedTable.id);
                    return next;
                });
                setSelectedTable(null);
                setShowFullBill(false);
                setShowPaymentModal(false);
                loadData();
            } else {
                toast.error('Não foi possível fechar a mesa: ' + (result.message || 'Erro desconhecido'));
            }
        } catch (e: any) {
            if (e.message === "schema cache updated_at") {
                toast.error("Para calcular o tempo médio, execute este script no SQL Editor do Supabase:\n\nALTER TABLE orders ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();\nNOTIFY pgrst, 'reload schema';", 10000);
            } else {
                toast.error("Erro ao fechar mesa: " + e.message);
            }
        } finally {
            isFinishingRef.current = false;
        }
    };

    // Fix round 2 (Group D2): `handleCloseTable` removido — fechava a mesa
    // SEM nenhuma forma de pagamento (`closeTableSession(selectedTable.id)`
    // sem `paymentData`) e não era gateado por `canFinalizeBill`, ao
    // contrário do fluxo real de pagamento (handleFinishPayment acima, que
    // sempre monta `paymentMethods`/`changeDue` e respeita a permissão de
    // Caixa quando o módulo está ligado). Comentário original já avisava
    // "legacy... kept just in case", e nenhum JSX chamava esta função —
    // uma linha de wiring futura a ligaria como um caminho de finalizar
    // mesa sem cobrar nada e sem checar quem tem permissão. Confirmado sem
    // call site algum antes de remover.

    const handleBlockToggle = async (e: React.MouseEvent, table: Table, inJurisdiction: boolean = true) => {
        e.stopPropagation();
        // Trava de jurisdicao (Task 3, mesma defesa em profundidade de
        // togglePin acima): sem isso, um garcom conseguia bloquear de
        // verdade uma mesa fora da sua area via teclado (Tab + Enter),
        // apesar do card estar visualmente inerte.
        if (!inJurisdiction) return;
        await toggleTableBlock(table.id, table.status);
    };

    // Módulo Caixa (Task 4): substitui o botão de finalizar pra quem não
    // pode finalizar (garçom sem permissão 'caixa'). Reaproveita
    // `requestTableBill`/`request_table_bill_secure`, o MESMO RPC que já
    // existe pra quando o CLIENTE pede a conta pelo cardápio (ClientModule)
    // — grava `tables.status = 'waiting_bill'`, o mesmo estado que a UI de
    // mesas já destaca ("PEDIU CONTA", card em amarelo). Não existe um
    // estado paralelo "garçom pediu conta": é literalmente a mesma coisa
    // que já acontecia quando o cliente pedia, por design (brief da Task
    // 4: "a mesa vai aparecer 'pediu conta' como se fosse o cliente
    // também").
    const handleRequestBill = async (tableId: string) => {
        try {
            await requestTableBill(tableId);
            setTables(prev => prev.map(t => t.id === tableId ? { ...t, status: TableStatus.WAITING_BILL } : t));
            if (selectedTable && selectedTable.id === tableId) {
                setSelectedTable(prev => prev ? { ...prev, status: TableStatus.WAITING_BILL } : null);
            }
            toast.success('Conta pedida — o caixa foi avisado.');
        } catch (e) {
            toast.error('Erro ao pedir a conta.');
        }
    };

    const handleDismissWaiter = async (tableId: string) => {
        try {
            await dismissWaiterRequest(tableId);
            // Optimistic Update
            setTables(prev => prev.map(t => t.id === tableId ? { ...t, waiter_requested: false } : t));
            
            // Also update selectedTable to clear the alert in modal immediately
            if(selectedTable && selectedTable.id === tableId) {
                setSelectedTable(prev => prev ? { ...prev, waiter_requested: false } : null);
            }
        } catch (e) {
            console.error("Erro ao atender garçom", e);
        }
    };
    
    const handleAddItem = async (product: Product, qty: number, notes: string, selectedOptions: SelectedOption[]) => {
        if (!selectedTable) return;
        // Fix round 1 (Task 2 review, Minor #3): mesmo padrão de guarda
        // síncrona que handleFinishPayment já usa (isFinishingRef) — sem
        // isso, um duplo toque rápido em "Lançar Pedido" (antes do primeiro
        // clique re-renderizar/desabilitar o botão) dispara duas
        // createOrder, e em direct_print cada uma imprime seu próprio
        // ticket físico.
        if (isAddingItemRef.current) return;
        isAddingItemRef.current = true;

        const finalNotes = notes ? `[${loggedUser.name}] ${notes}` : `[${loggedUser.name}]`;

        try {
            // Reuses createOrder logic which handles adding to existing orders.
            // `orderId` do retorno não é mais usado aqui (era só pro print
            // imediato removido abaixo) — a reconciliação do Caixa resolve o
            // pedido/item sozinha via fetch_kitchen_orders_secure.
            await createOrder(selectedTable.id, storeId, [{
                product, quantity: qty, notes: finalNotes, selectedOptions
            }], loggedUser.name, 'garcom', loggedUser.name);

            toast.success(`${getOrderItemDisplayName({ product, selected_options: selectedOptions })} adicionado com sucesso!`);

            // Redesign 2026-08-23 (review crítico "waiter-launched orders
            // print nowhere real, silently"): este componente já NÃO imprime
            // mais no próprio aparelho de quem lançou o item. Confirmado
            // direto com o dono: o celular do garçom não tem acesso à
            // impressora de rede da cozinha — só o aparelho do Caixa tem.
            // Antes deste fix, `window.print()` aqui "tinha sucesso" sempre
            // que a chamada não lançava, mesmo sem NENHUMA impressora
            // configurada no aparelho do garçom — o pedido nunca chegava na
            // cozinha e nada avisava ninguém.
            //
            // O pedido continua sendo criado exatamente como antes
            // (`createOrder(..., 'garcom')`, acima) — só o print imediato
            // saiu daqui. Quem imprime agora é a reconciliação em segundo
            // plano do Caixa (`useCaixaPrintStation`, CaixaPrintStation.tsx),
            // rodando no ÚNICO aparelho que de fato tem a impressora — o
            // mesmo mecanismo que já cobria autoatendimento (QR) e Balcão.
            // Esse item continua marcado `added_by_role: 'garcom'`
            // (migration 046), mas a reconciliação não filtra mais por esse
            // valor (ver CaixaPrintStation.tsx) — ela agora trata QR, Balcão
            // e garçom exatamente igual, todos sem impressora própria no
            // momento da criação.
            // setShowMenuMode(false);
        } catch (e) {
            toast.error("Erro ao adicionar item.");
            console.error(e);
        } finally {
            isAddingItemRef.current = false;
        }
    };

    const handleDeleteItem = async (itemId: string) => {
        if(await confirm("Deseja cancelar este item da comanda?")) {
            try {
                await cancelSpecificOrderItem(itemId);
                // Realtime will update the list
            } catch(e) {
                toast.error("Erro ao cancelar item.");
            }
        }
    };

    return (
        <>
            {/* Task 21 (plano "Fora do Cardápio"): reservas de hoje em diante —
                sem escolha de mesa específica (decisão do lojista no dia), só
                confirma/cancela. Some sozinha quando não há nenhuma reserva
                pendente/confirmada, pra não ocupar espaço em dia sem reserva. */}
            {reservations.filter(r => r.status !== 'canceled').length > 0 && (
                <div className="mb-4 bg-[var(--surface)] rounded-xl border border-[var(--border)] overflow-hidden">
                    <div className="p-3 border-b border-[var(--border)] flex items-center justify-between">
                        <h3 className="text-sm font-bold text-[var(--text)]">
                            Reservas de hoje ({reservations.filter(r => r.status !== 'canceled').length})
                        </h3>
                        <button type="button" onClick={loadReservations} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] u-motion" disabled={isLoadingReservations}>
                            <RefreshCw size={14} className={isLoadingReservations ? 'animate-spin' : ''} />
                        </button>
                    </div>
                    <div className="divide-y divide-[var(--border)]">
                        {reservations.filter(r => r.status !== 'canceled').map(r => (
                            <div key={r.id} className="p-3 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-[var(--text)] truncate">
                                        {r.customer_name} · {r.party_size} pessoa{r.party_size === 1 ? '' : 's'}
                                    </p>
                                    <p className="text-xs text-[var(--text-muted)]">
                                        {new Date(r.reserved_for).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {r.customer_phone}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {r.status === 'pending' ? (
                                        <span className="text-[10px] font-bold uppercase px-2 py-1 rounded-full bg-[var(--warn)]/10 text-[var(--warn)]">Pendente</span>
                                    ) : (
                                        <span className="text-[10px] font-bold uppercase px-2 py-1 rounded-full bg-[var(--ok)]/10 text-[var(--ok)]">Confirmada</span>
                                    )}
                                    {r.status === 'pending' && (
                                        <Button size="sm" disabled={savingReservationIds.has(r.id)} onClick={() => handleUpdateReservation(r.id, 'confirmed')}>Confirmar</Button>
                                    )}
                                    <Button size="sm" variant="outline" disabled={savingReservationIds.has(r.id)} onClick={() => handleUpdateReservation(r.id, 'canceled')}>Cancelar</Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex justify-end mb-4 gap-2">
                {canManagePin && (
                    <Button
                        variant={pinBlockEnabled ? "primary" : "secondary"}
                        onClick={handlePinBlockToggle}
                        className={`flex items-center gap-2 text-sm ${pinBlockEnabled ? 'bg-[var(--err)] hover:bg-[var(--err)]/90 text-white border-[var(--err)]' : 'text-[var(--text-muted)]'}`}
                        title="Se ativado, novos clientes precisarão do PIN para abrir a mesa"
                    >
                        {pinBlockEnabled ? <Lock size={18} /> : <Unlock size={18} />}
                        {pinBlockEnabled ? "Bloqueio PIN Ativo" : "Bloqueio PIN Inativo"}
                    </Button>
                )}

                <Button 
                    variant="secondary" 
                    onClick={() => setAreCardsCollapsed(!areCardsCollapsed)}
                    className="flex items-center gap-2 text-sm"
                >
                    {areCardsCollapsed ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                    {areCardsCollapsed ? "Expandir Cards" : "Colapsar Cards"}
                </Button>

                {/* Task 2 (2026-08-22) — só aparece em direct_print: é o
                    substituto do KDS pra esta loja, "acessível para garçom
                    e caixa" (o brief pede os dois; hoje só quem acessa
                    TablesView tem permissão 'tables' — caixa ganha a mesma
                    tela na Task 4). Nas 6 lojas com KDS, orderFlow é
                    sempre 'kds' e este botão nunca renderiza. */}
                {orderFlow === 'direct_print' && (
                    <Button
                        variant="secondary"
                        onClick={() => setShowSentHistory(true)}
                        className="flex items-center gap-2 text-sm"
                    >
                        <FileText size={18} />
                        Pedidos do Dia
                    </Button>
                )}
            </div>

            {/* items-start (pedido do dono, 2026-08-29 — "caber o máximo de coisa
                na tela"): sem isso, o grid estica TODO card da linha pra igualar
                o mais alto (comportamento padrão de CSS grid), reintroduzindo
                espaço vazio numa mesa com poucos itens só porque a vizinha tem
                muitos. Cada card agora só ocupa a altura que o próprio conteúdo
                precisa. */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 items-start">
                <AnimatePresence>
                {tables.map((table, tableIdx) => {
                    const summary = getTableSummary(table.id);
                    const isBlocked = table.status === 'blocked';
                    const isOccupied = table.status === 'occupied' || table.status === 'waiting_bill';
                    const isWaiterRequested = table.waiter_requested;
                    const hasOrders = summary.count > 0;
                    // Jurisdicao de mesas por garcom (Task 3, migration 049).
                    // Mesa fora da jurisdicao continua renderizada normalmente
                    // (numero/status/PIN) mas inteiramente nao-interativa —
                    // `pointer-events-none` bloqueia tanto abrir o card quanto
                    // os botoes internos (bloquear, ver PIN, atender garcom)
                    // numa unica trava, sem precisar desabilitar cada acao
                    // isoladamente. owner/universal nunca sao restringidos
                    // (ver isTableInJurisdiction).
                    const inJurisdiction = isTableInJurisdiction(loggedUser, table.id);

                    // allItems vem ordenado do mais novo pro mais antigo
                    // (getTableSummary acima) — [0] é o último pedido, o
                    // último elemento é o mais antigo (aproximação de
                    // "ocupada desde", ver comentário da declaração de
                    // tableAlertOccupiedMin).
                    const minutesSinceLastOrder = isOccupied && summary.allItems.length > 0
                        ? Math.floor((nowTick - new Date(summary.allItems[0].created_at).getTime()) / 60000) : null;
                    const minutesOccupied = isOccupied && summary.allItems.length > 0
                        ? Math.floor((nowTick - new Date(summary.allItems[summary.allItems.length - 1].created_at).getTime()) / 60000) : null;
                    const isOccupiedTooLong = tableAlertOccupiedMin > 0 && minutesOccupied !== null && minutesOccupied >= tableAlertOccupiedMin;
                    const isNoOrderTooLong = tableAlertNoOrderMin > 0 && minutesSinceLastOrder !== null && minutesSinceLastOrder >= tableAlertNoOrderMin;
                    const hasTimeAlert = isOccupiedTooLong || isNoOrderTooLong;

                    return (
                        <motion.div
                            key={table.id}
                            layout
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={SPRING_TAP}
                        >
                        <Card
                            hoverable={inJurisdiction}
                            onClick={() => { if(!isBlocked && inJurisdiction) { setSelectedTable(table); setShowFullBill(false); setShowMenuMode(false); } }}
                            className={`relative flex flex-col p-3 transition-[background-color,border-color,box-shadow] duration-300 border-2 group ${
                                isBlocked ? 'bg-[var(--surface-2)] border-[var(--border)] grayscale opacity-80' :
                                isWaiterRequested ? 'border-[var(--err)]/50 bg-[var(--err)]/5 shadow-xl animate-pulse' :
                                table.status === 'waiting_bill' ? 'bg-[var(--warn)]/5 border-[var(--warn)]/30 shadow-lg' :
                                hasTimeAlert ? 'bg-[var(--warn)]/10 border-[var(--warn)]/60 shadow-lg' :
                                isOccupied ? 'bg-[var(--info)]/5 border-[var(--info)]/25 shadow-lg' :
                                'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--brand)]/30 hover:shadow-lg'
                            } ${!inJurisdiction ? 'opacity-50 pointer-events-none grayscale' : ''}`}
                            style={stagger(Math.min(tableIdx, 10) * 30)}
                        >
                            {/* Jurisdicao: mesa fora da area do usuario logado */}
                            {!inJurisdiction && (
                                <div className="absolute top-2 left-2 z-20">
                                    <span className="px-1.5 py-0.5 bg-[var(--surface-2)] text-[var(--text-muted)] text-[10px] font-bold rounded border border-[var(--border)] uppercase tracking-wider">
                                        {TABLE_OUT_OF_JURISDICTION_LABEL}
                                    </span>
                                </div>
                            )}

                            {/* Waiter Alert Overlay */}
                            {isWaiterRequested && (
                                <div className="absolute -top-3 -right-3 z-20">
                                    <span className="relative flex h-8 w-8">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--err)] opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-8 w-8 bg-[var(--err)] items-center justify-center text-white border-2 border-white">
                                        <BellRing size={16} />
                                      </span>
                                    </span>
                                </div>
                            )}

                            {/* Header numa linha só — número, PIN, status, cliente — nos DOIS
                                modos (recolhido e expandido, pedido do dono 2026-08-29: "quero
                                que fique assim mesmo quando não colapsado"). Só a área de
                                itens do pedido abaixo continua ligada/desligada pelo toggle. */}
                            {(
                                <div className="flex items-center gap-2 min-w-0 mb-2">
                                    <div className="flex items-baseline gap-1 shrink-0">
                                        <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Mesa</span>
                                        <span className="text-xl font-black text-[var(--text)]">{table.number}</span>
                                    </div>
                                    <div className="flex items-center gap-1 bg-[var(--surface-2)] px-1.5 py-0.5 rounded-md shrink-0">
                                        <span className="font-mono font-bold text-xs text-[var(--text)]">
                                            {visiblePins.has(table.id) ? table.pin : '••••'}
                                        </span>
                                        <button
                                            onClick={(e) => togglePin(e, table.id, inJurisdiction)}
                                            disabled={!inJurisdiction}
                                            className="text-[var(--text-muted)] hover:text-[var(--brand)] u-motion u-press disabled:pointer-events-none"
                                            title={visiblePins.has(table.id) ? "Ocultar PIN" : "Ver PIN"}
                                        >
                                            {visiblePins.has(table.id) ? <EyeOff size={11} /> : <Eye size={11} />}
                                        </button>
                                    </div>
                                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                        isBlocked ? 'bg-[var(--surface-2)] text-[var(--text-muted)]' :
                                        isOccupied ? (table.status === 'waiting_bill' ? 'bg-[var(--warn)] text-white' : 'bg-[var(--info)] text-white') :
                                        'bg-[var(--ok)]/10 text-[var(--ok)]'
                                    }`}>
                                        {getTableStatusLabel(isBlocked ? 'blocked' : isOccupied ? table.status : 'available')}
                                    </span>
                                    {canManagePin && (
                                        <button
                                            onClick={(e) => {
                                                if(!isBlocked && hasOrders) return;
                                                handleBlockToggle(e, table, inJurisdiction);
                                            }}
                                            disabled={(!isBlocked && hasOrders) || !inJurisdiction}
                                            className={`ml-auto p-1.5 rounded-lg u-motion u-press z-10 shrink-0 ${
                                                isBlocked ? 'text-[var(--err)] bg-[var(--err)]/10 hover:bg-[var(--err)]/15' :
                                                (!isBlocked && hasOrders) ? 'text-[var(--border)] cursor-not-allowed opacity-50' :
                                                'text-[var(--text-muted)]/50 hover:text-[var(--text-muted)] hover:bg-[var(--surface-2)]'
                                            }`}
                                            title={isBlocked ? "Desbloquear" : hasOrders ? "Mesa com pedidos não pode ser bloqueada" : "Bloquear Mesa"}
                                        >
                                            {isBlocked ? <Lock size={14} /> : <Unlock size={14} />}
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Nome do cliente, linha própria embaixo do header (pedido do
                                dono, 2026-08-29: "seria interessante o nome aparecer embaixo
                                disso tudo" — junto na mesma linha ficava truncado demais). */}
                            {isOccupied && (
                                <div className="flex items-center gap-1 text-xs text-[var(--text-muted)] mb-1 min-w-0">
                                    <User size={11} className="shrink-0" />
                                    <span className="font-bold truncate">{table.current_host_name || 'Lojista'}</span>
                                    {watchedTables.has(table.id) && (
                                        <span title="Cliente acompanhando o pedido agora" className="shrink-0 text-[var(--info)] flex items-center">
                                            <Eye size={11} />
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Avisos de tempo (pedido do dono, 2026-08-29) — aparece nos dois
                                modos (recolhido e expandido), já que é informação operacional,
                                não estética. */}
                            {hasTimeAlert && (
                                <div className="flex items-center gap-1 text-[10px] font-bold text-[var(--warn)] mt-1">
                                    <Clock size={11} />
                                    {[
                                        isOccupiedTooLong ? `Ocupada há ${minutesOccupied}min` : null,
                                        isNoOrderTooLong ? `Sem pedido há ${minutesSinceLastOrder}min` : null,
                                    ].filter(Boolean).join(' · ')}
                                </div>
                            )}

                            {/* Content Area: Items or Empty State */}
                            {!areCardsCollapsed && (
                                isOccupied ? (
                                    <div className="flex-1 flex flex-col min-h-0 bg-[var(--surface)]/60 rounded-lg p-2 border border-[var(--border)]">
                                        <div className="flex justify-between items-end border-b border-[var(--border)] pb-1 mb-1">
                                            <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Últimos Pedidos</span>
                                            <div className="text-right leading-none">
                                                <span className="block text-[10px] text-[var(--text-muted)]">Total</span>
                                                <span className="font-bold text-[var(--brand)] num">R$ {formatBRL(summary.total)}</span>
                                            </div>
                                        </div>

                                        <div className="flex-1 overflow-hidden flex flex-col gap-1.5">
                                            {summary.items.length > 0 ? (
                                                summary.items.map((item, idx) => (
                                                    <div key={idx} className="flex justify-between items-center gap-1.5 text-xs text-[var(--text)]">
                                                        <span className="truncate min-w-0 flex-1 font-medium">{item.quantity}x {getOrderItemDisplayName(item)}</span>
                                                        {orderFlow !== 'direct_print' && item.status === 'delivered' && <CheckCircle size={12} className="text-[var(--ok)] flex-shrink-0" />}
                                                        {orderFlow !== 'direct_print' && item.status === 'preparing' && <ChefHat size={12} className="text-[var(--info)] flex-shrink-0" />}
                                                        {orderFlow !== 'direct_print' && (item.status === 'pending' || item.status === 'accepted') && <Clock size={12} className="text-[var(--warn)] flex-shrink-0" />}
                                                    </div>
                                                ))
                                            ) : (
                                                <p className="text-xs text-[var(--text-muted)] text-center italic mt-2">Sem pedidos</p>
                                            )}
                                            {summary.count > 3 && (
                                                <p className="text-[10px] text-center text-[var(--text-muted)] mt-auto">+ {summary.count - 3} {summary.count - 3 === 1 ? 'item' : 'itens'}...</p>
                                            )}
                                        </div>
                                        <div className="mt-1 pt-1 border-t border-[var(--border)] text-[10px] text-center text-[var(--text-muted)]">
                                            {summary.count} {summary.count === 1 ? 'item' : 'itens'} no total
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center opacity-30 py-3">
                                        <UtensilsCrossed size={24} />
                                        <p className="text-xs font-bold mt-1">Disponível</p>
                                    </div>
                                )
                            )}

                            {/* Footer: Waiter Action Only */}
                            {isWaiterRequested && (
                                <div className="mt-3 pt-2 border-t border-[var(--border)] flex flex-col items-center">
                                    <Button
                                        onClick={(e) => { e.stopPropagation(); if (!inJurisdiction) return; handleDismissWaiter(table.id); }}
                                        disabled={!inJurisdiction}
                                        className="w-full h-8 text-xs bg-[var(--err)] hover:bg-[var(--err)]/90 shadow-[var(--err)]/20 shadow-sm animate-bounce"
                                    >
                                        <BellRing size={14} className="mr-1"/> ATENDER GARÇOM
                                    </Button>
                                </div>
                            )}
                        </Card>
                        </motion.div>
                    );
                })}
                </AnimatePresence>
            </div>

            {/* MODAL DA MESA */}
            <Modal isOpen={!!selectedTable} onClose={() => setSelectedTable(null)} title={`Mesa ${selectedTable?.number} - ${selectedTable?.current_host_name || 'Lojista'}`} size="lg">
                <div className="space-y-4">
                    <div className="flex justify-between p-3 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] items-center">
                        <span className="text-[var(--text-muted)] font-medium text-sm">Status Atual</span>
                        <div className="flex items-center gap-2">
                             {selectedTable?.waiter_requested && (
                                <Badge color="bg-[var(--err)]/10 text-[var(--err)] flex items-center gap-1">
                                    <BellRing size={12}/> CHAMANDO
                                </Badge>
                             )}
                             <span className={`font-bold uppercase px-3 py-1 rounded-full text-xs ${
                                selectedTable?.status === 'available' ? 'bg-[var(--ok)]/10 text-[var(--ok)]' : 'bg-[var(--info)]/10 text-[var(--info)]'
                            }`}>
                                {getTableStatusLabel(selectedTable?.status || 'occupied')}
                            </span>
                        </div>
                    </div>

                    {!showFullBill && !showMenuMode ? (
                        <>
                             {/* VIEW 1: AÇÕES RÁPIDAS */}
                             {selectedTable?.waiter_requested && (
                                 <Button
                                    onClick={() => selectedTable && handleDismissWaiter(selectedTable.id)}
                                    className="w-full bg-[var(--err)] hover:bg-[var(--err)]/90 text-white animate-pulse mb-2 shadow-[var(--err)]/20 shadow-lg"
                                 >
                                     <BellRing size={20} className="mr-2"/> CONFIRMAR ATENDIMENTO
                                 </Button>
                             )}
                             
                             {selectedTable?.status !== 'available' && (
                                 <div className="space-y-3 animate-fade-in">
                                     <div className="grid grid-cols-2 gap-3">
                                         <Button
                                            className="h-24 flex flex-col items-center justify-center gap-2 bg-[var(--info)] hover:bg-[var(--info)]/90 text-white shadow-lg shadow-[var(--info)]/20"
                                            onClick={() => setShowMenuMode(true)}
                                         >
                                             <Plus size={28} />
                                             <span className="font-bold text-sm">Adicionar Pedido</span>
                                         </Button>
                                         <Button
                                            className="h-24 flex flex-col items-center justify-center gap-2 bg-[var(--brand)] hover:bg-[var(--brand-strong)] text-white shadow-lg shadow-[var(--brand)]/20 transition-colors"
                                            onClick={() => setShowFullBill(true)}
                                         >
                                             <Receipt size={28} />
                                             <div className="text-center leading-tight">
                                                 <span className="block font-bold text-sm">Ver Comanda</span>
                                                 <span className="text-xs font-normal">
                                                     R$ {selectedTable ? formatBRL(getTableSummary(selectedTable.id).total) : '0,00'}
                                                 </span>
                                             </div>
                                         </Button>
                                     </div>

                                     <div className="border-t border-[var(--border)] pt-4 mt-2">
                                         <p className="mb-3 font-bold text-xs text-[var(--text-muted)] uppercase tracking-wider text-center">Gestão</p>
                                         {/* Módulo Caixa (Task 4): quem pode finalizar (dono, universal, ou
                                             usuário com a permissão 'caixa') continua vendo exatamente o
                                             botão de sempre. Quem não pode vê "Pedir Conta" — a mesma ação
                                             que o cliente já tem no cardápio (requestTableBill), só que
                                             disparada pelo garçom. */}
                                         {canFinalize ? (
                                             <Button onClick={() => handleOpenPayment()} variant="danger" className="w-full text-sm shadow-[var(--ok)]/20 shadow-lg bg-[var(--ok)] hover:bg-[var(--ok)]/90 border-none">
                                                <Wallet size={18} className="mr-2"/> RECEBER & FINALIZAR
                                             </Button>
                                         ) : selectedTable?.status === 'waiting_bill' ? (
                                             <div className="w-full text-center text-sm font-bold text-[var(--warn)] bg-[var(--warn)]/10 border border-[var(--warn)]/30 rounded-[var(--r-md)] py-3">
                                                 Conta pedida — aguardando o caixa
                                             </div>
                                         ) : (
                                             <Button onClick={() => selectedTable && handleRequestBill(selectedTable.id)} className="w-full text-sm shadow-[var(--warn)]/20 shadow-lg bg-[var(--warn)] hover:bg-[var(--warn)]/90 text-white border-none">
                                                <Receipt size={18} className="mr-2"/> PEDIR CONTA
                                             </Button>
                                         )}
                                         {canReassignJurisdiction && (
                                             <Button onClick={handleOpenReassign} variant="outline" className="w-full text-sm mt-2">
                                                <Users size={16} className="mr-2"/> Trocar Responsável
                                             </Button>
                                         )}
                                     </div>
                                 </div>
                             )}
                             {selectedTable?.status === 'available' && (
                                <Button className="w-full text-lg h-14" onClick={async () => {
                                    if(selectedTable) {
                                        const previousTable = selectedTable;

                                        // 1. UPDATE LOCAL STATE IMMEDIATELY (Visual Feedback)
                                        setSelectedTable({ ...selectedTable, status: TableStatus.OCCUPIED, current_host_name: loggedUser.name });

                                        try {
                                            // 2. CALL API (grava a sessão de ocupação também, senão mesas abertas
                                            // pelo lojista nunca entram na métrica de tempo médio)
                                            await openTableManually(selectedTable.id, store.id, loggedUser.name);

                                            // 3. REFRESH DATA (Optional, but good practice)
                                            loadData();
                                        } catch (e) {
                                            // Reverte o update otimista em caso de falha
                                            setSelectedTable(previousTable);
                                            toast.error("Erro ao abrir mesa. Tente novamente.");
                                        }
                                    }
                                }}>
                                    Abrir Mesa Manualmente
                                </Button>
                            )}
                        </>
                    ) : showMenuMode ? (
                        <div className="animate-slide-up h-full">
                            {/* VIEW 3: ADICIONAR ITENS (MENU) */}
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-bold text-[var(--text)] flex items-center gap-2"><UtensilsCrossed size={18}/> Cardápio</h3>
                                <Button variant="ghost" size="sm" onClick={() => setShowMenuMode(false)} className="underline">Voltar</Button>
                            </div>
                            {/* Task 8 (2026-08-30): max-h sozinho não dá altura definida pro
                                filho (StoreTableMenu usa h-full na raiz) sem flex — sem
                                flex flex-col aqui, o scroll interno nunca ativa e um cardápio
                                grande (ex.: Sertão, ~110 produtos) vazaria pra fora da caixa em
                                vez de respeitar o teto de 70vh. overflow-hidden garante que,
                                se algo escapar mesmo assim, fica contido, não vaza visualmente. */}
                            <div className="border border-[var(--border)] rounded-xl p-2 bg-[var(--surface-2)] max-h-[70vh] flex flex-col overflow-hidden">
                                <StoreTableMenu storeId={storeId} onAddItem={handleAddItem} />
                            </div>
                        </div>
                    ) : (
                        <div className="animate-slide-up">
                            {/* VIEW 2: COMANDA COMPLETA */}
                            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg overflow-hidden mb-4 shadow-sm">
                                <div className="bg-[var(--surface-2)] p-3 text-xs font-bold text-[var(--text-muted)] uppercase flex justify-between">
                                    <span>Item</span>
                                    <span>Subtotal</span>
                                </div>
                                <div className="max-h-[300px] overflow-y-auto">
                                    {(() => {
                                        // Busca o resumo atualizado na hora
                                        const summary = selectedTable ? getTableSummary(selectedTable.id) : null;
                                        const items = summary?.allItems || [];

                                        if(items.length === 0) {
                                            return (
                                                <div className="p-8 text-center flex flex-col items-center text-[var(--text-muted)]">
                                                    <Coffee size={32} className="mb-2 opacity-20"/>
                                                    <p>Nenhum pedido lançado nesta mesa.</p>
                                                </div>
                                            );
                                        }

                                        return (
                                            <>
                                                {items.map(item => {
                                                    // Achado real (reunião com o Ramon, 2026-08-25): nome do
                                                    // cliente nunca aparecia na comanda em mesa com pedidos de
                                                    // pessoas diferentes — só o item lançado pelo GARÇOM tinha
                                                    // badge de atribuição. O nome do cliente vem embutido em
                                                    // `notes` (createOrder, lib/api.ts), nunca extraído aqui.
                                                    const clientNote = item.added_by_role !== 'garcom' ? parseItemNote(item.notes || '') : null;
                                                    return (
                                                    <div key={item.id} className="flex justify-between p-3 border-b border-[var(--border)] text-sm hover:bg-[var(--surface-2)] transition-colors group">
                                                        <div className="flex-1">
                                                            <span className="font-bold text-[var(--text)] flex items-center gap-2">
                                                                <span className="bg-[var(--surface-2)] px-1.5 rounded text-xs text-[var(--text-muted)]">x{item.quantity}</span>
                                                                {getOrderItemDisplayName(item)}
                                                                {item.added_by_role === 'garcom' ? (
                                                                    <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-[var(--info)]/15 text-[var(--info)]">
                                                                        {item.added_by_name || 'Garçom'}
                                                                    </span>
                                                                ) : clientNote?.client ? (
                                                                    <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-[var(--brand)]/15 text-[var(--brand)]">
                                                                        {clientNote.client}
                                                                    </span>
                                                                ) : null}
                                                            </span>
                                                            <div className="text-xs text-[var(--text-muted)] flex items-center gap-2 mt-1 ml-7">
                                                                {orderFlow !== 'direct_print' && (
                                                                    item.status === 'delivered' ? <span className="text-[var(--ok)] flex items-center gap-1"><CheckCircle size={10}/> Entregue</span> :
                                                                    item.status === 'preparing' ? <span className="text-[var(--info)] flex items-center gap-1"><ChefHat size={10}/> Preparando</span> :
                                                                    <span className="text-[var(--warn)] flex items-center gap-1"><Clock size={10}/> Aguardando</span>
                                                                )}
                                                                <span>{orderFlow !== 'direct_print' && '• '}R$ {formatBRL(item.price_at_time)} un.</span>
                                                                {clientNote?.observation && <span>• {clientNote.observation}</span>}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <span className="font-medium text-[var(--text)]">R$ {formatBRL(item.price_at_time * item.quantity)}</span>
                                                            <button
                                                                onClick={() => handleDeleteItem(item.id)}
                                                                className="text-[var(--text-muted)]/50 hover:text-[var(--err)] p-1 u-motion u-press"
                                                                title="Cancelar Item"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    );
                                                })}
                                                {/* Task 3: linha da taxa de serviço agora SEMPRE aparece na
                                                    comanda, nos 3 estados possíveis — antes só existia
                                                    quando cobrando, e desligada (loja sem taxa OU taxa
                                                    removida desta mesa) a linha simplesmente sumia, o que
                                                    o dono do projeto apontou como ambíguo pro garçom
                                                    também, não só pro cliente. */}
                                                {summary?.isServiceFeeEnabled ? (
                                                    <div className="flex justify-between p-3 border-b border-[var(--border)] text-sm bg-[var(--info)]/5">
                                                        <div className="flex-1">
                                                            <span className="font-bold text-[var(--text)]">Taxa de Serviço ({formatServiceFeeRate(serviceFeeRate)})</span>
                                                            <div className="text-xs text-[var(--text-muted)] mt-1">Opcional</div>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <span className="font-medium text-[var(--text)]">R$ {formatBRL(summary.serviceFee)}</span>
                                                            <button
                                                                onClick={() => {
                                                                    setRemovedServiceFees(prev => {
                                                                        const next = new Set(prev);
                                                                        next.add(selectedTable!.id);
                                                                        return next;
                                                                    });
                                                                }}
                                                                className="text-[var(--text-muted)]/50 hover:text-[var(--err)] p-1 u-motion u-press"
                                                                title="Remover Taxa"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="flex justify-between items-center p-3 border-b border-[var(--border)] text-sm text-[var(--text-muted)]">
                                                        <span className="italic">
                                                            {summary?.isServiceFeeRemovedForTable
                                                                ? 'Taxa de serviço opcional removida nesta mesa'
                                                                : 'Esta loja não cobra taxa de serviço'}
                                                        </span>
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>

                                <div className="bg-[var(--surface-2)] p-4 border-t border-[var(--border)] flex justify-between items-center">
                                    <span className="font-bold text-lg text-[var(--text)]">Total Final</span>
                                    <span className="font-black text-2xl text-[var(--brand)]">
                                        R$ {selectedTable ? formatBRL(getTableSummary(selectedTable.id).total) : '0,00'}
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2 mb-3">
                                <Button variant="secondary" className="text-sm" onClick={() => setShowFullBill(false)}>Voltar</Button>
                                <Button onClick={() => setShowMoveTableModal(true)} className="text-sm font-bold bg-[var(--info)] hover:bg-[var(--info)]/90 text-white">
                                    <ArrowRightLeft size={18} className="mr-2"/> TROCAR
                                </Button>
                                <Button onClick={() => selectedTable && printTableBill(selectedTable.id)} className="text-sm font-bold bg-[var(--ink)] hover:bg-[var(--ink)]/90 text-white">
                                    <Printer size={18} className="mr-2"/> IMPRIMIR
                                </Button>
                            </div>
                            {canFinalize ? (
                                <Button onClick={() => handleOpenPayment()} className="w-full text-sm font-bold bg-[var(--ok)] hover:bg-[var(--ok)]/90 text-white shadow-lg shadow-[var(--ok)]/20 h-12">
                                    <Wallet size={18} className="mr-2"/> RECEBER PAGAMENTO
                                </Button>
                            ) : selectedTable?.status === 'waiting_bill' ? (
                                <div className="w-full text-center text-sm font-bold text-[var(--warn)] bg-[var(--warn)]/10 border border-[var(--warn)]/30 rounded-[var(--r-md)] py-3">
                                    Conta pedida — aguardando o caixa
                                </div>
                            ) : (
                                <Button onClick={() => selectedTable && handleRequestBill(selectedTable.id)} className="w-full text-sm font-bold bg-[var(--warn)] hover:bg-[var(--warn)]/90 text-white shadow-lg shadow-[var(--warn)]/20 h-12">
                                    <Receipt size={18} className="mr-2"/> PEDIR CONTA
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </Modal>

            {/* MOVE TABLE MODAL */}
            <Modal isOpen={showMoveTableModal} onClose={() => setShowMoveTableModal(false)} title="Trocar de Mesa">
                <div className="space-y-4">
                    <p className="text-sm text-[var(--text-muted)]">
                        Selecione a mesa de destino para transferir todos os pedidos da <strong>Mesa {selectedTable?.number}</strong>.
                    </p>

                    <div className="grid grid-cols-3 gap-3 max-h-[300px] overflow-y-auto p-1">
                        {tables.filter(t => t.status === 'available' && t.id !== selectedTable?.id).map(table => (
                            <button
                                key={table.id}
                                onClick={() => setTargetTableId(table.id)}
                                className={`p-3 rounded-lg border-2 flex flex-col items-center justify-center u-motion u-press-sm ${
                                    targetTableId === table.id
                                    ? 'border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)] font-bold'
                                    : 'border-[var(--border)] hover:border-[var(--brand)]/50 text-[var(--text-muted)]'
                                }`}
                            >
                                <span className="text-lg">Mesa {table.number}</span>
                                <span className="text-xs font-normal opacity-70">{getTableStatusLabel('available')}</span>
                            </button>
                        ))}
                        {tables.filter(t => t.status === 'available' && t.id !== selectedTable?.id).length === 0 && (
                            <div className="col-span-3 text-center py-8 text-[var(--text-muted)] italic">
                                Nenhuma mesa disponível no momento.
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end gap-2 pt-4 border-t border-[var(--border)]">
                        <Button variant="secondary" onClick={() => setShowMoveTableModal(false)}>Cancelar</Button>
                        <Button
                            onClick={handleMoveTable}
                            disabled={!targetTableId}
                            className="bg-[var(--info)] hover:bg-[var(--info)]/90 text-white"
                        >
                            Confirmar Troca
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* PAYMENT MODAL */}
            <Modal isOpen={showPaymentModal} onClose={() => setShowPaymentModal(false)} title="Receber Pagamento" size="lg">
                <div className="space-y-4">
                    {/* Tabs */}
                    <div className="flex p-1 bg-[var(--surface-2)] rounded-lg">
                        <button onClick={() => setPaymentTab('payment')} className={`flex-1 py-1.5 text-xs font-bold rounded-md u-motion u-press-sm flex flex-col items-center gap-1 ${paymentTab === 'payment' ? 'bg-[var(--surface)] text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)]'}`}>
                            <Wallet size={14}/> Pagamento
                        </button>
                        <button onClick={() => setPaymentTab('split')} className={`flex-1 py-1.5 text-xs font-bold rounded-md u-motion u-press-sm flex flex-col items-center gap-1 ${paymentTab === 'split' ? 'bg-[var(--surface)] text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)]'}`}>
                            <Users size={14}/> Divisão
                        </button>
                        <button onClick={() => setPaymentTab('users')} className={`flex-1 py-1.5 text-xs font-bold rounded-md u-motion u-press-sm flex flex-col items-center gap-1 ${paymentTab === 'users' ? 'bg-[var(--surface)] text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)]'}`}>
                            <List size={14}/> Por Cliente
                        </button>
                        <button onClick={() => setPaymentTab('calculator')} className={`flex-1 py-1.5 text-xs font-bold rounded-md u-motion u-press-sm flex flex-col items-center gap-1 ${paymentTab === 'calculator' ? 'bg-[var(--surface)] text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)]'}`}>
                            <Calculator size={14}/> Calculadora
                        </button>
                    </div>

                    <div className="max-h-[60vh] overflow-y-auto pr-1">
                        {paymentTab === 'payment' && (
                            <PaymentCaptureFields
                                total={selectedTable ? getTableSummary(selectedTable.id).total : 0}
                                methods={paymentMethods}
                                currentMethod={currentPaymentMethod}
                                onMethodChange={setCurrentPaymentMethod}
                                currentBrand={currentPaymentBrand}
                                onBrandChange={setCurrentPaymentBrand}
                                currentAmount={currentPaymentAmount}
                                onAmountChange={setCurrentPaymentAmount}
                                onAddPayment={handleAddPayment}
                                onRemovePayment={handleRemovePayment}
                                remainingToPay={remainingToPay}
                                changeDue={changeDue}
                                onFinish={handleFinishPayment}
                                finishDisabled={remainingToPay > 0.01}
                                finishLabel="FINALIZAR MESA"
                                onOneClickFinish={(method) => handleFinishPayment([{ method, amount: remainingToPay }])}
                                showEmitirNotaToggle={emissaoFiscalConfigurada}
                                emitirNota={emitirNotaFiscal}
                                onEmitirNotaChange={setEmitirNotaFiscal}
                            >
                                {/* Destinatário da NF-e (Task 17) — só quando a loja emite NF-e
                                    automaticamente; NFC-e não tem <dest>, não mostra nada aqui. */}
                                {nfeModeloAtivo && (
                                    <div className="bg-[var(--info)]/5 p-3 rounded-xl border border-[var(--info)]/20 space-y-2">
                                        <p className="text-xs font-bold text-[var(--info)] uppercase tracking-wide">
                                            Documento do destinatário (NF-e, opcional)
                                        </p>
                                        <input
                                            type="text"
                                            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] focus:border-[var(--brand)] focus:outline-none text-sm"
                                            placeholder="CPF ou CNPJ do cliente"
                                            value={paymentDestCpfCnpj}
                                            onChange={(e) => setPaymentDestCpfCnpj(e.target.value)}
                                        />
                                        <input
                                            type="text"
                                            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] focus:border-[var(--brand)] focus:outline-none text-sm"
                                            placeholder="Nome do cliente"
                                            value={paymentDestNome}
                                            onChange={(e) => setPaymentDestNome(e.target.value)}
                                        />
                                        <p className="text-xs text-[var(--text-muted)]">
                                            Deixe em branco pra fechar a mesa sem emitir a NF-e agora — dá pra preencher
                                            e reemitir depois na aba "Notas Fiscais".
                                        </p>
                                    </div>
                                )}
                            </PaymentCaptureFields>
                        )}

                        {paymentTab === 'split' && currentTableSummary && (
                            <div className="space-y-6 pt-2 animate-fade-in">
                                <div className="bg-[var(--brand)]/5 p-4 rounded-xl border border-[var(--brand)]/10 text-center">
                                    <p className="text-sm text-[var(--text-muted)] uppercase font-bold tracking-wider">Total da Mesa</p>
                                    <p className="text-3xl font-black text-[var(--brand)] mt-1">R$ {formatBRL(currentTableSummary.total)}</p>
                                    <p className="text-xs text-[var(--text-muted)] mt-1">
                                        {currentTableSummary.isServiceFeeEnabled
                                            ? `Inclui R$ ${formatBRL(currentTableSummary.serviceFee)} de taxa de serviço (${formatServiceFeeRate(serviceFeeRate)} opcional)`
                                            : currentTableSummary.isServiceFeeRemovedForTable
                                                ? 'Taxa de serviço opcional removida nesta mesa'
                                                : 'Esta loja não cobra taxa de serviço'}
                                    </p>
                                </div>
                                <div className="flex items-center justify-center gap-6 py-2">
                                    <button onClick={() => setPaymentPeople(Math.max(1, paymentPeople - 1))} className="w-10 h-10 bg-[var(--surface-2)] rounded-full flex items-center justify-center hover:bg-[var(--border)] u-motion u-press-sm"><Minus size={18} /></button>
                                    <div className="text-center min-w-[80px]">
                                        <span className="block text-2xl font-bold text-[var(--text)]">{paymentPeople}</span>
                                        <span className="text-[10px] text-[var(--text-muted)] font-bold uppercase">Pessoas</span>
                                    </div>
                                    <button onClick={() => setPaymentPeople(paymentPeople + 1)} className="w-10 h-10 bg-[var(--surface-2)] rounded-full flex items-center justify-center hover:bg-[var(--border)] u-motion u-press-sm"><Plus size={18}/></button>
                                </div>
                                <div className="border-t border-dashed border-[var(--border)] pt-4 text-center">
                                    <p className="text-[var(--text-muted)] text-sm mb-1">Valor por pessoa</p>
                                    <p className="text-2xl font-bold text-[var(--text)]">R$ {formatBRL(currentTableSummary.total / paymentPeople)}</p>
                                    <Button 
                                        className="mt-4" 
                                        variant="secondary"
                                        onClick={() => {
                                            setCurrentPaymentAmount((currentTableSummary.total / paymentPeople).toFixed(2));
                                            setPaymentTab('payment');
                                        }}
                                    >
                                        Preencher Valor no Pagamento
                                    </Button>
                                </div>
                            </div>
                        )}

                        {paymentTab === 'users' && (
                            <div className="space-y-4 pt-2 animate-fade-in">
                                {/* Task 3: uma nota só (não por cartão de pessoa) quando a
                                    taxa não está sendo cobrada nesta comanda. */}
                                {currentTableSummary && !currentTableSummary.isServiceFeeEnabled && currentTableSummary.allItems.length > 0 && (
                                    <p className="text-xs text-[var(--text-muted)] px-1">
                                        {currentTableSummary.isServiceFeeRemovedForTable
                                            ? 'Taxa de serviço opcional removida nesta mesa'
                                            : 'Esta loja não cobra taxa de serviço'}
                                    </p>
                                )}
                                {Object.entries(usersBreakdown).map(([name, data]: [string, any]) => (
                                    <div key={name} className="border border-[var(--border)] rounded-xl overflow-hidden">
                                        <div className="bg-[var(--surface-2)] p-3 flex justify-between items-center border-b border-[var(--border)]">
                                            <span className="font-bold text-[var(--text)] flex items-center gap-2"><User size={14}/> {name}</span>
                                            <span className="font-bold text-[var(--brand)]">R$ {formatBRL(data.total)}</span>
                                        </div>
                                        <div className="p-2 space-y-1">
                                            {data.items.map((it: any) => (
                                                <div key={it.id} className="flex justify-between items-center text-xs text-[var(--text-muted)] px-2 py-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <span>{it.quantity}x {getOrderItemDisplayName(it)}</span>
                                                    </div>
                                                    <span>{(it.price_at_time * it.quantity).toFixed(2)}</span>
                                                </div>
                                            ))}
                                            {currentTableSummary?.isServiceFeeEnabled && (
                                                <div className="flex justify-between items-center text-xs text-[var(--text-muted)] px-2 py-1 border-t border-[var(--border)] mt-1 pt-1">
                                                    <span>Taxa de Serviço ({formatServiceFeeRate(serviceFeeRate)})</span>
                                                    <span>{data.serviceFee.toFixed(2)}</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="p-2 border-t border-[var(--border)] space-y-1.5">
                                            <Button
                                                className="w-full text-xs h-8"
                                                variant="secondary"
                                                onClick={() => {
                                                    setCurrentPaymentAmount(data.total.toFixed(2));
                                                    setPaymentTab('payment');
                                                }}
                                            >
                                                Lançar Pagamento de {name}
                                            </Button>
                                            {emissaoFiscalConfigurada && (
                                                <Button
                                                    className="w-full text-xs h-8"
                                                    variant="outline"
                                                    isLoading={emitindoNotaDe === name}
                                                    disabled={emitindoNotaDe !== null}
                                                    onClick={() => handleEmitirNotaIndividual(name, data.items)}
                                                >
                                                    Emitir Nota Fiscal de {name}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {(!currentTableSummary || currentTableSummary.allItems.length === 0) && <p className="text-center text-[var(--text-muted)]">Nenhum pedido realizado.</p>}
                            </div>
                        )}

                        {paymentTab === 'calculator' && currentTableSummary && (
                            <div className="space-y-2 pt-2 animate-fade-in">
                                <div className="bg-[var(--info)]/10 p-3 rounded-lg text-xs text-[var(--info)] mb-2">
                                    Selecione os itens para calcular um subtotal.
                                </div>
                                {currentTableSummary.allItems.map(item => {
                                    const isSelected = !!paymentSelectedItems[item.id];
                                    const selectedQty = paymentSelectedItems[item.id] || 0;

                                    return (
                                        <div key={item.id} onClick={() => toggleSelection(item.id, item.quantity)} className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${isSelected ? 'border-[var(--brand)] bg-[var(--brand)]/5' : 'border-[var(--border)] bg-[var(--surface)]'}`}>
                                            <div className={`text-[var(--brand)] ${isSelected ? 'opacity-100' : 'opacity-30'}`}>
                                                {isSelected ? <CheckSquare size={20}/> : <Square size={20}/>}
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex justify-between items-start">
                                                    <span className={`text-sm font-bold ${isSelected ? 'text-[var(--brand)]' : 'text-[var(--text-muted)]'}`}>
                                                        {getOrderItemDisplayName(item)}
                                                    </span>
                                                    <span className="text-sm font-medium">R$ {formatBRL(item.price_at_time)}</span>
                                                </div>

                                                {isSelected && item.quantity > 1 && (
                                                    <div className="flex items-center gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                                                        <span className="text-xs text-[var(--text-muted)]">Qtd:</span>
                                                        <button onClick={() => updateSelectionQty(item.id, -1, item.quantity)} className="w-6 h-6 bg-[var(--surface)] border border-[var(--border)] rounded flex items-center justify-center text-[var(--brand)] u-motion u-press-sm"><Minus size={12}/></button>
                                                        <span className="text-sm font-bold w-4 text-center">{selectedQty}</span>
                                                        <button onClick={() => updateSelectionQty(item.id, 1, item.quantity)} className="w-6 h-6 bg-[var(--surface)] border border-[var(--border)] rounded flex items-center justify-center text-[var(--brand)] u-motion u-press-sm"><Plus size={12}/></button>
                                                        <span className="text-xs text-[var(--text-muted)] ml-1">/ {item.quantity}</span>
                                                    </div>
                                                )}
                                                {!isSelected && item.quantity > 1 && (
                                                    <span className="text-xs text-[var(--text-muted)]">Quantidade: {item.quantity}</span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}

                                <div className="mt-4 p-4 bg-[var(--ink)] text-white rounded-xl">
                                    <div className="flex justify-between items-center">
                                        <span className="font-bold">Total Selecionado</span>
                                        <span className="font-black text-xl">R$ {formatBRL(calculatorTotal)}</span>
                                    </div>
                                    <div className="text-xs text-white/50 mt-1 text-right">
                                        {currentTableSummary.isServiceFeeEnabled
                                            ? `Inclui R$ ${formatBRL(calculatorServiceFee)} de taxa de serviço (${formatServiceFeeRate(serviceFeeRate)} opcional)`
                                            : currentTableSummary.isServiceFeeRemovedForTable
                                                ? 'Taxa de serviço opcional removida nesta mesa'
                                                : 'Esta loja não cobra taxa de serviço'}
                                    </div>
                                    <Button
                                        className="w-full mt-3 bg-white text-[var(--ink)] hover:bg-[var(--surface-2)]"
                                        onClick={() => {
                                            setCurrentPaymentAmount(calculatorTotal.toFixed(2));
                                            setPaymentTab('payment');
                                        }}
                                        disabled={calculatorTotal <= 0}
                                    >
                                        Preencher Valor no Pagamento
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </Modal>

            {/* FIX DATABASE MODAL */}
            <Modal isOpen={showFixDbModal} onClose={() => setShowFixDbModal(false)} title="Configuração Necessária">
                <div className="space-y-4">
                    <div className="bg-[var(--warn)]/10 border border-[var(--warn)]/30 p-4 rounded-xl flex gap-3 items-start">
                        <AlertCircle className="text-[var(--warn)] shrink-0 mt-1" size={24} />
                        <div>
                            <h4 className="font-bold text-[var(--warn)]">Atualização de Banco de Dados</h4>
                            <p className="text-sm text-[var(--text)] mt-1">
                                O banco de dados precisa ser atualizado para suportar novas funções.
                                <strong> Se você já rodou o script abaixo e o erro persiste, você precisa REINICIAR o projeto no painel do Supabase</strong> (Settings &gt; General &gt; Restart Project).
                            </p>
                        </div>
                    </div>

                    <p className="text-sm text-[var(--text-muted)]">
                        Para corrigir isso e habilitar o salvamento de pagamentos, execute o seguinte script no <strong>SQL Editor</strong> do seu painel Supabase:
                    </p>

                    <div className="relative">
                        <pre className="bg-[var(--ink)] text-white/70 p-4 rounded-lg text-xs overflow-x-auto font-mono border border-white/10">
                            {SQL_FIX_SCRIPT}
                        </pre>
                        <button 
                            onClick={() => {
                                navigator.clipboard.writeText(SQL_FIX_SCRIPT);
                                toast.success("Script copiado!");
                            }}
                            className="absolute top-2 right-2 bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded text-xs u-motion u-press-sm"
                        >
                            Copiar
                        </button>
                    </div>

                    <div className="flex justify-end pt-2">
                        <Button onClick={() => setShowFixDbModal(false)}>Entendi</Button>
                    </div>
                </div>
            </Modal>

            {/* "Pedidos do Dia" (redesign 2026-08-23, sucede "Histórico de
                Pedidos Enviados" da Task 2): lista plana (hora, mesa, item,
                se imprimiu), sem status/coluna de fluxo nem controle de
                confirmação de entrega — só visualização, pedido explícito do
                dono. Cobre o dia inteiro, mesas fechadas incluídas — ver
                sentHistoryItems acima pro porquê de combinar duas fontes. */}
            <Modal isOpen={showSentHistory} onClose={() => setShowSentHistory(false)} title="Pedidos do Dia" variant="sheet">
                <div className="space-y-3">
                    <p className="text-xs text-[var(--text-muted)]">
                        Tudo que foi lançado hoje, mesas fechadas incluídas — do mais recente pro mais antigo. Só visualização, sem nenhuma ação aqui.
                    </p>
                    <div className="flex p-1 bg-[var(--surface-2)] rounded-[var(--r-md)]">
                        <button
                            type="button"
                            onClick={() => setShowOnlyMine(true)}
                            className={`flex-1 py-1.5 text-xs font-bold rounded-[var(--r-sm)] u-motion u-press-sm ${showOnlyMine ? 'bg-[var(--surface)] text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)]'}`}
                        >
                            Meus pedidos
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowOnlyMine(false)}
                            className={`flex-1 py-1.5 text-xs font-bold rounded-[var(--r-sm)] u-motion u-press-sm ${!showOnlyMine ? 'bg-[var(--surface)] text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)]'}`}
                        >
                            Todos
                        </button>
                    </div>
                    {(() => {
                        const filteredHistory = showOnlyMine
                            ? sentHistoryItems.filter(row => row.addedByName === loggedUser.name)
                            : sentHistoryItems;
                        if (filteredHistory.length === 0) {
                            return (
                                <p className="text-sm text-[var(--text-muted)] text-center py-8">
                                    {showOnlyMine ? 'Você ainda não lançou nenhum pedido hoje.' : 'Nenhum pedido lançado ainda hoje.'}
                                </p>
                            );
                        }
                        return (
                        <div className="space-y-2 max-h-[65vh] overflow-y-auto">
                            {filteredHistory.map(row => (
                                <div key={row.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] flex-wrap">
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-[var(--text)] truncate">
                                            {row.quantity}x {row.productName}{row.addons ? ` (${row.addons})` : ''}
                                        </p>
                                        <p className="text-xs text-[var(--text-muted)]">
                                            Mesa {row.tableNumber} · {new Date(row.time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                            {row.closed ? ' · mesa fechada' : ''}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <Badge color={row.printed ? 'bg-[var(--ok)]/10 text-[var(--ok)]' : 'bg-[var(--surface)] text-[var(--text-muted)]'}>
                                            {row.printed ? 'Impresso' : 'Sem registro'}
                                        </Badge>
                                        <Badge color={row.destination === 'bar' ? 'bg-[var(--info)]/10 text-[var(--info)]' : 'bg-[var(--warn)]/10 text-[var(--warn)]'}>
                                            {row.destination === 'bar' ? 'Bar' : 'Cozinha'}
                                        </Badge>
                                        {/* Critical #2: só oferece a ação em quem passa por `canReprint`
                                            (aparelho de caixa de verdade, ver comentário acima) E cuja mesa/
                                            comanda ainda está aberta — reimprimir ticket de cozinha pra uma
                                            mesa já fechada (pagou e foi embora) produz comida que ninguém
                                            pediu mais. Quem não bate os dois continua vendo o badge de status
                                            normalmente (view-only), só não vê o botão. */}
                                        {!row.printed && !row.closed && canReprint && (
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                disabled={reprintingIds.has(row.id)}
                                                onClick={() => handleManualReprint(row)}
                                            >
                                                <RotateCcw size={14} className="mr-1" /> Reimprimir
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                        );
                    })()}
                </div>
            </Modal>

            {/* Subprojeto 3 (2026-08-25): trocar responsável pela mesa selecionada
                sem sair de Mesas nem abrir Gestão de Usuários. */}
            <Modal isOpen={showReassignModal} onClose={() => setShowReassignModal(false)} title={`Responsável — Mesa ${selectedTable?.number ?? ''}`}>
                <div className="space-y-3">
                    <p className="text-xs text-[var(--text-muted)]">
                        Só mostra quem já tem jurisdição de mesas restrita configurada. Garçom sem restrição ("todas as mesas") já vê esta mesa por padrão.
                        Quem não bateu ponto só aparece aqui se já for responsável por esta mesa.
                    </p>
                    {isLoadingReassignTeam ? (
                        <div className="flex items-center justify-center py-10 text-[var(--text-muted)]">
                            <RefreshCw size={22} className="animate-spin" />
                        </div>
                    ) : reassignTeamByLoad.length === 0 ? (
                        <p className="text-sm text-[var(--text-muted)] text-center py-8">
                            Ninguém com jurisdição restrita e ponto aberto agora — configure jurisdição em Administração → Usuários, ou peça pra bater ponto.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {/* Fase 3, Tasks 9+10: lista já vem ordenada do menos pro mais
                                ocupado agora e filtrada a quem bateu ponto (exceto quem já
                                é responsável por esta mesa) — sugestão visual de escala, o
                                operador continua livre pra marcar qualquer um. */}
                            {reassignTeamByLoad.map(member => {
                                const hasTable = !!selectedTable && (member.assigned_table_ids || []).includes(selectedTable.id);
                                const isSaving = savingReassignIds.has(member.id);
                                return (
                                    <label key={member.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] cursor-pointer">
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-[var(--text)] truncate flex items-center gap-1.5">
                                                {member.name}
                                                {!member.hasOpenCheckin && (
                                                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[var(--warn)]/10 text-[var(--warn)]">
                                                        sem ponto
                                                    </span>
                                                )}
                                            </p>
                                            <p className="text-xs text-[var(--text-muted)]">
                                                {(member.assigned_table_ids || []).length} mesa(s) atribuída(s) ·{' '}
                                                <span className={member.activeTableCount === 0 ? 'text-[var(--ok)] font-semibold' : 'font-semibold'}>
                                                    {member.activeTableCount} ativa{member.activeTableCount === 1 ? '' : 's'} agora
                                                </span>
                                            </p>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={hasTable}
                                            disabled={isSaving}
                                            onChange={() => handleToggleReassign(member)}
                                            className="w-5 h-5 accent-[var(--brand)] shrink-0"
                                        />
                                    </label>
                                );
                            })}
                        </div>
                    )}
                </div>
            </Modal>
        </>
    );
};

// --- SUB-MODULE: COUNTER (BALCÃO) ---

const CounterView: React.FC<{
    store: Store;
    loggedUser: StoreUser;
    // Task 3 (frente-de-caixa): mesmo mecanismo de TablesView.autoOpenTableId
    // — CaixaView navega até aqui pra abrir a captura de pagamento
    // (handleClose já abre `paymentOrder` quando caixaModuleOn) de um pedido
    // de balcão da fila consolidada.
    autoOpenOrderId?: string;
    onAutoOpenOrderHandled?: () => void;
}> = ({ store, loggedUser, autoOpenOrderId, onAutoOpenOrderHandled }) => {
    const storeId = store.id;
    const orderFlow = resolveOrderFlow(store);
    const [orders, setOrders] = useState<Order[]>([]);

    // Destinatário da NF-e (Task 17) — mesma lógica de TablesView: config
    // fiscal buscada à parte (não compartilhada com MenuManagementView), só
    // usada pra decidir se mostra o modal de captura opcional de CPF/CNPJ
    // antes de fechar o pedido de balcão.
    const [nfeModeloAtivo, setNfeModeloAtivo] = useState(false);
    // Task 4 (2026-08-23): mesmo state espelhado de TablesView, ver
    // comentário lá — qualquer modelo configurado (nfce OU nfe) já mostra
    // o toggle "Emitir nota fiscal desta venda".
    const [emissaoFiscalConfigurada, setEmissaoFiscalConfigurada] = useState(false);
    const [emitirNotaFiscal, setEmitirNotaFiscal] = useState(true);
    const [closingOrder, setClosingOrder] = useState<Order | null>(null);
    const [destCpfCnpj, setDestCpfCnpj] = useState('');
    const [destNome, setDestNome] = useState('');
    const [isClosingOrder, setIsClosingOrder] = useState(false);

    // Task 5 (2026-08-22, plano perfis-de-loja-e-caixa — fecha o gap do
    // Balcão): mesmas duas checagens que TablesView já faz pra mesa,
    // aplicadas ao balcão. `caixaModuleOn` decide se ENTREGAR passa a exigir
    // pagamento capturado; `canFinalize` decide QUEM pode finalizar quando o
    // módulo está ligado — a MESMA função (canFinalizeBill), não uma regra
    // paralela ("one rule, both surfaces", brief da Task 5). Loja sem
    // `config.modules` (as 7 lojas reais de hoje): `caixaModuleOn` é sempre
    // `false` (ver lib/storeModules.ts, ALL_ON.caixa), então nada abaixo
    // muda o comportamento de ninguém — handleClose cai direto no mesmo
    // confirm()/modal de NF-e de sempre.
    const caixaModuleOn = resolveStoreModules(store).caixa;
    const canFinalize = canFinalizeBill(loggedUser, store);
    const isFinishingRef = useRef(false);

    // Captura de pagamento (Task 5) — só usada quando caixaModuleOn. Mesmo
    // shape de estado que TablesView usa pro pagamento de mesa
    // (paymentMethods/currentPaymentAmount/currentPaymentMethod/
    // currentPaymentBrand), reaproveitado via PaymentCaptureFields.
    const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
    const [paymentMethods, setPaymentMethods] = useState<{ method: string; amount: number; brand?: string }[]>([]);
    const [currentPaymentAmount, setCurrentPaymentAmount] = useState('');
    const [currentPaymentMethod, setCurrentPaymentMethod] = useState('CREDIT');
    const [currentPaymentBrand, setCurrentPaymentBrand] = useState('');

    const load = async () => {
        const data = await fetchCounterOrders(storeId);
        setOrders(data);
    };

    useEffect(() => {
        load();
        const channel = supabase.channel(`counter_${storeId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'order_change_pings', filter: `store_id=eq.${storeId}` }, () => load())
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [storeId]);

    useEffect(() => {
        fetchStoreFiscalConfig(storeId)
            .then((cfg) => {
                setNfeModeloAtivo(cfg?.modelo_emissao_automatica === 'nfe');
                setEmissaoFiscalConfigurada(!!cfg && cfg.modelo_emissao_automatica !== 'nenhuma');
            })
            .catch(() => {
                setNfeModeloAtivo(false);
                setEmissaoFiscalConfigurada(false);
            });
    }, [storeId]);

    const getOrderTotal = (order: Order) =>
        (order.order_items || []).reduce((acc, item) => acc + item.quantity * item.price_at_time, 0);

    // Task 5: `paymentData` é novo e opcional (ver lib/api.ts,
    // closeCounterOrder) — todo call site que já existia antes desta task
    // continua passando `undefined` explícito nessa posição, comportamento
    // idêntico ao de sempre.
    const closeOrderNow = async (
        orderId: string,
        paymentData?: { total: number; methods: { method: string; amount: number; brand?: string }[]; emitir_nota?: boolean },
        destinatario?: { cpfCnpj: string; nome: string },
    ) => {
        try {
            await closeCounterOrder(orderId, paymentData, destinatario);
        } catch (e: any) {
            if (e.message === "schema cache updated_at") {
                toast.error("Para calcular o tempo médio, execute este script no SQL Editor do Supabase:\n\nALTER TABLE orders ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();\nNOTIFY pgrst, 'reload schema';", 10000);
            } else {
                toast.error("Erro ao fechar pedido: " + e.message);
            }
            throw e;
        }
    };

    // Achado na revisão final de branch (2026-08-30): antes vivia só como
    // `disabled` do botão "Entregar" no render — mas handleClose também é
    // chamado direto pelo efeito de autoOpenOrderId (fila "Aguardando
    // pagamento" do CaixaView), que contorna o botão inteiramente. Extraído
    // pra um helper único, usado tanto aqui (no handler, defesa real) quanto
    // no render (só UX — desabilitar/explicar o botão antes do clique).
    // orderFlow === 'direct_print' pula a checagem pelo mesmo motivo já
    // documentado no gate equivalente de TablesView.handleFinishPayment
    // (loja sem KDS nenhum, item nasce 'accepted' e nunca avança sozinho) —
    // READY e DELIVERED contam como pronto porque o cozinheiro pode marcar
    // "Entregar" no próprio KdsView antes do caixa fechar o pagamento aqui.
    const isOrderReadyForClose = (order: Order) => {
        if (orderFlow === 'direct_print') return true;
        const relevantItems = order.order_items?.filter(i => i.status !== OrderStatus.CANCELED) ?? [];
        return relevantItems.length > 0 && relevantItems.every(
            i => i.status === OrderStatus.READY || i.status === OrderStatus.DELIVERED
        );
    };

    const handleClose = async (orderId: string) => {
        const orderForGate = orders.find((o) => o.id === orderId) || null;
        if (orderForGate && !isOrderReadyForClose(orderForGate)) {
            toast.error('Pedido ainda não está pronto — aguarde a cozinha/bar finalizar antes de entregar.');
            return;
        }
        // Módulo Caixa ligado (Task 5): ENTREGAR abre a captura de
        // pagamento (mesmo modal/UI que TablesView usa pra mesa) em vez do
        // confirm() simples de sempre — nunca os dois juntos.
        if (caixaModuleOn) {
            // Defesa em profundidade — o botão que chama isto já não
            // renderiza pra quem não pode finalizar (ver JSX abaixo), mas
            // travar aqui também garante que nenhum outro caminho futuro
            // abra a captura de pagamento pra quem só pode VER o balcão.
            if (!canFinalize) return;
            const order = orderForGate;
            if (!order) return;
            setPaymentOrder(order);
            setPaymentMethods([]);
            setCurrentPaymentAmount(getOrderTotal(order).toFixed(2));
            setCurrentPaymentMethod('CREDIT');
            setCurrentPaymentBrand('');
            setDestCpfCnpj('');
            setDestNome('');
            // Task 4: sempre nasce ligado, mesmo motivo de TablesView.
            setEmitirNotaFiscal(true);
            return;
        }
        // Loja SEM o módulo Caixa — comportamento de hoje, intocado. Em
        // modelo NF-e: abre o modal de captura opcional do destinatário em
        // vez do confirm() simples de sempre — deixar em branco continua
        // fechando o pedido normalmente (nota cai 'pendente', não impede o
        // fechamento).
        if (nfeModeloAtivo) {
            setClosingOrder(orderForGate);
            setDestCpfCnpj('');
            setDestNome('');
            return;
        }
        if (await confirm("Confirma a entrega e pagamento deste pedido?")) {
            try {
                await closeOrderNow(orderId);
            } catch {
                // já reportado via toast em closeOrderNow
            }
        }
    };

    // Task 3 (frente-de-caixa): consome autoOpenOrderId — mesmo padrão do
    // efeito equivalente em TablesView (autoOpenTableId). Assim que `orders`
    // estiver carregado, acha o pedido pedido pela fila do Caixa e chama
    // handleClose, que já sabe abrir a captura de pagamento quando
    // caixaModuleOn (o único caso em que CaixaView navega pra cá).
    useEffect(() => {
        if (!autoOpenOrderId || orders.length === 0) return;
        const order = orders.find(o => o.id === autoOpenOrderId);
        if (order) handleClose(order.id);
        onAutoOpenOrderHandled?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoOpenOrderId, orders]);

    const handleConfirmCloseWithDestinatario = async () => {
        if (!closingOrder) return;
        setIsClosingOrder(true);
        try {
            const destinatario = buildDestinatario(destCpfCnpj, destNome);
            await closeOrderNow(closingOrder.id, undefined, destinatario);
            setClosingOrder(null);
        } catch {
            // já reportado via toast em closeOrderNow
        } finally {
            setIsClosingOrder(false);
        }
    };

    // A partir daqui, tudo é exclusivo do fluxo de captura de pagamento
    // (Task 5, só existe quando caixaModuleOn) — mesmos cálculos que
    // TablesView já faz pra mesa, nunca reescritos: lib/calc.ts
    // (calculateChangeForMethods) é a única fonte do troco.
    const paymentTotalDue = paymentOrder ? getOrderTotal(paymentOrder) : 0;
    const totalPaidSoFar = paymentMethods.reduce((acc, p) => acc + p.amount, 0);
    const remainingToPay = Math.max(0, paymentTotalDue - totalPaidSoFar);
    const changeDue = calculateChangeForMethods(paymentMethods, paymentTotalDue);

    const handleAddPayment = () => {
        const amount = parseFloat(currentPaymentAmount.replace(',', '.'));
        if (isNaN(amount) || amount <= 0) return;

        const isCard = currentPaymentMethod === 'CREDIT' || currentPaymentMethod === 'DEBIT';
        // Achado real ao vivo (2026-08-28): bandeira era opcional, quebrando
        // a conferência por bandeira no fechamento de caixa quando alguém
        // esquecia de escolher. Agora obrigatória pra cartão.
        if (isCard && !currentPaymentBrand) {
            toast.error('Escolha a bandeira do cartão antes de lançar o pagamento.');
            return;
        }
        setPaymentMethods(prev => [...prev, {
            method: currentPaymentMethod,
            amount,
            ...(isCard ? { brand: currentPaymentBrand } : {}),
        }]);
        setCurrentPaymentBrand('');

        const currentTotalPaid = paymentMethods.reduce((acc, p) => acc + p.amount, 0) + amount;
        const remaining = Math.max(0, paymentTotalDue - currentTotalPaid);
        setCurrentPaymentAmount(remaining.toFixed(2));
    };

    const handleRemovePayment = (index: number) => {
        setPaymentMethods(prev => prev.filter((_, i) => i !== index));
    };

    // Fase 2, Task 5 (plano "Fora do Cardápio"): `methodsOverride` só existe
    // pro atalho de 1 toque — ver comentário equivalente em
    // TablesView.handleFinishPayment pro porquê (setState é assíncrono).
    const handleFinishCounterPayment = async (methodsOverride?: { method: string; amount: number; brand?: string }[]) => {
        if (!paymentOrder) return;
        if (isFinishingRef.current) return;
        isFinishingRef.current = true;

        try {
            const total = getOrderTotal(paymentOrder);
            const methods = methodsOverride ?? paymentMethods;
            const totalPaid = methods.reduce((acc, p) => acc + p.amount, 0);

            // Mesma checagem em duas camadas que TablesView.handleFinishPayment
            // já faz (botão desabilitado + reconferência no clique contra um
            // total recém-calculado) — nunca fecha uma venda paga a menos.
            if (totalPaid < total - 0.01) {
                toast.error('O valor pago é menor que o total do pedido.');
                return;
            }

            // Task 2 (frente-de-caixa) — mesma trava de TablesView.handleFinishPayment,
            // ver comentário lá pro porquê completo (migration 062, "caixa
            // por operador": é sempre o turno de QUEM está finalizando).
            let cashShiftId: string | undefined;
            if (resolveStoreModules(store).caixa) {
                const openShift = await fetchOpenCashShift(store.id, loggedUser.role === 'universal' ? null : loggedUser.id);
                if (!openShift) {
                    toast.error('Você não tem um turno de caixa aberto. Abra o seu caixa antes de receber pagamentos.');
                    return;
                }
                cashShiftId = openShift.id;
            }

            // Task 4: mesmo princípio de TablesView — a chave só entra no
            // payload quando a loja tem emissão automática configurada.
            // Task 2: `cash_shift_id` idem — ver bloco acima.
            // Mesmo achado/correção de TablesView.handleFinishPayment — ver
            // lib/calc.ts (getPaymentMethodsForRecord).
            // Painel de recebimento por garçom — mesmo achado de
            // TablesView.handleFinishPayment.
            const paymentData = {
                total,
                methods: getPaymentMethodsForRecord(methods, total),
                operador_nome: loggedUser.name,
                operador_id: loggedUser.id,
                ...(emissaoFiscalConfigurada ? { emitir_nota: emitirNotaFiscal } : {}),
                ...(cashShiftId ? { cash_shift_id: cashShiftId } : {}),
            };
            const destinatario = buildDestinatario(destCpfCnpj, destNome);
            await closeOrderNow(paymentOrder.id, paymentData, destinatario);

            // Comprovante com forma de pagamento — só quando quem fechou é
            // de fato um CAIXA (mesma distinção de
            // TablesView.handleFinishPayment): as 7 lojas reais (módulo
            // desligado) nunca chegam aqui, e dono/universal fechando pelo
            // bypass de canFinalizeBill não ganham um papel novo do nada.
            // Redesign 2026-08-23: sempre imprime no aparelho de quem
            // fechou — não existe mais "Estação" separada pra evitar
            // duplicar (ver lib/storeModules.ts).
            const isCaixaOperator = loggedUser.role !== 'owner' && loggedUser.role !== 'universal' && loggedUser.permissions?.caixa === true;
            if (isCaixaOperator) {
                const items = paymentOrder.order_items || [];
                const receiptOpts = {
                    storeName: store.name,
                    cnpj: store.cnpj,
                    paperWidthMm: store.config?.printer_paper_width_mm,
                    label: `BALCÃO - ${paymentOrder.customer_name || 'Cliente'} - PAGO`,
                    items: items.map(item => ({
                        quantity: item.quantity,
                        name: getOrderItemDisplayName(item),
                        client: parseItemNote(item.notes || '').client,
                        total: item.price_at_time * item.quantity,
                    })),
                    subtotal: total,
                    total,
                    payment: { methods, changeDue: methodsOverride ? 0 : changeDue },
                };
                const printed = await printBillReceipt(receiptOpts);
                if (!printed) {
                    toast.error('O pedido foi fechado, mas o comprovante não imprimiu. Confira a impressora do caixa.');
                }
                // Aditivo (2026-08-28, achado ao vivo) — ver mesmo padrão em
                // TablesView.handleFinishPayment.
                enqueueReceiptPrintJobs(store.id, `Comprovante - ${receiptOpts.label}`, buildBillReceiptText(receiptOpts))
                    .catch((e) => console.error('enqueueReceiptPrintJobs falhou:', e));
            }

            setPaymentOrder(null);
        } catch {
            // já reportado via toast em closeOrderNow
        } finally {
            isFinishingRef.current = false;
        }
    };

    // Achado real (2026-07-07, testando na pratica): pedido de balcao nasce
    // 'pending', e fetch_kitchen_orders_secure EXCLUI de proposito item
    // pending de order_type='counter' (migration 021) -- sem essa acao ele
    // nunca aparece na Cozinha/Bar, nunca entra em preparo, nunca notifica
    // ninguem. sendOrderToKitchen ja existia em lib/api.ts mas nenhum botao
    // chamava -- ficou "morto" desde sempre, nao e regressao desta sessao.
    const handleSendToKitchen = async (orderId: string) => {
        try {
            await sendOrderToKitchen(orderId);
            load();
        } catch (e: any) {
            toast.error("Erro ao enviar para a cozinha: " + e.message);
        }
    }

    const getStatusColor = (status: OrderStatus) => {
        switch(status) {
            case OrderStatus.PENDING: return 'bg-[var(--warn)]/8 border-[var(--warn)]/25 text-[var(--warn)]';
            case OrderStatus.ACCEPTED: return 'bg-[var(--warn)]/12 border-[var(--warn)]/30 text-[var(--warn)]';
            case OrderStatus.PREPARING: return 'bg-[var(--info)]/8 border-[var(--info)]/25 text-[var(--info)]';
            case OrderStatus.READY: return 'bg-[var(--ok)]/8 border-[var(--ok)]/25 text-[var(--ok)]';
            default: return 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-muted)]';
        }
    };

    const getStatusLabel = (status: OrderStatus) => {
        switch(status) {
            case OrderStatus.PENDING: return 'Aguardando';
            case OrderStatus.ACCEPTED: return 'Na Fila';
            case OrderStatus.PREPARING: return 'Preparando';
            case OrderStatus.READY: return 'Pronto p/ Retirar';
            default: return status;
        }
    };

    // Fix round 4 (Group C1): mesmo motivo de printTableBill/printSalesReport
    // (fix round 3, Group C1/C2) — printBillReceipt() aqui não tinha
    // await/catch. printHtmlDocument (lib/print.ts) resolve `new Promise((resolve)
    // => {...})` com appendChild/doc.open()/doc.write() dentro do executor;
    // um throw ali rejeita a promise em vez de resolver `false`, e sem
    // await/catch isso vira unhandled rejection silenciosa em vez de um
    // aviso visível pro operador — última instância desta classe neste
    // branch (as outras três já foram fechadas).
    const printCounterReceipt = async (order: Order) => {
        const items = order.order_items || [];
        if (items.length === 0) return;
        const total = items.reduce((a, b) => a + (b.quantity * b.price_at_time), 0);

        try {
            const receiptOpts = {
                storeName: store.name,
                cnpj: store.cnpj,
                paperWidthMm: store.config?.printer_paper_width_mm,
                label: `BALCÃO - ${order.customer_name || 'Cliente'}`,
                items: items.map(item => ({
                    quantity: item.quantity,
                    name: getOrderItemDisplayName(item),
                    client: parseItemNote(item.notes || '').client,
                    total: item.price_at_time * item.quantity,
                })),
                subtotal: total,
                total,
            };
            const printed = await printBillReceipt(receiptOpts);
            enqueueReceiptPrintJobs(store.id, `Conferência - ${receiptOpts.label}`, buildBillReceiptText(receiptOpts))
                .catch((e) => console.error('enqueueReceiptPrintJobs (conferência balcão) falhou:', e));
            if (!printed) {
                toast.error('O comprovante não imprimiu. Confira a impressora.');
            }
        } catch (e) {
            console.error('printBillReceipt (comprovante de balcão) lançou:', e);
            toast.error('O comprovante não imprimiu. Confira a impressora.');
        }
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
            <AnimatePresence>
            {orders.map(order => {
                const itemCount = order.order_items?.reduce((a,b) => a+b.quantity, 0) || 0;
                const total = order.order_items?.reduce((a,b) => a+(b.quantity * b.price_at_time), 0) || 0;
                const status = order.status;
                // Checagem de "pronto pra entregar" centralizada em isOrderReadyForClose
                // (definida acima, perto de handleClose) — usada aqui só pra UX (desabilitar
                // o botão antes do clique); a defesa real vive no handler, que também é
                // chamado por fora deste botão (fila do CaixaView via autoOpenOrderId).
                const allItemsReady = isOrderReadyForClose(order);

                return (
                    <motion.div
                        key={order.id}
                        layout
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={SPRING_TAP}
                    >
                    <Card accentColor="var(--brand)" className="flex flex-col p-4 pl-5">
                         <div className="flex justify-between items-start mb-2">
                             <div>
                                 <h3 className="font-bold text-lg text-[var(--text)] flex items-center gap-2">
                                     <User size={18}/> {order.customer_name || 'Cliente'}
                                 </h3>
                                 <span className="text-xs text-[var(--text-muted)]">#{order.id.slice(0,4)} • {new Date(order.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                             </div>
                             <span className={`px-2 py-1 rounded-[var(--r-sm)] text-xs font-bold uppercase border ${getStatusColor(status)}`}>
                                 {getStatusLabel(status)}
                             </span>
                         </div>

                         <div className="flex-1 overflow-y-auto max-h-[150px] space-y-1 mb-3 bg-[var(--surface-2)] p-2 rounded-[var(--r-md)] border border-[var(--border)]">
                             {order.order_items?.map((item, idx) => (
                                 <div key={idx} className="flex justify-between text-sm text-[var(--text-muted)]">
                                     <span className="truncate flex-1">{item.quantity}x {getOrderItemDisplayName(item)}</span>
                                     <span className="font-mono text-xs">{(item.price_at_time * item.quantity).toFixed(2)}</span>
                                 </div>
                             ))}
                         </div>

                         <div className="mt-auto pt-3 border-t border-[var(--border)] flex justify-between items-center gap-2">
                             <div>
                                 <p className="text-xs text-[var(--text-muted)] font-bold uppercase">Total</p>
                                 <p className="text-xl font-black text-[var(--text)] num">R$ {formatBRL(total)}</p>
                             </div>
                             <button
                                 onClick={() => printCounterReceipt(order)}
                                 className="p-2.5 rounded-full bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--border)] border border-[var(--border)] u-motion u-press shrink-0"
                                 title="Imprimir Comprovante"
                             >
                                 <Printer size={18} />
                             </button>
                             {status === OrderStatus.PENDING ? (
                                 <Button onClick={() => handleSendToKitchen(order.id)} variant="primary" className="h-10 text-sm shrink-0">
                                     <ChefHat size={16} className="mr-1"/> Enviar p/ Cozinha
                                 </Button>
                             ) : caixaModuleOn && !canFinalize ? (
                                 // Task 5 (módulo Caixa): sem o botão de finalizar — só quem tem a
                                 // permissão 'caixa' fecha a venda quando o módulo está ligado. Não
                                 // existe equivalente de "pedir a conta" pro balcão (o pedido já
                                 // está no caixa, esperando ser recebido), então isto é só
                                 // informativo, sem ação nenhuma.
                                 <span className="h-10 px-3 flex items-center text-xs font-bold text-[var(--text-muted)] bg-[var(--surface-2)] rounded-[var(--r-md)] border border-[var(--border)] shrink-0">
                                     Aguardando o caixa
                                 </span>
                             ) : (
                                 <Button
                                     onClick={() => handleClose(order.id)}
                                     variant="primary"
                                     className="h-10 text-sm shrink-0"
                                     // Task 5 (varredura 2026-08-30, corrigido apos achado do
                                     // revisor): este botão só aparece pra status != PENDING (ramo
                                     // tratado acima). Libera só quando todo item do pedido estiver
                                     // READY (ver allItemsReady acima) — checar order.status aqui
                                     // travaria pra sempre, porque essa coluna nunca chega a
                                     // PREPARING/READY, só order_items.status avança via KDS.
                                     disabled={!allItemsReady}
                                     title={!allItemsReady ? 'Aguarde o pedido ficar pronto' : undefined}
                                 >
                                     <CheckCircle size={16} className="mr-1"/> Entregar
                                 </Button>
                             )}
                         </div>
                    </Card>
                    </motion.div>
                );
            })}
            </AnimatePresence>
            {orders.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center py-32 text-[var(--text-muted)] bg-[var(--surface)] rounded-[var(--r-lg)] border-2 border-dashed border-[var(--border)]">
                    <Coffee className="mb-4 h-20 w-20 opacity-20" />
                    <p className="text-xl font-medium">Tudo tranquilo no balcão!</p>
                    <p className="text-sm">Aguardando novos pedidos...</p>
                </div>
            )}

            {/* Destinatário da NF-e (Task 17) — só aparece quando a loja emite
                NF-e automaticamente (handleClose decide isso antes de abrir). */}
            <Modal isOpen={!!closingOrder} onClose={() => setClosingOrder(null)} title="Fechar Pedido">
                <div className="space-y-4">
                    <div className="bg-[var(--info)]/5 p-3 rounded-xl border border-[var(--info)]/20 space-y-2">
                        <p className="text-xs font-bold text-[var(--info)] uppercase tracking-wide">
                            Documento do destinatário (NF-e, opcional)
                        </p>
                        <input
                            type="text"
                            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] focus:border-[var(--brand)] focus:outline-none text-sm"
                            placeholder="CPF ou CNPJ do cliente"
                            value={destCpfCnpj}
                            onChange={(e) => setDestCpfCnpj(e.target.value)}
                        />
                        <input
                            type="text"
                            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] focus:border-[var(--brand)] focus:outline-none text-sm"
                            placeholder="Nome do cliente"
                            value={destNome}
                            onChange={(e) => setDestNome(e.target.value)}
                        />
                        <p className="text-xs text-[var(--text-muted)]">
                            Deixe em branco pra fechar o pedido sem emitir a NF-e agora — dá pra preencher e
                            reemitir depois na aba "Notas Fiscais".
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="secondary" className="flex-1" onClick={() => setClosingOrder(null)}>
                            Cancelar
                        </Button>
                        <Button className="flex-1" onClick={handleConfirmCloseWithDestinatario} isLoading={isClosingOrder}>
                            Confirmar e Fechar
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Módulo Caixa (Task 5, 2026-08-22): captura de pagamento do
                balcão — só existe quando caixaModuleOn (handleClose decide
                isso antes de abrir). Reaproveita EXATAMENTE o componente que
                TablesView usa pra mesa (PaymentCaptureFields), nunca uma UI
                paralela — "one payment mechanism", ver comentário do
                componente. */}
            <Modal isOpen={!!paymentOrder} onClose={() => setPaymentOrder(null)} title="Receber Pagamento" size="lg">
                <PaymentCaptureFields
                    total={paymentTotalDue}
                    methods={paymentMethods}
                    currentMethod={currentPaymentMethod}
                    onMethodChange={setCurrentPaymentMethod}
                    currentBrand={currentPaymentBrand}
                    onBrandChange={setCurrentPaymentBrand}
                    currentAmount={currentPaymentAmount}
                    onAmountChange={setCurrentPaymentAmount}
                    onAddPayment={handleAddPayment}
                    onRemovePayment={handleRemovePayment}
                    remainingToPay={remainingToPay}
                    changeDue={changeDue}
                    onFinish={handleFinishCounterPayment}
                    finishDisabled={remainingToPay > 0.01}
                    finishLabel="FINALIZAR VENDA"
                    onOneClickFinish={(method) => handleFinishCounterPayment([{ method, amount: remainingToPay }])}
                    showEmitirNotaToggle={emissaoFiscalConfigurada}
                    emitirNota={emitirNotaFiscal}
                    onEmitirNotaChange={setEmitirNotaFiscal}
                >
                    {/* Destinatário da NF-e (Task 17) — só quando a loja emite NF-e
                        automaticamente; mesma posição/campos que TablesView usa. */}
                    {nfeModeloAtivo && (
                        <div className="bg-[var(--info)]/5 p-3 rounded-xl border border-[var(--info)]/20 space-y-2">
                            <p className="text-xs font-bold text-[var(--info)] uppercase tracking-wide">
                                Documento do destinatário (NF-e, opcional)
                            </p>
                            <input
                                type="text"
                                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] focus:border-[var(--brand)] focus:outline-none text-sm"
                                placeholder="CPF ou CNPJ do cliente"
                                value={destCpfCnpj}
                                onChange={(e) => setDestCpfCnpj(e.target.value)}
                            />
                            <input
                                type="text"
                                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] focus:border-[var(--brand)] focus:outline-none text-sm"
                                placeholder="Nome do cliente"
                                value={destNome}
                                onChange={(e) => setDestNome(e.target.value)}
                            />
                            <p className="text-xs text-[var(--text-muted)]">
                                Deixe em branco pra fechar o pedido sem emitir a NF-e agora — dá pra preencher e
                                reemitir depois na aba "Notas Fiscais".
                            </p>
                        </div>
                    )}
                </PaymentCaptureFields>
            </Modal>
        </div>
    );
};

// --- SUB-MODULE: CAIXA (Task 3, 2026-08-23, plano frente-de-caixa) ---
//
// Aba nova pro operador de caixa: se não há turno aberto, mostra a ação de
// abrir caixa (fundo de troco) em destaque, sem mais nada — é o "primeiro
// lugar que o operador vê ao entrar" (brief). Com turno aberto, mostra a
// fila consolidada de recebíveis (mesas `waiting_bill` + pedidos de balcão
// aguardando pagamento, mais antigo primeiro) e um resumo pequeno do turno.
//
// Reuso, não duplicação (requisito central do brief): tocar num item da
// fila NÃO abre um modal de pagamento próprio — navega até TablesView ou
// CounterView (via onOpenTablePayment/onOpenCounterPayment, providos pelo
// StoreModule) e deixa a view original abrir o MESMO modal "Receber
// Pagamento" que já usa há tempos (ver TablesView.autoOpenTableId/
// CounterView.autoOpenOrderId acima). As duas views já buscam exatamente
// os dados que a fila precisa (fetchTables/fetchActiveOrdersForTables/
// fetchCounterOrders) — reaproveitados aqui, nenhuma query nova.
//
// Task 4 (frente-de-caixa): sangria/suprimento (register_cash_movement_secure)
// e fechamento de turno com conferência (fetch_cash_shift_summary_secure +
// close_cash_shift_secure) — completa o que a Task 3 tinha deixado como
// placeholder.
const CaixaView: React.FC<{
    store: Store;
    loggedUser: StoreUser;
    onOpenTablePayment: (tableId: string) => void;
    onOpenCounterPayment: (orderId: string) => void;
}> = ({ store, loggedUser, onOpenTablePayment, onOpenCounterPayment }) => {
    const storeId = store.id;
    const serviceFeeRate = store.config?.service_fee_rate ?? SERVICE_FEE_RATE;
    const orderFlow = resolveOrderFlow(store);

    // Melhorias no fluxo de Caixa (2026-08-28): contagem cega — owner/
    // universal e quem tem `supervisiona_caixa` sempre veem o esperado;
    // o resto só vê depois de confirmar, se a loja ligou a config.
    const canSeeExpectedBeforeClosing = !store.config?.cash_shift_blind_count
        || loggedUser.role === 'owner'
        || loggedUser.role === 'universal'
        || loggedUser.permissions?.supervisiona_caixa === true;
    const [closedResultDifference, setClosedResultDifference] = useState<{ expected: number; counted: number; difference: number } | null>(null);

    // Fase 3, Task 8 (plano "Fora do Cardápio"): mesmo critério exato de
    // `canReprint` em TablesView (ver Critical #2, CaixaPrintStation.tsx) —
    // reimprimir manualmente um item pendente só faz sentido no aparelho de
    // caixa de verdade, nunca em dono/universal checando de outro lugar.
    const canReprintPending = orderFlow === 'direct_print' && isCaixaRole(loggedUser);
    const [reprintingPendingIds, setReprintingPendingIds] = useState<Set<string>>(new Set());
    const [printedRefreshNonce, setPrintedRefreshNonce] = useState(0);

    // Fase 2, Task 6 (plano "Fora do Cardápio"): sob carga alta (sexta à
    // noite), a mesma densidade de informação de um dia vazio atrapalha —
    // `rushModeManual` deixa o operador ligar/desligar na mão; sem toque
    // nenhum, liga sozinho a partir de RUSH_THRESHOLD mesas ocupadas.
    const RUSH_THRESHOLD = 6;
    const [rushModeManual, setRushModeManual] = useState<boolean | null>(null);

    // undefined = ainda não sabemos (loading inicial); null = sem turno
    // aberto; objeto = turno aberto.
    const [shift, setShift] = useState<CashShift | null | undefined>(undefined);
    const [tables, setTables] = useState<Table[]>([]);
    const [activeOrders, setActiveOrders] = useState<Order[]>([]);
    const [counterOrders, setCounterOrders] = useState<Order[]>([]);
    const [openingFloat, setOpeningFloat] = useState('');
    const [isOpeningShift, setIsOpeningShift] = useState(false);

    // Task 4, Passo 1: sangria/suprimento — formulário simples num modal.
    const [showMovementModal, setShowMovementModal] = useState(false);
    const [movementType, setMovementType] = useState<'sangria' | 'suprimento'>('sangria');
    const [movementAmount, setMovementAmount] = useState('');
    const [movementReason, setMovementReason] = useState('');
    const [isSubmittingMovement, setIsSubmittingMovement] = useState(false);

    // Task 4, Passo 2: fechamento de turno com conferência.
    const [showCloseModal, setShowCloseModal] = useState(false);
    const [closeSummary, setCloseSummary] = useState<CashShiftSummary | null>(null);
    const [isLoadingSummary, setIsLoadingSummary] = useState(false);
    // Melhorias no fluxo de Caixa (2026-08-28): breakdown por cédula/moeda
    // em vez de um único total — chave é o valor da denominação em string
    // (ex. "50"), valor é a quantidade digitada. O total nunca é digitado
    // direto, sempre somado a partir daqui (sumDenominationBreakdown).
    const [closingCashBreakdown, setClosingCashBreakdown] = useState<Record<string, string>>({});
    const [isClosingShift, setIsClosingShift] = useState(false);

    // Task 1 (varredura 2026-08-30): diferença acima da tolerância
    // configurada (stores.config.cash_shift_max_tolerance) exige aprovação
    // de um supervisor antes de fechar o turno — a RPC já recusava sem
    // isso, mas nada aqui nunca mandava a tolerância nem tratava a recusa.
    const [pendingApproval, setPendingApproval] = useState<{ expected: number; counted: number; difference: number } | null>(null);
    const [supervisorEmail, setSupervisorEmail] = useState('');
    const [supervisorPassword, setSupervisorPassword] = useState('');
    const [isVerifyingSupervisor, setIsVerifyingSupervisor] = useState(false);

    // Subprojeto 2 (2026-08-25): histórico de turnos passados, consultável a
    // qualquer momento — não só na hora de fechar (achado real: o número da
    // diferença sumia assim que o turno era fechado, sem jeito de conferir
    // depois). `historySummary` reaproveita a MESMA function/tipo que a tela
    // de fechamento já usa (fetchCashShiftSummary) — não duplica lógica de
    // cálculo, só chama de novo pro turno escolhido na lista.
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [shiftsHistory, setShiftsHistory] = useState<CashShiftHistoryRow[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [historySummary, setHistorySummary] = useState<CashShiftSummary | null>(null);
    const [isLoadingHistorySummary, setIsLoadingHistorySummary] = useState(false);

    // Task 3 (varredura 2026-08-30): Tasks 1/2 já gravam eventos em
    // `cash_shift_audit_events` (sangria acima da tolerância + item
    // cancelado) — sem esta tela, ninguém consegue VER esses eventos, só
    // ficam no banco. `fetchCashShiftAudit(storeId, null, null, 50)` traz os
    // últimos 50 eventos da LOJA inteira (não só do turno atual), já
    // ordenados mais recentes primeiro pela própria RPC.
    const [auditEvents, setAuditEvents] = useState<CashShiftAuditEvent[]>([]);
    const [showAuditModal, setShowAuditModal] = useState(false);
    const [isLoadingAudit, setIsLoadingAudit] = useState(false);

    const loadAuditEvents = async () => {
        setIsLoadingAudit(true);
        try {
            const events = await fetchCashShiftAudit(storeId, null, null, 50);
            setAuditEvents(events);
        } finally {
            setIsLoadingAudit(false);
        }
    };

    // Relógio "agora" só pra recalcular o "há quanto tempo espera" da fila
    // periodicamente sem precisar de novo fetch — mesmo padrão do `now` em
    // KdsView (indicador de atraso).
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const tick = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(tick);
    }, []);

    // Migration 062 ("caixa por operador"): "o turno" agora é sempre O MEU
    // turno (deste `loggedUser` logado nesta sessão) — pode haver outros
    // operadores com turno aberto ao mesmo tempo na mesma loja, e esta
    // tela não precisa (nem deve) saber disso pra decidir se mostra "abrir
    // caixa" ou a fila. Mesmo critério de `handleOpenShift` abaixo pra
    // conta universal (sem linha em store_users, manda null).
    const loadShift = async () => {
        const s = await fetchOpenCashShift(storeId, loggedUser.role === 'universal' ? null : loggedUser.id);
        setShift(s);
    };

    const loadQueue = async () => {
        const [t, o, c] = await Promise.all([
            fetchTables(storeId),
            fetchActiveOrdersForTables(storeId),
            fetchCounterOrders(storeId),
        ]);
        setTables(t);
        setActiveOrders(o);
        setCounterOrders(c);
    };

    useEffect(() => {
        loadShift();
        loadQueue();
        // Mesmos dois canais de ping que TablesView/CounterView já assinam
        // (nenhuma tabela/canal novo) — qualquer mudança em mesa ou pedido
        // desta loja atualiza a fila e o estado do turno (ex.: outro
        // operador abriu/fechou o caixa em outro aparelho).
        const channel = supabase.channel(`caixa_queue_${storeId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'table_change_pings', filter: `store_id=eq.${storeId}` }, () => { loadQueue(); loadShift(); })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'order_change_pings', filter: `store_id=eq.${storeId}` }, () => { loadQueue(); loadShift(); })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [storeId]);

    const handleOpenShift = async () => {
        const value = parseFloat(openingFloat.replace(',', '.'));
        if (isNaN(value) || value < 0) {
            toast.error('Informe um fundo de troco válido.');
            return;
        }
        setIsOpeningShift(true);
        try {
            // Critical #2 da revisão final (ver supabase/migrations/052_frente_de_caixa_criticos.sql):
            // conta universal não tem linha em store_users, então loggedUser.id
            // não é um id válido pra cash_shifts.operator_user_id — manda null
            // e guarda a identificação legível em notes.
            const isUniversal = loggedUser.role === 'universal';
            const result = await openCashShift(
                storeId,
                isUniversal ? null : loggedUser.id,
                value,
                isUniversal ? `Aberto pela conta universal: ${loggedUser.name} (${loggedUser.email})` : undefined,
            );
            if (result.success) {
                toast.success('Caixa aberto.');
                setOpeningFloat('');
                await loadShift();
            } else {
                // open_cash_shift_secure recusa (não exception) quando já
                // existe turno aberto — mensagem pronta do servidor, ex.
                // outro aparelho abriu entre o load desta tela e o clique.
                toast.error(result.message || 'Não foi possível abrir o caixa.');
                await loadShift();
            }
        } catch (e: any) {
            toast.error('Erro ao abrir o caixa: ' + e.message);
        } finally {
            setIsOpeningShift(false);
        }
    };

    const handleOpenMovementModal = (type: 'sangria' | 'suprimento') => {
        setMovementType(type);
        setMovementAmount('');
        setMovementReason('');
        setShowMovementModal(true);
    };

    const handleSubmitMovement = async () => {
        if (!shift) return;
        const value = parseFloat(movementAmount.replace(',', '.'));
        if (isNaN(value) || value <= 0) {
            toast.error('Informe um valor maior que zero.');
            return;
        }
        if (!movementReason.trim()) {
            toast.error('Motivo é obrigatório.');
            return;
        }
        setIsSubmittingMovement(true);
        try {
            const result = await registerCashMovement(
                shift.id,
                movementType,
                value,
                movementReason.trim(),
                loggedUser.name,
                movementType === 'sangria' ? (store.config?.cash_shift_sangria_alert_threshold || undefined) : undefined,
            );
            if (result.success) {
                toast.success(movementType === 'sangria' ? 'Sangria registrada.' : 'Suprimento registrado.');
                setShowMovementModal(false);
            } else {
                toast.error(result.message || 'Não foi possível registrar a movimentação.');
            }
        } catch (e: any) {
            toast.error('Erro ao registrar movimentação: ' + e.message);
        } finally {
            setIsSubmittingMovement(false);
        }
    };

    // Abre a tela de fechamento já carregando o resumo real do turno
    // (fetch_cash_shift_summary_secure) — a diferença em si é recalculada
    // ao vivo no client (useMemo abaixo) conforme o operador digita o valor
    // conferido, sem round-trip novo a cada tecla.
    const handleCloseShiftClick = async () => {
        if (!shift) return;
        setShowCloseModal(true);
        setClosingCashBreakdown({});
        setIsLoadingSummary(true);
        try {
            const summary = await fetchCashShiftSummary(shift.id);
            setCloseSummary(summary);
            if (!summary) toast.error('Não foi possível carregar o resumo do turno.');
        } finally {
            setIsLoadingSummary(false);
        }
    };

    const handleOpenHistory = async () => {
        setShowHistoryModal(true);
        setIsLoadingHistory(true);
        try {
            const rows = await fetchCashShiftsHistory(storeId);
            setShiftsHistory(rows);
        } finally {
            setIsLoadingHistory(false);
        }
    };

    const handleViewHistorySummary = async (row: CashShiftHistoryRow) => {
        setIsLoadingHistorySummary(true);
        try {
            const summary = await fetchCashShiftSummary(row.id);
            setHistorySummary(summary);
            if (!summary) toast.error('Não foi possível carregar o resumo deste turno.');
        } finally {
            setIsLoadingHistorySummary(false);
        }
    };

    // Computado uma vez, referenciado nos dois estados de retorno abaixo
    // (sem turno / com turno) — a lista/detalhe de histórico faz sentido em
    // qualquer um dos dois, então em vez de duplicar o JSX dos dois modais
    // em cada branch, uma variável só.
    const historyModals = (
        <>
            <Modal
                isOpen={showHistoryModal}
                onClose={() => { setShowHistoryModal(false); setHistorySummary(null); }}
                title="Histórico de Turnos"
                variant="sheet"
            >
                {historySummary || isLoadingHistorySummary ? (
                    <div className="space-y-4">
                        <button
                            type="button"
                            onClick={() => setHistorySummary(null)}
                            className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--brand)] u-motion flex items-center gap-1"
                        >
                            <ArrowRight size={12} className="rotate-180" /> Voltar pra lista
                        </button>
                        {isLoadingHistorySummary ? (
                            <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
                                <RefreshCw size={24} className="animate-spin" />
                            </div>
                        ) : historySummary && (
                            <div className="space-y-5">
                                <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3 text-sm">
                                    <p className="text-[var(--text-muted)]">
                                        {new Date(historySummary.shift.opened_at).toLocaleString('pt-BR')}
                                        {historySummary.shift.closed_at && ` — ${new Date(historySummary.shift.closed_at).toLocaleString('pt-BR')}`}
                                    </p>
                                    {historySummary.shift.notes && (
                                        <p className="text-[var(--text-muted)] mt-1">{historySummary.shift.notes}</p>
                                    )}
                                </div>
                                <div className="space-y-1.5">
                                    <h4 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">
                                        Total por forma de pagamento
                                    </h4>
                                    {Object.keys(historySummary.totals_by_method).length === 0 ? (
                                        <p className="text-sm text-[var(--text-muted)]">Nenhum pagamento registrado neste turno.</p>
                                    ) : (
                                        <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
                                            {Object.entries(historySummary.totals_by_method).map(([method, total]) => (
                                                <div key={method} className="flex items-center justify-between px-3 py-2 text-sm">
                                                    <span className="text-[var(--text)]">{getPaymentMethodLabel(method)}</span>
                                                    <span className="font-mono font-bold text-[var(--text)]">R$ {formatBRL(total)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                {Object.keys(historySummary.totals_by_brand).length > 0 && (
                                    <div className="space-y-1.5">
                                        <h4 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">
                                            Total por bandeira
                                        </h4>
                                        <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
                                            {Object.entries(historySummary.totals_by_brand).map(([brand, total]) => (
                                                <div key={brand} className="flex items-center justify-between px-3 py-2 text-sm">
                                                    <span className="text-[var(--text)]">{getCardBrandLabel(brand)}</span>
                                                    <span className="font-mono font-bold text-[var(--text)]">R$ {formatBRL(total)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div className="rounded-xl border border-[var(--border)] px-3 py-2">
                                        <p className="text-[var(--text-muted)] flex items-center gap-1"><TrendingDown size={12} /> Sangrias</p>
                                        <p className="font-mono font-bold text-[var(--text)]">R$ {formatBRL(historySummary.total_sangria)}</p>
                                    </div>
                                    <div className="rounded-xl border border-[var(--border)] px-3 py-2">
                                        <p className="text-[var(--text-muted)] flex items-center gap-1"><TrendingUp size={12} /> Suprimentos</p>
                                        <p className="font-mono font-bold text-[var(--text)]">R$ {formatBRL(historySummary.total_suprimento)}</p>
                                    </div>
                                </div>
                                <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3 flex items-center justify-between">
                                    <span className="text-sm font-bold text-[var(--text)]">Esperado em dinheiro</span>
                                    <span className="font-mono font-bold text-lg text-[var(--text)]">R$ {formatBRL(historySummary.expected_cash)}</span>
                                </div>
                                {historySummary.closing_counted_cash !== null && (
                                    <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3 flex items-center justify-between">
                                        <span className="text-sm font-bold text-[var(--text)]">Contado na gaveta</span>
                                        <span className="font-mono font-bold text-lg text-[var(--text)]">R$ {formatBRL(historySummary.closing_counted_cash)}</span>
                                    </div>
                                )}
                                {historySummary.difference !== null && (
                                    <div className={`rounded-xl px-4 py-3 flex items-center justify-between border-2 ${
                                        Math.abs(historySummary.difference) < 0.005
                                            ? 'border-[var(--ok)]/40 bg-[var(--ok)]/10'
                                            : historySummary.difference > 0
                                                ? 'border-[var(--info)]/40 bg-[var(--info)]/10'
                                                : 'border-[var(--err)]/40 bg-[var(--err)]/10'
                                    }`}>
                                        <span className="text-sm font-bold text-[var(--text)]">
                                            {Math.abs(historySummary.difference) < 0.005 ? 'Conferiu certinho' : historySummary.difference > 0 ? 'Sobrou' : 'Faltou'}
                                        </span>
                                        <span className="font-mono font-bold text-lg text-[var(--text)]">
                                            {historySummary.difference > 0 ? '+' : ''}R$ {formatBRL(historySummary.difference)}
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {isLoadingHistory ? (
                            <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
                                <RefreshCw size={24} className="animate-spin" />
                            </div>
                        ) : shiftsHistory.length === 0 ? (
                            <p className="text-sm text-[var(--text-muted)] text-center py-8">Nenhum turno registrado ainda.</p>
                        ) : (
                            shiftsHistory.map(row => (
                                <button
                                    key={row.id}
                                    type="button"
                                    disabled={row.status !== 'closed'}
                                    onClick={() => handleViewHistorySummary(row)}
                                    className="w-full flex items-center justify-between gap-3 p-3 rounded-xl border border-[var(--border)] hover:border-[var(--brand)] u-motion u-press-sm text-left disabled:opacity-60 disabled:cursor-default"
                                >
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-[var(--text)]">
                                            {new Date(row.opened_at).toLocaleDateString('pt-BR')} · {new Date(row.opened_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                        <p className="text-xs text-[var(--text-muted)] truncate">
                                            {row.operator_name || row.notes || 'Operador não identificado'}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {row.status === 'open' ? (
                                            <Badge color="bg-[var(--info)]/10 text-[var(--info)]">Em andamento</Badge>
                                        ) : row.difference !== null && Math.abs(row.difference) >= 0.005 ? (
                                            <Badge color={row.difference > 0 ? 'bg-[var(--info)]/10 text-[var(--info)]' : 'bg-[var(--err)]/10 text-[var(--err)]'}>
                                                {row.difference > 0 ? '+' : ''}R$ {formatBRL(row.difference)}
                                            </Badge>
                                        ) : (
                                            <Badge color="bg-[var(--ok)]/10 text-[var(--ok)]">Conferiu</Badge>
                                        )}
                                        {row.status === 'closed' && <ArrowRight size={14} className="text-[var(--text-muted)]" />}
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                )}
            </Modal>
            <Modal
                isOpen={showAuditModal}
                onClose={() => setShowAuditModal(false)}
                title="Trilha de Auditoria"
                size="lg"
            >
                {isLoadingAudit ? (
                    <div className="text-center py-10 text-[var(--text-muted)] text-sm">Carregando...</div>
                ) : auditEvents.length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)] text-center py-6">Nenhum evento registrado ainda.</p>
                ) : (
                    <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                        {auditEvents.map(ev => (
                            <div key={ev.id} className="flex items-center justify-between gap-3 bg-[var(--surface-2)] rounded-lg px-3 py-2">
                                <div className="min-w-0">
                                    <p className="text-sm text-[var(--text)]">
                                        <span className="font-bold">{ev.operator_name}</span>
                                        {' — '}
                                        {ev.event_type === 'sangria_grande'
                                            ? `Sangria de R$ ${formatBRL(Number(ev.details?.valor) || 0)} (${ev.details?.motivo || 'sem motivo'})`
                                            : ev.event_type === 'tolerancia_excedida'
                                            // Achado #1 da revisão final de branch (2026-08-30): este
                                            // event_type (migration 068) caía no branch de
                                            // "Cancelou item" por engano — mostrava um operador como
                                            // tendo cancelado algo que nunca existiu.
                                            ? `Diferença de R$ ${formatBRL(Math.abs(Number(ev.details?.diferenca) || 0))} (${Number(ev.details?.diferenca) >= 0 ? 'sobra' : 'falta'}) acima da tolerância de R$ ${formatBRL(Number(ev.details?.tolerancia) || 0)} ao fechar o caixa`
                                            : `Cancelou "${ev.details?.produto || 'item'}"`}
                                    </p>
                                    <p className="text-[11px] text-[var(--text-muted)]">{new Date(ev.created_at).toLocaleString('pt-BR')}</p>
                                </div>
                                <Badge color={
                                    ev.event_type === 'sangria_grande' ? 'bg-[var(--warn)]/10 text-[var(--warn)]'
                                    : ev.event_type === 'tolerancia_excedida' ? 'bg-[var(--warn)]/10 text-[var(--warn)]'
                                    : 'bg-[var(--err)]/10 text-[var(--err)]'
                                }>
                                    {ev.event_type === 'sangria_grande' ? 'Sangria' : ev.event_type === 'tolerancia_excedida' ? 'Tolerância excedida' : 'Cancelamento'}
                                </Badge>
                            </div>
                        ))}
                    </div>
                )}
            </Modal>
        </>
    );

    const closingCountedValue = useMemo(() => sumDenominationBreakdown(closingCashBreakdown), [closingCashBreakdown]);

    const liveDifference = useMemo(() => {
        if (!closeSummary) return null;
        return closingCountedValue - closeSummary.expected_cash;
    }, [closingCountedValue, closeSummary]);

    const handleConfirmCloseShift = async (approvedByUserId?: string) => {
        if (!shift) return;
        setIsClosingShift(true);
        try {
            const breakdownAsNumbers: Record<string, number> = {};
            CASH_DENOMINATIONS.forEach((value) => {
                const count = parseInt(closingCashBreakdown[String(value)] || '0', 10);
                if (count > 0) breakdownAsNumbers[String(value)] = count;
            });
            const maxTolerance = store.config?.cash_shift_max_tolerance || undefined;
            const result = await closeCashShift(shift.id, closingCountedValue, breakdownAsNumbers, maxTolerance, approvedByUserId);
            if (result.success) {
                toast.success('Caixa fechado.');
                // Contagem cega (Task 4): quem não viu o esperado durante a
                // contagem vê agora, num modal de resultado — nunca escondido
                // pra sempre, só depois de confirmar.
                if (!canSeeExpectedBeforeClosing && result.expected_cash !== undefined && result.difference !== undefined) {
                    setClosedResultDifference({ expected: result.expected_cash, counted: closingCountedValue, difference: result.difference });
                }
                setPendingApproval(null);
                setShowCloseModal(false);
                setCloseSummary(null);
                // Volta ao estado "sem turno aberto" (mesma tela da Task 3).
                setShift(null);
            } else if (result.requires_approval) {
                // Achado da varredura (2026-08-30): a RPC já recusava fechar com
                // diferença acima da tolerância, mas nada aqui nunca tratava
                // esse retorno -- ficava só o erro genérico. Abre o modal de
                // aprovação em vez de exibir o texto de erro cru.
                setPendingApproval({
                    expected: result.expected_cash ?? 0,
                    counted: closingCountedValue,
                    difference: result.difference ?? 0,
                });
            } else {
                toast.error(result.message || 'Não foi possível fechar o caixa.');
                await loadShift();
            }
        } catch (e: any) {
            toast.error('Erro ao fechar o caixa: ' + e.message);
        } finally {
            setIsClosingShift(false);
        }
    };

    const handleApproveAndClose = async () => {
        if (!supervisorEmail.trim() || !supervisorPassword) {
            toast.error('Informe o e-mail e a senha do supervisor.');
            return;
        }
        setIsVerifyingSupervisor(true);
        try {
            const verify = await verifyCashSupervisor(store.id, supervisorEmail.trim(), supervisorPassword);
            if (!verify.success || !verify.user_id) {
                toast.error(verify.message || 'Supervisor não encontrado ou sem permissão.');
                return;
            }
            setSupervisorEmail('');
            setSupervisorPassword('');
            await handleConfirmCloseShift(verify.user_id);
        } finally {
            setIsVerifyingSupervisor(false);
        }
    };

    // Fila consolidada — mesas `waiting_bill` + pedidos de balcão aguardando
    // pagamento (mesmo critério que CounterView já usa pra oferecer o botão
    // "Entregar"/"Aguardando o caixa": qualquer pedido de balcão que não
    // esteja mais PENDING já pode ser recebido). Ordenada por tempo de
    // espera, mais antigo primeiro.
    const queueItems = useMemo(() => {
        const tableItems = tables
            .filter(t => t.status === TableStatus.WAITING_BILL)
            .map(t => {
                const tableOrders = activeOrders.filter(o => o.table_id === t.id);
                const items = tableOrders.flatMap(o => (o.order_items || []).filter(i => i.status !== 'canceled'));
                const subtotal = items.reduce((s, i) => s + i.price_at_time * i.quantity, 0);
                const total = calculateOrderTotal(subtotal, !!store.config?.charge_service_fee, serviceFeeRate, t.service_fee_removed);
                // Sem coluna dedicada de "pediu a conta às..." (fora de
                // escopo desta task — ver relatório): usa o pedido mais
                // recente lançado na mesa como proxy de última atividade,
                // a melhor aproximação disponível sem query/schema novos.
                const waitingSince = tableOrders.reduce((latest, o) => {
                    const ts = new Date(o.created_at).getTime();
                    return ts > latest ? ts : latest;
                }, 0) || now;
                return {
                    key: `table-${t.id}`,
                    kind: 'table' as const,
                    id: t.id,
                    label: `Mesa ${t.number}`,
                    sublabel: t.current_host_name || undefined,
                    total,
                    waitingSince,
                };
            });

        const counterItems = counterOrders
            .filter(o => o.status !== OrderStatus.PENDING)
            .map(o => {
                const total = (o.order_items || [])
                    .filter(i => i.status !== 'canceled')
                    .reduce((s, i) => s + i.price_at_time * i.quantity, 0);
                return {
                    key: `counter-${o.id}`,
                    kind: 'counter' as const,
                    id: o.id,
                    label: `Balcão · ${o.customer_name || 'Cliente'}`,
                    sublabel: `#${o.id.slice(0, 4)}`,
                    total,
                    waitingSince: new Date(o.created_at).getTime(),
                };
            });

        return [...tableItems, ...counterItems].sort((a, b) => a.waitingSince - b.waitingSince);
    }, [tables, activeOrders, counterOrders, store, serviceFeeRate]);

    // Fase 2, Task 4 (plano "Fora do Cardápio"): achado real da auditoria —
    // a fila acima só mostra mesa em WAITING_BILL. Numa loja sem
    // acompanhamento de pedido (direct_print), o Caixa é o único humano
    // olhando pra tela e não tinha NENHUMA visão de quais mesas estão
    // ocupadas comendo agora, só das que já pediram a conta. Mesma fonte de
    // dado que queueItems (tables/activeOrders), sem query nova.
    const occupiedTables = useMemo(() => {
        return tables
            .filter(t => t.status === TableStatus.OCCUPIED || t.status === TableStatus.WAITING_BILL)
            .map(t => {
                const tableOrders = activeOrders.filter(o => o.table_id === t.id);
                const items = tableOrders.flatMap(o => (o.order_items || []).filter(i => i.status !== 'canceled'));
                const subtotal = items.reduce((s, i) => s + i.price_at_time * i.quantity, 0);
                const total = calculateOrderTotal(subtotal, !!store.config?.charge_service_fee, serviceFeeRate, t.service_fee_removed);
                const occupiedSince = tableOrders.reduce((earliest, o) => {
                    const ts = new Date(o.created_at).getTime();
                    return earliest === 0 || ts < earliest ? ts : earliest;
                }, 0) || now;
                const minutesOccupied = Math.max(0, Math.round((now - occupiedSince) / 60000));

                // Fase 3, Task 8: numa loja `direct_print` (sem KDS), o caixa
                // não tem nenhuma outra tela mostrando "o que ainda tá pra
                // preparar" por mesa — reaproveita o MESMO dedupe local que
                // `CaixaPrintStation` usa (`wasKitchenTicketPrinted`), então só
                // aparece aqui o que esta sessão de caixa ainda não confirmou
                // impresso. Some sozinho da lista assim que a reconciliação em
                // segundo plano (ou um reimprimir manual) marca o item.
                const pendingPrintItems = orderFlow === 'direct_print'
                    ? items
                        .filter(i => (i.product?.destination === 'kitchen' || i.product?.destination === 'bar'))
                        .filter(i => !wasKitchenTicketPrinted(storeId, i.product!.destination === 'bar' ? 'bar' : 'kitchen', i.id))
                        .map(i => {
                            const { client, observation } = parseItemNote(i.notes || '');
                            return {
                                id: i.id,
                                orderId: i.order_id,
                                productName: i.product?.name || 'Produto indisponível',
                                quantity: i.quantity,
                                destination: (i.product!.destination === 'bar' ? 'bar' : 'kitchen') as 'kitchen' | 'bar',
                                addons: (i.selected_options || []).map(o => o.name).join(', ') || undefined,
                                observation: observation || undefined,
                                client,
                            };
                        })
                    : [];

                return {
                    id: t.id,
                    number: t.number,
                    hostName: t.current_host_name || undefined,
                    total,
                    minutesOccupied,
                    isWaitingBill: t.status === TableStatus.WAITING_BILL,
                    pendingPrintItems,
                };
            })
            .sort((a, b) => b.minutesOccupied - a.minutesOccupied);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- printedRefreshNonce só existe pra forçar recálculo (wasKitchenTicketPrinted lê localStorage, não é reativo sozinho).
    }, [tables, activeOrders, store, serviceFeeRate, now, orderFlow, printedRefreshNonce]);

    const rushMode = rushModeManual ?? (occupiedTables.length >= RUSH_THRESHOLD);

    const formatWaitingLabel = (waitingSince: number): string => {
        const minutes = Math.max(0, Math.round((now - waitingSince) / 60000));
        if (minutes < 1) return 'agora mesmo';
        if (minutes < 60) return `há ${minutes} min`;
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        return `há ${hours}h${rest > 0 ? ` ${rest}min` : ''}`;
    };

    // Fase 3, Task 8: mesmo mecanismo de `handleManualReprint` em TablesView
    // ("Pedidos do Dia") — reimprime UM item pendente e marca no dedupe
    // local, fazendo-o sumir da lista de "aguardando preparo" desta mesa.
    const handleReprintPending = async (item: { id: string; orderId: string; tableNumber: number | string; productName: string; quantity: number; destination: 'kitchen' | 'bar'; addons?: string; observation?: string; client?: string | null }) => {
        if (!canReprintPending || reprintingPendingIds.has(item.id)) return;
        setReprintingPendingIds(prev => new Set(prev).add(item.id));
        try {
            const ok = await printPendingKitchenTicket({
                storeId,
                storeName: store.name,
                paperWidthMm: store.config?.printer_paper_width_mm,
                destination: item.destination,
                itemId: item.id,
                orderId: item.orderId,
                tableNumber: item.tableNumber,
                quantity: item.quantity,
                productName: item.productName,
                addons: item.addons,
                observation: item.observation,
                client: item.client,
            });
            if (ok) {
                toast.success('Reimpresso com sucesso.');
                setPrintedRefreshNonce(n => n + 1);
            } else {
                toast.error('A reimpressão falhou. Verifique a impressora.');
            }
        } finally {
            setReprintingPendingIds(prev => {
                const copy = new Set(prev);
                copy.delete(item.id);
                return copy;
            });
        }
    };

    // Contagem cega (Task 4): resultado só mostrado DEPOIS de confirmar o
    // fechamento, pra quem não tem `supervisiona_caixa` e a loja ligou a
    // config — nunca escondido pra sempre. Extraído como variável (em vez de
    // JSX inline lá embaixo) porque `handleConfirmCloseShift` chama
    // `setShift(null)` no mesmo fechamento que abre este modal — sem isso o
    // componente cai direto no `if (!shift)` abaixo (um `return` totalmente
    // separado do que tem a modal), e o resultado nunca chegava a aparecer
    // (achado ao testar ao vivo, não só revisão de código).
    const closedResultModal = (
        <Modal
            isOpen={!!closedResultDifference}
            onClose={() => setClosedResultDifference(null)}
            title="Resultado do fechamento"
            size="sm"
        >
            {closedResultDifference && (
                <div className="space-y-4">
                    <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3 flex items-center justify-between">
                        <span className="text-sm font-bold text-[var(--text)]">Esperado em dinheiro na gaveta</span>
                        <span className="font-mono font-bold text-lg text-[var(--text)]">R$ {formatBRL(closedResultDifference.expected)}</span>
                    </div>
                    <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3 flex items-center justify-between">
                        <span className="text-sm font-bold text-[var(--text)]">Total contado</span>
                        <span className="font-mono font-bold text-lg text-[var(--text)]">R$ {formatBRL(closedResultDifference.counted)}</span>
                    </div>
                    <div className={`rounded-xl px-4 py-3 flex items-center justify-between border-2 ${
                        Math.abs(closedResultDifference.difference) < 0.005
                            ? 'border-[var(--ok)]/40 bg-[var(--ok)]/10'
                            : closedResultDifference.difference > 0
                                ? 'border-[var(--info)]/40 bg-[var(--info)]/10'
                                : 'border-[var(--err)]/40 bg-[var(--err)]/10'
                    }`}>
                        <span className="text-sm font-bold text-[var(--text)]">
                            {Math.abs(closedResultDifference.difference) < 0.005 ? 'Confere certinho' : closedResultDifference.difference > 0 ? 'Sobra' : 'Falta'}
                        </span>
                        <span className="font-mono font-bold text-lg text-[var(--text)]">
                            {closedResultDifference.difference > 0 ? '+' : ''}R$ {formatBRL(closedResultDifference.difference)}
                        </span>
                    </div>
                    <Button className="w-full" onClick={() => setClosedResultDifference(null)}>
                        Ok
                    </Button>
                </div>
            )}
        </Modal>
    );

    // Loading inicial do turno — evita piscar a tela de "abrir caixa" por um
    // frame antes de saber se já existe um turno aberto.
    if (shift === undefined) {
        return (
            <div className="flex items-center justify-center py-32 text-[var(--text-muted)]">
                <RefreshCw size={28} className="animate-spin" />
            </div>
        );
    }

    // Sem turno aberto — Passo 2 do brief: destaque total, é o primeiro
    // lugar que o operador vê ao entrar.
    if (!shift) {
        return (
            <div className="max-w-md mx-auto py-8">
                <Card className="p-6 text-center border-2 border-[var(--warn)]/30 bg-[var(--warn)]/5">
                    <Wallet size={40} className="mx-auto mb-3 text-[var(--warn)]" />
                    <h3 className="text-lg font-bold text-[var(--text)] mb-1">Nenhum turno de caixa aberto</h3>
                    <p className="text-sm text-[var(--text-muted)] mb-6">
                        Abra o caixa informando o fundo de troco (dinheiro físico já na gaveta) pra começar a
                        receber pagamentos.
                    </p>
                    <div className="text-left space-y-3">
                        <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">
                            Fundo de troco
                        </label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] font-bold">R$</span>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-[var(--border)] focus:border-[var(--brand)] focus:outline-none font-bold text-lg"
                                placeholder="0.00"
                                value={openingFloat}
                                onChange={e => setOpeningFloat(e.target.value)}
                            />
                        </div>
                        {/* Fase 1, Task 3 (plano "Fora do Cardápio"): o Master
                            Admin já tinha esse aviso no cadastro da loja, mas só
                            lá — nunca no dia a dia, quando quem abre o turno de
                            verdade é o operador. Não bloqueia abrir o caixa
                            (mesma filosofia do original), só avisa. */}
                        {orderFlow === 'direct_print' && (
                            <div className="text-left rounded-xl border border-[var(--warn)]/30 bg-[var(--warn)]/5 p-3 flex items-start gap-2">
                                <AlertCircle size={16} className="text-[var(--warn)] shrink-0 mt-0.5" />
                                <p className="text-xs text-[var(--text)]">
                                    Esta loja envia pedido direto pra impressão, sem tela de cozinha. Antes de abrir,
                                    confira que a impressora está funcionando — use &ldquo;Testar Impressão&rdquo;
                                    logo abaixo assim que o caixa abrir.
                                </p>
                            </div>
                        )}
                        <Button
                            onClick={handleOpenShift}
                            isLoading={isOpeningShift}
                            className="w-full h-12 text-lg font-bold bg-[var(--ok)] hover:bg-[var(--ok)]/90 text-white"
                        >
                            <Unlock size={20} className="mr-2" /> Abrir Caixa
                        </Button>
                    </div>
                </Card>
                <div className="flex items-center justify-center gap-4 mt-3">
                    <button
                        type="button"
                        onClick={handleOpenHistory}
                        className="text-center text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--brand)] u-motion py-2"
                    >
                        Ver histórico de turnos
                    </button>
                    <button
                        type="button"
                        onClick={() => { setShowAuditModal(true); loadAuditEvents(); }}
                        className="text-center text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--brand)] u-motion py-2"
                    >
                        Ver Auditoria
                    </button>
                </div>
                {closedResultModal}
                {historyModals}
            </div>
        );
    }

    // Turno aberto — Passo 1: fila consolidada; resumo + Fechar Caixa.
    return (
        <div className="space-y-6">
            <Card className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-[var(--ok)]/10 flex items-center justify-center text-[var(--ok)] shrink-0">
                        <Wallet size={20} />
                    </div>
                    <div>
                        <p className="text-sm font-bold text-[var(--text)]">
                            Caixa aberto desde {new Date(shift.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                            Fundo de troco: R$ {formatBRL(shift.opening_float)}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <Button onClick={() => handleOpenMovementModal('sangria')} variant="outline" className="shrink-0">
                        <TrendingDown size={16} className="mr-2" /> Sangria
                    </Button>
                    <Button onClick={() => handleOpenMovementModal('suprimento')} variant="outline" className="shrink-0">
                        <TrendingUp size={16} className="mr-2" /> Suprimento
                    </Button>
                    <Button onClick={handleCloseShiftClick} variant="outline" className="shrink-0">
                        <Lock size={16} className="mr-2" /> Fechar Caixa
                    </Button>
                    <Button onClick={handleOpenHistory} variant="ghost" className="shrink-0" title="Ver histórico de turnos">
                        <History size={16} />
                    </Button>
                    <Button onClick={() => { setShowAuditModal(true); loadAuditEvents(); }} variant="ghost" className="shrink-0" title="Ver Auditoria">
                        <Shield size={16} />
                    </Button>
                </div>
            </Card>

            {occupiedTables.length > 0 && (
                <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-wider">
                            Mesas ocupadas ({occupiedTables.length})
                        </h3>
                        <button
                            onClick={() => setRushModeManual(prev => prev === null ? !rushMode : !prev)}
                            className={`text-[11px] font-bold px-2.5 py-1 rounded-full border u-motion u-press-sm ${rushMode ? 'border-[var(--ember,var(--warn))]/40 bg-[var(--warn)]/10 text-[var(--warn)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}
                            title="Simplifica a visão sob carga alta — liga sozinho a partir de 6 mesas"
                        >
                            {rushMode ? '⚡ Modo Rush ligado' : 'Modo Rush'}
                        </button>
                    </div>
                    <div className={`grid gap-2 ${rushMode ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'}`}>
                        {occupiedTables.map(t => {
                            const colorClass = t.minutesOccupied >= 60
                                ? 'border-[var(--err)]/40 bg-[var(--err)]/5 text-[var(--err)]'
                                : t.minutesOccupied >= 30
                                    ? 'border-[var(--warn)]/40 bg-[var(--warn)]/5 text-[var(--warn)]'
                                    : 'border-[var(--ok)]/40 bg-[var(--ok)]/5 text-[var(--ok)]';
                            if (rushMode) {
                                return (
                                    <button
                                        key={t.id}
                                        onClick={() => onOpenTablePayment(t.id)}
                                        className={`text-center p-2 rounded-xl border u-motion u-press-sm ${colorClass}`}
                                    >
                                        <span className="block font-bold text-[var(--text)]">Mesa {t.number}</span>
                                        <span className="block text-xs font-bold text-[var(--text)]">R$ {formatBRL(t.total)}</span>
                                    </button>
                                );
                            }
                            return (
                                <div key={t.id} className={`rounded-xl border overflow-hidden ${colorClass}`}>
                                    <button
                                        onClick={() => onOpenTablePayment(t.id)}
                                        className="w-full text-left p-3 u-motion u-press-sm"
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-[var(--text)]">Mesa {t.number}</span>
                                            <span className="text-[11px] font-mono">{t.minutesOccupied}min</span>
                                        </div>
                                        <p className="text-xs text-[var(--text-muted)] truncate">{t.hostName || '—'}</p>
                                        <p className="text-sm font-bold text-[var(--text)] mt-1">R$ {formatBRL(t.total)}</p>
                                        {t.isWaitingBill && <p className="text-[10px] font-bold uppercase mt-0.5">Aguardando pagamento</p>}
                                    </button>
                                    {/* Fase 3, Task 8: "a sala de controle também é a cozinha" — só
                                        existe em loja `direct_print` (sem KDS); dá o mesmo "eu sei o
                                        que tá sendo preparado agora" que uma loja com KDS já tem. */}
                                    {t.pendingPrintItems.length > 0 && (
                                        <div className="border-t border-current/20 bg-[var(--surface)]/60 px-3 py-2 space-y-1.5">
                                            <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">
                                                {t.pendingPrintItems.length === 1 ? '1 item aguardando preparo' : `${t.pendingPrintItems.length} itens aguardando preparo`}
                                            </p>
                                            {t.pendingPrintItems.map(item => (
                                                <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                                                    <span className="text-[var(--text)] truncate">{item.quantity}x {item.productName}</span>
                                                    {canReprintPending && (
                                                        <button
                                                            type="button"
                                                            disabled={reprintingPendingIds.has(item.id)}
                                                            onClick={() => handleReprintPending({ ...item, tableNumber: t.number })}
                                                            className="shrink-0 p-1 rounded-full hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-50"
                                                            title="Reimprimir"
                                                        >
                                                            <RotateCcw size={12} className={reprintingPendingIds.has(item.id) ? 'animate-spin' : ''} />
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <div>
                <h3 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-wider mb-3">
                    Aguardando pagamento {queueItems.length > 0 && `(${queueItems.length})`}
                </h3>
                {queueItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)] bg-[var(--surface)] rounded-[var(--r-lg)] border-2 border-dashed border-[var(--border)]">
                        <CheckCircle className="mb-3 h-14 w-14 opacity-20" />
                        <p className="text-base font-medium">Nenhum recebível pendente</p>
                        <p className="text-xs">Mesas que pedirem a conta e vendas de balcão aparecem aqui.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <AnimatePresence>
                        {queueItems.map(item => (
                            <motion.button
                                key={item.key}
                                layout
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                transition={SPRING_TAP}
                                onClick={() => item.kind === 'table' ? onOpenTablePayment(item.id) : onOpenCounterPayment(item.id)}
                                className="w-full flex items-center justify-between gap-3 p-4 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-lg)] hover:border-[var(--brand)] u-motion u-press-sm text-left"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="h-9 w-9 rounded-full bg-[var(--warn)]/10 flex items-center justify-center text-[var(--warn)] shrink-0">
                                        {item.kind === 'table' ? <LayoutDashboard size={16} /> : <Coffee size={16} />}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-bold text-[var(--text)] truncate">{item.label}</p>
                                        <p className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                                            <Clock size={11} /> {item.sublabel ? `${item.sublabel} · ` : ''}Aguardando {formatWaitingLabel(item.waitingSince)}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className="font-mono font-bold text-[var(--text)]">R$ {formatBRL(item.total)}</span>
                                    <ArrowRight size={16} className="text-[var(--text-muted)]" />
                                </div>
                            </motion.button>
                        ))}
                        </AnimatePresence>
                    </div>
                )}
            </div>

            {/* Task 4, Passo 1: sangria/suprimento — formulário simples num modal. */}
            <Modal
                isOpen={showMovementModal}
                onClose={() => setShowMovementModal(false)}
                title={movementType === 'sangria' ? 'Registrar sangria' : 'Registrar suprimento'}
            >
                <div className="space-y-4">
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setMovementType('sangria')}
                            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 font-bold text-sm u-motion ${movementType === 'sangria' ? 'border-[var(--err)] bg-[var(--err)]/10 text-[var(--err)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}
                        >
                            <TrendingDown size={16} /> Sangria
                        </button>
                        <button
                            type="button"
                            onClick={() => setMovementType('suprimento')}
                            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 font-bold text-sm u-motion ${movementType === 'suprimento' ? 'border-[var(--ok)] bg-[var(--ok)]/10 text-[var(--ok)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}
                        >
                            <TrendingUp size={16} /> Suprimento
                        </button>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                            Valor
                        </label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] font-bold">R$</span>
                            <input
                                type="number"
                                min="0.01"
                                step="0.01"
                                autoFocus
                                className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-[var(--border)] focus:border-[var(--brand)] focus:outline-none font-bold text-lg"
                                placeholder="0.00"
                                value={movementAmount}
                                onChange={e => setMovementAmount(e.target.value)}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                            Motivo
                        </label>
                        <Input
                            value={movementReason}
                            onChange={e => setMovementReason(e.target.value)}
                            placeholder={movementType === 'sangria' ? 'Ex.: depósito no banco' : 'Ex.: troco reforçado'}
                        />
                    </div>

                    <div className="flex gap-2 pt-2">
                        <Button variant="outline" className="flex-1" onClick={() => setShowMovementModal(false)}>
                            Cancelar
                        </Button>
                        <Button className="flex-1" isLoading={isSubmittingMovement} onClick={handleSubmitMovement}>
                            Confirmar
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Task 4, Passo 2: fechamento de turno com conferência. */}
            <Modal
                isOpen={showCloseModal}
                onClose={() => { if (!isClosingShift) setShowCloseModal(false); }}
                title="Fechar Caixa"
                size="md"
            >
                {isLoadingSummary ? (
                    <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
                        <RefreshCw size={24} className="animate-spin" />
                    </div>
                ) : !closeSummary ? (
                    <div className="py-8 text-center text-sm text-[var(--text-muted)]">
                        Não foi possível carregar o resumo do turno.
                    </div>
                ) : (
                    <div className="space-y-5">
                        {/* Aviso de fila cheia (subprojeto 2, 2026-08-25) — não bloqueia
                            o fechamento (mesas/pedidos continuam lá depois, é um estado
                            válido), só evita fechar sem querer no meio do movimento. */}
                        {queueItems.length > 0 && (
                            <div className="rounded-xl border-2 border-[var(--warn)]/40 bg-[var(--warn)]/10 px-4 py-3 flex items-start gap-2">
                                <AlertCircle size={18} className="text-[var(--warn)] shrink-0 mt-0.5" />
                                <p className="text-sm text-[var(--warn)] font-semibold">
                                    Ainda há {queueItems.length} {queueItems.length === 1 ? 'recebível pendente' : 'recebíveis pendentes'} na fila. Eles continuam lá depois do fechamento.
                                </p>
                            </div>
                        )}
                        <div className="space-y-1.5">
                            <h4 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">
                                Total por forma de pagamento
                            </h4>
                            {Object.keys(closeSummary.totals_by_method).length === 0 ? (
                                <p className="text-sm text-[var(--text-muted)]">Nenhum pagamento registrado neste turno.</p>
                            ) : (
                                <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
                                    {Object.entries(closeSummary.totals_by_method).map(([method, total]) => (
                                        <div key={method} className="flex items-center justify-between px-3 py-2 text-sm">
                                            <span className="text-[var(--text)]">{getPaymentMethodLabel(method)}</span>
                                            <span className="font-mono font-bold text-[var(--text)]">R$ {formatBRL(total)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Achado real (auditoria "o que falta", 2026-08-27 —
                            item B11 da reunião): conferência por bandeira
                            (Mastercard, Alelo etc.) contra a maquineta física,
                            não só por método. Pagamento sem bandeira escolhida
                            (campo opcional) não aparece aqui de propósito. */}
                        {Object.keys(closeSummary.totals_by_brand).length > 0 && (
                            <div className="space-y-1.5">
                                <h4 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">
                                    Total por bandeira
                                </h4>
                                <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
                                    {Object.entries(closeSummary.totals_by_brand).map(([brand, total]) => (
                                        <div key={brand} className="flex items-center justify-between px-3 py-2 text-sm">
                                            <span className="text-[var(--text)]">{getCardBrandLabel(brand)}</span>
                                            <span className="font-mono font-bold text-[var(--text)]">R$ {formatBRL(total)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="rounded-xl border border-[var(--border)] px-3 py-2">
                                <p className="text-[var(--text-muted)] flex items-center gap-1"><TrendingDown size={12} /> Sangrias</p>
                                <p className="font-mono font-bold text-[var(--text)]">R$ {formatBRL(closeSummary.total_sangria)}</p>
                            </div>
                            <div className="rounded-xl border border-[var(--border)] px-3 py-2">
                                <p className="text-[var(--text-muted)] flex items-center gap-1"><TrendingUp size={12} /> Suprimentos</p>
                                <p className="font-mono font-bold text-[var(--text)]">R$ {formatBRL(closeSummary.total_suprimento)}</p>
                            </div>
                        </div>

                        {canSeeExpectedBeforeClosing && (
                            <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3 flex items-center justify-between">
                                <span className="text-sm font-bold text-[var(--text)]">Esperado em dinheiro na gaveta</span>
                                <span className="font-mono font-bold text-lg text-[var(--text)]">R$ {formatBRL(closeSummary.expected_cash)}</span>
                            </div>
                        )}

                        <div>
                            <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                                Contagem da gaveta
                            </label>
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                {CASH_DENOMINATIONS.map((value) => (
                                    <div key={value} className="flex flex-col gap-1">
                                        <span className="text-xs font-bold text-[var(--text-muted)] text-center">
                                            {value >= 1 ? `R$ ${value}` : `R$ ${value.toFixed(2)}`}
                                        </span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="1"
                                            inputMode="numeric"
                                            className="w-full px-2 py-2 rounded-lg border-2 border-[var(--border)] focus:border-[var(--brand)] focus:outline-none text-center font-bold"
                                            placeholder="0"
                                            value={closingCashBreakdown[String(value)] || ''}
                                            onChange={(e) => setClosingCashBreakdown((prev) => ({ ...prev, [String(value)]: e.target.value }))}
                                        />
                                    </div>
                                ))}
                            </div>
                            <div className="mt-3 flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--surface-2)]">
                                <span className="text-sm font-bold text-[var(--text)]">Total contado</span>
                                <span className="font-mono font-bold text-lg text-[var(--text)]">R$ {formatBRL(closingCountedValue)}</span>
                            </div>
                        </div>

                        {canSeeExpectedBeforeClosing && liveDifference !== null && (
                            <div className={`rounded-xl px-4 py-3 flex items-center justify-between border-2 ${
                                Math.abs(liveDifference) < 0.005
                                    ? 'border-[var(--ok)]/40 bg-[var(--ok)]/10'
                                    : liveDifference > 0
                                        ? 'border-[var(--info)]/40 bg-[var(--info)]/10'
                                        : 'border-[var(--err)]/40 bg-[var(--err)]/10'
                            }`}>
                                <span className="text-sm font-bold text-[var(--text)]">
                                    {Math.abs(liveDifference) < 0.005 ? 'Confere certinho' : liveDifference > 0 ? 'Sobra' : 'Falta'}
                                </span>
                                <span className="font-mono font-bold text-lg text-[var(--text)]">
                                    {liveDifference > 0 ? '+' : ''}R$ {formatBRL(liveDifference)}
                                </span>
                            </div>
                        )}

                        <div className="flex gap-2 pt-1">
                            <Button variant="outline" className="flex-1" disabled={isClosingShift} onClick={() => setShowCloseModal(false)}>
                                Cancelar
                            </Button>
                            <Button className="flex-1" isLoading={isClosingShift} onClick={() => handleConfirmCloseShift()}>
                                <Lock size={16} className="mr-2" /> Confirmar Fechamento
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Task 1 (varredura 2026-08-30): diferença acima da tolerância
                configurada exige aprovação de supervisor antes de fechar. */}
            <Modal isOpen={!!pendingApproval} onClose={() => { setPendingApproval(null); setSupervisorEmail(''); setSupervisorPassword(''); }} title="Diferença acima do limite — aprovação necessária">
                {pendingApproval && (
                    <div className="space-y-4">
                        <div className="bg-[var(--warn)]/10 p-4 rounded-xl border border-[var(--warn)]/20">
                            <p className="text-sm text-[var(--warn)] font-semibold">
                                {canSeeExpectedBeforeClosing
                                    // Achado #5 (revisão final de branch, 2026-08-30): mostrar o valor
                                    // aqui incondicionalmente furava a contagem cega — quem não devia
                                    // ver o esperado aprendia a diferença exata ao tentar fechar,
                                    // cancelava e ajustava a contagem pra caber na tolerância. O valor
                                    // real ainda aparece pra quem tem permissão (canSeeExpectedBeforeClosing)
                                    // e, pra todo mundo, no modal de resultado pós-fechamento (mesmo
                                    // padrão já usado ali).
                                    ? `Diferença de R$ ${formatBRL(Math.abs(pendingApproval.difference))} (${pendingApproval.difference >= 0 ? 'sobra' : 'falta'}) — acima da tolerância configurada pra esta loja.`
                                    : 'Diferença acima da tolerância configurada pra esta loja — contagem cega ativa, o valor só aparece depois que um supervisor aprovar o fechamento.'}
                            </p>
                        </div>
                        <p className="text-sm text-[var(--text-muted)]">Peça pra um supervisor (dono, ou quem tiver a permissão "Supervisiona Caixa") digitar o login dele pra aprovar o fechamento mesmo assim.</p>
                        <Input label="E-mail do supervisor" type="email" value={supervisorEmail} onChange={e => setSupervisorEmail(e.target.value)} />
                        <Input label="Senha do supervisor" type="password" value={supervisorPassword} onChange={e => setSupervisorPassword(e.target.value)} />
                        <div className="flex gap-2">
                            <Button className="flex-1" onClick={handleApproveAndClose} isLoading={isVerifyingSupervisor}>Aprovar e Fechar</Button>
                            <Button variant="ghost" onClick={() => { setPendingApproval(null); setSupervisorEmail(''); setSupervisorPassword(''); }}>Cancelar</Button>
                        </div>
                    </div>
                )}
            </Modal>
            {closedResultModal}
            {historyModals}
        </div>
    );
};

// --- SUB-MODULE: MENU MANAGEMENT ---

// Sentinel usado só na UI pra agrupar produtos órfãos (category_id === null,
// FK on delete set null quando a categoria é excluída — ver AGENTS.md) numa
// seção "Sem categoria" que reusa a mesma renderização/drag-and-drop das
// categorias reais, sem duplicar o JSX.
const UNCATEGORIZED_ID = '__uncategorized__';
const groupIdOf = (p: Product) => p.category_id ?? UNCATEGORIZED_ID;

interface DraftOption { tempId: string; name: string; price_delta: string; available: boolean }
interface DraftOptionGroup {
    tempId: string; name: string; type: 'single' | 'multiple'; required: boolean;
    // min_select/max_select ficam como string no rascunho (mesmo padrão de
    // price_delta) — vazio = sem limite/null, só relevantes quando type === 'multiple'.
    min_select: string; max_select: string;
    options: DraftOption[];
}

const toDraftGroups = (groups?: Product['option_groups']): DraftOptionGroup[] =>
    (groups || []).map(g => ({
        tempId: g.id, name: g.name, type: g.type, required: g.required,
        min_select: g.min_select != null ? g.min_select.toString() : '',
        max_select: g.max_select != null ? g.max_select.toString() : '',
        options: g.options.map(o => ({ tempId: o.id, name: o.name, price_delta: o.price_delta.toString(), available: o.available })),
    }));

// Soft-cap client-side (achado de robustez 2026-07-05): evita centenas de
// round-trips numa única "Salvar Produto" se o lojista, por engano ou
// abuso, tentar criar grupos/opções sem limite nenhum.
const MAX_OPTION_GROUPS = 20;
const MAX_OPTIONS_PER_GROUP = 30;

// Vende mais II (migration 020) — "peca tambem": mesmo limite validado dentro
// de sync_product_recommendations (security definer), replicado aqui so' pra
// desabilitar os checkboxes restantes na UI antes de bater no erro do banco.
const MAX_RECOMMENDATIONS = 3;

const parseOptionalInt = (value: string): number | null => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = parseInt(trimmed, 10);
    return Number.isNaN(n) ? null : n;
};

// Rotulos curtos de dia da semana pro modal de horario da categoria (0 =
// domingo, mesmo indice usado em Category.available_days/getDay()).
const SCHEDULE_DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const MenuManagementView: React.FC<{ store: Store, onStoreUpdate?: (store: Store) => void }> = ({ store, onStoreUpdate }) => {
    const storeId = store.id;
    const [categories, setCategories] = useState<Category[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [newCatName, setNewCatName] = useState('');

    // Horario/turno da categoria (migration 018 — ver lib/schedule.ts):
    // modal pequeno aberto a partir do icone de relogio no chip da
    // categoria, ver Task 3 do plano 2026-07-05.
    const [scheduleCategory, setScheduleCategory] = useState<Category | null>(null);
    const [scheduleAllDay, setScheduleAllDay] = useState(true);
    const [scheduleFrom, setScheduleFrom] = useState('');
    const [scheduleUntil, setScheduleUntil] = useState('');
    const [scheduleDays, setScheduleDays] = useState<number[]>([]);
    const [isSavingSchedule, setIsSavingSchedule] = useState(false);

    // Product Form
    const [pName, setPName] = useState('');
    const [pDesc, setPDesc] = useState('');
    const [pPrice, setPPrice] = useState('');
    const [pCat, setPCat] = useState('');
    const [pTime, setPTime] = useState('15');
    const [pDestination, setPDestination] = useState<'kitchen' | 'bar'>('kitchen');
    // NCM (migration 032/033) — classificacao fiscal do produto. Texto livre
    // (o codigo tem digitos e as vezes pontuacao), mesmo padrao dos outros
    // campos de texto opcionais deste form (nao ha catalogo fechado, ao
    // contrario de PRODUCT_TAGS).
    const [pNcm, setPNcm] = useState('');
    // Cadastro de produto unificado, Direção 1 (2026-08-16) — só em "Novo
    // Produto" (não em editar), mesmo padrão do "Criar no NTB Estoque
    // também" da tela de loja.
    const [pCriarNoEstoque, setPCriarNoEstoque] = useState(false);
    const [pFile, setPFile] = useState<File | null>(null);
    const [pPreview, setPPreview] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Integração ntb-vendas -> ntb-estoque (Ordem de Produção automática,
    // migration 042) — URL/chave nunca voltam do banco (write-only), só o
    // toggle `ativo` e se já está configurada.
    const [ntbEstoqueStatus, setNtbEstoqueStatus] = useState<NtbEstoqueIntegracaoStatus>({ configurado: false, ativo: false });
    const [ntbEstoqueUrlInput, setNtbEstoqueUrlInput] = useState('');
    const [ntbEstoqueApiKeyInput, setNtbEstoqueApiKeyInput] = useState('');
    const [isSavingNtbEstoque, setIsSavingNtbEstoque] = useState(false);

    useEffect(() => { fetchNtbEstoqueIntegracaoStatus(storeId).then(setNtbEstoqueStatus); }, [storeId]);

    const handleSaveNtbEstoqueIntegracao = async () => {
        if (!ntbEstoqueUrlInput && !ntbEstoqueApiKeyInput) {
            return toast.error('Preencha a URL e a chave de API do NTB Estoque.');
        }
        setIsSavingNtbEstoque(true);
        try {
            const result = await saveNtbEstoqueIntegracaoConfig(storeId, { url: ntbEstoqueUrlInput, apiKey: ntbEstoqueApiKeyInput, ativo: true });
            if (!result.success) throw new Error(result.message);
            toast.success('Integração com o NTB Estoque configurada!');
            setNtbEstoqueUrlInput('');
            setNtbEstoqueApiKeyInput('');
            setNtbEstoqueStatus(await fetchNtbEstoqueIntegracaoStatus(storeId));
        } catch (e: any) {
            toast.error('Erro ao configurar integração: ' + e.message);
        } finally {
            setIsSavingNtbEstoque(false);
        }
    };

    const handleToggleNtbEstoqueAtivo = async (ativo: boolean) => {
        const result = await saveNtbEstoqueIntegracaoConfig(storeId, { ativo });
        if (!result.success) return toast.error('Erro ao atualizar: ' + result.message);
        setNtbEstoqueStatus((prev) => ({ ...prev, ativo }));
        toast.success(ativo ? 'Ordem de Produção automática ativada.' : 'Ordem de Produção automática desativada.');
    };

    // Cardapio que vende (migration 019) — preco promocional, destaque e
    // etiquetas, tudo configuravel pelo lojista aqui mesmo (requisito
    // explicito do dono do projeto, ver Task B1 do plano 2026-07-06).
    const [pPromoPrice, setPPromoPrice] = useState('');
    const [pFeatured, setPFeatured] = useState(false);
    const [pTags, setPTags] = useState<string[]>([]);
    const toggleProductTag = (tag: string) => {
        setPTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
    };

    // Vende mais II (migration 020) — "peca tambem": rascunho local igual ao
    // de option_groups/tags acima, so' persiste de verdade quando "Salvar
    // Produto" e' clicado (ver handleSaveProduct: chama
    // updateProductRecommendations depois de ja' ter o productId definitivo,
    // mesma ordem que syncProductOptionGroups ja' segue). Ao editar um
    // produto existente, `product.recommended_products` ja' vem resolvido
    // pelo fetchMenu (lib/api.ts) — nao precisa de fetch novo, so' mapear pra
    // ids (ver openProductModal abaixo).
    const [pRecommendedIds, setPRecommendedIds] = useState<string[]>([]);
    const [pRecommendationSearch, setPRecommendationSearch] = useState('');
    const toggleRecommendedProduct = (productId: string) => {
        setPRecommendedIds(prev => {
            if (prev.includes(productId)) return prev.filter(id => id !== productId);
            if (prev.length >= MAX_RECOMMENDATIONS) {
                toast.error(`No máximo ${MAX_RECOMMENDATIONS} produtos recomendados.`);
                return prev;
            }
            return [...prev, productId];
        });
    };

    // Adicionais/opcionais do produto (ex: "Escolha a borda") — rascunho
    // local, so' persiste no banco quando "Salvar Produto" e' clicado
    // (syncProductOptionGroups apaga e recria tudo, seguro porque
    // order_items.selected_options e' snapshot historico, nao FK viva).
    const [pOptionGroups, setPOptionGroups] = useState<DraftOptionGroup[]>([]);
    const addOptionGroup = () => {
        if (pOptionGroups.length >= MAX_OPTION_GROUPS) {
            toast.error(`Limite de ${MAX_OPTION_GROUPS} grupos de opção por produto atingido.`);
            return;
        }
        setPOptionGroups(prev => [...prev, { tempId: crypto.randomUUID(), name: '', type: 'single', required: false, min_select: '', max_select: '', options: [] }]);
    };
    const updateOptionGroup = (tempId: string, patch: Partial<DraftOptionGroup>) => setPOptionGroups(prev => prev.map(g => g.tempId === tempId ? { ...g, ...patch } : g));
    const removeOptionGroup = (tempId: string) => setPOptionGroups(prev => prev.filter(g => g.tempId !== tempId));
    const addOption = (groupTempId: string) => {
        const group = pOptionGroups.find(g => g.tempId === groupTempId);
        if (group && group.options.length >= MAX_OPTIONS_PER_GROUP) {
            toast.error(`Limite de ${MAX_OPTIONS_PER_GROUP} opções por grupo atingido.`);
            return;
        }
        setPOptionGroups(prev => prev.map(g => g.tempId === groupTempId ? { ...g, options: [...g.options, { tempId: crypto.randomUUID(), name: '', price_delta: '0', available: true }] } : g));
    };
    const updateOption = (groupTempId: string, optTempId: string, patch: Partial<DraftOption>) => setPOptionGroups(prev => prev.map(g => g.tempId === groupTempId ? { ...g, options: g.options.map(o => o.tempId === optTempId ? { ...o, ...patch } : o) } : g));
    const removeOption = (groupTempId: string, optTempId: string) => setPOptionGroups(prev => prev.map(g => g.tempId === groupTempId ? { ...g, options: g.options.filter(o => o.tempId !== optTempId) } : g));

    // Reordena opções dentro de um mesmo grupo (drag-and-drop) — mesmo padrão
    // do handleDragEnd de categoria/produto abaixo, mas isolado num
    // DragDropContext próprio (Modal, fora da árvore de categorias/produtos).
    // Só permite mover dentro do MESMO grupo (não faz sentido "vazar" uma
    // opção de um grupo pra outro via arrasto).
    const handleOptionDragEnd = (result: DropResult) => {
        const { source, destination } = result;
        if (!destination) return;
        if (source.droppableId !== destination.droppableId) return;
        if (source.index === destination.index) return;
        const groupTempId = source.droppableId;
        setPOptionGroups(prev => prev.map(g => {
            if (g.tempId !== groupTempId) return g;
            const newOptions = [...g.options];
            const [moved] = newOptions.splice(source.index, 1);
            newOptions.splice(destination.index, 0, moved);
            return { ...g, options: newOptions };
        }));
    };

    const loadMenu = async () => {
        // includeUnavailable=true: o lojista precisa ver e editar opções
        // marcadas como indisponíveis nesta tela (só o cardápio do cliente
        // filtra `available = true`, ver fetchMenu em lib/api.ts).
        const { categories: c, products: p } = await fetchMenu(storeId, false, true);
        setCategories(c);
        setProducts(p);
    };

    const handleDragEnd = async (result: DropResult) => {
        const { source, destination, type } = result;
        if (!destination) return;
        if (source.droppableId === destination.droppableId && source.index === destination.index) return;

        if (type === 'category') {
            const newCategories = [...categories];
            const [moved] = newCategories.splice(source.index, 1);
            newCategories.splice(destination.index, 0, moved);
            
            const updatedCategories = newCategories.map((cat, index) => ({ ...cat, order: index + 1 }));
            setCategories(updatedCategories);

            try {
                await updateCategoryOrder(updatedCategories.map(c => ({ id: c.id, order: c.order })));
            } catch (e) {
                console.error("Error updating category order", e);
                loadMenu();
            }
        } else if (type === 'product') {
            const sourceCategoryId = source.droppableId;
            const destCategoryId = destination.droppableId;

            if (sourceCategoryId === destCategoryId) {
                // Reordering within the same category (ou dentro de "Sem categoria")
                const catProducts = products.filter(p => groupIdOf(p) === sourceCategoryId).sort((a, b) => (a.order || 0) - (b.order || 0));
                const otherProducts = products.filter(p => groupIdOf(p) !== sourceCategoryId);
                
                const newCatProducts = [...catProducts];
                const [moved] = newCatProducts.splice(source.index, 1);
                newCatProducts.splice(destination.index, 0, moved);

                const updatedCatProducts = newCatProducts.map((prod, index) => ({ ...prod, order: index + 1 }));
                
                setProducts([...otherProducts, ...updatedCatProducts]);

                try {
                    await updateProductOrder(updatedCatProducts.map(p => ({ id: p.id, order: p.order || 0 })));
                } catch (e: any) {
                    console.error("Error updating product order", e);
                    if (e.message === "schema cache") {
                        toast.error("Para reordenar produtos, execute este script no SQL Editor do Supabase:\n\nALTER TABLE products ADD COLUMN \"order\" INT DEFAULT 0;\nNOTIFY pgrst, 'reload schema';", 10000);
                    } else {
                        toast.error("Erro ao reordenar produtos: " + e.message);
                    }
                    loadMenu();
                }
            } else {
                // Moving to a different category (origem/destino podem ser "Sem categoria")
                const sourceCatProducts = products.filter(p => groupIdOf(p) === sourceCategoryId).sort((a, b) => (a.order || 0) - (b.order || 0));
                const destCatProducts = products.filter(p => groupIdOf(p) === destCategoryId).sort((a, b) => (a.order || 0) - (b.order || 0));
                const otherProducts = products.filter(p => groupIdOf(p) !== sourceCategoryId && groupIdOf(p) !== destCategoryId);

                const newSourceProducts = [...sourceCatProducts];
                const [moved] = newSourceProducts.splice(source.index, 1);
                const newCategoryId = destCategoryId === UNCATEGORIZED_ID ? null : destCategoryId;
                moved.category_id = newCategoryId; // Update category_id

                const newDestProducts = [...destCatProducts];
                newDestProducts.splice(destination.index, 0, moved);

                const updatedSourceProducts = newSourceProducts.map((prod, index) => ({ ...prod, order: index + 1 }));
                const updatedDestProducts = newDestProducts.map((prod, index) => ({ ...prod, order: index + 1 }));

                setProducts([...otherProducts, ...updatedSourceProducts, ...updatedDestProducts]);

                try {
                    // Update category_id for the moved product
                    await updateProduct(moved.id, storeId, { category_id: newCategoryId });

                    // Update orders for both categories
                    await updateProductOrder([
                        ...updatedSourceProducts.map(p => ({ id: p.id, order: p.order || 0 })),
                        ...updatedDestProducts.map(p => ({ id: p.id, order: p.order || 0 }))
                    ]);
                } catch (e: any) {
                    console.error("Error moving product", e);
                    if (e.message === "schema cache") {
                        toast.error("Para reordenar produtos, execute este script no SQL Editor do Supabase:\n\nALTER TABLE products ADD COLUMN \"order\" INT DEFAULT 0;\nNOTIFY pgrst, 'reload schema';", 10000);
                    } else {
                        toast.error("Erro ao mover produto: " + e.message);
                    }
                    loadMenu();
                }
            }
        }
    };

    useEffect(() => { loadMenu(); }, [storeId]);

    const handleAddCategory = async () => {
        if (!newCatName) return;
        await createCategory(storeId, newCatName);
        setNewCatName('');
        loadMenu();
    };

    const handleDeleteCategory = async (id: string) => {
        if (await confirm({ message: 'Excluir categoria? Produtos nela podem ficar órfãos.', variant: 'danger', confirmLabel: 'Excluir' })) {
            await deleteCategory(id);
            loadMenu();
        }
    };

    const openScheduleModal = (cat: Category) => {
        setScheduleCategory(cat);
        const hasSchedule = Boolean(cat.available_from || cat.available_until || (cat.available_days && cat.available_days.length > 0));
        setScheduleAllDay(!hasSchedule);
        setScheduleFrom(cat.available_from ? cat.available_from.slice(0, 5) : '');
        setScheduleUntil(cat.available_until ? cat.available_until.slice(0, 5) : '');
        setScheduleDays(cat.available_days || []);
    };

    const toggleScheduleDay = (day: number) => {
        setScheduleDays(prev => (prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b)));
    };

    const handleSaveSchedule = async () => {
        if (!scheduleCategory) return;
        setIsSavingSchedule(true);
        try {
            await updateCategorySchedule(scheduleCategory.id, {
                available_from: scheduleAllDay ? null : (scheduleFrom || null),
                available_until: scheduleAllDay ? null : (scheduleUntil || null),
                available_days: scheduleAllDay || scheduleDays.length === 0 ? null : scheduleDays,
            });
            setScheduleCategory(null);
            loadMenu();
        } catch (e) {
            console.error('Error updating category schedule', e);
            toast.error('Erro ao salvar horário da categoria.');
        } finally {
            setIsSavingSchedule(false);
        }
    };

    const openProductModal = (product?: Product) => {
        if (product) {
            setEditingProduct(product);
            setPName(product.name);
            setPDesc(product.description);
            setPPrice(product.price.toString());
            setPCat(product.category_id || ''); // produto orfao (sem categoria): forca escolha no select
            setPTime(product.prep_time_minutes.toString());
            setPPreview(product.image_url);
            setPDestination(product.destination || 'kitchen');
            setPOptionGroups(toDraftGroups(product.option_groups));
            setPPromoPrice(product.promo_price != null ? product.promo_price.toString() : '');
            setPFeatured(product.featured ?? false);
            setPTags(product.tags ?? []);
            setPRecommendedIds((product.recommended_products || []).map(rp => rp.id));
            setPNcm(product.ncm ?? '');
        } else {
            setEditingProduct(null);
            setPName('');
            setPDesc('');
            setPPrice('');
            setPCat(categories[0]?.id || '');
            setPTime('15');
            setPPreview(null);
            setPDestination('kitchen');
            setPOptionGroups([]);
            setPPromoPrice('');
            setPFeatured(false);
            setPTags([]);
            setPRecommendedIds([]);
            setPNcm('');
            setPCriarNoEstoque(false);
        }
        setPRecommendationSearch('');
        setPFile(null);
        setIsProductModalOpen(true);
    };

    const handleSaveProduct = async () => {
        if (!pName || !pPrice || !pCat) return toast.error('Preencha os campos obrigatórios');
        const priceNum = parseFloat(pPrice);
        if (isNaN(priceNum) || priceNum < 0) return toast.error('Preço não pode ser negativo.');
        const prepNum = parseInt(pTime);
        if (isNaN(prepNum) || prepNum < 0) return toast.error('Tempo de preparo não pode ser negativo.');

        // Preco promocional (migration 019): validacao amigavel aqui no
        // client — o CHECK do banco (promo_price < price) e' a rede de
        // seguranca final, mas o lojista nao deveria descobrir isso via um
        // erro 400 cru. Vazio = sem promocao (null).
        let promoPriceNum: number | null = null;
        if (pPromoPrice.trim() !== '') {
            promoPriceNum = parseFloat(pPromoPrice);
            if (isNaN(promoPriceNum) || promoPriceNum < 0) return toast.error('Preço promocional não pode ser negativo.');
            if (promoPriceNum >= priceNum) return toast.error('Preço promocional precisa ser menor que o preço cheio.');
        }

        // Validação: grupo obrigatório sem nenhuma opção válida "bricaria" o
        // produto pro cliente (obrigatório mas nada pra escolher, sem aviso
        // nenhum) — bloqueia o save antes de tocar em produto ou adicionais.
        // Só considera grupos que de fato serão salvos (nome preenchido).
        for (const g of pOptionGroups) {
            if (!g.name.trim() || !g.required) continue;
            const validOptions = g.options.filter(o => o.name.trim());
            if (validOptions.length === 0) {
                return toast.error(`Grupo "${g.name.trim()}" está marcado como obrigatório mas não tem nenhuma opção — adicione uma opção ou desmarque obrigatório.`);
            }
        }

        setIsLoading(true);

        try {
            let imageUrl = pPreview;
            if (pFile) {
                imageUrl = await uploadProductImage(pFile);
            }

            const productData = {
                name: pName,
                description: pDesc,
                price: priceNum,
                category_id: pCat,
                prep_time_minutes: prepNum,
                image_url: imageUrl,
                destination: pDestination,
                promo_price: promoPriceNum,
                featured: pFeatured,
                tags: pTags,
                ncm: pNcm.trim() || null,
            };

            let productId: string;
            const isNewProduct = !editingProduct;
            if (editingProduct) {
                await updateProduct(editingProduct.id, storeId, productData);
                productId = editingProduct.id;
            } else {
                productId = await createProduct(storeId, pCat, productData);
            }

            if (isNewProduct && pCriarNoEstoque) {
                const estoqueResult = await criarProdutoNoEstoque(storeId, productId, pName, priceNum, pNcm.trim() || null);
                if (!estoqueResult.success) {
                    toast.error('Produto criado aqui, mas falhou criar no NTB Estoque: ' + estoqueResult.message);
                } else {
                    toast.success('Produto criado no NTB Estoque também!');
                }
            }

            const groupsToSave: ProductOptionGroupInput[] = pOptionGroups
                .filter(g => g.name.trim())
                .map(g => ({
                    name: g.name.trim(), type: g.type, required: g.required,
                    min_select: g.type === 'multiple' ? parseOptionalInt(g.min_select) : null,
                    max_select: g.type === 'multiple' ? parseOptionalInt(g.max_select) : null,
                    options: g.options.filter(o => o.name.trim()).map(o => ({ name: o.name.trim(), price_delta: parseFloat(o.price_delta) || 0, available: o.available })),
                }));
            await syncProductOptionGroups(productId, groupsToSave);

            // Vende mais II (migration 020) — "peca tambem": so' pode rodar
            // depois de ter o productId definitivo (mesma ordem que
            // syncProductOptionGroups acima). Try/catch proprio de proposito:
            // um erro aqui nao pode travar o resto do salvamento (produto e
            // adicionais ja' foram gravados com sucesso), so' avisa o
            // lojista com um toast especifico.
            try {
                await updateProductRecommendations(productId, storeId, pRecommendedIds);
            } catch (recError) {
                console.error('Error updating product recommendations', recError);
                toast.error('Produto salvo, mas houve erro ao salvar as recomendações.');
            }

            setIsProductModalOpen(false);
            loadMenu();
        } catch (e: any) {
            if (e.message === "schema cache destination") {
                toast.error("Para usar o destino (Cozinha/Bar), execute este script no SQL Editor do Supabase:\n\nALTER TABLE products ADD COLUMN destination TEXT DEFAULT 'kitchen';\nNOTIFY pgrst, 'reload schema';", 10000);
            } else {
                toast.error('Erro ao salvar: ' + e.message);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteProduct = async (id: string) => {
        if (await confirm({ message: 'Excluir produto?', variant: 'danger', confirmLabel: 'Excluir' })) {
            await deleteProduct(id, storeId);
            loadMenu();
        }
    };

    const handleToggleAvailability = async (product: Product) => {
        await updateProduct(product.id, storeId, { available: !product.available });
        loadMenu();
    }

    // Consolidar produtos soltos em variação (2026-08-16) — "organizar o
    // cardápio": seleciona 2+ produtos da MESMA categoria e agrupa como
    // variações de um produto-pai (ver consolidateProductsIntoVariants em
    // lib/api.ts). Só entra em modo de seleção quando o lojista pede —
    // fora disso a lista de produtos funciona exatamente como sempre.
    const [groupSelectMode, setGroupSelectMode] = useState(false);
    const [selectedForGroup, setSelectedForGroup] = useState<Set<string>>(new Set());
    const [groupModalOpen, setGroupModalOpen] = useState(false);
    const [groupBaseId, setGroupBaseId] = useState<string | null>(null);
    const [groupNameInput, setGroupNameInput] = useState('');
    const [isConsolidating, setIsConsolidating] = useState(false);

    const toggleProductForGroup = (productId: string) => {
        setSelectedForGroup(prev => {
            const next = new Set(prev);
            if (next.has(productId)) next.delete(productId); else next.add(productId);
            return next;
        });
    };

    const selectedGroupProducts = useMemo(
        () => products.filter(p => selectedForGroup.has(p.id)),
        [products, selectedForGroup]
    );
    const selectedGroupSameCategory = useMemo(() => {
        if (selectedGroupProducts.length < 2) return false;
        const firstGroupId = groupIdOf(selectedGroupProducts[0]);
        return selectedGroupProducts.every(p => groupIdOf(p) === firstGroupId);
    }, [selectedGroupProducts]);

    const openGroupModal = () => {
        if (!selectedGroupSameCategory) return;
        // Sugere o mais barato como base (price_delta nunca pode ser negativo).
        const cheapest = [...selectedGroupProducts].sort((a, b) => a.price - b.price)[0];
        setGroupBaseId(cheapest.id);
        setGroupNameInput('');
        setGroupModalOpen(true);
    };

    const handleConsolidateGroup = async () => {
        if (!groupBaseId || !groupNameInput.trim()) {
            return toast.error('Escolha o produto base e dê um nome pro grupo.');
        }
        setIsConsolidating(true);
        try {
            const result = await consolidateProductsIntoVariants(storeId, groupBaseId, selectedGroupProducts, groupNameInput.trim());
            if (!result.success) throw new Error(result.message);
            toast.success('Produtos agrupados em variações!');
            setGroupModalOpen(false);
            setGroupSelectMode(false);
            setSelectedForGroup(new Set());
            loadMenu();
        } catch (e: any) {
            toast.error('Erro ao agrupar: ' + e.message);
        } finally {
            setIsConsolidating(false);
        }
    };

    // Produtos órfãos (categoria excluída, FK on delete set null) entram numa
    // seção sintética "Sem categoria" no final da lista, reusando o mesmo
    // Droppable/Draggable e os mesmos controles de editar/pausar/excluir das
    // categorias reais — ver `groupIdOf`/`UNCATEGORIZED_ID` acima.
    const hasUncategorizedProducts = products.some(p => p.category_id === null);
    const productGroups: Category[] = hasUncategorizedProducts
        ? [...categories, { id: UNCATEGORIZED_ID, store_id: storeId, name: 'Sem categoria', order: Number.MAX_SAFE_INTEGER }]
        : categories;

    // Vende mais II (migration 020) — "peca tambem": candidatos pra recomendar
    // no form de produto = todo produto da MESMA loja (products ja' vem
    // escopado por storeId via fetchMenu) exceto o proprio produto em edicao;
    // criando produto novo (editingProduct === null) nada precisa ser
    // excluido. Filtro de busca por nome em cima disso — loja pode ter
    // dezenas de produtos.
    const recommendableProducts = useMemo(
        () => products.filter(p => p.id !== editingProduct?.id),
        [products, editingProduct]
    );
    const filteredRecommendableProducts = useMemo(() => {
        const term = pRecommendationSearch.trim().toLowerCase();
        if (!term) return recommendableProducts;
        return recommendableProducts.filter(p => p.name.toLowerCase().includes(term));
    }, [recommendableProducts, pRecommendationSearch]);

    return (
        <div className="space-y-8">
            {/* INTEGRAÇÃO COM O NTB ESTOQUE (Ordem de Produção automática) */}
            <Collapsible
                title="Integração com o NTB Estoque"
                defaultOpen={false}
                badge={ntbEstoqueStatus.configurado ? <Badge color="bg-[var(--ok)]/10 border border-[var(--ok)]/30 text-[var(--ok)]">Configurado</Badge> : undefined}
            >
                <div className="space-y-4">
                    <p className="text-sm text-[var(--text-muted)]">Cada venda fechada cria automaticamente uma Ordem de Produção no NTB Estoque, consumindo os ingredientes da receita.</p>

                    <div className="flex items-center justify-between p-4 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
                        <div>
                            <h4 className="font-bold text-[var(--text)]">Ordem de Produção automática</h4>
                            <p className="text-sm text-[var(--text-muted)]">
                                {ntbEstoqueStatus.configurado
                                    ? (ntbEstoqueStatus.ativo ? 'Ativa — toda venda dispara uma ordem de produção.' : 'Configurada, mas desativada — nenhuma ordem é disparada.')
                                    : 'Ainda não configurada — preencha a URL e a chave de API abaixo.'}
                            </p>
                        </div>
                        <button
                            onClick={() => handleToggleNtbEstoqueAtivo(!ntbEstoqueStatus.ativo)}
                            disabled={!ntbEstoqueStatus.configurado}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${ntbEstoqueStatus.ativo ? 'bg-[var(--ok)]' : 'bg-[var(--border)]'}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${ntbEstoqueStatus.ativo ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <Input
                            label="URL do NTB Estoque"
                            placeholder="https://app-estoque.norteparanegocios.com.br"
                            value={ntbEstoqueUrlInput}
                            onChange={e => setNtbEstoqueUrlInput(e.target.value)}
                        />
                        <Input
                            label="Chave de API"
                            type="password"
                            placeholder={ntbEstoqueStatus.configurado ? '••••••••  (preencher só pra trocar)' : 'Chave de integração da loja no NTB Estoque'}
                            value={ntbEstoqueApiKeyInput}
                            onChange={e => setNtbEstoqueApiKeyInput(e.target.value)}
                        />
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">A chave nunca é exibida de volta depois de salva — deixe em branco se não quiser trocá-la.</p>

                    <Button variant="secondary" className="w-full" onClick={handleSaveNtbEstoqueIntegracao} isLoading={isSavingNtbEstoque}>
                        Salvar Integração com o NTB Estoque
                    </Button>
                </div>
            </Collapsible>

            {/* CATEGORIES */}
            <section className="bg-[var(--surface)] p-6 rounded-xl border border-[var(--border)] shadow-sm">
                <h3 className="font-bold text-lg mb-4 text-[var(--text)]">Categorias</h3>
                <div className="flex gap-2 mb-4">
                    <Input placeholder="Nova Categoria" value={newCatName} onChange={e => setNewCatName(e.target.value)} />
                    <Button onClick={handleAddCategory}><Plus size={20}/></Button>
                </div>
                <DragDropContext onDragEnd={handleDragEnd}>
                    <Droppable droppableId="categories" direction="horizontal" type="category">
                        {(provided) => (
                            <div 
                                className="flex flex-wrap gap-2"
                                {...provided.droppableProps}
                                ref={provided.innerRef}
                            >
                                {categories.map((cat, index) => {
                                    const scheduleLabel = formatScheduleLabel(cat);
                                    return (
                                    <Draggable key={cat.id} draggableId={cat.id} index={index}>
                                        {(provided, snapshot) => (
                                            <div
                                                ref={provided.innerRef}
                                                {...provided.draggableProps}
                                                className={`bg-[var(--surface-2)] px-3 py-1.5 rounded-lg flex items-center gap-2 group ${snapshot.isDragging ? 'shadow-md ring-2 ring-[var(--brand)] bg-[var(--surface)]' : ''}`}
                                            >
                                                <div {...provided.dragHandleProps} className="text-[var(--text-muted)] hover:text-[var(--text)] cursor-grab active:cursor-grabbing">
                                                    <GripVertical size={16} />
                                                </div>
                                                <span className="font-bold text-[var(--text)]">{cat.name}</span>
                                                {scheduleLabel && (
                                                    <Badge color="bg-[var(--info)]/10 text-[var(--info)]">{scheduleLabel}</Badge>
                                                )}
                                                <button onClick={() => openScheduleModal(cat)} className="text-[var(--text-muted)]/50 hover:text-[var(--brand)] opacity-0 group-hover:opacity-100 u-motion u-press">
                                                    <Clock size={14}/>
                                                </button>
                                                <button onClick={() => handleDeleteCategory(cat.id)} className="text-[var(--text-muted)]/50 hover:text-[var(--err)] opacity-0 group-hover:opacity-100 u-motion u-press">
                                                    <X size={14}/>
                                                </button>
                                            </div>
                                        )}
                                    </Draggable>
                                    );
                                })}
                                {provided.placeholder}
                                {categories.length === 0 && <span className="text-[var(--text-muted)] text-sm italic">Nenhuma categoria criada.</span>}
                            </div>
                        )}
                    </Droppable>

                    {/* PRODUCTS */}
                    <section className="mt-8">
                        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
                            <h3 className="font-bold text-lg text-[var(--text)]">Produtos</h3>
                            <div className="flex items-center gap-2">
                                {groupSelectMode && selectedGroupProducts.length >= 2 && (
                                    selectedGroupSameCategory ? (
                                        <Button onClick={openGroupModal} className="!bg-[var(--brand)]">
                                            Agrupar como variações ({selectedGroupProducts.length})
                                        </Button>
                                    ) : (
                                        <span className="text-xs text-[var(--warn)] font-medium">Selecione produtos da mesma categoria</span>
                                    )
                                )}
                                <Button
                                    variant={groupSelectMode ? 'secondary' : 'outline'}
                                    onClick={() => { setGroupSelectMode(prev => !prev); setSelectedForGroup(new Set()); }}
                                >
                                    {groupSelectMode ? 'Cancelar seleção' : 'Agrupar variações'}
                                </Button>
                                <Button onClick={() => openProductModal()}><Plus size={18} className="mr-1"/> Novo Produto</Button>
                            </div>
                        </div>
                        {groupSelectMode && (
                            <p className="text-xs text-[var(--text-muted)] mb-4">
                                Selecione 2+ produtos parecidos da mesma categoria (ex.: as variações de um prato) pra
                                juntar num produto só, com um grupo de escolha. Nenhum produto é apagado — os que
                                virarem variação ficam ocultos do cardápio, com o histórico de venda preservado.
                            </p>
                        )}

                        <div className="space-y-6">
                            {productGroups.map(cat => {
                                const catProducts = products.filter(p => groupIdOf(p) === cat.id).sort((a, b) => (a.order || 0) - (b.order || 0));
                                if (catProducts.length === 0) return null;

                                return (
                                    <div key={cat.id}>
                                        <h4 className="font-bold text-[var(--text-muted)] uppercase text-xs tracking-wider mb-2 ml-1">{cat.name}</h4>
                                        <Droppable droppableId={cat.id} type="product">
                                            {(provided) => (
                                                <div
                                                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start"
                                                    {...provided.droppableProps}
                                                    ref={provided.innerRef}
                                                >
                                                    {catProducts.map((prod, index) => (
                                                        <Draggable key={prod.id} draggableId={prod.id} index={index}>
                                                            {(provided, snapshot) => (
                                                                <div
                                                                    ref={provided.innerRef}
                                                                    {...provided.draggableProps}
                                                                >
                                                                    <Card className={`flex gap-3 p-3 relative group ${!prod.available ? 'opacity-60 bg-[var(--surface-2)]' : ''} ${snapshot.isDragging ? 'shadow-xl ring-2 ring-[var(--brand)]' : ''} ${groupSelectMode && selectedForGroup.has(prod.id) ? 'ring-2 ring-[var(--brand)]' : ''}`}>
                                                                        {groupSelectMode ? (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => toggleProductForGroup(prod.id)}
                                                                                aria-pressed={selectedForGroup.has(prod.id)}
                                                                                className={`absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center z-10 rounded-l-xl ${selectedForGroup.has(prod.id) ? 'bg-[var(--brand)] text-white' : 'bg-[var(--surface-2)]/50 text-[var(--border)]'}`}
                                                                            >
                                                                                {selectedForGroup.has(prod.id) ? <CheckSquare size={18} /> : <Square size={18} />}
                                                                            </button>
                                                                        ) : (
                                                                            <div {...provided.dragHandleProps} className="absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center text-[var(--border)] hover:text-[var(--text-muted)] cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--surface-2)]/50 rounded-l-xl z-10">
                                                                                <GripVertical size={20} />
                                                                            </div>
                                                                        )}
                                                                        <div className="w-20 h-20 bg-[var(--surface-2)] rounded-lg flex-shrink-0 overflow-hidden ml-4">
                                                                            {prod.image_url ? (
                                                                                <Image src={prod.image_url} alt="" width={80} height={80} className="w-full h-full object-cover"/>
                                                                            ) : (
                                                                                <div className="w-full h-full flex items-center justify-center text-[var(--border)]"><ImageIcon size={24}/></div>
                                                                            )}
                                                                        </div>
                                                                        <div className="flex-1">
                                                                            <div className="flex justify-between items-start gap-2">
                                                                                <h5 className="font-bold text-[var(--text)] flex items-center gap-1">
                                                                                    {prod.featured && (
                                                                                        <Star size={14} className="text-[var(--warn)] fill-[var(--warn)] flex-shrink-0" aria-label="Produto em destaque" />
                                                                                    )}
                                                                                    {prod.name}
                                                                                    {/* Achado da varredura (2026-07-07): promo_price/featured ja tinham
                                                                                        indicador aqui, so tags ficava sem — lojista com muitos produtos
                                                                                        nao tinha como saber quais tags estavam configuradas sem abrir o
                                                                                        modal de edicao um a um. */}
                                                                                    {prod.tags.length > 0 && (
                                                                                        <span
                                                                                            className="text-[12px]"
                                                                                            title={prod.tags.map(t => getTagDisplay(t).label).join(', ')}
                                                                                        >
                                                                                            {prod.tags.map(t => getTagDisplay(t).emoji).filter(Boolean).join(' ')}
                                                                                        </span>
                                                                                    )}
                                                                                </h5>
                                                                                {(() => {
                                                                                    const effectivePrice = getEffectivePrice(prod);
                                                                                    const hasActivePromo = effectivePrice < prod.price;
                                                                                    return hasActivePromo ? (
                                                                                        <span className="flex flex-col items-end leading-tight flex-shrink-0">
                                                                                            <span className="text-[11px] text-[var(--text-muted)] line-through">R$ {formatBRL(prod.price)}</span>
                                                                                            <span className="font-bold text-[var(--brand)]">R$ {formatBRL(effectivePrice)}</span>
                                                                                        </span>
                                                                                    ) : (
                                                                                        <span className="font-bold text-[var(--brand)] flex-shrink-0">R$ {formatBRL(prod.price)}</span>
                                                                                    );
                                                                                })()}
                                                                            </div>
                                                                            <p className="text-xs text-[var(--text-muted)] line-clamp-2 mt-1">{prod.description}</p>
                                                                            <div className="mt-2 flex gap-2">
                                                                                <button onClick={() => openProductModal(prod)} className="text-xs font-bold text-[var(--brand)] hover:underline u-motion">Editar</button>
                                                                                <button onClick={() => handleToggleAvailability(prod)} className={`text-xs font-bold hover:underline u-motion ${prod.available ? 'text-[var(--warn)]' : 'text-[var(--ok)]'}`}>
                                                                                    {prod.available ? 'Pausar' : 'Ativar'}
                                                                                </button>
                                                                                <button onClick={() => handleDeleteProduct(prod.id)} className="text-xs font-bold text-[var(--err)] hover:underline u-motion">Excluir</button>
                                                                            </div>
                                                                        </div>
                                                                        {!prod.available && (
                                                                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                                                <span className="bg-[var(--err)] text-white px-2 py-1 rounded text-xs font-bold transform -rotate-12 shadow-lg">INDISPONÍVEL</span>
                                                                            </div>
                                                                        )}
                                                                    </Card>
                                                                </div>
                                                            )}
                                                        </Draggable>
                                                    ))}
                                                    {provided.placeholder}
                                                </div>
                                            )}
                                        </Droppable>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                </DragDropContext>
            </section>

            {/* PRODUCT MODAL */}
            <Modal isOpen={isProductModalOpen} onClose={() => setIsProductModalOpen(false)} title={editingProduct ? 'Editar Produto' : 'Novo Produto'}>
                <div className="space-y-4">
                    <div className="flex gap-4 items-center">
                         <div className="w-24 h-24 bg-[var(--surface-2)] rounded-lg border-2 border-dashed border-[var(--border)] flex items-center justify-center overflow-hidden relative">
                             {pPreview ? (
                                 // pPreview pode ser um blob: local (arquivo recem-selecionado, antes do
                                 // upload) — o otimizador de imagem do Next não consegue buscar blob:
                                 // no servidor, entao pulamos a otimizacao so nesse caso.
                                 <Image src={pPreview} alt="" fill sizes="96px" className="object-cover" unoptimized={pPreview.startsWith('blob:')} />
                             ) : (
                                 <Camera className="text-[var(--border)]"/>
                             )}
                             <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" onChange={e => {
                                 const f = e.target.files?.[0];
                                 if(f) { setPFile(f); setPPreview(URL.createObjectURL(f)); }
                             }}/>
                         </div>
                         <div className="flex-1">
                             <Input label="Nome" value={pName} onChange={e => setPName(e.target.value)} />
                         </div>
                    </div>
                    {/* Fase 5, Task 16 (plano "Fora do Cardápio"): o campo já existia
                        (products.description, hoje só usado na busca) — vira "história
                        do prato" só com rótulo + campo maior, sem coluna nova. Trocado
                        de Input (uma linha) pra textarea: uma "história" raramente cabe
                        numa linha só, e o ProductModal (Task 16, ClientModule.tsx) agora
                        dá destaque tipográfico a esse texto. */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[13px] font-medium text-[var(--text-muted)]">
                            Descrição (opcional) — conte a história desse prato: origem, por que é especial, há quanto tempo está no cardápio
                        </label>
                        <textarea
                            className="w-full rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:border-[var(--brand)] transition-all"
                            rows={3}
                            value={pDesc}
                            onChange={e => setPDesc(e.target.value)}
                        />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Input label="Preço (R$)" type="number" step="0.01" min="0" value={pPrice} onChange={e => setPPrice(e.target.value)} />
                        <Input
                            label="Preço promocional (opcional)"
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="Deixe em branco pra não ter promoção"
                            value={pPromoPrice}
                            onChange={e => setPPromoPrice(e.target.value)}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-semibold text-[var(--text)]">Categoria</label>
                            <select className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--brand)]/30" value={pCat} onChange={e => setPCat(e.target.value)}>
                                <option value="" disabled>Selecione...</option>
                                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                         <Input label="Tempo Preparo (min)" type="number" min="0" value={pTime} onChange={e => setPTime(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                         <div className="flex flex-col gap-1.5">
                             <label className="text-sm font-semibold text-[var(--text)]">Destino do Pedido</label>
                             <select className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--brand)]/30" value={pDestination} onChange={e => setPDestination(e.target.value as 'kitchen' | 'bar')}>
                                 <option value="kitchen">Cozinha</option>
                                 <option value="bar">Bar</option>
                             </select>
                         </div>
                         <Input
                             label="NCM (opcional)"
                             placeholder="Ex: 2106.90.10"
                             value={pNcm}
                             onChange={e => setPNcm(e.target.value)}
                         />
                    </div>

                    {/* Cadastro de produto unificado, Direção 1 (2026-08-16)
                        — só na criação, não em editar (edição de omie_codigo
                        continua fora de escopo, ver AGENTS.md). */}
                    {!editingProduct && (
                        <label className="flex items-center gap-2 p-3 bg-[var(--surface-2)] rounded-lg border border-[var(--border)] cursor-pointer">
                            <input
                                type="checkbox"
                                checked={pCriarNoEstoque}
                                onChange={e => setPCriarNoEstoque(e.target.checked)}
                                className="accent-[var(--brand)]"
                            />
                            <span className="text-sm text-[var(--text)]">Criar no NTB Estoque também</span>
                        </label>
                    )}

                    {/* Destaque e etiquetas (migration 019, cardapio que vende) —
                        tudo configuravel pelo lojista aqui mesmo, sem Master Admin. */}
                    <div className="flex items-center justify-between p-3 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
                        <div>
                            <h4 className="font-bold text-sm text-[var(--text)]">⭐ Destacar no topo do cardápio</h4>
                            <p className="text-xs text-[var(--text-muted)]">Produtos destacados aparecem numa vitrine especial no topo do cardápio do cliente.</p>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={pFeatured}
                            aria-label="Destacar no topo do cardápio"
                            onClick={() => setPFeatured(prev => !prev)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full flex-shrink-0 transition-colors ${pFeatured ? 'bg-[var(--ok)]' : 'bg-[var(--border)]'}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${pFeatured ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>

                    <div>
                        <label className="text-sm font-semibold text-[var(--text)] block mb-1.5">Etiquetas</label>
                        <div className="flex flex-wrap gap-2">
                            {Object.entries(PRODUCT_TAGS).map(([key, tag]) => (
                                <label
                                    key={key}
                                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer u-motion has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--brand)] has-[:focus-visible]:ring-offset-1 ${
                                        pTags.includes(key) ? 'border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]' : 'border-[var(--border)] text-[var(--text-muted)]'
                                    }`}
                                >
                                    {/* sr-only (não `hidden`/display:none) pra continuar focável via
                                        Tab/Espaço — checkbox escondido só visualmente, o <label> em
                                        volta mostra o foco via has-[:focus-visible] acima. */}
                                    <input type="checkbox" className="sr-only" checked={pTags.includes(key)} onChange={() => toggleProductTag(key)} />
                                    <span aria-hidden="true">{tag.emoji}</span> {tag.label}
                                </label>
                            ))}
                        </div>
                        <p className="text-xs text-[var(--text-muted)] mt-1">Aparecem como badge no cardápio do cliente, ao lado do nome do produto.</p>
                    </div>

                    {/* Vende mais II (migration 020) — "peca tambem": cross-sell manual
                        entre produtos da mesma loja. Rascunho local (pRecommendedIds),
                        so' persiste via updateProductRecommendations dentro de
                        handleSaveProduct, depois que o productId ja' esta' resolvido. */}
                    <div className="border-t border-[var(--border)] pt-4">
                        <h4 className="font-bold text-sm text-[var(--text)]">Sugerir junto (opcional)</h4>
                        <p className="text-xs text-[var(--text-muted)] mb-2">
                            Escolha até {MAX_RECOMMENDATIONS} produtos da loja pra aparecer como "Peça também" quando o
                            cliente abrir este produto no cardápio.
                        </p>
                        <Input
                            placeholder="Buscar produto..."
                            aria-label="Buscar produto para recomendar"
                            value={pRecommendationSearch}
                            onChange={e => setPRecommendationSearch(e.target.value)}
                            className="mb-2"
                        />
                        <div className="max-h-48 overflow-y-auto space-y-1 border border-[var(--border)] rounded-lg p-2 bg-[var(--surface-2)]">
                            {filteredRecommendableProducts.length === 0 && (
                                <p className="text-xs text-[var(--text-muted)] italic p-1.5">
                                    {recommendableProducts.length === 0 ? 'Nenhum outro produto cadastrado nesta loja ainda.' : 'Nenhum produto encontrado.'}
                                </p>
                            )}
                            {filteredRecommendableProducts.map(p => {
                                const checked = pRecommendedIds.includes(p.id);
                                const limitReached = !checked && pRecommendedIds.length >= MAX_RECOMMENDATIONS;
                                return (
                                    <label
                                        key={p.id}
                                        title={limitReached ? `Limite de ${MAX_RECOMMENDATIONS} produtos recomendados atingido — desmarque algum pra trocar.` : undefined}
                                        className={`flex items-center gap-2 px-2 py-1.5 min-h-11 rounded-md text-sm u-motion ${
                                            limitReached ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--surface)]'
                                        } ${checked ? 'text-[var(--brand)] font-semibold' : 'text-[var(--text)]'}`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            disabled={limitReached}
                                            onChange={() => toggleRecommendedProduct(p.id)}
                                        />
                                        {p.name}
                                    </label>
                                );
                            })}
                        </div>
                        <p className="text-xs text-[var(--text-muted)] mt-1">{pRecommendedIds.length}/{MAX_RECOMMENDATIONS} selecionados.</p>
                    </div>

                    <div className="border-t border-[var(--border)] pt-4">
                        <div className="flex justify-between items-center mb-2">
                            <h4 className="font-bold text-sm text-[var(--text)]">Adicionais deste produto</h4>
                            <button type="button" onClick={addOptionGroup} className="text-xs font-bold text-[var(--brand)] hover:underline">
                                + Grupo de opção
                            </button>
                        </div>
                        {pOptionGroups.length === 0 && (
                            <p className="text-xs text-[var(--text-muted)] italic">Nenhum grupo de opção (ex: "Escolha a borda").</p>
                        )}
                        {pOptionGroups.map(group => (
                            <div key={group.tempId} className="border border-[var(--border)] rounded-lg p-3 mb-3 space-y-2 bg-[var(--surface-2)]">
                                <div className="flex gap-2 items-center">
                                    <Input placeholder='Nome do grupo (ex: "Escolha a borda")' value={group.name}
                                        onChange={e => updateOptionGroup(group.tempId, { name: e.target.value })} className="flex-1" />
                                    <button type="button" onClick={() => removeOptionGroup(group.tempId)} className="text-[var(--err)]/60 hover:text-[var(--err)]"><Trash2 size={14}/></button>
                                </div>
                                <div className="flex gap-3 items-center text-xs flex-wrap">
                                    <label className="flex items-center gap-1">
                                        <input type="radio" checked={group.type === 'single'} onChange={() => updateOptionGroup(group.tempId, { type: 'single' })}/> Escolha 1
                                    </label>
                                    <label className="flex items-center gap-1">
                                        <input type="radio" checked={group.type === 'multiple'} onChange={() => updateOptionGroup(group.tempId, { type: 'multiple' })}/> Escolha vários
                                    </label>
                                    <label className="ml-auto flex items-center gap-1">
                                        <input type="checkbox" checked={group.required} onChange={e => updateOptionGroup(group.tempId, { required: e.target.checked })}/> Obrigatório
                                    </label>
                                </div>
                                <p className="text-xs text-[var(--text-muted)]">
                                    "Escolha 1" mostra um seletor único (rádio) para o cliente; "Escolha vários" mostra
                                    caixas de seleção (checkbox), permitindo marcar mais de uma opção. Marcar
                                    "Obrigatório" bloqueia o botão "+" de adição rápida no cardápio do cliente — ele
                                    precisa abrir o produto e escolher antes de adicionar ao carrinho.
                                </p>
                                {group.type === 'multiple' && (
                                    <div className="flex gap-2 items-center">
                                        <Input placeholder="Mínimo" type="number" min="0" value={group.min_select}
                                            onChange={e => updateOptionGroup(group.tempId, { min_select: e.target.value })} className="w-24" />
                                        <Input placeholder="Máximo" type="number" min="0" value={group.max_select}
                                            onChange={e => updateOptionGroup(group.tempId, { max_select: e.target.value })} className="w-24" />
                                        <span className="text-xs text-[var(--text-muted)]">Vazio = sem limite de seleção</span>
                                    </div>
                                )}
                                <DragDropContext onDragEnd={handleOptionDragEnd}>
                                    <Droppable droppableId={group.tempId} type="option">
                                        {(provided) => (
                                            <div className="space-y-2" {...provided.droppableProps} ref={provided.innerRef}>
                                                {group.options.map((opt, index) => (
                                                    <Draggable key={opt.tempId} draggableId={opt.tempId} index={index}>
                                                        {(provided, snapshot) => (
                                                            <div
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                                className={`flex gap-2 items-center pl-1 ${snapshot.isDragging ? 'bg-[var(--surface)] rounded ring-1 ring-[var(--brand)]' : ''}`}
                                                            >
                                                                <div {...provided.dragHandleProps} className="text-[var(--text-muted)] hover:text-[var(--text)] cursor-grab active:cursor-grabbing">
                                                                    <GripVertical size={14} />
                                                                </div>
                                                                <Input placeholder='Opção (ex: "Catupiry")' value={opt.name}
                                                                    onChange={e => updateOption(group.tempId, opt.tempId, { name: e.target.value })} className="flex-1" />
                                                                <Input placeholder="+R$" type="number" step="0.01" min="0" value={opt.price_delta}
                                                                    onChange={e => updateOption(group.tempId, opt.tempId, { price_delta: e.target.value })} className="w-24" />
                                                                <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                                                                    <input type="checkbox" checked={opt.available} onChange={e => updateOption(group.tempId, opt.tempId, { available: e.target.checked })}/> Disponível
                                                                </label>
                                                                <button type="button" onClick={() => removeOption(group.tempId, opt.tempId)} className="text-[var(--err)]/60 hover:text-[var(--err)]"><X size={14}/></button>
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                ))}
                                                {provided.placeholder}
                                            </div>
                                        )}
                                    </Droppable>
                                </DragDropContext>
                                <button type="button" onClick={() => addOption(group.tempId)} className="text-xs font-bold text-[var(--brand)] hover:underline pl-3">+ Opção</button>
                            </div>
                        ))}
                    </div>

                    <Button className="w-full h-12 mt-4" onClick={handleSaveProduct} isLoading={isLoading}>Salvar Produto</Button>
                </div>
            </Modal>

            {/* CATEGORY SCHEDULE MODAL */}
            <Modal isOpen={!!scheduleCategory} onClose={() => setScheduleCategory(null)} title={`Horário — ${scheduleCategory?.name || ''}`}>
                <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
                        <div>
                            <h4 className="font-bold text-sm text-[var(--text)]">Disponível o dia todo</h4>
                            <p className="text-xs text-[var(--text-muted)]">Desligue para restringir esta categoria a um horário e/ou dias específicos.</p>
                        </div>
                        <button
                            onClick={() => setScheduleAllDay(prev => !prev)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full flex-shrink-0 transition-colors ${scheduleAllDay ? 'bg-[var(--ok)]' : 'bg-[var(--border)]'}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${scheduleAllDay ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>

                    {!scheduleAllDay && (
                        <>
                            <div className="grid grid-cols-2 gap-4">
                                <Input label="Das" type="time" value={scheduleFrom} onChange={e => setScheduleFrom(e.target.value)} />
                                <Input label="Até" type="time" value={scheduleUntil} onChange={e => setScheduleUntil(e.target.value)} />
                            </div>
                            <div>
                                <label className="text-sm font-semibold text-[var(--text)] block mb-1.5">Dias da semana</label>
                                <div className="flex flex-wrap gap-2">
                                    {SCHEDULE_DAY_LABELS.map((label, day) => (
                                        <label
                                            key={day}
                                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer u-motion ${
                                                scheduleDays.includes(day) ? 'border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]' : 'border-[var(--border)] text-[var(--text-muted)]'
                                            }`}
                                        >
                                            <input type="checkbox" className="hidden" checked={scheduleDays.includes(day)} onChange={() => toggleScheduleDay(day)} />
                                            {label}
                                        </label>
                                    ))}
                                </div>
                                <p className="text-xs text-[var(--text-muted)] mt-1">Nenhum dia marcado = todos os dias.</p>
                            </div>
                        </>
                    )}

                    <Button className="w-full h-12 mt-2" onClick={handleSaveSchedule} isLoading={isSavingSchedule}>Salvar</Button>
                </div>
            </Modal>

            {/* AGRUPAR VARIAÇÕES MODAL — consolidar produtos soltos num
                produto-pai com grupo de escolha (ver consolidateProductsIntoVariants). */}
            <Modal isOpen={groupModalOpen} onClose={() => setGroupModalOpen(false)} title="Agrupar como variações">
                <div className="space-y-4">
                    <p className="text-sm text-[var(--text-muted)]">
                        Escolha qual produto vira a base (os outros ficam ocultos do cardápio, sem apagar nada) e dê um
                        nome pro grupo de escolha.
                    </p>

                    <Input
                        label="Nome do grupo"
                        placeholder='Ex: "Qual sabor?"'
                        value={groupNameInput}
                        onChange={e => setGroupNameInput(e.target.value)}
                    />

                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-[var(--text)]">Produto base (preço de partida)</label>
                        {selectedGroupProducts.map(p => {
                            const base = selectedGroupProducts.find(b => b.id === groupBaseId);
                            const delta = base ? Math.max(0, p.price - base.price) : 0;
                            return (
                                <label key={p.id} className="flex items-center justify-between gap-3 p-3 bg-[var(--surface-2)] rounded-lg border border-[var(--border)] cursor-pointer">
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="radio"
                                            name="groupBase"
                                            checked={groupBaseId === p.id}
                                            onChange={() => setGroupBaseId(p.id)}
                                        />
                                        <div>
                                            <p className="text-sm font-medium text-[var(--text)]">{p.name}</p>
                                            <p className="text-xs text-[var(--text-muted)]">R$ {formatBRL(p.price)}{p.omie_codigo ? ` · Omie ${p.omie_codigo}` : ''}</p>
                                        </div>
                                    </div>
                                    {groupBaseId !== p.id && (
                                        <span className="text-xs font-bold text-[var(--brand)] flex-shrink-0">+ R$ {formatBRL(delta)}</span>
                                    )}
                                </label>
                            );
                        })}
                    </div>

                    <Button className="w-full h-12" onClick={handleConsolidateGroup} isLoading={isConsolidating}>
                        Agrupar {selectedGroupProducts.length} produtos
                    </Button>
                </div>
            </Modal>
        </div>
    );
};

// --- MAIN MODULE ---

// --- SUB-MODULE: USER MANAGEMENT ---

// Task 4 (módulo Caixa): extraído pra fora do componente pra poder ser
// espalhado (`...DEFAULT_TEAM_PERMISSIONS`) — literal + spread do MESMO
// tipo na mesma chamada de objeto (ex.: `{ tables: true, ...user.permissions }`)
// dá erro de TS ("specified more than once"), então o default precisa vir
// só de um spread também, nunca de chaves individuais ao lado de um spread.
const DEFAULT_TEAM_PERMISSIONS = {
    tables: true,
    counter: false,
    kitchen: false,
    bar: false,
    menu: false,
    admin: false,
    caixa: false,
    supervisiona_caixa: false,
};

// Presets de permissão por função real (Fase 1, Task 2 — plano "Fora do
// Cardápio"): cadastrar um garçom hoje é marcar checkbox um a um. Um preset
// só PRÉ-MARCA — nunca esconde o formulário nem impede ajuste fino depois.
// Só aparece pra usuário NOVO (editar um já existente nunca reseta
// permissão que o admin configurou com cuidado antes).
const TEAM_PERMISSION_PRESETS: Record<string, { label: string; permissions: typeof DEFAULT_TEAM_PERMISSIONS }> = {
    garcom_so_serve: { label: 'Garçom que só serve', permissions: { ...DEFAULT_TEAM_PERMISSIONS, tables: true, caixa: false } },
    garcom_recebe: { label: 'Garçom que também recebe', permissions: { ...DEFAULT_TEAM_PERMISSIONS, tables: true, caixa: true } },
    caixa_fixo: { label: 'Caixa fixo', permissions: { ...DEFAULT_TEAM_PERMISSIONS, tables: true, counter: true, caixa: true } },
};

const UserManagementView: React.FC<{ storeId: string }> = ({ storeId }) => {
    const [users, setUsers] = useState<StoreUser[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<StoreUser | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Form State
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('waiter');
    const [permissions, setPermissions] = useState({ ...DEFAULT_TEAM_PERMISSIONS });
    // Jurisdicao de mesas por garcom (Task 3, migration 049). `restrictTables
    // = false` grava `null` (sem restricao, "Todas as mesas") — o mesmo
    // valor que TODO store_user real ja tem hoje. So' faz sentido pra
    // role 'waiter'/'cashier' (seção abaixo escondida pros outros papéis),
    // mas o state existe sempre pra não perder seleção ao trocar de role
    // no mesmo formulário.
    const [restrictTables, setRestrictTables] = useState(false);
    const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
    const [storeTables, setStoreTables] = useState<Table[]>([]);

    const loadUsers = async () => {
        const data = await fetchStoreTeamMembers(storeId);
        setUsers(data);
    };

    useEffect(() => { loadUsers(); }, [storeId]);
    useEffect(() => { fetchTables(storeId).then(setStoreTables); }, [storeId]);

    const openModal = (user?: StoreUser) => {
        if (user) {
            setEditingUser(user);
            setName(user.name);
            setEmail(user.email);
            setRole(user.role);
            // Fix round 3 (Group C2): antes disto, chaves ausentes em
            // user.permissions herdavam DEFAULT_TEAM_PERMISSIONS — pensado
            // pro formulário de usuário NOVO (tables=true, resto=false) —,
            // mas em runtime (lib/storeModules.ts, hasTabPermission)
            // ausência de chave sempre significou PERMITIDO (`!== false`),
            // nunca negado. Um store_user real com uma das 6 permissões
            // históricas ausente (nunca gravada explicitamente) mostrava o
            // checkbox DESMARCADO mesmo tendo acesso de verdade hoje — e
            // "Salvar" sem tocar em nada gravava `false` explícito,
            // revogando silenciosamente um acesso que o admin nem sabia
            // estar mexendo.
            //
            // Corrigido aqui (na seed do formulário), não no momento de
            // salvar: o checkbox passa a refletir o acesso EFETIVO atual,
            // com a MESMA regra que hasTabPermission usa pra decidir se o
            // usuário acessa a aba — ausência vira `true` explícito
            // (preserva o acesso que já existia), e só um clique
            // deliberado no checkbox muda o que será salvo. Isso faz "o
            // que o admin vê é o que é salvo" valer nas duas direções: o
            // checkbox mostra o acesso real de hoje, e salvar sem tocar
            // não muda nada. `caixa` é o oposto por natureza (nunca existiu
            // em store_user real antes desta feature, ausência SEMPRE
            // significou negado — ver StoreUserPermissions em
            // types/index.ts) — mantido `=== true`, igual a
            // hasTabPermission/canFinalizeBill.
            setPermissions({
                tables: user.permissions?.tables !== false,
                counter: user.permissions?.counter !== false,
                kitchen: user.permissions?.kitchen !== false,
                bar: user.permissions?.bar !== false,
                menu: user.permissions?.menu !== false,
                admin: user.permissions?.admin !== false,
                caixa: user.permissions?.caixa === true,
                supervisiona_caixa: user.permissions?.supervisiona_caixa === true,
            });
            setPassword(''); // Don't show password
            const assignedIds = user.assigned_table_ids;
            setRestrictTables(!!(assignedIds && assignedIds.length > 0));
            setSelectedTableIds(assignedIds || []);
        } else {
            setEditingUser(null);
            setName('');
            setEmail('');
            setPassword('');
            setRole('waiter');
            setPermissions({ ...DEFAULT_TEAM_PERMISSIONS });
            setRestrictTables(false);
            setSelectedTableIds([]);
        }
        setIsModalOpen(true);
    };

    const toggleTableSelection = (tableId: string) => {
        setSelectedTableIds(prev => prev.includes(tableId) ? prev.filter(id => id !== tableId) : [...prev, tableId]);
    };

    const handleSave = async () => {
        if (!name || !email || (!editingUser && !password)) return toast.error('Preencha os campos obrigatórios');
        setIsLoading(true);
        try {
            // Jurisdicao de mesas (Task 3): restrictTables=false ou lista
            // vazia sempre grava null ("Todas as mesas") — nunca um array
            // vazio, que a function `update_store_user_secure` já trata como
            // sinônimo de null, mas fica explícito aqui pra não depender
            // disso silenciosamente.
            const assignedTableIds = restrictTables && selectedTableIds.length > 0 ? selectedTableIds : null;
            const userData = { name, email, role, permissions, assigned_table_ids: assignedTableIds, ...(password ? { password } : {}) };

            if (editingUser) {
                await updateStoreTeamMember(editingUser.id, userData);
            } else {
                await createStoreTeamMember(storeId, { ...userData, assignedTableIds });
            }
            setIsModalOpen(false);
            loadUsers();
        } catch (e: any) {
            toast.error('Erro ao salvar: ' + e.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (await confirm({ message: 'Tem certeza que deseja excluir este usuário?', variant: 'danger', confirmLabel: 'Excluir' })) {
            await deleteStoreTeamMember(id);
            loadUsers();
        }
    };

    const togglePermission = (key: keyof typeof permissions) => {
        setPermissions(prev => ({ ...prev, [key]: !prev[key] }));
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="font-bold text-lg text-[var(--text)]">Usuários do Sistema</h3>
                <Button onClick={() => openModal()}><Plus size={18} className="mr-1"/> Novo Usuário</Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                {users.map(user => (
                    <Card key={user.id} className="p-4 border border-[var(--border)] shadow-sm relative group">
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <h4 className="font-bold text-[var(--text)]">{user.name}</h4>
                                <p className="text-xs text-[var(--text-muted)]">{user.email}</p>
                            </div>
                            <Badge color="bg-[var(--info)]/10 text-[var(--info)] border-[var(--info)]/20 uppercase text-[10px]">{getRoleLabel(user.role)}</Badge>
                        </div>

                        <div className="mt-3 space-y-1">
                            <p className="text-xs font-bold text-[var(--text-muted)] uppercase">Acessos:</p>
                            <div className="flex flex-wrap gap-1">
                                {user.permissions?.tables && <span className="px-1.5 py-0.5 bg-[var(--ok)]/10 text-[var(--ok)] text-[10px] rounded border border-[var(--ok)]/20">Mesas</span>}
                                {user.permissions?.counter && <span className="px-1.5 py-0.5 bg-[var(--warn)]/10 text-[var(--warn)] text-[10px] rounded border border-[var(--warn)]/20">Balcão</span>}
                                {user.permissions?.kitchen && <span className="px-1.5 py-0.5 bg-[var(--err)]/10 text-[var(--err)] text-[10px] rounded border border-[var(--err)]/20">Cozinha</span>}
                                {user.permissions?.bar && <span className="px-1.5 py-0.5 bg-[var(--info)]/10 text-[var(--info)] text-[10px] rounded border border-[var(--info)]/20">Bar</span>}
                                {user.permissions?.menu && <span className="px-1.5 py-0.5 bg-[var(--brand)]/10 text-[var(--brand)] text-[10px] rounded border border-[var(--brand)]/20">Cardápio</span>}
                                {user.permissions?.admin && <span className="px-1.5 py-0.5 bg-[var(--surface-2)] text-[var(--text)] text-[10px] rounded border border-[var(--border)]">Admin</span>}
                                {user.permissions?.caixa && <span className="px-1.5 py-0.5 bg-[var(--ok)]/15 text-[var(--ok)] text-[10px] rounded border border-[var(--ok)]/30 font-bold">Caixa</span>}
                            </div>
                        </div>

                        <div className="mt-4 flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="outline" className="h-8 text-xs" onClick={() => openModal(user)}>Editar</Button>
                            <Button variant="outline" className="h-8 text-xs text-[var(--err)] border-[var(--err)]/20 hover:bg-[var(--err)]/5" onClick={() => handleDelete(user.id)}>Excluir</Button>
                        </div>
                    </Card>
                ))}
            </div>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingUser ? 'Editar Usuário' : 'Novo Usuário'}>
                <div className="space-y-4">
                    <Input label="Nome Completo" value={name} onChange={e => setName(e.target.value)} />
                    <Input label="Email de Acesso" type="email" value={email} onChange={e => setEmail(e.target.value)} />
                    <Input label={editingUser ? "Nova Senha (opcional)" : "Senha"} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={editingUser ? "Deixe em branco para manter" : "******"} />
                    
                    <div>
                        <label className="text-sm font-semibold text-[var(--text)] mb-1 block">Função</label>
                        <select className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm" value={role} onChange={e => setRole(e.target.value)}>
                            <option value="waiter">Garçom</option>
                            <option value="cashier">Caixa</option>
                            <option value="cook">Cozinheiro</option>
                            <option value="attendant">Atendente</option>
                            <option value="manager">Gerente</option>
                        </select>
                    </div>

                    <div className="bg-[var(--surface-2)] p-3 rounded-lg border border-[var(--border)]">
                        <label className="text-sm font-bold text-[var(--text)] mb-2 block">Permissões de Acesso</label>
                        {!editingUser && (
                            <div className="flex flex-wrap gap-1.5 mb-3">
                                {Object.entries(TEAM_PERMISSION_PRESETS).map(([key, preset]) => (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => setPermissions({ ...preset.permissions })}
                                        className="px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--surface)] text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--brand)]/40 u-motion u-press-sm"
                                    >
                                        {preset.label}
                                    </button>
                                ))}
                            </div>
                        )}
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="checkbox" checked={permissions.tables} onChange={() => togglePermission('tables')} className="rounded text-[var(--brand)] focus:ring-[var(--brand)]" />
                                Gestão de Mesas
                            </label>
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="checkbox" checked={permissions.counter} onChange={() => togglePermission('counter')} className="rounded text-[var(--brand)] focus:ring-[var(--brand)]" />
                                Gestão de Balcão
                            </label>
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="checkbox" checked={permissions.kitchen} onChange={() => togglePermission('kitchen')} className="rounded text-[var(--brand)] focus:ring-[var(--brand)]" />
                                Cozinha (KDS)
                            </label>
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="checkbox" checked={permissions.bar} onChange={() => togglePermission('bar')} className="rounded text-[var(--brand)] focus:ring-[var(--brand)]" />
                                Bar (KDS)
                            </label>
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="checkbox" checked={permissions.menu} onChange={() => togglePermission('menu')} className="rounded text-[var(--brand)] focus:ring-[var(--brand)]" />
                                Gestão de Cardápio
                            </label>
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="checkbox" checked={permissions.admin} onChange={() => togglePermission('admin')} className="rounded text-[var(--brand)] focus:ring-[var(--brand)]" />
                                Administração (Relatórios e Usuários)
                            </label>
                            <label className="flex items-center gap-2 text-sm cursor-pointer border-t border-[var(--border)] pt-2 mt-1">
                                <input type="checkbox" checked={!!permissions.caixa} onChange={() => togglePermission('caixa')} className="rounded text-[var(--brand)] focus:ring-[var(--brand)]" />
                                Caixa (finaliza pagamento das mesas)
                            </label>
                            <p className="text-[11px] text-[var(--text-muted)] pl-6 -mt-1">
                                Sem esta permissão, o usuário vê e gerencia mesas normalmente, mas só pode
                                pedir a conta — quem finaliza e recebe o pagamento é sempre o caixa.
                            </p>
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="checkbox" checked={!!permissions.supervisiona_caixa} onChange={() => togglePermission('supervisiona_caixa')} className="rounded text-[var(--brand)] focus:ring-[var(--brand)]" />
                                Supervisiona caixa
                            </label>
                            <p className="text-[11px] text-[var(--text-muted)] pl-6 -mt-1">
                                Vê o valor esperado ao fechar o próprio caixa mesmo com contagem cega ligada, e pode aprovar o fechamento de qualquer operador quando a diferença passa do limite configurado.
                            </p>
                        </div>
                    </div>

                    {/* Jurisdicao de mesas por garcom (Task 3, migration 049) —
                        só faz sentido pra quem de fato opera mesa em campo.
                        Reaproveita o MESMO padrão visual do bloco de
                        Permissões acima (checkbox list em card cinza), como
                        pedido no brief: nenhum componente novo. */}
                    {(role === 'waiter' || role === 'cashier') && (
                        <div className="bg-[var(--surface-2)] p-3 rounded-lg border border-[var(--border)]">
                            <label className="text-sm font-bold text-[var(--text)] mb-2 block">Jurisdição de Mesas</label>
                            <label className="flex items-center gap-2 text-sm cursor-pointer mb-2">
                                <input
                                    type="checkbox"
                                    checked={!restrictTables}
                                    onChange={() => setRestrictTables(prev => !prev)}
                                    className="rounded text-[var(--brand)] focus:ring-[var(--brand)]"
                                />
                                Todas as mesas (sem restrição)
                            </label>
                            {restrictTables && (
                                <div className="space-y-2 border-t border-[var(--border)] pt-2 mt-1">
                                    <p className="text-[11px] text-[var(--text-muted)]">
                                        Escolha as mesas que este usuário pode operar. Mesas fora da
                                        seleção continuam visíveis pra ele, só ficam bloqueadas.
                                    </p>
                                    {storeTables.length === 0 ? (
                                        <p className="text-xs text-[var(--text-muted)] italic">Nenhuma mesa cadastrada nesta loja.</p>
                                    ) : (
                                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                                            {storeTables.sort((a, b) => a.number - b.number).map(t => (
                                                <label key={t.id} className={`flex items-center justify-center gap-1 text-sm rounded-lg border px-2 py-1.5 cursor-pointer u-motion ${
                                                    selectedTableIds.includes(t.id)
                                                        ? 'bg-[var(--brand)]/10 border-[var(--brand)] text-[var(--brand)] font-bold'
                                                        : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)]'
                                                }`}>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedTableIds.includes(t.id)}
                                                        onChange={() => toggleTableSelection(t.id)}
                                                        className="sr-only"
                                                    />
                                                    {t.number}
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <Button className="w-full mt-2" onClick={handleSave} isLoading={isLoading}>Salvar Usuário</Button>
                </div>
            </Modal>
        </div>
    );
};

// --- SUB-MODULE: ADMIN (SALES HISTORY) ---

const StoreAdminView: React.FC<{ store: Store; onStoreUpdate?: (store: Store) => void }> = ({ store, onStoreUpdate }) => {
    const storeId = store.id;

    // Aba "Operação" (self-service de módulos/fluxo de pedido pelo
    // lojista) REMOVIDA (2026-08-28, pedido direto do dono): decidir
    // mesa/balcão, número de mesas e quais módulos a loja usa é uma
    // decisão comercial ligada ao plano contratado — só o Master Admin
    // (AdminModule.tsx, "Editar Loja", que já tem os mesmos controles)
    // pode mudar isso. Existiu por ~1 dia (2026-08-27) antes desta
    // reversão.

    // Certificado digital + Configuração do Emissor Fiscal — mesma tela que
    // já existe pro Master Admin (AdminModule.tsx), aberta pro lojista
    // também. Vive aqui (aba "Notas Fiscais" de Administração) e não em
    // Cardápio (MenuManagementView) — pedido explícito do usuário
    // (2026-08-16): "deveria estar em adm e não em cardápio" queria dizer
    // a aba Administração do próprio painel do lojista, não tirar do
    // lojista de vez (isso foi mal-entendido numa primeira tentativa e
    // corrigido na mesma sessão). Mesmo padrão de estado/handlers,
    // duplicado de propósito (arquivo diferente do AdminModule.tsx, sem
    // componente compartilhado).

    // Certificado Digital Fiscal State
    const [certFile, setCertFile] = useState<File | null>(null);
    const [certPassword, setCertPassword] = useState('');
    const [certExpiresAt, setCertExpiresAt] = useState('');
    const [certStatus, setCertStatus] = useState<StoreFiscalCertificateStatus | null>(null);
    const [isSavingCert, setIsSavingCert] = useState(false);

    // Configuração do Emissor Fiscal State (store_fiscal_config, migration
    // 024 + 025) — campos numéricos ficam como string pra bind de <input>
    // controlado, convertidos com Number(...) só na hora de montar o
    // payload de save. CSC/CSCID nunca voltam do banco (write-only),
    // sempre começam vazios.
    const [fiscalAmbiente, setFiscalAmbiente] = useState<'homologacao' | 'producao'>('homologacao');
    const [fiscalModeloEmissaoAutomatica, setFiscalModeloEmissaoAutomatica] = useState<'nenhuma' | 'nfce' | 'nfe'>('nenhuma');
    const [fiscalNfeSerie, setFiscalNfeSerie] = useState('');
    const [fiscalNfceSerie, setFiscalNfceSerie] = useState('');
    const [fiscalCteSerie, setFiscalCteSerie] = useState('');
    const [fiscalMdfeSerie, setFiscalMdfeSerie] = useState('');
    const [fiscalNfeUltimoNumero, setFiscalNfeUltimoNumero] = useState('');
    const [fiscalNfceUltimoNumero, setFiscalNfceUltimoNumero] = useState('');
    const [fiscalCteUltimoNumero, setFiscalCteUltimoNumero] = useState('');
    const [fiscalMdfeUltimoNumero, setFiscalMdfeUltimoNumero] = useState('');
    const [fiscalInscricaoMunicipal, setFiscalInscricaoMunicipal] = useState('');
    const [fiscalTelefone, setFiscalTelefone] = useState('');
    const [fiscalCasasDecimais, setFiscalCasasDecimais] = useState('2');
    const [fiscalCnpjAutorizado, setFiscalCnpjAutorizado] = useState('');
    const [fiscalObservacaoNfe, setFiscalObservacaoNfe] = useState('');
    const [fiscalObservacaoPedido, setFiscalObservacaoPedido] = useState('');
    const [fiscalCscHomologacao, setFiscalCscHomologacao] = useState('');
    const [fiscalCscidHomologacao, setFiscalCscidHomologacao] = useState('');
    const [fiscalCscProducao, setFiscalCscProducao] = useState('');
    const [fiscalCscidProducao, setFiscalCscidProducao] = useState('');
    // Identificação da empresa (migration 025)
    const [fiscalRazaoSocial, setFiscalRazaoSocial] = useState('');
    const [fiscalNomeFantasia, setFiscalNomeFantasia] = useState('');
    const [fiscalTipoPessoa, setFiscalTipoPessoa] = useState<'juridica' | 'fisica'>('juridica');
    const [fiscalInscricaoEstadual, setFiscalInscricaoEstadual] = useState('');
    const [fiscalEnderecoLogradouro, setFiscalEnderecoLogradouro] = useState('');
    const [fiscalEnderecoNumero, setFiscalEnderecoNumero] = useState('');
    const [fiscalEnderecoComplemento, setFiscalEnderecoComplemento] = useState('');
    const [fiscalEnderecoBairro, setFiscalEnderecoBairro] = useState('');
    const [fiscalEnderecoCidade, setFiscalEnderecoCidade] = useState('');
    const [fiscalEnderecoUf, setFiscalEnderecoUf] = useState('');
    const [fiscalEnderecoCep, setFiscalEnderecoCep] = useState('');
    // Padrões de impostos (migration 025) — default por loja, não
    // classificação por produto/NCM (isso continua fora de escopo).
    const [fiscalCstCsosnPadrao, setFiscalCstCsosnPadrao] = useState('');
    const [fiscalCstPisPadrao, setFiscalCstPisPadrao] = useState('');
    const [fiscalCstCofinsPadrao, setFiscalCstCofinsPadrao] = useState('');
    const [fiscalCstIpiPadrao, setFiscalCstIpiPadrao] = useState('');
    const [fiscalFretePadrao, setFiscalFretePadrao] = useState('');
    const [fiscalTipoPagamentoPadrao, setFiscalTipoPagamentoPadrao] = useState('');
    const [fiscalNaturezaOperacaoPadrao, setFiscalNaturezaOperacaoPadrao] = useState('');
    const [isSavingFiscalConfig, setIsSavingFiscalConfig] = useState(false);

    const loadFiscalData = async () => {
        setCertStatus(await fetchStoreCertificateStatus(storeId));

        const fiscalConfig = await fetchStoreFiscalConfig(storeId);
        if (fiscalConfig) {
            setFiscalAmbiente(fiscalConfig.ambiente);
            setFiscalModeloEmissaoAutomatica(fiscalConfig.modelo_emissao_automatica || 'nenhuma');
            setFiscalNfeSerie(fiscalConfig.nfe_serie != null ? String(fiscalConfig.nfe_serie) : '');
            setFiscalNfceSerie(fiscalConfig.nfce_serie != null ? String(fiscalConfig.nfce_serie) : '');
            setFiscalCteSerie(fiscalConfig.cte_serie != null ? String(fiscalConfig.cte_serie) : '');
            setFiscalMdfeSerie(fiscalConfig.mdfe_serie != null ? String(fiscalConfig.mdfe_serie) : '');
            setFiscalNfeUltimoNumero(String(fiscalConfig.nfe_ultimo_numero ?? 0));
            setFiscalNfceUltimoNumero(String(fiscalConfig.nfce_ultimo_numero ?? 0));
            setFiscalCteUltimoNumero(String(fiscalConfig.cte_ultimo_numero ?? 0));
            setFiscalMdfeUltimoNumero(String(fiscalConfig.mdfe_ultimo_numero ?? 0));
            setFiscalInscricaoMunicipal(fiscalConfig.inscricao_municipal || '');
            setFiscalTelefone(fiscalConfig.telefone || '');
            setFiscalCasasDecimais(String(fiscalConfig.casas_decimais ?? 2));
            setFiscalCnpjAutorizado(fiscalConfig.cnpj_autorizado || '');
            setFiscalObservacaoNfe(fiscalConfig.observacao_nfe || '');
            setFiscalObservacaoPedido(fiscalConfig.observacao_pedido || '');
            setFiscalRazaoSocial(fiscalConfig.razao_social || '');
            setFiscalNomeFantasia(fiscalConfig.nome_fantasia || '');
            setFiscalTipoPessoa(fiscalConfig.tipo_pessoa || 'juridica');
            setFiscalInscricaoEstadual(fiscalConfig.inscricao_estadual || '');
            setFiscalEnderecoLogradouro(fiscalConfig.endereco_logradouro || '');
            setFiscalEnderecoNumero(fiscalConfig.endereco_numero || '');
            setFiscalEnderecoComplemento(fiscalConfig.endereco_complemento || '');
            setFiscalEnderecoBairro(fiscalConfig.endereco_bairro || '');
            setFiscalEnderecoCidade(fiscalConfig.endereco_cidade || '');
            setFiscalEnderecoUf(fiscalConfig.endereco_uf || '');
            setFiscalEnderecoCep(fiscalConfig.endereco_cep || '');
            setFiscalCstCsosnPadrao(fiscalConfig.cst_csosn_padrao || '');
            setFiscalCstPisPadrao(fiscalConfig.cst_pis_padrao || '');
            setFiscalCstCofinsPadrao(fiscalConfig.cst_cofins_padrao || '');
            setFiscalCstIpiPadrao(fiscalConfig.cst_ipi_padrao || '');
            setFiscalFretePadrao(fiscalConfig.frete_padrao || '');
            setFiscalTipoPagamentoPadrao(fiscalConfig.tipo_pagamento_padrao || '');
            setFiscalNaturezaOperacaoPadrao(fiscalConfig.natureza_operacao_padrao || '');
            // CSC/CSCID nunca vêm do banco (write-only) — sempre resetam vazios.
            setFiscalCscHomologacao('');
            setFiscalCscidHomologacao('');
            setFiscalCscProducao('');
            setFiscalCscidProducao('');
        }
    };

    useEffect(() => { loadFiscalData(); }, [storeId]);

    const handleCertFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) setCertFile(file);
    };

    const handleSaveCertificate = async () => {
        if (!certFile && !certPassword && !certExpiresAt) {
            return toast.error('Escolha um arquivo, senha ou validade pra salvar.');
        }
        setIsSavingCert(true);
        try {
            if (certFile) {
                const uploadResult = await uploadStoreCertificate(storeId, certFile);
                if (!uploadResult.success) throw new Error(uploadResult.message);

                const metaResult = await saveStoreCertificateMetadata(storeId, certFile.name, certExpiresAt || null);
                if (!metaResult.success) throw new Error(metaResult.message);
            } else if (certExpiresAt) {
                // Só atualizando a validade, sem trocar o arquivo
                const metaResult = await saveStoreCertificateMetadata(storeId, certStatus?.original_filename || 'certificado.pfx', certExpiresAt);
                if (!metaResult.success) throw new Error(metaResult.message);
            }

            if (certPassword) {
                const secretResult = await saveStoreCertificateSecret(storeId, certPassword);
                if (!secretResult.success) throw new Error(secretResult.message);
            }

            toast.success('Certificado atualizado com sucesso!');
            setCertFile(null);
            setCertPassword('');
            setCertStatus(await fetchStoreCertificateStatus(storeId));
        } catch (e: any) {
            toast.error('Erro ao salvar certificado: ' + e.message);
        } finally {
            setIsSavingCert(false);
        }
    };

    const handleSaveFiscalConfig = async () => {
        setIsSavingFiscalConfig(true);
        try {
            // Só entram no payload os campos preenchidos — string vazia vira
            // undefined, não é enviada (mesmo princípio "não mexer no que não
            // foi preenchido" já usado em handleSaveCertificate/saveStoreCertificateSecret).
            const params: UpdateStoreFiscalConfigParams = { ambiente: fiscalAmbiente, modeloEmissaoAutomatica: fiscalModeloEmissaoAutomatica };
            if (fiscalNfeSerie) params.nfeSerie = Number(fiscalNfeSerie);
            if (fiscalNfceSerie) params.nfceSerie = Number(fiscalNfceSerie);
            if (fiscalCteSerie) params.cteSerie = Number(fiscalCteSerie);
            if (fiscalMdfeSerie) params.mdfeSerie = Number(fiscalMdfeSerie);
            if (fiscalNfeUltimoNumero) params.nfeUltimoNumero = Number(fiscalNfeUltimoNumero);
            if (fiscalNfceUltimoNumero) params.nfceUltimoNumero = Number(fiscalNfceUltimoNumero);
            if (fiscalCteUltimoNumero) params.cteUltimoNumero = Number(fiscalCteUltimoNumero);
            if (fiscalMdfeUltimoNumero) params.mdfeUltimoNumero = Number(fiscalMdfeUltimoNumero);
            if (fiscalInscricaoMunicipal) params.inscricaoMunicipal = fiscalInscricaoMunicipal;
            if (fiscalTelefone) params.telefone = fiscalTelefone;
            if (fiscalCasasDecimais) params.casasDecimais = Number(fiscalCasasDecimais);
            if (fiscalCnpjAutorizado) params.cnpjAutorizado = fiscalCnpjAutorizado;
            if (fiscalObservacaoNfe) params.observacaoNfe = fiscalObservacaoNfe;
            if (fiscalObservacaoPedido) params.observacaoPedido = fiscalObservacaoPedido;
            if (fiscalCscHomologacao) params.cscHomologacao = fiscalCscHomologacao;
            if (fiscalCscidHomologacao) params.cscidHomologacao = fiscalCscidHomologacao;
            if (fiscalCscProducao) params.cscProducao = fiscalCscProducao;
            if (fiscalCscidProducao) params.cscidProducao = fiscalCscidProducao;
            if (fiscalRazaoSocial) params.razaoSocial = fiscalRazaoSocial;
            if (fiscalNomeFantasia) params.nomeFantasia = fiscalNomeFantasia;
            if (fiscalTipoPessoa) params.tipoPessoa = fiscalTipoPessoa;
            if (fiscalInscricaoEstadual) params.inscricaoEstadual = fiscalInscricaoEstadual;
            if (fiscalEnderecoLogradouro) params.enderecoLogradouro = fiscalEnderecoLogradouro;
            if (fiscalEnderecoNumero) params.enderecoNumero = fiscalEnderecoNumero;
            if (fiscalEnderecoComplemento) params.enderecoComplemento = fiscalEnderecoComplemento;
            if (fiscalEnderecoBairro) params.enderecoBairro = fiscalEnderecoBairro;
            if (fiscalEnderecoCidade) params.enderecoCidade = fiscalEnderecoCidade;
            if (fiscalEnderecoUf) params.enderecoUf = fiscalEnderecoUf;
            if (fiscalEnderecoCep) params.enderecoCep = fiscalEnderecoCep;
            if (fiscalCstCsosnPadrao) params.cstCsosnPadrao = fiscalCstCsosnPadrao;
            if (fiscalCstPisPadrao) params.cstPisPadrao = fiscalCstPisPadrao;
            if (fiscalCstCofinsPadrao) params.cstCofinsPadrao = fiscalCstCofinsPadrao;
            if (fiscalCstIpiPadrao) params.cstIpiPadrao = fiscalCstIpiPadrao;
            if (fiscalFretePadrao) params.fretePadrao = fiscalFretePadrao;
            if (fiscalTipoPagamentoPadrao) params.tipoPagamentoPadrao = fiscalTipoPagamentoPadrao;
            if (fiscalNaturezaOperacaoPadrao) params.naturezaOperacaoPadrao = fiscalNaturezaOperacaoPadrao;

            const result = await updateStoreFiscalConfig(storeId, params);
            if (!result.success) throw new Error(result.message);

            toast.success('Configuração fiscal salva com sucesso!');
            // Limpa só os campos de CSC (senão o lojista vê a "senha" na tela
            // depois de salvar — mesmo tratamento que certPassword recebe em
            // handleSaveCertificate).
            setFiscalCscHomologacao('');
            setFiscalCscidHomologacao('');
            setFiscalCscProducao('');
            setFiscalCscidProducao('');
        } catch (e: any) {
            toast.error('Erro ao salvar configuração fiscal: ' + e.message);
        } finally {
            setIsSavingFiscalConfig(false);
        }
    };

    const certBadge = () => {
        if (!certStatus) return <Badge color="bg-[var(--surface-2)] text-[var(--text-muted)]">Nenhum certificado cadastrado</Badge>;
        if (!certStatus.expires_at) return <Badge color="bg-[var(--info)]/10 text-[var(--info)]">Cadastrado (sem validade informada)</Badge>;
        const days = differenceInDays(parseISO(certStatus.expires_at), new Date());
        const label = `Válido até ${format(parseISO(certStatus.expires_at), 'dd/MM/yyyy')}`;
        if (days < 0) return <Badge color="bg-[var(--err)]/10 text-[var(--err)]"><AlertCircle size={12} className="mr-1"/> Vencido ({label})</Badge>;
        if (days <= 30) return <Badge color="bg-[var(--warn)]/10 text-[var(--warn)]"><AlertCircle size={12} className="mr-1"/> Vence em breve ({label})</Badge>;
        return <Badge color="bg-[var(--ok)]/10 text-[var(--ok)]"><CheckCircle size={12} className="mr-1"/> {label}</Badge>;
    };

    const [activeTab, setActiveTab] = useState<'dashboard' | 'sales' | 'users' | 'link' | 'fiscal' | 'shifts' | 'impressao' | 'settings'>('dashboard');
    const [sales, setSales] = useState<Order[]>([]);
    const [tableSessions, setTableSessions] = useState<TableSession[]>([]);
    const [ratings, setRatings] = useState<OrderRating[]>([]);
    const [checkins, setCheckins] = useState<OperatorCheckin[]>([]);
    const [isLoadingCheckins, setIsLoadingCheckins] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedOrderDetails, setSelectedOrderDetails] = useState<Order | null>(null);

    // Filters
    const [filterMonth, setFilterMonth] = useState('');
    const [filterStartDate, setFilterStartDate] = useState('');
    const [filterEndDate, setFilterEndDate] = useState('');
    const [filterType, setFilterType] = useState('all');
    const [filterCustomer, setFilterCustomer] = useState('');
    const [filterMinItems, setFilterMinItems] = useState('');
    const [filterMaxItems, setFilterMaxItems] = useState('');
    const [filterMinTotal, setFilterMinTotal] = useState('');
    const [filterMaxTotal, setFilterMaxTotal] = useState('');
    const [showFilters, setShowFilters] = useState(false);

    // Sorting
    const [sortColumn, setSortColumn] = useState<'date' | 'type' | 'customer' | 'items' | 'total'>('date');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    const [isClearing, setIsClearing] = useState(false);

    // Paginação da tabela de vendas
    const SALES_PAGE_SIZE = 25;
    const [salesPage, setSalesPage] = useState(0);

    const loadSales = async (opts?: { silent?: boolean }) => {
        if (!opts?.silent) setIsLoading(true);
        const [data, sessions, ratingsData] = await Promise.all([fetchSalesHistory(storeId), fetchTableSessions(storeId), fetchOrderRatings(storeId)]);
        setSales(data);
        setTableSessions(sessions);
        setRatings(ratingsData);
        setIsLoading(false);
    };

    useEffect(() => {
        if (activeTab === 'sales' || activeTab === 'dashboard') loadSales();
    }, [storeId, activeTab]);

    // Achado real (auditoria "o que falta", 2026-08-27 — itens A8/A9 da
    // reunião): fechar uma mesa/venda em outra aba nunca atualizava sozinho
    // o Histórico de Vendas/Dashboard já abertos, só F5 ou trocar de aba
    // forçava reload. order_change_pings (migration 029) já existe pra
    // isso — pinga (sem dado sensível) a cada insert/update/delete em
    // orders/order_items da loja; o client só precisa recarregar via RPC
    // ao receber o ping. Debounce de 1s: fechar UMA mesa dispara vários
    // pings em sequência (1 por order_item + 1 pela order em si) — sem
    // isso, cada ping geraria uma chamada de rede própria.
    useEffect(() => {
        if (activeTab !== 'sales' && activeTab !== 'dashboard') return;
        let timeout: ReturnType<typeof setTimeout> | null = null;
        const unsubscribe = subscribeToStoreOrderChanges(storeId, () => {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => loadSales({ silent: true }), 1000);
        }, undefined, 'admin_sales');
        return () => {
            if (timeout) clearTimeout(timeout);
            unsubscribe();
        };
    }, [storeId, activeTab]);

    useEffect(() => {
        if (activeTab !== 'shifts') return;
        setIsLoadingCheckins(true);
        fetchCheckinsHistory(storeId).then(data => { setCheckins(data); setIsLoadingCheckins(false); });
    }, [storeId, activeTab]);

    const handleClearSales = async () => {
        const ok = await confirm({
            title: 'Zerar histórico de vendas',
            message: 'ATENÇÃO: Esta ação irá apagar TODAS as vendas e comandas registradas até o momento. O cardápio e os usuários serão mantidos.',
            requireText: 'ZERAR',
            variant: 'danger',
            confirmLabel: 'Zerar histórico',
        });
        if (!ok) return;

        setIsClearing(true);
        try {
            await clearSalesHistory(storeId);
            toast.success("Histórico de vendas zerado com sucesso!");
            await loadSales();
        } catch (error: any) {
            console.error("Error clearing sales", error);
            toast.error("Erro ao zerar histórico: " + error.message);
        } finally {
            setIsClearing(false);
        }
    };

    const handleSort = (column: 'date' | 'type' | 'customer' | 'items' | 'total') => {
        if (sortColumn === column) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

    const filteredAndSortedSales = useMemo(() => {
        let result = [...sales];

        // Apply filters
        if (filterMonth) {
            result = result.filter(order => order.created_at.startsWith(filterMonth));
        }
        if (filterStartDate) {
            result = result.filter(order => order.created_at >= filterStartDate);
        }
        if (filterEndDate) {
            const end = new Date(filterEndDate);
            end.setDate(end.getDate() + 1);
            result = result.filter(order => new Date(order.created_at) < end);
        }
        if (filterType !== 'all') {
            result = result.filter(order => order.order_type === filterType);
        }
        if (filterCustomer) {
            // Achado real (reunião com o Ramon, 2026-08-25): o filtro já se
            // chama "Cliente / Mesa" na UI, mas só buscava um OU outro —
            // pedido de mesa nunca batia pelo nome do cliente, só por
            // "Mesa N". Agora busca nos dois ao mesmo tempo (uma venda de
            // mesa pode ter cliente E número; balcão só tem cliente).
            const search = filterCustomer.toLowerCase();
            result = result.filter(order => {
                const tableName = order.order_type === 'table' ? `Mesa ${order.tables?.number || '?'}` : '';
                const customerName = order.customer_name || (order.order_type === 'counter' ? 'Cliente Balcão' : '');
                return tableName.toLowerCase().includes(search) || customerName.toLowerCase().includes(search);
            });
        }
        if (filterMinItems) {
            result = result.filter(order => (order.order_items?.length || 0) >= parseInt(filterMinItems));
        }
        if (filterMaxItems) {
            result = result.filter(order => (order.order_items?.length || 0) <= parseInt(filterMaxItems));
        }
        if (filterMinTotal) {
            result = result.filter(order => getOrderDisplayTotal(order) >= parseFloat(filterMinTotal));
        }
        if (filterMaxTotal) {
            result = result.filter(order => getOrderDisplayTotal(order) <= parseFloat(filterMaxTotal));
        }

        // Apply sorting
        result.sort((a, b) => {
            let valA: any, valB: any;

            if (sortColumn === 'date') {
                valA = new Date(a.created_at).getTime();
                valB = new Date(b.created_at).getTime();
            } else if (sortColumn === 'type') {
                valA = a.order_type;
                valB = b.order_type;
            } else if (sortColumn === 'customer') {
                valA = a.order_type === 'table' ? `Mesa ${a.tables?.number || '?'}` : (a.customer_name || 'Cliente Balcão');
                valB = b.order_type === 'table' ? `Mesa ${b.tables?.number || '?'}` : (b.customer_name || 'Cliente Balcão');
            } else if (sortColumn === 'items') {
                valA = a.order_items?.length || 0;
                valB = b.order_items?.length || 0;
            } else if (sortColumn === 'total') {
                valA = getOrderDisplayTotal(a);
                valB = getOrderDisplayTotal(b);
            }

            if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        return result;
    }, [sales, filterMonth, filterStartDate, filterEndDate, filterType, filterCustomer, filterMinItems, filterMaxItems, filterMinTotal, filterMaxTotal, sortColumn, sortDirection]);

    const totalRevenue = filteredAndSortedSales.reduce((acc, order) => acc + getOrderDisplayTotal(order), 0);

    // Achado real (reunião com o Ramon, 2026-08-25): "esse histórico de
    // vendas aqui, ele está por mesa, mas tem que ter um histórico de
    // vendas por produto, mais detalhado" — o dashboard só tem Top 5, sem
    // filtro de período nem lista completa. Reaproveita os MESMOS filtros
    // (data/tipo/cliente) já aplicados em filteredAndSortedSales — nenhuma
    // busca nova ao banco, só reagrupa order_items já carregados.
    // getOrderItemDisplayName agrupa por produto+adicional (ex.: "Pizza
    // (Catupiry)" separado de "Pizza" puro), mesmo critério do ranking de
    // mais vendidos do dashboard.
    const [historyView, setHistoryView] = useState<'sale' | 'product' | 'operator'>('sale');
    // Painel de recebimento por garçom (pedido real, reunião 2026-08-25):
    // "quantas vezes o Ramon recebeu, quantas vezes foi o giro". Reagrupa
    // por payment_details.operador_nome — vendas de antes desta mudança
    // (sem o campo) caem em "Sem registro", nunca escondidas.
    const operatorBreakdown = useMemo(() => {
        const byOperator = new Map<string, { sales: number; revenue: number }>();
        for (const order of filteredAndSortedSales) {
            const nome = (order.payment_details as { operador_nome?: string } | null)?.operador_nome || 'Sem registro';
            const entry = byOperator.get(nome) || { sales: 0, revenue: 0 };
            entry.sales += 1;
            entry.revenue += getOrderDisplayTotal(order);
            byOperator.set(nome, entry);
        }
        return Array.from(byOperator.entries())
            .map(([name, data]) => ({ name, ...data }))
            .sort((a, b) => b.revenue - a.revenue);
    }, [filteredAndSortedSales]);
    const productBreakdown = useMemo(() => {
        const byName = new Map<string, { quantity: number; revenue: number }>();
        for (const order of filteredAndSortedSales) {
            for (const item of order.order_items || []) {
                if (item.status === 'canceled') continue;
                const name = getOrderItemDisplayName(item);
                const entry = byName.get(name) || { quantity: 0, revenue: 0 };
                entry.quantity += item.quantity;
                entry.revenue += item.price_at_time * item.quantity;
                byName.set(name, entry);
            }
        }
        return Array.from(byName.entries())
            .map(([name, data]) => ({ name, ...data }))
            .sort((a, b) => b.revenue - a.revenue);
    }, [filteredAndSortedSales]);

    // Volta pra primeira página sempre que filtro ou ordenação mudam, senão o usuário
    // pode ficar preso numa página que não existe mais no novo resultado filtrado.
    useEffect(() => {
        setSalesPage(0);
    }, [filterMonth, filterStartDate, filterEndDate, filterType, filterCustomer, filterMinItems, filterMaxItems, filterMinTotal, filterMaxTotal, sortColumn, sortDirection]);

    const salesTotalPages = Math.max(1, Math.ceil(filteredAndSortedSales.length / SALES_PAGE_SIZE));
    const pagedSales = filteredAndSortedSales.slice(salesPage * SALES_PAGE_SIZE, (salesPage + 1) * SALES_PAGE_SIZE);

    const periodLabel = useMemo(() => {
        if (filterMonth) return `Mês: ${filterMonth}`;
        if (filterStartDate && filterEndDate) return `De ${new Date(filterStartDate).toLocaleDateString()} até ${new Date(filterEndDate).toLocaleDateString()}`;
        if (filterStartDate) return `A partir de ${new Date(filterStartDate).toLocaleDateString()}`;
        if (filterEndDate) return `Até ${new Date(filterEndDate).toLocaleDateString()}`;
        return 'Todo o histórico';
    }, [filterMonth, filterStartDate, filterEndDate]);

    // "2x Pizza Marguerita (Catupiry), 1x Coca-Cola" — reusa getOrderItemDisplayName
    // (produto + adicional) por item da venda, não só a contagem de linhas.
    const buildItemsSummary = (order: Order) =>
        order.order_items?.map(item => `${item.quantity}x ${getOrderItemDisplayName(item)}`).join(', ') || '';

    // Achado real (auditoria "o que falta", 2026-08-27 — item B13 da
    // reunião): mesma fórmula de handleReprintReceipt (total - subtotal dos
    // itens) — o pedido não grava a taxa histórica exata como campo
    // próprio, então isso é a melhor aproximação disponível a partir do
    // valor realmente cobrado (getOrderDisplayTotal).
    const calcOrderServiceFee = (order: Order): number => {
        const itemsTotal = order.order_items?.reduce((sum, item) => sum + (item.price_at_time * item.quantity), 0) || 0;
        const fee = Number((getOrderDisplayTotal(order) - itemsTotal).toFixed(2));
        return fee > 0.005 ? fee : 0;
    };

    // Fix round 3 (Group C1): mesmo motivo de printTableBill acima — sem
    // await/catch, um throw dentro do executor de printHtmlDocument
    // (lib/print.ts) vira unhandled promise rejection em vez de aviso
    // visível pro lojista.
    const handlePrintReport = async () => {
        try {
            const printed = await printSalesReport({
                storeName: store.name,
                periodLabel,
                rows: filteredAndSortedSales.map(order => ({
                    date: `${new Date(order.created_at).toLocaleDateString()} ${new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                    type: order.order_type === 'table' ? 'Mesa' : 'Balcão',
                    customer: order.order_type === 'table' ? `Mesa ${order.tables?.number || '?'}` : (order.customer_name || 'Cliente Balcão'),
                    items: order.order_items?.length || 0,
                    itemsSummary: buildItemsSummary(order),
                    total: getOrderDisplayTotal(order),
                    serviceFee: calcOrderServiceFee(order),
                })),
                totalRevenue,
                totalServiceFee: filteredAndSortedSales.reduce((sum, order) => sum + calcOrderServiceFee(order), 0),
            });
            if (!printed) {
                toast.error('O relatório não imprimiu. Confira a impressora.');
            }
        } catch (e) {
            console.error('printSalesReport lançou:', e);
            toast.error('O relatório não imprimiu. Confira a impressora.');
        }
    };

    const handleExportCsv = () => {
        downloadSalesReportCsv(
            filteredAndSortedSales.map(order => ({
                date: `${new Date(order.created_at).toLocaleDateString()} ${new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                type: order.order_type === 'table' ? 'Mesa' : 'Balcão',
                customer: order.order_type === 'table' ? `Mesa ${order.tables?.number || '?'}` : (order.customer_name || 'Cliente Balcão'),
                items: order.order_items?.length || 0,
                itemsSummary: buildItemsSummary(order),
                total: getOrderDisplayTotal(order),
                serviceFee: calcOrderServiceFee(order),
            })),
            `vendas-${store.name.toLowerCase().replace(/\s+/g, '-')}.csv`
        );
    };

    // Achado real (reunião com o Ramon, 2026-08-25): "o imprimir aqui
    // deveria ser aqui... deveria vir aqui para o histórico de venda" — não
    // existia NENHUMA forma de reimprimir o comprovante de uma venda já
    // fechada a partir do Histórico (só dava pra reimprimir o TICKET de
    // cozinha/bar via "Pedidos do Dia"). Reaproveita printBillReceipt com os
    // dados já disponíveis no pedido; `serviceFee.rate` usa a taxa atual da
    // loja como aproximação (o pedido não grava a taxa histórica exata),
    // mas `amount`/`charged` vêm do valor real cobrado (payment_details),
    // nunca recalculados.
    const handleReprintReceipt = async (order: Order) => {
        const itemsTotal = order.order_items?.reduce((sum, item) => sum + (item.price_at_time * item.quantity), 0) || 0;
        const total = getOrderDisplayTotal(order);
        const feeAmount = Number((total - itemsTotal).toFixed(2));
        const methods = order.payment_details?.methods;
        try {
            const receiptOpts = {
                storeName: store.name,
                cnpj: store.cnpj,
                paperWidthMm: store.config?.printer_paper_width_mm,
                label: `${order.order_type === 'table' ? `MESA ${order.tables?.number || '?'}` : `BALCÃO - ${order.customer_name || 'Cliente'}`} - REIMPRESSÃO`,
                items: (order.order_items || []).map(item => ({
                    quantity: item.quantity,
                    name: getOrderItemDisplayName(item),
                    client: parseItemNote(item.notes || '').client,
                    total: item.price_at_time * item.quantity,
                })),
                subtotal: itemsTotal,
                serviceFee: order.order_type === 'table' ? {
                    charged: feeAmount > 0.005,
                    rate: store.config?.service_fee_rate ?? SERVICE_FEE_RATE,
                    amount: Math.max(0, feeAmount),
                    removedForTable: false,
                } : undefined,
                total,
                payment: {
                    methods: methods && methods.length > 0 ? methods : [{ method: order.payment_method || 'CASH', amount: total }],
                    changeDue: 0,
                },
            };
            const printed = await printBillReceipt(receiptOpts);
            enqueueReceiptPrintJobs(store.id, `Comprovante - ${receiptOpts.label}`, buildBillReceiptText(receiptOpts))
                .catch((e) => console.error('enqueueReceiptPrintJobs (reimpressão) falhou:', e));
            if (!printed) {
                toast.error('O comprovante não imprimiu. Confira a impressora.');
            }
        } catch (e) {
            console.error('handleReprintReceipt (histórico de vendas) lançou:', e);
            toast.error('O comprovante não imprimiu. Confira a impressora.');
        }
    };

    const SortIcon = ({ column }: { column: string }) => {
        if (sortColumn !== column) return <ArrowRightLeft size={14} className="inline-block ml-1 text-[var(--border)] opacity-0 group-hover:opacity-100 rotate-90" />;
        return <ArrowRightLeft size={14} className={`inline-block ml-1 text-[var(--brand)] rotate-90 ${sortDirection === 'desc' ? 'transform scale-y-[-1]' : ''}`} />;
    };

    const clearFilters = () => {
        setFilterMonth('');
        setFilterStartDate('');
        setFilterEndDate('');
        setFilterType('all');
        setFilterCustomer('');
        setFilterMinItems('');
        setFilterMaxItems('');
        setFilterMinTotal('');
        setFilterMaxTotal('');
    };

    // Menu lateral de Administração (Task 4, redesign 2026-08-29) — substitui
    // a antiga barra de 8 abas soltas em linha por 4 categorias agrupadas.
    // "Notas Fiscais" ganha destaque visual próprio dentro de "Loja"
    // (separador + ícone de cadeado) por ser dado sensível, não trivial como
    // "Meu Link / QR Code" ao lado.
    const ADMIN_NAV_GROUPS: { label: string; icon: React.ReactNode; tabs: { id: string; label: string; sensitive?: boolean }[] }[] = [
        { label: 'Visão Geral', icon: <LayoutDashboard size={16} />, tabs: [
            { id: 'dashboard', label: 'Dashboard' },
            { id: 'sales', label: 'Histórico de Vendas' },
        ]},
        { label: 'Operação', icon: <Wallet size={16} />, tabs: [
            { id: 'shifts', label: 'Turnos' },
            { id: 'impressao', label: 'Impressão' },
        ]},
        { label: 'Time', icon: <Users size={16} />, tabs: [
            { id: 'users', label: 'Gestão de Usuários' },
        ]},
        { label: 'Loja', icon: <StoreIcon size={16} />, tabs: [
            { id: 'link', label: 'Meu Link / QR Code' },
            { id: 'settings', label: 'Configurações' },
            { id: 'fiscal', label: 'Notas Fiscais', sensitive: true },
        ]},
    ];

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row gap-6">
                <nav className="w-full md:w-56 flex-shrink-0 space-y-5">
                    {ADMIN_NAV_GROUPS.map((group) => (
                        <div key={group.label}>
                            <p className="px-3 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                                {group.icon} {group.label}
                            </p>
                            <div className="space-y-0.5">
                                {group.tabs.map((tab) => (
                                    <React.Fragment key={tab.id}>
                                        {tab.sensitive && <div className="my-1.5 border-t border-[var(--warn)]/30" />}
                                        <button
                                            onClick={() => setActiveTab(tab.id as typeof activeTab)}
                                            aria-current={activeTab === tab.id ? 'page' : undefined}
                                            className={`relative isolate w-full text-left px-3 py-2 rounded-lg text-sm font-medium u-motion u-press-sm flex items-center gap-1.5 ${
                                                activeTab === tab.id
                                                    ? 'text-[var(--brand)] font-bold'
                                                    : tab.sensitive
                                                        ? 'text-[var(--warn)] hover:bg-[var(--warn)]/5'
                                                        : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
                                            }`}
                                        >
                                            {activeTab === tab.id && (
                                                // layoutId por GRUPO (não compartilhado entre os 4 grupos do menu) —
                                                // senão o indicador "voaria" de um grupo pro outro na tela toda.
                                                <motion.div
                                                    layoutId={`admin-nav-active-${group.label}`}
                                                    className="absolute inset-0 rounded-lg bg-[var(--brand)]/10 -z-10"
                                                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                                                />
                                            )}
                                            {tab.sensitive && <Lock size={12} />}
                                            {tab.label}
                                        </button>
                                    </React.Fragment>
                                ))}
                            </div>
                        </div>
                    ))}
                </nav>
                <div className="flex-1 min-w-0">
                    {/* Crossfade mínimo na troca de aba (Task 5, 2026-08-29) —
                    120ms, sem y na saída (só opacity), sem bounce/stagger:
                    painel usado 50x/dia, motion tem que ser quase invisível. */}
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeTab}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.12, ease: 'easeOut' }}
                        >

            {activeTab === 'dashboard' && (
                <StoreDashboardView
                    sales={sales}
                    tableSessions={tableSessions}
                    ratings={ratings}
                    storeId={storeId}
                    onNavigateToOperatorHistory={() => { setActiveTab('sales'); setHistoryView('operator'); }}
                />
            )}

            {activeTab === 'users' && <UserManagementView storeId={storeId} />}

            {activeTab === 'link' && <MeuLinkView store={store} />}

            {activeTab === 'shifts' && (
                <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] overflow-hidden">
                    <div className="p-4 border-b border-[var(--border)]">
                        <h3 className="font-bold text-lg text-[var(--text)]">Turnos (ponto por operador)</h3>
                        <p className="text-sm text-[var(--text-muted)]">Cada operador marca a própria entrada/saída pelo botão "Bater ponto" no menu lateral — independente do turno de caixa.</p>
                    </div>
                    {isLoadingCheckins ? (
                        <div className="p-8 text-center text-[var(--text-muted)]">Carregando...</div>
                    ) : checkins.length === 0 ? (
                        <div className="p-8 text-center text-[var(--text-muted)]">Nenhum ponto registrado ainda.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-[var(--surface-2)] text-[var(--text-muted)] text-xs uppercase">
                                    <tr>
                                        <th className="px-4 py-2 text-left">Operador</th>
                                        <th className="px-4 py-2 text-left">Entrada</th>
                                        <th className="px-4 py-2 text-left">Saída</th>
                                        <th className="px-4 py-2 text-left">Duração</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {checkins.map(c => {
                                        const start = parseISO(c.checkin_at);
                                        const end = c.checkout_at ? parseISO(c.checkout_at) : null;
                                        const minutes = end ? Math.round((end.getTime() - start.getTime()) / 60000) : null;
                                        const duracao = minutes === null ? '—' : minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`;
                                        return (
                                            <tr key={c.id} className="border-t border-[var(--border)]">
                                                <td className="px-4 py-2 font-medium text-[var(--text)]">{c.user_name}</td>
                                                <td className="px-4 py-2 text-[var(--text-muted)]">{format(start, 'dd/MM/yyyy HH:mm')}</td>
                                                <td className="px-4 py-2 text-[var(--text-muted)]">
                                                    {end ? format(end, 'dd/MM/yyyy HH:mm') : <span className="text-[var(--ok)] font-medium">Em andamento</span>}
                                                </td>
                                                <td className="px-4 py-2 text-[var(--text-muted)]">{duracao}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'fiscal' && (
                <>
                    <FiscalNotasView storeId={storeId} />
            {/* CERTIFICADO E CONFIGURAÇÃO FISCAL — mesma tela do Master Admin
                (AdminModule.tsx), aberta pro lojista também (2026-07-07). Só
                armazenamento/configuração, nenhuma lógica de emissão de NFC-e
                de verdade (ver AGENTS.md, seção "Configuração do emissor
                fiscal"). Progressive disclosure (2026-08-29): antes era um
                único Collapsible cobrindo ~200 linhas; agora cada grupo de
                campos tem o próprio, nenhuma lógica de validação/salvamento
                mudou. */}
            <div className="space-y-3">
                <Collapsible title="Certificado Digital" defaultOpen={true}>
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-semibold text-[var(--text)] flex items-center gap-2"><Lock size={14}/> Certificado Digital (fiscal)</label>
                            {certBadge()}
                        </div>
                        <label className="cursor-pointer bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-2)] text-[var(--text)] px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 w-fit transition-colors shadow-sm">
                            <Upload size={16} /> {certFile ? certFile.name : 'Escolher arquivo (.pfx/.p12)'}
                            <input type="file" className="hidden" accept=".pfx,.p12" onChange={handleCertFileChange} />
                        </label>
                        <div className="grid grid-cols-2 gap-4">
                            <Input type="date" label="Validade do certificado" value={certExpiresAt} onChange={e => setCertExpiresAt(e.target.value)} />
                            <Input type="password" label="Senha do certificado" placeholder="Deixe em branco pra manter a atual" value={certPassword} onChange={e => setCertPassword(e.target.value)} />
                        </div>
                        <Button variant="secondary" className="w-full" onClick={handleSaveCertificate} isLoading={isSavingCert}>
                            Salvar Certificado
                        </Button>
                    </div>
                </Collapsible>

                {/* Configuração do Emissor Fiscal (store_fiscal_config,
                    migration 024 + 025) — só armazenamento/configuração, sem
                    lógica de emissão real ainda. */}
                <Collapsible title="Ambiente e Emissão Automática" defaultOpen={false}>
                    <div className="space-y-4">
                        <label className="text-sm font-semibold text-[var(--text)] flex items-center gap-2"><FileText size={14}/> Configuração do Emissor</label>

                        <div className="bg-[var(--warn)]/10 p-4 rounded-xl border border-[var(--warn)]/20 flex gap-3">
                            <AlertCircle className="text-[var(--warn)] flex-shrink-0" size={20} />
                            <p className="text-sm text-[var(--warn)]">
                                ⚠️ Sempre configure e teste em Homologação primeiro. Nunca emita nota fiscal real durante testes.
                            </p>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-semibold text-[var(--text)]">Ambiente</label>
                            <select
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30 disabled:opacity-60 disabled:cursor-not-allowed"
                              value={fiscalAmbiente}
                              onChange={e => setFiscalAmbiente(e.target.value as 'homologacao' | 'producao')}
                              disabled={store.is_test}
                            >
                                <option value="homologacao">Homologação</option>
                                <option value="producao">Produção</option>
                            </select>
                            {store.is_test && (
                                <p className="text-xs text-[var(--text-muted)]">🔒 Loja de teste — ambiente sempre em homologação.</p>
                            )}
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-semibold text-[var(--text)]">Modelo de emissão automática</label>
                            <select
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30"
                              value={fiscalModeloEmissaoAutomatica}
                              onChange={e => setFiscalModeloEmissaoAutomatica(e.target.value as 'nenhuma' | 'nfce' | 'nfe')}
                            >
                                <option value="nenhuma">Nenhuma (não emite automaticamente)</option>
                                <option value="nfce">NFC-e (cupom fiscal)</option>
                                <option value="nfe">NF-e (com destinatário)</option>
                            </select>
                            {fiscalModeloEmissaoAutomatica !== 'nenhuma' && !certStatus && (
                                <p className="text-xs text-[var(--warn)]">⚠️ Nenhum certificado cadastrado ainda — a emissão automática não vai funcionar até o certificado ser configurado acima.</p>
                            )}
                        </div>
                    </div>
                </Collapsible>

                <Collapsible title="Numeração (NF-e / NFC-e / CT-e / MDF-e)" defaultOpen={false}>
                    <div className="space-y-4">
                        {/* Reorganizado (2026-08-16, pedido explícito do usuário): antes NF-e e
                            NFC-e apareciam sempre lado a lado, misturados com CSC (que só existe
                            pra NFC-e) mesmo quando a loja usa só um dos dois — ou nenhum. Agora só
                            aparece o bloco do tipo escolhido acima em "Modelo de emissão automática". */}
                        {fiscalModeloEmissaoAutomatica === 'nfe' && (
                            <div className="space-y-4 p-4 bg-[var(--surface-2)]/50 rounded-xl border border-[var(--border)]">
                                <p className="text-xs font-semibold text-[var(--brand)] uppercase tracking-wide">NF-e (com destinatário)</p>
                                <div className="grid grid-cols-2 gap-4">
                                    <Input type="number" label="Série" className="font-mono" value={fiscalNfeSerie} onChange={e => setFiscalNfeSerie(e.target.value)} />
                                    <Input type="number" label="Último número emitido" className="font-mono" value={fiscalNfeUltimoNumero} onChange={e => setFiscalNfeUltimoNumero(e.target.value)} />
                                </div>
                                <p className="text-xs text-[var(--text-muted)] -mt-2">Deixe 0 se nunca emitiu.</p>
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-sm font-semibold text-[var(--text)]">Observação padrão — NF-e</label>
                                    <textarea
                                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30"
                                      rows={2}
                                      value={fiscalObservacaoNfe}
                                      onChange={e => setFiscalObservacaoNfe(e.target.value)}
                                    />
                                </div>
                            </div>
                        )}

                        {fiscalModeloEmissaoAutomatica === 'nfce' && (
                            <div className="space-y-4 p-4 bg-[var(--surface-2)]/50 rounded-xl border border-[var(--border)]">
                                <p className="text-xs font-semibold text-[var(--brand)] uppercase tracking-wide">NFC-e (cupom fiscal)</p>
                                <div className="grid grid-cols-2 gap-4">
                                    <Input type="number" label="Série" className="font-mono" value={fiscalNfceSerie} onChange={e => setFiscalNfceSerie(e.target.value)} />
                                    <Input type="number" label="Último número emitido" className="font-mono" value={fiscalNfceUltimoNumero} onChange={e => setFiscalNfceUltimoNumero(e.target.value)} />
                                </div>
                                <p className="text-xs text-[var(--text-muted)] -mt-2">Deixe 0 se nunca emitiu.</p>
                                <p className="text-xs text-[var(--text-muted)]">CSC (Código de Segurança do Contribuinte) — só existe pra NFC-e, cada ambiente tem o seu.</p>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">CSC — Homologação</p>
                                        <Input type="password" label="CSC" className="font-mono" placeholder="Deixe em branco pra manter o atual" value={fiscalCscHomologacao} onChange={e => setFiscalCscHomologacao(e.target.value)} />
                                        <Input type="password" label="CSCID" className="font-mono" placeholder="Deixe em branco pra manter o atual" value={fiscalCscidHomologacao} onChange={e => setFiscalCscidHomologacao(e.target.value)} />
                                    </div>
                                    <div className="space-y-2">
                                        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">CSC — Produção</p>
                                        <Input type="password" label="CSC" className="font-mono" placeholder="Deixe em branco pra manter o atual" value={fiscalCscProducao} onChange={e => setFiscalCscProducao(e.target.value)} />
                                        <Input type="password" label="CSCID" className="font-mono" placeholder="Deixe em branco pra manter o atual" value={fiscalCscidProducao} onChange={e => setFiscalCscidProducao(e.target.value)} />
                                    </div>
                                </div>
                            </div>
                        )}

                        {fiscalModeloEmissaoAutomatica === 'nenhuma' && (
                            <p className="text-xs text-[var(--text-muted)] italic">Escolha NFC-e ou NF-e acima pra configurar série, numeração e (se for NFC-e) o CSC.</p>
                        )}

                        <details className="border border-[var(--border)] rounded-lg p-3">
                            <summary className="text-sm font-medium text-[var(--text-muted)] cursor-pointer select-none">Outros documentos — CT-e / MDF-e (avançado)</summary>
                            <div className="grid grid-cols-2 gap-4 mt-3">
                                <div className="space-y-2">
                                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">CT-e</p>
                                    <Input type="number" label="Série" className="font-mono" value={fiscalCteSerie} onChange={e => setFiscalCteSerie(e.target.value)} />
                                    <Input type="number" label="Último número emitido" className="font-mono" value={fiscalCteUltimoNumero} onChange={e => setFiscalCteUltimoNumero(e.target.value)} />
                                    <p className="text-xs text-[var(--text-muted)]">Deixe 0 se nunca emitiu.</p>
                                </div>
                                <div className="space-y-2">
                                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">MDF-e</p>
                                    <Input type="number" label="Série" className="font-mono" value={fiscalMdfeSerie} onChange={e => setFiscalMdfeSerie(e.target.value)} />
                                    <Input type="number" label="Último número emitido" className="font-mono" value={fiscalMdfeUltimoNumero} onChange={e => setFiscalMdfeUltimoNumero(e.target.value)} />
                                    <p className="text-xs text-[var(--text-muted)]">Deixe 0 se nunca emitiu.</p>
                                </div>
                            </div>
                        </details>
                    </div>
                </Collapsible>

                <Collapsible title="Dados Gerais" defaultOpen={false}>
                    <div className="space-y-4">
                        <Input label="Inscrição municipal" className="font-mono" placeholder="Opcional" value={fiscalInscricaoMunicipal} onChange={e => setFiscalInscricaoMunicipal(e.target.value)} />
                        <Input label="Telefone" placeholder="Ex: (71) 99999-9999" value={fiscalTelefone} onChange={e => setFiscalTelefone(e.target.value)} />
                        <div className="grid grid-cols-2 gap-4">
                            <Input type="number" label="Casas decimais" value={fiscalCasasDecimais} onChange={e => setFiscalCasasDecimais(e.target.value)} />
                            <Input label="CNPJ Autorizado" className="font-mono" placeholder="Opcional" value={fiscalCnpjAutorizado} onChange={e => setFiscalCnpjAutorizado(e.target.value)} />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-semibold text-[var(--text)]">Observação padrão — Pedido/Orçamento</label>
                            <textarea
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30"
                              rows={2}
                              value={fiscalObservacaoPedido}
                              onChange={e => setFiscalObservacaoPedido(e.target.value)}
                            />
                        </div>
                    </div>
                </Collapsible>

                {/* Identificação da empresa (migration 025) */}
                <Collapsible title="Identificação da Empresa" defaultOpen={false}>
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-4">
                            <Input label="Razão Social" placeholder="Opcional" value={fiscalRazaoSocial} onChange={e => setFiscalRazaoSocial(e.target.value)} />
                            <Input label="Nome Fantasia" placeholder="Opcional" value={fiscalNomeFantasia} onChange={e => setFiscalNomeFantasia(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-1.5">
                                <label className="text-sm font-semibold text-[var(--text)]">Tipo</label>
                                <select
                                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30"
                                  value={fiscalTipoPessoa}
                                  onChange={e => setFiscalTipoPessoa(e.target.value as 'juridica' | 'fisica')}
                                >
                                    <option value="juridica">Jurídica</option>
                                    <option value="fisica">Física</option>
                                </select>
                            </div>
                            <Input label="Inscrição Estadual" className="font-mono" placeholder="Opcional" value={fiscalInscricaoEstadual} onChange={e => setFiscalInscricaoEstadual(e.target.value)} />
                        </div>
                        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Endereço</p>
                        <div className="grid grid-cols-2 gap-4">
                            <Input label="Logradouro" placeholder="Opcional" value={fiscalEnderecoLogradouro} onChange={e => setFiscalEnderecoLogradouro(e.target.value)} />
                            <Input label="Número" placeholder="Opcional" value={fiscalEnderecoNumero} onChange={e => setFiscalEnderecoNumero(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <Input label="Complemento" placeholder="Opcional" value={fiscalEnderecoComplemento} onChange={e => setFiscalEnderecoComplemento(e.target.value)} />
                            <Input label="Bairro" placeholder="Opcional" value={fiscalEnderecoBairro} onChange={e => setFiscalEnderecoBairro(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <Input label="Cidade" placeholder="Opcional" value={fiscalEnderecoCidade} onChange={e => setFiscalEnderecoCidade(e.target.value)} />
                            <Input label="UF" placeholder="Opcional" maxLength={2} value={fiscalEnderecoUf} onChange={e => setFiscalEnderecoUf(e.target.value.toUpperCase())} />
                            <Input label="CEP" placeholder="Opcional" value={fiscalEnderecoCep} onChange={e => setFiscalEnderecoCep(e.target.value)} />
                        </div>
                    </div>
                </Collapsible>

                {/* Padrões de impostos (migration 025) — default por
                    loja, não classificação por produto/NCM. */}
                <Collapsible title="Padrões de Impostos" defaultOpen={false}>
                    <div className="space-y-3">
                        <p className="text-xs text-[var(--text-muted)]">Códigos conforme tabela da contabilidade/SEFAZ.</p>
                        <div className="grid grid-cols-2 gap-4">
                            <Input label="CST/CSOSN Padrão" placeholder="Ex: 102" value={fiscalCstCsosnPadrao} onChange={e => setFiscalCstCsosnPadrao(e.target.value)} />
                            <Input label="CST/PIS Padrão" placeholder="Ex: 49" value={fiscalCstPisPadrao} onChange={e => setFiscalCstPisPadrao(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <Input label="CST/COFINS Padrão" placeholder="Ex: 49" value={fiscalCstCofinsPadrao} onChange={e => setFiscalCstCofinsPadrao(e.target.value)} />
                            <Input label="CST/IPI Padrão" placeholder="Ex: 53" value={fiscalCstIpiPadrao} onChange={e => setFiscalCstIpiPadrao(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <Input label="Frete Padrão" placeholder="Ex: 9 - Sem frete" value={fiscalFretePadrao} onChange={e => setFiscalFretePadrao(e.target.value)} />
                            <Input label="Tipo de Pagamento Padrão" placeholder="Ex: 01 - Dinheiro" value={fiscalTipoPagamentoPadrao} onChange={e => setFiscalTipoPagamentoPadrao(e.target.value)} />
                        </div>
                        <Input label="Natureza de Operação Padrão" placeholder="Ex: 0 - Emitente" value={fiscalNaturezaOperacaoPadrao} onChange={e => setFiscalNaturezaOperacaoPadrao(e.target.value)} />
                    </div>
                </Collapsible>

                <Button variant="secondary" className="w-full" onClick={handleSaveFiscalConfig} isLoading={isSavingFiscalConfig}>
                    Salvar Configuração Fiscal
                </Button>
            </div>
                </>
            )}

            {activeTab === 'impressao' && <PrinterSettingsView store={store} />}
            {activeTab === 'settings' && <StoreSettingsView store={store} onStoreUpdate={onStoreUpdate} />}

            {activeTab === 'sales' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Card accentColor="var(--brand)" className="p-6 pl-7 shadow-sm">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wider">Faturamento Total</p>
                                    <h3 className="text-3xl font-black text-[var(--text)] mt-1">R$ {formatBRL(totalRevenue)}</h3>
                                </div>
                                <div className="p-3 bg-[var(--brand)]/10 rounded-full text-[var(--brand)]">
                                    <Receipt size={24} />
                                </div>
                            </div>
                        </Card>
                        <Card accentColor="var(--ok)" className="p-6 pl-7 shadow-sm">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wider">Vendas Realizadas</p>
                                    <h3 className="text-3xl font-black text-[var(--text)] mt-1">{filteredAndSortedSales.length}</h3>
                                </div>
                                <div className="p-3 bg-[var(--ok)]/10 rounded-full text-[var(--ok)]">
                                    <CheckCircle size={24} />
                                </div>
                            </div>
                        </Card>
                        <Card accentColor="var(--info)" className="p-6 pl-7 shadow-sm">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wider">Ticket Médio</p>
                                    <h3 className="text-3xl font-black text-[var(--text)] mt-1">
                                        R$ {filteredAndSortedSales.length > 0 ? formatBRL(totalRevenue / filteredAndSortedSales.length) : '0,00'}
                                    </h3>
                                </div>
                                <div className="p-3 bg-[var(--info)]/10 rounded-full text-[var(--info)]">
                                    <BarChart3 size={24} />
                                </div>
                            </div>
                        </Card>
                    </div>

                    <Card className="overflow-hidden shadow-sm border border-[var(--border)]">
                        <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-2)] flex flex-col gap-4">
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <h3 className="font-bold text-lg text-[var(--text)]">Histórico de Vendas</h3>
                                    <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-xs font-bold">
                                        <button
                                            onClick={() => setHistoryView('sale')}
                                            className={`px-3 py-1.5 u-motion ${historyView === 'sale' ? 'bg-[var(--brand)] text-white' : 'bg-[var(--surface)] text-[var(--text-muted)]'}`}
                                        >
                                            Por Venda
                                        </button>
                                        <button
                                            onClick={() => setHistoryView('product')}
                                            className={`px-3 py-1.5 u-motion ${historyView === 'product' ? 'bg-[var(--brand)] text-white' : 'bg-[var(--surface)] text-[var(--text-muted)]'}`}
                                        >
                                            Por Produto
                                        </button>
                                        <button
                                            onClick={() => setHistoryView('operator')}
                                            className={`px-3 py-1.5 u-motion ${historyView === 'operator' ? 'bg-[var(--brand)] text-white' : 'bg-[var(--surface)] text-[var(--text-muted)]'}`}
                                        >
                                            Por Operador
                                        </button>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button variant="secondary" onClick={() => setShowFilters(!showFilters)}>
                                        <Search size={16} className="mr-2" />
                                        Filtros
                                    </Button>
                                    <Button variant="secondary" onClick={handlePrintReport} disabled={filteredAndSortedSales.length === 0}>
                                        <Printer size={16} className="mr-2" />
                                        Imprimir Relatório
                                    </Button>
                                    <Button variant="secondary" onClick={handleExportCsv} disabled={filteredAndSortedSales.length === 0}>
                                        <Download size={16} className="mr-2" />
                                        Exportar CSV
                                    </Button>
                                    <div className="w-px h-6 bg-[var(--border)] mx-1" />
                                    <Button variant="outline" className="text-[var(--err)] border-[var(--err)]/20 hover:bg-[var(--err)]/5" onClick={handleClearSales} isLoading={isClearing}>
                                        <Trash2 size={16} className="mr-2" />
                                        Zerar Vendas
                                    </Button>
                                    <Badge color="bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-muted)]">{filteredAndSortedSales.length} {filteredAndSortedSales.length === 1 ? 'registro' : 'registros'}</Badge>
                                </div>
                            </div>
                            
                            {showFilters && (
                                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4 bg-[var(--surface-2)] rounded-[var(--r-md)] border border-[var(--border)]">
                                    <div>
                                        <label className="block text-xs font-bold text-[var(--text-muted)] uppercase mb-1">Mês</label>
                                        <Input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-[var(--text-muted)] uppercase mb-1">Data Inicial</label>
                                        <Input type="date" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-[var(--text-muted)] uppercase mb-1">Data Final</label>
                                        <Input type="date" value={filterEndDate} onChange={e => setFilterEndDate(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-[var(--text-muted)] uppercase mb-1">Tipo</label>
                                        <select 
                                            className="w-full px-3 py-2 border border-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface)] text-[var(--text)] focus:ring-2 focus:ring-[var(--brand)]/30 focus:border-[var(--brand)] outline-none transition-all"
                                            value={filterType} 
                                            onChange={e => setFilterType(e.target.value)}
                                        >
                                            <option value="all">Todos</option>
                                            <option value="table">Mesa</option>
                                            <option value="counter">Balcão</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-[var(--text-muted)] uppercase mb-1">Cliente / Mesa</label>
                                        <Input placeholder="Buscar..." value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)} />
                                    </div>
                                    <div className="flex gap-2">
                                        <div className="flex-1">
                                            <label className="block text-xs font-bold text-[var(--text-muted)] uppercase mb-1">Min Itens</label>
                                            <Input type="number" min="0" value={filterMinItems} onChange={e => setFilterMinItems(e.target.value)} />
                                        </div>
                                        <div className="flex-1">
                                            <label className="block text-xs font-bold text-[var(--text-muted)] uppercase mb-1">Max Itens</label>
                                            <Input type="number" min="0" value={filterMaxItems} onChange={e => setFilterMaxItems(e.target.value)} />
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <div className="flex-1">
                                            <label className="block text-xs font-bold text-[var(--text-muted)] uppercase mb-1">Min Total (R$)</label>
                                            <Input type="number" min="0" step="0.01" value={filterMinTotal} onChange={e => setFilterMinTotal(e.target.value)} />
                                        </div>
                                        <div className="flex-1">
                                            <label className="block text-xs font-bold text-[var(--text-muted)] uppercase mb-1">Max Total (R$)</label>
                                            <Input type="number" min="0" step="0.01" value={filterMaxTotal} onChange={e => setFilterMaxTotal(e.target.value)} />
                                        </div>
                                    </div>
                                    <div className="flex items-end">
                                        <Button variant="secondary" className="w-full" onClick={clearFilters}>Limpar Filtros</Button>
                                    </div>
                                </div>
                            )}
                        </div>
                        {historyView === 'product' ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-[var(--surface-2)] text-[var(--text-muted)] font-medium uppercase text-xs">
                                        <tr>
                                            <th className="px-4 py-3">Produto</th>
                                            <th className="px-4 py-3 text-right">Quantidade</th>
                                            <th className="px-4 py-3 text-right">Faturamento</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[var(--border)]">
                                        {productBreakdown.length === 0 ? (
                                            <tr>
                                                <td colSpan={3} className="px-4 py-8 text-center text-[var(--text-muted)] italic">
                                                    Nenhuma venda encontrada com os filtros atuais.
                                                </td>
                                            </tr>
                                        ) : (
                                            productBreakdown.map((row, i) => (
                                                <tr key={row.name} className="u-stagger" style={stagger(Math.min(i, 10) * 30)}>
                                                    <td className="px-4 py-3 font-medium text-[var(--text)]">{row.name}</td>
                                                    <td className="px-4 py-3 text-right text-[var(--text-muted)]">{row.quantity}</td>
                                                    <td className="px-4 py-3 text-right font-bold text-[var(--text)]">R$ {formatBRL(row.revenue)}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        ) : historyView === 'operator' ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-[var(--surface-2)] text-[var(--text-muted)] font-medium uppercase text-xs">
                                        <tr>
                                            <th className="px-4 py-3">Operador</th>
                                            <th className="px-4 py-3 text-right">Vendas Fechadas</th>
                                            <th className="px-4 py-3 text-right">Total Recebido</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[var(--border)]">
                                        {operatorBreakdown.length === 0 ? (
                                            <tr>
                                                <td colSpan={3} className="px-4 py-8 text-center text-[var(--text-muted)] italic">
                                                    Nenhuma venda encontrada com os filtros atuais.
                                                </td>
                                            </tr>
                                        ) : (
                                            operatorBreakdown.map((row, i) => (
                                                <tr key={row.name} className="u-stagger" style={stagger(Math.min(i, 10) * 30)}>
                                                    <td className="px-4 py-3 font-medium text-[var(--text)]">{row.name}</td>
                                                    <td className="px-4 py-3 text-right text-[var(--text-muted)]">{row.sales}</td>
                                                    <td className="px-4 py-3 text-right font-bold text-[var(--text)]">R$ {formatBRL(row.revenue)}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                        <>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-[var(--surface-2)] text-[var(--text-muted)] font-medium uppercase text-xs">
                                    <tr>
                                        <th className="px-4 py-3 cursor-pointer hover:bg-[var(--border)] transition-colors group" onClick={() => handleSort('date')}>
                                            Data <SortIcon column="date" />
                                        </th>
                                        <th className="px-4 py-3 cursor-pointer hover:bg-[var(--border)] transition-colors group" onClick={() => handleSort('type')}>
                                            Tipo <SortIcon column="type" />
                                        </th>
                                        <th className="px-4 py-3 cursor-pointer hover:bg-[var(--border)] transition-colors group" onClick={() => handleSort('customer')}>
                                            Cliente / Mesa <SortIcon column="customer" />
                                        </th>
                                        <th className="px-4 py-3 cursor-pointer hover:bg-[var(--border)] transition-colors group" onClick={() => handleSort('items')}>
                                            Itens <SortIcon column="items" />
                                        </th>
                                        <th className="px-4 py-3 text-right cursor-pointer hover:bg-[var(--border)] transition-colors group" onClick={() => handleSort('total')}>
                                            Total <SortIcon column="total" />
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[var(--border)]">
                                    {isLoading ? (
                                        Array.from({ length: 6 }).map((_, i) => (
                                            <tr key={i} className="u-stagger" style={stagger(i * 30)}>
                                                <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                                                <td className="px-4 py-3"><Skeleton className="h-4 w-14" /></td>
                                                <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                                                <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
                                                <td className="px-4 py-3"><Skeleton className="h-4 w-16 ml-auto" /></td>
                                            </tr>
                                        ))
                                    ) : filteredAndSortedSales.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)] italic">
                                                Nenhuma venda encontrada com os filtros atuais.
                                            </td>
                                        </tr>
                                    ) : (
                                        pagedSales.map((order, orderIdx) => {
                                            const orderTotal = getOrderDisplayTotal(order);
                                            return (
                                                <tr
                                                    key={order.id}
                                                    className="u-stagger hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                                                    style={stagger(Math.min(orderIdx, 10) * 30)}
                                                    onClick={() => setSelectedOrderDetails(order)}
                                                >
                                                    <td className="px-4 py-3 text-[var(--text-muted)]">
                                                        {new Date(order.created_at).toLocaleDateString()} <span className="text-xs text-[var(--text-muted)]/70 ml-1">{new Date(order.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {order.order_type === 'counter' ? (
                                                            <Badge color="bg-[var(--warn)]/10 text-[var(--warn)] border-[var(--warn)]/20">Balcão</Badge>
                                                        ) : (
                                                            <Badge color="bg-[var(--info)]/10 text-[var(--info)] border-[var(--info)]/20">Mesa</Badge>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 font-medium text-[var(--text)]">
                                                        {order.order_type === 'table' ? `Mesa ${order.tables?.number || '?'}` : (order.customer_name || 'Cliente Balcão')}
                                                    </td>
                                                    <td className="px-4 py-3 text-[var(--text-muted)] max-w-xs">
                                                        <div className="group/items relative inline-block">
                                                            <span className="truncate">{order.order_items?.length || 0} {(order.order_items?.length || 0) === 1 ? 'item' : 'itens'}</span>
                                                            {(order.order_items?.length || 0) > 0 && (
                                                                <div className="hidden group-hover/items:block absolute z-20 left-0 top-full mt-1 w-56 max-h-48 overflow-y-auto rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] shadow-lg p-2 text-xs text-[var(--text)] whitespace-normal">
                                                                    {order.order_items?.map((i, idx) => (
                                                                        <div key={idx} className="flex justify-between gap-2 py-0.5">
                                                                            <span>{i.quantity}x {getOrderItemDisplayName(i)}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-bold text-[var(--text)]">
                                                        R$ {formatBRL(orderTotal)}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {filteredAndSortedSales.length > 0 && (
                            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] bg-[var(--surface-2)]">
                                <span className="text-xs text-[var(--text-muted)]">
                                    Página {salesPage + 1} de {salesTotalPages}
                                </span>
                                <div className="flex items-center gap-2">
                                    <Button variant="secondary" className="h-8 px-3 text-xs" disabled={salesPage === 0} onClick={() => setSalesPage(p => Math.max(0, p - 1))}>
                                        <ChevronLeft size={14} className="mr-1" /> Anterior
                                    </Button>
                                    <Button variant="secondary" className="h-8 px-3 text-xs" disabled={salesPage >= salesTotalPages - 1} onClick={() => setSalesPage(p => Math.min(salesTotalPages - 1, p + 1))}>
                                        Próxima <ChevronRight size={14} className="ml-1" />
                                    </Button>
                                </div>
                            </div>
                        )}
                        </>
                        )}
                    </Card>
                </div>
            )}

                        </motion.div>
                    </AnimatePresence>

            {/* Modal de Detalhes da Venda */}
            <Modal isOpen={!!selectedOrderDetails} onClose={() => setSelectedOrderDetails(null)} title="Detalhes da Venda">
                {selectedOrderDetails && (
                    <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <p className="text-[var(--text-muted)]">Data e Hora</p>
                                <p className="font-medium text-[var(--text)]">
                                    {new Date(selectedOrderDetails.created_at).toLocaleDateString()} às {new Date(selectedOrderDetails.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </p>
                            </div>
                            <div>
                                <p className="text-[var(--text-muted)]">Tipo</p>
                                <p className="font-medium text-[var(--text)]">
                                    {selectedOrderDetails.order_type === 'table' ? 'Mesa' : 'Balcão'}
                                </p>
                            </div>
                            <div className="col-span-2">
                                <p className="text-[var(--text-muted)]">Cliente / Mesa</p>
                                <p className="font-medium text-[var(--text)]">
                                    {selectedOrderDetails.order_type === 'table' ? `Mesa ${selectedOrderDetails.tables?.number || '?'}` : (selectedOrderDetails.customer_name || 'Cliente Balcão')}
                                </p>
                            </div>
                        </div>

                        <div>
                            <h4 className="font-bold text-[var(--text)] mb-2 border-b border-[var(--border)] pb-1">Itens do Pedido</h4>
                            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                                {selectedOrderDetails.order_items?.map(item => (
                                    <div key={item.id} className="flex justify-between text-sm">
                                        <div className="flex gap-2">
                                            <span className="font-medium text-[var(--text-muted)]">{item.quantity}x</span>
                                            <span className="text-[var(--text)]">{getOrderItemDisplayName(item)}</span>
                                        </div>
                                        <span className="text-[var(--text-muted)]">R$ {formatBRL(item.price_at_time * item.quantity)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {(() => {
                            // Bug real (WhatsApp do Ramon, 2026-08-24): "Total Pago" recalculava
                            // do zero (soma de order_items, sem taxa de serviço) em vez de usar a
                            // mesma fonte que a seção "Pagamento" já mostra corretamente
                            // (payment_details.methods, que inclui a taxa) — os dois números
                            // divergiam no mesmo modal. Agora uma fonte só, usada nos dois
                            // lugares; cai no total de produtos (sem taxa) só quando a venda é
                            // antiga o bastante pra não ter payment_details.methods gravado.
                            const itemsTotal = selectedOrderDetails.order_items?.reduce((sum, item) => sum + (item.price_at_time * item.quantity), 0) || 0;
                            const methods = selectedOrderDetails.payment_details?.methods;
                            const totalPago = getOrderDisplayTotal(selectedOrderDetails);
                            // Achado real (WhatsApp do usuário, 2026-08-27): a diferença entre
                            // "Itens do Pedido" e "Total Pago" já existia (é a taxa de serviço),
                            // mas nunca aparecia ESCRITA neste modal — só dava pra perceber
                            // subtraindo os dois números na mão. Mesmo texto/valor que o
                            // comprovante impresso já mostra (printBillReceipt), reaproveitado
                            // aqui em vez de duplicar a lógica.
                            const feeAmount = Number((totalPago - itemsTotal).toFixed(2));
                            return (
                                <>
                                    {feeAmount > 0.01 && (
                                        <div className="flex justify-between text-sm -mt-2">
                                            <span className="text-[var(--text-muted)]">Subtotal</span>
                                            <span className="text-[var(--text-muted)]">R$ {formatBRL(itemsTotal)}</span>
                                        </div>
                                    )}
                                    {feeAmount > 0.01 && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-[var(--text-muted)]">Taxa de Serviço ({formatServiceFeeRate(store.config?.service_fee_rate ?? SERVICE_FEE_RATE)} opcional)</span>
                                            <span className="font-medium text-[var(--text)]">R$ {formatBRL(feeAmount)}</span>
                                        </div>
                                    )}
                                    <div>
                                        <h4 className="font-bold text-[var(--text)] mb-2 border-b border-[var(--border)] pb-1">Pagamento</h4>
                                        <div className="text-sm space-y-1">
                                            {methods ? (
                                                methods.map((m: any, i: number) => (
                                                    <div key={i} className="flex justify-between">
                                                        <span className="text-[var(--text-muted)]">
                                                            {getPaymentMethodLabel(m.method)}
                                                            {m.brand && ` · ${getCardBrandLabel(m.brand)}`}
                                                        </span>
                                                        <span className="font-medium text-[var(--text)]">R$ {formatBRL(m.amount)}</span>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="flex justify-between">
                                                    <span className="text-[var(--text-muted)]">{getPaymentMethodLabel(selectedOrderDetails.payment_method)}</span>
                                                    <span className="font-medium text-[var(--text)]">R$ {formatBRL(itemsTotal)}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="border-t border-[var(--border)] pt-4 flex justify-between items-center">
                                        <span className="font-bold text-lg text-[var(--text)]">Total Pago</span>
                                        <span className="font-black text-2xl text-[var(--brand)]">
                                            R$ {formatBRL(totalPago)}
                                        </span>
                                    </div>
                                    <Button
                                        variant="secondary"
                                        className="w-full"
                                        onClick={() => handleReprintReceipt(selectedOrderDetails)}
                                    >
                                        <Printer size={16} className="mr-2" /> Reimprimir Comprovante
                                    </Button>
                                </>
                            );
                        })()}
                    </div>
                )}
            </Modal>
                </div>
            </div>
        </div>
    );
};

// --- SUB-MODULE: NOTAS FISCAIS ---

// Normaliza os dois campos livres de captura do destinatário (CPF/CNPJ +
// nome) num objeto pronto pra mandar pro backend, ou `undefined` se o
// documento ficou em branco (Task 17) — mesma regra usada nas três telas
// que capturam esse dado (TablesView, CounterView, FiscalNotasView
// "Reemitir"): só dígitos no documento, nome default 'Consumidor' se
// digitado em branco. A validação de tamanho (11/14 dígitos) é feita no
// servidor (app/api/fiscal/emitir/route.ts), não aqui — este helper só
// normaliza formato, não valida.
const buildDestinatario = (cpfCnpj: string, nome: string): { cpfCnpj: string; nome: string } | undefined => {
    const digits = cpfCnpj.replace(/\D/g, '');
    if (!digits) return undefined;
    return { cpfCnpj: digits, nome: nome.trim() || 'Consumidor' };
};

const FISCAL_STATUS_LABELS: Record<string, string> = {
    autorizada: 'Autorizada',
    pendente: 'Pendente',
    rejeitada: 'Rejeitada',
    erro: 'Erro',
};

const fiscalStatusBadgeColor = (status: string): string => {
    switch (status) {
        case 'autorizada': return 'bg-[var(--ok)]/10 text-[var(--ok)] border border-[var(--ok)]/20';
        case 'pendente': return 'bg-[var(--info)]/10 text-[var(--info)] border border-[var(--info)]/20';
        default: return 'bg-[var(--err)]/10 text-[var(--err)] border border-[var(--err)]/20'; // 'erro'/'rejeitada'
    }
};

// 'erro'/'rejeitada'/'pendente' podem ser reemitidas com sucesso — só
// 'autorizada' representa um documento real já existente na SEFAZ. A guarda
// de idempotência de app/api/fiscal/emitir/route.ts (e o índice único da
// migration 037) bloqueiam só 'autorizada' com
// {skipped:true, reason:'Nota já existe para esta venda'} — os outros três
// status sempre deixam uma nova tentativa rodar o pipeline do zero.
// 'pendente' (Task 17, 2026-08-06) é o caso mais comum de "Reemitir" na
// prática: nota de NF-e que nasceu sem CPF/CNPJ do destinatário, cai
// pendente ANTES de consumir numeração/tocar a SEFAZ, e só precisa que o
// lojista preencha o documento (Task 16, esta tela) e tente de novo.
const RETRYABLE_FISCAL_STATUSES = ['erro', 'rejeitada', 'pendente'];

const FiscalNotasView: React.FC<{ storeId: string }> = ({ storeId }) => {
    const [notas, setNotas] = useState<FiscalNota[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [retryingId, setRetryingId] = useState<string | null>(null);

    // Destinatário na reemissão (Task 17, achado de revisão — sem isso, uma
    // nota 'pendente' por falta de CPF/CNPJ nunca tinha como ser completada:
    // "Reemitir" só reenviava {orderId, tableId}, sem jeito nenhum de passar
    // o documento). Só relevante pra NF-e (modelo 55); "Reemitir" numa nota
    // NFC-e continua instantâneo, sem modal — motivo de rejeição nunca é
    // destinatário nesse modelo (NFC-e não tem <dest>).
    const [retryingNota, setRetryingNota] = useState<FiscalNota | null>(null);
    const [retryDestCpfCnpj, setRetryDestCpfCnpj] = useState('');
    const [retryDestNome, setRetryDestNome] = useState('');
    // Filtro por ambiente (2026-08-16, pedido explícito do usuário) — sem isso
    // não dá pra separar visualmente nota de homologação (sem valor fiscal)
    // de nota de produção (documento real) na mesma lista.
    const [ambienteFilter, setAmbienteFilter] = useState<'todos' | 'homologacao' | 'producao'>('todos');
    // Filtro por tipo de documento (2026-08-16, pedido explícito do usuário)
    // — NF-e e NFC-e vinham sempre juntas na mesma lista, sem jeito de olhar
    // só um tipo. Mesmo padrão do filtro de ambiente acima.
    const [tipoFilter, setTipoFilter] = useState<'todos' | '55' | '65'>('todos');
    // Filtro de período pro "Exportar período" (Task 5, 2026-08-23) — reaproveita
    // o mesmo padrão de Data Inicial/Data Final já usado no Histórico de Vendas
    // (StoreAdminView acima), <Input type="date"> simples. Não filtra a tabela
    // em si (isso já é feito pelos filtros de ambiente/tipo acima) — só delimita
    // o intervalo mandado pra rota de exportação.
    const [exportStartDate, setExportStartDate] = useState('');
    const [exportEndDate, setExportEndDate] = useState('');
    const [isExporting, setIsExporting] = useState(false);
    const filteredNotas = notas
        .filter(n => ambienteFilter === 'todos' || n.ambiente === ambienteFilter)
        .filter(n => tipoFilter === 'todos' || n.modelo === tipoFilter);

    // Baixa o ZIP (XMLs + CSV) do período via app/api/fiscal/exportar — a
    // rota resolve as notas server-side só por storeId+intervalo (nunca por
    // uma lista de ids que este componente mandasse), então não precisa (e
    // não deve) mandar `filteredNotas`/ids nenhum aqui, só o intervalo.
    const handleExportPeriodo = async () => {
        setIsExporting(true);
        try {
            const params = new URLSearchParams({ storeId });
            if (exportStartDate) params.set('startDate', exportStartDate);
            if (exportEndDate) params.set('endDate', exportEndDate);
            const res = await fetch(`/api/fiscal/exportar?${params.toString()}`);
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.message || 'Falha ao exportar notas fiscais.');
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `notas-fiscais${exportStartDate ? `_${exportStartDate}` : ''}${exportEndDate ? `_a_${exportEndDate}` : ''}.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e: any) {
            toast.error(e.message || 'Erro ao exportar notas fiscais.');
        } finally {
            setIsExporting(false);
        }
    };

    const load = async () => {
        setIsLoading(true);
        try {
            const data = await fetchFiscalNotas(storeId);
            setNotas(data);
        } catch (e: any) {
            toast.error('Erro ao carregar notas fiscais: ' + e.message);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { load(); }, [storeId]);

    const handleDownload = async (nota: FiscalNota) => {
        if (!nota.pdf_path) return;
        setDownloadingId(nota.id);
        try {
            const url = await fetchFiscalNotaPdfUrl(nota.id, nota.pdf_path);
            window.open(url, '_blank', 'noopener');
        } catch (e: any) {
            toast.error('Erro ao gerar link do PDF: ' + e.message);
        } finally {
            setDownloadingId(null);
        }
    };

    // Reemite mandando order_id E table_id juntos (quando a nota tem os
    // dois) — achado de revisão (2026-08-05) numa primeira versão que
    // mandava só order_id: a rota de emissão resolve QUAL order buscar
    // usando `if (body.orderId) {...} else if (body.tableId) {...}`, então
    // mandar os dois ainda usa o caminho orderId pra achar os itens (sem
    // restrição de tempo — ver próximo parágrafo) — mas
    // `notaBase.table_id = body.tableId ?? null` é montado independente de
    // qual branch resolveu os itens. Mandar só orderId fazia a nota
    // reemitida gravar `table_id: null`, diferente do `table_id` real que a
    // tentativa original (via fechamento de mesa) gravou — e como os dois
    // guards de idempotência (o SELECT em app/api/fiscal/emitir/route.ts E
    // o índice único da migration 036) usam `table_id` como parte da chave,
    // isso tornava a nota reemitida invisível pra uma futura checagem de
    // idempotência pela mesma mesa, reabrindo exatamente o risco de
    // documento duplicado que aquele guard existe pra evitar. Mandando os
    // dois, a rota ainda resolve via orderId (não muda o comportamento
    // buscado abaixo) mas `table_id` grava idêntico ao que a tentativa
    // original teria gravado.
    //
    // Por que ainda manda orderId (não só tableId): order_id é a "âncora"
    // da venda (sempre populado desde a correção do Task 13, ver comentário
    // em app/api/fiscal/emitir/route.ts) e a rota resolve ele com um select
    // direto por id, sem restrição de tempo. O caminho por table_id sozinho
    // só aceita orders com status 'delivered' E updated_at nos últimos 5
    // minutos — uma reemissão manual clicada pelo lojista minutos/horas
    // depois da falha (o caso comum: ele vê o erro na tela e clica
    // "Reemitir" bem depois) quase sempre cairia fora dessa janela e
    // voltaria "Pedido(s) não encontrado(s)", uma falha confusa e evitável.
    //
    // Nota sobre o trade-off de "order_id sozinho só pega os itens da order
    // âncora": isso seria um problema real SE uma venda de mesa pudesse ter
    // mais de um `order` na mesma sessão de fechamento. Investigado e
    // descartado como cenário real neste código: `create_order_secure`
    // (migrations 007/019/028) só cria uma nova `order` pra mesa quando não
    // existe nenhuma `pending` ainda — e pedido de mesa não passa por
    // `send_order_to_kitchen_secure`/mudança de status até o fechamento
    // (isso só existe pro fluxo de Balcão), então uma mesa acumula tudo
    // numa única `order` a visita inteira. Confirmado ao vivo: toda venda
    // de mesa já fechada no banco de dev tem exatamente 1 `order`. Continua
    // defensivamente correto mandar table_id de qualquer forma (não custa
    // nada e cobre qualquer mudança futura nesse comportamento), só não é
    // um risco comum hoje.
    const handleRetry = async (nota: FiscalNota, destinatario?: { cpfCnpj: string; nome: string }) => {
        if (!nota.order_id) {
            toast.error('Esta nota não tem um pedido associado — não é possível reemitir.');
            return;
        }
        setRetryingId(nota.id);
        try {
            const result = await reemitirFiscalNota({ orderId: nota.order_id, tableId: nota.table_id ?? undefined, destinatario });
            if (result?.ok) {
                toast.success(result.pdfWarning ? `Nota autorizada, mas: ${result.pdfWarning}` : 'Nota reemitida e autorizada com sucesso!');
            } else if (result?.skipped) {
                toast.error(result.reason || 'Reemissão não foi necessária.');
            } else {
                toast.error(result?.xMotivo || result?.reason || 'Falha ao reemitir a nota.');
            }
            await load();
        } catch (e: any) {
            toast.error('Erro ao reemitir: ' + e.message);
        } finally {
            setRetryingId(null);
        }
    };

    // Clique no botão "Reemitir" — NF-e (modelo 55) abre o modal opcional de
    // CPF/CNPJ antes de tentar de novo (o motivo mais comum de uma nota
    // 'pendente' é justamente faltar esse dado); NFC-e (modelo 65) reemite
    // na hora, igual sempre foi, porque destinatário não existe nesse modelo.
    const handleRetryClick = (nota: FiscalNota) => {
        if (nota.modelo === '55') {
            setRetryingNota(nota);
            setRetryDestCpfCnpj('');
            setRetryDestNome('');
            return;
        }
        handleRetry(nota);
    };

    const handleConfirmRetryWithDestinatario = async () => {
        if (!retryingNota) return;
        const destinatario = buildDestinatario(retryDestCpfCnpj, retryDestNome);
        await handleRetry(retryingNota, destinatario);
        setRetryingNota(null);
    };

    return (
        <div className="space-y-6">
            <Card className="overflow-hidden shadow-sm border border-[var(--border)]">
                <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-2)] flex flex-col gap-3">
                    <div className="flex justify-between items-center flex-wrap gap-2">
                        <h3 className="font-bold text-lg text-[var(--text)]">Notas Fiscais</h3>
                        <div className="flex items-center gap-2 flex-wrap">
                            <select
                                className="h-8 px-2 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
                                value={tipoFilter}
                                onChange={(e) => setTipoFilter(e.target.value as 'todos' | '55' | '65')}
                            >
                                <option value="todos">NF-e e NFC-e</option>
                                <option value="55">Só NF-e</option>
                                <option value="65">Só NFC-e</option>
                            </select>
                            <select
                                className="h-8 px-2 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
                                value={ambienteFilter}
                                onChange={(e) => setAmbienteFilter(e.target.value as 'todos' | 'homologacao' | 'producao')}
                            >
                                <option value="todos">Todos os ambientes</option>
                                <option value="homologacao">Só Homologação</option>
                                <option value="producao">Só Produção</option>
                            </select>
                            <Button variant="secondary" className="h-8 px-3 text-xs" onClick={load} isLoading={isLoading}>
                                <RefreshCw size={14} className="mr-1.5" /> Atualizar
                            </Button>
                            <Badge color="bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-muted)]">
                                {filteredNotas.length} {filteredNotas.length === 1 ? 'nota' : 'notas'}
                            </Badge>
                        </div>
                    </div>
                    {/* Filtro de período + exportação em lote (Task 5, 2026-08-23) — a
                        rota app/api/fiscal/exportar resolve as notas server-side só por
                        storeId + este intervalo, nunca por uma lista mandada daqui. */}
                    <div className="flex items-end gap-2 flex-wrap">
                        <div>
                            <label className="block text-xs font-bold text-[var(--text-muted)] uppercase mb-1">Data Inicial</label>
                            <Input type="date" value={exportStartDate} onChange={e => setExportStartDate(e.target.value)} className="h-8 text-xs" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-[var(--text-muted)] uppercase mb-1">Data Final</label>
                            <Input type="date" value={exportEndDate} onChange={e => setExportEndDate(e.target.value)} className="h-8 text-xs" />
                        </div>
                        <Button variant="secondary" className="h-8 px-3 text-xs" onClick={handleExportPeriodo} isLoading={isExporting}>
                            <Download size={14} className="mr-1.5" /> Exportar período
                        </Button>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-[var(--surface-2)] text-[var(--text-muted)] uppercase text-xs">
                            <tr>
                                <th className="px-4 py-3">Data</th>
                                <th className="px-4 py-3 text-right">Valor</th>
                                <th className="px-4 py-3">Modelo</th>
                                <th className="px-4 py-3">Ambiente</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Chave de Acesso</th>
                                <th className="px-4 py-3 text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                            {isLoading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i} className="u-stagger" style={stagger(i * 30)}>
                                        <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                                        <td className="px-4 py-3"><Skeleton className="h-4 w-16 ml-auto" /></td>
                                        <td className="px-4 py-3"><Skeleton className="h-4 w-12" /></td>
                                        <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
                                        <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
                                        <td className="px-4 py-3"><Skeleton className="h-4 w-40" /></td>
                                        <td className="px-4 py-3"><Skeleton className="h-4 w-24 ml-auto" /></td>
                                    </tr>
                                ))
                            ) : filteredNotas.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-[var(--text-muted)] italic">
                                        {notas.length === 0 ? 'Nenhuma nota fiscal emitida ainda.' : 'Nenhuma nota com esses filtros.'}
                                    </td>
                                </tr>
                            ) : (
                                filteredNotas.map((nota, idx) => (
                                    <tr key={nota.id} className="u-stagger hover:bg-[var(--surface-2)] transition-colors" style={stagger(Math.min(idx, 10) * 30)}>
                                        <td className="px-4 py-3 text-[var(--text-muted)] whitespace-nowrap">
                                            {new Date(nota.created_at).toLocaleDateString()} <span className="text-xs text-[var(--text-muted)]/70 ml-1">{new Date(nota.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-bold text-[var(--text)] whitespace-nowrap">
                                            R$ {formatBRL(nota.valor_total ?? 0)}
                                        </td>
                                        <td className="px-4 py-3 text-[var(--text-muted)]">
                                            {nota.modelo === '55' ? 'NF-e' : 'NFC-e'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <Badge color={nota.ambiente === 'homologacao' ? 'bg-[var(--warn)]/10 border border-[var(--warn)]/30 text-[var(--warn)]' : 'bg-[var(--err)]/10 border border-[var(--err)]/30 text-[var(--err)]'}>
                                                {nota.ambiente === 'homologacao' ? 'Homologação' : 'Produção'}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-3">
                                            <Badge color={fiscalStatusBadgeColor(nota.status)}>
                                                {FISCAL_STATUS_LABELS[nota.status] || nota.status}
                                            </Badge>
                                            {nota.motivo_erro && (
                                                <p className="text-xs text-[var(--text-muted)] mt-1 max-w-xs truncate" title={nota.motivo_erro}>{nota.motivo_erro}</p>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-[var(--text-muted)] font-mono text-xs">
                                            {nota.chave_acesso ? (
                                                <span title={nota.chave_acesso}>{nota.chave_acesso.slice(0, 8)}…{nota.chave_acesso.slice(-8)}</span>
                                            ) : '—'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex justify-end gap-2">
                                                {nota.pdf_path && (
                                                    <Button variant="secondary" size="sm" onClick={() => handleDownload(nota)} isLoading={downloadingId === nota.id}>
                                                        <Download size={14} className="mr-1.5" /> {nota.modelo === '55' ? 'DANFE' : 'Cupom'}
                                                    </Button>
                                                )}
                                                {RETRYABLE_FISCAL_STATUSES.includes(nota.status) && (
                                                    <Button variant="outline" size="sm" onClick={() => handleRetryClick(nota)} isLoading={retryingId === nota.id}>
                                                        <RotateCcw size={14} className="mr-1.5" /> Reemitir
                                                    </Button>
                                                )}
                                                {!nota.pdf_path && !RETRYABLE_FISCAL_STATUSES.includes(nota.status) && (
                                                    <span className="text-xs text-[var(--text-muted)]/70">—</span>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>

            {/* Destinatário da NF-e na reemissão (Task 17) — só abre pra
                notas modelo 55 (handleRetryClick decide isso antes). */}
            <Modal isOpen={!!retryingNota} onClose={() => setRetryingNota(null)} title="Reemitir Nota">
                <div className="space-y-4">
                    <div className="bg-[var(--info)]/5 p-3 rounded-xl border border-[var(--info)]/20 space-y-2">
                        <p className="text-xs font-bold text-[var(--info)] uppercase tracking-wide">
                            Documento do destinatário (NF-e, opcional)
                        </p>
                        <input
                            type="text"
                            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] focus:border-[var(--brand)] focus:outline-none text-sm"
                            placeholder="CPF ou CNPJ do cliente"
                            value={retryDestCpfCnpj}
                            onChange={(e) => setRetryDestCpfCnpj(e.target.value)}
                        />
                        <input
                            type="text"
                            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] focus:border-[var(--brand)] focus:outline-none text-sm"
                            placeholder="Nome do cliente"
                            value={retryDestNome}
                            onChange={(e) => setRetryDestNome(e.target.value)}
                        />
                        <p className="text-xs text-[var(--text-muted)]">
                            Se esta nota caiu pendente por falta de documento, preencha aqui antes de reemitir.
                            Se o motivo foi outro (ex.: certificado/SEFAZ fora do ar), pode deixar em branco.
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="secondary" className="flex-1" onClick={() => setRetryingNota(null)}>
                            Cancelar
                        </Button>
                        <Button
                            className="flex-1"
                            onClick={handleConfirmRetryWithDestinatario}
                            isLoading={!!retryingNota && retryingId === retryingNota.id}
                        >
                            Confirmar Reemissão
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

// Chave do localStorage onde fica { userId, storeId } da sessão do lojista —
// só o suficiente pra rebuscar o store_user via fetchStoreUserById depois de
// um F5 (achado de bug #6). Nunca guarda senha nem dado sensível.
const STORE_SESSION_STORAGE_KEY = 'ntb_store_session';

// Achado ao vivo (2026-08-29): a sessão de login já sobrevivia a um F5
// (bug #6, ver acima), mas a ABA em que a pessoa estava sempre voltava pro
// padrão (`pickInitialStoreTab`) -- dar refresh no meio de uma tarefa em
// Administração/Balcão/Cardápio jogava de volta pra Mesas sem aviso. Guarda
// só o id da aba, nunca dado sensível; revalidado contra as permissões
// atuais do usuário na restauração (ver useEffect de sessão abaixo) --
// nunca aplicado cego, senão um admin trocado de módulo depois do último
// login reabriria numa aba que não devia mais acessar.
const STORE_LAST_TAB_STORAGE_KEY = 'ntb_store_last_tab';

// Mesma regra de "primeira aba visível" usada tanto no login normal quanto na
// restauração de sessão — extraída pra não duplicar a cascata de permissões.
// Task 1 (perfil de módulos por loja): a cascata agora também pula módulo
// desligado na loja, não só permissão negada — senão um usuário cujo
// primeiro módulo na ordem (ex.: "tables") está desligado na loja cairia lá
// mesmo assim e bateria na tela de "sem permissão" em vez de ir pra próxima
// aba válida.
//
// Fix round 1 (Task 1 review, Important #1 — "self-inflicted lockout"): o
// fallback antigo (`?? 'admin'`) devolvia o literal 'admin' sem checar se
// 'admin' de fato estava acessível, então uma loja com todos os módulos
// desligados (sem validação nenhuma impedindo o Master Admin de salvar
// assim) estranhava o dono/conta universal numa aba sem conteúdo e sem
// NENHUMA aba visível na sidebar pra sair de lá. `computeAccessibleTabIds`
// (lib/storeModules.ts) já garante que 'admin' sobra acessível quando mais
// nenhuma aba sobraria — aqui só percorremos TAB_IDS na ordem de sempre até
// achar a primeira que está nesse conjunto.
const pickInitialStoreTab = (u: StoreUser & { store: Store }): string => {
    const modules = resolveStoreModules(u.store);
    const hasPermission = (tabId: string) => hasTabPermission(u, tabId, u.store);
    const accessible = computeAccessibleTabIds(modules, hasPermission);
    return TAB_IDS.find((t) => accessible.has(t)) ?? 'admin';
};

export const StoreModule: React.FC = () => {
    const [user, setUser] = useState<(StoreUser & { store: Store }) | null>(null);
    const [tab, setTab] = useState('tables');
    // Task 3 (frente-de-caixa): "ponte" entre a aba Caixa (CaixaView, fila
    // consolidada) e TablesView/CounterView — tocar num item da fila troca
    // de aba E passa o id pra view de destino abrir sozinha o modal
    // "Receber Pagamento" que ela já tem (autoOpenTableId/autoOpenOrderId).
    // Vive aqui (não dentro de CaixaView) porque é o único componente que
    // sobrevive à troca de aba.
    const [caixaFocusTableId, setCaixaFocusTableId] = useState<string | undefined>();
    const [caixaFocusOrderId, setCaixaFocusOrderId] = useState<string | undefined>();
    // true enquanto tenta restaurar a sessão salva no localStorage — evita
    // piscar a tela de login por um frame antes de saber se há sessão válida.
    const [isRestoringSession, setIsRestoringSession] = useState(true);

    // Restaura a sessão do lojista após F5 (achado de bug #6 — comentário
    // antigo "Restore session check? Maybe later" reconhecia a lacuna). Se
    // existir { userId, storeId } salvo no login anterior, rebusca o
    // store_user (fetchStoreUserById já revalida loja/usuário ativos, mesma
    // lógica de authenticateStoreUser) e loga sem pedir senha de novo. Se a
    // sessão salva não for mais válida (loja desativada, usuário removido),
    // limpa o localStorage e cai na tela de login normalmente.
    useEffect(() => {
        const raw = typeof window !== 'undefined' ? localStorage.getItem(STORE_SESSION_STORAGE_KEY) : null;
        if (!raw) {
            setIsRestoringSession(false);
            return;
        }

        (async () => {
            try {
                const saved = JSON.parse(raw) as { userId?: string; storeId?: string; isUniversal?: boolean };
                let restoredUser: (StoreUser & { store: Store }) | null = null;

                if (saved?.isUniversal && saved.userId && saved.storeId) {
                    // Conta universal: reconstrói o usuário sintético a partir
                    // de universal_users + stores, em vez de store_users (o id
                    // salvo não existe nessa tabela).
                    const [universalUser, store] = await Promise.all([
                        fetchUniversalUserById(saved.userId),
                        fetchStoreById(saved.storeId),
                    ]);
                    if (universalUser && store && store.is_active) {
                        restoredUser = {
                            id: universalUser.id,
                            store_id: store.id,
                            name: universalUser.name,
                            email: universalUser.email,
                            role: 'universal',
                            must_change_password: false,
                            permissions: universalPermissionsFor(store),
                            store,
                        };
                    }
                } else if (saved?.userId) {
                    restoredUser = await fetchStoreUserById(saved.userId);
                }

                if (restoredUser) {
                    setUser(restoredUser);
                    const savedTab = localStorage.getItem(STORE_LAST_TAB_STORAGE_KEY);
                    const modules = resolveStoreModules(restoredUser.store);
                    const hasPermission = (t: string) => hasTabPermission(restoredUser, t, restoredUser.store);
                    const accessible = computeAccessibleTabIds(modules, hasPermission);
                    setTab(savedTab && accessible.has(savedTab) ? savedTab : pickInitialStoreTab(restoredUser));
                } else {
                    localStorage.removeItem(STORE_SESSION_STORAGE_KEY);
                }
            } catch {
                localStorage.removeItem(STORE_SESSION_STORAGE_KEY);
            } finally {
                setIsRestoringSession(false);
            }
        })();
    }, []);

    // Persiste a aba atual a cada troca, pro F5 poder restaurar (ver
    // STORE_LAST_TAB_STORAGE_KEY acima). Só grava com sessão ativa -- nunca
    // quer dizer nada antes do login.
    useEffect(() => {
        if (!user) return;
        localStorage.setItem(STORE_LAST_TAB_STORAGE_KEY, tab);
    }, [tab, user]);

    const handleLogin = (u: StoreUser & { store: Store }) => {
        setUser(u);
        setTab(pickInitialStoreTab(u));
        localStorage.setItem(STORE_SESSION_STORAGE_KEY, JSON.stringify({ userId: u.id, storeId: u.store.id, isUniversal: u.role === 'universal' }));
    };

    const handleLogout = () => {
        setUser(null);
        localStorage.removeItem(STORE_LAST_TAB_STORAGE_KEY);
        localStorage.removeItem(STORE_SESSION_STORAGE_KEY);
    };

    // Botão "Trocar de Loja" da conta universal: mesma ação de logout, só
    // com um rótulo mais claro pra quem está usando a conta universal (o
    // e-mail/senha universal continua o mesmo pro próximo login, só o
    // seletor de loja é reaberto).
    const handleSwitchStore = handleLogout;

    // MotionConfig reducedMotion="user" envolve TODO retorno deste componente
    // (inclusive as telas de loading/login abaixo, que usam Button com
    // whileTap) — não só o retorno autenticado no fim da função. Ver
    // task-8-fix-round-1-report.md: o wrap original (Task 8) só cobria o
    // <StoreLayout> final, deixando a tela de "Restaurando sessão..." e
    // StoreLogin (incluindo os sub-fluxos de troca de senha/seletor de loja
    // universal) fora do Context, springando normalmente mesmo com
    // prefers-reduced-motion ativo.
    if (isRestoringSession) {
        return (
            <MotionConfig reducedMotion="user">
                <div className="force-light auth-shell min-h-screen flex items-center justify-center bg-[var(--bg)] p-4">
                    <div className="auth-mesh" />
                    <div className="auth-grain" />
                    <div className="relative z-[1] flex flex-col items-center gap-3 text-[var(--text-muted)]">
                        <RefreshCw size={28} className="animate-spin text-[var(--brand)]" />
                        <p className="text-sm">Restaurando sessão...</p>
                    </div>
                </div>
            </MotionConfig>
        );
    }

    if (!user) {
        return (
            <MotionConfig reducedMotion="user">
                <StoreLogin onLogin={handleLogin} />
            </MotionConfig>
        );
    }

    // Permission Check — Task 1 (perfil de módulos por loja): agora exige as
    // DUAS coisas, o usuário ter permissão E a loja ter o módulo ligado.
    // 'kitchen'/'bar' (nomes de aba/permissão) mapeiam pros módulos mais
    // específicos kitchen_kds/bar_kds via TAB_MODULE_KEY (dentro de
    // computeAccessibleTabIds). Fix round 1 (Important #1): usa a mesma
    // função compartilhada de pickInitialStoreTab/StoreLayout.visibleTabs —
    // ela garante que 'admin' nunca fica fora de alcance de todo mundo ao
    // mesmo tempo (ver lib/storeModules.ts).
    const storeModules = resolveStoreModules(user.store);
    const hasPermission = (t: string) => hasTabPermission(user, t, user.store);
    const accessibleTabIds = computeAccessibleTabIds(storeModules, hasPermission);
    const canAccess = (t: string) => accessibleTabIds.has(t);

    // Terceiro wrap de MotionConfig (view autenticada) — ver comentário
    // acima dos dois primeiros (loading/login) pro porquê de precisar de um
    // por branch, e não um único wrap externo cobrindo tudo.
    return (
        <MotionConfig reducedMotion="user">
        <StoreLayout
            title={
                tab === 'caixa' ? 'Caixa' :
                tab === 'tables' ? 'Mesas & Comandas' :
                tab === 'counter' ? 'Pedidos Balcão' :
                tab === 'kitchen' ? 'Monitor de Cozinha (KDS)' :
                tab === 'bar' ? 'Monitor do Bar (KDS)' :
                tab === 'menu' ? 'Gestão de Cardápio' :
                'Administração'
            }
            currentTab={tab}
            onTabChange={setTab}
            storeName={user.store.name}
            onLogout={handleLogout}
            onSwitchStore={handleSwitchStore}
            user={user}
        >
            {tab === 'caixa' && canAccess('caixa') && (
                <CaixaView
                    store={user.store}
                    loggedUser={user}
                    onOpenTablePayment={(tableId) => { setCaixaFocusTableId(tableId); setTab('tables'); }}
                    onOpenCounterPayment={(orderId) => { setCaixaFocusOrderId(orderId); setTab('counter'); }}
                />
            )}
            {tab === 'tables' && canAccess('tables') && (
                <TablesView
                    store={user.store}
                    loggedUser={user}
                    autoOpenTableId={caixaFocusTableId}
                    onAutoOpenTableHandled={() => setCaixaFocusTableId(undefined)}
                />
            )}
            {tab === 'counter' && canAccess('counter') && (
                <CounterView
                    store={user.store}
                    loggedUser={user}
                    autoOpenOrderId={caixaFocusOrderId}
                    onAutoOpenOrderHandled={() => setCaixaFocusOrderId(undefined)}
                />
            )}
            {tab === 'kitchen' && canAccess('kitchen') && <KdsView destination="kitchen" store={user.store} />}
            {tab === 'bar' && canAccess('bar') && <KdsView destination="bar" store={user.store} />}
            {tab === 'menu' && canAccess('menu') && <MenuManagementView store={user.store} onStoreUpdate={(updatedStore) => setUser({ ...user, store: updatedStore })} />}
            {tab === 'admin' && canAccess('admin') && <StoreAdminView store={user.store} onStoreUpdate={(updatedStore) => setUser({ ...user, store: updatedStore })} />}

            {!canAccess(tab) && (
                <div className="flex flex-col items-center justify-center h-64 text-[var(--text-muted)]">
                    <Lock size={48} className="mb-4 opacity-20"/>
                    <p>Você não tem permissão para acessar esta área.</p>
                </div>
            )}
        </StoreLayout>
        </MotionConfig>
    );
}