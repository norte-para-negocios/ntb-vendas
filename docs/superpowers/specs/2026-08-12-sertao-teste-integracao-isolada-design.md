# Sertão Teste — integração isolada NTB Vendas × NTB Estoque — Design

**Data:** 2026-08-12

**Gatilho:** o NTB Vendas dispara emissão de nota fiscal (direto pro
SEFAZ, sem Omie) e Ordem de Produção no NTB Estoque (via Omie de
verdade) ao fechar uma venda. Hoje só a loja "Vinhas & Vinhetos" tinha
essa integração de OP configurada e testada. Pedido: criar uma loja de
teste pro "Sertão" (nome fantasia real: "O Sertão Vai Virar Mar", já
marcada no NTB Estoque como "produção protegida — nunca testar escrita
ao vivo"), visível só pra admin (usuário) + Ramon + devs, que gera nota
em homologação e Ordem de Produção real-porém-isolada, **sem nenhuma
chamada à Omie** e sem afetar nenhum dado/relatório oficial dos dois
sistemas.

## Contexto já investigado hoje (não re-investigar)

**NTB Vendas** (repo "/Users/joaquimsalles/Projects/norte para
negocios/ntb vendas"):
- Emissão fiscal (`app/api/fiscal/emitir/route.ts`) é direta pro SEFAZ
  via certificado A1, já com ambiente `homologacao`/`producao` real
  (`store_fiscal_config.ambiente`, `store_fiscal_config_secrets` com
  CSC/CSCID separados por ambiente). Toda nota emitida (autorizada,
  rejeitada, com erro) já fica gravada em `fiscal_notas` (migration
  034), com `store_id` + `ambiente` + `status`.
- SEFAZ não tem webservice de "listar minhas notas" — só consulta por
  chave conhecida (`lib/fiscal/soap.ts`, `resolverEndpointsNfceConsulta`).
  Como o app já guarda tudo que emite, não precisa puxar nada de fora.
- OP no NTB Estoque é disparada por `triggerOrdemProducao()`
  (`lib/api.ts`), fire-and-forget ao fechar mesa/balcão, via
  `POST {ntb_estoque_url}/api/integracao/ordem-producao` com
  `Authorization: Bearer <api_key>` — credencial por loja em
  `store_ntb_estoque_secrets` (tabela write-only, sem policy de SELECT).
  Integração é opt-in: sem linha em `store_ntb_estoque_secrets`, a rota
  simplesmente não dispara nada (`{ skipped: true }`).
- Seletor de loja só existe pro login "universal" (`universal_users`,
  migration 015 `authenticate_universal_user_secure`, RPC
  `security definer`, sem policy de leitura direta na tabela) — mostra
  TODAS as lojas com `is_active=true` (`fetchAllStores()`, `lib/api.ts`,
  `select('*')` sem filtro de papel/permissão).
- Não existe hoje nenhum conceito de loja "de teste"/sandbox no schema
  (`stores`: `id, name, slug, logo_url, cnpj, is_active, contract_type,
  contract_period_months, activation_date, config jsonb`) nem
  granularidade de permissão dentro de `universal_users` (só
  `id, name, email, password, must_change_password, login_attempts,
  login_locked_until, created_at`).

**NTB Estoque** (repo "/Users/joaquimsalles/Projects/norte para
negocios/ntb estoque"):
- `app/api/integracao/ordem-producao/route.ts`: autenticada por
  `lojas.integracao_api_key`, chama `incluirOrdemProducao` +
  `concluirOrdemProducao` (Omie de verdade) pra cada item, loga em
  `integration_attempts`, depois `fetchOrdemProducao` pra refletir o
  estado real na tabela local `ordens_producao`. Roda sequencial (nunca
  `Promise.all`, evita concorrência na mesma conta Omie).
- `lib/auth.ts:62`, `isAdmin()` — já usado em várias telas admin-only
  hoje (`sync-status`, etc.).
- Loja "O Sertão Vai Virar Mar" (`lojas.id`, nome fantasia confirmado
  hoje via SQL) já está documentada em `AGENTS.md` como excluída de
  vários crons de escrita automática ("nunca testar escrita ao vivo").

## Parte A — NTB Vendas: loja de teste + acesso restrito

### A1. Loja "Sertão Teste" como registro NOVO e separado

Nova linha em `stores`, com `slug` próprio (ex: `sertao-teste`),
**mesmo `cnpj`** da loja real "O Sertão Vai Virar Mar" (é a mesma
empresa testando o próprio fluxo, a SEFAZ exige CNPJ real cadastrado
mesmo em homologação), `is_test = true` (coluna nova).

```sql
alter table stores add column if not exists is_test boolean not null default false;
```

Essa loja tem seu próprio `store_fiscal_config` com `ambiente =
'homologacao'` fixo (nunca alternar pra produção — reforçar isso na UI
de configuração fiscal: se `stores.is_test`, esconder ou desabilitar o
seletor de ambiente). Certificado: pode reusar o mesmo certificado A1
da loja real "Sertão" se for o mesmo CNPJ e já estiver cadastrado
(SEFAZ homologação aceita o certificado de produção normalmente — só
transmite pro endpoint de homologação) — decisão de configuração, não
de código; documentar essa possibilidade, não forçar upload de um
certificado novo.

Como é um `store_id` diferente do "Sertão" real, `fiscal_notas`,
`orders`, `tables`, etc. dessa loja já ficam automaticamente isolados
de qualquer relatório/dashboard que agrega por loja real — nenhuma
mudança adicional necessária pra isso.

### A2. Permissão granular no login universal

```sql
alter table universal_users add column if not exists pode_ver_lojas_teste boolean not null default false;
```

Setar `true` manualmente (via SQL direto, não precisa de UI) só nas
contas do usuário e do Ramon.

`authenticate_universal_user_secure` (migration 015) precisa incluir
esse campo no `jsonb_build_object('user', ...)` de retorno, senão o
cliente nunca sabe o valor (a tabela não tem policy de leitura direta).

`fetchAllStores()` (`lib/api.ts:129`) hoje é `select('*')` sem filtro —
mudar a chamada (ou adicionar uma variante) pra filtrar `is_test=false`
por padrão, incluindo `is_test=true` só quando o usuário universal
logado tiver `pode_ver_lojas_teste=true`. Como não há RLS diferenciando
por usuário nessa tabela (achado documentado hoje: RLS é permissiva em
tudo), o filtro é client-side, no componente `StoreLogin`
(`components/modules/StoreModule.tsx`) — mesma classe de "autorização é
client-side" que já é o padrão hoje neste repo, não uma regressão de
segurança nova (dado não-sigiloso: nome/slug de loja).

### A3. Integração NTB Estoque configurada só pra essa loja

`store_ntb_estoque_secrets` da loja "Sertão Teste" aponta pra um
endpoint DIFERENTE do usado pelas lojas reais — `ntb_estoque_url`
continua sendo o mesmo host, mas o path é
`/api/integracao/ordem-producao-teste` (Parte B) em vez de
`/api/integracao/ordem-producao`, com uma `api_key` própria (não é a
`integracao_api_key` real de nenhuma loja do NTB Estoque). Isso é só
configuração de dado (uma linha na tabela), sem mudança de código em
`triggerOrdemProducao()` — ele já lê `ntb_estoque_url` da tabela e bate
nesse mesmo host+path, então funciona automaticamente.

## Parte B — NTB Estoque: Ordem de Produção isolada, sem Omie

### B1. Tabela nova, sem relação com `ordens_producao`

```sql
create table if not exists ordens_producao_teste (
  id bigint generated always as identity primary key,
  loja_id bigint not null references lojas(id),
  codigo_produto bigint,
  codigo_produto_texto text not null, -- o "codigo" recebido do ntb-vendas, mesmo se não achar produto cadastrado
  quantidade numeric not null,
  pedido_ref text,
  criado_em timestamptz not null default now()
);
```

Zero índice/relação com `ordens_producao`, `movimentos`,
`posicao_estoques` ou qualquer tabela usada pelos relatórios reais —
nenhum consumidor existente do sistema sabe que essa tabela existe.

### B2. Rota nova, com chave própria, nunca chama Omie

`app/api/integracao/ordem-producao-teste/route.ts` — mesma forma de
entrada da rota real (`{ itens: [{codigo, quantidade}], pedidoRef? }`,
header `Authorization: Bearer <chave>`), mas:
- A chave é validada contra uma tabela/coluna NOVA e separada (ex:
  `lojas.integracao_teste_api_key`, nullable, só preenchida pra loja
  "Sertão" — reusa a mesma `loja_id` real do Sertão no NTB Estoque, já
  que o catálogo de produtos pra resolver `codigo → codigo_produto` já
  existe lá; não precisa duplicar cadastro de produto).
- Resolve `codigo → codigo_produto` na tabela `produtos` real (só
  leitura, sem escrita) — se não achar, grava mesmo assim com
  `codigo_produto = null` e `codigo_produto_texto` preenchido (não
  bloqueia o teste por falta de cadastro).
- **Nunca importa nem chama `lib/omie/ordem-producao.ts`** — grava
  direto em `ordens_producao_teste` com um único `INSERT`, sem
  `incluirOrdemProducao`/`concluirOrdemProducao`/`fetchOrdemProducao`.
- Não usa `logIntegrationAttempt` (essa tabela é sobre erros de
  integração REAL com o Omie — não faz sentido logar tentativa de teste
  lá).

### B3. Tela nova, só admin

Página nova (ex: `/ordem-producao/teste`), protegida por `isAdmin()`
(mesmo padrão de `sync-status`), listando `ordens_producao_teste` (sem
paginação sofisticada — volume esperado é baixíssimo, é teste manual).
Sem link nenhum a partir da navegação principal do app (só acessível
por URL direta) — reforça que não é uma feature pra uso normal.

## Fluxo completo, ponta a ponta

1. Usuário/Ramon loga no NTB Vendas com conta universal, vê "Sertão
   Teste" na lista de lojas (F outros usuários universais não veem).
2. Faz um pedido de teste, fecha a mesa/balcão.
3. NF-e/NFC-e emite em homologação de verdade contra a SEFAZ (fluxo já
   existente, sem mudança) — aparece na aba de notas fiscais da própria
   loja "Sertão Teste".
4. `triggerOrdemProducao()` dispara pro path de teste configurado —
   NTB Estoque grava em `ordens_producao_teste`, nunca toca a Omie.
5. Usuário/Ramon confere o resultado em `/ordem-producao/teste` no NTB
   Estoque (admin-only).

## Fora de escopo (explícito)

- Qualquer alteração na loja REAL "O Sertão Vai Virar Mar" (nome
  fantasia, cadastro, config fiscal) — ela continua intocada, "Sertão
  Teste" é um registro 100% novo.
- UI de administração pra ligar/desligar `pode_ver_lojas_teste` (SQL
  direto é suficiente pro volume de contas envolvidas: 2).
- Qualquer mudança no fluxo de emissão fiscal em si (já funciona,
  homologação já existe) — só a visibilidade da loja de teste é nova.
- Réplica/dual-write pro Contabo (`ordens_producao_teste` não precisa
  ir pro histórico frio — é dado de teste, descartável).
