'use client';
import React, { useMemo, useState } from 'react';
import { Card, Input } from '@/components/ui';
import { Order } from '@/types';
import { BarChart3, Receipt, CheckCircle, Clock, Users, Coffee, TrendingUp } from 'lucide-react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
    BarChart, Bar, PieChart, Pie, Cell, Legend
} from 'recharts';
import { subDays, isAfter, isSameDay, isSameWeek, isSameMonth, format, differenceInMinutes } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getPaymentMethodLabel } from '@/lib/labels';

const COLORS = ['#484DB5', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#F43F5E'];

export const StoreDashboardView: React.FC<{ sales: Order[] }> = ({ sales }) => {
    const [periodType, setPeriodType] = useState<'custom' | 'today' | 'week' | 'month' | 'year'>('custom');
    const [periodDays, setPeriodDays] = useState<number>(90);

    const now = new Date();

    const dailySales = sales.filter(s => isSameDay(new Date(s.created_at), now));
    const weeklySales = sales.filter(s => isSameWeek(new Date(s.created_at), now, { locale: ptBR }));
    const monthlySales = sales.filter(s => isSameMonth(new Date(s.created_at), now));

    const calcStats = (orders: Order[]) => {
        // Acumula em centavos inteiros para evitar erro de arredondamento de ponto flutuante somando muitos pedidos.
        const totalCents = orders.reduce((sum, o) => {
            const orderTotal = o.total || o.order_items?.reduce((s, i) => s + (i.price_at_time * i.quantity), 0) || 0;
            return sum + Math.round(orderTotal * 100);
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

    const periodSales = useMemo(() => {
        if (periodType === 'today') return dailySales;
        if (periodType === 'week') return weeklySales;
        if (periodType === 'month') return monthlySales;
        if (periodType === 'year') return sales.filter(s => new Date(s.created_at).getFullYear() === now.getFullYear());
        const periodStartDate = subDays(now, periodDays);
        return sales.filter(s => isAfter(new Date(s.created_at), periodStartDate));
    }, [sales, periodType, periodDays, dailySales, weeklySales, monthlySales, now]);

    const periodStats = calcStats(periodSales);

    const salesByDay = useMemo(() => {
        // Agrupa por chave yyyy-MM-dd (nao so dd/MM) para nao colidir datas de anos diferentes.
        const map = new Map<string, { label: string; total: number }>();
        periodSales.forEach(o => {
            const d = new Date(o.created_at);
            const key = format(d, 'yyyy-MM-dd');
            const total = o.total || o.order_items?.reduce((s, i) => s + (i.price_at_time * i.quantity), 0) || 0;
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

    const productStats = useMemo(() => {
        const map = new Map<string, { id: string, name: string, qty: number }>();
        periodSales.forEach(o => {
            o.order_items?.forEach(i => {
                if (!i.product) return;
                const existing = map.get(i.product_id) || { id: i.product_id, name: i.product.name, qty: 0 };
                existing.qty += i.quantity;
                map.set(i.product_id, existing);
            });
        });
        const arr = Array.from(map.values()).sort((a, b) => b.qty - a.qty);
        const top = arr.slice(0, 5);
        const topIds = new Set(top.map(p => p.id));
        // Exclui do "menos vendidos" quem ja aparece no "mais vendidos" (acontecia quando havia <=10 produtos distintos no periodo).
        const bottom = arr.slice().reverse().filter(p => !topIds.has(p.id)).slice(0, 5);
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

    const avgDeliveryTime = useMemo(() => {
        let totalMins = 0; let count = 0;
        periodSales.forEach(o => { if (o.updated_at) { totalMins += differenceInMinutes(new Date(o.updated_at), new Date(o.created_at)); count++; } });
        return count > 0 ? Math.round(totalMins / count) : 0;
    }, [periodSales]);

    const avgTableTime = useMemo(() => {
        let totalMins = 0; let count = 0;
        tableSales.forEach(o => { if (o.updated_at) { totalMins += differenceInMinutes(new Date(o.updated_at), new Date(o.created_at)); count++; } });
        return count > 0 ? Math.round(totalMins / count) : 0;
    }, [tableSales]);

    const counterSales = periodSales.filter(s => s.order_type === 'counter');
    const counterStats = calcStats(counterSales);

    const StatCard = ({ title, value, subtitle, icon: Icon, accentColor }: any) => (
        <Card accentColor={accentColor} className="p-4 pl-5 shadow-sm">
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
            {/* Faturamento Bruto */}
            <section>
                <h2 className="text-xl font-bold text-[var(--text)] mb-4">Faturamento Bruto</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                        { label: 'Hoje', stats: dailyStats },
                        { label: 'Esta Semana', stats: weeklyStats },
                        { label: 'Este Mês', stats: monthlyStats },
                    ].map(({ label, stats }) => (
                        <Card key={label} className={cardCls}>
                            <h3 className="font-bold text-[var(--text)] mb-3 border-b border-[var(--border)] pb-2">{label}</h3>
                            <div className="space-y-2">
                                <div className="flex justify-between"><span className="text-sm text-[var(--text-muted)]">Total:</span><span className="font-bold text-[var(--brand)]">R$ {stats.total.toFixed(2)}</span></div>
                                <div className="flex justify-between"><span className="text-sm text-[var(--text-muted)]">Ticket Médio:</span><span className="font-medium text-[var(--text)]">R$ {stats.ticket.toFixed(2)}</span></div>
                                <div className="flex justify-between"><span className="text-sm text-[var(--text-muted)]">Pedidos:</span><span className="font-medium text-[var(--text)]">{stats.count}</span></div>
                                <div className="flex justify-between"><span className="text-sm text-[var(--text-muted)]">Ocupação Mesas:</span><span className="font-medium text-[var(--text)]">{stats.tableOrders}</span></div>
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
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                            <StatCard title="Total no Período" value={`R$ ${periodStats.total.toFixed(2)}`} icon={Receipt} accentColor="var(--brand)" />
                            <StatCard title="Ticket Médio" value={`R$ ${periodStats.ticket.toFixed(2)}`} icon={TrendingUp} accentColor="var(--info)" />
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
                                            <RechartsTooltip formatter={(value: any) => [`R$ ${Number(value).toFixed(2)}`, 'Total']} />
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
                            <StatCard title="Número de Pedidos" value={periodStats.count} icon={CheckCircle} accentColor="var(--ok)" />
                            <StatCard title="Tempo Médio de Atendimento" value={`${avgDeliveryTime} min`} subtitle="Criação até entrega" icon={Clock} accentColor="var(--info)" />
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
                            <StatCard title="Tempo Médio de Ocupação" value={`${avgTableTime} min`} subtitle="Abertura até fechamento" icon={Clock} accentColor="var(--warn)" />
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
                    </div>

                    {/* Balcão */}
                    <div>
                        <h3 className="text-lg font-bold text-[var(--text)] mb-3 flex items-center gap-2"><Coffee size={20} className="text-[var(--warn)]" /> Balcão</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <StatCard title="Faturamento Balcão" value={`R$ ${counterStats.total.toFixed(2)}`} icon={Receipt} accentColor="var(--warn)" />
                            <StatCard title="Número de Pedidos" value={counterStats.count} icon={Coffee} accentColor="var(--warn)" />
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
};
