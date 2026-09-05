-- 071_store_omie_secrets.sql
--
-- Chave direta da Omie pra lojas que usam SÓ o ntb-vendas (sem
-- ntb-estoque) — permite registrar a NFC-e autorizada direto na Omie
-- da loja, sem passar por integração nenhuma. Write-only de verdade,
-- mesmo princípio de store_fiscal_config_secrets (migration 024) e
-- store_ntb_estoque_secrets (migration 027): zero policy de select.
-- Ver docs/superpowers/specs/2026-09-05-envio-nota-fiscal-omie-design.md.

create table if not exists store_omie_secrets (
  store_id uuid primary key references stores(id) on delete cascade,
  omie_app_key text not null,
  omie_app_secret text not null,
  updated_at timestamptz not null default now()
);

alter table store_omie_secrets enable row level security;

-- Sem policy nenhuma pra anon/authenticated: nem select, nem insert,
-- nem update — só a service role (app/api/integracao/omie-direto/
-- route.ts) escreve. Mesmo padrão de store_ntb_estoque_secrets.

-- Function security definer só pra UI saber "configurado ou não", sem
-- nunca ler a chave de volta.
create or replace function public.fetch_omie_direto_status_secure(p_store_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_existe boolean;
begin
  select exists(select 1 from store_omie_secrets where store_id = p_store_id) into v_existe;
  return jsonb_build_object('configurado', v_existe);
end;
$$;

grant execute on function public.fetch_omie_direto_status_secure(uuid) to anon, authenticated;
