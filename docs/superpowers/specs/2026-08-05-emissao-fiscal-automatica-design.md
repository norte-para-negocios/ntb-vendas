# Emissão fiscal automática (NFC-e/NF-e) ao fechar pedido

Data: 2026-08-05
Status: aprovado, aguardando plano de implementação

## Contexto

`store_fiscal_config`/`store_fiscal_certificate*` (migrations 006, 011, 012, 024, 025)
já guardam todos os campos de configuração do emissor fiscal por loja — certificado
digital, CSC/CSCID por ambiente, dados de identificação da empresa, padrões de
imposto — mas nada disso emite nota de verdade ainda. É armazenamento puro.

Entre 06/07 e 04/08/2026, testes manuais fora do app (scripts standalone, nunca
integrados, sem segredo commitado — ver `AGENTS.md`, seção "Backlog / Próximos
passos") validaram ponta a ponta contra a SEFAZ real, sempre em homologação:

- **NF-e modelo 55**: autorizada (`cStat=100`) contra a infraestrutura própria da
  SEFAZ-BA, usando o certificado real de uma loja (AMJ Santos Restaurante).
- **NFC-e modelo 65**: autorizada (`cStat=100`) em 04/08 — o bloqueio anterior
  (`cStat=702` "NFC-e não é aceita pela UF do Emitente", visto 3x entre 06/07 e
  03/08 e mal interpretado como pendência administrativa de credenciamento) era na
  verdade endpoint errado: a Bahia delega o modelo 65 pra SEFAZ Virtual do RS
  (SVRS), não atende no próprio webservice da BA.
- Assinatura XML (`xml-crypto`, enveloped + C14N + SHA1), cadeia de certificado
  intermediário montada manualmente (o `.pfx` só tem o certificado folha), mTLS,
  QR Code da NFC-e (hash SHA1 com o CSC) e geração de DANFE/cupom em PDF
  (`node-sped-pdf`) — tudo confirmado funcionando com dados reais.

Esta spec cobre transformar essa prova de conceito em funcionalidade real do app:
disparo automático ao fechar mesa/balcão, com o mesmo padrão fire-and-forget já
usado pela integração `ntb-estoque` (Ordem de Produção).

**Regra crítica que já vale pra todo o projeto (não nova, só reafirmada aqui):
sempre testar em homologação, nunca emitir nota real durante desenvolvimento.**

## Decisões já tomadas com o usuário

1. **Modelo fiscal**: os dois (NFC-e modelo 65 e NF-e modelo 55), configurável por
   loja — cada loja escolhe qual documento emite automaticamente, não os dois pra
   toda venda.
2. **Falha na emissão**: fechamento de mesa/pedido nunca trava. A nota fica
   `pendente`/`erro`, lojista reemite manualmente depois. Mesmo princípio do
   `triggerOrdemProducao` (erro na integração nunca desfaz uma ação que já
   aconteceu).
3. **NCM**: campo por produto (não um único padrão por loja) — mais correto
   fiscalmente, aceito o custo de o lojista precisar preencher o cadastro antes da
   primeira nota sair.

## Escopo desta fase

Dentro: NCM por produto, construção de XML (NF-e e NFC-e) com itens reais do
pedido, assinatura, transmissão contra a SEFAZ (infraestrutura própria da BA pra
modelo 55, SVRS pra modelo 65 — hoje todas as lojas reais são da Bahia), tratamento
de autorização/rejeição, geração de PDF (DANFE/cupom), disparo automático ao
fechar mesa (`closeTableSession`) e balcão (`closeCounterOrder`), tela de
acompanhamento e reemissão manual no admin.

Fora de escopo (não pedido, cada um vira spec própria se/quando for a vez):

- Integração com Omie pra emissão fiscal (via anotada em 2026-07-03, não decidida).
- Suporte a outros estados além da Bahia — o mapa de endpoints fica isolado num
  módulo próprio, fácil de estender, mas só a BA é implementada agora.
- CT-e/MDF-e (campos existem em `store_fiscal_config` desde a migration 024, mas
  não fazem parte do fluxo "fechar pedido").
- Cancelamento/carta de correção de nota já autorizada.
- Qualquer mudança em `ambiente` de loja alguma — sempre respeita o que já está
  salvo (default `homologacao`), nunca decidido pelo código.

## Arquitetura

### Modelo de dados

- `products`: nova coluna `ncm` (text, nullable) — sem NCM, a emissão daquele
  produto falha e a nota cai em `erro` com motivo explícito (não trava o pedido,
  mesma política de falha já decidida).
- `store_fiscal_config`: nova coluna `modelo_emissao_automatica`
  (`'nenhuma' | 'nfce' | 'nfe'`, default `'nenhuma'`). Só dispara emissão quando
  != `'nenhuma'` e o resto da config (certificado + série do modelo escolhido)
  está completo — do contrário a rota devolve `{skipped: true}`, mesmo padrão do
  `triggerOrdemProducao`.
- `store_fiscal_certificates`: nova coluna `chain_pem` (cadeia da AC intermediária
  em PEM) — resolvida **uma vez, no upload do certificado** (`/api/certificado`),
  não a cada emissão. Motivo: a extração depende de baixar o certificado da AC
  emissora a partir da URL "CA Issuers" do certificado da loja, uma dependência
  externa que não deve virar ponto de falha de toda emissão.
- Nova tabela `fiscal_notas`:
  ```
  id uuid pk
  store_id uuid references stores(id)
  table_id uuid null   -- fechamento de mesa
  order_id uuid null   -- fechamento de balcão (um dos dois sempre preenchido)
  modelo text check in ('55','65')
  ambiente text check in ('homologacao','producao')
  status text check in ('pendente','autorizada','rejeitada','erro')
  chave_acesso text
  numero int
  serie int
  protocolo text
  motivo_erro text
  valor_total numeric(10,2)
  xml_path text   -- storage
  pdf_path text   -- storage
  created_at, updated_at timestamptz
  ```
  RLS: `select` liberado pra `anon`/loja (mesmo nível de `store_fiscal_certificates`
  — não é dado sigiloso, é histórico de vendas da própria loja). Toda escrita só
  via service role (rota de API), mesmo princípio de `store_fiscal_config`.
- Nova bucket privada `fiscal-documentos` (XML autorizado + PDF) — mesmo padrão de
  `store-certificates`: sem policy de select/insert pra `anon`, só a rota de
  servidor grava; download pelo admin via signed URL gerada sob demanda.
- Function Postgres `increment_fiscal_numero_secure(store_id, modelo)` — incremento
  atômico de `nfe_ultimo_numero`/`nfce_ultimo_numero` (`UPDATE ... SET x = x + 1
  RETURNING x`), evita duas emissões concorrentes (dois garçons fechando mesas ao
  mesmo tempo) colidirem no mesmo número.

### Módulo de emissão (`lib/fiscal/`)

Generaliza `scripts/nfce-referencia/gerar-nfce-teste.mjs` (referência técnica já
validada contra a SEFAZ real) pra: múltiplos itens reais, os dois modelos
parametrizados, dados vindos do banco em vez de hardcoded/env var.

- **`certificado.ts`** — extrai certificado + chave privada do `.pfx` usando a
  senha guardada em `store_fiscal_certificate_secrets` (nova dependência:
  `node-forge`, já que o `crypto` nativo do Node não parseia PKCS12 em
  cert+key separados). Monta a cadeia completa (leaf + `chain_pem` já resolvido no
  upload) pro handshake mTLS.
- **`xml.ts`** — monta `infNFe`/`enviNFe` a partir dos itens do pedido (preço e
  quantidade reais, NCM do produto), CFOP fixo `5102` (venda dentro do estado pra
  consumidor final — mesmo valor do script de referência; todas as lojas reais
  hoje são intraestaduais) e os defaults fiscais da loja (`cst_csosn_padrao`,
  `cst_pis_padrao`, `cst_cofins_padrao`, `natureza_operacao_padrao`, etc.,
  migration 025). Pra NF-e (modelo 55), inclui bloco `<dest>` com o
  CPF/CNPJ/nome capturado no fechamento (ver "Gatilho" abaixo). Pra NFC-e (modelo
  65), sem `<dest>`, com o texto obrigatório de homologação no `xProd` do primeiro
  item quando `ambiente = homologacao` (mesma regra descoberta em 04/08).
- **`assinatura.ts`** — wrapper do `xml-crypto` (nova dependência): enveloped +
  C14N + SHA1/RSA-SHA1, mesma receita já provada.
- **`qrcode.ts`** (só NFC-e) — monta o QR Code (versão 2, modo online) com o hash
  SHA1 do CSC da loja/ambiente correspondente.
- **`soap.ts`** — mapa fixo de endpoints da Bahia: modelo 55 direto na
  infraestrutura própria da SEFAZ-BA, modelo 65 via SVRS — par
  homologação/produção conforme `store_fiscal_config.ambiente` daquela loja.
  Isolado num módulo só pra facilitar adicionar outras UFs depois, sem reescrever
  o resto do pipeline.
- **`pdf.ts`** — `node-sped-pdf` (nova dependência) gera DANFE (`DANFe`) ou cupom
  (`DANFCe`) a partir do `nfeProc` (XML assinado + protocolo de autorização).

### Gatilho e integração com o fechamento

`closeTableSession`/`closeCounterOrder` (`lib/api.ts`) ganham uma segunda chamada
fire-and-forget, no mesmo padrão de `triggerOrdemProducao`, pra uma nova rota
`app/api/fiscal/emitir` (service role, mesmo motivo de `/api/certificado`: precisa
ler certificado/senha/CSC que a chave anônima nunca pode ver):

- Fechamento de mesa → `{ tableId }`, agrega todos os `order_items` de todos os
  pedidos daquela sessão de mesa (mesma soma que já alimenta o valor cobrado).
- Fechamento de balcão → `{ orderId }`, um pedido só.

A rota resolve a config da loja, decide se emite (config completa +
`modelo_emissao_automatica != 'nenhuma'`) e qual modelo, roda o pipeline
`certificado → xml → assinatura → soap → pdf`, grava o resultado em `fiscal_notas`.
Erro em qualquer etapa (SEFAZ fora do ar, rejeição, NCM faltando, certificado
vencido) grava a linha como `erro`/`rejeitada` com `motivo_erro` legível — nunca
propaga exceção que travaria o fechamento, que já aconteceu antes dessa chamada.

**NF-e (modelo 55) precisa de destinatário.** Como este projeto não tem captura de
identidade do cliente (item já listado como standby no backlog), as duas telas que
disparam fechamento — `BillSplitter`/fechar mesa e fechar pedido de balcão — ganham
um campo opcional de CPF/CNPJ **só quando a loja está configurada pra
`modelo_emissao_automatica = 'nfe'`**. Se vazio, a nota fica `pendente` com motivo
"falta documento do destinatário" e o lojista completa depois na tela de
reemissão. NFC-e não precisa disso — sem `<dest>`, igual ao script de referência.

### Admin UI (`StoreModule.tsx`)

- Nova aba "Notas Fiscais": lista `fiscal_notas` da loja (data, valor, modelo,
  status com badge, chave de acesso), botão "baixar PDF" (signed URL sob demanda),
  botão "reemitir" nas linhas `erro`/`pendente` (repete o pipeline, opcionalmente
  com o CPF/CNPJ preenchido pelo lojista se estava faltando).
- Seção fiscal existente ganha o seletor "Modelo de emissão automática"
  (Nenhuma/NFC-e/NF-e) — só habilitado quando certificado + config mínima da loja
  já estão preenchidos (mesma checagem de completude que a rota de emissão usa).
- Formulário de cadastro/edição de produto ganha campo NCM.

### Guard-rails

- Nada no código decide ou muda `ambiente` de loja alguma — sempre o valor já
  salvo em `store_fiscal_config` (default `homologacao`).
- Todo teste de código novo (item com NCM novo, edge case de XML, etc.) roda contra
  homologação primeiro. Emissão real em produção só com confirmação explícita do
  usuário no momento, loja a loja — mesma regra já em vigor no projeto.
- Certificado/senha/CSC nunca aparecem em log, nunca são commitados — mesmo
  princípio já seguido nos testes manuais de 06/07 a 04/08.

## Fora de escopo / não resolvido aqui

- Captura de identidade do cliente além do CPF/CNPJ pontual no fechamento com
  NF-e (sem cadastro de cliente recorrente).
- Cancelamento de nota, carta de correção, inutilização de numeração pulada.
- Expansão pra UFs além da Bahia.
- Retry automático de nota `erro`/`pendente` (fica manual, botão no admin) —
  automatizar reemissão é natural extensão futura, não necessária pra "começar a
  funcionar".
