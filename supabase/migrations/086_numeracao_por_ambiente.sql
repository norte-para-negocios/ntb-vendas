-- Numeração fiscal separada por ambiente: a série/contador de homologação
-- (nfce_serie/nfce_ultimo_numero, nfe_*) não pode continuar valendo quando a
-- loja vira produção — os números de teste não existem na SEFAZ de produção
-- e a produção pode já ter números usados por outro sistema.
alter table store_fiscal_config
  add column if not exists nfce_serie_producao integer,
  add column if not exists nfce_ultimo_numero_producao integer not null default 0,
  add column if not exists nfe_serie_producao integer,
  add column if not exists nfe_ultimo_numero_producao integer not null default 0;

create or replace function public.increment_fiscal_numero_secure(p_store_id uuid, p_modelo text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_novo int;
  v_amb text;
begin
  select ambiente into v_amb from store_fiscal_config where store_id = p_store_id;
  if v_amb is null then
    raise exception 'store_fiscal_config não encontrado pra store_id %', p_store_id;
  end if;
  if p_modelo = '55' and v_amb = 'producao' then
    update store_fiscal_config set nfe_ultimo_numero_producao = nfe_ultimo_numero_producao + 1, updated_at = now()
      where store_id = p_store_id returning nfe_ultimo_numero_producao into v_novo;
  elsif p_modelo = '55' then
    update store_fiscal_config set nfe_ultimo_numero = nfe_ultimo_numero + 1, updated_at = now()
      where store_id = p_store_id returning nfe_ultimo_numero into v_novo;
  elsif p_modelo = '65' and v_amb = 'producao' then
    update store_fiscal_config set nfce_ultimo_numero_producao = nfce_ultimo_numero_producao + 1, updated_at = now()
      where store_id = p_store_id returning nfce_ultimo_numero_producao into v_novo;
  elsif p_modelo = '65' then
    update store_fiscal_config set nfce_ultimo_numero = nfce_ultimo_numero + 1, updated_at = now()
      where store_id = p_store_id returning nfce_ultimo_numero into v_novo;
  else
    raise exception 'modelo inválido: %', p_modelo;
  end if;
  return v_novo;
end;
$function$;

notify pgrst, 'reload schema';
