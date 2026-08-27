-- Nota fiscal individualizada por pessoa/consumo dentro da mesma mesa
-- (pedido real, reunião com o Ramon, 2026-08-25): "se a pessoa paga
-- separado, não vai ser só uma nota... hoje você não consegue
-- individualizar a nota fiscal por uma conta". Antes disso, `fiscal_notas`
-- só sabia emitir UMA nota por venda inteira (order_id) — o índice de
-- idempotência (037) bloqueia uma segunda linha 'autorizada' pro mesmo
-- (store_id, table_id, order_id) de propósito, pra nunca duplicar
-- documento fiscal na mesma venda. Precisa de uma forma de ter VÁRIAS
-- notas autorizadas pra UMA venda (uma por pessoa), sem abrir mão dessa
-- proteção pro caso comum (uma nota só, pessoa_identificador nulo).

alter table fiscal_notas add column if not exists pessoa_identificador text;

-- Rastreia quais itens já foram cobertos por uma nota AUTORIZADA — sem
-- isso, o fechamento final da mesa (emissão automática, sem itemIds)
-- cobraria de novo itens que uma pessoa já tinha faturado individualmente
-- no meio do serviço. Nulo = item ainda não faturado em nenhuma nota.
alter table order_items add column if not exists fiscal_nota_id uuid references fiscal_notas(id) on delete set null;
create index if not exists order_items_fiscal_nota_id_idx on order_items(fiscal_nota_id) where fiscal_nota_id is not null;

-- Achado real ao aplicar esta migration (2026-08-27): o índice de 037/036
-- (sem pessoa_identificador, cobrindo o caso "uma nota só por venda") NÃO
-- está ativo em produção hoje — já existem 3 fiscal_notas autorizadas reais
-- pra "O Sertão Vai Virar Mar" com table_id/order_id nulos que violam
-- aquele índice (`fiscal_notas_unico_por_venda` original não pode estar de
-- pé com esse dado presente). Dívida pré-existente, não causada por esta
-- mudança — decidir o que fazer com documentos fiscais reais já emitidos
-- em duplicidade é decisão do usuário, fora do escopo desta task. Por
-- isso este arquivo NÃO tenta recriar o índice antigo (evita re-quebrar
-- a mesma aplicação de migration por causa de um problema não relacionado)
-- — só adiciona a proteção NOVA, restrita ao caso que esta feature usa de
-- verdade (pessoa_identificador preenchido): nunca duas notas autorizadas
-- pra mesma pessoa na mesma venda.
create unique index if not exists fiscal_notas_unico_por_pessoa on fiscal_notas (
  store_id,
  coalesce(table_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(order_id, '00000000-0000-0000-0000-000000000000'::uuid),
  pessoa_identificador
) where status = 'autorizada' and pessoa_identificador is not null;
