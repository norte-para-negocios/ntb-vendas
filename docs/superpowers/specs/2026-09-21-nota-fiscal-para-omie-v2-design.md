# Nota fiscal → Omie (v2): registrar a NFC-e autorizada no Omie, sem mexer no estoque

**Substitui em parte** `2026-09-05-envio-nota-fiscal-omie-design.md` (que continua valendo para NF-e modelo 55 e para a arquitetura dos caminhos A/B). Esta v2 corrige o que a pesquisa de 2026-09-21 mostrou e adiciona as regras de segurança que faltavam.

## 1. Objetivo

Toda NFC-e **de produção** autorizada pela SEFAZ no NTB Vendas passa a ser registrada também no Omie da loja, para o Ramon e o contador enxergarem as vendas/notas nos painéis do Omie. O Omie **não** baixa estoque por causa disso (a baixa já vem da Ordem de Produção). Conta a receber no Omie é **opcional e desligada por padrão**.

Decisões do dono (2026-09-21): opção **A** (registrar a venda com a chave da NFC-e); financeiro **desligado por padrão**.

## 2. O que mudou em relação à spec de 05/09

| Ponto | Spec 05/09 | v2 |
|---|---|---|
| Método Omie p/ NFC-e | `IncluirNfce` (payload estruturado, itens, formas de pagamento) | **`ImportarNFCe`** (`v1/produtos/nfce/`): XML autorizado + MD5. Mais simples, e o XML da SEFAZ vira a fonte da verdade |
| Estoque no Omie | não tratado (risco de baixa em dobro com a Ordem de Produção) | `cNaoMovEstoque = "S"` **sempre** |
| Conta a receber | não tratado | `cNaoGerarTitulo = "S"` por padrão; configurável por loja |
| Ambiente | não tratado | **só notas de `producao`** são enviadas; homologação nunca vai ao Omie real |
| Retry | "fora de escopo" | fila simples com tentativas (§5), porque o dono pediu que queda do Omie não perca nota |
| Nome do emissor | não tratado | `emiNome="NTB Vendas"`, `emiVersao` = versão do app, `emiId` = `store_id` |

Fonte da pesquisa: docs Omie "Importando uma NFC-e por API" e "Importando pelo XML os cupons de saída" (ver memória `reference_omie_importar_nfce`).

## 3. Quando envia (regras)

Enviar quando **todas** forem verdade:
1. `fiscal_notas.status = 'autorizada'`, `modelo = '65'`, `ambiente = 'producao'`.
2. A loja tem credencial Omie utilizável (Caminho A: `store_ntb_estoque_secrets` ativo; Caminho B: `store_omie_secrets`).
3. `stores.config.omie_envio_nfce = true` (novo interruptor por loja, **default false**; ligado só pelo dono/Master Admin).
4. A nota ainda não foi enviada (`omie_status` diferente de `enviada`).

Nota que nasceu em **contingência** (tpEmis=9) só é enviada depois de virar `autorizada` na retransmissão (mesmo gatilho, `salvarNotaAutorizada`).

## 4. Qual caminho, por loja

- **Caminho A** (loja ligada ao `ntb-estoque` de produção): o `ntb-estoque` chama o Omie com as credenciais que já tem.
- **Caminho B** (loja só com Vendas, ou Vendas ligado a loja de teste do estoque): Vendas chama o Omie direto com `store_omie_secrets` (migration 071, já existe).
- **Sertão (caso real hoje):** o Vendas do Sertão está ligado à loja 12 do estoque (`is_test`, escrita simulada) **de propósito** e o dono proibiu ligar à loja 4 de produção. Portanto o Sertão usa o **Caminho B**: o **dono cadastra a App Key/Secret do Omie do Sertão pela tela** (Administração → Notas Fiscais → "Integração direta com a Omie"). Eu nunca copio essa credencial de um banco para o outro.

A prioridade da spec de 05/09 ("A vence B") passa a valer só quando a loja tem integração de produção com o estoque; loja ligada a estoque `is_test` cai no B.

## 5. Modelo de dados e fila

Migration nova (`078_fiscal_notas_omie.sql`), colunas em `fiscal_notas`:

```sql
alter table fiscal_notas
  add column if not exists omie_status text not null default 'nao_aplicavel'
    check (omie_status in ('nao_aplicavel','pendente','enviada','erro','desistiu')),
  add column if not exists omie_tentativas int not null default 0,
  add column if not exists omie_proxima_tentativa timestamptz,
  add column if not exists omie_id_cupom text,
  add column if not exists omie_erro text,
  add column if not exists omie_enviada_em timestamptz;
create index if not exists fiscal_notas_omie_pendentes_idx
  on fiscal_notas (omie_proxima_tentativa) where omie_status in ('pendente','erro');
```

Fluxo:
1. Nota vira `autorizada` (produção, modelo 65, regras do §3 ok) → `omie_status='pendente'`, `omie_proxima_tentativa=now()`.
2. `after()` tenta enviar na hora (não bloqueia a venda; padrão já usado no dual-write).
3. Falha ou Omie fora do ar → `omie_status='erro'`, guarda `omie_erro`, incrementa tentativas, backoff: 2 min, 10 min, 1 h, 6 h, 24 h.
4. O ciclo de retransmissão que já roda a cada 2 min (`verificarNotasEmContingencia`) também varre `omie_proxima_tentativa <= now()` e reenvia.
5. Após 5 tentativas → `desistiu` (visível na tela de Notas Fiscais; reenvio manual por botão).

Nada disso altera `fiscal_notas.status` (a nota continua `autorizada` mesmo se o Omie falhar), exatamente como o resto da rota pós-autorização.

## 6. Chamada ao Omie

Novo `lib/omie/importarNfce.ts` (Vendas). Entrada: `xmlNfeProc` (o arquivo em `fiscal-documentos/<store>/<chave>.xml`), `chave`, credenciais, opções.

```ts
// forma da requisição
{
  call: 'ImportarNFCe',
  app_key, app_secret,
  param: [{
    emiNome: 'NTB Vendas', emiVersao: APP_VERSION, emiId: storeId,
    chNFe: chave,
    nfceXml: sanitizarXmlParaOmie(xml),   // §6.1
    nfceMd5: md5(nfceXml),                // do texto JÁ sanitizado
    cNaoMovEstoque: 'S',
    cNaoGerarTitulo: config.omie_gerar_titulo ? 'N' : 'S',
    cIncluirProduto: 'N',
  }]
}
// sucesso: cCodStatus === '0' → guarda idCupom em omie_id_cupom
```

### 6.1 Sanitização do XML (regras da doc do Omie)
Remover acentos; escapar `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`, `"`→`&quot;`, `'`→`&apos;`, `|`→`&#124;`; remover `\`. **Atenção:** a doc não diz se o escape vale só dentro do texto dos campos ou sobre o XML inteiro (as tags `<` do próprio XML seriam quebradas). O comportamento correto é o primeiro teste da §8 — não presumir.

### 6.2 Idempotência
A chave de acesso é única. Se o Omie devolver "já importada", tratar como **sucesso** (`enviada`). A mensagem exata só se descobre testando (§8); até lá, o reenvio de nota já enviada é evitado pelo `omie_status`.

### 6.3 Produtos que o Omie não conhece
`cIncluirProduto='N'` significa que item sem cadastro correspondente pode falhar a importação. Os produtos do Sertão têm `omie_codigo` real, exceto os 8 indisponíveis (não vendem). O comportamento real fica registrado no teste §8.3; se falhar por produto, o erro aparece em `omie_erro` e a nota não é perdida.

## 7. Segurança

- **Homologação nunca vai ao Omie** (nota sem valor fiscal; regra do §3.1). Cobrir com teste unitário.
- Credencial Omie é write-only (mesmo padrão de `store_fiscal_config_secrets`): a UI mostra só "configurado / não".
- Nenhuma escrita no Omie real sem ok explícito do dono; o interruptor `omie_envio_nfce` nasce desligado.
- Log nunca imprime `app_key`, `app_secret` nem o XML inteiro.

## 8. Testes (ordem obrigatória)

1. **Unitário, sem rede:** `sanitizarXmlParaOmie` e `md5` com um XML real de homologação já guardado (as regras de acento/escape; o caso `&`, aspas e `|`); regra "homologação não envia"; cálculo de backoff.
2. **Unitário com Omie falso (servidor HTTP local):** sucesso, `cCodStatus != 0`, timeout, 500 → `omie_status` e `omie_tentativas` corretos; "já importada" vira `enviada`.
3. **Real, controlado, com o dono presente:** 1 NFC-e **de produção** de valor baixo, interruptor ligado só no Sertão, Caminho B com a credencial cadastrada por ele. Conferir no painel "NFC-e, CF-e SAT e ECF" do Omie que a nota apareceu, que o **estoque não mexeu** e que **nenhum título** foi criado. Registrar as mensagens reais de erro/duplicidade na memória.
4. **Falha proposital:** credencial errada → nota continua `autorizada`, `omie_status='erro'`, retry em 2 min, venda não bloqueada.

## 9. Fora de escopo

- NF-e modelo 55 (segue a spec de 05/09, `ImportarNFe`); só depois desta.
- Tela de histórico de envios além de um selo "Omie: enviada/erro" na lista de Notas Fiscais (pequeno, entra no plano).
- Correção do `ehChamadaDeEscrita` do `ntb-estoque` para `Importar*` (necessária **só** para o Caminho A; para o Sertão via B não bloqueia, mas deve ser feita antes de qualquer loja usar o A).

## 10. Perguntas que continuam abertas

1. O financeiro do Sertão já lança as vendas por outro caminho? (define se `omie_gerar_titulo` fica sempre desligado.)
2. Cliente "consumidor" padrão no Omie: o Omie exige um cadastrado para a importação? (descobrir no teste §8.3.)
3. O dono/Ramon aceita cadastrar a credencial do Omie do Sertão na tela do Vendas?
