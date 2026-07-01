# Alerta Ativo no Cliente + Certificado Digital Fiscal — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adicionar (A) alerta ativo (toast + som + vibração) na tela do
cliente quando um item/pedido entra em preparo ou fica pronto, e (B) um
espaço seguro no Master Admin pra cadastrar o certificado digital fiscal de
cada loja (só armazenamento — emissão de NFC-e é trabalho futuro à parte).

**Architecture:** Track A estende o `OrderTracker` existente em
`ClientModule.tsx` (que já escuta Realtime de `order_items`) com diffing
contra um snapshot anterior em `useRef`, disparando toast por item e
som/vibração na transição agregada. Track B adiciona uma migration nova com
bucket de Storage privado + duas tabelas (uma legível pra metadados, uma
write-only — sem policy de SELECT — pra senha do certificado), novas
funções em `lib/api.ts`, e uma seção nova no modal de editar loja do
`AdminModule.tsx`. Design completo aprovado em
`docs/plans/2026-07-01-alerta-cliente-e-certificado-fiscal-design.md`.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Supabase (Postgres +
Storage + Realtime), Web Audio API (sem libs novas).

**Nota sobre "testes" neste plano:** este repo não tem test runner (
`package.json` só tem `lint`/`build`, ver `AGENTS.md`). Não vou introduzir
um framework de testes novo pra isso (fora de escopo do que foi pedido). O
ciclo rápido de verificação de cada task é `npm run build` (type-check +
build do Next) e passos manuais precisos no browser, no padrão que o
próprio `AGENTS.md` já recomenda ("rodar sempre antes de commitar mudança
grande").

---

## Track A — Alerta ativo no cliente

### Task 1: Criar `lib/audioAlert.ts`

**Files:**
- Create: `lib/audioAlert.ts`

**Step 1: Escrever o arquivo**

```ts
// Beep gerado por código via Web Audio API — sem arquivo de áudio.
// Autoplay pode ser bloqueado pelo navegador se nenhuma interação do
// usuário aconteceu ainda; o catch silencioso é intencional — o toast
// visual continua funcionando de qualquer forma.

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

function tone(audioCtx: AudioContext, freq: number, startOffset: number, duration: number) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = freq;
  osc.type = 'sine';
  const t0 = audioCtx.currentTime + startOffset;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export function playPreparingAlert() {
  try {
    const audioCtx = getContext();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    tone(audioCtx, 660, 0, 0.15);
  } catch {
    // autoplay bloqueado ou API indisponível
  }
}

export function playReadyAlert() {
  try {
    const audioCtx = getContext();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    tone(audioCtx, 880, 0, 0.15);
    tone(audioCtx, 1175, 0.18, 0.2);
  } catch {
    // autoplay bloqueado ou API indisponível
  }
}

export function vibrateAlert(pattern: number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate(pattern); } catch {}
  }
}
```

**Step 2: Verificar tipos**

Run: `npm run build`
Expected: build passa sem erro novo relacionado a `lib/audioAlert.ts` (ainda
não é importado em lugar nenhum, então só precisa compilar isoladamente).

**Step 3: Commit**

```bash
git add lib/audioAlert.ts
git commit -m "feat: adiciona utilitario de beep via Web Audio API"
```

---

### Task 2: Diff por item + toast granular no `OrderTracker`

**Files:**
- Modify: `components/modules/ClientModule.tsx:6` (import), `:50-85` (efeito
  de load/Realtime dentro de `OrderTracker`)

**Step 1: Importar o novo utilitário**

Old (`components/modules/ClientModule.tsx:10`):
```ts
import { toast } from '@/components/Toast';
```

New:
```ts
import { toast } from '@/components/Toast';
import { playPreparingAlert, playReadyAlert, vibrateAlert } from '@/lib/audioAlert';
```

**Step 2: Adicionar ref de snapshot e diffar no load inicial e no Realtime**

Old (`components/modules/ClientModule.tsx:50-85`):
```tsx
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
```

New:
```tsx
const OrderTracker: React.FC<{ orderId: string, onReset: () => void, onLogout: () => void }> = ({ orderId, onReset, onLogout }) => {
    const [order, setOrder] = useState<Order | null>(null);
    const [items, setItems] = useState<OrderItem[]>([]);
    const [secondsToRedirect, setSecondsToRedirect] = useState(5);
    // Snapshot do fetch anterior — usado só pra diff, nunca renderizado.
    // null = ainda não carregou nenhuma vez (evita alertar no load inicial).
    const prevItemsRef = useRef<OrderItem[] | null>(null);

    const notifyItemTransitions = (nextItems: OrderItem[]) => {
        const prevById = new Map((prevItemsRef.current || []).map(i => [i.id, i.status]));
        for (const item of nextItems) {
            const prevStatus = prevById.get(item.id);
            if (!prevStatus || prevStatus === item.status) continue;
            const itemName = item.product?.name || 'Item';
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
```

**Step 3: Verificar tipos**

Run: `npm run build`
Expected: build passa sem erro.

**Step 4: Commit**

```bash
git add components/modules/ClientModule.tsx
git commit -m "feat: toast por item quando prato entra em preparo ou fica pronto"
```

---

### Task 3: Som + vibração na transição agregada do pedido

**Files:**
- Modify: `components/modules/ClientModule.tsx` (logo após o `useMemo` de
  `derivedStatus`, hoje em `:88-109`)

**Step 1: Adicionar o efeito de alerta agregado**

Old (`components/modules/ClientModule.tsx:87-109`, dentro de `OrderTracker`,
imediatamente após o fechamento do `useEffect` do Step 2 acima):
```tsx
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
```

New (mesmo bloco + efeito novo logo abaixo):
```tsx
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
```

**Step 2: Verificar tipos**

Run: `npm run build`
Expected: build passa sem erro.

**Step 3: Commit**

```bash
git add components/modules/ClientModule.tsx
git commit -m "feat: som e vibracao quando pedido inteiro entra em preparo ou fica pronto"
```

---

### Task 4: Teste manual do Track A

**Files:** nenhum (só verificação)

**Step 1: Rodar local**

Run: `npm run dev`

**Step 2: Roteiro manual**

1. Abrir `/c/bistro` (loja demo) em uma aba, entrar numa mesa, fazer um
   pedido com 2+ itens.
2. Em outra aba, logar como lojista (`/loja`) na mesma loja e ir na Cozinha/
   Bar — avançar o status de um item por vez (Iniciar Preparo → Marcar
   Pronto).
3. Na aba do cliente (tela de acompanhamento), confirmar:
   - toast aparece a cada item que muda pra "preparando" ou "pronto";
   - ao avançar o **primeiro** item pra preparing, dispara toast + beep +
     (se em celular/Android) vibração de "pedido sendo preparado";
   - quando o **último** item fica ready, dispara toast + beep duplo +
     vibração de "pedido pronto" (mais o banner que já existia antes);
   - recarregar a página no meio do processo **não** dispara nenhum alerta
     sonoro imediatamente (só a baseline é definida).

**Step 3: Se tudo bater, seguir pro Track B**

---

## Track B — Certificado digital fiscal (Master Admin)

### Task 5: Migration `006_fiscal_certificado.sql`

**Files:**
- Create: `supabase/migrations/006_fiscal_certificado.sql`

**Step 1: Escrever a migration**

```sql
-- Espaço pra loja cadastrar o certificado digital fiscal (fase de
-- armazenamento apenas — emissão de NFC-e/SEFAZ é trabalho futuro
-- separado, ver "Backlog / Próximos passos" em AGENTS.md).
--
-- Sem Supabase Auth neste projeto (ver 001_schema_inicial.sql), então
-- "privado" aqui significa: sem NENHUMA policy de SELECT pra anon — dá
-- pra escrever mas não pra ler de volta usando a chave anônima. Mesmo
-- princípio do PIN de mesa em 003_secure_table_pin.sql, generalizado
-- pra um segredo de verdade (senha do certificado + o próprio .pfx).

-- ─── Bucket privado do certificado ────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('store-certificates', 'store-certificates', false)
on conflict (id) do nothing;

drop policy if exists "cert_upload_anon" on storage.objects;
create policy "cert_upload_anon" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'store-certificates');

drop policy if exists "cert_update_anon" on storage.objects;
create policy "cert_update_anon" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'store-certificates')
  with check (bucket_id = 'store-certificates');

-- Sem policy de select/delete pra este bucket: upload feito às cegas,
-- ninguém baixa o .pfx de volta usando a anon key.

-- ─── Metadados legíveis (não é sigiloso, a UI do admin precisa listar) ────────
create table if not exists store_fiscal_certificates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references stores(id) on delete cascade,
  file_path text not null,
  original_filename text not null,
  uploaded_at timestamptz not null default now(),
  expires_at date,
  created_at timestamptz not null default now()
);

alter table store_fiscal_certificates enable row level security;
drop policy if exists "allow_all_anon" on store_fiscal_certificates;
create policy "allow_all_anon" on store_fiscal_certificates
  for all to anon, authenticated using (true) with check (true);

-- ─── Senha do certificado — write-only de verdade ─────────────────────────────
create table if not exists store_fiscal_certificate_secrets (
  store_id uuid primary key references stores(id) on delete cascade,
  password text not null,
  updated_at timestamptz not null default now()
);

alter table store_fiscal_certificate_secrets enable row level security;

drop policy if exists "cert_secret_insert_anon" on store_fiscal_certificate_secrets;
create policy "cert_secret_insert_anon" on store_fiscal_certificate_secrets
  for insert to anon, authenticated with check (true);

drop policy if exists "cert_secret_update_anon" on store_fiscal_certificate_secrets;
create policy "cert_secret_update_anon" on store_fiscal_certificate_secrets
  for update to anon, authenticated using (true) with check (true);

-- Sem policy de select: RLS nega por padrão pra quem só tem a anon key.
-- Só um processo futuro com service role (quando a emissão de NFC-e for
-- implementada) vai conseguir ler essa senha de volta.
```

**Step 2: Aplicar a migration**

Run: `node scripts/aplicar-migration.mjs 006_fiscal_certificado.sql`
Expected: `MIGRATION APLICADA.` no output (o script varre os poolers até
achar um que conecte — ver comentário no topo do próprio script).

**Step 3: Commit**

```bash
git add supabase/migrations/006_fiscal_certificado.sql
git commit -m "feat: bucket privado e tabelas write-only pro certificado digital fiscal"
```

---

### Task 6: Tipos e funções em `lib/api.ts`

**Files:**
- Modify: `types/index.ts` (nova interface)
- Modify: `lib/api.ts` (novas funções, perto de `uploadStoreLogo`/`createStore`,
  hoje em `:737-750`)

**Step 1: Adicionar tipo em `types/index.ts`**

Adicionar ao final do arquivo:
```ts
export interface StoreFiscalCertificateStatus {
  original_filename: string;
  uploaded_at: string;
  expires_at: string | null;
}
```

**Step 2: Adicionar funções em `lib/api.ts`**

Old (`lib/api.ts:737-738`):
```ts
export const uploadStoreLogo = async (file: File): Promise<string> => uploadToCloudinary(file);
export const uploadProductImage = async (file: File): Promise<string> => uploadToCloudinary(file);
```

New:
```ts
export const uploadStoreLogo = async (file: File): Promise<string> => uploadToCloudinary(file);
export const uploadProductImage = async (file: File): Promise<string> => uploadToCloudinary(file);

// Certificado digital fiscal: NÃO usa Cloudinary (é público/sem controle de
// acesso). Vai pro bucket privado `store-certificates` — ver
// supabase/migrations/006_fiscal_certificado.sql pro porquê.
const CERT_BUCKET = 'store-certificates';

export const uploadStoreCertificate = async (storeId: string, file: File): Promise<{ success: boolean; message?: string }> => {
  const path = `${storeId}/certificado.pfx`;
  const { error } = await supabase.storage.from(CERT_BUCKET).upload(path, file, { upsert: true });
  if (error) return { success: false, message: error.message };
  return { success: true };
};

export const saveStoreCertificateMetadata = async (storeId: string, originalFilename: string, expiresAt: string | null): Promise<{ success: boolean; message?: string }> => {
  const { error } = await supabase.from('store_fiscal_certificates').upsert({
    store_id: storeId,
    file_path: `${storeId}/certificado.pfx`,
    original_filename: originalFilename,
    uploaded_at: new Date().toISOString(),
    expires_at: expiresAt,
  }, { onConflict: 'store_id' });
  if (error) return { success: false, message: error.message };
  return { success: true };
};

export const saveStoreCertificateSecret = async (storeId: string, password: string): Promise<{ success: boolean; message?: string }> => {
  // SEM .select() de propósito: a tabela não tem policy de SELECT pra anon
  // (write-only, ver a migration). supabase-js só pede a linha de volta
  // (Prefer: return=representation) quando .select() é encadeado — sem
  // isso, o upsert funciona como INSERT/UPDATE puro mesmo sem permissão
  // de leitura nenhuma.
  const { error } = await supabase.from('store_fiscal_certificate_secrets').upsert({
    store_id: storeId,
    password,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'store_id' });
  if (error) return { success: false, message: error.message };
  return { success: true };
};

export const fetchStoreCertificateStatus = async (storeId: string): Promise<StoreFiscalCertificateStatus | null> => {
  const { data, error } = await supabase
    .from('store_fiscal_certificates')
    .select('original_filename, uploaded_at, expires_at')
    .eq('store_id', storeId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
};
```

Conferir que `StoreFiscalCertificateStatus` está importado de `@/types` no
topo de `lib/api.ts` (adicionar ao import existente de tipos, se houver, ou
usar `import type` dedicado).

**Step 3: Verificar tipos**

Run: `npm run build`
Expected: build passa sem erro.

**Step 4: Commit**

```bash
git add types/index.ts lib/api.ts
git commit -m "feat: funcoes de upload e leitura do certificado digital fiscal"
```

---

### Task 7: UI no modal de editar loja (`AdminModule.tsx`)

**Files:**
- Modify: `components/modules/AdminModule.tsx` (imports `:4,6`; state
  `:159-171`; `handleEditStore` `:234-251`; `resetForm` `:209-221`; novo
  `handleSaveCertificate`; JSX do modal `:664-683`)

**Step 1: Imports**

Old (`components/modules/AdminModule.tsx:4-6`):
```tsx
import { Store as StoreIcon, Users, Plus, Save, Calendar, CheckCircle, XCircle, AlertCircle, LayoutGrid, Coffee, Lock, User, RefreshCw, Trash2, Edit2, Upload, Image, Copy, ArrowRight } from 'lucide-react';
import { Button, Card, Input, Modal, Badge } from '@/components/ui';
import { createStore, updateStore, deleteStore, duplicateStore, authenticateAdmin, updateAdminPassword, fetchAllStores, fetchTables, createStoreUser, updateStoreUser, deleteStoreUser, fetchStoreUsers, uploadStoreLogo } from '@/lib/api';
```

New:
```tsx
import { Store as StoreIcon, Users, Plus, Save, Calendar, CheckCircle, XCircle, AlertCircle, LayoutGrid, Coffee, Lock, User, RefreshCw, Trash2, Edit2, Upload, Image, Copy, ArrowRight } from 'lucide-react';
import { Button, Card, Input, Modal, Badge } from '@/components/ui';
import { createStore, updateStore, deleteStore, duplicateStore, authenticateAdmin, updateAdminPassword, fetchAllStores, fetchTables, createStoreUser, updateStoreUser, deleteStoreUser, fetchStoreUsers, uploadStoreLogo, uploadStoreCertificate, saveStoreCertificateMetadata, saveStoreCertificateSecret, fetchStoreCertificateStatus } from '@/lib/api';
import { differenceInDays, format, parseISO } from 'date-fns';
```

**Step 2: State novo**

Old (`components/modules/AdminModule.tsx:169-171`):
```tsx
  // Logo Upload State
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
```

New:
```tsx
  // Logo Upload State
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  // Certificado Digital Fiscal State
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certPassword, setCertPassword] = useState('');
  const [certExpiresAt, setCertExpiresAt] = useState('');
  const [certStatus, setCertStatus] = useState<StoreFiscalCertificateStatus | null>(null);
  const [isSavingCert, setIsSavingCert] = useState(false);
```

Adicionar `StoreFiscalCertificateStatus` ao import de tipos existente no
topo do arquivo (`import { Store, StoreUser } from '@/types';` vira
`import { Store, StoreUser, StoreFiscalCertificateStatus } from '@/types';`).

**Step 3: Buscar status do certificado ao abrir "Editar Loja"**

Old (`components/modules/AdminModule.tsx:234-251`):
```tsx
  const handleEditStore = async (store: Store) => {
      setEditingId(store.id);
      setName(store.name);
      setCnpj(store.cnpj || '');
      setSlug(store.slug);
      setContractType(store.contract_type);

      // Fetch current tables to set correct count
      const tables = await fetchTables(store.id);
      setTableCount(tables.length || 0);

      setPeriodMonths(store.contract_period_months || 12);
      setIsActive(store.is_active);
      setLogoPreview(store.logo_url);
      setLogoFile(null);
      setErrorMsg(null);
      setIsModalOpen(true);
  };
```

New:
```tsx
  const handleEditStore = async (store: Store) => {
      setEditingId(store.id);
      setName(store.name);
      setCnpj(store.cnpj || '');
      setSlug(store.slug);
      setContractType(store.contract_type);

      // Fetch current tables to set correct count
      const tables = await fetchTables(store.id);
      setTableCount(tables.length || 0);

      setPeriodMonths(store.contract_period_months || 12);
      setIsActive(store.is_active);
      setLogoPreview(store.logo_url);
      setLogoFile(null);
      setErrorMsg(null);

      setCertFile(null);
      setCertPassword('');
      setCertExpiresAt('');
      setCertStatus(await fetchStoreCertificateStatus(store.id));

      setIsModalOpen(true);
  };
```

**Step 4: Limpar estado do certificado ao abrir "Nova Loja"**

Old (`components/modules/AdminModule.tsx:209-221`):
```tsx
  const resetForm = () => {
      setEditingId(null);
      setName('');
      setCnpj('');
      setSlug('');
      setContractType('balcao');
      setTableCount(10);
      setPeriodMonths(12);
      setIsActive(true);
      setLogoFile(null);
      setLogoPreview(null);
      setErrorMsg(null);
  };
```

New:
```tsx
  const resetForm = () => {
      setEditingId(null);
      setName('');
      setCnpj('');
      setSlug('');
      setContractType('balcao');
      setTableCount(10);
      setPeriodMonths(12);
      setIsActive(true);
      setLogoFile(null);
      setLogoPreview(null);
      setErrorMsg(null);

      setCertFile(null);
      setCertPassword('');
      setCertExpiresAt('');
      setCertStatus(null);
  };
```

**Step 5: Handler de salvar certificado (ação independente do form da loja)**

Adicionar logo após `handleFileChange` (`components/modules/AdminModule.tsx:280-286`):
```tsx
  const handleCertFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) setCertFile(file);
  };

  const handleSaveCertificate = async () => {
      if (!editingId) return; // só disponível editando loja existente
      if (!certFile && !certPassword && !certExpiresAt) {
          return toast.error('Escolha um arquivo, senha ou validade pra salvar.');
      }
      setIsSavingCert(true);
      try {
          if (certFile) {
              const uploadResult = await uploadStoreCertificate(editingId, certFile);
              if (!uploadResult.success) throw new Error(uploadResult.message);

              const metaResult = await saveStoreCertificateMetadata(editingId, certFile.name, certExpiresAt || null);
              if (!metaResult.success) throw new Error(metaResult.message);
          } else if (certExpiresAt) {
              // Só atualizando a validade, sem trocar o arquivo
              const metaResult = await saveStoreCertificateMetadata(editingId, certStatus?.original_filename || 'certificado.pfx', certExpiresAt);
              if (!metaResult.success) throw new Error(metaResult.message);
          }

          if (certPassword) {
              const secretResult = await saveStoreCertificateSecret(editingId, certPassword);
              if (!secretResult.success) throw new Error(secretResult.message);
          }

          toast.success('Certificado atualizado com sucesso!');
          setCertFile(null);
          setCertPassword('');
          setCertStatus(await fetchStoreCertificateStatus(editingId));
      } catch (e: any) {
          toast.error('Erro ao salvar certificado: ' + e.message);
      } finally {
          setIsSavingCert(false);
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
```

**Step 6: Seção nova no JSX do modal**

Old (`components/modules/AdminModule.tsx:697-699`, logo depois do bloco de
Slug e antes do `<hr>` que separa a seção de contrato):
```tsx
                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-[var(--text)]">Link de Acesso (Slug)</label>
                    <div className="flex items-center group">
                        <span className="bg-[var(--surface-2)] border border-r-0 border-[var(--border)] rounded-l-lg px-3 py-2 text-sm text-[var(--text-muted)]">site.com/c/</span>
                        <input className="w-full rounded-r-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-[var(--brand)]/30 outline-none" placeholder="minha-loja" value={slug} onChange={e => setSlug(generateSlug(e.target.value))} />
                    </div>
                </div>
              </div>
              <hr className="border-[var(--border)]" />
```

New:
```tsx
                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-[var(--text)]">Link de Acesso (Slug)</label>
                    <div className="flex items-center group">
                        <span className="bg-[var(--surface-2)] border border-r-0 border-[var(--border)] rounded-l-lg px-3 py-2 text-sm text-[var(--text-muted)]">site.com/c/</span>
                        <input className="w-full rounded-r-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-[var(--brand)]/30 outline-none" placeholder="minha-loja" value={slug} onChange={e => setSlug(generateSlug(e.target.value))} />
                    </div>
                </div>
              </div>
              <hr className="border-[var(--border)]" />

              {editingId && (
                  <>
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
                      <hr className="border-[var(--border)]" />
                  </>
              )}
```

**Step 7: Verificar tipos e build**

Run: `npm run build`
Expected: build passa sem erro.

**Step 8: Commit**

```bash
git add components/modules/AdminModule.tsx
git commit -m "feat: secao de certificado digital fiscal no modal de editar loja"
```

---

### Task 8: Teste manual do Track B

**Files:** nenhum (só verificação)

**Step 1: Rodar local**

Run: `npm run dev`

**Step 2: Roteiro manual**

1. Logar em `/painel` (Master Admin), editar a loja demo ("Bistrô Demo" ou
   "Japanese").
2. Confirmar que a seção "Certificado Digital (fiscal)" só aparece
   editando (não em "Adicionar Nova Loja").
3. Badge deve mostrar "Nenhum certificado cadastrado" na primeira vez.
4. Escolher qualquer arquivo pequeno (pode ser um `.txt` renomeado pra
   `.pfx` só pra testar o upload — não precisa ser um certificado real
   nesta fase), preencher validade e senha, clicar "Salvar Certificado".
5. Toast de sucesso deve aparecer; reabrir o modal de editar a mesma loja
   e confirmar que o badge agora mostra "Válido até ..." com a cor certa.
6. Confirmar que o campo de senha volta vazio ao reabrir (não deve nunca
   vir pré-preenchido — é write-only por design).
7. No Supabase Studio (ou via `node scripts/db.mjs "select * from
   store_fiscal_certificate_secrets"`), confirmar que a linha existe mas
   que **não é possível lê-la usando a anon key** — só com a connection
   string direta (que usa o usuário postgres, não a policy anon).

**Step 3: Se tudo bater, atualizar o AGENTS.md (Task 9)**

---

### Task 9: Atualizar `AGENTS.md`

**Files:**
- Modify: `AGENTS.md` (seção "Backlog / Próximos passos", adicionada em
  commit anterior)

**Step 1: Mover as duas entradas do backlog pra refletir o que foi feito**

Substituir a seção "Backlog / Próximos passos" atual (que descreve as duas
features como não implementadas) por uma versão que documenta o que
existe agora e o que ainda falta:

- Alerta ativo: **implementado** (toast por item + som/vibração agregado,
  ver `lib/audioAlert.ts` e `OrderTracker` em `ClientModule.tsx`). Falta:
  Web Push pra alertar com app fechado/tela bloqueada (fora de escopo,
  seguiria exigindo Service Worker + backend de push).
- Certificado digital: **espaço de armazenamento implementado** (bucket
  privado `store-certificates` + `store_fiscal_certificates` +
  `store_fiscal_certificate_secrets`, ver
  `supabase/migrations/006_fiscal_certificado.sql`). Falta: emissão de
  NFC-e de verdade (integração com SEFAZ ou intermediário tipo Focus
  NFe/eNotas) — isso vai precisar de um processo com service role pra
  ler o certificado/senha de volta, já que a anon key não consegue.

**Step 2: Documentar o padrão write-only como convenção do projeto**

Adicionar uma frase na seção "Decisões de arquitetura" (perto do parágrafo
existente sobre o PIN de mesa) generalizando o padrão: tabelas/buckets sem
nenhuma policy de SELECT pra anon são o jeito padrão deste projeto de
guardar credenciais sensíveis sem precisar de backend/Auth.

**Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: atualiza AGENTS.md com o que foi implementado e o padrao write-only"
```

---

## Resumo de arquivos tocados

- `lib/audioAlert.ts` (novo)
- `components/modules/ClientModule.tsx`
- `supabase/migrations/006_fiscal_certificado.sql` (novo)
- `types/index.ts`
- `lib/api.ts`
- `components/modules/AdminModule.tsx`
- `AGENTS.md`
