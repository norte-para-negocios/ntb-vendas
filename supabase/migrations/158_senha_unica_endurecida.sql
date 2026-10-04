-- 158: endurece a senha única por loja (04/10, regra do dono: a senha do garçom é o que identifica quem lançou o
-- pedido, então nenhuma senha pode repetir dentro da mesma loja). Substitui a função do gatilho da 136 mantendo o
-- que ela já fazia (só dispara quando a senha muda; ignora role 'open'; não mexe em quem já existe) e acrescenta:
--  1) comparação sem diferenciar maiúscula/minúscula nem espaços nas pontas (evita quase-iguais que confundem);
--  2) senha INICIAL (must_change_password = true) também é recusada se for igual à senha de alguém que já
--     escolheu a sua (senha inicial igual à de outro inicial continua permitida: ninguém se identifica com ela,
--     o modo "só senha" exclui contas que ainda não trocaram);
--  3) vale também ao mudar de loja (store_id) e é serializado por loja (dois cadastros ao mesmo tempo);
--  4) mensagem clara. Usuários existentes não são tocados.
create or replace function store_users_senha_unica()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_chave text;
begin
  if new.role = 'open' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.password is not distinct from old.password
     and new.must_change_password is not distinct from old.must_change_password
     and new.store_id is not distinct from old.store_id then
    return new;
  end if;
  v_chave := lower(btrim(new.password));
  perform pg_advisory_xact_lock(hashtextextended('store_users_senha_unica:' || new.store_id::text, 0));
  if exists (
    select 1 from store_users o
     where o.store_id = new.store_id and o.id <> new.id
       and o.role <> 'open'
       and lower(btrim(o.password)) = v_chave
       and (not o.must_change_password or not new.must_change_password)
  ) then
    raise exception 'Essa senha já está em uso por outra pessoa, escolha outra.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_store_users_senha_unica on store_users;
create trigger trg_store_users_senha_unica
  before insert or update of password, must_change_password, store_id on store_users
  for each row execute function store_users_senha_unica();
