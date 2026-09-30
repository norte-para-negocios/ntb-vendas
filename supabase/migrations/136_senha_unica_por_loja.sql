-- Senha única por loja (30/09, pedido do Ramon): no modo Aberto o pedido é confirmado
-- só com a senha, então duas pessoas com a mesma senha ficam indistinguíveis. Recusa
-- gravar uma senha que outra conta da mesma loja já usa. Não vale pra senha inicial
-- (must_change_password = true, ex. '123456' padrão): a trava entra quando a pessoa
-- escolhe a própria senha.
create or replace function store_users_senha_unica()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.must_change_password or new.role = 'open' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.password is not distinct from old.password
     and new.must_change_password is not distinct from old.must_change_password then
    return new;
  end if;
  if exists (
    select 1 from store_users o
     where o.store_id = new.store_id and o.id <> new.id
       and o.role <> 'open' and not o.must_change_password
       and o.password = new.password
  ) then
    raise exception 'Essa senha já é usada por outra pessoa desta loja. Escolha outra senha.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_store_users_senha_unica on store_users;
create trigger trg_store_users_senha_unica
  before insert or update of password, must_change_password on store_users
  for each row execute function store_users_senha_unica();
