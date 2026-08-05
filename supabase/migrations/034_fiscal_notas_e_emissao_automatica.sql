-- Emissão fiscal automática (2026-08-05) — ver
-- docs/superpowers/specs/2026-08-05-emissao-fiscal-automatica-design.md.

-- Loja escolhe qual modelo emite automaticamente ao fechar pedido. 'nenhuma'
-- (default) mantém o comportamento atual: nada é emitido.
alter table store_fiscal_config add column if not exists modelo_emissao_automatica text
  not null default 'nenhuma' check (modelo_emissao_automatica in ('nenhuma', 'nfce', 'nfe'));

-- Cadeia da AC intermediária em PEM, resolvida uma vez no upload do
-- certificado (não a cada emissão — ver seção "Arquitetura" da spec). Mesmo
-- nível de sensibilidade dos metadados de store_fiscal_certificates (não é
-- segredo — é público, tipo um certificado raiz).
alter table store_fiscal_certificates add column if not exists chain_pem text;

create table if not exists fiscal_notas (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  table_id uuid references tables(id) on delete set null,
  order_id uuid references orders(id) on delete set null,
  modelo text not null check (modelo in ('55', '65')),
  ambiente text not null check (ambiente in ('homologacao', 'producao')),
  status text not null check (status in ('pendente', 'autorizada', 'rejeitada', 'erro')),
  chave_acesso text,
  numero int,
  serie int,
  protocolo text,
  motivo_erro text,
  valor_total numeric(10,2),
  xml_path text,
  pdf_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table fiscal_notas enable row level security;

-- Leitura liberada pra anon/loja, mesmo nível de store_fiscal_certificates:
-- não é dado sigiloso, é histórico de vendas da própria loja (a UI do admin
-- precisa listar). Escrita só via service role (rota app/api/fiscal/emitir).
drop policy if exists "fiscal_notas_select_anon" on fiscal_notas;
create policy "fiscal_notas_select_anon" on fiscal_notas
  for select to anon, authenticated using (true);

create index if not exists fiscal_notas_store_id_idx on fiscal_notas(store_id);
create index if not exists fiscal_notas_status_idx on fiscal_notas(status);

-- Bucket privado dos documentos fiscais gerados (XML autorizado + PDF) —
-- mesmo padrão de store-certificates: sem policy de select/insert pra anon,
-- só a rota de servidor grava; download pelo admin via signed URL sob
-- demanda (nunca a URL pública direta).
insert into storage.buckets (id, name, public)
values ('fiscal-documentos', 'fiscal-documentos', false)
on conflict (id) do nothing;

-- Incremento atômico do número de NF-e/NFC-e — evita duas emissões
-- concorrentes (dois garçons fechando mesas ao mesmo tempo) colidirem no
-- mesmo número. p_modelo: '55' ou '65'.
create or replace function public.increment_fiscal_numero_secure(p_store_id uuid, p_modelo text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_novo int;
begin
  if p_modelo = '55' then
    update store_fiscal_config set nfe_ultimo_numero = nfe_ultimo_numero + 1, updated_at = now()
      where store_id = p_store_id
      returning nfe_ultimo_numero into v_novo;
  elsif p_modelo = '65' then
    update store_fiscal_config set nfce_ultimo_numero = nfce_ultimo_numero + 1, updated_at = now()
      where store_id = p_store_id
      returning nfce_ultimo_numero into v_novo;
  else
    raise exception 'modelo inválido: %', p_modelo;
  end if;

  if v_novo is null then
    raise exception 'store_fiscal_config não encontrado pra store_id %', p_store_id;
  end if;

  return v_novo;
end;
$$;

grant execute on function public.increment_fiscal_numero_secure(uuid, text) to service_role;
