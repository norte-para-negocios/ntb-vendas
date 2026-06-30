import React, { useState, useEffect, useMemo } from 'react';
import { ShoppingBag, Search, Clock, Plus, Minus, User, LogIn, Coffee, LayoutGrid, Eye, EyeOff, ArrowUpDown, ArrowDownAZ, ArrowUpNarrowWide, ArrowDownWideNarrow, Bell, BellRing, LogOut, Trash2, Receipt, ChefHat, CheckCircle, AlertTriangle, AlertCircle, Users, Calculator, List, CheckSquare, Square, Lock, Info, PartyPopper, UtensilsCrossed, RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { fetchMenu, fetchStoreBySlug, createOrder, fetchTables, updateTableStatus, fetchTableOrderSummary, callWaiter, requestTableBill, cancelPendingTableItems, fetchOrderById } from '../services/api';
import { Category, Product, Table, TableStatus, Store, CartItem, OrderStatus, Order, OrderItem } from '../types';
import { Button, Card, Input, Modal, Badge } from '../components/UIComponents';
import * as ReactRouterDOM from 'react-router-dom';
import { supabase } from '../supabaseClient';

const { useParams } = ReactRouterDOM as any;

// --- COMPONENTS ---

const CounterConfirmModal: React.FC<{ isOpen: boolean, onClose: () => void, onConfirm: () => void, isLoading: boolean }> = ({ isOpen, onClose, onConfirm, isLoading }) => {
    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Atenção ao Pedido">
            <div className="flex flex-col items-center text-center space-y-6 py-2">
                <div className="bg-yellow-100 p-4 rounded-full text-yellow-600">
                    <AlertTriangle size={48} />
                </div>
                <div>
                    <h3 className="text-xl font-bold text-slate-800 mb-2">Pedido Único</h3>
                    <p className="text-gray-600 text-sm leading-relaxed">
                        Devido à organização da fila do balcão, este pedido será <strong className="text-slate-800">encerrado</strong> assim que confirmado.
                    </p>
                    <p className="text-gray-600 text-sm leading-relaxed mt-2">
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

    useEffect(() => {
        const load = async () => {
            const data = await fetchOrderById(orderId);
            setOrder(data);
            
            // Fetch items immediately to determine detailed status
            const { data: itemsData } = await supabase.from('order_items').select('*, product:products(*)').eq('order_id', orderId);
            if(itemsData) setItems(itemsData as OrderItem[]);
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
                 if(itemsData) setItems(itemsData as OrderItem[]);
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
            case OrderStatus.PENDING: return <Badge color="bg-yellow-100 text-yellow-700"><Clock size={12} className="mr-1"/> Enviado</Badge>;
            case OrderStatus.ACCEPTED: return <Badge color="bg-orange-100 text-orange-700"><ChefHat size={12} className="mr-1"/> Aceito</Badge>;
            case OrderStatus.PREPARING: return <Badge color="bg-blue-100 text-blue-700"><UtensilsCrossed size={12} className="mr-1"/> Preparando</Badge>;
            case OrderStatus.READY: return <Badge color="bg-green-100 text-green-700"><BellRing size={12} className="mr-1"/> Pronto</Badge>;
            case OrderStatus.DELIVERED: return <Badge color="bg-gray-100 text-gray-600"><CheckCircle size={12} className="mr-1"/> Entregue</Badge>;
            default: return null;
        }
    };

    if (!order) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="animate-pulse text-primary font-bold">Carregando status...</div></div>;

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
             <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6 text-center">
                 <div className="bg-red-100 p-6 rounded-full mb-6">
                     <AlertCircle size={48} className="text-red-500" />
                 </div>
                 <h2 className="text-2xl font-bold text-slate-800 mb-2">Pedido Cancelado</h2>
                 <p className="text-gray-500 mb-8">Seu pedido foi cancelado pelo estabelecimento.</p>
                 <Button onClick={onReset}>Fazer Novo Pedido</Button>
             </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <div className="bg-white p-6 shadow-sm border-b text-center">
                <h1 className="text-xl font-bold text-slate-800">Acompanhamento</h1>
                <p className="text-sm text-gray-500">Pedido #{orderId.slice(0, 4)}</p>
            </div>

            <div className="flex-1 flex flex-col items-center p-6 space-y-6">
                {/* Banner de Pronto */}
                {isReady && (
                    <div className="animate-bounce bg-green-100 text-green-800 px-6 py-3 rounded-xl font-bold text-lg flex items-center gap-3 shadow-lg border border-green-200 w-full justify-center max-w-md">
                        <PartyPopper /> SEU PEDIDO ESTÁ PRONTO!
                    </div>
                )}
                
                {isDelivered ? (
                     <div className="text-center py-10 animate-fade-in">
                         <div className="bg-green-100 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600">
                             <CheckCircle size={48} />
                         </div>
                         <h2 className="text-2xl font-bold text-slate-800 mb-2">Pedido Finalizado</h2>
                         <p className="text-gray-500 mb-2">Obrigado pela preferência!</p>
                         <p className="text-primary font-bold text-sm bg-primary/10 py-2 px-4 rounded-full inline-block">
                             Reiniciando em {secondsToRedirect}s...
                         </p>
                     </div>
                ) : (
                    <>
                        {/* Linha do Tempo */}
                        <div className="w-full max-w-md space-y-6 relative pb-6 border-b border-gray-200">
                             <div className="absolute left-6 top-6 bottom-6 w-1 bg-gray-200 -z-10"></div>
                             
                             {steps.map((step, idx) => {
                                 const isCompleted = currentStepIndex >= idx;
                                 const isCurrent = currentStepIndex === idx;
                                 
                                 return (
                                     <div key={idx} className={`flex items-center gap-4 transition-all duration-500 ${isCompleted ? 'opacity-100' : 'opacity-40'}`}>
                                         <div className={`w-12 h-12 rounded-full flex items-center justify-center border-4 transition-all z-10 ${
                                             isCompleted ? (step.status === OrderStatus.READY ? 'bg-green-500 border-green-200 text-white' : 'bg-primary border-blue-200 text-white') : 'bg-white border-gray-200 text-gray-300'
                                         } ${isCurrent && !isReady ? 'animate-pulse' : ''}`}>
                                             <step.icon size={20} />
                                         </div>
                                         <div>
                                             <h3 className={`font-bold text-lg ${isCompleted ? 'text-slate-800' : 'text-gray-400'}`}>{step.label}</h3>
                                             {isCurrent && <p className="text-xs text-primary font-medium animate-pulse">Em andamento...</p>}
                                         </div>
                                     </div>
                                 );
                             })}
                        </div>

                        {/* Lista de Itens Detalhada */}
                        <div className="w-full max-w-md bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="bg-gray-50 px-4 py-3 border-b border-gray-100">
                                <h3 className="font-bold text-slate-700 text-sm">Status dos Itens</h3>
                            </div>
                            <div className="divide-y divide-gray-100">
                                {items.map(item => (
                                    <div key={item.id} className="p-3 flex items-center justify-between">
                                        <div className="text-sm">
                                            <span className="font-bold text-gray-900">{item.quantity}x</span> {item.product?.name || 'Item'}
                                        </div>
                                        <div className="flex-shrink-0 ml-2">
                                            {getItemStatusIcon(item.status)}
                                        </div>
                                    </div>
                                ))}
                                {items.length === 0 && <p className="p-4 text-center text-gray-400 text-sm">Carregando itens...</p>}
                            </div>
                        </div>

                        <div className="p-2 text-center text-xs text-gray-400">
                             Aguarde chamar seu nome ou número no painel.
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

const LoginScreen: React.FC<{ onLogin: (name: string, tableId: string | null) => void, storeSlug: string, store: Store | null }> = ({ onLogin, storeSlug, store }) => {
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
                const t = await fetchTables(store.id);
                setTables(t);
            }
            setIsLoading(false);
        };
        load();
    }, [store, storeSlug]);

    const handleEnter = async () => {
        if (!name || name.length < 3) return alert('Por favor, digite seu nome (mínimo 3 letras)');
        
        // Counter Logic
        if (mode === 'counter') {
            return onLogin(name, null);
        }

        // Table Logic
        if (!tableId) return alert('Selecione onde você está sentado');
        
        setIsLoading(true);
        try {
            const freshTables = await fetchTables(store!.id);
            setTables(freshTables); // Atualiza os dados na tela caso algo mude
            
            const selected = freshTables.find(t => t.id === tableId);
            
            if (!selected) {
                alert('Mesa não encontrada.');
                setIsLoading(false);
                return;
            }

            // PIN Verification against freshest data!
            const isOccupied = selected.status !== TableStatus.AVAILABLE;
            const isPinRequired = isOccupied || (store?.config?.require_pin_for_open);

            if (isPinRequired) {
                 if (selected.pin && selected.pin !== pin) {
                     alert(isOccupied ? 'Mesa já ocupada! Peça o PIN ao anfitrião.' : 'PIN incorreto.');
                     setIsLoading(false);
                     return;
                 }
            }
            
            onLogin(name, tableId);
        } catch (error) {
            alert('Erro ao tentar acessar a mesa. Tente novamente.');
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading) return <div className="min-h-screen flex items-center justify-center bg-primary text-white"><span className="animate-pulse">Carregando...</span></div>;

    return (
        <div className="min-h-screen bg-primary flex flex-col items-center justify-center p-6">
            <div className="mb-8 text-center text-white">
                {store?.logo_url ? (
                    <img src={store.logo_url} alt="Logo" className="w-24 h-24 rounded-full mx-auto mb-4 border-4 border-white/20" />
                ) : (
                    <div className="bg-white/20 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4"><Coffee size={32}/></div>
                )}
                <h1 className="text-3xl font-bold mb-2">{store?.name || 'Cardápio Digital'}</h1>
                <p className="opacity-80">Faça seu pedido direto pelo celular</p>
            </div>
            <Card className="w-full max-w-sm p-8 space-y-6 shadow-2xl animate-slide-up">
                {store?.contract_type === 'balcao_mesas' && (
                    <div className="flex p-1 bg-gray-100 rounded-lg">
                        <button 
                            className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${mode === 'table' ? 'bg-white text-primary shadow-sm' : 'text-gray-500'}`}
                            onClick={() => setMode('table')}
                        >
                            <span className="flex items-center justify-center gap-2"><LayoutGrid size={16}/> Mesa</span>
                        </button>
                        <button 
                            className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${mode === 'counter' ? 'bg-white text-primary shadow-sm' : 'text-gray-500'}`}
                            onClick={() => setMode('counter')}
                        >
                            <span className="flex items-center justify-center gap-2"><Coffee size={16}/> Balcão</span>
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
                        <div className="animate-fade-in space-y-4">
                            <div>
                                <label className="text-sm font-semibold text-slate-700 mb-1 block">Onde você está?</label>
                                <select 
                                    className="w-full p-3 border rounded-lg bg-white focus:ring-2 focus:ring-primary/50 outline-none transition-all"
                                    value={tableId}
                                    onChange={e => setTableId(e.target.value)}
                                >
                                    <option value="">Selecione sua mesa...</option>
                                    {tables.map(t => {
                                        let statusLabel = '(Livre)';
                                        let isDisabled = false;

                                        if (t.status === 'occupied' || t.status === 'waiting_bill') {
                                            statusLabel = '(Ocupada)';
                                        } else if (t.status === 'blocked') {
                                            statusLabel = '(Bloqueada)';
                                            isDisabled = true;
                                        }

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
                                    <div className="animate-fade-in bg-yellow-50 p-3 rounded-lg border border-yellow-100">
                                        <p className="text-xs text-yellow-700 mb-2 font-bold text-center">
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
                         <div className="bg-blue-50 p-4 rounded-lg text-sm text-blue-700 animate-fade-in">
                             <p><strong>Pedido no Balcão:</strong> Você fará o pedido e aguardará ser chamado pelo nome ou painel.</p>
                         </div>
                    )}
                </div>

                <Button className="w-full text-lg shadow-lg shadow-primary/30" onClick={handleEnter} disabled={isLoading}>
                    <LogIn className="mr-2" size={20} /> 
                    {tables.find(t => t.id === tableId)?.status === 'occupied' 
                        ? 'Entrar / Recuperar' 
                        : (mode === 'counter' ? 'Abrir Comanda' : 'Abrir Mesa')}
                </Button>
            </Card>
        </div>
    );
};

const ProductModal: React.FC<{ product: Product | null, onClose: () => void, onAdd: (qty: number, notes: string) => void }> = ({ product, onClose, onAdd }) => {
    const [qty, setQty] = useState(1);
    const [notes, setNotes] = useState('');

    useEffect(() => {
        if(product) { setQty(1); setNotes(''); }
    }, [product]);

    if (!product) return null;

    return (
        <Modal isOpen={!!product} onClose={onClose} title={product.name}>
            <div className="space-y-4">
                {product.image_url && (
                    <img src={product.image_url} alt={product.name} className="w-full h-56 object-cover rounded-xl shadow-sm" />
                )}
                <p className="text-gray-600 leading-relaxed">{product.description}</p>
                
                <div className="flex items-center justify-between bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <span className="text-2xl font-bold text-primary">R$ {product.price.toFixed(2)}</span>
                    <div className="flex items-center gap-4 bg-white px-2 py-1 rounded-lg shadow-sm border">
                        <button onClick={() => setQty(Math.max(1, qty - 1))} className="p-2 text-primary hover:bg-gray-50 rounded-md"><Minus size={18} /></button>
                        <span className="font-bold text-lg w-8 text-center">{qty}</span>
                        <button onClick={() => setQty(qty + 1)} className="p-2 text-primary hover:bg-gray-50 rounded-md"><Plus size={18} /></button>
                    </div>
                </div>

                <Input 
                    label="Observações"
                    placeholder="Ex: Tirar cebola, ponto da carne..." 
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                />

                <Button className="w-full mt-4 h-12 text-lg" onClick={() => { onAdd(qty, notes); onClose(); }}>
                    Adicionar • R$ {(product.price * qty).toFixed(2)}
                </Button>
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
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
            <div className="w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden animate-slide-up flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                    <div className="flex items-center gap-2">
                        <ShoppingBag className="text-primary" />
                        <h3 className="text-lg font-bold text-slate-900">Seu Pedido</h3>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <span className="text-2xl">&times;</span>
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {cart.length === 0 ? (
                        <div className="text-center py-10 text-gray-400">
                            <ShoppingBag size={48} className="mx-auto mb-2 opacity-20"/>
                            <p>Seu carrinho está vazio.</p>
                        </div>
                    ) : (
                        cart.map((item, idx) => (
                            <div key={`${item.product.id}-${idx}`} className="flex gap-3 bg-white border border-gray-100 p-3 rounded-xl shadow-sm">
                                {item.product.image_url ? (
                                    <img src={item.product.image_url} alt="" className="w-16 h-16 rounded-lg object-cover bg-gray-100" />
                                ) : (
                                    <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300">
                                        <Coffee size={20}/>
                                    </div>
                                )}
                                <div className="flex-1">
                                    <div className="flex justify-between items-start">
                                        <h4 className="font-bold text-slate-800 text-sm">{item.product.name}</h4>
                                        <span className="font-bold text-slate-900 text-sm">R$ {(item.product.price * item.quantity).toFixed(2)}</span>
                                    </div>
                                    {item.notes && <p className="text-xs text-gray-500 mt-1 italic">"{item.notes}"</p>}
                                    
                                    <div className="flex justify-between items-end mt-2">
                                        <button onClick={() => onRemove(item)} className="text-red-400 hover:text-red-600 p-1">
                                            <Trash2 size={16}/>
                                        </button>
                                        <div className="flex items-center gap-3 bg-gray-50 rounded-lg px-2 py-1 border border-gray-200">
                                            <button onClick={() => onUpdateQty(item, -1)} className="text-primary hover:bg-gray-200 rounded p-0.5"><Minus size={14}/></button>
                                            <span className="text-sm font-bold w-4 text-center">{item.quantity}</span>
                                            <button onClick={() => onUpdateQty(item, 1)} className="text-primary hover:bg-gray-200 rounded p-0.5"><Plus size={14}/></button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-4 border-t bg-gray-50 space-y-3">
                    <div className="flex justify-between items-center text-lg font-bold text-slate-800">
                        <span>Total</span>
                        <span>R$ {total.toFixed(2)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Button variant="secondary" onClick={onClose} className="h-12">
                            Adicionar Mais
                        </Button>
                        <Button onClick={onConfirm} isLoading={isLoading} disabled={cart.length === 0} className="h-12 shadow-lg shadow-primary/20">
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

    useEffect(() => {
        const loadBill = async () => {
            setIsLoading(true);
            const data = await fetchTableOrderSummary(tableId);
            
            // Fetch fresh table and store data to ensure we have the latest config
            const { data: tableData } = await supabase.from('tables').select('*').eq('id', tableId).single();
            let storeConfig = currentStore?.config;
            if (tableData?.store_id) {
                const { data: storeData } = await supabase.from('stores').select('config').eq('id', tableData.store_id).single();
                if (storeData) storeConfig = storeData.config;
            }

            // Calculate service fee
            const isFeeEnabled = storeConfig?.charge_service_fee && !tableData?.service_fee_removed;
            const calculatedSubtotal = data.total;
            const calculatedServiceFee = isFeeEnabled ? calculatedSubtotal * 0.1 : 0;
            
            setSubtotal(calculatedSubtotal);
            setServiceFee(calculatedServiceFee);
            setTotal(calculatedSubtotal + calculatedServiceFee);
            setIsServiceFeeEnabled(!!isFeeEnabled);
            
            setItems(data.items);
            setIsLoading(false);
        };
        loadBill();
        
        const channel = supabase.channel(`bill_${tableId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => loadBill())
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
            alert(e.message || "Erro ao chamar garçom.");
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
            alert("Conta solicitada com sucesso! O garçom trará a conta em instantes.");
            onClose();
        } catch (e) {
            alert("Erro ao solicitar conta.");
            console.error(e);
        } finally {
            setIsClosing(false);
        }
    };

    const getItemStatusBadge = (status: string) => {
        switch (status) {
            case 'pending': return <span className="flex items-center gap-1 text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded border border-yellow-200"><Clock size={10}/> Enviado</span>;
            case 'accepted': return <span className="flex items-center gap-1 text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded border border-orange-200"><ChefHat size={10}/> Aceito</span>;
            case 'preparing': return <span className="flex items-center gap-1 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200"><UtensilsCrossed size={10}/> Prep.</span>;
            case 'ready': return <span className="flex items-center gap-1 text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded border border-green-200"><BellRing size={10}/> Pronto</span>;
            case 'delivered': return <span className="flex items-center gap-1 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded border border-gray-200"><CheckCircle size={10}/> Entregue</span>;
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
            const userServiceFee = isServiceFeeEnabled ? userSubtotal * 0.1 : 0;
            breakdown[userName].serviceFee = userServiceFee;
            breakdown[userName].total = userSubtotal + userServiceFee;
        });

        return breakdown;
    }, [items, isServiceFeeEnabled]);

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

    const calculatorServiceFee = isServiceFeeEnabled ? calculatorSubtotal * 0.1 : 0;
    const calculatorTotal = calculatorSubtotal + calculatorServiceFee;

    // --- RENDER MODALS ---

    if (showCloseConfirmation) {
        return (
             <Modal isOpen={true} onClose={() => setShowCloseConfirmation(false)} title="Encerrar Mesa">
                 <div className="space-y-6 text-center">
                     <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-200 flex flex-col items-center">
                         <AlertCircle className="text-yellow-600 mb-2" size={32}/>
                         <p className="font-bold text-yellow-800">Deseja realmente pedir a conta?</p>
                         <p className="text-sm text-yellow-700 mt-1">Ao solicitar o fechamento, não será possível adicionar novos itens.</p>
                     </div>

                     {hasPendingItems && (
                         <div className="bg-red-50 p-4 rounded-xl border border-red-200 text-left">
                             <div className="flex items-start gap-2">
                                 <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={20}/>
                                 <div>
                                     <p className="font-bold text-red-700">Itens Pendentes</p>
                                     <p className="text-sm text-red-600 mt-1">
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
                                    className="w-full bg-red-600 hover:bg-red-700 text-white" 
                                    onClick={() => handleRequestBill(true)}
                                    isLoading={isClosing}
                                >
                                    Cancelar Pendentes e Fechar
                                </Button>
                                <Button 
                                    className="w-full bg-slate-700 hover:bg-slate-800 text-white" 
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
                    <div className="py-10 animate-pulse text-center text-primary">Carregando conta...</div>
                ) : (
                    <>  
                        {/* Tabs */}
                        <div className="flex p-1 bg-gray-100 rounded-lg">
                            <button onClick={() => setTab('split')} className={`flex-1 py-2 text-xs font-bold rounded-md transition-all flex flex-col items-center gap-1 ${tab === 'split' ? 'bg-white text-primary shadow-sm' : 'text-gray-400'}`}>
                                <Users size={16}/> Divisão
                            </button>
                            <button onClick={() => setTab('users')} className={`flex-1 py-2 text-xs font-bold rounded-md transition-all flex flex-col items-center gap-1 ${tab === 'users' ? 'bg-white text-primary shadow-sm' : 'text-gray-400'}`}>
                                <List size={16}/> Por Cliente
                            </button>
                            <button onClick={() => setTab('calculator')} className={`flex-1 py-2 text-xs font-bold rounded-md transition-all flex flex-col items-center gap-1 ${tab === 'calculator' ? 'bg-white text-primary shadow-sm' : 'text-gray-400'}`}>
                                <Calculator size={16}/> Calculadora
                            </button>
                        </div>

                        {/* Content based on Tab */}
                        <div className="min-h-[250px] max-h-[50vh] overflow-y-auto">
                            
                            {/* TAB 1: SPLIT BY PEOPLE */}
                            {tab === 'split' && (
                                <div className="space-y-6 animate-fade-in pt-2">
                                    <div className="bg-primary/5 p-4 rounded-xl border border-primary/10 text-center">
                                        <p className="text-sm text-gray-500 uppercase font-bold tracking-wider">Total da Mesa</p>
                                        <p className="text-3xl font-black text-primary mt-1">R$ {total.toFixed(2)}</p>
                                        {isServiceFeeEnabled && (
                                            <p className="text-xs text-gray-500 mt-1">Inclui R$ {serviceFee.toFixed(2)} de taxa de serviço (10% opcional)</p>
                                        )}
                                    </div>
                                    <div className="flex items-center justify-center gap-6 py-2">
                                        <button onClick={() => setPeople(Math.max(1, people - 1))} className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors"><Minus size={18} /></button>
                                        <div className="text-center min-w-[80px]">
                                            <span className="block text-2xl font-bold text-slate-800">{people}</span>
                                            <span className="text-[10px] text-gray-500 font-bold uppercase">Pessoas</span>
                                        </div>
                                        <button onClick={() => setPeople(people + 1)} className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors"><Plus size={18}/></button>
                                    </div>
                                    <div className="border-t border-dashed border-gray-300 pt-4 text-center">
                                        <p className="text-gray-500 text-sm mb-1">Valor por pessoa</p>
                                        <p className="text-2xl font-bold text-slate-800">R$ {(total / people).toFixed(2)}</p>
                                    </div>
                                    {/* List All Items for Context */}
                                    <div className="mt-4 pt-4 border-t border-gray-100">
                                        <p className="text-xs text-gray-400 font-bold uppercase mb-2">Itens da Mesa</p>
                                        <ul className="text-sm space-y-1 text-gray-600">
                                            {items.map((it, idx) => (
                                                <li key={idx} className="flex justify-between items-center py-1">
                                                    <div className="flex items-center gap-2">
                                                        <span>{it.quantity}x {it.product?.name}</span>
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
                                        <div key={name} className="border border-gray-200 rounded-xl overflow-hidden">
                                            <div className="bg-gray-50 p-3 flex justify-between items-center border-b border-gray-100">
                                                <span className="font-bold text-slate-700 flex items-center gap-2"><User size={14}/> {name}</span>
                                                <span className="font-bold text-primary">R$ {data.total.toFixed(2)}</span>
                                            </div>
                                            <div className="p-2 space-y-1">
                                                {data.items.map((it: any) => (
                                                    <div key={it.id} className="flex justify-between items-center text-xs text-gray-600 px-2 py-1">
                                                        <div className="flex items-center gap-1.5">
                                                            {getItemStatusBadge(it.status)}
                                                            <span>{it.quantity}x {it.product?.name}</span>
                                                        </div>
                                                        <span>{(it.price_at_time * it.quantity).toFixed(2)}</span>
                                                    </div>
                                                ))}
                                                {isServiceFeeEnabled && (
                                                    <div className="flex justify-between items-center text-xs text-gray-500 px-2 py-1 border-t border-gray-100 mt-1 pt-1">
                                                        <span>Taxa de Serviço (10%)</span>
                                                        <span>{data.serviceFee.toFixed(2)}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {items.length === 0 && <p className="text-center text-gray-400">Nenhum pedido realizado.</p>}
                                </div>
                            )}

                            {/* TAB 3: CALCULATOR */}
                            {tab === 'calculator' && (
                                <div className="space-y-2 animate-fade-in pt-2">
                                    <div className="bg-blue-50 p-3 rounded-lg text-xs text-blue-700 mb-2">
                                        Selecione os itens que você vai pagar para calcular seu subtotal.
                                    </div>
                                    {items.map(item => {
                                        const isSelected = !!selectedItems[item.id];
                                        const selectedQty = selectedItems[item.id] || 0;
                                        
                                        return (
                                            <div key={item.id} onClick={() => toggleSelection(item.id, item.quantity)} className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${isSelected ? 'border-primary bg-primary/5' : 'border-gray-100 bg-white'}`}>
                                                <div className={`text-primary ${isSelected ? 'opacity-100' : 'opacity-30'}`}>
                                                    {isSelected ? <CheckSquare size={20}/> : <Square size={20}/>}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex justify-between items-start">
                                                        <span className={`text-sm font-bold ${isSelected ? 'text-primary' : 'text-gray-600'}`}>
                                                            {item.product?.name}
                                                        </span>
                                                        <span className="text-sm font-medium">R$ {item.price_at_time.toFixed(2)}</span>
                                                    </div>
                                                    
                                                    {isSelected && item.quantity > 1 && (
                                                        <div className="flex items-center gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                                                            <span className="text-xs text-gray-500">Qtd:</span>
                                                            <button onClick={() => updateSelectionQty(item.id, -1, item.quantity)} className="w-6 h-6 bg-white border rounded flex items-center justify-center text-primary"><Minus size={12}/></button>
                                                            <span className="text-sm font-bold w-4 text-center">{selectedQty}</span>
                                                            <button onClick={() => updateSelectionQty(item.id, 1, item.quantity)} className="w-6 h-6 bg-white border rounded flex items-center justify-center text-primary"><Plus size={12}/></button>
                                                            <span className="text-xs text-gray-400 ml-1">/ {item.quantity}</span>
                                                        </div>
                                                    )}
                                                    {!isSelected && item.quantity > 1 && (
                                                        <span className="text-xs text-gray-400">Quantidade: {item.quantity}</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        
                        {/* FOOTER ACTIONS */}
                        <div className="pt-2 border-t border-gray-100 space-y-3">
                            {tab === 'calculator' ? (
                                <div className="flex flex-col bg-slate-900 text-white p-4 rounded-xl">
                                    <div className="flex justify-between items-center">
                                        <span className="font-bold">Total Selecionado</span>
                                        <span className="font-black text-xl">R$ {calculatorTotal.toFixed(2)}</span>
                                    </div>
                                    {isServiceFeeEnabled && (
                                        <div className="text-xs text-slate-400 mt-1 text-right">
                                            Inclui R$ {calculatorServiceFee.toFixed(2)} de taxa de serviço
                                        </div>
                                    )}
                                </div>
                            ) : (
                                !isWaitingBill && (
                                    <Button 
                                        className="w-full bg-slate-800 hover:bg-black text-white gap-2"
                                        onClick={() => setShowCloseConfirmation(true)}
                                    >
                                        <Receipt size={18} /> Pedir Conta (Bloquear Mesa)
                                    </Button>
                                )
                            )}
                            
                            {isWaitingBill && (
                                <div className="bg-orange-100 text-orange-800 p-3 rounded-lg text-center font-bold text-sm flex items-center justify-center gap-2">
                                    <Clock size={16}/> Conta Solicitada. Aguarde o garçom.
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-3">
                                <Button 
                                    variant="secondary" 
                                    className={`gap-2 ${waiterRequested ? 'text-green-600 bg-green-50 border border-green-200' : ''}`}
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

export const ClientModule: React.FC = () => {
    const { slug } = useParams();
    const [hasAccess, setHasAccess] = useState(false);
    const [categories, setCategories] = useState<Category[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [activeCategory, setActiveCategory] = useState<string>('');
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [showBill, setShowBill] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    
    // New States
    const [showPin, setShowPin] = useState(false);
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

    useEffect(() => {
        if (slug) {
            fetchStoreBySlug(slug).then(store => {
                if (store) {
                    setCurrentStore(store);
                    // Pass TRUE to fetch only available products
                    fetchMenu(store.id, true).then(({ categories, products }) => {
                        setCategories(categories);
                        setProducts(products);
                        if (categories.length > 0) setActiveCategory(categories[0].id);
                    });
                }
            });
        }
    }, [slug, setCurrentStore]);

    // Realtime Table Status Listener
    useEffect(() => {
        if (currentTable) {
            const channel = supabase.channel(`table_status_${currentTable.id}`)
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables', filter: `id=eq.${currentTable.id}` }, 
                (payload) => {
                    const newTable = payload.new as Table;
                    setGlobalTable(newTable);
                    
                    // If session closed, force logout
                    if(newTable.status === TableStatus.AVAILABLE) {
                         alert("A mesa foi fechada pelo restaurante. Obrigado!");
                         localStorage.removeItem(`session_${slug}`);
                         window.location.reload();
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
                            const tables = await fetchTables(currentStore.id);
                            const table = tables.find(t => t.id === session.tableId);
                            
                            // Only auto-restore if table is still occupied by the same context
                            if (table && (table.status === TableStatus.OCCUPIED || table.status === TableStatus.WAITING_BILL)) {
                                // If I was the host, check if I am still the host
                                const isReturningHost = table.current_host_name?.toLowerCase() === session.name.toLowerCase();
                                
                                setClientName(session.name);
                                setGlobalTable(table);
                                setIsHost(isReturningHost);
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

    const handleLogin = async (name: string, tableId: string | null) => {
        setClientName(name);
        if (!currentStore) return;

        let hostStatus = false;

        if (tableId) {
            // Table Login
            const tables = await fetchTables(currentStore.id);
            const table = tables.find(t => t.id === tableId);
            
            if (table) {
                setGlobalTable(table);
                if (table.status === TableStatus.AVAILABLE) {
                    // Start New Session (Host)
                    await updateTableStatus(table.id, TableStatus.OCCUPIED, name);
                    hostStatus = true;
                } else {
                    // Join Existing Session
                    // Check if recovering host session
                    if (table.current_host_name?.toLowerCase() === name.toLowerCase()) {
                        hostStatus = true;
                    } else {
                        // Guest joining
                        hostStatus = false;
                    }
                }
            }
        } else {
            // Counter Login
            setGlobalTable(null);
            hostStatus = true; // Always host of your own counter order
        }
        
        setIsHost(hostStatus);
        setHasAccess(true);

        // SAVE SESSION
        localStorage.setItem(`session_${slug}`, JSON.stringify({
            name,
            tableId,
            mode: tableId ? 'table' : 'counter',
            timestamp: Date.now()
        }));
    };

    const handleLogout = (force = false) => {
        if(force || window.confirm("Deseja realmente sair? Se você for o anfitrião, a mesa continuará aberta.")) {
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
                     alert('Pedido enviado para a cozinha!');
                 }
            }
        } catch (e: any) {
            console.error(e);
            alert('Erro ao enviar pedido: ' + (e.message || 'Tente novamente.'));
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleResetTracker = () => {
         setTrackedOrderId(null);
         // Maintain session logged in
    };

    const cartTotal = cart.reduce((acc, item) => acc + (item.product.price * item.quantity), 0);

    const filteredProducts = useMemo(() => {
        let prods = [...products]; // Create a copy to avoid mutating state directly
        
        if (activeCategory) prods = prods.filter(p => p.category_id === activeCategory);
        if (searchTerm) prods = prods.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
        
        // Sorting Logic
        if (sortBy === 'price_asc') {
            prods.sort((a, b) => a.price - b.price);
        } else if (sortBy === 'price_desc') {
            prods.sort((a, b) => b.price - a.price);
        } else if (sortBy === 'name_asc') {
            prods.sort((a, b) => a.name.localeCompare(b.name));
        }

        return prods;
    }, [products, activeCategory, searchTerm, sortBy]);

    if (!currentStore) return <div className="flex items-center justify-center h-screen bg-gray-50"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div></div>;

    if (!hasAccess) return <LoginScreen onLogin={handleLogin} storeSlug={slug || ''} store={currentStore} />;
    
    // TRACKER MODE INTERCEPT
    if (trackedOrderId) {
        return <OrderTracker orderId={trackedOrderId} onReset={handleResetTracker} onLogout={() => handleLogout(true)} />;
    }

    const isWaitingBill = currentTable?.status === TableStatus.WAITING_BILL;

    return (
        <div className="bg-gray-50 min-h-screen pb-32">
            {/* Header */}
            <header className="sticky top-0 bg-white/95 backdrop-blur-sm shadow-sm z-30 px-4 py-3 flex items-center justify-between border-b border-gray-100">
                <div className="flex flex-col">
                    <h1 className="font-bold text-primary text-lg leading-tight">{currentStore.name}</h1>
                    <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                        <span className="flex items-center gap-1 bg-gray-100 px-2 py-0.5 rounded-full">
                            <User size={10} /> {clientName} {isHost ? '(Host)' : '(Convidado)'}
                        </span>
                        {currentTable ? (
                            <span className="font-medium">• Mesa {currentTable.number}</span>
                        ) : (
                            <span className="font-medium text-orange-600 bg-orange-100 px-2 rounded-full">• Balcão</span>
                        )}
                        
                        {/* PIN DISPLAY FOR HOST ONLY */}
                        {isHost && currentTable && currentTable.pin && (
                            <div className="flex items-center gap-1 ml-1 bg-yellow-50 px-2 py-0.5 rounded-full border border-yellow-100 cursor-pointer" onClick={() => setShowPin(!showPin)}>
                                <span className="font-mono font-bold text-yellow-700 tracking-wider">
                                    {showPin ? currentTable.pin : '****'}
                                </span>
                                {showPin ? <EyeOff size={10} className="text-yellow-600"/> : <Eye size={10} className="text-yellow-600"/>}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex gap-2">
                    {currentTable && (
                        <Button 
                            variant="primary" 
                            className={`px-4 py-1.5 text-xs h-auto font-bold rounded-full shadow-sm transition-all ${
                                isWaitingBill 
                                    ? 'bg-orange-500 hover:bg-orange-600 text-white shadow-orange-500/25' 
                                    : 'bg-green-600 hover:bg-green-700 text-white shadow-green-600/25'
                            }`} 
                            onClick={() => setShowBill(true)}
                        >
                            {isWaitingBill ? <><Clock size={12} className="mr-1"/> Conta Pedida</> : <><Receipt size={14} className="mr-1.5"/> Pagar Conta</>}
                        </Button>
                    )}
                    <button onClick={() => handleLogout(false)} className="p-2 text-gray-400 hover:text-red-500">
                        <LogOut size={16} />
                    </button>
                </div>
            </header>
            
            {/* Waiting Bill Banner */}
            {isWaitingBill && (
                <div className="bg-orange-600 text-white px-4 py-2 text-center text-sm font-bold shadow-md sticky top-[60px] z-30 flex items-center justify-center gap-2">
                    <Lock size={16}/> Conta Solicitada. Novos pedidos bloqueados.
                </div>
            )}

            {/* Category Nav */}
            <div className={`sticky ${isWaitingBill ? 'top-[96px]' : 'top-[60px]'} bg-white z-20 border-b border-gray-100 overflow-x-auto flex gap-3 p-3 no-scrollbar shadow-[0_4px_6px_-4px_rgba(0,0,0,0.05)]`}>
                {categories.map(cat => (
                    <button
                        key={cat.id}
                        onClick={() => setActiveCategory(cat.id)}
                        className={`whitespace-nowrap px-5 py-2 rounded-full text-sm font-bold transition-all transform active:scale-95 ${
                            activeCategory === cat.id ? 'bg-primary text-white shadow-md shadow-primary/30' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                    >
                        {cat.name}
                    </button>
                ))}
            </div>

            {/* Search and Sort */}
            <div className={`p-4 bg-white border-b border-gray-100 sticky ${isWaitingBill ? 'top-[150px]' : 'top-[114px]'} z-10`}>
                <div className="flex gap-2 mb-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-3 text-gray-400" size={18} />
                        <Input 
                            placeholder="Buscar no cardápio..." 
                            className="pl-10 bg-gray-50 border-gray-200 focus:bg-white h-11" 
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                    {/* Sort Dropdown / Toggles */}
                    <div className="flex gap-1">
                        <button 
                            onClick={() => setSortBy(sortBy === 'price_asc' ? 'default' : 'price_asc')} 
                            className={`p-3 rounded-lg border transition-colors ${sortBy === 'price_asc' ? 'bg-primary text-white border-primary' : 'bg-white border-gray-200 text-gray-500'}`}
                            title="Preço Menor"
                        >
                            <ArrowDownWideNarrow size={18} />
                        </button>
                        <button 
                            onClick={() => setSortBy(sortBy === 'price_desc' ? 'default' : 'price_desc')} 
                            className={`p-3 rounded-lg border transition-colors ${sortBy === 'price_desc' ? 'bg-primary text-white border-primary' : 'bg-white border-gray-200 text-gray-500'}`}
                            title="Preço Maior"
                        >
                             <ArrowUpNarrowWide size={18} />
                        </button>
                        <button 
                             onClick={() => setSortBy(sortBy === 'name_asc' ? 'default' : 'name_asc')} 
                             className={`p-3 rounded-lg border transition-colors ${sortBy === 'name_asc' ? 'bg-primary text-white border-primary' : 'bg-white border-gray-200 text-gray-500'}`}
                             title="Nome A-Z"
                        >
                             <ArrowDownAZ size={18} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Menu Grid */}
            <div className={`p-4 grid gap-4 ${isWaitingBill ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
                {filteredProducts.map(product => (
                    <Card key={product.id} onClick={() => !isWaitingBill && setSelectedProduct(product)} className="flex gap-4 p-3 active:scale-[0.99] transition-transform">
                        {product.image_url ? (
                             <img src={product.image_url} alt={product.name} className="w-28 h-28 object-cover rounded-lg bg-gray-200 flex-shrink-0" />
                        ) : (
                             <div className="w-28 h-28 bg-gray-100 rounded-lg flex items-center justify-center text-gray-300 flex-shrink-0">Sem Foto</div>
                        )}
                        <div className="flex-1 flex flex-col justify-between py-1">
                            <div>
                                <div className="flex justify-between items-start gap-2">
                                    <h3 className="font-bold text-slate-800 leading-tight">{product.name}</h3>
                                    <span className="font-bold text-primary whitespace-nowrap">R$ {product.price.toFixed(2)}</span>
                                </div>
                                <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">{product.description}</p>
                            </div>
                            <div className="flex items-center gap-1 text-xs text-gray-400 mt-2 font-medium">
                                <Clock size={12} /> {product.prep_time_minutes} min
                            </div>
                        </div>
                    </Card>
                ))}
                {filteredProducts.length === 0 && (
                    <div className="text-center py-10 text-gray-400">Nenhum produto encontrado.</div>
                )}
            </div>

            {/* Floating Cart Button (Opens Modal) */}
            {cart.length > 0 && !isWaitingBill && (
                <div className="fixed bottom-4 left-4 right-4 z-40 animate-slide-up">
                    <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-2xl flex flex-col gap-3">
                        <div className="flex justify-between items-center px-1">
                            <div className="flex items-center gap-3">
                                <div className="bg-primary p-2 rounded-lg text-white">
                                    <ShoppingBag size={20} />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-sm font-medium text-gray-300">Meu Pedido</span>
                                    <span className="text-xs text-gray-400">{cart.reduce((a,b) => a + b.quantity, 0)} itens selecionados</span>
                                </div>
                            </div>
                            <span className="text-xl font-bold">R$ {cartTotal.toFixed(2)}</span>
                        </div>
                        <Button 
                            className="w-full font-bold text-lg bg-primary hover:bg-primary-light h-12 rounded-xl" 
                            onClick={() => setIsCartOpen(true)}
                        >
                            Ver Sacola
                        </Button>
                    </div>
                </div>
            )}
            
            {/* Locked State Footer */}
            {isWaitingBill && (
                 <div className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900 text-white p-4 shadow-2xl animate-slide-up">
                    <div className="flex justify-between items-center max-w-lg mx-auto">
                        <div className="flex items-center gap-3">
                            <Lock className="text-orange-500" size={24}/>
                            <div>
                                <p className="font-bold">Conta Solicitada</p>
                                <p className="text-xs text-gray-400">Aguarde o garçom para finalizar.</p>
                            </div>
                        </div>
                        <Button variant="secondary" className="text-sm py-2 px-4 h-auto" onClick={() => setShowBill(true)}>
                            Ver Detalhes
                        </Button>
                    </div>
                 </div>
            )}

            <ProductModal 
                product={selectedProduct} 
                onClose={() => setSelectedProduct(null)} 
                onAdd={(qty, notes) => {
                    if (selectedProduct) addToCart(selectedProduct, qty, notes);
                }} 
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
                onUpdateQty={(item, delta) => addToCart(item.product, delta, item.notes)}
                onRemove={(item) => removeFromCart(item.product, item.notes)}
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