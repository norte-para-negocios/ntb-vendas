-- 188: comanda automática de cozinha/bar sai pelo PC (ODARA 24/10/2026: "priorize sempre o PC para pedidos; depois o
-- celular"). Todo aparelho logado é estação de impressão e o primeiro que pega o pedido mandava o papel, inclusive
-- celular com app antigo. Agora, enquanto a loja tem um PC com app 1.2.115+ ligado (app_instances visto há < 2 min e o
-- motor de impressão dando sinal há < 60 s), o banco recusa a comanda automática (dedupe item:/grupo:) que não veio do
-- PC (cabeçalho x-ntb-dispositivo: pc). A recusa usa o código de "já está na fila" (23505), que todo app, novo ou
-- antigo, trata como sucesso e para de tentar. PC desligado = celular volta a imprimir. Cancelamento, reimpressão
-- manual, conferência e cupom não passam por aqui.
create or replace function public.print_jobs_prioridade_do_pc()
 returns trigger
 language plpgsql
as $function$
declare
  v_disp text;
begin
  if NEW.destination not in ('kitchen', 'bar') or NEW.dedupe_key is null or NEW.dedupe_key !~ '^(item|grupo):' then
    return NEW;
  end if;
  begin
    v_disp := current_setting('request.headers', true)::json->>'x-ntb-dispositivo';
  exception when others then v_disp := null;
  end;
  if v_disp = 'pc' then return NEW; end if;
  if exists (select 1 from print_agent_status pa where pa.store_id = NEW.store_id and pa.last_seen_at > now() - interval '60 seconds')
     and exists (select 1 from app_instances ai
                  where ai.store_id = NEW.store_id and ai.platform = 'windows' and ai.last_seen_at > now() - interval '2 minutes'
                    and ai.app_version ~ '^\d+\.\d+\.\d+$'
                    and string_to_array(ai.app_version, '.')::int[] >= array[1, 2, 115]) then
    raise exception 'Comanda fica com o PC da loja.' using errcode = 'unique_violation';
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_print_jobs_prioridade_do_pc on public.print_jobs;
create trigger trg_print_jobs_prioridade_do_pc before insert on public.print_jobs
  for each row execute function public.print_jobs_prioridade_do_pc();
