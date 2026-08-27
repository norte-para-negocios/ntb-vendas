'use client';

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import Image from 'next/image';
import { ShoppingBag, Search, Clock, Plus, Minus, Check, User, LogIn, Coffee, LayoutGrid, Eye, EyeOff, ArrowUpDown, ArrowDownAZ, ArrowUpNarrowWide, ArrowDownWideNarrow, Bell, BellRing, LogOut, Trash2, Receipt, ChefHat, CheckCircle, AlertTriangle, AlertCircle, Users, Calculator, List, CheckSquare, Square, Lock, Info, PartyPopper, UtensilsCrossed, RefreshCw, X, Star, Wine, Sparkles, Heart, ChevronRight, MapPin, Image as ImageIcon } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { fetchMenu, fetchStoreBySlug, createOrder, fetchTablesPublic, openTableSession, fetchTableOrderSummary, callWaiter, requestTableBill, fetchOrderById, fetchOrderItemsById, createOrderRating, fetchBestsellerProductIds, fetchStoreFiscalConfig } from '@/lib/api';
import { Category, Product, Table, TableStatus, Store, CartItem, OrderStatus, Order, OrderItem, ProductOptionGroup, SelectedOption, StoreFiscalConfig } from '@/types';
import { Button, Card, Input, Modal, Badge } from '@/components/ui';
import { ProductThumb } from '@/components/ProductThumb';
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/components/Toast';
import { playPreparingAlert, playReadyAlert, vibrateAlert } from '@/lib/audioAlert';
import { confirm } from '@/components/ConfirmDialog';
import { Skeleton, stagger } from '@/components/Skeleton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getTableStatusLabel, getOrderItemDisplayName, getCartItemDisplayName, getTagDisplay } from '@/lib/labels';
import { calculateServiceFee, calculateOrderTotal, calculateCartItemUnitPrice, calculateCartTotal, getEffectivePrice, formatBRL, formatServiceFeeRate, SERVICE_FEE_RATE } from '@/lib/calc';
import { normalizeForSearch } from '@/lib/search';
import { isCategoryAvailableNow } from '@/lib/schedule';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import { SPRING_TAP, SPRING_SHEET } from '@/lib/motion';
import { resolveOrderFlow, OrderFlow } from '@/lib/storeModules';

// --- COMPONENTS ---

// Identidade "carta de vinhos" do cardápio do cliente: dourado só pra
// preço/valor e etiqueta de proveniência — regra original do projeto,
// restaurada em 2026-08-16 depois de uma rodada que também tinha jogado
// dourado nos CTAs/botões (o usuário achou "amarelo demais"). Ação
// continua sendo o azul da marca (--brand), igual ao resto do produto
// (admin, lojista, landing). Hex fixo de propósito, como os outros
// consts de marca do projeto (AuthBackdrop, app/page.tsx) — não é um
// token do design system porque só existe nesta tela.
const WINE_GOLD = '#D4AF5C';

// Paleta iFood (correção 2026-08-21, pedido direto do usuário: quer as
// cores REAIS do iFood, não o azul desta empresa). iFood distingue AÇÃO de
// PROMOÇÃO — não usa uma cor só pra "marca": botão/controle de adicionar,
// aba ativa e seletor de opção são vermelho; preço com promoção ativa
// (e o selo -X%) são roxo; preço SEM promoção nenhuma é só texto escuro
// em negrito, nunca colorido (essa é a maioria absoluta do catálogo hoje —
// 390 produtos ativos na loja piloto, 0 com promo_price). Hex fixo de
// propósito, mesmo precedente de WINE_GOLD acima — só existe neste
// arquivo, nunca o token global --brand (usado no painel do lojista e no
// Master Admin, fora de escopo, tem que continuar azul).
const IFOOD_RED = '#EA1D2C';
const IFOOD_PURPLE = '#8E1CA8';

// Cardápio que vende (migration 019): promoção "ativa" = promo_price setado
// E menor que o preço cheio — mesma guarda de getEffectivePrice (lib/calc.ts),
// usada aqui só pra decidir SE mostra o preço riscado, não pra calcular o
// valor cobrado (isso é sempre getEffectivePrice/calculateCartItemUnitPrice).
function hasActivePromo(product: { price: number; promo_price?: number | null }): boolean {
    return product.promo_price != null && product.promo_price < product.price;
}

// Produto com grupo de opção que tem ALGUMA variação de preço real (ex.:
// "Tamanho" G custa mais que M) precisa do prefixo "A partir de" — senão o
// preço fixo do card é enganoso (mostra só o preço da variação mais barata
// como se fosse o preço do produto inteiro). Grupos só com price_delta=0 em
// todas as opções (ex.: "Ponto da carne", sem custo extra) não contam.
function hasVariablePricing(product: { option_groups?: { options: { price_delta: number }[] }[] }): boolean {
    return (product.option_groups || []).some((g) => g.options.some((o) => o.price_delta > 0));
}

// Composição de preço (redesign iFood, Task 4): preço efetivo em --brand +
// riscado + selo "-X%" quando há promoção ativa. Escrita 1x aqui e consumida
// pela linha de produto (ProductCard, abaixo), pelo card de destaque (Task 5)
// e pela página de produto (Task 6) — sem isso a mesma lógica de desconto
// seria digitada 3x, exatamente o tipo de duplicação que review de código
// pega. `size` só varia a escala tipográfica entre os 3 contextos; a regra
// de exibição (o que mostrar e quando) é sempre a mesma, sempre lida de
// getEffectivePrice/hasActivePromo (lib/calc.ts + acima), nunca duplicada.
type PriceRowSize = 'row' | 'featured' | 'page';
const PRICE_ROW_SIZES: Record<PriceRowSize, { effective: string; prefix: string; full: string; badge: string; gap: string }> = {
    row: { effective: 'text-[15px]', prefix: 'text-[11px]', full: 'text-[13px]', badge: 'text-[11px] px-1.5 py-0.5', gap: 'gap-2' },
    featured: { effective: 'text-[16px]', prefix: 'text-[11px]', full: 'text-[13px]', badge: 'text-[11px] px-1.5 py-0.5', gap: 'gap-2' },
    page: { effective: 'text-[22px]', prefix: 'text-[13px]', full: 'text-[15px]', badge: 'text-[12px] px-2 py-0.5', gap: 'gap-2.5' },
};
function PriceRow({ product, size = 'row', variablePricing = false, className = '' }: {
    product: { price: number; promo_price?: number | null },
    size?: PriceRowSize,
    // Task 4/5/6 controlam isso com a própria checagem de contexto deles
    // (ex.: hasVariablePricing(product) aqui no card, algo equivalente na
    // página de produto) — o componente só decide COMO renderizar o prefixo,
    // nunca SE ele se aplica.
    variablePricing?: boolean,
    className?: string,
}) {
    const cfg = PRICE_ROW_SIZES[size];
    const promo = hasActivePromo(product);
    const effective = getEffectivePrice(product);
    // pct só existe quando promo=true E promo_price não é null — a segunda
    // checagem é só pro TypeScript estreitar o tipo (hasActivePromo já
    // garante isso em runtime), evita non-null assertion.
    const pct = promo && product.promo_price != null
        ? Math.round((1 - product.promo_price / product.price) * 100)
        : null;

    return (
        <span className={`flex items-center ${cfg.gap} flex-wrap ${className}`}>
            {/* Correção 2026-08-21: preço sem promoção é texto escuro em negrito
                (var(--text)), NÃO colorido — no iFood real, cor no preço só
                aparece em item com promoção/Clube. Como praticamente nenhum
                produto tem promo_price hoje, isso é o estado normal da tela.
                `num` (monoespaçado/tabular) também saiu — era um mismatch
                visível com a tipografia proporcional do iFood; alinhamento
                tabular só importa nas telas do lojista/documentos impressos. */}
            <span className={`font-bold ${cfg.effective}`} style={{ color: promo ? IFOOD_PURPLE : 'var(--text)' }}>
                {variablePricing && (
                    <span className={`font-normal text-[var(--text-muted)] ${cfg.prefix} mr-0.5`}>A partir de</span>
                )}
                {' '}R$ {formatBRL(effective)}
            </span>
            {promo && pct !== null && (
                <>
                    <span className={`text-[var(--text-muted)] line-through ${cfg.full}`}>R$ {formatBRL(product.price)}</span>
                    {pct > 0 && (
                        <span className={`rounded-full font-bold text-white ${cfg.badge}`} style={{ background: IFOOD_PURPLE }}>-{pct}%</span>
                    )}
                </>
            )}
        </span>
    );
}

const CounterConfirmModal: React.FC<{ isOpen: boolean, onClose: () => void, onConfirm: () => void, isLoading: boolean }> = ({ isOpen, onClose, onConfirm, isLoading }) => {
    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Atenção ao Pedido">
            <div className="flex flex-col items-center text-center space-y-6 py-2">
                <div className="bg-[var(--warn)]/10 p-4 rounded-full text-[var(--warn)]">
                    <AlertTriangle size={48} />
                </div>
                <div>
                    <h3 className="text-xl font-bold text-[var(--text)] mb-2">Pedido Único</h3>
                    <p className="text-[var(--text-muted)] text-sm leading-relaxed">
                        Devido à organização da fila do balcão, este pedido será <strong className="text-[var(--text)]">encerrado</strong> assim que confirmado.
                    </p>
                    <p className="text-[var(--text-muted)] text-sm leading-relaxed mt-2">
                        Verifique se você adicionou <strong>todos</strong> os itens (bebidas, sobremesas) antes de enviar.
                    </p>
                </div>

                <div className="w-full space-y-3">
                    <Button onClick={onConfirm} isLoading={isLoading} className="w-full h-12 text-lg">
                        Tudo Certo, Enviar!
                    </Button>
                    <Button variant="secondary" onClick={onClose} className="w-full">
                        Voltar e Adicionar Mais
                    </Button>
                </div>
            </div>
        </Modal>
    );
};

// Deriva o status "visual" do pedido a partir do status bruto + status dos
// itens (o pedido em si só tem pending/accepted/delivered/canceled;
// preparing/ready são estados por ITEM que a UI precisa agregar). Compartilhado
// entre o OrderTracker (Balcão, tela cheia) e useMesaOrders (Mesa, painel).
function deriveOrderStatus(order: Order | null, items: OrderItem[]): OrderStatus {
    if (!order) return OrderStatus.PENDING;
    if (order.status === OrderStatus.DELIVERED) return OrderStatus.DELIVERED;
    if (order.status === OrderStatus.CANCELED) return OrderStatus.CANCELED;

    if (items.length > 0) {
        // Só fica PRONTO se TODOS os itens estiverem prontos ou entregues.
        const allReady = items.every(i => i.status === OrderStatus.READY || i.status === OrderStatus.DELIVERED);
        if (allReady) return OrderStatus.READY;

        // Se algum estiver preparando OU pronto (mas não todos), mostra Preparando.
        const isWorking = items.some(i => i.status === OrderStatus.PREPARING || i.status === OrderStatus.READY);
        if (isWorking) return OrderStatus.PREPARING;

        const isAccepted = items.some(i => i.status === OrderStatus.ACCEPTED);
        if (isAccepted) return OrderStatus.ACCEPTED;
    }

    return order.status;
}

const ORDER_STEPS = [
    { status: OrderStatus.PENDING, label: 'Enviado', icon: CheckCircle },
    { status: OrderStatus.ACCEPTED, label: 'Aceito', icon: ChefHat },
    { status: OrderStatus.PREPARING, label: 'Preparando', icon: Clock },
    { status: OrderStatus.READY, label: 'Pronto!', icon: BellRing },
];

function getItemStatusBadge(status: OrderStatus) {
    switch (status) {
        case OrderStatus.PENDING: return <Badge color="bg-[var(--warn)]/10 text-[var(--warn)]"><Clock size={12} className="mr-1"/> Enviado</Badge>;
        case OrderStatus.ACCEPTED: return <Badge color="bg-[var(--warn)]/15 text-[var(--warn)]"><ChefHat size={12} className="mr-1"/> Aceito</Badge>;
        case OrderStatus.PREPARING: return <Badge color="bg-[var(--info)]/10 text-[var(--info)]"><UtensilsCrossed size={12} className="mr-1"/> Preparando</Badge>;
        case OrderStatus.READY: return <Badge color="bg-[var(--ok)]/10 text-[var(--ok)]"><BellRing size={12} className="mr-1"/> Pronto</Badge>;
        case OrderStatus.DELIVERED: return <Badge color="bg-[var(--surface-2)] text-[var(--text-muted)]"><CheckCircle size={12} className="mr-1"/> Entregue</Badge>;
        default: return null;
    }
}

// Linha do tempo (Enviado→Aceito→Preparando→Pronto) + lista de itens com
// status individual. Usado pelo OrderTracker (Balcão) e pelo OrderStatusModal
// (Mesa) — a MESMA visualização nos dois lugares, só muda a moldura em volta.
//
// `orderFlow` (achado real, pedido explícito do Ramon, loja Sertão): em
// lojas `direct_print` não existe KDS nenhum — nada além de FECHAR A MESA
// avança o status de um item (ver CaixaPrintStation.tsx), então esta linha
// do tempo ficava travada pra sempre em "Enviado"/"Aceito", parecendo que o
// pedido nunca é preparado, quando na verdade só não existe rastreamento
// nessas lojas. Com `orderFlow === 'direct_print'`, mostra uma confirmação
// simples em vez da linha do tempo/status por item — que nunca seriam
// verdadeiros ali.
function OrderProgressView({ status, items, orderFlow = 'kds' }: { status: OrderStatus; items: OrderItem[]; orderFlow?: OrderFlow }) {
    if (orderFlow === 'direct_print') {
        return (
            <div className="w-full max-w-md mx-auto text-center py-6">
                <div className="bg-[var(--ok)]/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 text-[var(--ok)]">
                    <CheckCircle size={28} />
                </div>
                <h3 className="font-bold text-lg text-[var(--text)] mb-1">Pedido enviado!</h3>
                <p className="text-sm text-[var(--text-muted)]">Seu pedido já foi encaminhado pra cozinha.</p>
            </div>
        );
    }

    const currentStepIndex = ORDER_STEPS.findIndex(s => s.status === status) !== -1
        ? ORDER_STEPS.findIndex(s => s.status === status)
        : (status === OrderStatus.DELIVERED ? 4 : 0);
    const isReady = status === OrderStatus.READY;

    return (
        <>
            <div className="w-full max-w-md mx-auto space-y-6 relative pb-6 border-b border-[var(--border)]">
                <div className="absolute left-6 top-6 bottom-6 w-1 bg-[var(--border)] -z-10"></div>

                {ORDER_STEPS.map((step, idx) => {
                    const isCompleted = currentStepIndex >= idx;
                    const isCurrent = currentStepIndex === idx;

                    return (
                        <div key={idx} className={`flex items-center gap-4 transition-all duration-500 ${isCompleted ? 'opacity-100' : 'opacity-40'}`}>
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center border-4 transition-all z-10 ${
                                isCompleted ? (step.status === OrderStatus.READY ? 'bg-[var(--ok)] border-[var(--ok)]/30 text-white' : 'bg-[var(--brand)] border-[var(--brand)]/30 text-white') : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)]'
                            } ${isCurrent && !isReady ? 'animate-pulse' : ''}`}>
                                <step.icon size={20} />
                            </div>
                            <div>
                                <h3 className={`font-bold text-lg ${isCompleted ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{step.label}</h3>
                                {isCurrent && <p className="text-xs text-[var(--brand)] font-medium animate-pulse">Em andamento...</p>}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="w-full max-w-md mx-auto bg-[var(--surface)] rounded-[var(--r-lg)] shadow-sm border border-[var(--border)] overflow-hidden">
                <div className="bg-[var(--surface-2)] px-4 py-3 border-b border-[var(--border)]">
                    <h3 className="font-bold text-[var(--text)] text-sm">Status dos Itens</h3>
                </div>
                <div className="divide-y divide-[var(--border)]">
                    {items.map(item => (
                        <div key={item.id} className="p-3 flex items-center justify-between">
                            <div className="text-sm">
                                <span className="font-bold text-[var(--text)]">{item.quantity}x</span> {getOrderItemDisplayName(item, 'Item')}
                            </div>
                            <div className="flex-shrink-0 ml-2">
                                {getItemStatusBadge(item.status)}
                            </div>
                        </div>
                    ))}
                    {items.length === 0 && <p className="p-4 text-center text-[var(--text-muted)] text-sm">Carregando itens...</p>}
                </div>
            </div>
        </>
    );
}

export type MesaOrderState = {
    orderId: string;
    order: Order | null;
    items: OrderItem[];
    status: OrderStatus;
};

// Estado + alerta de status pra pedidos de MESA (achado 2026-07-08: o cliente
// numa mesa continua navegando o cardápio pra pedir mais rodadas -- NUNCA
// entrava no OrderTracker, que só é montado no fluxo de Balcão/pedido único).
// Além de disparar o alerta (som/toast) na transição, expõe o estado de cada
// rodada da sessão pro OrderStatusPill/OrderStatusModal renderizarem.
function useMesaOrders(storeId: string | undefined, orderIds: string[]) {
    const [ordersMap, setOrdersMap] = useState<Map<string, MesaOrderState>>(new Map());
    const prevStatusRef = useRef<Map<string, OrderStatus>>(new Map());
    const orderIdsRef = useRef<string[]>(orderIds);
    orderIdsRef.current = orderIds;

    const refreshOrder = useCallback(async (orderId: string) => {
        const [order, items] = await Promise.all([fetchOrderById(orderId), fetchOrderItemsById(orderId)]);
        const status = deriveOrderStatus(order, items);

        const prev = prevStatusRef.current.get(orderId);
        prevStatusRef.current.set(orderId, status);
        // Baseline (1ª checagem desse orderId): não alerta, só registra.
        if (prev && prev !== status) {
            if (status === OrderStatus.PREPARING) {
                playPreparingAlert();
                vibrateAlert([120]);
                toast.info('Seu pedido está sendo preparado! 👨‍🍳');
            } else if (status === OrderStatus.READY) {
                playReadyAlert();
                vibrateAlert([120, 80, 120]);
                toast.success('Seu pedido está pronto! 🔔');
            }
        }

        setOrdersMap(prevMap => {
            const next = new Map(prevMap);
            next.set(orderId, { orderId, order, items, status });
            return next;
        });
    }, []);

    // Carrega cada pedido novo assim que entra na sessão (1º fetch, sem esperar
    // ping) -- senão o pill/painel ficam vazios até a 1ª mudança real de status.
    useEffect(() => {
        for (const id of orderIds) {
            if (!prevStatusRef.current.has(id)) {
                prevStatusRef.current.set(id, OrderStatus.PENDING); // reserva a baseline antes do fetch resolver, evita corrida
                refreshOrder(id);
            }
        }
    }, [orderIds, refreshOrder]);

    useEffect(() => {
        if (!storeId) return;

        const channel = supabase.channel(`mesa_alerts_${storeId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'order_change_pings', filter: `store_id=eq.${storeId}` }, (payload: any) => {
                const orderId = payload.new?.order_id ?? payload.old?.order_id;
                if (orderId && orderIdsRef.current.includes(orderId)) refreshOrder(orderId);
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [storeId, refreshOrder]);

    const orders = orderIds.map(id => ordersMap.get(id)).filter((o): o is MesaOrderState => !!o);
    const latest = [...orders].reverse().find(o => o.status !== OrderStatus.DELIVERED && o.status !== OrderStatus.CANCELED) ?? null;

    return { orders, latest };
}

const OrderTracker: React.FC<{ orderId: string, onReset: () => void, onLogout: () => void }> = ({ orderId, onReset, onLogout }) => {
    const { currentStore } = useApp();
    const orderFlow = resolveOrderFlow(currentStore);
    const [order, setOrder] = useState<Order | null>(null);
    const [items, setItems] = useState<OrderItem[]>([]);
    const [secondsToRedirect, setSecondsToRedirect] = useState(5);
    const [ratingStars, setRatingStars] = useState(0);
    const [ratingComment, setRatingComment] = useState('');
    const [ratingSent, setRatingSent] = useState(false);
    const [isSendingRating, setIsSendingRating] = useState(false);
    // Snapshot do fetch anterior — usado só pra diff, nunca renderizado.
    // null = ainda não carregou nenhuma vez (evita alertar no load inicial).
    const prevItemsRef = useRef<OrderItem[] | null>(null);

    const notifyItemTransitions = (nextItems: OrderItem[]) => {
        const prevById = new Map((prevItemsRef.current || []).map(i => [i.id, i.status]));
        for (const item of nextItems) {
            const prevStatus = prevById.get(item.id);
            if (!prevStatus || prevStatus === item.status) continue;
            const itemName = getOrderItemDisplayName(item, 'Item');
            if (item.status === OrderStatus.PREPARING) {
                toast.info(`${itemName} entrou em preparo`);
            } else if (item.status === OrderStatus.READY) {
                toast.success(`${itemName} ficou pronto`);
            }
        }
        prevItemsRef.current = nextItems;
    };

    useEffect(() => {
        const load = async () => {
            const data = await fetchOrderById(orderId);
            setOrder(data);

            if (data) {
                const ratingKey = `rated_table_${data.table_id ?? data.id}`;
                if (localStorage.getItem(ratingKey)) setRatingSent(true);
            }

            // Fetch items immediately to determine detailed status
            const itemsData = await fetchOrderItemsById(orderId);
            if (itemsData) {
                // Baseline do load inicial: guarda o snapshot sem disparar toast.
                prevItemsRef.current = itemsData;
                setItems(itemsData);
            }
        };
        load();

        // order_change_pings (migration 029): orders/order_items não têm mais
        // select público pra anon (correção de segurança 021/022) — o Realtime
        // só entrega postgres_changes pra quem tem visibilidade via RLS, então
        // não dá mais pra assinar as tabelas reais direto. Assina a tabela de
        // "ping" (sem dado sensível, só order_id+store_id+timestamp) e, ao
        // receber um ping, busca o dado de verdade pela RPC segura.
        const pingChannel = supabase.channel(`tracker_ping_${orderId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'order_change_pings', filter: `order_id=eq.${orderId}` }, async () => {
                const data = await fetchOrderById(orderId);
                if (data) setOrder(data);

                const itemsData = await fetchOrderItemsById(orderId);
                if (itemsData) {
                    notifyItemTransitions(itemsData);
                    setItems(itemsData);
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(pingChannel);
        };
    }, [orderId]);

    // DERIVE STATUS LOGIC (compartilhada com useMesaOrders, ver deriveOrderStatus)
    const derivedStatus = useMemo(() => deriveOrderStatus(order, items), [order, items]);

    // ALERTA AGREGADO (som + vibração): só na TRANSIÇÃO pra preparing/ready,
    // nunca no carregamento inicial. prevAggregateStatusRef começa null;
    // a primeira vez que `order` existe só define a baseline, sem alertar.
    const prevAggregateStatusRef = useRef<OrderStatus | null>(null);
    useEffect(() => {
        if (!order) return;
        const prev = prevAggregateStatusRef.current;
        prevAggregateStatusRef.current = derivedStatus;
        if (prev === null || prev === derivedStatus) return;

        if (derivedStatus === OrderStatus.PREPARING) {
            playPreparingAlert();
            vibrateAlert([120]);
            toast.info('Seu pedido está sendo preparado! 👨‍🍳');
        } else if (derivedStatus === OrderStatus.READY) {
            playReadyAlert();
            vibrateAlert([120, 80, 120]);
            toast.success('Seu pedido está pronto! 🔔');
        }
    }, [derivedStatus, order]);

    const isDelivered = derivedStatus === OrderStatus.DELIVERED;

    // AUTO LOGOUT EFFECT
    useEffect(() => {
        let interval: any;
        if (isDelivered) {
            interval = setInterval(() => {
                setSecondsToRedirect((prev) => {
                    if (prev <= 1) {
                        clearInterval(interval);
                        onLogout(); // Force logout
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [isDelivered, onLogout]);

    const handleSendRating = async () => {
        if (ratingStars === 0 || !order) return;
        setIsSendingRating(true);
        try {
            const result = await createOrderRating(order.id, order.store_id, ratingStars, ratingComment || null);
            if (!result.success) throw new Error(result.message);
            const ratingKey = `rated_table_${order.table_id ?? order.id}`;
            localStorage.setItem(ratingKey, '1');
            setRatingSent(true);
            toast.success('Obrigado pela avaliação!');
        } catch (e: any) {
            toast.error('Erro ao enviar avaliação: ' + e.message);
        } finally {
            setIsSendingRating(false);
        }
    };

    const handleSkipRating = () => {
        if (order) localStorage.setItem(`rated_table_${order.table_id ?? order.id}`, '1');
        setRatingSent(true);
    };

    if (!order) return <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]"><div className="animate-pulse text-[var(--brand)] font-bold">Carregando status...</div></div>;

    const isReady = derivedStatus === OrderStatus.READY;
    const isCanceled = derivedStatus === OrderStatus.CANCELED;

    if (isCanceled) {
        return (
             <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] p-6 text-center">
                 <div className="bg-[var(--err)]/10 p-6 rounded-full mb-6">
                     <AlertCircle size={48} className="text-[var(--err)]" />
                 </div>
                 <h2 className="text-2xl font-bold text-[var(--text)] mb-2">Pedido Cancelado</h2>
                 <p className="text-[var(--text-muted)] mb-8">Seu pedido foi cancelado pelo estabelecimento.</p>
                 <Button onClick={onReset}>Fazer Novo Pedido</Button>
             </div>
        );
    }

    return (
        <div className="min-h-screen bg-[var(--bg)] flex flex-col">
            <div className="bg-[var(--surface)] p-6 shadow-sm border-b text-center">
                <h1 className="text-xl font-bold text-[var(--text)]">Acompanhamento</h1>
                <p className="text-sm text-[var(--text-muted)]">Pedido #{orderId.slice(0, 4)}</p>
            </div>

            <div className="flex-1 flex flex-col items-center p-6 space-y-6">
                {/* Banner de Pronto */}
                {isReady && (
                    <div className="animate-bounce bg-[var(--ok)]/10 text-[var(--ok)] px-6 py-3 rounded-xl font-bold text-lg flex items-center gap-3 shadow-lg border border-[var(--ok)]/30 w-full justify-center max-w-md">
                        <PartyPopper /> SEU PEDIDO ESTÁ PRONTO!
                    </div>
                )}

                {isDelivered ? (
                     <div className="text-center py-10 animate-fade-in w-full max-w-md">
                         <div className="bg-[var(--ok)]/10 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4 text-[var(--ok)]">
                             <CheckCircle size={48} />
                         </div>
                         <h2 className="text-2xl font-bold text-[var(--text)] mb-2">Pedido Finalizado</h2>
                         <p className="text-[var(--text-muted)] mb-4">Obrigado pela preferência!</p>

                         {!ratingSent && (
                             <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 mb-4 text-left">
                                 <p className="text-sm font-semibold text-[var(--text)] mb-3 text-center">Como foi sua experiência?</p>
                                 <div className="flex items-center justify-center gap-2 mb-3">
                                     {[1, 2, 3, 4, 5].map((n) => (
                                         <button key={n} onClick={() => setRatingStars(n)} className="u-motion">
                                             <Star size={32} className={n <= ratingStars ? 'fill-[var(--warn)] text-[var(--warn)]' : 'text-[var(--border)]'} />
                                         </button>
                                     ))}
                                 </div>
                                 {ratingStars > 0 && (
                                     <textarea
                                         value={ratingComment}
                                         onChange={(e) => setRatingComment(e.target.value)}
                                         placeholder="Comentário (opcional)"
                                         className="w-full rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] outline-none mb-3"
                                         rows={2}
                                     />
                                 )}
                                 <div className="flex items-center justify-center gap-3">
                                     <button onClick={handleSkipRating} className="text-sm text-[var(--text-muted)] u-motion">Pular</button>
                                     <Button size="sm" onClick={handleSendRating} isLoading={isSendingRating} disabled={ratingStars === 0}>Enviar</Button>
                                 </div>
                             </div>
                         )}

                         <p className="text-[var(--brand)] font-bold text-sm bg-[var(--brand)]/8 py-2 px-4 rounded-full inline-block">
                             Reiniciando em {secondsToRedirect}s...
                         </p>
                     </div>
                ) : (
                    <>
                        <OrderProgressView status={derivedStatus} items={items} orderFlow={orderFlow} />

                        <div className="p-2 text-center text-xs text-[var(--text-muted)]">
                             Aguarde chamar seu nome ou número no painel.
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

// Botão flutuante da MESA (achado 2026-07-08: cliente pediu uma tela de
// status clicável a partir do cardápio, sem sair dele). Mostra a rodada mais
// recente ainda não entregue; ao tocar, abre o OrderStatusModal.
const PILL_CONFIG: Partial<Record<OrderStatus, { label: string; icon: any }>> = {
    [OrderStatus.PENDING]: { label: 'Pedido enviado', icon: Clock },
    [OrderStatus.ACCEPTED]: { label: 'Pedido aceito pela cozinha', icon: ChefHat },
    [OrderStatus.PREPARING]: { label: 'Preparando seu pedido...', icon: UtensilsCrossed },
    [OrderStatus.READY]: { label: 'Seu pedido está pronto! 🔔', icon: BellRing },
};

function OrderStatusPill({ order, onClick }: { order: MesaOrderState; onClick: () => void }) {
    const c = PILL_CONFIG[order.status] ?? PILL_CONFIG[OrderStatus.PENDING]!;
    const Icon = c.icon;
    const isReady = order.status === OrderStatus.READY;

    return (
        <button
            type="button"
            onClick={onClick}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-[var(--r-lg)] border text-left transition-transform active:scale-[0.98] ${
                isReady ? 'bg-[var(--ok)]/10 border-[var(--ok)]/30 animate-pulse' : 'border-white/10 text-white'
            }`}
            style={isReady ? undefined : { background: 'var(--ink)', boxShadow: '0 12px 34px -8px rgba(0,0,0,0.45)' }}
        >
            <div
                className={`p-2 rounded-full shrink-0 ${isReady ? 'bg-[var(--ok)]/15 text-[var(--ok)]' : ''}`}
                style={isReady ? undefined : { background: 'color-mix(in srgb, var(--brand) 15%, transparent)', color: 'var(--brand)' }}
            >
                <Icon size={18} />
            </div>
            <div className="flex-1 min-w-0">
                <p className={`text-[13px] font-bold truncate ${isReady ? 'text-[var(--ok)]' : 'text-white'}`}>{c.label}</p>
                <p className={`text-[11px] ${isReady ? 'text-[var(--ok)]/70' : 'text-white/50'}`}>Toque pra ver detalhes</p>
            </div>
            <ChevronRight size={16} className={isReady ? 'text-[var(--ok)]' : 'text-white/50'} />
        </button>
    );
}

// Painel deslizante (mesmo padrão visual do CartModal/"Ver Comanda"): tela de
// acompanhamento acessível a qualquer momento sem sair do cardápio. Mostra a
// rodada ativa (reaproveitando OrderProgressView, igual ao Balcão) + histórico
// das rodadas já entregues nesta visita.
function OrderStatusModal({ isOpen, onClose, orders, orderFlow = 'kds' }: { isOpen: boolean; onClose: () => void; orders: MesaOrderState[]; orderFlow?: OrderFlow }) {
    const active = [...orders].reverse().find(o => o.status !== OrderStatus.DELIVERED && o.status !== OrderStatus.CANCELED) ?? null;
    const history = orders.filter(o => o.orderId !== active?.orderId && o.status === OrderStatus.DELIVERED);

    return (
        <BottomSheet isOpen={isOpen} onClose={onClose} title="Acompanhar Pedido">
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-[var(--surface)]">
                    <div className="flex items-center gap-2.5">
                        <BellRing size={18} className="text-[var(--brand)]" />
                        <h3 className="text-[15px] font-semibold text-[var(--text)]">Acompanhar Pedido</h3>
                    </div>
                    <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] p-1.5 rounded-[var(--r-sm)] u-motion">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    {active ? (
                        <OrderProgressView status={active.status} items={active.items} orderFlow={orderFlow} />
                    ) : (
                        <div className="text-center py-10 text-[var(--text-muted)]">
                            <CheckCircle size={36} className="mx-auto mb-3 opacity-20" />
                            <p className="text-sm">Nenhum pedido em andamento no momento.</p>
                        </div>
                    )}

                    {history.length > 0 && (
                        <div>
                            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2 px-1">Pedidos anteriores desta visita</h4>
                            <div className="space-y-2">
                                {history.map(h => (
                                    <div key={h.orderId} className="flex items-center justify-between gap-2 p-3 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)]">
                                        <div className="text-sm text-[var(--text)] min-w-0 truncate">
                                            {h.items.map(i => `${i.quantity}x ${getOrderItemDisplayName(i, 'Item')}`).join(', ')}
                                        </div>
                                        <div className="shrink-0">{getItemStatusBadge(OrderStatus.DELIVERED)}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
        </BottomSheet>
    );
}

// Sinaliza (via Supabase Realtime Presence — nenhum dado gravado no banco)
// que o cliente está com o painel de acompanhamento aberto, pro lojista ver
// um indicador "cliente acompanhando" no card da mesa (StoreModule/TablesView,
// mesmo canal `presence_${storeId}` lido lá via useWatchedTables).
function useWatchingPresence(storeId: string | undefined, tableId: string | undefined, watching: boolean) {
    useEffect(() => {
        if (!storeId || !tableId || !watching) return;
        const channel = supabase.channel(`presence_${storeId}`, {
            config: { presence: { key: `${tableId}_${Math.random().toString(36).slice(2)}` } },
        });
        channel.subscribe(async (status: string) => {
            if (status === 'SUBSCRIBED') {
                await channel.track({ tableId, watching: true, at: Date.now() });
            }
        });
        return () => { supabase.removeChannel(channel); };
    }, [storeId, tableId, watching]);
}

const LoginScreen: React.FC<{ onLogin: (name: string, tableId: string | null, isHost?: boolean, table?: Table | null) => void, storeSlug: string, store: Store | null, onClose?: () => void }> = ({ onLogin, storeSlug, store, onClose }) => {
    const [name, setName] = useState('');
    const [pin, setPin] = useState('');
    const [tableId, setTableId] = useState('');
    const [tables, setTables] = useState<Table[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [mode, setMode] = useState<'table' | 'counter'>('table'); // Default mode

    useEffect(() => {
        const load = async () => {
            if (store) {
                if (store.contract_type === 'balcao') {
                    setMode('counter');
                }
                const t = await fetchTablesPublic(store.id);
                setTables(t);
            }
            setIsLoading(false);
        };
        load();
    }, [store, storeSlug]);

    const handleEnter = async () => {
        const trimmedName = name.trim();
        if (!trimmedName || trimmedName.length < 3) return toast.error('Por favor, digite seu nome (mínimo 3 letras)');

        // Counter Logic
        if (mode === 'counter') {
            return onLogin(trimmedName, null);
        }

        // Table Logic
        if (!tableId) return toast.error('Selecione onde você está sentado');

        setIsLoading(true);
        try {
            // PIN é validado no servidor (Postgres function) — o client nunca
            // recebe o PIN real de mesas que não são a sua.
            const result = await openTableSession(tableId, trimmedName, pin || undefined);

            if (!result.success) {
                toast.error(result.message || 'Não foi possível acessar a mesa.');
                const freshTables = await fetchTablesPublic(store!.id);
                setTables(freshTables); // Atualiza os dados na tela caso algo mude
                setIsLoading(false);
                return;
            }

            onLogin(trimmedName, tableId, result.isHost, result.table ?? null);
        } catch (error) {
            toast.error('Erro ao tentar acessar a mesa. Tente novamente.');
        } finally {
            setIsLoading(false);
        }
    };

    // Overlay escuro coerente com a identidade do cardápio (--ink + dourado)
    // em vez do AuthBackdrop azul institucional: desde que o login virou um
    // modal disparado no meio do fluxo de compra (requestAccessThen), o azul
    // com nuvens quebrava completamente a atmosfera da carta de vinhos.
    if (isLoading) return (
        <div className="min-h-full flex items-center justify-center p-4" style={{ background: 'rgba(10,13,19,0.8)' }}>
            <span className="text-white/80 text-sm animate-pulse">Carregando...</span>
        </div>
    );

    return (
        // .u-glass-modal (achado M1 da revisão final de 2026-08-16, mesmo bug já
        // corrigido em outras superfícies de vidro nesta branch): backdrop-filter
        // inline nunca respeita o fallback de prefers-reduced-transparency (só
        // uma classe CSS consegue, via @media), e duplicar manualmente o prefixo
        // -webkit- é exatamente o padrão que a Task 7 eliminou em todo o resto do
        // cardápio — faltava só este overlay.
        <div className="min-h-full flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out] u-glass-modal">
          <div className="w-full max-w-sm flex flex-col items-center">
            <div className="mb-6 text-center u-grow-in">
                {store?.logo_url ? (
                    <Image src={store.logo_url} alt={`Logo de ${store.name}`} width={80} height={80} className="w-20 h-20 rounded-[1.4rem] mx-auto mb-4 object-cover" style={{ boxShadow: '0 18px 40px -12px rgba(0,0,0,0.5)', border: '2px solid rgba(212,175,92,0.45)' }} />
                ) : (
                    <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(212,175,92,0.15)', border: '1px solid rgba(212,175,92,0.35)' }}>
                        <Wine size={26} style={{ color: store?.config?.accent_color || WINE_GOLD }} />
                    </div>
                )}
                <h1 className="text-2xl font-bold text-white tracking-tight mb-1">{store?.name || 'Cardápio Digital'}</h1>
                <p className="text-sm" style={{ color: store?.config?.accent_color || WINE_GOLD }}>Identifique-se para continuar seu pedido</p>
            </div>
            <Card className="u-grow-in relative w-full p-6 space-y-5" style={{ boxShadow: '0 30px 60px -18px rgba(0,0,0,0.55)', border: '1px solid rgba(212,175,92,0.3)' }}>
                {onClose && (
                    <button
                        onClick={onClose}
                        aria-label="Fechar e continuar vendo o cardápio"
                        className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-2)] u-motion"
                    >
                        <X size={18} />
                    </button>
                )}
                {store?.contract_type === 'balcao_mesas' && (
                    <div className="flex p-1 bg-[var(--surface-2)] rounded-[var(--r-md)]">
                        <button
                            className={`flex-1 py-2 text-[13px] font-medium rounded-[var(--r-sm)] u-motion u-press-sm ${mode === 'table' ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm' : 'text-[var(--text-muted)]'}`}
                            onClick={() => setMode('table')}
                        >
                            <span className="flex items-center justify-center gap-2"><LayoutGrid size={14}/> Mesa</span>
                        </button>
                        <button
                            className={`flex-1 py-2 text-[13px] font-medium rounded-[var(--r-sm)] u-motion u-press-sm ${mode === 'counter' ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm' : 'text-[var(--text-muted)]'}`}
                            onClick={() => setMode('counter')}
                        >
                            <span className="flex items-center justify-center gap-2"><Coffee size={14}/> Balcão</span>
                        </button>
                    </div>
                )}

                <div className="space-y-4">
                    <Input
                        label="Seu Nome"
                        placeholder="Como podemos te chamar?"
                        value={name}
                        onChange={e => setName(e.target.value)}
                    />

                    {mode === 'table' && (
                        <div className="animate-[fadeIn_0.2s_ease-out] space-y-4">
                            <div>
                                <label className="text-[13px] font-medium text-[var(--text-muted)] mb-1 block">Onde você está?</label>
                                <select
                                    className="w-full px-3 py-2 border border-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface)] text-[var(--text)] text-sm focus:ring-2 focus:ring-[var(--brand)] focus:border-[var(--brand)] outline-none u-motion"
                                    value={tableId}
                                    onChange={e => setTableId(e.target.value)}
                                >
                                    <option value="">Selecione sua mesa...</option>
                                    {tables.map(t => {
                                        let statusKey = 'available';
                                        let isDisabled = false;

                                        if (t.status === 'occupied' || t.status === 'waiting_bill') {
                                            statusKey = 'occupied';
                                        } else if (t.status === 'blocked') {
                                            statusKey = 'blocked';
                                            isDisabled = true;
                                        }
                                        const statusLabel = `(${getTableStatusLabel(statusKey)})`;

                                        return (
                                            <option key={t.id} value={t.id} disabled={isDisabled}>
                                                Mesa {t.number} {statusLabel}
                                            </option>
                                        );
                                    })}
                                </select>
                            </div>

                            {/* Show PIN field if occupied OR if store requires PIN */}
                            {(() => {
                                const selected = tables.find(t => t.id === tableId);
                                const isOccupied = selected?.status === 'occupied';
                                const isPinRequired = isOccupied || (store?.config?.require_pin_for_open);

                                if (!isPinRequired) return null;

                                return (
                                    <div className="animate-[fadeIn_0.2s_ease-out] bg-[var(--warn)]/8 p-3 rounded-[var(--r-md)] border border-[var(--warn)]/25">
                                        <p className="text-xs text-[var(--text-muted)] mb-2 text-center">
                                            {isOccupied
                                                ? "Mesa ocupada. Digite o PIN para entrar ou recuperar seu acesso."
                                                : "Digite o PIN fornecido pelo estabelecimento para abrir a mesa."
                                            }
                                        </p>
                                        <Input
                                            label="PIN da Mesa"
                                            placeholder="****"
                                            maxLength={4}
                                            type="tel"
                                            className="text-center tracking-widest text-lg font-bold"
                                            value={pin}
                                            onChange={(e: any) => setPin(e.target.value)}
                                        />
                                    </div>
                                );
                            })()}
                        </div>
                    )}

                    {mode === 'counter' && (
                         <div className="bg-[var(--info)]/8 p-3 rounded-[var(--r-md)] text-sm text-[var(--text-muted)] animate-[fadeIn_0.2s_ease-out]">
                             <p><strong className="text-[var(--text)]">Pedido no Balcão:</strong> Você fará o pedido e aguardará ser chamado pelo nome ou painel.</p>
                         </div>
                    )}
                </div>

                <Button className="w-full group" onClick={handleEnter} disabled={isLoading}>
                    <LogIn className="mr-2 u-motion group-hover:translate-x-1" size={20} />
                    {tables.find(t => t.id === tableId)?.status === 'occupied'
                        ? 'Entrar / Recuperar'
                        : (mode === 'counter' ? 'Abrir Comanda' : 'Abrir Mesa')}
                </Button>
            </Card>
          </div>
        </div>
    );
};

// Extraído do .map() de renderização do cardápio — memoizado pra evitar
// que a lista inteira de produtos re-renderize a cada ação de carrinho
// (achado de performance #7). Também navegável por teclado: é um
// <button> de verdade (Tab foca, Enter/Space aciona), em vez do <div
// onClick> anterior (achado de UX #1).
// Layout iFood (redesign 2026-08-21, Task 4): coluna de texto (nome,
// descrição 2 linhas, linha de preço) à esquerda + miniatura quadrada à
// direita (ProductThumb, Task 1) — substitui a linha "carta de vinhos"
// (sem foto, preço dourado, etiqueta de origem extraída do nome). Sem gold
// nesta linha: preço e selo de desconto usam --brand (regra do redesign,
// gold sai do cardápio). Continua funcionando bem SEM foto real — hoje
// 0/1109 produtos têm `image_url` (catálogo vem do Omie) — porque é
// exatamente esse o caso normal que ProductThumb resolve.
const ProductCard = React.memo(function ProductCard({ product, onSelect, onQuickAdd, disabled, style, isBestseller, isFavorite, onToggleFavorite }: {
    product: Product,
    onSelect: (product: Product) => void,
    onQuickAdd?: (product: Product) => void,
    disabled?: boolean,
    style?: React.CSSProperties,
    // Vende mais II (migration 020): badge calculado (não é PRODUCT_TAGS) e
    // favorito 100% client-side (localStorage) — ambos opcionais pra não
    // quebrar nenhum outro caller existente do ProductCard.
    isBestseller?: boolean,
    isFavorite?: boolean,
    onToggleFavorite?: (productId: string) => void,
}) {
    const open = () => { if (!disabled) onSelect(product); };
    return (
        <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            onClick={open}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
            aria-disabled={disabled}
            className={`u-grow-in group flex items-start gap-3 py-4 text-left w-full u-motion border-b border-[var(--border)] last:border-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] rounded-[var(--r-sm)] hover:bg-[var(--surface-2)]/60 ${disabled ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}`}
            style={style}
        >
            <div className="flex-1 min-w-0">
                <h3 className="text-[15px] font-semibold text-[var(--text)] leading-snug line-clamp-2">
                    {product.name}
                </h3>
                {product.description && (
                    <p className="text-[13px] text-[var(--text-muted)] mt-0.5 line-clamp-2">{product.description}</p>
                )}
                {/* Preço + "Mais vendido": mesma linha (mt-1.5 flex-wrap), pra caber
                    junto sem empurrar layout quando os dois aparecem. PriceRow (acima
                    no arquivo) é a fonte única da composição riscado+selo — reusada
                    também pelo card de destaque (Task 5) e pela página de produto
                    (Task 6). "Mais vendido" (migration 020, calculado a partir de
                    venda real) virou selo discreto aqui em vez de texto dourado ao
                    lado do nome — gold sai desta linha por completo. */}
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <PriceRow product={product} size="row" variablePricing={hasVariablePricing(product)} />
                    {isBestseller && (
                        <span
                            className="inline-flex items-center gap-1 rounded-full bg-[var(--brand)]/10 text-[var(--brand)] text-[10px] font-bold px-1.5 py-0.5 whitespace-nowrap"
                            title="Um dos produtos mais vendidos desta loja"
                        >
                            🔥 Mais vendido
                        </span>
                    )}
                </div>
                {!!product.prep_time_minutes && (
                    <div className="mt-1">
                        <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                            <Clock size={11} /> {product.prep_time_minutes} min
                        </span>
                    </div>
                )}
            </div>
            {/* Miniatura à direita: relative pro "+" de adição rápida e o coração de
                favorito ficarem sobrepostos nos cantos (mesmo padrão iFood). */}
            <div className="relative flex-shrink-0">
                <ProductThumb src={product.image_url} name={product.name} size="row" />
                {onQuickAdd && (
                    // Vermelho iFood (correção 2026-08-21: --brand/azul saiu de toda
                    // "ação" do cardápio, ver IFOOD_RED acima). whileTap com spring
                    // de verdade (SPRING_TAP, lib/motion.ts — validado com o usuário,
                    // não criar um terceiro preset) em vez do scale CSS instantâneo do
                    // u-press: é o botão mais tocado da tela. stopPropagation preservado:
                    // o card inteiro é clicável (abre o modal), o "+" não pode também abrir.
                    <motion.button
                        type="button"
                        aria-label={`Adicionar ${product.name}`}
                        onClick={(e) => { e.stopPropagation(); if (!disabled) onQuickAdd(product); }}
                        whileTap={{ scale: 0.88 }}
                        transition={SPRING_TAP}
                        className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[var(--surface)] border border-[var(--border)] shadow-sm grid place-items-center"
                        style={{ color: IFOOD_RED }}
                    >
                        <Plus size={15} />
                    </motion.button>
                )}
                {onToggleFavorite && (
                    // Mesmo alvo de toque de 44x44 já usado antes desta reescrita
                    // (padding 15px + margem negativa -15px cancelando o espaço no
                    // fluxo) — só que agora "fluxo" é a posição absoluta no canto
                    // superior direito da miniatura, não mais ao lado do preço.
                    // stopPropagation preservado: favoritar não abre o modal.
                    <button
                        type="button"
                        aria-label={isFavorite ? `Remover ${product.name} dos favoritos` : `Favoritar ${product.name}`}
                        onClick={(e) => { e.stopPropagation(); onToggleFavorite(product.id); }}
                        className="absolute top-0 right-0 p-[15px] -m-[15px] text-[var(--text-muted)] hover:text-[var(--err)] u-motion"
                    >
                        <Heart
                            size={14}
                            className={isFavorite ? 'fill-[var(--err)] text-[var(--err)]' : ''}
                            style={{ filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))' }}
                        />
                    </button>
                )}
            </div>
        </div>
    );
});
ProductCard.displayName = 'ProductCard';

// Cartão de Destaques (redesign iFood, Task 5): cartão de vitrine
// independente do ProductCard acima. A linha do ProductCard (texto à
// esquerda, miniatura quadrada à direita) não funciona dentro de uma faixa
// de carrossel estreita — o destaque precisa do formato inverso (foto
// quadrada em cima, texto embaixo). Por isso os dois formatos nunca se
// aninham: cada um é seu próprio componente, sem reaproveitamento visual
// entre eles. Reusa ProductThumb (size="featured", já quadrado full-width)
// e PriceRow (size="featured", mesma composição efetivo+riscado+selo da
// Task 4) — nenhuma das duas é reimplementada aqui.
const FeaturedProductCard = React.memo(function FeaturedProductCard({ product, onSelect, disabled }: {
    product: Product,
    onSelect: (product: Product) => void,
    disabled?: boolean,
}) {
    return (
        <button
            type="button"
            onClick={() => onSelect(product)}
            disabled={disabled}
            aria-disabled={disabled}
            className={`w-[165px] flex-shrink-0 text-left u-motion focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] rounded-[var(--r-sm)] ${disabled ? 'opacity-60 pointer-events-none' : ''}`}
            style={{ scrollSnapAlign: 'start' }}
        >
            <ProductThumb src={product.image_url} name={product.name} size="featured" />
            <PriceRow product={product} size="featured" variablePricing={hasVariablePricing(product)} className="mt-2" />
            <p className="text-[13px] text-[var(--text)] mt-1 line-clamp-2">{product.name}</p>
        </button>
    );
});
FeaturedProductCard.displayName = 'FeaturedProductCard';

// Regra de seleção mostrada na faixa de cabeçalho de cada grupo (Task 6,
// Passo 3) — sempre derivada de type/required/max_select, nunca hardcoded.
// 'single' é sempre 0 ou 1 por natureza do radio (nunca tem max_select
// próprio, ver ProductOptionGroup em types/index.ts), então não depende do
// campo. 'multiple' deriva de max_select: com teto → "até N"; sem teto →
// "quantas quiser".
function getOptionGroupRuleLabel(group: ProductOptionGroup): string {
    if (group.type === 'single') return 'Escolha 1 opção';
    if (typeof group.max_select === 'number') return `Escolha até ${group.max_select} opções`;
    return 'Escolha quantas quiser';
}

// Fix round 2/3 (revisão, Finding 5): o rodapé do ProductModal é
// `position: sticky` dentro do container com scroll do Modal (ui.tsx) —
// participa do fluxo normal (diferente de `fixed`), mas como é o último
// elemento do conteúdo, ao rolar até o fim ele "gruda" no rodapé do
// container e passa a sobrepor o que estava rolando por baixo dele (é
// assim que sticky funciona, de propósito) — sem nenhuma folga reservada
// depois dele, isso cobria parte do campo de observação (o penúltimo
// elemento) permanentemente, em qualquer altura de scroll.
//
// Fix round 2 tentou reservar esse espaço medindo o rodapé ao vivo via
// `ResizeObserver` (JS) — e não funcionou: o efeito usava deps `[]` (roda
// uma única vez, no primeiro mount de `ProductModal`), e o primeiro mount
// acontece com `incomingProduct === null` (o componente é montado
// incondicionalmente em `ClientModule`, antes de qualquer produto ser
// selecionado). Como `if (!product) return null` faz o componente devolver
// `null` nesse instante, o `ref` do rodapé também nunca chegava a apontar
// pra nenhum elemento real quando o efeito rodava — o observer nunca era
// criado, e como o efeito nunca roda de novo (deps vazias), o estado ficava
// em 0 pra sempre, mesmo com o rodapé de verdade existindo no DOM em
// qualquer produto aberto depois. Trocado por uma reserva 100% CSS: sem
// estado, sem observer, sem depender de QUANDO um efeito roda em relação a
// quando o rodapé existe — não tem como silenciosamente virar 0.
//
// O valor cobre com folga o pior caso real do rodapé: `py-3` (12px topo +
// 12px base) + borda (1px) + o mais alto entre o seletor de quantidade e a
// coluna [mensagem de erro + botão] — o botão sozinho (`h-12`=48px) ou,
// quando `missingRequired` aparece, mensagem (~14px) + `gap-1`(4px) +
// botão(48px) ≈ 66px de conteúdo. Total real ≈ 91px no pior caso (medido ao
// vivo pelo revisor em 79px no caso sem mensagem). `9rem` (144px) reserva
// ~53px de margem sobre esse pior caso; `env(safe-area-inset-bottom)` é
// somado à parte porque o rodapé já soma isso na própria `paddingBottom`
// dele — o spacer precisa espelhar, não só a parte fixa.
const PRODUCT_MODAL_FOOTER_SPACER_HEIGHT = 'calc(9rem + env(safe-area-inset-bottom))';

const ProductModal: React.FC<{
    product: Product | null,
    onClose: () => void,
    onAdd: (qty: number, notes: string, selectedOptions: SelectedOption[]) => void,
    noteSuggestions?: string[],
    // Vende mais II (migration 020): "peça também" reusa o mesmo mecanismo de
    // estado que já controla qual produto está com o modal aberto (troca o
    // selectedProduct do ClientModule, o próprio useEffect abaixo já reseta
    // qty/notes ao mudar de produto). Favorito é 100% client-side.
    onSelectRecommended: (product: Product) => void,
    isFavorite: boolean,
    onToggleFavorite: (productId: string) => void,
    // Achado da varredura (2026-07-07): "Peça também" não respeitava o
    // horário da categoria do produto recomendado (migration 018) — um
    // produto de categoria fechada no momento podia aparecer aqui, ao
    // contrário da vitrine de Destaques, que já filtra por isso. Mesmo
    // conjunto de ids que `visibleCategories` já calcula no ClientModule.
    visibleCategoryIds: Set<string>,
    // Task 6: pílula da loja sobre a foto (logo + nome), formato iFood.
    // null enquanto currentStore ainda não carregou.
    store: Store | null,
}> = ({ product: incomingProduct, onClose, onAdd, noteSuggestions = [], onSelectRecommended, isFavorite, onToggleFavorite, visibleCategoryIds, store }) => {
    const [qty, setQty] = useState(1);
    const [notes, setNotes] = useState('');
    const [selections, setSelections] = useState<Record<string, string[]>>({}); // group_id -> option_id[]
    // Modal (variant="sheet") precisa continuar renderizando o conteúdo
    // durante a animação de saída (~0.4s, spring) — se este componente
    // retornasse null no instante em que incomingProduct vira null, o
    // AnimatePresence de dentro do Modal nunca teria conteúdo pra manter
    // montado enquanto anima. Guarda o último produto real e usa ele pro
    // corpo do modal; isOpen continua refletindo incomingProduct de verdade.
    const lastProductRef = useRef<Product | null>(null);
    if (incomingProduct) lastProductRef.current = incomingProduct;
    const product = incomingProduct ?? lastProductRef.current;

    useEffect(() => {
        if (!incomingProduct) return;
        setQty(1);
        setNotes('');

        // Reduz atrito: grupo unico obrigatorio (ex. "Tamanho" P/M/G) vem com a
        // 1a opcao disponivel ja pre-selecionada, em vez de forcar o cliente a
        // clicar numa escolha que teria que fazer de qualquer forma. Defesa
        // client-side extra com `available !== false` mesmo o servidor
        // (fetchMenu) ja filtrando por available=true por padrao.
        const initialSelections: Record<string, string[]> = {};
        (incomingProduct.option_groups || []).forEach(group => {
            if (group.type === 'single' && group.required) {
                const firstAvailable = group.options.find(opt => opt.available !== false);
                if (firstAvailable) initialSelections[group.id] = [firstAvailable.id];
            }
        });
        setSelections(initialSelections);
    }, [incomingProduct]);

    if (!product) return null; // só null antes do primeiro produto abrir (ver lastProductRef acima)

    const groups = product.option_groups || [];

    // "Peça também": só sugere produto de categoria disponível agora (mesma
    // regra da vitrine de Destaques) — produto órfão (sem categoria) não tem
    // restrição de horário, então continua sugerido normalmente.
    const availableRecommended = (product.recommended_products || []).filter(
        rec => rec.category_id == null || visibleCategoryIds.has(rec.category_id)
    );

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
    // Mínimo efetivo: grupo obrigatório sempre exige pelo menos 1 (ou
    // min_select, se maior); grupo opcional só exige algo se min_select
    // tiver sido configurado explicitamente.
    const missingRequired = groups.some(g => {
        const effectiveMin = g.required ? Math.max(g.min_select || 1, 1) : (g.min_select || 0);
        return (selections[g.id] || []).length < effectiveMin;
    });

    return (
        <Modal isOpen={!!incomingProduct} onClose={onClose} title={product.name} variant="sheet" surface="opaque" hideTitle>
            {/* -m-5 cancela o p-5 do container de conteúdo do Modal (ui.tsx) —
                só a foto do topo (Passo 1) precisa sangrar de borda a borda;
                cada seção abaixo reintroduz o próprio px-4. O botão de fechar
                da sheet já vive na barra de título do Modal (ui.tsx), por
                isso não há um segundo "X" aqui. */}
            <div className="-m-5">
                {/* Passo 1: foto sangrando + pílula da loja + favoritar */}
                <div className="h-56 relative">
                    <ProductThumb src={product.image_url} name={product.name} size="hero" />
                    {store && (
                        <div className="absolute left-3 bottom-3 max-w-[75%] flex items-center gap-1.5 bg-white rounded-full py-1 pl-1 pr-3 shadow-sm">
                            {store.logo_url && (
                                <Image
                                    src={store.logo_url}
                                    alt=""
                                    width={22}
                                    height={22}
                                    className="w-[22px] h-[22px] rounded-full object-cover flex-shrink-0"
                                />
                            )}
                            <span className="text-[12px] font-medium text-[var(--ink)] truncate">{store.name}</span>
                        </div>
                    )}
                    {/* Favoritar (Vende Mais II, 100% client-side, localStorage) — canto
                        superior direito, sobre a foto. Sem `backdrop-blur-sm` (achado M3
                        da revisão final de 2026-08-16): já é uma sheet de vidro em
                        animação (drag-transformada), um segundo backdrop-filter aninhado
                        é caro em celular fraco — `bg-[var(--surface)]` opaco equivale
                        visualmente. */}
                    <button
                        type="button"
                        aria-label={isFavorite ? `Remover ${product.name} dos favoritos` : `Favoritar ${product.name}`}
                        onClick={() => onToggleFavorite(product.id)}
                        className="absolute top-3 right-3 z-10 p-2 rounded-full bg-[var(--surface)] border border-[var(--border)] u-motion u-press-sm"
                    >
                        <Heart size={18} className={isFavorite ? 'fill-[var(--err)] text-[var(--err)]' : 'text-[var(--text-muted)]'} />
                    </button>
                </div>

                {/* Passo 2: bloco de identificação */}
                <div className="px-4 pt-4">
                    <h2 className="text-[22px] font-bold leading-tight text-[var(--text)]">{product.name}</h2>
                    {!!product.description && (
                        <p className="text-[14px] text-[var(--text-muted)] mt-1">{product.description}</p>
                    )}

                    {/* Badges (migration 019): catálogo fechado de lib/labels.ts, tom
                        dourado trocado por --brand (redesign iFood — gold sai do
                        cardápio inteiro, ver AGENTS.md "Identidade carta de vinhos"). */}
                    {product.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {product.tags.map(tag => {
                                const { label, emoji } = getTagDisplay(tag);
                                return (
                                    <span
                                        key={tag}
                                        className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full border border-[var(--brand)]/35 text-[var(--brand)] bg-[var(--brand)]/8"
                                    >
                                        {emoji} {label}
                                    </span>
                                );
                            })}
                        </div>
                    )}

                    {/* Linha de preço: mesma composição das Tasks 4/5 (PriceRow),
                        consumida aqui, não reimplementada. Não exibir "Serve até N
                        pessoas" — esse dado não existe no schema (regra do brief). */}
                    <PriceRow product={product} size="page" variablePricing={hasVariablePricing(product)} className="mt-3" />
                </div>

                {/* Passo 3: grupos de opção — faixa de cabeçalho cinza + linhas de
                    opção, um <fieldset>/<legend> por grupo (preserva a estrutura
                    de acessibilidade existente: aria-required no input, legend
                    como nome acessível do fieldset). */}
                {groups.map(group => {
                    // Defesa client-side extra: o servidor (fetchMenu) já filtra
                    // product_options por available=true por padrão, mas manter
                    // o filtro aqui também, caso a opção chegue por outro caminho.
                    const visibleOptions = group.options.filter(opt => opt.available !== false);
                    const groupSelections = selections[group.id] || [];
                    const hasMaxLimit = group.type === 'multiple' && typeof group.max_select === 'number';
                    const atMaxLimit = hasMaxLimit && groupSelections.length >= (group.max_select as number);

                    return (
                        <fieldset key={group.id}>
                            <legend className="w-full block bg-[var(--surface-2)] px-4 py-2.5 mt-4">
                                <span className="flex items-center justify-between gap-2">
                                    <span className="text-[15px] font-bold text-[var(--text)]">{group.name}</span>
                                    {group.required && (
                                        <span className="flex-shrink-0 bg-[var(--ink)] text-white text-[10px] font-bold tracking-wide rounded px-1.5 py-0.5">
                                            OBRIGATÓRIO
                                        </span>
                                    )}
                                </span>
                                <span className="block text-[12px] text-[var(--text-muted)] mt-0.5">
                                    {getOptionGroupRuleLabel(group)}
                                </span>
                            </legend>
                            {visibleOptions.map(opt => {
                                const isChecked = groupSelections.includes(opt.id);
                                const isDisabled = atMaxLimit && !isChecked;
                                return (
                                    <label
                                        key={opt.id}
                                        // Fix round 1 (revisão, Minor #4): focus-within estende o anel de
                                        // foco pra linha inteira (não só o controle circular/quadrado à
                                        // direita) — um usuário de teclado navegando da esquerda enxerga o
                                        // foco assim que chega na linha, não só quando o olhar já está no
                                        // canto direito. ring-inset evita que o anel seja cortado pelo
                                        // scroll container (o modal inteiro tem overflow-y-auto).
                                        className={`flex items-center gap-3 px-4 py-3 min-h-11 border-b border-[var(--border)] focus-within:ring-2 focus-within:ring-inset focus-within:ring-[var(--brand)] ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                    >
                                        <span className="flex-1 min-w-0">
                                            <span className="block text-[14px] text-[var(--text)]">{opt.name}</span>
                                            {opt.price_delta > 0 && (
                                                <span className="block text-[13px] text-[var(--text-muted)] mt-0.5">
                                                    + R$ {formatBRL(opt.price_delta)}
                                                </span>
                                            )}
                                        </span>
                                        <ProductThumb src={undefined} name={opt.name} size="option" />
                                        {group.type === 'single' ? (
                                            <span className="relative flex-shrink-0 w-5 h-5">
                                                <input
                                                    type="radio"
                                                    name={`group-${group.id}`}
                                                    checked={isChecked}
                                                    disabled={isDisabled}
                                                    aria-required={group.required}
                                                    onChange={() => toggleOption(group, opt.id)}
                                                    className="peer sr-only"
                                                />
                                                <span
                                                    aria-hidden="true"
                                                    // Vermelho iFood (correção 2026-08-21): "option radio/+ controls"
                                                    // é AÇÃO na paleta iFood, não preço/marca — ver IFOOD_RED acima.
                                                    className={`absolute inset-0 rounded-full border-2 flex items-center justify-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--brand)] peer-focus-visible:ring-offset-1 ${isChecked ? '' : 'border-[var(--border)]'}`}
                                                    style={isChecked ? { borderColor: IFOOD_RED } : undefined}
                                                >
                                                    {isChecked && <span className="w-2.5 h-2.5 rounded-full" style={{ background: IFOOD_RED }} />}
                                                </span>
                                            </span>
                                        ) : (
                                            <span className="relative flex-shrink-0 w-7 h-7">
                                                <input
                                                    type="checkbox"
                                                    name={`group-${group.id}`}
                                                    checked={isChecked}
                                                    disabled={isDisabled}
                                                    aria-required={group.required}
                                                    onChange={() => toggleOption(group, opt.id)}
                                                    className="peer sr-only"
                                                />
                                                <span
                                                    aria-hidden="true"
                                                    // Mesmo princípio do radio acima: controle de opção é AÇÃO,
                                                    // vermelho iFood nos dois estados (borda sempre; fundo cheio
                                                    // só quando marcado).
                                                    className={`absolute inset-0 rounded-full border flex items-center justify-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--brand)] peer-focus-visible:ring-offset-1 ${isChecked ? 'text-white' : ''}`}
                                                    style={{ borderColor: IFOOD_RED, ...(isChecked ? { backgroundColor: IFOOD_RED } : { color: IFOOD_RED }) }}
                                                >
                                                    {isChecked ? <Check size={14} /> : <Plus size={14} />}
                                                </span>
                                            </span>
                                        )}
                                    </label>
                                );
                            })}
                        </fieldset>
                    );
                })}

                {/* Passo 4: observação — chips de sugestão já existentes + rótulo
                    com contador. Nenhum fluxo de "Denunciar item" (não existe
                    aqui, regra do brief). */}
                <div className="px-4 mt-4">
                    {noteSuggestions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                            {noteSuggestions.map((suggestion, idx) => (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={() => setNotes(prev => (prev.trim() ? `${prev.trim()}, ${suggestion}` : suggestion).slice(0, 140))}
                                    className="inline-flex items-center min-h-11 text-[12px] font-medium px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] hover:border-[var(--brand)] hover:text-[var(--text)] u-motion u-press-sm"
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="flex items-center justify-between mb-1">
                        <label htmlFor="product-modal-notes" className="text-[13px] font-medium text-[var(--text-muted)]">
                            Alguma observação?
                        </label>
                        <span className="text-[12px] text-[var(--text-muted)] num">{notes.length}/140</span>
                    </div>
                    <input
                        id="product-modal-notes"
                        maxLength={140}
                        placeholder="Ex: tirar a cebola, maionese à parte etc."
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        className="w-full rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:border-[var(--brand)] transition-all"
                    />
                </div>

                {/* "Peça também" (migration 020, Vende Mais II): cross-sell manual
                    do lojista, movido pra cima do rodapé fixo (Task 6). Clicar
                    troca o produto do próprio modal (onSelectRecommended ->
                    setSelectedProduct no ClientModule, mesmo mecanismo de sempre). */}
                {!!availableRecommended.length && (
                    <div className="px-4 mt-4 pb-4">
                        <h4 className="text-[13px] font-semibold text-[var(--text)] mb-2 flex items-center gap-1.5">
                            <Sparkles size={13} className="text-[var(--brand)]" /> Peça também
                        </h4>
                        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
                            {availableRecommended.map(rec => (
                                <button
                                    key={rec.id}
                                    type="button"
                                    onClick={() => onSelectRecommended(rec)}
                                    className="flex-shrink-0 w-24 text-left border border-[var(--border)] rounded-[var(--r-md)] overflow-hidden bg-[var(--surface)] u-motion hover:border-[var(--brand)]"
                                >
                                    <div className="w-full h-16 bg-[var(--surface-2)] overflow-hidden">
                                        {/* Fix round 1 (revisão, Minor #3): size="option" do ProductThumb é
                                            um quadrado fixo de 56px — dentro deste wrapper de 96x64 sobrava
                                            gutter visível em --surface-2. !w-full/!h-16/!rounded-none (via
                                            className, ponto de extensão que o próprio componente já aceita)
                                            fazem a miniatura preencher o wrapper inteiro, sem reimplementar
                                            nada do ProductThumb. */}
                                        <ProductThumb src={rec.image_url} name={rec.name} size="option" className="!w-full !h-16 !rounded-none" />
                                    </div>
                                    <div className="p-1.5">
                                        <p className="text-[11px] font-medium text-[var(--text)] leading-tight line-clamp-2">{rec.name}</p>
                                        {/* Mesma regra de preço da PriceRow (correção 2026-08-21): escuro
                                            sem promoção, roxo com promoção — nunca --brand, mesmo aqui num
                                            card compacto que não passa pelo componente PriceRow. */}
                                        <p className="text-[11px] font-bold mt-0.5" style={{ color: hasActivePromo(rec) ? IFOOD_PURPLE : 'var(--text)' }}>R$ {formatBRL(getEffectivePrice(rec))}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Passo 4 (rodapé): quantidade (limites 1-99 preservados) + botão
                    Adicionar com o total dentro do próprio botão. sticky bottom-0
                    dentro do container com overflow-y-auto do Modal (ui.tsx) — não
                    precisa de scroll container próprio.
                    Fix round 1 (revisão): a mensagem de grupo obrigatório faltando
                    precisa viajar com o rodapé fixo (senão o cliente vê um botão
                    desabilitado sem explicação até rolar até o fim). Em vez de
                    alterar a classlist exata do próprio rodapé (mandada verbatim
                    pelo brief), a mensagem entra num wrapper novo ao lado do
                    seletor de quantidade — o rodapé continua tendo só 2 filhos
                    diretos (quantidade + este wrapper), "flex items-center gap-3"
                    intacto. */}
                <div
                    className="sticky bottom-0 bg-[var(--surface)] border-t border-[var(--border)] px-4 py-3 flex items-center gap-3"
                    style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
                >
                    <div className="flex items-center gap-3 bg-[var(--surface-2)] px-1.5 py-1 rounded-[var(--r-sm)] border border-[var(--border)] flex-shrink-0">
                        <button onClick={() => setQty(Math.max(1, qty - 1))} className="min-w-11 min-h-11 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] rounded-[var(--r-sm)] u-motion"><Minus size={16} /></button>
                        <span className="font-semibold text-[var(--text)] w-6 text-center num">{qty}</span>
                        <button onClick={() => setQty(q => Math.min(99, q + 1))} className="min-w-11 min-h-11 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] rounded-[var(--r-sm)] u-motion"><Plus size={16} /></button>
                    </div>
                    <div className="flex-1 flex flex-col gap-1 min-w-0">
                        {missingRequired && (
                            <p id="product-modal-required-error" className="text-[12px] text-center text-[var(--err)]">
                                Escolha uma opção obrigatória para continuar.
                            </p>
                        )}
                        <Button
                            className="w-full h-12"
                            // Vermelho iFood (correção 2026-08-21): "o botão Adicionar" é uma
                            // das 4 ações explicitamente listadas pra virar IFOOD_RED. Estilo
                            // inline porque o componente Button (components/ui.tsx) é
                            // compartilhado com o painel do lojista/Master Admin — não dá pra
                            // mudar a cor "primary" do componente em si sem afetar telas fora
                            // de escopo, então só esta instância recebe a cor por style
                            // (sempre vence a classe bg-[var(--brand)] do variant, sem tocar
                            // no componente). Texto/total continuam brancos (herdado do
                            // Button), contraste de branco sobre #EA1D2C é alto o bastante.
                            style={{ backgroundColor: IFOOD_RED }}
                            disabled={missingRequired}
                            aria-describedby={missingRequired ? 'product-modal-required-error' : undefined}
                            onClick={() => { onAdd(qty, notes, selectedOptions); onClose(); }}
                        >
                            <span className="w-full flex items-center justify-between text-[15px]">
                                <span>Adicionar</span>
                                <span>R$ {formatBRL(unitPrice * qty)}</span>
                            </span>
                        </Button>
                    </div>
                </div>
                {/* Fix round 3 (revisão, Finding 5): spacer 100% CSS (ver
                    PRODUCT_MODAL_FOOTER_SPACER_HEIGHT acima) que garante scroll
                    suficiente pra tudo que vem antes do rodapé (observação, "Peça
                    também") nunca ficar parcialmente escondido atrás dele quando
                    "gruda" no fim do scroll. Puramente estrutural — sem conteúdo,
                    sem cor, invisível pro leitor de tela. */}
                <div aria-hidden="true" style={{ height: PRODUCT_MODAL_FOOTER_SPACER_HEIGHT }} />
            </div>
        </Modal>
    );
};

// Bottom sheet reutilizável (2026-08-16): scrim + folha que arrasta com o
// dedo de verdade (1:1, não só anima no final), resiste com rubber-band
// ao passar do topo, e decide fechar-ou-voltar pela VELOCIDADE do gesto
// ao soltar (projeção de momentum), não só pela distância arrastada — ver
// docs/plans/2026-08-16-cardapio-material-motion-apple.md, Princípio 4.
// CartModal e OrderStatusModal usam este componente pro scrim/folha/gesto;
// cada um só cuida do próprio conteúdo interno (header/body/footer).
const DISMISS_VELOCITY = 500; // px/s — flick rápido pra baixo já fecha
const DISMISS_OFFSET_RATIO = 0.35; // arrastar >35% da altura da folha fecha mesmo sem flick

// Duplicado de components/ui.tsx (Modal) de propósito — achado I2 da revisão
// final de 2026-08-16: BottomSheet (usado por CartModal/OrderStatusModal)
// não tinha role="dialog"/aria-modal/focus-trap/Esc, enquanto o gêmeo
// Modal variant="sheet" (ui.tsx) já tinha desde sempre. Mesmo princípio já
// documentado no comentário de ui.tsx: "se um valor mudar, mudar os dois
// juntos" — não virou hook/módulo compartilhado novo porque não existe
// nenhum lib/hooks compartilhado entre ClientModule.tsx e ui.tsx hoje, e
// inventar um cruzamento novo tão perto do fim do branch é risco
// desproporcional a um bugfix de acessibilidade.
const BOTTOM_SHEET_FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function BottomSheet({ isOpen, onClose, children, maxWidth = 'max-w-md', title }: {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    maxWidth?: string;
    // Nome acessível da folha pro leitor de tela (aria-label) — cada
    // consumidor (CartModal/OrderStatusModal) já mostra esse mesmo texto
    // visualmente no próprio header, então aria-label evita ter que
    // encanar um id através da fronteira children/BottomSheet só pra usar
    // aria-labelledby.
    title: string;
}) {
    const containerRef = React.useRef<HTMLDivElement>(null);
    // Achado real da Task 7 (QA ao vivo com mouse, não só revisão de
    // código): dragElastic.top pequeno faz a folha mal se mover ao ser
    // arrastada pra cima, mas o cursor do mouse continua andando a
    // distância cheia — ele "sai" da folha e passa a estar sobre o scrim
    // (que tem onClick={onClose}). Ao soltar o botão ali, o clique nativo
    // do browser (disparado logo depois do mouseup) aterrissa no scrim e
    // fecha a folha mesmo sem o usuário ter arrastado o suficiente pra
    // isso ser intencional. Não acontece em touch (pointerup fica
    // capturado no elemento original) — confirmado testando os dois com
    // Playwright (mouse vs. touch simulado via CDP).
    //
    // A guarda abaixo suprime esse clique acidental do scrim. Achado
    // decisivo ao instrumentar com console.log: o evento nativo `click`
    // dispara ANTES do `onDragEnd` do Framer Motion rodar (não depois,
    // como seria intuitivo) — então marcar a flag dentro de `onDragEnd`
    // sempre chega tarde demais, o `onClick` do scrim já leu o valor
    // antigo. A flag precisa ser marcada em `onDragStart` (dispara assim
    // que o gesto é reconhecido como arrasto, bem antes do soltar/click) e
    // só é limpa depois, em `onDragEnd`, com um pequeno atraso — folga
    // suficiente pra não atrapalhar um toque legítimo seguinte no scrim.
    const justDraggedRef = React.useRef(false);

    // Foco inicial + focus trap (Tab/Shift+Tab) + fechar com Esc — mesmo
    // efeito de components/ui.tsx (Modal), duplicado aqui (ver comentário
    // acima do componente).
    React.useEffect(() => {
        if (!isOpen) return;

        const container = containerRef.current;
        const getFocusable = (): HTMLElement[] =>
            container
                ? Array.from(container.querySelectorAll<HTMLElement>(BOTTOM_SHEET_FOCUSABLE_SELECTOR)).filter(
                    (el) => el.offsetParent !== null
                )
                : [];

        const focusable = getFocusable();
        if (focusable.length > 0) {
            focusable[0].focus();
        } else {
            container?.focus();
        }

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
                return;
            }

            if (e.key === 'Tab') {
                const items = getFocusable();
                if (items.length === 0) {
                    e.preventDefault();
                    container?.focus();
                    return;
                }

                const first = items[0];
                const last = items[items.length - 1];
                const active = document.activeElement;

                if (e.shiftKey) {
                    if (active === first || !container?.contains(active)) {
                        e.preventDefault();
                        last.focus();
                    }
                } else {
                    if (active === last || !container?.contains(active)) {
                        e.preventDefault();
                        first.focus();
                    }
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="scrim"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
                    style={{ background: 'rgba(10,13,19,0.6)' }}
                    onClick={() => { if (!justDraggedRef.current) onClose(); }}
                >
                    <motion.div
                        key="sheet"
                        ref={containerRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label={title}
                        tabIndex={-1}
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={SPRING_SHEET}
                        drag="y"
                        // Só `top: 0` (achado I1 da revisão final de 2026-08-16): com
                        // `bottom: 0` também, arrastar pra BAIXO (fechar) também
                        // ficava elástico/resistido — a spec pede rastreio 1:1 do
                        // dedo ao arrastar pra baixo, com resistência só ao
                        // arrastar pra CIMA (passar do topo). Sem `bottom` no
                        // objeto, esse eixo fica sem limite, então nenhum
                        // `dragElastic` se aplica a ele — só `top: 0.05` (quase
                        // rígido) continua valendo pra cima.
                        dragConstraints={{ top: 0 }}
                        dragElastic={{ top: 0.05, bottom: 0.5 }}
                        onDragStart={() => { justDraggedRef.current = true; }}
                        onDragEnd={(_e, info) => {
                            setTimeout(() => { justDraggedRef.current = false; }, 150);
                            if (info.velocity.y > DISMISS_VELOCITY || info.offset.y > window.innerHeight * DISMISS_OFFSET_RATIO) {
                                onClose();
                            }
                        }}
                        className={`w-full ${maxWidth} rounded-t-[var(--r-lg)] sm:rounded-[var(--r-lg)] overflow-hidden flex flex-col max-h-[90vh] u-glass-modal on-glass`}
                        style={{ border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 -8px 40px -8px rgba(0,0,0,0.5)' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Alça visual — sinaliza que dá pra arrastar (achado da
                            skill apple-design: "swipe actions must show clear
                            affordance"). Só decorativo, o gesto funciona na folha
                            inteira, não só na alça. */}
                        <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
                            <div className="w-10 h-1 rounded-full bg-white/20" />
                        </div>
                        {children}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

const CartModal: React.FC<{
    isOpen: boolean,
    onClose: () => void,
    cart: CartItem[],
    onConfirm: () => void,
    isLoading: boolean,
    total: number,
    onUpdateQty: (item: CartItem, delta: number) => void,
    onRemove: (item: CartItem) => void,
    accentColor: string
}> = ({ isOpen, onClose, cart, onConfirm, isLoading, total, onUpdateQty, onRemove, accentColor }) => {
    return (
        <BottomSheet isOpen={isOpen} onClose={onClose} title="Seu Pedido">
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
                    <div className="flex items-center gap-2.5">
                        <ShoppingBag size={18} className="text-[var(--brand)]" />
                        <h3 className="text-[15px] font-semibold text-[var(--text)]">Seu Pedido</h3>
                    </div>
                    <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] p-1.5 rounded-[var(--r-sm)] u-motion">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {cart.length === 0 ? (
                        <div className="text-center py-12 text-[var(--text-muted)] u-fade-in">
                            <ShoppingBag size={36} className="mx-auto mb-3 opacity-20"/>
                            <p className="text-sm">Seu carrinho está vazio.</p>
                        </div>
                    ) : (
                        cart.map((item, idx) => (
                            <div key={`${item.product.id}-${idx}`} className="flex gap-3 border border-[var(--border)] p-3 rounded-[var(--r-md)]" style={{boxShadow:'var(--shadow-sm)'}}>
                                {/* Mesmo bloco de fallback tipográfico usado em toda a linha
                                    de produto (ProductThumb, Task 1) — antes caía num ícone
                                    Coffee fixo, um terceiro estilo de fallback inconsistente
                                    com o resto do redesign iFood. */}
                                <ProductThumb src={item.product.image_url} name={item.product.name} size="cart" />
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start gap-2">
                                        <h4 className="font-medium text-[var(--text)] text-sm truncate">
                                            {getCartItemDisplayName(item)}
                                        </h4>
                                        {/* Preço promocional (migration 019): calculateCartItemUnitPrice
                                            já usa getEffectivePrice por baixo, então o valor cobrado
                                            aqui sempre está certo — só decidimos SE mostra o riscado. */}
                                        {hasActivePromo(item.product) ? (
                                            <span className="flex flex-col items-end flex-shrink-0 leading-tight">
                                                <span className="text-[11px] text-[var(--text-muted)] line-through num">
                                                    R$ {formatBRL((item.product.price + (item.selectedOptions || []).reduce((a, o) => a + o.price_delta, 0)) * item.quantity)}
                                                </span>
                                                <span className="font-semibold text-sm num" style={{ color: accentColor }}>R$ {formatBRL(calculateCartItemUnitPrice(item) * item.quantity)}</span>
                                            </span>
                                        ) : (
                                            <span className="font-semibold text-[var(--text)] text-sm num flex-shrink-0">R$ {formatBRL(calculateCartItemUnitPrice(item) * item.quantity)}</span>
                                        )}
                                    </div>
                                    {item.notes && <p className="text-[12px] text-[var(--text-muted)] mt-0.5 italic">"{item.notes}"</p>}

                                    <div className="flex justify-between items-center mt-2">
                                        <button onClick={() => onRemove(item)} className="text-[var(--err)]/60 hover:text-[var(--err)] p-1 u-motion rounded-[var(--r-sm)]">
                                            <Trash2 size={14}/>
                                        </button>
                                        <div className="flex items-center gap-2 bg-[var(--surface-2)] rounded-[var(--r-sm)] px-1.5 py-0.5 border border-[var(--border)]">
                                            <button onClick={() => onUpdateQty(item, -1)} className="min-w-11 min-h-11 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] u-motion"><Minus size={13}/></button>
                                            <span className="text-[13px] font-semibold text-[var(--text)] w-4 text-center num">{item.quantity}</span>
                                            <button onClick={() => onUpdateQty(item, 1)} className="min-w-11 min-h-11 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] u-motion"><Plus size={13}/></button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-4 border-t border-[var(--border)] bg-[var(--surface-2)] space-y-3">
                    <div className="flex justify-between items-center font-semibold text-[var(--text)]">
                        <span>Total</span>
                        <span className="num">R$ {formatBRL(total)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <Button variant="secondary" onClick={onClose} className="w-full">
                            Adicionar Mais
                        </Button>
                        <Button onClick={onConfirm} isLoading={isLoading} disabled={cart.length === 0} className="w-full">
                            Confirmar Pedido
                        </Button>
                    </div>
                </div>
        </BottomSheet>
    );
}

const BillSplitter: React.FC<{ isOpen: boolean, onClose: () => void, tableId: string, storeId: string, clientName: string, isWaitingBill: boolean, currentStore: Store | null, currentTable: Table | null, requestBillOnOpen?: boolean }> = ({ isOpen, onClose, tableId, storeId, clientName, isWaitingBill, currentStore, currentTable, requestBillOnOpen = false }) => {
    // Lojas `direct_print` (ex.: Sertão) não têm KDS — status por item
    // (Enviado/Aceito/Preparando/Pronto) nunca reflete a realidade nesse
    // fluxo, mesmo achado do OrderProgressView (achado real, WhatsApp do
    // Ramon 2026-08-24).
    const orderFlow = resolveOrderFlow(currentStore);
    const [tab, setTab] = useState<'split' | 'users' | 'calculator'>('split');
    const [people, setPeople] = useState(1);
    const [total, setTotal] = useState(0);
    const [items, setItems] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [waiterRequested, setWaiterRequested] = useState(false);

    // Calculator State
    const [selectedItems, setSelectedItems] = useState<{ [itemId: string]: number }>({});

    // Request Bill State
    const [showCloseConfirmation, setShowCloseConfirmation] = useState(false);
    const [isClosing, setIsClosing] = useState(false);

    const [serviceFee, setServiceFee] = useState(0);
    const [subtotal, setSubtotal] = useState(0);
    const [isServiceFeeEnabled, setIsServiceFeeEnabled] = useState(false);
    const [serviceFeeRate, setServiceFeeRate] = useState(SERVICE_FEE_RATE);
    // Task 3: distingue "a loja nunca cobra" de "a loja cobra, mas foi
    // removida desta mesa" (`tables.service_fee_removed`, direito do
    // cliente, nunca reativável por esta tela) — os dois têm o mesmo efeito
    // no total (isServiceFeeEnabled=false), mas o texto explicativo precisa
    // ser diferente pra não sugerir que a remoção nunca aconteceu.
    const [isServiceFeeRemovedForTable, setIsServiceFeeRemovedForTable] = useState(false);

    // Defesa extra pro achado C2 da revisão final (2026-08-16): desde que
    // Modal variant="sheet" ficou montado durante a animação de saída em vez
    // de desmontar, o estado interno do BillSplitter não reseta mais sozinho
    // entre um "fechar" e o próximo "abrir" — cobre qualquer caminho de
    // fechamento (não só handleRequestBill, que já reseta showCloseConfirmation
    // direto) e também tab/people/selectedItems (achado M4, mesma causa raiz),
    // que sem isso reabriam na aba/estado da visita anterior.
    useEffect(() => {
        if (!isOpen) {
            setShowCloseConfirmation(false);
            setTab('split');
            setPeople(1);
            setSelectedItems({});
        }
    }, [isOpen]);

    // Task 4: entrada rápida vinda do controle do hero ("Pedir a conta"
    // quando a sessão tem pedido em aberto) — pula direto pra esta mesma
    // tela de confirmação, sem duplicar handleRequestBill/requestTableBill.
    // Guard `!isWaitingBill`: se a conta já foi pedida, não faz sentido
    // reabrir "Deseja realmente pedir a conta?" — o próprio conteúdo normal
    // do modal já mostra "Conta Solicitada. Aguarde o garçom." nesse caso.
    // Guard `!isLoading` (achado da revisão final, 2026-08-22): `loadBill`
    // ainda está em voo no primeiro paint (`isLoading` começa `true`), então
    // sem este guard a tela de confirmação abria ANTES de `items` chegar —
    // `hasPendingItems` calculava `false` sobre uma lista vazia, o bloco
    // `!hasPendingItems` (abaixo) renderizava com um único botão ("Sim,
    // Fechar Conta"), e no instante seguinte, quando `loadBill` resolvia com
    // itens pendentes de verdade, o layout virava pra dois botões com o
    // destrutivo ("Cancelar Pendentes e Fechar", `variant="danger"`) no
    // topo — exatamente onde o botão seguro acabara de estar. Esse atalho
    // (Task 4) é o único caminho novo que abre esta confirmação com
    // `isLoading` ainda `true`; pelo footer normal (`!isLoading` já
    // filtrava a renderização de quem chamava) essa janela nunca existiu.
    useEffect(() => {
        if (isOpen && !isLoading && requestBillOnOpen && !isWaitingBill) {
            setShowCloseConfirmation(true);
        }
    }, [isOpen, isLoading, requestBillOnOpen, isWaitingBill]);

    useEffect(() => {
        // Modal (variant="sheet") agora fica montado durante a animação de
        // saída (~0.4s) — sem esse guard, fechar a comanda continuaria
        // buscando dado e mantendo a assinatura realtime aberta enquanto o
        // cliente nem está mais olhando a comanda, e reabrir não reiniciaria
        // a busca (o efeito só roda de novo quando as deps mudam). Fecha a
        // assinatura (via cleanup) quando isOpen vira false, e só busca/
        // assina de novo quando volta a ficar true.
        if (!isOpen) return;

        const loadBill = async () => {
            setIsLoading(true);
            const data = await fetchTableOrderSummary(tableId);

            // Fetch fresh table and store data to ensure we have the latest config.
            // RPC nunca inclui `pin` — antes disso o select('*') direto vazava o PIN
            // da mesa pra qualquer convidado que abrisse "Dividir Conta".
            const { data: tableData } = await supabase.rpc('get_table_public_by_id_secure', { p_table_id: tableId });
            let storeConfig = currentStore?.config;
            if (tableData?.store_id) {
                const { data: storeData } = await supabase.from('stores').select('config').eq('id', tableData.store_id).single();
                if (storeData) storeConfig = storeData.config;
            }

            // Calculate service fee
            const isFeeEnabled = !!(storeConfig?.charge_service_fee && !tableData?.service_fee_removed);
            const feeRate = storeConfig?.service_fee_rate ?? SERVICE_FEE_RATE;
            const calculatedSubtotal = data.total;
            const calculatedServiceFee = isFeeEnabled ? calculateServiceFee(calculatedSubtotal, feeRate) : 0;

            setSubtotal(calculatedSubtotal);
            setServiceFee(calculatedServiceFee);
            setTotal(calculateOrderTotal(calculatedSubtotal, isFeeEnabled, feeRate));
            setIsServiceFeeEnabled(isFeeEnabled);
            setIsServiceFeeRemovedForTable(!!(storeConfig?.charge_service_fee && tableData?.service_fee_removed));
            setServiceFeeRate(feeRate);

            setItems(data.items);
            setIsLoading(false);
        };
        loadBill();

        const channel = supabase.channel(`bill_${tableId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'order_change_pings', filter: `store_id=eq.${storeId}` }, () => loadBill())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'table_change_pings', filter: `table_id=eq.${tableId}` }, () => loadBill())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'stores', filter: `id=eq.${storeId}` }, () => loadBill())
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [tableId, storeId, isOpen]);

    const handleCallWaiter = async () => {
        try {
            // New signature only requires tableId
            await callWaiter(tableId);
            setWaiterRequested(true);
            setTimeout(() => setWaiterRequested(false), 5000);
        } catch (e: any) {
            toast.error(e.message || "Erro ao chamar garçom.");
        }
    };

    const handleRequestBill = async () => {
        setIsClosing(true);
        try {
            await requestTableBill(tableId);
            toast.success("Conta solicitada com sucesso! O garçom trará a conta em instantes.");
            // Sem isso, o modal ficava montado (variant="sheet" não desmonta mais
            // pra poder animar a saída — ver o useEffect abaixo) com
            // showCloseConfirmation ainda true, e "Encerrar Mesa" (isOpen
            // hardcoded true) reaparecia sozinho por cima de tudo depois do
            // sucesso. Ver achado C2 da revisão final de 2026-08-16.
            setShowCloseConfirmation(false);
            onClose();
        } catch (e) {
            toast.error("Erro ao solicitar conta.");
            console.error(e);
        } finally {
            setIsClosing(false);
        }
    };

    const getItemStatusBadge = (status: string) => {
        switch (status) {
            case 'pending': return <span className="flex items-center gap-1 text-[10px] bg-[var(--warn)]/10 text-[var(--warn)] px-1.5 py-0.5 rounded border border-[var(--warn)]/20"><Clock size={10}/> Enviado</span>;
            case 'accepted': return <span className="flex items-center gap-1 text-[10px] bg-[var(--warn)]/15 text-[var(--warn)] px-1.5 py-0.5 rounded border border-[var(--warn)]/25"><ChefHat size={10}/> Aceito</span>;
            case 'preparing': return <span className="flex items-center gap-1 text-[10px] bg-[var(--info)]/10 text-[var(--info)] px-1.5 py-0.5 rounded border border-[var(--info)]/20"><UtensilsCrossed size={10}/> Prep.</span>;
            case 'ready': return <span className="flex items-center gap-1 text-[10px] bg-[var(--ok)]/10 text-[var(--ok)] px-1.5 py-0.5 rounded border border-[var(--ok)]/20"><BellRing size={10}/> Pronto</span>;
            case 'delivered': return <span className="flex items-center gap-1 text-[10px] bg-[var(--surface-2)] text-[var(--text-muted)] px-1.5 py-0.5 rounded border border-[var(--border)]"><CheckCircle size={10}/> Entregue</span>;
            default: return null;
        }
    };

    // --- Helper for 'Users' Tab ---
    const usersBreakdown = useMemo(() => {
        const breakdown: { [name: string]: { subtotal: number, serviceFee: number, total: number, items: any[] } } = {};

        items.forEach(item => {
            // Regex to extract [Name] from start of notes
            const match = item.notes ? item.notes.match(/^\[(.*?)\]/) : null;
            const userName = match ? match[1] : 'Mesa / Geral';

            if (!breakdown[userName]) {
                breakdown[userName] = { subtotal: 0, serviceFee: 0, total: 0, items: [] };
            }

            breakdown[userName].items.push(item);
            breakdown[userName].subtotal += (item.price_at_time * item.quantity);
        });

        Object.keys(breakdown).forEach(userName => {
            const userSubtotal = breakdown[userName].subtotal;
            breakdown[userName].serviceFee = isServiceFeeEnabled ? calculateServiceFee(userSubtotal, serviceFeeRate) : 0;
            breakdown[userName].total = calculateOrderTotal(userSubtotal, isServiceFeeEnabled, serviceFeeRate);
        });

        return breakdown;
    }, [items, isServiceFeeEnabled, serviceFeeRate]);

    // --- Helper for 'Calculator' Tab ---
    const toggleSelection = (itemId: string, maxQty: number) => {
        setSelectedItems(prev => {
            const current = prev[itemId] || 0;
            // If selected (any qty), unselect. If not, select full qty
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
        setSelectedItems(prev => {
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
        let sum = 0;
        items.forEach(item => {
            if (selectedItems[item.id]) {
                sum += (item.price_at_time * selectedItems[item.id]);
            }
        });
        return sum;
    }, [items, selectedItems]);

    const calculatorServiceFee = isServiceFeeEnabled ? calculateServiceFee(calculatorSubtotal, serviceFeeRate) : 0;
    const calculatorTotal = calculateOrderTotal(calculatorSubtotal, isServiceFeeEnabled, serviceFeeRate);

    // Task 3: quando a taxa NÃO está sendo cobrada nesta conta (loja nunca
    // cobra, ou cobra por padrão mas foi removida desta mesa específica —
    // `tables.service_fee_removed`, direito do cliente, nunca reativável
    // por esta tela), a linha antes simplesmente sumia — ambíguo pro
    // cliente ("pedi sem saber que ia pagar 10% a mais"). Sempre enuncia um
    // dos dois estados de desligada; o estado ligada continua com o texto
    // específico (valor + percentual) já existente em cada aba.
    const serviceFeeOffText = isServiceFeeRemovedForTable
        ? 'Taxa de serviço opcional removida nesta mesa'
        : 'Esta loja não cobra taxa de serviço';

    // --- RENDER MODALS ---

    if (showCloseConfirmation) {
        return (
             <Modal isOpen={true} onClose={() => setShowCloseConfirmation(false)} title="Encerrar Mesa">
                 <div className="space-y-6 text-center">
                     <div className="bg-[var(--warn)]/8 p-4 rounded-[var(--r-lg)] border border-[var(--warn)]/20 flex flex-col items-center">
                         <AlertCircle className="text-[var(--warn)] mb-2" size={32}/>
                         <p className="font-bold text-[var(--text)]">Deseja realmente pedir a conta?</p>
                         <p className="text-sm text-[var(--text-muted)] mt-1">Ao solicitar o fechamento, não será possível adicionar novos itens.</p>
                     </div>

                     {/* Pedido real do Ramon (WhatsApp, 2026-08-24): "não é pra ter essa
                         comunicação, tanto no cliente como na loja" — a trava de "itens
                         pendentes" (dois botões, um deles cancelando itens sem perguntar
                         de novo) foi removida. Pedir a conta agora é sempre uma única
                         confirmação simples, com a lista de itens pedidos — sem checar
                         status de preparo, que em lojas `direct_print` nunca reflete a
                         realidade de qualquer forma (ver OrderProgressView). */}
                     <div className="flex flex-col gap-3">
                         <Button
                            className="w-full h-12 text-lg"
                            onClick={() => handleRequestBill()}
                            isLoading={isClosing}
                        >
                            Sim, Fechar Conta
                        </Button>
                         <Button variant="secondary" onClick={() => setShowCloseConfirmation(false)}>
                             Voltar
                         </Button>
                     </div>
                 </div>
             </Modal>
        );
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Conta da Mesa" variant="sheet">
            <div className="space-y-4">
                {isLoading ? (
                    <div className="py-10 animate-pulse text-center text-[var(--brand)]">Carregando conta...</div>
                ) : (
                    <>
                        {/* Tabs */}
                        <div className="flex p-1 bg-[var(--surface-2)] rounded-[var(--r-md)]">
                            <button onClick={() => setTab('split')} className={`flex-1 py-2 text-xs font-bold rounded-[var(--r-sm)] u-motion u-press-sm flex flex-col items-center gap-1 ${tab === 'split' ? 'bg-[var(--surface)] text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)]'}`}>
                                <Users size={16}/> Divisão
                            </button>
                            <button onClick={() => setTab('users')} className={`flex-1 py-2 text-xs font-bold rounded-[var(--r-sm)] u-motion u-press-sm flex flex-col items-center gap-1 ${tab === 'users' ? 'bg-[var(--surface)] text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)]'}`}>
                                <List size={16}/> Por Cliente
                            </button>
                            <button onClick={() => setTab('calculator')} className={`flex-1 py-2 text-xs font-bold rounded-[var(--r-sm)] u-motion u-press-sm flex flex-col items-center gap-1 ${tab === 'calculator' ? 'bg-[var(--surface)] text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)]'}`}>
                                <Calculator size={16}/> Calculadora
                            </button>
                        </div>

                        {/* Content based on Tab */}
                        <div className="min-h-[250px] max-h-[50vh] overflow-y-auto">

                            {/* TAB 1: SPLIT BY PEOPLE */}
                            {tab === 'split' && (
                                <div className="space-y-6 animate-fade-in pt-2">
                                    <div className="bg-[var(--brand)]/5 p-4 rounded-[var(--r-lg)] border border-[var(--brand)]/10 text-center">
                                        <p className="text-sm text-[var(--text-muted)] uppercase font-bold tracking-wider">Total da Mesa</p>
                                        <p className="text-3xl font-black text-[var(--brand)] mt-1 num">R$ {formatBRL(total)}</p>
                                        {/* Guard `items.length > 0` no ramo desligado (achado da
                                            revisão final, 2026-08-22): esta aba mostrava
                                            `serviceFeeOffText` incondicionalmente, enquanto a aba
                                            "Por Cliente" (acima) já guardava a mesma frase em
                                            `items.length > 0` -- uma mesa vazia (R$ 0,00, nenhum
                                            pedido ainda) exibia "Esta loja não cobra taxa de
                                            serviço" embaixo de um total zerado, sem nenhum item que
                                            justificasse falar de taxa. Mesmo guard das duas abas
                                            agora. Ramo ligado (fee real cobrada) não muda: mostrar
                                            "Inclui R$ 0,00..." com a mesa ainda vazia não é a mesma
                                            ambiguidade que este achado aponta. */}
                                        {(isServiceFeeEnabled || items.length > 0) && (
                                            <p className="text-xs text-[var(--text-muted)] mt-1">
                                                {isServiceFeeEnabled
                                                    ? `Inclui R$ ${formatBRL(serviceFee)} de taxa de serviço (${formatServiceFeeRate(serviceFeeRate)} opcional)`
                                                    : serviceFeeOffText}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex items-center justify-center gap-6 py-2">
                                        <button onClick={() => setPeople(Math.max(1, people - 1))} className="w-10 h-10 bg-[var(--surface-2)] rounded-full flex items-center justify-center hover:bg-[var(--border)] u-motion u-press-sm"><Minus size={18} /></button>
                                        <div className="text-center min-w-[80px]">
                                            <span className="block text-2xl font-bold text-[var(--text)]">{people}</span>
                                            <span className="text-[10px] text-[var(--text-muted)] font-bold uppercase">Pessoas</span>
                                        </div>
                                        <button onClick={() => setPeople(people + 1)} className="w-10 h-10 bg-[var(--surface-2)] rounded-full flex items-center justify-center hover:bg-[var(--border)] u-motion u-press-sm"><Plus size={18}/></button>
                                    </div>
                                    <div className="border-t border-dashed border-[var(--border)] pt-4 text-center">
                                        <p className="text-[var(--text-muted)] text-sm mb-1">Valor por pessoa</p>
                                        <p className="text-2xl font-bold text-[var(--text)] num">R$ {formatBRL(total / people)}</p>
                                    </div>
                                    {/* List All Items for Context */}
                                    <div className="mt-4 pt-4 border-t border-[var(--border)]">
                                        <p className="text-xs text-[var(--text-muted)] font-bold uppercase mb-2">Itens da Mesa</p>
                                        <ul className="text-sm space-y-1 text-[var(--text-muted)]">
                                            {items.map((it, idx) => (
                                                <li key={idx} className="flex justify-between items-center py-1">
                                                    <div className="flex items-center gap-2">
                                                        <span>{it.quantity}x {getOrderItemDisplayName(it)}</span>
                                                        {orderFlow !== 'direct_print' && getItemStatusBadge(it.status)}
                                                    </div>
                                                    <span>{formatBRL(it.price_at_time * it.quantity)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                            )}

                            {/* TAB 2: BY USER */}
                            {tab === 'users' && (
                                <div className="space-y-4 animate-fade-in pt-2">
                                    {/* Task 3: uma nota só (não por cartão de pessoa, que
                                        repetiria a mesma frase N vezes) quando a taxa não
                                        está sendo cobrada nesta conta. */}
                                    {!isServiceFeeEnabled && items.length > 0 && (
                                        <p className="text-xs text-[var(--text-muted)] px-1">{serviceFeeOffText}</p>
                                    )}
                                    {Object.entries(usersBreakdown).map(([name, data]: [string, any]) => (
                                        <div key={name} className="border border-[var(--border)] rounded-[var(--r-lg)] overflow-hidden">
                                            <div className="bg-[var(--surface-2)] p-3 flex justify-between items-center border-b border-[var(--border)]">
                                                <span className="font-bold text-[var(--text)] flex items-center gap-2"><User size={14}/> {name}</span>
                                                <span className="font-bold text-[var(--brand)] num">R$ {formatBRL(data.total)}</span>
                                            </div>
                                            <div className="p-2 space-y-1">
                                                {data.items.map((it: any) => (
                                                    <div key={it.id} className="flex justify-between items-center text-xs text-[var(--text-muted)] px-2 py-1">
                                                        <div className="flex items-center gap-1.5">
                                                            {orderFlow !== 'direct_print' && getItemStatusBadge(it.status)}
                                                            <span>{it.quantity}x {getOrderItemDisplayName(it)}</span>
                                                        </div>
                                                        <span className="num">{formatBRL(it.price_at_time * it.quantity)}</span>
                                                    </div>
                                                ))}
                                                {isServiceFeeEnabled && (
                                                    <div className="flex justify-between items-center text-xs text-[var(--text-muted)] px-2 py-1 border-t border-[var(--border)] mt-1 pt-1">
                                                        <span>Taxa de Serviço ({formatServiceFeeRate(serviceFeeRate)})</span>
                                                        <span className="num">{formatBRL(data.serviceFee)}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {items.length === 0 && <p className="text-center text-[var(--text-muted)]">Nenhum pedido realizado.</p>}
                                </div>
                            )}

                            {/* TAB 3: CALCULATOR */}
                            {tab === 'calculator' && (
                                <div className="space-y-2 animate-fade-in pt-2">
                                    <div className="bg-[var(--info)]/8 p-3 rounded-[var(--r-md)] text-xs text-[var(--info)] mb-2">
                                        Selecione os itens que você vai pagar para calcular seu subtotal.
                                    </div>
                                    {items.map(item => {
                                        const isSelected = !!selectedItems[item.id];
                                        const selectedQty = selectedItems[item.id] || 0;

                                        return (
                                            <div key={item.id} onClick={() => toggleSelection(item.id, item.quantity)} className={`flex items-center gap-3 p-3 rounded-[var(--r-lg)] border transition-all cursor-pointer u-motion ${isSelected ? 'border-[var(--brand)] bg-[var(--brand)]/5' : 'border-[var(--border)] bg-[var(--surface)]'}`}>
                                                <div className={`text-[var(--brand)] ${isSelected ? 'opacity-100' : 'opacity-30'}`}>
                                                    {isSelected ? <CheckSquare size={20}/> : <Square size={20}/>}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex justify-between items-start">
                                                        <span className={`text-sm font-bold ${isSelected ? 'text-[var(--brand)]' : 'text-[var(--text-muted)]'}`}>
                                                            {getOrderItemDisplayName(item)}
                                                        </span>
                                                        <span className="text-sm font-medium num">R$ {formatBRL(item.price_at_time)}</span>
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
                                </div>
                            )}
                        </div>

                        {/* FOOTER ACTIONS */}
                        <div className="pt-2 border-t border-[var(--border)] space-y-3">
                            {tab === 'calculator' ? (
                                <div className="flex flex-col bg-[var(--ink)] text-white p-4 rounded-[var(--r-lg)]">
                                    <div className="flex justify-between items-center">
                                        <span className="font-bold">Total Selecionado</span>
                                        <span className="font-black text-xl num">R$ {formatBRL(calculatorTotal)}</span>
                                    </div>
                                    <div className="text-xs text-white/50 mt-1 text-right">
                                        {isServiceFeeEnabled
                                            ? `Inclui R$ ${formatBRL(calculatorServiceFee)} de taxa de serviço (${formatServiceFeeRate(serviceFeeRate)} opcional)`
                                            : serviceFeeOffText}
                                    </div>
                                </div>
                            ) : (
                                !isWaitingBill && (
                                    <Button
                                        className="w-full gap-2"
                                        onClick={() => setShowCloseConfirmation(true)}
                                    >
                                        <Receipt size={18} /> Pedir Conta (Bloquear Mesa)
                                    </Button>
                                )
                            )}

                            {isWaitingBill && (
                                <div className="bg-[var(--warn)]/10 text-[var(--warn)] p-3 rounded-[var(--r-md)] text-center font-bold text-sm flex items-center justify-center gap-2">
                                    <Clock size={16}/> Conta Solicitada. Aguarde o garçom.
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-3">
                                <Button
                                    variant="secondary"
                                    className={`gap-2 ${waiterRequested ? 'text-[var(--ok)] bg-[var(--ok)]/8 border border-[var(--ok)]/20' : ''}`}
                                    onClick={handleCallWaiter}
                                    disabled={waiterRequested}
                                >
                                    {waiterRequested ? <BellRing size={18}/> : <Bell size={18}/>}
                                    {waiterRequested ? 'Chamado!' : 'Garçom'}
                                </Button>
                                <Button variant="outline" onClick={onClose}>Voltar</Button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
}

// Endereço da loja no cartão do hero (redesign iFood, item 3/2026-08-21):
// `store_fiscal_config` guarda os campos `endereco_*` em CAIXA ALTA sem
// acento (dado fiscal, não pensado pra exibição — ver AGENTS.md,
// "Configuração do emissor fiscal"). Este helper só normaliza capitalização
// (Title Case, com preposições curtas em minúsculo pra ler como endereço de
// verdade, e tokens tipo "S/N" preservados em maiúsculo) — NÃO tenta
// restaurar acentuação perdida (ex.: "SAO JOAO" nunca vira "São João" sem
// um dicionário; fora de escopo aqui, registrado no relatório desta task).
const ADDRESS_LOWERCASE_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
function titleCaseAddress(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map((word, i) => {
            if (!word) return word;
            if (i > 0 && ADDRESS_LOWERCASE_WORDS.has(word)) return word;
            // "s/n" (sem número) — mantém maiúsculo, não é uma palavra normal.
            if (/^[a-z]\/[a-z]$/i.test(word)) return word.toUpperCase();
            return word[0].toUpperCase() + word.slice(1);
        })
        .join(' ');
}

// Linha curta (bairro, cidade/UF) — a que aparece SEMPRE visível no cartão,
// logo abaixo do nome da loja. `null` quando não há dado nenhum pra compor
// (config nunca configurada, ou os 3 campos usados aqui vazios) — o card
// nunca mostra placeholder/texto inventado nesse caso.
function composeStoreAddressLine(config: StoreFiscalConfig | null): string | null {
    if (!config) return null;
    const bairro = config.endereco_bairro?.trim();
    const cidade = config.endereco_cidade?.trim();
    const uf = config.endereco_uf?.trim();
    const parts: string[] = [];
    if (bairro) parts.push(titleCaseAddress(bairro));
    const cityUf = [cidade ? titleCaseAddress(cidade) : null, uf ? uf.toUpperCase() : null]
        .filter((v): v is string => !!v)
        .join('/');
    if (cityUf) parts.push(cityUf);
    return parts.length > 0 ? parts.join(', ') : null;
}

// Endereço completo (logradouro + número + a linha curta acima) — só
// aparece quando o cliente expande a linha do nome da loja (item 2).
function composeFullStoreAddress(config: StoreFiscalConfig | null): string | null {
    if (!config) return null;
    const logradouro = config.endereco_logradouro?.trim();
    const numero = config.endereco_numero?.trim();
    const street = [logradouro ? titleCaseAddress(logradouro) : null, numero ? titleCaseAddress(numero) : null]
        .filter((v): v is string => !!v)
        .join(', ');
    const rest = composeStoreAddressLine(config);
    const full = [street, rest].filter(Boolean).join(' - ');
    return full || null;
}

export const ClientModule: React.FC<{ slug: string }> = ({ slug }) => {
    const [hasAccess, setHasAccess] = useState(false);
    const [categories, setCategories] = useState<Category[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [activeCategory, setActiveCategory] = useState<string>('');

    // Vende mais II (migration 020): "mais vendido" automático (via RPC
    // get_bestseller_product_ids, só quando a loja liga
    // config.show_bestsellers) e favoritos (100% client-side, localStorage,
    // sem coluna/RPC nenhuma — ver efeitos abaixo).
    const [bestsellerIds, setBestsellerIds] = useState<Set<string>>(new Set());
    const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
    const [favoritesOnly, setFavoritesOnly] = useState(false);

    // Cardapio por horario/turno (migration 018): `scheduleNow` tickando a
    // cada minuto forca reavaliar `isCategoryAvailableNow` mesmo sem
    // nenhuma outra mudanca de estado — sem isso, uma categoria que sai da
    // janela de horario no meio da visita do cliente (ex: relogio virou
    // 11h01 com "Cafe da Manha" ja selecionada) so sumiria depois de um F5.
    const [scheduleNow, setScheduleNow] = useState(() => new Date());
    useEffect(() => {
        const interval = setInterval(() => setScheduleNow(new Date()), 60 * 1000);
        return () => clearInterval(interval);
    }, []);

    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [showBill, setShowBill] = useState(false);
    // Task 4: quando o controle do hero abre a Conta a partir do estado
    // "Pedir a conta" (pedido em aberto), pula direto pra tela de
    // confirmação que já existe dentro do BillSplitter — mesma ação
    // (handleRequestBill/requestTableBill) que "Pedir Conta (Bloquear
    // Mesa)" já dispara lá dentro, só entrando por um atalho. Reseta ao
    // fechar a Conta por qualquer caminho, pra nunca reabrir direto na
    // confirmação da próxima vez que a Conta for aberta pelo botão normal.
    const [billRequestIntent, setBillRequestIntent] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    // Ref pro input de busca da barra sticky (Task hero item 5): o botão de
    // lupa sobre a capa não abre uma busca própria, só rola até essa mesma
    // barra e foca este input — nunca um segundo mecanismo de busca.
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [isLoading, setIsLoading] = useState(false);
    const isSubmittingOrderRef = useRef(false);

    // Cartão da loja no hero (redesign iFood, item 2/3/2026-08-21): endereço
    // fiscal (`store_fiscal_config`, mesma tabela/função já usada pelo
    // Master Admin/lojista pra configuração fiscal — nunca uma query nova)
    // e o estado de expandir/recolher a linha do nome pra revelar o
    // endereço completo. Não existe tela de "informações da loja" nesta
    // versão do app — em vez de linkar pra uma rota inexistente, a própria
    // linha do nome expande em lugar (ver JSX do hero).
    const [fiscalConfig, setFiscalConfig] = useState<StoreFiscalConfig | null>(null);
    const [storeInfoExpanded, setStoreInfoExpanded] = useState(false);

    // New States
    const [showPin, setShowPin] = useState(false);
    const [hostPin, setHostPin] = useState<string | null>(null);
    // Discrimina "loja não existe" de "erro de rede/timeout" (achado de UX #4)
    // — antes um único boolean `storeNotFound` misturava os dois casos.
    const [loadError, setLoadError] = useState<'not_found' | 'network' | null>(null);
    // Só vira false depois que fetchMenu resolve (sucesso ou erro) — evita que
    // "Nenhum produto encontrado" pisque antes do cardápio carregar (achado de
    // UX #6, race entre `products` ainda vazio e o fetch em andamento).
    const [isLoadingMenu, setIsLoadingMenu] = useState(true);
    const [sortBy, setSortBy] = useState<'default' | 'price_asc' | 'price_desc' | 'name_asc'>('default');
    const [sortMenuOpen, setSortMenuOpen] = useState(false);
    const [isCartOpen, setIsCartOpen] = useState(false);

    // Task 3 (tabs fixas + scroll-spy, substitui o acordeão): `activeCategory`
    // agora representa a TAB ativa, não mais "categoria expandida" — sempre
    // aponta pra uma categoria visível (nunca fica vazia com o cardápio
    // carregado, ver efeito logo abaixo de `visibleCategories`).
    const stickyBarRef = useRef<HTMLDivElement>(null);
    const [stickyOffset, setStickyOffset] = useState(0);
    const sortMenuRef = useRef<HTMLDivElement>(null);
    const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
    const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
    // Suprime a atualização do scroll-spy enquanto um scroll disparado por
    // clique numa tab está em curso — senão o observer muda a tab ativa no
    // meio da animação e a faixa de tabs "corre" visivelmente (hazard #1 do
    // brief). SEMPRE limpo por um timeout de segurança (ver handleTabClick),
    // nunca depende só do evento 'scrollend' — não pode travar pro resto da
    // sessão mesmo se o navegador não suportar o evento ou se a seção já
    // estiver visível (nenhum scroll acontece, nenhum 'scrollend' dispara).
    const isClickScrollingRef = useRef(false);
    const clickScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Cardápio livre, PIN só na primeira tentativa de adicionar item (ver
    // conversa com o usuário, 2026-08-14): antes o cardápio inteiro ficava
    // atrás do login; agora só a AÇÃO de adicionar ao carrinho é que exige
    // sessão. `pendingCartAction` guarda o que o cliente tentou fazer pra
    // completar sozinho assim que o PIN é validado.
    const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
    const [pendingCartAction, setPendingCartAction] = useState<(() => void) | null>(null);

    // Tracker State
    const [trackedOrderId, setTrackedOrderId] = useState<string | null>(null);
    const [isCounterConfirmOpen, setIsCounterConfirmOpen] = useState(false);
    // Pedidos enviados NESTA sessão de mesa (várias rodadas possíveis) --
    // não persiste em localStorage, mas é RESTAURADO a partir do banco pelo
    // bloco de AUTO-LOGIN (fetchTableOrderSummary) sempre que a mesa segue
    // OCCUPIED/WAITING_BILL. Deixou de ser "cosmético" em 2026-08-22: agora
    // alimenta `hasOpenTableOrders`, que decide entre "Sair"/"Pedir a conta"
    // no hero -- se ficasse vazio a cada F5 (celular trava, guia recarrega),
    // o cliente veria "Sair" de novo com conta em aberto, exatamente o que a
    // Task 4 existe pra evitar.
    const [mesaOrderIds, setMesaOrderIds] = useState<string[]>([]);
    // Residual da Task 4 (2026-08-22): se o fetch de restauração acima falhar
    // (rede instável, celular voltando de sinal fraco), `mesaOrderIds` fica
    // vazio -- mas a mesa continua OCCUPIED/WAITING_BILL de verdade, então
    // NÃO sabemos se há pedido em aberto, o que é diferente de "sabemos que
    // não há". Esse flag carrega exatamente essa incerteza (nunca é usado
    // pra inflar `mesaOrders`/contagem de itens -- não é um pedido falso,
    // é só um sinal de UI); ver `hasOpenTableOrders` abaixo, que o soma ao
    // gate por OR. Setado true só quando o fetch falha com a mesa nesse
    // estado; limpo (false) em qualquer fetch que resolva (com sucesso ou
    // não) a dúvida, pra não prender o cliente no fallback pro resto da
    // sessão.
    const [tableOrdersUnknown, setTableOrdersUnknown] = useState(false);
    const [isOrderStatusOpen, setIsOrderStatusOpen] = useState(false);

    const {
        clientName, setClientName,
        setCurrentStore, currentStore,
        setCurrentTable, currentTable, setCurrentTable: setGlobalTable,
        addToCart, removeFromCart, cart, clearCart,
        setIsHost, isHost
    } = useApp();

    const { orders: mesaOrders, latest: latestMesaOrder } = useMesaOrders(currentStore?.id, mesaOrderIds);
    useWatchingPresence(currentStore?.id, currentTable?.id, isOrderStatusOpen);

    // Carrega loja + cardápio. Extraído do useEffect pra poder ser reusado pelo
    // botão "Tentar de novo" da tela de erro de conexão (achado de UX #4).
    const loadStoreAndMenu = useCallback(async () => {
        if (!slug) return;
        setLoadError(null);
        setIsLoadingMenu(true);

        const { store, error: storeError } = await fetchStoreBySlug(slug);
        if (!store) {
            setLoadError(storeError === 'network' ? 'network' : 'not_found');
            setIsLoadingMenu(false);
            return;
        }
        setCurrentStore(store);

        // "Mais vendido" (migration 020, Vende Mais II): opt-in por loja
        // (config.show_bestsellers), roda em paralelo (não é `await`ado) —
        // fetchBestsellerProductIds já nunca lança (devolve [] em erro), então
        // isso nunca atrasa nem quebra o carregamento do cardápio.
        if (store.config?.show_bestsellers) {
            fetchBestsellerProductIds(store.id).then(ids => setBestsellerIds(new Set(ids)));
        } else {
            setBestsellerIds(new Set());
        }

        // Pass TRUE to fetch only available products
        const { categories, products, error: menuError } = await fetchMenu(store.id, true);
        setCategories(categories);
        setProducts(products);
        // Acordeão (2026-08-15): cardápio abre com todas as categorias
        // recolhidas, nenhuma expandida por padrão — o cliente toca pra
        // abrir a que quiser (antes a 1a categoria disponível abria sozinha,
        // modelo de aba única que não existe mais).
        if (menuError) setLoadError('network');
        setIsLoadingMenu(false);
    }, [slug, setCurrentStore]);

    useEffect(() => {
        loadStoreAndMenu();
    }, [loadStoreAndMenu]);

    // Favoritos (Vende Mais II, 100% client-side): lido do localStorage uma
    // vez por loja (chave `fav_products_${storeId}`), assim que
    // currentStore.id fica disponível (troca de loja recarrega do zero).
    useEffect(() => {
        if (!currentStore?.id) return;
        try {
            const raw = localStorage.getItem(`fav_products_${currentStore.id}`);
            setFavoriteIds(new Set(raw ? JSON.parse(raw) : []));
        } catch {
            setFavoriteIds(new Set());
        }
    }, [currentStore?.id]);

    // Endereço da loja (hero item 3): reusa fetchStoreFiscalConfig, já
    // existente em lib/api.ts pro Master Admin/lojista — nenhuma query
    // nova. `null` é estado normal (loja nunca configurou o cadastro
    // fiscal), não erro; a linha de metadados só aparece quando há dado
    // real (ver composeStoreAddressLine acima).
    useEffect(() => {
        if (!currentStore?.id) { setFiscalConfig(null); return; }
        let cancelled = false;
        fetchStoreFiscalConfig(currentStore.id).then(cfg => {
            if (!cancelled) setFiscalConfig(cfg);
        });
        return () => { cancelled = true; };
    }, [currentStore?.id]);

    const toggleFavorite = useCallback((productId: string) => {
        setFavoriteIds(prev => {
            const next = new Set(prev);
            if (next.has(productId)) next.delete(productId); else next.add(productId);
            if (currentStore?.id) {
                try { localStorage.setItem(`fav_products_${currentStore.id}`, JSON.stringify(Array.from(next))); } catch {}
            }
            return next;
        });
    }, [currentStore?.id]);

    // Ref pro valor mais recente de `tableOrdersUnknown`, lido de dentro do
    // handler do canal realtime abaixo sem precisar entrar no array de
    // dependências do useEffect (que forçaria reinscrever o canal a cada
    // vez que a incerteza muda de estado -- mesmo padrão já usado em
    // `orderIdsRef` dentro de `useMesaOrders` acima).
    const tableOrdersUnknownRef = useRef(tableOrdersUnknown);
    tableOrdersUnknownRef.current = tableOrdersUnknown;

    // Realtime Table Status Listener — assina a tabela de ping (sem dado
    // sensivel) e busca o estado real via RPC segura, que nunca inclui `pin`.
    // Antes disso o listener usava payload.new direto: o pin da PROPRIA mesa
    // do cliente trafegava pela rede (carga do websocket) antes de ser
    // descartado no state, mesmo so' sendo usado por quem ja tinha acesso.
    useEffect(() => {
        if (currentTable) {
            const channel = supabase.channel(`table_status_${currentTable.id}`)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'table_change_pings', filter: `table_id=eq.${currentTable.id}` },
                async () => {
                    const { data } = await supabase.rpc('get_table_public_by_id_secure', { p_table_id: currentTable.id });
                    if (!data) return;
                    const newTable = data as Table;
                    setGlobalTable(newTable);

                    // If session closed, force logout
                    if(newTable.status === TableStatus.AVAILABLE) {
                         toast.info("A mesa foi fechada pelo restaurante. Obrigado!", 3000);
                         localStorage.removeItem(`session_${slug}`);
                         setTimeout(() => window.location.reload(), 2500);
                         return;
                    }

                    // Auto-cura de `tableOrdersUnknown` (achado da revisão final,
                    // 2026-08-22): antes desta correção, o flag só era ligado
                    // dentro do bloco de AUTO-LOGIN (uma vez por mount) e só era
                    // desligado por uma restauração bem-sucedida OU um pedido
                    // próprio bem-sucedido -- se nenhum dos dois acontecesse de
                    // novo (wifi de restaurante instável na primeira tentativa,
                    // cliente sem pressa pra pedir outra rodada), a incerteza
                    // durava pelo resto da vida da página, e com ela sumia a
                    // única saída (`handleLogout`) do hero -- só "Pedir a conta"
                    // ficava disponível, que trava a mesa inteira em
                    // `waiting_bill` se confirmado. Este handler já roda a cada
                    // ping realtime da mesa (mudança de status, pedido novo de
                    // QUALQUER dispositivo etc.), então é reaproveitado aqui pra
                    // tentar resolver a dúvida em segundo plano sem esperar
                    // reload ou pedido novo desta sessão -- sucesso resolve em
                    // segundos (o intervalo natural entre pings); falha
                    // simplesmente tenta de novo no próximo.
                    if (tableOrdersUnknownRef.current) {
                        const summary = await fetchTableOrderSummary(currentTable.id);
                        if (!summary.error) {
                            const restoredOrderIds = Array.from(new Set(
                                summary.items.map((item: any) => item.order_id).filter(Boolean)
                            )) as string[];
                            setMesaOrderIds(restoredOrderIds);
                            setTableOrdersUnknown(false);
                        }
                    }
                })
                .subscribe();

            return () => { supabase.removeChannel(channel); };
        }
    }, [currentTable?.id, setGlobalTable, slug]);

    // AUTO-LOGIN LOGIC (TRACKER REMOVED FROM HERE)
    useEffect(() => {
        const checkSession = async () => {
            if (!slug || !currentStore) return;

            const savedSession = localStorage.getItem(`session_${slug}`);
            if (savedSession) {
                try {
                    const session = JSON.parse(savedSession);
                    // Session is valid for 4 hours
                    if (Date.now() - session.timestamp < 4 * 60 * 60 * 1000) {
                        if (session.tableId) {
                            const tables = await fetchTablesPublic(currentStore.id);
                            const table = tables.find(t => t.id === session.tableId);

                            // Only auto-restore if table is still occupied by the same context
                            if (table && (table.status === TableStatus.OCCUPIED || table.status === TableStatus.WAITING_BILL)) {
                                // If I was the host, check if I am still the host
                                const isReturningHost = table.current_host_name?.toLowerCase() === session.name.toLowerCase();

                                setClientName(session.name);
                                setGlobalTable(table);
                                setIsHost(isReturningHost);
                                setHostPin(isReturningHost ? (session.hostPin ?? null) : null);
                                setHasAccess(true);

                                // Restaura mesaOrderIds a partir do banco (mesma RPC que já
                                // alimenta o BillSplitter, fetchTableOrderSummary/
                                // fetch_table_order_summary_secure) -- sem isso,
                                // hasOpenTableOrders voltava sempre `false` após qualquer
                                // reload, mesmo com pedido real e não pago na mesa (achado
                                // Critical da revisão da Task 4).
                                //
                                // Residual (2026-08-22): se ESTE fetch falhar (rede
                                // instável), `mesaOrderIds` ficaria vazio de novo com a
                                // mesa OCCUPIED/WAITING_BILL de verdade -- fail-open pro
                                // "Sair" exatamente no caso que a Task 4 existe pra
                                // fechar. `fetchTableOrderSummary` NUNCA rejeita a
                                // promise (ela mesma engole o erro do `.rpc()` e devolve
                                // `{ total: 0, items: [] }` -- comportamento antigo,
                                // preservado pros outros chamadores/BillSplitter); por
                                // isso o sinal de falha real é o campo `error` que ela
                                // agora expõe, não uma exceção -- o catch aqui só cobre
                                // um throw inesperado (defensivo, não é o caminho normal
                                // de falha de rede). Sucesso restaura os ids normalmente
                                // E resolve a dúvida (`tableOrdersUnknown = false`); falha
                                // não injeta id nenhum falso em `mesaOrderIds` (isso
                                // vazaria pra "Comanda aberta • N itens"/BillSplitter) --
                                // em vez disso liga o flag de incerteza, que por si só já
                                // empurra o hero pra "Pedir a conta" via
                                // `hasOpenTableOrders` abaixo.
                                try {
                                    const summary = await fetchTableOrderSummary(table.id);
                                    if (summary.error) {
                                        setTableOrdersUnknown(true);
                                    } else {
                                        const restoredOrderIds = Array.from(new Set(
                                            summary.items.map((item: any) => item.order_id).filter(Boolean)
                                        )) as string[];
                                        setMesaOrderIds(restoredOrderIds);
                                        setTableOrdersUnknown(false);
                                    }
                                } catch (fetchErr) {
                                    console.error("Falha ao restaurar pedidos da mesa", fetchErr);
                                    setTableOrdersUnknown(true);
                                }
                            } else {
                                // Table closed or reset, clear session
                                localStorage.removeItem(`session_${slug}`);
                            }
                        } else if (session.mode === 'counter') {
                            setClientName(session.name);
                            setGlobalTable(null);
                            setIsHost(true);
                            setHasAccess(true);
                        }
                    }
                } catch (e) {
                    console.error("Erro ao recuperar sessão", e);
                }
            }
        };
        checkSession();
    }, [slug, currentStore]);

    const handleLogin = async (name: string, tableId: string | null, isHostResult?: boolean, table?: Table | null) => {
        setClientName(name);
        if (!currentStore) return;

        // A validação de PIN e a decisão de quem é host já aconteceram no
        // servidor (LoginScreen.handleEnter -> openTableSession RPC); aqui só
        // gravamos o resultado no estado.
        let hostStatus = false;

        if (tableId) {
            setGlobalTable(table ?? null);
            hostStatus = !!isHostResult;
        } else {
            // Counter Login
            setGlobalTable(null);
            hostStatus = true; // Always host of your own counter order
        }

        setIsHost(hostStatus);
        setHostPin(tableId && hostStatus && table ? table.pin : null);
        setHasAccess(true);

        // SAVE SESSION
        localStorage.setItem(`session_${slug}`, JSON.stringify({
            name,
            tableId,
            mode: tableId ? 'table' : 'counter',
            timestamp: Date.now(),
            hostPin: tableId && hostStatus && table ? table.pin : null,
        }));

        // Login disparado a partir de uma tentativa de adicionar item (ver
        // requestAccessThen abaixo): fecha o modal e completa sozinho a ação
        // que ficou pendente, sem o cliente precisar repetir o toque.
        setIsLoginModalOpen(false);
        if (pendingCartAction) {
            pendingCartAction();
            setPendingCartAction(null);
        }
    };

    // Gate de acesso movido pra hora da ação (2026-08-14): navegar pelo
    // cardápio é livre; só a primeira tentativa de adicionar item ao
    // carrinho pede nome+mesa+PIN. Com sessão já aberta, executa na hora;
    // sem sessão, guarda a ação e abre o modal — handleLogin completa ela
    // sozinho ao validar o PIN.
    const requestAccessThen = (action: () => void) => {
        if (hasAccess) {
            action();
        } else {
            setPendingCartAction(() => action);
            setIsLoginModalOpen(true);
        }
    };

    const handleLogout = async (force = false) => {
        if(force || await confirm("Deseja realmente sair? Se você for o anfitrião, a mesa continuará aberta.")) {
            localStorage.removeItem(`session_${slug}`);
            setTrackedOrderId(null);
            setMesaOrderIds([]);
            setTableOrdersUnknown(false);
            setIsOrderStatusOpen(false);

            setHasAccess(false);
            setClientName('');
            setGlobalTable(null);
            clearCart();
        }
    };

    const handleSendOrder = () => {
        // If Counter, show alert first
        if (!currentTable) {
             setIsCounterConfirmOpen(true);
             setIsCartOpen(false); // Close cart modal to show alert
        } else {
            // If Table, proceed normally
            submitOrder();
        }
    };

    const submitOrder = async () => {
        if (!currentStore) return;
        // Guard síncrono contra duplo clique — setIsLoading só reflete no DOM
        // no próximo render, então a janela entre 2 cliques rápidos precisa
        // de um valor checado/setado na hora, não só de estado React.
        if (isSubmittingOrderRef.current) return;
        isSubmittingOrderRef.current = true;
        setIsLoading(true);
        try {
            const tableId = currentTable ? currentTable.id : null;
            const result = await createOrder(tableId, currentStore.id, cart, clientName, 'cliente');

            if (result.success) {
                 clearCart();
                 setIsCartOpen(false);

                 // If Counter, start tracking (NO PERSISTENCE)
                 if (!currentTable && result.orderId) {
                     setTrackedOrderId(result.orderId);
                     setIsCounterConfirmOpen(false); // Close the counter alert
                 } else {
                     if (result.orderId) setMesaOrderIds(prev => [...prev, result.orderId!]);
                     // Um pedido próprio bem-sucedido já resolve qualquer incerteza
                     // anterior sobre "há pedido em aberto" -- não precisa esperar
                     // outro fetch de restauração pra limpar o fallback.
                     setTableOrdersUnknown(false);
                     toast.success('Pedido enviado para a cozinha!');
                 }
            }
        } catch (e: any) {
            console.error(e);
            toast.error('Erro ao enviar pedido: ' + (e.message || 'Tente novamente.'));
        } finally {
            setIsLoading(false);
            isSubmittingOrderRef.current = false;
        }
    };

    const handleResetTracker = () => {
         setTrackedOrderId(null);
         // Maintain session logged in
    };

    const cartTotal = calculateCartTotal(cart);

    // Cardapio por horario/turno (migration 018): categoria fora da janela
    // configurada simplesmente some da barra — mesmo comportamento que
    // produto com available=false ja tem hoje (some inteiro, nao fica
    // desabilitada visivel). `scheduleNow` como dependencia garante que isso
    // reavalia sozinho conforme o relogio passa, sem precisar de F5.
    const visibleCategories = useMemo(
        () => categories.filter(cat => isCategoryAvailableNow(cat, scheduleNow)),
        [categories, scheduleNow]
    );

    // Task 3: tabs fixas substituem o acordeão — sempre existe uma tab ativa
    // (nunca "nada aberto"). No primeiro paint, `activeCategory` começa ''
    // (nenhuma tab bate), e este efeito a define pra primeira categoria
    // visível assim que o cardápio carrega. Se a categoria ativa deixar de
    // estar disponível (relógio virou durante a visita, ver
    // isCategoryAvailableNow), cai pra primeira categoria ainda disponível
    // em vez de ficar sem nenhuma tab ativa.
    useEffect(() => {
        if (visibleCategories.length === 0) {
            if (activeCategory !== '') setActiveCategory('');
            return;
        }
        if (!visibleCategories.some(c => c.id === activeCategory)) {
            setActiveCategory(visibleCategories[0].id);
        }
    }, [visibleCategories, activeCategory]);

    // Busca/favoritos filtram os produtos DENTRO de cada categoria (não mais
    // uma lista única da categoria ativa) — cada categoria do acordeão pega
    // sua fatia daqui. `sortBy` também é aplicado por categoria: "menor
    // preço primeiro" faz sentido dentro de uma seção, não faria sentido
    // comparar entre seções diferentes.
    const productsByCategory = useMemo(() => {
        // Achado real (reunião com o Ramon, 2026-08-25): buscar "muqueca" sem
        // o acento não encontrava "Moqueca" cadastrado com acento.
        // normalizeForSearch (lib/search.ts) remove diacríticos dos dois
        // lados antes de comparar.
        const term = normalizeForSearch(searchTerm.trim());
        const map: Record<string, Product[]> = {};
        visibleCategories.forEach(cat => {
            let prods = products.filter(p => p.category_id === cat.id);
            if (term) {
                // Busca por descrição (migration 019): além do nome, também bate se
                // o termo aparecer na descrição do produto (campo opcional).
                prods = prods.filter(p => normalizeForSearch(p.name).includes(term) || (p.description && normalizeForSearch(p.description).includes(term)));
            }
            if (favoritesOnly) prods = prods.filter(p => favoriteIds.has(p.id));

            // getEffectivePrice (migration 019): produto com promoção ativa
            // ordena pelo preço que o cliente realmente paga, não o cheio.
            if (sortBy === 'price_asc') prods = [...prods].sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b));
            else if (sortBy === 'price_desc') prods = [...prods].sort((a, b) => getEffectivePrice(b) - getEffectivePrice(a));
            else if (sortBy === 'name_asc') prods = [...prods].sort((a, b) => a.name.localeCompare(b.name));

            map[cat.id] = prods;
        });
        return map;
    }, [products, visibleCategories, searchTerm, sortBy, favoritesOnly, favoriteIds]);

    // Com busca ou filtro de favoritos ativo, a faixa de tabs some e só as
    // seções com resultado renderizam (Task 3) — sem o "abrir categoria"
    // do acordeão antigo, todas as seções já estão sempre empilhadas.
    const hasActiveFilter = !!searchTerm.trim() || favoritesOnly;

    // Vitrine de destaques (migration 019): produtos featured=true, respeitando
    // a mesma janela de horário/dia de categoria que o resto do cardápio já
    // respeita (visibleCategories == isCategoryAvailableNow). Produto órfão
    // (sem categoria) não tem restrição de horário nenhuma, então continua
    // visível. `products` já vem só com available=true (fetchMenu(store.id,
    // true)), não precisa refiltrar disponibilidade de estoque aqui.
    const featuredProducts = useMemo(
        () => products.filter(p => p.featured && (p.category_id == null || visibleCategories.some(c => c.id === p.category_id))),
        [products, visibleCategories]
    );

    // Achado da varredura (2026-07-07): mesmo Set usado pra "Peça também"
    // respeitar horário de categoria (ver ProductModal), sem repetir o
    // .some() de featuredProducts em cada render do modal.
    const visibleCategoryIds = useMemo(() => new Set(visibleCategories.map(c => c.id)), [visibleCategories]);

    // Precisa estar acima dos efeitos da barra fixa abaixo (Task 3), que
    // dependem dela pro offset `top-9`/`top-0` — movida pra cima do lugar
    // original (perto do JSX que a usa) porque hooks não podem referenciar
    // uma const declarada só depois deles no corpo do componente.
    const isWaitingBill = currentTable?.status === TableStatus.WAITING_BILL;

    // Task 3 — barra fixa (busca + tabs): mede a altura real ocupada pelo
    // chrome fixo (banner "Conta Solicitada" quando presente + a própria
    // barra) via `getComputedStyle(...).top` (reflete o `top-9`/`top-0` do
    // Tailwind sem repetir o número mágico 36px) + `offsetHeight`. Esse
    // valor vira tanto o `scroll-margin-top` de cada seção quanto a margem
    // do IntersectionObserver abaixo — nenhum cálculo manual de offset de
    // scroll é feito (a rolagem em si usa scrollIntoView + scroll-margin-top,
    // conforme o brief pede). ResizeObserver reage a qualquer mudança de
    // altura da barra (ex.: campo de busca quebrando linha em tela estreita);
    // as dependências extras forçam remedir quando a barra ganha/perde a
    // faixa de tabs ou muda de `top`.
    // `useLayoutEffect` (não `useEffect`): a medição precisa terminar ANTES
    // do browser pintar, senão `scroll-margin-top` fica `0` por um frame
    // (achado de code review) — como essa medição só lê/escreve DOM, sem
    // I/O nenhum, rodar sincronamente antes da pintura não tem custo
    // perceptível.
    useLayoutEffect(() => {
        const el = stickyBarRef.current;
        if (!el) return;
        const updateOffset = () => {
            const top = parseFloat(getComputedStyle(el).top) || 0;
            setStickyOffset(top + el.offsetHeight);
        };
        updateOffset();
        const ro = new ResizeObserver(updateOffset);
        ro.observe(el);
        return () => ro.disconnect();
    }, [isWaitingBill, hasActiveFilter, visibleCategories.length]);

    // Scroll-spy: um único IntersectionObserver observando as seções de
    // categoria, ativo só quando a faixa de tabs está visível (sem busca/
    // favoritos ativos — com filtro ativo não há tabs pra destacar, ver
    // hasActiveFilter). Reconstruído sempre que o conjunto de seções muda
    // (`visibleCategories`) ou a área fixa muda de altura (`stickyOffset`).
    // Desconecta no cleanup do efeito em toda re-execução E no unmount —
    // nunca acumula observers.
    useEffect(() => {
        if (hasActiveFilter || visibleCategories.length === 0) return;

        const observer = new IntersectionObserver(
            (entries) => {
                // Suprime enquanto um scroll disparado por clique na tab está
                // em curso (hazard #1) — senão a tab ativa "pula" no meio da
                // animação de rolagem e a faixa visivelmente "corre".
                if (isClickScrollingRef.current) return;
                const intersecting = entries.filter(e => e.isIntersecting);
                if (intersecting.length === 0) return;
                // Entre as seções cruzando a faixa observada, a mais próxima
                // do topo é a seção "atual" (técnica padrão de scroll-spy).
                intersecting.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                const id = intersecting[0].target.getAttribute('data-category-id');
                if (id) setActiveCategory(id);
            },
            { rootMargin: `-${stickyOffset}px 0px -65% 0px`, threshold: 0 }
        );

        visibleCategories.forEach(cat => {
            const el = sectionRefs.current[cat.id];
            if (el) observer.observe(el);
        });

        return () => observer.disconnect();
    }, [visibleCategories, hasActiveFilter, stickyOffset]);

    // Guarda de fim de página (achado da revisão final): `rootMargin` do
    // IntersectionObserver acima observa só uma faixa fina perto do topo
    // (`-65%` na base), então uma última categoria curta pode nunca cruzar
    // essa faixa — o scroll chega ao fim da página com a penúltima tab ainda
    // marcada como ativa. Ao detectar que o usuário rolou até o fim de
    // verdade (scrollY + innerHeight cobre scrollHeight), força a última
    // categoria visível como ativa, sobrescrevendo o que o observer decidiu.
    // Só reage a eventos `scroll` de verdade — SEM chamada síncrona logo
    // após o `addEventListener` (achado da 2ª revisão): um cardápio curto
    // o bastante pra já nascer sem overflow bateria a condição de "fim de
    // página" no mount, e como este efeito roda DEPOIS do efeito que
    // define a 1ª categoria como padrão (declarado antes, mesmo commit),
    // um `setActiveCategory` síncrono aqui sobrescreveria esse padrão pela
    // ÚLTIMA categoria — corrida de efeitos, não scroll de verdade.
    useEffect(() => {
        if (hasActiveFilter || visibleCategories.length === 0) return;

        const checkBottom = () => {
            // Mesma supressão do observer principal (linha ~2615) — sem isso,
            // um clique em QUALQUER tab (não só a última) cuja seção é curta
            // o suficiente pra `scrollIntoView` pousar a 2px do fim real da
            // página dispara `scroll` durante a animação e este listener
            // sobrescreve a tab recém-clicada pela última categoria.
            if (isClickScrollingRef.current) return;
            const doc = document.documentElement;
            if (window.scrollY + window.innerHeight >= doc.scrollHeight - 2) {
                const last = visibleCategories[visibleCategories.length - 1];
                if (last) setActiveCategory(last.id);
            }
        };

        window.addEventListener('scroll', checkBottom, { passive: true });
        return () => window.removeEventListener('scroll', checkBottom);
    }, [visibleCategories, hasActiveFilter]);

    // Traz a tab ativa pra vista dentro da faixa horizontal rolável sempre
    // que ela muda — tanto por clique quanto pelo scroll-spy. `tabButtonRefs`
    // só é populado quando a faixa de tabs está renderizada (!hasActiveFilter);
    // sem ela, o lookup simplesmente não acha o botão e não faz nada.
    useEffect(() => {
        const btn = tabButtonRefs.current[activeCategory];
        if (btn) btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }, [activeCategory]);

    // Failsafe da supressão do spy: além do timeout de segurança em
    // handleTabClick (que SEMPRE limpa, aconteça o que acontecer), usa o
    // evento nativo 'scrollend' (quando suportado) pra limpar assim que a
    // rolagem de verdade termina, em vez de esperar o timeout inteiro.
    useEffect(() => {
        const clear = () => {
            isClickScrollingRef.current = false;
            if (clickScrollTimeoutRef.current) {
                clearTimeout(clickScrollTimeoutRef.current);
                clickScrollTimeoutRef.current = null;
            }
        };
        window.addEventListener('scrollend', clear);
        return () => window.removeEventListener('scrollend', clear);
    }, []);

    // Fecha o menu de ordenação ao clicar fora dele ou pressionar Esc
    // (achado Minor de code review — não é um full popover com focus trap,
    // só a tecla de saída que qualquer menu efêmero precisa ter).
    useEffect(() => {
        if (!sortMenuOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
                setSortMenuOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setSortMenuOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [sortMenuOpen]);

    // Clique numa tab: rola a seção pra vista (scroll-margin-top da própria
    // seção garante que o título não fica escondido atrás da barra fixa) e
    // marca a tab como ativa imediatamente (feedback instantâneo, sem
    // esperar o observer). A supressão (`isClickScrollingRef`) É SEMPRE
    // limpa por um timeout, nunca só por 'scrollend' — garante que o spy
    // nunca fica travado pro resto da sessão, mesmo se a seção já estiver
    // visível (nenhum scroll acontece, 'scrollend' nunca dispara) ou o
    // navegador não suportar o evento.
    const handleTabClick = (categoryId: string) => {
        const section = sectionRefs.current[categoryId];
        if (!section) return;
        isClickScrollingRef.current = true;
        setActiveCategory(categoryId);
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (clickScrollTimeoutRef.current) clearTimeout(clickScrollTimeoutRef.current);
        clickScrollTimeoutRef.current = setTimeout(() => {
            isClickScrollingRef.current = false;
            clickScrollTimeoutRef.current = null;
        }, 1000);
    };

    if (loadError === 'network') return (
        <div className="min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center gap-3 p-6 text-center">
            <RefreshCw className="text-[var(--text-muted)]" size={48} />
            <h1 className="text-lg font-semibold text-[var(--text)]">Erro de conexão</h1>
            <p className="text-sm text-[var(--text-muted)] max-w-xs">
                Não foi possível carregar o cardápio. Verifique sua internet e tente novamente.
            </p>
            <Button onClick={loadStoreAndMenu} className="mt-2">
                <RefreshCw size={16} className="mr-2" /> Tentar de novo
            </Button>
        </div>
    );

    if (loadError === 'not_found') return (
        <div className="min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertTriangle className="text-[var(--text-muted)]" size={48} />
            <h1 className="text-lg font-semibold text-[var(--text)]">Loja não encontrada</h1>
            <p className="text-sm text-[var(--text-muted)] max-w-xs">
                Este link não corresponde a nenhuma loja ativa. Confira o endereço ou fale com o restaurante.
            </p>
        </div>
    );

    if (!currentStore) return (
        <div className="min-h-screen bg-[var(--bg)] p-4 max-w-2xl mx-auto">
            <div className="flex items-center gap-3 py-4">
                <Skeleton className="w-12 h-12 rounded-[var(--r-lg)]" />
                <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                </div>
            </div>
            <div className="grid gap-3">
                {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="u-stagger flex gap-3 p-3" style={stagger(Math.min(i, 10) * 30)}>
                        <Skeleton className="w-20 h-20 rounded-[var(--r-sm)] shrink-0" />
                        <div className="flex-1 space-y-2 py-1">
                            <Skeleton className="h-3.5 w-3/4" />
                            <Skeleton className="h-3 w-full" />
                            <Skeleton className="h-3 w-1/3" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    // TRACKER MODE INTERCEPT
    if (trackedOrderId) {
        return <OrderTracker orderId={trackedOrderId} onReset={handleResetTracker} onLogout={() => handleLogout(true)} />;
    }

    // Hero da loja (Task 2): fatos do salão pra linha de metadados do cartão
    // — nunca dado de entrega (km/tempo/pedido mínimo/avaliação/cupom, sem
    // equivalente real neste app). Taxa de serviço sempre lida de
    // lib/calc.ts (SERVICE_FEE_RATE como fallback), nunca reescrita aqui.
    const serviceFeeRateForHero = currentStore.config?.service_fee_rate ?? SERVICE_FEE_RATE;
    // Mesa/Balcão NÃO entra aqui (achado da revisão final): já aparece no
    // chip de sessão logo abaixo (que também carrega nome do cliente + PIN),
    // renderizar de novo aqui duplicava a informação na mesma tela.
    //
    // Task 3 (2026-08-22): antes só entrava aqui quando a taxa estava
    // ligada — desligada, a linha simplesmente não aparecia, o que o dono
    // do projeto apontou como ambíguo ("o cliente pede sem saber que vai
    // pagar 10% a mais"). Agora sempre enuncia um dos dois estados. Este
    // cartão é a política DA LOJA (visível antes de qualquer mesa/sessão
    // escolhida) — a remoção por mesa específica (`service_fee_removed`)
    // não cabe aqui por desenho: não há mesa selecionada ainda neste ponto
    // do fluxo. Quem carrega uma sessão de mesa vê o estado por-mesa exato
    // na Conta (BillSplitter, mais abaixo neste arquivo).
    const heroMetaParts: string[] = [];
    heroMetaParts.push(
        currentStore.config?.charge_service_fee
            ? `Taxa de serviço opcional de ${formatServiceFeeRate(serviceFeeRateForHero)}`
            : 'Sem taxa de serviço'
    );

    // Endereço do cartão do hero (item 3): linha curta sempre visível
    // (bairro, cidade/UF) + linha completa (logradouro+número) só quando a
    // linha do nome está expandida (item 2). Ambas `null` sem dado real —
    // nunca placeholder.
    const storeAddressLine = composeStoreAddressLine(fiscalConfig);
    const storeAddressFull = composeFullStoreAddress(fiscalConfig);

    // Total de itens da comanda desta sessão de mesa (soma de todos os
    // pedidos já enviados, `mesaOrders` — dado real já carregado por
    // useMesaOrders, nunca um número inventado).
    const mesaItemCount = mesaOrders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);

    // Task 4: mesma derivação de "há pedido em aberto nesta sessão" que já
    // alimenta a barra "Comanda aberta • N itens" acima (`mesaOrders.length
    // > 0`, nunca recomputada) — decide se o controle do hero oferece
    // "Sair" (sessão sem nada pedido, pode mesmo sair) ou "Pedir a conta"
    // (pedido em aberto: sair "fecharia" só o aparelho, não a dívida —
    // decisão do dono do projeto, 2026-08-22).
    //
    // `|| tableOrdersUnknown` (residual, 2026-08-22): quando o fetch de
    // restauração falhou com a mesa OCCUPIED/WAITING_BILL, não sabemos se
    // há pedido -- e "não sabemos" tem que se comportar como "pode haver",
    // nunca como "não há". Errar nessa direção é seguro (pior caso: cliente
    // sem nada a pagar toca "Pedir a conta" e o garçom limpa); errar pro
    // outro lado é o cliente saindo com conta em aberto.
    //
    // `|| isWaitingBill` (achado da revisão final, 2026-08-22): `mesaOrders`
    // só reflete pedidos que ESTE dispositivo enviou nesta sessão
    // (`mesaOrderIds`), sem filtrar cancelado/pago -- ao vivo, na mesma
    // sessão, ele acumula tudo que este aparelho mandou; após um reload, o
    // AUTO-LOGIN o repopula a partir de `fetch_table_order_summary_secure`,
    // que é table-scoped E filtra item cancelado/pedido
    // `delivered`/`canceled`. A mesma mesa real, dependendo só do histórico
    // de reload, podia dar "Sair" ou "Pedir a conta" pro MESMO estado real
    // -- e um caso concreto sobrevivia aos dois: um cliente que entra numa
    // mesa que OUTRO dispositivo já colocou em `waiting_bill` nunca passa
    // pelo bloco de restauração (login novo, não reload de sessão salva),
    // então `mesaOrders`/`tableOrdersUnknown` ficam vazios/false mesmo com
    // a mesa já travada — via `isWaitingBill` (já em escopo, calculado bem
    // acima a partir de `currentTable.status`), esse latecomer ganha
    // "Sair" desabilitado bem debaixo do aviso "Conta Solicitada. Novos
    // pedidos bloqueados.", contradição visual pura, e o próprio caso que
    // este OR fecha. `isWaitingBill` é o sinal de mesa mais autoritativo já
    // disponível (vem direto de `currentTable.status`, não de uma
    // derivação local) -- somá-lo por OR nunca esconde "Sair" quando não
    // deveria, só garante que uma mesa em `waiting_bill` nunca a oferece.
    const hasOpenTableOrders = mesaOrders.length > 0 || tableOrdersUnknown || isWaitingBill;

    return (
        <MotionConfig reducedMotion="user">
            <div className="bg-[var(--bg)] min-h-screen pb-32">
            {/* Hero da loja (Task 2, redesign inspirado no iFood): capa full-bleed
                + logo circular + cartão de identificação sobreposto, no lugar
                da antiga banda sólida --ink com só o nome em texto branco.
                Dine-in apenas: nenhum dado de entrega (km, tempo de entrega,
                pedido mínimo, avaliação, cupom) tem equivalente real neste
                app — nada disso é renderizado, nem como placeholder. */}
            <header className="relative">
                {/* Faixa da capa: SEMPRE 200px, com foto ou sem (correção
                    2026-08-21). Uma rodada anterior colapsava pra h-[120px]
                    sem capa "pra evitar banda morta" — decisão errada:
                    removia exatamente o espaço que o usuário quer VER (é
                    assim que o lojista também aprende onde a própria capa
                    vai entrar). Hoje a loja piloto tem 0 capa e 0 logo — o
                    catálogo inteiro está vazio — e é justo por isso que o
                    estado vazio precisa ser desenhado, não colapsado. */}
                <div className="relative w-full h-[200px]">
                    {/* Mídia (foto/degradê+textura + escurecimento) isolada num
                        filho absolute+overflow-hidden: precisa recortar a capa
                        na faixa, mas SEM recortar o logo circular logo abaixo,
                        que atravessa a borda inferior de propósito. */}
                    <div className="absolute inset-0 overflow-hidden">
                        {currentStore.cover_url ? (
                            <Image
                                src={currentStore.cover_url}
                                alt=""
                                fill
                                priority
                                sizes="100vw"
                                className="object-cover"
                            />
                        ) : (
                            // Estado vazio DESENHADO, não um vazio plano: gradiente de
                            // marca (mesmo degradê --ink→--brand de sempre) + textura de
                            // pontos sutil (dá profundidade sem competir com nada) + glifo
                            // de foto/câmera baixo-contraste centralizado — lê como "aqui
                            // vai a foto do restaurante", não como falha de carregamento.
                            <div
                                className="absolute inset-0 flex items-center justify-center"
                                style={{
                                    backgroundImage:
                                        'radial-gradient(circle, color-mix(in srgb, white 14%, transparent) 1px, transparent 1px), ' +
                                        'linear-gradient(135deg, var(--ink), color-mix(in srgb, var(--ink) 82%, var(--brand)))',
                                    backgroundSize: '16px 16px, 100% 100%',
                                }}
                            >
                                <ImageIcon size={48} strokeWidth={1.5} className="text-white/15" aria-hidden="true" />
                            </div>
                        )}
                        {/* Escurecimento pro rodapé: só faz sentido sobre uma FOTO
                            real (garante contraste dos controles) — sem capa, NÃO
                            aplicar este overlay (achado da revisão anterior: aplicado
                            incondicional, virava um "buraco preto" em cima do estado
                            vazio já escuro — exatamente a reclamação corrigida aqui). */}
                        {currentStore.cover_url && (
                            <div
                                className="absolute inset-0"
                                style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,.18), rgba(0,0,0,.55))' }}
                            />
                        )}
                    </div>

                    {/* Controles sobre a capa. Sem botão de voltar (o cardápio é
                        a raiz, não há pra onde voltar). Coração e lupa
                        (hero item 5, 2026-08-21): NÃO são um segundo
                        mecanismo de busca/favoritos — reaproveitam o MESMO
                        estado/input da barra sticky abaixo (favoritesOnly,
                        searchInputRef), só dão um atalho de cima da capa,
                        igual ao app de referência. Mesmo tratamento visual
                        translúcido do ThemeToggle (bg-black/35 +
                        backdrop-blur-sm), validado como legível sobre foto
                        arbitrária de cliente. */}
                    <div
                        className="absolute right-3 z-10 flex items-center gap-2"
                        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
                    >
                        <div className="w-9 h-9 rounded-full overflow-hidden bg-black/35 backdrop-blur-sm">
                            <ThemeToggle variant="sidebar" />
                        </div>
                        <button
                            type="button"
                            onClick={() => setFavoritesOnly(v => !v)}
                            aria-label={favoritesOnly ? 'Mostrar todos os produtos' : 'Mostrar só favoritos'}
                            aria-pressed={favoritesOnly}
                            className={`w-9 h-9 grid place-items-center rounded-full backdrop-blur-sm text-white u-motion ${favoritesOnly ? 'bg-[var(--brand)]' : 'bg-black/35'}`}
                        >
                            <Heart size={16} className={favoritesOnly ? 'fill-current' : ''} />
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                stickyBarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                searchInputRef.current?.focus();
                            }}
                            aria-label="Buscar no cardápio"
                            className="w-9 h-9 grid place-items-center rounded-full bg-black/35 backdrop-blur-sm text-white u-motion"
                        >
                            <Search size={16} />
                        </button>
                        {/* Task 4 (2026-08-22): com pedido em aberto nesta sessão, "Sair"
                            deixa de existir — o cliente não fecha a mesa nem a conta
                            saindo do aparelho (handleLogout só limpa localStorage/estado
                            local, a mesa e a dívida continuam abertas; ver confirm() logo
                            abaixo). O que ele quer nesse momento é pedir a conta, então o
                            controle vira exatamente isso: mesmo ícone/mecanismo já usado
                            em "Pedir Conta (Bloquear Mesa)" dentro da Conta (BillSplitter,
                            via requestBillOnOpen — não uma segunda chamada a
                            requestTableBill). Sem pedido nenhum na sessão (mesa errada,
                            desistiu, só olhando o cardápio), "Sair" continua existindo e
                            funcionando como sempre — não pode ficar sem saída. */}
                        {hasAccess && (
                            hasOpenTableOrders ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setBillRequestIntent(true);
                                        setShowBill(true);
                                    }}
                                    // Com a mesa já em waiting_bill, o clique não "pede" a conta
                                    // de novo (o BillSplitter só mostra "Aguarde o garçom" nesse
                                    // caso, ver requestBillOnOpen/!isWaitingBill acima) -- rótulo
                                    // reflete isso pra não prometer uma ação que já aconteceu,
                                    // agora que este estado fica alcançável em qualquer reload.
                                    aria-label={isWaitingBill ? 'Ver conta' : 'Pedir a conta'}
                                    title={isWaitingBill ? 'Ver conta' : 'Pedir a conta'}
                                    className="w-9 h-9 grid place-items-center rounded-full bg-black/35 backdrop-blur-sm text-white u-motion"
                                >
                                    <Receipt size={16} />
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => handleLogout(false)}
                                    aria-label="Sair deste aparelho"
                                    title="Sair deste aparelho"
                                    className="w-9 h-9 grid place-items-center rounded-full bg-black/35 backdrop-blur-sm text-white u-motion"
                                >
                                    <LogOut size={16} />
                                </button>
                            )
                        )}
                    </div>

                </div>

                {/* Cartão de identificação da loja (correção de geometria,
                    2026-08-21, pedido direto do usuário comparando com a
                    referência do iFood real): dois ajustes de composição, sem
                    tocar em nenhum conteúdo.

                    1) Cartão agora INSET (mx-4) e arredondado nos 4 cantos
                       (rounded-2xl, era só rounded-t-2xl full-bleed) — a capa
                       fica visível dos dois lados no topo, o cartão lê como um
                       painel flutuando SOBRE a foto, não como um sheet que a
                       foto "vira". -mt-4 preservado (mesma sobreposição
                       vertical de sempre, é isso que faz o cartão "subir"
                       sobre a capa).

                    2) O selo de logo (ver o <div> logo abaixo) deixou de ser
                       filho do container da capa (ancorado na borda INFERIOR
                       DA CAPA via -bottom-8) e virou filho deste cartão,
                       ancorado na borda SUPERIOR DO CARTÃO via -top-8 — é
                       essa borda (não a da capa) que a referência usa. Como
                       este <div> já é `position: relative` (necessário pro
                       `z-[5]` fazer sentido), um filho `absolute` com
                       `top: -2rem` fica automaticamente centrado na própria
                       borda superior do cartão: com w-16/h-16 (64px de
                       diâmetro) e -top-8 (-32px), metade do círculo (32px)
                       fica ACIMA dessa borda (sobre a capa, que continua
                       visível ali por causa do -mt-4 acima) e a outra metade
                       (32px) fica ABAIXO (sobre o fundo branco do cartão) —
                       exatamente a proporção pedida, e sem depender de
                       recalcular a altura da capa: funciona pra qualquer
                       h-[...] da capa, desde que >= metade do logo. */}
                <div
                    className="relative z-[5] mx-4 -mt-4 rounded-2xl bg-[var(--surface)] px-4 pb-3 pt-10"
                    style={{ boxShadow: 'var(--shadow-md)' }}
                >
                    {/* Selo de logo: SEMPRE renderiza (com logo_url real ou
                        placeholder desenhado — mesmo ProductThumb size="store"
                        reusado em todo o resto do cardápio, ring-4
                        ring-[var(--surface)] preservado nos dois casos).
                        Continua precisando do <div> wrapper externo pra
                        posicionamento (ver histórico do achado ao vivo
                        2026-08-21 no commit anterior desta feature): a raiz do
                        ProductThumb já é `relative` fixo (o branch com `src`
                        usa `<Image fill>`, que exige um ancestral posicionado
                        — os outros 6 call sites do componente dependem disso),
                        então `absolute`/`-top-8`/anel/recorte não podem ir no
                        `className` do ProductThumb (empatariam
                        `relative`/`absolute` na mesma tag) — só no `<div>` que
                        o envolve, que é quem de fato ganha a posição. */}
                    <div className="absolute left-1/2 -translate-x-1/2 -top-8 z-10 w-16 h-16 rounded-full overflow-hidden ring-4 ring-[var(--surface)]">
                        <ProductThumb
                            src={currentStore.logo_url}
                            name={currentStore.name}
                            size="store"
                        />
                    </div>

                    <div className="flex items-start justify-between gap-3">
                        {/* Linha do nome (hero item 2, 2026-08-21): virou um
                            <button> de verdade — foco por teclado, nome
                            acessível ("Informações da loja") — em vez de um
                            <h1> mudo. Não existe tela de "informações da
                            loja" nesta versão do app (nenhuma rota/modal
                            equivalente), então em vez de linkar pra um
                            destino fictício, a própria linha expande/
                            recolhe em lugar pra revelar o endereço completo
                            (storeAddressFull) — ver bloco abaixo. Ícone
                            MapPin em IFOOD_RED (mesma paleta de ação/leitura
                            já usada no resto do redesign), chevron
                            empurrado pro fim do <button> (que é flex-1) —
                            fica encostado no botão "Conta" quando ele existe,
                            ou na borda direita do cartão quando não. */}
                        <button
                            type="button"
                            onClick={() => setStoreInfoExpanded(v => !v)}
                            aria-expanded={storeInfoExpanded}
                            aria-label="Informações da loja"
                            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[var(--r-sm)] text-left u-motion focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                        >
                            <MapPin size={16} className="flex-shrink-0" style={{ color: IFOOD_RED }} />
                            <h1 className="min-w-0 flex-1 truncate text-[20px] font-semibold leading-tight text-[var(--text)]">
                                {currentStore.name}
                            </h1>
                            <ChevronRight
                                size={18}
                                className={`flex-shrink-0 text-[var(--text-muted)] transition-transform duration-200 ${storeInfoExpanded ? 'rotate-90' : ''}`}
                            />
                        </button>
                        {currentTable && (
                            <button
                                onClick={() => setShowBill(true)}
                                className={`flex h-8 flex-shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-semibold u-motion ${
                                    isWaitingBill
                                        ? 'bg-[var(--warn)] text-white'
                                        : 'border border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface-2)]'
                                }`}
                            >
                                {isWaitingBill ? <Clock size={12} /> : <Receipt size={12} />} Conta
                            </button>
                        )}
                    </div>

                    {/* Linha de metadados (hero item 3, 2026-08-21): endereço
                        real da loja (store_fiscal_config, título-caseado —
                        ver composeStoreAddressLine), SEMPRE visível quando
                        configurado. `null` (loja sem cadastro fiscal, estado
                        normal) = nenhuma linha, nunca um placeholder. */}
                    {storeAddressLine && (
                        <p className="mt-1 flex items-center gap-1 text-[13px] text-[var(--text-muted)]">
                            {storeAddressLine}
                        </p>
                    )}

                    {/* Endereço completo — só ao expandir a linha do nome
                        (item 2). AnimatePresence + SPRING_SHEET: mesmo
                        spring já usado neste arquivo pra abrir/fechar
                        acordeão (ver lib/motion.ts, comentário do preset),
                        nunca um terceiro preset novo. */}
                    <AnimatePresence>
                        {storeInfoExpanded && storeAddressFull && (
                            <motion.p
                                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                                animate={{ opacity: 1, height: 'auto', marginTop: 4 }}
                                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                                transition={SPRING_SHEET}
                                className="overflow-hidden text-[12px] text-[var(--text-muted)]"
                            >
                                {storeAddressFull}
                            </motion.p>
                        )}
                    </AnimatePresence>

                    {/* Linha de metadados original (taxa de serviço) — mantida
                        como estava, só deslocada pra depois do endereço. */}
                    {heroMetaParts.length > 0 && (
                        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                            {heroMetaParts.join(' • ')}
                        </p>
                    )}

                    {/* Chips de sessão (nome/mesa/balcão/revelar PIN), realocados
                        pra dentro do cartão — só existem depois que o cliente
                        tentou adicionar algo e passou pelo modal de PIN (ver
                        requestAccessThen), mesma condição de antes. */}
                    {hasAccess && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--text-muted)]">
                                <User size={10} /> {clientName} {isHost ? '(Host)' : ''}
                            </span>
                            {currentTable ? (
                                <span className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-semibold text-[var(--text)]">
                                    Mesa {currentTable.number}
                                </span>
                            ) : (
                                <span
                                    className="rounded-full px-2 py-1 font-semibold"
                                    style={{ color: 'var(--brand)', background: 'color-mix(in srgb, var(--brand) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--brand) 30%, transparent)' }}
                                >
                                    Balcão
                                </span>
                            )}
                            {isHost && currentTable && hostPin && (
                                <button
                                    type="button"
                                    onClick={() => setShowPin(!showPin)}
                                    className="flex items-center gap-1 rounded-full px-2 py-1 font-semibold u-motion"
                                    style={{ color: 'var(--brand)', background: 'color-mix(in srgb, var(--brand) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--brand) 30%, transparent)' }}
                                >
                                    <span className="num tracking-wider">{showPin ? hostPin : '••••'}</span>
                                    {showPin ? <EyeOff size={9} /> : <Eye size={9} />}
                                </button>
                            )}
                        </div>
                    )}

                    {/* Divisor + segunda linha (hero item 4, 2026-08-21): no
                        iFood real esse é o espaço da nota (estrelas) — este
                        app não tem avaliação agregada de loja nenhuma
                        (order_ratings é por pedido, nunca seria uma média
                        honesta de "nota da loja" sem uma feature nova) e
                        não vou inventar uma. Equivalente honesto pro
                        dine-in: reaproveita a MESMA derivação mesa/balcão
                        já usada no chip de sessão logo acima
                        (`currentTable ? 'Mesa N' : 'Balcão'`), nunca
                        recalculada. Com sessão de mesa aberta, a linha é
                        tappable de verdade (abre a Conta, mesmo destino do
                        botão "Conta" do cabeçalho — reaproveitado, não
                        duplicado). Sem sessão, é um convite tappable pra
                        abrir a mesa/comanda (mesmo modal de login que já
                        existe). Com sessão de BALCÃO (sem mesa), não há
                        nenhuma tela real pra abrir a esta altura do pedido
                        — a linha fica só informativa (sem chevron, sem
                        <button>), pra nunca prometer uma ação que não
                        existe. */}
                    <div className="mt-3 border-t border-[var(--border)] pt-3">
                        {hasAccess && currentTable ? (
                            <button
                                type="button"
                                onClick={() => setShowBill(true)}
                                className="flex w-full items-center gap-2 text-left u-motion"
                            >
                                <LayoutGrid size={15} className="flex-shrink-0" style={{ color: IFOOD_RED }} />
                                <span className="flex-1 text-[13px] font-medium text-[var(--text)]">Mesa {currentTable.number} • ver conta</span>
                                <ChevronRight size={16} className="flex-shrink-0 text-[var(--text-muted)]" />
                            </button>
                        ) : hasAccess ? (
                            <div className="flex w-full items-center gap-2">
                                <Coffee size={15} className="flex-shrink-0" style={{ color: IFOOD_RED }} />
                                <span className="flex-1 text-[13px] font-medium text-[var(--text)]">Pedido no balcão</span>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setIsLoginModalOpen(true)}
                                className="flex w-full items-center gap-2 text-left u-motion"
                            >
                                <Info size={15} className="flex-shrink-0" style={{ color: IFOOD_RED }} />
                                <span className="flex-1 text-[13px] font-medium text-[var(--text)]">Toque para abrir sua mesa ou comanda</span>
                                <ChevronRight size={16} className="flex-shrink-0 text-[var(--text-muted)]" />
                            </button>
                        )}
                    </div>
                </div>
            </header>

            {/* Barra de status da sessão: só existe fato real pra mostrar quando
                há uma comanda de mesa com pelo menos 1 pedido já enviado
                (mesaOrders, populado em submitOrder ao enviar pra cozinha —
                nunca um número inventado). Sem sessão de mesa aberta, não
                renderiza nada. */}
            {hasAccess && mesaOrders.length > 0 && (
                <div className="w-full bg-[var(--ink)] py-2 text-center text-[13px] text-white">
                    Comanda aberta • {mesaItemCount} {mesaItemCount === 1 ? 'item' : 'itens'}
                </div>
            )}

            {/* Waiting Bill Banner */}
            {isWaitingBill && (
                <div className="bg-[var(--warn)] text-white px-4 py-2 text-center text-[13px] font-medium sticky top-0 z-30 flex items-center justify-center gap-2">
                    <Lock size={13}/> Conta Solicitada. Novos pedidos bloqueados.
                </div>
            )}

            {/* Vitrine de Destaques (migration 019) — faixa horizontal rolável no
                topo do cardápio, antes da navegação de categorias. Redesign
                iFood (Task 5): cartão próprio (FeaturedProductCard, definido
                acima junto do ProductCard) em vez do ProductCard da lista —
                a linha texto-esquerda/foto-direita não funciona como cartão
                de carrossel. Sem ícone/régua dourada no título (gold sai do
                cardápio inteiro no redesign). Produto destacado continua
                aparecendo normalmente dentro da categoria dele também — esta
                vitrine é além, não em vez disso. */}
            {featuredProducts.length > 0 && (
                <div className={`px-4 pt-4 ${isWaitingBill ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
                    <h2 className="text-[19px] font-bold text-[var(--text)] mb-1.5 u-grow-in">Destaques</h2>
                    {/* Fade nas duas pontas sinalizando que dá pra rolar mais (útil em
                        desktop sem trackpad/touch, onde não há nenhuma outra pista
                        visual de overflow horizontal) — mesmo princípio do fade da
                        navegação de categorias logo abaixo, cor adaptada pro fundo
                        claro/escuro (--bg) desta seção. */}
                    <div className="relative">
                        <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-4 z-10" style={{ background: 'linear-gradient(to right, var(--bg), transparent)' }} />
                        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-10" style={{ background: 'linear-gradient(to left, var(--bg), transparent)' }} />
                        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1.5 px-1.5 pb-1" style={{ scrollSnapType: 'x mandatory' }}>
                            {featuredProducts.map(product => (
                                <FeaturedProductCard
                                    key={product.id}
                                    product={product}
                                    onSelect={setSelectedProduct}
                                    disabled={isWaitingBill}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Barra fixa de busca + tabs de categoria (Task 3, substitui o
                antigo acordeão + banda --ink): as duas linhas (busca+ações,
                tabs) vivem dentro do MESMO container sticky, pra
                `stickyOffset` (ver efeito acima) medir a altura ocupada
                pelas duas de uma vez. `top-9`/`top-0` reproduz o mesmo
                encaixe que a barra antiga já tinha com o banner "Conta
                Solicitada" (também sticky, z-30, top-0). */}
            <div
                ref={stickyBarRef}
                className={`bg-[var(--surface)]/95 backdrop-blur border-b border-[var(--border)] sticky ${isWaitingBill ? 'top-9' : 'top-0'} z-30`}
            >
                <div className="px-4 pt-3 pb-2 flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" size={18} />
                        <input
                            ref={searchInputRef}
                            type="text"
                            aria-label={`Buscar em ${currentStore.name}`}
                            placeholder={`Buscar em ${currentStore.name}`}
                            className="w-full h-11 pl-11 pr-4 rounded-full bg-[var(--surface-2)] border border-transparent text-[15px] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border)] transition-colors"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                    {/* Favoritos (Vende Mais II, 100% client-side): mesmo filtro
                        cumulativo de sempre, só o visual virou botão de ícone
                        redondo pra caber ao lado da pílula de busca. */}
                    <button
                        onClick={() => setFavoritesOnly(v => !v)}
                        className={`flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-full border u-motion u-press-sm ${favoritesOnly ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'bg-[var(--surface-2)] border-transparent text-[var(--text-muted)]'}`}
                        title="Mostrar só favoritos"
                        aria-pressed={favoritesOnly}
                    >
                        <Heart size={16} className={favoritesOnly ? 'fill-current' : ''} />
                    </button>
                    {/* Ordenação: os 3 toggles lado a lado viraram um único botão de
                        ícone que abre um menu (brief permite essa forma, pra caber
                        na largura ao lado da busca+favoritos). */}
                    <div className="relative flex-shrink-0" ref={sortMenuRef}>
                        <button
                            type="button"
                            onClick={() => setSortMenuOpen(v => !v)}
                            className={`flex items-center justify-center w-11 h-11 rounded-full border u-motion u-press-sm ${sortBy !== 'default' ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'bg-[var(--surface-2)] border-transparent text-[var(--text-muted)]'}`}
                            title="Ordenar"
                            aria-haspopup="menu"
                            aria-expanded={sortMenuOpen}
                        >
                            <ArrowUpDown size={16} />
                        </button>
                        <AnimatePresence>
                            {sortMenuOpen && (
                                <motion.div
                                    role="menu"
                                    aria-label="Ordenar cardápio"
                                    initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                    transition={SPRING_TAP}
                                    className="absolute right-0 top-12 z-20 w-48 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] py-1"
                                    style={{ boxShadow: 'var(--shadow-md)' }}
                                >
                                    {([
                                        { key: 'default' as const, label: 'Padrão', Icon: null as typeof ArrowDownAZ | null },
                                        { key: 'price_asc' as const, label: 'Menor preço', Icon: ArrowDownWideNarrow },
                                        { key: 'price_desc' as const, label: 'Maior preço', Icon: ArrowUpNarrowWide },
                                        { key: 'name_asc' as const, label: 'Nome A-Z', Icon: ArrowDownAZ },
                                    ]).map(opt => (
                                        <button
                                            key={opt.key}
                                            type="button"
                                            role="menuitem"
                                            onClick={() => { setSortBy(opt.key); setSortMenuOpen(false); }}
                                            className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left u-motion ${sortBy === opt.key ? 'font-semibold text-[var(--brand)]' : 'text-[var(--text)]'}`}
                                        >
                                            {opt.Icon ? <opt.Icon size={14} /> : <span className="w-[14px]" />}
                                            {opt.label}
                                        </button>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {/* Tabs de categoria: só existem sem busca/favoritos ativos — com
                    filtro ativo, cada seção com resultado já aparece sozinha
                    embaixo, sem precisar de navegação por tab (ver
                    hasActiveFilter e a lista de seções logo abaixo). */}
                {!hasActiveFilter && visibleCategories.length > 0 && (
                    <div role="group" aria-label="Categorias do cardápio" className="flex gap-5 overflow-x-auto no-scrollbar px-4 pb-2.5">
                        {visibleCategories.map(cat => {
                            const isActive = activeCategory === cat.id;
                            return (
                                <button
                                    key={cat.id}
                                    type="button"
                                    ref={el => { tabButtonRefs.current[cat.id] = el; }}
                                    onClick={() => handleTabClick(cat.id)}
                                    aria-current={isActive ? 'true' : undefined}
                                    // Sublinhado da aba ativa: AÇÃO na paleta iFood (correção
                                    // 2026-08-21) — vermelho via style, não classe (a cor depende
                                    // do estado isActive, Tailwind não referencia var JS).
                                    className={`flex-shrink-0 pb-1.5 text-[14px] whitespace-nowrap border-b-2 u-motion ${isActive ? 'text-[var(--text)] font-semibold' : 'text-[var(--text-muted)] border-transparent'}`}
                                    style={isActive ? { borderColor: IFOOD_RED } : undefined}
                                >
                                    {cat.name}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Seções empilhadas (Task 3, substitui o acordeão): todo produto
                fica visível sem nenhum toque — `scroll-margin-top` (via
                `stickyOffset`) garante que o título da seção não fica
                escondido atrás da barra fixa ao chegar por scrollIntoView
                (clique numa tab). Com busca/favoritos ativos, categoria sem
                nenhum resultado some inteira (mesmo comportamento que o
                acordeão já tinha). */}
            <div className={`px-4 pt-3 pb-2 ${isWaitingBill ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
                {visibleCategories.map((cat) => {
                    const catProducts = productsByCategory[cat.id] || [];
                    if (hasActiveFilter && catProducts.length === 0) return null;
                    return (
                        <section
                            key={cat.id}
                            ref={el => { sectionRefs.current[cat.id] = el; }}
                            data-category-id={cat.id}
                            style={{ scrollMarginTop: stickyOffset }}
                            className="border-b border-[var(--border)] last:border-0 pt-4 pb-2"
                        >
                            <h2 className="text-[19px] font-bold text-[var(--text)] mb-1">{cat.name}</h2>
                            <div className="pb-2">
                                {catProducts.map((product, i) => (
                                    <ProductCard
                                        key={product.id}
                                        product={product}
                                        onSelect={setSelectedProduct}
                                        onQuickAdd={(p) => {
                                            // Qualquer grupo de opção (obrigatório ou não) abre o
                                            // modal completo em vez de adicionar direto — extras
                                            // opcionais (ex.: borda de pizza) também são upsell/
                                            // vinculados ao omie_codigo, não podem ser pulados no "+".
                                            if ((p.option_groups || []).length > 0) { setSelectedProduct(p); return; }
                                            requestAccessThen(() => {
                                                addToCart(p, 1, '', []);
                                                toast.success(`${p.name} adicionado`);
                                            });
                                        }}
                                        disabled={isWaitingBill}
                                        style={stagger(Math.min(i, 10) * 30)}
                                        isBestseller={bestsellerIds.has(product.id)}
                                        isFavorite={favoriteIds.has(product.id)}
                                        onToggleFavorite={toggleFavorite}
                                    />
                                ))}
                                {catProducts.length === 0 && (
                                    <p className="text-[13px] text-[var(--text-muted)] py-3 text-center">Nenhum produto nesta categoria.</p>
                                )}
                            </div>
                        </section>
                    );
                })}

                {isLoadingMenu ? (
                    <div className="text-center py-12 text-[var(--text-muted)] text-sm animate-pulse">Carregando cardápio...</div>
                ) : visibleCategories.length === 0 ? (
                    <div className="flex flex-col items-center text-center py-16 u-grow-in">
                        <div className="w-16 h-16 rounded-[1.4rem] bg-[var(--brand-soft)] flex items-center justify-center mb-4" style={{ animation: '3s ease-in-out infinite icon-float' }}>
                            <UtensilsCrossed size={26} className="text-[var(--brand)]/50" />
                        </div>
                        <p className="text-[var(--text)] font-medium">Cardápio a caminho</p>
                        <p className="text-[var(--text-muted)] text-sm mt-1 max-w-[15rem]">Os pratos desta loja aparecem aqui assim que forem cadastrados.</p>
                    </div>
                ) : hasActiveFilter && Object.values(productsByCategory).every(p => p.length === 0) ? (
                    <div className="flex flex-col items-center text-center py-16 u-grow-in">
                        <div className="w-16 h-16 rounded-[1.4rem] bg-[var(--brand-soft)] flex items-center justify-center mb-4" style={{ animation: '3s ease-in-out infinite icon-float' }}>
                            <UtensilsCrossed size={26} className="text-[var(--brand)]/50" />
                        </div>
                        <p className="text-[var(--text)] font-medium">Nada encontrado</p>
                        <p className="text-[var(--text-muted)] text-sm mt-1 max-w-[15rem]">Tente buscar por outro nome.</p>
                    </div>
                ) : null}
            </div>

            {/* Floating Cart Button + Status da Mesa (empilham: Comanda em cima, Status embaixo) */}
            {!isWaitingBill && (
                <div className="fixed bottom-4 left-4 right-4 z-40 flex flex-col gap-3">
                    <AnimatePresence>
                        {cart.length > 0 && (
                            <motion.div
                                key="cart-bar"
                                initial={{ y: 40, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                exit={{ y: 40, opacity: 0 }}
                                transition={SPRING_SHEET}
                                className="text-white px-4 pt-3 pb-4 rounded-[var(--r-lg)] flex flex-col gap-3 border u-glass-cart on-glass"
                                style={{ borderColor: 'color-mix(in srgb, var(--brand) 30%, transparent)', boxShadow: '0 12px 34px -8px rgba(0,0,0,0.45)' }}
                            >
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2.5">
                                        <div className="p-1.5 rounded-[var(--r-sm)]" style={{ background: 'color-mix(in srgb, var(--brand) 15%, transparent)' }}>
                                            <ShoppingBag size={16} style={{ color: 'var(--brand)' }} />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[13px] font-medium text-white/80">Sua Comanda</span>
                                            <span className="text-[11px] text-white/50">{cart.reduce((a,b) => a + b.quantity, 0)} {cart.reduce((a,b) => a + b.quantity, 0) === 1 ? 'item' : 'itens'}</span>
                                        </div>
                                    </div>
                                    {/* Correção 2026-08-21: tirado do --brand azul (regra "preço sem
                                        promoção não é colorido" também vale pra este total). Não vira
                                        var(--text) aqui porque esta barra é um cartão de vidro ESCURO
                                        (text-white/80 nos rótulos ao lado) — var(--text) é escuro no
                                        tema claro e ficaria ilegível sobre este fundo; branco simples
                                        é o equivalente correto de "não colorido" neste contexto. */}
                                    <span className="text-[18px] font-bold text-white">R$ {formatBRL(cartTotal)}</span>
                                </div>
                                <Button
                                    className="w-full"
                                    onClick={() => setIsCartOpen(true)}
                                >
                                    Ver Comanda
                                </Button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    {latestMesaOrder && resolveOrderFlow(currentStore) !== 'direct_print' && (
                        // Entrada com spring (achado M5 da revisão final de 2026-08-16):
                        // a pill perdeu a animação de entrada quando o wrapper da barra
                        // do carrinho virou motion.div (Task 2) — sem AnimatePresence de
                        // propósito, o mount/unmount natural do `{latestMesaOrder && ...}`
                        // já dispara initial→animate sozinho, igual ao cart-bar acima.
                        <motion.div
                            initial={{ y: 40, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={SPRING_SHEET}
                        >
                            <OrderStatusPill order={latestMesaOrder} onClick={() => setIsOrderStatusOpen(true)} />
                        </motion.div>
                    )}
                </div>
            )}

            {/* Locked State Footer */}
            {isWaitingBill && (
                 <div className="fixed bottom-0 left-0 right-0 z-40 bg-[var(--ink)] text-white p-4 animate-[slideUp_0.25s_cubic-bezier(0.22,1,0.36,1)]" style={{boxShadow:'0 -4px 20px rgba(0,0,0,0.3)'}}>
                    <div className="flex justify-between items-center max-w-lg mx-auto">
                        <div className="flex items-center gap-3">
                            <Lock className="text-[var(--warn)]" size={18}/>
                            <div>
                                <p className="font-medium text-sm">Conta Solicitada</p>
                                <p className="text-[11px] text-white/50">Aguarde o garçom para finalizar.</p>
                            </div>
                        </div>
                        <Button variant="outline" size="sm" className="border-white/20 text-white hover:bg-white/10" onClick={() => setShowBill(true)}>
                            Ver Detalhes
                        </Button>
                    </div>
                 </div>
            )}

            <ProductModal
                product={selectedProduct}
                onClose={() => setSelectedProduct(null)}
                onAdd={(qty, notes, selectedOptions) => {
                    const product = selectedProduct;
                    if (product) {
                        requestAccessThen(() => {
                            addToCart(product, qty, notes, selectedOptions);
                            toast.success('Adicionado ao carrinho!');
                        });
                    }
                }}
                noteSuggestions={currentStore?.config?.note_suggestions || []}
                onSelectRecommended={setSelectedProduct}
                isFavorite={!!selectedProduct && favoriteIds.has(selectedProduct.id)}
                onToggleFavorite={toggleFavorite}
                visibleCategoryIds={visibleCategoryIds}
                store={currentStore}
            />

            <CounterConfirmModal
                isOpen={isCounterConfirmOpen}
                onClose={() => setIsCounterConfirmOpen(false)}
                onConfirm={submitOrder}
                isLoading={isLoading}
            />

            <CartModal
                isOpen={isCartOpen}
                onClose={() => setIsCartOpen(false)}
                cart={cart}
                total={cartTotal}
                onConfirm={handleSendOrder}
                isLoading={isLoading}
                onUpdateQty={(item, delta) => addToCart(item.product, delta, item.notes, item.selectedOptions)}
                onRemove={(item) => removeFromCart(item.product, item.notes, item.selectedOptions)}
                accentColor={currentStore?.config?.accent_color || WINE_GOLD}
            />

            <OrderStatusModal
                isOpen={isOrderStatusOpen}
                onClose={() => setIsOrderStatusOpen(false)}
                orders={mesaOrders}
                orderFlow={resolveOrderFlow(currentStore)}
            />

            {currentTable && currentStore && (
                <BillSplitter
                    isOpen={showBill}
                    onClose={() => { setShowBill(false); setBillRequestIntent(false); }}
                    tableId={currentTable.id}
                    storeId={currentStore.id}
                    clientName={clientName}
                    isWaitingBill={isWaitingBill}
                    currentStore={currentStore}
                    currentTable={currentTable}
                    requestBillOnOpen={billRequestIntent}
                />
            )}

            {/* Modal de nome+mesa+PIN, disparado por requestAccessThen na
                primeira tentativa de adicionar item — não é mais um gate de
                página inteira. Fecha sem logar = cancela a ação pendente e
                volta a navegar livremente. */}
            {isLoginModalOpen && (
                <div className="fixed inset-0 z-[100] overflow-y-auto">
                    <LoginScreen
                        onLogin={handleLogin}
                        storeSlug={slug || ''}
                        store={currentStore}
                        onClose={() => { setIsLoginModalOpen(false); setPendingCartAction(null); }}
                    />
                </div>
            )}
            </div>
        </MotionConfig>
    );
};
