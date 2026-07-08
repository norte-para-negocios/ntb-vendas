'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Image from 'next/image';
import { ShoppingBag, Search, Clock, Plus, Minus, User, LogIn, Coffee, LayoutGrid, Eye, EyeOff, ArrowUpDown, ArrowDownAZ, ArrowUpNarrowWide, ArrowDownWideNarrow, Bell, BellRing, LogOut, Trash2, Receipt, ChefHat, CheckCircle, AlertTriangle, AlertCircle, Users, Calculator, List, CheckSquare, Square, Lock, Info, PartyPopper, UtensilsCrossed, RefreshCw, X, Star, Wine, Martini, Beer, GlassWater, Flame, Pizza, Cake, Sparkles, Heart } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { fetchMenu, fetchStoreBySlug, createOrder, fetchTablesPublic, openTableSession, fetchTableOrderSummary, callWaiter, requestTableBill, cancelPendingTableItems, fetchOrderById, createOrderRating, fetchBestsellerProductIds } from '@/lib/api';
import { Category, Product, Table, TableStatus, Store, CartItem, OrderStatus, Order, OrderItem, ProductOptionGroup, SelectedOption } from '@/types';
import { Button, Card, Input, Modal, Badge } from '@/components/ui';
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/components/Toast';
import { playPreparingAlert, playReadyAlert, vibrateAlert } from '@/lib/audioAlert';
import { confirm } from '@/components/ConfirmDialog';
import { Skeleton, stagger } from '@/components/Skeleton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getTableStatusLabel, getOrderItemDisplayName, getCartItemDisplayName, getTagDisplay } from '@/lib/labels';
import { calculateServiceFee, calculateOrderTotal, calculateCartItemUnitPrice, calculateCartTotal, getEffectivePrice } from '@/lib/calc';
import { isCategoryAvailableNow } from '@/lib/schedule';
import { AuthBackdrop } from '@/components/AuthBackdrop';

// --- COMPONENTS ---

// Identidade "carta de vinhos" do cardápio do cliente: dourado usado só pra
// preço/proveniência (o azul da marca continua sendo a cor de ação/CTA).
// Hex fixo de propósito, como os outros consts de marca do projeto
// (AuthBackdrop, app/page.tsx) — não é um token do design system porque só
// existe nesta tela.
const WINE_GOLD = '#D4AF5C';
// Tom mais escuro só pro ícone dentro do medalhão dourado claro: o dourado
// puro em cima do próprio tom claro (rgba 0.14) não tem contraste suficiente.
const WINE_GOLD_DARK = '#8A6A2B';

// Cardápio que vende (migration 019): promoção "ativa" = promo_price setado
// E menor que o preço cheio — mesma guarda de getEffectivePrice (lib/calc.ts),
// usada aqui só pra decidir SE mostra o preço riscado, não pra calcular o
// valor cobrado (isso é sempre getEffectivePrice/calculateCartItemUnitPrice).
function hasActivePromo(product: { price: number; promo_price?: number | null }): boolean {
    return product.promo_price != null && product.promo_price < product.price;
}

// Ícone por categoria: leitura visual rápida na navegação, sem depender de
// texto. Heurística por palavra-chave no nome da categoria (dado real vindo
// do Omie, não uma taxonomia fixa no banco).
function categoryIcon(name: string) {
    const n = name.toLowerCase();
    if (n.includes('champagne')) return Sparkles;
    if (n.includes('vinho')) return Wine;
    if (n.includes('drink')) return Martini;
    if (n.includes('long neck') || n.includes('artesan')) return Beer;
    if (n.includes('s/ álcool') || n.includes('s/ alcool') || n.includes('suco')) return GlassWater;
    if (n.includes('50ml') || n.includes('whisky') || n.includes('destilad') || n.includes('licor') || n.includes('conhaque')) return Flame;
    if (n.includes('pizza')) return Pizza;
    if (n.includes('sobremesa')) return Cake;
    if (n.includes('taxa')) return Receipt;
    return UtensilsCrossed;
}

// Muitos vinhos vêm do Omie com o país de origem no fim do nome ("- ARG",
// "- FR"). Extrai isso pra virar uma etiqueta de proveniência em vez de
// ficar preso no nome corrido.
function parseOrigin(name: string): { clean: string; origin: string | null } {
    const m = name.match(/^(.*)\s-\s([A-ZÇ]{2,4})$/);
    if (m) return { clean: m[1].trim(), origin: m[2] };
    return { clean: name, origin: null };
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

const OrderTracker: React.FC<{ orderId: string, onReset: () => void, onLogout: () => void }> = ({ orderId, onReset, onLogout }) => {
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
            const { data: itemsData } = await supabase.from('order_items').select('*, product:products(*)').eq('order_id', orderId);
            if (itemsData) {
                // Baseline do load inicial: guarda o snapshot sem disparar toast.
                prevItemsRef.current = itemsData as OrderItem[];
                setItems(itemsData as OrderItem[]);
            }
        };
        load();

        // Listen to Order Changes
        const orderChannel = supabase.channel(`tracker_order_${orderId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, (payload) => {
                setOrder(payload.new as Order);
            })
            .subscribe();

        // Listen to Item Changes (To update sequence correctly based on Kitchen actions)
        const itemsChannel = supabase.channel(`tracker_items_${orderId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items', filter: `order_id=eq.${orderId}` }, async () => {
                 const { data: itemsData } = await supabase.from('order_items').select('*, product:products(*)').eq('order_id', orderId);
                 if (itemsData) {
                     notifyItemTransitions(itemsData as OrderItem[]);
                     setItems(itemsData as OrderItem[]);
                 }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(orderChannel);
            supabase.removeChannel(itemsChannel);
        };
    }, [orderId]);

    // DERIVE STATUS LOGIC
    const derivedStatus = useMemo(() => {
        if (!order) return OrderStatus.PENDING;
        if (order.status === OrderStatus.DELIVERED) return OrderStatus.DELIVERED;
        if (order.status === OrderStatus.CANCELED) return OrderStatus.CANCELED;

        // If items exist, check their status to advance the bar
        if (items.length > 0) {
            // LÓGICA CORRIGIDA: Só fica PRONTO se TODOS os itens estiverem prontos ou entregues
            const allReady = items.every(i => i.status === OrderStatus.READY || i.status === OrderStatus.DELIVERED);
            if (allReady) return OrderStatus.READY;

            // Se algum estiver preparando OU pronto (mas não todos), mostra Preparando
            const isWorking = items.some(i => i.status === OrderStatus.PREPARING || i.status === OrderStatus.READY);
            if (isWorking) return OrderStatus.PREPARING;

            // Se algum foi aceito
            const isAccepted = items.some(i => i.status === OrderStatus.ACCEPTED);
            if (isAccepted) return OrderStatus.ACCEPTED;
        }

        return order.status; // Fallback to order status (Pending/Accepted)
    }, [order, items]);

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

    const getItemStatusIcon = (status: OrderStatus) => {
        switch (status) {
            case OrderStatus.PENDING: return <Badge color="bg-[var(--warn)]/10 text-[var(--warn)]"><Clock size={12} className="mr-1"/> Enviado</Badge>;
            case OrderStatus.ACCEPTED: return <Badge color="bg-[var(--warn)]/15 text-[var(--warn)]"><ChefHat size={12} className="mr-1"/> Aceito</Badge>;
            case OrderStatus.PREPARING: return <Badge color="bg-[var(--info)]/10 text-[var(--info)]"><UtensilsCrossed size={12} className="mr-1"/> Preparando</Badge>;
            case OrderStatus.READY: return <Badge color="bg-[var(--ok)]/10 text-[var(--ok)]"><BellRing size={12} className="mr-1"/> Pronto</Badge>;
            case OrderStatus.DELIVERED: return <Badge color="bg-[var(--surface-2)] text-[var(--text-muted)]"><CheckCircle size={12} className="mr-1"/> Entregue</Badge>;
            default: return null;
        }
    };

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

    const steps = [
        { status: OrderStatus.PENDING, label: 'Enviado', icon: CheckCircle },
        { status: OrderStatus.ACCEPTED, label: 'Aceito', icon: ChefHat },
        { status: OrderStatus.PREPARING, label: 'Preparando', icon: Clock },
        { status: OrderStatus.READY, label: 'Pronto!', icon: BellRing },
    ];

    const currentStepIndex = steps.findIndex(s => s.status === derivedStatus) !== -1
        ? steps.findIndex(s => s.status === derivedStatus)
        : (derivedStatus === OrderStatus.DELIVERED ? 4 : 0);

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
                        {/* Linha do Tempo */}
                        <div className="w-full max-w-md space-y-6 relative pb-6 border-b border-[var(--border)]">
                             <div className="absolute left-6 top-6 bottom-6 w-1 bg-[var(--border)] -z-10"></div>

                             {steps.map((step, idx) => {
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

                        {/* Lista de Itens Detalhada */}
                        <div className="w-full max-w-md bg-[var(--surface)] rounded-[var(--r-lg)] shadow-sm border border-[var(--border)] overflow-hidden">
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
                                            {getItemStatusIcon(item.status)}
                                        </div>
                                    </div>
                                ))}
                                {items.length === 0 && <p className="p-4 text-center text-[var(--text-muted)] text-sm">Carregando itens...</p>}
                            </div>
                        </div>

                        <div className="p-2 text-center text-xs text-[var(--text-muted)]">
                             Aguarde chamar seu nome ou número no painel.
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

const LoginScreen: React.FC<{ onLogin: (name: string, tableId: string | null, isHost?: boolean, table?: Table | null) => void, storeSlug: string, store: Store | null }> = ({ onLogin, storeSlug, store }) => {
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

    if (isLoading) return <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]"><span className="text-[var(--text-muted)] text-sm animate-pulse">Carregando...</span></div>;

    return (
        <AuthBackdrop>
          <div className="w-full max-w-sm flex flex-col items-center">
            <div className="mb-7 text-center">
                {store?.logo_url ? (
                    <Image src={store.logo_url} alt={`Logo de ${store.name}`} width={80} height={80} className="w-20 h-20 rounded-[1.4rem] mx-auto mb-4 object-cover border-2 border-white/40" style={{ boxShadow: '0 18px 40px -12px rgba(0,0,0,0.4)' }} />
                ) : (
                    <div className="w-16 h-16 rounded-[1.4rem] flex items-center justify-center mx-auto mb-4 text-white bg-white/12 backdrop-blur-sm border border-white/25" style={{ animation: '3s ease-in-out infinite icon-float' }}>
                        <Coffee size={26}/>
                    </div>
                )}
                <h1 className="text-2xl font-bold text-white tracking-tight mb-1">{store?.name || 'Cardápio Digital'}</h1>
                <p className="text-white/75 text-sm">Faça seu pedido direto pelo celular</p>
            </div>
            <Card className="u-grow-in w-full p-6 space-y-5" style={{ boxShadow: '0 30px 60px -18px rgba(30,27,75,0.5)' }}>
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
        </AuthBackdrop>
    );
};

// Extraído do .map() de renderização do cardápio — memoizado pra evitar
// que a lista inteira de produtos re-renderize a cada ação de carrinho
// (achado de performance #7). Também navegável por teclado: é um
// <button> de verdade (Tab foca, Enter/Space aciona), em vez do <div
// onClick> anterior (achado de UX #1).
// Linha de "carta de vinhos" (não mais card com placeholder de foto): sem
// fotos reais ainda pra a maioria dos 248 produtos, um card com caixa cinza
// vazia parece quebrado. A fila tipográfica (medalhão com ícone da
// categoria, nome, etiqueta de origem, preço em dourado) fica intencional
// com ou sem imagem — quando a foto chegar, ela só substitui o medalhão.
const ProductCard = React.memo(function ProductCard({ product, onSelect, onQuickAdd, disabled, style, icon: Icon = UtensilsCrossed, isBestseller, isFavorite, onToggleFavorite }: {
    product: Product,
    onSelect: (product: Product) => void,
    onQuickAdd?: (product: Product) => void,
    disabled?: boolean,
    style?: React.CSSProperties,
    icon?: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>,
    // Vende mais II (migration 020): badge calculado (não é PRODUCT_TAGS) e
    // favorito 100% client-side (localStorage) — ambos opcionais pra não
    // quebrar nenhum outro caller existente do ProductCard.
    isBestseller?: boolean,
    isFavorite?: boolean,
    onToggleFavorite?: (productId: string) => void,
}) {
    const open = () => { if (!disabled) onSelect(product); };
    const { clean, origin } = parseOrigin(product.name);
    return (
        <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            onClick={open}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
            aria-disabled={disabled}
            className={`u-grow-in group flex items-start gap-3 py-3.5 px-1.5 text-left w-full u-motion border-b border-dotted border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]/60 rounded-[var(--r-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] ${disabled ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}`}
            style={style}
        >
            <div
                className="w-11 h-11 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center mt-0.5"
                style={{ background: product.image_url ? undefined : 'rgba(212,175,92,0.14)' }}
            >
                {product.image_url ? (
                    <Image src={product.image_url} alt={product.name} width={44} height={44} className="w-full h-full object-cover u-motion group-hover:scale-105" />
                ) : (
                    <Icon size={18} style={{ color: WINE_GOLD_DARK }} />
                )}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold text-[var(--text)] leading-snug text-[14.5px]">
                        {clean}
                        {/* Badges (migration 019): só o emoji aqui, discreto — a carta de
                            vinhos não pode virar poluição visual. Label completo só no
                            ProductModal (detalhe expandido). */}
                        {product.tags.length > 0 && (
                            <span
                                className="ml-1.5 text-[12px] align-middle"
                                title={product.tags.map(t => getTagDisplay(t).label).join(', ')}
                            >
                                {product.tags.map(t => getTagDisplay(t).emoji).filter(Boolean).join(' ')}
                            </span>
                        )}
                        {/* "Mais vendido" (migration 020, Vende Mais II): calculado a
                            partir de venda real (get_bestseller_product_ids), não é
                            tag manual do catálogo — por isso ganha fundo/borda própria
                            em vez de só emoji solto, pra não ser confundido com
                            PRODUCT_TAGS. */}
                        {isBestseller && (
                            // Cor via token de tema (--warn), já calibrado pra AA (>=4.5:1)
                            // em claro e escuro numa rodada de acessibilidade anterior —
                            // mesmo padrão usado nos outros badges deste arquivo (ex.: status
                            // de pedido), em vez de hex fixo sem variante dark.
                            <span
                                className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full align-middle whitespace-nowrap bg-[var(--warn)]/12 text-[var(--warn)]"
                                title="Um dos produtos mais vendidos desta loja"
                            >
                                🔥 Mais vendido
                            </span>
                        )}
                    </h3>
                    {/* Preço promocional (migration 019): cheio riscado + efetivo em
                        destaque (mesmo dourado de sempre). getEffectivePrice é a mesma
                        fonte que já decide quanto o carrinho cobra (lib/calc.ts).
                        Favoritar (Vende Mais II, 100% client-side): coração empilhado
                        acima do preço, mesmo canto — stopPropagation pra não abrir o
                        modal (o card inteiro já é clicável). */}
                    <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                        {onToggleFavorite && (
                            // Alvo de toque real de 44x44 (padrão do projeto) sem alterar o
                            // layout compacto do card: padding aumenta a caixa clicável e a
                            // margem negativa equivalente cancela o espaço extra reservado no
                            // fluxo, então o ícone continua visualmente pequeno e no mesmo
                            // lugar — só a área de toque invisível fica maior ao redor dele.
                            <button
                                type="button"
                                aria-label={isFavorite ? `Remover ${product.name} dos favoritos` : `Favoritar ${product.name}`}
                                onClick={(e) => { e.stopPropagation(); onToggleFavorite(product.id); }}
                                className="p-[15px] -m-[15px] text-[var(--text-muted)] hover:text-[var(--err)] u-motion"
                            >
                                <Heart size={14} className={isFavorite ? 'fill-[var(--err)] text-[var(--err)]' : ''} />
                            </button>
                        )}
                        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                            {hasActivePromo(product) && (
                                <span className="text-[11.5px] text-[var(--text-muted)] line-through num">R$ {product.price.toFixed(2)}</span>
                            )}
                            <span className="font-bold num text-[15px]" style={{ color: WINE_GOLD }}>R$ {getEffectivePrice(product).toFixed(2)}</span>
                        </span>
                    </div>
                </div>
                {(origin || product.description) && (
                    <div className="flex items-center gap-2 mt-1">
                        {origin && (
                            <span
                                className="text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded-[3px] border flex-shrink-0"
                                style={{ borderColor: 'rgba(212,175,92,0.4)', color: WINE_GOLD }}
                            >
                                {origin}
                            </span>
                        )}
                        {product.description && (
                            <p className="text-[12px] text-[var(--text-muted)] line-clamp-1 min-w-0">{product.description}</p>
                        )}
                    </div>
                )}
                <div className="flex items-center justify-between mt-1.5 min-h-[32px]">
                    {!!product.prep_time_minutes ? (
                        <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                            <Clock size={11} /> {product.prep_time_minutes} min
                        </span>
                    ) : <span />}
                    {onQuickAdd && (
                        <button
                            type="button"
                            aria-label={`Adicionar ${product.name}`}
                            onClick={(e) => { e.stopPropagation(); if (!disabled) onQuickAdd(product); }}
                            className="w-8 h-8 rounded-full bg-[var(--brand)] text-white flex items-center justify-center shadow-sm u-motion u-press hover:bg-[var(--brand-strong)] flex-shrink-0"
                        >
                            <Plus size={17} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
});
ProductCard.displayName = 'ProductCard';

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
}> = ({ product, onClose, onAdd, noteSuggestions = [], onSelectRecommended, isFavorite, onToggleFavorite, visibleCategoryIds }) => {
    const [qty, setQty] = useState(1);
    const [notes, setNotes] = useState('');
    const [selections, setSelections] = useState<Record<string, string[]>>({}); // group_id -> option_id[]

    useEffect(() => {
        if (!product) return;
        setQty(1);
        setNotes('');

        // Reduz atrito: grupo unico obrigatorio (ex. "Tamanho" P/M/G) vem com a
        // 1a opcao disponivel ja pre-selecionada, em vez de forcar o cliente a
        // clicar numa escolha que teria que fazer de qualquer forma. Defesa
        // client-side extra com `available !== false` mesmo o servidor
        // (fetchMenu) ja filtrando por available=true por padrao.
        const initialSelections: Record<string, string[]> = {};
        (product.option_groups || []).forEach(group => {
            if (group.type === 'single' && group.required) {
                const firstAvailable = group.options.find(opt => opt.available !== false);
                if (firstAvailable) initialSelections[group.id] = [firstAvailable.id];
            }
        });
        setSelections(initialSelections);
    }, [product]);

    if (!product) return null;

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
        <Modal isOpen={!!product} onClose={onClose} title={product.name}>
            <div className="relative space-y-4">
                {/* Favoritar (Vende Mais II, 100% client-side, localStorage) — canto
                    superior direito do modal, sobrepõe a foto quando existe; sem
                    foto, fica sobre a descrição, mesmo canto. */}
                <button
                    type="button"
                    aria-label={isFavorite ? `Remover ${product.name} dos favoritos` : `Favoritar ${product.name}`}
                    onClick={() => onToggleFavorite(product.id)}
                    className="absolute top-0 right-0 z-10 p-2 rounded-full bg-[var(--surface)]/85 backdrop-blur-sm border border-[var(--border)] u-motion u-press-sm"
                >
                    <Heart size={18} className={isFavorite ? 'fill-[var(--err)] text-[var(--err)]' : 'text-[var(--text-muted)]'} />
                </button>
                {product.image_url && (
                    <div className="relative w-full h-56 rounded-xl overflow-hidden shadow-sm">
                        <Image src={product.image_url} alt={product.name} fill sizes="(max-width: 640px) 100vw, 480px" className="object-cover" />
                    </div>
                )}
                <p className="text-[var(--text-muted)] leading-relaxed">{product.description}</p>

                {/* Badges (migration 019): aqui, detalhe expandido, emoji + label
                    completo — no ProductCard (linha da lista) é só o emoji. */}
                {product.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {product.tags.map(tag => {
                            const { label, emoji } = getTagDisplay(tag);
                            return (
                                <span
                                    key={tag}
                                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full border"
                                    style={{ borderColor: 'rgba(212,175,92,0.35)', color: WINE_GOLD_DARK, background: 'rgba(212,175,92,0.08)' }}
                                >
                                    {emoji} {label}
                                </span>
                            );
                        })}
                    </div>
                )}

                <div className="flex items-center justify-between bg-[var(--surface-2)] px-4 py-3 rounded-[var(--r-md)] border border-[var(--border)]">
                    {hasActivePromo(product) ? (
                        <span className="flex items-baseline gap-2">
                            <span className="text-sm text-[var(--text-muted)] line-through num">R$ {product.price.toFixed(2)}</span>
                            <span className="text-xl font-semibold num" style={{ color: WINE_GOLD }}>R$ {getEffectivePrice(product).toFixed(2)}</span>
                        </span>
                    ) : (
                        <span className="text-xl font-semibold text-[var(--brand)] num">R$ {product.price.toFixed(2)}</span>
                    )}
                    <div className="flex items-center gap-3 bg-[var(--surface)] px-1.5 py-1 rounded-[var(--r-sm)] border border-[var(--border)]" style={{boxShadow:'var(--shadow-sm)'}}>
                        <button onClick={() => setQty(Math.max(1, qty - 1))} className="min-w-11 min-h-11 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] rounded-[var(--r-sm)] u-motion"><Minus size={16} /></button>
                        <span className="font-semibold text-[var(--text)] w-6 text-center num">{qty}</span>
                        <button onClick={() => setQty(q => Math.min(99, q + 1))} className="min-w-11 min-h-11 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] rounded-[var(--r-sm)] u-motion"><Plus size={16} /></button>
                    </div>
                </div>

                {/* "Peça também" (migration 020, Vende Mais II): cross-sell manual
                    do lojista (product_recommendations), já resolvido pelo
                    fetchMenu contra a lista de produtos da loja (indisponível/
                    excluído já filtrado antes de chegar em product.recommended_products).
                    Cards compactos em linha rolável; clicar troca o produto do
                    próprio modal (onSelectRecommended -> setSelectedProduct no
                    ClientModule, mesmo mecanismo de estado de sempre). */}
                {!!availableRecommended.length && (
                    <div>
                        <h4 className="text-[13px] font-semibold text-[var(--text)] mb-2 flex items-center gap-1.5">
                            <Sparkles size={13} style={{ color: WINE_GOLD }} /> Peça também
                        </h4>
                        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
                            {availableRecommended.map(rec => (
                                <button
                                    key={rec.id}
                                    type="button"
                                    onClick={() => onSelectRecommended(rec)}
                                    className="flex-shrink-0 w-24 text-left border border-[var(--border)] rounded-[var(--r-md)] overflow-hidden bg-[var(--surface)] u-motion hover:border-[var(--brand)]"
                                >
                                    <div className="w-full h-16 bg-[var(--surface-2)] flex items-center justify-center overflow-hidden">
                                        {rec.image_url ? (
                                            <Image src={rec.image_url} alt={rec.name} width={96} height={64} className="w-full h-full object-cover" />
                                        ) : (
                                            <UtensilsCrossed size={16} className="text-[var(--text-muted)]/40" />
                                        )}
                                    </div>
                                    <div className="p-1.5">
                                        <p className="text-[11px] font-medium text-[var(--text)] leading-tight line-clamp-2">{rec.name}</p>
                                        <p className="text-[11px] font-bold num mt-0.5" style={{ color: WINE_GOLD }}>R$ {getEffectivePrice(rec).toFixed(2)}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {groups.map(group => {
                    // Defesa client-side extra: o servidor (fetchMenu) já filtra
                    // product_options por available=true por padrão, mas manter
                    // o filtro aqui também, caso a opção chegue por outro caminho.
                    const visibleOptions = group.options.filter(opt => opt.available !== false);
                    const groupSelections = selections[group.id] || [];
                    const hasMaxLimit = group.type === 'multiple' && typeof group.max_select === 'number';
                    const atMaxLimit = hasMaxLimit && groupSelections.length >= (group.max_select as number);

                    return (
                        <fieldset key={group.id} className="border border-[var(--border)] rounded-lg p-3">
                            <legend className="w-full flex items-center justify-between gap-2 mb-2 px-1">
                                <span className="font-semibold text-sm text-[var(--text)]">{group.name}</span>
                                {group.required && <Badge color="bg-[var(--warn)]/10 text-[var(--warn)]">Obrigatório</Badge>}
                            </legend>
                            {hasMaxLimit && (
                                <p className="text-xs text-[var(--text-muted)] mb-1.5">
                                    {groupSelections.length} de {group.max_select} selecionados
                                </p>
                            )}
                            {visibleOptions.map(opt => {
                                const isChecked = groupSelections.includes(opt.id);
                                const isDisabled = atMaxLimit && !isChecked;
                                return (
                                    <label key={opt.id} className={`flex items-center justify-between py-1.5 min-h-11 cursor-pointer ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                        <span className="flex items-center gap-2 text-sm text-[var(--text)]">
                                            <input
                                                type={group.type === 'single' ? 'radio' : 'checkbox'}
                                                name={`group-${group.id}`}
                                                checked={isChecked}
                                                disabled={isDisabled}
                                                aria-required={group.required}
                                                onChange={() => toggleOption(group, opt.id)}
                                            />
                                            {opt.name}
                                        </span>
                                        {opt.price_delta > 0 && <span className="num text-[var(--text-muted)] text-sm">+R$ {opt.price_delta.toFixed(2)}</span>}
                                    </label>
                                );
                            })}
                        </fieldset>
                    );
                })}

                {/* Chips de observação rápida (migration 019, stores.config.note_suggestions,
                    editado pelo lojista em MenuManagementView) — atalho de digitação, não
                    é toggle: clicar só acrescenta o texto, o cliente ainda edita livremente
                    depois. Some inteiro quando a loja não configurou nenhuma sugestão. */}
                {noteSuggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {noteSuggestions.map((suggestion, idx) => (
                            <button
                                key={idx}
                                type="button"
                                onClick={() => setNotes(prev => prev.trim() ? `${prev.trim()}, ${suggestion}` : suggestion)}
                                className="inline-flex items-center min-h-11 text-[12px] font-medium px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] hover:border-[var(--brand)] hover:text-[var(--text)] u-motion u-press-sm"
                            >
                                {suggestion}
                            </button>
                        ))}
                    </div>
                )}

                <Input
                    label="Observações"
                    placeholder="Ex: Tirar cebola, ponto da carne..."
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                />

                <Button className="w-full mt-4 h-12 text-lg" disabled={missingRequired} onClick={() => { onAdd(qty, notes, selectedOptions); onClose(); }}>
                    Adicionar • R$ {(unitPrice * qty).toFixed(2)}
                </Button>
                {missingRequired && <p className="text-xs text-center text-[var(--err)]">Escolha uma opção obrigatória para continuar.</p>}
            </div>
        </Modal>
    );
};

const CartModal: React.FC<{
    isOpen: boolean,
    onClose: () => void,
    cart: CartItem[],
    onConfirm: () => void,
    isLoading: boolean,
    total: number,
    onUpdateQty: (item: CartItem, delta: number) => void,
    onRemove: (item: CartItem) => void
}> = ({ isOpen, onClose, cart, onConfirm, isLoading, total, onUpdateQty, onRemove }) => {
    if(!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] animate-[fadeIn_0.2s_ease-out]">
            <div className="w-full max-w-md bg-[var(--surface)] rounded-t-[var(--r-lg)] sm:rounded-[var(--r-lg)] overflow-hidden animate-[slideUp_0.25s_cubic-bezier(0.22,1,0.36,1)] flex flex-col max-h-[90vh]" style={{boxShadow:'var(--shadow-md), 0 0 0 1px var(--border)'}}>
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
                                {item.product.image_url ? (
                                    <Image src={item.product.image_url} alt="" width={56} height={56} className="w-14 h-14 rounded-[var(--r-sm)] object-cover bg-[var(--surface-2)] flex-shrink-0" />
                                ) : (
                                    <div className="w-14 h-14 rounded-[var(--r-sm)] bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-muted)]/40 flex-shrink-0">
                                        <Coffee size={18}/>
                                    </div>
                                )}
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
                                                    R$ {((item.product.price + (item.selectedOptions || []).reduce((a, o) => a + o.price_delta, 0)) * item.quantity).toFixed(2)}
                                                </span>
                                                <span className="font-semibold text-sm num" style={{ color: WINE_GOLD }}>R$ {(calculateCartItemUnitPrice(item) * item.quantity).toFixed(2)}</span>
                                            </span>
                                        ) : (
                                            <span className="font-semibold text-[var(--text)] text-sm num flex-shrink-0">R$ {(calculateCartItemUnitPrice(item) * item.quantity).toFixed(2)}</span>
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
                        <span className="num">R$ {total.toFixed(2)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <Button variant="secondary" onClick={onClose}>
                            Adicionar Mais
                        </Button>
                        <Button onClick={onConfirm} isLoading={isLoading} disabled={cart.length === 0}>
                            Confirmar Pedido
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

const BillSplitter: React.FC<{ onClose: () => void, tableId: string, storeId: string, clientName: string, isWaitingBill: boolean, currentStore: Store | null, currentTable: Table | null }> = ({ onClose, tableId, storeId, clientName, isWaitingBill, currentStore, currentTable }) => {
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
    const [serviceFeeRate, setServiceFeeRate] = useState(0.10);

    useEffect(() => {
        const loadBill = async () => {
            setIsLoading(true);
            const data = await fetchTableOrderSummary(tableId);

            // Fetch fresh table and store data to ensure we have the latest config.
            // Colunas explícitas (SEM `pin`) — select('*') aqui vazava o PIN da mesa
            // pra qualquer convidado que abrisse "Dividir Conta", não só o anfitrião.
            const { data: tableData } = await supabase.from('tables').select('id, store_id, number, status, current_host_name, guest_count, waiter_requested, service_fee_removed').eq('id', tableId).single();
            let storeConfig = currentStore?.config;
            if (tableData?.store_id) {
                const { data: storeData } = await supabase.from('stores').select('config').eq('id', tableData.store_id).single();
                if (storeData) storeConfig = storeData.config;
            }

            // Calculate service fee
            const isFeeEnabled = !!(storeConfig?.charge_service_fee && !tableData?.service_fee_removed);
            const feeRate = storeConfig?.service_fee_rate ?? 0.10;
            const calculatedSubtotal = data.total;
            const calculatedServiceFee = isFeeEnabled ? calculateServiceFee(calculatedSubtotal, feeRate) : 0;

            setSubtotal(calculatedSubtotal);
            setServiceFee(calculatedServiceFee);
            setTotal(calculateOrderTotal(calculatedSubtotal, isFeeEnabled, feeRate));
            setIsServiceFeeEnabled(isFeeEnabled);
            setServiceFeeRate(feeRate);

            setItems(data.items);
            setIsLoading(false);
        };
        loadBill();

        const channel = supabase.channel(`bill_${tableId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items', filter: `store_id=eq.${storeId}` }, () => loadBill())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tables', filter: `id=eq.${tableId}` }, () => loadBill())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'stores', filter: `id=eq.${storeId}` }, () => loadBill())
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [tableId, storeId]);

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

    const hasPendingItems = useMemo(() => {
        return items.some(i => i.status === 'pending' || i.status === 'accepted');
    }, [items]);

    const handleRequestBill = async (cancelPending = false) => {
        setIsClosing(true);
        try {
            if (cancelPending) {
                await cancelPendingTableItems(tableId);
            }
            await requestTableBill(tableId);
            toast.success("Conta solicitada com sucesso! O garçom trará a conta em instantes.");
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

                     {hasPendingItems && (
                         <div className="bg-[var(--err)]/8 p-4 rounded-[var(--r-lg)] border border-[var(--err)]/20 text-left">
                             <div className="flex items-start gap-2">
                                 <AlertTriangle className="text-[var(--err)] flex-shrink-0 mt-0.5" size={20}/>
                                 <div>
                                     <p className="font-bold text-[var(--err)]">Itens Pendentes</p>
                                     <p className="text-sm text-[var(--text-muted)] mt-1">
                                         Existem pedidos que ainda não começaram a ser preparados pela cozinha.
                                     </p>
                                 </div>
                             </div>
                         </div>
                     )}

                     <div className="flex flex-col gap-3">
                         {hasPendingItems ? (
                             <>
                                <Button
                                    variant="danger"
                                    className="w-full"
                                    onClick={() => handleRequestBill(true)}
                                    isLoading={isClosing}
                                >
                                    Cancelar Pendentes e Fechar
                                </Button>
                                <Button
                                    className="w-full"
                                    onClick={() => handleRequestBill(false)}
                                    isLoading={isClosing}
                                >
                                    Manter Pendentes e Fechar
                                </Button>
                             </>
                         ) : (
                             <Button
                                className="w-full h-12 text-lg"
                                onClick={() => handleRequestBill(false)}
                                isLoading={isClosing}
                            >
                                Sim, Fechar Conta
                            </Button>
                         )}
                         <Button variant="secondary" onClick={() => setShowCloseConfirmation(false)}>
                             Voltar
                         </Button>
                     </div>
                 </div>
             </Modal>
        );
    }

    return (
        <Modal isOpen={true} onClose={onClose} title="Conta da Mesa">
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
                                        <p className="text-3xl font-black text-[var(--brand)] mt-1 num">R$ {total.toFixed(2)}</p>
                                        {isServiceFeeEnabled && (
                                            <p className="text-xs text-[var(--text-muted)] mt-1">Inclui R$ {serviceFee.toFixed(2)} de taxa de serviço ({(serviceFeeRate * 100).toFixed(0)}% opcional)</p>
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
                                        <p className="text-2xl font-bold text-[var(--text)] num">R$ {(total / people).toFixed(2)}</p>
                                    </div>
                                    {/* List All Items for Context */}
                                    <div className="mt-4 pt-4 border-t border-[var(--border)]">
                                        <p className="text-xs text-[var(--text-muted)] font-bold uppercase mb-2">Itens da Mesa</p>
                                        <ul className="text-sm space-y-1 text-[var(--text-muted)]">
                                            {items.map((it, idx) => (
                                                <li key={idx} className="flex justify-between items-center py-1">
                                                    <div className="flex items-center gap-2">
                                                        <span>{it.quantity}x {getOrderItemDisplayName(it)}</span>
                                                        {getItemStatusBadge(it.status)}
                                                    </div>
                                                    <span>{(it.price_at_time * it.quantity).toFixed(2)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                            )}

                            {/* TAB 2: BY USER */}
                            {tab === 'users' && (
                                <div className="space-y-4 animate-fade-in pt-2">
                                    {Object.entries(usersBreakdown).map(([name, data]: [string, any]) => (
                                        <div key={name} className="border border-[var(--border)] rounded-[var(--r-lg)] overflow-hidden">
                                            <div className="bg-[var(--surface-2)] p-3 flex justify-between items-center border-b border-[var(--border)]">
                                                <span className="font-bold text-[var(--text)] flex items-center gap-2"><User size={14}/> {name}</span>
                                                <span className="font-bold text-[var(--brand)] num">R$ {data.total.toFixed(2)}</span>
                                            </div>
                                            <div className="p-2 space-y-1">
                                                {data.items.map((it: any) => (
                                                    <div key={it.id} className="flex justify-between items-center text-xs text-[var(--text-muted)] px-2 py-1">
                                                        <div className="flex items-center gap-1.5">
                                                            {getItemStatusBadge(it.status)}
                                                            <span>{it.quantity}x {getOrderItemDisplayName(it)}</span>
                                                        </div>
                                                        <span className="num">{(it.price_at_time * it.quantity).toFixed(2)}</span>
                                                    </div>
                                                ))}
                                                {isServiceFeeEnabled && (
                                                    <div className="flex justify-between items-center text-xs text-[var(--text-muted)] px-2 py-1 border-t border-[var(--border)] mt-1 pt-1">
                                                        <span>Taxa de Serviço ({(serviceFeeRate * 100).toFixed(0)}%)</span>
                                                        <span className="num">{data.serviceFee.toFixed(2)}</span>
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
                                                        <span className="text-sm font-medium num">R$ {item.price_at_time.toFixed(2)}</span>
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
                                        <span className="font-black text-xl num">R$ {calculatorTotal.toFixed(2)}</span>
                                    </div>
                                    {isServiceFeeEnabled && (
                                        <div className="text-xs text-white/50 mt-1 text-right">
                                            Inclui R$ {calculatorServiceFee.toFixed(2)} de taxa de serviço
                                        </div>
                                    )}
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

    // Barra de categorias: arrastável com o mouse (desktop) + auto-scroll da
    // categoria ativa pra dentro da vista. No mobile o toque já rola nativo.
    const navScrollRef = useRef<HTMLDivElement>(null);
    const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
    const navDrag = useRef({ down: false, moved: false, startX: 0, startScroll: 0 });
    const onNavDown = (e: React.MouseEvent) => {
        const el = navScrollRef.current; if (!el) return;
        navDrag.current = { down: true, moved: false, startX: e.pageX, startScroll: el.scrollLeft };
    };
    const onNavMove = (e: React.MouseEvent) => {
        if (!navDrag.current.down) return;
        const el = navScrollRef.current; if (!el) return;
        const dx = e.pageX - navDrag.current.startX;
        if (Math.abs(dx) > 3) navDrag.current.moved = true;
        el.scrollLeft = navDrag.current.startScroll - dx;
    };
    const onNavUp = () => { navDrag.current.down = false; };
    useEffect(() => {
        const el = chipRefs.current[activeCategory];
        el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }, [activeCategory]);
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [showBill, setShowBill] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const isSubmittingOrderRef = useRef(false);

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
    const [isCartOpen, setIsCartOpen] = useState(false);

    // Tracker State
    const [trackedOrderId, setTrackedOrderId] = useState<string | null>(null);
    const [isCounterConfirmOpen, setIsCounterConfirmOpen] = useState(false);

    const {
        clientName, setClientName,
        setCurrentStore, currentStore,
        setCurrentTable, currentTable, setCurrentTable: setGlobalTable,
        addToCart, removeFromCart, cart, clearCart,
        setIsHost, isHost
    } = useApp();

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
        // Cardapio por horario (migration 018): comeca ja na 1a categoria
        // disponivel AGORA, nao so a 1a da lista (que pode estar fora da
        // janela de horario) — evita abrir o cardapio numa categoria vazia.
        if (categories.length > 0) {
            const firstAvailable = categories.find(c => isCategoryAvailableNow(c)) || categories[0];
            setActiveCategory(firstAvailable.id);
        }
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

    // Realtime Table Status Listener
    useEffect(() => {
        if (currentTable) {
            const channel = supabase.channel(`table_status_${currentTable.id}`)
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables', filter: `id=eq.${currentTable.id}` },
                (payload) => {
                    // O Realtime manda a linha inteira (incluindo pin) em todo UPDATE;
                    // removemos aqui como defesa em profundidade para não deixar o PIN
                    // real acessível no estado React de um convidado (não-host).
                    const newTable = { ...(payload.new as Table), pin: undefined as any };
                    setGlobalTable(newTable);

                    // If session closed, force logout
                    if(newTable.status === TableStatus.AVAILABLE) {
                         toast.info("A mesa foi fechada pelo restaurante. Obrigado!", 3000);
                         localStorage.removeItem(`session_${slug}`);
                         setTimeout(() => window.location.reload(), 2500);
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
    };

    const handleLogout = async (force = false) => {
        if(force || await confirm("Deseja realmente sair? Se você for o anfitrião, a mesa continuará aberta.")) {
            localStorage.removeItem(`session_${slug}`);
            setTrackedOrderId(null);

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
            const result = await createOrder(tableId, currentStore.id, cart, clientName);

            if (result.success) {
                 clearCart();
                 setIsCartOpen(false);

                 // If Counter, start tracking (NO PERSISTENCE)
                 if (!currentTable && result.orderId) {
                     setTrackedOrderId(result.orderId);
                     setIsCounterConfirmOpen(false); // Close the counter alert
                 } else {
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

    // Se a categoria ativa deixar de estar disponivel (relogio virou durante
    // a visita do cliente), troca automaticamente pra primeira categoria
    // ainda disponivel — nao existe hoje nenhuma aba "Todas" no cardapio do
    // cliente (activeCategory sempre aponta pra uma categoria concreta desde
    // o load inicial), entao "mostrar tudo" nao é o padrao aplicavel aqui.
    useEffect(() => {
        if (visibleCategories.length === 0) return;
        if (!visibleCategories.some(c => c.id === activeCategory)) {
            setActiveCategory(visibleCategories[0].id);
        }
    }, [visibleCategories, activeCategory]);

    const filteredProducts = useMemo(() => {
        let prods = [...products]; // Create a copy to avoid mutating state directly

        if (activeCategory) {
            // Produtos de uma categoria que acabou de sair da janela de horario
            // (ainda nao corrigido pelo efeito acima) tambem somem — nunca
            // mostra produto de categoria que nao esta na barra.
            const isActiveVisible = visibleCategories.some(c => c.id === activeCategory);
            prods = isActiveVisible ? prods.filter(p => p.category_id === activeCategory) : [];
        }
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            // Busca por descrição (migration 019): além do nome, também bate se o
            // termo aparecer na descrição do produto — descrição é opcional, daí
            // o `?.` (produto sem descrição simplesmente não casa por esse lado).
            prods = prods.filter(p => p.name.toLowerCase().includes(term) || p.description?.toLowerCase().includes(term));
        }
        // Favoritos (Vende Mais II, 100% client-side): mesmo padrão cumulativo
        // que a busca por texto já usa aqui em cima — categoria ativa (e busca)
        // continuam valendo, isso só restringe ainda mais (AND, não substitui).
        if (favoritesOnly) {
            prods = prods.filter(p => favoriteIds.has(p.id));
        }

        // Sorting Logic
        // getEffectivePrice (migration 019): produto com promoção ativa tem que
        // ordenar pelo preço que o cliente realmente paga, não o cheio — senão
        // um item em promoção pode aparecer fora de ordem em "menor preço".
        if (sortBy === 'price_asc') {
            prods.sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b));
        } else if (sortBy === 'price_desc') {
            prods.sort((a, b) => getEffectivePrice(b) - getEffectivePrice(a));
        } else if (sortBy === 'name_asc') {
            prods.sort((a, b) => a.name.localeCompare(b.name));
        }

        return prods;
    }, [products, activeCategory, visibleCategories, searchTerm, sortBy, favoritesOnly, favoriteIds]);

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

    const categoryIconById = useMemo(() => {
        const map: Record<string, ReturnType<typeof categoryIcon>> = {};
        categories.forEach(c => { map[c.id] = categoryIcon(c.name); });
        return map;
    }, [categories]);
    const activeCategoryObj = useMemo(() => visibleCategories.find(c => c.id === activeCategory) || null, [visibleCategories, activeCategory]);

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

    if (!hasAccess) return <LoginScreen onLogin={handleLogin} storeSlug={slug || ''} store={currentStore} />;

    // TRACKER MODE INTERCEPT
    if (trackedOrderId) {
        return <OrderTracker orderId={trackedOrderId} onReset={handleResetTracker} onLogout={() => handleLogout(true)} />;
    }

    const isWaitingBill = currentTable?.status === TableStatus.WAITING_BILL;

    return (
        <div className="bg-[var(--bg)] min-h-screen pb-32">
            {/* Header — banda de marca fixa (sempre --ink, não segue claro/escuro,
                mesmo princípio do AuthBackdrop): é a "capa" da carta, rola junto
                com a página em vez de ficar fixa, pra abrir espaço pro conteúdo. */}
            <header className="relative overflow-hidden px-5 pt-5 pb-6" style={{ background: 'var(--ink)' }}>
                <svg className="absolute -bottom-2 right-0 w-[65%] h-auto opacity-[0.07] pointer-events-none" viewBox="0 0 1443 912" fill="none" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
                    <path d="M1443 203.5C1443 203.5 1156.08 94.5 868.5 293.5C580.92 492.5 558.996 755 582.5 911.5H1443V203.5Z" fill="#FFFFFF" />
                </svg>
                <div className="relative flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: WINE_GOLD }}>Norte Para Negócios</span>
                        <h1 className="font-bold text-white text-[22px] leading-tight tracking-tight truncate mt-0.5">{currentStore.name}</h1>
                        <div className="flex items-center gap-1.5 text-[11px] mt-2 flex-wrap">
                            <span className="flex items-center gap-1 bg-white/10 border border-white/15 text-white/80 px-2 py-1 rounded-full">
                                <User size={10} /> {clientName} {isHost ? '(Host)' : ''}
                            </span>
                            {currentTable ? (
                                <span className="font-semibold text-white/90 bg-white/10 border border-white/15 px-2 py-1 rounded-full">Mesa {currentTable.number}</span>
                            ) : (
                                <span className="font-semibold px-2 py-1 rounded-full" style={{ color: WINE_GOLD, background: 'rgba(212,175,92,0.15)', border: '1px solid rgba(212,175,92,0.3)' }}>Balcão</span>
                            )}
                            {isHost && currentTable && hostPin && (
                                <div className="flex items-center gap-1 px-2 py-1 rounded-full cursor-pointer" style={{ color: WINE_GOLD, background: 'rgba(212,175,92,0.15)', border: '1px solid rgba(212,175,92,0.3)' }} onClick={() => setShowPin(!showPin)}>
                                    <span className="num font-semibold tracking-wider">{showPin ? hostPin : '••••'}</span>
                                    {showPin ? <EyeOff size={9} /> : <Eye size={9} />}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                        {currentTable && (
                            <button
                                onClick={() => setShowBill(true)}
                                className={`flex items-center gap-1 rounded-full text-[12px] font-semibold px-3 h-8 u-motion ${isWaitingBill ? 'bg-[var(--warn)] text-white' : 'bg-white/10 border border-white/15 text-white hover:bg-white/20'}`}
                            >
                                {isWaitingBill ? <Clock size={12} /> : <Receipt size={12} />} Conta
                            </button>
                        )}
                        <ThemeToggle className="w-8 h-8 rounded-full border border-white/15" variant="sidebar" />
                        <button onClick={() => handleLogout(false)} className="w-8 h-8 flex items-center justify-center bg-white/10 border border-white/15 text-white/80 hover:text-white hover:bg-white/20 rounded-full u-motion">
                            <LogOut size={14} />
                        </button>
                    </div>
                </div>
            </header>

            {/* Waiting Bill Banner */}
            {isWaitingBill && (
                <div className="bg-[var(--warn)] text-white px-4 py-2 text-center text-[13px] font-medium sticky top-0 z-30 flex items-center justify-center gap-2">
                    <Lock size={13}/> Conta Solicitada. Novos pedidos bloqueados.
                </div>
            )}

            {/* Vitrine de Destaques (migration 019) — faixa horizontal rolável no
                topo do cardápio, antes da navegação de categorias. Reusa o
                ProductCard normal (mesma linha editorial), só envolto num
                container de largura fixa pra virar "cartão" dentro do scroll
                horizontal; `last:border-0` do próprio ProductCard já remove o
                separador pontilhado de linha-de-lista porque cada um vira
                filho único do seu wrapper. Produto destacado continua
                aparecendo normalmente dentro da categoria dele também — esta
                vitrine é além, não em vez disso. */}
            {featuredProducts.length > 0 && (
                <div className={`px-4 pt-4 ${isWaitingBill ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
                    <div className="flex items-center gap-2 mb-1.5 u-grow-in">
                        <Star size={14} style={{ color: WINE_GOLD }} className="fill-current" />
                        <h2 className="font-bold text-[var(--text)] text-[17px] tracking-tight">Destaques</h2>
                        <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, rgba(212,175,92,0.5), transparent)' }} />
                    </div>
                    {/* Fade nas duas pontas sinalizando que dá pra rolar mais (útil em
                        desktop sem trackpad/touch, onde não há nenhuma outra pista
                        visual de overflow horizontal) — mesmo princípio do fade da
                        navegação de categorias logo abaixo, cor adaptada pro fundo
                        claro/escuro (--bg) desta seção. */}
                    <div className="relative">
                        <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-4 z-10" style={{ background: 'linear-gradient(to right, var(--bg), transparent)' }} />
                        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-10" style={{ background: 'linear-gradient(to left, var(--bg), transparent)' }} />
                        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1.5 px-1.5 pb-1" style={{ scrollSnapType: 'x proximity' }}>
                            {featuredProducts.map(product => (
                                <div
                                    key={product.id}
                                    className="w-64 flex-shrink-0 border border-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface)]"
                                    style={{ scrollSnapAlign: 'start' }}
                                >
                                    <ProductCard
                                        product={product}
                                        icon={categoryIconById[product.category_id || ''] || UtensilsCrossed}
                                        onSelect={setSelectedProduct}
                                        onQuickAdd={(p) => {
                                            if ((p.option_groups || []).length > 0) { setSelectedProduct(p); return; }
                                            addToCart(p, 1, '', []);
                                            toast.success(`${p.name} adicionado`);
                                        }}
                                        disabled={isWaitingBill}
                                        isBestseller={bestsellerIds.has(product.id)}
                                        isFavorite={favoriteIds.has(product.id)}
                                        onToggleFavorite={toggleFavorite}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Category Nav — banda de marca continua aqui: navegação com ícone
                por categoria, arrastável (mouse), rola no toque, degradê nas
                bordas. Fica grudada no topo ao rolar (a "capa" acima, não). */}
            <div className={`sticky ${isWaitingBill ? 'top-9' : 'top-0'} z-20`} style={{ background: 'var(--ink)' }}>
                <div className="relative">
                    <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 z-10" style={{ background: 'linear-gradient(to right, var(--ink), transparent)' }} />
                    <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-10" style={{ background: 'linear-gradient(to left, var(--ink), transparent)' }} />
                    <div
                        ref={navScrollRef}
                        onMouseDown={onNavDown}
                        onMouseMove={onNavMove}
                        onMouseUp={onNavUp}
                        onMouseLeave={onNavUp}
                        className="overflow-x-auto no-scrollbar flex gap-2 px-4 py-3 cursor-grab active:cursor-grabbing select-none"
                        style={{ scrollSnapType: 'x proximity' }}
                    >
                        {visibleCategories.map((cat) => {
                            const active = activeCategory === cat.id;
                            const Icon = categoryIconById[cat.id] || UtensilsCrossed;
                            return (
                                <button
                                    key={cat.id}
                                    ref={(el) => { chipRefs.current[cat.id] = el; }}
                                    onClick={() => { if (!navDrag.current.moved) setActiveCategory(cat.id); }}
                                    style={{ scrollSnapAlign: 'center', ...(active ? { background: WINE_GOLD, color: 'var(--ink)' } : undefined) }}
                                    className={`whitespace-nowrap flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-semibold u-motion flex-shrink-0 ${
                                        active ? 'shadow-sm' : 'bg-white/8 text-white/75 hover:bg-white/15 hover:text-white border border-white/10'
                                    }`}
                                >
                                    <Icon size={14} />
                                    {cat.name}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Search and Sort */}
            <div className={`px-4 py-3 bg-[var(--surface)] border-b border-[var(--border)] sticky ${isWaitingBill ? 'top-[85px]' : 'top-[52px]'} z-10`}>
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-3 text-[var(--text-muted)]" size={18} />
                        <Input
                            placeholder="Buscar no cardápio..."
                            className="pl-10 bg-[var(--surface-2)] border-[var(--border)] focus:bg-[var(--surface)] h-11"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                    {/* Sort Dropdown / Toggles */}
                    <div className="flex gap-1">
                        {/* Favoritos (Vende Mais II, 100% client-side): mesma área da
                            busca/ordenação, filtra filteredProducts de forma cumulativa
                            (ver useMemo acima) — não desliga categoria nem busca. */}
                        <button
                            onClick={() => setFavoritesOnly(v => !v)}
                            className={`flex items-center gap-1 px-2.5 h-11 rounded-[var(--r-md)] border text-[12px] font-semibold u-motion u-press-sm ${favoritesOnly ? 'bg-[var(--err)] text-white border-[var(--err)]' : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)]'}`}
                            title="Mostrar só favoritos"
                            aria-pressed={favoritesOnly}
                        >
                            <Heart size={14} className={favoritesOnly ? 'fill-current' : ''} /> Favoritos
                        </button>
                        <button
                            onClick={() => setSortBy(sortBy === 'price_asc' ? 'default' : 'price_asc')}
                            className={`p-2 rounded-[var(--r-md)] border u-motion u-press-sm ${sortBy === 'price_asc' ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)]'}`}
                            title="Preço Menor"
                        >
                            <ArrowDownWideNarrow size={16} />
                        </button>
                        <button
                            onClick={() => setSortBy(sortBy === 'price_desc' ? 'default' : 'price_desc')}
                            className={`p-2 rounded-[var(--r-md)] border u-motion u-press-sm ${sortBy === 'price_desc' ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)]'}`}
                            title="Preço Maior"
                        >
                             <ArrowUpNarrowWide size={16} />
                        </button>
                        <button
                             onClick={() => setSortBy(sortBy === 'name_asc' ? 'default' : 'name_asc')}
                             className={`p-2 rounded-[var(--r-md)] border u-motion u-press-sm ${sortBy === 'name_asc' ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)]'}`}
                             title="Nome A-Z"
                        >
                             <ArrowDownAZ size={16} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Menu List — "carta" editorial: título da categoria + contagem,
                depois as linhas (sem grid de cards). */}
            <div className={`px-4 pt-4 ${isWaitingBill ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
                {activeCategoryObj && !searchTerm && (
                    <div className="flex items-center gap-2 mb-1 u-grow-in">
                        <h2 className="font-bold text-[var(--text)] text-[17px] tracking-tight">{activeCategoryObj.name}</h2>
                        <span className="text-[11px] font-semibold text-[var(--text-muted)]">{filteredProducts.length}</span>
                        <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, rgba(212,175,92,0.5), transparent)' }} />
                    </div>
                )}
                <div>
                    {filteredProducts.map((product, i) => (
                        <ProductCard
                            key={product.id}
                            product={product}
                            icon={categoryIconById[product.category_id || ''] || UtensilsCrossed}
                            onSelect={setSelectedProduct}
                            onQuickAdd={(p) => {
                                // Qualquer grupo de opção (obrigatório ou não) abre o modal
                                // completo em vez de adicionar direto — extras opcionais
                                // (ex.: borda de pizza) também são upsell/vinculados ao
                                // omie_codigo da integração, não podem ser pulados no "+".
                                if ((p.option_groups || []).length > 0) { setSelectedProduct(p); return; }
                                addToCart(p, 1, '', []);
                                toast.success(`${p.name} adicionado`);
                            }}
                            disabled={isWaitingBill}
                            style={stagger(Math.min(i, 10) * 30)}
                            isBestseller={bestsellerIds.has(product.id)}
                            isFavorite={favoriteIds.has(product.id)}
                            onToggleFavorite={toggleFavorite}
                        />
                    ))}
                </div>
                {isLoadingMenu ? (
                    <div className="text-center py-12 text-[var(--text-muted)] text-sm animate-pulse">Carregando cardápio...</div>
                ) : filteredProducts.length === 0 ? (
                    <div className="flex flex-col items-center text-center py-16 u-grow-in">
                        <div className="w-16 h-16 rounded-[1.4rem] bg-[var(--brand-soft)] flex items-center justify-center mb-4" style={{ animation: '3s ease-in-out infinite icon-float' }}>
                            <UtensilsCrossed size={26} className="text-[var(--brand)]/50" />
                        </div>
                        <p className="text-[var(--text)] font-medium">{searchTerm ? 'Nada encontrado' : 'Cardápio a caminho'}</p>
                        <p className="text-[var(--text-muted)] text-sm mt-1 max-w-[15rem]">
                            {searchTerm ? 'Tente buscar por outro nome.' : 'Os pratos desta loja aparecem aqui assim que forem cadastrados.'}
                        </p>
                    </div>
                ) : null}
            </div>

            {/* Floating Cart Button */}
            {cart.length > 0 && !isWaitingBill && (
                <div className="fixed bottom-4 left-4 right-4 z-40 animate-[slideUp_0.25s_cubic-bezier(0.22,1,0.36,1)]">
                    <div className="text-white px-4 pt-3 pb-4 rounded-[var(--r-lg)] flex flex-col gap-3 border" style={{ background: 'var(--ink)', borderColor: 'rgba(212,175,92,0.3)', boxShadow: '0 12px 34px -8px rgba(0,0,0,0.45)' }}>
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2.5">
                                <div className="p-1.5 rounded-[var(--r-sm)]" style={{ background: 'rgba(212,175,92,0.15)' }}>
                                    <Wine size={16} style={{ color: WINE_GOLD }} />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-[13px] font-medium text-white/80">Sua Comanda</span>
                                    <span className="text-[11px] text-white/50">{cart.reduce((a,b) => a + b.quantity, 0)} {cart.reduce((a,b) => a + b.quantity, 0) === 1 ? 'item' : 'itens'}</span>
                                </div>
                            </div>
                            <span className="text-[18px] font-bold num" style={{ color: WINE_GOLD }}>R$ {cartTotal.toFixed(2)}</span>
                        </div>
                        <Button
                            className="w-full bg-[var(--brand)] hover:bg-[var(--brand-strong)] text-white"
                            onClick={() => setIsCartOpen(true)}
                        >
                            Ver Comanda
                        </Button>
                    </div>
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
                    if (selectedProduct) {
                        addToCart(selectedProduct, qty, notes, selectedOptions);
                        toast.success('Adicionado ao carrinho!');
                    }
                }}
                noteSuggestions={currentStore?.config?.note_suggestions || []}
                onSelectRecommended={setSelectedProduct}
                isFavorite={!!selectedProduct && favoriteIds.has(selectedProduct.id)}
                onToggleFavorite={toggleFavorite}
                visibleCategoryIds={visibleCategoryIds}
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
            />

            {showBill && currentTable && currentStore && (
                <BillSplitter
                    onClose={() => setShowBill(false)}
                    tableId={currentTable.id}
                    storeId={currentStore.id}
                    clientName={clientName}
                    isWaitingBill={isWaitingBill}
                    currentStore={currentStore}
                    currentTable={currentTable}
                />
            )}
        </div>
    );
};
