-- Desfaz o "Pediu Conta" de uma mesa (pedido sem querer): waiting_bill -> occupied.
-- Só mexe em mesa que está de fato em waiting_bill; mesa livre/ocupada não muda.
create or replace function public.cancel_table_bill_request_secure(p_table_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update tables set status = 'occupied' where id = p_table_id and status = 'waiting_bill';
end;
$$;
grant execute on function public.cancel_table_bill_request_secure(uuid) to anon, authenticated;
