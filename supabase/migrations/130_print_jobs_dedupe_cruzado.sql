-- Duplicata entre versões do app (2026-09-29, Sertão): a versão nova do app enfileira UMA comanda
-- agrupada por destino (chave `grupo:<destino>:<impressora>:<id1,id2,...>`), a antiga enfileira uma
-- por item (chave `item:<id>:<destino>:<impressora>`). Com dois computadores rodando versões
-- diferentes, cada um imprimia o mesmo item — a chave única não pega, as chaves são diferentes.
-- Este gatilho compara as duas formas: item já coberto por uma comanda agrupada da mesma impressora
-- (ou grupo cujos itens JÁ saíram todos avulsos) vira violação de unicidade (23505), que o app
-- já trata como "outro aparelho já enfileirou" (sucesso silencioso). Grupo com pelo menos 1 item
-- ainda não impresso PASSA (melhor uma repetição do que faltar item na cozinha).
create or replace function public.print_jobs_dedupe_cruzado() returns trigger
language plpgsql as $$
declare
  v_id text;
  v_prn text;
  v_ids text[];
  v_todos boolean;
begin
  if NEW.dedupe_key is null then return NEW; end if;

  if NEW.dedupe_key like 'item:%' then
    v_id := split_part(NEW.dedupe_key, ':', 2);
    v_prn := split_part(NEW.dedupe_key, ':', 4);
    if exists (
      select 1 from print_jobs p
      where p.store_id = NEW.store_id
        and p.dedupe_key like 'grupo:%'
        and split_part(p.dedupe_key, ':', 3) = v_prn
        and position(v_id in p.dedupe_key) > 0
        and p.created_at > now() - interval '1 day'
    ) then
      raise exception 'item ja impresso em comanda agrupada' using errcode = '23505';
    end if;

  elsif NEW.dedupe_key like 'grupo:%' then
    v_prn := split_part(NEW.dedupe_key, ':', 3);
    v_ids := string_to_array(split_part(NEW.dedupe_key, ':', 4), ',');
    select bool_and(exists (
      select 1 from print_jobs p
      where p.store_id = NEW.store_id
        and p.dedupe_key like 'item:' || i || ':%'
        and split_part(p.dedupe_key, ':', 4) = v_prn
        and p.created_at > now() - interval '1 day'
    )) into v_todos from unnest(v_ids) as i;
    if coalesce(v_todos, false) then
      raise exception 'todos os itens ja impressos avulsos' using errcode = '23505';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists print_jobs_dedupe_cruzado on print_jobs;
create trigger print_jobs_dedupe_cruzado before insert on print_jobs
  for each row execute function public.print_jobs_dedupe_cruzado();
