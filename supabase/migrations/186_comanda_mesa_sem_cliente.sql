-- 186: comanda de MESA (cozinha/bar) sem a linha "Cliente: ..." (ODARA 24/10/2026: "o pedido do garçom imprime
-- Cliente: <nome do garçom>; deixe só a mesa"). O app novo (1.2.113+) já não escreve essa linha, mas TODO aparelho
-- logado é estação de impressão (isCaixaRole = true) e o primeiro que pega o pedido manda o papel: celular com app
-- antigo continuava imprimindo "Cliente:". O filtro fica no banco para valer para qualquer aparelho e versão.
-- Só comanda de mesa (linha "MESA n" no cabeçalho); balcão mantém o nome do cliente.
create or replace function public.print_jobs_comanda_mesa_sem_cliente()
 returns trigger
 language plpgsql
as $function$
begin
  if NEW.destination in ('kitchen', 'bar') and NEW.content is not null and NEW.content ~ E'\nMESA [^\n]*\nCliente: ' then
    NEW.content := regexp_replace(NEW.content, E'\nCliente: [^\n]*(\n(?!-----|=====|Lançado por)[^\n]*)*?(?=\n(-----|Lançado por))', '');
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_print_jobs_comanda_mesa_sem_cliente on public.print_jobs;
create trigger trg_print_jobs_comanda_mesa_sem_cliente before insert on public.print_jobs
  for each row execute function public.print_jobs_comanda_mesa_sem_cliente();
