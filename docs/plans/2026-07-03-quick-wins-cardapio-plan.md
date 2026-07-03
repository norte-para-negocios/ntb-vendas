# Quick Wins do Cardápio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar os 4 quick wins do Mega Plano (taxa de serviço configurável, exportar CSV, comparação vs. período anterior no dashboard, avaliação pós-refeição) no `ntb-vendas-next`.

**Architecture:** Cada feature toca só os arquivos já responsáveis por aquele pedaço do sistema (sem introduzir camadas novas): `lib/calc.ts` ganha um parâmetro de taxa; `lib/csv.ts` é um arquivo novo e pequeno, só a função de export; `StoreDashboardView.tsx` ganha um período comparativo e uma seção de avaliações; a tabela `order_ratings` segue o padrão de RLS permissiva já usado em `orders`/`order_items` (não é dado sensível, não precisa do padrão write-only do certificado fiscal).

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase (Postgres + RLS), Tailwind v4, `date-fns`, `lucide-react`, `recharts`.

## Global Constraints

- Sem suite de testes automatizada neste projeto. Verificação de cada tarefa é `npx tsc --noEmit` + `npm run build` limpos, mais teste manual no navegador (`npm run dev`).
- Testes manuais sempre na loja "Bistrô Demo" (slug `bistro`) ou "Japanese". Nunca em loja real de cliente (o app local conecta no banco de produção real).
- Nenhum texto visível usa travessão (—). Usar vírgula, ponto ou reescrever a frase.
- Todo texto novo em português correto, com acentuação completa.
- Migrations aplicadas via `node scripts/aplicar-migration.mjs <arquivo>.sql`; a próxima é `013_order_ratings.sql` (últimas aplicadas: 001 a 012).

---

### Task 1: `service_fee_rate` no tipo `Store` e em `lib/calc.ts`

**Files:**
- Modify: `types/index.ts:37-42`
- Modify: `lib/calc.ts`

**Interfaces:**
- Produces: `Store.config.service_fee_rate?: number` (decimal, ex. `0.10`). `calculateServiceFee(subtotal: number, rate: number): number`, `calculateOrderTotal(subtotal: number, chargeServiceFee: boolean, rate: number, serviceFeeRemoved?: boolean): number`, `calculateSplitByPerson(items: SplitItem[], chargeServiceFee: boolean, rate: number): Map<string, number>`. `SERVICE_FEE_RATE` continua exportado como valor padrão (`0.10`) pra quando a loja não tiver a taxa configurada.

- [ ] **Step 1: Adicionar o campo ao tipo `Store`**

Em `types/index.ts`, trocar:

```ts
  config: {
    use_pin: boolean;
    allow_client_open: boolean;
    require_pin_for_open: boolean;
    charge_service_fee?: boolean;
  };
```

por:

```ts
  config: {
    use_pin: boolean;
    allow_client_open: boolean;
    require_pin_for_open: boolean;
    charge_service_fee?: boolean;
    service_fee_rate?: number;
  };
```

- [ ] **Step 2: Tornar a taxa um parâmetro em `lib/calc.ts`**

Reescrever `lib/calc.ts` inteiro para:

```ts
// Fonte única da fórmula de taxa de serviço e split de conta, antes
// duplicada em 7+ lugares entre StoreModule.tsx e ClientModule.tsx.
// O percentual é configurável por loja (store.config.service_fee_rate);
// SERVICE_FEE_RATE é só o valor padrão pra lojas que ainda não configuraram.
export const SERVICE_FEE_RATE = 0.10;

export function calculateServiceFee(subtotal: number, rate: number = SERVICE_FEE_RATE): number {
  return subtotal * rate;
}

export function calculateOrderTotal(subtotal: number, chargeServiceFee: boolean, rate: number = SERVICE_FEE_RATE, serviceFeeRemoved?: boolean): number {
  if (!chargeServiceFee || serviceFeeRemoved) return subtotal;
  return subtotal + calculateServiceFee(subtotal, rate);
}

export interface SplitItem {
  userName: string;
  subtotal: number;
}

export function calculateSplitByPerson(items: SplitItem[], chargeServiceFee: boolean, rate: number = SERVICE_FEE_RATE): Map<string, number> {
  const bySubtotal = new Map<string, number>();
  for (const item of items) {
    bySubtotal.set(item.userName, (bySubtotal.get(item.userName) || 0) + item.subtotal);
  }
  const result = new Map<string, number>();
  for (const [name, subtotal] of bySubtotal) {
    result.set(name, calculateOrderTotal(subtotal, chargeServiceFee, rate));
  }
  return result;
}

export function calculateChange(amountPaid: number, total: number): number {
  return Math.max(0, amountPaid - total);
}
```

Nota: os parâmetros `rate` têm valor padrão `SERVICE_FEE_RATE` só como rede de segurança; a partir da Task 3 e 4, todo call site vai passar o valor explícito da loja.

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: erros nos call sites de `StoreModule.tsx`/`ClientModule.tsx` **não** aparecem ainda (os parâmetros novos têm default, então continuam compilando mesmo sem passar `rate`), zero erros nesta task.

- [ ] **Step 4: Commit**

```bash
git add types/index.ts lib/calc.ts
git commit -m "feat: adiciona taxa de servico configuravel por loja em lib/calc.ts"
```

---

### Task 2: UI da taxa de serviço no Master Admin

**Files:**
- Modify: `lib/api.ts` (`CreateStoreParams`, `createStore`, `updateStore`)
- Modify: `components/modules/AdminModule.tsx`

**Interfaces:**
- Consumes: `Store.config.service_fee_rate` (Task 1).
- Produces: `CreateStoreParams.serviceFeeRate: number` (decimal), usado por `createStore`/`updateStore`.

- [ ] **Step 1: Adicionar `serviceFeeRate` a `CreateStoreParams` e usar no `createStore`**

Em `lib/api.ts`, trocar:

```ts
export interface CreateStoreParams {
  name: string;
  cnpj: string;
  slug: string;
  contractType: 'balcao' | 'balcao_mesas';
  tableCount: number;
  periodMonths: number;
  isActive: boolean;
  logoUrl?: string | null;
}
```

por:

```ts
export interface CreateStoreParams {
  name: string;
  cnpj: string;
  slug: string;
  contractType: 'balcao' | 'balcao_mesas';
  tableCount: number;
  periodMonths: number;
  isActive: boolean;
  logoUrl?: string | null;
  serviceFeeRate: number;
}
```

E em `createStore`, trocar:

```ts
        config: { use_pin: true, allow_client_open: true },
```

por:

```ts
        config: { use_pin: true, allow_client_open: true, service_fee_rate: params.serviceFeeRate },
```

- [ ] **Step 2: `updateStore` passa a mesclar o config sem apagar o resto**

Em `lib/api.ts`, trocar o corpo de `updateStore`:

```ts
export const updateStore = async (id: string, params: CreateStoreParams): Promise<{ success: boolean; message?: string }> => {
  try {
    const { error } = await supabase
      .from('stores')
      .update({ name: params.name, cnpj: params.cnpj, slug: params.slug, contract_type: params.contractType, contract_period_months: params.periodMonths, is_active: params.isActive, logo_url: params.logoUrl })
      .eq('id', id);

    if (error) {
      if (error.code === '23505') return { success: false, message: 'Este slug (URL) já está em uso por outra loja.' };
      throw error;
    }
```

por:

```ts
export const updateStore = async (id: string, params: CreateStoreParams): Promise<{ success: boolean; message?: string }> => {
  try {
    // Busca o config atual pra só sobrescrever service_fee_rate, sem apagar
    // outras flags (use_pin, allow_client_open, require_pin_for_open,
    // charge_service_fee) que o lojista já pode ter configurado.
    const { data: current } = await supabase.from('stores').select('config').eq('id', id).single();
    const { error } = await supabase
      .from('stores')
      .update({
        name: params.name, cnpj: params.cnpj, slug: params.slug, contract_type: params.contractType,
        contract_period_months: params.periodMonths, is_active: params.isActive, logo_url: params.logoUrl,
        config: { ...(current?.config || {}), service_fee_rate: params.serviceFeeRate },
      })
      .eq('id', id);

    if (error) {
      if (error.code === '23505') return { success: false, message: 'Este slug (URL) já está em uso por outra loja.' };
      throw error;
    }
```

(o resto da função continua igual, não precisa tocar).

- [ ] **Step 3: Estado e wiring no `AdminModule.tsx`**

Em `components/modules/AdminModule.tsx:167`, logo depois de `const [periodMonths, setPeriodMonths] = useState<number>(12);`, adicionar:

```tsx
  const [serviceFeeRatePercent, setServiceFeeRatePercent] = useState<number>(10);
```

Em `resetForm` (linha ~217), depois de `setPeriodMonths(12);`, adicionar:

```tsx
      setServiceFeeRatePercent(10);
```

Em `handleEditStore` (linha ~247), depois de `setPeriodMonths(store.contract_period_months || 12);`, adicionar:

```tsx
      setServiceFeeRatePercent(store.config?.service_fee_rate != null ? store.config.service_fee_rate * 100 : 10);
```

Em `handleSaveStore`, dentro do objeto `params` (linha ~377-386), adicionar o campo:

```ts
          const params = {
              name: trimmedName,
              cnpj,
              slug: trimmedSlug,
              contractType,
              tableCount,
              periodMonths,
              isActive,
              logoUrl: finalLogoUrl,
              serviceFeeRate: serviceFeeRatePercent / 100,
          };
```

- [ ] **Step 4: Campo no formulário**

Em `components/modules/AdminModule.tsx`, no bloco que hoje tem CNPJ e Meses de Contrato (grid de 2 colunas, procurar `<Input label="CNPJ"` e `<Input type="number" label="Meses de Contrato"`), adicionar um terceiro campo logo depois desse grid:

```tsx
                <Input type="number" label="Taxa de Serviço (%)" value={serviceFeeRatePercent} onChange={e => setServiceFeeRatePercent(Number(e.target.value) || 0)} min="0" max="100" step="0.1" />
```

- [ ] **Step 5: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos limpos.

- [ ] **Step 6: Teste manual**

Run: `npm run dev`, abrir `/painel`, editar a loja "Bistrô Demo", mudar "Taxa de Serviço (%)" pra `15`, salvar. Reabrir a edição da mesma loja e confirmar que o campo mostra `15` (não voltou pro padrão).

- [ ] **Step 7: Commit**

```bash
git add lib/api.ts components/modules/AdminModule.tsx
git commit -m "feat: adiciona campo de taxa de servico configuravel no Master Admin"
```

---

### Task 3: Usar a taxa configurável em `StoreModule.tsx` (painel do Lojista)

**Files:**
- Modify: `components/modules/StoreModule.tsx`

**Interfaces:**
- Consumes: `calculateServiceFee(subtotal, rate)`, `calculateOrderTotal(subtotal, chargeServiceFee, rate)`, `calculateSplitByPerson(items, chargeServiceFee, rate)` (Task 1).

- [ ] **Step 1: Declarar a taxa uma vez no início de `TablesView`**

Em `components/modules/StoreModule.tsx:803-804`, trocar:

```tsx
const TablesView: React.FC<{ store: Store; loggedUser: StoreUser }> = ({ store, loggedUser }) => {
    const storeId = store.id;
```

por:

```tsx
const TablesView: React.FC<{ store: Store; loggedUser: StoreUser }> = ({ store, loggedUser }) => {
    const storeId = store.id;
    const serviceFeeRate = store.config?.service_fee_rate ?? 0.10;
```

- [ ] **Step 2: Passar `serviceFeeRate` nas 8 chamadas existentes**

Trocar (linha ~874-875):

```tsx
        const serviceFee = isServiceFeeEnabled ? calculateServiceFee(subtotal) : 0;
        const total = calculateOrderTotal(subtotal, isServiceFeeEnabled);
```

por:

```tsx
        const serviceFee = isServiceFeeEnabled ? calculateServiceFee(subtotal, serviceFeeRate) : 0;
        const total = calculateOrderTotal(subtotal, isServiceFeeEnabled, serviceFeeRate);
```

Trocar (linha ~895):

```tsx
        const totalsByUser = calculateSplitByPerson(splitItems, currentTableSummary.isServiceFeeEnabled);
```

por:

```tsx
        const totalsByUser = calculateSplitByPerson(splitItems, currentTableSummary.isServiceFeeEnabled, serviceFeeRate);
```

Trocar (linha ~899):

```tsx
            breakdown[userName].serviceFee = currentTableSummary.isServiceFeeEnabled ? calculateServiceFee(userSubtotal) : 0;
```

por:

```tsx
            breakdown[userName].serviceFee = currentTableSummary.isServiceFeeEnabled ? calculateServiceFee(userSubtotal, serviceFeeRate) : 0;
```

Trocar (linha ~943-944):

```tsx
    const calculatorServiceFee = (currentTableSummary?.isServiceFeeEnabled) ? calculateServiceFee(calculatorSubtotal) : 0;
    const calculatorTotal = calculateOrderTotal(calculatorSubtotal, !!currentTableSummary?.isServiceFeeEnabled);
```

por:

```tsx
    const calculatorServiceFee = (currentTableSummary?.isServiceFeeEnabled) ? calculateServiceFee(calculatorSubtotal, serviceFeeRate) : 0;
    const calculatorTotal = calculateOrderTotal(calculatorSubtotal, !!currentTableSummary?.isServiceFeeEnabled, serviceFeeRate);
```

Trocar (linha ~1032-1033, dentro de `getTableSummary`):

```tsx
        const serviceFee = isServiceFeeEnabled ? calculateServiceFee(subtotal) : 0;
        const total = calculateOrderTotal(subtotal, isServiceFeeEnabled);
```

por:

```tsx
        const serviceFee = isServiceFeeEnabled ? calculateServiceFee(subtotal, serviceFeeRate) : 0;
        const total = calculateOrderTotal(subtotal, isServiceFeeEnabled, serviceFeeRate);
```

(`getTableSummary` está dentro do mesmo componente `TablesView`, então `serviceFeeRate` já está em escopo.)

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos limpos.

- [ ] **Step 4: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat: usa taxa de servico configuravel da loja em TablesView"
```

---

### Task 4: Usar a taxa configurável em `ClientModule.tsx` (cliente final)

**Files:**
- Modify: `components/modules/ClientModule.tsx`

**Interfaces:**
- Consumes: mesmas funções da Task 3.

- [ ] **Step 1: Novo estado `serviceFeeRate` em `BillSplitter`**

Em `components/modules/ClientModule.tsx:672-674`, trocar:

```tsx
    const [serviceFee, setServiceFee] = useState(0);
    const [subtotal, setSubtotal] = useState(0);
    const [isServiceFeeEnabled, setIsServiceFeeEnabled] = useState(false);
```

por:

```tsx
    const [serviceFee, setServiceFee] = useState(0);
    const [subtotal, setSubtotal] = useState(0);
    const [isServiceFeeEnabled, setIsServiceFeeEnabled] = useState(false);
    const [serviceFeeRate, setServiceFeeRate] = useState(0.10);
```

- [ ] **Step 2: Ler a taxa do config fresco e usar nas duas chamadas do `loadBill`**

Trocar (linha ~691-699):

```tsx
            // Calculate service fee
            const isFeeEnabled = !!(storeConfig?.charge_service_fee && !tableData?.service_fee_removed);
            const calculatedSubtotal = data.total;
            const calculatedServiceFee = isFeeEnabled ? calculateServiceFee(calculatedSubtotal) : 0;

            setSubtotal(calculatedSubtotal);
            setServiceFee(calculatedServiceFee);
            setTotal(calculateOrderTotal(calculatedSubtotal, isFeeEnabled));
            setIsServiceFeeEnabled(isFeeEnabled);
```

por:

```tsx
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
```

- [ ] **Step 3: Usar `serviceFeeRate` em `usersBreakdown`**

Trocar (linha ~775-782):

```tsx
        Object.keys(breakdown).forEach(userName => {
            const userSubtotal = breakdown[userName].subtotal;
            breakdown[userName].serviceFee = isServiceFeeEnabled ? calculateServiceFee(userSubtotal) : 0;
            breakdown[userName].total = calculateOrderTotal(userSubtotal, isServiceFeeEnabled);
        });

        return breakdown;
    }, [items, isServiceFeeEnabled]);
```

por:

```tsx
        Object.keys(breakdown).forEach(userName => {
            const userSubtotal = breakdown[userName].subtotal;
            breakdown[userName].serviceFee = isServiceFeeEnabled ? calculateServiceFee(userSubtotal, serviceFeeRate) : 0;
            breakdown[userName].total = calculateOrderTotal(userSubtotal, isServiceFeeEnabled, serviceFeeRate);
        });

        return breakdown;
    }, [items, isServiceFeeEnabled, serviceFeeRate]);
```

- [ ] **Step 4: Usar `serviceFeeRate` na calculadora**

Trocar (linha ~824-825):

```tsx
    const calculatorServiceFee = isServiceFeeEnabled ? calculateServiceFee(calculatorSubtotal) : 0;
    const calculatorTotal = calculateOrderTotal(calculatorSubtotal, isServiceFeeEnabled);
```

por:

```tsx
    const calculatorServiceFee = isServiceFeeEnabled ? calculateServiceFee(calculatorSubtotal, serviceFeeRate) : 0;
    const calculatorTotal = calculateOrderTotal(calculatorSubtotal, isServiceFeeEnabled, serviceFeeRate);
```

- [ ] **Step 5: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos limpos.

- [ ] **Step 6: Teste manual completo (Tasks 1-4)**

Run: `npm run dev`, na loja "Bistrô Demo" (já com taxa em 15% da Task 2): abrir uma mesa como cliente, montar um pedido, conferir que o total mostrado usa 15% (não 10%); no painel do Lojista, abrir a mesma mesa e conferir que "Dividir Conta"/calculadora também usam 15%.

- [ ] **Step 7: Commit**

```bash
git add components/modules/ClientModule.tsx
git commit -m "feat: usa taxa de servico configuravel da loja em BillSplitter"
```

---

### Task 5: Exportar CSV do Histórico de Vendas

**Files:**
- Create: `lib/csv.ts`
- Modify: `components/modules/StoreModule.tsx`

**Interfaces:**
- Consumes: `SalesReportRow` (já existe em `lib/print.ts`).
- Produces: `downloadSalesReportCsv(rows: SalesReportRow[], filename: string): void`.

- [ ] **Step 1: Criar `lib/csv.ts`**

```ts
import { SalesReportRow } from '@/lib/print';

// Separador ; (não ,): é o que o Excel em pt-BR espera por padrão, já que a
// vírgula já é o separador decimal nesse locale.
function escapeCsvField(value: string): string {
  if (value.includes(';') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function downloadSalesReportCsv(rows: SalesReportRow[], filename: string): void {
  const header = ['Data', 'Tipo', 'Cliente/Mesa', 'Itens', 'Total'];
  const lines = [
    header.join(';'),
    ...rows.map((r) =>
      [
        escapeCsvField(r.date),
        escapeCsvField(r.type),
        escapeCsvField(r.customer),
        String(r.items),
        r.total.toFixed(2).replace('.', ','),
      ].join(';')
    ),
  ];
  const csvContent = '﻿' + lines.join('\r\n'); // BOM pro Excel reconhecer UTF-8
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
```

- [ ] **Step 2: Botão "Exportar CSV" ao lado de "Imprimir Relatório"**

Em `components/modules/StoreModule.tsx`, importar a função nova (perto do import de `printSalesReport`):

```tsx
import { printKitchenTicket, printBillReceipt, printSalesReport } from '@/lib/print';
import { downloadSalesReportCsv } from '@/lib/csv';
```

Adicionar o handler logo depois de `handlePrintReport` (linha ~2903, mesmo bloco):

```tsx
    const handleExportCsv = () => {
        downloadSalesReportCsv(
            filteredAndSortedSales.map(order => ({
                date: `${new Date(order.created_at).toLocaleDateString()} ${new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                type: order.order_type === 'table' ? 'Mesa' : 'Balcão',
                customer: order.order_type === 'table' ? `Mesa ${order.tables?.number || '?'}` : (order.customer_name || 'Cliente Balcão'),
                items: order.order_items?.length || 0,
                total: order.order_items?.reduce((sum, item) => sum + (item.price_at_time * item.quantity), 0) || 0,
            })),
            `vendas-${store.name.toLowerCase().replace(/\s+/g, '-')}.csv`
        );
    };
```

Trocar o botão de imprimir (linha ~3007-3010):

```tsx
                                    <Button variant="secondary" onClick={handlePrintReport} disabled={filteredAndSortedSales.length === 0}>
                                        <Printer size={16} className="mr-2" />
                                        Imprimir Relatório
                                    </Button>
```

por:

```tsx
                                    <Button variant="secondary" onClick={handlePrintReport} disabled={filteredAndSortedSales.length === 0}>
                                        <Printer size={16} className="mr-2" />
                                        Imprimir Relatório
                                    </Button>
                                    <Button variant="secondary" onClick={handleExportCsv} disabled={filteredAndSortedSales.length === 0}>
                                        <Download size={16} className="mr-2" />
                                        Exportar CSV
                                    </Button>
```

Adicionar `Download` ao import de ícones do topo do arquivo (linha 5), junto dos outros ícones já importados de `lucide-react`.

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos limpos.

- [ ] **Step 4: Teste manual**

Run: `npm run dev`, Histórico de Vendas da Bistrô Demo, clicar "Exportar CSV", abrir o arquivo baixado no Excel/Google Sheets, conferir que os valores batem com a tela (e com o PDF do "Imprimir Relatório").

- [ ] **Step 5: Commit**

```bash
git add lib/csv.ts components/modules/StoreModule.tsx
git commit -m "feat: adiciona exportar CSV no historico de vendas"
```

---

### Task 6: Comparação vs. período anterior no dashboard

**Files:**
- Modify: `components/modules/StoreDashboardView.tsx`

**Interfaces:**
- Produces: `previousPeriodStats` (mesma forma de `calcStats`), usado só dentro deste arquivo.

- [ ] **Step 1: Importar `subMonths` e `TrendingDown`**

Trocar:

```tsx
import { subDays, isAfter, isSameDay, isSameWeek, isSameMonth, format, differenceInMinutes } from 'date-fns';
```

por:

```tsx
import { subDays, subMonths, isAfter, isBefore, isSameDay, isSameWeek, isSameMonth, format, differenceInMinutes } from 'date-fns';
```

Trocar:

```tsx
import { BarChart3, Receipt, CheckCircle, Clock, Users, Coffee, TrendingUp } from 'lucide-react';
```

por:

```tsx
import { BarChart3, Receipt, CheckCircle, Clock, Users, Coffee, TrendingUp, TrendingDown } from 'lucide-react';
```

- [ ] **Step 2: Calcular `previousPeriodSales` e `previousPeriodStats`**

Logo depois do bloco `periodStats = calcStats(periodSales);` (linha ~61), adicionar:

```tsx
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

    const ChangeBadge = ({ value }: { value: number | undefined }) => {
        if (value === undefined) return null;
        const isUp = value >= 0;
        const Icon = isUp ? TrendingUp : TrendingDown;
        return (
            <span className={`inline-flex items-center gap-1 text-xs font-bold ${isUp ? 'text-[var(--ok)]' : 'text-[var(--err)]'}`}>
                <Icon size={14} />
                {isUp ? '+' : ''}{value.toFixed(1)}% vs. período anterior
            </span>
        );
    };
```

- [ ] **Step 3: Mostrar a variação nos 3 StatCards do período**

Trocar (linha ~231-234):

```tsx
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                            <StatCard title="Total no Período" value={`R$ ${periodStats.total.toFixed(2)}`} icon={Receipt} accentColor="var(--brand)" />
                            <StatCard title="Ticket Médio" value={`R$ ${periodStats.ticket.toFixed(2)}`} icon={TrendingUp} accentColor="var(--info)" />
                        </div>
```

por:

```tsx
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                            <StatCard title="Total no Período" value={`R$ ${periodStats.total.toFixed(2)}`} subtitle={<ChangeBadge value={percentChange(periodStats.total, previousPeriodStats.total)} />} icon={Receipt} accentColor="var(--brand)" />
                            <StatCard title="Ticket Médio" value={`R$ ${periodStats.ticket.toFixed(2)}`} subtitle={<ChangeBadge value={percentChange(periodStats.ticket, previousPeriodStats.ticket)} />} icon={TrendingUp} accentColor="var(--info)" />
                        </div>
```

E no StatCard de "Número de Pedidos" (linha ~273):

```tsx
                            <StatCard title="Número de Pedidos" value={periodStats.count} icon={CheckCircle} accentColor="var(--ok)" />
```

por:

```tsx
                            <StatCard title="Número de Pedidos" value={periodStats.count} subtitle={<ChangeBadge value={percentChange(periodStats.count, previousPeriodStats.count)} />} icon={CheckCircle} accentColor="var(--ok)" />
```

Nota: `StatCard` (linha ~160-173) já aceita `subtitle` como `any` e renderiza com `{subtitle && <p ...>{subtitle}</p>}` , então passar um JSX element no lugar de string funciona sem alterar o componente.

- [ ] **Step 4: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos limpos.

- [ ] **Step 5: Teste manual**

Run: `node scripts/db.mjs` pra criar (ou usar dados existentes) vendas em dois períodos vizinhos da Bistrô Demo; abrir o Dashboard, trocar entre "Hoje"/"Esta Semana"/"Este Mês"/"Últimos X dias" e conferir que a variação percentual exibida bate com a conta manual `(atual - anterior) / anterior * 100`.

- [ ] **Step 6: Commit**

```bash
git add components/modules/StoreDashboardView.tsx
git commit -m "feat: adiciona comparacao vs periodo anterior no dashboard"
```

---

### Task 7: Schema e API de avaliação pós-refeição

**Files:**
- Create: `supabase/migrations/013_order_ratings.sql`
- Modify: `types/index.ts`
- Modify: `lib/api.ts`

**Interfaces:**
- Produces: `OrderRating { id, order_id, store_id, stars, comment, created_at }`, `createOrderRating(orderId: string, storeId: string, stars: number, comment: string | null): Promise<{ success: boolean; message?: string }>`, `fetchOrderRatings(storeId: string, sinceDate?: string): Promise<OrderRating[]>`.

- [ ] **Step 1: Criar a migration**

```sql
-- Avaliação pós-refeição (estrelas + comentário opcional). Dado não
-- sensível (diferente do certificado fiscal/PIN de mesa), então RLS
-- permissiva igual ao resto do schema (allow_all_anon), sem o padrão
-- write-only.
create table if not exists order_ratings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists order_ratings_store_id_idx on order_ratings(store_id, created_at desc);

alter table order_ratings enable row level security;
drop policy if exists "allow_all_anon" on order_ratings;
create policy "allow_all_anon" on order_ratings
  for all to anon, authenticated using (true) with check (true);
```

- [ ] **Step 2: Aplicar a migration**

Run: `node scripts/aplicar-migration.mjs 013_order_ratings.sql`
Expected: `MIGRATION APLICADA.`

- [ ] **Step 3: Tipo `OrderRating`**

Em `types/index.ts`, adicionar (perto de `StoreFiscalCertificateStatus`, fim do arquivo):

```ts
export interface OrderRating {
  id: string;
  order_id: string;
  store_id: string;
  stars: number;
  comment: string | null;
  created_at: string;
}
```

- [ ] **Step 4: Funções em `lib/api.ts`**

Adicionar ao fim de `lib/api.ts`:

```ts
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
```

Adicionar `OrderRating` ao import de tipos já existente no topo de `lib/api.ts` (procurar a linha que importa de `@/types`).

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/013_order_ratings.sql types/index.ts lib/api.ts
git commit -m "feat: cria tabela order_ratings e funcoes de leitura/escrita"
```

---

### Task 8: Tela de avaliação no `OrderTracker` (cliente)

**Files:**
- Modify: `components/modules/ClientModule.tsx`

**Interfaces:**
- Consumes: `createOrderRating(orderId, storeId, stars, comment)` (Task 7), `order.store_id`, `order.table_id` (já existem em `Order`).

- [ ] **Step 1: Importar `Star` e `createOrderRating`**

Trocar:

```tsx
import { ShoppingBag, Search, Clock, Plus, Minus, User, LogIn, Coffee, LayoutGrid, Eye, EyeOff, ArrowUpDown, ArrowDownAZ, ArrowUpNarrowWide, ArrowDownWideNarrow, Bell, BellRing, LogOut, Trash2, Receipt, ChefHat, CheckCircle, AlertTriangle, AlertCircle, Users, Calculator, List, CheckSquare, Square, Lock, Info, PartyPopper, UtensilsCrossed, RefreshCw, X } from 'lucide-react';
```

por:

```tsx
import { ShoppingBag, Search, Clock, Plus, Minus, User, LogIn, Coffee, LayoutGrid, Eye, EyeOff, ArrowUpDown, ArrowDownAZ, ArrowUpNarrowWide, ArrowDownWideNarrow, Bell, BellRing, LogOut, Trash2, Receipt, ChefHat, CheckCircle, AlertTriangle, AlertCircle, Users, Calculator, List, CheckSquare, Square, Lock, Info, PartyPopper, UtensilsCrossed, RefreshCw, X, Star } from 'lucide-react';
```

Trocar:

```tsx
import { fetchMenu, fetchStoreBySlug, createOrder, fetchTablesPublic, openTableSession, fetchTableOrderSummary, callWaiter, requestTableBill, cancelPendingTableItems, fetchOrderById } from '@/lib/api';
```

por:

```tsx
import { fetchMenu, fetchStoreBySlug, createOrder, fetchTablesPublic, openTableSession, fetchTableOrderSummary, callWaiter, requestTableBill, cancelPendingTableItems, fetchOrderById, createOrderRating } from '@/lib/api';
```

- [ ] **Step 2: Estado da avaliação em `OrderTracker`**

Em `components/modules/ClientModule.tsx:56`, logo depois de `const [secondsToRedirect, setSecondsToRedirect] = useState(5);`, adicionar:

```tsx
    const [ratingStars, setRatingStars] = useState(0);
    const [ratingComment, setRatingComment] = useState('');
    const [ratingSent, setRatingSent] = useState(false);
    const [isSendingRating, setIsSendingRating] = useState(false);
```

- [ ] **Step 3: Checar se já avaliou essa sessão de mesa ao carregar**

Em `components/modules/ClientModule.tsx`, dentro do `useEffect` que já existe em `OrderTracker` (linha ~76-113), no `load` async, depois de `setOrder(data);`, adicionar:

```tsx
            if (data) {
                const ratingKey = `rated_table_${data.table_id ?? data.id}`;
                if (localStorage.getItem(ratingKey)) setRatingSent(true);
            }
```

- [ ] **Step 4: Handler de envio**

Adicionar logo antes do `if (!order) return ...` (linha ~191):

```tsx
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
```

- [ ] **Step 5: UI das estrelas na tela "Pedido Finalizado"**

Trocar (linha ~235-245):

```tsx
                {isDelivered ? (
                     <div className="text-center py-10 animate-fade-in">
                         <div className="bg-[var(--ok)]/10 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4 text-[var(--ok)]">
                             <CheckCircle size={48} />
                         </div>
                         <h2 className="text-2xl font-bold text-[var(--text)] mb-2">Pedido Finalizado</h2>
                         <p className="text-[var(--text-muted)] mb-2">Obrigado pela preferência!</p>
                         <p className="text-[var(--brand)] font-bold text-sm bg-[var(--brand)]/8 py-2 px-4 rounded-full inline-block">
                             Reiniciando em {secondsToRedirect}s...
                         </p>
                     </div>
                ) : (
```

por:

```tsx
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
```

- [ ] **Step 6: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos limpos.

- [ ] **Step 7: Teste manual**

Run: `npm run dev`, completar um pedido de teste na Bistrô Demo até "Pedido Finalizado", avaliar com estrelas + comentário, conferir toast de sucesso. Recarregar a tela do mesmo pedido (ou simular novo pedido na mesma mesa) e confirmar que não pede avaliação de novo. Testar "Pular" numa mesa diferente e confirmar que não trava o fluxo.

- [ ] **Step 8: Commit**

```bash
git add components/modules/ClientModule.tsx
git commit -m "feat: adiciona avaliacao pos-refeicao na tela de pedido finalizado"
```

---

### Task 9: Seção "Avaliações" no dashboard do Lojista

**Files:**
- Modify: `components/modules/StoreModule.tsx` (busca as avaliações e repassa)
- Modify: `components/modules/StoreDashboardView.tsx` (exibe)

**Interfaces:**
- Consumes: `fetchOrderRatings(storeId, sinceDate?)` (Task 7).
- Produces: `StoreDashboardView` ganha a prop `ratings: OrderRating[]`.

- [ ] **Step 1: Buscar as avaliações em `StoreAdminView`**

Em `components/modules/StoreModule.tsx`, importar `fetchOrderRatings` e o tipo `OrderRating` (junto dos imports já existentes de `@/lib/api` e `@/types`).

No `StoreAdminView` (onde `loadSales` já busca `fetchSalesHistory`/`fetchTableSessions`, linha ~2751-2757), trocar:

```tsx
    const loadSales = async () => {
        setIsLoading(true);
        const [data, sessions] = await Promise.all([fetchSalesHistory(storeId), fetchTableSessions(storeId)]);
        setSales(data);
        setTableSessions(sessions);
        setIsLoading(false);
    };
```

por:

```tsx
    const [ratings, setRatings] = useState<OrderRating[]>([]);

    const loadSales = async () => {
        setIsLoading(true);
        const [data, sessions, ratingsData] = await Promise.all([fetchSalesHistory(storeId), fetchTableSessions(storeId), fetchOrderRatings(storeId)]);
        setSales(data);
        setTableSessions(sessions);
        setRatings(ratingsData);
        setIsLoading(false);
    };
```

(a declaração de `const [ratings, setRatings] = useState<OrderRating[]>([]);` precisa ficar junto dos outros `useState` do topo de `StoreAdminView`, não literalmente dentro do corpo de `loadSales`; mover pra perto de `const [tableSessions, setTableSessions] = useState<TableSession[]>([]);`).

Passar a prop pro dashboard (linha ~2945):

```tsx
            {activeTab === 'dashboard' && <StoreDashboardView sales={sales} tableSessions={tableSessions} />}
```

por:

```tsx
            {activeTab === 'dashboard' && <StoreDashboardView sales={sales} tableSessions={tableSessions} ratings={ratings} />}
```

- [ ] **Step 2: Exibir no `StoreDashboardView`**

Trocar a assinatura do componente:

```tsx
export const StoreDashboardView: React.FC<{ sales: Order[]; tableSessions: TableSession[] }> = ({ sales, tableSessions }) => {
```

por:

```tsx
export const StoreDashboardView: React.FC<{ sales: Order[]; tableSessions: TableSession[]; ratings: OrderRating[] }> = ({ sales, tableSessions, ratings }) => {
```

Importar `OrderRating`, trocando:

```tsx
import { Order, TableSession } from '@/types';
```

por:

```tsx
import { Order, TableSession, OrderRating } from '@/types';
```

Filtrar as avaliações pelo mesmo período selecionado (logo depois de `previousPeriodStats` da Task 6):

```tsx
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
```

Adicionar a seção "Avaliações" logo depois da seção "Balcão" (linha ~347, antes do `</div></section>` final do bloco "Por Período"):

```tsx
                    {/* Avaliações */}
                    <div>
                        <h3 className="text-lg font-bold text-[var(--text)] mb-3 flex items-center gap-2"><Star size={20} className="text-[var(--warn)]" /> Avaliações</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
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
```

Adicionar `Star` ao import de ícones do topo do arquivo:

```tsx
import { BarChart3, Receipt, CheckCircle, Clock, Users, Coffee, TrendingUp, TrendingDown, Star } from 'lucide-react';
```

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos limpos.

- [ ] **Step 4: Teste manual**

Run: `npm run dev`, depois de enviar uma avaliação de teste (Task 8), abrir o Dashboard da Bistrô Demo e conferir que "Nota Média" e o comentário aparecem na seção "Avaliações".

- [ ] **Step 5: Commit**

```bash
git add components/modules/StoreModule.tsx components/modules/StoreDashboardView.tsx
git commit -m "feat: mostra avaliacoes pos-refeicao no dashboard do lojista"
```

---

### Task 10: Verificação final e push

**Files:** nenhum arquivo novo, só verificação.

- [ ] **Step 1: Build completo**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos limpos, sem warnings novos.

- [ ] **Step 2: Fluxo completo ponta a ponta na Bistrô Demo**

1. Taxa de serviço em 15% (Task 2) refletindo em pedido novo do cliente e no painel do Lojista (Task 3/4).
2. Exportar CSV do Histórico de Vendas e abrir no Excel/Sheets.
3. Comparação vs. período anterior aparecendo nos 3 cards do Dashboard.
4. Avaliação pós-refeição: enviar uma com estrelas + comentário, testar "Pular" em outro pedido, conferir a seção "Avaliações" do Dashboard.

- [ ] **Step 3: Push**

```bash
git push
```
