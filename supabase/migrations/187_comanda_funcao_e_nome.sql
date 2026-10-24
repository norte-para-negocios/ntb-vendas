-- 187: comanda de mesa com a FUNÇÃO e o nome de quem lançou (ODARA 24/10/2026: "é para aparecer garçom ou caixa ou
-- gerente e o nome da pessoa"). Substitui o filtro da 186 (que só tirava a linha). Vale para qualquer aparelho/versão:
-- "Cliente: <nome>" vira "<Função>: <nome>" quando o nome é de alguém da equipe da loja (ou da equipe Norte);
-- nome que não é da equipe é cliente do QR e continua "Cliente: <nome>". Balcão não muda.
create or replace function public.print_jobs_comanda_mesa_sem_cliente()
 returns trigger
 language plpgsql
as $function$
declare
  v_bloco text;
  v_nome text;
  v_role text;
  v_rotulo text;
begin
  if NEW.destination in ('kitchen', 'bar') and NEW.content is not null and NEW.content ~ E'\nMESA [^\n]*\nCliente: ' then
    v_bloco := substring(NEW.content from E'\nCliente: (?:[^\n]*)(?:\n(?!-----|=====|Lan\u00e7ado por)[^\n]*)*?(?=\n(?:-----|Lan\u00e7ado por))');
    if v_bloco is not null then
      v_nome := btrim(regexp_replace(regexp_replace(v_bloco, E'^\nCliente: ', ''), E'\\s*\n\\s*', ' ', 'g'));
      select su.role into v_role from store_users su
       where su.store_id = NEW.store_id and lower(btrim(su.name)) = lower(v_nome) and su.role <> 'open'
       order by su.created_at limit 1;
      if v_role is null and exists (select 1 from universal_users u where lower(btrim(u.name)) = lower(v_nome)) then
        v_role := 'universal';
      end if;
      if v_role is not null then
        v_rotulo := case v_role
          when 'waiter' then 'Garçom' when 'cashier' then 'Caixa' when 'manager' then 'Gerente'
          when 'owner' then 'Gerente' when 'attendant' then 'Atendente' when 'cook' then 'Cozinha'
          when 'kitchen' then 'Cozinha' when 'bar' then 'Bar' when 'universal' then 'Equipe'
          else 'Equipe' end;
        NEW.content := replace(NEW.content, v_bloco, E'\n' || v_rotulo || ': ' || v_nome);
      end if;
    end if;
  end if;
  return NEW;
end;
$function$;
