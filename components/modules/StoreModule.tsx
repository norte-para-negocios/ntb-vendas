'use client';
import { normalizarNcm } from '@/lib/fiscal/ncm';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { usePolling } from '@/lib/usePolling';
import { publicarMesas, publicarKds } from '@/lib/dadosAoVivo';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence, MotionConfig, useDragControls, useAnimate, useReducedMotion } from 'motion/react';
import { SPRING_TAP, SPRING_SHEET, SPRING_UI, LIST_ITEM_MOTION } from '@/lib/motion';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { flashSuccessCheck } from '@/components/SuccessCheck';
import { resolveStoreModules, resolveOrderFlow, computeAccessibleTabIds, TAB_IDS, TAB_MODULE_KEY, hasTabPermission, canFinalizeBill, isTableInJurisdiction, isCounterPaymentFirst, isCounterOrderPaid, podeTrocarOuExcluir } from '@/lib/storeModules';
import { useCaixaPrintStation, CaixaPrintStationIndicator, CaixaPrintStationOfflineBanner, wasKitchenTicketPrinted, printPendingKitchenTicket, isCaixaRole } from '@/components/modules/CaixaPrintStation';
import PrinterSettingsView from '@/components/modules/PrinterSettingsView';
import StoreSettingsView from '@/components/modules/StoreSettingsView';
import { AdminNavShell } from '@/components/modules/admin/AdminNavShell';
import { useAdminStatus } from '@/components/modules/admin/useAdminStatus';
import RolePermissionsView from '@/components/modules/RolePermissionsView';
import CardapioSaudeView from '@/components/modules/CardapioSaudeView';
import RegrasCaixaView from '@/components/modules/admin/RegrasCaixaView';
import type { AbaId, NavCtx } from '@/lib/adminNav';
import CouponManagementView from '@/components/modules/CouponManagementView';
import { dentroDoPrazoCancelamento, limiteCancelamento, mensagemPrazoEncerrado, PRAZO_CANCELAMENTO_TEXTO } from '@/lib/fiscal/prazoCancelamento';
import { LayoutDashboard, UtensilsCrossed, ChefHat, LogOut, CheckCircle, Clock, RotateCcw, Lock, Store as StoreIcon, AlertCircle, Plus, Edit2, Trash2, Image as ImageIcon, ToggleLeft, ToggleRight, X, Coffee, Receipt, LayoutGrid, RefreshCw, Upload, Camera, Settings, Ban, Unlock, User, BellRing, Search, Minus, BarChart3, Printer, Wallet, CreditCard, Banknote, QrCode, Gift, ArrowRight, ArrowRightLeft, ChevronLeft, ChevronRight, Eye, EyeOff, GripVertical, Wine, Users, List, Calculator, CheckSquare, Square, Menu, Download, Star, FileText, Pencil, Pause, Play, TrendingDown, TrendingUp, History, Shield, WifiOff, AlertTriangle } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult, DraggableProvided, DraggableStateSnapshot } from '@hello-pangea/dnd';
import { differenceInDays, format, parseISO } from 'date-fns';
import { Button, Card, Badge, Modal, Input, Collapsible, SegmentedControl } from '@/components/ui';
import { ProductThumb } from '@/components/ProductThumb';
import { formatAppVersion } from '@/lib/appVersion';
import { AuthBackdrop } from '@/components/AuthBackdrop';
import { FloorPlanView } from './FloorPlanView';
import { PedidosDoDiaView } from './PedidosDoDiaView';
import { ExceptionsReportView } from './ExceptionsReportView';
import { PriceSchedulesView } from './PriceSchedulesView';
import { ReportsView } from './ReportsView';
import { RelatorioMenu } from './RelatorioMenu';
import { StaffOfflineBanner } from '@/components/StaffOfflineBanner';
import { canUndo } from '@/lib/undoGuard';
import { subtituloHistorico, nomeArquivoHistorico, type FiltrosHistorico } from '@/lib/reports/historicoRotulos';
import { applySalesFilters, describeFilters, EMPTY_FILTERS, type SalesFilters } from '@/lib/reports/salesFilters';
import { completarFormas, completarCartoes, ticketMedio } from '@/lib/caixaResumo';
import { resolveCancelReasons } from '@/lib/excecoes';
import { fetchFeeProducts, addFeeItem, setProductFee, fetchKitchenOrders, updateOrderItemStatus, fetchTables, authenticateStoreUser, updateStoreUserPassword, fetchMenu, createCategory, deleteCategory, createProduct, updateProduct, deleteProduct, fetchCounterOrders, closeCounterOrder, uploadProductImage, uploadUserPhoto, updateOrderStatus, sendOrderToKitchen, fetchActiveOrdersForTables, toggleTableBlock, closeTableSession, dismissWaiterRequest, createOrder, cancelSpecificOrderItem, enfileirarCancelamento, fetchSalesHistory, clearSalesHistory, moveTable, updateTablesPositions, type PosicaoMesa, setProductSoldOut, transferItems, updateStoreConfig, fetchStoreTeamMembers, createStoreTeamMember, updateStoreTeamMember, deleteStoreTeamMember, toggleTableServiceFee, updateCategoryOrder, updateCategorySchedule, updateProductOrder, openTableManually, fetchTableSessions, fetchStoreUserById, fetchOrderRatings, authenticateUniversalUser, updateUniversalUserPassword, fetchUniversalUserById, fetchAllStores, fetchStoreById, syncProductOptionGroups, ProductOptionGroupInput, updateProductRecommendations, consolidateProductsIntoVariants, criarProdutoNoEstoque, setProductOmieCodigo, buscarProdutosNoEstoque, ProdutoEstoqueBusca, uploadStoreCertificate, saveStoreCertificateMetadata, saveStoreCertificateSecret, fetchStoreCertificateStatus, fetchStoreFiscalConfig, updateStoreFiscalConfig, UpdateStoreFiscalConfigParams, fetchFiscalNotas, fetchFiscalNotaPdfUrl, aguardarNotaFiscalDaVenda, descreverFalhaFiscalDaVenda, reemitirFiscalNota, cancelarFiscalNota, fetchNtbEstoqueIntegracaoStatus, saveNtbEstoqueIntegracaoConfig, NtbEstoqueIntegracaoStatus, type BaixasEstoqueResumo, fetchOmieDiretoStatus, saveOmieDiretoConfig, requestTableBill, cancelTableBillRequest, fetchOpenCashShift, fetchOpenCashShifts, openCashShift, registerCashMovement, fetchCashShiftSummary, closeCashShift, verifyCashSupervisor, verificarSenhaEquipe, registrarSenhaConferida, leituraFalhou, CashShiftSummary, CashShift, fetchCashShiftsHistory, CashShiftHistoryRow, fetchCashShiftAudit, CashShiftAuditEvent, fetchOpenCheckin, startCheckin, endCheckin, fetchCheckinsHistory, fetchOpenCheckinUserIds, subscribeToStoreOrderChanges, triggerPushForOrder, fetchReservationsByStore, updateReservationStatus, enqueueReceiptPrintJobs, enqueueFiscalCupomPrintJobs, printOfflineOrderTicket, fetchPrintSectors, fetchCategorySectors, createPrintSector, deletePrintSector, updateCategorySector, updateProductSector, hasActivePrinterForDestination, hasActivePrinterForDoc, fetchUsbPrinterForAutoprint, resolverUrlApi, registrarPagamentoBalcao, entregarPedidoBalcao, estornarPagamentoBalcao, iniciarMotorImpressaoDesktop, pararMotorImpressaoDesktop, createCategoryGroup, deleteCategoryGroup, updateCategoryGroupAssignment, toggleItemPriority } from '@/lib/api';
import { buildTopLevelItems, TopLevelItem } from '@/lib/categoryGroups';
import { OrderItem, OrderStatus, Table, TableStatus, StoreUser, StoreUserPermissions, Store, Category, CategoryGroup, PrintSector, Product, Order, TableSession, OrderRating, UniversalUser, ProductOptionGroup, ProductOption, SelectedOption, StoreFiscalCertificateStatus, FiscalNota, OperatorCheckin, TableReservation } from '@/types';
import { CASH_DENOMINATIONS, sumDenominationBreakdown } from '@/lib/cashDenominations';
import { supabase } from '@/lib/supabaseClient';
import { startOfflineSync, getSyncStatus, onSyncStatusChange, listarAcoesFalhas, reenviarAcaoFalha, descartarAcaoFalha, descreverAcaoFila, explicarDescarteAcao } from '@/lib/offline/sync';
import type { QueuedAction } from '@/lib/offline/types';
import { checkRealConnectivity, isNetworkError } from '@/lib/offline/network';
import { buildPendingOrdersForStore } from '@/lib/offline/pendingOrders';
import { getCachedMenu } from '@/lib/offline/cache';
import { toast } from '@/components/Toast';
import { useConexaoEstoque, SeloConexao, PainelConexao, BaixasEstoque } from '@/components/modules/settings/IntegracaoEstoque';
import { useStoreNotifications } from '@/lib/useStoreNotifications';
import { NotificacoesProvider } from '@/components/NotificacoesContext';
import { LocaisPreparoView } from '@/components/modules/LocaisPreparoView';
import { NotificationBell } from '@/components/NotificationBell';
import { ProducaoView } from '@/components/modules/ProducaoView';
import { ResumoKds, ChipsLocal } from '@/components/modules/ProducaoCabecalho';
import { resumirKds, modoProducao, abaCorretaDeProducao, producaoAcessivel, locaisAcessiveis, abasProducao, somaContagens } from '@/lib/producaoNav';
import { confirm } from '@/components/ConfirmDialog';
import { ContaSalva, lerContasSalvas, salvarConta, removerContaSalva, rotuloDoPapel } from '@/lib/contasSalvas';
import { Skeleton, stagger } from '@/components/Skeleton';
import { CaixasAoVivo } from '@/components/modules/CaixasAoVivo';
import { VendasCanceladasView } from '@/components/modules/VendasCanceladasView';
import { podeVerCaixasDaEquipe } from '@/lib/caixasAoVivo';
import { roleCan, roleCanOr } from '@/lib/rolePermissions';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getRoleLabel, getTableStatusLabel, getPaymentMethodLabel, getOrderItemDisplayName, PRODUCT_TAGS, getTagDisplay, CARD_BRAND_LABELS, getCardBrandLabel, getCardTotalLabel, TABLE_OUT_OF_JURISDICTION_LABEL, parseItemNote } from '@/lib/labels';
import logoNorteVendas from '@/components/assets/norte-vendas-logo-branco.png';
import { setorDoItem } from '@/lib/setores';
import { chavePreConta, preContaAutomaticaLigada } from '@/lib/preConta';
import { itensAtivos, qtdItensAtivos, subtotalItensAtivos, rotuloQtdItens, itemCancelado } from '@/lib/itensVenda';
import { descreverHoraDoPedido } from '@/lib/tempo';
import { definirAtor, cabecalhosApi } from '@/lib/atorAtual';
import { registrarAcao } from '@/lib/auditoria';
import { printKitchenTicket, printBillReceipt, printSalesReport, buildBillReceiptText, buildFiscalCupomText, buildKitchenTicketText, buildCashClosingText } from '@/lib/print';
import { downloadSalesReportCsv } from '@/lib/csv';
import { playPreparingAlert, playNewOrderAlert, playItemLateAlert, vibrateAlert } from '@/lib/audioAlert';
import { resumirPedidosDaMesa } from '@/lib/mesaPedidos';
import { calculateServiceFee, calculateOrderTotal, vendaTemCobranca, calculateSplitByPerson, calculateChangeForMethods, getPaymentMethodsForRecord, SplitItem, getEffectivePrice, resolveServiceFeeRate, formatServiceFeeRate, formatBRL, getOrderDisplayTotal, calculateCartItemUnitPrice, resolveSelectedOptions, displayOptionDelta, sortKitchenItems } from '@/lib/calc';
import { contaTemTaxaPercentual, ehTaxa, ehTaxaPercentual, semTaxas, valorTaxaPercentual, baseDaTaxaPercentual, resolverTaxaEditada, resolverValorTaxaFixa, taxaPercentualDesatualizada, podeLancarTaxa } from '@/lib/taxas';
import { normalizeForSearch } from '@/lib/search';
import { visibleOptionGroups } from '@/lib/optionRules';
import { formatScheduleLabel } from '@/lib/schedule';
import { formatDuration } from '@/lib/formatDuration';
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

const StoreLogin: React.FC<{ onLogin: (user: StoreUser & { store: Store }) => void; onEntrarMesas?: () => void }> = ({ onLogin, onEntrarMesas }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // Tela "Quem está entrando?" (só no app desktop): contas que já entraram
    // neste computador viram cartões. Ver lib/contasSalvas.ts.
    const [isDesktop, setIsDesktop] = useState(false);
    const [contas, setContas] = useState<ContaSalva[]>([]);
    const [mostrarFormulario, setMostrarFormulario] = useState(false);
    const [contaEscolhida, setContaEscolhida] = useState<ContaSalva | null>(null);
    const [lembrarSenha, setLembrarSenha] = useState(false);
    const [editandoContas, setEditandoContas] = useState(false);
    const [entrandoEmail, setEntrandoEmail] = useState<string | null>(null);
    const [tremerSenha, setTremerSenha] = useState(0);
    const [agora, setAgora] = useState(() => new Date());
    useEffect(() => {
        const t = setInterval(() => setAgora(new Date()), 15000);
        return () => clearInterval(t);
    }, []);
    useEffect(() => {
        const desk = typeof window !== 'undefined' && Boolean(window.electronApp?.isElectron);
        setIsDesktop(desk);
        if (desk) setContas(lerContasSalvas());
    }, []);

    const guardarConta = async (dados: { email: string; name: string; roleLabel: string; photoUrl?: string | null }, senha: string, lembrar: boolean) => {
        if (!isDesktop) return;
        let senhaCifrada: string | null = null;
        if (lembrar && window.electronApp?.encryptSecret) senhaCifrada = await window.electronApp.encryptSecret(senha).catch(() => null);
        salvarConta({ ...dados, senhaCifrada, ultimoUso: Date.now() });
    };

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

    const handleLogin = async (emailArg?: string, senhaArg?: string, lembrarArg?: boolean) => {
        const emailUsado = (emailArg ?? email).trim();
        const senhaUsada = senhaArg ?? password;
        const lembrar = lembrarArg ?? lembrarSenha;
        setError('');
        setIsLoading(true);
        const result = await authenticateStoreUser(emailUsado, senhaUsada);

        if (result.success && result.user) {
            if (result.user.must_change_password) {
                setNeedsChange(true);
                setUserId(result.user.id);
                setIsUniversalChange(false);
            } else {
                await guardarConta({ email: emailUsado, name: result.user.name, roleLabel: rotuloDoPapel(result.user.role, result.user.permissions), photoUrl: (result.user as any).photo_url ?? null }, senhaUsada, lembrar);
                await registrarSenhaConferida(result.user.store_id, senhaUsada, { id: result.user.id, name: result.user.name, role: result.user.role });
                onLogin(result.user);
            }
            setIsLoading(false);
            return 'ok' as const;
        }

        // Rede fora ou conta bloqueada: não adianta tentar a conta universal, e a mensagem tem que dizer a verdade.
        if (result.reason === 'locked') registrarAcao(null, 'login.bloqueado', { entity: 'login', summary: `Conta bloqueada por tentativas: ${emailUsado}`, details: { email: emailUsado } });
        if (result.reason === 'network' || result.reason === 'locked' || result.reason === 'store_inactive') {
            setError(result.message || 'Erro ao entrar.');
            setIsLoading(false);
            return result.reason;
        }
        // Não bateu em nenhum store_user: tenta a conta universal antes de
        // mostrar erro (tabelas separadas, sem custo extra de segurança em
        // tentar as duas em sequência).
        const universalResult = await authenticateUniversalUser(emailUsado, senhaUsada);
        if (universalResult.success && universalResult.user) {
            if (universalResult.mustChangePass) {
                setNeedsChange(true);
                setUserId(universalResult.user.id);
                setIsUniversalChange(true);
            } else {
                await guardarConta({ email: emailUsado, name: universalResult.user.name, roleLabel: rotuloDoPapel('universal') }, senhaUsada, lembrar);
                setUniversalUser(universalResult.user);
            }
        } else {
            const motivoUniv = universalResult.reason;
            if (motivoUniv === 'network' || motivoUniv === 'locked') {
                setError(universalResult.message || 'Erro ao entrar.');
            } else {
                setError(contaEscolhida ? 'Senha incorreta.' : (result.message || 'Erro ao entrar.'));
                setTremerSenha(n => n + 1);
                registrarAcao(null, 'login.falhou', { entity: 'login', summary: `Senha ou usuário incorretos: ${emailUsado}`, details: { email: emailUsado } });
            }
            setIsLoading(false);
            return (motivoUniv === 'network' || motivoUniv === 'locked') ? motivoUniv : ('wrong' as const);
        }
        setIsLoading(false);
        return 'ok' as const;
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
        } catch (e: any) {
            // Senha repetida na loja (migration 136) chega com a mensagem pronta.
            setError(/já (é usada|está em uso)/.test(String(e?.message || '')) ? e.message : 'Erro ao atualizar senha.');
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
                <div className="w-full max-w-sm">
                    <div className="text-center mb-7">
                        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 text-white ring-1 ring-white/30 bg-white/10 backdrop-blur-md shadow-[0_12px_40px_-12px_rgba(15,12,60,0.7)]">
                            <Lock size={26} strokeWidth={1.75} />
                        </div>
                        <h1 className="text-[28px] font-semibold text-white tracking-[-0.02em]">Crie sua senha</h1>
                        <p className="text-white/65 text-sm mt-1">Primeiro acesso. Defina uma senha segura para continuar.</p>
                    </div>
                    <Card className="u-grow-in p-6 !rounded-[22px]" style={{ boxShadow: '0 30px 60px -20px rgba(15,12,60,0.55), 0 2px 8px rgba(15,12,60,0.12)' }}>
                        <form className="space-y-4" onSubmit={e => { e.preventDefault(); handleChangePassword(); }}>
                            <Input label="Nova senha" type="password" autoFocus autoComplete="new-password" value={newPass} onChange={e => setNewPass(e.target.value)} className="h-11" />
                            <Input label="Confirmar nova senha" type="password" autoComplete="new-password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} className="h-11" />
                            <p className="text-[12px] text-[var(--text-muted)] -mt-1">Mínimo de 6 caracteres.</p>

                            {error && (
                                <div className="bg-[var(--err)]/10 text-[var(--err)] px-3 py-2.5 rounded-[12px] text-[13px] font-medium flex items-center gap-2">
                                    <AlertCircle size={16} className="shrink-0" /> {error}
                                </div>
                            )}

                            <Button type="submit" size="lg" className="w-full" isLoading={isLoading}>
                                Salvar senha
                            </Button>
                        </form>
                    </Card>
                </div>
            </AuthBackdrop>
        );
    }

    if (universalUser) {
        const filteredStores = stores.filter(s => s.name.toLowerCase().includes(storeFilter.toLowerCase()));
        return (
            <AuthBackdrop>
                <div className="max-w-md w-full max-sm:pb-28">
                    <div className="text-center mb-7 max-sm:mb-5">
                        <div className="w-16 h-16 max-sm:w-12 max-sm:h-12 rounded-full flex items-center justify-center mx-auto mb-5 max-sm:mb-3 text-white ring-1 ring-white/30 bg-white/10 backdrop-blur-md shadow-[0_12px_40px_-12px_rgba(15,12,60,0.7)]">
                            <StoreIcon size={26} strokeWidth={1.75} />
                        </div>
                        <h1 className="text-[28px] font-semibold text-white tracking-[-0.02em]">Qual loja você quer acessar?</h1>
                        <p className="text-white/65 text-sm mt-1">Entrou como {universalUser.name}</p>
                    </div>
                    <Card className="u-grow-in p-3 !rounded-[22px]" style={{ boxShadow: '0 30px 60px -20px rgba(15,12,60,0.55), 0 2px 8px rgba(15,12,60,0.12)' }}>
                        <div className="relative mb-2">
                            <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                            <input
                                type="search"
                                autoFocus
                                placeholder="Buscar loja"
                                aria-label="Buscar loja"
                                value={storeFilter}
                                onChange={e => setStoreFilter(e.target.value)}
                                className="w-full h-11 pl-10 pr-4 rounded-full bg-[var(--surface-2)] text-[var(--text)] placeholder:text-[var(--text-muted)] text-[15px] max-sm:text-base focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40"
                            />
                        </div>
                        <div className="max-h-[min(24rem,55vh)] max-sm:max-h-[42vh] overflow-y-auto">
                            {isLoadingStores && <p className="text-[13px] text-[var(--text-muted)] text-center py-8">Carregando lojas…</p>}
                            {!isLoadingStores && filteredStores.map((store, i) => (
                                <button
                                    key={store.id}
                                    onClick={() => handleSelectStore(store)}
                                    className="u-grow-in group/store w-full text-left min-h-12 px-3 rounded-[12px] hover:bg-[var(--brand-soft)] u-motion flex items-center gap-3"
                                    style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
                                >
                                    <span className="w-8 h-8 rounded-full bg-[var(--surface-2)] text-[var(--text-muted)] group-hover/store:bg-[var(--surface)] group-hover/store:text-[var(--brand)] flex items-center justify-center text-[13px] font-semibold shrink-0 u-motion">
                                        {store.name.trim().charAt(0).toUpperCase()}
                                    </span>
                                    <span className="flex-1 min-w-0 py-3 border-b border-[var(--border)] group-last/store:border-0 flex items-center justify-between gap-2">
                                        <span className="text-[15px] font-medium text-[var(--text)] truncate group-hover/store:text-[var(--brand)]">{store.name}</span>
                                        <ChevronRight size={16} className="shrink-0 text-[var(--text-muted)]/70 u-motion group-hover/store:translate-x-0.5 group-hover/store:text-[var(--brand)]" />
                                    </span>
                                </button>
                            ))}
                            {!isLoadingStores && filteredStores.length === 0 && (
                                <p className="text-[13px] text-[var(--text-muted)] text-center py-8">Nenhuma loja encontrada.</p>
                            )}
                        </div>
                    </Card>
                    <button onClick={() => setUniversalUser(null)} className="relative z-10 block mx-auto mt-5 px-5 min-h-11 rounded-full text-sm font-medium text-white bg-white/15 backdrop-blur-md hover:bg-white/25 u-motion">
                        Sair
                    </button>
                </div>
            </AuthBackdrop>
        );
    }

    const entrarComConta = async (conta: ContaSalva) => {
        if (editandoContas) return;
        setError('');
        if (conta.senhaCifrada && window.electronApp?.decryptSecret) {
            setEntrandoEmail(conta.email);
            const senha = await window.electronApp.decryptSecret(conta.senhaCifrada).catch(() => null);
            if (senha) {
                const motivo = await handleLogin(conta.email, senha, true);
                setEntrandoEmail(null);
                // Entrou, ou o problema é rede/bloqueio (mensagem já na tela): não reenviar a senha, cada tentativa conta no bloqueio.
                if (motivo !== 'wrong') return;
                // Senha guardada ficou velha (alguém trocou): esquece a salva e pede a nova, sem martelar o servidor.
                salvarConta({ ...conta, senhaCifrada: null, ultimoUso: Date.now() });
                conta = { ...conta, senhaCifrada: null };
                setError('A senha salva neste aparelho não vale mais. Digite a senha atual.');
            } else {
                setEntrandoEmail(null);
            }
        }
        setContaEscolhida(conta);
        setEmail(conta.email);
        setPassword('');
        setLembrarSenha(Boolean(conta.senhaCifrada));
        setMostrarFormulario(true);
    };

    // Avatar redondo no estilo da tela de login do Mac. O layoutId faz o
    // avatar escolhido "voar" da grade pro centro da tela de senha.
    const AvatarConta = ({ conta, tamanho }: { conta: ContaSalva; tamanho: number }) => (
        <motion.div
            layoutId={`avatar-${conta.email}`}
            transition={{ type: 'spring', bounce: 0, duration: 0.45 }}
            className="rounded-full overflow-hidden flex items-center justify-center text-white font-semibold ring-1 ring-white/35 shadow-[0_12px_40px_-12px_rgba(15,12,60,0.7)]"
            style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.4, background: 'linear-gradient(160deg, rgba(255,255,255,0.32), rgba(255,255,255,0.08))', backdropFilter: 'blur(20px) saturate(180%)' }}
        >
            {conta.photoUrl
                ? <img src={conta.photoUrl} alt="" className="w-full h-full object-cover" />
                : <span className="tracking-tight">{conta.name.trim().charAt(0).toUpperCase()}</span>}
        </motion.div>
    );

    const relogio = (
        <div className="text-center text-white mb-10 select-none">
            <p className="text-[15px] font-medium text-white/75">{(() => { const d = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }); return d.charAt(0).toUpperCase() + d.slice(1); })()}</p>
            {/* Fonte do sistema no relógio (SF no Mac, Segoe no Windows): a do app tem zero cortado. */}
            <p className="text-[72px] leading-none font-semibold tracking-[-0.02em] tabular-nums mt-1" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif' }}>{agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
    );

    if (isDesktop && contas.length > 0 && !mostrarFormulario) {
        return (
            <AuthBackdrop>
                <div className="w-full max-w-3xl flex flex-col items-center">
                    {relogio}
                    <h1 className="text-[28px] font-semibold text-white tracking-[-0.02em]">Quem está entrando?</h1>
                    <p className="text-white/65 text-sm mt-1 mb-8">{editandoContas ? 'Toque no – para tirar alguém deste computador' : 'Toque no seu nome'}</p>
                    {error && (
                        <div className="mb-6 bg-white/12 backdrop-blur-md text-white px-4 py-2.5 rounded-full text-sm flex items-center gap-2">
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}
                    <div className="flex flex-wrap justify-center gap-x-8 gap-y-7">
                        {/* Modo Aberto (30/09, pedido do dono): qualquer um entra só nas mesas; a senha é pedida ao lançar o pedido. */}
                        {onEntrarMesas && !editandoContas && (
                            <motion.button
                                type="button"
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ type: 'spring', bounce: 0, duration: 0.45 }}
                                whileTap={{ scale: 0.97 }}
                                onClick={onEntrarMesas}
                                className="w-32 flex flex-col items-center gap-3 text-white"
                            >
                                <div className="w-24 h-24 rounded-full flex items-center justify-center ring-1 ring-white/35 shadow-[0_12px_40px_-12px_rgba(15,12,60,0.7)]" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,0.32), rgba(255,255,255,0.08))' }}>
                                    <LayoutDashboard size={36} strokeWidth={1.75} />
                                </div>
                                <div className="text-center">
                                    <p className="text-[15px] font-semibold leading-tight">Mesas</p>
                                    <p className="text-xs text-white/60 mt-0.5">Sem login</p>
                                </div>
                            </motion.button>
                        )}
                        {contas.map((conta, i) => (
                            <motion.div
                                key={conta.email}
                                initial={{ opacity: 0, y: 12 }}
                                animate={editandoContas ? { opacity: 1, y: 0, rotate: [0, -1.2, 1.2, 0] } : { opacity: 1, y: 0, rotate: 0 }}
                                transition={editandoContas
                                    ? { rotate: { repeat: Infinity, duration: 0.3, delay: i * 0.05 }, default: { type: 'spring', bounce: 0, duration: 0.4 } }
                                    : { type: 'spring', bounce: 0, duration: 0.45, delay: Math.min(i, 8) * 0.04 }}
                                className="relative"
                            >
                                <motion.button
                                    type="button"
                                    disabled={isLoading}
                                    onClick={() => entrarComConta(conta)}
                                    whileTap={editandoContas ? undefined : { scale: 0.97 }}
                                    transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
                                    className="w-32 flex flex-col items-center gap-3 text-white disabled:opacity-70 outline-none focus-visible:[&>div:first-child]:ring-2 focus-visible:[&>div:first-child]:ring-white"
                                >
                                    <AvatarConta conta={conta} tamanho={96} />
                                    <div className="text-center">
                                        <p className="text-[15px] font-semibold leading-tight line-clamp-2">{conta.name}</p>
                                        <p className="text-xs text-white/60 mt-0.5">{entrandoEmail === conta.email ? 'Entrando…' : conta.roleLabel}</p>
                                    </div>
                                </motion.button>
                                <AnimatePresence>
                                    {editandoContas && (
                                        <motion.button
                                            type="button"
                                            aria-label={`Tirar ${conta.name} deste computador`}
                                            initial={{ scale: 0 }}
                                            animate={{ scale: 1 }}
                                            exit={{ scale: 0 }}
                                            transition={{ type: 'spring', bounce: 0.3, duration: 0.3 }}
                                            onClick={async () => {
                                                if (!(await confirm({ message: `Tirar ${conta.name} da tela de entrada deste computador? A conta continua existindo, só some daqui.`, variant: 'danger' }))) return;
                                                removerContaSalva(conta.email);
                                                const restantes = lerContasSalvas();
                                                setContas(restantes);
                                                if (restantes.length === 0) setEditandoContas(false);
                                            }}
                                            className="absolute top-0 left-4 hit-44 w-7 h-7 rounded-full bg-[#ff3b30] text-white flex items-center justify-center shadow-md"
                                        >
                                            <Minus size={16} strokeWidth={3} />
                                        </motion.button>
                                    )}
                                </AnimatePresence>
                            </motion.div>
                        ))}
                        {!editandoContas && (
                            <motion.button
                                type="button"
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ type: 'spring', bounce: 0, duration: 0.45, delay: Math.min(contas.length, 8) * 0.04 }}
                                whileTap={{ scale: 0.97 }}
                                onClick={() => { setContaEscolhida(null); setEmail(''); setPassword(''); setLembrarSenha(false); setError(''); setMostrarFormulario(true); }}
                                className="w-32 flex flex-col items-center gap-3 text-white/85"
                            >
                                <div className="w-24 h-24 rounded-full flex items-center justify-center ring-1 ring-white/30 bg-white/8 backdrop-blur-md">
                                    <Plus size={34} strokeWidth={1.75} />
                                </div>
                                <p className="text-[15px] font-semibold leading-tight">Outro usuário</p>
                            </motion.button>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => setEditandoContas(v => !v)}
                        className="mt-10 px-4 min-h-11 rounded-full text-sm font-medium text-white/75 hover:text-white hover:bg-white/10 u-motion"
                    >
                        {editandoContas ? 'OK' : 'Editar'}
                    </button>
                </div>
            </AuthBackdrop>
        );
    }

    // Senha de uma conta salva: avatar grande no centro, campo em pílula com a
    // seta dentro, e o campo "balança" quando a senha está errada (igual Mac).
    if (isDesktop && contaEscolhida) {
        return (
            <AuthBackdrop>
                <div className="w-full max-w-sm flex flex-col items-center text-white">
                    {relogio}
                    <AvatarConta conta={contaEscolhida} tamanho={112} />
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', bounce: 0, duration: 0.4, delay: 0.1 }} className="text-center mt-4 mb-6">
                        <p className="text-[22px] font-semibold tracking-[-0.01em]">{contaEscolhida.name}</p>
                        <p className="text-sm text-white/60">{contaEscolhida.roleLabel}</p>
                    </motion.div>
                    <motion.form
                        key={tremerSenha}
                        onSubmit={(e) => { e.preventDefault(); if (password) handleLogin(); }}
                        animate={tremerSenha > 0 ? { x: [0, -12, 10, -8, 6, -3, 0] } : { x: 0 }}
                        transition={{ duration: 0.45 }}
                        className="w-72 relative"
                    >
                        <input
                            type="password"
                            autoFocus
                            placeholder="Senha"
                            value={password}
                            onChange={e => { setPassword(e.target.value); if (error) setError(''); }}
                            className="w-full h-11 pl-4 pr-12 rounded-full bg-white/15 backdrop-blur-xl text-white placeholder:text-white/55 ring-1 ring-white/30 focus:ring-2 focus:ring-white/70 outline-none text-base u-motion"
                        />
                        <button
                            type="submit"
                            aria-label="Entrar"
                            disabled={!password || isLoading}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center bg-white text-[#484DB5] disabled:bg-white/25 disabled:text-white/60 u-motion max-sm:min-h-11 max-sm:min-w-11"
                        >
                            {isLoading ? <RefreshCw size={15} className="animate-spin" /> : <ArrowRight size={16} strokeWidth={2.5} />}
                        </button>
                    </motion.form>
                    <p className="h-5 mt-3 text-sm text-white/90">{error}</p>
                    <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer select-none mt-2">
                        <input type="checkbox" checked={lembrarSenha} onChange={e => setLembrarSenha(e.target.checked)} className="size-4 accent-white" />
                        Entrar sem senha neste aparelho
                    </label>
                    <button
                        type="button"
                        onClick={() => { setMostrarFormulario(false); setContaEscolhida(null); setError(''); setPassword(''); }}
                        className="mt-8 px-4 min-h-11 rounded-full text-sm font-medium text-white/75 hover:text-white hover:bg-white/10 u-motion"
                    >
                        Cancelar
                    </button>
                </div>
            </AuthBackdrop>
        );
    }

    return (
        <AuthBackdrop>
            <div className="max-w-sm w-full">
                <div className="text-center mb-7">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 text-white ring-1 ring-white/30 bg-white/10 backdrop-blur-md shadow-[0_12px_40px_-12px_rgba(15,12,60,0.7)]">
                        <StoreIcon size={26} strokeWidth={1.75} />
                    </div>
                    <h1 className="text-[28px] font-semibold text-white tracking-[-0.02em]">{contaEscolhida ? contaEscolhida.name : 'Área do Lojista'}</h1>
                    <p className="text-white/65 text-sm mt-1">{contaEscolhida ? `${contaEscolhida.roleLabel} · digite sua senha` : 'Gerencie seus pedidos e mesas'}</p>
                </div>
                <Card className="u-grow-in p-6 !rounded-[22px]" style={{ boxShadow: '0 30px 60px -20px rgba(15,12,60,0.55), 0 2px 8px rgba(15,12,60,0.12)' }}>
                    <form className="space-y-4" onSubmit={e => { e.preventDefault(); handleLogin(); }}>
                        {!contaEscolhida && (
                            <Input label="Email de acesso" placeholder="seu@email.com" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} className="h-11" />
                        )}
                        <Input label="Senha" placeholder="Sua senha" type="password" autoComplete="current-password" autoFocus={Boolean(contaEscolhida)} value={password} onChange={e => setPassword(e.target.value)} className="h-11" />
                        {isDesktop && (
                            <label className="flex items-center gap-2 text-[13px] text-[var(--text)] cursor-pointer select-none">
                                <input type="checkbox" checked={lembrarSenha} onChange={e => setLembrarSenha(e.target.checked)} className="size-4 accent-[var(--brand)]" />
                                Entrar sem senha neste aparelho
                            </label>
                        )}

                        {error && (
                            <div className="bg-[var(--err)]/10 text-[var(--err)] px-3 py-2.5 rounded-[12px] text-[13px] font-medium flex items-center gap-2">
                                <AlertCircle size={16} className="shrink-0" /> {error}
                            </div>
                        )}

                        <Button type="submit" size="lg" className="w-full group" isLoading={isLoading}>
                            Acessar painel
                            {!isLoading && <ArrowRight size={18} className="u-motion group-hover:translate-x-0.5" />}
                        </Button>
                    </form>
                </Card>
                {onEntrarMesas && (
                    <button onClick={onEntrarMesas} className="flex items-center justify-center gap-2 mx-auto mt-6 px-5 min-h-11 rounded-full text-sm font-semibold text-white bg-white/12 hover:bg-white/20 u-motion">
                        <LayoutDashboard size={16} /> Entrar só nas mesas (sem login)
                    </button>
                )}
                {isDesktop && contas.length > 0 && (
                    <button onClick={() => { setMostrarFormulario(false); setContaEscolhida(null); setError(''); }} className="block mx-auto mt-6 px-4 min-h-11 rounded-full text-sm font-medium text-white/75 hover:text-white hover:bg-white/10 u-motion">
                        Voltar para os usuários
                    </button>
                )}
            </div>
        </AuthBackdrop>
    );
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

// Reunião 2026-09-10 (min 14:34): ao fechar a venda só saía o comprovante
// SEM valor fiscal; a nota autorizada ficava só em Administração → Notas
// Fiscais. "Deveria imprimir a nota fiscal automaticamente quando encerra."
//
// Detalhe que faz a diferença entre funcionar e falhar em silêncio: a nota
// leva segundos pra voltar da SEFAZ, e `window.open()` chamado DEPOIS de um
// await perde o vínculo com o gesto do usuário — todo navegador bloqueia
// como popup, e a feature ficaria silenciosamente inútil (a mesma classe de
// falha silenciosa já documentada neste projeto: Peça Também, tables sem
// policy de SELECT, dual-write na Vercel). Por isso a janela é aberta JÁ no
// clique (enquanto o gesto ainda vale), mostrando "Gerando cupom fiscal...",
// e só troca de endereço quando o PDF existe. Se ainda assim vier bloqueada,
// cai num aviso claro em vez de não fazer nada.
const avisarFalhaNotaFiscal = async (storeId: string, alvo: { orderId?: string; tableId?: string }, desde?: number) => {
    const r = await descreverFalhaFiscalDaVenda(storeId, alvo, desde).catch(() => null);
    if (r?.status === 'pendente') {
        toast.warning('Nota fiscal pendente: CPF/CNPJ do cliente ausente ou inválido. Corrija em Administração → Notas Fiscais e clique em Reemitir.');
    } else if (r?.status === 'rejeitada' || r?.status === 'erro') {
        toast.error(`Nota fiscal rejeitada: ${(r.motivo || 'sem detalhe').slice(0, 140)}`);
    } else {
        toast.error('A nota fiscal ainda não voltou autorizada — imprima por Administração → Notas Fiscais quando ela sair.');
    }
};

const abrirCupomFiscalQuandoSair = (
    storeId: string,
    storeName: string,
    alvo: { orderId?: string; tableId?: string },
) => {
    const desde = Date.now() - 5000;
    // No app desktop (Electron), main.js nega TODO window.open() internamente
    // (setWindowOpenHandler sempre devolve { action: 'deny' } e repassa pra
    // shell.openExternal) — a janela em branco aberta aqui embaixo nunca
    // existe de verdade dentro do Electron, `janela` sempre vem `null`, e o
    // `shell.openExternal('')` (URL vazia, já que o PDF real ainda não
    // existe neste ponto) é quem produzia o diálogo confuso do Windows
    // pedindo "escolher um app pra abrir isso" que o usuário reportou ao
    // vivo na loja (2026-09-15). O truque de janela em branco existe só pra
    // driblar bloqueio de pop-up do NAVEGADOR — dentro do Electron não tem
    // pop-up blocker nenhum, então o caminho certo é simplesmente abrir a
    // URL real assim que ela existir.
    const isElectron = typeof window !== 'undefined' && Boolean(window.electronApp?.isElectron);

    // Achado ao vivo (2026-09-15): 3 tentativas de auto-imprimir o PDF real
    // usando o motor de PDF do PRÓPRIO Electron saíram como borrão cinza —
    // mas o operador confirmou que baixar o mesmo PDF e mandar imprimir
    // manualmente (app padrão de PDF do Windows) imprime CERTO na mesma
    // impressora. Ou seja, o problema nunca foi a impressora — é o motor
    // de renderização de PDF do Electron. 4ª tentativa (main.js): em vez
    // do app renderizar o PDF ele mesmo, baixa o arquivo e manda o
    // WINDOWS executar o verbo "Imprimir em" nele (mesmo mecanismo que já
    // funciona manualmente). Se isso falhar por qualquer motivo, cai pro
    // resumo em texto automático (buildFiscalCupomText, mesma fila/
    // impressora do comprovante) — nunca fica sem nada sair no caixa.
    const imprimirResumoTextoNoCaixa = (nota: { id: string; numero: number | null; serie: number | null; chave_acesso: string | null; protocolo: string | null; valor_total: number | null; modelo: '55' | '65'; ambiente: 'homologacao' | 'producao' }) => {
        const texto = buildFiscalCupomText({ storeName, nota });
        // dedupeKeyBase = id da nota: fechar a mesma venda 2x quase junto
        // acha a MESMA nota já autorizada nas duas vezes — sem uma chave
        // estável aqui, cada disparo enfileirava seu próprio job e o
        // cupom saía impresso 2x fisicamente (achado ao vivo, corrigido).
        enqueueReceiptPrintJobs(storeId, `Cupom Fiscal - ${nota.modelo === '65' ? 'NFC-e' : 'NF-e'} ${nota.numero ?? ''}`, texto, `cupom-fiscal:${nota.id}`, 'cupom_fiscal')
            .catch((e) => console.error('enqueueReceiptPrintJobs (cupom fiscal) falhou:', e));
    };

    // Cupom COMPLETO pela fila (qualquer computador finaliza, o PC da
    // impressora USB do caixa imprime o PDF). Ver enqueueFiscalCupomPrintJobs.
    const enfileirarCupomCompleto = (resultado: { pdfUrl: string; nota: any }) => {
        const nota = resultado.nota;
        const texto = buildFiscalCupomText({ storeName, nota });
        const cupomSobDemanda = nota.modelo === '65' && nota.status === 'autorizada';
        const vias = nota.status === 'contingencia' ? 2 : 1;
        for (let via = 1; via <= vias; via++) {
            enqueueFiscalCupomPrintJobs(
                storeId,
                `Cupom Fiscal - ${nota.modelo === '65' ? 'NFC-e' : 'NF-e'} ${nota.numero ?? ''}${via > 1 ? ` (via ${via})` : ''}`,
                texto,
                `cupom-fiscal-pdf:${nota.id}:${via}`,
                (larg) => cupomSobDemanda ? resolverUrlApi(`/api/fiscal/cupom-pdf?noteId=${nota.id}&larguraMm=${larg}`) : resultado.pdfUrl,
            ).catch((e) => console.error('enqueueFiscalCupomPrintJobs falhou:', e));
        }
    };

    if (isElectron) {
        // Cupom sempre pela FILA (print_jobs): o computador que tem a impressora do caixa imprime, seja qual for o
        // computador que fechou a venda — deixa rastro na fila e tem retentativa. Antes cada PC tentava imprimir
        // direto (PrintTo silencioso) e, quando falhava ou o PC não era o do caixa, não ficava registro nenhum
        // (Ramon, 29/09: "fecho no caixa e a nota não imprime").
        aguardarNotaFiscalDaVenda(storeId, alvo)
            .then((resultado) => {
                if (!resultado) {
                    avisarFalhaNotaFiscal(storeId, alvo, desde);
                    return;
                }
                if (resultado.nota.status === 'autorizada') toast.success(`Nota fiscal autorizada${resultado.nota.numero ? ` (nº ${resultado.nota.numero})` : ''}.`);
                enfileirarCupomCompleto(resultado);
                if (resultado.nota.status === 'contingencia') {
                    toast.warning('Nota emitida em contingência — 2 vias enviadas à impressora. Será enviada à SEFAZ automaticamente quando a conexão voltar.');
                }
            })
            .catch((e) => {
                console.error('abrirCupomFiscalQuandoSair falhou:', e);
            });
        return;
    }

    const janela = window.open('', '_blank');
    if (janela) {
        janela.document.write('<!doctype html><meta charset="utf-8"><title>Cupom fiscal</title><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#444">Gerando cupom fiscal...</body>');
        janela.document.close();
    }
    aguardarNotaFiscalDaVenda(storeId, alvo)
        .then((resultado) => {
            if (resultado?.nota.status === 'autorizada') toast.success(`Nota fiscal autorizada${resultado.nota.numero ? ` (nº ${resultado.nota.numero})` : ''}.`);
            if (resultado) enfileirarCupomCompleto(resultado);
            if (resultado && janela && !janela.closed) {
                janela.location.href = resultado.pdfUrl;
                // Contingência: 2 vias físicas (cliente + estabelecimento) —
                // pedido explícito do dono (2026-09-15), já que o documento
                // não tem protocolo/QR ainda e o cliente precisa sair com o
                // comprovante em papel mesmo assim.
                if (resultado.nota.status === 'contingencia') {
                    window.open(resultado.pdfUrl, '_blank');
                    toast.warning('Nota emitida em contingência — 2 vias impressas. Será enviada à SEFAZ automaticamente quando a conexão voltar.');
                }
            } else if (resultado) {
                // Popup bloqueado (ou fechado na mão): não abre nada à força,
                // avisa onde está.
                toast.error('O cupom fiscal saiu, mas o navegador bloqueou a janela. Abra por Administração → Notas Fiscais.');
            } else {
                if (janela && !janela.closed) janela.close();
                avisarFalhaNotaFiscal(storeId, alvo, desde);
            }
        })
        .catch((e) => {
            if (janela && !janela.closed) janela.close();
            console.error('abrirCupomFiscalQuandoSair falhou:', e);
        });
};

// Badge de sincronização offline + LISTA das falhas (fix round 1 da Task 7,
// revisão independente, 2026-09-14). Antes o badge era um <span> morto com
// "🔴 N falha(s) — verificar": o `lastError` gravado por markFailed
// (lib/offline/queue.ts) não era lido por componente nenhum, então a
// mensagem da ação — inclusive a da entrega bloqueada por pagamento que
// falhou de vez — nunca chegava a quem opera. O operador via um número e não
// sabia nem qual pedido nem o que fazer.
//
// Duas saídas, no mesmo espírito (e com os mesmos tokens) da lista de
// impressões falhas que CaixaPrintStation já tem: "Tentar de novo" (zera as
// tentativas e sincroniza na hora) e "Descartar" (apaga a ação, com
// confirmação dizendo o que se perde). Sem a segunda, uma ação no teto de
// tentativas ficava na IndexedDB daquele aparelho pra sempre, mantendo o
// alarme aceso mesmo depois do problema resolvido por fora — e alarme que
// não some é alarme que o time aprende a ignorar.
const SyncStatusBadge: React.FC<{ status: { pending: number; failed: number } }> = ({ status }) => {
  const [aberto, setAberto] = useState(false);
  const [falhas, setFalhas] = useState<QueuedAction[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregarFalhas = async () => {
    try { setFalhas(await listarAcoesFalhas()); } catch { setFalhas([]); }
  };

  // Recarrega ao abrir E sempre que o contador muda (o runSync roda a cada
  // 30s de qualquer forma; com o modal aberto, a lista acompanha).
  useEffect(() => { if (aberto) carregarFalhas(); }, [aberto, status.failed]);

  const handleReenviar = async (id: string) => {
    setOcupado(id);
    try {
      await reenviarAcaoFalha(id);
      await carregarFalhas();
      toast.success('Reenviado — se falhar de novo, volta pra esta lista.');
    } catch {
      toast.error('Não consegui reenviar agora.');
    } finally {
      setOcupado(null);
    }
  };

  const handleDescartar = async (acao: QueuedAction) => {
    // Fix round 2 da revisão: o aviso é POR TIPO (explicarDescarteAcao em
    // lib/offline/sync.ts). O texto fixo anterior falava de pagamento/caixa
    // pra qualquer ação — e não dizia que descartar um pedido novo apaga o
    // pedido inteiro, que é a perda irreversível de verdade aqui.
    const ok = await confirm({
      title: 'Descartar esta ação?',
      message: `${descreverAcaoFila(acao)}\n\n${explicarDescarteAcao(acao)}`,
      confirmLabel: 'Descartar mesmo assim',
      variant: 'danger',
    });
    if (!ok) return;
    setOcupado(acao.id);
    try {
      await descartarAcaoFalha(acao.id);
      await carregarFalhas();
      toast.success('Ação descartada.');
    } catch {
      toast.error('Não consegui descartar agora.');
    } finally {
      setOcupado(null);
    }
  };

  return (
    <>
      {status.failed > 0 ? (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="px-2 py-1 rounded-full text-[11px] font-bold bg-[var(--err)]/10 text-[var(--err)] border border-[var(--err)]/30 hover:bg-[var(--err)]/20 u-motion"
          title="Ver o que falhou ao sincronizar"
        >
          🔴 {status.failed} falha(s) — verificar
        </button>
      ) : status.pending > 0 ? (
        <span className="px-2 py-1 rounded-full text-[11px] font-bold bg-[var(--warn)]/10 text-[var(--warn)] border border-[var(--warn)]/30">
          🟡 Offline — {status.pending} pendente(s)
        </span>
      ) : null /* fila vazia e sem falha: nenhum badge, mesmo comportamento visual de hoje */}

      <Modal isOpen={aberto} onClose={() => setAberto(false)} title="Falhas de sincronização" variant="sheet">
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-muted)]">
            Estas ações foram feitas neste aparelho e não conseguiram chegar ao servidor depois de várias tentativas. Enquanto estiverem aqui, elas NÃO aconteceram no sistema.
          </p>
          {falhas.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-4">Nenhuma falha pendente.</p>
          ) : (
            falhas.map((acao) => (
              <div key={acao.id} className="bg-[var(--surface-2)] rounded-lg p-3 border border-[var(--border)] space-y-2">
                <p className="text-sm font-semibold text-[var(--text)]">{descreverAcaoFila(acao)}</p>
                <p className="text-xs text-[var(--err)]">{acao.lastError || 'Erro desconhecido.'}</p>
                <p className="text-[11px] text-[var(--text-muted)]">
                  {new Date(acao.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} • {acao.attempts} tentativa(s)
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => handleReenviar(acao.id)} isLoading={ocupado === acao.id}>
                    <RotateCcw size={14} className="mr-1" /> Tentar de novo
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => handleDescartar(acao)} disabled={ocupado === acao.id}>
                    <Trash2 size={14} className="mr-1" /> Descartar
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>
    </>
  );
};

// Avatar do menu lateral azul (2026-09-26, "menu volta ao azul da marca"):
// com foto, a foto; sem foto, inicial branca num círculo translúcido.
const SidebarAvatar: React.FC<{ photoUrl?: string | null; name: string; className?: string }> = ({ photoUrl, name, className = '' }) => (
    <div className={`shrink-0 rounded-full overflow-hidden ${className}`}>
        {photoUrl ? (
            <div className="w-full h-full [&>*]:!w-full [&>*]:!h-full [&>*]:!rounded-full"><ProductThumb src={photoUrl} name={name} size="cart" /></div>
        ) : (
            <div className="w-full h-full flex items-center justify-center bg-white/15 text-white font-semibold">
                {(name || '?').trim().charAt(0).toUpperCase()}
            </div>
        )}
    </div>
);

const StoreLayout: React.FC<{ children: React.ReactNode, title: string, currentTab: string, onTabChange: (t: string) => void, storeName: string, onLogout: () => void, onSwitchStore?: () => void, user: StoreUser & { store: Store }, onUserUpdate?: (patch: Partial<StoreUser>) => void }> = ({ children, title, currentTab, onTabChange, storeName, onLogout, onSwitchStore, user, onUserUpdate }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // "Meu Perfil" (migration 078, 2026-09-22: "um local de meu login pra
  // trocar, colocar seu nome, ver seu histórico, colocar sua fotinha").
  const [showProfileModal, setShowProfileModal] = useState(false);
  // Módulos/permissões antes do hook de avisos: ele filtra locais e avisos pelo que o usuário acessa.
  const storeModules = resolveStoreModules(user.store);
  const hasPermission = (tabId: string) => hasTabPermission(user, tabId, user.store);
  const accessibleTabIds = computeAccessibleTabIds(storeModules, hasPermission);
  const notif = useStoreNotifications({ store: user.store, user, acessiveis: accessibleTabIds, abaAtual: currentTab });
  const notifications = notif.counts;

  // "Procurar atualização" (2026-09-13, cobrança direta do dono: "nem
  // aparece o botão de atualizar"). A checagem automática só roda ao abrir
  // o app e de 4 em 4h — num PDV que fica ligado o dia inteiro, isso quer
  // dizer horas sem saber que já existe versão nova, e nenhum jeito de
  // forçar nem de saber se o app chegou a checar. Este botão responde as
  // duas coisas na hora, com a resposta na tela e não num log.
  const [procurandoUpdate, setProcurandoUpdate] = useState(false);
  const handleProcurarAtualizacao = async () => {
    if (!window.electronApp?.checkForUpdate) return;
    setProcurandoUpdate(true);
    try {
      // `jaBaixada` não vem no tipo compartilhado de `checkForUpdate`
      // (lib/api.ts) — declarado aqui como opcional pra não mexer num
      // contrato usado por outras telas só por causa deste caminho.
      const r: { ok: boolean; empacotado: boolean; versaoDisponivel?: string | null; erro?: string; jaBaixada?: boolean } =
        await window.electronApp.checkForUpdate();
      if (!r.empacotado) {
        toast.error('Esta janela está rodando em modo de desenvolvimento — atualização automática só existe no app instalado.');
      } else if (!r.ok) {
        toast.error('Não foi possível checar agora: ' + (r.erro || 'sem conexão com o servidor de atualização.'));
      } else if (r.jaBaixada) {
        toast.success(`A versão ${formatAppVersion(r.versaoDisponivel)} já está baixada — é só clicar em "Atualizar agora" no aviso.`);
      } else if (r.versaoDisponivel && r.versaoDisponivel !== window.electronApp.version) {
        toast.success(`Versão ${formatAppVersion(r.versaoDisponivel)} encontrada — baixando. O aviso pra atualizar aparece assim que terminar.`);
      } else {
        toast.success(`Você já está na versão mais recente (${formatAppVersion(window.electronApp.version)}).`);
      }
    } catch {
      toast.error('Não foi possível checar a atualização agora.');
    } finally {
      setProcurandoUpdate(false);
    }
  };

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

  // Modo offline (Task 8) — inicia o motor de sincronização uma vez, no
  // mount do painel. `startOfflineSync()` é idempotente (guarda `started`
  // interna), então é seguro chamar de novo se StoreLayout remontar (ex.
  // troca de loja pela conta universal).
  useEffect(() => {
    startOfflineSync();
  }, []);

  // Indicador visual de status offline/sincronização (Task 9) — mesma
  // justificativa do efeito acima: StoreLayout sobrevive à troca de aba, é o
  // único lugar que faz sentido manter essa assinatura viva o tempo todo.
  const [syncStatus, setSyncStatus] = useState(getSyncStatus());
  useEffect(() => {
    const unsubscribe = onSyncStatusChange(setSyncStatus);
    return unsubscribe;
  }, []);

  // Regra única (04/10): 2+ abas de KDS => "Produção" com abas; 1 aba => item com o nome dela; ver lib/producaoNav.ts.
  const locaisDoUsuario = locaisAcessiveis(notif.locais, accessibleTabIds);
  const modoProd = modoProducao(locaisDoUsuario);
  // Menu mostra TODAS as áreas que a loja tem ligadas; as que a pessoa não pode acessar ficam com cadeado (04/10).
  const modulosLigadosIds = computeAccessibleTabIds(storeModules, () => true);
  const modoProdMenu = modoProducao(locaisAcessiveis(notif.locais, modulosLigadosIds));
  const tabAcessivel = (id: string) => (id === 'producao' ? producaoAcessivel(accessibleTabIds) : accessibleTabIds.has(id));
  const allTabs = [
    // Aba Caixa (Task 3, frente-de-caixa) — primeira da lista de propósito,
    // mesmo raciocínio do TAB_IDS em lib/storeModules.ts.
    { id: 'caixa', icon: Wallet, label: 'Caixa', permission: 'caixa' },
    { id: 'tables', icon: LayoutDashboard, label: 'Gestão de Mesas', permission: 'tables', count: notifications.tables },
    { id: 'counter', icon: Coffee, label: 'Balcão', permission: 'counter' },
    // Loja com local de preparo próprio (ex.: Pizzaria): um item "Produção" com abas por local.
    // Loja sem setores continua com Cozinha e Bar separados, como sempre foi.
    ...(modoProdMenu.tipo === 'abas'
      ? [{ id: 'producao', icon: ChefHat, label: 'Produção', permission: 'kitchen', count: somaContagens(abasProducao(locaisDoUsuario, notif.porLocal)) }]
      : modoProdMenu.tipo === 'unico' && modoProdMenu.tabId === 'producao'
        ? [{ id: 'producao', icon: ChefHat, label: modoProdMenu.nome, permission: 'kitchen', count: somaContagens(abasProducao(locaisDoUsuario, notif.porLocal)) }]
        : [
            ...(modoProdMenu.tipo === 'unico' && modoProdMenu.tabId === 'kitchen' ? [{ id: 'kitchen', icon: ChefHat, label: 'Cozinha (KDS)', permission: 'kitchen', count: notifications.kitchen }] : []),
            ...(modoProdMenu.tipo === 'unico' && modoProdMenu.tabId === 'bar' ? [{ id: 'bar', icon: Wine, label: 'Bar (KDS)', permission: 'bar', count: notifications.bar }] : []),
          ]),
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
  // Modo Aberto (30/09): o computador do salão mostra as outras áreas da loja com
  // cadeado ("só com login") em vez de sumir com elas.
  const isAberto = user.role === 'open';
  // Regra do dono (04/10): quem não tem permissão de uma área a vê com CADEADO (visível e bloqueada), nunca escondida.
  const visibleTabs = allTabs
    .filter(tab => { const k = TAB_MODULE_KEY[tab.id]; return tabAcessivel(tab.id) || !k || storeModules[k]; })
    .map(tab => tabAcessivel(tab.id) ? tab : { ...tab, count: 0 });
  const bottomNavTabs = visibleTabs.filter(item => ['caixa', 'tables', 'counter', 'kitchen', 'bar', 'producao'].includes(item.id));
  // Clique numa área bloqueada: só avisa (sem abrir a tela nem carregar dados dela). O modo Aberto mantém o painel "Só com login".
  const irParaAba = (id: string): boolean => {
    if (tabAcessivel(id) || isAberto) { onTabChange(id); return true; }
    toast.info('Sem permissão para esta área. Peça ao gerente.');
    return false;
  };
  const rotuloCadeado = isAberto ? 'Só com login' : 'Sem permissão';

  // Loja ganhou/perdeu abas de KDS com a aba aberta: leva para a aba equivalente.
  const abaProdutoAlvo = abaCorretaDeProducao(modoProd, currentTab);
  useEffect(() => {
    if (abaProdutoAlvo) onTabChange(abaProdutoAlvo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abaProdutoAlvo]);

  return (
    <NotificacoesProvider value={notif}>
    <div className={`min-h-screen supports-[height:100dvh]:min-h-dvh bg-[var(--bg)] pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0 transition-all duration-[var(--dur-slow)] ${isCollapsed ? 'md:pl-20' : 'md:pl-64'}`}>
      <StaffOfflineBanner />
      <CaixaPrintStationOfflineBanner status={caixaPrintStatus} />

      {/* Mobile Header */}
      <header className="md:hidden bg-[var(--surface)]/80 backdrop-blur-xl border-b border-[var(--border)] px-3 py-2 sticky top-0 z-30 flex items-center gap-2">
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label="Abrir menu"
            className="w-11 h-11 flex items-center justify-center text-[var(--text)] hover:bg-[var(--surface-2)] rounded-full u-motion shrink-0"
          >
             <Menu size={20} />
          </button>
          <div className="flex items-center gap-2.5 flex-1 overflow-hidden">
             <div className="h-8 w-8 rounded-full bg-[var(--brand-soft)] flex items-center justify-center text-[var(--brand)] font-semibold text-[12px] shrink-0">
                {storeName.slice(0,2).toUpperCase()}
             </div>
             <h1 className="font-semibold text-[var(--text)] text-[17px] tracking-[-0.01em] truncate flex-1">{title}</h1>
          </div>
          <CaixaPrintStationIndicator status={caixaPrintStatus} storeName={storeName} />
          <SyncStatusBadge status={syncStatus} />
          {!isAberto && <NotificationBell variant="header" />}
          <ThemeToggle />
      </header>

      {/* Mobile Menu Drawer (Off-canvas) — entra/sai pela esquerda (Task 10). */}
      <AnimatePresence>
      {isMobileMenuOpen && (
        <motion.div key="drawer" className="fixed inset-0 z-50 flex md:hidden" initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 1 }}>
            <motion.div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}></motion.div>
            <motion.div initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={SPRING_UI} className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] sidebar-blue shadow-[var(--shadow-md)] flex flex-col text-left">
                <div className="pl-4 pr-2 py-2 flex justify-between items-center">
                    <span className="font-semibold text-white text-[17px] tracking-[-0.01em]">Menu Lojista</span>
                    <div className="flex items-center gap-1">
                        <ThemeToggle variant="sidebar" className="!w-11 !h-11" />
                        <button onClick={() => setIsMobileMenuOpen(false)} aria-label="Fechar menu" className="w-11 h-11 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 rounded-full u-motion">
                            <X size={18}/>
                        </button>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => { if (user.role === 'open') return; setShowProfileModal(true); setIsMobileMenuOpen(false); }}
                    className="flex items-center gap-3 mx-3 px-2 py-2 rounded-[var(--r-md)] hover:bg-white/10 u-motion text-left"
                >
                    <SidebarAvatar photoUrl={user.photo_url} name={user.name} className="w-11 h-11 text-[16px]" />
                    <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-semibold text-white truncate">{user.name}</p>
                        <p className="text-[13px] text-white/60">{user.role === 'open' ? 'Sem login' : 'Meu Perfil'}</p>
                    </div>
                </button>
                <div className="flex-1 overflow-y-auto p-3 space-y-1">
                    {visibleTabs.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => { if (irParaAba(item.id)) setIsMobileMenuOpen(false); }}
                          className={`relative isolate flex items-center w-full px-3 min-h-[44px] rounded-[10px] text-[15px] u-motion u-press gap-3
                            ${currentTab === item.id ? 'text-white font-semibold' : 'text-white/80 font-medium hover:bg-white/10 hover:text-white'}
                          `}
                        >
                          {currentTab === item.id && (
                            <motion.div layoutId="nav-ativo-gaveta" transition={SPRING_UI} className="absolute inset-0 -z-10 rounded-[10px] bg-white/[0.18] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]" />
                          )}
                          <div className="relative">
                              <item.icon size={18} className="shrink-0" />
                              {!!item.count && item.count > 0 && (
                                 <div className="absolute -top-1.5 -right-1.5 bg-[var(--err-fill)] text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full num">
                                    {item.count > 9 ? '9+' : item.count}
                                 </div>
                              )}
                          </div>
                          <div className="flex-1 flex items-center justify-between truncate">
                              <span className="truncate">{item.label}</span>
                              {!tabAcessivel(item.id) && <Lock size={14} className="opacity-70 shrink-0 ml-2" aria-label={rotuloCadeado} />}
                              {!!item.count && item.count > 0 && (
                                 <span className="bg-[var(--err-fill)] text-white text-[11px] font-semibold px-1.5 py-0.5 rounded-full num ml-2 shrink-0">
                                    <AnimatedNumber value={item.count} format={(n) => String(Math.round(n))} />
                                 </span>
                              )}
                          </div>
                        </button>
                    ))}
                </div>
                <div className="p-3 border-t border-white/[0.12] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    <button
                        onClick={handleToggleCheckin}
                        disabled={checkinBusy}
                        className={`${isAberto ? 'hidden' : ''} flex items-center gap-3 w-full px-3 min-h-[44px] rounded-[10px] u-motion text-[15px] text-white hover:bg-white/10 disabled:opacity-50 whitespace-nowrap`}
                    >
                        {openCheckin
                          ? <span className="w-[18px] flex justify-center shrink-0"><span className="w-2 h-2 rounded-full bg-[var(--ok-fill)]" /></span>
                          : <Clock size={18} className="shrink-0 text-white/60"/>}
                        <span className="truncate">{openCheckin ? `Encerrar turno (${format(parseISO(openCheckin.checkin_at), 'HH:mm')})` : 'Bater ponto'}</span>
                    </button>
                    {user.role === 'universal' && onSwitchStore && (
                        <button onClick={onSwitchStore} className="flex items-center gap-3 w-full px-3 min-h-[44px] text-white hover:bg-white/10 rounded-[10px] u-motion text-[15px] whitespace-nowrap">
                            <RefreshCw size={18} className="text-white/60"/> Trocar de Loja
                        </button>
                    )}
                    <button onClick={onLogout} className="flex items-center gap-3 w-full px-3 min-h-[44px] text-white/80 hover:text-white hover:bg-white/10 rounded-[10px] u-motion text-[15px]">
                        <LogOut size={18}/> Sair
                    </button>
                    {typeof window !== 'undefined' && window.electronApp?.version && window.electronApp?.checkForUpdate && (
                        <button
                            onClick={handleProcurarAtualizacao}
                            disabled={procurandoUpdate}
                            className="w-full text-center text-[12px] text-white/60 hover:text-white pt-2 u-motion disabled:opacity-50 truncate whitespace-nowrap"
                            title="Procurar atualização"
                        >
                            App {formatAppVersion(window.electronApp.version)} · {procurandoUpdate ? 'procurando...' : 'procurar atualização'}
                        </button>
                    )}
                </div>
            </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <aside className={`fixed left-0 top-0 h-full sidebar-blue border-r border-white/[0.08] hidden md:flex flex-col z-10 transition-all duration-[var(--dur-slow)] ${isCollapsed ? 'w-20' : 'w-64'}`}>
        <div className={`px-4 pt-5 pb-3 flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
          {!isCollapsed && (
            <div className="overflow-hidden">
              {/* Logo do Norte Vendas no topo, como no Norte Estoque (pedido do dono, 2026-09-29). */}
              <img src={logoNorteVendas.src} alt="Norte Vendas" className="h-8 w-auto mb-3" />
              <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-white truncate">{storeName}</h1>
              <p className="text-[13px] text-white/60 mt-0.5 truncate">Painel Lojista</p>
            </div>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={`text-white/60 hover:text-white hover:bg-white/10 w-8 h-8 flex items-center justify-center shrink-0 rounded-full u-motion max-sm:min-h-11 max-sm:min-w-11 ${isCollapsed ? '' : 'ml-2'}`}
            title={isCollapsed ? "Expandir Menu" : "Recolher Menu"}
          >
            {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        <button
            type="button"
            onClick={() => { if (user.role !== 'open') setShowProfileModal(true); }}
            className={`flex items-center mx-3 px-2 py-2 rounded-[var(--r-md)] hover:bg-white/10 u-motion text-left ${isCollapsed ? 'justify-center' : 'gap-3'}`}
            title={isCollapsed ? 'Meu Perfil' : undefined}
        >
            <SidebarAvatar photoUrl={user.photo_url} name={user.name} className="w-10 h-10 text-[15px]" />
            {!isCollapsed && (
                <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-white truncate">{user.name}</p>
                    <p className="text-[12px] text-white/60">{user.role === 'open' ? 'Sem login' : 'Meu Perfil'}</p>
                </div>
            )}
        </button>

        <nav className={`flex-1 px-3 pt-3 pb-3 space-y-0.5 overflow-y-auto no-scrollbar`}>
          {visibleTabs.map((item) => (
            <button
              key={item.id}
              onClick={() => irParaAba(item.id)}
              className={`flex items-center w-full px-3 h-10 rounded-[10px] text-[14px] u-motion u-press group relative isolate
                ${currentTab === item.id ? 'text-white font-semibold' : 'text-white/80 font-medium hover:bg-white/10 hover:text-white'}
                ${isCollapsed ? 'justify-center' : 'gap-3'}
              `}
              title={isCollapsed ? item.label : ''}
            >
              {/* Pílula do item ativo desliza entre os itens (Task 10 Step 2). */}
              {currentTab === item.id && (
                <motion.div layoutId="nav-ativo" transition={SPRING_UI} className="absolute inset-0 -z-10 rounded-[10px] bg-white/[0.18] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]" />
              )}
              <div className="relative shrink-0">
                <item.icon size={18} />
                {isCollapsed && !!item.count && item.count > 0 && (
                   <div className="absolute -top-1.5 -right-1.5 bg-[var(--err-fill)] text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full num">
                      {item.count > 9 ? '9+' : item.count}
                   </div>
                )}
              </div>
              {!isCollapsed && (
                  <div className="flex-1 flex items-center justify-between truncate">
                      <span className="truncate">{item.label}</span>
                      {!tabAcessivel(item.id) && <Lock size={14} className="opacity-70 shrink-0 ml-2" aria-label={rotuloCadeado} />}
                      {!!item.count && item.count > 0 && (
                          <span className="bg-[var(--err-fill)] text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full ml-2 shrink-0 num">
                              <AnimatedNumber value={item.count} format={(n) => String(Math.round(n))} />
                          </span>
                      )}
                  </div>
              )}

              {/* Tooltip para estado colapsado */}
              {isCollapsed && (
                <div className="absolute left-full ml-2 px-2.5 py-1.5 bg-[var(--text)] text-[var(--bg)] text-[12px] font-medium rounded-[var(--r-sm)] opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
                  {item.label}{!tabAcessivel(item.id) ? ` (${rotuloCadeado.toLowerCase()})` : ''}{!!item.count && ` (${item.count})`}
                </div>
              )}
            </button>
          ))}
        </nav>

        {!isAberto && <div className="px-3 pb-1"><NotificationBell variant="sidebar" collapsed={isCollapsed} /></div>}
        <div className="px-3 pb-1">
          <button
            onClick={handleToggleCheckin}
            disabled={checkinBusy}
            className={`${isAberto ? 'hidden' : ''} flex items-center w-full px-3 h-10 rounded-[10px] text-[13px] font-medium u-motion disabled:opacity-50 whitespace-nowrap text-white/60 hover:bg-white/10 hover:text-white
              ${isCollapsed ? 'justify-center' : 'gap-3'}
            `}
            title={isCollapsed ? (openCheckin ? `Encerrar turno (desde ${format(parseISO(openCheckin.checkin_at), 'HH:mm')})` : 'Bater ponto') : ''}
          >
            {openCheckin
              ? <span className="w-[18px] h-[18px] flex items-center justify-center shrink-0"><span className="w-2 h-2 rounded-full bg-[var(--ok-fill)]" /></span>
              : <Clock size={18} className="shrink-0" />}
            {!isCollapsed && (
              <span className="truncate">
                {openCheckin ? `Encerrar turno (${format(parseISO(openCheckin.checkin_at), 'HH:mm')})` : 'Bater ponto'}
              </span>
            )}
          </button>
        </div>

        {/* Rodapé (redesign 2026-09-26): uma linha só — tema à esquerda,
            Trocar de Loja/Sair à direita; nada quebra em 2 linhas. Com
            "Trocar de Loja" visível, Sair vira só ícone (title/aria-label). */}
        <div className={`p-3 border-t border-white/[0.12] ${isCollapsed ? 'flex flex-col items-center gap-1' : 'flex items-center gap-1'}`}>
          <ThemeToggle variant="sidebar" className={isCollapsed ? '' : 'mr-auto'} />
          {user.role === 'universal' && onSwitchStore && (
            <button
              onClick={onSwitchStore}
              className={`flex items-center h-9 text-white hover:bg-white/10 rounded-full u-motion text-[13px] font-medium whitespace-nowrap max-sm:min-h-11 ${isCollapsed ? 'w-9 justify-center' : 'px-3 gap-2'}`}
              title="Trocar de Loja"
              aria-label="Trocar de Loja"
            >
              <RefreshCw size={16} className="shrink-0 text-white/60" />
              {!isCollapsed && <span>Trocar de Loja</span>}
            </button>
          )}
          <button
            onClick={onLogout}
            className={`flex items-center h-9 text-white/80 hover:text-white hover:bg-white/10 rounded-full u-motion text-[13px] font-medium whitespace-nowrap max-sm:min-h-11 ${isCollapsed || (user.role === 'universal' && onSwitchStore) ? 'w-9 justify-center' : 'px-3 gap-2'}`}
            title="Sair"
            aria-label="Sair"
          >
            <LogOut size={16} className="shrink-0" />
            {!isCollapsed && !(user.role === 'universal' && onSwitchStore) && <span>Sair</span>}
          </button>
        </div>
        {/* Com a barra recolhida o botão sumia por completo — quem trabalha o
            dia inteiro com a barra recolhida (o padrão de quem já sabe os
            ícones de cor) simplesmente não tinha como procurar atualização.
            Recolhido vira só o ícone, com o `title` dizendo a versão. */}
        {typeof window !== 'undefined' && window.electronApp?.version && window.electronApp?.checkForUpdate && (
          isCollapsed ? (
            <button
              onClick={handleProcurarAtualizacao}
              disabled={procurandoUpdate}
              // min-h de 44px: é o alvo de toque padrão do projeto (mesmo
              // valor já usado no seletor de adicionais e nos +/- do
              // carrinho) — o PDV pode rodar em touchscreen, e só `pb-3`
              // deixava o botão com 30px de altura.
              className="flex items-center justify-center w-full min-h-[44px] px-3 pb-2 text-white/60 hover:text-white u-motion disabled:opacity-50"
              title={`App ${formatAppVersion(window.electronApp.version)} — procurar atualização`}
              aria-label="Procurar atualização"
            >
              <Download size={18} className={procurandoUpdate ? 'animate-pulse' : ''} />
            </button>
          ) : (
            <button
              onClick={handleProcurarAtualizacao}
              disabled={procurandoUpdate}
              className="w-full px-3 text-center text-[11px] text-white/60 hover:text-white pb-3 u-motion disabled:opacity-50 truncate whitespace-nowrap"
              title="Procurar atualização"
            >
              App {formatAppVersion(window.electronApp.version)} · {procurandoUpdate ? 'procurando...' : 'procurar atualização'}
            </button>
          )
        )}
      </aside>

    {/* Mobile Bottom Nav */}
    {bottomNavTabs.length > 0 && (
        <div className="fixed bottom-0 left-0 w-full bg-[var(--surface)]/85 backdrop-blur-xl border-t border-[var(--border)] flex justify-around px-2 pt-1.5 pb-[max(1rem,env(safe-area-inset-bottom))] md:hidden z-40">
           {bottomNavTabs.map(item => (
            <button key={item.id} onClick={() => irParaAba(item.id)} aria-disabled={!tabAcessivel(item.id)} className={`relative isolate flex flex-col items-center justify-center gap-0.5 min-h-[48px] min-w-[64px] text-[11px] px-3 py-1 rounded-[var(--r-md)] u-motion u-press ${currentTab === item.id ? 'text-[var(--brand)] font-semibold' : 'text-[var(--text-muted)] font-medium'}`}>
              {currentTab === item.id && (
                <motion.div layoutId="nav-ativo-barra" transition={SPRING_UI} className="absolute inset-0 -z-10 rounded-[var(--r-md)] bg-[var(--brand-soft)]" />
              )}
              <div className="relative">
                  <item.icon size={20} className={tabAcessivel(item.id) ? '' : 'opacity-60'} />
                  {!tabAcessivel(item.id) && <Lock size={11} className="absolute -top-1 -right-2 text-[var(--text-muted)]" aria-label={rotuloCadeado} />}
                  {!!item.count && item.count > 0 && (
                       <div className="absolute -top-1.5 -right-2 bg-[var(--err-fill)] text-white text-[9px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded-full px-0.5 num">
                          {item.count > 9 ? '9+' : item.count}
                       </div>
                  )}
              </div>
              <span className="truncate max-w-[72px] text-center">
                  {item.id === 'caixa' ? 'Caixa' :
                   item.id === 'tables' ? 'Mesas' :
                   item.id === 'kitchen' ? 'Cozinha' :
                   item.id === 'producao' && item.label === 'Produção' ? 'Produção' :
                   item.id === 'bar' ? 'Bar' :
                   item.label.split(' ')[0]}
              </span>
            </button>
           ))}
        </div>
    )}

    {/* Main Content Area */}
    <main className="p-4 md:p-8 pt-4 md:pt-6 pb-24 md:pb-8 max-w-7xl mx-auto">
      <header className="relative mb-6 hidden md:flex justify-between items-center gap-4">
        <h2 className="text-[30px] max-sm:text-[26px] font-bold tracking-[-0.02em] leading-tight text-[var(--text)] truncate">{title}</h2>
        <div className="flex items-center gap-3 shrink-0">
           <CaixaPrintStationIndicator status={caixaPrintStatus} storeName={storeName} />
           <SyncStatusBadge status={syncStatus} />
           <div className="h-8 w-8 rounded-full bg-[var(--brand-soft)] flex items-center justify-center text-[var(--brand)] font-semibold text-[12px]">
              {storeName.slice(0,2).toUpperCase()}
           </div>
           <div className="text-[13px] text-[var(--text-muted)]">{new Date().toLocaleDateString('pt-BR')}</div>
        </div>
      </header>
      
      {/* Troca de aba (Task 10 Step 3): fade de 220ms na entrada, 120ms na
          saída. SEM transform de propósito: transform no ancestral vira o
          "containing block" dos position:fixed de dentro, e uma janela que
          abrisse durante a entrada da aba (ex.: Caixa → mesa) aparecia
          deslocada até a animação acabar. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={currentTab}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } }}
          exit={{ opacity: 0, transition: { duration: 0.12, ease: 'easeOut' } }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </main>
  </div>
  <MyProfileModal isOpen={showProfileModal} onClose={() => setShowProfileModal(false)} user={user} onUserUpdate={onUserUpdate} />
  </NotificacoesProvider>
);
};

// "Meu Perfil" (migration 078, 2026-09-22) — nome + foto do operador
// (medalhão do Caixa) + histórico dos próprios turnos de caixa. Componente
// separado de StoreLayout (que já é grande) por responsabilidade única.
const MyProfileModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    user: StoreUser & { store: Store };
    onUserUpdate?: (patch: Partial<StoreUser>) => void;
}> = ({ isOpen, onClose, user, onUserUpdate }) => {
    const [name, setName] = useState(user.name);
    const [photoUrl, setPhotoUrl] = useState(user.photo_url ?? null);
    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [history, setHistory] = useState<CashShiftHistoryRow[] | null>(null);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    // Reabre sempre limpo com o valor atual (evita mostrar rascunho de uma
    // abertura anterior cancelada) e carrega o histórico só quando abre —
    // não é dado que muda a cada segundo, não precisa de Realtime/polling.
    useEffect(() => {
        if (!isOpen) return;
        setName(user.name);
        setPhotoUrl(user.photo_url ?? null);
        setIsLoadingHistory(true);
        // Meu histórico: fetchCashShiftsHistory devolve a loja inteira (só
        // tem `operator_name`, sem id) — filtra pelo nome deste operador.
        // Mesmo critério já usado no resto do Caixa pra identificar quem é
        // quem sem uma FK própria nessa leitura.
        fetchCashShiftsHistory(user.store.id, 50)
            .then(rows => setHistory(rows.filter(r => r.operator_name === user.name)))
            .catch(() => setHistory([]))
            .finally(() => setIsLoadingHistory(false));
    }, [isOpen, user.id, user.name, user.store.id, user.photo_url]);

    const handlePickPhoto = () => fileInputRef.current?.click();
    const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploadingPhoto(true);
        try {
            const url = await uploadUserPhoto(file);
            setPhotoUrl(url);
        } catch (err: any) {
            toast.error('Erro ao enviar a foto: ' + err.message);
        } finally {
            setIsUploadingPhoto(false);
            e.target.value = '';
        }
    };

    const handleSave = async () => {
        if (!name.trim()) { toast.error('Digite um nome.'); return; }
        setIsSaving(true);
        try {
            await updateStoreTeamMember(user.id, { name: name.trim() });
            // photo_url passa reto (nunca some se undefined) — RPC só grava
            // quando a chave existe no jsonb (ver migration 078), então o
            // supabase-js precisa mandar mesmo quando é a mesma string.
            await supabase.rpc('update_store_user_secure', { p_user_id: user.id, p_updates: { photo_url: photoUrl } });
            onUserUpdate?.({ name: name.trim(), photo_url: photoUrl });
            toast.success('Perfil atualizado.');
            onClose();
        } catch (err: any) {
            toast.error('Erro ao salvar: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Meu Perfil">
            <div className="space-y-5">
                <div className="flex items-center gap-4">
                    <button type="button" onClick={handlePickPhoto} className="relative shrink-0 u-motion u-press-sm" title="Trocar foto">
                        <div className="w-16 h-16"><ProductThumb src={photoUrl} name={name || user.name} size="store" /></div>
                        <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[var(--brand-fill)] text-white flex items-center justify-center border-2 border-[var(--surface)]">
                            {isUploadingPhoto ? <RefreshCw size={12} className="animate-spin" /> : <Camera size={12} />}
                        </div>
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                    <div className="flex-1 min-w-0">
                        <label className="block text-[13px] font-semibold text-[var(--text-muted)] mb-1">Nome</label>
                        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Seu nome" />
                    </div>
                </div>

                <Button onClick={handleSave} isLoading={isSaving} disabled={isUploadingPhoto} className="w-full">
                    Salvar
                </Button>

                <div className="pt-2 border-t border-[var(--border)]">
                    <h4 className="text-[13px] font-semibold text-[var(--text-muted)] mb-2">Meu histórico de turnos de caixa</h4>
                    {isLoadingHistory ? (
                        <p className="text-sm text-[var(--text-muted)] py-4 text-center">Carregando...</p>
                    ) : !history || history.length === 0 ? (
                        <p className="text-sm text-[var(--text-muted)] py-4 text-center">Nenhum turno de caixa seu ainda.</p>
                    ) : (
                        <div className="max-h-64 overflow-y-auto space-y-1.5">
                            {history.map(h => (
                                <div key={h.id} className="flex items-center justify-between gap-2 p-2.5 bg-[var(--surface-2)] rounded-lg text-sm">
                                    <div className="min-w-0">
                                        <p className="font-semibold text-[var(--text)]">
                                            {new Date(h.opened_at).toLocaleDateString('pt-BR')}
                                        </p>
                                        <p className="text-xs text-[var(--text-muted)]">
                                            {h.status === 'open' ? 'Em aberto' : `Diferença: R$ ${formatBRL(h.difference ?? 0)}`}
                                        </p>
                                    </div>
                                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${h.status === 'open' ? 'bg-[var(--ok)]/10 text-[var(--ok)]' : 'bg-[var(--surface)] text-[var(--text-muted)]'}`}>
                                        {h.status === 'open' ? 'Aberto' : 'Fechado'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
};

// --- SUB-MODULE: KDS (Kitchen / Bar) ---
const KdsView: React.FC<{ destination: 'kitchen' | 'bar'; store: Store; fixedLocal?: string; loggedUser?: StoreUser }> = ({ destination, store, fixedLocal, loggedUser }) => {
    // Cancelar item no KDS segue a mesma regra da comanda: só gerente/dono ou quem tem a permissão de trocas (R1).
    const podeCancelarNoKds = !!loggedUser && roleCan(loggedUser, store, 'cancelar_item');
  const storeId = store.id;
  const storeName = store.name;
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());

  // Locais de preparo (ex.: Pizzaria) deste fluxo: cada tela pode ficar fixa
  // num local — escolha lembrada neste aparelho.
  const [locaisKds, setLocaisKds] = useState<PrintSector[]>([]);
  const chaveLocalKds = `ntb-kds-local:${storeId}:${destination}`;
  const [localKds, setLocalKds] = useState<string>(() => { try { return localStorage.getItem(chaveLocalKds) || 'todos'; } catch { return 'todos'; } });
  useEffect(() => {
      fetchPrintSectors(storeId).then(l => setLocaisKds(l.filter(x => x.base === destination))).catch(() => {});
  }, [storeId, destination]);
  // Loja com impressora ligada para este destino: o ticket sai sozinho, o botão manual vira "Reimprimir".
  const [imprimeAuto, setImprimeAuto] = useState(false);
  useEffect(() => {
      hasActivePrinterForDestination(storeId, destination).then(setImprimeAuto).catch(() => setImprimeAuto(false));
  }, [storeId, destination]);
  const escolherLocalKds = (v: string) => { setLocalKds(v); try { localStorage.setItem(chaveLocalKds, v); } catch { /* sem persistência */ } };

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
      let falhou = false;
      const data = await fetchKitchenOrders(storeId, destination, () => { falhou = true; });
      // O sino reaproveita o que esta tela acabou de buscar (evita uma 2ª consulta igual).
      if (!falhou) publicarKds(storeId, destination, data);
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
  usePolling(() => loadOrders(true));

  const isItemLate = (item: OrderItem) => {
      const prepMinutes = item.product?.prep_time_minutes;
      if (!prepMinutes || item.status === OrderStatus.READY) return false; // pronto não está mais atrasado
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
      const ratio = prepMinutes && item.status !== OrderStatus.READY ? elapsedMinutes / prepMinutes : null;
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

  // Status por ponto colorido + texto (redesign estilo Apple, 2026-09-26):
  // cartão sempre branco, cor só no ponto.
  const getStatusInfo = (status: OrderStatus): { label: string; dot: string } => {
      switch(status) {
          case OrderStatus.PENDING: return { label: 'Novo', dot: 'var(--warn)' };
          case OrderStatus.ACCEPTED: return { label: 'Novo', dot: 'var(--warn)' };
          case OrderStatus.PREPARING: return { label: 'Preparando', dot: 'var(--info)' };
          case OrderStatus.READY: return { label: 'Pronto', dot: 'var(--ok)' };
          default: return { label: '', dot: 'var(--text-muted)' };
      }
  };

  const printOrderTicket = (item: OrderItem) => {
      registrarAcao(storeId, 'reimpressao.pedido_kds', { entity: 'order_item', entityId: item.id, summary: `Imprimiu/reimprimiu pedido no KDS: ${item.quantity}x ${item.product?.name ?? 'item'}`, details: { mesa: item.order?.tables?.number ?? null } });
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

  const handleTogglePriority = async (itemId: string) => {
      // Update otimista; reverte se a RPC falhar.
      setOrders(prev => prev.map(o => o.id === itemId ? { ...o, priority: !o.priority } : o));
      const result = await toggleItemPriority(itemId);
      if (!result.success) {
          setOrders(prev => prev.map(o => o.id === itemId ? { ...o, priority: !o.priority } : o));
          toast.error('Não foi possível alterar a prioridade.');
      }
  };

  const pertenceAoLocal = (item: OrderItem, local: string) =>
      local === 'todos' ? true : local === 'padrao' ? !item.sector_id : item.sector_id === local;
  const localAtivo = fixedLocal ?? (localKds === 'todos' || localKds === 'padrao' || locaisKds.some(x => x.id === localKds) ? localKds : 'todos');
  const visibleOrders = sortKitchenItems(orders.filter(item => pertenceAoLocal(item, localAtivo)));
  const nomeLocalAtivo = localAtivo === 'todos' || localAtivo === 'padrao' ? null : locaisKds.find(x => x.id === localAtivo)?.name;

  return (
    <div>
        <div className="mb-4 space-y-3">
            <ResumoKds resumo={resumirKds(visibleOrders, isItemLate)} />
            {locaisKds.length > 0 && !fixedLocal && (
                <ChipsLocal
                    value={localAtivo}
                    onChange={escolherLocalKds}
                    opcoes={[{ id: 'todos', nome: 'Tudo' }, { id: 'padrao', nome: destination === 'bar' ? 'Bar' : 'Cozinha' }, ...locaisKds.map(x => ({ id: x.id, nome: x.name }))].map(l => ({ ...l, count: orders.filter(it => pertenceAoLocal(it, l.id)).length }))}
                />
            )}
        </div>
        <div className="relative grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 items-start">
            {/* Lista viva (Task 10 Step 6): chave estável por item — a cada
                poll/realtime só o que entra/sai anima; o resto se reorganiza. */}
            <AnimatePresence mode="popLayout">
            {visibleOrders.map(item => {
                const { client, observation } = parseItemNote(item.notes || '');
                const late = isItemLate(item);
                const { elapsedMinutes, ratio } = getPrepProgress(item);
                const timerColorClass = ratio === null ? 'text-[var(--text-muted)]' : ratio >= 1 ? 'text-[var(--err)] font-bold' : ratio >= 0.7 ? 'text-[var(--warn)] font-bold' : 'text-[var(--ok)]';

                return (
                    <motion.div
                        key={item.id}
                        {...LIST_ITEM_MOTION}
                    >
                    <Card className={`p-4 flex flex-col ${item.priority ? 'ring-2 ring-[var(--err)]' : late ? 'ring-2 ring-[var(--err)]/40' : ''}`} style={(late || item.priority) ? { animation: 'u-late-pulse 2s ease-in-out infinite' } : undefined}>
                        {/* 1) Quem e quando: mesa/cliente + hora e tempo na primeira linha; status em Badge logo abaixo */}
                        <div>
                            <p className="text-[17px] font-semibold text-[var(--text)] tracking-[-0.01em] break-words">
                                {item.order?.order_type === 'counter'
                                    ? (item.order?.customer_name || 'Balcão')
                                    : `Mesa ${item.order?.tables?.number || '?'}`}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                <Badge variant={item.status === OrderStatus.READY ? 'success' : item.status === OrderStatus.PREPARING ? 'default' : 'warning'} dot>
                                    {getStatusInfo(item.status).label}
                                </Badge>
                                {item.order?.order_type === 'counter' && item.order?.customer_name && <Badge>Balcão</Badge>}
                                {late && <Badge variant="critical"><AlertCircle size={12}/> Atrasado</Badge>}
                                {item.priority && <Badge variant="critical">Prioridade</Badge>}
                                <span
                                    className={`ml-auto inline-flex items-center gap-1 text-[12px] num px-2 h-6 rounded-full bg-[var(--surface-2)] whitespace-nowrap ${timerColorClass}`}
                                    title={`Pedido às ${new Date(item.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: false})}`}
                                >
                                    <Clock size={12}/>
                                    {new Date(item.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: false})} · {formatDuration(Math.floor(elapsedMinutes))}
                                </span>
                            </div>
                        </div>

                        {/* 2) O que fazer: item com nome completo, cliente e observação em destaque */}
                        <h3 className="font-semibold text-[var(--text)] leading-snug mt-3 mb-2 text-[17px] break-words">
                            <span className="num">{item.quantity}×</span> {getOrderItemDisplayName(item)}
                        </h3>

                        {client && (
                            <p className="mb-2 text-[13px] text-[var(--text-muted)] flex items-center gap-1.5">
                                <User size={13}/> {client}
                            </p>
                        )}

                        {observation && (
                            <div className="bg-[var(--warn)]/10 text-[var(--warn)] px-3 py-2 rounded-[var(--r-md)] text-[14px] font-semibold mb-3 break-words whitespace-pre-line">
                                Obs: {observation}
                            </div>
                        )}

                        {/* 3) Ação principal única */}
                        <div className="mt-auto pt-2">
                            <Button
                                size="lg"
                                onClick={() => advanceStatus(item)}
                                className={`w-full max-sm:h-12 ${item.status === 'preparing' ? '!bg-[var(--ok-fill)] hover:!opacity-90' : ''}`}
                            >
                                {(item.status === 'pending' || item.status === 'accepted') && 'Iniciar preparo'}
                                {item.status === 'preparing' && 'Marcar pronto'}
                                {item.status === 'ready' && 'Entregar'}
                            </Button>
                        </div>

                        {/* 4) Ações secundárias, discretas: impressão e controles do item */}
                        <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3 border-t border-[var(--border)]">
                            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                {imprimeAuto && <span title="O pedido sai sozinho na impressora deste local (o sistema não confirma o papel impresso)"><Badge variant="success">Impressão automática</Badge></span>}
                                <Button size="sm" variant="ghost" className="max-sm:!h-11" onClick={() => printOrderTicket(item)} title={imprimeAuto ? 'Imprimir o pedido de novo' : 'Imprimir pedido'}>
                                    <Printer size={14} /> {imprimeAuto ? 'Reimprimir pedido' : 'Imprimir pedido'}
                                </Button>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                    onClick={() => handleTogglePriority(item.id)}
                                    className={`w-8 h-8 max-sm:w-11 max-sm:h-11 inline-flex items-center justify-center rounded-full u-motion u-press ${item.priority ? 'bg-[var(--err-fill)] text-white' : 'bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--err)] hover:bg-[var(--err)]/12'}`}
                                    title={item.priority ? 'Remover prioridade' : 'Priorizar'}
                                    aria-label={item.priority ? 'Remover prioridade' : 'Priorizar'}
                                >
                                    <AlertTriangle size={15} />
                                </button>
                                {podeCancelarNoKds && <button
                                    disabled={cancellingIds.has(item.id)}
                                    onClick={async () => {
                                        if (cancellingIds.has(item.id)) return;
                                        if (!podeCancelarNoKds) return;
                                        if (await confirm({ message: 'Tem certeza que deseja CANCELAR este item?', variant: 'danger' })) {
                                            setCancellingIds(prev => new Set(prev).add(item.id));
                                            await cancelSpecificOrderItem(item.id, loggedUser!.id, loggedUser!.name, 'Cancelado no KDS');
                                            setOrders(prev => prev.filter(o => o.id !== item.id));
                                        }
                                    }}
                                    className="w-8 h-8 max-sm:w-11 max-sm:h-11 inline-flex items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--err)] hover:bg-[var(--err)]/12 u-motion u-press disabled:opacity-50 disabled:pointer-events-none"
                                    title="Cancelar item"
                                    aria-label="Cancelar item"
                                >
                                    <X size={16} />
                                </button>}
                            </div>
                        </div>
                    </Card>
                    </motion.div>
                );
            })}
            </AnimatePresence>
            {visibleOrders.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center text-center py-24 px-6 bg-[var(--surface)] rounded-[var(--r-lg)] shadow-[var(--shadow-sm)]">
                    {destination === 'kitchen'
                        ? <ChefHat size={40} strokeWidth={1.5} className="mb-3 text-[var(--text-muted)] opacity-50" />
                        : <Wine size={40} strokeWidth={1.5} className="mb-3 text-[var(--text-muted)] opacity-50" />}
                    <p className="text-[17px] font-semibold text-[var(--text)]">{nomeLocalAtivo ? `Tudo tranquilo em ${nomeLocalAtivo}!` : destination === 'kitchen' ? 'Tudo tranquilo na cozinha!' : 'Tudo tranquilo no bar!'}</p>
                    <p className="text-[13px] text-[var(--text-muted)] mt-1">Aguardando novos pedidos...</p>
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
// `addLabel`: texto do botão final. Mesa lança na hora ("Lançar pedido"); a
// venda de balcão pela equipe só junta no carrinho ("Adicionar à venda").
const StoreProductModal: React.FC<{ product: Product | null, onClose: () => void, onAdd: (qty: number, notes: string, selectedOptions: SelectedOption[]) => void, addLabel?: string }> = ({ product, onClose, onAdd, addLabel = 'Lançar pedido' }) => {
    const [qty, setQty] = useState(1);
    const [notes, setNotes] = useState('');
    const [selections, setSelections] = useState<Record<string, string[]>>({}); // group_id -> option_id[]

    useEffect(() => {
        if (product) {
            setQty(1);
            setNotes('');
            // Garçom escolhe tamanho/sabor explicitamente (2026-09-24): com a 1ª opção
            // pré-marcada, um pedido errado ficava a um toque de distância e o selo
            // "Obrigatório" perdia o sentido. O cardápio do CLIENTE mantém a pré-seleção.
            setSelections({});
        }
    }, [product]);

    if (!product) return null;

    // Grupos escondidos por regra (ex.: pizza Pequena = 1 sabor) somem da tela e do preço.
    const groups = visibleOptionGroups(product.option_groups || [], selections);

    const toggleOption = (group: ProductOptionGroup, optionId: string) => {
        setSelections(prev => {
            const current = prev[group.id] || [];
            if (group.type === 'single') return { ...prev, [group.id]: current[0] === optionId ? [] : [optionId] };
            const next = current.includes(optionId) ? current.filter(id => id !== optionId) : [...current, optionId];
            return { ...prev, [group.id]: next };
        });
    };

    // Acréscimo efetivo (variação por tamanho + "vale o sabor mais caro",
    // migration 140) — mesma regra que create_order_secure cobra.
    const selectedOptions: SelectedOption[] = resolveSelectedOptions(groups, selections)
        .map(({ group_id, option_id, name, price_delta }) => ({ group_id, option_id, name, price_delta }));
    const unitPrice = getEffectivePrice(product) + selectedOptions.reduce((a, o) => a + o.price_delta, 0);
    const missingRequired = groups.some(g => g.required && (selections[g.id] || []).length === 0);

    return (
        <Modal isOpen={!!product} onClose={onClose} title="Adicionar item" size="md">
            <div className="space-y-4">
                <div className="flex gap-4">
                    {product.image_url && (
                        <Image src={product.image_url} alt={product.name} width={96} height={96} className="w-24 h-24 object-cover rounded-[14px]" />
                    )}
                    <div>
                        <h4 className="font-semibold text-[20px] tracking-[-0.01em] text-[var(--text)]">{product.name}</h4>
                        <p className="text-[var(--text-muted)] text-[13px] line-clamp-2">{product.description}</p>
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
                                    <span className="text-[13px] text-[var(--text-muted)] line-through num">R$ {formatBRL(product.price)}</span>
                                    <span className="text-[var(--brand)] font-semibold text-[17px] num">R$ {formatBRL(effectivePrice)}</span>
                                </span>
                            ) : (
                                <span className="text-[var(--text)] font-semibold text-[17px] num mt-1 block">R$ {formatBRL(product.price)}</span>
                            );
                        })()}
                    </div>
                </div>

                <div className="flex items-center justify-between bg-[var(--surface-2)] pl-4 pr-2 py-2 rounded-[14px]">
                    <span className="text-[15px] font-medium text-[var(--text)]">Quantidade</span>
                    <div className="flex items-center gap-3">
                        <button onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Diminuir quantidade" className="w-9 h-9 max-sm:w-11 max-sm:h-11 grid place-items-center rounded-full bg-[var(--surface)] text-[var(--brand)] shadow-[var(--shadow-sm)] u-motion u-press-sm"><Minus size={18} /></button>
                        <span className="font-semibold text-[17px] num w-8 text-center">{qty}</span>
                        <button onClick={() => setQty(qty + 1)} aria-label="Aumentar quantidade" className="w-9 h-9 max-sm:w-11 max-sm:h-11 grid place-items-center rounded-full bg-[var(--surface)] text-[var(--brand)] shadow-[var(--shadow-sm)] u-motion u-press-sm"><Plus size={18} /></button>
                    </div>
                </div>

                {groups.map(group => (
                    <div key={group.id} className="rounded-[14px] px-4 py-3 bg-[var(--surface-2)]">
                        <div className="flex items-center justify-between mb-1">
                            <h4 className="font-semibold text-[15px] text-[var(--text)]">{group.name}</h4>
                            {group.required && <Badge color="bg-[var(--warn)]/10 text-[var(--warn)]">Obrigatório</Badge>}
                        </div>
                        {group.options.map(opt => { const optDelta = displayOptionDelta(groups, selections, group.id, opt); return (
                            <label key={opt.id} className="flex items-center justify-between py-2 cursor-pointer min-h-11 border-t border-[var(--border)] first-of-type:border-t-0">
                                <span className="flex items-center gap-3 text-[15px] text-[var(--text)]">
                                    <input
                                        type={group.type === 'single' ? 'radio' : 'checkbox'}
                                        name={`store-group-${group.id}`}
                                        checked={(selections[group.id] || []).includes(opt.id)}
                                        onChange={() => toggleOption(group, opt.id)}
                                        className="w-[18px] h-[18px] accent-[var(--brand)]"
                                    />
                                    {opt.name}
                                </span>
                                {optDelta > 0 && <span className="text-[var(--text-muted)] text-[13px] font-medium num">+R$ {formatBRL(optDelta)}</span>}
                            </label>
                        ); })}
                    </div>
                ))}

                <Input
                    label="Observação (opcional)"
                    placeholder="Ex: Lojista: Sem cebola"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                />

                <div className="max-sm:sticky max-sm:bottom-[calc(-1*max(1.25rem,env(safe-area-inset-bottom)))] max-sm:-mx-5 max-sm:-mb-[max(1.25rem,env(safe-area-inset-bottom))] max-sm:px-5 max-sm:pt-2 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] max-sm:bg-[var(--surface)] max-sm:border-t max-sm:border-[var(--border)] max-sm:z-10">
                    <Button size="lg" className="w-full mt-4 max-sm:mt-1 !h-[52px] !text-[17px]" disabled={missingRequired} onClick={() => { onAdd(qty, notes, selectedOptions); onClose(); }}>
                        {addLabel} · R$ {formatBRL(unitPrice * qty)}
                    </Button>
                    {missingRequired && <p className="text-xs text-center text-[var(--err)] mt-4 max-sm:mt-1">Escolha uma opção obrigatória para continuar.</p>}
                </div>
            </div>
        </Modal>
    );
};

// Cor de ação do cardápio do garçom = mesma do cliente (ClientModule.tsx:
// ACTION_FG, azul-violeta da Norte via token --brand; até 2026-09-22 era
// vermelho iFood). Duplicada de propósito — painéis não compartilham
// componente, só o valor da cor.
const GARCOM_ACTION = 'var(--brand)';

// Cardápio do garçom em camadas (pedido do dono, 2026-09-26): barra de
// categorias em cima + lista embaixo não era intuitivo ("tenho que clicar
// embaixo pra aparecer"). Agora é navegação em pilha, estilo app de PDV de
// iPad: Cardápio (cartões de grupo/categoria solta + "Ver todos") → grupo
// (cartões das subcategorias + "Ver todos os <grupo>") → produtos, com
// voltar e pílulas das irmãs pra pular sem voltar. Busca sempre no topo,
// procura no cardápio inteiro. A tela fica onde está depois de lançar um
// item (o componente não desmonta ao abrir/fechar o StoreProductModal).
type TableMenuView =
    | { level: 'home' }
    | { level: 'all' }
    | { level: 'group'; groupId: string }
    | { level: 'groupAll'; groupId: string }
    | { level: 'category'; categoryId: string; groupId: string | null };

const menuViewDepth = (v: TableMenuView) => v.level === 'home' ? 0 : v.level === 'group' || v.level === 'all' ? 1 : v.level === 'groupAll' ? 2 : (v.groupId ? 2 : 1);
const menuViewKey = (v: TableMenuView) => v.level === 'home' || v.level === 'all' ? v.level : v.level === 'category' ? `c:${v.categoryId}` : `${v.level}:${v.groupId}`;

const MenuTile: React.FC<{ title: string; meta: string; hint?: string; onClick: () => void; emphasis?: boolean }> = ({ title, meta, hint, onClick, emphasis }) => (
    <button
        type="button"
        onClick={onClick}
        className={`text-left rounded-[16px] sm:rounded-[18px] pl-4 pr-3 py-3 min-h-[60px] sm:min-h-[80px] flex items-center gap-3 u-motion u-press-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] ${emphasis ? 'bg-[var(--brand-soft)]' : 'bg-[var(--surface-2)] hover:bg-[color-mix(in_srgb,var(--surface-2)_80%,var(--text)_6%)]'}`}
    >
        <span className="flex-1 min-w-0">
            <span className={`block text-[16px] font-semibold leading-snug line-clamp-2 ${emphasis ? '' : 'text-[var(--text)]'}`} style={emphasis ? { color: GARCOM_ACTION } : undefined}>{title}</span>
            {hint && <span className="block text-[13px] text-[var(--text-muted)] mt-0.5 truncate">{hint}</span>}
        </span>
        <span className="flex-shrink-0 text-[14px] text-[var(--text-muted)] num">{meta}</span>
        <ChevronRight size={18} className="flex-shrink-0 -ml-1 text-[var(--text-muted)] opacity-60" />
    </button>
);

const itensLabel = (n: number) => `${n} ${n === 1 ? 'item' : 'itens'}`;

const StoreTableMenu: React.FC<{ storeId: string, onAddItem: (product: Product, qty: number, notes: string, selectedOptions: SelectedOption[]) => void, addLabel?: string, podeEsgotar?: boolean }> = ({ storeId, onAddItem, addLabel, podeEsgotar = false }) => {
    const [categories, setCategories] = useState<Category[]>([]);
    const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [view, setView] = useState<TableMenuView>({ level: 'home' });
    const [direction, setDirection] = useState<1 | -1>(1);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

    const listRef = useRef<HTMLDivElement>(null);
    const [loaded, setLoaded] = useState(false);

    // Falha de rede não pode virar "cardápio vazio" calado (visto em teste,
    // 2026-09-26): tenta de novo sozinho uma vez e, se ainda falhar, mostra
    // o aviso com "Tentar de novo".
    const [loadFailed, setLoadFailed] = useState(false);
    const loadMenu = React.useCallback((attempt = 0) => {
        setLoadFailed(false);
        fetchMenu(storeId, true).then(({ categories, categoryGroups, products, error }) => {
            if (error || products.length === 0) {
                if (attempt === 0) { setTimeout(() => loadMenu(1), 1500); return; }
                if (error) { setLoadFailed(true); setLoaded(true); return; }
            }
            setCategories(categories);
            setCategoryGroups(categoryGroups);
            // Taxa (migration 138) só entra pelo caixa, no fechamento da conta.
            setProducts(semTaxas(products));
            setLoaded(true);
        });
    }, [storeId]);
    useEffect(() => { setLoaded(false); loadMenu(0); }, [loadMenu]);

    // Esgotado em tempo real (migration 151): atualiza a lista a cada 15 s e ao voltar pra aba,
    // sem mexer na navegação nem mostrar "carregando".
    useEffect(() => {
        const refrescar = () => {
            fetchMenu(storeId, true).then(({ products, error }) => { if (!error && products.length > 0) setProducts(semTaxas(products)); }).catch(() => {});
        };
        const id = setInterval(refrescar, 15000);
        const onVis = () => { if (document.visibilityState === 'visible') refrescar(); };
        document.addEventListener('visibilitychange', onVis);
        return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
    }, [storeId]);

    const alternarEsgotado = async (product: Product) => {
        const novo = !product.sold_out;
        setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, sold_out: novo } : p))); // otimista
        const ok = await setProductSoldOut(storeId, product.id, novo);
        if (!ok) {
            setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, sold_out: !novo } : p)));
            toast.error('Não consegui atualizar o produto.');
        } else {
            toast.undo(novo ? `${product.name} marcado como esgotado.` : `${product.name} voltou ao cardápio.`, 'Desfazer', async () => {
                // Só desfaz se ninguém mexeu depois: relê o estado atual do produto.
                const { products: atuais } = await fetchMenu(storeId, true);
                const atual = atuais.find((p) => p.id === product.id);
                if (!atual || !canUndo(String(novo), String(!!atual.sold_out))) { toast.info('Outra pessoa já alterou este produto. Nada foi desfeito.'); return; }
                setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, sold_out: !novo } : p)));
                if (!(await setProductSoldOut(storeId, product.id, !novo))) toast.error('Não consegui desfazer.');
            });
        }
    };

    // Grupo→subcategoria. Fonte única de ordenação via buildTopLevelItems
    // (lib/categoryGroups.ts). Grupo com UMA categoria vira categoria solta
    // com o nome do grupo (análise de categorias 2026-09-26, P3/P4).
    const topLevelItems = useMemo<TopLevelItem[]>(() => buildTopLevelItems(categories, categoryGroups).map(item =>
        item.kind === 'group' && item.categories.length === 1
            ? { kind: 'category', category: { ...item.categories[0], name: item.group.name } }
            : item
    ), [categories, categoryGroups]);

    const orderedCategories = useMemo(
        () => topLevelItems.flatMap(i => i.kind === 'category' ? [i.category] : i.categories),
        [topLevelItems]
    );

    const productsByCategory = useMemo(() => {
        const map = new Map<string, Product[]>();
        products.forEach(p => {
            if (!p.category_id) return;
            const list = map.get(p.category_id) || [];
            list.push(p);
            map.set(p.category_id, list);
        });
        map.forEach(list => list.sort((a, b) => (a.order || 0) - (b.order || 0)));
        return map;
    }, [products]);

    const countOf = (catId: string) => productsByCategory.get(catId)?.length || 0;

    // Cartões só pra quem tem produto — categoria vazia não serve pro garçom.
    const homeItems = useMemo(() => topLevelItems
        .map(item => item.kind === 'group'
            ? { ...item, categories: item.categories.filter(c => countOf(c.id) > 0) }
            : item)
        .filter(item => item.kind === 'group' ? item.categories.length > 0 : countOf(item.category.id) > 0),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- countOf deriva de productsByCategory
        [topLevelItems, productsByCategory]);

    const groupById = (id: string) => {
        const item = homeItems.find(i => i.kind === 'group' && i.group.id === id);
        return item && item.kind === 'group' ? item : null;
    };

    const categoryLabelOf = useMemo(() => {
        const m = new Map<string, string>();
        orderedCategories.forEach(c => m.set(c.id, c.name));
        return m;
    }, [orderedCategories]);

    const go = (next: TableMenuView) => {
        setSearchTerm('');
        setDirection(menuViewDepth(next) >= menuViewDepth(view) ? 1 : -1);
        setView(next);
    };

    const goBack = () => {
        if (view.level === 'category' && view.groupId) go({ level: 'group', groupId: view.groupId });
        else if (view.level === 'groupAll') go({ level: 'group', groupId: view.groupId });
        else go({ level: 'home' });
    };

    // Pílula ativa sempre visível (ex.: "Grelhados" no fim da fileira).
    const pillsRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = pillsRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
        el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }, [view]);

    // Troca de tela volta a lista pro topo.
    useEffect(() => {
        if (listRef.current) listRef.current.scrollTop = 0;
    }, [view, searchTerm]);

    // Busca: sem acento, nome ou descrição, no cardápio inteiro; cada
    // resultado mostra a categoria (três "Carne do Sol" ficam distinguíveis).
    const term = searchTerm.trim();
    const searchResults = useMemo(() => {
        if (!term) return [];
        const nt = normalizeForSearch(term);
        const matches = (p: Product) => normalizeForSearch(p.name).includes(nt) || (!!p.description && normalizeForSearch(p.description).includes(nt));
        const ordered = orderedCategories.flatMap(c => (productsByCategory.get(c.id) || []).filter(matches));
        const orphans = products.filter(p => !p.category_id && matches(p));
        return [...ordered, ...orphans];
    }, [term, orderedCategories, productsByCategory, products]);

    const renderProductRow = (product: Product, catLabel?: string) => {
        const effectivePrice = getEffectivePrice(product);
        const hasActivePromo = effectivePrice < product.price;
        const variablePricing = !!product.option_groups?.some(g => g.options?.some(o => o.price_delta > 0));
        return (
            <div
                key={product.id}
                role="button"
                tabIndex={0}
                onClick={() => { if (product.sold_out) { toast.info(`${product.name} está esgotado.`); return; } setSelectedProduct(product); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (product.sold_out) { toast.info(`${product.name} está esgotado.`); return; } setSelectedProduct(product); } }}
                className={`flex items-center gap-3 px-2 -mx-2 py-3 border-b border-[var(--border)] last:border-0 cursor-pointer u-motion hover:bg-[var(--surface-2)] rounded-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] ${product.sold_out ? 'opacity-60' : ''}`}
            >
                <div className="flex-1 min-w-0">
                    <h4 className="text-[15px] font-semibold text-[var(--text)] leading-snug line-clamp-2">{product.name}</h4>
                    {catLabel && (
                        <p className="text-[12px] font-medium text-[var(--brand)] mt-0.5 truncate">{catLabel}</p>
                    )}
                    {product.description && (
                        <p className="text-[13px] text-[var(--text-muted)] mt-0.5 line-clamp-2">{product.description}</p>
                    )}
                    <div className="mt-1 flex items-center gap-2">
                        <span className="font-semibold text-[15px] num" style={{ color: hasActivePromo ? 'var(--promo)' : 'var(--text)' }}>
                            {variablePricing && (
                                <span className="font-normal text-[var(--text-muted)] text-[13px] mr-0.5">A partir de</span>
                            )}
                            {' '}R$ {formatBRL(effectivePrice)}
                        </span>
                        {hasActivePromo && (
                            <span className="text-[var(--text-muted)] line-through text-[13px]">R$ {formatBRL(product.price)}</span>
                        )}
                    </div>
                </div>
                {product.sold_out && (
                    <span className="shrink-0 text-[12px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-[var(--err-fill)] text-white">Esgotado</span>
                )}
                {podeEsgotar && (
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); alternarEsgotado(product); }}
                        className="shrink-0 min-h-9 max-sm:min-h-11 px-3 rounded-full bg-[var(--surface-2)] text-[12px] font-semibold text-[var(--text)] hover:bg-[var(--border)] u-press"
                        aria-label={product.sold_out ? `Voltar ${product.name} ao cardápio` : `Marcar ${product.name} como esgotado`}
                    >
                        {product.sold_out ? 'Voltou' : 'Esgotar'}
                    </button>
                )}
                <ProductThumb src={product.image_url} name={product.name} size="option" className="!rounded-[12px]" />
            </div>
        );
    };

    const renderSections = (cats: Category[], withOrphans = false) => {
        const secs = cats.map(c => ({ cat: c as Category | null, list: productsByCategory.get(c.id) || [] })).filter(s => s.list.length > 0);
        if (withOrphans) {
            const orphans = products.filter(p => !p.category_id);
            if (orphans.length) secs.push({ cat: null, list: orphans });
        }
        return secs.map((s, i) => (
            <section key={s.cat?.id ?? 'sem-categoria'} className={i > 0 ? 'mt-5' : ''}>
                <h3 className="text-[13px] font-semibold text-[var(--text-muted)] pt-1 pb-1">
                    {s.cat?.name ?? 'Sem categoria'} <span className="font-normal num">· {s.list.length}</span>
                </h3>
                {s.list.map(p => renderProductRow(p))}
            </section>
        ));
    };

    // Pílulas das irmãs (dentro de um grupo): pular de "Na Chapa" pra
    // "Espetos" sem voltar. "Todos" = o grupo inteiro por seção.
    const renderSiblingPills = (groupId: string, activeCatId: string | null) => {
        const g = groupById(groupId);
        if (!g) return null;
        const pill = (key: string, label: string, active: boolean, onClick: () => void) => (
            <button
                key={key}
                type="button"
                onClick={onClick}
                aria-current={active ? 'true' : undefined}
                className={`flex-shrink-0 h-9 px-3.5 rounded-full text-[14px] whitespace-nowrap u-motion u-press-sm max-sm:min-h-11 ${active ? 'bg-[var(--brand-soft)] font-semibold' : 'bg-[var(--surface-2)] font-medium text-[var(--text)]'}`}
                style={active ? { color: GARCOM_ACTION } : undefined}
            >
                {label}
            </button>
        );
        return (
            <div ref={pillsRef} className="flex gap-2 overflow-x-auto no-scrollbar pb-2 -mx-1 px-1">
                {pill('todos', 'Todos', activeCatId === null, () => { setSearchTerm(''); setView({ level: 'groupAll', groupId }); })}
                {g.categories.map(c => pill(c.id, c.name, activeCatId === c.id, () => { setSearchTerm(''); setView({ level: 'category', categoryId: c.id, groupId }); }))}
            </div>
        );
    };

    const title = (() => {
        if (view.level === 'all') return { back: 'Cardápio', name: 'Todos os produtos' };
        if (view.level === 'group') return { back: 'Cardápio', name: groupById(view.groupId)?.group.name ?? '' };
        if (view.level === 'groupAll') return { back: groupById(view.groupId)?.group.name ?? 'Voltar', name: 'Todos' };
        if (view.level === 'category') {
            const g = view.groupId ? groupById(view.groupId) : null;
            return { back: g ? g.group.name : 'Cardápio', name: categoryLabelOf.get(view.categoryId) ?? '' };
        }
        return null;
    })();

    const renderView = () => {
        if (!loaded) {
            return (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
                    {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[84px] rounded-[18px] bg-[var(--surface-2)] animate-pulse" />)}
                </div>
            );
        }
        if (loadFailed) {
            return (
                <div className="text-center py-10 space-y-3">
                    <p className="text-[15px] text-[var(--text)] font-semibold">Não foi possível carregar o cardápio</p>
                    <p className="text-[13px] text-[var(--text-muted)]">Confira a conexão e tente de novo.</p>
                    <Button onClick={() => { setLoaded(false); loadMenu(1); }}>Tentar de novo</Button>
                </div>
            );
        }
        if (view.level === 'home') {
            return (
                <div className="space-y-2.5 pt-1">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {homeItems.map(item => item.kind === 'group' ? (
                            <MenuTile
                                key={item.group.id}
                                title={item.group.name}
                                meta={itensLabel(item.categories.reduce((n, c) => n + countOf(c.id), 0))}
                                hint={item.categories.map(c => c.name).join(' · ')}
                                onClick={() => go({ level: 'group', groupId: item.group.id })}
                            />
                        ) : (
                            <MenuTile
                                key={item.category.id}
                                title={item.category.name}
                                meta={itensLabel(countOf(item.category.id))}
                                onClick={() => go({ level: 'category', categoryId: item.category.id, groupId: null })}
                            />
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={() => go({ level: 'all' })}
                        className="w-full h-12 rounded-full bg-[var(--surface-2)] text-[15px] font-semibold flex items-center justify-center gap-1.5 u-motion u-press-sm"
                        style={{ color: GARCOM_ACTION }}
                    >
                        Ver todos os produtos <span className="font-normal text-[var(--text-muted)] num">({products.length})</span>
                    </button>
                </div>
            );
        }
        if (view.level === 'group') {
            const g = groupById(view.groupId);
            if (!g) return null;
            const total = g.categories.reduce((n, c) => n + countOf(c.id), 0);
            return (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
                    <MenuTile
                        emphasis
                        title="Ver todos"
                        meta={itensLabel(total)}
                        onClick={() => go({ level: 'groupAll', groupId: g.group.id })}
                    />
                    {g.categories.map(c => (
                        <MenuTile
                            key={c.id}
                            title={c.name}
                            meta={itensLabel(countOf(c.id))}
                            onClick={() => go({ level: 'category', categoryId: c.id, groupId: g.group.id })}
                        />
                    ))}
                </div>
            );
        }
        if (view.level === 'groupAll') {
            const g = groupById(view.groupId);
            return g ? renderSections(g.categories) : null;
        }
        if (view.level === 'category') {
            const list = productsByCategory.get(view.categoryId) || [];
            return list.length
                ? <div>{list.map(p => renderProductRow(p))}</div>
                : <p className="text-sm text-[var(--text-muted)] text-center py-8">Nenhum produto nesta categoria.</p>;
        }
        return renderSections(orderedCategories, true);
    };

    const pillsGroupId = view.level === 'groupAll' ? view.groupId : view.level === 'category' ? view.groupId : null;
    const pillsActive = view.level === 'category' ? view.categoryId : null;

    return (
        <div className="flex flex-col h-full min-h-[400px]">
            <div className="flex-shrink-0 space-y-3 pb-2">
                <div className="relative">
                    <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                    <input
                        type="search"
                        placeholder="Buscar no cardápio inteiro..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full h-10 max-sm:h-11 pl-10 pr-4 rounded-full bg-[var(--surface-2)] text-[var(--text)] placeholder:text-[var(--text-muted)] text-[15px] max-sm:text-base focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40"
                    />
                </div>
                {!term && title && (
                    <div className="flex items-center gap-2 min-h-[36px]">
                        <button
                            type="button"
                            onClick={goBack}
                            className="flex items-center -ml-1.5 pr-2 h-9 rounded-full text-[15px] font-medium u-motion u-press-sm max-w-[45%] max-sm:min-h-11"
                            style={{ color: GARCOM_ACTION }}
                        >
                            <ChevronLeft size={22} className="flex-shrink-0" />
                            <span className="truncate">{title.back}</span>
                        </button>
                        <h3 className="flex-1 min-w-0 text-right text-[20px] font-bold tracking-[-0.01em] text-[var(--text)] truncate">{title.name}</h3>
                    </div>
                )}
                {!term && !title && (
                    <h3 className="text-[20px] font-bold tracking-[-0.01em] text-[var(--text)] min-h-[36px] flex items-center">Cardápio</h3>
                )}
                {!term && pillsGroupId && renderSiblingPills(pillsGroupId, pillsActive)}
                {term && (
                    <p className="text-[13px] text-[var(--text-muted)] min-h-[20px]">
                        {searchResults.length ? `${itensLabel(searchResults.length)} para “${term}”` : ''}
                    </p>
                )}
            </div>

            <div ref={listRef} className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-1">
                {term ? (
                    searchResults.length
                        ? searchResults.map(p => renderProductRow(p, p.category_id ? categoryLabelOf.get(p.category_id) : undefined))
                        : <p className="text-sm text-[var(--text-muted)] text-center py-8">Nada encontrado para “{term}”.</p>
                ) : (
                    <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                        <motion.div
                            key={menuViewKey(view)}
                            custom={direction}
                            variants={{
                                enter: (d: number) => ({ x: d * 40, opacity: 0 }),
                                center: { x: 0, opacity: 1 },
                                exit: (d: number) => ({ x: d * -40, opacity: 0 }),
                            }}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
                        >
                            {renderView()}
                        </motion.div>
                    </AnimatePresence>
                )}
            </div>

            <StoreProductModal
                product={selectedProduct}
                addLabel={addLabel}
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
    // Reunião 2026-09-10 (min 34:44): "cadê a seleção dos 10%? Eu tenho que
    // vir aqui na comanda e tirar" — o controle da taxa só existia uma tela
    // antes. Opcional de propósito: só mesa tem taxa de serviço por comanda,
    // o balcão (CounterView, mesmo componente) não passa nada aqui.
    serviceFeeToggle?: React.ReactNode;
    children?: React.ReactNode;
}> = ({
    total, methods, currentMethod, onMethodChange, currentBrand, onBrandChange,
    currentAmount, onAmountChange, onAddPayment, onRemovePayment, remainingToPay,
    changeDue, onFinish, finishDisabled, finishLabel,
    showEmitirNotaToggle, emitirNota, onEmitirNotaChange, serviceFeeToggle, children,
}) => (
    <div className="space-y-6 pt-2">
        <div className="text-center pt-1">
            <p className="text-[13px] font-medium text-[var(--text-muted)]">Total a receber</p>
            <p className="text-[40px] leading-tight font-bold num tracking-[-0.02em] text-[var(--text)] mt-0.5">R$ <AnimatedNumber value={total} format={formatBRL} /></p>
            {serviceFeeToggle}
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
                    className={`flex flex-col items-center justify-center min-h-[72px] p-3 rounded-[14px] u-motion u-press-sm ${
                        currentMethod === m.id
                        ? 'ring-2 ring-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]'
                        : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--border)]'
                    }`}
                >
                    <m.icon size={22} className="mb-1.5" />
                    <span className="text-[13px] font-semibold">{m.label}</span>
                </button>
            ))}
        </div>

        {/* Bandeira do cartão — só faz sentido pra CREDIT/DEBIT. Catálogo
            fechado (lib/labels.ts CARD_BRAND_LABELS), nunca texto livre.
            Obrigatória (2026-08-28, achado ao vivo): sem ela, a conferência
            por bandeira no fechamento de caixa fica incompleta — handleAddPayment
            bloqueia lançar pagamento de cartão sem bandeira escolhida. */}
        {(currentMethod === 'CREDIT' || currentMethod === 'DEBIT') && (
            <div className="animate-fade-in">
                <p className="text-[13px] font-semibold text-[var(--text-muted)] mb-2">Bandeira</p>
                <div className="flex flex-wrap gap-2">
                    {Object.entries(CARD_BRAND_LABELS).map(([id, label]) => (
                        <button
                            key={id}
                            onClick={() => onBrandChange(currentBrand === id ? '' : id)}
                            className={`h-9 max-sm:h-11 px-4 rounded-full text-[13px] font-semibold u-motion u-press-sm ${
                                currentBrand === id
                                ? 'bg-[var(--brand-fill)] text-white'
                                : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--border)]'
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
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] font-semibold">R$</span>
                <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    className="w-full h-12 pl-11 pr-4 rounded-[14px] bg-[var(--surface-2)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 font-semibold text-lg num"
                    placeholder="0.00"
                    value={currentAmount}
                    onChange={e => onAmountChange(e.target.value)}
                />
            </div>
            <Button onClick={onAddPayment} aria-label="Lançar pagamento" className="!w-12 !h-12 !px-0 shrink-0">
                <Plus size={22} />
            </Button>
        </div>

        {/* Payment List */}
        <div className="bg-[var(--surface-2)] rounded-[14px] overflow-hidden">
            {methods.length > 0 ? (
                <ul className="divide-y divide-[var(--border)]">
                    {methods.map((p, idx) => (
                        <li key={idx} className="flex justify-between items-center text-[15px] px-4 py-2.5">
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-[var(--text)]">
                                    {getPaymentMethodLabel(p.method)}
                                    {p.brand && <span className="font-normal text-[var(--text-muted)]"> · {getCardBrandLabel(p.brand)}</span>}
                                </span>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="num font-semibold">R$ {formatBRL(p.amount)}</span>
                                <button onClick={() => onRemovePayment(idx)} aria-label="Remover pagamento" className="p-1.5 max-sm:p-2.5 rounded-full text-[var(--err)]/70 hover:text-[var(--err)] hover:bg-[var(--err)]/10 u-motion u-press">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-center text-[var(--text-muted)] text-[13px] py-6">Nenhum pagamento lançado</p>
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
            <div className="flex items-center justify-between bg-[var(--surface-2)] px-4 py-3 rounded-[14px]">
                <span className="text-[15px] font-medium text-[var(--text)]">Emitir nota fiscal desta venda</span>
                <button
                    type="button"
                    onClick={() => onEmitirNotaChange?.(!emitirNota)}
                    role="switch"
                    aria-checked={!!emitirNota}
                    aria-label="Emitir nota fiscal desta venda"
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${emitirNota ? 'bg-[var(--ok-fill)]' : 'bg-[var(--border)]'}`}
                >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${emitirNota ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
            </div>
        )}

        {children}

        {/* Summary & Action */}
        <div className="border-t border-[var(--border)] pt-4 max-sm:sticky max-sm:bottom-[calc(-1*max(1.25rem,env(safe-area-inset-bottom)))] max-sm:-mx-5 max-sm:-mb-[max(1.25rem,env(safe-area-inset-bottom))] max-sm:px-5 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] max-sm:bg-[var(--surface)] max-sm:z-10">
            <div className="space-y-1 mb-4 px-2">
                <div className="flex justify-between text-sm">
                    <span className="text-[var(--text-muted)]">Restante a pagar</span>
                    <span className="font-semibold num text-[var(--err)]">
                        R$ <AnimatedNumber value={remainingToPay} format={formatBRL} />
                    </span>
                </div>
                {finishDisabled && (
                    <p className="text-xs text-[var(--text-muted)]">
                        Digite o valor recebido e toque em <span className="font-bold">+</span> para liberar o botão.
                    </p>
                )}
                {changeDue > 0 && (
                    <div className="flex justify-between text-sm">
                        <span className="text-[var(--text-muted)]">Troco</span>
                        <span className="font-semibold num text-[var(--ok)]">
                            R$ <AnimatedNumber value={changeDue} format={formatBRL} />
                        </span>
                    </div>
                )}
            </div>
            <Button
                // Bug real do cliente (Ramon, 2026-09-03): onClick={onFinish} direto
                // repassa o SyntheticEvent do clique como 1º argumento pra
                // handleFinishPayment/handleFinishCounterPayment — desde que essas
                // funções ganharam o parâmetro opcional `methodsOverride` (2026-08-27,
                // atalho de 1 toque), o evento (sempre truthy) vira `methods` no lugar
                // de `paymentMethods`, e `methods.reduce` quebra em TODO clique manual
                // deste botão (mesa e balcão) — só o atalho de 1 toque (que chama a
                // função direto com um array de verdade, sem passar por este botão)
                // funcionava. `() => onFinish()` garante que nenhum argumento é
                // repassado, sempre caindo no fallback correto (`paymentMethods`).
                onClick={() => onFinish()}
                size="lg"
                className="w-full !h-[52px] !text-[17px]"
                disabled={finishDisabled}
            >
                <CheckCircle size={20} /> {finishLabel}
            </Button>
        </div>
    </div>
);

// "Adicionar pedido" do garçom (redesign 2026-09-26, pedido do dono): no
// computador/tablet (>=768px) é uma janela grande centralizada (~88vw x 84vh)
// sobre scrim escurecido+desfocado; no celular continua ocupando a altura
// toda (é tela de trabalho), como folha que sobe de baixo com alça — só a
// alça/cabeçalho arrasta (dragControls), pra não brigar com a rolagem do
// cardápio. Esc/scrim/X fecham; Esc é ignorado enquanto houver outro
// diálogo por cima (folha do produto, "Categorias"), que fecha primeiro.
const useIsPhone = () => {
    const [isPhone, setIsPhone] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia('(max-width: 767px)');
        const update = () => setIsPhone(mq.matches);
        update();
        mq.addEventListener('change', update);
        return () => mq.removeEventListener('change', update);
    }, []);
    return isPhone;
};

const WaiterOrderSurface: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    title: React.ReactNode;
    ariaLabel: string;
    children: React.ReactNode;
}> = ({ isOpen, onClose, title, ariaLabel, children }) => {
    const isPhone = useIsPhone();
    const dragControls = useDragControls();
    const containerRef = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            // Outro diálogo aberto por cima (folha do produto etc.) fecha primeiro.
            const dialogs = document.querySelectorAll('[role="dialog"]');
            if (dialogs.length > 1) return;
            e.preventDefault();
            onCloseRef.current();
        };
        document.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [isOpen]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="waiter-scrim"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 backdrop-blur-sm"
                    onClick={onClose}
                >
                    <motion.div
                        key="waiter-panel"
                        ref={containerRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label={ariaLabel}
                        initial={isPhone ? { y: '100%' } : { opacity: 0, scale: 0.96 }}
                        animate={isPhone ? { y: 0 } : { opacity: 1, scale: 1 }}
                        exit={isPhone ? { y: '100%' } : { opacity: 0, scale: 0.96 }}
                        transition={isPhone ? SPRING_SHEET : SPRING_UI}
                        drag={isPhone ? 'y' : false}
                        dragListener={false}
                        dragControls={dragControls}
                        dragConstraints={{ top: 0 }}
                        dragElastic={{ top: 0.05, bottom: 0.5 }}
                        onDragEnd={(_e, info) => {
                            if (info.velocity.y > 500 || info.offset.y > window.innerHeight * 0.3) onClose();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full h-[calc(100dvh-10px)] rounded-t-[22px] md:w-[min(1280px,88vw)] md:h-[84vh] md:rounded-[22px] bg-[var(--surface)] overflow-hidden flex flex-col"
                        style={{ boxShadow: '0 20px 60px -12px rgba(0,0,0,0.28), 0 0 0 1px var(--border)' }}
                    >
                        <div
                            className="flex-shrink-0 touch-none md:touch-auto"
                            onPointerDown={(e) => { if (isPhone && !(e.target as HTMLElement).closest('button')) dragControls.start(e); }}
                        >
                            <div className="flex justify-center pt-2 md:hidden">
                                <div className="w-10 h-1 rounded-full bg-[var(--border)]" />
                            </div>
                            <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-3 md:pt-5">
                                <h3 className="text-[20px] font-semibold tracking-[-0.015em] text-[var(--text)] min-w-0 truncate">{title}</h3>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    aria-label="Sair"
                                    title="Sair"
                                    className="flex items-center justify-center flex-shrink-0 w-8 h-8 max-md:w-10 max-md:h-10 rounded-full bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--border)] u-motion max-sm:min-h-11 max-sm:min-w-11"
                                >
                                    <X size={16} strokeWidth={2.25} />
                                </button>
                            </div>
                        </div>
                        {children}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

// Mesa mudando de status (Task 10 Step 9). A memória fica no TablesView
// (sobrevive ao cartão trocar de grade Livres→Ocupadas, que remonta o
// cartão): o ponto troca de cor com crossfade e o cartão dá UM "respiro"
// (scale 1→1.02→1). Mesa que só é redesenhada pelo polling sem mudar de
// status não anima nada.
type TableVisualMemo = React.MutableRefObject<Map<string, { status: string; color: string }>>;

const TableStatusDot: React.FC<{ tableId: string; color: string; memo: TableVisualMemo; pulse?: boolean }> = ({ tableId, color, memo, pulse }) => {
    // Cor anterior lida só na montagem (cartão que acabou de trocar de grade).
    const [from] = useState(() => memo.current.get(tableId)?.color);
    return (
        <span className={`relative w-2 h-2 rounded-full shrink-0 ${pulse ? 'u-pulse-dot' : ''}`} style={{ color }} aria-hidden>
            <AnimatePresence initial={false}>
                <motion.span
                    key={color}
                    className="absolute inset-0 rounded-full"
                    style={{ background: color }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                />
            </AnimatePresence>
            {from && from !== color && (
                <motion.span
                    className="absolute inset-0 rounded-full"
                    style={{ background: from }}
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                />
            )}
        </span>
    );
};

const TableMotionCard = React.forwardRef<HTMLDivElement, {
    tableId: string;
    statusKey: string;
    dotColor: string;
    memo: TableVisualMemo;
    children: React.ReactNode;
}>(function TableMotionCard({ tableId, statusKey, dotColor, memo, children }, ref) {
    const [scope, animate] = useAnimate<HTMLDivElement>();
    const reduce = useReducedMotion();
    useEffect(() => {
        const prev = memo.current.get(tableId)?.status;
        memo.current.set(tableId, { status: statusKey, color: dotColor });
        if (prev !== undefined && prev !== statusKey && !reduce && scope.current) {
            animate(scope.current, { scale: [1, 1.02, 1] }, { duration: 0.45, ease: 'easeInOut' });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusKey]);
    useEffect(() => {
        const cur = memo.current.get(tableId);
        if (cur) cur.color = dotColor;
    }, [tableId, dotColor, memo]);
    return (
        <motion.div ref={ref} {...LIST_ITEM_MOTION}>
            <div ref={scope}>{children}</div>
        </motion.div>
    );
});

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
    const serviceFeeRate = resolveServiceFeeRate(store.config);
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
    // Modo Aberto (30/09): computador do salão logado no perfil role='open'. Só abre
    // mesa e lança pedido (confirmado com a senha de quem lança); o resto é só com login.
    const isAberto = loggedUser.role === 'open';
    const avisarSoComLogin = () => toast.info('Só com login: saia do modo Aberto e entre com a sua conta.');
    // Senha de quem está lançando o pedido no modo Aberto (só a senha; ver migration 135).
    const [senhaPedido, setSenhaPedido] = useState<{ aberto: boolean; senha: string; erro: string; verificando: boolean }>({ aberto: false, senha: '', erro: '', verificando: false });
    const pedirSenhaDoPedido = () => setSenhaPedido({ aberto: true, senha: '', erro: '', verificando: false });
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
    // Pedido da mesa em montagem (2026-09-29, pedido do cliente do Sertão): tocar
    // em "Adicionar ao pedido" só junta no carrinho; o pedido nasce de uma vez em
    // "Confirmar pedido" — e sai numa comanda só por destino, em vez de um papel
    // por item. Depois de confirmado o pedido está na mesa (sem desfazer).
    const [mesaCarrinho, setMesaCarrinho] = useState<CounterSaleLine[]>([]);
    const [enviandoPedidoMesa, setEnviandoPedidoMesa] = useState(false);
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
    const tableVisualMemo: TableVisualMemo = useRef(new Map<string, { status: string; color: string }>());
    const [hostNameInput, setHostNameInput] = useState('');
    useEffect(() => { setHostNameInput(''); }, [selectedTable?.id]);
    const [showFullBill, setShowFullBill] = useState(false);
    
    // Menu Mode State
    const [showMenuMode, setShowMenuMode] = useState(false);
    useEffect(() => { if (!showMenuMode) setMesaCarrinho([]); }, [showMenuMode]);

    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [showFixDbModal, setShowFixDbModal] = useState(false);
    const [showMoveTableModal, setShowMoveTableModal] = useState(false);
    const [moveItemDlg, setMoveItemDlg] = useState<{ itemId: string; nome: string; targetId: string; enviando: boolean } | null>(null);
    const [cancelItemDlg, setCancelItemDlg] = useState<{ itemId: string; nome: string; motivo: string; outro: string; enviando: boolean } | null>(null);
    // Planta de mesas (floor plan): alterna Lista/Mapa; a escolha fica no aparelho.
    const [tablesViewMode, setTablesViewMode] = useState<'lista' | 'mapa'>(() => {
        try { return localStorage.getItem('tables_view_mode') === 'mapa' ? 'mapa' : 'lista'; } catch { return 'lista'; }
    });
    const mudarTablesViewMode = (m: 'lista' | 'mapa') => {
        setTablesViewMode(m);
        try { localStorage.setItem('tables_view_mode', m); } catch { /* sem storage: só não lembra */ }
    };
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
        if (isAberto) { avisarSoComLogin(); return; }
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
    // Locais de preparo pra filtrar "Pedidos do Dia" por local (ex.: só Pizzaria).
    const [locaisInfo, setLocaisInfo] = useState<{ setores: PrintSector[]; catSetor: Record<string, string | null> }>({ setores: [], catSetor: {} });
    useEffect(() => {
        Promise.all([fetchPrintSectors(storeId), fetchCategorySectors(storeId)])
            .then(([setores, catSetor]) => setLocaisInfo({ setores, catSetor }))
            .catch(() => {});
    }, [showSentHistory, storeId]);

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
        if (isAberto) { avisarSoComLogin(); return; }
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
            if (!cancelled) setClosedTodayOrders(closed); // mesas e balcão (balcão aparece como "Balcão")
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

    // Achado real (2026-09-11, ao atender o pedido da reunião de 10/09 de
    // "tirar os 10% mais fácil"): existiam DUAS fontes de verdade pra taxa
    // removida que nunca conversavam. O botão de lixeira da comanda só
    // mexia no Set local `removedServiceFees` — `toggleTableServiceFee`
    // (lib/api.ts) estava importado mas NUNCA era chamado, e a coluna
    // persistida `tables.service_fee_removed` (que CaixaView lê pra montar
    // o total da mesma mesa) nunca era escrita por ninguém. Consequências
    // reais: (1) remover a taxa não sobrevivia a um F5; (2) a aba Caixa
    // mostrava um total DIFERENTE da comanda pra mesma mesa; (3) outro
    // aparelho/operador nunca via a remoção.
    //
    // Agora é uma fonte só: o Set local é só cache otimista do que está no
    // banco — hidratado de `service_fee_removed` a cada loadData (ver
    // abaixo) e escrito via RPC aqui, com revert se o servidor recusar.
    const handleToggleServiceFee = async (tableId: string, remove: boolean) => {
        if (isAberto) { avisarSoComLogin(); return; }
        setRemovedServiceFees(prev => {
            const next = new Set(prev);
            if (remove) next.add(tableId); else next.delete(tableId);
            return next;
        });
        try {
            await toggleTableServiceFee(tableId, remove);
        } catch (e: any) {
            setRemovedServiceFees(prev => {
                const next = new Set(prev);
                if (remove) next.delete(tableId); else next.add(tableId);
                return next;
            });
            toast.error('Não foi possível alterar a taxa de serviço: ' + (e?.message || 'tente de novo.'));
        }
    };

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
    // 2026-09-21: mesmo campo, agora também pra NFC-e (opcional, não trava
    // o fechamento nem cria 'pendente' — ver route.ts). Estado separado de
    // nfeModeloAtivo pra manter o texto de ajuda diferente por modelo (NF-e
    // deixa a nota 'pendente' se ficar em branco; NFC-e não).
    const [nfceModeloAtivo, setNfceModeloAtivo] = useState(false);
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
        // Taxa de serviço lançada como item pelo caixa (migration 138): o item
        // É a taxa, então o cálculo automático não soma de novo.
        const hasFeeItem = contaTemTaxaPercentual(items);
        const isServiceFeeEnabled = !!(store.config?.charge_service_fee && !removedServiceFees.has(selectedTable.id)) && !hasFeeItem;
        // Task 3: distingue "loja nunca cobra" de "loja cobra, mas foi
        // removida desta mesa" (mesmo botão "Remover Taxa" da comanda) —
        // os dois zeram isServiceFeeEnabled, mas o texto explicativo pro
        // garçom precisa dizer qual dos dois é, não só "sem taxa".
        const isServiceFeeRemovedForTable = !!(store.config?.charge_service_fee && removedServiceFees.has(selectedTable.id)) && !hasFeeItem;
        const serviceFee = isServiceFeeEnabled ? calculateServiceFee(subtotal, serviceFeeRate) : 0;
        const total = calculateOrderTotal(subtotal, isServiceFeeEnabled, serviceFeeRate);
        return { subtotal, serviceFee, total, allItems: items, isServiceFeeEnabled, isServiceFeeRemovedForTable, hasFeeItem };
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
        if (isAberto) { avisarSoComLogin(); return; }
        if (!selectedTable) return;
        setEmitindoNotaDe(userName);
        try {
            const destinatario = buildDestinatario(paymentDestCpfCnpj, paymentDestNome);
            const res = await fetch(resolverUrlApi('/api/fiscal/emitir'), {
                method: 'POST',
                headers: cabecalhosApi(),
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
            localId: string;
            addons?: string;
            observation?: string;
            client?: string | null;
            closed: boolean;
            printed: boolean;
            addedByName?: string | null;
            balcao?: boolean;
        }[] = [];
        const pushOrder = (order: Order, closed: boolean) => {
            (order.order_items || []).forEach(item => {
                if (item.status === OrderStatus.CANCELED) return;
                const setorId = item.product?.sector_id
                    || (item.product?.ignore_category_sector ? null : (item.product?.category_id ? locaisInfo.catSetor[item.product.category_id] : null))
                    || null;
                const setor = setorId ? locaisInfo.setores.find(x => x.id === setorId) : undefined;
                const destination: 'kitchen' | 'bar' = setor ? setor.base : (item.product?.destination === 'bar' ? 'bar' : 'kitchen');
                const localId = setor ? setor.id : destination;
                const { client, observation } = parseItemNote(item.notes || '');
                rows.push({
                    localId,
                    id: item.id,
                    orderId: item.order_id,
                    time: item.created_at,
                    tableNumber: order.order_type === 'counter' ? 'Balcão' : ((order.table_id && tableNumberById.get(order.table_id)) ?? order.tables?.number ?? '?'),
                    balcao: order.order_type === 'counter',
                    productName: item.product?.name || 'Produto indisponível',
                    quantity: item.quantity,
                    destination,
                    addons: (item.selected_options || []).map(o => o.name).join(', ') || undefined,
                    observation: observation || undefined,
                    client: client || (order.order_type === 'counter' ? order.customer_name : null),
                    closed,
                    printed: wasKitchenTicketPrinted(storeId, destination, item.id),
                    addedByName: item.added_by_role === 'garcom' ? item.added_by_name : ((order.payment_details as { operador_nome?: string } | null)?.operador_nome && order.order_type === 'counter' ? (order.payment_details as { operador_nome?: string }).operador_nome : null),
                });
            });
        };
        activeOrders.forEach(order => pushOrder(order, false));
        closedTodayOrders.forEach(order => pushOrder(order, true));
        return rows.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
        // eslint-disable-next-line react-hooks/exhaustive-deps -- printedRefreshTick é só um gatilho de recálculo (lê localStorage via wasKitchenTicketPrinted), não um valor usado no corpo.
    }, [orderFlow, activeOrders, closedTodayOrders, tables, storeId, printedRefreshTick, locaisInfo]);

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
        registrarAcao(storeId, 'reimpressao.comanda', { entity: 'order_item', entityId: row.id, summary: `Reimprimiu comanda: ${row.quantity}x ${row.productName} (mesa ${row.tableNumber})`, details: { destino: row.destination } });
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

    const loadDataSeq = useRef(0);
    const loadDataAplicado = useRef(0);
    const tablesBoasRef = useRef<Table[]>([]);
    const ordersBoasRef = useRef<Order[]>([]);
    // Troca de loja: a última lista boa é da loja anterior, nunca pode aparecer na nova.
    useEffect(() => { tablesBoasRef.current = []; ordersBoasRef.current = []; loadDataAplicado.current = ++loadDataSeq.current; }, [storeId]);
    const loadData = async () => {
        if(!storeId) return;
        // Nao rebusca `stores` aqui (achado de performance #9): os eventos
        // Realtime assinados abaixo sao de `tables`/`orders`/`order_items`,
        // nenhum deles muda dado de `stores` — a config da loja ja vem
        // atualizada via prop `store` (StoreModule mantem `user.store` em
        // sincronia sempre que algo em `stores` muda de fato, ex.:
        // MenuManagementView.handleToggleServiceFee → onStoreUpdate).
        const seq = ++loadDataSeq.current;
        const [t0, o0, pendingOrders] = await Promise.all([
            fetchTables(storeId),
            fetchActiveOrdersForTables(storeId),
            buildPendingOrdersForStore(storeId),
        ]);
        // Resposta mais velha que a última já aplicada (polling + realtime em rede lenta): descarta. Nunca descarta só
        // porque outra leitura começou depois, senão em horário de pico (rajada de pings) a lista nunca atualizaria.
        if (seq < loadDataAplicado.current) return;
        loadDataAplicado.current = seq;
        // Leitura que falhou (rede lenta, timeout) nunca troca uma lista boa por cache velho ou vazio: mesas não somem.
        const t = leituraFalhou(t0) && tablesBoasRef.current.length > 0 ? tablesBoasRef.current : t0;
        const o = leituraFalhou(o0) && ordersBoasRef.current.length > 0 ? ordersBoasRef.current : o0;
        if (!leituraFalhou(t0)) tablesBoasRef.current = t0;
        if (!leituraFalhou(o0)) ordersBoasRef.current = o0;
        setTables(t);
        publicarMesas(storeId, t);
        // Mescla pedidos ainda só na fila offline (nunca sincronizados) —
        // sem isso, remontar este componente (ex. trocar de aba e voltar)
        // faz a comanda "esquecer" um pedido lançado offline até
        // sincronizar de verdade (achado real, WhatsApp 2026-09-10; ver
        // comentário completo em lib/offline/pendingOrders.ts).
        setActiveOrders([...o, ...(pendingOrders as Order[])]);

        // "Pedidos do Dia" (mesas fechadas hoje) NÃO é mais buscado aqui —
        // ver o efeito de `showSentHistory` abaixo (Important #I3, revisão
        // de código 2026-08-23): `fetchSalesHistory` é uma RPC `limit 2000`
        // com `order_items` aninhado, e `loadData` roda a cada ping Realtime
        // de `order_change_pings`/`table_change_pings` — MUITO mais vezes
        // por minuto do que alguém realmente abre o modal "Pedidos do Dia".
        // Rodar essa RPC toda vez era trabalho pago pra uma tela que, na
        // prática, fica fechada quase sempre.

        // Hidrata o cache local de taxa removida a partir do banco (ver
        // handleToggleServiceFee): antes disso `removedServiceFees` nascia
        // vazio a cada montagem, então a remoção não sobrevivia a um F5 nem
        // aparecia pra outro operador. Como fonte de verdade é a coluna,
        // uma remoção feita em outro aparelho também chega aqui pelo mesmo
        // ping de Realtime que já dispara loadData.
        setRemovedServiceFees(new Set(t.filter(table => table.service_fee_removed).map(table => table.id)));

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
    usePolling(() => loadData());

    // Config fiscal (Task 17) — só pra saber se mostra o campo opcional de
    // CPF/CNPJ do destinatário ao fechar a mesa. Falha silenciosa de
    // propósito (catch vazio): sem config fiscal configurada é o estado
    // normal da maioria das lojas, não um erro pra atrapalhar o fechamento.
    useEffect(() => {
        fetchStoreFiscalConfig(storeId)
            .then((cfg) => {
                setNfeModeloAtivo(cfg?.modelo_emissao_automatica === 'nfe');
                setNfceModeloAtivo(cfg?.modelo_emissao_automatica === 'nfce');
                // Task 4: qualquer modelo configurado (nfce OU nfe) já é
                // "emissão automática ligada" pra fins do toggle de opt-out
                // — loja sem NENHUMA config (cfg null) ou com
                // 'nenhuma' explícito não ganha o toggle.
                setEmissaoFiscalConfigurada(!!cfg && cfg.modelo_emissao_automatica !== 'nenhuma');
            })
            .catch(() => {
                setNfeModeloAtivo(false);
                setNfceModeloAtivo(false);
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
        // Inclui os cancelados: a lista "Pedidos da mesa" mostra riscado (fora do total).
        const itensComCancelados: OrderItem[] = [];
        tableOrders.forEach(o => {
            if(o.order_items) {
                o.order_items.forEach(i => {
                    itensComCancelados.push(i);
                    if(i.status !== 'canceled') {
                        subtotal += (i.price_at_time * i.quantity);
                        items.push(i);
                    }
                });
            }
        });
        // Sort by newest
        items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        itensComCancelados.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        
        const table = tables.find(t => t.id === tableId);
        const hasFeeItem = contaTemTaxaPercentual(items);
        const isServiceFeeEnabled = !!(store.config?.charge_service_fee && !removedServiceFees.has(tableId)) && !hasFeeItem;
        const isServiceFeeRemovedForTable = !!(store.config?.charge_service_fee && removedServiceFees.has(tableId)) && !hasFeeItem;
        const serviceFee = isServiceFeeEnabled ? calculateServiceFee(subtotal, serviceFeeRate) : 0;
        const total = calculateOrderTotal(subtotal, isServiceFeeEnabled, serviceFeeRate);

        return { subtotal, serviceFee, total, count: items.length, items: items.slice(0, 3), allItems: items, todosItens: itensComCancelados, isServiceFeeEnabled, isServiceFeeRemovedForTable }; // Show top 3
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
    // `automatica`: disparada por 'Pedir conta' — só imprime se houver impressora que receba a pré-conta (sem janela
    // de impressão do navegador no aparelho de quem pediu) e não repete no mesmo minuto (garçom + cliente pedindo junto).
    const printTableBill = async (tableId: string, automatica = false) => {
        if (isAberto) { avisarSoComLogin(); return; }
        // Interruptor 'Imprimir pré-conta automaticamente' (Configurações > Impressão): desligado, só o botão manual imprime.
        if (automatica && !preContaAutomaticaLigada((await fetchStoreById(store.id).catch(() => null) ?? store).config)) return;
        const summary = getTableSummary(tableId);
        const table = tables.find(t => t.id === tableId);
        if (!table || summary.allItems.length === 0) return;
        if (!automatica) registrarAcao(store.id, 'reimpressao.pre_conta', { entity: 'table', entityId: tableId, summary: `Imprimiu pré-conta da mesa ${table.number}`, details: { total: summary.total } });

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
            // Achado ao vivo (2026-08-28): esta é a "conferência da conta"
            // impressa ANTES de pagar (dono pede pra ver o extrato na mesa) —
            // faltava o mesmo enfileiramento pra impressora USB/rede do
            // caixa que handleFinishPayment já tem, então só o comprovante
            // PÓS-pagamento saía na impressora física; este nunca saía.
            enqueueReceiptPrintJobs(store.id, `Conferência - ${receiptOpts.label}`, (mm) => buildBillReceiptText({ ...receiptOpts, paperWidthMm: mm ?? receiptOpts.paperWidthMm }), automatica ? chavePreConta(tableId, activeOrders) : `manual:${tableId}:${receiptOpts.items.length}:${Math.round(Number(receiptOpts.total) * 100)}:${Math.floor(Date.now() / 45000)}`, 'pre_conta', automatica)
                .catch((e) => console.error('enqueueReceiptPrintJobs (conferência) falhou:', e));
            // Achado ao vivo na loja Sertão (2026-09-15): com uma impressora
            // USB/rede cadastrada pro destino 'receipt' (ex.: CAIXA), o
            // enqueueReceiptPrintJobs acima já imprime de verdade via
            // print-agent — chamar também printBillReceipt() (window.print,
            // caminho de navegador) duplicava a comanda em papel, e a
            // orientação/tamanho dessa segunda via seguia o driver padrão do
            // Windows, não a config da loja (daí ela sair errada). Mesmo
            // princípio que CaixaPrintStation.tsx já usa pros tickets de
            // cozinha/bar: com impressora física cadastrada, window.print()
            // fica de fora.
            const temImpressoraFisica = await hasActivePrinterForDoc(store.id, 'pre_conta');
            if (!temImpressoraFisica && !automatica) {
                const printed = await printBillReceipt(receiptOpts);
                if (!printed) {
                    toast.error('A conferência da conta não imprimiu. Confira a impressora.');
                }
            }
        } catch (e) {
            console.error('printBillReceipt (conferência de conta) lançou:', e);
            toast.error('A conferência da conta não imprimiu. Confira a impressora.');
        }
    };

    const handleMoveTable = async () => {
        if (isAberto) { avisarSoComLogin(); return; }
        if (!roleCan(loggedUser, store, 'trocar_mesa')) { toast.error('Você não tem permissão para trocar de mesa.'); return; }
        if (!selectedTable || !targetTableId) return;
        
        if (await confirm(`Tem certeza que deseja mover a Mesa ${selectedTable.number} para a nova mesa?`)) {
            const result = await moveTable(selectedTable.id, targetTableId, loggedUser.id);
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
        // Achado real (Ramon, WhatsApp 2026-09-08): a lista "Mesas ocupadas"
        // do Caixa (CaixaView) chama isto via `tableOverride` (autoOpenTableId,
        // ver o useEffect abaixo) SEM passar pelo mesmo clique de card que a
        // Gestão de Mesas usa — e só o clique de card em TablesView checava
        // `isTableInJurisdiction` (linha ~2722). Resultado: um garçom sem
        // jurisdição sobre a mesa (ex. mesa 12, fora da área 1-10 dele)
        // conseguia abrir o modal completo (Ver Comanda/Adicionar Pedido)
        // dessa mesa navegando via Caixa em vez de Gestão de Mesas — a
        // jurisdição nunca é sobre O BOTÃO que abre o modal, é sobre A MESA
        // em si, então o choque tem que estar aqui, no único ponto que os
        // dois caminhos (clique manual e auto-abertura do Caixa) atravessam
        // antes de `setSelectedTable`.
        if (!isTableInJurisdiction(loggedUser, table.id)) return;
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

    // Reunião 2026-09-10: com o botão de tirar/cobrar a taxa dentro do
    // próprio modal de pagamento, o valor já preenchido precisa acompanhar —
    // senão o caixa tira a taxa e continua cobrando o valor velho sem
    // perceber. Só mexe enquanto NENHUM pagamento foi lançado ainda: depois
    // do primeiro lançamento, quem manda no campo é o restante a pagar
    // (handleAddPayment), e sobrescrever aqui apagaria o troco em andamento.
    useEffect(() => {
        if (!showPaymentModal || !currentTableSummary) return;
        if (paymentMethods.length > 0) return;
        setCurrentPaymentAmount(currentTableSummary.total.toFixed(2));
    }, [currentTableSummary?.total, showPaymentModal, paymentMethods.length]);

    // Taxas como produto (migration 138, pedido do Ramon 2026-10-01): taxa de
    // serviço, rolha, troca etc. são produtos ligados ao código do Omie, e SÓ o
    // caixa lança, aqui no pagamento da mesa. Viram item da conta (nota fiscal e
    // Estoque/Omie pelo fluxo de sempre); a percentual substitui a taxa automática.
    const canLaunchFee = podeLancarTaxa(loggedUser);
    const [feeProducts, setFeeProducts] = useState<Product[]>([]);
    const [launchingFeeId, setLaunchingFeeId] = useState<string | null>(null);
    useEffect(() => {
        if (!canLaunchFee) return;
        fetchFeeProducts(storeId).then(setFeeProducts).catch(() => setFeeProducts([]));
    }, [storeId, canLaunchFee]);
    // Taxa editável (migration 141, pedido do Ramon): o caixa digita o valor em R$ ou o percentual
    // (menor ou maior que 10) e o item grava exatamente isso. Editar de novo atualiza o MESMO item.
    const [editandoTaxaId, setEditandoTaxaId] = useState<string | null>(null);
    const [taxaValorInput, setTaxaValorInput] = useState('');
    const [taxaPercentInput, setTaxaPercentInput] = useState('');
    const paraNumero = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
    const abrirEdicaoTaxa = (fp: Product) => {
        if (!currentTableSummary) return;
        const lancada = currentTableSummary.allItems.find(i => i.product_id === fp.id);
        if (ehTaxaPercentual(fp)) {
            const base = baseDaTaxaPercentual(currentTableSummary.allItems);
            const valor = lancada ? lancada.price_at_time : valorTaxaPercentual(currentTableSummary.allItems, Number(fp.fee_percent));
            setTaxaValorInput(valor.toFixed(2).replace('.', ','));
            const pct = lancada?.fee_manual && lancada.fee_manual_percent != null ? Number(lancada.fee_manual_percent) : (base > 0 ? Math.round((valor / base) * 10000) / 100 : Number(fp.fee_percent));
            setTaxaPercentInput(String(pct).replace('.', ','));
        } else {
            setTaxaValorInput(getEffectivePrice(fp).toFixed(2).replace('.', ','));
            setTaxaPercentInput('');
        }
        setEditandoTaxaId(fp.id);
    };
    // Digitou num campo: o outro acompanha (valor <-> % sobre a conta), pra ver a conta antes de aplicar.
    const aoDigitarTaxaValor = (v: string) => {
        setTaxaValorInput(v);
        if (!currentTableSummary) return;
        const base = baseDaTaxaPercentual(currentTableSummary.allItems);
        const n = paraNumero(v);
        setTaxaPercentInput(n != null && !Number.isNaN(n) && base > 0 ? String(Math.round((n / base) * 10000) / 100).replace('.', ',') : '');
    };
    const aoDigitarTaxaPercent = (v: string) => {
        setTaxaPercentInput(v);
        if (!currentTableSummary) return;
        const base = baseDaTaxaPercentual(currentTableSummary.allItems);
        const n = paraNumero(v);
        setTaxaValorInput(n != null && !Number.isNaN(n) ? (Math.round(base * n) / 100).toFixed(2).replace('.', ',') : '');
    };
    const handleLaunchFee = async (product: Product, edicao?: { amount?: number | null; percent?: number | null }) => {
        if (!selectedTable || !canLaunchFee) return;
        setLaunchingFeeId(product.id);
        try {
            const r = await addFeeItem({
                storeId,
                tableId: selectedTable.id,
                productId: product.id,
                operatorUserId: loggedUser.id,
                operatorName: loggedUser.name,
                amount: edicao?.amount,
                percent: edicao?.percent,
            });
            if (!r.success) { toast.error(r.message || 'Não foi possível lançar a taxa.'); return; }
            if (ehTaxaPercentual(product)) setRemovedServiceFees(prev => new Set(prev).add(selectedTable.id));
            setEditandoTaxaId(null);
            if (r.removed) toast.success(`${product.name} removida da conta.`);
            else toast.success(`${product.name} ${r.updated ? 'ajustada' : 'lançada'}: R$ ${formatBRL(r.price ?? 0)}`);
            await loadData();
        } catch (e: any) {
            toast.error('Não foi possível lançar a taxa: ' + (e?.message || 'tente de novo.'));
        } finally {
            setLaunchingFeeId(null);
        }
    };
    const handleAplicarEdicaoTaxa = (fp: Product) => {
        if (!currentTableSummary) return;
        const valor = paraNumero(taxaValorInput);
        const percent = paraNumero(taxaPercentInput);
        if (ehTaxaPercentual(fp)) {
            // Os dois campos andam juntos; o valor em R$ é o que o cliente pagou, então ele manda.
            const r = resolverTaxaEditada(baseDaTaxaPercentual(currentTableSummary.allItems), valor != null ? { valor } : { percent });
            if (!r.ok) { toast.error(r.message); return; }
            handleLaunchFee(fp, valor != null ? { amount: r.valor } : { percent: r.percent });
        } else {
            const r = resolverValorTaxaFixa(valor ?? NaN);
            if (!r.ok) { toast.error(r.message); return; }
            handleLaunchFee(fp, Math.abs(r.valor - getEffectivePrice(fp)) < 0.005 ? undefined : { amount: r.valor });
        }
    };
    // Taxa percentual lançada e depois entrou item novo na mesa: recalcula sozinha
    // ao abrir o pagamento (uma tentativa por valor), antes de qualquer forma de
    // pagamento lançada — o total não muda no meio do recebimento. Taxa editada em R$
    // nunca recalcula; editada em % recalcula com o % digitado (taxaPercentualDesatualizada).
    const feeRecalcKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (!showPaymentModal || !selectedTable || !currentTableSummary || !canLaunchFee) return;
        if (paymentMethods.length > 0 || launchingFeeId) return;
        const velha = taxaPercentualDesatualizada(currentTableSummary.allItems);
        if (!velha?.item.product) return;
        const chave = `${selectedTable.id}:${velha.esperado.toFixed(2)}`;
        if (feeRecalcKeyRef.current === chave) return;
        feeRecalcKeyRef.current = chave;
        handleLaunchFee(velha.item.product as Product);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showPaymentModal, currentTableSummary, paymentMethods.length, launchingFeeId]);

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
        if (isAberto) { avisarSoComLogin(); return; }
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
                // Id único do pagamento: o fechamento de caixa junta os pedidos de UMA conta por ele e não confunde
                // duas contas diferentes com valor, forma e operador iguais.
                payment_id: crypto.randomUUID(),
                operador_id: loggedUser.id,
                ...(emissaoFiscalConfigurada ? { emitir_nota: emitirNotaFiscal && vendaTemCobranca({ total: summary.total }) } : {}),
                ...(cashShiftId ? { cash_shift_id: cashShiftId } : {}),
            };

            // Destinatário (Task 17) — opcional mesmo em modelo NF-e; deixado
            // em branco, a rota de emissão grava a nota como 'pendente' (não
            // 'erro') com motivo claro, retomável depois via "Reemitir".
            const destinatario = buildDestinatario(paymentDestCpfCnpj, paymentDestNome);

            const result = await closeTableSession(selectedTable.id, paymentData, destinatario);

            if (result.success) {
                // Só visual (Task 10 Step 8): dispara e segue — não segura
                // impressão, nota nem o fechamento da janela.
                flashSuccessCheck();
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
                // Loja com impressora ativa pro caixa (rede/USB) imprime o comprovante
                // em toda venda fechada, seja quem for que finalizou (dono, universal,
                // operador) e em qualquer computador — a impressora física é quem decide.
                const temImpressoraFisica = await hasActivePrinterForDoc(store.id, 'comprovante');
                if (isCaixaOperator || temImpressoraFisica) {
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
                    // Aditivo (2026-08-28, achado ao vivo — loja com
                    // impressora de rede/USB dedicada ao caixa): nunca
                    // bloqueia nem afeta o resultado do fechamento.
                    enqueueReceiptPrintJobs(store.id, `Comprovante - ${receiptOpts.label}`, (mm) => buildBillReceiptText({ ...receiptOpts, paperWidthMm: mm ?? receiptOpts.paperWidthMm }), undefined, 'comprovante')
                        .catch((e) => console.error('enqueueReceiptPrintJobs falhou:', e));
                    // Achado ao vivo na loja Sertão (2026-09-15): com
                    // impressora física cadastrada pro destino 'receipt', o
                    // enqueue acima já imprime — window.print() aqui
                    // duplicava o comprovante (mesmo princípio já aplicado
                    // na conferência acima e em CaixaPrintStation.tsx).
                    if (!temImpressoraFisica) {
                        const printed = await printBillReceipt(receiptOpts);
                        if (!printed) {
                            toast.error('A conta foi fechada, mas o comprovante não imprimiu. Confira a impressora do caixa.');
                        }
                    }
                }

                // Reunião 2026-09-10 (min 15:06): com nota emitida, o que o
                // cliente leva também tem que ser o CUPOM FISCAL — até aqui
                // só saía o comprovante acima (sem valor fiscal) e a nota
                // ficava só em Administração → Notas Fiscais. Venda sem nota
                // continua exatamente como era: nada disso roda.
                //
                // Nunca bloqueia o fechamento: a mesa JÁ foi fechada neste
                // ponto, e `aguardarNotaFiscalDaVenda` tem teto de 12s. Se a
                // SEFAZ demorar mais que isso ou rejeitar, o caixa recebe um
                // aviso claro em vez de ficar esperando uma janela que não vem.
                if (emissaoFiscalConfigurada && emitirNotaFiscal && vendaTemCobranca({ total: summary.total })) {
                    const tableIdParaNota = selectedTable.id;
                    abrirCupomFiscalQuandoSair(store.id, store.name, { tableId: tableIdParaNota });
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
        if (isAberto) { avisarSoComLogin(); return; }
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
        if (isAberto) { avisarSoComLogin(); return; }
        try {
            const jaPediuConta = tables.find((t) => t.id === tableId)?.status === TableStatus.WAITING_BILL;
            await requestTableBill(tableId);
            setTables(prev => prev.map(t => t.id === tableId ? { ...t, status: TableStatus.WAITING_BILL } : t));
            if (selectedTable && selectedTable.id === tableId) {
                setSelectedTable(prev => prev ? { ...prev, status: TableStatus.WAITING_BILL } : null);
            }
            toast.success('Conta pedida — o caixa foi avisado.');
            // Pré-conta sai sozinha na(s) impressora(s) configurada(s) para ela (ex.: no bar).
            if (!jaPediuConta) void printTableBill(tableId, true);
        } catch (e) {
            toast.error('Erro ao pedir a conta.');
        }
    };

    const handleCancelBillRequest = async (tableId: string) => {
        if (isAberto) { avisarSoComLogin(); return; }
        try {
            await cancelTableBillRequest(tableId);
            setTables(prev => prev.map(t => t.id === tableId ? { ...t, status: TableStatus.OCCUPIED } : t));
            if (selectedTable && selectedTable.id === tableId) {
                setSelectedTable(prev => prev ? { ...prev, status: TableStatus.OCCUPIED } : null);
            }
            toast.success('Pedido de conta cancelado.');
        } catch (e) {
            toast.error('Erro ao cancelar o pedido de conta.');
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
    
    const mesaCarrinhoTotal = mesaCarrinho.reduce((a, l) => a + calculateCartItemUnitPrice({ product: l.product, selectedOptions: l.selectedOptions }) * l.qty, 0);
    const mesaCarrinhoQtd = mesaCarrinho.reduce((a, l) => a + l.qty, 0);

    const adicionarNaMesa = (product: Product, qty: number, notes: string, selectedOptions: SelectedOption[]) => {
        const obs = notes.trim();
        const key = `${product.id}|${selectedOptions.map(o => o.option_id).sort().join(',')}|${obs}`;
        setMesaCarrinho(prev => {
            const existente = prev.find(l => l.key === key);
            if (existente) return prev.map(l => l.key === key ? { ...l, qty: l.qty + qty } : l);
            return [...prev, { key, product, qty, notes: obs, selectedOptions }];
        });
        toast.success(`${getOrderItemDisplayName({ product, selected_options: selectedOptions })} adicionado ao pedido`);
    };
    const mudarQtdMesa = (key: string, delta: number) => {
        setMesaCarrinho(prev => prev.map(l => l.key === key ? { ...l, qty: Math.max(1, l.qty + delta) } : l));
    };
    const removerDaMesa = (key: string) => setMesaCarrinho(prev => prev.filter(l => l.key !== key));

    const fecharPedidoMesa = async () => {
        if (isAddingItemRef.current) return;
        if (mesaCarrinho.length > 0 && !(await confirm({ message: 'Descartar os itens que ainda não foram confirmados?', variant: 'danger', confirmLabel: 'Descartar' }))) return;
        setMesaCarrinho([]);
        setShowMenuMode(false);
    };

    const confirmarPedidoMesa = async (autor?: { name: string }) => {
        if (!selectedTable || mesaCarrinho.length === 0) return;
        // Modo Aberto: sem a senha de alguém da equipe o pedido não sai (ver pedirSenhaDoPedido).
        if ((isAberto || store.config?.pedido_pede_senha === true) && !autor) { pedirSenhaDoPedido(); return; }
        const nomeAutor = autor?.name ?? loggedUser.name;
        // Defesa em profundidade (achado real do Ramon, WhatsApp 2026-09-08,
        // mesmo espírito do comentário em handleOpenPayment acima): repetir a
        // checagem de jurisdição aqui garante que um bug futuro em QUALQUER
        // outro lugar que chame `setSelectedTable` sem passar pelo gate não
        // reabra esse buraco silenciosamente.
        if (!isTableInJurisdiction(loggedUser, selectedTable.id)) return;
        // Guarda síncrona contra duplo toque (antes do botão re-renderizar):
        // duas createOrder imprimiriam duas comandas e duplicariam o pedido.
        if (isAddingItemRef.current) return;
        isAddingItemRef.current = true;
        setEnviandoPedidoMesa(true);
        const linhas = mesaCarrinho;
        const mesa = selectedTable;

        try {
            // Uma chamada só: o servidor grava o pedido inteiro numa transação,
            // e a Estação de Impressão agrupa por pedido + destino.
            const result = await createOrder(mesa.id, storeId, linhas.map(l => ({
                product: l.product, quantity: l.qty, notes: l.notes, selectedOptions: l.selectedOptions,
            })), nomeAutor, 'garcom', nomeAutor);

            // Sem internet: o pedido ficou só na fila local (id "local_..."), então a
            // Estação de Impressão (que lê o servidor) não vai ver nada agora. Imprime
            // a comanda direto na impressora de rede do destino e deixa uma marca pra
            // não sair em dobro quando o pedido sincronizar.
            if (result.orderId && String(result.orderId).startsWith('local_')) {
                const menuCache: any = await getCachedMenu(storeId).catch(() => null);
                const setores = await fetchPrintSectors(storeId).catch(() => []);
                let impressas = 0;
                for (const l of linhas) {
                    const catDoProduto = (menuCache?.categories || []).find((c: any) => c.id === l.product.category_id);
                    const setorId: string | null = l.product.sector_id || (l.product.ignore_category_sector ? null : catDoProduto?.sector_id) || null;
                    const setor = setorId ? setores.find((x) => x.id === setorId) : undefined;
                    const destino: 'kitchen' | 'bar' = setor ? setor.base : (l.product.destination === 'bar' ? 'bar' : 'kitchen');
                    const notasNoBanco = l.notes ? `[${nomeAutor}] ${l.notes}` : `[${nomeAutor}]`;
                    const conteudo = buildKitchenTicketText({
                        kind: destino === 'bar' ? 'BAR' : 'COZINHA',
                        storeName: store.name,
                        orderType: 'MESA',
                        identifier: `MESA ${mesa.number}`,
                        client: nomeAutor,
                        quantity: l.qty,
                        productName: l.product.name,
                        addons: (l.selectedOptions || []).map((o: any) => o.name).join(', ') || undefined,
                        observation: l.notes || undefined,
                        orderIdShort: String(result.orderId).slice(6, 14),
                    });
                    const sig = `${mesa.number}|${l.product.id}|${l.qty}|${notasNoBanco}`;
                    impressas += await printOfflineOrderTicket({ storeId, destination: destino, sectorId: setor ? setorId : null, title: `${l.qty}x ${l.product.name} — Mesa ${mesa.number}`, content: conteudo, sig }).catch(() => 0);
                }
                if (impressas > 0) toast.info('Sem internet: pedido impresso direto na impressora.');
                else toast.warning('Sem internet: o pedido foi salvo, mas o papel do pedido não saiu na impressora. Ele sai quando a internet voltar.');
            }

            // Atualização otimista da comanda — sem isso, "Ver Comanda" e o
            // total do card da mesa continuam com o valor antigo até a próxima
            // sincronização real. `loadData`/Realtime substituem estes itens
            // sintéticos pelos reais (setActiveOrders troca o array inteiro).
            if (result.orderId) {
                const agora = new Date().toISOString();
                const itensOtimistas: OrderItem[] = linhas.map(l => ({
                    id: `local_item_${crypto.randomUUID()}`,
                    order_id: result.orderId!,
                    product_id: l.product.id,
                    product: l.product,
                    quantity: l.qty,
                    status: OrderStatus.PENDING,
                    notes: l.notes ? `[${nomeAutor}] ${l.notes}` : `[${nomeAutor}]`,
                    created_at: agora,
                    price_at_time: calculateCartItemUnitPrice({ product: l.product, selectedOptions: l.selectedOptions }),
                    selected_options: l.selectedOptions.map(o => ({ name: o.name, price_delta: o.price_delta })),
                    added_by_role: 'garcom',
                    added_by_name: nomeAutor,
                }));
                setActiveOrders(prev => {
                    const existing = prev.find(o => o.table_id === mesa.id && o.status === OrderStatus.PENDING);
                    if (existing) {
                        return prev.map(o => o.id === existing.id
                            ? { ...o, order_items: [...(o.order_items || []), ...itensOtimistas] }
                            : o);
                    }
                    const optimisticOrder: Order = {
                        id: result.orderId!,
                        table_id: mesa.id,
                        store_id: storeId,
                        status: OrderStatus.PENDING,
                        order_type: 'table',
                        total: 0,
                        created_at: agora,
                        order_items: itensOtimistas,
                    };
                    return [...prev, optimisticOrder];
                });
            }

            // Quem imprime é a Estação de Impressão do Caixa (o celular do garçom
            // não alcança a impressora da cozinha) — ver CaixaPrintStation.tsx.
            toast.success(mesaCarrinhoQtd === 1 ? 'Pedido enviado.' : `Pedido enviado (${mesaCarrinhoQtd} itens).`);
            setMesaCarrinho([]);
            setShowMenuMode(false);
        } catch (e: any) {
            // Nada foi gravado: o carrinho continua aí pra tentar de novo.
            toast.error(e?.message ? `O pedido não foi enviado: ${e.message}` : 'O pedido não foi enviado. Tente de novo.');
            console.error(e);
        } finally {
            isAddingItemRef.current = false;
            setEnviandoPedidoMesa(false);
        }
    };

    // Comanda de CANCELAMENTO (pedido do dono, 2026-09-29): cancelou um item que já foi
    // confirmado/enviado → sai um papel "CANCELAMENTO" na cozinha/bar do destino dele.
    // Itens do mesmo destino saem numa comanda só. Sem impressora cadastrada pro
    // destino, abre a janela de imprimir do aparelho de quem cancelou.
    const imprimirCancelamento = async (itens: OrderItem[], mesaNumero: number | string, motivo?: string) => {
        // Mesmo critério da Estação de Impressão: setor do produto, senão o da categoria (a pizza herda
        // "Pizzaria" da categoria). Sem isso o cancelamento da pizza saía na impressora da cozinha.
        // Os setores (Pizzaria etc.) só eram carregados com o painel "Pedidos do Dia" aberto; fora dele
        // a lista vinha vazia e o cancelamento da pizza caía no destino padrão (cozinha). Busca na hora
        // (04/10, achado do Ramon: "cancelamento de pizza tem que ir pra pizzaria, de acordo com o produto").
        const [setoresAgora, catSetorAgora] = await Promise.all([
            fetchPrintSectors(storeId).catch(() => locaisInfo.setores),
            fetchCategorySectors(storeId).catch(() => locaisInfo.catSetor),
        ]);
        const grupos = new Map<string, { destino: 'kitchen' | 'bar'; setorId: string | null; lista: OrderItem[] }>();
        itens.forEach((it) => {
            const setorId = setorDoItem(it.product, catSetorAgora);
            const setor = setorId ? setoresAgora.find((x) => x.id === setorId) : undefined;
            const destino: 'kitchen' | 'bar' = setor ? setor.base : (it.product?.destination === 'bar' ? 'bar' : 'kitchen');
            const chave = `${destino}|${setorId ?? ''}`;
            const g = grupos.get(chave) ?? { destino, setorId, lista: [] };
            g.lista.push(it);
            grupos.set(chave, g);
        });
        for (const { destino, setorId, lista } of grupos.values()) {
            const dados = {
                kind: (destino === 'bar' ? 'BAR' : 'COZINHA') as 'BAR' | 'COZINHA',
                storeName: store.name,
                orderType: 'MESA',
                identifier: `MESA ${mesaNumero}`,
                client: null,
                items: lista.map((it) => ({
                    quantity: it.quantity,
                    productName: it.product?.name || 'Produto indisponível',
                    addons: (it.selected_options || []).map((o) => o.name).join(', ') || undefined,
                    observation: parseItemNote(it.notes || '').observation || undefined,
                })),
                orderIdShort: String(lista[0].order_id).slice(0, 8),
                cancelamento: { por: loggedUser.name, motivo: motivo || null },
            };
            let enviadas = 0;
            try {
                enviadas = await enfileirarCancelamento({
                    storeId,
                    destination: destino,
                    sectorId: setorId,
                    title: `CANCELAMENTO — ${lista.length} ${lista.length === 1 ? 'item' : 'itens'} — Mesa ${mesaNumero}`,
                    content: (printer) => buildKitchenTicketText({ ...dados, paperWidthMm: printer.paper_width_mm, modoDireto: printer.print_mode === 'raw', titulo: printer.sector_id ? String(printer.name).toUpperCase() : undefined }),
                    dedupeKey: `cancel:${lista.map((i) => i.id).sort().join(',')}`,
                });
            } catch (e) {
                console.error('enfileirarCancelamento falhou:', e);
            }
            if (enviadas === 0) {
                const ok = await printKitchenTicket({ ...dados, interativo: true }).catch(() => false);
                if (!ok) toast.warning('O item foi cancelado, mas o pedido de cancelamento não imprimiu. Avise a cozinha.');
            }
        }
    };

    const abrirMoverItem = (itemId: string) => {
        if (isAberto) { avisarSoComLogin(); return; }
        if (!roleCan(loggedUser, store, 'mover_item')) { toast.error('Você não tem permissão para mover item.'); return; }
        const itemAlvo = selectedTable ? getTableSummary(selectedTable.id).allItems.find((i: any) => i.id === itemId) : undefined;
        setMoveItemDlg({ itemId, nome: itemAlvo ? `${itemAlvo.quantity}x ${getOrderItemDisplayName(itemAlvo)}` : 'este item', targetId: '', enviando: false });
    };

    const confirmarMoverItem = async () => {
        const dlg = moveItemDlg;
        if (!dlg || dlg.enviando) return;
        if (!dlg.targetId) { toast.error('Escolha a mesa de destino.'); return; }
        setMoveItemDlg({ ...dlg, enviando: true });
        const origemId = selectedTable?.id ?? null;
        const operadorId = loggedUser.id;
        const r = await transferItems(storeId, [dlg.itemId], dlg.targetId, operadorId, loggedUser.name);
        setMoveItemDlg(null);
        if (r.success) {
            loadData();
            toast.undo('Item movido para a outra mesa.', 'Desfazer', async () => {
                // O servidor só devolve se o item ainda está na mesa de destino (p_from_table_id).
                const volta = origemId ? await transferItems(storeId, [dlg.itemId], origemId, operadorId, loggedUser.name, dlg.targetId) : { success: false as const };
                if (volta.success) { toast.success('Item devolvido para a mesa de origem.'); loadData(); }
                else toast.info('Outra pessoa já mexeu neste item. Nada foi desfeito.');
            });
        }
        else toast.error(r.message || 'Não consegui mover o item.');
    };

    const handleDeleteItem = async (itemId: string) => {
        if (isAberto) { avisarSoComLogin(); return; }
        if (!podeTrocarOuExcluir(loggedUser, store)) { toast.error('Você não tem permissão para excluir item.'); return; }
        // Defesa em profundidade — mesmo motivo do handleAddItem acima.
        if (selectedTable && !isTableInJurisdiction(loggedUser, selectedTable.id)) return;
        const itemAlvo = selectedTable ? getTableSummary(selectedTable.id).allItems.find((i: any) => i.id === itemId) : undefined;
        const nomeItem = itemAlvo ? `${itemAlvo.quantity}x ${getOrderItemDisplayName(itemAlvo)}` : 'este item';
        // Motivo obrigatório (migration 150): abre o diálogo de motivo; o cancelamento sai em confirmarCancelamentoItem.
        setCancelItemDlg({ itemId, nome: nomeItem, motivo: '', outro: '', enviando: false });
    };

    const confirmarCancelamentoItem = async () => {
        const dlg = cancelItemDlg;
        if (!dlg || dlg.enviando) return;
        const motivoFinal = (dlg.motivo === 'Outro' ? dlg.outro.trim() : dlg.motivo).trim();
        if (!motivoFinal) { toast.error('Escolha o motivo do cancelamento.'); return; }
        setCancelItemDlg({ ...dlg, enviando: true });
        const itemAlvo = selectedTable ? getTableSummary(selectedTable.id).allItems.find((i: any) => i.id === dlg.itemId) : undefined;
        try {
            const ok = await cancelSpecificOrderItem(dlg.itemId, loggedUser.id, loggedUser.name, motivoFinal);
            if (!ok) { toast.error("Erro ao cancelar item."); setCancelItemDlg(null); return; }
            if (itemAlvo && selectedTable) await imprimirCancelamento([itemAlvo], selectedTable.number, motivoFinal);
            setCancelItemDlg(null);
        } catch (e) {
            toast.error("Erro ao cancelar item.");
            setCancelItemDlg(null);
        }
    };

    // Cancelar o PEDIDO inteiro da mesa (todos os itens ainda não pagos) — só gerente/dono/
    // universal/supervisor (decisão do dono do Sertão, 2026-09-29: "só gerente cancela").
    // Fica no nome de quem cancelou (auditoria) e sai a comanda de cancelamento. Item já
    // faturado em nota por pessoa não entra: precisa cancelar a nota antes.
    const podeCancelarPedido = roleCan(loggedUser, store, 'cancelar_pedido');
    const [showCancelarPedido, setShowCancelarPedido] = useState(false);
    const [cancelarMotivo, setCancelarMotivo] = useState('');
    const [cancelandoPedido, setCancelandoPedido] = useState(false);
    const handleCancelarPedidoMesa = async () => {
        if (isAberto) { avisarSoComLogin(); return; }
        if (!podeCancelarPedido) { toast.error('Você não tem permissão para cancelar o pedido.'); return; }
        if (!selectedTable || cancelandoPedido) return;
        if (!isTableInJurisdiction(loggedUser, selectedTable.id)) return;
        const itens = getTableSummary(selectedTable.id).allItems.filter((i) => i.status !== OrderStatus.CANCELED);
        if (itens.length === 0) { setShowCancelarPedido(false); return; }
        if (itens.some((i) => (i as any).fiscal_nota_id)) {
            toast.error('Este pedido tem item já faturado em nota fiscal. Cancele a nota antes (Administração → Notas fiscais).');
            return;
        }
        setCancelandoPedido(true);
        try {
            const operador = loggedUser.id;
            const cancelados: OrderItem[] = [];
            for (const it of itens) {
                // eslint-disable-next-line no-await-in-loop -- um por vez: ordem e falha parcial ficam claras
                if (await cancelSpecificOrderItem(it.id, operador, loggedUser.name, cancelarMotivo.trim() || 'Pedido cancelado pelo gerente', 'cancelar_pedido')) cancelados.push(it);
            }
            if (cancelados.length > 0) await imprimirCancelamento(cancelados, selectedTable.number, cancelarMotivo.trim() || undefined);
            if (cancelados.length === itens.length) toast.success('Pedido cancelado.');
            else toast.warning(`Cancelei ${cancelados.length} de ${itens.length} itens. Tente de novo para os restantes.`);
            setShowCancelarPedido(false);
            setCancelarMotivo('');
            loadData();
        } finally {
            setCancelandoPedido(false);
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
                                        <span className="text-[12px] font-medium px-2 py-0.5 rounded-full bg-[var(--warn)]/10 text-[var(--warn)]">Pendente</span>
                                    ) : (
                                        <span className="text-[12px] font-medium px-2 py-0.5 rounded-full bg-[var(--ok)]/10 text-[var(--ok)]">Confirmada</span>
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

            <div className="flex flex-wrap justify-end max-sm:justify-start mb-5 gap-2">
                {canManagePin && (
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={handlePinBlockToggle}
                        className="max-sm:h-11"
                        title="Se ativado, novos clientes precisarão do PIN para abrir a mesa"
                    >
                        {pinBlockEnabled
                            ? <span className="w-2 h-2 rounded-full bg-[var(--err-fill)] shrink-0" aria-hidden />
                            : <Unlock size={15} className="text-[var(--text-muted)]" />}
                        {pinBlockEnabled ? "Bloqueio PIN ativo" : "Bloqueio PIN inativo"}
                    </Button>
                )}

                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setAreCardsCollapsed(!areCardsCollapsed)}
                    className="max-sm:h-11"
                >
                    {areCardsCollapsed ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    {areCardsCollapsed ? "Expandir cards" : "Colapsar cards"}
                </Button>

                {/* Task 2 (2026-08-22) — só aparece em direct_print: é o
                    substituto do KDS pra esta loja, "acessível para garçom
                    e caixa". Nas 6 lojas com KDS, orderFlow é sempre 'kds'
                    e este botão nunca renderiza. */}
                {orderFlow === 'direct_print' && (
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setShowSentHistory(true)}
                        className="max-sm:h-11"
                    >
                        <FileText size={16} />
                        Pedidos do Dia
                    </Button>
                )}
            </div>

            {(() => {
                // Redesign estilo Apple (2026-09-26): mesas ocupadas (ou chamando
                // garçom) em cartões completos; livres/bloqueadas em blocos
                // compactos numa grade à parte — antes cada mesa livre ocupava o
                // mesmo espaço de uma ocupada, virando uma grade infinita.
                const isFullCard = (t: Table) =>
                    t.status === 'occupied' || t.status === 'waiting_bill' || !!t.waiter_requested;
                const fullTables = tables.filter(isFullCard);
                const compactTables = tables.filter(t => !isFullCard(t));

                const renderPinChip = (table: Table, inJurisdiction: boolean) => {
                    const revealed = visiblePins.has(table.id);
                    return (
                        <div className={`flex items-center gap-1 h-6 px-2 rounded-full bg-[var(--surface-2)] shrink-0 ${revealed ? '' : 'pin-peek'}`}>
                            <span className={`text-[12px] text-[var(--text-muted)] ${revealed ? 'font-mono font-semibold text-[var(--text)]' : 'tracking-[0.1em]'}`}>
                                {revealed ? table.pin : '••••'}
                            </span>
                            <button
                                onClick={(e) => togglePin(e, table.id, inJurisdiction)}
                                disabled={!inJurisdiction}
                                className="relative hit-44 text-[var(--text-muted)] hover:text-[var(--brand)] u-motion u-press disabled:pointer-events-none"
                                title={revealed ? "Ocultar PIN" : "Ver PIN"}
                                aria-label={revealed ? `Ocultar PIN da mesa ${table.number}` : `Ver PIN da mesa ${table.number}`}
                            >
                                {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
                            </button>
                        </div>
                    );
                };

                const renderBlockButton = (table: Table, isBlocked: boolean, hasOrders: boolean, inJurisdiction: boolean) => canManagePin && (
                    <button
                        onClick={(e) => {
                            if(!isBlocked && hasOrders) return;
                            handleBlockToggle(e, table, inJurisdiction);
                        }}
                        disabled={(!isBlocked && hasOrders) || !inJurisdiction}
                        className={`relative hit-44 p-1.5 rounded-full u-motion u-press z-10 shrink-0 disabled:pointer-events-none ${
                            isBlocked ? 'text-[var(--err)] bg-[var(--err)]/10 hover:bg-[var(--err)]/15' :
                            (!isBlocked && hasOrders) ? 'text-[var(--text-muted)] cursor-not-allowed opacity-30' :
                            'text-[var(--text-muted)]/60 hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
                        }`}
                        title={isBlocked ? "Desbloquear" : hasOrders ? "Mesa com pedidos não pode ser bloqueada" : "Bloquear Mesa"}
                    >
                        {isBlocked ? <Lock size={14} /> : <Unlock size={14} />}
                    </button>
                );

                const renderTable = (table: Table, tableIdx: number) => {
                    const summary = getTableSummary(table.id);
                    const isBlocked = table.status === 'blocked';
                    const isOccupied = table.status === 'occupied' || table.status === 'waiting_bill';
                    const isWaiterRequested = table.waiter_requested;
                    const hasOrders = summary.count > 0;
                    // Jurisdicao de mesas por garcom (Task 3, migration 049).
                    // Mesa fora da jurisdicao continua renderizada normalmente
                    // (numero/status/PIN) mas inteiramente nao-interativa —
                    // `pointer-events-none` bloqueia tanto abrir o card quanto
                    // os botoes internos numa unica trava. owner/universal
                    // nunca sao restringidos (ver isTableInJurisdiction).
                    const inJurisdiction = isTableInJurisdiction(loggedUser, table.id);

                    // allItems vem ordenado do mais novo pro mais antigo
                    // (getTableSummary acima) — [0] é o último pedido, o
                    // último elemento é o mais antigo (aproximação de
                    // "ocupada desde", ver tableAlertOccupiedMin).
                    const minutesSinceLastOrder = isOccupied && summary.allItems.length > 0
                        ? Math.floor((nowTick - new Date(summary.allItems[0].created_at).getTime()) / 60000) : null;
                    const minutesOccupied = isOccupied && summary.allItems.length > 0
                        ? Math.floor((nowTick - new Date(summary.allItems[summary.allItems.length - 1].created_at).getTime()) / 60000) : null;
                    const isOccupiedTooLong = tableAlertOccupiedMin > 0 && minutesOccupied !== null && minutesOccupied >= tableAlertOccupiedMin;
                    const isNoOrderTooLong = tableAlertNoOrderMin > 0 && minutesSinceLastOrder !== null && minutesSinceLastOrder >= tableAlertNoOrderMin;
                    const hasTimeAlert = isOccupiedTooLong || isNoOrderTooLong;
                    // "Crítico" quando o atraso é o DOBRO do limiar configurado.
                    const isOccupiedCritical = tableAlertOccupiedMin > 0 && minutesOccupied !== null && minutesOccupied >= tableAlertOccupiedMin * 2;

                    // Status = ponto colorido + texto (nada de bloco colorido).
                    const dotColor =
                        isBlocked ? 'var(--text-muted)' :
                        isWaiterRequested ? 'var(--err)' :
                        table.status === 'waiting_bill' ? 'var(--warn)' :
                        isOccupiedCritical ? 'var(--err)' :
                        hasTimeAlert ? 'var(--warn)' :
                        isOccupied ? 'var(--brand)' : 'var(--ok)';
                    const statusLabel = getTableStatusLabel(isBlocked ? 'blocked' : isOccupied ? table.status : 'available');
                    const open = () => { if(!isBlocked && inJurisdiction) { setSelectedTable(table); setShowFullBill(false); setShowMenuMode(false); } };

                    const statusKey = isBlocked ? 'blocked' : isWaiterRequested ? 'waiter' : isOccupied ? String(table.status) : 'available';

                    if (!isFullCard(table)) {
                        return (
                            <TableMotionCard key={table.id} tableId={table.id} statusKey={statusKey} dotColor={dotColor} memo={tableVisualMemo}>
                            <Card
                                hoverable={inJurisdiction && !isBlocked}
                                onClick={open}
                                className={`group flex flex-col justify-between gap-1.5 px-3.5 py-3 min-h-[72px] ${
                                    isBlocked ? '!bg-[var(--surface-2)] opacity-80' : ''
                                } ${!inJurisdiction ? 'opacity-50 pointer-events-none grayscale' : ''}`}
                                style={stagger(Math.min(tableIdx, 10) * 20)}
                            >
                                <div className="flex items-center justify-between gap-2 min-w-0">
                                    <span className="text-[15px] font-semibold text-[var(--text)] truncate">Mesa {table.number}</span>
                                    {renderBlockButton(table, isBlocked, hasOrders, inJurisdiction)}
                                </div>
                                <div className="flex items-center justify-between gap-2 min-w-0">
                                    <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] min-w-0">
                                        <TableStatusDot tableId={table.id} color={dotColor} memo={tableVisualMemo} />
                                        <span className="truncate">{!inJurisdiction ? TABLE_OUT_OF_JURISDICTION_LABEL : statusLabel}</span>
                                    </span>
                                    {!isBlocked && renderPinChip(table, inJurisdiction)}
                                </div>
                            </Card>
                            </TableMotionCard>
                        );
                    }

                    return (
                        <TableMotionCard key={table.id} tableId={table.id} statusKey={statusKey} dotColor={dotColor} memo={tableVisualMemo}>
                        <Card
                            hoverable={inJurisdiction}
                            onClick={open}
                            className={`group flex flex-col p-4 max-sm:p-3.5 ${
                                isWaiterRequested ? 'ring-2 ring-[var(--err)]/60' : ''
                            } ${!inJurisdiction ? 'opacity-50 pointer-events-none grayscale' : ''}`}
                            style={stagger(Math.min(tableIdx, 10) * 30)}
                        >
                            {/* Cabeçalho: número + status (ponto), PIN discreto e bloqueio à direita. */}
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="text-[17px] font-semibold text-[var(--text)] shrink-0">Mesa {table.number}</span>
                                <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] min-w-0">
                                    <TableStatusDot tableId={table.id} color={dotColor} memo={tableVisualMemo} pulse={isWaiterRequested} />
                                    <span className="truncate">{isWaiterRequested ? 'Chamando garçom' : statusLabel}</span>
                                </span>
                                <div className="ml-auto flex items-center gap-1 shrink-0">
                                    {renderPinChip(table, inJurisdiction)}
                                    {renderBlockButton(table, isBlocked, hasOrders, inJurisdiction)}
                                </div>
                            </div>

                            {!inJurisdiction && (
                                <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{TABLE_OUT_OF_JURISDICTION_LABEL}</p>
                            )}

                            {/* Cliente embaixo do cabeçalho (pedido do dono, 2026-08-29). */}
                            {isOccupied && (
                                <div className="flex items-center gap-1 text-[13px] text-[var(--text-muted)] mt-0.5 min-w-0">
                                    <span className="truncate">{table.current_host_name || 'Lojista'}</span>
                                    {watchedTables.has(table.id) && (
                                        <span title="Cliente acompanhando o pedido agora" className="shrink-0 text-[var(--info)] flex items-center">
                                            <Eye size={12} />
                                        </span>
                                    )}
                                </div>
                            )}

                            {isOccupied && (
                                <p className="text-[22px] font-semibold num text-[var(--text)] mt-2 leading-none">R$ <AnimatedNumber value={summary.total} format={formatBRL} /></p>
                            )}

                            {/* Avisos de tempo (pedido do dono, 2026-08-29) — nos dois modos. */}
                            {hasTimeAlert && (
                                <div className={`flex items-center gap-1 text-[12px] font-medium mt-2 ${isOccupiedCritical ? 'text-[var(--err)]' : 'text-[var(--warn)]'}`}>
                                    <Clock size={12} />
                                    {[
                                        isOccupiedTooLong ? `Ocupada há ${formatDuration(minutesOccupied ?? 0)}` : null,
                                        isNoOrderTooLong ? `Sem pedido há ${formatDuration(minutesSinceLastOrder ?? 0)}` : null,
                                    ].filter(Boolean).join(' · ')}
                                </div>
                            )}

                            {/* Itens (desligável pelo toggle "Colapsar cards"). */}
                            {!areCardsCollapsed && isOccupied && (
                                <div className="mt-3 pt-2.5 border-t border-[var(--border)] flex flex-col gap-1.5">
                                    {summary.items.length > 0 ? (
                                        summary.items.map((item, idx) => (
                                            <div key={idx} className="flex justify-between items-center gap-1.5 text-[13px] text-[var(--text)] transition-colors duration-300">
                                                <span className="truncate min-w-0 flex-1">
                                                    <span className="text-[var(--text-muted)] num">{item.quantity}×</span> {getOrderItemDisplayName(item)}
                                                </span>
                                                {orderFlow !== 'direct_print' && item.status === 'delivered' && <CheckCircle size={13} className="text-[var(--ok)] flex-shrink-0" />}
                                                {orderFlow !== 'direct_print' && item.status === 'preparing' && <ChefHat size={13} className="text-[var(--info)] flex-shrink-0" />}
                                                {orderFlow !== 'direct_print' && (item.status === 'pending' || item.status === 'accepted') && <Clock size={13} className="text-[var(--warn)] flex-shrink-0" />}
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-[13px] text-[var(--text-muted)]">Sem pedidos</p>
                                    )}
                                    <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
                                        {summary.count > 3
                                            ? `+ ${summary.count - 3} ${summary.count - 3 === 1 ? 'item' : 'itens'} · ${summary.count} no total`
                                            : `${summary.count} ${summary.count === 1 ? 'item' : 'itens'} no total`}
                                    </p>
                                </div>
                            )}

                            {isWaiterRequested && (
                                <Button
                                    onClick={(e) => { e.stopPropagation(); if (!inJurisdiction) return; handleDismissWaiter(table.id); }}
                                    disabled={!inJurisdiction}
                                    variant="danger"
                                    size="sm"
                                    className="w-full mt-3 max-sm:h-11"
                                >
                                    <BellRing size={14} /> Atender garçom
                                </Button>
                            )}
                        </Card>
                        </TableMotionCard>
                    );
                };

                const infoDaMesa = (table: Table) => {
                    const blocked = table.status === 'blocked';
                    const occ = table.status === 'occupied' || table.status === 'waiting_bill';
                    const dotColor =
                        blocked ? 'var(--text-muted)' :
                        table.waiter_requested ? 'var(--err)' :
                        table.status === 'waiting_bill' ? 'var(--warn)' :
                        occ ? 'var(--brand)' : 'var(--ok)';
                    // Tempo de ocupação = idade do item mais antigo da mesa (mesma aproximação dos cartões da lista).
                    const itens = occ ? getTableSummary(table.id).allItems : [];
                    const minutes = itens.length > 0 ? Math.floor((nowTick - new Date(itens[itens.length - 1].created_at).getTime()) / 60000) : null;
                    const alerta: 'warn' | 'err' | null =
                        minutes === null || tableAlertOccupiedMin <= 0 ? null :
                        minutes >= tableAlertOccupiedMin * 2 ? 'err' :
                        minutes >= tableAlertOccupiedMin ? 'warn' : null;
                    return {
                        dotColor,
                        statusLabel: getTableStatusLabel(blocked ? 'blocked' : occ ? table.status : 'available'),
                        inJurisdiction: isTableInJurisdiction(loggedUser, table.id),
                        blocked,
                        minutes,
                        alerta,
                    };
                };
                const podeEditarPlanta = roleCan(loggedUser, store, 'editar_planta');
                const moverVariasNaPlanta = async (itens: PosicaoMesa[]): Promise<boolean> => {
                    const porId = new Map(itens.map(i => [i.id, i]));
                    setTables(prev => prev.map(t => {
                        const i = porId.get(t.id);
                        if (!i) return t;
                        return { ...t, ...(i.x !== undefined ? { floor_x: i.x, floor_y: i.y ?? null } : {}), ...(i.area !== undefined ? { area: i.area } : {}) };
                    })); // otimista
                    const ok = await updateTablesPositions(storeId, itens);
                    if (!ok) { toast.error('Não consegui salvar a planta. Tente de novo.'); loadData(); }
                    return ok;
                };

                return (
                    <>
                        <div className="flex items-center gap-1 mb-4 p-1 rounded-full bg-[var(--surface-2)] w-fit" role="tablist" aria-label="Modo de exibição das mesas">
                            {(['lista', 'mapa'] as const).map((m) => (
                                <button
                                    key={m}
                                    role="tab"
                                    aria-selected={tablesViewMode === m}
                                    onClick={() => mudarTablesViewMode(m)}
                                    className={`h-8 max-sm:h-11 px-4 rounded-full text-[13px] font-semibold u-press ${tablesViewMode === m ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-muted)]'}`}
                                >
                                    {m === 'lista' ? 'Lista' : 'Mapa'}
                                </button>
                            ))}
                        </div>
                        {tablesViewMode === 'mapa' ? (
                            <FloorPlanView
                                tables={tables}
                                info={infoDaMesa}
                                onOpen={(t) => { setSelectedTable(t); setShowFullBill(false); setShowMenuMode(false); }}
                                canEdit={podeEditarPlanta}
                                onMoveMany={moverVariasNaPlanta}
                            />
                        ) : (<>
                        {fullTables.length > 0 && (
                            <>
                                <h3 className="eyebrow mb-2.5">Ocupadas ({fullTables.length})</h3>
                                {/* items-start (pedido do dono, 2026-08-29): cada card só ocupa a
                                    altura do próprio conteúdo, sem esticar pela vizinha mais alta. */}
                                <div className="relative grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-sm:gap-3 items-start mb-7">
                                    <AnimatePresence mode="popLayout">
                                        {fullTables.map((t, i) => renderTable(t, i))}
                                    </AnimatePresence>
                                </div>
                            </>
                        )}
                        {compactTables.length > 0 && (
                            <>
                                <h3 className="eyebrow mb-2.5">Livres ({compactTables.filter(t => t.status !== 'blocked').length})</h3>
                                <div className="relative grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 max-sm:gap-2.5 items-start">
                                    <AnimatePresence mode="popLayout">
                                        {compactTables.map((t, i) => renderTable(t, i))}
                                    </AnimatePresence>
                                </div>
                            </>
                        )}
                        </>)}
                    </>
                );
            })()}

            {/* Janelas de Mover/Cancelar item abrem POR CIMA da janela da Mesa (mesmo z-50, ordem do DOM as deixava por baixo): o wrapper cria um contexto de empilhamento mais alto. */}
            <div className="relative z-[60]">
            <Modal isOpen={!!moveItemDlg} onClose={() => !moveItemDlg?.enviando && setMoveItemDlg(null)} title="Mover item para outra mesa" size="sm">
                {moveItemDlg && (
                    <div className="space-y-4">
                        <p className="text-sm text-[var(--text)]">Mover <b>{moveItemDlg.nome}</b> da Mesa {selectedTable?.number} para:</p>
                        <select
                            className="w-full h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[15px] text-[var(--text)]"
                            value={moveItemDlg.targetId}
                            onChange={(e) => setMoveItemDlg({ ...moveItemDlg, targetId: e.target.value })}
                            aria-label="Mesa de destino"
                        >
                            <option value="">Escolha a mesa…</option>
                            {tables.filter((t) => t.id !== selectedTable?.id && t.status !== 'blocked').map((t) => (
                                <option key={t.id} value={t.id}>Mesa {t.number}{t.status === 'available' ? ' (livre)' : ''}</option>
                            ))}
                        </select>
                        <p className="text-[12px] text-[var(--text-muted)]">O item não é impresso de novo na cozinha. Fica registrado quem moveu.</p>
                        <div className="grid grid-cols-2 gap-2">
                            <Button variant="secondary" onClick={() => setMoveItemDlg(null)} disabled={moveItemDlg.enviando}>Voltar</Button>
                            <Button onClick={confirmarMoverItem} isLoading={moveItemDlg.enviando}>Mover item</Button>
                        </div>
                    </div>
                )}
            </Modal>

            <Modal isOpen={!!cancelItemDlg} onClose={() => !cancelItemDlg?.enviando && setCancelItemDlg(null)} title="Cancelar item" size="sm">
                {cancelItemDlg && (
                    <div className="space-y-4">
                        <p className="text-sm text-[var(--text)]">Cancelar <b>{cancelItemDlg.nome}</b> da comanda? Escolha o motivo:</p>
                        <div className="space-y-2" role="radiogroup" aria-label="Motivo do cancelamento">
                            {resolveCancelReasons(store.config as any).map((r) => (
                                <label key={r} className={`flex items-center gap-2 min-h-11 px-3 rounded-xl border cursor-pointer text-[15px] ${cancelItemDlg.motivo === r ? 'border-[var(--brand)] bg-[var(--surface-2)]' : 'border-[var(--border)]'}`}>
                                    <input type="radio" name="motivo-cancelamento" checked={cancelItemDlg.motivo === r} onChange={() => setCancelItemDlg({ ...cancelItemDlg, motivo: r })} />
                                    {r}
                                </label>
                            ))}
                        </div>
                        {cancelItemDlg.motivo === 'Outro' && (
                            <Input placeholder="Descreva o motivo" value={cancelItemDlg.outro} onChange={(e) => setCancelItemDlg({ ...cancelItemDlg, outro: e.target.value })} maxLength={120} />
                        )}
                        <div className="grid grid-cols-2 gap-2">
                            <Button variant="secondary" onClick={() => setCancelItemDlg(null)} disabled={cancelItemDlg.enviando}>Voltar</Button>
                            <Button variant="danger" onClick={confirmarCancelamentoItem} isLoading={cancelItemDlg.enviando}>Cancelar item</Button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* MODAL DA MESA */}
            </div>

            {/* 2026-09-22: "Adicionar Pedido" (showMenuMode) saiu deste modal
                pequeno pra virar tela cheia própria (ver bloco logo abaixo do
                fechamento deste Modal) — pedido explícito do dono: cardápio
                do garçom tem que ocupar a tela toda, não uma caixa central.
                Este modal continua isOpen só pras Views 1/2 (ações rápidas e
                comanda completa). */}
            <Modal isOpen={!!selectedTable && !showMenuMode} onClose={() => setSelectedTable(null)} title={`Mesa ${selectedTable?.number ?? ''}`} size="lg">
                <div className="space-y-4">
                    {/* Subtítulo: cliente + status (ponto), no lugar da antiga caixa "Status Atual". */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 -mt-1 text-[15px] text-[var(--text-muted)]">
                        {selectedTable?.status !== 'available' && (
                            <span className="font-medium text-[var(--text)] truncate">{selectedTable?.current_host_name || 'Lojista'}</span>
                        )}
                        <span className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ background: selectedTable?.status === 'available' ? 'var(--ok)' : selectedTable?.status === 'waiting_bill' ? 'var(--warn)' : 'var(--brand)' }} aria-hidden />
                            {getTableStatusLabel(selectedTable?.status || 'occupied')}
                        </span>
                        {selectedTable?.waiter_requested && (
                            <span className="inline-flex items-center gap-1.5 text-[var(--err)] font-medium">
                                <BellRing size={14}/> Chamando garçom
                            </span>
                        )}
                    </div>

                    {!showFullBill ? (
                        <>
                             {/* VIEW 1: AÇÕES RÁPIDAS */}
                             {selectedTable?.waiter_requested && (
                                 <Button
                                    onClick={() => selectedTable && handleDismissWaiter(selectedTable.id)}
                                    variant="danger"
                                    size="lg"
                                    className="w-full"
                                 >
                                     <BellRing size={18}/> Confirmar atendimento
                                 </Button>
                             )}
                             
                             {selectedTable?.status !== 'available' && (
                                 <div className="space-y-3 animate-fade-in">
                                     {(() => {
                                         // Pedidos à vista ao tocar na mesa (plano mesa-cardapio-permissoes, Task 1).
                                         const resumoMesa = selectedTable ? getTableSummary(selectedTable.id) : null;
                                         const { linhas } = resumirPedidosDaMesa(resumoMesa?.todosItens ?? []);
                                         return (
                                             <div className="bg-[var(--surface-2)] rounded-[14px] overflow-hidden" aria-label="Pedidos da mesa">
                                                 <p className="eyebrow px-4 pt-3 pb-1">Pedidos da mesa</p>
                                                 {linhas.length === 0 ? (
                                                     <p className="px-4 pb-4 pt-1 text-[14px] text-[var(--text-muted)]">Nenhum pedido ainda. Toque em Adicionar Pedido.</p>
                                                 ) : (
                                                     <>
                                                         <ul className="max-h-[40vh] overflow-y-auto">
                                                             {linhas.filter(l => !l.taxa).map(l => (
                                                                 <li key={l.id} className={`flex justify-between items-baseline gap-3 px-4 py-2 border-b border-[var(--border)] last:border-b-0 text-[15px] ${l.status === 'canceled' ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>
                                                                     <span className="flex-1 min-w-0">
                                                                         <span className="text-[var(--text-muted)] num">{l.qtd}× </span>
                                                                         <span className="font-medium">{l.nome}</span>
                                                                         {l.status === 'canceled' ? <span className="ml-2 inline-block whitespace-nowrap text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--err)]/12 text-[var(--err)] no-underline">Cancelado</span> : null}
                                                                         {l.quem ? <span className="ml-2 inline-block whitespace-nowrap text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--surface)] text-[var(--text-muted)] no-underline">{l.quem}</span> : null}
                                                                     </span>
                                                                     <span className="num shrink-0">R$ {formatBRL(l.valor)}</span>
                                                                 </li>
                                                             ))}
                                                         </ul>
                                                         {linhas.filter(l => l.taxa).map(l => (
                                                             <div key={l.id} className="flex justify-between items-baseline gap-3 px-4 py-2 border-t border-[var(--border)] text-[14px] text-[var(--text-muted)]">
                                                                 <span className="flex-1 min-w-0">{l.nome}</span>
                                                                 <span className="num shrink-0">R$ {formatBRL(l.valor)}</span>
                                                             </div>
                                                         ))}
                                                         {resumoMesa && resumoMesa.serviceFee > 0 && (
                                                             <div className="flex justify-between items-baseline gap-3 px-4 py-2 border-t border-[var(--border)] text-[14px] text-[var(--text-muted)]">
                                                                 <span>Taxa de Serviço ({formatServiceFeeRate(serviceFeeRate)})</span>
                                                                 <span className="num shrink-0">R$ {formatBRL(resumoMesa.serviceFee)}</span>
                                                             </div>
                                                         )}
                                                         <div className="flex justify-between items-baseline px-4 py-3 border-t border-[var(--border)] font-semibold text-[16px] text-[var(--text)]">
                                                             <span>Total</span>
                                                             <span className="num">R$ {formatBRL(resumoMesa?.total ?? 0)}</span>
                                                         </div>
                                                     </>
                                                 )}
                                             </div>
                                         );
                                     })()}
                                     <div className="grid grid-cols-2 gap-3">
                                         <Button
                                            size="lg"
                                            className="!h-14 !rounded-[16px] text-[16px] max-sm:text-[15px] max-sm:px-3"
                                            onClick={() => setShowMenuMode(true)}
                                         >
                                             <Plus size={20} className="shrink-0 max-sm:hidden" />
                                             Adicionar Pedido
                                         </Button>
                                         <Button
                                            variant="secondary"
                                            size="lg"
                                            className="!h-14 !rounded-[16px] text-[16px] max-sm:text-[15px] max-sm:px-3 min-w-0"
                                            onClick={() => setShowFullBill(true)}
                                         >
                                             <Receipt size={20} className="shrink-0 max-sm:hidden" />
                                             <span className="truncate">Ver Comanda</span>
                                             <span className="font-normal text-[var(--text-muted)] num max-sm:hidden">
                                                 · R$ {selectedTable ? formatBRL(getTableSummary(selectedTable.id).total) : '0,00'}
                                             </span>
                                         </Button>
                                     </div>

                                     <div className="pt-1">
                                         {/* Módulo Caixa (Task 4): quem pode finalizar (dono, universal, ou
                                             usuário com a permissão 'caixa') continua vendo exatamente o
                                             botão de sempre. Quem não pode vê "Pedir Conta" — a mesma ação
                                             que o cliente já tem no cardápio (requestTableBill), só que
                                             disparada pelo garçom. */}
                                         {canFinalize ? (
                                             <Button onClick={() => handleOpenPayment()} size="lg" className="w-full !h-12">
                                                <Wallet size={18}/> Receber e finalizar
                                             </Button>
                                         ) : selectedTable?.status === 'waiting_bill' ? (
                                             <div className="w-full flex items-center justify-center gap-2 text-[15px] font-medium text-[var(--text)] bg-[var(--surface-2)] rounded-full h-12">
                                                 <span className="w-2 h-2 rounded-full bg-[var(--warn-fill)]" aria-hidden />
                                                 Conta pedida — aguardando o caixa
                                             </div>
                                         ) : isAberto ? (
                                             <div className="w-full flex items-center justify-center gap-2 text-[14px] text-[var(--text-muted)] bg-[var(--surface-2)] rounded-full h-12">
                                                 <Lock size={15} aria-hidden /> Conta e pagamento: só com login
                                             </div>
                                         ) : (
                                             <Button onClick={() => selectedTable && handleRequestBill(selectedTable.id)} size="lg" className="w-full !h-12">
                                                <Receipt size={18}/> Pedir conta
                                             </Button>
                                         )}
                                         {canFinalize && selectedTable?.status === 'waiting_bill' && (
                                <button
                                    type="button"
                                    onClick={() => handleCancelBillRequest(selectedTable.id)}
                                    className="mt-2 w-full h-10 rounded-[var(--r-md)] text-[14px] text-[var(--text-muted)] hover:bg-[var(--surface-2)] u-motion"
                                >
                                    Cancelar pedido de conta (foi sem querer)
                                </button>
                            )}
                                         {canReassignJurisdiction && (
                                             <button
                                                type="button"
                                                onClick={handleOpenReassign}
                                                className="mt-3 w-full flex items-center gap-3 px-4 h-12 rounded-[var(--r-md)] bg-[var(--surface-2)] text-[15px] text-[var(--text)] hover:bg-[var(--border)] u-motion"
                                             >
                                                <Users size={17} className="text-[var(--text-muted)]"/>
                                                <span className="flex-1 text-left">Trocar responsável</span>
                                                <ChevronRight size={17} className="text-[var(--text-muted)]"/>
                                             </button>
                                         )}
                                     </div>
                                 </div>
                             )}
                             {selectedTable?.status === 'available' && (
                                <>
                                <Input
                                    label="Nome do cliente (opcional)"
                                    placeholder="Ex.: Família Silva"
                                    maxLength={40}
                                    value={hostNameInput}
                                    onChange={e => setHostNameInput(e.target.value)}
                                />
                                <Button size="lg" className="w-full !h-14 !rounded-[16px] text-[17px]" onClick={async () => {
                                    if(selectedTable) {
                                        const hostName = hostNameInput.trim() || loggedUser.name;
                                        const previousTable = selectedTable;

                                        // 1. UPDATE LOCAL STATE IMMEDIATELY (Visual Feedback) — atualiza o
                                        // modal E o card na grade (`tables`), senão só o modal muda e o
                                        // card por trás continua mostrando "Disponível" até sincronizar de
                                        // verdade (achado real, WhatsApp 2026-09-09: offline, parecia que o
                                        // clique não tinha feito nada).
                                        const optimisticTable = { ...selectedTable, status: TableStatus.OCCUPIED, current_host_name: hostName };
                                        setSelectedTable(optimisticTable);
                                        setTables(prev => prev.map(t => t.id === optimisticTable.id ? optimisticTable : t));

                                        try {
                                            // 2. CALL API (grava a sessão de ocupação também, senão mesas abertas
                                            // pelo lojista nunca entram na métrica de tempo médio)
                                            const { queued } = await openTableManually(selectedTable.id, store.id, hostName);

                                            // 3. REFRESH DATA — só quando a mesa abriu de verdade no servidor
                                            // agora (`!queued`). Se caiu na fila offline, `loadData()` cairia no
                                            // cache local (desatualizado) e SOBRESCREVERIA o update otimista
                                            // acima com o estado antigo — o mesmo achado do WhatsApp: a mesa
                                            // fica com o pedido enfileirado corretamente (confirmado no
                                            // IndexedDB), mas a tela volta a mostrar "Disponível", como se nada
                                            // tivesse acontecido. Usar `queued` (não `navigator.onLine`) evita a
                                            // mesma falha numa rede "falsamente online" (wifi conectado sem
                                            // internet de verdade — ver `lib/offline/network.ts`), já que
                                            // `openTableManually` só marca `queued=true` depois de uma falha de
                                            // rede REAL na própria chamada, nunca por adivinhação. O Realtime
                                            // (`table_change_pings`) já atualiza sozinho assim que o dado real
                                            // mudar — na hora, se online; depois da sincronização, se ficou na
                                            // fila — então este refresh manual é só atalho pro caso online,
                                            // nunca necessário pro caso enfileirado.
                                            if (!queued) loadData();
                                        } catch (e) {
                                            // Reverte o update otimista em caso de falha
                                            setSelectedTable(previousTable);
                                            setTables(prev => prev.map(t => t.id === previousTable.id ? previousTable : t));
                                            toast.error("Erro ao abrir mesa. Tente novamente.");
                                        }
                                    }
                                }}>
                                    Abrir Mesa Manualmente
                                </Button>
                                </>
                            )}
                        </>
                    ) : (
                        <div className="animate-slide-up">
                            {/* VIEW 2: COMANDA COMPLETA */}
                            <h4 className="eyebrow mb-1.5 px-1">Comanda</h4>
                            <div className="bg-[var(--surface-2)] rounded-[14px] overflow-hidden mb-4">
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
                                                    const clientNote = parseItemNote(item.notes || '');
                                                    return (
                                                    <div key={item.id} className="flex justify-between items-center gap-3 px-4 py-3 border-b border-[var(--border)] last:border-b-0 text-[15px]">
                                                        <div className="flex-1 min-w-0">
                                                            <span className="text-[var(--text)] flex flex-wrap items-center gap-x-2 gap-y-1">
                                                                <span className="text-[var(--text-muted)] num">{item.quantity}×</span>
                                                                <span className="font-medium">{getOrderItemDisplayName(item)}</span>
                                                                {item.added_by_role === 'garcom' ? (
                                                                    <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--surface)] text-[var(--text-muted)]">
                                                                        {item.added_by_name || 'Garçom'}
                                                                    </span>
                                                                ) : clientNote?.client ? (
                                                                    <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
                                                                        {clientNote.client}
                                                                    </span>
                                                                ) : null}
                                                            </span>
                                                            <div className="text-[13px] text-[var(--text-muted)] flex flex-wrap items-center gap-x-2 mt-0.5">
                                                                {orderFlow !== 'direct_print' && (
                                                                    item.status === 'delivered' ? <span className="text-[var(--ok)] flex items-center gap-1"><CheckCircle size={10}/> Entregue</span> :
                                                                    item.status === 'preparing' ? <span className="text-[var(--info)] flex items-center gap-1"><ChefHat size={10}/> Preparando</span> :
                                                                    item.status === 'ready' ? <span className="text-[var(--ok)] flex items-center gap-1"><CheckCircle size={10}/> Pronto</span> :
                                                                    <span className="text-[var(--warn)] flex items-center gap-1"><Clock size={10}/> Aguardando</span>
                                                                )}
                                                                <span>{orderFlow !== 'direct_print' && '• '}R$ {formatBRL(item.price_at_time)} un.</span>
                                                                <HoraDoPedido criadoEm={item.created_at} />
                                                                {clientNote?.observation && <span>• {clientNote.observation}</span>}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-3 shrink-0">
                                                            <span className="num text-[var(--text)]">R$ {formatBRL(item.price_at_time * item.quantity)}</span>
                                                            {roleCan(loggedUser, store, 'mover_item') && (
                                                            <button
                                                                onClick={() => abrirMoverItem(item.id)}
                                                                className="relative hit-44 text-[var(--text-muted)]/60 hover:text-[var(--brand)] p-1 u-motion u-press"
                                                                title="Mover para outra mesa"
                                                                aria-label="Mover item para outra mesa"
                                                            >
                                                                <ArrowRightLeft size={16} />
                                                            </button>
                                                            )}
                                                            {podeTrocarOuExcluir(loggedUser, store) && (
                                                            <button
                                                                onClick={() => handleDeleteItem(item.id)}
                                                                className="relative hit-44 text-[var(--text-muted)]/60 hover:text-[var(--err)] p-1 u-motion u-press"
                                                                title="Cancelar Item"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                            )}
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
                                                    <div className="flex justify-between items-center gap-3 px-4 py-3 text-[15px]">
                                                        <div className="flex-1">
                                                            <span className="font-medium text-[var(--text)]">Taxa de Serviço ({formatServiceFeeRate(serviceFeeRate)})</span>
                                                            <div className="text-[13px] text-[var(--text-muted)] mt-0.5">Opcional</div>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <span className="num text-[var(--text)]">R$ {formatBRL(summary.serviceFee)}</span>
                                                            <button
                                                                onClick={() => handleToggleServiceFee(selectedTable!.id, true)}
                                                                className="relative hit-44 text-[var(--text-muted)]/60 hover:text-[var(--err)] p-1 u-motion u-press"
                                                                title="Remover Taxa"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="flex justify-between items-center px-4 py-3 text-[13px] text-[var(--text-muted)]">
                                                        <span>
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

                                <div className="px-4 py-3.5 border-t border-[var(--border)] flex justify-between items-baseline">
                                    <span className="font-semibold text-[17px] text-[var(--text)]">Total</span>
                                    <span className="font-semibold text-[28px] num text-[var(--text)] tracking-tight">
                                        R$ <AnimatedNumber value={selectedTable ? getTableSummary(selectedTable.id).total : 0} format={formatBRL} />
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2 mb-3">
                                <Button variant="secondary" className="max-sm:h-11" onClick={() => setShowFullBill(false)}>Voltar</Button>
                                {roleCan(loggedUser, store, 'trocar_mesa') ? (
                                <Button variant="secondary" className="max-sm:h-11" onClick={() => setShowMoveTableModal(true)}>
                                    <ArrowRightLeft size={16}/> Trocar
                                </Button>
                                ) : <span />}
                                <Button variant="secondary" className="max-sm:h-11" onClick={() => selectedTable && printTableBill(selectedTable.id)}>
                                    <Printer size={16}/> Imprimir comanda
                                </Button>
                            </div>
                            {podeCancelarPedido && (currentTableSummary?.allItems || []).some((i) => i.status !== OrderStatus.CANCELED) && (
                                <Button variant="danger" className="w-full max-sm:h-11 mb-3" onClick={() => { setCancelarMotivo(''); setShowCancelarPedido(true); }}>
                                    <Trash2 size={16}/> Cancelar pedido
                                </Button>
                            )}
                            {canFinalize ? (
                                <Button onClick={() => handleOpenPayment()} size="lg" className="w-full !h-12">
                                    <Wallet size={18}/> Receber pagamento
                                </Button>
                            ) : selectedTable?.status === 'waiting_bill' ? (
                                <div className="w-full flex items-center justify-center gap-2 text-[15px] font-medium text-[var(--text)] bg-[var(--surface-2)] rounded-full h-12">
                                    <span className="w-2 h-2 rounded-full bg-[var(--warn-fill)]" aria-hidden />
                                    Conta pedida — aguardando o caixa
                                </div>
                            ) : isAberto ? (
                                <div className="w-full flex items-center justify-center gap-2 text-[14px] text-[var(--text-muted)] bg-[var(--surface-2)] rounded-full h-12">
                                    <Lock size={15} aria-hidden /> Conta e pagamento: só com login
                                </div>
                            ) : (
                                <Button onClick={() => selectedTable && handleRequestBill(selectedTable.id)} size="lg" className="w-full !h-12">
                                    <Receipt size={18}/> Pedir conta
                                </Button>
                            )}
                                         {canFinalize && selectedTable?.status === 'waiting_bill' && (
                                <button
                                    type="button"
                                    onClick={() => handleCancelBillRequest(selectedTable.id)}
                                    className="mt-2 w-full h-10 rounded-[var(--r-md)] text-[14px] text-[var(--text-muted)] hover:bg-[var(--surface-2)] u-motion"
                                >
                                    Cancelar pedido de conta (foi sem querer)
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </Modal>

            {/* "Adicionar Pedido" em tela cheia (2026-09-22, pedido explícito
                do dono: "quero na tela TODA, botão de sair, 30% da tela na
                direita como a mesa está, o resto pra escolher no cardápio") —
                não é mais um Modal pequeno. `fixed inset-0` cobre a viewport
                inteira por cima de tudo (inclusive da sidebar), com botão de
                sair explícito na barra superior. Coluna direita ("Já pedido
                nesta mesa") em `lg:w-[30%]` de verdade (fração da tela, não
                um teto de px como antes) e o cardápio ocupa o resto. Empilha
                (cardápio em cima, resumo embaixo) em telas estreitas — 30%
                de um celular quebraria o layout do resumo. */}
            <WaiterOrderSurface
                isOpen={showMenuMode && !!selectedTable}
                onClose={fecharPedidoMesa}
                ariaLabel={`Mesa ${selectedTable?.number ?? ''} — Adicionar pedido`}
                title={<>Mesa {selectedTable?.number} <span className="text-[var(--text-muted)] font-normal">· Adicionar pedido</span></>}
            >
                {selectedTable && (() => {
                const resumo = getTableSummary(selectedTable.id);
                const itens = resumo.allItems || [];
                return (
                        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
                            <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden px-5 pb-2">
                                <StoreTableMenu storeId={storeId} onAddItem={adicionarNaMesa} addLabel="Adicionar ao pedido" podeEsgotar={roleCanOr(loggedUser, store, 'esgotar', loggedUser.role === 'manager' || hasTabPermission(loggedUser, 'menu', store))} />
                            </div>
                            {/* "Já pedido" (pedido do dono, 2026-09-18): resumo do que a
                                mesa já pediu ao lado do cardápio, com cancelar. Lê o mesmo
                                getTableSummary da comanda completa — atualiza sozinho
                                (otimista no handleAddItem + Realtime). */}
                            <div className={`md:w-[300px] lg:w-[32%] lg:max-w-[400px] ${mesaCarrinho.length > 0 ? 'max-md:max-h-[62%]' : 'max-md:max-h-[38%]'} flex-shrink-0 border-t md:border-t-0 md:border-l border-[var(--border)] bg-[var(--surface-2)] flex flex-col min-h-0 overflow-hidden`}>
                                {mesaCarrinho.length > 0 && (
                                    <div className="flex-shrink-0 max-h-[60%] flex flex-col min-h-0 border-b border-[var(--border)]">
                                        <div className="px-4 pt-4 pb-2 flex items-baseline justify-between flex-shrink-0">
                                            <h4 className="font-semibold text-[15px] text-[var(--text)]">Novo pedido <span className="font-normal text-[var(--text-muted)]">· ainda não enviado</span></h4>
                                            <span className="text-[13px] text-[var(--text-muted)] num">{mesaCarrinhoQtd} {mesaCarrinhoQtd === 1 ? 'item' : 'itens'}</span>
                                        </div>
                                        <div className="overflow-y-auto min-h-[64px] px-3 pb-2">
                                            <div className="bg-[var(--surface)] rounded-[14px] divide-y divide-[var(--border)] overflow-hidden">
                                                {mesaCarrinho.map(l => {
                                                    const unit = calculateCartItemUnitPrice({ product: l.product, selectedOptions: l.selectedOptions });
                                                    return (
                                                        <div key={l.key} className="flex items-center gap-2 pl-4 pr-1.5 py-2.5">
                                                            <div className="min-w-0 flex-1">
                                                                <div className="font-semibold text-[15px] text-[var(--text)] leading-tight line-clamp-2">{getOrderItemDisplayName({ product: l.product, selected_options: l.selectedOptions })}</div>
                                                                {l.notes && <div className="text-[13px] font-medium text-[var(--warn)] mt-0.5 line-clamp-2">Obs: {l.notes}</div>}
                                                                <div className="text-[13px] text-[var(--text-muted)] mt-0.5 num">R$ {formatBRL(unit * l.qty)}</div>
                                                            </div>
                                                            <div className="flex items-center gap-0.5 flex-shrink-0">
                                                                <button type="button" onClick={() => mudarQtdMesa(l.key, -1)} disabled={l.qty <= 1} aria-label={`Diminuir ${l.product.name}`} className="w-8 h-8 max-sm:w-9 max-sm:h-9 grid place-items-center rounded-full bg-[var(--surface-2)] text-[var(--brand)] disabled:opacity-40 u-motion u-press-sm max-sm:min-h-11 max-sm:min-w-11"><Minus size={15} /></button>
                                                                <span className="font-semibold text-[15px] num w-7 text-center">{l.qty}</span>
                                                                <button type="button" onClick={() => mudarQtdMesa(l.key, 1)} aria-label={`Aumentar ${l.product.name}`} className="w-8 h-8 max-sm:w-9 max-sm:h-9 grid place-items-center rounded-full bg-[var(--surface-2)] text-[var(--brand)] u-motion u-press-sm max-sm:min-h-11 max-sm:min-w-11"><Plus size={15} /></button>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => removerDaMesa(l.key)}
                                                                className="relative hit-44 w-8 h-8 grid place-items-center rounded-full text-[var(--text-muted)]/70 hover:text-[var(--err)] hover:bg-[var(--err)]/10 u-motion u-press flex-shrink-0"
                                                                title="Tirar do pedido"
                                                                aria-label={`Tirar ${l.product.name} do pedido`}
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <div className="px-4 pt-1 pb-3 flex-shrink-0">
                                            <Button
                                                size="lg"
                                                className="w-full !h-[52px] !text-[17px]"
                                                isLoading={enviandoPedidoMesa}
                                                onClick={() => confirmarPedidoMesa()}
                                            >
                                                Confirmar pedido · R$ {formatBRL(mesaCarrinhoTotal)}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                                <div className="px-4 pt-4 pb-2 flex items-baseline justify-between flex-shrink-0">
                                    <h4 className="font-semibold text-[15px] text-[var(--text)]">Já pedido nesta mesa</h4>
                                    <span className="text-[13px] text-[var(--text-muted)]">{itens.length} {itens.length === 1 ? 'item' : 'itens'}</span>
                                </div>
                                <div className="flex-1 overflow-y-auto min-h-[88px] px-3">
                                    {itens.length === 0 ? (
                                        <div className="p-6 text-center text-[13px] text-[var(--text-muted)]">Nenhum item lançado ainda.</div>
                                    ) : (
                                    <div className="bg-[var(--surface)] rounded-[14px] divide-y divide-[var(--border)] overflow-hidden">
                                    {itens.map(item => (
                                        <div key={item.id} className="flex items-start justify-between gap-2 pl-4 pr-2 py-3">
                                            <div className="min-w-0 flex-1">
                                                <div className="font-semibold text-[15px] text-[var(--text)] leading-tight">
                                                    <span className="text-[13px] font-medium text-[var(--text-muted)] mr-1 num">{item.quantity}×</span>
                                                    {getOrderItemDisplayName(item)}
                                                </div>
                                                <div className="text-[13px] text-[var(--text-muted)] mt-0.5 num">
                                                    R$ {formatBRL(item.price_at_time * item.quantity)}
                                                    {orderFlow !== 'direct_print' && (
                                                        <> · {item.status === 'delivered' ? 'Entregue' : item.status === 'preparing' ? 'Preparando' : item.status === 'ready' ? 'Pronto' : 'Aguardando'}</>
                                                    )}
                                                    <HoraDoPedido criadoEm={item.created_at} />
                                                </div>
                                                {parseItemNote(item.notes || '').observation && (
                                                    <div className="text-[13px] font-medium text-[var(--warn)] mt-0.5">Obs: {parseItemNote(item.notes || '').observation}</div>
                                                )}
                                            </div>
                                            {roleCan(loggedUser, store, 'mover_item') && (
                                            <button
                                                type="button"
                                                onClick={() => abrirMoverItem(item.id)}
                                                className="relative hit-44 w-8 h-8 grid place-items-center rounded-full text-[var(--text-muted)]/70 hover:text-[var(--brand)] hover:bg-[var(--surface-2)] u-motion u-press flex-shrink-0"
                                                title="Mover para outra mesa"
                                                aria-label="Mover item para outra mesa"
                                            >
                                                <ArrowRightLeft size={15} />
                                            </button>
                                            )}
                                            {podeTrocarOuExcluir(loggedUser, store) && (
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteItem(item.id)}
                                                className="relative hit-44 w-8 h-8 grid place-items-center rounded-full text-[var(--text-muted)]/70 hover:text-[var(--err)] hover:bg-[var(--err)]/10 u-motion u-press flex-shrink-0"
                                                title="Cancelar item"
                                                aria-label="Cancelar item"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                            )}
                                        </div>
                                    ))}
                                    </div>
                                    )}
                                </div>
                                <div className="px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] flex items-baseline justify-between flex-shrink-0">
                                    <span className="font-medium text-[15px] text-[var(--text-muted)]">Total</span>
                                    <span className="font-bold text-[28px] max-md:text-[22px] num tracking-[-0.02em] text-[var(--text)]">R$ <AnimatedNumber value={resumo.total || 0} format={formatBRL} /></span>
                                </div>
                            </div>
                        </div>
                );
                })()}
            </WaiterOrderSurface>
            <Modal isOpen={senhaPedido.aberto} onClose={() => !senhaPedido.verificando && setSenhaPedido((x) => ({ ...x, aberto: false }))} title="Quem está lançando?" size="sm">
                <form
                    className="space-y-4"
                    onSubmit={async (e) => {
                        e.preventDefault();
                        const senha = senhaPedido.senha;
                        if (!senha) { setSenhaPedido((x) => ({ ...x, erro: 'Digite a sua senha.' })); return; }
                        setSenhaPedido((x) => ({ ...x, verificando: true, erro: '' }));
                        const r = await verificarSenhaEquipe(storeId, senha);
                        // Com login (não é o modo Aberto): a senha tem que ser da PRÓPRIA pessoa logada, nunca de outra (R3).
                        if (r.success && !isAberto && loggedUser.role !== 'universal' && r.user_id !== loggedUser.id) {
                            setSenhaPedido((x) => ({ ...x, verificando: false, erro: 'Essa senha não é a sua. Digite a sua própria senha.', senha: '' }));
                            return;
                        }
                        if (r.success) {
                            setSenhaPedido({ aberto: false, senha: '', erro: '', verificando: false });
                            toast.success(`Pedido no nome de ${r.name}.`);
                            await confirmarPedidoMesa({ name: r.name });
                            return;
                        }
                        const erro =
                            r.error === 'ambiguous' ? 'Essa senha é de mais de uma pessoa. Troque a sua senha ou entre com o seu login.' :
                            r.error === 'locked' ? `Muitas tentativas erradas. Espere ${r.seconds ?? 60} segundos.` :
                            r.error === 'offline' ? 'Sem internet: não dá pra conferir a senha agora.' :
                            'Senha não encontrada.';
                        setSenhaPedido((x) => ({ ...x, verificando: false, erro, senha: '' }));
                    }}
                >
                    <p className="text-sm text-[var(--text-muted)]">Digite a <b>sua</b> senha de login. O pedido sai no seu nome.</p>
                    <Input
                        label="Sua senha"
                        type="password"
                        autoFocus
                        autoComplete="off"
                        value={senhaPedido.senha}
                        onChange={(e) => setSenhaPedido((x) => ({ ...x, senha: e.target.value, erro: '' }))}
                    />
                    {senhaPedido.erro && <p className="text-sm text-[var(--err)]" role="alert">{senhaPedido.erro}</p>}
                    <Button type="submit" size="lg" className="w-full" isLoading={senhaPedido.verificando}>Confirmar pedido</Button>
                </form>
            </Modal>

            {/* CANCELAR PEDIDO (mesa inteira) — pede o motivo, cancela os itens e imprime o cancelamento na cozinha/bar */}
            <Modal isOpen={showCancelarPedido} onClose={() => !cancelandoPedido && setShowCancelarPedido(false)} title={`Cancelar pedido da Mesa ${selectedTable?.number ?? ''}`}>
                <div className="space-y-4">
                    <p className="text-sm text-[var(--text-muted)]">
                        Todos os itens ainda não pagos desta mesa serão cancelados e a cozinha/bar recebe um pedido de cancelamento. Não dá para desfazer.
                    </p>
                    <Input label="Motivo (opcional)" placeholder="Ex.: cliente desistiu" value={cancelarMotivo} onChange={(e) => setCancelarMotivo(e.target.value)} maxLength={80} />
                    <div className="grid grid-cols-2 gap-2">
                        <Button variant="secondary" className="max-sm:h-11" onClick={() => setShowCancelarPedido(false)} disabled={cancelandoPedido}>Voltar</Button>
                        <Button variant="danger" className="max-sm:h-11" onClick={handleCancelarPedidoMesa} isLoading={cancelandoPedido}>Cancelar pedido</Button>
                    </div>
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
                            className="bg-[var(--info-fill)] hover:bg-[var(--info)]/90 text-white"
                        >
                            Confirmar Troca
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* PAYMENT MODAL */}
            <Modal isOpen={showPaymentModal} onClose={() => setShowPaymentModal(false)} title="Receber pagamento" size="lg">
                <div className="space-y-4">
                    {/* Tabs — Reunião 2026-09-10 (min 32:14): "Por Cliente" virou
                        "Por pessoa" porque ninguém associava ao recurso de nota
                        fiscal por pessoa (migration 055). */}
                    <SegmentedControl
                        className="flex w-full [&>button]:flex-1 max-sm:[&>button]:px-1.5"
                        value={paymentTab}
                        onChange={(v) => setPaymentTab(v as typeof paymentTab)}
                        options={[
                            { value: 'payment', label: 'Pagamento' },
                            { value: 'split', label: 'Dividir igual' },
                            { value: 'users', label: 'Por pessoa' },
                            { value: 'calculator', label: 'Calculadora' },
                        ]}
                    />

                    <div className="sm:max-h-[60vh] sm:overflow-y-auto sm:-mx-1 sm:px-1 sm:pb-1">
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
                                finishLabel="Finalizar mesa"
                                showEmitirNotaToggle={emissaoFiscalConfigurada}
                                emitirNota={emitirNotaFiscal}
                                onEmitirNotaChange={setEmitirNotaFiscal}
                                serviceFeeToggle={selectedTable ? (
                                    <>
                                        {!!store.config?.charge_service_fee && !currentTableSummary?.hasFeeItem && (
                                            <button
                                                type="button"
                                                onClick={() => handleToggleServiceFee(selectedTable.id, !currentTableSummary?.isServiceFeeRemovedForTable)}
                                                className="mt-2 inline-flex items-center justify-center gap-1.5 h-8 max-sm:h-11 px-3.5 rounded-full bg-[var(--surface-2)] text-[13px] font-semibold text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--border)] u-motion u-press-sm"
                                            >
                                                {currentTableSummary?.isServiceFeeRemovedForTable
                                                    ? <><Plus size={14} /> Cobrar a taxa de {formatServiceFeeRate(serviceFeeRate)}</>
                                                    : <><Trash2 size={14} /> Tirar a taxa de {formatServiceFeeRate(serviceFeeRate)}</>}
                                            </button>
                                        )}
                                        {/* Taxas como produto (migration 138): só quem tem caixa vê e
                                            lança. Cada uma vira item da conta com o código do Omie
                                            (nota fiscal + Estoque); a percentual troca o cálculo
                                            automático pelo item. */}
                                        {canLaunchFee && feeProducts.length > 0 && currentTableSummary && (
                                            <div className="mt-3 flex flex-wrap justify-center gap-2">
                                                {feeProducts.map(fp => {
                                                    const isPct = ehTaxaPercentual(fp);
                                                    const lancada = currentTableSummary.allItems.find(i => i.product_id === fp.id);
                                                    const valor = isPct
                                                        ? valorTaxaPercentual(currentTableSummary.allItems, Number(fp.fee_percent))
                                                        : getEffectivePrice(fp);
                                                    const velha = isPct ? taxaPercentualDesatualizada(currentTableSummary.allItems) : null;
                                                    const desatualizada = !!velha && velha.item.product_id === fp.id;
                                                    const valorRecalc = desatualizada ? velha!.esperado : valor;
                                                    const travada = (isPct && !!lancada && !desatualizada) || paymentMethods.length > 0;
                                                    const rotulo = isPct
                                                        ? (lancada
                                                            ? (desatualizada ? `Recalcular ${fp.name}: R$ ${formatBRL(valorRecalc)}` : `${fp.name} na conta · R$ ${formatBRL(lancada.price_at_time)}`)
                                                            : `Lançar ${fp.name} (${formatServiceFeeRate(Number(fp.fee_percent) / 100)}) · R$ ${formatBRL(valor)}`)
                                                        : `Lançar ${fp.name} · R$ ${formatBRL(valor)}`;
                                                    const editando = editandoTaxaId === fp.id;
                                                    const podeEditar = paymentMethods.length === 0 && launchingFeeId === null && (!isPct || baseDaTaxaPercentual(currentTableSummary.allItems) > 0);
                                                    return (
                                                        <div key={fp.id} className="flex flex-col items-center gap-2">
                                                            <div className="inline-flex items-center gap-1.5">
                                                                <button
                                                                    type="button"
                                                                    title={paymentMethods.length > 0 ? 'Pra lançar taxa, remova os pagamentos já lançados.' : undefined}
                                                                    disabled={travada || launchingFeeId !== null || (isPct && valor <= 0)}
                                                                    onClick={() => handleLaunchFee(fp)}
                                                                    className="inline-flex items-center gap-1.5 h-8 max-sm:h-11 px-3.5 rounded-full bg-[var(--brand-soft)] text-[13px] font-semibold text-[var(--brand)] hover:brightness-95 disabled:bg-[var(--surface-2)] disabled:text-[var(--text-muted)] disabled:cursor-default u-motion u-press-sm"
                                                                >
                                                                    {launchingFeeId === fp.id ? <RefreshCw size={14} className="animate-spin" /> : (isPct && lancada && !desatualizada ? <CheckCircle size={14} className="text-[var(--ok)]" /> : <Plus size={14} />)}
                                                                    {rotulo}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    aria-label={`Editar ${fp.name}`}
                                                                    title={isPct ? 'Editar o valor ou o percentual da taxa' : 'Cobrar um valor diferente'}
                                                                    disabled={!podeEditar}
                                                                    onClick={() => (editando ? setEditandoTaxaId(null) : abrirEdicaoTaxa(fp))}
                                                                    className="inline-flex items-center justify-center h-8 w-8 max-sm:h-11 max-sm:w-11 rounded-full bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-50 disabled:cursor-default u-motion u-press-sm"
                                                                >
                                                                    <Pencil size={14} />
                                                                </button>
                                                            </div>
                                                            {editando && (
                                                                <div className="w-full max-w-sm bg-[var(--surface-2)] p-3 rounded-[14px] space-y-2 text-left">
                                                                    <p className="text-[13px] font-semibold text-[var(--text-muted)]">
                                                                        {isPct
                                                                            ? `${fp.name}: valor cobrado ou percentual da conta (R$ ${formatBRL(baseDaTaxaPercentual(currentTableSummary.allItems))}). Zero tira a taxa.`
                                                                            : `${fp.name}: valor cobrado (cadastrado R$ ${formatBRL(getEffectivePrice(fp))})`}
                                                                    </p>
                                                                    <div className="flex gap-2">
                                                                        <label className="flex-1 text-[12px] text-[var(--text-muted)]">
                                                                            Valor (R$)
                                                                            <input
                                                                                type="text"
                                                                                inputMode="decimal"
                                                                                autoComplete="off"
                                                                                value={taxaValorInput}
                                                                                onChange={(e) => aoDigitarTaxaValor(e.target.value)}
                                                                                className="mt-1 w-full h-11 px-3 rounded-[var(--r-md)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 text-base sm:text-[15px] num"
                                                                            />
                                                                        </label>
                                                                        {isPct && (
                                                                            <label className="flex-1 text-[12px] text-[var(--text-muted)]">
                                                                                Percentual (%)
                                                                                <input
                                                                                    type="text"
                                                                                    inputMode="decimal"
                                                                                    autoComplete="off"
                                                                                    value={taxaPercentInput}
                                                                                    onChange={(e) => aoDigitarTaxaPercent(e.target.value)}
                                                                                    className="mt-1 w-full h-11 px-3 rounded-[var(--r-md)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 text-base sm:text-[15px] num"
                                                                                />
                                                                            </label>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex gap-2 justify-end">
                                                                        <button type="button" onClick={() => setEditandoTaxaId(null)} className="h-9 max-sm:h-11 px-3.5 rounded-full bg-[var(--surface)] text-[13px] font-semibold text-[var(--text-muted)] u-motion u-press-sm">Cancelar</button>
                                                                        <button type="button" disabled={launchingFeeId !== null} onClick={() => handleAplicarEdicaoTaxa(fp)} className="h-9 max-sm:h-11 px-3.5 rounded-full bg-[var(--brand)] text-[13px] font-semibold text-white disabled:opacity-50 u-motion u-press-sm">
                                                                            {lancada && isPct ? 'Aplicar' : 'Lançar'}
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </>
                                ) : undefined}
                            >
                                {/* Destinatário (Task 17; 2026-09-21: NFC-e também, ver
                                    lib/fiscal/xml.ts) — nome só é usado no <dest> da NF-e
                                    (NFC-e manda só o documento, sem endereço/xNome). */}
                                {(nfeModeloAtivo || nfceModeloAtivo) && (
                                    <div className="bg-[var(--surface-2)] p-4 rounded-[14px] space-y-2">
                                        <p className="text-[13px] font-semibold text-[var(--text-muted)]">
                                            Documento do destinatário (opcional)
                                        </p>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            autoComplete="off"
                                            className="w-full h-11 px-3 rounded-[var(--r-md)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 text-base sm:text-[15px]"
                                            placeholder="CPF ou CNPJ do cliente"
                                            value={paymentDestCpfCnpj}
                                            onChange={(e) => setPaymentDestCpfCnpj(e.target.value)}
                                        />
                                        {nfeModeloAtivo && (
                                            <input
                                                type="text"
                                                className="w-full h-11 px-3 rounded-[var(--r-md)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 text-base sm:text-[15px]"
                                                placeholder="Nome do cliente"
                                                value={paymentDestNome}
                                                onChange={(e) => setPaymentDestNome(e.target.value)}
                                            />
                                        )}
                                        <p className="text-xs text-[var(--text-muted)]">
                                            {nfeModeloAtivo
                                                ? 'Deixe em branco pra fechar a mesa sem emitir a NF-e agora — dá pra preencher e reemitir depois na aba "Notas Fiscais".'
                                                : 'Aparece no cupom fiscal, se informado. Deixar em branco não muda nada.'}
                                        </p>
                                    </div>
                                )}
                            </PaymentCaptureFields>
                        )}

                        {paymentTab === 'split' && currentTableSummary && (
                            <div className="space-y-6 pt-2 animate-fade-in">
                                {/* Reunião 2026-09-10 (min 32:14): o recurso de nota fiscal
                                    por pessoa (migration 055) já existia na aba ao lado, mas
                                    quem estava dividindo a conta nunca chegou lá — "não
                                    entendi nada disso aqui". Esta ponte é o fix real: o
                                    problema era descoberta, não falta de funcionalidade. */}
                                {Object.keys(usersBreakdown).length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => setPaymentTab('users')}
                                        className="w-full flex items-center justify-between gap-2 p-3 rounded-[14px] bg-[var(--brand-soft)] text-left u-motion u-press-sm"
                                    >
                                        <span className="text-[13px] font-medium text-[var(--brand)]">
                                            Esta mesa tem {Object.keys(usersBreakdown).length} pessoas identificadas — dá pra cobrar e emitir nota fiscal separada pra cada uma.
                                        </span>
                                        <ArrowRight size={16} className="text-[var(--brand)] shrink-0" />
                                    </button>
                                )}
                                <div className="text-center pt-1">
                                    <p className="text-[13px] font-medium text-[var(--text-muted)]">Total da mesa</p>
                                    <p className="text-[40px] leading-tight font-bold num tracking-[-0.02em] text-[var(--text)] mt-0.5">R$ <AnimatedNumber value={currentTableSummary.total} format={formatBRL} /></p>
                                    <p className="text-[13px] text-[var(--text-muted)] mt-1">
                                        {currentTableSummary.isServiceFeeEnabled
                                            ? `Inclui R$ ${formatBRL(currentTableSummary.serviceFee)} de taxa de serviço (${formatServiceFeeRate(serviceFeeRate)} opcional)`
                                            : currentTableSummary.isServiceFeeRemovedForTable
                                                ? 'Taxa de serviço opcional removida nesta mesa'
                                                : 'Esta loja não cobra taxa de serviço'}
                                    </p>
                                </div>
                                <div className="flex items-center justify-center gap-6 py-2">
                                    <button onClick={() => setPaymentPeople(Math.max(1, paymentPeople - 1))} aria-label="Menos uma pessoa" className="w-11 h-11 bg-[var(--surface-2)] rounded-full flex items-center justify-center hover:bg-[var(--border)] u-motion u-press-sm"><Minus size={18} /></button>
                                    <div className="text-center min-w-[80px]">
                                        <span className="block text-[28px] font-bold num text-[var(--text)]">{paymentPeople}</span>
                                        <span className="text-[13px] text-[var(--text-muted)]">Pessoas</span>
                                    </div>
                                    <button onClick={() => setPaymentPeople(paymentPeople + 1)} aria-label="Mais uma pessoa" className="w-11 h-11 bg-[var(--surface-2)] rounded-full flex items-center justify-center hover:bg-[var(--border)] u-motion u-press-sm"><Plus size={18}/></button>
                                </div>
                                <div className="bg-[var(--surface-2)] rounded-[14px] p-4 text-center">
                                    <p className="text-[var(--text-muted)] text-[13px] mb-0.5">Valor por pessoa</p>
                                    <p className="text-[28px] font-bold num tracking-[-0.01em] text-[var(--text)]">R$ <AnimatedNumber value={currentTableSummary.total / paymentPeople} format={formatBRL} /></p>
                                    <Button
                                        className="mt-3"
                                        variant="primary"
                                        onClick={() => {
                                            setCurrentPaymentAmount((currentTableSummary.total / paymentPeople).toFixed(2));
                                            setPaymentTab('payment');
                                        }}
                                    >
                                        Preencher valor no pagamento
                                    </Button>
                                </div>
                            </div>
                        )}

                        {paymentTab === 'users' && (
                            <div className="space-y-4 pt-2 animate-fade-in">
                                {/* Reunião 2026-09-10 (min 33:06): ao chegar nesta aba, a
                                    reação foi "não entendi nada disso aqui" — os botões
                                    existiam mas nada dizia o que faziam. */}
                                <p className="text-[13px] text-[var(--text-muted)] px-1">
                                    Cobre cada pessoa separadamente. "Emitir nota" gera uma nota fiscal só com os itens daquela pessoa — o que já foi faturado aqui não entra de novo na nota do fechamento da mesa.
                                </p>
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
                                    <div key={name} className="bg-[var(--surface-2)] rounded-[14px] overflow-hidden">
                                        <div className="px-4 py-3 flex justify-between items-center">
                                            <span className="font-semibold text-[var(--text)] flex items-center gap-2"><User size={15} className="text-[var(--text-muted)]"/> {name}</span>
                                            <span className="font-semibold num text-[var(--text)]">R$ {formatBRL(data.total)}</span>
                                        </div>
                                        <div className="p-2 space-y-1">
                                            {data.items.map((it: any) => (
                                                <div key={it.id} className="flex justify-between items-center text-[13px] text-[var(--text-muted)] px-2 py-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <span>{it.quantity}x {getOrderItemDisplayName(it)}</span>
                                                    </div>
                                                    <span className="num">{formatBRL(it.price_at_time * it.quantity)}</span>
                                                </div>
                                            ))}
                                            {currentTableSummary?.isServiceFeeEnabled && (
                                                <div className="flex justify-between items-center text-[13px] text-[var(--text-muted)] px-2 py-1 border-t border-[var(--border)] mt-1 pt-1">
                                                    <span>Taxa de serviço ({formatServiceFeeRate(serviceFeeRate)})</span>
                                                    <span className="num">{formatBRL(data.serviceFee)}</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="p-3 pt-1 flex flex-col sm:flex-row gap-2">
                                            <Button
                                                className="w-full sm:flex-1 max-sm:!h-11"
                                                size="sm"
                                                variant="primary"
                                                onClick={() => {
                                                    setCurrentPaymentAmount(data.total.toFixed(2));
                                                    setPaymentTab('payment');
                                                }}
                                            >
                                                Lançar pagamento de {name}
                                            </Button>
                                            {emissaoFiscalConfigurada && (
                                                <Button
                                                    className="w-full sm:flex-1 max-sm:!h-11 !bg-[var(--surface)]"
                                                    size="sm"
                                                    variant="outline"
                                                    isLoading={emitindoNotaDe === name}
                                                    disabled={emitindoNotaDe !== null}
                                                    onClick={() => handleEmitirNotaIndividual(name, data.items)}
                                                >
                                                    Emitir nota fiscal de {name}
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
                                <div className="px-1 text-[13px] text-[var(--text-muted)] mb-2">
                                    Selecione os itens para calcular um subtotal.
                                </div>
                                {currentTableSummary.allItems.map(item => {
                                    const isSelected = !!paymentSelectedItems[item.id];
                                    const selectedQty = paymentSelectedItems[item.id] || 0;

                                    return (
                                        <div key={item.id} onClick={() => toggleSelection(item.id, item.quantity)} className={`flex items-center gap-3 p-3 rounded-[14px] transition-all cursor-pointer ${isSelected ? 'ring-2 ring-[var(--brand)] bg-[var(--brand-soft)]' : 'bg-[var(--surface-2)]'}`}>
                                            <div className={`text-[var(--brand)] ${isSelected ? 'opacity-100' : 'opacity-30'}`}>
                                                {isSelected ? <CheckSquare size={20}/> : <Square size={20}/>}
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex justify-between items-start">
                                                    <span className={`text-[15px] font-semibold ${isSelected ? 'text-[var(--brand)]' : 'text-[var(--text)]'}`}>
                                                        {getOrderItemDisplayName(item)}
                                                    </span>
                                                    <span className="text-[15px] font-medium num">R$ {formatBRL(item.price_at_time)}</span>
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

                                <div className="mt-4 p-4 bg-[var(--surface-2)] rounded-[14px]">
                                    <div className="flex justify-between items-center">
                                        <span className="font-semibold text-[var(--text)]">Total selecionado</span>
                                        <span className="font-bold num text-[22px] tracking-[-0.01em] text-[var(--text)]">R$ {formatBRL(calculatorTotal)}</span>
                                    </div>
                                    <div className="text-[13px] text-[var(--text-muted)] mt-1 text-right">
                                        {currentTableSummary.isServiceFeeEnabled
                                            ? `Inclui R$ ${formatBRL(calculatorServiceFee)} de taxa de serviço (${formatServiceFeeRate(serviceFeeRate)} opcional)`
                                            : currentTableSummary.isServiceFeeRemovedForTable
                                                ? 'Taxa de serviço opcional removida nesta mesa'
                                                : 'Esta loja não cobra taxa de serviço'}
                                    </div>
                                    <Button
                                        className="w-full mt-3"
                                        onClick={() => {
                                            setCurrentPaymentAmount(calculatorTotal.toFixed(2));
                                            setPaymentTab('payment');
                                        }}
                                        disabled={calculatorTotal <= 0}
                                    >
                                        Preencher valor no pagamento
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

            {/* "Pedidos do Dia" (redesign 04/10/2026): janela larga; lógica em lib/pedidosDoDia.ts, tela em
                PedidosDoDiaView. Só visualização, exceto Reimprimir (item sem registro, mesa aberta, aparelho de
                caixa — `canReprint`). Cobre o dia inteiro, mesas fechadas incluídas — ver sentHistoryItems. */}
            <Modal isOpen={showSentHistory} onClose={() => setShowSentHistory(false)} title="Pedidos do Dia" variant="sheet" size="lg">
                <PedidosDoDiaView
                    linhas={sentHistoryItems}
                    locais={[{ id: 'kitchen', nome: 'Cozinha' }, { id: 'bar', nome: 'Bar' }, ...locaisInfo.setores.map(x => ({ id: x.id, nome: x.name }))]}
                    meuNome={loggedUser.name}
                    soMeusInicial={loggedUser.role === 'waiter'}
                    podeReimprimir={canReprint}
                    reimprimindo={reprintingIds}
                    onReimprimir={handleManualReprint}
                />
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
                                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--warn)]/10 text-[var(--warn)]">
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

// Linha do carrinho da venda de balcão feita pela equipe (CounterView).
// `key` = produto + opções + observação: repetir o mesmo item soma quantidade.
type CounterSaleLine = { key: string; product: Product; qty: number; notes: string; selectedOptions: SelectedOption[] };

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
    // 2026-09-21: ver comentário equivalente em TablesView.
    const [nfceModeloAtivo, setNfceModeloAtivo] = useState(false);
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

    // "Paga primeiro" (pedido do André, reunião 2026-09-10): inverte a ordem
    // do balcão — recebe o pagamento ANTES de mandar pra cozinha, em vez de
    // cobrar na entrega. É a lógica de lanchonete/fast food: ninguém prepara
    // antes de o dinheiro entrar. Ligado por loja pelo Master Admin
    // (`counter_payment_first`), desligado por padrão — todas as lojas de
    // hoje continuam exatamente como sempre foram.
    //
    // Exige o módulo Caixa: sem ele não existe captura de pagamento nenhuma
    // nesta tela (o fluxo antigo só faz um confirm() de "entrega e
    // pagamento"), então um botão "Receber pagamento" ali não receberia
    // nada de verdade — seria só um clique a mais fingindo que recebeu.
    // Sertão, a loja que pediu, tem Caixa ligado.
    const paymentFirst = isCounterPaymentFirst(store) && caixaModuleOn;

    // "Já pago" é um FATO do pedido, não um modo de exibição. Achado de
    // revisão independente (2026-09-13): isto estava amarrado a
    // `paymentFirst`, então desligar a chave (ou o módulo Caixa) com pedidos
    // pagos esperando entrega fazia esses pedidos voltarem pro fluxo antigo
    // — o botão virava "Entregar", que reabre a captura de pagamento, SEM
    // nenhum indício de que já tinham sido pagos. Cobrança em dobro no
    // cliente. Agora qualquer pedido de balcão com pagamento gravado é
    // tratado como pago em qualquer configuração da loja.
    // Predicado ÚNICO, compartilhado com a fila do Caixa e com o card "Pago e
    // ainda não entregue" (Important #1 da revisão final, 2026-09-13) — ver
    // `isCounterOrderPaid` em lib/storeModules.ts. Era uma cópia local com a
    // mesma regra; virou alias do predicado compartilhado pra que as três
    // telas nunca possam divergir de novo.
    const pedidoJaPago = (order: Order) => isCounterOrderPaid(order);

    // Captura de pagamento (Task 5) — só usada quando caixaModuleOn. Mesmo
    // shape de estado que TablesView usa pro pagamento de mesa
    // (paymentMethods/currentPaymentAmount/currentPaymentMethod/
    // currentPaymentBrand), reaproveitado via PaymentCaptureFields.
    const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
    const [paymentMethods, setPaymentMethods] = useState<{ method: string; amount: number; brand?: string }[]>([]);
    const [currentPaymentAmount, setCurrentPaymentAmount] = useState('');
    const [currentPaymentMethod, setCurrentPaymentMethod] = useState('CREDIT');
    const [currentPaymentBrand, setCurrentPaymentBrand] = useState('');

    // Venda de balcão registrada pela EQUIPE (2026-09-26, virada do Sertão pra
    // cardápio vitrine: sem pedido do cliente pelo QR, a aba Balcão ficava
    // vazia). Mesma superfície do garçom (WaiterOrderSurface + StoreTableMenu),
    // mas tocar em "Adicionar à venda" só junta num carrinho local — o pedido
    // de balcão nasce de uma vez, com todos os itens, em "Enviar pedido".
    // Quem pode receber (módulo Caixa + canFinalizeBill) ganha "Receber agora"
    // logo depois; o resto fica em "Aguardando pagamento", igual pedido do QR.
    const canReceberVenda = caixaModuleOn && canFinalize;
    const [showNovaVenda, setShowNovaVenda] = useState(false);
    const [vendaItens, setVendaItens] = useState<CounterSaleLine[]>([]);
    const [vendaCliente, setVendaCliente] = useState('');
    const [enviandoVenda, setEnviandoVenda] = useState(false);
    const enviandoVendaRef = useRef(false);
    const [vendaEnviada, setVendaEnviada] = useState<{ orderId: string; total: number; cliente: string; offline: boolean } | null>(null);
    // Pedido cujo pagamento foi aberto por "Receber agora": o pagamento é
    // registrado SEM fechar o pedido (fica pago, esperando entregar) — em
    // qualquer configuração da loja, não só no "paga primeiro".
    const [pagamentoDaNovaVenda, setPagamentoDaNovaVenda] = useState<string | null>(null);

    const vendaTotal = vendaItens.reduce((a, l) => a + calculateCartItemUnitPrice({ product: l.product, selectedOptions: l.selectedOptions }) * l.qty, 0);
    const vendaQtd = vendaItens.reduce((a, l) => a + l.qty, 0);

    const adicionarNaVenda = (product: Product, qty: number, notes: string, selectedOptions: SelectedOption[]) => {
        const obs = notes.trim();
        const key = `${product.id}|${selectedOptions.map(o => o.option_id).sort().join(',')}|${obs}`;
        setVendaItens(prev => {
            const existente = prev.find(l => l.key === key);
            if (existente) return prev.map(l => l.key === key ? { ...l, qty: l.qty + qty } : l);
            return [...prev, { key, product, qty, notes: obs, selectedOptions }];
        });
        toast.success(`${getOrderItemDisplayName({ product, selected_options: selectedOptions })} adicionado à venda`);
    };

    const mudarQtdVenda = (key: string, delta: number) => {
        setVendaItens(prev => prev.map(l => l.key === key ? { ...l, qty: Math.max(1, l.qty + delta) } : l));
    };

    const removerDaVenda = (key: string) => setVendaItens(prev => prev.filter(l => l.key !== key));

    const fecharNovaVenda = async () => {
        if (enviandoVendaRef.current) return;
        if (vendaItens.length > 0 && !(await confirm({ message: 'Descartar os itens desta venda?', variant: 'danger', confirmLabel: 'Descartar' }))) return;
        setVendaItens([]);
        setVendaCliente('');
        setShowNovaVenda(false);
    };

    const enviarVenda = async () => {
        if (enviandoVendaRef.current || vendaItens.length === 0) return;
        enviandoVendaRef.current = true;
        setEnviandoVenda(true);
        const cliente = vendaCliente.trim();
        const itens = vendaItens;
        const total = vendaTotal;
        try {
            // Mesmo caminho do garçom na mesa (`createOrder(..., 'garcom')`),
            // com mesa nula = pedido de balcão. 'garcom' passa pelo bloqueio da
            // migration 091 (cardápio vitrine só recusa 'cliente').
            const result = await createOrder(null, storeId, itens.map(l => ({
                product: l.product, quantity: l.qty, notes: l.notes, selectedOptions: l.selectedOptions,
            })), cliente || undefined, 'garcom', loggedUser.name);
            if (!result.orderId) throw new Error('O servidor não confirmou a venda.');
            const offline = String(result.orderId).startsWith('local_');

            if (offline) {
                // Sem internet: a venda ficou na fila local (sincroniza sozinha
                // quando a conexão voltar). A Estação do Caixa lê o servidor e
                // não vê nada agora — mesma saída da mesa: imprime a comanda
                // direto na impressora de rede de cada destino.
                const menuCache: any = await getCachedMenu(storeId).catch(() => null);
                const setores = await fetchPrintSectors(storeId).catch(() => []);
                let impressas = 0;
                for (const l of itens) {
                    const catDoProduto = (menuCache?.categories || []).find((c: any) => c.id === l.product.category_id);
                    const setorId: string | null = l.product.sector_id || (l.product.ignore_category_sector ? null : catDoProduto?.sector_id) || null;
                    const setor = setorId ? setores.find((x) => x.id === setorId) : undefined;
                    const destino: 'kitchen' | 'bar' = setor ? setor.base : (l.product.destination === 'bar' ? 'bar' : 'kitchen');
                    const notasNoBanco = l.notes ? `${cliente ? `[${cliente}] ` : ''}${l.notes}` : cliente ? `[${cliente}]` : '';
                    const conteudo = buildKitchenTicketText({
                        kind: destino === 'bar' ? 'BAR' : 'COZINHA',
                        storeName: store.name,
                        orderType: 'BALCÃO',
                        identifier: 'BALCÃO',
                        client: cliente || undefined,
                        quantity: l.qty,
                        productName: l.product.name,
                        addons: l.selectedOptions.map(o => o.name).join(', ') || undefined,
                        observation: l.notes || undefined,
                        orderIdShort: String(result.orderId).slice(6, 14),
                    });
                    // Mesma assinatura que a Estação usa (mesa|produto|qtd|obs,
                    // mesa vazia no balcão) — não sai em dobro depois.
                    const sig = `|${l.product.id}|${l.qty}|${notasNoBanco}`;
                    impressas += await printOfflineOrderTicket({ storeId, destination: destino, sectorId: setor ? setorId : null, title: `${l.qty}x ${l.product.name} — Balcão`, content: conteudo, sig }).catch(() => 0);
                }
                if (impressas === 0) toast.warning('Sem internet: o pedido não saiu na impressora. Avise a cozinha.');
            } else if (!paymentFirst) {
                // Pedido de balcão nasce 'pending', e a Estação de Impressão /
                // KDS ignoram item de balcão pendente de propósito (é o pedido
                // do QR esperando alguém da loja aceitar — migration 021/089).
                // Aqui quem lançou JÁ é a loja: vai direto pra produção e sai
                // nas impressoras do local certo pelo fluxo normal, igual mesa.
                // No "paga primeiro" só vai depois de receber (ver
                // handleFinishCounterPayment).
                try {
                    await sendOrderToKitchen(result.orderId);
                } catch {
                    toast.error('A venda foi registrada, mas não foi liberada pra cozinha. Confira a conexão e avise a cozinha.');
                }
            }

            setVendaItens([]);
            setVendaCliente('');
            setShowNovaVenda(false);
            flashSuccessCheck();
            load();

            if (offline) {
                setVendaEnviada({ orderId: result.orderId, total, cliente, offline: true });
            } else if (canReceberVenda) {
                setVendaEnviada({ orderId: result.orderId, total, cliente, offline: false });
            } else {
                toast.success(caixaModuleOn ? 'Venda enviada. Ela fica em "Aguardando pagamento" até o caixa receber.' : 'Venda enviada.');
            }
        } catch (e: any) {
            toast.error(e?.message ? `A venda não foi enviada: ${e.message}` : 'A venda não foi enviada. Tente de novo.');
        } finally {
            enviandoVendaRef.current = false;
            setEnviandoVenda(false);
        }
    };

    // "Receber agora": abre a MESMA janela de pagamento do balcão, com o
    // pedido real recém-criado (itens e preço do servidor, não do carrinho).
    const receberVendaAgora = async () => {
        if (!vendaEnviada || !canReceberVenda) return;
        const { orderId } = vendaEnviada;
        setVendaEnviada(null);
        const data = await fetchCounterOrders(storeId);
        const order = data.find(o => o.id === orderId) || null;
        if (!order) {
            toast.error('Não achei a venda pra receber agora. Ela está na lista do balcão — receba por lá.');
            load();
            return;
        }
        if (pedidoJaPago(order)) {
            toast.error('Esta venda já foi paga.');
            return;
        }
        setPagamentoDaNovaVenda(order.id);
        abrirCapturaDePagamento(order);
    };

    const load = async () => {
        const [data, pendingOrders] = await Promise.all([
            fetchCounterOrders(storeId),
            buildPendingOrdersForStore(storeId),
        ]);
        // Mesmo achado/fix de TablesView.loadData/CaixaView.loadQueue — um
        // pedido de balcão lançado offline (createOrder com tableId nulo
        // também enfileira do mesmo jeito) "sumia" da lista sempre que
        // este componente remontava. Filtra só `order_type === 'counter'`
        // — pedido de mesa pendente na fila não pertence a esta tela.
        const pendingCounterOrders = (pendingOrders as Order[]).filter(o => o.order_type === 'counter');
        setOrders([...data, ...pendingCounterOrders]);
    };

    useEffect(() => {
        load();
        const channel = supabase.channel(`counter_${storeId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'order_change_pings', filter: `store_id=eq.${storeId}` }, () => load())
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [storeId]);
    usePolling(() => load());

    useEffect(() => {
        fetchStoreFiscalConfig(storeId)
            .then((cfg) => {
                setNfeModeloAtivo(cfg?.modelo_emissao_automatica === 'nfe');
                setNfceModeloAtivo(cfg?.modelo_emissao_automatica === 'nfce');
                setEmissaoFiscalConfigurada(!!cfg && cfg.modelo_emissao_automatica !== 'nenhuma');
            })
            .catch(() => {
                setNfeModeloAtivo(false);
                setNfceModeloAtivo(false);
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
        // Pedido JÁ PAGO com todos os itens cancelados não pode ficar preso
        // na tela pra sempre (achado de revisão independente): sem esta
        // saída, "Entregar" ficava desabilitado e nenhum caminho fechava o
        // pedido — o dinheiro já entrou e o card nunca sumia.
        if (relevantItems.length === 0 && pedidoJaPago(order)) return true;
        return relevantItems.length > 0 && relevantItems.every(
            i => i.status === OrderStatus.READY || i.status === OrderStatus.DELIVERED
        );
    };

    // Abre a captura de pagamento (o mesmo modal nos dois fluxos — no
    // "paga primeiro" ele é o PRIMEIRO passo, no fluxo de sempre é o
    // último). Extraído porque agora tem dois pontos de entrada.
    const abrirCapturaDePagamento = (order: Order) => {
        setPaymentOrder(order);
        setPaymentMethods([]);
        setCurrentPaymentAmount(getOrderTotal(order).toFixed(2));
        setCurrentPaymentMethod('CREDIT');
        setCurrentPaymentBrand('');
        setDestCpfCnpj('');
        setDestNome('');
        // Task 4: sempre nasce ligado, mesmo motivo de TablesView.
        setEmitirNotaFiscal(true);
    };

    // Passo 1 do "paga primeiro". Sem a checagem de "pedido pronto" de
    // propósito: aqui o pedido ACABOU de ser lançado e nem foi pra cozinha
    // ainda — esperar ficar pronto pra poder cobrar seria exatamente o
    // contrário do que a loja pediu.
    const handleReceberPrimeiro = (orderId: string) => {
        if (!canFinalize) return;
        const order = orders.find((o) => o.id === orderId);
        if (!order) return;
        // Trava de cobrança em dobro no momento do clique: entre a tela ter
        // carregado e o clique, outro caixa (ou a fila do Caixa, ou outra
        // aba) pode ter recebido este mesmo pedido.
        if (pedidoJaPago(order)) {
            toast.error('Este pedido já foi pago — falta só entregar.');
            load();
            return;
        }
        abrirCapturaDePagamento(order);
    };

    // Passo final do "paga primeiro": o pedido já está pago, só falta sair
    // pro cliente. Não reabre pagamento nenhum — só fecha e dispara a baixa
    // de estoque (Ordem de Produção), que é o que de fato acontece quando a
    // comida sai.
    const handleEntregarPago = async (orderId: string) => {
        const order = orders.find((o) => o.id === orderId);
        if (order && !isOrderReadyForClose(order)) {
            toast.error('Pedido ainda não está pronto — aguarde a cozinha/bar finalizar antes de entregar.');
            return;
        }
        try {
            await entregarPedidoBalcao(orderId);
            load();
        } catch (e: any) {
            toast.error('Erro ao entregar o pedido: ' + e.message);
        }
    };

    const handleClose = async (orderId: string) => {
        const orderForGate = orders.find((o) => o.id === orderId) || null;
        // Pedido já pago nunca passa pela captura de pagamento de novo —
        // entregar é só fechar. Vale inclusive no fluxo antigo, pra cobrir
        // o pedido que foi pago com a chave ligada e ficou em aberto quando
        // ela foi desligada (ver `pedidoJaPago`).
        if (orderForGate && pedidoJaPago(orderForGate)) {
            await handleEntregarPago(orderId);
            return;
        }
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
            abrirCapturaDePagamento(order);
            return;
        }
        // Loja SEM o módulo Caixa — comportamento de hoje, intocado. Em
        // modelo NF-e OU NFC-e (2026-09-21): abre o modal de captura opcional
        // do destinatário em vez do confirm() simples de sempre — deixar em
        // branco continua fechando o pedido normalmente (NF-e cai
        // 'pendente'; NFC-e simplesmente sai sem <dest>, nenhuma das duas
        // impede o fechamento).
        if (nfeModeloAtivo || nfceModeloAtivo) {
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
        // No "paga primeiro", a fila do Caixa manda pedido AINDA NÃO PRONTO
        // (é esse o ponto do fluxo) — handleClose barraria no gate de
        // "aguarde a cozinha". Vai direto pra captura de pagamento.
        if (order && paymentFirst && !pedidoJaPago(order)) handleReceberPrimeiro(order.id);
        else if (order) handleClose(order.id);
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
                // Id único do pagamento: o fechamento de caixa junta os pedidos de UMA conta por ele e não confunde
                // duas contas diferentes com valor, forma e operador iguais.
                payment_id: crypto.randomUUID(),
                operador_id: loggedUser.id,
                ...(emissaoFiscalConfigurada ? { emitir_nota: emitirNotaFiscal } : {}),
                ...(cashShiftId ? { cash_shift_id: cashShiftId } : {}),
            };
            const destinatario = buildDestinatario(destCpfCnpj, destNome);
            // "Paga primeiro": registra o pagamento e emite a nota (o
            // dinheiro entrou), mas NÃO fecha o pedido — ele ainda vai pra
            // cozinha e só é entregue depois. No fluxo de sempre, receber e
            // fechar continuam sendo a mesma ação, como sempre foram.
            // Venda da equipe recebida na hora ("Receber agora"): mesma coisa —
            // pago agora, entregue depois pelo botão "Entregar".
            const ehNovaVenda = pagamentoDaNovaVenda === paymentOrder.id;
            if (paymentFirst || ehNovaVenda) {
                await registrarPagamentoBalcao(paymentOrder.id, paymentData, destinatario, store.id);
                // No "paga primeiro" a venda da equipe só vai pra produção
                // depois do dinheiro entrar (ver enviarVenda).
                if (ehNovaVenda && paymentFirst && orderFlow === 'direct_print') {
                    sendOrderToKitchen(paymentOrder.id).catch(() => toast.error('Pagamento registrado, mas a venda não foi liberada pra cozinha. Avise a cozinha.'));
                }
            } else {
                await closeOrderNow(paymentOrder.id, paymentData, destinatario);
            }
            // Só visual (Task 10 Step 8): dispara e segue — não segura
            // impressão, nota nem o fechamento da janela.
            flashSuccessCheck();

            // Comprovante com forma de pagamento — só quando quem fechou é
            // de fato um CAIXA (mesma distinção de
            // TablesView.handleFinishPayment): as 7 lojas reais (módulo
            // desligado) nunca chegam aqui, e dono/universal fechando pelo
            // bypass de canFinalizeBill não ganham um papel novo do nada.
            // Redesign 2026-08-23: sempre imprime no aparelho de quem
            // fechou — não existe mais "Estação" separada pra evitar
            // duplicar (ver lib/storeModules.ts).
            const isCaixaOperator = loggedUser.role !== 'owner' && loggedUser.role !== 'universal' && loggedUser.permissions?.caixa === true;
            const temImpressoraFisica = await hasActivePrinterForDoc(store.id, 'comprovante');
            if (isCaixaOperator || temImpressoraFisica) {
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
                // Aditivo (2026-08-28, achado ao vivo) — ver mesmo padrão em
                // TablesView.handleFinishPayment.
                enqueueReceiptPrintJobs(store.id, `Comprovante - ${receiptOpts.label}`, (mm) => buildBillReceiptText({ ...receiptOpts, paperWidthMm: mm ?? receiptOpts.paperWidthMm }), undefined, 'comprovante')
                    .catch((e) => console.error('enqueueReceiptPrintJobs falhou:', e));
                // Achado ao vivo na loja Sertão (2026-09-15) — mesmo guard
                // aplicado nos outros call sites de printBillReceipt.
                if (!temImpressoraFisica) {
                    const printed = await printBillReceipt(receiptOpts);
                    if (!printed) {
                        toast.error('O pedido foi fechado, mas o comprovante não imprimiu. Confira a impressora do caixa.');
                    }
                }
            }

            // Cupom fiscal ao fechar — mesmo bloco e mesmo racional de
            // TablesView.handleFinishPayment (reunião 2026-09-10, min 15:06).
            if (emissaoFiscalConfigurada && emitirNotaFiscal) {
                const orderIdParaNota = paymentOrder.id;
                abrirCupomFiscalQuandoSair(store.id, store.name, { orderId: orderIdParaNota });
            }

            setPaymentOrder(null);
            setPagamentoDaNovaVenda(null);
            // No "paga primeiro" o pedido CONTINUA na tela (só mudou pra
            // pago) — sem recarregar, o card seguiria oferecendo "Receber
            // pagamento" de novo até o próximo evento de realtime.
            if (paymentFirst || ehNovaVenda) {
                load();
                if (ehNovaVenda) toast.success('Pagamento recebido. Entregue quando o pedido sair.');
            }
        } catch (e: any) {
            // closeOrderNow já avisa por toast, mas registrarPagamentoBalcao
            // não — e este catch vazio engolia a falha: o operador clicava em
            // "RECEBER PAGAMENTO" com o dinheiro já na mão, NADA acontecia na
            // tela, e ele clicava de novo (achado de revisão independente).
            if (paymentFirst || pagamentoDaNovaVenda === paymentOrder.id) {
                toast.error(e?.message || 'Não consegui registrar o pagamento. Confira antes de cobrar de novo.');
                load();
            }
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
        registrarAcao(store.id, 'reimpressao.comprovante_balcao', { entity: 'order', entityId: order.id, summary: `Imprimiu comprovante do balcão (${order.customer_name || 'sem nome'})` });
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
            enqueueReceiptPrintJobs(store.id, `Conferência - ${receiptOpts.label}`, (mm) => buildBillReceiptText({ ...receiptOpts, paperWidthMm: mm ?? receiptOpts.paperWidthMm }), undefined, 'pre_conta')
                .catch((e) => console.error('enqueueReceiptPrintJobs (conferência balcão) falhou:', e));
            const temImpressoraFisica = await hasActivePrinterForDoc(store.id, 'pre_conta');
            if (!temImpressoraFisica) {
                const printed = await printBillReceipt(receiptOpts);
                if (!printed) {
                    toast.error('O comprovante não imprimiu. Confira a impressora.');
                }
            }
        } catch (e) {
            console.error('printBillReceipt (comprovante de balcão) lançou:', e);
            toast.error('O comprovante não imprimiu. Confira a impressora.');
        }
    };

    const pedidosAbertos = orders.length;

    return (
        <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-[15px] text-[var(--text-muted)]">
                {pedidosAbertos === 0 ? 'Nenhum pedido aberto no balcão' : `${pedidosAbertos} ${pedidosAbertos === 1 ? 'pedido aberto' : 'pedidos abertos'} no balcão`}
            </p>
            <Button size="lg" onClick={() => setShowNovaVenda(true)} className="w-full sm:w-auto !h-12 !px-6 shrink-0">
                <Plus size={20} strokeWidth={2.25} /> Nova venda
            </Button>
        </div>
        <div className="relative grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
            <AnimatePresence mode="popLayout">
            {orders.map(order => {
                // Venda lançada sem internet ainda na fila local: sem id real no
                // servidor, nada de receber/entregar até sincronizar.
                const aguardandoInternet = order.id.startsWith('local_') || order.id.startsWith('pending_order_');
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
                        {...LIST_ITEM_MOTION}
                    >
                    <Card accentColor="var(--brand)" className="flex flex-col p-4 pl-5">
                         <div className="flex justify-between items-start mb-2">
                             <div>
                                 <h3 className="font-bold text-lg text-[var(--text)] flex items-center gap-2">
                                     <User size={18}/> {order.customer_name || 'Cliente'}
                                 </h3>
                                 <span className="text-xs text-[var(--text-muted)]">#{order.id.slice(0,4)} • {new Date(order.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                             </div>
                             <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                 {/* No "paga primeiro" o pedido fica na tela DEPOIS de
                                     pago, esperando sair — sem esse selo, dois pedidos
                                     em estados bem diferentes (pago e não pago) ficariam
                                     visualmente idênticos. */}
                                 {pedidoJaPago(order) && (
                                     <span className="px-2 py-0.5 rounded-full text-[12px] font-medium bg-[var(--ok)]/10 text-[var(--ok)]">
                                         Pago
                                     </span>
                                 )}
                                 {/* Pedido pago que não sai do balcão é dinheiro parado no
                                     turno sem aparecer no Histórico de Vendas (que só conta
                                     'delivered') — o aviso de idade é o que faz o operador
                                     perceber que tem venda pendurada antes de fechar o caixa. */}
                                 {pedidoJaPago(order) && (() => {
                                     // Fix round 1 (revisão independente): a idade tem que vir
                                     // do INSTANTE DO PAGAMENTO (payment_details.pago_em,
                                     // gravado por /api/orders/pagamento-balcao), não da
                                     // criação do pedido — no fluxo "paga primeiro" o pedido
                                     // pode ficar aberto horas antes de o caixa cobrar, e usar
                                     // `created_at` faria um pedido pago há 5 minutos aparecer
                                     // como "pago há 8h". Pedido pago antes desta correção não
                                     // tem `pago_em` — nesse caso mostra "aberto há" (o que
                                     // realmente se sabe), nunca inventa quando foi pago.
                                     const pagoEm = order.payment_details?.pago_em;
                                     const referencia = pagoEm ? new Date(pagoEm) : new Date(order.created_at);
                                     const rotulo = pagoEm ? 'Pago' : 'Aberto';
                                     const minutos = Math.round((Date.now() - referencia.getTime()) / 60000);
                                     if (minutos <= 30) return null;
                                     // Abaixo de 1h, minutos exatos; a partir de 1h, horas
                                     // truncadas + minutos restantes ("1h20") —
                                     // Math.round(minutos/60) fazia qualquer coisa entre 31 e
                                     // 89min virar "1h", subestimando em até quase 3x.
                                     const texto = formatDuration(minutos);
                                     return (
                                         <span className="text-xs font-bold text-[var(--warn)]">
                                             {rotulo} há {texto}
                                         </span>
                                     );
                                 })()}
                                 <span className={`px-2 py-0.5 rounded-full text-[12px] font-medium ${getStatusColor(status)}`}>
                                     {getStatusLabel(status)}
                                 </span>
                             </div>
                         </div>

                         <div className="flex-1 overflow-y-auto max-h-[150px] space-y-1 mb-3 bg-[var(--surface-2)] p-2 rounded-[var(--r-md)] border border-[var(--border)]">
                             {order.order_items?.map((item, idx) => {
                                 const obs = parseItemNote(item.notes || '').observation;
                                 return (
                                     <div key={idx}>
                                         <div className="flex justify-between text-sm text-[var(--text-muted)]">
                                             <span className="truncate flex-1">{item.quantity}x {getOrderItemDisplayName(item)}</span>
                                             <span className="num text-xs">{(item.price_at_time * item.quantity).toFixed(2)}</span>
                                         </div>
                                         {obs && <div className="text-xs font-semibold text-[var(--warn)]">Obs: {obs}</div>}
                                     </div>
                                 );
                             })}
                         </div>

                         <div className="mt-auto pt-3 border-t border-[var(--border)] flex flex-wrap justify-between items-center gap-2">
                             <div className="whitespace-nowrap">
                                 <p className="text-[13px] text-[var(--text-muted)]">Total</p>
                                 <p className="text-[22px] font-semibold text-[var(--text)] num leading-tight">R$ <AnimatedNumber value={total} format={formatBRL} /></p>
                             </div>
                             <Button size="sm" variant="secondary" className="shrink-0 !px-0 w-8 max-sm:!h-11 max-sm:w-11" onClick={() => printCounterReceipt(order)} title="Imprimir comprovante" aria-label="Imprimir comprovante">
                                 <Printer size={15} />
                             </Button>
                             {/* Achado ao vivo (2026-09-10): loja `direct_print` (sem tela de
                                 acompanhamento/KDS) forçava o mesmo "Enviar p/ Cozinha" das
                                 lojas com KDS antes de liberar Receber/Entregar — mas nessa
                                 loja a impressão automática já roda sozinha via
                                 CaixaPrintStation (reconciliação por order_items, nunca por
                                 order.status, ver comentário no topo daquele arquivo) e
                                 isOrderReadyForClose() já retorna true incondicionalmente pra
                                 direct_print. O clique não fazia nada além de atrapalhar —
                                 pedido devia ir direto de "novo" pra "pode receber e
                                 finalizar". */}
                             {/* "Paga primeiro" (André, 2026-09-10): a ordem vira
                                 1) receber pagamento, 2) enviar pra cozinha,
                                 3) pronto, 4) entregar. Numa loja sem KDS (Sertão,
                                 `direct_print`) o passo 2/3 não existe — a impressão
                                 sai sozinha —, então são só 2 passos: pagar → entregar.
                                 `payment_details` é o que diz se já pagou: quem grava é
                                 /api/orders/pagamento-balcao, e fetch_counter_orders_secure
                                 devolve a coluna (select o.*). */}
                             {/* Estorno (Task 5, 2026-09-13, revisão independente): o
                                 fluxo "paga primeiro" deixa o pedido pago e aberto por
                                 minutos — cliente desiste, caixa cobrou o pedido errado,
                                 maquininha recusou depois. Sem isto, a única saída era
                                 mexer no banco à mão. Fica ao lado de "Entregar" (o
                                 caminho inverso dele) e só pra quem tem a MESMA permissão
                                 de receber (`canFinalize`) — quem não pode cobrar também
                                 não pode descobrar. */}
                             {paymentFirst && pedidoJaPago(order) && canFinalize && (
                                 <button
                                     type="button"
                                     onClick={async () => {
                                         if (!(await confirm(`Estornar o pagamento de ${order.customer_name || 'Cliente'}? O pedido volta a aparecer como não pago.`))) return;
                                         // Identidade de quem estorna vai junto: a rota grava o
                                         // evento 'pagamento_estornado' na trilha de auditoria do
                                         // Caixa (migration 074). `null` pra conta universal, mesmo
                                         // critério do resto do projeto (não é linha de store_users).
                                         const identidade = {
                                             storeId,
                                             operatorUserId: loggedUser.role === 'universal' ? null : loggedUser.id,
                                             operatorName: loggedUser.name,
                                         };
                                         try {
                                             const r = await estornarPagamentoBalcao(order.id, identidade);
                                             // Nota fiscal AUTORIZADA desta venda: a rota recusa até
                                             // o operador ver o que fica pra trás. Confirmação
                                             // específica (não o confirm genérico) porque o que está
                                             // em jogo é diferente — o estorno NÃO cancela nada na
                                             // SEFAZ, e o cancelamento tem prazo.
                                             if (r.notaAutorizada) {
                                                 const n = r.notaAutorizada;
                                                 const ident = n.numero
                                                     ? `nº ${n.numero}${n.serie ? `/série ${n.serie}` : ''}`
                                                     : n.chave_acesso
                                                     ? `chave ${n.chave_acesso}`
                                                     : 'já emitida';
                                                 const ok = await confirm({
                                                     message: `Esta venda já tem NOTA FISCAL AUTORIZADA (${ident}${n.chave_acesso && n.numero ? ` — chave ${n.chave_acesso}` : ''}). O estorno NÃO cancela essa nota na SEFAZ: o cancelamento tem que ser feito pelo caminho fiscal, dentro do prazo legal. Estornar mesmo assim?`,
                                                     variant: 'danger',
                                                     confirmLabel: 'Estornar mesmo assim',
                                                 });
                                                 if (!ok) return;
                                                 await estornarPagamentoBalcao(order.id, { ...identidade, confirmarNotaAutorizada: true });
                                             }
                                             toast.success('Pagamento estornado.');
                                             load();
                                         } catch (e: any) {
                                             toast.error(e?.message || 'Não consegui estornar.');
                                         }
                                     }}
                                     className="h-10 px-3 rounded-[var(--r-md)] border border-[var(--border)] text-xs font-bold text-[var(--text-muted)] hover:text-[var(--err)] u-motion shrink-0"
                                     title="Estornar pagamento"
                                 >
                                     Estornar
                                 </button>
                             )}
                             {aguardandoInternet ? (
                                 <span className="h-10 px-3 flex items-center gap-1.5 text-xs font-bold text-[var(--text-muted)] bg-[var(--surface-2)] rounded-full shrink-0">
                                     <WifiOff size={14} /> Aguardando internet
                                 </span>
                             ) : paymentFirst ? (
                                 caixaModuleOn && !canFinalize ? (
                                     <span className="h-10 px-3 flex items-center text-xs font-bold text-[var(--text-muted)] bg-[var(--surface-2)] rounded-[var(--r-md)] border border-[var(--border)] shrink-0">
                                         Aguardando o caixa
                                     </span>
                                 ) : !pedidoJaPago(order) ? (
                                     <Button onClick={() => handleReceberPrimeiro(order.id)} variant="primary" className="h-10 text-sm shrink-0">
                                         <Wallet size={16} className="mr-1"/> Receber pagamento
                                     </Button>
                                 ) : status === OrderStatus.PENDING && orderFlow !== 'direct_print' ? (
                                     <Button onClick={() => handleSendToKitchen(order.id)} variant="primary" className="h-10 text-sm shrink-0">
                                         <ChefHat size={16} className="mr-1"/> Enviar p/ Cozinha
                                     </Button>
                                 ) : (
                                     <Button
                                         onClick={() => handleEntregarPago(order.id)}
                                         variant="primary"
                                         className="h-10 text-sm shrink-0"
                                         disabled={!allItemsReady}
                                         title={!allItemsReady ? 'Aguarde o pedido ficar pronto' : undefined}
                                     >
                                         <CheckCircle size={16} className="mr-1"/> Entregar
                                     </Button>
                                 )
                             ) : status === OrderStatus.PENDING && orderFlow !== 'direct_print' ? (
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
                                     // revisor): este botão aparece pra status != PENDING (ramo
                                     // tratado acima) OU pra qualquer status em loja direct_print
                                     // (2026-09-10, ver comentário acima). Libera só quando todo
                                     // item do pedido estiver READY (ver allItemsReady acima) —
                                     // checar order.status aqui travaria pra sempre numa loja com
                                     // KDS, porque essa coluna nunca chega a PREPARING/READY, só
                                     // order_items.status avança via KDS; isOrderReadyForClose já
                                     // retorna true sempre pra direct_print, então allItemsReady
                                     // nunca bloqueia esse caso.
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
                <div className="col-span-full flex flex-col items-center justify-center text-center py-24 px-6 bg-[var(--surface)] rounded-[var(--r-lg)] shadow-[var(--shadow-sm)]">
                    <Coffee size={40} strokeWidth={1.5} className="mb-3 text-[var(--text-muted)] opacity-50" />
                    <p className="text-[17px] font-semibold text-[var(--text)]">Tudo tranquilo no balcão</p>
                    <p className="text-[13px] text-[var(--text-muted)] mt-1">Toque em “Nova venda” para registrar um pedido de balcão.</p>
                </div>
            )}

            {/* Destinatário (Task 17; 2026-09-21: NF-e ou NFC-e — handleClose
                decide isso antes de abrir). Nome só é usado no <dest> da
                NF-e, ver lib/fiscal/xml.ts. */}
            <Modal isOpen={!!closingOrder} onClose={() => setClosingOrder(null)} title="Fechar Pedido">
                <div className="space-y-4">
                    <div className="bg-[var(--surface-2)] p-4 rounded-[14px] space-y-2">
                        <p className="text-[13px] font-semibold text-[var(--text-muted)]">
                            Documento do destinatário (opcional)
                        </p>
                        <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            className="w-full h-11 px-3 rounded-[var(--r-md)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 text-base sm:text-[15px]"
                            placeholder="CPF ou CNPJ do cliente"
                            value={destCpfCnpj}
                            onChange={(e) => setDestCpfCnpj(e.target.value)}
                        />
                        {nfeModeloAtivo && (
                            <input
                                type="text"
                                className="w-full h-11 px-3 rounded-[var(--r-md)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 text-base sm:text-[15px]"
                                placeholder="Nome do cliente"
                                value={destNome}
                                onChange={(e) => setDestNome(e.target.value)}
                            />
                        )}
                        <p className="text-xs text-[var(--text-muted)]">
                            {nfeModeloAtivo
                                ? 'Deixe em branco pra fechar o pedido sem emitir a NF-e agora — dá pra preencher e reemitir depois na aba "Notas Fiscais".'
                                : 'Aparece no cupom fiscal, se informado. Deixar em branco não muda nada.'}
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
            <Modal isOpen={!!paymentOrder} onClose={() => { setPaymentOrder(null); setPagamentoDaNovaVenda(null); }} title="Receber pagamento" size="lg">
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
                    // No "paga primeiro" este botão NÃO finaliza a venda —
                    // o pedido ainda vai ser preparado e entregue depois.
                    finishLabel={paymentFirst || (!!paymentOrder && pagamentoDaNovaVenda === paymentOrder.id) ? "Receber pagamento" : "Finalizar venda"}
                    showEmitirNotaToggle={emissaoFiscalConfigurada}
                    emitirNota={emitirNotaFiscal}
                    onEmitirNotaChange={setEmitirNotaFiscal}
                >
                    {/* Destinatário (Task 17; 2026-09-21: NF-e ou NFC-e) —
                        mesma posição/campos que TablesView usa. */}
                    {(nfeModeloAtivo || nfceModeloAtivo) && (
                        <div className="bg-[var(--surface-2)] p-4 rounded-[14px] space-y-2">
                            <p className="text-[13px] font-semibold text-[var(--text-muted)]">
                                Documento do destinatário (opcional)
                            </p>
                            <input
                                type="text"
                                inputMode="numeric"
                                autoComplete="off"
                                className="w-full h-11 px-3 rounded-[var(--r-md)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 text-base sm:text-[15px]"
                                placeholder="CPF ou CNPJ do cliente"
                                value={destCpfCnpj}
                                onChange={(e) => setDestCpfCnpj(e.target.value)}
                            />
                            {nfeModeloAtivo && (
                                <input
                                    type="text"
                                    className="w-full h-11 px-3 rounded-[var(--r-md)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 text-base sm:text-[15px]"
                                    placeholder="Nome do cliente"
                                    value={destNome}
                                    onChange={(e) => setDestNome(e.target.value)}
                                />
                            )}
                            <p className="text-xs text-[var(--text-muted)]">
                                {nfeModeloAtivo
                                    ? 'Deixe em branco pra fechar o pedido sem emitir a NF-e agora — dá pra preencher e reemitir depois na aba "Notas Fiscais".'
                                    : 'Aparece no cupom fiscal, se informado. Deixar em branco não muda nada.'}
                            </p>
                        </div>
                    )}
                </PaymentCaptureFields>
            </Modal>
        </div>

            {/* Nova venda no balcão: mesma superfície do garçom (folha no
                celular, janela grande no computador), cardápio em camadas à
                esquerda e o carrinho desta venda à direita. */}
            <WaiterOrderSurface
                isOpen={showNovaVenda}
                onClose={fecharNovaVenda}
                ariaLabel="Nova venda no balcão"
                title="Nova venda no balcão"
            >
                <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
                    <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden px-5 pb-2">
                        <StoreTableMenu storeId={storeId} onAddItem={adicionarNaVenda} addLabel="Adicionar à venda" podeEsgotar={roleCanOr(loggedUser, store, 'esgotar', loggedUser.role === 'manager' || hasTabPermission(loggedUser, 'menu', store))} />
                    </div>
                    <div className="md:w-[320px] lg:w-[34%] lg:max-w-[420px] max-md:max-h-[50%] flex-shrink-0 border-t md:border-t-0 md:border-l border-[var(--border)] bg-[var(--surface-2)] flex flex-col min-h-0 overflow-hidden">
                        <div className="px-4 pt-4 pb-2 flex items-baseline justify-between flex-shrink-0">
                            <h4 className="font-semibold text-[15px] text-[var(--text)]">Itens desta venda</h4>
                            <span className="text-[13px] text-[var(--text-muted)] num">{vendaQtd} {vendaQtd === 1 ? 'item' : 'itens'}</span>
                        </div>
                        <div className="flex-1 overflow-y-auto min-h-[72px] px-3">
                            {vendaItens.length === 0 ? (
                                <div className="p-6 text-center text-[13px] text-[var(--text-muted)]">Escolha os produtos no cardápio. Eles aparecem aqui antes de enviar.</div>
                            ) : (
                                <div className="bg-[var(--surface)] rounded-[14px] divide-y divide-[var(--border)] overflow-hidden">
                                    {vendaItens.map(l => {
                                        const unit = calculateCartItemUnitPrice({ product: l.product, selectedOptions: l.selectedOptions });
                                        return (
                                            <div key={l.key} className="flex items-center gap-2 pl-4 pr-1.5 py-2.5">
                                                <div className="min-w-0 flex-1">
                                                    <div className="font-semibold text-[15px] text-[var(--text)] leading-tight line-clamp-2">{getOrderItemDisplayName({ product: l.product, selected_options: l.selectedOptions })}</div>
                                                    {l.notes && <div className="text-[13px] font-medium text-[var(--warn)] mt-0.5 line-clamp-2">Obs: {l.notes}</div>}
                                                    <div className="text-[13px] text-[var(--text-muted)] mt-0.5 num">R$ {formatBRL(unit * l.qty)}</div>
                                                </div>
                                                <div className="flex items-center gap-0.5 flex-shrink-0">
                                                    <button type="button" onClick={() => mudarQtdVenda(l.key, -1)} disabled={l.qty <= 1} aria-label={`Diminuir ${l.product.name}`} className="w-8 h-8 max-sm:w-9 max-sm:h-9 grid place-items-center rounded-full bg-[var(--surface-2)] text-[var(--brand)] disabled:opacity-40 u-motion u-press-sm max-sm:min-h-11 max-sm:min-w-11"><Minus size={15} /></button>
                                                    <span className="font-semibold text-[15px] num w-7 text-center">{l.qty}</span>
                                                    <button type="button" onClick={() => mudarQtdVenda(l.key, 1)} aria-label={`Aumentar ${l.product.name}`} className="w-8 h-8 max-sm:w-9 max-sm:h-9 grid place-items-center rounded-full bg-[var(--surface-2)] text-[var(--brand)] u-motion u-press-sm max-sm:min-h-11 max-sm:min-w-11"><Plus size={15} /></button>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removerDaVenda(l.key)}
                                                    className="relative hit-44 w-8 h-8 grid place-items-center rounded-full text-[var(--text-muted)]/70 hover:text-[var(--err)] hover:bg-[var(--err)]/10 u-motion u-press flex-shrink-0"
                                                    title="Remover item"
                                                    aria-label={`Remover ${l.product.name}`}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3 max-md:space-y-2.5 flex-shrink-0 border-t border-[var(--border)]">
                            <input
                                type="text"
                                value={vendaCliente}
                                onChange={e => setVendaCliente(e.target.value)}
                                placeholder="Nome do cliente (opcional)"
                                aria-label="Nome do cliente (opcional)"
                                maxLength={60}
                                autoComplete="off"
                                className="w-full h-11 px-4 rounded-full bg-[var(--surface)] text-[var(--text)] placeholder:text-[var(--text-muted)] text-base sm:text-[15px] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40"
                            />
                            {/* No celular o total já está no botão — a linha some pra sobrar espaço pros itens. */}
                            <div className="flex items-baseline justify-between max-md:hidden">
                                <span className="font-medium text-[15px] text-[var(--text-muted)]">Total</span>
                                <span className="font-bold text-[28px] max-md:text-[22px] num tracking-[-0.02em] text-[var(--text)]">R$ <AnimatedNumber value={vendaTotal} format={formatBRL} /></span>
                            </div>
                            <Button
                                size="lg"
                                className="w-full !h-[52px] !text-[17px]"
                                disabled={vendaItens.length === 0}
                                isLoading={enviandoVenda}
                                onClick={enviarVenda}
                            >
                                Enviar pedido · R$ {formatBRL(vendaTotal)}
                            </Button>
                        </div>
                    </div>
                </div>
            </WaiterOrderSurface>

            {/* Logo depois de enviar: receber na hora ou deixar pro caixa. */}
            <Modal isOpen={!!vendaEnviada} onClose={() => setVendaEnviada(null)} title={vendaEnviada?.offline ? 'Venda salva sem internet' : 'Venda enviada'} size="sm">
                {vendaEnviada && (
                    <div className="space-y-5">
                        <div className="text-center pt-1">
                            <p className="text-[13px] font-medium text-[var(--text-muted)]">{vendaEnviada.cliente ? `Balcão · ${vendaEnviada.cliente}` : 'Balcão'}</p>
                            <p className="text-[40px] leading-tight font-bold num tracking-[-0.02em] text-[var(--text)] mt-0.5">R$ {formatBRL(vendaEnviada.total)}</p>
                        </div>
                        {vendaEnviada.offline ? (
                            <>
                                <div className="flex gap-3 bg-[var(--surface-2)] rounded-[14px] p-4">
                                    <WifiOff size={20} className="text-[var(--warn)] flex-shrink-0 mt-0.5" />
                                    <p className="text-[14px] text-[var(--text)]">Sem internet agora. A venda ficou guardada neste aparelho e entra no sistema sozinha quando a conexão voltar. Receba o pagamento depois, com internet.</p>
                                </div>
                                <Button size="lg" className="w-full !h-[52px]" onClick={() => setVendaEnviada(null)}>Entendi</Button>
                            </>
                        ) : (
                            <>
                                <p className="text-[14px] text-[var(--text-muted)] text-center">O cliente vai pagar agora?</p>
                                <div className="space-y-2.5">
                                    <Button size="lg" className="w-full !h-[52px] !text-[17px]" onClick={receberVendaAgora}>
                                        <Wallet size={20} /> Receber agora
                                    </Button>
                                    <Button size="lg" variant="secondary" className="w-full !h-[52px] !text-[17px]" onClick={() => { setVendaEnviada(null); toast.info('A venda ficou em "Aguardando pagamento".'); }}>
                                        Receber depois
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                )}
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
const CaixaViewMeu: React.FC<{
    store: Store;
    loggedUser: StoreUser;
    onOpenTablePayment: (tableId: string) => void;
    onOpenCounterPayment: (orderId: string) => void;
}> = ({ store, loggedUser, onOpenTablePayment, onOpenCounterPayment }) => {
    const storeId = store.id;
    const serviceFeeRate = resolveServiceFeeRate(store.config);
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
        const [t, o, c, pendingOrders] = await Promise.all([
            fetchTables(storeId),
            fetchActiveOrdersForTables(storeId),
            fetchCounterOrders(storeId),
            buildPendingOrdersForStore(storeId),
        ]);
        setTables(t);
        publicarMesas(storeId, t);
        // Mesmo achado/fix de TablesView.loadData — sem isso, a lista
        // "Mesas ocupadas" do Caixa também "esquece" um pedido lançado
        // offline sempre que este componente remonta.
        setActiveOrders([...o, ...(pendingOrders as Order[])]);
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
    usePolling(() => { loadQueue(); loadShift(); });

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
                                {historySummary.payments_count != null && (
                                    <div className="grid grid-cols-3 gap-3 text-sm">
                                        <div className="rounded-xl border border-[var(--border)] px-3 py-2">
                                            <p className="text-[var(--text-muted)]">Contas pagas</p>
                                            <p className="num font-bold text-[var(--text)]">{historySummary.payments_count}</p>
                                        </div>
                                        <div className="rounded-xl border border-[var(--border)] px-3 py-2">
                                            <p className="text-[var(--text-muted)]">Total vendido</p>
                                            <p className="num font-bold text-[var(--text)]">R$ {formatBRL(Number(historySummary.payments_total) || 0)}</p>
                                        </div>
                                        <div className="rounded-xl border border-[var(--border)] px-3 py-2">
                                            <p className="text-[var(--text-muted)]">Ticket médio</p>
                                            <p className="num font-bold text-[var(--text)]">{ticketMedio(historySummary.payments_total, historySummary.payments_count) != null ? `R$ ${formatBRL(ticketMedio(historySummary.payments_total, historySummary.payments_count) as number)}` : '—'}</p>
                                        </div>
                                    </div>
                                )}
                                <div className="space-y-1.5">
                                    <h4 className="text-[13px] font-semibold text-[var(--text-muted)]">
                                        Total por forma de pagamento
                                    </h4>
                                    {false ? (
                                        <p className="text-sm text-[var(--text-muted)]">Nenhum pagamento registrado neste turno.</p>
                                    ) : (
                                        <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
                                            {completarFormas(historySummary.totals_by_method).map(({ key: method, total }) => (
                                                <div key={method} className="flex items-center justify-between px-3 py-2 text-sm">
                                                    <span className="text-[var(--text)]">{getPaymentMethodLabel(method)}</span>
                                                    <span className="num font-bold text-[var(--text)]">R$ {formatBRL(total)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                {(historySummary.totals_by_card || Object.keys(historySummary.totals_by_brand).length > 0) && (
                                    <div className="space-y-1.5">
                                        <h4 className="text-[13px] font-semibold text-[var(--text-muted)]">
                                            Cartões: crédito e débito por bandeira
                                        </h4>
                                        <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
                                            {(historySummary.totals_by_card ? completarCartoes(historySummary.totals_by_card).map((c) => [c.label, c.total] as [string, number]) : Object.entries(historySummary.totals_by_brand).map(([b, t]) => [getCardBrandLabel(b), t] as [string, number])).map(([brand, total]) => (
                                                <div key={brand} className="flex items-center justify-between px-3 py-2 text-sm">
                                                    <span className="text-[var(--text)]">{brand}</span>
                                                    <span className="num font-bold text-[var(--text)]">R$ {formatBRL(total)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div className="rounded-xl border border-[var(--border)] px-3 py-2">
                                        <p className="text-[var(--text-muted)] flex items-center gap-1"><TrendingDown size={12} /> Sangrias</p>
                                        <p className="num font-bold text-[var(--text)]">R$ {formatBRL(historySummary.total_sangria)}</p>
                                    </div>
                                    <div className="rounded-xl border border-[var(--border)] px-3 py-2">
                                        <p className="text-[var(--text-muted)] flex items-center gap-1"><TrendingUp size={12} /> Suprimentos</p>
                                        <p className="num font-bold text-[var(--text)]">R$ {formatBRL(historySummary.total_suprimento)}</p>
                                    </div>
                                </div>
                                <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3 flex items-center justify-between">
                                    <span className="text-sm font-bold text-[var(--text)]">Esperado em dinheiro</span>
                                    <span className="num font-bold text-lg text-[var(--text)]">R$ {formatBRL(historySummary.expected_cash)}</span>
                                </div>
                                {historySummary.closing_counted_cash !== null && (
                                    <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3 flex items-center justify-between">
                                        <span className="text-sm font-bold text-[var(--text)]">Contado na gaveta</span>
                                        <span className="num font-bold text-lg text-[var(--text)]">R$ {formatBRL(historySummary.closing_counted_cash)}</span>
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
                                        <span className="num font-bold text-lg text-[var(--text)]">
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
                                            : ev.event_type === 'pagamento_estornado'
                                            // Migration 074: sem este branch o estorno cairia no
                                            // "Cancelou item" genérico (mesmo bug do achado #1 acima).
                                            ? `Estornou pagamento de R$ ${formatBRL(Number(ev.details?.valor) || 0)} do pedido #${String(ev.details?.order_id || '').slice(0, 4)}${ev.details?.nota_autorizada_id ? ' (venda com nota fiscal autorizada — não cancelada na SEFAZ)' : ''}`
                                            : `Cancelou "${ev.details?.produto || 'item'}"`}
                                    </p>
                                    {/* `resultado: 'incerto'` (app/api/orders/pagamento-balcao):
                                        o estorno foi tentado, o rastro foi gravado, mas a
                                        resposta do banco se perdeu — pode ter aplicado ou não.
                                        Sem este aviso a linha ficava IDÊNTICA a um estorno
                                        confirmado, e o motivo de manter o evento (avisar quem
                                        audita que aquele pedido precisa ser conferido à mão)
                                        não chegava em ninguém. */}
                                    {ev.event_type === 'pagamento_estornado' && ev.details?.resultado === 'incerto' && (
                                        <p className="mt-1 inline-flex items-center gap-1 rounded-[var(--r-sm)] bg-[var(--warn)]/10 px-2 py-0.5 text-[11px] font-bold text-[var(--warn)] border border-[var(--warn)]/30">
                                            <AlertTriangle size={12} /> Não confirmado — conferir o pedido
                                        </p>
                                    )}
                                    <p className="text-[11px] text-[var(--text-muted)]">{new Date(ev.created_at).toLocaleString('pt-BR')}</p>
                                </div>
                                <Badge color={
                                    ev.event_type === 'sangria_grande' ? 'bg-[var(--warn)]/10 text-[var(--warn)]'
                                    : ev.event_type === 'tolerancia_excedida' ? 'bg-[var(--warn)]/10 text-[var(--warn)]'
                                    : 'bg-[var(--err)]/10 text-[var(--err)]'
                                }>
                                    {ev.event_type === 'sangria_grande' ? 'Sangria' : ev.event_type === 'tolerancia_excedida' ? 'Tolerância excedida' : ev.event_type === 'pagamento_estornado' ? 'Estorno' : 'Cancelamento'}
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
                // Posição do caixa impressa sozinha ao fechar (pedido do Ramon, 2026-09-29). Nunca impede o fechamento.
                if (closeSummary) try {
                    const resumo = closeSummary;
                    const dados = {
                        storeName: store.name,
                        operador: loggedUser.name,
                        abertoEm: new Date(shift.opened_at),
                        fechadoEm: new Date(),
                        fundo: Number(shift.opening_float) || 0,
                        formas: completarFormas(resumo.totals_by_method).map(({ label, total }) => ({ label, total })),
                        cartoes: resumo.totals_by_card
                            ? completarCartoes(resumo.totals_by_card)
                            : Object.entries(resumo.totals_by_brand).map(([b, total]) => ({ label: getCardBrandLabel(b), total: Number(total) || 0 })),
                        vendas: resumo.payments_count != null ? { contas: Number(resumo.payments_count) || 0, total: Number(resumo.payments_total) || 0, ticketMedio: ticketMedio(resumo.payments_total, resumo.payments_count) } : null,
                        sangria: Number(resumo.total_sangria) || 0,
                        suprimento: Number(resumo.total_suprimento) || 0,
                        dinheiroEsperado: Number(resumo.expected_cash) || 0,
                        dinheiroContado: closingCountedValue,
                        diferenca: result.difference ?? (closingCountedValue - (Number(resumo.expected_cash) || 0)),
                        taxaServico: resumo.service_fee_total != null ? { quantidade: Number(resumo.service_fee_count) || 0, total: Number(resumo.service_fee_total) || 0 } : null,
                        outrasTaxas: Object.entries(resumo.fees_by_product ?? {})
                            .filter(([, t]) => t.tipo === 'fixed')
                            .map(([label, t]) => ({ label, quantidade: Number(t.quantidade) || 0, total: Number(t.total) || 0 })),
                    };
                    enqueueReceiptPrintJobs(store.id, `Fechamento de caixa - ${loggedUser.name}`, (mm) => buildCashClosingText({ ...dados, paperWidthMm: mm ?? store.config?.printer_paper_width_mm }), `fechamento:${shift.id}`, 'fechamento_caixa')
                        .catch((e) => console.error('enqueueReceiptPrintJobs (fechamento de caixa) falhou:', e));
                } catch (e) {
                    console.error('montar posição do caixa falhou (o caixa já foi fechado):', e);
                }
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
    // pagamento. O critério do balcão depende do fluxo da loja (ver o filtro
    // comentado abaixo): o que entra aqui é sempre "o que o caixa ainda tem
    // pra receber". Ordenada por tempo de espera, mais antigo primeiro.
    const queueItems = useMemo(() => {
        const tableItems = tables
            .filter(t => t.status === TableStatus.WAITING_BILL)
            // Pedido direto do dono (reunião 2026-09-10, min 18:00): na aba
            // Caixa, mesa fora da jurisdição não deve nem APARECER — "ele não
            // precisa nem ver isso aqui". Diferente de TablesView, onde
            // continua visível de propósito (lá o garçom precisa enxergar o
            // salão inteiro pra saber o que está ocupado).
            .filter(t => isTableInJurisdiction(loggedUser, t.id))
            .map(t => {
                const tableOrders = activeOrders.filter(o => o.table_id === t.id);
                const items = tableOrders.flatMap(o => (o.order_items || []).filter(i => i.status !== 'canceled'));
                const subtotal = items.reduce((s, i) => s + i.price_at_time * i.quantity, 0);
                const total = calculateOrderTotal(subtotal, !!store.config?.charge_service_fee, serviceFeeRate, t.service_fee_removed || contaTemTaxaPercentual(items));
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
            // Achado ao vivo (2026-09-13, testando o balcão "paga primeiro"):
            // a regra era só "não pendente", e pedido de balcão NASCE
            // pendente. Numa loja `direct_print` (Sertão) nada nunca é
            // enviado pra cozinha, então ele nunca deixa de ser pendente —
            // ou seja, venda de balcão jamais aparecia na fila do Caixa
            // daquela loja. É a mesma razão pela qual isOrderReadyForClose
            // devolve true direto pra direct_print: ali o pedido já nasce
            // pronto pra receber.
            // No "paga primeiro" a fila muda de sentido: mostra o que falta
            // RECEBER. Pedido já pago some daqui (está esperando a entrega,
            // não o caixa) — senão o caixa cobraria duas vezes.
            .filter(o => {
                // PEDIDO JÁ PAGO NUNCA ENTRA NESTA FILA, em configuração
                // NENHUMA (Important #1 da revisão final, 2026-09-13 — ver
                // `isCounterOrderPaid` em lib/storeModules.ts pro achado
                // completo). Antes esta checagem estava presa a
                // `isCounterPaymentFirst + módulo Caixa`; com a chave
                // desligada (todas as lojas de hoje) e `direct_print` a linha
                // seguinte devolvia `true` pra qualquer pedido, então um
                // pedido pago e pendurado aparecia AQUI ("a receber") e no
                // card "Pago e ainda não entregue" ao mesmo tempo. As duas
                // telas agora perguntam a mesma coisa pelo mesmo predicado.
                if (isCounterOrderPaid(o)) return false;
                if (isCounterPaymentFirst(store) && resolveStoreModules(store).caixa) return true;
                if (orderFlow === 'direct_print') return true;
                return o.status !== OrderStatus.PENDING;
            })
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
    }, [tables, activeOrders, counterOrders, store, serviceFeeRate, loggedUser]);

    // Fase 2, Task 4 (plano "Fora do Cardápio"): achado real da auditoria —
    // a fila acima só mostra mesa em WAITING_BILL. Numa loja sem
    // acompanhamento de pedido (direct_print), o Caixa é o único humano
    // olhando pra tela e não tinha NENHUMA visão de quais mesas estão
    // ocupadas comendo agora, só das que já pediram a conta. Mesma fonte de
    // dado que queueItems (tables/activeOrders), sem query nova.
    const occupiedTables = useMemo(() => {
        return tables
            .filter(t => t.status === TableStatus.OCCUPIED || t.status === TableStatus.WAITING_BILL)
            // Mesmo motivo do filtro em queueItems (reunião 2026-09-10,
            // min 18:10): "essas mesas que estão ocupadas, isso aqui ele não
            // precisa ver".
            .filter(t => isTableInJurisdiction(loggedUser, t.id))
            .map(t => {
                const tableOrders = activeOrders.filter(o => o.table_id === t.id);
                const items = tableOrders.flatMap(o => (o.order_items || []).filter(i => i.status !== 'canceled'));
                const subtotal = items.reduce((s, i) => s + i.price_at_time * i.quantity, 0);
                const total = calculateOrderTotal(subtotal, !!store.config?.charge_service_fee, serviceFeeRate, t.service_fee_removed || contaTemTaxaPercentual(items));
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
                        .filter(i => !ehTaxa(i.product) && (i.product?.destination === 'kitchen' || i.product?.destination === 'bar'))
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
    }, [tables, activeOrders, store, serviceFeeRate, now, orderFlow, printedRefreshNonce, loggedUser]);

    const rushMode = rushModeManual ?? (occupiedTables.length >= RUSH_THRESHOLD);

    const formatWaitingLabel = (waitingSince: number): string => {
        const minutes = Math.max(0, Math.round((now - waitingSince) / 60000));
        if (minutes < 1) return 'agora mesmo';
        return `há ${formatDuration(minutes)}`;
    };

    // Fase 3, Task 8: mesmo mecanismo de `handleManualReprint` em TablesView
    // ("Pedidos do Dia") — reimprime UM item pendente e marca no dedupe
    // local, fazendo-o sumir da lista de "aguardando preparo" desta mesa.
    const handleReprintPending = async (item: { id: string; orderId: string; tableNumber: number | string; productName: string; quantity: number; destination: 'kitchen' | 'bar'; addons?: string; observation?: string; client?: string | null }) => {
        if (!canReprintPending || reprintingPendingIds.has(item.id)) return;
        registrarAcao(storeId, 'reimpressao.pedido_pendente', { entity: 'order_item', entityId: item.id, summary: `Reimprimiu pedido pendente: ${item.quantity}x ${item.productName} (mesa ${item.tableNumber})` });
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
                        <span className="num font-bold text-lg text-[var(--text)]">R$ {formatBRL(closedResultDifference.expected)}</span>
                    </div>
                    <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3 flex items-center justify-between">
                        <span className="text-sm font-bold text-[var(--text)]">Total contado</span>
                        <span className="num font-bold text-lg text-[var(--text)]">R$ {formatBRL(closedResultDifference.counted)}</span>
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
                        <span className="num font-bold text-lg text-[var(--text)]">
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
    // lugar que o operador vê ao entrar. 2026-09-22 (pedido direto: "caixa
    // individual, login por pessoa, fica bonito no topo caixa de tal
    // pessoa"): personalizado com nome + medalhão de quem vai abrir —
    // ProductThumb (mesmo componente/paleta do resto do app, hue por hash
    // do nome) em vez de inventar um avatar novo.
    if (!shift) {
        const primeiroNome = loggedUser.name.trim().split(/\s+/)[0];
        // Materializa (escala+opacidade), não desliza — mesmo padrão já
        // validado neste arquivo pra cards que "chegam" na tela (ex.:
        // TablesView, grid de mesas) em vez de inventar uma 3ª entrada.
        return (
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={SPRING_TAP} className="max-w-md mx-auto py-8">
                <Card className="p-6 text-center border-2 border-[var(--warn)]/30 bg-[var(--warn)]/5">
                    <div className="mx-auto mb-3 w-16 h-16">
                        <ProductThumb src={loggedUser.photo_url} name={loggedUser.name} size="store" />
                    </div>
                    <h3 className="text-lg font-bold text-[var(--text)] mb-1 tracking-[-0.01em]">Abrir caixa, {primeiroNome}</h3>
                    <p className="text-sm text-[var(--text-muted)] mb-6">
                        Informe o fundo de troco (dinheiro físico já na gaveta) pra começar a receber pagamentos —
                        o turno fica só seu, outros operadores podem abrir o deles ao mesmo tempo.
                    </p>
                    <div className="text-left space-y-3">
                        <label className="block text-[13px] font-semibold text-[var(--text-muted)]">
                            Fundo de troco
                        </label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] font-semibold">R$</span>
                            <input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="0.01"
                                className="w-full h-12 pl-11 pr-4 rounded-[14px] bg-[var(--surface-2)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 font-semibold text-lg num"
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
                            className="w-full h-12 text-lg font-bold bg-[var(--ok-fill)] hover:bg-[var(--ok)]/90 text-white"
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
            </motion.div>
        );
    }

    // Turno aberto — Passo 1: fila consolidada; resumo + Fechar Caixa.
    // Duração do turno formatada ("2h 14min" / "38min" / "11d 21h" pra um
    // turno esquecido aberto há dias) — usa o mesmo `now` que já reticka a
    // cada 30s pra fila (declarado no topo do componente), sem intervalo
    // novo só pra isto. Achado real ao vivo (2026-09-22): sem o corte por
    // dia, um turno esquecido de 11 dias mostrava "283h 8min" (técnicamente
    // certo, mas ilegível) ao lado de "Aberto às 21:19" — que também não
    // dizia a DATA, então parecia "hoje às 21:19", quando era 11 dias atrás.
    const abertoEm = new Date(shift.opened_at);
    const minutosAbertos = Math.max(0, Math.floor((now - abertoEm.getTime()) / 60000));
    const horasAbertas = Math.floor(minutosAbertos / 60);
    const duracaoLabel = formatDuration(minutosAbertos);
    // "Aberto hoje às HH:MM" só quando é mesmo hoje; senão a data completa,
    // pra nunca parecer que um turno de dias atrás foi aberto agora.
    const abertoHoje = abertoEm.toDateString() === new Date(now).toDateString();
    const abertoLabel = abertoHoje
        ? `Aberto às ${abertoEm.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : `Aberto em ${abertoEm.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} às ${abertoEm.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    // Turno esquecido (>24h) é um problema operacional de verdade — contagem
    // cega/fechamento de caixa desatualizando por dias. Só avisa (cor de
    // atenção), nunca fecha sozinho: fechar caixa mexe em dinheiro real,
    // só quem está na loja decide.
    const turnoEsquecido = horasAbertas >= 24;

    return (
        <div className="space-y-6">
            {/* 2026-09-22 (pedido direto: "caixa individual, fica bonito no topo
                caixa de tal pessoa"): o nome do operador virou o título
                principal do cabeçalho (antes era só "Caixa aberto desde HH:MM",
                sem dizer de quem — cada operador tem o próprio turno desde a
                migration 062, mas a tela nunca mostrava isso). Medalhão via
                ProductThumb, mesma paleta/hash do resto do app. */}
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={SPRING_TAP}>
            <Card className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 shrink-0 rounded-full overflow-hidden"><ProductThumb src={loggedUser.photo_url} name={loggedUser.name} size="cart" /></div>
                    <div className="min-w-0">
                        <p className="text-[17px] font-semibold text-[var(--text)] truncate tracking-[-0.01em]">Caixa de {loggedUser.name}</p>
                        <p className="text-[13px] text-[var(--text-muted)]">
                            {abertoLabel}
                            {' · '}<span className="num">{duracaoLabel}</span>
                            {turnoEsquecido && <span className="text-[var(--warn)] font-medium"> — esqueceu de fechar?</span>}
                            {' · '}Fundo <span className="num">R$ {formatBRL(shift.opening_float)}</span>
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <Button onClick={() => handleOpenMovementModal('sangria')} variant="secondary" className="shrink-0 max-sm:h-11">
                        <TrendingDown size={16} /> Sangria
                    </Button>
                    <Button onClick={() => handleOpenMovementModal('suprimento')} variant="secondary" className="shrink-0 max-sm:h-11">
                        <TrendingUp size={16} /> Suprimento
                    </Button>
                    <Button onClick={handleCloseShiftClick} variant="secondary" className="shrink-0 max-sm:h-11">
                        <Lock size={16} /> Fechar caixa
                    </Button>
                    <Button onClick={handleOpenHistory} variant="secondary" className="shrink-0 !w-9 !h-9 !px-0 max-sm:!w-11 max-sm:!h-11 text-[var(--text-muted)]" title="Ver histórico de turnos" aria-label="Ver histórico de turnos">
                        <History size={16} />
                    </Button>
                    <Button onClick={() => { setShowAuditModal(true); loadAuditEvents(); }} variant="secondary" className="shrink-0 !w-9 !h-9 !px-0 max-sm:!w-11 max-sm:!h-11 text-[var(--text-muted)]" title="Ver Auditoria" aria-label="Ver auditoria">
                        <Shield size={16} />
                    </Button>
                </div>
            </Card>
            </motion.div>

            {occupiedTables.length > 0 && (
                <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="eyebrow">
                            Mesas ocupadas ({occupiedTables.length})
                        </h3>
                        <button
                            onClick={() => setRushModeManual(prev => prev === null ? !rushMode : !prev)}
                            className={`relative hit-44 text-[12px] font-semibold px-3 h-7 rounded-full u-motion u-press-sm ${rushMode ? 'bg-[var(--brand-soft)] text-[var(--brand)]' : 'bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                            title="Simplifica a visão sob carga alta — liga sozinho a partir de 6 mesas"
                        >
                            {rushMode ? '⚡ Modo Rush ligado' : 'Modo Rush'}
                        </button>
                    </div>
                    {/* Liquid glass (2026-09-22, pedido direto: "estilo Apple, liquid
                        glass, bonito"): backdrop-blur + tinta translúcida um
                        pouco mais forte que antes (5%→12%) pra sobreviver ao
                        blur sem ficar chapado, sombra mais funda (material
                        "mais grosso" — apple-design §12) e um traço claro no
                        topo (luz batendo no vidro). Cor semântica por urgência
                        (ok/warn/err conforme minutos ocupados) continua
                        intacta — é informação, não decoração. */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={SPRING_TAP}
                        className={`grid gap-2 ${rushMode ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'}`}
                    >
                        {occupiedTables.map(t => {
                            // Redesign estilo Apple (2026-09-26): cartão branco; a urgência
                            // (ok/warn/err conforme minutos ocupados) virou ponto + cor do tempo.
                            const urgency = t.minutesOccupied >= 60 ? 'var(--err)' : t.minutesOccupied >= 30 ? 'var(--warn)' : 'var(--ok)';
                            const cardCls = 'bg-[var(--surface)] rounded-[var(--r-lg)] shadow-[var(--shadow-sm)]';
                            if (rushMode) {
                                return (
                                    <button
                                        key={t.id}
                                        onClick={() => onOpenTablePayment(t.id)}
                                        className={`text-left px-3 py-2.5 u-motion u-press-sm hover:shadow-[var(--shadow-md)] ${cardCls}`}
                                    >
                                        <span className="flex items-center gap-1.5 font-semibold text-[15px] text-[var(--text)]">
                                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: urgency }} aria-hidden />
                                            Mesa {t.number}
                                        </span>
                                        <span className="block text-[13px] num text-[var(--text-muted)] mt-0.5">R$ {formatBRL(t.total)}</span>
                                    </button>
                                );
                            }
                            return (
                                <div key={t.id} className={`overflow-hidden ${cardCls}`}>
                                    <button
                                        onClick={() => onOpenTablePayment(t.id)}
                                        className="w-full text-left p-4 max-sm:p-3.5 u-motion u-press-sm hover:bg-[var(--surface-2)]/50"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="flex items-center gap-1.5 font-semibold text-[17px] text-[var(--text)] min-w-0">
                                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.isWaitingBill ? 'var(--warn)' : urgency }} aria-hidden />
                                                <span className="truncate">Mesa {t.number}</span>
                                            </span>
                                            <span className="text-[12px] num shrink-0" style={{ color: urgency }}>{formatDuration(t.minutesOccupied)}</span>
                                        </div>
                                        <p className="text-[13px] text-[var(--text-muted)] truncate mt-0.5">{t.hostName || '—'}</p>
                                        <p className="text-[20px] font-semibold num text-[var(--text)] mt-1.5 leading-tight">R$ {formatBRL(t.total)}</p>
                                        {t.isWaitingBill && <p className="text-[12px] font-medium text-[var(--warn)] mt-1">Aguardando pagamento</p>}
                                    </button>
                                    {/* Fase 3, Task 8: "a sala de controle também é a cozinha" — só
                                        existe em loja `direct_print` (sem KDS); dá o mesmo "eu sei o
                                        que tá sendo preparado agora" que uma loja com KDS já tem. */}
                                    {t.pendingPrintItems.length > 0 && (
                                        <div className="border-t border-[var(--border)] px-4 max-sm:px-3.5 py-2.5 space-y-1">
                                            <p className="text-[12px] font-medium text-[var(--text-muted)]">
                                                {t.pendingPrintItems.length === 1 ? '1 item aguardando preparo' : `${t.pendingPrintItems.length} itens aguardando preparo`}
                                            </p>
                                            {t.pendingPrintItems.map(item => (
                                                <div key={item.id} className="flex items-center justify-between gap-2 text-[13px]">
                                                    <span className="text-[var(--text)] truncate"><span className="text-[var(--text-muted)] num">{item.quantity}×</span> {item.productName}</span>
                                                    {canReprintPending && (
                                                        <button
                                                            type="button"
                                                            disabled={reprintingPendingIds.has(item.id)}
                                                            onClick={() => handleReprintPending({ ...item, tableNumber: t.number })}
                                                            className="relative hit-44 shrink-0 p-1 rounded-full hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-50"
                                                            title="Reimprimir pedido"
                                                            aria-label={`Reimprimir ${item.productName}`}
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
                    </motion.div>
                </div>
            )}

            <div>
                <h3 className="eyebrow mb-3">
                    Aguardando pagamento {queueItems.length > 0 && `(${queueItems.length})`}
                </h3>
                {queueItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-16 px-6 bg-[var(--surface)] rounded-[var(--r-lg)] shadow-[var(--shadow-sm)]">
                        <Wallet size={40} strokeWidth={1.5} className="mb-3 text-[var(--text-muted)] opacity-50" />
                        <p className="text-[17px] font-semibold text-[var(--text)]">Nenhum recebível pendente</p>
                        <p className="text-[13px] text-[var(--text-muted)] mt-1">Mesas que pedirem a conta e vendas de balcão aparecem aqui.</p>
                    </div>
                ) : (
                    <div className="relative space-y-2">
                        <AnimatePresence mode="popLayout">
                        {queueItems.map(item => (
                            <motion.button
                                key={item.key}
                                {...LIST_ITEM_MOTION}
                                whileTap={{ scale: 0.97 }}
                                onClick={() => item.kind === 'table' ? onOpenTablePayment(item.id) : onOpenCounterPayment(item.id)}
                                className="w-full flex items-center justify-between gap-3 p-4 bg-[var(--surface)] shadow-[var(--shadow-sm)] rounded-[var(--r-lg)] hover:shadow-[var(--shadow-md)] u-motion text-left"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="h-9 w-9 rounded-full bg-[var(--warn)]/10 flex items-center justify-center text-[var(--warn)] shrink-0">
                                        {item.kind === 'table' ? <LayoutDashboard size={16} /> : <Coffee size={16} />}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-semibold text-[var(--text)] truncate">{item.label}</p>
                                        <p className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                                            <Clock size={11} /> {item.sublabel ? `${item.sublabel} · ` : ''}Aguardando {formatWaitingLabel(item.waitingSince)}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className="num font-semibold text-[var(--text)]">R$ {formatBRL(item.total)}</span>
                                    <ArrowRight size={16} className="text-[var(--text-muted)]" />
                                </div>
                            </motion.button>
                        ))}
                        </AnimatePresence>
                    </div>
                )}
            </div>

            {(() => {
                // Pedido pago e não entregue é um buraco de conferência: o
                // dinheiro já está no turno e a nota já saiu, mas a venda
                // NÃO aparece no Histórico de Vendas (que só conta
                // 'delivered'). Sem este aviso, o caixa fecha o turno sem
                // saber que existe venda pendurada — e o relatório do
                // contador não bate com o do dia.
                // Mesmo predicado da fila "Aguardando pagamento" acima
                // (`isCounterOrderPaid`) — as duas telas são complementares
                // por construção: o que está aqui não pode estar lá, e
                // vice-versa (Important #1 da revisão final, 2026-09-13).
                const pagosNaoEntregues = counterOrders.filter(isCounterOrderPaid);
                if (pagosNaoEntregues.length === 0) return null;
                // Fix round 1 (revisão independente): o valor COBRADO é
                // `payment_details.total`, congelado no instante do
                // pagamento — nunca recalculado de `order_items` na hora de
                // renderizar. Nesse fluxo o pedido fica pago e não entregue
                // DE PROPÓSITO, e a cozinha pode cancelar item nesse
                // meio-tempo (`cancelSpecificOrderItem` funciona em pedido
                // não entregue); recalcular a partir dos itens então
                // SUBESTIMA o dinheiro que já está na gaveta — o oposto do
                // que este aviso promete. Mesma fonte que
                // `getOrderDisplayTotal` já usa em todo o resto do projeto
                // (Histórico de Vendas, dashboard) desde 2026-08-25.
                const total = pagosNaoEntregues.reduce((s, o) => s + getOrderDisplayTotal(o), 0);
                return (
                    <Card className="p-3 bg-[var(--warn)]/10 border-[var(--warn)]/30">
                        <p className="text-[13px] font-semibold text-[var(--warn)] mb-1">
                            Pago e ainda não entregue ({pagosNaoEntregues.length})
                        </p>
                        <p className="text-[12px] text-[var(--text-muted)]">
                            R$ {formatBRL(total)} já recebido, esperando entrega no Balcão. Esse valor está no seu
                            caixa, mas só entra no histórico de vendas depois que o pedido for entregue.
                        </p>
                    </Card>
                );
            })()}

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
                        <label className="block text-[13px] font-semibold text-[var(--text-muted)] mb-1.5">
                            Valor
                        </label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] font-semibold">R$</span>
                            <input
                                type="number"
                                inputMode="decimal"
                                min="0.01"
                                step="0.01"
                                autoFocus
                                className="w-full h-12 pl-11 pr-4 rounded-[14px] bg-[var(--surface-2)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 font-semibold text-lg num"
                                placeholder="0.00"
                                value={movementAmount}
                                onChange={e => setMovementAmount(e.target.value)}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-[13px] font-semibold text-[var(--text-muted)] mb-1.5">
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
                title={`Fechar caixa de ${loggedUser.name}`}
                size="md"
            >
                {isLoadingSummary ? (
                    <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
                        <RefreshCw size={24} className="animate-spin" />
                    </div>
                ) : (
                    <div className="space-y-5">
                        {/* Task 13 (fix offline): sem resumo (offline, sem cache
                            aproveitável, ou turno aberto direto offline) o
                            fechamento não pode mais travar num beco sem saída —
                            a contagem de gaveta e o botão de confirmar sempre
                            renderizam abaixo, mesmo sem os blocos dependentes de
                            closeSummary. */}
                        {!closeSummary && (
                            <div className="rounded-xl border-2 border-[var(--warn)]/40 bg-[var(--warn)]/10 px-4 py-3 flex items-start gap-2">
                                <AlertCircle size={18} className="text-[var(--warn)] shrink-0 mt-0.5" />
                                <p className="text-sm text-[var(--warn)] font-semibold">
                                    Sem conexão — não foi possível carregar o resumo do turno (formas de pagamento, sangria/suprimento, esperado em dinheiro). Você ainda pode fechar o caixa normalmente: o fechamento fica registrado e sincroniza quando a internet voltar.
                                </p>
                            </div>
                        )}

                        {closeSummary && (
                            <>
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
                                {closeSummary.payments_count != null && (
                                    <div className="grid grid-cols-3 gap-3 text-sm">
                                        <div className="rounded-xl border border-[var(--border)] px-3 py-2">
                                            <p className="text-[var(--text-muted)]">Contas pagas</p>
                                            <p className="num font-bold text-[var(--text)]">{closeSummary.payments_count}</p>
                                        </div>
                                        <div className="rounded-xl border border-[var(--border)] px-3 py-2">
                                            <p className="text-[var(--text-muted)]">Total vendido</p>
                                            <p className="num font-bold text-[var(--text)]">R$ {formatBRL(Number(closeSummary.payments_total) || 0)}</p>
                                        </div>
                                        <div className="rounded-xl border border-[var(--border)] px-3 py-2">
                                            <p className="text-[var(--text-muted)]">Ticket médio</p>
                                            <p className="num font-bold text-[var(--text)]">{ticketMedio(closeSummary.payments_total, closeSummary.payments_count) != null ? `R$ ${formatBRL(ticketMedio(closeSummary.payments_total, closeSummary.payments_count) as number)}` : '—'}</p>
                                        </div>
                                    </div>
                                )}
                                <div className="space-y-1.5">
                                    <h4 className="text-[13px] font-semibold text-[var(--text-muted)]">
                                        Total por forma de pagamento
                                    </h4>
                                    {false ? (
                                        <p className="text-sm text-[var(--text-muted)]">Nenhum pagamento registrado neste turno.</p>
                                    ) : (
                                        <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
                                            {completarFormas(closeSummary.totals_by_method).map(({ key: method, total }) => (
                                                <div key={method} className="flex items-center justify-between px-3 py-2 text-sm">
                                                    <span className="text-[var(--text)]">{getPaymentMethodLabel(method)}</span>
                                                    <span className="num font-bold text-[var(--text)]">R$ {formatBRL(total)}</span>
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
                                {(closeSummary.totals_by_card || Object.keys(closeSummary.totals_by_brand).length > 0) && (
                                    <div className="space-y-1.5">
                                        <h4 className="text-[13px] font-semibold text-[var(--text-muted)]">
                                            Cartões: crédito e débito por bandeira
                                        </h4>
                                        <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
                                            {(closeSummary.totals_by_card ? completarCartoes(closeSummary.totals_by_card).map((c) => [c.label, c.total] as [string, number]) : Object.entries(closeSummary.totals_by_brand).map(([b, t]) => [getCardBrandLabel(b), t] as [string, number])).map(([brand, total]) => (
                                                <div key={brand} className="flex items-center justify-between px-3 py-2 text-sm">
                                                    <span className="text-[var(--text)]">{brand}</span>
                                                    <span className="num font-bold text-[var(--text)]">R$ {formatBRL(total)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div className="rounded-xl border border-[var(--border)] px-3 py-2">
                                        <p className="text-[var(--text-muted)] flex items-center gap-1"><TrendingDown size={12} /> Sangrias</p>
                                        <p className="num font-bold text-[var(--text)]">R$ {formatBRL(closeSummary.total_sangria)}</p>
                                    </div>
                                    <div className="rounded-xl border border-[var(--border)] px-3 py-2">
                                        <p className="text-[var(--text-muted)] flex items-center gap-1"><TrendingUp size={12} /> Suprimentos</p>
                                        <p className="num font-bold text-[var(--text)]">R$ {formatBRL(closeSummary.total_suprimento)}</p>
                                    </div>
                                </div>

                                {canSeeExpectedBeforeClosing && (
                                    <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3 flex items-center justify-between">
                                        <span className="text-sm font-bold text-[var(--text)]">Esperado em dinheiro na gaveta</span>
                                        <span className="num font-bold text-lg text-[var(--text)]">R$ {formatBRL(closeSummary.expected_cash)}</span>
                                    </div>
                                )}
                            </>
                        )}

                        <div>
                            <label className="block text-[13px] font-semibold text-[var(--text-muted)] mb-1.5">
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
                                <span className="num font-bold text-lg text-[var(--text)]">R$ {formatBRL(closingCountedValue)}</span>
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
                                <span className="num font-bold text-lg text-[var(--text)]">
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

// Gerente/dono/universal/quem supervisiona o caixa ganha a alternância "Meu
// caixa / Caixas da equipe" no topo da aba Caixa (2026-09-29, pedido do dono:
// o gerente escolhe qual caixa quer ver, ao vivo e com histórico). A visão
// pessoal fica montada (só escondida) pra não perder modal/rascunho ao alternar.
const CaixaView: React.FC<{
    store: Store;
    loggedUser: StoreUser;
    onOpenTablePayment: (tableId: string) => void;
    onOpenCounterPayment: (orderId: string) => void;
}> = (props) => {
    const [visao, setVisao] = useState<'meu' | 'equipe' | 'notas'>('meu');
    const veEquipe = podeVerCaixasDaEquipe(props.loggedUser);
    return (
        <div className="space-y-4">
            <SegmentedControl
                className="flex w-full [&>button]:flex-1 max-sm:[&>button]:px-1.5"
                value={visao}
                onChange={(v) => setVisao(v as 'meu' | 'equipe' | 'notas')}
                options={[
                    { value: 'meu', label: 'Meu caixa' },
                    { value: 'notas', label: 'Notas fiscais' },
                    ...(veEquipe ? [{ value: 'equipe', label: 'Caixas da equipe' }] : []),
                ]}
            />
            <div className={visao === 'meu' ? '' : 'hidden'}><CaixaViewMeu {...props} /></div>
            {visao === 'notas' && <FiscalNotasView storeId={props.store.id} storeName={props.store.name} modoCaixa />}
            {visao === 'equipe' && veEquipe && <CaixasAoVivo storeId={props.store.id} viewer={props.loggedUser} contagemCega={!!props.store.config?.cash_shift_blind_count} />}
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

// omie_codigo (2026-09-22, achado real): o formulário nunca lia nem
// mandava esse campo de volta — `groupsToSave` (handleSaveProduct)
// montava cada opção sem `omie_codigo`, e `syncProductOptionGroups`
// (lib/api.ts) faz `o.omie_codigo ?? null`, então TODO "Salvar Produto"
// num produto com grupo de opção apagava silenciosamente o código Omie
// de cada opção — sem erro nenhum, sem aviso. Só não tinha estourado
// ainda porque nenhum produto com sabor (Pizza Arretada etc.) tinha sido
// resalvo pela tela desde que os códigos foram gravados via SQL em
// 2026-08-27. Corrigido carregando e devolvendo o campo.
// `variants` (migration 140, preço/código por tamanho) não é editável nesta tela —
// só é carregado e devolvido intacto, senão um "Salvar" apagaria a configuração
// (mesma classe de bug do omie_codigo descrita acima).
interface DraftOption { tempId: string; name: string; price_delta: string; available: boolean; omie_codigo: string; variants: ProductOption['variants'] }
interface DraftOptionGroup {
    tempId: string; name: string; type: 'single' | 'multiple'; required: boolean;
    price_rule: 'sum' | 'max'; // migration 140
    // min_select/max_select ficam como string no rascunho (mesmo padrão de
    // price_delta) — vazio = sem limite/null, só relevantes quando type === 'multiple'.
    min_select: string; max_select: string;
    options: DraftOption[];
}

const toDraftGroups = (groups?: Product['option_groups']): DraftOptionGroup[] =>
    (groups || []).map(g => ({
        tempId: g.id, name: g.name, type: g.type, required: g.required,
        price_rule: g.price_rule === 'max' ? 'max' : 'sum',
        min_select: g.min_select != null ? g.min_select.toString() : '',
        max_select: g.max_select != null ? g.max_select.toString() : '',
        options: g.options.map(o => ({ tempId: o.id, name: o.name, price_delta: o.price_delta.toString(), available: o.available, omie_codigo: o.omie_codigo ?? '', variants: o.variants ?? null })),
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

const MenuManagementView: React.FC<{ store: Store, onStoreUpdate?: (store: Store) => void, podeEditar?: boolean }> = ({ store, onStoreUpdate, podeEditar = true }) => {
    const storeId = store.id;
    const [categories, setCategories] = useState<Category[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [newCatName, setNewCatName] = useState('');
    const [newGroupName, setNewGroupName] = useState('');

    // Redesign da navegação do cardápio (2026-09-04, pedido direto do dono):
    // categorias viram um modal de gestão à parte + abas horizontais pra
    // navegar os produtos (só a categoria ativa renderiza), e uma busca
    // global substitui o scroll interminável de todas as categorias
    // empilhadas. Ver activeCategoryProducts/searchResults mais abaixo.
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
    const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);
    const [printSectors, setPrintSectors] = useState<PrintSector[]>([]);
    // Grupos da lista lateral começam fechados (sanfona); o grupo da categoria ativa abre sozinho.
    const [openSidebarGroups, setOpenSidebarGroups] = useState<Set<string>>(new Set());
    const [activeMenuCategoryId, setActiveMenuCategoryId] = useState<string | null>(null);
    const [productSearchTerm, setProductSearchTerm] = useState('');

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
    const [pCostPrice, setPCostPrice] = useState('');
    const [pStockThreshold, setPStockThreshold] = useState('');
    const [pCat, setPCat] = useState('');
    const [pTime, setPTime] = useState('15');
    const [pDestination, setPDestination] = useState<'kitchen' | 'bar'>('kitchen');
    const [pSector, setPSector] = useState('');
    const [pIgnoreCat, setPIgnoreCat] = useState(false);
    // NCM (migration 032/033) — classificacao fiscal do produto. Texto livre
    // (o codigo tem digitos e as vezes pontuacao), mesmo padrao dos outros
    // campos de texto opcionais deste form (nao ha catalogo fechado, ao
    // contrario de PRODUCT_TAGS).
    const [pNcm, setPNcm] = useState('');
    // Taxa (migration 138): '' = produto normal; 'fixed'/'percent' = só o caixa lança.
    const [pFeeType, setPFeeType] = useState<'' | 'fixed' | 'percent'>('');
    const [pFeePercent, setPFeePercent] = useState('');
    // Vínculo com Omie (2026-09-17) — 3 casos: 'none' (produto só existe
    // aqui, sem omie_codigo), 'link' (já existe um SKU no Omie — ex. veio do
    // backfill do cardápio antigo — só grava o código, não cria nada novo em
    // lugar nenhum) e 'create' (Direção 1, 2026-08-16: gera um SKU novo via
    // /api/integracao/criar-produto-estoque, só disponível ao criar produto
    // novo, não em editar). Substituiu o antigo `pCriarNoEstoque` boolean.
    const [pOmieMode, setPOmieMode] = useState<'none' | 'link' | 'create'>('none');
    const [pOmieCodeInput, setPOmieCodeInput] = useState('');
    // Busca de produto já existente no NTB Estoque (modo 'link') — pesquisa
    // por nome em vez de exigir o código Omie de cor. Debounce simples (a
    // mesma ideia do pRecommendationSearch, mas com chamada de rede real,
    // então precisa de debounce de verdade, não só filtro local).
    const [pOmieSearchTerm, setPOmieSearchTerm] = useState('');
    const [pOmieSearchResults, setPOmieSearchResults] = useState<ProdutoEstoqueBusca[]>([]);
    const [pOmieSearching, setPOmieSearching] = useState(false);
    useEffect(() => {
        if (pOmieMode !== 'link' || pOmieSearchTerm.trim().length < 2) {
            setPOmieSearchResults([]);
            return;
        }
        setPOmieSearching(true);
        const timer = setTimeout(() => {
            buscarProdutosNoEstoque(storeId, pOmieSearchTerm.trim())
                .then(setPOmieSearchResults)
                .finally(() => setPOmieSearching(false));
        }, 400);
        return () => clearTimeout(timer);
    }, [pOmieMode, pOmieSearchTerm, storeId]);
    const [pFile, setPFile] = useState<File | null>(null);
    const [pPreview, setPPreview] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

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
        setPOptionGroups(prev => [...prev, { tempId: crypto.randomUUID(), name: '', type: 'single', required: false, price_rule: 'sum', min_select: '', max_select: '', options: [] }]);
    };
    const updateOptionGroup = (tempId: string, patch: Partial<DraftOptionGroup>) => setPOptionGroups(prev => prev.map(g => g.tempId === tempId ? { ...g, ...patch } : g));
    const removeOptionGroup = (tempId: string) => setPOptionGroups(prev => prev.filter(g => g.tempId !== tempId));
    const addOption = (groupTempId: string) => {
        const group = pOptionGroups.find(g => g.tempId === groupTempId);
        if (group && group.options.length >= MAX_OPTIONS_PER_GROUP) {
            toast.error(`Limite de ${MAX_OPTIONS_PER_GROUP} opções por grupo atingido.`);
            return;
        }
        setPOptionGroups(prev => prev.map(g => g.tempId === groupTempId ? { ...g, options: [...g.options, { tempId: crypto.randomUUID(), name: '', price_delta: '0', available: true, omie_codigo: '', variants: null }] } : g));
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
        const { categories: c, products: p, categoryGroups: g } = await fetchMenu(storeId, false, true);
        setCategories(c);
        setProducts(p);
        setCategoryGroups(g);
        fetchPrintSectors(storeId).then(setPrintSectors).catch(() => {});
    };

    const handleDragEnd = async (result: DropResult) => {
        if (!podeEditar) { toast.error('Seu perfil só pode consultar o cardápio.'); return; }
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
        if (!podeEditar) { toast.error('Seu perfil só pode consultar o cardápio.'); return; }
        if (!newCatName) return;
        await createCategory(storeId, newCatName);
        setNewCatName('');
        loadMenu();
    };

    const handleDeleteCategory = async (id: string) => {
        if (!podeEditar) { toast.error('Seu perfil só pode consultar o cardápio.'); return; }
        if (await confirm({ message: 'Excluir categoria? Produtos nela podem ficar órfãos.', variant: 'danger', confirmLabel: 'Excluir' })) {
            await deleteCategory(id);
            loadMenu();
        }
    };

    const handleAddCategoryGroup = async () => {
        if (!podeEditar) { toast.error('Seu perfil só pode consultar o cardápio.'); return; }
        if (!newGroupName) return;
        try {
            await createCategoryGroup(storeId, newGroupName);
            setNewGroupName('');
            loadMenu();
        } catch (e: any) {
            console.error('Error creating category group', e);
            toast.error('Erro ao criar grupo: ' + (e.message || 'Tente novamente.'));
        }
    };

    const handleDeleteCategoryGroup = async (id: string) => {
        if (!podeEditar) { toast.error('Seu perfil só pode consultar o cardápio.'); return; }
        // Fix minor da revisão final (2026-09-22): mensagem de confirmação
        // mostra quantas categorias ficam sem grupo, não é só um aviso genérico.
        const affectedCount = categories.filter(c => c.group_id === id).length;
        const message = affectedCount > 0
            ? `Excluir grupo? ${affectedCount} ${affectedCount === 1 ? 'categoria vai ficar' : 'categorias vão ficar'} sem grupo (não ${affectedCount === 1 ? 'é apagada' : 'são apagadas'}).`
            : 'Excluir grupo?';
        if (await confirm({ message, variant: 'danger', confirmLabel: 'Excluir' })) {
            try {
                await deleteCategoryGroup(id);
                loadMenu();
            } catch (e: any) {
                console.error('Error deleting category group', e);
                toast.error('Erro ao excluir grupo: ' + (e.message || 'Tente novamente.'));
            }
        }
    };

    const handleChangeCategorySector = async (categoryId: string, sectorId: string | null) => {
        if (!podeEditar) { toast.error('Seu perfil só pode consultar o cardápio.'); return; }
        setCategories(prev => prev.map(c => c.id === categoryId ? { ...c, sector_id: sectorId } : c));
        try {
            await updateCategorySector(categoryId, sectorId);
        } catch (e: any) {
            toast.error('Erro ao mudar o setor da categoria: ' + (e.message || 'Tente novamente.'));
            loadMenu();
        }
    };

    const handleChangeCategoryGroup = async (categoryId: string, groupId: string | null) => {
        if (!podeEditar) { toast.error('Seu perfil só pode consultar o cardápio.'); return; }
        setCategories(prev => prev.map(c => c.id === categoryId ? { ...c, group_id: groupId } : c));
        try {
            await updateCategoryGroupAssignment(categoryId, groupId);
        } catch (e: any) {
            console.error('Error updating category group assignment', e);
            toast.error('Erro ao mudar o grupo da categoria: ' + (e.message || 'Tente novamente.'));
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
        if (!podeEditar) { toast.error('Seu perfil só pode consultar o cardápio.'); return; }
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
        if (!podeEditar) { toast.error('Seu perfil só pode consultar o cardápio.'); return; }
        if (product) {
            setEditingProduct(product);
            setPName(product.name);
            setPDesc(product.description);
            setPPrice(product.price.toString());
            setPCat(product.category_id || ''); // produto orfao (sem categoria): forca escolha no select
            setPTime(product.prep_time_minutes.toString());
            setPPreview(product.image_url);
            setPDestination(product.destination || 'kitchen');
            setPSector(product.sector_id || '');
            setPIgnoreCat(Boolean(product.ignore_category_sector));
            setPOptionGroups(toDraftGroups(product.option_groups));
            setPPromoPrice(product.promo_price != null ? product.promo_price.toString() : '');
            setPFeatured(product.featured ?? false);
            setPTags(product.tags ?? []);
            setPRecommendedIds((product.recommended_products || []).map(rp => rp.id));
            setPNcm(product.ncm ?? '');
            setPFeeType(product.fee_type ?? '');
            setPFeePercent(product.fee_percent != null ? String(product.fee_percent) : '');
            setPCostPrice(product.cost_price != null ? String(product.cost_price) : '');
            setPStockThreshold(product.stock_alert_threshold != null ? String(product.stock_alert_threshold) : '');
            if (product.omie_codigo) {
                setPOmieMode('link');
                setPOmieCodeInput(product.omie_codigo);
            } else {
                setPOmieMode('none');
                setPOmieCodeInput('');
            }
            setPOmieSearchTerm('');
        } else {
            setEditingProduct(null);
            setPName('');
            setPDesc('');
            setPPrice('');
            setPCostPrice('');
            setPStockThreshold('');
            setPCat(categories[0]?.id || '');
            setPTime('15');
            setPPreview(null);
            setPDestination('kitchen');
            setPSector('');
            setPIgnoreCat(false);
            setPOptionGroups([]);
            setPPromoPrice('');
            setPFeatured(false);
            setPTags([]);
            setPRecommendedIds([]);
            setPNcm('');
            setPFeeType('');
            setPFeePercent('');
            setPOmieMode('none');
            setPOmieCodeInput('');
            setPOmieSearchTerm('');
        }
        setPRecommendationSearch('');
        setPFile(null);
        setIsProductModalOpen(true);
    };

    const handleSaveProduct = async () => {
        if (!podeEditar) { toast.error('Seu perfil só pode consultar o cardápio.'); return; }
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

        // Taxa percentual: o preço do produto não é usado (o valor sai da conta).
        let feePercentNum: number | null = null;
        if (pFeeType === 'percent') {
            feePercentNum = parseFloat(pFeePercent.replace(',', '.'));
            if (isNaN(feePercentNum) || feePercentNum <= 0 || feePercentNum > 100) return toast.error('Percentual da taxa precisa ser entre 0 e 100.');
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
                ncm: pNcm.trim() ? (normalizarNcm(pNcm) ?? pNcm.trim()) : null,
                cost_price: pCostPrice ? Number(pCostPrice) : null,
                stock_alert_threshold: pStockThreshold ? Number(pStockThreshold) : null,
            };

            let productId: string;
            const isNewProduct = !editingProduct;
            if (editingProduct) {
                await updateProduct(editingProduct.id, storeId, productData);
                productId = editingProduct.id;
            } else {
                productId = await createProduct(storeId, pCat, productData);
            }

            if ((pFeeType || null) !== (editingProduct?.fee_type ?? null) || (pFeeType === 'percent' && feePercentNum !== Number(editingProduct?.fee_percent))) {
                try { await setProductFee(productId, storeId, pFeeType || null, feePercentNum); }
                catch (e: any) { toast.error('Produto salvo, mas a configuração de taxa não foi salva: ' + (e.message || '')); }
            }

            if ((pSector || '') !== (editingProduct?.sector_id || '') || pIgnoreCat !== Boolean(editingProduct?.ignore_category_sector)) {
                try { await updateProductSector(productId, storeId, pSector || null, pIgnoreCat); }
                catch (e: any) { toast.error('Produto salvo, mas o setor não foi salvo: ' + (e.message || '')); }
            }

            if (isNewProduct && pOmieMode === 'create') {
                const estoqueResult = await criarProdutoNoEstoque(storeId, productId, pName, priceNum, pNcm.trim() || null);
                if (!estoqueResult.success) {
                    toast.error('Produto criado aqui, mas falhou criar no NTB Estoque: ' + estoqueResult.message);
                } else {
                    toast.success('Produto criado no NTB Estoque também!');
                }
            } else if (pOmieMode === 'link') {
                try {
                    await setProductOmieCodigo(productId, storeId, pOmieCodeInput.trim() || null);
                } catch (omieError: any) {
                    toast.error('Produto salvo, mas houve erro ao vincular o código Omie: ' + omieError.message);
                }
            } else if (!isNewProduct && pOmieMode === 'none' && editingProduct?.omie_codigo) {
                // Lojista trocou de "vinculado" pra "sem Omie" explicitamente
                // — limpa o vínculo em vez de deixar o código antigo preso.
                try {
                    await setProductOmieCodigo(productId, storeId, null);
                } catch (omieError: any) {
                    toast.error('Produto salvo, mas houve erro ao desvincular o código Omie: ' + omieError.message);
                }
            }

            const groupsToSave: ProductOptionGroupInput[] = pOptionGroups
                .filter(g => g.name.trim())
                .map(g => ({
                    name: g.name.trim(), type: g.type, required: g.required, price_rule: g.price_rule,
                    min_select: g.type === 'multiple' ? parseOptionalInt(g.min_select) : null,
                    max_select: g.type === 'multiple' ? parseOptionalInt(g.max_select) : null,
                    options: g.options.filter(o => o.name.trim()).map(o => ({ name: o.name.trim(), price_delta: parseFloat(o.price_delta) || 0, available: o.available, omie_codigo: o.omie_codigo.trim() || null, variants: o.variants ?? null })),
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
        if (!podeEditar) { toast.error('Seu perfil só pode consultar o cardápio.'); return; }
        if (await confirm({ message: 'Excluir produto?', variant: 'danger', confirmLabel: 'Excluir' })) {
            await deleteProduct(id, storeId);
            loadMenu();
        }
    };

    const handleToggleAvailability = async (product: Product) => {
        if (!podeEditar) { toast.error('Seu perfil só pode consultar o cardápio.'); return; }
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
        if (!podeEditar) { toast.error('Seu perfil só pode consultar o cardápio.'); return; }
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

    // Categorias com pelo menos 1 produto — só essas viram aba (uma categoria
    // vazia não tem o que mostrar na navegação de produtos, mas continua
    // existindo/editável no modal de gestão).
    const categoriesWithItems = useMemo(
        () => productGroups.filter(cat => products.some(p => groupIdOf(p) === cat.id)),
        [productGroups, products]
    );

    // Aba ativa sempre cai numa categoria válida (a primeira com produto) —
    // se a categoria ativa for apagada ou esvaziar, cai pra próxima
    // automaticamente em vez de mostrar uma aba morta.
    useEffect(() => {
        if (categoriesWithItems.length === 0) {
            if (activeMenuCategoryId !== null) setActiveMenuCategoryId(null);
            return;
        }
        if (!activeMenuCategoryId || !categoriesWithItems.some(c => c.id === activeMenuCategoryId)) {
            setActiveMenuCategoryId(categoriesWithItems[0].id);
        }
    }, [categoriesWithItems, activeMenuCategoryId]);

    useEffect(() => {
        const gid = categories.find(c => c.id === activeMenuCategoryId)?.group_id;
        if (gid) setOpenSidebarGroups(prev => (prev.has(gid) ? prev : new Set(prev).add(gid)));
    }, [activeMenuCategoryId, categories]);

    const isSearchingProducts = productSearchTerm.trim().length > 0;
    const productSearchResults = useMemo(() => {
        if (!isSearchingProducts) return [];
        const term = productSearchTerm.trim().toLowerCase();
        return products
            .filter(p => p.name.toLowerCase().includes(term))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(p => ({ product: p, categoryLabel: productGroups.find(c => c.id === groupIdOf(p))?.name || '' }));
    }, [products, productSearchTerm, isSearchingProducts, productGroups]);

    const activeCategoryProducts = useMemo(() => {
        if (!activeMenuCategoryId) return [];
        return products.filter(p => groupIdOf(p) === activeMenuCategoryId).sort((a, b) => (a.order || 0) - (b.order || 0));
    }, [products, activeMenuCategoryId]);

    // Card de produto compartilhado entre a grade da aba ativa (com
    // drag-and-drop pra reordenar dentro da categoria) e a lista de
    // resultados de busca (sem drag — mistura categorias diferentes, não
    // faz sentido reordenar). Mover um produto pra OUTRA categoria continua
    // possível pelo campo "Categoria" do formulário de edição.
    const renderProductCard = (
        prod: Product,
        opts: { dragProvided?: DraggableProvided; dragSnapshot?: DraggableStateSnapshot; categoryLabel?: string } = {}
    ) => {
        const { dragProvided, dragSnapshot, categoryLabel } = opts;
        return (
            <div ref={dragProvided?.innerRef} {...(dragProvided?.draggableProps || {})}>
                <Card className={`flex gap-3 p-3 relative group ${!prod.available ? 'opacity-60 bg-[var(--surface-2)]' : ''} ${dragSnapshot?.isDragging ? 'shadow-xl ring-2 ring-[var(--brand)]' : ''} ${groupSelectMode && selectedForGroup.has(prod.id) ? 'ring-2 ring-[var(--brand)]' : ''}`}>
                    {groupSelectMode ? (
                        <button
                            type="button"
                            onClick={() => toggleProductForGroup(prod.id)}
                            aria-pressed={selectedForGroup.has(prod.id)}
                            className={`absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center z-10 rounded-l-[var(--r-lg)] max-sm:min-h-11 max-sm:min-w-11 ${selectedForGroup.has(prod.id) ? 'bg-[var(--brand-fill)] text-white' : 'bg-[var(--surface-2)]/50 text-[var(--border)]'}`}
                        >
                            {selectedForGroup.has(prod.id) ? <CheckSquare size={18} /> : <Square size={18} />}
                        </button>
                    ) : dragProvided ? (
                        <div {...dragProvided.dragHandleProps} className="absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center text-[var(--border)] hover:text-[var(--text-muted)] cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--surface-2)]/50 rounded-l-[var(--r-lg)] z-10">
                            <GripVertical size={20} />
                        </div>
                    ) : null}
                    <div className="w-20 h-20 bg-[var(--surface-2)] rounded-[12px] flex-shrink-0 overflow-hidden ml-4">
                        {prod.image_url ? (
                            <Image src={prod.image_url} alt="" width={80} height={80} className="w-full h-full object-cover"/>
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-[var(--border)]"><ImageIcon size={24}/></div>
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        {/* Nome em cima, preço embaixo: lado a lado, em 3 colunas, o
                            nome ficava espremido e quebrava no meio da palavra
                            ("Charqu/e", varredura final 2026-09-26). */}
                        <div className="flex flex-col items-start gap-0.5">
                            <h5 className="min-w-0 text-[15px] font-semibold leading-snug tracking-[-0.01em] text-[var(--text)] break-words">
                                {prod.featured && (
                                    <Star size={14} className="inline-block -mt-0.5 mr-1 text-[var(--warn)] fill-[var(--warn)]" aria-label="Produto em destaque" />
                                )}
                                {prod.name}
                                {prod.tags.length > 0 && (
                                    <span
                                        className="text-[12px] ml-1"
                                        title={prod.tags.map(t => getTagDisplay(t).label).join(', ')}
                                    >
                                        {prod.tags.map(t => getTagDisplay(t).emoji).filter(Boolean).join(' ')}
                                    </span>
                                )}
                            </h5>
                            {(() => {
                                // Taxa (migration 138): mostra que só o caixa lança e, se percentual, o %.
                                if (ehTaxa(prod)) {
                                    return (
                                        <span className="text-[13px] font-semibold text-[var(--brand)]">
                                            {ehTaxaPercentual(prod) ? `Taxa · ${formatServiceFeeRate(Number(prod.fee_percent) / 100)} da conta` : `Taxa · R$ ${formatBRL(getEffectivePrice(prod))}`}
                                        </span>
                                    );
                                }
                                const effectivePrice = getEffectivePrice(prod);
                                const hasActivePromo = effectivePrice < prod.price;
                                return hasActivePromo ? (
                                    <span className="flex items-baseline gap-1.5">
                                        <span className="text-[15px] font-semibold text-[var(--text)] num">R$ {formatBRL(effectivePrice)}</span>
                                        <span className="text-[12px] text-[var(--text-muted)] line-through num">R$ {formatBRL(prod.price)}</span>
                                    </span>
                                ) : (
                                    <span className="text-[15px] font-semibold text-[var(--text)] num">R$ {formatBRL(prod.price)}</span>
                                );
                            })()}
                        </div>
                        {categoryLabel && (
                            <span className="text-[12px] font-medium text-[var(--text-muted)]">{categoryLabel}</span>
                        )}
                        <p className="text-[13px] leading-snug text-[var(--text-muted)] line-clamp-2 mt-1">{prod.description}</p>
                        <div className="mt-2 flex gap-1.5 relative z-10">
                            <button type="button" onClick={() => openProductModal(prod)} aria-label={`Editar ${prod.name}`} title="Editar" className="relative hit-44 w-8 h-8 inline-flex items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--border)] u-motion u-press">
                                <Pencil size={14} />
                            </button>
                            <button type="button" onClick={() => handleToggleAvailability(prod)} aria-label={`${prod.available ? 'Pausar' : 'Ativar'} ${prod.name}`} title={prod.available ? 'Pausar' : 'Ativar'} className="relative hit-44 w-8 h-8 inline-flex items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--border)] u-motion u-press">
                                {prod.available ? <Pause size={14} /> : <Play size={14} />}
                            </button>
                            <button type="button" onClick={() => handleDeleteProduct(prod.id)} aria-label={`Excluir ${prod.name}`} title="Excluir" className="relative hit-44 w-8 h-8 inline-flex items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--err)] hover:bg-[var(--err)]/12 u-motion u-press">
                                <Trash2 size={14} />
                            </button>
                        </div>
                    </div>
                    {!prod.available && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <span className="inline-flex items-center gap-1.5 bg-[var(--surface)] text-[var(--text)] px-2.5 py-1 rounded-full text-[12px] font-medium shadow-[var(--shadow-md)]"><span className="w-2 h-2 rounded-full bg-[var(--err-fill)]" />Indisponível</span>
                        </div>
                    )}
                </Card>
            </div>
        );
    };

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
            {!podeEditar && (
                <p className="rounded-[var(--r-md)] bg-[var(--surface-2)] border border-[var(--border)] px-4 py-3 text-[13px] text-[var(--text-muted)]" role="status">
                    Seu perfil só pode consultar o cardápio. Peça ao gerente ou ao dono para alterar.
                </p>
            )}
            {/* CARDÁPIO — navegação por abas + busca global (redesign 2026-09-04).
                Gestão de categoria (criar/reordenar/horário/apagar) mora só no
                modal abaixo; aqui é só navegar/ver/editar produto. */}
            <section className="bg-[var(--surface)] p-6 max-sm:p-4 rounded-[var(--r-lg)] shadow-[var(--shadow-sm)]">
                <div className="flex justify-between items-center gap-3 mb-4 flex-wrap">
                    <h3 className="text-[20px] font-semibold tracking-[-0.015em] text-[var(--text)]">Cardápio</h3>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                            <input
                                type="text"
                                placeholder="Buscar produto..."
                                value={productSearchTerm}
                                onChange={e => setProductSearchTerm(e.target.value)}
                                className="pl-9 pr-3 h-[38px] w-full sm:w-64 rounded-full border-0 bg-[var(--surface-2)] text-[15px] text-[var(--text)] placeholder:text-[var(--text-muted)]/80 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 max-sm:text-base"
                            />
                        </div>
                        <Button variant="secondary" onClick={() => setIsCategoryModalOpen(true)} disabled={!podeEditar}>
                            <List size={16} className="mr-1.5"/> Categorias
                        </Button>
                    </div>
                </div>

                {/* Categorias — lista lateral editorial em telas largas (lg+), pílulas
                    horizontais em telas estreitas (redesign 2026-09-22, pedido explícito:
                    a barra de pílulas enfileirava mal com 8-10 categorias reais). Só
                    aparecem fora do modo de busca, já que buscar mistura produtos de
                    todas as categorias de propósito. */}
                {!isSearchingProducts && categoriesWithItems.length > 0 && (
                    <div className="lg:hidden flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1">
                        {categoriesWithItems.map(cat => {
                            const count = products.filter(p => groupIdOf(p) === cat.id).length;
                            const isActive = cat.id === activeMenuCategoryId;
                            return (
                                <button
                                    key={cat.id}
                                    onClick={() => setActiveMenuCategoryId(cat.id)}
                                    className={`flex-shrink-0 px-4 h-9 max-sm:h-10 rounded-full text-[14px] font-semibold whitespace-nowrap u-motion max-sm:min-h-11 ${isActive ? 'bg-[var(--brand-soft)] text-[var(--brand)]' : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--border)]'}`}
                                >
                                    {cat.name} <span className="num font-medium text-[var(--text-muted)]">{count}</span>
                                </button>
                            );
                        })}
                    </div>
                )}

                <div className="flex flex-col lg:flex-row gap-6">
                    {!isSearchingProducts && categoriesWithItems.length > 0 && (
                        <nav className="hidden lg:block lg:w-56 lg:shrink-0">
                            <ul className="space-y-0.5">
                                {/* Fix I2 (2026-09-22): mesma fonte de ordenação (buildTopLevelItems)
                                    das outras 4 telas. "Sem categoria" (UNCATEGORIZED_ID) é excluída do
                                    input e sempre anexada por último, como já era antes da feature de
                                    grupos — nunca entra na intercalação por order. */}
                                {(() => {
                                    const realCategories = categoriesWithItems.filter(cat => cat.id !== UNCATEGORIZED_ID);
                                    const uncategorized = categoriesWithItems.find(cat => cat.id === UNCATEGORIZED_ID);
                                    const items = buildTopLevelItems(realCategories, categoryGroups);
                                    const renderCategoryLi = (cat: Category) => {
                                        const count = products.filter(p => groupIdOf(p) === cat.id).length;
                                        const isActive = cat.id === activeMenuCategoryId;
                                        return (
                                            <li key={cat.id}>
                                                <button
                                                    onClick={() => setActiveMenuCategoryId(cat.id)}
                                                    className={`w-full flex items-center justify-between gap-2 py-2 pl-3 pr-2.5 rounded-[10px] text-left text-[14px] u-motion ${isActive ? 'bg-[var(--brand-soft)] text-[var(--brand)] font-semibold' : 'text-[var(--text)] hover:bg-[var(--surface-2)]'}`}
                                                >
                                                    <span className="truncate tracking-[-0.01em]">{cat.name}</span>
                                                    <span className={`text-[12px] num shrink-0 ${isActive ? 'text-[var(--brand)]' : 'text-[var(--text-muted)]'}`}>{count}</span>
                                                </button>
                                            </li>
                                        );
                                    };
                                    return (
                                        <>
                                            {items.map((item: TopLevelItem) => item.kind === 'category' ? renderCategoryLi(item.category) : (
                                                (() => {
                                                    const isOpen = openSidebarGroups.has(item.group.id);
                                                    const ownsActive = item.categories.some(c => c.id === activeMenuCategoryId);
                                                    const total = item.categories.reduce((n, c) => n + products.filter(p => groupIdOf(p) === c.id).length, 0);
                                                    return (
                                                        <li key={item.group.id}>
                                                            <button
                                                                type="button"
                                                                aria-expanded={isOpen}
                                                                onClick={() => setOpenSidebarGroups(prev => {
                                                                    const next = new Set(prev);
                                                                    if (next.has(item.group.id)) next.delete(item.group.id); else next.add(item.group.id);
                                                                    return next;
                                                                })}
                                                                className={`w-full flex items-center gap-2 py-2 pl-2 pr-2.5 rounded-[10px] text-left text-[14px] font-semibold u-motion ${ownsActive && !isOpen ? 'bg-[var(--brand-soft)] text-[var(--brand)]' : 'text-[var(--text)] hover:bg-[var(--surface-2)]'}`}
                                                            >
                                                                <motion.span animate={{ rotate: isOpen ? 90 : 0 }} transition={SPRING_TAP} className="shrink-0 text-[var(--text-muted)]">
                                                                    <ChevronRight size={14} />
                                                                </motion.span>
                                                                <span className="flex-1 truncate tracking-[-0.01em]">{item.group.name}</span>
                                                                <span className="text-[12px] num font-normal text-[var(--text-muted)] shrink-0">{total}</span>
                                                            </button>
                                                            <AnimatePresence initial={false}>
                                                                {isOpen && (
                                                                    <motion.ul
                                                                        key="sub"
                                                                        initial={{ height: 0, opacity: 0 }}
                                                                        animate={{ height: 'auto', opacity: 1 }}
                                                                        exit={{ height: 0, opacity: 0 }}
                                                                        transition={SPRING_SHEET}
                                                                        className="overflow-hidden space-y-0.5 pl-3"
                                                                    >
                                                                        {item.categories.map(renderCategoryLi)}
                                                                    </motion.ul>
                                                                )}
                                                            </AnimatePresence>
                                                        </li>
                                                    );
                                                })()
                                            ))}
                                            {uncategorized && renderCategoryLi(uncategorized)}
                                        </>
                                    );
                                })()}
                            </ul>
                        </nav>
                    )}

                    <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                                {groupSelectMode && selectedGroupProducts.length >= 2 && (
                                    selectedGroupSameCategory ? (
                                        <Button onClick={openGroupModal} className="!bg-[var(--brand-fill)]">
                                            Agrupar como variações ({selectedGroupProducts.length})
                                        </Button>
                                    ) : (
                                        <span className="text-[13px] text-[var(--warn)] font-medium">Selecione produtos da mesma categoria</span>
                                    )
                                )}
                                <Button
                                    variant={groupSelectMode ? 'secondary' : 'outline'}
                                    onClick={() => { setGroupSelectMode(prev => !prev); setSelectedForGroup(new Set()); }}
                                >
                                    {groupSelectMode ? 'Cancelar seleção' : 'Agrupar variações'}
                                </Button>
                            </div>
                            <Button onClick={() => openProductModal()} disabled={!podeEditar}><Plus size={18} className="-ml-1"/> Novo produto</Button>
                        </div>
                        {groupSelectMode && (
                            <p className="text-xs text-[var(--text-muted)] mb-4">
                                Selecione 2+ produtos parecidos da mesma categoria (ex.: as variações de um prato) pra
                                juntar num produto só, com um grupo de escolha. Nenhum produto é apagado — os que
                                virarem variação ficam ocultos do cardápio, com o histórico de venda preservado.
                            </p>
                        )}

                        <AnimatePresence mode="wait">
                            <motion.div
                                key={isSearchingProducts ? 'search' : (activeMenuCategoryId || 'empty')}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                transition={{ duration: 0.15 }}
                            >
                                {isSearchingProducts ? (
                                    productSearchResults.length === 0 ? (
                                        <p className="text-sm text-[var(--text-muted)] italic py-8 text-center">Nenhum produto encontrado para &quot;{productSearchTerm}&quot;.</p>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                            {productSearchResults.map(({ product, categoryLabel }) => (
                                                <React.Fragment key={product.id}>
                                                    {renderProductCard(product, { categoryLabel })}
                                                </React.Fragment>
                                            ))}
                                        </div>
                                    )
                                ) : activeMenuCategoryId ? (
                                    <DragDropContext onDragEnd={handleDragEnd}>
                                        <Droppable droppableId={activeMenuCategoryId} type="product">
                                            {(provided) => (
                                                <div
                                                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start"
                                                    {...provided.droppableProps}
                                                    ref={provided.innerRef}
                                                >
                                                    {activeCategoryProducts.map((prod, index) => (
                                                        <Draggable key={prod.id} draggableId={prod.id} index={index}>
                                                            {(dragProvided, dragSnapshot) => renderProductCard(prod, { dragProvided, dragSnapshot })}
                                                        </Draggable>
                                                    ))}
                                                    {provided.placeholder}
                                                </div>
                                            )}
                                        </Droppable>
                                    </DragDropContext>
                                ) : (
                                    <p className="text-sm text-[var(--text-muted)] italic py-8 text-center">Nenhum produto cadastrado ainda. Clique em &quot;Novo Produto&quot; pra começar.</p>
                                )}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </div>
            </section>

            {/* MODAL DE GESTÃO DE CATEGORIAS — criar/reordenar/horário/apagar,
                separado da navegação de produtos acima (pedido do dono,
                2026-09-04: a tela principal era "um monte de chip" antes disso). */}
            <Modal isOpen={isCategoryModalOpen} onClose={() => setIsCategoryModalOpen(false)} title="Gerenciar categorias">
                <div className="space-y-5">
                    <div>
                        <p className="text-[13px] font-semibold text-[var(--text-muted)] mb-2">Grupos (opcional)</p>
                        <div className="flex gap-2 mb-2">
                            <Input placeholder="Novo Grupo (ex.: Bebidas)" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
                            <Button onClick={handleAddCategoryGroup}><Plus size={20}/></Button>
                        </div>
                        {/* Fix I2 (2026-09-22): drag-and-drop de grupo removido — a posição
                            de um grupo não é mais controlada por `category_groups.order`
                            arrastado aqui, e sim derivada da primeira categoria-membro dele
                            (ver buildTopLevelItems). Chips continuam só com nome + excluir. */}
                        <div className="flex flex-wrap gap-2">
                            {categoryGroups.map(g => (
                                <div key={g.id} className="bg-[var(--surface-2)] px-3 py-1.5 rounded-lg flex items-center gap-2 group">
                                    <span className="font-bold text-[var(--text)]">{g.name}</span>
                                    <button onClick={() => handleDeleteCategoryGroup(g.id)} className="text-[var(--text-muted)]/50 hover:text-[var(--err)] opacity-0 group-hover:opacity-100 u-motion u-press">
                                        <X size={14}/>
                                    </button>
                                </div>
                            ))}
                            {categoryGroups.length === 0 && <span className="text-[var(--text-muted)] text-sm italic">Nenhum grupo criado — categorias soltas continuam funcionando normal.</span>}
                        </div>
                        {categoryGroups.length > 0 && (
                            <p className="text-[11px] text-[var(--text-muted)] mt-1.5">A posição de cada grupo segue a da primeira categoria dele — arraste as categorias abaixo pra reordenar.</p>
                        )}
                    </div>

                    <div>
                        <p className="text-[13px] font-semibold text-[var(--text-muted)] mb-2">Categorias</p>
                        <div className="flex gap-2 mb-2">
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
                                                        {categoryGroups.length > 0 && (
                                                            <select
                                                                value={cat.group_id || ''}
                                                                onChange={e => handleChangeCategoryGroup(cat.id, e.target.value || null)}
                                                                className="text-xs bg-[var(--surface)] border border-[var(--border)] rounded px-1.5 py-1 text-[var(--text-muted)] max-sm:text-base"
                                                            >
                                                                <option value="">Sem grupo</option>
                                                                {categoryGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                                                            </select>
                                                        )}
                                                        {(
                                                            <select
                                                                value={cat.sector_id || ''}
                                                                onChange={e => handleChangeCategorySector(cat.id, e.target.value || null)}
                                                                title="Pra qual setor (impressora) os itens desta categoria vão"
                                                                className="text-xs bg-[var(--surface)] border border-[var(--border)] rounded px-1.5 py-1 text-[var(--text-muted)] max-sm:text-base"
                                                            >
                                                                <option value="">Local: Cozinha/Bar</option>
                                                                {printSectors.map(st => <option key={st.id} value={st.id}>Local: {st.name}</option>)}
                                                            </select>
                                                        )}
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
                        </DragDropContext>
                    </div>
                </div>
            </Modal>

            {/* PRODUCT MODAL */}
            {/* size="lg" (2026-09-22, pedido direto): no tamanho padrão (sm,
                448px) as listas de opção (Sabor 1/2 de pizza, 15+ linhas com
                nome+preço+código Omie+disponível cada) ficavam espremidas.
                Mesmo teto (~85vw/1100px) já usado no modal "Mesa X". */}
            <Modal isOpen={isProductModalOpen} onClose={() => setIsProductModalOpen(false)} title={editingProduct ? 'Editar Produto' : 'Novo Produto'} size="lg">
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
                            className="w-full rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:border-[var(--brand)] transition-all max-sm:text-base"
                            rows={3}
                            value={pDesc}
                            onChange={e => setPDesc(e.target.value)}
                        />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Input label="Preço (R$)" type="number" inputMode="decimal" step="0.01" min="0" value={pPrice} onChange={e => setPPrice(e.target.value)} />
                        <Input
                            label="Preço promocional (opcional)"
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            placeholder="Deixe em branco pra não ter promoção"
                            value={pPromoPrice}
                            onChange={e => setPPromoPrice(e.target.value)}
                        />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-1">
                            <Input label="Custo (opcional — pra calcular margem)" type="number" inputMode="decimal" step="0.01" min="0" placeholder="Ex: 12.50" value={pCostPrice} onChange={e => setPCostPrice(e.target.value)} />
                            <p className="text-[11px] text-[var(--text-muted)]">Se preenchido, o dashboard mostra a margem de lucro deste produto.</p>
                        </div>
                        <div className="space-y-1">
                            <Input label="Alerta de estoque baixo (opcional)" type="number" inputMode="numeric" min="1" placeholder="Ex: 10" value={pStockThreshold} onChange={e => setPStockThreshold(e.target.value)} />
                            <p className="text-[11px] text-[var(--text-muted)]">Se o estoque cair abaixo deste número, aparece um alerta no dashboard.</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-semibold text-[var(--text)]">Categoria</label>
                            <select className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--brand)]/30 max-sm:text-base" value={pCat} onChange={e => setPCat(e.target.value)}>
                                <option value="" disabled>Selecione...</option>
                                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                         <Input label="Tempo Preparo (min)" type="number" inputMode="numeric" min="0" value={pTime} onChange={e => setPTime(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                         <div className="flex flex-col gap-1.5">
                             <label className="text-sm font-semibold text-[var(--text)]">Local de preparo (impressão)</label>
                             {(() => {
                                 const catSector = categories.find(c => c.id === pCat)?.sector_id || '';
                                 const valor = pSector || ((pIgnoreCat || !catSector) ? pDestination : catSector);
                                 return (
                                     <select className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--brand)]/30 max-sm:text-base" value={valor} onChange={e => {
                                         const v = e.target.value;
                                         if (v === 'kitchen' || v === 'bar') { setPDestination(v); setPSector(''); setPIgnoreCat(Boolean(catSector)); return; }
                                         const st = printSectors.find(x => x.id === v);
                                         if (st) setPDestination(st.base);
                                         if (v === catSector) { setPSector(''); setPIgnoreCat(false); }
                                         else { setPSector(v); setPIgnoreCat(false); }
                                     }}>
                                         <option value="kitchen">Cozinha</option>
                                         <option value="bar">Bar</option>
                                         {printSectors.map(st => <option key={st.id} value={st.id}>{st.name}{st.id === catSector ? ' (da categoria)' : ''}</option>)}
                                     </select>
                                 );
                             })()}
                         </div>
                         <Input
                             label="NCM (opcional)"
                             placeholder="Ex: 2106.90.10"
                             value={pNcm}
                             onChange={e => setPNcm(e.target.value)}
                         />
                    </div>

                    {/* Taxa (migration 138): taxa de serviço, rolha, troca... Só o
                        caixa lança, no pagamento da mesa; some do cardápio do
                        cliente e do lançamento do garçom. */}
                    <div className="flex flex-col gap-2 p-3 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
                        <span className="text-sm font-semibold text-[var(--text)]">É uma taxa?</span>
                        <select className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--brand)]/30 max-sm:text-base" value={pFeeType} onChange={e => setPFeeType(e.target.value as '' | 'fixed' | 'percent')}>
                            <option value="">Não, é um produto normal</option>
                            <option value="fixed">Sim, taxa de valor fixo (usa o preço acima)</option>
                            <option value="percent">Sim, percentual sobre a conta (ex.: taxa de serviço)</option>
                        </select>
                        {pFeeType === 'percent' && (
                            <Input label="Percentual (%)" type="number" inputMode="decimal" step="0.1" min="0" max="100" placeholder="10" value={pFeePercent} onChange={e => setPFeePercent(e.target.value)} />
                        )}
                        {pFeeType !== '' && (
                            <p className="text-xs text-[var(--text-muted)]">
                                Só quem tem permissão de caixa lança, no pagamento da mesa. Vincule ao código do Omie abaixo pra ir na nota fiscal e no estoque.
                                {pFeeType === 'percent' ? ' O valor é calculado sobre os itens da conta e substitui a taxa de serviço automática.' : ''}
                            </p>
                        )}
                    </div>

                    {/* Vínculo com Omie (2026-09-17) — 3 casos, ver comentário
                        do state pOmieMode acima. "Criar produto novo no Omie"
                        só aparece ao criar (edição de SKU novo continua fora
                        de escopo, mesma decisão de sempre — ver AGENTS.md);
                        "Vincular a um código já existente" funciona nos dois
                        modos, já que é só gravar/trocar um texto. */}
                    <div className="flex flex-col gap-2 p-3 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
                        <span className="text-sm font-semibold text-[var(--text)]">Vínculo com Omie</span>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="radio" name="omieMode" className="accent-[var(--brand)]" checked={pOmieMode === 'none'} onChange={() => setPOmieMode('none')} />
                            <span className="text-sm text-[var(--text)]">Sem Omie (só neste cardápio)</span>
                        </label>
                        {/* 2026-09-22, achado real: "Sem Omie" aqui é sobre o PRODUTO —
                            produto consolidado em variação (pizza, Na Chapa, Moqueca,
                            Kids, Sobremesas, drinks com Sabor/Marca etc.) nunca tem
                            omie_codigo próprio de propósito, o código mora em cada
                            OPÇÃO (ver "Adicionais deste produto" abaixo). Sem este
                            aviso, "Sem Omie" lia como "essa comida não tem código
                            nenhum" — gerou a dúvida real "só as bebidas têm código".
                            A checagem ignora "Sem borda"/"Sem segundo sabor"/etc. */}
                        {pOmieMode === 'none' && pOptionGroups.some(g => g.options.some(o => o.omie_codigo.trim() && !o.name.trim().toLowerCase().startsWith('sem '))) && (
                            <p className="ml-6 text-xs text-[var(--info)] bg-[var(--info)]/10 rounded-lg px-2.5 py-1.5">
                                Este produto não tem código Omie próprio, mas as variações abaixo (em "Adicionais deste
                                produto") já têm — é assim que a baixa de estoque funciona pra ele.
                            </p>
                        )}
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="radio" name="omieMode" className="accent-[var(--brand)]" checked={pOmieMode === 'link'} onChange={() => setPOmieMode('link')} />
                            <span className="text-sm text-[var(--text)]">Vincular a um código Omie já existente</span>
                        </label>
                        {pOmieMode === 'link' && (
                            <div className="ml-6 flex flex-col gap-2">
                                <Input
                                    placeholder="Buscar produto no NTB Estoque por nome..."
                                    value={pOmieSearchTerm}
                                    onChange={e => setPOmieSearchTerm(e.target.value)}
                                />
                                {pOmieSearching && <span className="text-xs text-[var(--text-muted)]">Buscando...</span>}
                                {pOmieSearchResults.length > 0 && (
                                    <div className="flex flex-col gap-1 max-h-40 overflow-y-auto border border-[var(--border)] rounded-lg p-1 bg-[var(--surface)]">
                                        {pOmieSearchResults.map(p => (
                                            <button
                                                type="button"
                                                key={p.codigo}
                                                onClick={() => { setPOmieCodeInput(p.codigo); setPOmieSearchTerm(''); setPOmieSearchResults([]); }}
                                                className={`text-left text-sm px-2 py-1.5 rounded-md hover:bg-[var(--surface-2)] ${pOmieCodeInput === p.codigo ? 'bg-[var(--brand)]/10 font-semibold' : ''}`}
                                            >
                                                {p.descricao} <span className="text-[var(--text-muted)]">· {p.codigo} · R$ {formatBRL(p.valor_unitario)}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <Input
                                    label="Código Omie selecionado"
                                    placeholder="Ou digite o código direto (ex: 90386)"
                                    value={pOmieCodeInput}
                                    onChange={e => setPOmieCodeInput(e.target.value)}
                                />
                            </div>
                        )}
                        {!editingProduct && (
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="radio" name="omieMode" className="accent-[var(--brand)]" checked={pOmieMode === 'create'} onChange={() => setPOmieMode('create')} />
                                <span className="text-sm text-[var(--text)]">Criar produto novo no Omie (via NTB Estoque)</span>
                            </label>
                        )}
                    </div>

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
                            className={`relative inline-flex h-6 w-11 items-center rounded-full flex-shrink-0 transition-colors ${pFeatured ? 'bg-[var(--ok-fill)]' : 'bg-[var(--border)]'}`}
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
                                {/* migration 140: grupos marcados assim no mesmo produto (ex.: "Sabor 1"
                                    e "Sabor 2") cobram só o maior acréscimo entre as escolhas. */}
                                <label className="flex items-center gap-1 text-xs">
                                    <input type="checkbox" checked={group.price_rule === 'max'} onChange={e => updateOptionGroup(group.tempId, { price_rule: e.target.checked ? 'max' : 'sum' })}/>
                                    Cobrar só o maior valor (ex.: sabores de pizza meio a meio — marque em todos os grupos de sabor)
                                </label>
                                {group.options.some(o => o.variants && Object.keys(o.variants).length > 0) && (
                                    <p className="text-xs text-[var(--text-muted)]">
                                        Algumas opções têm preço/código Omie por {Array.from(new Set(group.options.flatMap(o => Object.keys(o.variants || {})))).join(' / ')} —
                                        configurado pela equipe Norte e mantido ao salvar. Não renomeie essas escolhas.
                                    </p>
                                )}
                                <p className="text-xs text-[var(--text-muted)]">
                                    "Escolha 1" mostra um seletor único (rádio) para o cliente; "Escolha vários" mostra
                                    caixas de seleção (checkbox), permitindo marcar mais de uma opção. Marcar
                                    "Obrigatório" bloqueia o botão "+" de adição rápida no cardápio do cliente — ele
                                    precisa abrir o produto e escolher antes de adicionar ao carrinho.
                                </p>
                                {group.type === 'multiple' && (
                                    <div className="flex gap-2 items-center">
                                        <Input placeholder="Mínimo" type="number" inputMode="numeric" min="0" value={group.min_select}
                                            onChange={e => updateOptionGroup(group.tempId, { min_select: e.target.value })} className="w-24" />
                                        <Input placeholder="Máximo" type="number" inputMode="numeric" min="0" value={group.max_select}
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
                                                                <Input placeholder="+R$" type="number" inputMode="decimal" step="0.01" min="0" value={opt.price_delta}
                                                                    onChange={e => updateOption(group.tempId, opt.tempId, { price_delta: e.target.value })} className="w-24" />
                                                                {/* Código Omie por opção (2026-09-22, achado real: o formulário
                                                                    apagava esse campo em silêncio a cada Salvar — ver comentário
                                                                    de DraftOption acima). Visível e editável aqui; vazio = essa
                                                                    variação não baixa estoque no Omie ao ser vendida. */}
                                                                <Input placeholder="Cód. Omie" value={opt.omie_codigo}
                                                                    onChange={e => updateOption(group.tempId, opt.tempId, { omie_codigo: e.target.value })}
                                                                    title="Código Omie desta variação — vazio não baixa estoque" className="w-28" />
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
                            className={`relative inline-flex h-6 w-11 items-center rounded-full flex-shrink-0 transition-colors ${scheduleAllDay ? 'bg-[var(--ok-fill)]' : 'bg-[var(--border)]'}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${scheduleAllDay ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>

                    {!scheduleAllDay && (
                        <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
    trocas: false,
};

// Presets de permissão por função real (Fase 1, Task 2 — plano "Fora do
// Cardápio"): cadastrar um garçom hoje é marcar checkbox um a um. Um preset
// só PRÉ-MARCA — nunca esconde o formulário nem impede ajuste fino depois.
// Só aparece pra usuário NOVO (editar um já existente nunca reseta
// permissão que o admin configurou com cuidado antes).
const TEAM_PERMISSION_PRESETS: Record<string, { label: string; permissions: typeof DEFAULT_TEAM_PERMISSIONS }> = {
    garcom_so_serve: { label: 'Garçom que só serve', permissions: { ...DEFAULT_TEAM_PERMISSIONS, tables: true, caixa: false } },
    garcom_recebe: { label: 'Garçom que também recebe', permissions: { ...DEFAULT_TEAM_PERMISSIONS, tables: true, caixa: true } },
    caixa_fixo: { label: 'Caixa fixo', permissions: { ...DEFAULT_TEAM_PERMISSIONS, tables: true, counter: true, caixa: true, trocas: true } },
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
            // Mesma regra do acesso real (hasTabPermission): garçom/caixa só tem o que está marcado explicitamente.
            const efetiva = (t: string) => hasTabPermission({ role: user.role, permissions: user.permissions as any }, t);
            setPermissions({
                tables: efetiva('tables'),
                counter: efetiva('counter'),
                kitchen: efetiva('kitchen'),
                bar: efetiva('bar'),
                menu: efetiva('menu'),
                admin: efetiva('admin'),
                caixa: user.permissions?.caixa === true,
                supervisiona_caixa: user.permissions?.supervisiona_caixa === true,
                trocas: user.permissions?.trocas === true,
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
                <h3 className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--text)]">Usuários do sistema</h3>
                <Button className="max-sm:min-h-11" onClick={() => openModal()}><Plus size={18} /> Novo usuário</Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                {users.map(user => (
                    <Card key={user.id} className="p-5 relative group">
                        <div className="flex justify-between items-start gap-2 mb-2">
                            <div className="min-w-0">
                                <h4 className="font-semibold text-[17px] text-[var(--text)] truncate">{user.name}</h4>
                                <p className="text-[13px] text-[var(--text-muted)] truncate">{user.email}</p>
                            </div>
                            <span className="shrink-0"><Badge color="bg-[var(--surface-2)] text-[var(--text-muted)]">{getRoleLabel(user.role)}</Badge></span>
                        </div>

                        <div className="mt-3 space-y-1">
                            <p className="text-[13px] font-medium text-[var(--text-muted)]">Acessos</p>
                            <div className="flex flex-wrap gap-1.5" data-testid="resumo-acessos">
                                {([['tables', 'Mesas'], ['counter', 'Balcão'], ['kitchen', 'Cozinha'], ['bar', 'Bar'], ['menu', 'Cardápio'], ['admin', 'Admin'], ['caixa', 'Caixa']] as const).map(([k, rotulo]) => {
                                    const pode = hasTabPermission({ role: user.role, permissions: user.permissions as any }, k);
                                    return pode
                                        ? <span key={k} className="px-2 py-0.5 bg-[var(--surface-2)] text-[var(--text)] text-[12px] font-medium rounded-full">{rotulo} ✓</span>
                                        : <span key={k} className="px-2 py-0.5 text-[var(--text-muted)] text-[12px] rounded-full border border-[var(--border)] inline-flex items-center gap-1"><Lock size={10} aria-hidden /> {rotulo}</span>;
                                })}
                                {user.permissions?.trocas === true && <span className="px-2 py-0.5 bg-[var(--surface-2)] text-[var(--text)] text-[12px] font-medium rounded-full">Trocas ✓</span>}
                                {user.permissions?.supervisiona_caixa === true && <span className="px-2 py-0.5 bg-[var(--surface-2)] text-[var(--text)] text-[12px] font-medium rounded-full">Supervisiona ✓</span>}
                            </div>
                        </div>

                        <div className="mt-4 flex gap-2 justify-end md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            <Button variant="secondary" size="sm" className="max-md:!h-11" onClick={() => openModal(user)}>Editar</Button>
                            <Button variant="ghost" size="sm" className="!text-[var(--err)] hover:!bg-[var(--err)]/10 max-md:!h-11" onClick={() => handleDelete(user.id)}>Excluir</Button>
                        </div>
                    </Card>
                ))}
            </div>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingUser ? 'Editar usuário' : 'Novo usuário'}>
                <div className="space-y-4">
                    <Input label="Nome Completo" value={name} onChange={e => setName(e.target.value)} />
                    <Input label="Email de Acesso" type="email" value={email} onChange={e => setEmail(e.target.value)} />
                    <Input label={editingUser ? "Nova Senha (opcional)" : "Senha"} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={editingUser ? "Deixe em branco para manter" : "******"} />
                    
                    <div>
                        <label className="text-[13px] font-medium text-[var(--text-muted)] mb-1 block">Função</label>
                        <select className="w-full h-[38px] max-sm:h-11 rounded-[var(--r-md)] bg-[var(--surface-2)] text-[var(--text)] px-3 text-[15px] max-sm:text-base focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40" value={role} onChange={e => { const r = e.target.value; setRole(r); if (!editingUser) setPermissions(r === 'manager' ? { tables: true, counter: true, kitchen: true, bar: true, menu: true, admin: true, caixa: true, supervisiona_caixa: true, trocas: true } : { ...DEFAULT_TEAM_PERMISSIONS }); }}>
                            <option value="waiter">Garçom</option>
                            <option value="cashier">Caixa</option>
                            <option value="cook">Cozinheiro</option>
                            <option value="attendant">Atendente</option>
                            <option value="manager">Gerente</option>
                            <option value="open">Aberto (computador só de mesas)</option>
                        </select>
                        {role === 'open' && (
                            <p className="mt-1.5 text-xs text-[var(--text-muted)]">Conta pra deixar logada no computador do salão: só abre mesa e lança pedido. Cada pedido pede a senha de quem está lançando e sai no nome dessa pessoa. Conta, pagamento e o resto do sistema ficam bloqueados.</p>
                        )}
                    </div>

                    <div className="bg-[var(--surface-2)] p-4 rounded-[14px]">
                        <label className="text-[15px] font-semibold text-[var(--text)] mb-2 block">Permissões de acesso</label>
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
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="checkbox" checked={!!permissions.trocas} onChange={() => togglePermission('trocas')} className="rounded text-[var(--brand)] focus:ring-[var(--brand)]" />
                                Troca de mesa e exclusão de item
                            </label>
                            <p className="text-[11px] text-[var(--text-muted)] pl-6 -mt-1">
                                Sem esta permissão, o usuário não vê o botão de trocar de mesa nem de cancelar item da comanda. Gerente e dono sempre podem.
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

const StoreAdminView: React.FC<{ store: Store; loggedUser: StoreUser; onStoreUpdate?: (store: Store) => void }> = ({ store, loggedUser, onStoreUpdate }) => {
    const storeId = store.id;
    // Permissões por função (lib/rolePermissions.ts): sem config salva, quem entra na Administração continua vendo.
    const podeEditarPrecosHorario = roleCanOr(loggedUser, store, 'editar_precos_horario', true);

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
    const [fiscalNfceSerieProd, setFiscalNfceSerieProd] = useState('');
    const [fiscalNfceUltimoNumeroProd, setFiscalNfceUltimoNumeroProd] = useState('');
    const [fiscalNfeSerieProd, setFiscalNfeSerieProd] = useState('');
    const [fiscalNfeUltimoNumeroProd, setFiscalNfeUltimoNumeroProd] = useState('');
    const [prontidao, setProntidao] = useState<{ certificadoValido: boolean; certificadoVenceEm: string | null; cscHomologacao: boolean; cscProducao: boolean; serieHomologacao: number | null; serieProducao: number | null } | null>(null);
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
        fetch(resolverUrlApi(`/api/fiscal/prontidao?storeId=${storeId}`)).then((r) => r.json()).then((j) => { if (j?.ok) setProntidao(j); }).catch(() => {});

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
            setFiscalNfceSerieProd(fiscalConfig.nfce_serie_producao != null ? String(fiscalConfig.nfce_serie_producao) : '');
            setFiscalNfceUltimoNumeroProd(String(fiscalConfig.nfce_ultimo_numero_producao ?? 0));
            setFiscalNfeSerieProd(fiscalConfig.nfe_serie_producao != null ? String(fiscalConfig.nfe_serie_producao) : '');
            setFiscalNfeUltimoNumeroProd(String(fiscalConfig.nfe_ultimo_numero_producao ?? 0));
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
            if (fiscalNfceSerieProd) params.nfceSerieProducao = Number(fiscalNfceSerieProd);
            if (fiscalNfceUltimoNumeroProd) params.nfceUltimoNumeroProducao = Number(fiscalNfceUltimoNumeroProd);
            if (fiscalNfeSerieProd) params.nfeSerieProducao = Number(fiscalNfeSerieProd);
            if (fiscalNfeUltimoNumeroProd) params.nfeUltimoNumeroProducao = Number(fiscalNfeUltimoNumeroProd);
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
            fetch(resolverUrlApi(`/api/fiscal/prontidao?storeId=${storeId}`)).then((r) => r.json()).then((j) => { if (j?.ok) setProntidao(j); }).catch(() => {});
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

    const [activeTab, setActiveTab] = useState<AbaId>('dashboard');
    const [sales, setSales] = useState<Order[]>([]);
    const [salesLoaded, setSalesLoaded] = useState(false);
    const [tableSessions, setTableSessions] = useState<TableSession[]>([]);
    const [ratings, setRatings] = useState<OrderRating[]>([]);
    const [checkins, setCheckins] = useState<OperatorCheckin[]>([]);
    const [isLoadingCheckins, setIsLoadingCheckins] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    // Achado real (WhatsApp, 2026-09-10): offline, `fetchSalesHistory`
    // engole o erro de rede e devolve `[]` (comportamento antigo, correto
    // pra não quebrar a tela) — mas o Dashboard/Histórico então renderiza
    // "R$ 0,00"/"Sem dados" em tudo, indistinguível de "perdi o dia
    // inteiro de vendas". Sem nenhuma tela de Administração ter ganhado
    // cache offline (fora de escopo — não faz sentido cachear
    // relatório/gestão, só o fluxo operacional), a correção certa aqui é
    // avisar explicitamente que é falta de conexão, não perda de dado.
    const [salesDataUnavailableOffline, setSalesDataUnavailableOffline] = useState(false);
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
    // Filtros combináveis (relatórios, 04/10): operador, forma, bandeira, mesa, status, nota, horário + filtros salvos.
    const [salesFilters, setSalesFilters] = useState<SalesFilters>(EMPTY_FILTERS);
    const [savedFilters, setSavedFilters] = useState<{ name: string; f: SalesFilters }[]>(() => {
        try { return JSON.parse(localStorage.getItem(`saved_sales_filters_${storeId}`) || '[]'); } catch { return []; }
    });
    const [saveFilterName, setSaveFilterName] = useState<string | null>(null);
    const persistSavedFilters = (list: { name: string; f: SalesFilters }[]) => {
        setSavedFilters(list);
        try { localStorage.setItem(`saved_sales_filters_${storeId}`, JSON.stringify(list)); } catch { /* sem storage: só não lembra */ }
    };
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
        let wasNetworkError = false;
        const [data, sessions, ratingsData] = await Promise.all([
            fetchSalesHistory(storeId, undefined, undefined, (e) => { if (isNetworkError(e)) wasNetworkError = true; }),
            fetchTableSessions(storeId),
            fetchOrderRatings(storeId),
        ]);
        setSales(data);
        setSalesLoaded(!wasNetworkError);
        setTableSessions(sessions);
        setRatings(ratingsData);
        setSalesDataUnavailableOffline(wasNetworkError);
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
        registrarAcao(storeId, 'historico.zerar', { entity: 'orders', summary: 'ZEROU o histórico de vendas da loja' });
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
            result = result.filter(order => qtdItensAtivos(order) >= parseInt(filterMinItems));
        }
        if (filterMaxItems) {
            result = result.filter(order => qtdItensAtivos(order) <= parseInt(filterMaxItems));
        }
        if (filterMinTotal) {
            result = result.filter(order => getOrderDisplayTotal(order) >= parseFloat(filterMinTotal));
        }
        if (filterMaxTotal) {
            result = result.filter(order => getOrderDisplayTotal(order) <= parseFloat(filterMaxTotal));
        }
        result = applySalesFilters(result, salesFilters);

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
                valA = qtdItensAtivos(a);
                valB = qtdItensAtivos(b);
            } else if (sortColumn === 'total') {
                valA = getOrderDisplayTotal(a);
                valB = getOrderDisplayTotal(b);
            }

            if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        return result;
    }, [sales, filterMonth, filterStartDate, filterEndDate, filterType, filterCustomer, filterMinItems, filterMaxItems, filterMinTotal, filterMaxTotal, salesFilters, sortColumn, sortDirection]);

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
    const [historyView, setHistoryView] = useState<'sale' | 'product' | 'operator' | 'canceled'>('sale');
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
    }, [filterMonth, filterStartDate, filterEndDate, filterType, filterCustomer, filterMinItems, filterMaxItems, filterMinTotal, filterMaxTotal, salesFilters, sortColumn, sortDirection]);

    const salesTotalPages = Math.max(1, Math.ceil(filteredAndSortedSales.length / SALES_PAGE_SIZE));
    const pagedSales = filteredAndSortedSales.slice(salesPage * SALES_PAGE_SIZE, (salesPage + 1) * SALES_PAGE_SIZE);

    const periodLabel = useMemo(() => {
        if (filterMonth) return `Mês: ${filterMonth}`;
        if (filterStartDate && filterEndDate) return `De ${new Date(filterStartDate).toLocaleDateString()} até ${new Date(filterEndDate).toLocaleDateString()}`;
        if (filterStartDate) return `A partir de ${new Date(filterStartDate).toLocaleDateString()}`;
        if (filterEndDate) return `Até ${new Date(filterEndDate).toLocaleDateString()}`;
        return 'Todo o histórico';
    }, [filterMonth, filterStartDate, filterEndDate]);

    // Subtítulo e nome do arquivo do relatório (Excel/PDF) dizem o período E os filtros aplicados.
    const filtrosHistorico: FiltrosHistorico = { mes: filterMonth, inicio: filterStartDate, fim: filterEndDate, tipo: filterType, cliente: filterCustomer, minItens: filterMinItems, maxItens: filterMaxItems, minTotal: filterMinTotal, maxTotal: filterMaxTotal, filtros: salesFilters };

    // "2x Pizza Marguerita (Catupiry), 1x Coca-Cola" — reusa getOrderItemDisplayName
    // (produto + adicional) por item da venda, não só a contagem de linhas.
    const buildItemsSummary = (order: Order) =>
        itensAtivos(order).map(item => `${item.quantity}x ${getOrderItemDisplayName(item)}`).join(', ');

    // Achado real (auditoria "o que falta", 2026-08-27 — item B13 da
    // reunião): mesma fórmula de handleReprintReceipt (total - subtotal dos
    // itens) — o pedido não grava a taxa histórica exata como campo
    // próprio, então isso é a melhor aproximação disponível a partir do
    // valor realmente cobrado (getOrderDisplayTotal).
    const calcOrderServiceFee = (order: Order): number => {
        const itemsTotal = subtotalItensAtivos(order);
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
                    items: qtdItensAtivos(order),
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
                items: qtdItensAtivos(order),
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
        registrarAcao(store.id, 'reimpressao.comprovante_historico', { entity: 'order', entityId: order.id, summary: 'Reimprimiu comprovante pelo Histórico de vendas' });
        const itemsTotal = subtotalItensAtivos(order);
        const total = getOrderDisplayTotal(order);
        const feeAmount = Number((total - itemsTotal).toFixed(2));
        const methods = order.payment_details?.methods;
        try {
            const receiptOpts = {
                storeName: store.name,
                cnpj: store.cnpj,
                paperWidthMm: store.config?.printer_paper_width_mm,
                label: `${order.order_type === 'table' ? `MESA ${order.tables?.number || '?'}` : `BALCÃO - ${order.customer_name || 'Cliente'}`} - REIMPRESSÃO`,
                items: itensAtivos(order).map(item => ({
                    quantity: item.quantity,
                    name: getOrderItemDisplayName(item),
                    client: parseItemNote(item.notes || '').client,
                    total: item.price_at_time * item.quantity,
                })),
                subtotal: itemsTotal,
                serviceFee: order.order_type === 'table' ? {
                    charged: feeAmount > 0.005,
                    rate: resolveServiceFeeRate(store.config),
                    amount: Math.max(0, feeAmount),
                    removedForTable: false,
                } : undefined,
                total,
                payment: {
                    methods: methods && methods.length > 0 ? methods : [{ method: order.payment_method || 'CASH', amount: total }],
                    changeDue: 0,
                },
            };
            enqueueReceiptPrintJobs(store.id, `Comprovante - ${receiptOpts.label}`, (mm) => buildBillReceiptText({ ...receiptOpts, paperWidthMm: mm ?? receiptOpts.paperWidthMm }), undefined, 'comprovante')
                .catch((e) => console.error('enqueueReceiptPrintJobs (reimpressão) falhou:', e));
            const temImpressoraFisica = await hasActivePrinterForDoc(store.id, 'comprovante');
            if (!temImpressoraFisica) {
                const printed = await printBillReceipt(receiptOpts);
                if (!printed) {
                    toast.error('O comprovante não imprimiu. Confira a impressora.');
                }
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
        setSalesFilters(EMPTY_FILTERS);
    };
    const salesOperators = useMemo(
        () => Array.from(new Set(sales.map((o) => (o.payment_details as { operador_nome?: string } | null)?.operador_nome).filter(Boolean) as string[])).sort(),
        [sales],
    );

    // Navegação em 5 áreas (lib/adminNav.ts + AdminNavShell). Os ids de aba antigos seguem
    // sendo o valor de `activeTab`, então os efeitos de carregamento acima não mudaram.
    const navCtx: NavCtx = {
        user: loggedUser,
        podeVerExcecoes: roleCan(loggedUser, store, 'ver_excecoes'),
        can: (acao) =>
            acao === 'editar_cardapio' ? roleCan(loggedUser, store, 'editar_cardapio')
            : acao === 'editar_precos_horario' ? podeEditarPrecosHorario
            : loggedUser.role === 'owner' || loggedUser.role === 'universal' || loggedUser.role === 'manager', // ver_permissoes: gerente vê (só leitura), dono edita
    };
    // `sales` só chega depois que Resumo/Histórico carregam; antes disso o cartão de Vendas mostra só a descrição.
    const adminStatus = useAdminStatus({ storeId, sales: salesLoaded ? sales : null, incluirCardapio: navCtx.can?.('editar_cardapio') === true });
    const [secaoAlvo, setSecaoAlvo] = useState<string | null>(null);
    const irPara = React.useCallback((id: AbaId, alvo?: string) => { setActiveTab(id); setSecaoAlvo(alvo ?? null); }, []);
    // Depois da troca de aba (crossfade de 120 ms), rola até o ajuste achado na busca e o destaca.
    useEffect(() => {
        if (!secaoAlvo) return;
        const t = setTimeout(() => {
            const el = document.getElementById(secaoAlvo);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el?.classList.add('ring-2', 'ring-[var(--brand)]/50');
            setTimeout(() => el?.classList.remove('ring-2', 'ring-[var(--brand)]/50'), 1800);
            setSecaoAlvo(null);
        }, 250);
        return () => clearTimeout(t);
    }, [secaoAlvo, activeTab]);

    return (
        <div className="space-y-6">
            <AdminNavShell ctx={navCtx} activeTab={activeTab} onTab={irPara} status={adminStatus}>
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

            {salesDataUnavailableOffline && (activeTab === 'dashboard' || activeTab === 'sales') && (
                <div className="mb-4 rounded-[14px] bg-[var(--surface)] shadow-[var(--shadow-sm)] px-4 py-3 flex items-start gap-2.5">
                    <WifiOff size={18} className="text-[var(--warn)] shrink-0 mt-0.5" />
                    <p className="text-[15px] text-[var(--text)]">
                        Sem conexão — não deu pra carregar os números reais agora (os valores abaixo NÃO refletem o dia). Isso não apaga nenhuma venda: assim que a internet voltar, é só recarregar esta tela.
                    </p>
                </div>
            )}

            {activeTab === 'dashboard' && (
                <StoreDashboardView
                    sales={sales}
                    tableSessions={tableSessions}
                    ratings={ratings}
                    storeId={storeId}
                    onNavigateToOperatorHistory={() => { irPara('sales'); setHistoryView('operator'); }}
                />
            )}

            {activeTab === 'users' && <UserManagementView storeId={storeId} />}

            {activeTab === 'link' && <MeuLinkView store={store} />}

            {activeTab === 'shifts' && (
                <div className="bg-[var(--surface)] rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] overflow-hidden">
                    <div className="p-4 border-b border-[var(--border)]">
                        <h3 className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--text)]">Turnos (ponto por operador)</h3>
                        <p className="text-[13px] text-[var(--text-muted)] mt-0.5">Cada operador marca a própria entrada/saída pelo botão "Bater ponto" no menu lateral — independente do turno de caixa.</p>
                    </div>
                    {isLoadingCheckins ? (
                        <div className="p-8 text-center text-[var(--text-muted)]">Carregando...</div>
                    ) : checkins.length === 0 ? (
                        <div className="p-8 text-center text-[var(--text-muted)]">Nenhum ponto registrado ainda.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-[15px]">
                                <thead className="text-[var(--text-muted)] text-[13px] border-b border-[var(--border)]">
                                    <tr>
                                        <th className="px-4 py-3 whitespace-nowrap text-left">Operador</th>
                                        <th className="px-4 py-3 whitespace-nowrap text-left">Entrada</th>
                                        <th className="px-4 py-3 whitespace-nowrap text-left">Saída</th>
                                        <th className="px-4 py-3 whitespace-nowrap text-left">Duração</th>
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
                                                <td className="px-4 py-3 whitespace-nowrap font-medium text-[var(--text)]">{c.user_name}</td>
                                                <td className="px-4 py-3 whitespace-nowrap text-[var(--text-muted)]">{format(start, 'dd/MM/yyyy HH:mm')}</td>
                                                <td className="px-4 py-3 whitespace-nowrap text-[var(--text-muted)]">
                                                    {end ? format(end, 'dd/MM/yyyy HH:mm') : <span className="text-[var(--ok)] font-medium">Em andamento</span>}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-[var(--text-muted)]">{duracao}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* "Caixa por operador" agora é a mesma tela ao vivo da aba Caixa do gerente
                (CaixasAoVivo): escolhe o operador, vê o turno em tempo real e o
                histórico com detalhe de cada turno. */}
            {activeTab === 'shifts' && (
                <div className="bg-[var(--surface)] rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] overflow-hidden mt-4">
                    <div className="p-4 border-b border-[var(--border)]">
                        <h3 className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--text)]">Caixa por operador</h3>
                        <p className="text-[13px] text-[var(--text-muted)] mt-0.5">Cada operador abre e fecha o próprio caixa. Escolha quem quer acompanhar.</p>
                    </div>
                    <div className="p-4">
                        {podeVerCaixasDaEquipe(loggedUser)
                            ? <CaixasAoVivo storeId={storeId} viewer={loggedUser} contagemCega={!!store.config?.cash_shift_blind_count} />
                            : <p className="text-sm text-[var(--text-muted)]">Só o gerente ou o dono acompanha o caixa da equipe.</p>}
                    </div>
                </div>
            )}

            {activeTab === 'notas' && <FiscalNotasView storeId={storeId} storeName={store.name} onConfigurarEmissor={() => irPara('fiscal')} />}

            {activeTab === 'integracoes' && <IntegracoesView storeId={storeId} podeEditarEstoque={roleCan(loggedUser, store, 'editar_cardapio')} operador={loggedUser.name} />}

            {activeTab === 'fiscal' && (
                <>
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

                        {prontidao && (() => {
                            const itens = [
                                { ok: prontidao.certificadoValido, txt: prontidao.certificadoValido ? `Certificado digital válido${prontidao.certificadoVenceEm ? ` (vence ${new Date(prontidao.certificadoVenceEm).toLocaleDateString('pt-BR')})` : ''}` : 'Certificado digital ausente ou vencido' },
                                ...(fiscalModeloEmissaoAutomatica === 'nfce' ? [
                                    { ok: prontidao.cscHomologacao, txt: prontidao.cscHomologacao ? 'CSC de homologação cadastrado' : 'CSC de homologação faltando' },
                                    { ok: prontidao.cscProducao, txt: prontidao.cscProducao ? 'CSC de produção cadastrado' : 'CSC de produção faltando (pegar no site da SEFAZ)' },
                                ] : []),
                                { ok: prontidao.serieProducao != null, txt: prontidao.serieProducao != null ? `Série de produção: ${prontidao.serieProducao}` : 'Série de produção não definida' },
                            ];
                            const prontoProducao = itens.every((i) => i.ok);
                            return (
                                <div className={`p-4 rounded-xl border ${prontoProducao ? 'bg-[var(--ok)]/10 border-[var(--ok)]/30' : 'bg-[var(--surface-2)] border-[var(--border)]'}`}>
                                    <p className="text-sm font-bold text-[var(--text)] mb-2">{prontoProducao ? '✅ Pronto para emitir em produção' : 'Para emitir em produção falta:'}</p>
                                    <ul className="space-y-1">
                                        {itens.map((i) => (
                                            <li key={i.txt} className={`text-sm flex items-center gap-2 ${i.ok ? 'text-[var(--ok)]' : 'text-[var(--warn)]'}`}>
                                                {i.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />} {i.txt}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            );
                        })()}

                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-semibold text-[var(--text)]">Ambiente</label>
                            <select
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30 disabled:opacity-60 disabled:cursor-not-allowed max-sm:text-base"
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
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30 max-sm:text-base"
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
                            <div className="space-y-4 p-4 bg-[var(--surface-2)] rounded-[14px]">
                                <p className="text-[15px] font-semibold text-[var(--text)]">NF-e (com destinatário)</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <Input type="number" inputMode="numeric" label="Série — homologação" className="num" value={fiscalNfeSerie} onChange={e => setFiscalNfeSerie(e.target.value)} />
                                    <Input type="number" inputMode="numeric" label="Último número — homologação" className="num" value={fiscalNfeUltimoNumero} onChange={e => setFiscalNfeUltimoNumero(e.target.value)} />
                                </div>
                                <p className="text-xs text-[var(--text-muted)] -mt-2">↑ Homologação (testes). Deixe 0 se nunca emitiu.</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <Input type="number" inputMode="numeric" label="Série — PRODUÇÃO" className="num" value={fiscalNfeSerieProd} onChange={e => setFiscalNfeSerieProd(e.target.value)} />
                                    <Input type="number" inputMode="numeric" label="Último número emitido — PRODUÇÃO" className="num" value={fiscalNfeUltimoNumeroProd} onChange={e => setFiscalNfeUltimoNumeroProd(e.target.value)} />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-sm font-semibold text-[var(--text)]">Observação padrão — NF-e</label>
                                    <textarea
                                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30 max-sm:text-base"
                                      rows={2}
                                      value={fiscalObservacaoNfe}
                                      onChange={e => setFiscalObservacaoNfe(e.target.value)}
                                    />
                                </div>
                            </div>
                        )}

                        {fiscalModeloEmissaoAutomatica === 'nfce' && (
                            <div className="space-y-4 p-4 bg-[var(--surface-2)] rounded-[14px]">
                                <p className="text-[15px] font-semibold text-[var(--text)]">NFC-e (cupom fiscal)</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <Input type="number" inputMode="numeric" label="Série — homologação" className="num" value={fiscalNfceSerie} onChange={e => setFiscalNfceSerie(e.target.value)} />
                                    <Input type="number" inputMode="numeric" label="Último número — homologação" className="num" value={fiscalNfceUltimoNumero} onChange={e => setFiscalNfceUltimoNumero(e.target.value)} />
                                </div>
                                <p className="text-xs text-[var(--text-muted)] -mt-2">↑ Homologação (testes). Deixe 0 se nunca emitiu.</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <Input type="number" inputMode="numeric" label="Série — PRODUÇÃO" className="num" placeholder="Ex: 2" value={fiscalNfceSerieProd} onChange={e => setFiscalNfceSerieProd(e.target.value)} />
                                    <Input type="number" inputMode="numeric" label="Último número emitido — PRODUÇÃO" className="num" value={fiscalNfceUltimoNumeroProd} onChange={e => setFiscalNfceUltimoNumeroProd(e.target.value)} />
                                </div>
                                <p className="text-xs text-[var(--text-muted)] -mt-2">Produção tem numeração própria. Se a loja já emitia nota por outro sistema, use uma série que ele não usava (ou informe o último número dele). Se o número já tiver sido usado, o sistema pula sozinho pro próximo.</p>
                                <p className="text-xs text-[var(--text-muted)]">CSC (Código de Segurança do Contribuinte) — só existe pra NFC-e, cada ambiente tem o seu.</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <p className="text-[13px] font-semibold text-[var(--text-muted)]">CSC — Homologação</p>
                                        <Input type="password" label="CSC" className="font-mono" placeholder="Deixe em branco pra manter o atual" value={fiscalCscHomologacao} onChange={e => setFiscalCscHomologacao(e.target.value)} />
                                        <Input type="password" label="CSCID" className="font-mono" placeholder="Deixe em branco pra manter o atual" value={fiscalCscidHomologacao} onChange={e => setFiscalCscidHomologacao(e.target.value)} />
                                    </div>
                                    <div className="space-y-2">
                                        <p className="text-[13px] font-semibold text-[var(--text-muted)]">CSC — Produção</p>
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
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                                <div className="space-y-2">
                                    <p className="text-[13px] font-semibold text-[var(--text-muted)]">CT-e</p>
                                    <Input type="number" inputMode="numeric" label="Série" className="num" value={fiscalCteSerie} onChange={e => setFiscalCteSerie(e.target.value)} />
                                    <Input type="number" inputMode="numeric" label="Último número emitido" className="num" value={fiscalCteUltimoNumero} onChange={e => setFiscalCteUltimoNumero(e.target.value)} />
                                    <p className="text-xs text-[var(--text-muted)]">Deixe 0 se nunca emitiu.</p>
                                </div>
                                <div className="space-y-2">
                                    <p className="text-[13px] font-semibold text-[var(--text-muted)]">MDF-e</p>
                                    <Input type="number" inputMode="numeric" label="Série" className="num" value={fiscalMdfeSerie} onChange={e => setFiscalMdfeSerie(e.target.value)} />
                                    <Input type="number" inputMode="numeric" label="Último número emitido" className="num" value={fiscalMdfeUltimoNumero} onChange={e => setFiscalMdfeUltimoNumero(e.target.value)} />
                                    <p className="text-xs text-[var(--text-muted)]">Deixe 0 se nunca emitiu.</p>
                                </div>
                            </div>
                        </details>
                    </div>
                </Collapsible>

                <Collapsible title="Dados Gerais" defaultOpen={false}>
                    <div className="space-y-4">
                        <Input label="Inscrição municipal" className="num" placeholder="Opcional" value={fiscalInscricaoMunicipal} onChange={e => setFiscalInscricaoMunicipal(e.target.value)} />
                        <Input label="Telefone" inputMode="tel" placeholder="Ex: (71) 99999-9999" value={fiscalTelefone} onChange={e => setFiscalTelefone(e.target.value)} />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Input type="number" inputMode="numeric" label="Casas decimais" value={fiscalCasasDecimais} onChange={e => setFiscalCasasDecimais(e.target.value)} />
                            <Input label="CNPJ Autorizado" className="num" placeholder="Opcional" value={fiscalCnpjAutorizado} onChange={e => setFiscalCnpjAutorizado(e.target.value)} />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-semibold text-[var(--text)]">Observação padrão — Pedido/Orçamento</label>
                            <textarea
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30 max-sm:text-base"
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Input label="Razão Social" placeholder="Opcional" value={fiscalRazaoSocial} onChange={e => setFiscalRazaoSocial(e.target.value)} />
                            <Input label="Nome Fantasia" placeholder="Opcional" value={fiscalNomeFantasia} onChange={e => setFiscalNomeFantasia(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="flex flex-col gap-1.5">
                                <label className="text-sm font-semibold text-[var(--text)]">Tipo</label>
                                <select
                                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30 max-sm:text-base"
                                  value={fiscalTipoPessoa}
                                  onChange={e => setFiscalTipoPessoa(e.target.value as 'juridica' | 'fisica')}
                                >
                                    <option value="juridica">Jurídica</option>
                                    <option value="fisica">Física</option>
                                </select>
                            </div>
                            <Input label="Inscrição Estadual" className="num" placeholder="Opcional" value={fiscalInscricaoEstadual} onChange={e => setFiscalInscricaoEstadual(e.target.value)} />
                        </div>
                        <p className="text-[13px] font-semibold text-[var(--text-muted)]">Endereço</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Input label="Logradouro" placeholder="Opcional" value={fiscalEnderecoLogradouro} onChange={e => setFiscalEnderecoLogradouro(e.target.value)} />
                            <Input label="Número" placeholder="Opcional" value={fiscalEnderecoNumero} onChange={e => setFiscalEnderecoNumero(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Input label="CST/CSOSN Padrão" placeholder="Ex: 102" value={fiscalCstCsosnPadrao} onChange={e => setFiscalCstCsosnPadrao(e.target.value)} />
                            <Input label="CST/PIS Padrão" placeholder="Ex: 49" value={fiscalCstPisPadrao} onChange={e => setFiscalCstPisPadrao(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Input label="CST/COFINS Padrão" placeholder="Ex: 49" value={fiscalCstCofinsPadrao} onChange={e => setFiscalCstCofinsPadrao(e.target.value)} />
                            <Input label="CST/IPI Padrão" placeholder="Ex: 53" value={fiscalCstIpiPadrao} onChange={e => setFiscalCstIpiPadrao(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            {activeTab === 'permissoes' && navCtx.can?.('ver_permissoes') && <RolePermissionsView store={store} loggedUser={loggedUser} onStoreUpdate={onStoreUpdate} />}
            {activeTab === 'saude' && roleCan(loggedUser, store, 'editar_cardapio') && <CardapioSaudeView storeId={storeId} />}
            {activeTab === 'regras_caixa' && <RegrasCaixaView store={store} onStoreUpdate={onStoreUpdate} />}
            {activeTab === 'impressao' && <PrinterSettingsView store={store} />}
            {activeTab === 'locais' && <LocaisPreparoView store={store} />}
            {activeTab === 'settings' && <StoreSettingsView store={store} onStoreUpdate={onStoreUpdate} />}
            {activeTab === 'cupons' && <CouponManagementView storeId={storeId} />}
            {activeTab === 'precos' && podeEditarPrecosHorario && <PriceSchedulesView storeId={storeId} />}
            {activeTab === 'relatorios' && <ReportsView storeId={storeId} storeName={store.name} storeSlug={store.slug} userName={loggedUser.name} />}
            {activeTab === 'excecoes' && roleCan(loggedUser, store, 'ver_excecoes') && <ExceptionsReportView storeId={storeId} storeName={store.name} userName={loggedUser.name} />}

            {activeTab === 'sales' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Card className="p-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-[13px] font-medium text-[var(--text-muted)]">Faturamento total</p>
                                    <h3 className="text-[28px] leading-tight font-bold tracking-[-0.02em] num text-[var(--text)] mt-1">R$ <AnimatedNumber value={totalRevenue} format={formatBRL} /></h3>
                                </div>
                                <div className="w-10 h-10 grid place-items-center bg-[var(--surface-2)] rounded-full text-[var(--text-muted)]">
                                    <Receipt size={19} />
                                </div>
                            </div>
                        </Card>
                        <Card className="p-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-[13px] font-medium text-[var(--text-muted)]">Vendas realizadas</p>
                                    <h3 className="text-[28px] leading-tight font-bold tracking-[-0.02em] num text-[var(--text)] mt-1">{filteredAndSortedSales.length}</h3>
                                </div>
                                <div className="w-10 h-10 grid place-items-center bg-[var(--surface-2)] rounded-full text-[var(--text-muted)]">
                                    <CheckCircle size={19} />
                                </div>
                            </div>
                        </Card>
                        <Card className="p-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-[13px] font-medium text-[var(--text-muted)]">Ticket médio</p>
                                    <h3 className="text-[28px] leading-tight font-bold tracking-[-0.02em] num text-[var(--text)] mt-1">
                                        R$ {filteredAndSortedSales.length > 0 ? formatBRL(totalRevenue / filteredAndSortedSales.length) : '0,00'}
                                    </h3>
                                </div>
                                <div className="w-10 h-10 grid place-items-center bg-[var(--surface-2)] rounded-full text-[var(--text-muted)]">
                                    <BarChart3 size={19} />
                                </div>
                            </div>
                        </Card>
                    </div>

                    <Card className="overflow-hidden">
                        <div className="p-4 sm:px-5 border-b border-[var(--border)] flex flex-col gap-4">
                            <div className="flex flex-wrap justify-between items-center gap-3 max-sm:flex-col max-sm:items-stretch">
                                <div className="flex items-center gap-3 flex-wrap min-w-0">
                                    <h3 className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--text)]">Histórico de vendas</h3>
                                    <SegmentedControl
                                        className="max-sm:flex max-sm:w-full max-sm:[&>button]:flex-1 max-sm:[&>button]:px-1.5 max-sm:[&>button]:text-[13px]"
                                        value={historyView}
                                        onChange={(v) => setHistoryView(v as typeof historyView)}
                                        options={[
                                            { value: 'sale', label: <><span className="sm:hidden">Venda</span><span className="max-sm:hidden">Por venda</span></> },
                                            { value: 'product', label: <><span className="sm:hidden">Produto</span><span className="max-sm:hidden">Por produto</span></> },
                                            { value: 'operator', label: <><span className="sm:hidden">Operador</span><span className="max-sm:hidden">Por operador</span></> },
                                            { value: 'canceled', label: 'Canceladas' },
                                        ]}
                                    />
                                    <span className={`text-[13px] text-[var(--text-muted)] num max-sm:hidden ${historyView === 'canceled' ? 'hidden' : ''}`}>{filteredAndSortedSales.length} {filteredAndSortedSales.length === 1 ? 'registro' : 'registros'}</span>
                                </div>
                                {historyView !== 'canceled' && (
                                <div className="flex items-center gap-2 flex-wrap">
                                    <Button variant="secondary" size="sm" className="max-sm:!h-11 max-sm:flex-1" onClick={() => setShowFilters(!showFilters)} aria-pressed={showFilters}>
                                        <Search size={15} />
                                        Filtros
                                    </Button>
                                    <RelatorioMenu storeId={storeId} storeName={store.name} storeSlug={store.slug} userName={loggedUser.name} vendas={filteredAndSortedSales} periodoLabel={subtituloHistorico(filtrosHistorico)} nomeArquivo={nomeArquivoHistorico(filtrosHistorico, store.slug)}
                                        disabled={filteredAndSortedSales.length === 0} onPrintList={handlePrintReport} onCsv={handleExportCsv} />
                                    <div className="w-px h-5 bg-[var(--border)] mx-1 max-sm:hidden" />
                                    <Button variant="ghost" size="sm" className="!text-[var(--err)] hover:!bg-[var(--err)]/10 max-sm:order-last max-sm:w-full max-sm:mt-1 max-sm:!h-11" onClick={handleClearSales} isLoading={isClearing}>
                                        <Trash2 size={15} />
                                        Zerar vendas
                                    </Button>
                                    <span className="text-[13px] text-[var(--text-muted)] num sm:hidden w-full">{filteredAndSortedSales.length} {filteredAndSortedSales.length === 1 ? 'registro' : 'registros'}</span>
                                </div>
                                )}
                            </div>
                            
                            {showFilters && historyView !== 'canceled' && (
                                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4 bg-[var(--surface-2)] rounded-[14px]">
                                    <div>
                                        <label className="block text-[13px] font-medium text-[var(--text-muted)] mb-1">Mês</label>
                                        <Input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-[13px] font-medium text-[var(--text-muted)] mb-1">Data inicial</label>
                                        <Input type="date" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-[13px] font-medium text-[var(--text-muted)] mb-1">Data final</label>
                                        <Input type="date" value={filterEndDate} onChange={e => setFilterEndDate(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-[13px] font-medium text-[var(--text-muted)] mb-1">Tipo</label>
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
                                        <label className="block text-[13px] font-medium text-[var(--text-muted)] mb-1">Cliente / mesa</label>
                                        <Input placeholder="Buscar..." value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)} />
                                    </div>
                                    <div className="flex gap-2">
                                        <div className="flex-1">
                                            <label className="block text-[13px] font-medium text-[var(--text-muted)] mb-1">Mín. itens</label>
                                            <Input type="number" inputMode="numeric" min="0" value={filterMinItems} onChange={e => setFilterMinItems(e.target.value)} />
                                        </div>
                                        <div className="flex-1">
                                            <label className="block text-[13px] font-medium text-[var(--text-muted)] mb-1">Máx. itens</label>
                                            <Input type="number" inputMode="numeric" min="0" value={filterMaxItems} onChange={e => setFilterMaxItems(e.target.value)} />
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <div className="flex-1">
                                            <label className="block text-[13px] font-medium text-[var(--text-muted)] mb-1">Mín. total (R$)</label>
                                            <Input type="number" inputMode="decimal" min="0" step="0.01" value={filterMinTotal} onChange={e => setFilterMinTotal(e.target.value)} />
                                        </div>
                                        <div className="flex-1">
                                            <label className="block text-[13px] font-medium text-[var(--text-muted)] mb-1">Máx. total (R$)</label>
                                            <Input type="number" inputMode="decimal" min="0" step="0.01" value={filterMaxTotal} onChange={e => setFilterMaxTotal(e.target.value)} />
                                        </div>
                                    </div>
                                    {([
                                        ['operator', 'Operador', [['', 'Todos'], ...salesOperators.map((n) => [n, n] as [string, string])]],
                                        ['method', 'Forma de pagamento', [['', 'Todas'], ['CASH', 'Dinheiro'], ['PIX', 'PIX'], ['DEBIT', 'Débito'], ['CREDIT', 'Crédito']]],
                                        ['brand', 'Bandeira', [['', 'Todas'], ...Object.entries(CARD_BRAND_LABELS).map(([id, label]) => [id, label] as [string, string])]],
                                        ['status', 'Situação', [['all', 'Todas'], ['delivered', 'Entregues'], ['canceled', 'Canceladas']]],
                                        ['invoice', 'Nota fiscal', [['all', 'Todas'], ['with', 'Com nota'], ['without', 'Sem nota']]],
                                    ] as [keyof SalesFilters, string, [string, string][]][]).map(([key, label, opts]) => (
                                        <div key={key}>
                                            <label className="block text-[13px] font-medium text-[var(--text-muted)] mb-1">{label}</label>
                                            <select
                                                className="w-full h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[15px] text-[var(--text)]"
                                                value={String(salesFilters[key])}
                                                onChange={(e) => setSalesFilters({ ...salesFilters, [key]: e.target.value } as SalesFilters)}
                                            >
                                                {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                            </select>
                                        </div>
                                    ))}
                                    <div>
                                        <label className="block text-[13px] font-medium text-[var(--text-muted)] mb-1">Mesa</label>
                                        <Input inputMode="numeric" placeholder="Número" value={salesFilters.table} onChange={(e) => setSalesFilters({ ...salesFilters, table: e.target.value.replace(/\D/g, '') })} />
                                    </div>
                                    <div className="flex gap-2">
                                        <div className="flex-1">
                                            <label className="block text-[13px] font-medium text-[var(--text-muted)] mb-1">Das</label>
                                            <Input type="time" value={salesFilters.hourFrom} onChange={(e) => setSalesFilters({ ...salesFilters, hourFrom: e.target.value })} />
                                        </div>
                                        <div className="flex-1">
                                            <label className="block text-[13px] font-medium text-[var(--text-muted)] mb-1">Até</label>
                                            <Input type="time" value={salesFilters.hourTo} onChange={(e) => setSalesFilters({ ...salesFilters, hourTo: e.target.value })} />
                                        </div>
                                    </div>
                                    <div className="flex items-end">
                                        <Button variant="secondary" className="w-full" onClick={clearFilters}>Limpar Filtros</Button>
                                    </div>
                                </div>
                            )}
                        </div>
                        {(describeFilters(salesFilters).length > 0 || savedFilters.length > 0) && (
                            <div className="flex flex-wrap items-center gap-2 px-1 pb-3">
                                {describeFilters(salesFilters).map((c) => (
                                    <button
                                        key={c.key}
                                        type="button"
                                        onClick={() => setSalesFilters(c.key === 'hourFrom' ? { ...salesFilters, hourFrom: '', hourTo: '' } : { ...salesFilters, [c.key]: EMPTY_FILTERS[c.key] } as SalesFilters)}
                                        className="inline-flex items-center gap-1.5 min-h-9 max-sm:min-h-11 px-3 rounded-full bg-[var(--surface-2)] text-[13px] font-medium text-[var(--text)] hover:bg-[var(--border)] u-press"
                                        aria-label={`Remover filtro ${c.label}`}
                                    >
                                        {c.label} <X size={13} />
                                    </button>
                                ))}
                                {describeFilters(salesFilters).length > 0 && (saveFilterName === null ? (
                                    <button type="button" onClick={() => setSaveFilterName('')} className="min-h-9 max-sm:min-h-11 px-3 rounded-full border border-[var(--border)] text-[13px] font-semibold text-[var(--brand)] u-press">Salvar este filtro</button>
                                ) : (
                                    <span className="inline-flex items-center gap-2">
                                        <Input className="!h-9 w-44" placeholder="Nome (ex.: Crédito da Claudia)" value={saveFilterName} onChange={(e) => setSaveFilterName(e.target.value)} maxLength={40} />
                                        <Button size="sm" onClick={() => { const nome = (saveFilterName ?? '').trim(); if (!nome) return; persistSavedFilters([...savedFilters.filter((x) => x.name !== nome), { name: nome, f: salesFilters }]); setSaveFilterName(null); }}>Salvar</Button>
                                        <Button size="sm" variant="secondary" onClick={() => setSaveFilterName(null)}>Cancelar</Button>
                                    </span>
                                ))}
                                {savedFilters.map((sf) => (
                                    <span key={sf.name} className="inline-flex items-center rounded-full border border-[var(--border)] overflow-hidden">
                                        <button type="button" onClick={() => setSalesFilters(sf.f)} className="min-h-9 pl-3 pr-2 text-[13px] font-medium text-[var(--text)] hover:bg-[var(--surface-2)] u-press max-sm:min-h-11">{sf.name}</button>
                                        <button type="button" onClick={() => persistSavedFilters(savedFilters.filter((x) => x.name !== sf.name))} className="min-h-9 px-2 text-[var(--text-muted)] hover:text-[var(--err)] u-press max-sm:min-h-11" aria-label={`Apagar filtro salvo ${sf.name}`}><X size={13} /></button>
                                    </span>
                                ))}
                            </div>
                        )}
                        {historyView === 'canceled' ? (
                            <VendasCanceladasView storeId={storeId} />
                        ) : historyView === 'product' ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-[15px] text-left">
                                    <thead className="text-[var(--text-muted)] text-[13px] border-b border-[var(--border)]">
                                        <tr>
                                            <th className="px-4 py-2.5 font-medium">Produto</th>
                                            <th className="px-4 py-2.5 font-medium text-right">Quantidade</th>
                                            <th className="px-4 py-2.5 font-medium text-right">Faturamento</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[var(--border)]">
                                        {productBreakdown.length === 0 ? (
                                            <tr>
                                                <td colSpan={3} className="px-4 py-8 text-center text-[var(--text-muted)]">
                                                    Nenhuma venda encontrada com os filtros atuais.
                                                </td>
                                            </tr>
                                        ) : (
                                            productBreakdown.map((row, i) => (
                                                <tr key={row.name} className="u-stagger" style={stagger(Math.min(i, 10) * 30)}>
                                                    <td className="px-4 py-3 font-medium text-[var(--text)]">{row.name}</td>
                                                    <td className="px-4 py-3 text-right num text-[var(--text-muted)]">{row.quantity}</td>
                                                    <td className="px-4 py-3 text-right font-semibold num text-[var(--text)]">R$ {formatBRL(row.revenue)}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        ) : historyView === 'operator' ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-[15px] text-left">
                                    <thead className="text-[var(--text-muted)] text-[13px] border-b border-[var(--border)]">
                                        <tr>
                                            <th className="px-4 py-2.5 font-medium">Operador</th>
                                            <th className="px-4 py-2.5 font-medium text-right">Vendas fechadas</th>
                                            <th className="px-4 py-2.5 font-medium text-right">Total recebido</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[var(--border)]">
                                        {operatorBreakdown.length === 0 ? (
                                            <tr>
                                                <td colSpan={3} className="px-4 py-8 text-center text-[var(--text-muted)]">
                                                    Nenhuma venda encontrada com os filtros atuais.
                                                </td>
                                            </tr>
                                        ) : (
                                            operatorBreakdown.map((row, i) => (
                                                <tr key={row.name} className="u-stagger" style={stagger(Math.min(i, 10) * 30)}>
                                                    <td className="px-4 py-3 font-medium text-[var(--text)]">{row.name}</td>
                                                    <td className="px-4 py-3 text-right num text-[var(--text-muted)]">{row.sales}</td>
                                                    <td className="px-4 py-3 text-right font-semibold num text-[var(--text)]">R$ {formatBRL(row.revenue)}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                        <>
                        <div className="overflow-x-auto">
                            <table className="w-full text-[15px] text-left">
                                <thead className="text-[var(--text-muted)] text-[13px] border-b border-[var(--border)]">
                                    <tr>
                                        <th className="px-4 py-2.5 font-medium cursor-pointer hover:text-[var(--text)] transition-colors group" onClick={() => handleSort('date')}>
                                            Data <SortIcon column="date" />
                                        </th>
                                        <th className="px-4 py-2.5 font-medium cursor-pointer hover:text-[var(--text)] transition-colors group" onClick={() => handleSort('type')}>
                                            Tipo <SortIcon column="type" />
                                        </th>
                                        <th className="px-4 py-2.5 font-medium cursor-pointer hover:text-[var(--text)] transition-colors group" onClick={() => handleSort('customer')}>
                                            Cliente / mesa <SortIcon column="customer" />
                                        </th>
                                        <th className="px-4 py-2.5 font-medium cursor-pointer hover:text-[var(--text)] transition-colors group" onClick={() => handleSort('items')}>
                                            Itens <SortIcon column="items" />
                                        </th>
                                        <th className="px-4 py-2.5 font-medium text-right cursor-pointer hover:text-[var(--text)] transition-colors group" onClick={() => handleSort('total')}>
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
                                            <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">
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
                                                    <td className="px-4 py-3 text-[var(--text-muted)] num">
                                                        {new Date(order.created_at).toLocaleDateString()} <span className="text-[13px] text-[var(--text-muted)]/70 ml-1">{new Date(order.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {order.order_type === 'counter' ? (
                                                            <Badge color="bg-[var(--warn)]/12 text-[var(--warn)]">Balcão</Badge>
                                                        ) : (
                                                            <Badge color="bg-[var(--surface-2)] text-[var(--text)]">Mesa</Badge>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 font-medium text-[var(--text)]">
                                                        {order.order_type === 'table' ? `Mesa ${order.tables?.number || '?'}` : (order.customer_name || 'Cliente Balcão')}
                                                    </td>
                                                    <td className="px-4 py-3 text-[var(--text-muted)] max-w-xs">
                                                        <div className="group/items relative inline-block">
                                                            <span className="truncate">{rotuloQtdItens(qtdItensAtivos(order))}</span>
                                                            {(order.order_items?.length || 0) > 0 && (
                                                                <div className="hidden group-hover/items:block absolute z-20 left-0 top-full mt-1 w-56 max-h-48 overflow-y-auto rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] shadow-lg p-2 text-xs text-[var(--text)] whitespace-normal">
                                                                    {order.order_items?.map((i, idx) => (
                                                                        <div key={idx} className="flex justify-between gap-2 py-0.5">
                                                                            <span className={itemCancelado(i) ? 'line-through text-[var(--text-muted)]' : ''}>{i.quantity}x {getOrderItemDisplayName(i)}{itemCancelado(i) ? ' (cancelado)' : ''}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-semibold num text-[var(--text)]">
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
                            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)]">
                                <span className="text-[13px] text-[var(--text-muted)]">
                                    Página {salesPage + 1} de {salesTotalPages}
                                </span>
                                <div className="flex items-center gap-2">
                                    <Button variant="secondary" size="sm" className="max-sm:!h-11" disabled={salesPage === 0} onClick={() => setSalesPage(p => Math.max(0, p - 1))}>
                                        <ChevronLeft size={14} /> Anterior
                                    </Button>
                                    <Button variant="secondary" size="sm" className="max-sm:!h-11" disabled={salesPage >= salesTotalPages - 1} onClick={() => setSalesPage(p => Math.min(salesTotalPages - 1, p + 1))}>
                                        Próxima <ChevronRight size={14} />
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
            <Modal isOpen={!!selectedOrderDetails} onClose={() => setSelectedOrderDetails(null)} title="Detalhes da venda">
                {selectedOrderDetails && (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
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
                            <h4 className="font-semibold text-[15px] text-[var(--text)] mb-2">Itens do pedido</h4>
                            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                                {/* Ativos primeiro; item cancelado aparece riscado com selo e FORA de qualquer total. Cada linha mostra quem lançou (added_by_name). */}
                                {[...itensAtivos(selectedOrderDetails), ...(selectedOrderDetails.order_items ?? []).filter(itemCancelado)].map(item => {
                                    const cancelado = itemCancelado(item);
                                    return (
                                        <div key={item.id} data-item-cancelado={cancelado ? 'true' : undefined} className="flex justify-between gap-3 text-sm">
                                            <div className="flex gap-2 min-w-0">
                                                <span className="font-medium text-[var(--text-muted)]">{item.quantity}x</span>
                                                <div className="min-w-0">
                                                    <span className={cancelado ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text)]'}>{getOrderItemDisplayName(item)}</span>
                                                    {cancelado && <span className="ml-2 rounded-full bg-[var(--err)]/12 px-2 py-0.5 text-[11px] font-semibold text-[var(--err)] no-underline">Cancelado</span>}
                                                    {item.added_by_name && <p className="text-[12px] text-[var(--text-muted)]">Lançado por {item.added_by_name}</p>}
                                                </div>
                                            </div>
                                            <span className={`shrink-0 ${cancelado ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-muted)]'}`}>R$ {formatBRL(item.price_at_time * item.quantity)}</span>
                                        </div>
                                    );
                                })}
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
                            const itemsTotal = subtotalItensAtivos(selectedOrderDetails);
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
                                            <span className="text-[var(--text-muted)]">Taxa de Serviço ({formatServiceFeeRate(resolveServiceFeeRate(store.config))} opcional)</span>
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
            </AdminNavShell>
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
    contingencia: 'Contingência',
    cancelada: 'Cancelada',
};

const fiscalStatusBadgeColor = (status: string): string => {
    switch (status) {
        case 'autorizada': return 'bg-[var(--ok)]/10 text-[var(--ok)] border border-[var(--ok)]/20';
        case 'pendente': return 'bg-[var(--info)]/10 text-[var(--info)] border border-[var(--info)]/20';
        case 'contingencia': return 'bg-[var(--warn)]/10 text-[var(--warn)] border border-[var(--warn)]/20';
        case 'cancelada': return 'bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border)]';
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

// Administração → Configurações → Integrações. Antes: "Integração com o NTB Estoque" morava na tela de
// Cardápio e "Integração direta com a Omie" dentro do Emissor fiscal; ambas são configuração, não operação.
// URL/chave nunca voltam do banco (write-only), só o toggle `ativo` e se já está configurada.
const IntegracoesView: React.FC<{ storeId: string; podeEditarEstoque: boolean; operador: string }> = ({ storeId, podeEditarEstoque, operador }) => {
    const [ntbEstoqueStatus, setNtbEstoqueStatus] = useState<NtbEstoqueIntegracaoStatus>({ configurado: false, ativo: false });
    // Estado REAL da ligação (a chave responde? a loja do Estoque é de teste?) e baixas que não fecharam.
    const conexaoEstoque = useConexaoEstoque(storeId, ntbEstoqueStatus.configurado);
    const [baixasResumo, setBaixasResumo] = useState<BaixasEstoqueResumo | null>(null);
    const [ntbEstoqueUrlInput, setNtbEstoqueUrlInput] = useState('');
    const [ntbEstoqueApiKeyInput, setNtbEstoqueApiKeyInput] = useState('');
    const [isSavingNtbEstoque, setIsSavingNtbEstoque] = useState(false);

    useEffect(() => { fetchNtbEstoqueIntegracaoStatus(storeId).then(setNtbEstoqueStatus); }, [storeId]);

    const handleSaveNtbEstoqueIntegracao = async () => {
        if (!podeEditarEstoque) { toast.error('Seu perfil não pode alterar esta integração.'); return; }
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
        if (!podeEditarEstoque) { toast.error('Seu perfil não pode alterar esta integração.'); return; }
        const result = await saveNtbEstoqueIntegracaoConfig(storeId, { ativo });
        if (!result.success) return toast.error('Erro ao atualizar: ' + result.message);
        setNtbEstoqueStatus((prev) => ({ ...prev, ativo }));
        toast.success(ativo ? 'Ordem de Produção automática ativada.' : 'Ordem de Produção automática desativada.');
    };

    // Integração direta com a Omie (2026-09-05): só pra loja que NÃO usa ntb-estoque.
    const [omieDiretoConfigurado, setOmieDiretoConfigurado] = useState(false);
    const [omieAppKeyInput, setOmieAppKeyInput] = useState('');
    const [omieAppSecretInput, setOmieAppSecretInput] = useState('');
    const [isSavingOmieDireto, setIsSavingOmieDireto] = useState(false);
    useEffect(() => { fetchOmieDiretoStatus(storeId).then((r) => setOmieDiretoConfigurado(r.configurado)); }, [storeId]);

    const handleSaveOmieDireto = async () => {
        if (!omieAppKeyInput || !omieAppSecretInput) {
            return toast.error('Preencha App Key e App Secret da Omie.');
        }
        setIsSavingOmieDireto(true);
        try {
            const result = await saveOmieDiretoConfig(storeId, { omieAppKey: omieAppKeyInput, omieAppSecret: omieAppSecretInput });
            if (!result.success) throw new Error(result.message);
            toast.success('Integração direta com a Omie salva!');
            setOmieAppKeyInput('');
            setOmieAppSecretInput('');
            setOmieDiretoConfigurado(true);
        } catch (e: any) {
            toast.error('Erro ao salvar integração Omie: ' + e.message);
        } finally {
            setIsSavingOmieDireto(false);
        }
    };

    return (
        <div className="space-y-3">
            <Collapsible
                title="Integração com o NTB Estoque"
                defaultOpen={true}
                badge={<SeloConexao configurado={ntbEstoqueStatus.configurado} teste={conexaoEstoque.teste} testando={conexaoEstoque.testando} />}
            >
                <div className="space-y-4">
                    <p className="text-sm text-[var(--text-muted)]">Cada venda fechada cria automaticamente uma Ordem de Produção no NTB Estoque, consumindo os ingredientes da receita.</p>

                    <PainelConexao configurado={ntbEstoqueStatus.configurado} ativo={ntbEstoqueStatus.ativo} teste={conexaoEstoque.teste} testando={conexaoEstoque.testando} onTestar={conexaoEstoque.testar} />

                    <div className="flex items-center justify-between gap-3 p-4 bg-[var(--surface-2)] rounded-[var(--r-md)]">
                        <div>
                            <h4 className="text-[15px] font-semibold text-[var(--text)]">Ordem de produção automática</h4>
                            <p className="text-sm text-[var(--text-muted)]">
                                {ntbEstoqueStatus.configurado
                                    ? (ntbEstoqueStatus.ativo ? 'Ativa — toda venda dispara uma ordem de produção.' : 'Configurada, mas desativada — nenhuma ordem é disparada.')
                                    : 'Ainda não configurada — preencha a URL e a chave de API abaixo.'}
                            </p>
                        </div>
                        <button
                            onClick={() => handleToggleNtbEstoqueAtivo(!ntbEstoqueStatus.ativo)}
                            disabled={!ntbEstoqueStatus.configurado || !podeEditarEstoque}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${ntbEstoqueStatus.ativo ? 'bg-[var(--ok-fill)]' : 'bg-[var(--border)]'}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${ntbEstoqueStatus.ativo ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Input
                            label="URL do NTB Estoque"
                            placeholder="https://app-estoque.norteparanegocios.com.br"
                            value={ntbEstoqueUrlInput}
                            disabled={!podeEditarEstoque}
                            onChange={e => setNtbEstoqueUrlInput(e.target.value)}
                        />
                        <Input
                            label="Chave de API"
                            type="password"
                            placeholder={ntbEstoqueStatus.configurado ? '••••••••  (preencher só pra trocar)' : 'Chave de integração da loja no NTB Estoque'}
                            value={ntbEstoqueApiKeyInput}
                            disabled={!podeEditarEstoque}
                            onChange={e => setNtbEstoqueApiKeyInput(e.target.value)}
                        />
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">A chave nunca é exibida de volta depois de salva — deixe em branco se não quiser trocá-la.</p>

                    <Button variant="secondary" className="w-full" onClick={handleSaveNtbEstoqueIntegracao} isLoading={isSavingNtbEstoque} disabled={!podeEditarEstoque}>
                        Salvar integração com o NTB Estoque
                    </Button>
                </div>
            </Collapsible>

            <Collapsible
                title="Baixas de estoque"
                defaultOpen={true}
                badge={baixasResumo && baixasResumo.com_erro > 0 ? <Badge variant="critical" dot>{baixasResumo.com_erro} com erro</Badge> : undefined}
            >
                <BaixasEstoque storeId={storeId} podeAgir={podeEditarEstoque} operador={operador} onResumo={setBaixasResumo} />
            </Collapsible>

            {/* Integração direta com a Omie (2026-09-05) — só pra loja que NÃO usa
                ntb-estoque; se a loja tiver ntb-estoque configurado E ativo, esse
                caminho nunca é usado (ver app/api/fiscal/emitir/route.ts). */}
            <Collapsible
                title="Integração direta com a Omie"
                defaultOpen={false}
                badge={omieDiretoConfigurado ? <Badge color="bg-[var(--ok)]/10 text-[var(--ok)]" dot>Configurado</Badge> : undefined}
            >
                <div className="space-y-3">
                    <p className="text-sm text-[var(--text-muted)]">
                        Pra lojas que não usam o NTB Estoque: registra a NFC-e autorizada direto na Omie, sem passar por outra integração.
                        Se a loja tiver integração com o NTB Estoque ativa, ela sempre tem prioridade sobre esta.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Input
                            label="App Key da Omie"
                            placeholder={omieDiretoConfigurado ? '••••••••  (preencher só pra trocar)' : 'App Key da conta Omie da loja'}
                            value={omieAppKeyInput}
                            onChange={e => setOmieAppKeyInput(e.target.value)}
                        />
                        <Input
                            label="App Secret da Omie"
                            type="password"
                            placeholder={omieDiretoConfigurado ? '••••••••  (preencher só pra trocar)' : 'App Secret da conta Omie da loja'}
                            value={omieAppSecretInput}
                            onChange={e => setOmieAppSecretInput(e.target.value)}
                        />
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">A chave nunca é exibida de volta depois de salva — deixe em branco se não quiser trocá-la.</p>
                    <Button variant="secondary" className="w-full" onClick={handleSaveOmieDireto} isLoading={isSavingOmieDireto}>
                        Salvar Integração Direta com a Omie
                    </Button>
                </div>
            </Collapsible>
        </div>
    );
};

const FiscalNotasView: React.FC<{ storeId: string; storeName?: string; modoCaixa?: boolean; onConfigurarEmissor?: () => void }> = ({ storeId, storeName = '', modoCaixa = false, onConfigurarEmissor }) => {
    const [notas, setNotas] = useState<FiscalNota[]>([]);
    const [reimprimindoId, setReimprimindoId] = useState<string | null>(null);
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
    const [statusFilter, setStatusFilter] = useState<'todos' | 'autorizada' | 'cancelada' | 'contingencia' | 'problema'>('todos');

    // Cancelamento (evento 110111, pedido do Ramon 2026-09-26). O prazo legal
    // (lib/fiscal/prazoCancelamento.ts) é contado da autorização; `agora`
    // anda sozinho pra o botão sumir quando o prazo acaba com a tela aberta.
    const [cancelingNota, setCancelingNota] = useState<FiscalNota | null>(null);
    const [cancelJustificativa, setCancelJustificativa] = useState('');
    const [isCanceling, setIsCanceling] = useState(false);
    const [agora, setAgora] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setAgora(Date.now()), 20000);
        return () => clearInterval(t);
    }, []);
    // Filtro de período pro "Exportar período" (Task 5, 2026-08-23) — reaproveita
    // o mesmo padrão de Data Inicial/Data Final já usado no Histórico de Vendas
    // (StoreAdminView acima), <Input type="date"> simples. Não filtra a tabela
    // em si (isso já é feito pelos filtros de ambiente/tipo acima) — só delimita
    // o intervalo mandado pra rota de exportação.
    const [exportStartDate, setExportStartDate] = useState('');
    const [exportEndDate, setExportEndDate] = useState('');
    const [isExporting, setIsExporting] = useState(false);
    const notasBase = notas
        .filter(n => ambienteFilter === 'todos' || n.ambiente === ambienteFilter)
        .filter(n => tipoFilter === 'todos' || n.modelo === tipoFilter);
    const contarStatus = (f: typeof statusFilter) => notasBase.filter(n => f === 'todos'
        || (f === 'problema' ? RETRYABLE_FISCAL_STATUSES.includes(n.status) : n.status === f)).length;
    const totalCanceladas = notasBase.filter(n => n.status === 'cancelada').reduce((acc, n) => acc + Number(n.valor_total ?? 0), 0);
    const filteredNotas = notasBase
        .filter(n => statusFilter === 'todos'
            || (statusFilter === 'problema' ? RETRYABLE_FISCAL_STATUSES.includes(n.status) : n.status === statusFilter));

    // Início do prazo na tela: created_at da linha (a emissão síncrona grava a
    // linha logo depois do protocolo). O servidor confere de novo usando o
    // dhRecbto do XML autorizado, que é o horário oficial.
    const podeCancelar = (nota: FiscalNota) =>
        nota.status === 'autorizada' && !!nota.chave_acesso && !!nota.protocolo
        && dentroDoPrazoCancelamento(nota.modelo, nota.created_at, new Date(agora));

    const openCancel = (nota: FiscalNota) => {
        setCancelJustificativa('');
        setCancelingNota(nota);
    };

    const handleConfirmCancel = async () => {
        const nota = cancelingNota;
        if (!nota) return;
        const justificativa = cancelJustificativa.replace(/\s+/g, ' ').trim();
        if (justificativa.length < 15) {
            toast.error('Escreva o motivo com pelo menos 15 caracteres.');
            return;
        }
        if (!dentroDoPrazoCancelamento(nota.modelo, nota.created_at)) {
            toast.error(mensagemPrazoEncerrado(nota.modelo));
            setCancelingNota(null);
            return;
        }
        setIsCanceling(true);
        try {
            const result = await cancelarFiscalNota({ storeId, notaId: nota.id, justificativa });
            if (result?.ok) {
                if (result.aviso) toast.error(result.aviso);
                else toast.success(result.mensagem || 'Nota cancelada na SEFAZ.');
                setCancelingNota(null);
                await load();
            } else {
                toast.error(result?.reason || 'Não foi possível cancelar a nota.');
                if (result?.prazoEncerrado) {
                    setCancelingNota(null);
                    await load();
                }
            }
        } catch (e: any) {
            toast.error('Erro ao cancelar: ' + (e?.message || 'falha de conexão'));
        } finally {
            setIsCanceling(false);
        }
    };

    // Baixa o ZIP (XMLs + CSV) do período via app/api/fiscal/exportar — a
    // rota resolve as notas server-side só por storeId+intervalo (nunca por
    // uma lista de ids que este componente mandasse), então não precisa (e
    // não deve) mandar `filteredNotas`/ids nenhum aqui, só o intervalo.
    const handleExportPeriodo = async () => {
        registrarAcao(storeId, 'fiscal.exportar', { entity: 'fiscal_notas', summary: `Exportou notas fiscais (${exportStartDate || 'início'} a ${exportEndDate || 'hoje'})` });
        setIsExporting(true);
        try {
            const params = new URLSearchParams({ storeId });
            if (exportStartDate) params.set('startDate', exportStartDate);
            if (exportEndDate) params.set('endDate', exportEndDate);
            const res = await fetch(`${resolverUrlApi('/api/fiscal/exportar')}?${params.toString()}`);
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
        registrarAcao(storeId, 'fiscal.ver_pdf', { entity: 'fiscal_notas', entityId: nota.id, summary: `Abriu o PDF da nota nº ${nota.numero ?? ''}` });
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

    // Reimprime o cupom na MESMA impressora do fechamento (fila print_jobs, impressoras com o documento
    // "cupom_fiscal"): quem está no caixa toca em Reimprimir e sai na térmica, sem abrir PDF no navegador.
    // dedupeKey com carimbo de tempo: cada toque é uma impressão nova (a chave estável do fechamento a descartaria).
    const handleReimprimir = async (nota: FiscalNota) => {
        if (reimprimindoId) return;
        registrarAcao(storeId, 'reimpressao.cupom_fiscal', { entity: 'fiscal_notas', entityId: nota.id, summary: `Reimprimiu ${nota.modelo === '65' ? 'NFC-e' : 'NF-e'} nº ${nota.numero ?? ''}`, details: { valor: nota.valor_total } });
        setReimprimindoId(nota.id);
        try {
            const texto = buildFiscalCupomText({ storeName, nota });
            const sobDemanda = nota.modelo === '65' && nota.status === 'autorizada';
            let pdfFixo = '';
            if (!sobDemanda) {
                if (!nota.pdf_path) { toast.error('Esta nota ainda não tem PDF para imprimir.'); return; }
                pdfFixo = await fetchFiscalNotaPdfUrl(nota.id, nota.pdf_path);
            }
            const vias = nota.status === 'contingencia' ? 2 : 1;
            const carimbo = Date.now();
            let enviados = 0;
            for (let via = 1; via <= vias; via++) {
                enviados = Math.max(enviados, await enqueueFiscalCupomPrintJobs(
                    storeId,
                    `Cupom Fiscal - ${nota.modelo === '65' ? 'NFC-e' : 'NF-e'} ${nota.numero ?? ''} (reimpressão${via > 1 ? ` via ${via}` : ''})`,
                    texto,
                    `cupom-fiscal-reimp:${nota.id}:${carimbo}:${via}`,
                    (larg) => sobDemanda ? resolverUrlApi(`/api/fiscal/cupom-pdf?noteId=${nota.id}&larguraMm=${larg}`) : pdfFixo,
                ));
            }
            if (enviados === 0) toast.error('Nenhuma impressora de cupom fiscal está configurada. Veja Configurações > Impressão.');
            else toast.success(`Cupom ${nota.numero ?? ''} enviado para a impressora do caixa.`);
        } catch (e: any) {
            toast.error('Não consegui reimprimir: ' + (e?.message || 'erro desconhecido'));
        } finally {
            setReimprimindoId(null);
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

    // Clique no botão "Reemitir" — abre o modal opcional de CPF/CNPJ sempre
    // que a nota está 'pendente' (única razão que a rota usa esse status,
    // pros dois modelos — ver app/api/fiscal/emitir/route.ts: falta ou
    // documento inválido do destinatário). 2026-09-21: antes disso o modal
    // só abria pra modelo 55 — uma NFC-e 'pendente' por CPF/CNPJ inválido
    // reemitia na hora SEM destinatário nenhum, descartando silenciosamente
    // o documento que o lojista queria corrigir. Qualquer outro status
    // ('erro' etc.) continua reemitindo direto, sem modal.
    const handleRetryClick = (nota: FiscalNota) => {
        if (nota.status === 'pendente') {
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
            {(() => {
                const emContingencia = notas.filter((n) => n.status === 'contingencia');
                if (emContingencia.length === 0) return null;
                const UMA_HORA_MS = 60 * 60 * 1000;
                const antigas = emContingencia.filter((n) => Date.now() - new Date(n.created_at).getTime() > 2 * UMA_HORA_MS);
                return (
                    <div className={`p-3 px-4 rounded-[14px] border text-[15px] font-medium ${antigas.length > 0 ? 'bg-[var(--err)]/10 border-[var(--err)]/30 text-[var(--err)]' : 'bg-[var(--warn)]/10 border-[var(--warn)]/30 text-[var(--warn)]'}`}>
                        {antigas.length > 0
                            ? `${antigas.length} nota(s) em contingência pendente(s) há mais de 2h — verifique a conexão com a SEFAZ. (${emContingencia.length} no total aguardando confirmação.)`
                            : `${emContingencia.length} nota(s) em contingência aguardando confirmação automática da SEFAZ.`}
                    </div>
                );
            })()}
            <Card className="overflow-hidden">
                <div className="p-4 sm:px-5 border-b border-[var(--border)] flex flex-col gap-3">
                    <div className="flex justify-between items-center flex-wrap gap-2">
                        <div className="flex items-center gap-x-3 flex-wrap">
                            <h3 className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--text)]">Notas fiscais</h3>
                            {onConfigurarEmissor && (
                                <button type="button" onClick={onConfigurarEmissor} className="inline-flex items-center text-[13px] font-medium text-[var(--brand)] hover:underline underline-offset-2 max-sm:min-h-11">
                                    Configurar emissor
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <select
                                className="h-8 max-sm:h-11 px-3 text-[13px] font-medium rounded-full bg-[var(--surface-2)] text-[var(--text)] max-sm:text-base focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40"
                                value={tipoFilter}
                                onChange={(e) => setTipoFilter(e.target.value as 'todos' | '55' | '65')}
                            >
                                <option value="todos">NF-e e NFC-e</option>
                                <option value="55">Só NF-e</option>
                                <option value="65">Só NFC-e</option>
                            </select>
                            <select
                                className="h-8 max-sm:h-11 px-3 text-[13px] font-medium rounded-full bg-[var(--surface-2)] text-[var(--text)] max-sm:text-base focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40"
                                value={ambienteFilter}
                                onChange={(e) => setAmbienteFilter(e.target.value as 'todos' | 'homologacao' | 'producao')}
                            >
                                <option value="todos">Todos os ambientes</option>
                                <option value="homologacao">Só Homologação</option>
                                <option value="producao">Só Produção</option>
                            </select>

                            <Button variant="secondary" size="sm" className="max-sm:!h-11" onClick={load} isLoading={isLoading}>
                                <RefreshCw size={14} /> Atualizar
                            </Button>
                            <Badge color="bg-transparent text-[var(--text-muted)] !text-[13px] num">
                                {filteredNotas.length} {filteredNotas.length === 1 ? 'nota' : 'notas'}
                            </Badge>
                        </div>
                    </div>
                    <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5" role="tablist" aria-label="Status das notas">
                        {([
                            ['todos', 'Todas'],
                            ['autorizada', 'Autorizadas'],
                            ['cancelada', 'Canceladas'],
                            ['contingencia', 'Em contingência'],
                            ['problema', 'Com erro ou pendentes'],
                        ] as const).map(([id, label]) => (
                            <button
                                key={id}
                                type="button"
                                role="tab"
                                aria-selected={statusFilter === id}
                                onClick={() => setStatusFilter(id)}
                                className={`shrink-0 h-8 max-sm:h-11 px-3.5 text-[13px] font-medium rounded-full transition-colors ${statusFilter === id ? 'bg-[var(--brand-soft)] text-[var(--brand)] font-semibold' : 'bg-[var(--surface-2)] text-[var(--text)]'}`}
                            >
                                {label} <span className="num opacity-70">{contarStatus(id)}</span>
                            </button>
                        ))}
                    </div>
                    {statusFilter === 'cancelada' && (
                        <p className="text-[13px] text-[var(--text-muted)]">
                            {contarStatus('cancelada')} {contarStatus('cancelada') === 1 ? 'nota cancelada' : 'notas canceladas'} · R$ <span className="num">{formatBRL(totalCanceladas)}</span> em valor cancelado
                        </p>
                    )}
                    {/* Filtro de período + exportação em lote (Task 5, 2026-08-23) — a
                        rota app/api/fiscal/exportar resolve as notas server-side só por
                        storeId + este intervalo, nunca por uma lista mandada daqui. */}
                    <div className="flex items-end gap-2 flex-wrap">
                        <div>
                            <label className="block text-[13px] font-medium text-[var(--text-muted)] mb-1">Data inicial</label>
                            <Input type="date" value={exportStartDate} onChange={e => setExportStartDate(e.target.value)} className="!h-8 max-sm:!h-11 !text-[13px] max-sm:!text-base" />
                        </div>
                        <div>
                            <label className="block text-[13px] font-medium text-[var(--text-muted)] mb-1">Data final</label>
                            <Input type="date" value={exportEndDate} onChange={e => setExportEndDate(e.target.value)} className="!h-8 max-sm:!h-11 !text-[13px] max-sm:!text-base" />
                        </div>
                        <Button variant="secondary" size="sm" className="max-sm:!h-11" onClick={handleExportPeriodo} isLoading={isExporting}>
                            <Download size={14} /> Exportar período
                        </Button>
                    </div>
                    <p className="text-[13px] text-[var(--text-muted)]">
                        Cancelamento: NFC-e em até {PRAZO_CANCELAMENTO_TEXTO['65']} e NF-e em até {PRAZO_CANCELAMENTO_TEXTO['55']} depois da autorização. Depois disso a SEFAZ não aceita mais.
                    </p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-[15px] text-left">
                        <thead className="text-[var(--text-muted)] text-[13px] border-b border-[var(--border)]">
                            <tr>
                                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Data</th>
                                <th className="px-4 py-2.5 font-medium whitespace-nowrap text-right">Valor</th>
                                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Modelo</th>
                                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Ambiente</th>
                                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Status</th>
                                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Chave de acesso</th>
                                <th className="px-4 py-2.5 font-medium whitespace-nowrap text-right">Ações</th>
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
                                    <td colSpan={7} className="px-4 py-8 text-[var(--text-muted)] italic">
                                        <div className="sticky left-4 w-[calc(100vw-6rem)] sm:w-auto text-center">
                                            {notas.length === 0 ? 'Nenhuma nota fiscal emitida ainda.' : 'Nenhuma nota com esses filtros.'}
                                        </div>
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
                                            <Badge color={fiscalStatusBadgeColor(nota.status)} dot>
                                                {FISCAL_STATUS_LABELS[nota.status] || nota.status}
                                            </Badge>
                                            {nota.status === 'cancelada' ? (
                                                <p className="text-xs text-[var(--text-muted)] mt-1 max-w-xs truncate" title={nota.cancelamento_justificativa || undefined}>
                                                    {nota.cancelada_em ? `Em ${new Date(nota.cancelada_em).toLocaleDateString()} ${new Date(nota.cancelada_em).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Cancelada'}
                                                    {nota.cancelamento_justificativa ? ` · ${nota.cancelamento_justificativa}` : ''}
                                                </p>
                                            ) : nota.motivo_erro && (
                                                <p className="text-xs text-[var(--text-muted)] mt-1 max-w-xs truncate" title={nota.motivo_erro}>{nota.motivo_erro}</p>
                                            )}
                                            {nota.modelo === '65' && nota.omie_status === 'erro' && (
                                                <p className="text-xs text-[var(--err)] mt-1 max-w-xs line-clamp-3" title={nota.omie_erro || undefined}>Omie não registrou{nota.omie_erro ? `: ${nota.omie_erro}` : ' a nota'}</p>
                                            )}
                                            {nota.modelo === '65' && nota.omie_status === 'na_fila' && (
                                                <p className="text-xs text-[var(--warn)] mt-1 max-w-xs line-clamp-2" title={nota.omie_erro || undefined}>Omie: reenvio automático</p>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-[var(--text-muted)] font-mono text-xs">
                                            {nota.chave_acesso ? (
                                                <span title={nota.chave_acesso}>{nota.chave_acesso.slice(0, 8)}…{nota.chave_acesso.slice(-8)}</span>
                                            ) : '—'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex justify-end gap-2">
                                                {(nota.status === 'autorizada' || nota.status === 'contingencia') && (
                                                    <Button variant="primary" size="sm" onClick={() => handleReimprimir(nota)} isLoading={reimprimindoId === nota.id}>
                                                        <Printer size={14} className="mr-1.5" /> Reimprimir
                                                    </Button>
                                                )}
                                                {nota.pdf_path && (
                                                    <Button variant="secondary" size="sm" onClick={() => handleDownload(nota)} isLoading={downloadingId === nota.id}>
                                                        <Download size={14} className="mr-1.5" /> {nota.modelo === '55' ? 'DANFE' : 'Cupom'}
                                                    </Button>
                                                )}
                                                {!modoCaixa && RETRYABLE_FISCAL_STATUSES.includes(nota.status) && (
                                                    <Button variant="outline" size="sm" onClick={() => handleRetryClick(nota)} isLoading={retryingId === nota.id}>
                                                        <RotateCcw size={14} className="mr-1.5" /> Reemitir
                                                    </Button>
                                                )}
                                                {!modoCaixa && podeCancelar(nota) && (
                                                    <Button variant="outline" size="sm" onClick={() => openCancel(nota)}>
                                                        <Ban size={14} className="mr-1.5" /> Cancelar nota
                                                    </Button>
                                                )}
                                                {!nota.pdf_path && !RETRYABLE_FISCAL_STATUSES.includes(nota.status) && !podeCancelar(nota) && (
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

            {/* Destinatário na reemissão (Task 17; 2026-09-21: vale pros dois
                modelos) — só abre quando a nota está 'pendente'
                (handleRetryClick decide isso antes). */}
            <Modal isOpen={!!retryingNota} onClose={() => setRetryingNota(null)} title="Reemitir Nota">
                <div className="space-y-4">
                    <div className="bg-[var(--surface-2)] p-4 rounded-[14px] space-y-2">
                        <p className="text-[13px] font-semibold text-[var(--text-muted)]">
                            Documento do destinatário (opcional)
                        </p>
                        <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            className="w-full h-11 px-3 rounded-[var(--r-md)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 text-base sm:text-[15px]"
                            placeholder="CPF ou CNPJ do cliente"
                            value={retryDestCpfCnpj}
                            onChange={(e) => setRetryDestCpfCnpj(e.target.value)}
                        />
                        <input
                            type="text"
                            className="w-full h-11 px-3 rounded-[var(--r-md)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 text-base sm:text-[15px]"
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

            <Modal isOpen={!!cancelingNota} onClose={() => { if (!isCanceling) setCancelingNota(null); }} title="Cancelar nota">
                {cancelingNota && (() => {
                    const nota = cancelingNota;
                    const limite = limiteCancelamento(nota.modelo, nota.created_at);
                    const minutosRestantes = Math.max(0, Math.floor((limite.getTime() - agora) / 60000));
                    const restante = minutosRestantes >= 120
                        ? `${Math.floor(minutosRestantes / 60)} h`
                        : `${minutosRestantes} min`;
                    const justificativaLen = cancelJustificativa.replace(/\s+/g, ' ').trim().length;
                    const justificativaOk = justificativaLen >= 15 && justificativaLen <= 255;
                    return (
                        <div className="space-y-4">
                            <div className="bg-[var(--surface-2)] p-4 rounded-[14px] space-y-1.5">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-[15px] font-semibold text-[var(--text)]">
                                        {nota.modelo === '55' ? 'NF-e' : 'NFC-e'}{nota.numero ? ` nº ${nota.numero}` : ''}
                                    </span>
                                    <span className="text-[15px] font-semibold text-[var(--text)] num">R$ {formatBRL(nota.valor_total ?? 0)}</span>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <Badge color={nota.ambiente === 'homologacao' ? 'bg-[var(--warn)]/10 border border-[var(--warn)]/30 text-[var(--warn)]' : 'bg-[var(--err)]/10 border border-[var(--err)]/30 text-[var(--err)]'}>
                                        {nota.ambiente === 'homologacao' ? 'Homologação' : 'Produção'}
                                    </Badge>
                                    <span className="text-[13px] text-[var(--text-muted)]">
                                        Prazo: até {limite.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{minutosRestantes < 24 * 60 ? ` · faltam ${restante}` : ''}
                                    </span>
                                </div>
                                {nota.chave_acesso && (
                                    <p className="font-mono text-xs text-[var(--text-muted)] break-all">{nota.chave_acesso}</p>
                                )}
                            </div>

                            <div className="flex gap-2.5 p-3 rounded-[14px] bg-[var(--err)]/10 border border-[var(--err)]/25 text-[var(--err)]">
                                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                                <p className="text-[13px] font-medium">
                                    Isso cancela a nota na SEFAZ e não pode ser desfeito. Só cancele se a venda não aconteceu ou a nota saiu errada.
                                </p>
                            </div>

                            <div className="space-y-1.5">
                                <label htmlFor="cancel-justificativa" className="block text-[13px] font-medium text-[var(--text-muted)]">
                                    Motivo do cancelamento
                                </label>
                                <textarea
                                    id="cancel-justificativa"
                                    rows={3}
                                    maxLength={255}
                                    className="w-full rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2.5 text-[15px] max-sm:text-base text-[var(--text)] placeholder:text-[var(--text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 resize-none"
                                    placeholder="Ex.: cliente desistiu da compra antes de receber o pedido"
                                    value={cancelJustificativa}
                                    onChange={(e) => setCancelJustificativa(e.target.value)}
                                    disabled={isCanceling}
                                />
                                <div className="flex justify-between text-xs">
                                    <span className={justificativaLen > 0 && justificativaLen < 15 ? 'text-[var(--err)]' : 'text-[var(--text-muted)]'}>
                                        Mínimo de 15 caracteres. Vai junto para a SEFAZ.
                                    </span>
                                    <span className={`num ${justificativaOk ? 'text-[var(--ok)]' : 'text-[var(--text-muted)]'}`}>{justificativaLen}/255</span>
                                </div>
                            </div>

                            <div className="flex gap-3">
                                <Button variant="secondary" className="flex-1" onClick={() => setCancelingNota(null)} disabled={isCanceling}>
                                    Voltar
                                </Button>
                                <Button variant="danger" className="flex-1" onClick={handleConfirmCancel} isLoading={isCanceling} disabled={!justificativaOk || isCanceling}>
                                    Cancelar na SEFAZ
                                </Button>
                            </div>
                        </div>
                    );
                })()}
            </Modal>
        </div>
    );
};

// Chave do localStorage onde fica { userId, storeId } da sessão do lojista —
// só o suficiente pra rebuscar o store_user via fetchStoreUserById depois de
// um F5 (achado de bug #6). Nunca guarda senha nem dado sensível.
const STORE_SESSION_STORAGE_KEY = 'ntb_store_session';
// Modo Aberto (30/09): loja deste computador, gravada a cada login real, pra tela de
// entrada oferecer "Mesas · Sem login". Usuário sintético role='open' (id nulo fixo).
const MESAS_LOJA_STORAGE_KEY = 'ntb_mesas_loja';
const ABERTO_USER_ID = '00000000-0000-0000-0000-000000000000';
const usuarioAberto = (store: Store): StoreUser & { store: Store } => ({
    id: ABERTO_USER_ID,
    store_id: store.id,
    name: 'Mesas',
    email: '',
    role: 'open',
    must_change_password: false,
    permissions: {},
    store,
} as StoreUser & { store: Store });

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
                const saved = JSON.parse(raw) as { userId?: string; storeId?: string; isUniversal?: boolean; aberto?: boolean };
                let restoredUser: (StoreUser & { store: Store }) | null = null;

                if (saved?.aberto && saved.storeId) {
                    const store = await fetchStoreById(saved.storeId);
                    if (store && store.is_active) restoredUser = usuarioAberto(store);
                } else if (saved?.isUniversal && saved.userId && saved.storeId) {
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
                    setTab(savedTab && (savedTab === 'producao' ? producaoAcessivel(accessible) : accessible.has(savedTab)) ? savedTab : pickInitialStoreTab(restoredUser));
                } else {
                    // Fix round final (C4, ver task-12-report.md): fetchStoreUserById/
                    // fetchUniversalUserById/fetchStoreById (lib/api.ts) já caem pro
                    // último valor cacheado numa falha de REDE (mesmo padrão de
                    // fetchOpenCashShift) — se chegamos aqui com `restoredUser` nulo,
                    // ou a sessão salva é mesmo inválida (usuário removido, loja
                    // desativada), ou é a primeira restauração offline desta sessão
                    // sem nenhum cache prévio (nunca logou com sucesso neste
                    // navegador). Só apagar a sessão salva no primeiro caso —
                    // confirmando com uma checagem de conectividade real (mesma
                    // usada pelo motor de sync) antes de deslogar, senão uma queda de
                    // rede sem cache travaria o operador fora do app PARA SEMPRE (a
                    // sessão salva não voltaria nem quando a internet voltasse).
                    const online = await checkRealConnectivity();
                    if (online) {
                        localStorage.removeItem(STORE_SESSION_STORAGE_KEY);
                    }
                    // Offline sem cache: mantém a sessão salva (cai na tela de login
                    // normalmente por não ter como reconstruir o usuário agora — login
                    // offline é fora de escopo — mas tenta de novo sozinha no próximo
                    // reload/retomada de rede, sem exigir novo login).
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

    // App desktop: liga a impressão de rede/USB da loja logada (ver
    // desktop/electron/print-engine.js). Fica aqui, e não no login, porque
    // a sessão também volta sozinha depois de F5 — nos dois caminhos o
    // efeito roda com a loja certa, e desliga ao sair/trocar de loja. No
    // navegador, os dois são no-op.
    useEffect(() => {
        if (!user?.store?.id) return;
        iniciarMotorImpressaoDesktop(user.store.id, user.role !== 'universal');
        return () => pararMotorImpressaoDesktop();
    }, [user?.store?.id]);

    // Auditoria: o ator da sessão vai em toda requisição (lib/supabaseClient.ts) — também quando a sessão volta sozinha após F5.
    useEffect(() => {
        definirAtor(user ? { id: user.role === 'universal' || user.role === 'open' ? null : user.id, name: user.name, role: user.role } : null);
    }, [user]);

    const handleLogin = (u: StoreUser & { store: Store }) => {
        definirAtor({ id: u.role === 'universal' ? null : u.id, name: u.name, role: u.role });
        registrarAcao(u.store.id, 'login.entrou', { entity: 'login', entityId: u.id, summary: `${u.name} entrou no sistema`, details: { papel: u.role } });
        setUser(u);
        setTab(pickInitialStoreTab(u));
        localStorage.setItem(STORE_SESSION_STORAGE_KEY, JSON.stringify({ userId: u.id, storeId: u.store.id, isUniversal: u.role === 'universal' }));
        try { localStorage.setItem(MESAS_LOJA_STORAGE_KEY, u.store.id); } catch { /* sem armazenamento */ }
    };

    const [lojaMesas, setLojaMesas] = useState<string | null>(null);
    useEffect(() => {
        try {
            // Grava a loja também quando a sessão é restaurada (ex.: app reabriu após atualizar),
            // senão o botão "Mesas" só apareceria depois de alguém digitar o login de novo.
            if (user && user.role !== 'open' && user.role !== 'universal') localStorage.setItem(MESAS_LOJA_STORAGE_KEY, user.store.id);
            setLojaMesas(localStorage.getItem(MESAS_LOJA_STORAGE_KEY));
        } catch { /* sem armazenamento */ }
    }, [user]);
    const entrarMesas = async () => {
        if (!lojaMesas) return;
        const store = await fetchStoreById(lojaMesas).catch(() => null);
        if (!store || !store.is_active) { toast.error('Não consegui abrir as mesas desta loja. Entre com o seu login.'); return; }
        const u = usuarioAberto(store);
        definirAtor({ id: null, name: u.name, role: u.role });
        registrarAcao(store.id, 'login.modo_aberto', { entity: 'login', summary: 'PC do salão entrou no modo Aberto (só Mesas)' });
        setUser(u);
        setTab('tables');
        localStorage.setItem(STORE_SESSION_STORAGE_KEY, JSON.stringify({ aberto: true, storeId: store.id }));
    };

    const handleLogout = () => {
        if (user) registrarAcao(user.store.id, 'login.saiu', { entity: 'login', entityId: user.id, summary: `${user.name} saiu do sistema` });
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
                <div className="force-light auth-shell min-h-screen supports-[height:100dvh]:min-h-dvh flex items-center justify-center bg-[var(--bg)] p-4">
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
                <StoreLogin onLogin={handleLogin} onEntrarMesas={lojaMesas ? entrarMesas : undefined} />
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
    const canAccess = (t: string) => (t === 'producao' ? producaoAcessivel(accessibleTabIds) : accessibleTabIds.has(t));

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
                tab === 'producao' ? 'Produção' :
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
            onUserUpdate={(patch) => setUser({ ...user, ...patch })}
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
            {tab === 'producao' && canAccess('producao') && (
                <ProducaoView store={user.store} acessiveis={accessibleTabIds}
                    renderKds={(l) => <KdsView key={l.chave} destination={l.base} store={user.store} fixedLocal={l.setorId ?? 'padrao'} loggedUser={user} />} />
            )}
            {tab === 'kitchen' && canAccess('kitchen') && <KdsView destination="kitchen" store={user.store} loggedUser={user} />}
            {tab === 'bar' && canAccess('bar') && <KdsView destination="bar" store={user.store} loggedUser={user} />}
            {tab === 'menu' && canAccess('menu') && <MenuManagementView store={user.store} podeEditar={roleCanOr(user, user.store, 'editar_cardapio', true)} onStoreUpdate={(updatedStore) => setUser({ ...user, store: updatedStore })} />}
            {tab === 'admin' && canAccess('admin') && <StoreAdminView store={user.store} loggedUser={user} onStoreUpdate={(updatedStore) => setUser({ ...user, store: updatedStore })} />}

            {!canAccess(tab) && (
                <div className="flex flex-col items-center justify-center h-64 text-[var(--text-muted)]">
                    <Lock size={48} className="mb-4 opacity-20"/>
                    {user.role === 'open' ? (
                        <>
                            <p className="font-semibold text-[var(--text)]">Só com login</p>
                            <p className="mt-1 text-sm text-center max-w-xs">Neste computador, sem login, só funciona a Gestão de Mesas. Para esta área, saia e entre com a sua conta.</p>
                            <Button className="mt-4" onClick={() => setTab('tables')}>Voltar para as mesas</Button>
                        </>
                    ) : (
                        <p>Você não tem permissão para acessar esta área.</p>
                    )}
                </div>
            )}
        </StoreLayout>
        </MotionConfig>
    );
}

// Hora em que o item foi pedido + quanto tempo faz (pedido dos garçons/Ramon, 2026-09-29); atualiza sozinha.
function HoraDoPedido({ criadoEm }: { criadoEm?: string | null }) {
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick((t) => t + 1), 30000);
        return () => clearInterval(id);
    }, []);
    const texto = descreverHoraDoPedido(criadoEm);
    if (!texto) return null;
    return <span className="num text-[var(--text-muted)]" title="Hora em que o pedido foi feito"> · Pedido às {texto}</span>;
}
