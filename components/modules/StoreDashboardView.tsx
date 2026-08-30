'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { Card, Input } from '@/components/ui';
import { Order, TableSession, OrderRating, OperatorCheckin, Table, TableStatus, OrderStatus } from '@/types';
import { BarChart3, Receipt, CheckCircle, Clock, Users, Coffee, TrendingUp, TrendingDown, Star, Wallet, ArrowRight, AlertTriangle } from 'lucide-react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
    BarChart, Bar, PieChart, Pie, Cell, Legend
} from 'recharts';
import { subDays, subMonths, isAfter, isBefore, isSameDay, isSameWeek, isSameMonth, format, differenceInMinutes } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getPaymentMethodLabel, getOrderItemDisplayName } from '@/lib/labels';
import { formatBRL, getOrderDisplayTotal } from '@/lib/calc';
import { fetchCheckinsHistory, fetchOpenCashShifts, fetchTables, fetchActiveOrdersForTables, CashShift } from '@/lib/api';

const COLORS = ['#484DB5', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#F43F5E'];

// Pedidos/sessões acima disso são tratados como outlier (ex.: mesa esquecida aberta, pedido travado)
// e excluídos da média para não distorcer o número exibido.
const MAX_REASONABLE_DELIVERY_MINUTES = 240;
const MAX_REASONABLE_TABLE_MINUTES = 480;

export const StoreDashboardView: React.FC<{
    sales: Order[];
    tableSessions: TableSession[];
    ratings: OrderRating[];
    storeId?: string;
    onNavigateToOperatorHistory?: () => void;
}> = ({ sales, tableSessions, ratings, storeId, onNavigateToOperatorHistory }) => {
    const [periodType, setPeriodType] = useState<'custom' | 'today' | 'week' | 'month' | 'year'>('custom');
    const [periodDays, setPeriodDays] = useState<number>(90);

    // Fase 4, Task 11 (plano "Fora do Cardápio"): "o que já é seu, visível de
    // longe" — não é dado novo, é reunir 3 chamadas que já existiam
    // espalhadas (ponto pessoal, turno de caixa, histórico por operador)
    // numa única visão de topo. `storeId` é opcional pra não quebrar quem
    // ainda não passa essa prop (nenhum call site hoje, mas mantém o
    // componente utilizável isoladamente/em teste sem storeId).
    const [workingNow, setWorkingNow] = useState<OperatorCheckin[]>([]);
    // Migration 062 ("caixa por operador"): pode haver mais de um turno
    // aberto ao mesmo tempo agora (um por operador) — esta é uma tela
    // gerencial (dono/universal olhando o resumo do dia), então mostra
    // TODOS os turnos abertos, não "o" turno (fetchOpenCashShifts, plural).
    const [openShifts, setOpenShifts] = useState<(CashShift & { operator_name: string | null })[]>([]);
    const [isLoadingTodayCard, setIsLoadingTodayCard] = useState(false);

    useEffect(() => {
        if (!storeId) return;
        let cancelled = false;
        setIsLoadingTodayCard(true);
        Promise.all([fetchCheckinsHistory(storeId), fetchOpenCashShifts(storeId)])
            .then(([checkins, shifts]) => {
                if (cancelled) return;
                setWorkingNow(checkins.filter(c => !c.checkout_at));
                setOpenShifts(shifts);
            })
            .finally(() => { if (!cancelled) setIsLoadingTodayCard(false); });
        return () => { cancelled = true; };
    }, [storeId]);

    // Fase 4, Task 12 (plano "Fora do Cardápio"): "alertas que avisam antes"
    // — mesa ocupada sem pedido novo há mais de 40min. `Table` não tem
    // `updated_at` (ver types/index.ts), então o sinal usado é o
    // `created_at` do item mais recente entre os pedidos ativos da mesa —
    // mais fiel ao que "sem pedido novo" realmente significa do que
    // qualquer timestamp de atualização de status da mesa em si.
    const STALE_TABLE_MINUTES = 40;
    const [staleTables, setStaleTables] = useState<{ number: number; minutesSinceLastItem: number }[]>([]);

    useEffect(() => {
        if (!storeId) return;
        let cancelled = false;
        Promise.all([fetchTables(storeId), fetchActiveOrdersForTables(storeId)])
            .then(([allTables, activeOrders]) => {
                if (cancelled) return;
                const nowMs = Date.now();
                const stale = allTables
                    .filter(t => t.status === TableStatus.OCCUPIED || t.status === TableStatus.WAITING_BILL)
                    .map(t => {
                        const items = activeOrders.filter(o => o.table_id === t.id).flatMap(o => o.order_items || []);
                        if (items.length === 0) return null;
                        const lastItemMs = Math.max(...items.map(i => new Date(i.created_at).getTime()));
                        const minutesSinceLastItem = Math.round((nowMs - lastItemMs) / 60000);
                        return minutesSinceLastItem >= STALE_TABLE_MINUTES ? { number: t.number, minutesSinceLastItem } : null;
                    })
                    .filter((v): v is { number: number; minutesSinceLastItem: number } => v !== null)
                    .sort((a, b) => b.minutesSinceLastItem - a.minutesSinceLastItem);
                setStaleTables(stale);
            });
        return () => { cancelled = true; };
    }, [storeId]);

    const now = new Date();

    const dailySales = sales.filter(s => isSameDay(new Date(s.created_at), now));
    const weeklySales = sales.filter(s => isSameWeek(new Date(s.created_at), now, { locale: ptBR }));
    const monthlySales = sales.filter(s => isSameMonth(new Date(s.created_at), now));

    const dailyTableSessions = tableSessions.filter(s => isSameDay(new Date(s.opened_at), now));
    const weeklyTableSessions = tableSessions.filter(s => isSameWeek(new Date(s.opened_at), now, { locale: ptBR }));
    const monthlyTableSessions = tableSessions.filter(s => isSameMonth(new Date(s.opened_at), now));

    // Fase 4, Task 12: "cancelamento acima do normal hoje" — % de itens
    // cancelados hoje vs. a média dos últimos 7 dias (excluindo hoje).
    // `sales` só traz pedidos `delivered` (fetch_sales_history_secure), mas
    // os `order_items` embutidos não são filtrados por status — um item
    // cancelado dentro de um pedido por outro lado entregue continua
    // aparecendo aqui, que é exatamente o dado que esse alerta precisa, sem
    // RPC nova. Não cobre pedido INTEIRO cancelado (esses nunca entram em
    // `sales`), mas isso é uma fatia pequena e o plano já aceita esse
    // recorte pra não exigir busca extra.
    const cancellationRateAlert = useMemo(() => {
        const cancelRateOf = (orders: Order[]) => {
            const items = orders.flatMap(o => o.order_items || []);
            if (items.length === 0) return null;
            const canceled = items.filter(i => i.status === OrderStatus.CANCELED).length;
            return canceled / items.length;
        };
        const todayRate = cancelRateOf(dailySales);
        if (todayRate === null || todayRate === 0) return null;
        const last7DaysSales = sales.filter(s => {
            const d = new Date(s.created_at);
            return isAfter(d, subDays(now, 7)) && !isSameDay(d, now);
        });
        const avgRate = cancelRateOf(last7DaysSales);
        // Sem histórico de comparação (loja nova/poucos dias) — não dá pra
        // dizer "acima do normal" sem uma base, então o alerta fica calado
        // em vez de arriscar um falso positivo.
        if (avgRate === null) return null;
        // "Acima do normal" = pelo menos o dobro da média — limiar simples
        // de propósito (sem modelo estatístico, ver escopo reduzido do
        // plano), e só dispara se a média não for desprezível (>=1%) pra
        // não alarmar por causa de ruído de amostra pequena.
        if (avgRate >= 0.01 && todayRate >= avgRate * 2) {
            return { todayRate, avgRate };
        }
        return null;
    }, [sales, dailySales, now]);

    const calcStats = (orders: Order[]) => {
        // Acumula em centavos inteiros para evitar erro de arredondamento de ponto flutuante somando muitos pedidos.
        const totalCents = orders.reduce((sum, o) => {
            return sum + Math.round(getOrderDisplayTotal(o) * 100);
        }, 0);
        const total = totalCents / 100;
        const count = orders.length;
        const ticket = count > 0 ? Math.round(totalCents / count) / 100 : 0;
        const tableOrders = orders.filter(o => o.order_type === 'table').length;
        return { total, count, ticket, tableOrders };
    };

    const dailyStats = calcStats(dailySales);
    const weeklyStats = calcStats(weeklySales);
    const monthlyStats = calcStats(monthlySales);

    // Comparação dos 3 blocos fixos do topo com o período anterior
    // equivalente (ontem / semana passada / mês passado) — mesma base de
    // `sales` já carregada, sem busca extra.
    const yesterday = subDays(now, 1);
    const prevDailyStats = calcStats(sales.filter(s => isSameDay(new Date(s.created_at), yesterday)));
    const lastWeekRef = subDays(now, 7);
    const prevWeeklyStats = calcStats(sales.filter(s => isSameWeek(new Date(s.created_at), lastWeekRef, { locale: ptBR })));
    const lastMonthRef = subMonths(now, 1);
    const prevMonthlyStats = calcStats(sales.filter(s => isSameMonth(new Date(s.created_at), lastMonthRef)));

    const periodSales = useMemo(() => {
        if (periodType === 'today') return dailySales;
        if (periodType === 'week') return weeklySales;
        if (periodType === 'month') return monthlySales;
        if (periodType === 'year') return sales.filter(s => new Date(s.created_at).getFullYear() === now.getFullYear());
        const periodStartDate = subDays(now, periodDays);
        return sales.filter(s => isAfter(new Date(s.created_at), periodStartDate));
    }, [sales, periodType, periodDays, dailySales, weeklySales, monthlySales, now]);

    const periodStats = calcStats(periodSales);

    const previousPeriodSales = useMemo(() => {
        if (periodType === 'today') {
            const yesterday = subDays(now, 1);
            return sales.filter(s => isSameDay(new Date(s.created_at), yesterday));
        }
        if (periodType === 'week') {
            const lastWeek = subDays(now, 7);
            return sales.filter(s => isSameWeek(new Date(s.created_at), lastWeek, { locale: ptBR }));
        }
        if (periodType === 'month') {
            const lastMonth = subMonths(now, 1);
            return sales.filter(s => isSameMonth(new Date(s.created_at), lastMonth));
        }
        if (periodType === 'year') {
            return sales.filter(s => new Date(s.created_at).getFullYear() === now.getFullYear() - 1);
        }
        // custom: os periodDays dias imediatamente antes da janela atual
        const currentStart = subDays(now, periodDays);
        const previousStart = subDays(currentStart, periodDays);
        return sales.filter(s => {
            const d = new Date(s.created_at);
            return isAfter(d, previousStart) && isBefore(d, currentStart);
        });
    }, [sales, periodType, periodDays, now]);

    const previousPeriodStats = calcStats(previousPeriodSales);

    // undefined = sem base de comparação (período anterior sem nenhuma venda),
    // não mostra a variação em vez de dividir por zero.
    const percentChange = (current: number, previous: number): number | undefined => {
        if (previous === 0) return undefined;
        return ((current - previous) / previous) * 100;
    };

    const ChangeBadge = ({ value, label = 'vs. período anterior' }: { value: number | undefined; label?: string }) => {
        if (value === undefined) return null;
        const isUp = value >= 0;
        const Icon = isUp ? TrendingUp : TrendingDown;
        return (
            <span className={`inline-flex items-center gap-1 text-xs font-bold ${isUp ? 'text-[var(--ok)]' : 'text-[var(--err)]'}`}>
                <Icon size={14} />
                {isUp ? '+' : ''}{value.toFixed(1)}% {label}
            </span>
        );
    };

    const periodRatings = useMemo(() => {
        if (periodType === 'today') return ratings.filter(r => isSameDay(new Date(r.created_at), now));
        if (periodType === 'week') return ratings.filter(r => isSameWeek(new Date(r.created_at), now, { locale: ptBR }));
        if (periodType === 'month') return ratings.filter(r => isSameMonth(new Date(r.created_at), now));
        if (periodType === 'year') return ratings.filter(r => new Date(r.created_at).getFullYear() === now.getFullYear());
        const periodStartDate = subDays(now, periodDays);
        return ratings.filter(r => isAfter(new Date(r.created_at), periodStartDate));
    }, [ratings, periodType, periodDays, now]);

    const avgRating = periodRatings.length > 0
        ? periodRatings.reduce((sum, r) => sum + r.stars, 0) / periodRatings.length
        : 0;

    const periodTableSessions = useMemo(() => {
        if (periodType === 'today') return dailyTableSessions;
        if (periodType === 'week') return weeklyTableSessions;
        if (periodType === 'month') return monthlyTableSessions;
        if (periodType === 'year') return tableSessions.filter(s => new Date(s.opened_at).getFullYear() === now.getFullYear());
        const periodStartDate = subDays(now, periodDays);
        return tableSessions.filter(s => isAfter(new Date(s.opened_at), periodStartDate));
    }, [tableSessions, periodType, periodDays, dailyTableSessions, weeklyTableSessions, monthlyTableSessions, now]);

    const salesByDay = useMemo(() => {
        // Agrupa por chave yyyy-MM-dd (nao so dd/MM) para nao colidir datas de anos diferentes.
        const map = new Map<string, { label: string; total: number }>();
        periodSales.forEach(o => {
            const d = new Date(o.created_at);
            const key = format(d, 'yyyy-MM-dd');
            const total = getOrderDisplayTotal(o);
            const existing = map.get(key);
            map.set(key, { label: format(d, 'dd/MM'), total: (existing?.total || 0) + total });
        });
        return Array.from(map.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, v]) => ({ date: v.label, total: v.total }));
    }, [periodSales]);

    const paymentMethods = useMemo(() => {
        const map = new Map<string, number>();
        periodSales.forEach(o => {
            const method = getPaymentMethodLabel(o.payment_method);
            map.set(method, (map.get(method) || 0) + 1);
        });
        return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    }, [periodSales]);

    // Assinatura dos adicionais escolhidos, mesmo princípio de `optionsSignature` em
    // context/AppContext.tsx (dedup do carrinho) — mas aqui a fonte é o snapshot
    // `order_items.selected_options` (sem ids), então a assinatura é por `name`
    // ordenado em vez de `option_id`.
    const optionsSignature = (opts?: { name: string }[]) => (opts || []).map(o => o.name).slice().sort().join('|');

    const productStats = useMemo(() => {
        // Chave agora inclui a assinatura dos adicionais: "Pizza Marguerita (Catupiry)"
        // e "Pizza Marguerita (Mussarela)" viram linhas separadas no ranking, não uma
        // linha só agrupada por product_id.
        const map = new Map<string, { key: string, name: string, qty: number }>();
        periodSales.forEach(o => {
            o.order_items?.forEach(i => {
                if (!i.product) return;
                const key = `${i.product_id}::${optionsSignature(i.selected_options)}`;
                const existing = map.get(key) || { key, name: getOrderItemDisplayName(i), qty: 0 };
                existing.qty += i.quantity;
                map.set(key, existing);
            });
        });
        const arr = Array.from(map.values()).sort((a, b) => b.qty - a.qty);
        const top = arr.slice(0, 5);
        const topKeys = new Set(top.map(p => p.key));
        // Exclui do "menos vendidos" quem ja aparece no "mais vendidos" (acontecia quando havia <=10 produtos distintos no periodo).
        const bottom = arr.slice().reverse().filter(p => !topKeys.has(p.key)).slice(0, 5);
        return { top, bottom };
    }, [periodSales]);

    const tableSales = periodSales.filter(s => s.order_type === 'table');
    const tableOccupations = tableSales.length;

    const tableOccupationsByHour = useMemo(() => {
        if (tableSales.length === 0) return [];
        const map = new Map<number, number>();
        let minHour = 23, maxHour = 0;
        tableSales.forEach(o => {
            const hour = new Date(o.created_at).getHours();
            map.set(hour, (map.get(hour) || 0) + 1);
            if (hour < minHour) minHour = hour;
            if (hour > maxHour) maxHour = hour;
        });
        // Mostra so a faixa de horas com movimento real, em vez de sempre 24 barras fixas.
        const result: { hour: string; count: number }[] = [];
        for (let h = minHour; h <= maxHour; h++) result.push({ hour: `${h}h`, count: map.get(h) || 0 });
        return result;
    }, [tableSales]);

    // Fase 4, Task 13 (plano "Fora do Cardápio"): "mapa de calor de ocupação
    // por hora" já existia só num eixo (hora do dia); cruza com o dia da
    // semana também. Mesma faixa de horas do gráfico de barras acima
    // (minHour..maxHour com movimento real), reaproveitando `tableSales` —
    // sem chamada nova, é o mesmo dado visto por outro ângulo.
    const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const occupancyHeatmap = useMemo(() => {
        if (tableSales.length === 0) return { hours: [] as number[], grid: [] as number[][], max: 0 };
        let minHour = 23, maxHour = 0;
        const counts = new Map<string, number>(); // key `${day}-${hour}`
        tableSales.forEach(o => {
            const d = new Date(o.created_at);
            const day = d.getDay();
            const hour = d.getHours();
            if (hour < minHour) minHour = hour;
            if (hour > maxHour) maxHour = hour;
            const key = `${day}-${hour}`;
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        const hours: number[] = [];
        for (let h = minHour; h <= maxHour; h++) hours.push(h);
        let max = 0;
        const grid = DAY_LABELS.map((_, day) => hours.map(h => {
            const v = counts.get(`${day}-${h}`) || 0;
            if (v > max) max = v;
            return v;
        }));
        return { hours, grid, max };
    }, [tableSales]);

    // Fase 4, Task 13: funil simples do período filtrado — mesas abertas
    // (periodTableSessions) → mesas que chegaram a ter pedido (algum pedido
    // de mesa criado dentro da janela aberta→fechada da sessão) → mesas
    // fechadas (closed_at presente — fechar mesa neste app sempre passa por
    // RECEBER & FINALIZAR, então "fechada" já implica "com pagamento").
    const funnelStats = useMemo(() => {
        const opened = periodTableSessions.length;
        const withOrder = periodTableSessions.filter(s => tableSales.some(o =>
            o.table_id === s.table_id &&
            isAfter(new Date(o.created_at), new Date(s.opened_at)) &&
            (!s.closed_at || isBefore(new Date(o.created_at), new Date(s.closed_at)))
        )).length;
        const closed = periodTableSessions.filter(s => s.closed_at).length;
        return { opened, withOrder, closed };
    }, [periodTableSessions, tableSales]);

    const avgDeliveryTime = useMemo(() => {
        let totalMins = 0; let count = 0; let excluded = 0;
        periodSales.forEach(o => {
            if (!o.updated_at) return;
            const mins = differenceInMinutes(new Date(o.updated_at), new Date(o.created_at));
            if (mins > MAX_REASONABLE_DELIVERY_MINUTES) { excluded++; return; }
            totalMins += mins; count++;
        });
        return { avg: count > 0 ? Math.round(totalMins / count) : 0, excluded };
    }, [periodSales]);

    // Tempo de mesa vem de table_sessions (abertura -> fechamento real), não mais
    // reaproveitando updated_at/created_at do pedido (que mede o pedido, não a mesa).
    const avgTableTime = useMemo(() => {
        let totalMins = 0; let count = 0; let excluded = 0;
        periodTableSessions.forEach(s => {
            if (!s.closed_at) return;
            const mins = differenceInMinutes(new Date(s.closed_at), new Date(s.opened_at));
            if (mins > MAX_REASONABLE_TABLE_MINUTES) { excluded++; return; }
            totalMins += mins; count++;
        });
        return { avg: count > 0 ? Math.round(totalMins / count) : 0, excluded };
    }, [periodTableSessions]);

    const counterSales = periodSales.filter(s => s.order_type === 'counter');
    const counterStats = calcStats(counterSales);

    const StatCard = ({ title, value, subtitle, icon: Icon, accentColor }: any) => (
        <Card accentColor={accentColor} className="u-grow-in u-card p-4 pl-5 shadow-sm">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{title}</p>
                    <h3 className="text-xl font-black text-[var(--text)] mt-1">{value}</h3>
                    {subtitle && <p className="text-xs text-[var(--text-muted)] mt-1">{subtitle}</p>}
                </div>
                <div className="p-2 rounded-full bg-[var(--surface-2)]">
                    <Icon size={20} className="text-[var(--brand)]" />
                </div>
            </div>
        </Card>
    );

    const cardCls = 'p-4 shadow-sm border border-[var(--border)] bg-[var(--surface)]';
    const h4Cls = 'text-sm font-bold text-[var(--text-muted)] uppercase mb-4';

    return (
        <div className="space-y-8">
            {/* Fase 4, Task 11: "Hoje na loja" — só aparece com storeId (quem
                monta este componente sem essa prop continua vendo o dashboard
                normal, sem esse card). */}
            {storeId && (
                <section>
                    <Card className={`${cardCls} u-grow-in u-card`}>
                        <div className="flex items-center justify-between mb-3">
                            <h3 className={h4Cls + ' mb-0'}>Hoje na loja</h3>
                            {isLoadingTodayCard && <span className="text-xs text-[var(--text-muted)]">Atualizando...</span>}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <Users size={13} /> Trabalhando agora
                                </p>
                                {workingNow.length === 0 ? (
                                    <p className="text-sm text-[var(--text-muted)]">Ninguém bateu ponto ainda.</p>
                                ) : (
                                    <ul className="space-y-1">
                                        {workingNow.map(c => (
                                            <li key={c.id} className="text-sm font-semibold text-[var(--text)] flex items-center gap-1.5">
                                                <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
                                                {c.user_name} <span className="text-[var(--text-muted)] font-normal">(trabalhando)</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            <div>
                                <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <Wallet size={13} /> {openShifts.length > 1 ? `Turnos de caixa (${openShifts.length})` : 'Turno de caixa'}
                                </p>
                                {openShifts.length > 0 ? (
                                    <ul className="space-y-1">
                                        {openShifts.map((s) => (
                                            <li key={s.id} className="text-sm text-[var(--text)]">
                                                <span className="font-semibold text-[var(--ok)]">Aberto</span>
                                                {s.operator_name ? ` — ${s.operator_name}` : ''} desde{' '}
                                                {new Date(s.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                {' · '}fundo R$ {formatBRL(s.opening_float)}
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-sm text-[var(--text-muted)]">Nenhum turno de caixa aberto agora.</p>
                                )}
                            </div>
                            <div className="flex items-start md:items-center md:justify-end">
                                {onNavigateToOperatorHistory && (
                                    <button
                                        onClick={onNavigateToOperatorHistory}
                                        className="text-sm font-bold text-[var(--brand)] hover:underline flex items-center gap-1 u-motion"
                                    >
                                        Ver histórico por operador <ArrowRight size={14} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </Card>
                </section>
            )}

            {/* Fase 4, Task 12: alertas que avisam antes — só renderiza a
                seção quando existe pelo menos um alerta, pra não ocupar
                espaço em dia normal. */}
            {(staleTables.length > 0 || cancellationRateAlert) && (
                <section className="space-y-2">
                    {staleTables.map(t => (
                        <div key={t.number} className="flex items-center gap-3 p-3 rounded-xl border border-[var(--warn)]/30 bg-[var(--warn)]/5 text-sm">
                            <AlertTriangle size={18} className="text-[var(--warn)] shrink-0" />
                            <p className="text-[var(--text)]">
                                <span className="font-bold">Mesa {t.number}</span> sem pedido novo há{' '}
                                <span className="font-bold">{t.minutesSinceLastItem} min</span> — pode estar esquecida.
                            </p>
                        </div>
                    ))}
                    {cancellationRateAlert && (
                        <div className="flex items-center gap-3 p-3 rounded-xl border border-[var(--err)]/30 bg-[var(--err)]/5 text-sm">
                            <AlertTriangle size={18} className="text-[var(--err)] shrink-0" />
                            <p className="text-[var(--text)]">
                                <span className="font-bold">Cancelamento acima do normal hoje:</span>{' '}
                                {(cancellationRateAlert.todayRate * 100).toFixed(0)}% dos itens, vs. média de{' '}
                                {(cancellationRateAlert.avgRate * 100).toFixed(0)}% nos últimos 7 dias.
                            </p>
                        </div>
                    )}
                </section>
            )}

            {/* Faturamento Bruto */}
            <section>
                <h2 className="text-xl font-bold text-[var(--text)] mb-4">Faturamento Bruto</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                        { label: 'Hoje', stats: dailyStats, prev: prevDailyStats, prevLabel: 'vs. ontem', accent: 'var(--brand)' },
                        { label: 'Esta Semana', stats: weeklyStats, prev: prevWeeklyStats, prevLabel: 'vs. semana passada', accent: 'var(--info)' },
                        { label: 'Este Mês', stats: monthlyStats, prev: prevMonthlyStats, prevLabel: 'vs. mês passado', accent: 'var(--ok)' },
                    ].map(({ label, stats, prev, prevLabel, accent }, i) => (
                        <Card key={label} accentColor={accent} className={`${cardCls} u-grow-in u-card pl-5`} style={{ animationDelay: `${i * 60}ms` }}>
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">{label}</h3>
                                <div className="p-1.5 rounded-full bg-[var(--surface-2)]">
                                    <Receipt size={14} style={{ color: accent }} />
                                </div>
                            </div>
                            {/* Total em destaque tipográfico (número grande primeiro,
                                leitura de relance) + variação vs. o período anterior
                                equivalente logo abaixo — antes eram 4 linhas de texto
                                de mesmo peso, difícil comparar os 3 blocos num olhar. */}
                            <p className="text-2xl font-black num" style={{ color: accent }}>R$ {formatBRL(stats.total)}</p>
                            <div className="min-h-[18px] mb-3">
                                <ChangeBadge value={percentChange(stats.total, prev.total)} label={prevLabel} />
                            </div>
                            <div className="space-y-2 border-t border-[var(--border)] pt-2.5">
                                <div className="flex justify-between items-center">
                                    <span className="flex items-center gap-1.5 text-sm text-[var(--text-muted)]"><TrendingUp size={13} /> Ticket Médio</span>
                                    <span className="font-medium text-[var(--text)] num">R$ {formatBRL(stats.ticket)}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="flex items-center gap-1.5 text-sm text-[var(--text-muted)]"><Coffee size={13} /> Pedidos</span>
                                    <span className="font-medium text-[var(--text)] num">{stats.count}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="flex items-center gap-1.5 text-sm text-[var(--text-muted)]"><Users size={13} /> Pedidos de Mesa</span>
                                    <span className="font-medium text-[var(--text)] num">{stats.tableOrders}</span>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            </section>

            {/* Por Período */}
            <section className="border-t border-[var(--border)] pt-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                    <h2 className="text-xl font-bold text-[var(--text)]">Por Período</h2>
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            className="px-3 py-2 border border-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface)] text-[var(--text)] focus:ring-2 focus:ring-[var(--brand)]/30 focus:border-[var(--brand)] outline-none transition-all text-sm"
                            value={periodType}
                            onChange={(e) => setPeriodType(e.target.value as any)}
                        >
                            <option value="today">Hoje</option>
                            <option value="week">Esta Semana</option>
                            <option value="month">Este Mês</option>
                            <option value="year">Este Ano</option>
                            <option value="custom">Últimos X dias</option>
                        </select>
                        {periodType === 'custom' && (
                            <div className="flex items-center gap-2">
                                <Input type="number" className="w-20 h-9" value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value) || 0)} min="1" />
                                <span className="text-sm font-medium text-[var(--text-muted)]">dias</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="space-y-8">
                    {/* Faturamento */}
                    <div>
                        <h3 className="text-lg font-bold text-[var(--text)] mb-3 flex items-center gap-2"><Receipt size={20} className="text-[var(--brand)]" /> Faturamento</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4 mb-4">
                            <StatCard title="Total no Período" value={`R$ ${formatBRL(periodStats.total)}`} subtitle={<ChangeBadge value={percentChange(periodStats.total, previousPeriodStats.total)} />} icon={Receipt} accentColor="var(--brand)" />
                            <StatCard title="Ticket Médio" value={`R$ ${formatBRL(periodStats.ticket)}`} subtitle={<ChangeBadge value={percentChange(periodStats.ticket, previousPeriodStats.ticket)} />} icon={TrendingUp} accentColor="var(--info)" />
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            <Card className={`${cardCls} lg:col-span-2`}>
                                <h4 className={h4Cls}>Evolução das Vendas</h4>
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={salesByDay}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                                            <XAxis dataKey="date" tick={{fontSize: 12}} />
                                            <YAxis tick={{fontSize: 12}} tickFormatter={(v) => `R$${v}`} />
                                            <RechartsTooltip formatter={(value: any) => [`R$ ${formatBRL(Number(value))}`, 'Total']} />
                                            <Line type="monotone" dataKey="total" stroke="#484DB5" strokeWidth={3} dot={{r: 4}} activeDot={{r: 6}} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </Card>
                            <Card className={cardCls}>
                                <h4 className={h4Cls}>Formas de Pagamento</h4>
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={paymentMethods} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                                                {paymentMethods.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <RechartsTooltip />
                                            <Legend />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </Card>
                        </div>
                    </div>

                    {/* Pedidos */}
                    <div>
                        <h3 className="text-lg font-bold text-[var(--text)] mb-3 flex items-center gap-2"><CheckCircle size={20} className="text-[var(--ok)]" /> Pedidos</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <StatCard title="Número de Pedidos" value={periodStats.count} subtitle={<ChangeBadge value={percentChange(periodStats.count, previousPeriodStats.count)} />} icon={CheckCircle} accentColor="var(--ok)" />
                            <StatCard
                                title="Tempo Médio de Atendimento"
                                value={`${avgDeliveryTime.avg} min`}
                                subtitle={avgDeliveryTime.excluded > 0 ? `Criação até entrega · ${avgDeliveryTime.excluded} atípico(s) excluído(s)` : 'Criação até entrega'}
                                icon={Clock}
                                accentColor="var(--info)"
                            />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Card className={cardCls}>
                                <h4 className={h4Cls}>Top 5 Mais Vendidos</h4>
                                <div className="space-y-3">
                                    {productStats.top.map((p, i) => (
                                        <div key={i} className="flex justify-between items-center">
                                            <span className="text-sm font-medium text-[var(--text)]">{i+1}. {p.name}</span>
                                            <span className="text-sm font-bold text-[var(--brand)]">{p.qty} un</span>
                                        </div>
                                    ))}
                                    {productStats.top.length === 0 && <p className="text-sm text-[var(--text-muted)]">Sem dados</p>}
                                </div>
                            </Card>
                            <Card className={cardCls}>
                                <h4 className={h4Cls}>Top 5 Menos Vendidos</h4>
                                <div className="space-y-3">
                                    {productStats.bottom.map((p, i) => (
                                        <div key={i} className="flex justify-between items-center">
                                            <span className="text-sm font-medium text-[var(--text)]">{i+1}. {p.name}</span>
                                            <span className="text-sm font-bold text-[var(--warn)]">{p.qty} un</span>
                                        </div>
                                    ))}
                                    {productStats.bottom.length === 0 && <p className="text-sm text-[var(--text-muted)]">Sem dados</p>}
                                </div>
                            </Card>
                        </div>
                    </div>

                    {/* Mesas */}
                    <div>
                        <h3 className="text-lg font-bold text-[var(--text)] mb-3 flex items-center gap-2"><Users size={20} className="text-[var(--info)]" /> Mesas</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <StatCard title="Ocupações" value={tableOccupations} icon={Users} accentColor="var(--info)" />
                            <StatCard
                                title="Tempo Médio de Ocupação"
                                value={`${avgTableTime.avg} min`}
                                subtitle={avgTableTime.excluded > 0 ? `Abertura até fechamento · ${avgTableTime.excluded} atípico(s) excluído(s)` : 'Abertura até fechamento'}
                                icon={Clock}
                                accentColor="var(--warn)"
                            />
                        </div>
                        <Card className={cardCls}>
                            <h4 className={h4Cls}>Ocupação por Hora do Dia</h4>
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={tableOccupationsByHour}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                                        <XAxis dataKey="hour" tick={{fontSize: 12}} />
                                        <YAxis tick={{fontSize: 12}} />
                                        <RechartsTooltip />
                                        <Bar dataKey="count" fill="#484DB5" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </Card>

                        {/* Fase 4, Task 13: mapa de calor cruzando dia da semana ×
                            hora — mesmo dado do gráfico acima, outro ângulo. Sem
                            biblioteca de heatmap: grid CSS simples, intensidade da
                            cor de marca proporcional à contagem (0 = célula vazia). */}
                        {occupancyHeatmap.hours.length > 0 && (
                            <Card className={`${cardCls} mt-4 overflow-x-auto`}>
                                <h4 className={h4Cls}>Ocupação por Dia da Semana × Hora</h4>
                                <div className="inline-block min-w-full">
                                    <div className="grid gap-1" style={{ gridTemplateColumns: `48px repeat(${occupancyHeatmap.hours.length}, 1fr)` }}>
                                        <div />
                                        {occupancyHeatmap.hours.map(h => (
                                            <div key={h} className="text-[10px] text-center text-[var(--text-muted)] font-mono">{h}h</div>
                                        ))}
                                        {DAY_LABELS.map((label, day) => (
                                            <React.Fragment key={label}>
                                                <div className="text-xs font-bold text-[var(--text-muted)] flex items-center">{label}</div>
                                                {occupancyHeatmap.grid[day].map((v, i) => {
                                                    const intensity = occupancyHeatmap.max > 0 ? v / occupancyHeatmap.max : 0;
                                                    return (
                                                        <div
                                                            key={i}
                                                            title={`${label} ${occupancyHeatmap.hours[i]}h: ${v} mesa(s)`}
                                                            className="aspect-square rounded-sm flex items-center justify-center text-[9px] font-bold"
                                                            style={{
                                                                backgroundColor: v === 0 ? 'var(--surface-2)' : `color-mix(in srgb, var(--brand) ${Math.round(20 + intensity * 80)}%, var(--surface-2))`,
                                                                color: intensity > 0.5 ? '#fff' : 'var(--text-muted)',
                                                            }}
                                                        >
                                                            {v > 0 ? v : ''}
                                                        </div>
                                                    );
                                                })}
                                            </React.Fragment>
                                        ))}
                                    </div>
                                </div>
                            </Card>
                        )}

                        {/* Fase 4, Task 13: funil simples do período filtrado. */}
                        <Card className={`${cardCls} mt-4`}>
                            <h4 className={h4Cls}>Funil de Conversão (Mesas)</h4>
                            <div className="grid grid-cols-3 gap-3 text-center">
                                <div>
                                    <p className="text-2xl font-black text-[var(--text)]">{funnelStats.opened}</p>
                                    <p className="text-xs text-[var(--text-muted)] mt-1">Mesas abertas</p>
                                </div>
                                <div>
                                    <p className="text-2xl font-black text-[var(--info)]">{funnelStats.withOrder}</p>
                                    <p className="text-xs text-[var(--text-muted)] mt-1">
                                        Com pedido
                                        {funnelStats.opened > 0 && <span className="block">({Math.round(funnelStats.withOrder / funnelStats.opened * 100)}%)</span>}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-2xl font-black text-[var(--ok)]">{funnelStats.closed}</p>
                                    <p className="text-xs text-[var(--text-muted)] mt-1">
                                        Fechadas com pagamento
                                        {funnelStats.opened > 0 && <span className="block">({Math.round(funnelStats.closed / funnelStats.opened * 100)}%)</span>}
                                    </p>
                                </div>
                            </div>
                        </Card>
                    </div>

                    {/* Balcão */}
                    <div>
                        <h3 className="text-lg font-bold text-[var(--text)] mb-3 flex items-center gap-2"><Coffee size={20} className="text-[var(--warn)]" /> Balcão</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <StatCard title="Faturamento Balcão" value={`R$ ${formatBRL(counterStats.total)}`} icon={Receipt} accentColor="var(--warn)" />
                            <StatCard title="Número de Pedidos" value={counterStats.count} icon={Coffee} accentColor="var(--warn)" />
                        </div>
                    </div>

                    {/* Avaliações */}
                    <div>
                        <h3 className="text-lg font-bold text-[var(--text)] mb-3 flex items-center gap-2"><Star size={20} className="text-[var(--warn)]" /> Avaliações</h3>
                        <div className="grid grid-cols-1 gap-4 mb-4">
                            <StatCard title="Nota Média" value={periodRatings.length > 0 ? avgRating.toFixed(1) : '-'} subtitle={`${periodRatings.length} avaliação(ões) no período`} icon={Star} accentColor="var(--warn)" />
                        </div>
                        <Card className={cardCls}>
                            <h4 className={h4Cls}>Comentários Recentes</h4>
                            <div className="space-y-3 max-h-80 overflow-y-auto">
                                {periodRatings.filter(r => r.comment).slice(0, 10).map((r) => (
                                    <div key={r.id} className="border-b border-[var(--border)] pb-2 last:border-0">
                                        <div className="flex items-center gap-1 mb-1">
                                            {[1, 2, 3, 4, 5].map((n) => (
                                                <Star key={n} size={12} className={n <= r.stars ? 'fill-[var(--warn)] text-[var(--warn)]' : 'text-[var(--border)]'} />
                                            ))}
                                        </div>
                                        <p className="text-sm text-[var(--text)]">{r.comment}</p>
                                    </div>
                                ))}
                                {periodRatings.filter(r => r.comment).length === 0 && <p className="text-sm text-[var(--text-muted)]">Sem comentários no período</p>}
                            </div>
                        </Card>
                    </div>
                </div>
            </section>
        </div>
    );
};
