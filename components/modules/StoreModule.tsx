'use client';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LayoutDashboard, UtensilsCrossed, ChefHat, LogOut, CheckCircle, Clock, RotateCcw, Lock, Store as StoreIcon, AlertCircle, Plus, Edit2, Trash2, Image, ToggleLeft, ToggleRight, X, Coffee, Receipt, LayoutGrid, RefreshCw, Loader2, Upload, Camera, Settings, Ban, Unlock, User, BellRing, Search, Minus, BarChart3, Printer, Wallet, CreditCard, Banknote, QrCode, Gift, ArrowRightLeft, ChevronLeft, ChevronRight, Eye, EyeOff, GripVertical, Wine, Users, List, Calculator, CheckSquare, Square, Menu } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Button, Card, Badge, Modal, Input } from '@/components/ui';
import { fetchKitchenOrders, updateOrderItemStatus, fetchTables, updateTableStatus, authenticateStoreUser, updateStoreUserPassword, fetchMenu, createCategory, deleteCategory, createProduct, updateProduct, deleteProduct, fetchCounterOrders, closeCounterOrder, uploadProductImage, updateOrderStatus, sendOrderToKitchen, fetchActiveOrdersForTables, toggleTableBlock, closeTableSession, dismissWaiterRequest, createOrder, cancelSpecificOrderItem, fetchSalesHistory, clearSalesHistory, moveTable, updateStoreConfig, fetchStoreTeamMembers, createStoreTeamMember, updateStoreTeamMember, deleteStoreTeamMember, toggleTableServiceFee, fetchStoreById, updateCategoryOrder, updateProductOrder } from '@/lib/api';
import { OrderItem, OrderStatus, Table, TableStatus, StoreUser, Store, Category, Product, Order } from '@/types';
import { supabase } from '@/lib/supabaseClient';
import { StoreDashboardView } from '@/components/modules/StoreDashboardView';
import { toast } from '@/components/Toast';
import { confirm } from '@/components/ConfirmDialog';

// --- COMPONENTS ---

const StoreLogin: React.FC<{ onLogin: (user: StoreUser & { store: Store }) => void }> = ({ onLogin }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    
    // Reset Password State
    const [needsChange, setNeedsChange] = useState(false);
    const [userId, setUserId] = useState('');
    const [newPass, setNewPass] = useState('');
    const [confirmPass, setConfirmPass] = useState('');

    const handleLogin = async () => {
        setError('');
        setIsLoading(true);
        const result = await authenticateStoreUser(email, password);
        
        if (result.success && result.user) {
            if (result.user.must_change_password) {
                setNeedsChange(true);
                setUserId(result.user.id);
            } else {
                onLogin(result.user);
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
            await updateStoreUserPassword(userId, newPass);
            toast.success('Senha atualizada com sucesso! Faça login novamente.');
            setNeedsChange(false);
            setPassword('');
        } catch (e) {
            setError('Erro ao atualizar senha.');
        } finally {
            setIsLoading(false);
        }
    };

    if (needsChange) {
         return (
            <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-4">
                <Card className="w-full max-w-sm p-8 animate-[fadeIn_0.2s_ease-out]">
                    <div className="text-center mb-6">
                        <div className="bg-[var(--warn)]/10 w-14 h-14 rounded-[var(--r-lg)] flex items-center justify-center mx-auto mb-4 text-[var(--warn)]">
                            <Lock size={24} />
                        </div>
                        <h2 className="text-xl font-semibold text-[var(--text)]">Crie sua Senha</h2>
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
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-4">
             <div className="max-w-sm w-full">
                 <div className="text-center mb-8">
                     <div className="bg-[var(--brand)] w-12 h-12 rounded-[var(--r-lg)] flex items-center justify-center mx-auto mb-5 text-white" style={{boxShadow:'0 4px 14px rgba(27,58,75,0.35)'}}>
                         <StoreIcon size={22} />
                     </div>
                     <h1 className="text-2xl font-semibold text-[var(--text)]">Área do Lojista</h1>
                     <p className="text-[var(--text-muted)] text-sm mt-1">Gerencie seus pedidos e mesas</p>
                 </div>
                 <Card className="p-6 animate-[slideUp_0.25s_cubic-bezier(0.22,1,0.36,1)]">
                    <div className="space-y-4">
                        <Input label="Email de Acesso" placeholder="seu@email.com" type="email" value={email} onChange={e => setEmail(e.target.value)} />
                        <Input label="Senha" placeholder="••••••" type="password" value={password} onChange={e => setPassword(e.target.value)} />
                        
                        {error && (
                            <div className="bg-[var(--err)]/10 text-[var(--err)] p-3 rounded text-sm flex items-center gap-2">
                                <AlertCircle size={16} /> {error}
                            </div>
                        )}
                        
                        <Button className="w-full" onClick={handleLogin} isLoading={isLoading}>
                            Acessar Painel
                        </Button>
                    </div>
                 </Card>
             </div>
        </div>
    );
};

const useStoreNotifications = (storeId: string | undefined) => {
    const [counts, setCounts] = useState({ tables: 0, kitchen: 0, bar: 0 });

    useEffect(() => {
        if (!storeId) return;
        
        let isMounted = true;
        
        const loadCounts = async () => {
            try {
                // Fetch tables and active orders
                const tablesData = await fetchTables(storeId);
                const activeOrdersData = await fetchActiveOrdersForTables(storeId);
                
                let tableCount = 0;
                tablesData.forEach(t => {
                    const isOccupied = t.status === 'occupied' || t.status === 'waiting_bill';
                    if (!isOccupied) return;

                    if (t.waiter_requested || t.status === 'waiting_bill') {
                        tableCount++;
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
                         }
                    }
                });

                // Fetch kitchen & bar orders
                const { data: allItems } = await supabase
                    .from('order_items')
                    .select('*, product:products(*), order:orders(*)')
                    .neq('status', 'delivered')
                    .neq('status', 'canceled');
                
                let kitchenCount = 0;
                let barCount = 0;

                if (allItems) {
                    allItems.forEach((item: any) => {
                        if (!item.product || item.product.store_id !== storeId) return;
                        
                        const isCounterAndPending = item.order?.order_type === 'counter' && item.status === 'pending';
                        if (isCounterAndPending) return; // Ignore pending counter items

                        const needsAction = item.status === 'pending' || (item.order?.order_type === 'counter' && item.status === 'accepted');

                        if (needsAction) {
                            const dest = item.product.destination || 'kitchen';
                            if (dest === 'kitchen') kitchenCount++;
                            if (dest === 'bar') barCount++;
                        }
                    });
                }

                if (isMounted) setCounts({ tables: tableCount, kitchen: kitchenCount, bar: barCount });
            } catch (err) {
                console.error("Erro ao carregar notificações", err);
            }
        };

        loadCounts();
        
        const channel = supabase.channel(`notifications_${storeId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tables', filter: `store_id=eq.${storeId}` }, loadCounts)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, loadCounts)
            .subscribe();

        return () => {
            isMounted = false;
            supabase.removeChannel(channel);
        };
    }, [storeId]);

    return counts;
};

const StoreLayout: React.FC<{ children: React.ReactNode, title: string, currentTab: string, onTabChange: (t: string) => void, storeName: string, onLogout: () => void, user: StoreUser & { store: Store } }> = ({ children, title, currentTab, onTabChange, storeName, onLogout, user }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const notifications = useStoreNotifications(user.store.id);

  const allTabs = [
    { id: 'tables', icon: LayoutDashboard, label: 'Gestão de Mesas', permission: 'tables', count: notifications.tables },
    { id: 'counter', icon: Coffee, label: 'Balcão', permission: 'counter' },
    { id: 'kitchen', icon: ChefHat, label: 'Cozinha (KDS)', permission: 'kitchen', count: notifications.kitchen },
    { id: 'bar', icon: Wine, label: 'Bar (KDS)', permission: 'bar', count: notifications.bar },
    { id: 'menu', icon: UtensilsCrossed, label: 'Cardápio', permission: 'menu' },
    { id: 'admin', icon: BarChart3, label: 'Administração', permission: 'admin' }
  ];

  const visibleTabs = allTabs.filter(tab => user.role === 'owner' || user.permissions?.[tab.permission as keyof typeof user.permissions] !== false);
  const bottomNavTabs = visibleTabs.filter(item => ['tables', 'counter', 'kitchen', 'bar'].includes(item.id));

  return (
    <div className={`min-h-screen bg-[var(--bg)] pb-20 md:pb-0 transition-all duration-[var(--dur-slow)] ${isCollapsed ? 'md:pl-20' : 'md:pl-64'}`}>

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
      </header>

      {/* Mobile Menu Drawer (Off-canvas) */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setIsMobileMenuOpen(false)}></div>
            <div className="absolute left-0 top-0 bottom-0 w-64 bg-[var(--ink)] shadow-2xl flex flex-col animate-[slideRight_0.25s_cubic-bezier(0.22,1,0.36,1)] text-left">
                <div className="px-4 py-4 border-b border-white/10 flex justify-between items-center">
                    <span className="font-semibold text-white text-[15px]">Menu Lojista</span>
                    <button onClick={() => setIsMobileMenuOpen(false)} className="p-1.5 text-white/40 hover:text-white/80 hover:bg-white/10 rounded-[var(--r-sm)] u-motion">
                        <X size={18}/>
                    </button>
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

        <div className="p-3 border-t border-white/8">
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
                  {item.id === 'tables' ? 'Mesas' :
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

// --- SUB-MODULE: KITCHEN ---
const KitchenView: React.FC<{ storeId: string }> = ({ storeId }) => {
  const [orders, setOrders] = useState<OrderItem[]>([]);

  const loadOrders = async () => {
      if(!storeId) return;
      const data = await fetchKitchenOrders(storeId, 'kitchen');
      setOrders(data);
  };

  useEffect(() => {
    loadOrders();
    const channel = supabase.channel(`kitchen_updates_${storeId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
            loadOrders(); // Refresh on any change
        })
        .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [storeId]);

  const advanceStatus = async (item: OrderItem) => {
      let nextStatus = OrderStatus.PENDING;
      
      // Order State Machine
      if (item.status === OrderStatus.PENDING) nextStatus = OrderStatus.PREPARING; // Table (Pending -> Preparing)
      else if (item.status === OrderStatus.ACCEPTED) nextStatus = OrderStatus.PREPARING; // Counter (Accepted -> Preparing)
      else if (item.status === OrderStatus.PREPARING) nextStatus = OrderStatus.READY;
      else if (item.status === OrderStatus.READY) nextStatus = OrderStatus.DELIVERED;
      
      // Optimistic UI
      setOrders(prev => prev.map(o => o.id === item.id ? { ...o, status: nextStatus } : o).filter(o => o.status !== OrderStatus.DELIVERED));
      
      await updateOrderItemStatus(item.id, nextStatus);
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

  // Helper function to extract name from notes: "[Name] Notes..."
  const parseItemNote = (fullNote: string) => {
      if (!fullNote) return { client: null, observation: '' };
      const match = fullNote.match(/^\[(.*?)\]\s*(.*)$/);
      if (match) {
          return { client: match[1], observation: match[2].trim() };
      }
      return { client: null, observation: fullNote.trim() };
  };

  const printOrderTicket = (item: OrderItem) => {
      const { client, observation } = parseItemNote(item.notes || '');
      const orderType = item.order?.order_type === 'counter' ? 'BALCÃO' : 'MESA';
      const identifier = item.order?.order_type === 'counter' 
          ? (item.order?.customer_name || 'Balcão') 
          : `MESA ${item.order?.tables?.number || '?'}`;
      
      const printWindow = window.open('', '_blank', 'width=300,height=400');
      if (printWindow) {
          printWindow.document.write(`
              <html>
                  <head>
                      <title>Ticket Cozinha</title>
                      <style>
                          body { font-family: 'Courier New', Courier, monospace; width: 100%; max-width: 48mm; margin: 0; padding: 0; font-size: 10px; color: #000; font-weight: bold; }
                          .header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 2px; margin-bottom: 5px; }
                          .title { font-size: 12px; font-weight: bold; text-transform: uppercase; }
                          .meta { font-size: 8px; margin-top: 1px; }
                          .info { margin-bottom: 5px; border-bottom: 1px dashed #000; padding-bottom: 5px; }
                          .big-text { font-size: 12px; font-weight: bold; }
                          .item { font-size: 12px; font-weight: bold; margin: 5px 0; line-height: 1.1; }
                          .obs { font-weight: bold; margin-top: 2px; font-size: 10px; text-transform: uppercase; }
                          .footer { border-top: 1px dashed #000; margin-top: 5px; padding-top: 2px; text-align: center; font-size: 8px; }
                          @media print {
                              @page { margin: 0; size: auto; }
                              body { margin: 0; padding: 0; }
                          }
                      </style>
                  </head>
                  <body>
                      <div class="header">
                          <div class="title">COZINHA</div>
                          <div class="meta">${new Date().toLocaleString()}</div>
                      </div>
                      <div class="info">
                          <div class="big-text">${orderType}: ${identifier}</div>
                          ${client ? `<div>Cliente: ${client}</div>` : ''}
                      </div>
                      <div class="item">
                          ${item.quantity}x ${item.product?.name || 'Produto Indisponível'}
                      </div>
                      ${observation ? `<div class="obs">OBS: ${observation}</div>` : ''}
                      <div class="footer">
                          Pedido #${item.order_id.slice(0, 8)}
                      </div>
                      <script>
                          setTimeout(() => {
                              window.print();
                              window.onafterprint = function() { window.close(); }
                          }, 500);
                      </script>
                  </body>
              </html>
          `);
          printWindow.document.close();
      }
  };

  return (
    <div>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {orders.map(item => {
                const { client, observation } = parseItemNote(item.notes || '');

                return (
                    <Card key={item.id} className={`${getStatusColor(item.status)} p-4 border-2 transition-all duration-300 shadow-sm hover:shadow-md`}>
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
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={async () => {
                                        if(await confirm({ message: 'Tem certeza que deseja CANCELAR este item?', variant: 'danger' })) {
                                            cancelSpecificOrderItem(item.id);
                                            setOrders(prev => prev.filter(o => o.id !== item.id));
                                        }
                                    }}
                                    className="p-2 rounded-full bg-[var(--err)]/10 text-[var(--err)] hover:bg-[var(--err)]/15 border border-[var(--err)]/20 transition-colors"
                                    title="Cancelar Item"
                                >
                                    <X size={18} />
                                </button>
                                <button
                                    onClick={() => printOrderTicket(item)}
                                    className="p-2 rounded-full bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] border border-[var(--border)] transition-colors"
                                    title="Imprimir Ticket"
                                >
                                    <Printer size={18} />
                                </button>
                                <div className="flex items-center gap-1 text-xs font-mono text-[var(--text-muted)] bg-[var(--surface)]/50 px-2 py-1 rounded-[var(--r-sm)]">
                                    <Clock size={12}/>
                                    {new Date(item.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </div>
                            </div>
                        </div>
                        <h3 className="font-black text-[var(--text)] leading-tight mb-2 text-lg">
                            {item.quantity}x {item.product?.name || 'Produto Indisponível'}
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
                );
            })}
            {orders.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center py-32 text-[var(--text-muted)] bg-[var(--surface)] rounded-[var(--r-lg)] border-2 border-dashed border-[var(--border)]">
                    <CheckCircle className="mb-4 h-20 w-20 opacity-20 text-[var(--ok)]" />
                    <p className="text-xl font-medium">Tudo tranquilo na cozinha!</p>
                    <p className="text-sm">Aguardando novos pedidos...</p>
                </div>
            )}
        </div>
    </div>
  );
};

// --- SUB-MODULE: BAR ---
const BarView: React.FC<{ storeId: string }> = ({ storeId }) => {
  const [orders, setOrders] = useState<OrderItem[]>([]);

  const loadOrders = async () => {
      if(!storeId) return;
      const data = await fetchKitchenOrders(storeId, 'bar');
      setOrders(data);
  };

  useEffect(() => {
    loadOrders();
    const channel = supabase.channel(`bar_updates_${storeId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
            loadOrders(); // Refresh on any change
        })
        .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [storeId]);

  const advanceStatus = async (item: OrderItem) => {
      let nextStatus = OrderStatus.PENDING;
      
      // Order State Machine
      if (item.status === OrderStatus.PENDING) nextStatus = OrderStatus.PREPARING; // Table (Pending -> Preparing)
      else if (item.status === OrderStatus.ACCEPTED) nextStatus = OrderStatus.PREPARING; // Counter (Accepted -> Preparing)
      else if (item.status === OrderStatus.PREPARING) nextStatus = OrderStatus.READY;
      else if (item.status === OrderStatus.READY) nextStatus = OrderStatus.DELIVERED;
      
      // Optimistic UI
      setOrders(prev => prev.map(o => o.id === item.id ? { ...o, status: nextStatus } : o).filter(o => o.status !== OrderStatus.DELIVERED));
      
      await updateOrderItemStatus(item.id, nextStatus);
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

  // Helper function to extract name from notes: "[Name] Notes..."
  const parseItemNote = (fullNote: string) => {
      if (!fullNote) return { client: null, observation: '' };
      const match = fullNote.match(/^\[(.*?)\]\s*(.*)$/);
      if (match) {
          return { client: match[1], observation: match[2].trim() };
      }
      return { client: null, observation: fullNote.trim() };
  };

  const printOrderTicket = (item: OrderItem) => {
      const { client, observation } = parseItemNote(item.notes || '');
      const orderType = item.order?.order_type === 'counter' ? 'BALCÃO' : 'MESA';
      const identifier = item.order?.order_type === 'counter' 
          ? (item.order?.customer_name || 'Balcão') 
          : `MESA ${item.order?.tables?.number || '?'}`;
      
      const printWindow = window.open('', '_blank', 'width=300,height=400');
      if (printWindow) {
          printWindow.document.write(`
              <html>
                  <head>
                      <title>Ticket Bar</title>
                      <style>
                          body { font-family: 'Courier New', Courier, monospace; width: 100%; max-width: 48mm; margin: 0; padding: 0; font-size: 10px; color: #000; font-weight: bold; }
                          .header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 2px; margin-bottom: 5px; }
                          .title { font-size: 12px; font-weight: bold; text-transform: uppercase; }
                          .meta { font-size: 8px; margin-top: 1px; }
                          .info { margin-bottom: 5px; border-bottom: 1px dashed #000; padding-bottom: 5px; }
                          .big-text { font-size: 12px; font-weight: bold; }
                          .item { font-size: 12px; font-weight: bold; margin: 5px 0; line-height: 1.1; }
                          .obs { font-weight: bold; margin-top: 2px; font-size: 10px; text-transform: uppercase; }
                          .footer { border-top: 1px dashed #000; margin-top: 5px; padding-top: 2px; text-align: center; font-size: 8px; }
                          @media print {
                              @page { margin: 0; size: auto; }
                              body { margin: 0; padding: 0; }
                          }
                      </style>
                  </head>
                  <body>
                      <div class="header">
                          <div class="title">BAR</div>
                          <div class="meta">${new Date().toLocaleString()}</div>
                      </div>
                      <div class="info">
                          <div class="big-text">${orderType}: ${identifier}</div>
                          ${client ? `<div>Cliente: ${client}</div>` : ''}
                      </div>
                      <div class="item">
                          ${item.quantity}x ${item.product?.name || 'Produto Indisponível'}
                      </div>
                      ${observation ? `<div class="obs">OBS: ${observation}</div>` : ''}
                      <div class="footer">
                          Pedido #${item.order_id.slice(0, 8)}
                      </div>
                      <script>
                          setTimeout(() => {
                              window.print();
                              window.onafterprint = function() { window.close(); }
                          }, 500);
                      </script>
                  </body>
              </html>
          `);
          printWindow.document.close();
      }
  };

  return (
    <div>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {orders.map(item => {
                const { client, observation } = parseItemNote(item.notes || '');

                return (
                    <Card key={item.id} className={`${getStatusColor(item.status)} p-4 border-2 transition-all duration-300 shadow-sm hover:shadow-md`}>
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
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={async () => {
                                        if(await confirm({ message: 'Tem certeza que deseja CANCELAR este item?', variant: 'danger' })) {
                                            cancelSpecificOrderItem(item.id);
                                            setOrders(prev => prev.filter(o => o.id !== item.id));
                                        }
                                    }}
                                    className="p-2 rounded-full bg-[var(--err)]/10 text-[var(--err)] hover:bg-[var(--err)]/15 border border-[var(--err)]/20 transition-colors"
                                    title="Cancelar Item"
                                >
                                    <X size={18} />
                                </button>
                                <button
                                    onClick={() => printOrderTicket(item)}
                                    className="p-2 rounded-full bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] border border-[var(--border)] transition-colors"
                                    title="Imprimir Ticket"
                                >
                                    <Printer size={18} />
                                </button>
                                <div className="flex items-center gap-1 text-xs font-mono text-[var(--text-muted)] bg-[var(--surface)]/50 px-2 py-1 rounded-[var(--r-sm)]">
                                    <Clock size={12}/>
                                    {new Date(item.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </div>
                            </div>
                        </div>
                        <h3 className="font-black text-[var(--text)] leading-tight mb-2 text-lg">
                            {item.quantity}x {item.product?.name || 'Produto Indisponível'}
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
                );
            })}
            {orders.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center py-32 text-[var(--text-muted)] bg-[var(--surface)] rounded-[var(--r-lg)] border-2 border-dashed border-[var(--border)]">
                    <CheckCircle className="mb-4 h-20 w-20 opacity-20 text-[var(--ok)]" />
                    <p className="text-xl font-medium">Tudo tranquilo no bar!</p>
                    <p className="text-sm">Aguardando novos pedidos...</p>
                </div>
            )}
        </div>
    </div>
  );
};

// --- SUB-MODULE: TABLES ---

const StoreProductModal: React.FC<{ product: Product | null, onClose: () => void, onAdd: (qty: number, notes: string) => void }> = ({ product, onClose, onAdd }) => {
    const [qty, setQty] = useState(1);
    const [notes, setNotes] = useState('');

    useEffect(() => {
        if(product) { setQty(1); setNotes(''); }
    }, [product]);

    if (!product) return null;

    return (
        <Modal isOpen={!!product} onClose={onClose} title="Adicionar Item">
            <div className="space-y-4">
                <div className="flex gap-4">
                    {product.image_url && (
                        <img src={product.image_url} alt={product.name} className="w-24 h-24 object-cover rounded-lg shadow-sm" />
                    )}
                    <div>
                        <h4 className="font-bold text-lg">{product.name}</h4>
                        <p className="text-[var(--text-muted)] text-sm line-clamp-2">{product.description}</p>
                        <span className="text-[var(--brand)] font-bold mt-1 block">R$ {product.price.toFixed(2)}</span>
                    </div>
                </div>

                <div className="flex items-center justify-between bg-[var(--surface-2)] p-3 rounded-xl border border-[var(--border)]">
                    <span className="text-sm font-bold text-[var(--text)]">Quantidade</span>
                    <div className="flex items-center gap-4 bg-[var(--surface)] px-2 py-1 rounded-lg shadow-sm border border-[var(--border)]">
                        <button onClick={() => setQty(Math.max(1, qty - 1))} className="p-2 text-[var(--brand)] hover:bg-[var(--surface-2)] rounded-md"><Minus size={18} /></button>
                        <span className="font-bold text-lg w-8 text-center">{qty}</span>
                        <button onClick={() => setQty(qty + 1)} className="p-2 text-[var(--brand)] hover:bg-[var(--surface-2)] rounded-md"><Plus size={18} /></button>
                    </div>
                </div>

                <Input 
                    label="Observação (Opcional)"
                    placeholder="Ex: Lojista: Sem cebola" 
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                />

                <Button className="w-full mt-4 h-12 text-lg" onClick={() => { onAdd(qty, notes); onClose(); }}>
                    Lançar Pedido • R$ {(product.price * qty).toFixed(2)}
                </Button>
            </div>
        </Modal>
    );
};

const StoreTableMenu: React.FC<{ storeId: string, onAddItem: (product: Product, qty: number, notes: string) => void }> = ({ storeId, onAddItem }) => {
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

    const filteredProducts = useMemo(() => {
        let prods = [...products];
        if (activeCategory) prods = prods.filter(p => p.category_id === activeCategory);
        if (searchTerm) prods = prods.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
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
                            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition-colors border ${
                                activeCategory === cat.id ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]'
                            }`}
                        >
                            {cat.name}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-3 py-2">
                {filteredProducts.map(product => (
                    <Card key={product.id} onClick={() => setSelectedProduct(product)} className="flex flex-col gap-2 p-2 cursor-pointer hover:border-[var(--brand)] transition-colors">
                        {product.image_url ? (
                             <img src={product.image_url} alt={product.name} className="w-full h-24 object-cover rounded-lg bg-[var(--surface-2)]" />
                        ) : (
                             <div className="w-full h-24 bg-[var(--surface-2)] rounded-lg flex items-center justify-center text-[var(--border)] font-bold text-xs">Sem Foto</div>
                        )}
                        <div>
                            <h4 className="font-bold text-sm text-[var(--text)] leading-tight line-clamp-1">{product.name}</h4>
                            <span className="text-[var(--brand)] font-bold text-xs">R$ {product.price.toFixed(2)}</span>
                        </div>
                    </Card>
                ))}
            </div>

            <StoreProductModal 
                product={selectedProduct} 
                onClose={() => setSelectedProduct(null)} 
                onAdd={(qty, notes) => {
                    if (selectedProduct) {
                        onAddItem(selectedProduct, qty, notes);
                    }
                }}
            />
        </div>
    );
};

const TablesView: React.FC<{ store: Store }> = ({ store }) => {
    const storeId = store.id;
    const [tables, setTables] = useState<Table[]>([]);
    const [activeOrders, setActiveOrders] = useState<Order[]>([]);
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

    const togglePin = (e: React.MouseEvent, tableId: string) => {
        e.stopPropagation();
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

    const [currentStore, setCurrentStore] = useState<Store>(store);
    const [paymentMethods, setPaymentMethods] = useState<{ method: string, amount: number }[]>([]);
    const [currentPaymentAmount, setCurrentPaymentAmount] = useState('');
    const [removedServiceFees, setRemovedServiceFees] = useState<Set<string>>(new Set());
    const [currentPaymentMethod, setCurrentPaymentMethod] = useState('CREDIT');

    // StorePaymentModal Tabs & Calculators
    const [paymentTab, setPaymentTab] = useState<'payment' | 'split' | 'users' | 'calculator'>('payment');
    const [paymentPeople, setPaymentPeople] = useState(1);
    const [paymentSelectedItems, setPaymentSelectedItems] = useState<{ [itemId: string]: number }>({});

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
        const isServiceFeeEnabled = currentStore.config?.charge_service_fee && !removedServiceFees.has(selectedTable.id);
        const serviceFee = isServiceFeeEnabled ? subtotal * 0.1 : 0;
        return { subtotal, serviceFee, total: subtotal + serviceFee, allItems: items, isServiceFeeEnabled };
    }, [selectedTable, activeOrders, currentStore, removedServiceFees]);

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
        
        Object.keys(breakdown).forEach(userName => {
            const userSubtotal = breakdown[userName].subtotal;
            const userServiceFee = currentTableSummary.isServiceFeeEnabled ? userSubtotal * 0.1 : 0;
            breakdown[userName].serviceFee = userServiceFee;
            breakdown[userName].total = userSubtotal + userServiceFee;
        });
        
        return breakdown;
    }, [currentTableSummary]);

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

    const calculatorServiceFee = (currentTableSummary?.isServiceFeeEnabled) ? calculatorSubtotal * 0.1 : 0;
    const calculatorTotal = calculatorSubtotal + calculatorServiceFee;


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
        const [t, o, s] = await Promise.all([
            fetchTables(storeId),
            fetchActiveOrdersForTables(storeId),
            fetchStoreById(storeId)
        ]);
        setTables(t);
        setActiveOrders(o);
        if (s) setCurrentStore(s);

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
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, () => loadData())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => loadData())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => loadData())
            .subscribe();
        return () => { supabase.removeChannel(channel); };
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
        const isServiceFeeEnabled = currentStore.config?.charge_service_fee && !removedServiceFees.has(tableId);
        const serviceFee = isServiceFeeEnabled ? subtotal * 0.1 : 0;
        const total = subtotal + serviceFee;

        return { subtotal, serviceFee, total, count: items.length, items: items.slice(0, 3), allItems: items, isServiceFeeEnabled }; // Show top 3
    };

    const printTableBill = (tableId: string) => {
        const summary = getTableSummary(tableId);
        const table = tables.find(t => t.id === tableId);
        if (!table || summary.allItems.length === 0) return;

        const printWindow = window.open('', '_blank', 'width=250,height=600');
        if (printWindow) {
            printWindow.document.write(`
                <html>
                    <head>
                        <title>Comanda Mesa ${table.number}</title>
                        <style>
                            body { font-family: 'Courier New', Courier, monospace; width: 100%; max-width: 48mm; margin: 0; padding: 0; font-size: 10px; color: #000; font-weight: bold; }
                            .header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 2px; margin-bottom: 5px; }
                            .title { font-size: 12px; font-weight: bold; text-transform: uppercase; }
                            .meta { font-size: 8px; margin-top: 1px; }
                            .info { margin-bottom: 5px; border-bottom: 1px dashed #000; padding-bottom: 5px; text-align: center; }
                            .big-text { font-size: 12px; font-weight: bold; }
                            .items-table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 5px; border-bottom: 1px dashed #000; padding-bottom: 2px; }
                            .items-table th { border-bottom: 1px dashed #000; padding-bottom: 3px; text-align: left; }
                            .items-table th.right { text-align: right; }
                            .items-table td { padding: 3px 0; vertical-align: top; }
                            .items-table td.right { text-align: right; white-space: nowrap; padding-left: 5px; }
                            .summary-table { width: 100%; border-collapse: collapse; font-size: 10px; }
                            .summary-table td { padding: 2px 0; }
                            .summary-table td.right { text-align: right; white-space: nowrap; padding-left: 5px; }
                            .total { border-top: 1px dashed #000; margin-top: 5px; padding-top: 4px; font-size: 12px; font-weight: bold; text-align: right; }
                            .footer { border-top: 1px dashed #000; margin-top: 8px; padding-top: 4px; text-align: center; font-size: 10px; white-space: nowrap; overflow: hidden; }
                            @media print {
                                @page { margin: 0; size: auto; }
                                body { margin: 0; padding: 0; }
                            }
                        </style>
                    </head>
                    <body>
                        <div class="header">
                            <div class="title">${store.name}</div>
                            <div class="meta">CNPJ: ${store.cnpj}</div>
                            <div class="meta">${new Date().toLocaleString()}</div>
                        </div>
                        <div class="info">
                            <div class="big-text">MESA ${table.number}</div>
                        </div>
                        
                        <table class="items-table">
                            <thead>
                                <tr>
                                    <th style="width: 15%">QTD</th>
                                    <th style="width: 55%">ITEM</th>
                                    <th class="right" style="width: 30%">R$</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${summary.allItems.map(item => `
                                    <tr>
                                        <td>${item.quantity}x</td>
                                        <td style="padding-right: 4px;">${item.product?.name || 'Produto Indisponível'}</td>
                                        <td class="right">${(item.price_at_time * item.quantity).toFixed(2)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                        
                        ${summary.isServiceFeeEnabled ? `
                            <table class="summary-table">
                                <tr>
                                    <td>Subtotal</td>
                                    <td class="right">R$ ${summary.subtotal.toFixed(2)}</td>
                                </tr>
                                <tr>
                                    <td>Taxa de Serviço (10%)</td>
                                    <td class="right">R$ ${summary.serviceFee.toFixed(2)}</td>
                                </tr>
                            </table>
                        ` : ''}

                        <div class="total">
                            TOTAL: R$ ${summary.total.toFixed(2)}
                        </div>
                        
                        <div class="footer">
                            norteparanegocios.com.br
                        </div>
                        
                        <script>
                            setTimeout(() => {
                                window.print();
                                window.onafterprint = function() { window.close(); }
                            }, 500);
                        </script>
                    </body>
                </html>
            `);
            printWindow.document.close();
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

    const handleOpenPayment = () => {
        if (!selectedTable) return;
        const summary = getTableSummary(selectedTable.id);
        setPaymentMethods([]);
        setCurrentPaymentAmount(summary.total.toFixed(2));
        setCurrentPaymentMethod('CREDIT');
        setPaymentTab('payment');
        setPaymentPeople(1);
        setPaymentSelectedItems({});
        setShowPaymentModal(true);
    };

    const handleAddPayment = () => {
        const amount = parseFloat(currentPaymentAmount.replace(',', '.'));
        if (isNaN(amount) || amount <= 0) return;
        
        setPaymentMethods(prev => [...prev, { method: currentPaymentMethod, amount }]);
        
        // Calculate remaining
        const summary = selectedTable ? getTableSummary(selectedTable.id) : { total: 0 };
        const currentTotalPaid = paymentMethods.reduce((acc, p) => acc + p.amount, 0) + amount;
        const remaining = Math.max(0, summary.total - currentTotalPaid);
        
        setCurrentPaymentAmount(remaining.toFixed(2));
    };

    const handleRemovePayment = (index: number) => {
        setPaymentMethods(prev => prev.filter((_, i) => i !== index));
    };

    const handleFinishPayment = async () => {
        if (!selectedTable) return;
        
        const summary = getTableSummary(selectedTable.id);
        const totalPaid = paymentMethods.reduce((acc, p) => acc + p.amount, 0);
        
        if (totalPaid < summary.total - 0.01) { // Tolerance for float
            toast.error('O valor pago é menor que o total da conta.');
            return;
        }

        const paymentData = {
            total: summary.total,
            methods: paymentMethods
        };

        try {
            const result = await closeTableSession(selectedTable.id, paymentData);
            
            if (result.success) {
                if (result.message && result.message.includes("Colunas ausentes")) {
                    setShowFixDbModal(true);
                } else if (result.message) {
                    toast.info(result.message);
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
        }
    };

    const handleCloseTable = async () => {
        // Legacy close (without payment modal) - kept just in case, but UI now points to Payment
        if (!selectedTable) return;
        const result = await closeTableSession(selectedTable.id);
        if (result.success) {
            if (result.message && result.message.includes("Colunas ausentes")) {
                setShowFixDbModal(true);
            } else if (result.message) {
                toast.info(result.message);
            }
            setRemovedServiceFees(prev => {
                const next = new Set(prev);
                next.delete(selectedTable.id);
                return next;
            });
            setSelectedTable(null);
            setShowFullBill(false);
            loadData();
        } else {
            toast.error('Não foi possível fechar a mesa: ' + (result.message || 'Erro desconhecido'));
        }
    };

    const handleBlockToggle = async (e: React.MouseEvent, table: Table) => {
        e.stopPropagation();
        await toggleTableBlock(table.id, table.status);
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
    
    const handleAddItem = async (product: Product, qty: number, notes: string) => {
        if (!selectedTable) return;
        
        const finalNotes = notes ? `[Lojista] ${notes}` : `[Lojista]`;
        
        try {
            // Reuses createOrder logic which handles adding to existing orders
            await createOrder(selectedTable.id, storeId, [{
                product, quantity: qty, notes: finalNotes
            }], "Lojista");
            
            toast.success("Item adicionado com sucesso!");
            // Optional: Close menu to go back to bill, or stay to add more
            // setShowMenuMode(false);
        } catch (e) {
            toast.error("Erro ao adicionar item.");
            console.error(e);
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
            <div className="flex justify-end mb-4 gap-2">
                <Button 
                    variant={pinBlockEnabled ? "primary" : "secondary"}
                    onClick={handlePinBlockToggle}
                    className={`flex items-center gap-2 text-sm ${pinBlockEnabled ? 'bg-[var(--err)] hover:bg-[var(--err)]/90 text-white border-[var(--err)]' : 'text-[var(--text-muted)]'}`}
                    title="Se ativado, novos clientes precisarão do PIN para abrir a mesa"
                >
                    {pinBlockEnabled ? <Lock size={18} /> : <Unlock size={18} />}
                    {pinBlockEnabled ? "Bloqueio PIN Ativo" : "Bloqueio PIN Inativo"}
                </Button>

                <Button 
                    variant="secondary" 
                    onClick={() => setAreCardsCollapsed(!areCardsCollapsed)}
                    className="flex items-center gap-2 text-sm"
                >
                    {areCardsCollapsed ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                    {areCardsCollapsed ? "Expandir Cards" : "Colapsar Cards"}
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {tables.map(table => {
                    const summary = getTableSummary(table.id);
                    const isBlocked = table.status === 'blocked';
                    const isOccupied = table.status === 'occupied' || table.status === 'waiting_bill';
                    const isWaiterRequested = table.waiter_requested;
                    const hasOrders = summary.count > 0;
                    
                    return (
                        <Card 
                            key={table.id} 
                            onClick={() => { if(!isBlocked) { setSelectedTable(table); setShowFullBill(false); setShowMenuMode(false); } }}
                            className={`relative flex flex-col justify-between p-4 transition-all duration-300 border-2 group ${
                                areCardsCollapsed ? (isWaiterRequested ? 'h-[220px]' : 'h-[160px]') : 'h-[340px]'
                            } ${
                                isBlocked ? 'bg-[var(--surface-2)] border-[var(--border)] grayscale opacity-80' :
                                table.status === 'waiting_bill' ? 'bg-[var(--warn)]/5 border-[var(--warn)]/30 shadow-lg' :
                                isWaiterRequested ? 'border-[var(--err)]/50 bg-[var(--err)]/5 shadow-xl animate-pulse' :
                                isOccupied ? 'bg-[var(--info)]/5 border-[var(--info)]/25 shadow-lg' :
                                'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--brand)]/30 hover:shadow-lg'
                            }`}
                        >
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

                            {/* Header: Number & Block Button */}
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex flex-col">
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-sm font-bold text-[var(--text-muted)] uppercase">Mesa</span>
                                        <span className="text-5xl font-black text-[var(--text)]">{table.number}</span>
                                    </div>
                                    {/* PIN Display - Compact & Toggleable */}
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">PIN:</span>
                                        <div className="flex items-center gap-2 bg-[var(--surface-2)] px-2 py-0.5 rounded-md">
                                            <span className="font-mono font-bold text-sm text-[var(--text)]">
                                                {visiblePins.has(table.id) ? table.pin : '••••'}
                                            </span>
                                            <button
                                                onClick={(e) => togglePin(e, table.id)}
                                                className="text-[var(--text-muted)] hover:text-[var(--brand)] transition-colors"
                                                title={visiblePins.has(table.id) ? "Ocultar PIN" : "Ver PIN"}
                                            >
                                                {visiblePins.has(table.id) ? <EyeOff size={14} /> : <Eye size={14} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <button 
                                    onClick={(e) => {
                                        if(!isBlocked && hasOrders) return; // Prevent blocking if has orders
                                        handleBlockToggle(e, table);
                                    }}
                                    disabled={!isBlocked && hasOrders}
                                    className={`p-2 rounded-lg transition-colors z-10 ${
                                        isBlocked ? 'text-[var(--err)] bg-[var(--err)]/10 hover:bg-[var(--err)]/15' :
                                        (!isBlocked && hasOrders) ? 'text-[var(--border)] cursor-not-allowed opacity-50' :
                                        'text-[var(--text-muted)]/50 hover:text-[var(--text-muted)] hover:bg-[var(--surface-2)]'
                                    }`}
                                    title={isBlocked ? "Desbloquear" : hasOrders ? "Mesa com pedidos não pode ser bloqueada" : "Bloquear Mesa"}
                                >
                                    {isBlocked ? <Lock size={20} /> : <Unlock size={20} />}
                                </button>
                            </div>

                            {/* Status Badge */}
                            <div className="mb-2">
                                {isBlocked ? (
                                    <span className="w-full block text-center bg-[var(--surface-2)] text-[var(--text-muted)] text-xs font-bold py-1 rounded-[var(--r-sm)] uppercase tracking-wider">Bloqueada</span>
                                ) : isOccupied ? (
                                    <span className={`w-full block text-center text-xs font-bold py-1 rounded-[var(--r-sm)] uppercase tracking-wider ${table.status === 'waiting_bill' ? 'bg-[var(--warn)] text-white' : 'bg-[var(--info)] text-white'}`}>
                                        {table.status === 'waiting_bill' ? 'Pediu Conta' : 'Ocupada'}
                                    </span>
                                ) : (
                                    <span className="w-full block text-center bg-[var(--ok)]/10 text-[var(--ok)] text-xs font-bold py-1 rounded-[var(--r-sm)] uppercase tracking-wider">Livre</span>
                                )}
                            </div>

                            {/* Host Name */}
                            <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] mb-3 px-1">
                                <User size={12} />
                                <span className="font-bold truncate max-w-[150px]">
                                    {isOccupied ? (table.current_host_name || 'Lojista') : '—'}
                                </span>
                            </div>

                            {/* Content Area: Items or Empty State */}
                            {!areCardsCollapsed && (
                                isOccupied ? (
                                    <div className="flex-1 flex flex-col min-h-0 bg-[var(--surface)]/60 rounded-lg p-2 border border-[var(--border)]">
                                        <div className="flex justify-between items-end border-b border-[var(--border)] pb-1 mb-1">
                                            <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Últimos Pedidos</span>
                                            <div className="text-right leading-none">
                                                <span className="block text-[10px] text-[var(--text-muted)]">Total</span>
                                                <span className="font-bold text-[var(--brand)] num">R$ {summary.total.toFixed(2)}</span>
                                            </div>
                                        </div>

                                        <div className="flex-1 overflow-hidden flex flex-col gap-1.5">
                                            {summary.items.length > 0 ? (
                                                summary.items.map((item, idx) => (
                                                    <div key={idx} className="flex justify-between items-center gap-1.5 text-xs text-[var(--text)]">
                                                        <span className="truncate min-w-0 flex-1 font-medium">{item.quantity}x {item.product?.name}</span>
                                                        {item.status === 'delivered' && <CheckCircle size={12} className="text-[var(--ok)] flex-shrink-0" />}
                                                        {item.status === 'preparing' && <ChefHat size={12} className="text-[var(--info)] flex-shrink-0" />}
                                                        {(item.status === 'pending' || item.status === 'accepted') && <Clock size={12} className="text-[var(--warn)] flex-shrink-0" />}
                                                    </div>
                                                ))
                                            ) : (
                                                <p className="text-xs text-[var(--text-muted)] text-center italic mt-2">Sem pedidos</p>
                                            )}
                                            {summary.count > 3 && (
                                                <p className="text-[10px] text-center text-[var(--text-muted)] mt-auto">+ {summary.count - 3} itens...</p>
                                            )}
                                        </div>
                                        <div className="mt-1 pt-1 border-t border-[var(--border)] text-[10px] text-center text-[var(--text-muted)]">
                                            {summary.count} itens no total
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center opacity-30">
                                        <UtensilsCrossed size={40} />
                                        <p className="text-xs font-bold mt-2">Disponível</p>
                                    </div>
                                )
                            )}

                            {/* Footer: Waiter Action Only */}
                            {isWaiterRequested && (
                                <div className="mt-3 pt-2 border-t border-[var(--border)] flex flex-col items-center">
                                    <Button
                                        onClick={(e) => { e.stopPropagation(); handleDismissWaiter(table.id); }}
                                        className="w-full h-8 text-xs bg-[var(--err)] hover:bg-[var(--err)]/90 shadow-[var(--err)]/20 shadow-sm animate-bounce"
                                    >
                                        <BellRing size={14} className="mr-1"/> ATENDER GARÇOM
                                    </Button>
                                </div>
                            )}
                        </Card>
                    );
                })}
            </div>

            {/* MODAL DA MESA */}
            <Modal isOpen={!!selectedTable} onClose={() => setSelectedTable(null)} title={`Mesa ${selectedTable?.number} - ${selectedTable?.current_host_name || 'Lojista'}`}>
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
                            }`}>{selectedTable?.status}</span>
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
                                                     R$ {selectedTable ? getTableSummary(selectedTable.id).total.toFixed(2) : '0.00'}
                                                 </span>
                                             </div>
                                         </Button>
                                     </div>

                                     <div className="border-t border-[var(--border)] pt-4 mt-2">
                                         <p className="mb-3 font-bold text-xs text-[var(--text-muted)] uppercase tracking-wider text-center">Gestão</p>
                                         <Button onClick={handleOpenPayment} variant="danger" className="w-full text-sm shadow-[var(--ok)]/20 shadow-lg bg-[var(--ok)] hover:bg-[var(--ok)]/90 border-none">
                                            <Wallet size={18} className="mr-2"/> RECEBER & FINALIZAR
                                         </Button>
                                     </div>
                                 </div>
                             )}
                             {selectedTable?.status === 'available' && (
                                <Button className="w-full text-lg h-14" onClick={async () => {
                                    if(selectedTable) {
                                        // 1. UPDATE LOCAL STATE IMMEDIATELY (Visual Feedback)
                                        setSelectedTable({ ...selectedTable, status: TableStatus.OCCUPIED, current_host_name: "Lojista" });
                                        
                                        // 2. CALL API
                                        await updateTableStatus(selectedTable.id, TableStatus.OCCUPIED, "Lojista");
                                        
                                        // 3. REFRESH DATA (Optional, but good practice)
                                        loadData();
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
                                <button onClick={() => setShowMenuMode(false)} className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] underline">Voltar</button>
                            </div>
                            <div className="border border-[var(--border)] rounded-xl p-2 bg-[var(--surface-2)] h-[400px]">
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
                                                {items.map(item => (
                                                    <div key={item.id} className="flex justify-between p-3 border-b border-[var(--border)] text-sm hover:bg-[var(--surface-2)] transition-colors group">
                                                        <div className="flex-1">
                                                            <span className="font-bold text-[var(--text)] flex items-center gap-2">
                                                                <span className="bg-[var(--surface-2)] px-1.5 rounded text-xs text-[var(--text-muted)]">x{item.quantity}</span>
                                                                {item.product?.name}
                                                            </span>
                                                            <div className="text-xs text-[var(--text-muted)] flex items-center gap-2 mt-1 ml-7">
                                                                {item.status === 'delivered' ? <span className="text-[var(--ok)] flex items-center gap-1"><CheckCircle size={10}/> Entregue</span> :
                                                                 item.status === 'preparing' ? <span className="text-[var(--info)] flex items-center gap-1"><ChefHat size={10}/> Preparando</span> :
                                                                 <span className="text-[var(--warn)] flex items-center gap-1"><Clock size={10}/> Aguardando</span>}
                                                                <span>• R$ {item.price_at_time.toFixed(2)} un.</span>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <span className="font-medium text-[var(--text)]">R$ {(item.price_at_time * item.quantity).toFixed(2)}</span>
                                                            <button
                                                                onClick={() => handleDeleteItem(item.id)}
                                                                className="text-[var(--text-muted)]/50 hover:text-[var(--err)] p-1"
                                                                title="Cancelar Item"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                                {summary?.isServiceFeeEnabled && (
                                                    <div className="flex justify-between p-3 border-b border-[var(--border)] text-sm bg-[var(--info)]/5">
                                                        <div className="flex-1">
                                                            <span className="font-bold text-[var(--text)]">Taxa de Serviço (10%)</span>
                                                            <div className="text-xs text-[var(--text-muted)] mt-1">Opcional</div>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <span className="font-medium text-[var(--text)]">R$ {summary.serviceFee.toFixed(2)}</span>
                                                            <button 
                                                                onClick={() => {
                                                                    setRemovedServiceFees(prev => {
                                                                        const next = new Set(prev);
                                                                        next.add(selectedTable!.id);
                                                                        return next;
                                                                    });
                                                                }}
                                                                className="text-[var(--text-muted)]/50 hover:text-[var(--err)] p-1"
                                                                title="Remover Taxa"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>

                                <div className="bg-[var(--surface-2)] p-4 border-t border-[var(--border)] flex justify-between items-center">
                                    <span className="font-bold text-lg text-[var(--text)]">Total Final</span>
                                    <span className="font-black text-2xl text-[var(--brand)]">
                                        R$ {selectedTable ? getTableSummary(selectedTable.id).total.toFixed(2) : '0.00'}
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
                            <Button onClick={handleOpenPayment} className="w-full text-sm font-bold bg-[var(--ok)] hover:bg-[var(--ok)]/90 text-white shadow-lg shadow-[var(--ok)]/20 h-12">
                                <Wallet size={18} className="mr-2"/> RECEBER PAGAMENTO
                            </Button>
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
                                className={`p-3 rounded-lg border-2 flex flex-col items-center justify-center transition-all ${
                                    targetTableId === table.id
                                    ? 'border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)] font-bold'
                                    : 'border-[var(--border)] hover:border-[var(--brand)]/50 text-[var(--text-muted)]'
                                }`}
                            >
                                <span className="text-lg">Mesa {table.number}</span>
                                <span className="text-xs font-normal opacity-70">Livre</span>
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
            <Modal isOpen={showPaymentModal} onClose={() => setShowPaymentModal(false)} title="Receber Pagamento">
                <div className="space-y-4">
                    {/* Tabs */}
                    <div className="flex p-1 bg-[var(--surface-2)] rounded-lg">
                        <button onClick={() => setPaymentTab('payment')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all flex flex-col items-center gap-1 ${paymentTab === 'payment' ? 'bg-[var(--surface)] text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)]'}`}>
                            <Wallet size={14}/> Pagamento
                        </button>
                        <button onClick={() => setPaymentTab('split')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all flex flex-col items-center gap-1 ${paymentTab === 'split' ? 'bg-[var(--surface)] text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)]'}`}>
                            <Users size={14}/> Divisão
                        </button>
                        <button onClick={() => setPaymentTab('users')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all flex flex-col items-center gap-1 ${paymentTab === 'users' ? 'bg-[var(--surface)] text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)]'}`}>
                            <List size={14}/> Por Cliente
                        </button>
                        <button onClick={() => setPaymentTab('calculator')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all flex flex-col items-center gap-1 ${paymentTab === 'calculator' ? 'bg-[var(--surface)] text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)]'}`}>
                            <Calculator size={14}/> Calculadora
                        </button>
                    </div>

                    <div className="max-h-[60vh] overflow-y-auto pr-1">
                        {paymentTab === 'payment' && (
                            <div className="space-y-6 pt-2">
                                <div className="bg-[var(--surface-2)] p-4 rounded-xl border border-[var(--border)] text-center">
                                    <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Total a Receber</p>
                                    <p className="text-4xl font-black text-[var(--text)] mt-1">
                                        R$ {selectedTable ? getTableSummary(selectedTable.id).total.toFixed(2) : '0.00'}
                                    </p>
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
                                            onClick={() => setCurrentPaymentMethod(m.id)}
                                            className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${
                                                currentPaymentMethod === m.id
                                                ? 'border-[var(--brand)] bg-[var(--brand)]/5 text-[var(--brand)]'
                                                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--border)]'
                                            }`}
                                        >
                                            <m.icon size={24} className="mb-1" />
                                            <span className="text-xs font-bold">{m.label}</span>
                                        </button>
                                    ))}
                                </div>

                                {/* Amount Input */}
                                <div className="flex gap-2">
                                    <div className="flex-1 relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] font-bold">R$</span>
                                        <input
                                            type="number"
                                            className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-[var(--border)] focus:border-[var(--brand)] focus:outline-none font-bold text-lg"
                                            placeholder="0.00"
                                            value={currentPaymentAmount}
                                            onChange={e => setCurrentPaymentAmount(e.target.value)}
                                        />
                                    </div>
                                    <Button onClick={handleAddPayment} className="px-6 bg-[var(--ink)] text-white">
                                        <Plus size={20} />
                                    </Button>
                                </div>

                                {/* Payment List */}
                                <div className="bg-[var(--surface-2)] rounded-xl p-3 border border-[var(--border)] min-h-[100px]">
                                    {paymentMethods.length > 0 ? (
                                        <ul className="space-y-2">
                                            {paymentMethods.map((p, idx) => (
                                                <li key={idx} className="flex justify-between items-center text-sm bg-[var(--surface)] p-2 rounded border border-[var(--border)] shadow-sm">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-[var(--text)]">
                                                            {p.method === 'CREDIT' ? 'Crédito' :
                                                             p.method === 'DEBIT' ? 'Débito' :
                                                             p.method === 'PIX' ? 'PIX' :
                                                             p.method === 'CASH' ? 'Dinheiro' : 'Cortesia'}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <span className="font-mono font-bold">R$ {p.amount.toFixed(2)}</span>
                                                        <button onClick={() => handleRemovePayment(idx)} className="text-[var(--err)]/60 hover:text-[var(--err)]">
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

                                {/* Summary & Action */}
                                <div className="border-t border-[var(--border)] pt-4">
                                    <div className="flex justify-between text-sm mb-4 px-2">
                                        <span className="text-[var(--text-muted)]">Restante a Pagar:</span>
                                        <span className="font-bold text-[var(--err)]">
                                            R$ {Math.max(0, (selectedTable ? getTableSummary(selectedTable.id).total : 0) - paymentMethods.reduce((acc, p) => acc + p.amount, 0)).toFixed(2)}
                                        </span>
                                    </div>
                                    <Button
                                        onClick={handleFinishPayment}
                                        className="w-full h-12 text-lg font-bold bg-[var(--ok)] hover:bg-[var(--ok)]/90 text-white shadow-lg shadow-[var(--ok)]/20"
                                        disabled={Math.max(0, (selectedTable ? getTableSummary(selectedTable.id).total : 0) - paymentMethods.reduce((acc, p) => acc + p.amount, 0)) > 0.01}
                                    >
                                        <CheckCircle size={20} className="mr-2"/> FINALIZAR MESA
                                    </Button>
                                </div>
                            </div>
                        )}

                        {paymentTab === 'split' && currentTableSummary && (
                            <div className="space-y-6 pt-2 animate-fade-in">
                                <div className="bg-[var(--brand)]/5 p-4 rounded-xl border border-[var(--brand)]/10 text-center">
                                    <p className="text-sm text-[var(--text-muted)] uppercase font-bold tracking-wider">Total da Mesa</p>
                                    <p className="text-3xl font-black text-[var(--brand)] mt-1">R$ {currentTableSummary.total.toFixed(2)}</p>
                                    {currentTableSummary.isServiceFeeEnabled && (
                                        <p className="text-xs text-[var(--text-muted)] mt-1">Inclui R$ {currentTableSummary.serviceFee.toFixed(2)} de taxa de serviço (10%)</p>
                                    )}
                                </div>
                                <div className="flex items-center justify-center gap-6 py-2">
                                    <button onClick={() => setPaymentPeople(Math.max(1, paymentPeople - 1))} className="w-10 h-10 bg-[var(--surface-2)] rounded-full flex items-center justify-center hover:bg-[var(--border)] transition-colors"><Minus size={18} /></button>
                                    <div className="text-center min-w-[80px]">
                                        <span className="block text-2xl font-bold text-[var(--text)]">{paymentPeople}</span>
                                        <span className="text-[10px] text-[var(--text-muted)] font-bold uppercase">Pessoas</span>
                                    </div>
                                    <button onClick={() => setPaymentPeople(paymentPeople + 1)} className="w-10 h-10 bg-[var(--surface-2)] rounded-full flex items-center justify-center hover:bg-[var(--border)] transition-colors"><Plus size={18}/></button>
                                </div>
                                <div className="border-t border-dashed border-[var(--border)] pt-4 text-center">
                                    <p className="text-[var(--text-muted)] text-sm mb-1">Valor por pessoa</p>
                                    <p className="text-2xl font-bold text-[var(--text)]">R$ {(currentTableSummary.total / paymentPeople).toFixed(2)}</p>
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
                                {Object.entries(usersBreakdown).map(([name, data]: [string, any]) => (
                                    <div key={name} className="border border-[var(--border)] rounded-xl overflow-hidden">
                                        <div className="bg-[var(--surface-2)] p-3 flex justify-between items-center border-b border-[var(--border)]">
                                            <span className="font-bold text-[var(--text)] flex items-center gap-2"><User size={14}/> {name}</span>
                                            <span className="font-bold text-[var(--brand)]">R$ {data.total.toFixed(2)}</span>
                                        </div>
                                        <div className="p-2 space-y-1">
                                            {data.items.map((it: any) => (
                                                <div key={it.id} className="flex justify-between items-center text-xs text-[var(--text-muted)] px-2 py-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <span>{it.quantity}x {it.product?.name}</span>
                                                    </div>
                                                    <span>{(it.price_at_time * it.quantity).toFixed(2)}</span>
                                                </div>
                                            ))}
                                            {currentTableSummary?.isServiceFeeEnabled && (
                                                <div className="flex justify-between items-center text-xs text-[var(--text-muted)] px-2 py-1 border-t border-[var(--border)] mt-1 pt-1">
                                                    <span>Taxa de Serviço (10%)</span>
                                                    <span>{data.serviceFee.toFixed(2)}</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="p-2 border-t border-[var(--border)]">
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
                                                        {item.product?.name}
                                                    </span>
                                                    <span className="text-sm font-medium">R$ {item.price_at_time.toFixed(2)}</span>
                                                </div>

                                                {isSelected && item.quantity > 1 && (
                                                    <div className="flex items-center gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                                                        <span className="text-xs text-[var(--text-muted)]">Qtd:</span>
                                                        <button onClick={() => updateSelectionQty(item.id, -1, item.quantity)} className="w-6 h-6 bg-[var(--surface)] border border-[var(--border)] rounded flex items-center justify-center text-[var(--brand)]"><Minus size={12}/></button>
                                                        <span className="text-sm font-bold w-4 text-center">{selectedQty}</span>
                                                        <button onClick={() => updateSelectionQty(item.id, 1, item.quantity)} className="w-6 h-6 bg-[var(--surface)] border border-[var(--border)] rounded flex items-center justify-center text-[var(--brand)]"><Plus size={12}/></button>
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
                                        <span className="font-black text-xl">R$ {calculatorTotal.toFixed(2)}</span>
                                    </div>
                                    {currentTableSummary.isServiceFeeEnabled && (
                                        <div className="text-xs text-white/50 mt-1 text-right">
                                            Inclui R$ {calculatorServiceFee.toFixed(2)} de taxa de serviço
                                        </div>
                                    )}
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
                            className="absolute top-2 right-2 bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded text-xs transition-colors"
                        >
                            Copiar
                        </button>
                    </div>

                    <div className="flex justify-end pt-2">
                        <Button onClick={() => setShowFixDbModal(false)}>Entendi</Button>
                    </div>
                </div>
            </Modal>
        </>
    );
};

// --- SUB-MODULE: COUNTER (BALCÃO) ---

const CounterView: React.FC<{ storeId: string }> = ({ storeId }) => {
    const [orders, setOrders] = useState<Order[]>([]);
    
    const load = async () => {
        const data = await fetchCounterOrders(storeId);
        setOrders(data);
    };

    useEffect(() => {
        load();
        const channel = supabase.channel(`counter_${storeId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => load())
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [storeId]);
    
    const handleClose = async (orderId: string) => {
        if(await confirm("Confirma a entrega e pagamento deste pedido?")) {
            try {
                await closeCounterOrder(orderId);
            } catch (e: any) {
                if (e.message === "schema cache updated_at") {
                    toast.error("Para calcular o tempo médio, execute este script no SQL Editor do Supabase:\n\nALTER TABLE orders ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();\nNOTIFY pgrst, 'reload schema';", 10000);
                } else {
                    toast.error("Erro ao fechar pedido: " + e.message);
                }
            }
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

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {orders.map(order => {
                const itemCount = order.order_items?.reduce((a,b) => a+b.quantity, 0) || 0;
                const total = order.order_items?.reduce((a,b) => a+(b.quantity * b.price_at_time), 0) || 0;
                const status = order.status;

                return (
                    <Card key={order.id} accentColor="var(--brand)" className="flex flex-col p-4 pl-5">
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
                                     <span className="truncate flex-1">{item.quantity}x {item.product?.name}</span>
                                     <span className="font-mono text-xs">{(item.price_at_time * item.quantity).toFixed(2)}</span>
                                 </div>
                             ))}
                         </div>

                         <div className="mt-auto pt-3 border-t border-[var(--border)] flex justify-between items-center">
                             <div>
                                 <p className="text-xs text-[var(--text-muted)] font-bold uppercase">Total</p>
                                 <p className="text-xl font-black text-[var(--text)] num">R$ {total.toFixed(2)}</p>
                             </div>
                             <Button onClick={() => handleClose(order.id)} variant="primary" className="h-10 text-sm">
                                 <CheckCircle size={16} className="mr-1"/> Entregar
                             </Button>
                         </div>
                    </Card>
                );
            })}
            {orders.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center py-20 text-[var(--text-muted)]">
                    <Coffee size={48} className="mb-4 opacity-20"/>
                    <p>Nenhum pedido no balcão no momento.</p>
                </div>
            )}
        </div>
    );
};

// --- SUB-MODULE: MENU MANAGEMENT ---

const MenuManagementView: React.FC<{ store: Store, onStoreUpdate?: (store: Store) => void }> = ({ store, onStoreUpdate }) => {
    const storeId = store.id;
    const [categories, setCategories] = useState<Category[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [newCatName, setNewCatName] = useState('');
    
    // Product Form
    const [pName, setPName] = useState('');
    const [pDesc, setPDesc] = useState('');
    const [pPrice, setPPrice] = useState('');
    const [pCat, setPCat] = useState('');
    const [pTime, setPTime] = useState('15');
    const [pDestination, setPDestination] = useState<'kitchen' | 'bar'>('kitchen');
    const [pFile, setPFile] = useState<File | null>(null);
    const [pPreview, setPPreview] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const loadMenu = async () => {
        const { categories: c, products: p } = await fetchMenu(storeId, false);
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
                // Reordering within the same category
                const catProducts = products.filter(p => p.category_id === sourceCategoryId).sort((a, b) => (a.order || 0) - (b.order || 0));
                const otherProducts = products.filter(p => p.category_id !== sourceCategoryId);
                
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
                // Moving to a different category
                const sourceCatProducts = products.filter(p => p.category_id === sourceCategoryId).sort((a, b) => (a.order || 0) - (b.order || 0));
                const destCatProducts = products.filter(p => p.category_id === destCategoryId).sort((a, b) => (a.order || 0) - (b.order || 0));
                const otherProducts = products.filter(p => p.category_id !== sourceCategoryId && p.category_id !== destCategoryId);

                const newSourceProducts = [...sourceCatProducts];
                const [moved] = newSourceProducts.splice(source.index, 1);
                moved.category_id = destCategoryId; // Update category_id

                const newDestProducts = [...destCatProducts];
                newDestProducts.splice(destination.index, 0, moved);

                const updatedSourceProducts = newSourceProducts.map((prod, index) => ({ ...prod, order: index + 1 }));
                const updatedDestProducts = newDestProducts.map((prod, index) => ({ ...prod, order: index + 1 }));

                setProducts([...otherProducts, ...updatedSourceProducts, ...updatedDestProducts]);

                try {
                    // Update category_id for the moved product
                    await updateProduct(moved.id, { category_id: destCategoryId });
                    
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

    const openProductModal = (product?: Product) => {
        if (product) {
            setEditingProduct(product);
            setPName(product.name);
            setPDesc(product.description);
            setPPrice(product.price.toString());
            setPCat(product.category_id);
            setPTime(product.prep_time_minutes.toString());
            setPPreview(product.image_url);
            setPDestination(product.destination || 'kitchen');
        } else {
            setEditingProduct(null);
            setPName('');
            setPDesc('');
            setPPrice('');
            setPCat(categories[0]?.id || '');
            setPTime('15');
            setPPreview(null);
            setPDestination('kitchen');
        }
        setPFile(null);
        setIsProductModalOpen(true);
    };

    const handleSaveProduct = async () => {
        if (!pName || !pPrice || !pCat) return toast.error('Preencha os campos obrigatórios');
        setIsLoading(true);

        try {
            let imageUrl = pPreview;
            if (pFile) {
                imageUrl = await uploadProductImage(pFile);
            }

            const productData = {
                name: pName,
                description: pDesc,
                price: parseFloat(pPrice),
                category_id: pCat,
                prep_time_minutes: parseInt(pTime),
                image_url: imageUrl,
                destination: pDestination
            };

            if (editingProduct) {
                await updateProduct(editingProduct.id, productData);
            } else {
                await createProduct(storeId, pCat, productData);
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
            await deleteProduct(id);
            loadMenu();
        }
    };

    const handleToggleAvailability = async (product: Product) => {
        await updateProduct(product.id, { available: !product.available });
        loadMenu();
    }

    const [serviceFeeEnabled, setServiceFeeEnabled] = useState(store.config?.charge_service_fee ?? false);
    const [currentStoreConfig, setCurrentStoreConfig] = useState(store.config);

    useEffect(() => {
        // Fetch fresh store config to ensure we have the latest state
        fetchStoreById(storeId).then(freshStore => {
            if (freshStore) {
                setCurrentStoreConfig(freshStore.config);
                setServiceFeeEnabled(freshStore.config?.charge_service_fee ?? false);
            }
        });
    }, [storeId]);

    const handleToggleServiceFee = async () => {
        const newValue = !serviceFeeEnabled;
        setServiceFeeEnabled(newValue);
        try {
            const newConfig = {
                ...currentStoreConfig,
                charge_service_fee: newValue
            };
            await updateStoreConfig(store.id, newConfig);
            setCurrentStoreConfig(newConfig);
            if (onStoreUpdate) {
                onStoreUpdate({ ...store, config: newConfig });
            }
        } catch (e) {
            console.error("Error updating config", e);
            setServiceFeeEnabled(!newValue); // Revert on error
            toast.error("Erro ao atualizar configuração de taxa de serviço.");
        }
    };

    return (
        <div className="space-y-8">
            {/* STORE SETTINGS */}
            <section className="bg-[var(--surface)] p-6 rounded-xl border border-[var(--border)] shadow-sm">
                <h3 className="font-bold text-lg mb-4 text-[var(--text)]">Configurações Gerais</h3>
                <div className="flex items-center justify-between p-4 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
                    <div>
                        <h4 className="font-bold text-[var(--text)]">Cobrar Taxa de Serviço (10%)</h4>
                        <p className="text-sm text-[var(--text-muted)]">Aplica 10% de taxa opcional no total das comandas e pedidos.</p>
                    </div>
                    <button 
                        onClick={handleToggleServiceFee}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${serviceFeeEnabled ? 'bg-[var(--ok)]' : 'bg-[var(--border)]'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${serviceFeeEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>
            </section>

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
                                {categories.map((cat, index) => (
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
                                                <button onClick={() => handleDeleteCategory(cat.id)} className="text-[var(--text-muted)]/50 hover:text-[var(--err)] opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <X size={14}/>
                                                </button>
                                            </div>
                                        )}
                                    </Draggable>
                                ))}
                                {provided.placeholder}
                                {categories.length === 0 && <span className="text-[var(--text-muted)] text-sm italic">Nenhuma categoria criada.</span>}
                            </div>
                        )}
                    </Droppable>

                    {/* PRODUCTS */}
                    <section className="mt-8">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-lg text-[var(--text)]">Produtos</h3>
                            <Button onClick={() => openProductModal()}><Plus size={18} className="mr-1"/> Novo Produto</Button>
                        </div>

                        <div className="space-y-6">
                            {categories.map(cat => {
                                const catProducts = products.filter(p => p.category_id === cat.id).sort((a, b) => (a.order || 0) - (b.order || 0));
                                if (catProducts.length === 0) return null;

                                return (
                                    <div key={cat.id}>
                                        <h4 className="font-bold text-[var(--text-muted)] uppercase text-xs tracking-wider mb-2 ml-1">{cat.name}</h4>
                                        <Droppable droppableId={cat.id} type="product">
                                            {(provided) => (
                                                <div 
                                                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
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
                                                                    <Card className={`flex gap-3 p-3 relative group ${!prod.available ? 'opacity-60 bg-[var(--surface-2)]' : ''} ${snapshot.isDragging ? 'shadow-xl ring-2 ring-[var(--brand)]' : ''}`}>
                                                                        <div {...provided.dragHandleProps} className="absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center text-[var(--border)] hover:text-[var(--text-muted)] cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--surface-2)]/50 rounded-l-xl z-10">
                                                                            <GripVertical size={20} />
                                                                        </div>
                                                                        <div className="w-20 h-20 bg-[var(--surface-2)] rounded-lg flex-shrink-0 overflow-hidden ml-4">
                                                                            {prod.image_url ? (
                                                                                <img src={prod.image_url} alt="" className="w-full h-full object-cover"/>
                                                                            ) : (
                                                                                <div className="w-full h-full flex items-center justify-center text-[var(--border)]"><Image size={24}/></div>
                                                                            )}
                                                                        </div>
                                                                        <div className="flex-1">
                                                                            <div className="flex justify-between items-start">
                                                                                <h5 className="font-bold text-[var(--text)]">{prod.name}</h5>
                                                                                <span className="font-bold text-[var(--brand)]">R$ {prod.price.toFixed(2)}</span>
                                                                            </div>
                                                                            <p className="text-xs text-[var(--text-muted)] line-clamp-2 mt-1">{prod.description}</p>
                                                                            <div className="mt-2 flex gap-2">
                                                                                <button onClick={() => openProductModal(prod)} className="text-xs font-bold text-[var(--brand)] hover:underline">Editar</button>
                                                                                <button onClick={() => handleToggleAvailability(prod)} className={`text-xs font-bold hover:underline ${prod.available ? 'text-[var(--warn)]' : 'text-[var(--ok)]'}`}>
                                                                                    {prod.available ? 'Pausar' : 'Ativar'}
                                                                                </button>
                                                                                <button onClick={() => handleDeleteProduct(prod.id)} className="text-xs font-bold text-[var(--err)] hover:underline">Excluir</button>
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
                                 <img src={pPreview} alt="" className="w-full h-full object-cover" />
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
                    <Input label="Descrição" value={pDesc} onChange={e => setPDesc(e.target.value)} />
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Preço (R$)" type="number" step="0.01" value={pPrice} onChange={e => setPPrice(e.target.value)} />
                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-semibold text-[var(--text)]">Categoria</label>
                            <select className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--brand)]/30" value={pCat} onChange={e => setPCat(e.target.value)}>
                                <option value="" disabled>Selecione...</option>
                                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                         <Input label="Tempo Preparo (min)" type="number" value={pTime} onChange={e => setPTime(e.target.value)} />
                         <div className="flex flex-col gap-1.5">
                             <label className="text-sm font-semibold text-[var(--text)]">Destino do Pedido</label>
                             <select className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--brand)]/30" value={pDestination} onChange={e => setPDestination(e.target.value as 'kitchen' | 'bar')}>
                                 <option value="kitchen">Cozinha</option>
                                 <option value="bar">Bar</option>
                             </select>
                         </div>
                    </div>

                    <Button className="w-full h-12 mt-4" onClick={handleSaveProduct} isLoading={isLoading}>Salvar Produto</Button>
                </div>
            </Modal>
        </div>
    );
};

// --- MAIN MODULE ---

// --- SUB-MODULE: USER MANAGEMENT ---

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
    const [permissions, setPermissions] = useState({
        tables: true,
        counter: false,
        kitchen: false,
        bar: false,
        menu: false,
        admin: false
    });

    const loadUsers = async () => {
        const data = await fetchStoreTeamMembers(storeId);
        setUsers(data);
    };

    useEffect(() => { loadUsers(); }, [storeId]);

    const openModal = (user?: StoreUser) => {
        if (user) {
            setEditingUser(user);
            setName(user.name);
            setEmail(user.email);
            setRole(user.role);
            setPermissions(user.permissions || { tables: true, counter: false, kitchen: false, bar: false, menu: false, admin: false });
            setPassword(''); // Don't show password
        } else {
            setEditingUser(null);
            setName('');
            setEmail('');
            setPassword('');
            setRole('waiter');
            setPermissions({ tables: true, counter: false, kitchen: false, bar: false, menu: false, admin: false });
        }
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!name || !email || (!editingUser && !password)) return toast.error('Preencha os campos obrigatórios');
        setIsLoading(true);
        try {
            const userData = { name, email, role, permissions, ...(password ? { password } : {}) };

            if (editingUser) {
                await updateStoreTeamMember(editingUser.id, userData);
            } else {
                await createStoreTeamMember(storeId, userData);
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

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {users.map(user => (
                    <Card key={user.id} className="p-4 border border-[var(--border)] shadow-sm relative group">
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <h4 className="font-bold text-[var(--text)]">{user.name}</h4>
                                <p className="text-xs text-[var(--text-muted)]">{user.email}</p>
                            </div>
                            <Badge color="bg-[var(--info)]/10 text-[var(--info)] border-[var(--info)]/20 uppercase text-[10px]">{user.role}</Badge>
                        </div>

                        <div className="mt-3 space-y-1">
                            <p className="text-xs font-bold text-[var(--text-muted)] uppercase">Acessos:</p>
                            <div className="flex flex-wrap gap-1">
                                {user.permissions?.tables && <span className="px-1.5 py-0.5 bg-[var(--ok)]/10 text-[var(--ok)] text-[10px] rounded border border-[var(--ok)]/20">Mesas</span>}
                                {user.permissions?.counter && <span className="px-1.5 py-0.5 bg-[var(--warn)]/10 text-[var(--warn)] text-[10px] rounded border border-[var(--warn)]/20">Balcão</span>}
                                {user.permissions?.kitchen && <span className="px-1.5 py-0.5 bg-[var(--err)]/10 text-[var(--err)] text-[10px] rounded border border-[var(--err)]/20">Cozinha</span>}
                                {user.permissions?.menu && <span className="px-1.5 py-0.5 bg-[var(--brand)]/10 text-[var(--brand)] text-[10px] rounded border border-[var(--brand)]/20">Cardápio</span>}
                                {user.permissions?.admin && <span className="px-1.5 py-0.5 bg-[var(--surface-2)] text-[var(--text)] text-[10px] rounded border border-[var(--border)]">Admin</span>}
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
                            <option value="cook">Cozinheiro</option>
                            <option value="attendant">Atendente</option>
                            <option value="manager">Gerente</option>
                        </select>
                    </div>

                    <div className="bg-[var(--surface-2)] p-3 rounded-lg border border-[var(--border)]">
                        <label className="text-sm font-bold text-[var(--text)] mb-2 block">Permissões de Acesso</label>
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
                        </div>
                    </div>

                    <Button className="w-full mt-2" onClick={handleSave} isLoading={isLoading}>Salvar Usuário</Button>
                </div>
            </Modal>
        </div>
    );
};

// --- SUB-MODULE: ADMIN (SALES HISTORY) ---

const StoreAdminView: React.FC<{ storeId: string }> = ({ storeId }) => {
    const [activeTab, setActiveTab] = useState<'dashboard' | 'sales' | 'users'>('dashboard');
    const [sales, setSales] = useState<Order[]>([]);
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

    const loadSales = async () => {
        setIsLoading(true);
        const data = await fetchSalesHistory(storeId);
        setSales(data);
        setIsLoading(false);
    };

    useEffect(() => {
        if (activeTab === 'sales' || activeTab === 'dashboard') loadSales();
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
            const search = filterCustomer.toLowerCase();
            result = result.filter(order => {
                const name = order.order_type === 'table' ? `Mesa ${order.tables?.number || '?'}` : (order.customer_name || 'Cliente Balcão');
                return name.toLowerCase().includes(search);
            });
        }
        if (filterMinItems) {
            result = result.filter(order => (order.order_items?.length || 0) >= parseInt(filterMinItems));
        }
        if (filterMaxItems) {
            result = result.filter(order => (order.order_items?.length || 0) <= parseInt(filterMaxItems));
        }
        if (filterMinTotal) {
            result = result.filter(order => {
                const total = order.order_items?.reduce((sum, item) => sum + (item.price_at_time * item.quantity), 0) || 0;
                return total >= parseFloat(filterMinTotal);
            });
        }
        if (filterMaxTotal) {
            result = result.filter(order => {
                const total = order.order_items?.reduce((sum, item) => sum + (item.price_at_time * item.quantity), 0) || 0;
                return total <= parseFloat(filterMaxTotal);
            });
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
                valA = a.order_items?.reduce((sum, item) => sum + (item.price_at_time * item.quantity), 0) || 0;
                valB = b.order_items?.reduce((sum, item) => sum + (item.price_at_time * item.quantity), 0) || 0;
            }

            if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        return result;
    }, [sales, filterMonth, filterStartDate, filterEndDate, filterType, filterCustomer, filterMinItems, filterMaxItems, filterMinTotal, filterMaxTotal, sortColumn, sortDirection]);

    const totalRevenue = filteredAndSortedSales.reduce((acc, order) => {
        const orderTotal = order.order_items?.reduce((sum, item) => sum + (item.price_at_time * item.quantity), 0) || 0;
        return acc + orderTotal;
    }, 0);

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

    return (
        <div className="space-y-6">
            <div className="flex space-x-4 border-b border-[var(--border)] pb-2">
                <button
                    onClick={() => setActiveTab('dashboard')}
                    className={`pb-2 text-sm font-medium transition-colors ${activeTab === 'dashboard' ? 'border-b-2 border-[var(--brand)] text-[var(--brand)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                >
                    Dashboard
                </button>
                <button
                    onClick={() => setActiveTab('sales')}
                    className={`pb-2 text-sm font-medium transition-colors ${activeTab === 'sales' ? 'border-b-2 border-[var(--brand)] text-[var(--brand)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                >
                    Histórico de Vendas
                </button>
                <button
                    onClick={() => setActiveTab('users')}
                    className={`pb-2 text-sm font-medium transition-colors ${activeTab === 'users' ? 'border-b-2 border-[var(--brand)] text-[var(--brand)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                >
                    Gestão de Usuários
                </button>
            </div>

            {activeTab === 'dashboard' && <StoreDashboardView sales={sales} />}
            
            {activeTab === 'users' && <UserManagementView storeId={storeId} />}

            {activeTab === 'sales' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Card accentColor="var(--brand)" className="p-6 pl-7 shadow-sm">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wider">Faturamento Total</p>
                                    <h3 className="text-3xl font-black text-[var(--text)] mt-1">R$ {totalRevenue.toFixed(2)}</h3>
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
                                        R$ {filteredAndSortedSales.length > 0 ? (totalRevenue / filteredAndSortedSales.length).toFixed(2) : '0.00'}
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
                                <h3 className="font-bold text-lg text-[var(--text)]">Histórico de Vendas</h3>
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" className="text-[var(--err)] border-[var(--err)]/20 hover:bg-[var(--err)]/5" onClick={handleClearSales} isLoading={isClearing}>
                                        <Trash2 size={16} className="mr-2" />
                                        Zerar Vendas
                                    </Button>
                                    <Button variant="secondary" onClick={() => setShowFilters(!showFilters)}>
                                        <Search size={16} className="mr-2" />
                                        Filtros
                                    </Button>
                                    <Badge color="bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-muted)]">{filteredAndSortedSales.length} registros</Badge>
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
                                        <tr>
                                            <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">
                                                <div className="flex items-center justify-center gap-2">
                                                    <Loader2 className="animate-spin" size={16} /> Carregando histórico...
                                                </div>
                                            </td>
                                        </tr>
                                    ) : filteredAndSortedSales.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)] italic">
                                                Nenhuma venda encontrada com os filtros atuais.
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredAndSortedSales.map((order) => {
                                            const orderTotal = order.order_items?.reduce((sum, item) => sum + (item.price_at_time * item.quantity), 0) || 0;
                                            return (
                                                <tr
                                                    key={order.id}
                                                    className="hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
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
                                                    <td className="px-4 py-3 text-[var(--text-muted)] max-w-xs truncate" title={order.order_items?.map(i => `${i.quantity}x ${i.product?.name}`).join(', ')}>
                                                        {order.order_items?.length || 0} itens
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-bold text-[var(--text)]">
                                                        R$ {orderTotal.toFixed(2)}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </div>
            )}

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
                                            <span className="text-[var(--text)]">{item.product?.name || 'Produto Excluído'}</span>
                                        </div>
                                        <span className="text-[var(--text-muted)]">R$ {(item.price_at_time * item.quantity).toFixed(2)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h4 className="font-bold text-[var(--text)] mb-2 border-b border-[var(--border)] pb-1">Pagamento</h4>
                            <div className="text-sm space-y-1">
                                {selectedOrderDetails.payment_details?.methods ? (
                                    selectedOrderDetails.payment_details.methods.map((m: any, i: number) => (
                                        <div key={i} className="flex justify-between">
                                            <span className="text-[var(--text-muted)] capitalize">{m.method}</span>
                                            <span className="font-medium text-[var(--text)]">R$ {m.amount.toFixed(2)}</span>
                                        </div>
                                    ))
                                ) : (
                                    <div className="flex justify-between">
                                        <span className="text-[var(--text-muted)] capitalize">{selectedOrderDetails.payment_method || 'Não especificado'}</span>
                                        <span className="font-medium text-[var(--text)]">
                                            R$ {(selectedOrderDetails.order_items?.reduce((sum, item) => sum + (item.price_at_time * item.quantity), 0) || 0).toFixed(2)}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="border-t border-[var(--border)] pt-4 flex justify-between items-center">
                            <span className="font-bold text-lg text-[var(--text)]">Total Pago</span>
                            <span className="font-black text-2xl text-[var(--brand)]">
                                R$ {(selectedOrderDetails.order_items?.reduce((sum, item) => sum + (item.price_at_time * item.quantity), 0) || 0).toFixed(2)}
                            </span>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export const StoreModule: React.FC = () => {
    const [user, setUser] = useState<(StoreUser & { store: Store }) | null>(null);
    const [tab, setTab] = useState('tables');

    // Restore session check? Maybe later. For now simple login.
    
    if (!user) return <StoreLogin onLogin={(u) => {
        setUser(u);
        // Set initial tab based on permissions
        if (u.role === 'owner') {
             setTab('tables');
        } else if (u.permissions?.tables !== false) {
             setTab('tables');
        } else if (u.permissions?.counter !== false) {
             setTab('counter');
        } else if (u.permissions?.kitchen !== false) {
             setTab('kitchen');
        } else if (u.permissions?.bar !== false) {
             setTab('bar');
        } else if (u.permissions?.menu !== false) {
             setTab('menu');
        } else {
             setTab('admin');
        }
    }} />;
    
    // Permission Check
    const canAccess = (t: string) => {
        if (user.role === 'owner') return true;
        if (!user.permissions) return true; // Default to true if no permissions defined (legacy)
        return user.permissions[t as keyof typeof user.permissions] !== false;
    };

    return (
        <StoreLayout 
            title={
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
            onLogout={() => setUser(null)}
            user={user}
        >
            {tab === 'tables' && canAccess('tables') && <TablesView store={user.store} />}
            {tab === 'counter' && canAccess('counter') && <CounterView storeId={user.store.id} />}
            {tab === 'kitchen' && canAccess('kitchen') && <KitchenView storeId={user.store.id} />}
            {tab === 'bar' && canAccess('bar') && <BarView storeId={user.store.id} />}
            {tab === 'menu' && canAccess('menu') && <MenuManagementView store={user.store} onStoreUpdate={(updatedStore) => setUser({ ...user, store: updatedStore })} />}
            {tab === 'admin' && canAccess('admin') && <StoreAdminView storeId={user.store.id} />}
            
            {!canAccess(tab) && (
                <div className="flex flex-col items-center justify-center h-64 text-[var(--text-muted)]">
                    <Lock size={48} className="mb-4 opacity-20"/>
                    <p>Você não tem permissão para acessar esta área.</p>
                </div>
            )}
        </StoreLayout>
    );
}