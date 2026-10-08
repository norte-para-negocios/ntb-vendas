-- 175: abrir mesa nunca rebaixa uma mesa que já pediu a conta (08/10/2026, teste do modo sem internet).
-- Sem internet, o "abrir mesa" que estava em andamento quando a conexão caiu entra na fila do aparelho por último;
-- na volta da internet ele rodava DEPOIS do "pedir conta" e devolvia a mesa para "ocupada". Agora só ocupa mesa livre
-- (available/closed); mesa já ocupada ou pedindo conta fica como está (só o nome do cliente é preenchido se faltar).
-- A sessão de ocupação só é criada se a mesa não tem uma aberta (o reenvio da fila não duplica a sessão).

create or replace function public.open_table_manually_secure(p_table_id uuid, p_store_id uuid, p_host_name text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  update tables set
    status = case when status in ('available', 'closed') then 'occupied' else status end,
    current_host_name = coalesce(current_host_name, p_host_name)
  where id = p_table_id;
  if not exists (select 1 from table_sessions where table_id = p_table_id and closed_at is null) then
    insert into table_sessions (table_id, store_id, host_name) values (p_table_id, p_store_id, p_host_name);
  end if;
end;
$function$;

create or replace function public.open_table_manually_v2(p_table_id uuid, p_store_id uuid, p_host_name text, p_funcionario text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_func text := nullif(btrim(coalesce(p_funcionario, '')), '');
begin
  if v_func is not null and length(v_func) > 60 then v_func := left(v_func, 60); end if;
  update tables set
    status = case when status in ('available', 'closed') then 'occupied' else status end,
    current_host_name = coalesce(current_host_name, p_host_name),
    funcionario = coalesce(funcionario, v_func),
    service_fee_removed = case when v_func is not null then true else service_fee_removed end
   where id = p_table_id and store_id = p_store_id;
  if not found then raise exception 'Mesa não encontrada nesta loja'; end if;
  if not exists (select 1 from table_sessions where table_id = p_table_id and closed_at is null) then
    insert into table_sessions (table_id, store_id, host_name, funcionario) values (p_table_id, p_store_id, p_host_name, v_func);
  end if;
end $$;

notify pgrst, 'reload schema';
