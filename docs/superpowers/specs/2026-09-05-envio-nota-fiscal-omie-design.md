# Envio de nota fiscal autorizada pra Omie (ntb-vendas → ntb-estoque → Omie, ou direto)

## Contexto e objetivo

Hoje, quando o `ntb-vendas` emite uma nota fiscal (NFC-e modelo 65 ou NF-e
modelo 55) via certificado digital + SEFAZ direto (`app/api/fiscal/emitir/
route.ts`), a nota fica só no `ntb-vendas` (tabela `fiscal_notas` +
XML/PDF no Storage). Pedido do usuário (2026-09-05): sempre que a loja
tiver conexão com a Omie configurada — direta ou via `ntb-estoque` —, essa
nota também precisa ser registrada lá, pra aparecer nos relatórios/painéis
da Omie que a loja/contador já usa.

Duas populações de loja distintas:
- **Loja com `ntb-estoque` também**: já existe uma integração (Ordem de
  Produção automática, `store_ntb_estoque_secrets` ↔
  `lojas.integracao_api_key`) e o `ntb-estoque` já tem as credenciais Omie
  da loja (`omie_app_key`/`omie_app_secret`) — reaproveita esse caminho.
- **Loja só com `ntb-vendas`** (não usa `ntb-estoque`): precisa de uma
  chave Omie própria, cadastrada direto no `ntb-vendas`, e chamar a Omie
  sem passar pelo estoque.

## O que a API da Omie oferece (pesquisa feita nesta sessão)

Dois métodos, um por modelo de documento, ambos recebem o documento **já
autorizado pela SEFAZ** (não é uma emissão nova — é um registro/import do
que já existe):

- **NFC-e (modelo 65) → `IncluirNfce`** (serviço
  `produtos/cupomfiscalincluir/`). Payload estruturado: `NFe` (chNFe, nNF,
  série, `det`/itens, total), `nfce` (nfceXml, nfceMd5, nfceProt — o XML/
  protocolo reais da SEFAZ), `formasPag`, `caixa`, `emissor`. **Confirmado
  na documentação oficial da Omie (fetch feito nesta sessão): não existe
  nenhum campo de observação/texto livre nesse payload** — não dá pra
  anotar "enviado via integração X" dentro da nota em si.
- **NF-e (modelo 55) → `ImportarNFe`** (serviço `produtos/nfe/`). Import
  puro de XML+MD5 — ainda mais simples que o de NFC-e, sem estrutura de
  campos própria (o XML assinado já é o documento inteiro).

Não existe hoje, em nenhum dos dois repositórios, nenhuma linha de código
chamando esses dois métodos (`grep` vazio no `ntb-estoque`).

## Achado de segurança que bloqueia qualquer implementação até ser corrigido

`ehChamadaDeEscrita` (`ntb-estoque/lib/omie/client.ts`) — a função que
decide se uma loja de teste (`is_test=true`) deve ter a chamada à Omie
**simulada** em vez de executada de verdade — só reconhece chamadas que
começam com `Incluir|Alterar|Excluir|Concluir|Reverter`. `ImportarNFe` (e
`ImportarNFCe`/`ImportarCTe`/`ImportarCfeSat`, todos métodos de escrita
reais da Omie) **não bate nesse regex**. Sem corrigir isso primeiro, uma
loja de teste do `ntb-estoque` chamando `ImportarNFe` escreveria de
verdade na Omie de um cliente real — a mesma classe de vazamento que todo
o sistema de "Lojas de Teste" existe pra prevenir.

**Correção obrigatória, antes de qualquer código novo desta spec**:

```ts
function ehChamadaDeEscrita(call: string): boolean {
  return /^(Incluir|Alterar|Excluir|Concluir|Reverter|Importar)/.test(call)
}
```

## Arquitetura: dois caminhos, mutuamente exclusivos por loja

Prioridade quando os dois estiverem configurados na mesma loja: **Caminho
A vence** (é a integração mais completa, já linka a nota ao estoque via
Ordem de Produção).

```
                    fiscal_notas vira 'autorizada'
                    (app/api/fiscal/emitir/route.ts,
                     ntb-vendas, depois do cStat=100)
                              │
                    tem store_ntb_estoque_secrets
                    configurado e ativo?
                    ┌─────────┴─────────┐
                   sim                  não
                    │                    │
         Caminho A: dispara         tem store_omie_secrets
         pro ntb-estoque            preenchido?
         (fire-and-forget,          ┌────┴────┐
          after())                 sim        não
                    │               │          │
         ntb-estoque decide    Caminho B:   no-op
         modelo 65/55 e        chama a       (loja não
         chama IncluirNfce/    Omie DIRETO   quer Omie)
         ImportarNFe           (mesma
                                decisão de
                                modelo)
```

### Caminho A — loja com `ntb-estoque`

**`ntb-vendas`** (`app/api/fiscal/emitir/route.ts`): logo depois do insert
de `fiscal_notas` com `status: 'autorizada'` (mesmo ponto onde `chave`,
`resposta.protocolo`, `xmlAssinado`/`nfeProc`, `modelo`, `config.ambiente`
já estão resolvidos — não precisa buscar nada novo), dispara via `after()`
(mesmo padrão já usado pro dual-write do Contabo, ver AGENTS.md — nunca
`void (async () => {})()` sozinho, não é confiável em produção) um POST
pra `${ntb_estoque_url}/api/integracao/nota-fiscal`, autenticado com
`Authorization: Bearer ${ntb_estoque_api_key}` — a MESMA credencial de
`store_ntb_estoque_secrets` já usada por `triggerOrdemProducao()`. Corpo:
`{ modelo, ambiente, chave, protocolo, numero, serie, xml: nfeProc,
valor_total }`.

Igual ao resto da rota a partir do `cStat=100`: falha nesse disparo NUNCA
marca a nota como erro — só loga. Nada muda no formato de retorno da rota
pro client.

**`ntb-estoque`** (novo `app/api/integracao/nota-fiscal/route.ts`, mesmo
padrão de auth de `app/api/integracao/ordem-producao/route.ts` — resolve
`loja_id` por `lojas.integracao_api_key`):

1. Busca a loja (`omie_app_key`, `omie_app_secret`, `is_test`). Sem chave
   Omie configurada: responde `{ skipped: true, reason: 'Loja sem Omie
   configurada' }` (mesmo princípio de "loja sem integração
   configurada" que a rota de Ordem de Produção já usa).
2. `modelo === '65'` → `omieRequest('IncluirNfce', payload, { app_key,
   app_secret, is_test })`; `modelo === '55'` → `omieRequest('ImportarNFe',
   payload, { ... })`. `is_test` sempre explícito (nunca via cast solto —
   ver achado já documentado no AGENTS.md do ntb-estoque sobre esse tipo
   de bug invisível ao `tsc`).
3. Grava o resultado (sucesso ou erro) em `integration_attempts` — tabela
   já existente, usada por outros fluxos Omie deste projeto —, com uma
   coluna/campo indicando a origem como "Norte Para Negócios" (só
   instrumentação interna; a Omie em si não recebe esse rótulo, porque
   não tem onde colocá-lo — ver achado acima).

### Caminho B — loja só com `ntb-vendas`

**Cadastro** (`store_omie_secrets`, nova tabela em `ntb-vendas`): mesmo
padrão write-only já usado por `store_fiscal_config_secrets`/CSC — sem
NENHUMA policy de SELECT, só grava via `app/api/certificado`
(reaproveita a mesma rota de servidor, ganha mais um bloco de escrita com
service role key). Campos: `store_id`, `omie_app_key`, `omie_app_secret`.
UI: `StoreAdminView` → Notas Fiscais, novo bloco "Integração direta com a
Omie" ao lado do bloco de Certificado/CSC já existente — os campos nunca
voltam preenchidos depois de salvos (mesmo comportamento do CSC).

**Client Omie novo em `ntb-vendas`** (`lib/omie/client.ts`, não
compartilhado com `ntb-estoque` — repositórios/deploys separados, mesmo
princípio já usado pra tudo neste projeto). Escopo mínimo, só o
necessário pra esta feature:
- `omieRequest(call, payload, { appKey, appSecret })` — POST genérico pro
  endpoint da Omie (`app_key`/`app_secret` no corpo, convenção padrão da
  API).
- `incluirNfce(...)` / `importarNFe(...)` — os dois métodos, nada mais.

**Diferença de risco importante em relação ao Caminho A**: o `ntb-vendas`
não tem (e não é escopo desta spec construir) o conceito de "loja de
teste ligada à Omie" que o `ntb-estoque` tem (`is_test`, chamadas de
escrita sempre simuladas). Ou seja, **o Caminho B sempre escreve de
verdade na Omie quando chamado**. Isso é aceitável porque só dispara
depois de `cStat=100` — a nota já é real, autorizada pela SEFAZ, então
"escrever de verdade" é o comportamento desejado, não um risco de teste
acidental. Mas **testar este caminho específico** (antes de ativar em
produção) não pode usar uma loja de teste do `ntb-vendas` normal (ZZ
Laboratorio) com credencial Omie de verdade — precisa de uma conta/loja
de teste dedicada dentro da própria Omie (sandbox real do lado deles), ou
não deve ser testado com chamada de escrita nenhuma antes da revisão de
código.

**No `app/api/fiscal/emitir/route.ts`**: depois do bloco do Caminho A (que
já checa `store_ntb_estoque_secrets`), se esse caminho não se aplicar
(sem integração configurada/ativa), checa `store_omie_secrets` — se
preenchido, monta o mesmo payload e chama `incluirNfce`/`importarNFe`
direto, sem nenhuma chamada HTTP intermediária (é tudo no mesmo processo
server-side do `ntb-vendas`). Mesmo princípio de erro do Caminho A: falha
aqui não muda o status da nota, só loga (`motivo_erro` já existe na linha,
mas não deve ser sobrescrito — usar `console.error`, mesmo padrão do
resto da rota pra falhas pós-autorização).

## Fora de escopo (registrado, não construído agora)

- **Reconciliação/retry de falha de envio pra Omie** — mesmo princípio já
  demonstrado nas "142 notas fiscais ausentes" do `ntb-estoque`: construir
  só se aparecer falha real, não preventivamente.
- **UI pra ver o histórico de envio pra Omie** (sucesso/erro por nota) —
  pode ser um filtro futuro na tela de Notas Fiscais, não pedido agora.
- **Loja de teste ligada à Omie no lado `ntb-vendas`** — não existe hoje,
  não é construída por esta spec (ver risco do Caminho B acima).

## Testes planejados

1. **Correção de segurança primeiro** (`ehChamadaDeEscrita` +
   `Importar`), sozinha, confirmando que uma chamada `ImportarNFe`/
   `ImportarNFCe` numa loja de teste do `ntb-estoque` passa a ser
   simulada (não bate na Omie real) — mesmo teste que já existe pros
   outros verbos.
2. **Caminho A**: loja de teste do `ntb-vendas` (ZZ Laboratorio) ligada a
   uma loja de teste do `ntb-estoque` (`is_test=true`) — confirmar que o
   POST chega, a chamada Omie é simulada, e o resultado aparece em
   `integration_attempts`.
3. **Caminho B**: sem loja de teste Omie disponível hoje — o teste real
   fica condicionado a ter uma conta/CNPJ de teste na própria Omie
   disponível; até lá, valida-se só com `tsc`/build + mock manual da
   chamada (nunca contra a Omie real).
