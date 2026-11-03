-- 192 — Nota fiscal sem duplicar + cupom de desconto fechado (02/11/2026, plano 2026-11-02-melhorias-vendas, Tasks 2 e 4).
-- Aplicar no banco ntb_vendas (docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas < este arquivo).
-- Aditiva e segura com app antigo, EXCETO a tela de Cupons do app antigo (1.2.117/1.2.118), que escrevia direto na tabela:
-- depois desta migration ela falha ao criar/editar/apagar cupom (1 cupom cadastrado, 0 usos; o campo de cupom do
-- cliente já está escondido no app novo).

-- ─── 1. Índice único de nota da venda inteira ───────────────────────────────────────────────────────────────────────
-- Uma nota AUTORIZADA por venda (âncora order_id) sem pessoa. Não olha table_id: a reemissão por {orderId}
-- (table_id null) e o fechamento por {tableId} são a mesma venda. Nota por pessoa (pessoa_identificador preenchido)
-- fica fora: continua no fiscal_notas_unico_por_pessoa (055), então a 2ª pessoa da mesma mesa não é barrada.
-- Parcial em created_at: em produção há 1 duplicada antiga (mesma loja+pedido, autorizada, pessoa null) que não pode
-- ser apagada (documento fiscal real) e impediria criar o índice sem esse corte.
-- Conferir antes de aplicar (deve voltar 0 linhas):
--   select store_id, order_id, count(*) from fiscal_notas
--    where status = 'autorizada' and order_id is not null and pessoa_identificador is null and created_at >= '2026-11-03'
--    group by 1, 2 having count(*) > 1;
create unique index if not exists fiscal_notas_unico_venda_v2 on fiscal_notas (store_id, order_id)
  where status = 'autorizada' and order_id is not null and pessoa_identificador is null and created_at >= '2026-11-03';

-- ─── 2. Cupom: escrita só por função com sessão ─────────────────────────────────────────────────────────────────────
-- Leitura continua pública (validateAndApplyCoupon lê). Insert/update/delete direto pela chave anônima saem.
drop policy if exists allow_all_anon_insert on discount_coupons;
drop policy if exists allow_all_anon_update on discount_coupons;
drop policy if exists allow_all_anon_delete on discount_coupons;

create or replace function public.create_coupon_secure(
  p_store_id uuid, p_code text, p_type text, p_value numeric,
  p_max_uses integer default null, p_min_order_value numeric default null, p_expires_at timestamptz default null,
  p_token text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if p_store_id is null or not _sessao_ok(p_token, p_store_id) then
    return jsonb_build_object('success', false, 'message', 'Sessão vencida. Saia e entre de novo.');
  end if;
  if v_code = '' then return jsonb_build_object('success', false, 'message', 'Informe o código do cupom.'); end if;
  if p_type not in ('percent', 'fixed') then return jsonb_build_object('success', false, 'message', 'Tipo de cupom inválido.'); end if;
  if p_value is null or p_value <= 0 then return jsonb_build_object('success', false, 'message', 'O valor do cupom precisa ser maior que zero.'); end if;
  if p_type = 'percent' and p_value > 100 then return jsonb_build_object('success', false, 'message', 'Desconto em % vai até 100.'); end if;
  insert into discount_coupons (store_id, code, type, value, max_uses, min_order_value, expires_at)
  values (p_store_id, v_code, p_type, p_value, p_max_uses, p_min_order_value, p_expires_at)
  returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('success', false, 'message', 'Já existe um cupom com este código.');
end $$;

-- p_fields: só code, type, value, max_uses, min_order_value, expires_at, active (o resto é ignorado).
create or replace function public.update_coupon_secure(p_store_id uuid, p_coupon_id uuid, p_fields jsonb, p_token text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c discount_coupons%rowtype; f jsonb := coalesce(p_fields, '{}'::jsonb);
begin
  if p_store_id is null or not _sessao_ok(p_token, p_store_id) then
    return jsonb_build_object('success', false, 'message', 'Sessão vencida. Saia e entre de novo.');
  end if;
  select * into c from discount_coupons where id = p_coupon_id and store_id = p_store_id for update;
  if not found then return jsonb_build_object('success', false, 'message', 'Cupom não encontrado nesta loja.'); end if;
  if f ? 'code' then c.code := upper(btrim(coalesce(f->>'code', ''))); end if;
  if f ? 'type' then c.type := f->>'type'; end if;
  if f ? 'value' then c.value := (f->>'value')::numeric; end if;
  if f ? 'max_uses' then c.max_uses := nullif(f->>'max_uses', '')::integer; end if;
  if f ? 'min_order_value' then c.min_order_value := nullif(f->>'min_order_value', '')::numeric; end if;
  if f ? 'expires_at' then c.expires_at := nullif(f->>'expires_at', '')::timestamptz; end if;
  if f ? 'active' then c.active := coalesce((f->>'active')::boolean, c.active); end if;
  if c.code = '' then return jsonb_build_object('success', false, 'message', 'Informe o código do cupom.'); end if;
  if c.type not in ('percent', 'fixed') then return jsonb_build_object('success', false, 'message', 'Tipo de cupom inválido.'); end if;
  if c.value is null or c.value <= 0 then return jsonb_build_object('success', false, 'message', 'O valor do cupom precisa ser maior que zero.'); end if;
  if c.type = 'percent' and c.value > 100 then return jsonb_build_object('success', false, 'message', 'Desconto em % vai até 100.'); end if;
  update discount_coupons set code = c.code, type = c.type, value = c.value, max_uses = c.max_uses,
    min_order_value = c.min_order_value, expires_at = c.expires_at, active = c.active
  where id = c.id;
  return jsonb_build_object('success', true);
exception when unique_violation then
  return jsonb_build_object('success', false, 'message', 'Já existe um cupom com este código.');
when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
  return jsonb_build_object('success', false, 'message', 'Valor inválido no cupom.');
end $$;

create or replace function public.delete_coupon_secure(p_store_id uuid, p_coupon_id uuid, p_token text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if p_store_id is null or not _sessao_ok(p_token, p_store_id) then
    return jsonb_build_object('success', false, 'message', 'Sessão vencida. Saia e entre de novo.');
  end if;
  delete from discount_coupons where id = p_coupon_id and store_id = p_store_id;
  if not found then return jsonb_build_object('success', false, 'message', 'Cupom não encontrado nesta loja.'); end if;
  return jsonb_build_object('success', true);
end $$;

revoke all on function public.create_coupon_secure(uuid, text, text, numeric, integer, numeric, timestamptz, text) from public;
revoke all on function public.update_coupon_secure(uuid, uuid, jsonb, text) from public;
revoke all on function public.delete_coupon_secure(uuid, uuid, text) from public;
grant execute on function public.create_coupon_secure(uuid, text, text, numeric, integer, numeric, timestamptz, text) to anon, authenticated;
grant execute on function public.update_coupon_secure(uuid, uuid, jsonb, text) to anon, authenticated;
grant execute on function public.delete_coupon_secure(uuid, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
