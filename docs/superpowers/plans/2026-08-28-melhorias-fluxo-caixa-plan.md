# Melhorias no fluxo de Caixa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduzir perda/erro de dinheiro, aumentar visibilidade gerencial, reduzir fricção e ligar (levemente) ponto e caixa, no fluxo de "Caixa" do NTB Vendas.

**Architecture:** Evolução incremental de `cash_shifts`/`cash_movements`/`operator_checkins` (já existentes) — sem reconstrução do fluxo. Uma migration só com todo o SQL novo; camada `lib/api.ts` espelhando as RPCs; UI em `CaixaView`/`UserManagementView`/`MenuManagementView`/`StoreLayout` (todos dentro de `components/modules/StoreModule.tsx`, que não tem componentes em arquivos separados pra essas views).

**Tech Stack:** Next.js 16, Supabase self-hosted (Postgres + PostgREST), TypeScript, Tailwind v4 — mesmo stack do resto do projeto, nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-08-28-melhorias-fluxo-caixa-design.md`

## Global Constraints

- Toda função `security definer` nova/alterada: `set search_path = public`, grant explícito pra `anon, authenticated`, `NOTIFY pgrst, 'reload schema'` depois de aplicar a migration (achado real 2026-08-27 — PostgREST cacheia schema, erro `PGRST202` sem isso).
- Qualquer RPC que ganhar parâmetro novo no fim, mesmo com `default`, precisa de `DROP FUNCTION IF EXISTS` antes do `CREATE` — `CREATE OR REPLACE` com lista de parâmetros diferente cria overload novo, não substitui (lição documentada 2x neste projeto — migrations 052 e 062).
- Nenhuma trava de fechamento é permanente: sem `stores.config` configurado, tolerância usa defaults (aviso R$5, máximo R$20) — nunca bloqueia por acidente numa loja que nunca configurou nada.
- Migrations são aplicadas manualmente via SSH: `cat migration.sql | ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas"` (não há `SUPABASE_DB_URL` local pro banco de produção real, de propósito).
- Deploy: `git push origin main` seguido de `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"` — sempre depois de testar localmente (`npm run dev` contra o banco de produção real, já que não há banco de dev separado).
- `npm run build` (tsc + Next build) precisa passar limpo antes de cada commit que mexe em `.ts`/`.tsx`.

---

### Task 1: Migration — schema e RPCs

**Files:**
- Create: `supabase/migrations/063_melhorias_caixa.sql`

**Interfaces:**
- Produces (usado pelas Tasks 2-7): tabela `cash_shift_audit_events`; colunas novas `cash_shifts.closing_cash_breakdown`/`cash_shifts.approved_by_user_id`; RPCs `cancel_order_item_secure(p_item_id uuid, p_operator_user_id uuid default null, p_operator_name text default null)`, `register_cash_movement_secure(p_shift_id uuid, p_type text, p_amount numeric, p_reason text, p_operator_name text default null, p_alert_threshold numeric default null)`, `close_cash_shift_secure(p_shift_id uuid, p_closing_counted_cash numeric, p_closing_cash_breakdown jsonb default null, p_max_tolerance numeric default null, p_approved_by_user_id uuid default null)`, `verify_cash_supervisor_secure(p_store_id uuid, p_email text, p_password text)`, `fetch_cash_shift_audit_secure(p_store_id uuid, p_shift_id uuid default null, p_operator_user_id uuid default null, p_limit int default 50)`.

- [ ] **Step 1: Escrever a migration completa**

```sql
-- Melhorias no fluxo de Caixa (2026-08-28) — ver
-- docs/superpowers/specs/2026-08-28-melhorias-fluxo-caixa-design.md pro
-- design completo. Contagem cega, breakdown por cédula/moeda, tolerância
-- em 2 níveis com aprovação de supervisor, e trilha de auditoria
-- (cancelamento de item + sangria grande) por operador.

alter table cash_shifts add column if not exists closing_cash_breakdown jsonb;
alter table cash_shifts add column if not exists approved_by_user_id uuid references store_users(id) on delete set null;

create table if not exists cash_shift_audit_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  shift_id uuid references cash_shifts(id) on delete set null,
  operator_user_id uuid references store_users(id) on delete set null,
  operator_name text not null,
  event_type text not null check (event_type in ('item_cancelado', 'sangria_grande')),
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_cash_shift_audit_store on cash_shift_audit_events(store_id, created_at desc);
create index if not exists idx_cash_shift_audit_operator on cash_shift_audit_events(operator_user_id, created_at desc);
create index if not exists idx_cash_shift_audit_shift on cash_shift_audit_events(shift_id);

alter table cash_shift_audit_events enable row level security;
create policy cash_shift_audit_deny_all on cash_shift_audit_events for select using (false);

-- cancel_order_item_secure (migration 021, assinatura hoje (p_item_id uuid))
-- ganha p_operator_user_id/p_operator_name pra registrar quem cancelou.
-- DROP explícito: parâmetro novo no fim, mesmo com default, cria overload
-- em vez de substituir.
drop function if exists public.cancel_order_item_secure(uuid);
create function public.cancel_order_item_secure(
  p_item_id uuid,
  p_operator_user_id uuid default null,
  p_operator_name text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid;
  v_product_name text;
begin
  update order_items set status = 'canceled' where id = p_item_id
  returning store_id into v_store_id;

  if v_store_id is not null and p_operator_name is not null then
    select p.name into v_product_name from order_items oi
      left join products p on p.id = oi.product_id
      where oi.id = p_item_id;
    insert into cash_shift_audit_events (store_id, operator_user_id, operator_name, event_type, details)
    values (v_store_id, p_operator_user_id, p_operator_name, 'item_cancelado', jsonb_build_object('produto', coalesce(v_product_name, 'Produto indisponível')));
  end if;
end;
$$;
grant execute on function public.cancel_order_item_secure(uuid, uuid, text) to anon, authenticated;

-- register_cash_movement_secure (migration 051) ganha p_operator_name e
-- p_alert_threshold — mesmo cuidado de DROP FUNCTION IF EXISTS.
drop function if exists public.register_cash_movement_secure(uuid, text, numeric, text);
create function public.register_cash_movement_secure(
  p_shift_id uuid,
  p_type text,
  p_amount numeric,
  p_reason text,
  p_operator_name text default null,
  p_alert_threshold numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shift cash_shifts%rowtype;
  v_id uuid;
begin
  if p_type not in ('sangria', 'suprimento') then
    return jsonb_build_object('success', false, 'message', 'Tipo de movimentação inválido.');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'message', 'Valor deve ser maior que zero.');
  end if;

  select * into v_shift from cash_shifts where id = p_shift_id;
  if not found or v_shift.status <> 'open' then
    return jsonb_build_object('success', false, 'message', 'Turno não está aberto.');
  end if;

  insert into cash_movements (shift_id, type, amount, reason)
  values (p_shift_id, p_type, p_amount, p_reason)
  returning id into v_id;

  if p_type = 'sangria' and p_operator_name is not null and p_alert_threshold is not null and p_amount >= p_alert_threshold then
    insert into cash_shift_audit_events (store_id, shift_id, operator_user_id, operator_name, event_type, details)
    values (v_shift.store_id, p_shift_id, v_shift.operator_user_id, p_operator_name, 'sangria_grande', jsonb_build_object('valor', p_amount, 'motivo', p_reason));
  end if;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;
grant execute on function public.register_cash_movement_secure(uuid, text, numeric, text, text, numeric) to anon, authenticated;

-- close_cash_shift_secure (migration 051) ganha breakdown, tolerância
-- máxima e aprovação de supervisor. Assinatura hoje: (p_shift_id uuid,
-- p_closing_counted_cash numeric).
drop function if exists public.close_cash_shift_secure(uuid, numeric);
create function public.close_cash_shift_secure(
  p_shift_id uuid,
  p_closing_counted_cash numeric,
  p_closing_cash_breakdown jsonb default null,
  p_max_tolerance numeric default null,
  p_approved_by_user_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shift cash_shifts%rowtype;
  v_expected numeric;
  v_difference numeric;
  v_approver store_users%rowtype;
begin
  select * into v_shift from cash_shifts where id = p_shift_id;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Turno não encontrado.');
  end if;
  if v_shift.status = 'closed' then
    return jsonb_build_object('success', false, 'message', 'Este turno já está fechado.');
  end if;

  v_expected := public._cash_shift_expected_cash(p_shift_id);
  v_difference := p_closing_counted_cash - v_expected;

  if p_max_tolerance is not null and abs(v_difference) > p_max_tolerance then
    if p_approved_by_user_id is null then
      return jsonb_build_object('success', false, 'requires_approval', true, 'message', 'Diferença acima do limite — precisa de aprovação de um supervisor.');
    end if;
    select * into v_approver from store_users where id = p_approved_by_user_id;
    if not found or not (v_approver.role in ('owner', 'universal') or (v_approver.permissions->>'supervisiona_caixa')::boolean is true) then
      return jsonb_build_object('success', false, 'message', 'Usuário informado não tem permissão de supervisor.');
    end if;
  end if;

  update cash_shifts set
    closing_counted_cash = p_closing_counted_cash,
    closing_cash_breakdown = p_closing_cash_breakdown,
    approved_by_user_id = p_approved_by_user_id,
    closed_at = now(),
    status = 'closed'
  where id = p_shift_id;

  return jsonb_build_object(
    'success', true,
    'expected_cash', v_expected,
    'closing_counted_cash', p_closing_counted_cash,
    'difference', v_difference
  );
end;
$$;
grant execute on function public.close_cash_shift_secure(uuid, numeric, jsonb, numeric, uuid) to anon, authenticated;

-- verify_cash_supervisor_secure — mesmo padrão inline de rate-limit de
-- authenticate_store_user_secure (migration 008), mesma coluna
-- login_attempts/login_locked_until (é a mesma credencial de login).
create or replace function public.verify_cash_supervisor_secure(p_store_id uuid, p_email text, p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user store_users%rowtype;
begin
  select * into v_user from store_users where store_id = p_store_id and email = p_email;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Credenciais inválidas.');
  end if;
  if v_user.login_locked_until is not null and v_user.login_locked_until > now() then
    return jsonb_build_object('success', false, 'message', 'Muitas tentativas. Aguarde alguns minutos.');
  end if;
  if v_user.password <> p_password then
    update store_users set
      login_attempts = login_attempts + 1,
      login_locked_until = case when login_attempts + 1 >= 5 then now() + interval '5 minutes' else login_locked_until end
    where id = v_user.id;
    return jsonb_build_object('success', false, 'message', 'Credenciais inválidas.');
  end if;
  if not (v_user.role in ('owner', 'universal') or (v_user.permissions->>'supervisiona_caixa')::boolean is true) then
    return jsonb_build_object('success', false, 'message', 'Este usuário não tem permissão de supervisor de caixa.');
  end if;
  update store_users set login_attempts = 0, login_locked_until = null where id = v_user.id;
  return jsonb_build_object('success', true, 'user_id', v_user.id, 'name', v_user.name);
end;
$$;
grant execute on function public.verify_cash_supervisor_secure(uuid, text, text) to anon, authenticated;

-- fetch_cash_shift_audit_secure — p_shift_id filtra "eventos deste turno",
-- p_operator_user_id (sem p_shift_id) filtra "eventos deste operador no
-- período". Os dois são independentes e opcionais.
create or replace function public.fetch_cash_shift_audit_secure(
  p_store_id uuid,
  p_shift_id uuid default null,
  p_operator_user_id uuid default null,
  p_limit int default 50
) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(e) order by e.created_at desc), '[]'::jsonb)
  from (
    select * from cash_shift_audit_events
    where store_id = p_store_id
      and (p_shift_id is null or shift_id = p_shift_id)
      and (p_operator_user_id is null or operator_user_id = p_operator_user_id)
    order by created_at desc
    limit p_limit
  ) e;
$$;
grant execute on function public.fetch_cash_shift_audit_secure(uuid, uuid, uuid, int) to anon, authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Aplicar a migration em produção**

```bash
cat supabase/migrations/063_melhorias_caixa.sql | ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas"
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker restart rest-vendas"
```
Expected: cada `CREATE`/`ALTER`/`DROP FUNCTION`/`GRANT` sem erro. `docker restart rest-vendas` garante que o PostgREST realmente pegou as assinaturas novas (achado real: `NOTIFY` sozinho às vezes não basta).

- [ ] **Step 3: Testar as RPCs direto via SQL (loja ZZ Laboratorio, id `f33b4310-ff0a-487c-a3b1-62acd0a58850`)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas" <<'EOF'
-- abre um turno de teste
select open_cash_shift_secure('f33b4310-ff0a-487c-a3b1-62acd0a58850', 'dac99663-9ac1-43c2-9a54-84e43c31f038', 100);

-- sangria pequena (não deve gerar evento) e grande (deve gerar)
select register_cash_movement_secure(
  (select id from cash_shifts where store_id='f33b4310-ff0a-487c-a3b1-62acd0a58850' and status='open'),
  'sangria', 10, 'teste pequena', 'QA Caixa', 200
);
select register_cash_movement_secure(
  (select id from cash_shifts where store_id='f33b4310-ff0a-487c-a3b1-62acd0a58850' and status='open'),
  'sangria', 300, 'teste grande', 'QA Caixa', 200
);
select event_type, details from cash_shift_audit_events where store_id='f33b4310-ff0a-487c-a3b1-62acd0a58850';

-- fechamento com diferença acima do máximo, sem aprovação (deve recusar)
select close_cash_shift_secure(
  (select id from cash_shifts where store_id='f33b4310-ff0a-487c-a3b1-62acd0a58850' and status='open'),
  1000, null, 20, null
);

-- verify_cash_supervisor com senha errada (deve recusar) e certa (deve aceitar, QA Caixa é owner)
select verify_cash_supervisor_secure('f33b4310-ff0a-487c-a3b1-62acd0a58850', 'qa-caixa-task4@zz-laboratorio.test', 'senha-errada');
select verify_cash_supervisor_secure('f33b4310-ff0a-487c-a3b1-62acd0a58850', 'qa-caixa-task4@zz-laboratorio.test', 'TesteImpressao2026!');

-- fechamento com o approved_by_user_id do owner (deve aceitar)
select close_cash_shift_secure(
  (select id from cash_shifts where store_id='f33b4310-ff0a-487c-a3b1-62acd0a58850' and status='open'),
  1000, '{"200": 5}'::jsonb, 20, 'dac99663-9ac1-43c2-9a54-84e43c31f038'
);
EOF
```
Expected: sangria de 300 gera 1 linha em `cash_shift_audit_events` (a de 10 não); o primeiro `close_cash_shift_secure` devolve `{"success":false,"requires_approval":true,...}`; senha errada no `verify_cash_supervisor_secure` recusa, senha certa aceita (ajustar a senha real do QA Caixa se tiver sido trocada); o segundo `close_cash_shift_secure` fecha com sucesso e grava `approved_by_user_id`.

- [ ] **Step 4: Limpar dado de teste**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -c \"delete from cash_shift_audit_events where store_id='f33b4310-ff0a-487c-a3b1-62acd0a58850'; delete from cash_movements where shift_id in (select id from cash_shifts where store_id='f33b4310-ff0a-487c-a3b1-62acd0a58850'); delete from cash_shifts where store_id='f33b4310-ff0a-487c-a3b1-62acd0a58850';\""
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/063_melhorias_caixa.sql
git commit -m "feat(caixa): migration de auditoria, tolerância e aprovação de supervisor"
```

---

### Task 2: Camada `lib/api.ts` — tipos e funções

**Files:**
- Modify: `lib/api.ts:1092-1108` (`CashShift` interface, `fetchOpenCashShift`)
- Modify: `lib/api.ts:1025-1027` (`cancelSpecificOrderItem`)
- Modify: `lib/api.ts:1160-1175` (`registerCashMovement`)
- Modify: `lib/api.ts:1228-1240` (`closeCashShift`)
- Modify: `types/index.ts:83-90` (`StoreUserPermissions`)

**Interfaces:**
- Consumes: RPCs da Task 1 (`cancel_order_item_secure`, `register_cash_movement_secure`, `close_cash_shift_secure`, `verify_cash_supervisor_secure`, `fetch_cash_shift_audit_secure`).
- Produces (usado pelas Tasks 3-8): `CashShiftAuditEvent` interface; `cancelSpecificOrderItem(itemId, operatorUserId?, operatorName?)`; `registerCashMovement(shiftId, type, amount, reason, operatorName?, alertThreshold?)`; `closeCashShift(shiftId, closingCountedCash, closingCashBreakdown?, maxTolerance?, approvedByUserId?)` retornando `{success, requires_approval?, expected_cash?, closing_counted_cash?, difference?, message?}`; `verifyCashSupervisor(storeId, email, password)`; `fetchCashShiftAudit(storeId, shiftId?, operatorUserId?, limit?)`; `StoreUserPermissions.supervisiona_caixa?: boolean`.

- [ ] **Step 1: Atualizar `StoreUserPermissions` (`types/index.ts:83-90`)**

```ts
export interface StoreUserPermissions {
  tables: boolean;
  counter: boolean;
  kitchen: boolean;
  bar: boolean;
  menu: boolean;
  admin: boolean;
  caixa?: boolean;
  // Melhorias no fluxo de Caixa (2026-08-28): vê o valor esperado no
  // fechamento mesmo com contagem cega ligada, e aprova fechamentos com
  // diferença acima da tolerância máxima. Ausência = false (mesmo padrão
  // estrito de `caixa`, nunca o fallback permissivo das 6 chaves antigas).
  supervisiona_caixa?: boolean;
}
```

- [ ] **Step 2: Atualizar `CashShift` e `fetchOpenCashShift`/`fetchOpenCashShifts` (`lib/api.ts:1092-1108`)**

```ts
export interface CashShift {
  id: string;
  store_id: string;
  operator_user_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  closing_counted_cash: number | null;
  closing_cash_breakdown: Record<string, number> | null;
  approved_by_user_id: string | null;
  status: 'open' | 'closed';
  notes: string | null;
}
```
(Só adiciona os 2 campos novos ao interface já existente — o resto da função `fetchOpenCashShift` não muda.)

- [ ] **Step 3: Atualizar `cancelSpecificOrderItem` (`lib/api.ts:1025-1027`)**

```ts
export const cancelSpecificOrderItem = async (itemId: string, operatorUserId?: string | null, operatorName?: string) => {
  await supabase.rpc('cancel_order_item_secure', {
    p_item_id: itemId,
    p_operator_user_id: operatorUserId ?? null,
    p_operator_name: operatorName ?? null,
  });
};
```

- [ ] **Step 4: Atualizar `registerCashMovement` (`lib/api.ts:1160-1175`)**

```ts
export const registerCashMovement = async (
  shiftId: string,
  type: 'sangria' | 'suprimento',
  amount: number,
  reason: string,
  operatorName?: string,
  alertThreshold?: number,
): Promise<{ success: boolean; id?: string; message?: string }> => {
  const { data, error } = await supabase.rpc('register_cash_movement_secure', {
    p_shift_id: shiftId,
    p_type: type,
    p_amount: amount,
    p_reason: reason,
    p_operator_name: operatorName ?? null,
    p_alert_threshold: alertThreshold ?? null,
  });
  if (error) return { success: false, message: error.message };
  return data as { success: boolean; id?: string; message?: string };
};
```

- [ ] **Step 5: Atualizar `closeCashShift` (`lib/api.ts:1228-1240`)**

```ts
export const closeCashShift = async (
  shiftId: string,
  closingCountedCash: number,
  closingCashBreakdown?: Record<string, number> | null,
  maxTolerance?: number | null,
  approvedByUserId?: string | null,
): Promise<{ success: boolean; requires_approval?: boolean; expected_cash?: number; closing_counted_cash?: number; difference?: number; message?: string }> => {
  const { data, error } = await supabase.rpc('close_cash_shift_secure', {
    p_shift_id: shiftId,
    p_closing_counted_cash: closingCountedCash,
    p_closing_cash_breakdown: closingCashBreakdown ?? null,
    p_max_tolerance: maxTolerance ?? null,
    p_approved_by_user_id: approvedByUserId ?? null,
  });
  if (error) return { success: false, message: error.message };
  return data as { success: boolean; requires_approval?: boolean; expected_cash?: number; closing_counted_cash?: number; difference?: number; message?: string };
};
```

- [ ] **Step 6: Adicionar `verifyCashSupervisor` e `fetchCashShiftAudit` (logo abaixo de `closeCashShift`)**

```ts
export const verifyCashSupervisor = async (
  storeId: string,
  email: string,
  password: string,
): Promise<{ success: boolean; user_id?: string; name?: string; message?: string }> => {
  const { data, error } = await supabase.rpc('verify_cash_supervisor_secure', {
    p_store_id: storeId,
    p_email: email,
    p_password: password,
  });
  if (error) return { success: false, message: error.message };
  return data as { success: boolean; user_id?: string; name?: string; message?: string };
};

export interface CashShiftAuditEvent {
  id: string;
  store_id: string;
  shift_id: string | null;
  operator_user_id: string | null;
  operator_name: string;
  event_type: 'item_cancelado' | 'sangria_grande';
  details: Record<string, any>;
  created_at: string;
}

export const fetchCashShiftAudit = async (
  storeId: string,
  shiftId?: string | null,
  operatorUserId?: string | null,
  limit: number = 50,
): Promise<CashShiftAuditEvent[]> => {
  const { data, error } = await supabase.rpc('fetch_cash_shift_audit_secure', {
    p_store_id: storeId,
    p_shift_id: shiftId ?? null,
    p_operator_user_id: operatorUserId ?? null,
    p_limit: limit,
  });
  if (error) { console.error('Error fetching cash shift audit:', error); return []; }
  return (data as CashShiftAuditEvent[]) || [];
};
```

- [ ] **Step 7: Build**

```bash
npm run build
```
Expected: compila limpo (nenhum call site quebrado ainda, já que todos os parâmetros novos são opcionais).

- [ ] **Step 8: Testar as funções novas via script Node descartável**

Criar `/tmp/test-cash-api.mjs`:
```js
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  'https://testvendase.norteparanegocios.com.br',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg0ODQ3MjYwLCJleHAiOjE5NDI1MjcyNjB9.YmlPFysJDamnhjkRwwNDOqNhzPIVtmrIjlucfDKPOv4'
);
const { data, error } = await supabase.rpc('verify_cash_supervisor_secure', {
  p_store_id: 'f33b4310-ff0a-487c-a3b1-62acd0a58850',
  p_email: 'qa-caixa-task4@zz-laboratorio.test',
  p_password: 'senha-errada',
});
console.log({ data, error });
```
```bash
node /tmp/test-cash-api.mjs
rm /tmp/test-cash-api.mjs
```
Expected: `{ data: { success: false, message: 'Credenciais inválidas.' }, error: null }` — confirma que o schema cache do PostgREST já reconhece a function nova (mesmo teste de conectividade que os scripts anteriores desta sessão já usaram).

- [ ] **Step 9: Commit**

```bash
git add lib/api.ts types/index.ts
git commit -m "feat(caixa): tipos e funções de API pra auditoria/tolerância/supervisor"
```

---

### Task 3: Breakdown por cédula/moeda no fechamento

**Files:**
- Create: `lib/cashDenominations.ts`
- Modify: `components/modules/StoreModule.tsx` (`CaixaView` — state ~4222-4227, `handleConfirmCloseShift` ~4550-4583, modal JSX ~5042-5171)

**Interfaces:**
- Consumes: `CASH_DENOMINATIONS`/`sumDenominationBreakdown` (esta task); `closeCashShift` (Task 2).
- Produces: `closingCashBreakdown: Record<string, string>` state em `CaixaView`, usado pela Task 5 (tolerância) e Task 7 (nenhuma dependência direta).

- [ ] **Step 1: Criar `lib/cashDenominations.ts`**

```ts
// Cédulas e moedas do Real em circulação — usado no fechamento de caixa
// (contagem por denominação em vez de somar de cabeça, achado da pesquisa
// de mercado: menos erro, e vira registro auditável de como se chegou no
// total). R$0,01 fora de propósito — praticamente fora de circulação.
export const CASH_DENOMINATIONS: number[] = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05];

export function sumDenominationBreakdown(breakdown: Record<string, string>): number {
  return CASH_DENOMINATIONS.reduce((total, value) => {
    const count = parseInt(breakdown[String(value)] || '0', 10);
    return total + (isNaN(count) ? 0 : count * value);
  }, 0);
}
```

- [ ] **Step 2: Trocar o state de `closingCountedCash` por `closingCashBreakdown` (`CaixaView`, linhas ~4222-4227)**

```tsx
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
```

- [ ] **Step 3: Atualizar `handleCloseShiftClick` pra zerar o breakdown (não mais `setClosingCountedCash('')`)**

```tsx
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
```

- [ ] **Step 4: Atualizar os memos `closingCountedValue`/`liveDifference` e `handleConfirmCloseShift`**

```tsx
const closingCountedValue = useMemo(() => sumDenominationBreakdown(closingCashBreakdown), [closingCashBreakdown]);

const liveDifference = useMemo(() => {
    if (!closeSummary) return null;
    return closingCountedValue - closeSummary.expected_cash;
}, [closingCountedValue, closeSummary]);

const handleConfirmCloseShift = async () => {
    if (!shift) return;
    setIsClosingShift(true);
    try {
        const breakdownAsNumbers: Record<string, number> = {};
        CASH_DENOMINATIONS.forEach((value) => {
            const count = parseInt(closingCashBreakdown[String(value)] || '0', 10);
            if (count > 0) breakdownAsNumbers[String(value)] = count;
        });
        const result = await closeCashShift(shift.id, closingCountedValue, breakdownAsNumbers);
        if (result.success) {
            toast.success('Caixa fechado.');
            setShowCloseModal(false);
            setCloseSummary(null);
            setShift(null);
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
```
(A Task 5 volta a mexer nesta função pra tratar `requires_approval`.)

- [ ] **Step 5: Trocar o input único por um grid de denominações na modal (linhas ~5145-5162, dentro do bloco `<div><label>Valor conferido na gaveta</label>...</div>`)**

```tsx
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
```

- [ ] **Step 6: Adicionar o import no topo do arquivo**

```tsx
import { CASH_DENOMINATIONS, sumDenominationBreakdown } from '@/lib/cashDenominations';
```

- [ ] **Step 7: Testar ao vivo**

```bash
npm run build
npm run dev
```
Abrir `http://localhost:3000/loja`, logar na ZZ Laboratorio, abrir um turno de caixa, clicar "Fechar Caixa", preencher quantidades em 2-3 denominações, confirmar que "Total contado" soma certo ao vivo, clicar "Confirmar Fechamento", confirmar que fecha sem erro.

- [ ] **Step 8: Confirmar no banco que o breakdown foi salvo**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -c \"select closing_cash_breakdown from cash_shifts where store_id='f33b4310-ff0a-487c-a3b1-62acd0a58850' order by closed_at desc limit 1;\""
```
Expected: jsonb com as denominações preenchidas.

- [ ] **Step 9: Commit**

```bash
git add lib/cashDenominations.ts components/modules/StoreModule.tsx
git commit -m "feat(caixa): contagem de fechamento por cédula/moeda"
```

---

### Task 4: Contagem cega — permissão `supervisiona_caixa` e config da loja

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`UserManagementView` — `DEFAULT_TEAM_PERMISSIONS` ~6815, checkbox grid ~7036-7069, `openModal` ~6897-6905; `MenuManagementView` — state/effect ~5769-5825; `CaixaView` — modal de fechamento)

**Interfaces:**
- Consumes: `StoreUserPermissions.supervisiona_caixa` (Task 2).
- Produces: `stores.config.cash_shift_blind_count` (nova chave jsonb, sem migração — consumida também pela Task 5).

- [ ] **Step 1: Adicionar `supervisiona_caixa` ao `DEFAULT_TEAM_PERMISSIONS` (`UserManagementView`, ~linha 6815)**

```tsx
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
```

- [ ] **Step 2: Adicionar o checkbox no grid de permissões (logo depois do checkbox `caixa`, ~linha 7069)**

```tsx
    <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={!!permissions.supervisiona_caixa} onChange={() => togglePermission('supervisiona_caixa')} className="rounded text-[var(--brand)] focus:ring-[var(--brand)]" />
        Supervisiona caixa
    </label>
    <p className="text-[11px] text-[var(--text-muted)] pl-6 -mt-1">
        Vê o valor esperado ao fechar o próprio caixa mesmo com contagem cega ligada, e pode aprovar o fechamento de qualquer operador quando a diferença passa do limite configurado.
    </p>
```

- [ ] **Step 3: Seedar `supervisiona_caixa` ao abrir o modal de edição (`openModal`, ~linha 6897-6905)**

```tsx
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
```

- [ ] **Step 4: Adicionar o toggle "Contagem cega" em `MenuManagementView`, seção "Configurações Gerais" (logo depois do bloco de `handleToggleServiceFee`, mesmo padrão)**

Novo state (junto dos outros, ~linha 5769):
```tsx
const [blindCountEnabled, setBlindCountEnabled] = useState(store.config?.cash_shift_blind_count ?? false);
```
No `useEffect` de sincronização (~linha 5817-5825), adicionar:
```tsx
setBlindCountEnabled(store.config?.cash_shift_blind_count ?? false);
```
Novo handler (mesmo padrão de `handleToggleServiceFee`):
```tsx
const handleToggleBlindCount = async () => {
    const newValue = !blindCountEnabled;
    setBlindCountEnabled(newValue);
    try {
        const newConfig = { ...currentStoreConfig, cash_shift_blind_count: newValue };
        await updateStoreConfig(store.id, newConfig);
        setCurrentStoreConfig(newConfig);
        if (onStoreUpdate) onStoreUpdate({ ...store, config: newConfig });
    } catch (e) {
        console.error('Error updating blind count config', e);
        setBlindCountEnabled(!newValue);
        toast.error('Erro ao atualizar configuração de contagem cega.');
    }
};
```
Novo bloco JSX (logo depois do bloco de taxa de serviço, mesmo componente visual):
```tsx
<div className="flex items-center justify-between p-4 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
    <div>
        <h4 className="font-bold text-[var(--text)]">Contagem cega no fechamento de caixa</h4>
        <p className="text-sm text-[var(--text-muted)]">Quem fecha o caixa só vê o valor esperado DEPOIS de confirmar a contagem — evita ajustar a contagem pra bater. Quem tem a permissão "Supervisiona caixa" continua vendo antes.</p>
    </div>
    <button
        onClick={handleToggleBlindCount}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${blindCountEnabled ? 'bg-[var(--ok)]' : 'bg-[var(--border)]'}`}
    >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${blindCountEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
</div>
```

- [ ] **Step 5: Aplicar a contagem cega na modal de fechamento (`CaixaView`)**

Adicionar um helper logo no início do componente `CaixaView` (depois de `orderFlow`, ~linha 4189):
```tsx
    // Melhorias no fluxo de Caixa (2026-08-28): contagem cega — owner/
    // universal e quem tem `supervisiona_caixa` sempre veem o esperado;
    // o resto só vê depois de confirmar, se a loja ligou a config.
    const canSeeExpectedBeforeClosing = !store.config?.cash_shift_blind_count
        || loggedUser.role === 'owner'
        || loggedUser.role === 'universal'
        || loggedUser.permissions?.supervisiona_caixa === true;
    const [closedResultDifference, setClosedResultDifference] = useState<{ expected: number; counted: number; difference: number } | null>(null);
```
No bloco JSX do "Esperado em dinheiro na gaveta" (~linha 5136-5140), condicionar:
```tsx
            {canSeeExpectedBeforeClosing && (
                <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3 flex items-center justify-between">
                    <span className="text-sm font-bold text-[var(--text)]">Esperado em dinheiro na gaveta</span>
                    <span className="font-mono font-bold text-lg text-[var(--text)]">R$ {formatBRL(closeSummary.expected_cash)}</span>
                </div>
            )}
```
E o bloco de `liveDifference` (~linha 5165-5177), condicionar do mesmo jeito (`{canSeeExpectedBeforeClosing && liveDifference !== null && (...)}`) — sem isso, contagem cega mostraria a diferença calculada em tempo real, que já entrega o valor esperado indiretamente.

Em `handleConfirmCloseShift`, guardar o resultado pra mostrar depois de fechar (mesmo em contagem cega — a promessa é "só depois de confirmar", nunca escondido pra sempre):
```tsx
        const result = await closeCashShift(shift.id, closingCountedValue, breakdownAsNumbers);
        if (result.success) {
            toast.success('Caixa fechado.');
            if (!canSeeExpectedBeforeClosing && result.expected_cash !== undefined && result.difference !== undefined) {
                setClosedResultDifference({ expected: result.expected_cash, counted: closingCountedValue, difference: result.difference });
            }
            setShowCloseModal(false);
            setCloseSummary(null);
            setShift(null);
        }
```
E um `Modal` simples pra mostrar `closedResultDifference` quando não-nulo (título "Resultado do fechamento", mesma estrutura de "Esperado"/"Diferença" já usada na modal de fechamento, botão "Ok" que zera `closedResultDifference`).

- [ ] **Step 6: Testar ao vivo**

```bash
npm run build && npm run dev
```
1. Ligar "Contagem cega" em Configurações Gerais.
2. Logar como um operador SEM `supervisiona_caixa` — abrir e fechar caixa, confirmar que "Esperado" e a diferença ao vivo não aparecem durante a contagem, mas aparecem num modal de resultado depois de confirmar.
3. Marcar `supervisiona_caixa` nesse mesmo usuário (Gestão de Usuários) — repetir o fechamento, confirmar que agora vê o esperado durante a contagem.

- [ ] **Step 7: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat(caixa): contagem cega opcional via permissão supervisiona_caixa"
```

---

### Task 5: Tolerância em 2 níveis + aprovação de supervisor

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`MenuManagementView` — mesma seção da Task 4; `CaixaView` — `handleConfirmCloseShift`, modal JSX)

**Interfaces:**
- Consumes: `verifyCashSupervisor`, `closeCashShift` com `maxTolerance`/`approvedByUserId` (Task 2); `stores.config.cash_shift_warning_tolerance`/`cash_shift_max_tolerance` (novas chaves, sem migração).
- Produces: nada consumido por tasks depois desta.

- [ ] **Step 1: Adicionar os 2 campos numéricos de tolerância em `MenuManagementView` (mesmo bloco da Task 4, logo abaixo do toggle de contagem cega)**

State (junto dos outros):
```tsx
const [warningTolerance, setWarningTolerance] = useState(String(store.config?.cash_shift_warning_tolerance ?? 5));
const [maxTolerance, setMaxTolerance] = useState(String(store.config?.cash_shift_max_tolerance ?? 20));
const [isSavingTolerance, setIsSavingTolerance] = useState(false);
```
No `useEffect` de sincronização:
```tsx
setWarningTolerance(String(store.config?.cash_shift_warning_tolerance ?? 5));
setMaxTolerance(String(store.config?.cash_shift_max_tolerance ?? 20));
```
Handler (padrão diferente dos toggles — aqui precisa de um botão "Salvar" explícito, já que são 2 campos numéricos digitados, não um clique único):
```tsx
const handleSaveTolerance = async () => {
    const warning = parseFloat(warningTolerance.replace(',', '.'));
    const max = parseFloat(maxTolerance.replace(',', '.'));
    if (isNaN(warning) || warning < 0 || isNaN(max) || max < warning) {
        toast.error('Informe valores válidos — o limite máximo precisa ser maior ou igual ao de aviso.');
        return;
    }
    setIsSavingTolerance(true);
    try {
        const newConfig = { ...currentStoreConfig, cash_shift_warning_tolerance: warning, cash_shift_max_tolerance: max };
        await updateStoreConfig(store.id, newConfig);
        setCurrentStoreConfig(newConfig);
        if (onStoreUpdate) onStoreUpdate({ ...store, config: newConfig });
        toast.success('Tolerância de fechamento atualizada.');
    } catch (e) {
        console.error('Error updating tolerance config', e);
        toast.error('Erro ao salvar tolerância.');
    } finally {
        setIsSavingTolerance(false);
    }
};
```
JSX:
```tsx
<div className="p-4 bg-[var(--surface-2)] rounded-lg border border-[var(--border)] space-y-3">
    <div>
        <h4 className="font-bold text-[var(--text)]">Tolerância de diferença no fechamento</h4>
        <p className="text-sm text-[var(--text-muted)]">Diferença até o limite de aviso só mostra um alerta. Acima do limite máximo, o fechamento trava até um supervisor aprovar.</p>
    </div>
    <div className="grid grid-cols-2 gap-3">
        <div>
            <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Aviso (R$)</label>
            <input type="number" min="0" step="0.01" className="w-full px-3 py-2 rounded-lg border border-[var(--border)]" value={warningTolerance} onChange={e => setWarningTolerance(e.target.value)} />
        </div>
        <div>
            <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Máximo (R$)</label>
            <input type="number" min="0" step="0.01" className="w-full px-3 py-2 rounded-lg border border-[var(--border)]" value={maxTolerance} onChange={e => setMaxTolerance(e.target.value)} />
        </div>
    </div>
    <Button size="sm" onClick={handleSaveTolerance} isLoading={isSavingTolerance}>Salvar tolerância</Button>
</div>
```

- [ ] **Step 2: Adicionar o campo de limiar de sangria no mesmo bloco (reaproveita `handleSaveTolerance`)**

Adicionar mais um state e mais um input no mesmo grid:
```tsx
const [sangriaAlertThreshold, setSangriaAlertThreshold] = useState(String(store.config?.cash_shift_sangria_alert_threshold ?? 200));
```
No `useEffect`: `setSangriaAlertThreshold(String(store.config?.cash_shift_sangria_alert_threshold ?? 200));`
Em `handleSaveTolerance`, validar e incluir no `newConfig`:
```tsx
const sangriaThreshold = parseFloat(sangriaAlertThreshold.replace(',', '.'));
if (isNaN(sangriaThreshold) || sangriaThreshold < 0) {
    toast.error('Informe um limite de sangria válido.');
    return;
}
// ...newConfig ganha: cash_shift_sangria_alert_threshold: sangriaThreshold,
```
JSX (terceira coluna, `grid-cols-3` em vez de `grid-cols-2`):
```tsx
<div>
    <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Sangria grande a partir de (R$)</label>
    <input type="number" min="0" step="0.01" className="w-full px-3 py-2 rounded-lg border border-[var(--border)]" value={sangriaAlertThreshold} onChange={e => setSangriaAlertThreshold(e.target.value)} />
</div>
```

- [ ] **Step 3: Passar `maxTolerance` e tratar `requires_approval` em `handleConfirmCloseShift` (`CaixaView`)**

```tsx
const [showApprovalModal, setShowApprovalModal] = useState(false);
const [approvalEmail, setApprovalEmail] = useState('');
const [approvalPassword, setApprovalPassword] = useState('');
const [isVerifyingApproval, setIsVerifyingApproval] = useState(false);

const handleConfirmCloseShift = async () => {
    if (!shift) return;
    setIsClosingShift(true);
    try {
        const breakdownAsNumbers: Record<string, number> = {};
        CASH_DENOMINATIONS.forEach((value) => {
            const count = parseInt(closingCashBreakdown[String(value)] || '0', 10);
            if (count > 0) breakdownAsNumbers[String(value)] = count;
        });
        const maxTol = store.config?.cash_shift_max_tolerance ?? 20;
        const result = await closeCashShift(shift.id, closingCountedValue, breakdownAsNumbers, maxTol);
        if (result.requires_approval) {
            setShowApprovalModal(true);
            return;
        }
        if (result.success) {
            toast.success('Caixa fechado.');
            if (!canSeeExpectedBeforeClosing && result.expected_cash !== undefined && result.difference !== undefined) {
                setClosedResultDifference({ expected: result.expected_cash, counted: closingCountedValue, difference: result.difference });
            }
            setShowCloseModal(false);
            setCloseSummary(null);
            setShift(null);
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

const handleConfirmWithApproval = async () => {
    if (!shift) return;
    setIsVerifyingApproval(true);
    try {
        const verify = await verifyCashSupervisor(store.id, approvalEmail.trim(), approvalPassword);
        if (!verify.success || !verify.user_id) {
            toast.error(verify.message || 'Credenciais inválidas.');
            return;
        }
        const breakdownAsNumbers: Record<string, number> = {};
        CASH_DENOMINATIONS.forEach((value) => {
            const count = parseInt(closingCashBreakdown[String(value)] || '0', 10);
            if (count > 0) breakdownAsNumbers[String(value)] = count;
        });
        const maxTol = store.config?.cash_shift_max_tolerance ?? 20;
        const result = await closeCashShift(shift.id, closingCountedValue, breakdownAsNumbers, maxTol, verify.user_id);
        if (result.success) {
            toast.success(`Caixa fechado com aprovação de ${verify.name}.`);
            setShowApprovalModal(false);
            setShowCloseModal(false);
            setCloseSummary(null);
            setShift(null);
            setApprovalEmail('');
            setApprovalPassword('');
        } else {
            toast.error(result.message || 'Não foi possível fechar o caixa.');
        }
    } finally {
        setIsVerifyingApproval(false);
    }
};
```

- [ ] **Step 4: Mostrar aviso inline (limite de aviso) e o botão de aprovação (limite máximo) na modal de fechamento**

Substituir o bloco de `liveDifference` (dentro de `canSeeExpectedBeforeClosing`) por uma versão que também compara com `warning`/`max`:
```tsx
            {canSeeExpectedBeforeClosing && liveDifference !== null && (
                <>
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
                    {Math.abs(liveDifference) > (store.config?.cash_shift_warning_tolerance ?? 5) && (
                        <p className="text-xs text-[var(--warn)] font-semibold flex items-center gap-1.5">
                            <AlertCircle size={14} /> Diferença acima do normal — confira a contagem antes de fechar.
                        </p>
                    )}
                </>
            )}
```
Adicionar o modal de aprovação (novo `<Modal>`, logo depois da modal de "Fechar Caixa" existente):
```tsx
<Modal isOpen={showApprovalModal} onClose={() => { if (!isVerifyingApproval) setShowApprovalModal(false); }} title="Aprovação de supervisor necessária">
    <div className="space-y-4">
        <p className="text-sm text-[var(--text-muted)]">
            A diferença deste fechamento passou do limite configurado (R$ {formatBRL(store.config?.cash_shift_max_tolerance ?? 20)}). Peça pra um supervisor digitar a própria senha pra aprovar.
        </p>
        <Input label="E-mail do supervisor" value={approvalEmail} onChange={e => setApprovalEmail(e.target.value)} />
        <Input label="Senha" type="password" value={approvalPassword} onChange={e => setApprovalPassword(e.target.value)} />
        <div className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled={isVerifyingApproval} onClick={() => setShowApprovalModal(false)}>Cancelar</Button>
            <Button className="flex-1" isLoading={isVerifyingApproval} onClick={handleConfirmWithApproval}>Aprovar e fechar</Button>
        </div>
    </div>
</Modal>
```

- [ ] **Step 5: Adicionar o import de `verifyCashSupervisor` no topo do arquivo**

Adicionar `verifyCashSupervisor` à lista de imports de `@/lib/api` já existente no topo de `StoreModule.tsx`.

- [ ] **Step 6: Testar ao vivo**

```bash
npm run build && npm run dev
```
1. Configurar tolerância máxima em R$ 1 (bem baixa, pra forçar o cenário).
2. Abrir caixa, fechar com uma contagem propositalmente errada (diferença > R$1).
3. Confirmar que aparece o modal de aprovação em vez de fechar.
4. Tentar com senha errada — confirmar que recusa e o turno continua aberto.
5. Tentar com a senha certa de um usuário `owner` — confirmar que fecha.
6. Reabrir um turno de teste, fechar com diferença pequena (< R$1) — confirmar que fecha direto, sem pedir aprovação.

- [ ] **Step 7: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat(caixa): tolerância em 2 níveis com aprovação de supervisor"
```

---

### Task 6: Trilha de auditoria — cancelamento de item e sangria grande

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`KdsView` — signature ~736, call site ~942, instanciação ~9112-9113; `TablesView.handleDeleteItem`; `CaixaView.handleSubmitMovement`)

**Interfaces:**
- Consumes: `cancelSpecificOrderItem`/`registerCashMovement` com os parâmetros novos (Task 2).
- Produces: linhas reais em `cash_shift_audit_events`, consumidas pela Task 7.

- [ ] **Step 1: Adicionar `loggedUser` como prop de `KdsView` (assinatura, linha 736)**

```tsx
const KdsView: React.FC<{ destination: 'kitchen' | 'bar'; store: Store; loggedUser: StoreUser }> = ({ destination, store, loggedUser }) => {
```

- [ ] **Step 2: Passar `loggedUser` nos 2 call sites de `KdsView` (linhas 9112-9113)**

```tsx
{tab === 'kitchen' && canAccess('kitchen') && <KdsView destination="kitchen" store={user.store} loggedUser={user} />}
{tab === 'bar' && canAccess('bar') && <KdsView destination="bar" store={user.store} loggedUser={user} />}
```

- [ ] **Step 3: Passar os dados do operador na chamada de `cancelSpecificOrderItem` dentro de `KdsView` (linha ~942)**

```tsx
onClick={async () => {
    if (cancellingIds.has(item.id)) return;
    if (await confirm({ message: 'Tem certeza que deseja CANCELAR este item?', variant: 'danger' })) {
        setCancellingIds(prev => new Set(prev).add(item.id));
        await cancelSpecificOrderItem(item.id, loggedUser.id, loggedUser.name);
        setOrders(prev => prev.filter(o => o.id !== item.id));
    }
}}
```

- [ ] **Step 4: Passar os dados do operador em `TablesView.handleDeleteItem`**

```tsx
const handleDeleteItem = async (itemId: string) => {
    if(await confirm("Deseja cancelar este item da comanda?")) {
        try {
            await cancelSpecificOrderItem(itemId, loggedUser.id, loggedUser.name);
            // Realtime will update the list
        } catch(e) {
            toast.error("Erro ao cancelar item.");
        }
    }
};
```

- [ ] **Step 5: Passar `operatorName` e `alertThreshold` em `CaixaView.handleSubmitMovement`**

```tsx
const result = await registerCashMovement(
    shift.id,
    movementType,
    value,
    movementReason.trim(),
    loggedUser.name,
    store.config?.cash_shift_sangria_alert_threshold ?? 200,
);
```

- [ ] **Step 6: Testar ao vivo**

```bash
npm run build && npm run dev
```
1. Na tela Cozinha (KDS), cancelar um item de teste — verificar no banco:
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -c \"select operator_name, event_type, details from cash_shift_audit_events where store_id='f33b4310-ff0a-487c-a3b1-62acd0a58850' order by created_at desc limit 5;\""
```
2. Na tela Mesas (comanda), cancelar um item — repetir a checagem, confirmar nova linha `item_cancelado`.
3. No Caixa, registrar uma sangria de valor alto (acima do limite configurado) — confirmar linha `sangria_grande`. Registrar uma pequena — confirmar que NÃO gera linha.

- [ ] **Step 7: Limpar dado de teste e commitar**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -c \"delete from cash_shift_audit_events where store_id='f33b4310-ff0a-487c-a3b1-62acd0a58850';\""
git add components/modules/StoreModule.tsx
git commit -m "feat(caixa): registra cancelamento de item e sangria grande na trilha de auditoria"
```

---

### Task 7: UI — "Eventos deste turno" e extensão do relatório por operador

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`CaixaView` — modal de fechamento; `StoreAdminView` — `operatorBreakdown`/tabela de histórico por operador)

**Interfaces:**
- Consumes: `fetchCashShiftAudit`, `fetchCashShiftsHistory` (já existente).

- [ ] **Step 1: Adicionar a seção "Eventos deste turno" na modal de fechamento (`CaixaView`, logo antes do bloco de "Valor conferido"/"Contagem da gaveta")**

State novo:
```tsx
const [shiftAuditEvents, setShiftAuditEvents] = useState<CashShiftAuditEvent[]>([]);
```
Em `handleCloseShiftClick`, buscar junto com o resumo:
```tsx
const handleCloseShiftClick = async () => {
    if (!shift) return;
    setShowCloseModal(true);
    setClosingCashBreakdown({});
    setIsLoadingSummary(true);
    try {
        const [summary, events] = await Promise.all([
            fetchCashShiftSummary(shift.id),
            fetchCashShiftAudit(storeId, shift.id),
        ]);
        setCloseSummary(summary);
        setShiftAuditEvents(events);
        if (!summary) toast.error('Não foi possível carregar o resumo do turno.');
    } finally {
        setIsLoadingSummary(false);
    }
};
```
JSX (usa o componente `Collapsible` já existente no projeto, `@/components/ui`):
```tsx
{shiftAuditEvents.length > 0 && (
    <Collapsible title={`Eventos deste turno (${shiftAuditEvents.length})`} defaultOpen={false}>
        <div className="space-y-1.5">
            {shiftAuditEvents.map((event) => (
                <div key={event.id} className="flex items-center justify-between text-xs bg-[var(--surface-2)] rounded-lg px-3 py-2">
                    <span className="text-[var(--text)]">
                        {event.event_type === 'item_cancelado'
                            ? `Item cancelado: ${event.details.produto || 'produto'}`
                            : `Sangria grande: R$ ${formatBRL(event.details.valor || 0)}`}
                    </span>
                    <span className="text-[var(--text-muted)]">{new Date(event.created_at).toLocaleTimeString('pt-BR')}</span>
                </div>
            ))}
        </div>
    </Collapsible>
)}
```

- [ ] **Step 2: Adicionar o import de `Collapsible`/`CashShiftAuditEvent`/`fetchCashShiftAudit`**

Confirmar que `Collapsible` já está importado de `@/components/ui` no topo do arquivo (é usado em outras seções — `Collapsible title="Certificado e Configuração Fiscal"` já existe); adicionar `fetchCashShiftAudit` e o tipo `CashShiftAuditEvent` à lista de imports de `@/lib/api`.

- [ ] **Step 3: Estender `operatorBreakdown` em `StoreAdminView` com contagem de eventos e diferença acumulada**

Localizar o `useMemo` de `operatorBreakdown` (agrupa `filteredAndSortedSales` por `payment_details.operador_nome`) e, na tabela que o renderiza, adicionar 2 colunas novas carregadas separadamente (não dentro do mesmo `useMemo`, já que vêm de fontes diferentes — auditoria e turnos, não de `orders`):

```tsx
const [auditCountByOperator, setAuditCountByOperator] = useState<Record<string, number>>({});
const [shiftDifferenceByOperator, setShiftDifferenceByOperator] = useState<Record<string, number>>({});

useEffect(() => {
    if (historyView !== 'operator') return;
    Promise.all([
        fetchCashShiftAudit(storeId, null, null, 500),
        fetchCashShiftsHistory(storeId, 500),
    ]).then(([events, shifts]) => {
        const byOperatorEvents: Record<string, number> = {};
        events.forEach((e) => { byOperatorEvents[e.operator_name] = (byOperatorEvents[e.operator_name] || 0) + 1; });
        setAuditCountByOperator(byOperatorEvents);

        const byOperatorDiff: Record<string, number> = {};
        shifts.forEach((s) => {
            if (s.operator_name && s.difference !== null) {
                byOperatorDiff[s.operator_name] = (byOperatorDiff[s.operator_name] || 0) + s.difference;
            }
        });
        setShiftDifferenceByOperator(byOperatorDiff);
    });
}, [storeId, historyView]);
```
Na tabela de `operatorBreakdown`, adicionar 2 `<th>`/`<td>` novos: "Eventos" (`auditCountByOperator[nome] || 0`) e "Diferença de caixa" (`formatBRL(shiftDifferenceByOperator[nome] || 0)`, com cor `--err` se negativo e `--ok` se zero/positivo).

- [ ] **Step 4: Testar ao vivo**

```bash
npm run build && npm run dev
```
Fechar um turno com pelo menos 1 evento de auditoria gerado (repetir um cancelamento de item da Task 6), abrir a modal de "Fechar Caixa" de um turno novo pra ver a seção (ou usar a mesma sessão antes de confirmar o fechamento), e conferir a aba "Histórico de Vendas" → visão por operador mostrando as 2 colunas novas.

- [ ] **Step 5: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat(caixa): mostra eventos de auditoria no fechamento e no relatório por operador"
```

---

### Task 8: Ponto ↔ caixa — integração leve

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`StoreLayout` — `handleToggleCheckin` ~453-467 e o botão "Bater ponto" ~573/659)

**Interfaces:**
- Consumes: `fetchOpenCashShift`, `openCashShift` (já existentes/atualizados).

- [ ] **Step 1: Adicionar os modais e o novo fluxo de `handleToggleCheckin`**

```tsx
  const [showOpenShiftPrompt, setShowOpenShiftPrompt] = useState(false);
  const [showCloseShiftReminder, setShowCloseShiftReminder] = useState(false);
  const [checkinOpeningFloat, setCheckinOpeningFloat] = useState('');
  const [isOpeningShiftFromCheckin, setIsOpeningShiftFromCheckin] = useState(false);

  const handleToggleCheckin = async () => {
    if (checkinBusy) return;
    setCheckinBusy(true);
    try {
      if (openCheckin) {
        // Bater ponto de SAÍDA: se ainda há caixa aberto deste operador,
        // lembra (nunca trava) — Toast "Shift Review" foi a referência.
        const operatorUserId = user.role === 'universal' ? null : user.id;
        const openShift = await fetchOpenCashShift(user.store.id, operatorUserId);
        if (openShift) {
          setShowCloseShiftReminder(true);
          return;
        }
        const result = await endCheckin(openCheckin.id);
        if (result.success) setOpenCheckin(null);
      } else {
        const created = await startCheckin(user.store.id, user.id, user.name);
        if (created) {
          setOpenCheckin(created);
          // Bater ponto de ENTRADA: se este operador pode operar caixa e
          // ainda não tem turno aberto, oferece abrir junto (Quantic foi
          // a referência) — sempre opcional.
          if (user.permissions?.caixa === true) {
            const operatorUserId = user.role === 'universal' ? null : user.id;
            const openShift = await fetchOpenCashShift(user.store.id, operatorUserId);
            if (!openShift) setShowOpenShiftPrompt(true);
          }
        }
      }
    } finally {
      setCheckinBusy(false);
    }
  };

  const handleOpenShiftFromCheckin = async () => {
    const value = parseFloat(checkinOpeningFloat.replace(',', '.'));
    if (isNaN(value) || value < 0) {
      toast.error('Informe um fundo de troco válido.');
      return;
    }
    setIsOpeningShiftFromCheckin(true);
    try {
      const isUniversal = user.role === 'universal';
      const result = await openCashShift(user.store.id, isUniversal ? null : user.id, value, isUniversal ? `Aberto pela conta universal: ${user.name} (${user.email})` : undefined);
      if (result.success) {
        toast.success('Caixa aberto.');
        setShowOpenShiftPrompt(false);
        setCheckinOpeningFloat('');
      } else {
        toast.error(result.message || 'Não foi possível abrir o caixa.');
      }
    } finally {
      setIsOpeningShiftFromCheckin(false);
    }
  };

  const handleCheckoutAnyway = async () => {
    if (!openCheckin) return;
    setCheckinBusy(true);
    try {
      const result = await endCheckin(openCheckin.id);
      if (result.success) setOpenCheckin(null);
      setShowCloseShiftReminder(false);
    } finally {
      setCheckinBusy(false);
    }
  };
```

- [ ] **Step 2: Adicionar os 2 modais (em qualquer lugar do JSX de `StoreLayout`, junto dos outros modais do componente)**

```tsx
<Modal isOpen={showOpenShiftPrompt} onClose={() => setShowOpenShiftPrompt(false)} title="Quer abrir seu caixa também?">
    <div className="space-y-4">
        <p className="text-sm text-[var(--text-muted)]">Você bateu ponto e pode operar o caixa. Quer abrir seu turno agora, informando o fundo de troco?</p>
        <div>
            <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Fundo de troco</label>
            <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] font-bold">R$</span>
                <input type="number" min="0" step="0.01" autoFocus className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-[var(--border)] focus:border-[var(--brand)] focus:outline-none font-bold text-lg" placeholder="0.00" value={checkinOpeningFloat} onChange={e => setCheckinOpeningFloat(e.target.value)} />
            </div>
        </div>
        <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowOpenShiftPrompt(false)}>Só bater ponto</Button>
            <Button className="flex-1" isLoading={isOpeningShiftFromCheckin} onClick={handleOpenShiftFromCheckin}>Abrir os dois</Button>
        </div>
    </div>
</Modal>

<Modal isOpen={showCloseShiftReminder} onClose={() => setShowCloseShiftReminder(false)} title="Você ainda tem um caixa aberto">
    <div className="space-y-4">
        <p className="text-sm text-[var(--text-muted)]">Recomendado fechar o caixa antes de sair, mas você pode sair e fechar depois se precisar.</p>
        <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={handleCheckoutAnyway} isLoading={checkinBusy}>Sair mesmo assim</Button>
            <Button className="flex-1" onClick={() => { setShowCloseShiftReminder(false); setActiveTab('caixa'); }}>Fechar caixa agora</Button>
        </div>
    </div>
</Modal>
```
(Se `StoreLayout` não tiver um jeito direto de navegar pra aba Caixa — checar se existe `setActiveTab`/prop de navegação já usada por outro botão do sidebar; se não houver, o botão "Fechar caixa agora" só fecha o modal e o usuário navega manualmente — ajustar o texto do botão pra "Ok, vou fechar" nesse caso.)

- [ ] **Step 3: Testar ao vivo**

```bash
npm run build && npm run dev
```
1. Como operador com `permissions.caixa === true` e sem turno aberto: bater ponto de entrada, confirmar que aparece "Quer abrir seu caixa também?"; clicar "Só bater ponto" — confirmar que só o ponto foi batido (sem turno criado).
2. Bater ponto de entrada de novo (saída primeiro), desta vez clicar "Abrir os dois" — confirmar que ponto E caixa abrem.
3. Tentar bater ponto de SAÍDA com o caixa ainda aberto — confirmar que aparece o lembrete; clicar "Sair mesmo assim" — confirmar que o ponto encerra e o caixa continua aberto (nunca travado).

- [ ] **Step 4: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat(caixa): integração leve entre bater ponto e abrir/lembrar de fechar caixa"
```

---

### Task 9: Revisão final, documentação e deploy

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Build final completo**

```bash
npm run build
```
Expected: compila limpo, zero erros de tipo.

- [ ] **Step 2: Teste end-to-end ao vivo, ponta a ponta, na ZZ Laboratorio**

Sequência única cobrindo as 4 prioridades: bater ponto de entrada → abrir caixa junto (modal do Ponto) → cancelar 1 item na Cozinha (gera evento) → registrar 1 sangria grande (gera evento) → fechar o caixa com contagem por cédula, diferença acima do limite → aprovar com supervisor → conferir "Eventos deste turno" na modal → bater ponto de saída (sem caixa aberto, sem lembrete) → conferir a coluna nova na visão por operador do Histórico de Vendas.

- [ ] **Step 3: Atualizar `AGENTS.md` com uma seção nova documentando o que foi feito**

Adicionar, logo depois da seção "## Caixa por operador (`cash_shifts`, migration 062)" já existente:

```markdown
## Melhorias no fluxo de Caixa (migration 063, 2026-08-28)

Ver spec completa em `docs/superpowers/specs/2026-08-28-melhorias-fluxo-caixa-design.md`
e plano em `docs/superpowers/plans/2026-08-28-melhorias-fluxo-caixa-plan.md`.
Pesquisa de mercado (Toast, Loyverse, Square) validou 4 práticas baratas:

- **Contagem cega** — nova permissão `supervisiona_caixa`; loja liga em
  `stores.config.cash_shift_blind_count`. Quem não tem a permissão só vê o
  valor esperado DEPOIS de confirmar o fechamento.
- **Breakdown por cédula/moeda** (`lib/cashDenominations.ts`,
  `cash_shifts.closing_cash_breakdown`) — contagem por denominação em vez
  de somar de cabeça.
- **Tolerância em 2 níveis** (`stores.config.cash_shift_warning_tolerance`/
  `cash_shift_max_tolerance`) — diferença grande trava o fechamento até um
  supervisor (`verify_cash_supervisor_secure`) digitar a própria senha.
  `cash_shifts.approved_by_user_id` registra quem aprovou.
- **Trilha de auditoria** (`cash_shift_audit_events`) — cancelamento de
  item e sangria acima de `stores.config.cash_shift_sangria_alert_threshold`
  ficam registrados por operador, visíveis no fechamento e no relatório.
- **Ponto ↔ caixa leve** (`StoreLayout.handleToggleCheckin`) — bater ponto
  de entrada oferece abrir caixa junto; bater ponto de saída lembra de
  fechar o caixa aberto, nunca trava a saída de verdade.
```

- [ ] **Step 4: Commit da documentação**

```bash
git add AGENTS.md
git commit -m "docs: documenta melhorias no fluxo de Caixa (migration 063)"
```

- [ ] **Step 5: Push e deploy**

```bash
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```
Expected: build remoto limpo, `systemctl` mostra `ntb-vendas.service` ativo e "Ready" no log.
