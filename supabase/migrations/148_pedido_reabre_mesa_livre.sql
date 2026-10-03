-- 148: pedido de mesa que entra numa mesa LIVRE reabre a mesa (pedido do Ramon/Sertão, 2026-10-03).
-- Incidente real (02/10): nas mesas 108 e 216 a sessão fechou em menos de 1 minuto e, DEPOIS,
-- o garçom lançou os itens (a tela dele ainda estava na mesa). create_order_secure aceitou o pedido,
-- mas a mesa ficou "available": o pedido existia (R$ 153,30 e R$ 399,60) e a mesa aparecia vazia
-- ("mesa sumiu"). Agora, ao entrar um pedido de MESA numa mesa livre, a mesa volta a ficar ocupada
-- e abre uma sessão (host = quem lançou). Mesa bloqueada não é mexida.
CREATE OR REPLACE FUNCTION public.reabrir_mesa_livre_ao_receber_pedido()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_status text;
begin
  if NEW.order_type is distinct from 'table' or NEW.table_id is null then
    return NEW;
  end if;
  select status into v_status from tables where id = NEW.table_id for update;
  if v_status = 'available' then
    update tables set status = 'occupied', current_host_name = coalesce(current_host_name, nullif(NEW.customer_name, ''))
    where id = NEW.table_id;
    if not exists (select 1 from table_sessions where table_id = NEW.table_id and closed_at is null) then
      insert into table_sessions (table_id, store_id, host_name)
      values (NEW.table_id, NEW.store_id, nullif(NEW.customer_name, ''));
    end if;
  end if;
  return NEW;
end;
$$;

DROP TRIGGER IF EXISTS trg_reabrir_mesa_livre ON public.orders;
CREATE TRIGGER trg_reabrir_mesa_livre
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.reabrir_mesa_livre_ao_receber_pedido();

NOTIFY pgrst, 'reload schema';
