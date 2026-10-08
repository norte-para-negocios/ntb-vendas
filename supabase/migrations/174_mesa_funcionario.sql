-- 174: mesa de funcionário (pedido do Joaquim 08/10/2026: "opção de abrir a mesa como funcionário e ficar marcado como
-- funcionário"). Aditiva: apps antigos continuam abrindo mesa pela open_table_manually_secure de sempre.
--  - tables.funcionario / table_sessions.funcionario: nome de quem consome (null = mesa normal).
--  - open_table_manually_v2: abre a mesa marcada como funcionário e já SEM a taxa de serviço automática
--    (service_fee_removed = true; o caixa pode religar pelo "Cobrar taxa" de sempre).
--  - a marca some sozinha quando a mesa volta a ficar livre ou a conta é fechada (trigger).
--  - o pagamento grava payment_details.funcionario (app) e o fechamento do turno separa "Consumo de funcionários".

alter table public.tables add column if not exists funcionario text;
alter table public.table_sessions add column if not exists funcionario text;

create or replace function public._tables_limpa_funcionario() returns trigger
language plpgsql as $$
begin
  if new.status in ('available', 'closed') and new.status is distinct from old.status then
    new.funcionario := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_tables_limpa_funcionario on public.tables;
create trigger trg_tables_limpa_funcionario before update on public.tables
  for each row execute function public._tables_limpa_funcionario();

create or replace function public.open_table_manually_v2(p_table_id uuid, p_store_id uuid, p_host_name text, p_funcionario text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_func text := nullif(btrim(coalesce(p_funcionario, '')), '');
begin
  if v_func is not null and length(v_func) > 60 then v_func := left(v_func, 60); end if;
  update tables set status = 'occupied', current_host_name = p_host_name, funcionario = v_func,
         service_fee_removed = case when v_func is not null then true else service_fee_removed end
   where id = p_table_id and store_id = p_store_id;
  if not found then raise exception 'Mesa não encontrada nesta loja'; end if;
  insert into table_sessions (table_id, store_id, host_name, funcionario) values (p_table_id, p_store_id, p_host_name, v_func);
end $$;

revoke all on function public.open_table_manually_v2(uuid, uuid, text, text) from public;
grant execute on function public.open_table_manually_v2(uuid, uuid, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
