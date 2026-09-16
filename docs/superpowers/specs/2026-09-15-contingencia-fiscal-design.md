# Contingência Fiscal (NFC-e Offline) — Design

**Contexto:** NTB Vendas — cardápio digital/PDV. Emissão de NFC-e (modelo 65) hoje depende de uma transmissão síncrona pra SEFAZ (`app/api/fiscal/emitir/route.ts` → `lib/fiscal/soap.ts:transmitirNota`) no momento do fechamento da venda. Se a internet da loja ou o webservice da SEFAZ cair, a venda continua fechando normalmente (a emissão é fire-and-forget), mas **nenhuma nota fiscal sai** — achado ao vivo na loja Sertão em 2026-09-15, registrado em `docs/superpowers/plans` daquela sessão.

**Pedido do dono (2026-09-15):** quando não houver conexão, o sistema deve emitir a NFC-e em **modo de contingência** (previsto na legislação — "Contingência Offline", `tpEmis=9`), imprimir o cupom na hora (**2 vias**: cliente + estabelecimento) mesmo sem autorização da SEFAZ ainda, e retransmitir automaticamente pra SEFAZ assim que a conexão voltar.

## Achados técnicos que embasam este design

- `lib/fiscal/chaveAcesso.ts:montarChaveAcesso` **já aceita** um parâmetro `tpEmis` (default `1`) — a chave de acesso de 44 dígitos é inteiramente calculada localmente (módulo 11, sem round-trip com a SEFAZ), então gerar uma chave válida em contingência não depende de rede nenhuma.
- `lib/fiscal/xml.ts` linha ~371 tem `<tpEmis>1</tpEmis>` **hardcoded** dentro do grupo `<ide>` do XML, e a chamada a `montarChaveAcesso` (linha ~201) não passa `tpEmis` — os dois precisam virar parâmetro.
- `lib/fiscal/soap.ts:transmitirNota` já distingue duas falhas de transporte de uma rejeição de negócio: (a) a promise **rejeita** (`req.on('error', reject)` ou timeout — rede inacessível/DNS/TLS) e (b) a resposta chega mas `parseRespostaSefaz` devolve `cStat: null` (corpo não é um XML de decisão da SEFAZ — página de erro de gateway, corpo vazio). **Ambos os casos são o gatilho de contingência.** Uma rejeição de negócio real (`cStat` presente e ≠ sucesso, ex. `899`/`702`) **nunca** deve virar contingência — é um problema no XML, não de rede, e continua caindo em `status: 'rejeitada'` como hoje.
- `fiscal_notas.status` tem `check (status in ('pendente','autorizada','rejeitada','erro'))` — precisa de migration pra incluir `'contingencia'`.
- `lib/fiscal/pdf.ts:gerarPdfNota` (modelo 65) chama `nfe-danfe-pdf`, que **exige** `nf.protNFe.infProt` (desestruturado direto, sem checagem de nulo) — quebra sem protocolo. Como a impressão em contingência acontece **antes** de qualquer protocolo existir, essa biblioteca não pode ser reaproveitada pro cupom de contingência.
- O app roda como processo `systemd` contínuo no Contabo (`ntb-vendas.service`, não é serverless) — dá pra ter um `setInterval` de longa duração dentro do próprio processo Next.js pra retransmissão em background, sem precisar de infra nova (cron externo, fila, etc.).

## Decisões (confirmadas com o dono)

1. **Ativação: automática.** Sem botão manual — qualquer emissão que falhe por rede/transporte (não por rejeição de negócio) vira contingência sozinha.
2. **Retransmissão: automática em background**, sem botão.
3. **Falha persistente: alerta visível no painel** (Administração → Notas Fiscais), sem travar nenhuma venda.

## Arquitetura

### 1. Emissão em contingência (`app/api/fiscal/emitir/route.ts`)

Fluxo atual (Fase 1, pré-autorização): monta XML com `tpEmis=1` → assina → chama `transmitirNota` → em caso de EXCEÇÃO (`catch`), grava `status: 'erro'` e sai.

Novo fluxo: a exceção capturada no `catch` da Fase 1 passa a ser classificada:

- **Erro de transporte/rede** (a promise de `transmitirNota` rejeitou, ou a resposta veio mas `parseRespostaSefaz` devolveu `cStat: null`) → **contingência**:
  1. Remonta o XML **do zero** com `tpEmis: 9` (a primeira tentativa, com `tpEmis: 1`, já tinha sido assinada e falhou — descarta; contingência é uma nota logicamente diferente, mesma chave-base mas `tpEmis` diferente muda a chave de acesso calculada).
  2. Assina normalmente (já é 100% local — certificado já foi carregado).
  3. Insere em `fiscal_notas` com `status: 'contingencia'`, guardando o **XML assinado completo** (novo campo, ver Modelo de Dados) — é isso que a retransmissão mais tarde vai reenviar tal e qual, sem remontar nada.
  4. Gera o PDF de contingência (ver seção 2) e retorna a URL pro client, do mesmo jeito que retorna `pdfUrl` numa autorização normal — `abrirCupomFiscalQuandoSair`/`aguardarNotaFiscalDaVenda` no client **não precisam mudar**, contingência é só mais um valor de `status` que já resulta num PDF pronto.
- **Qualquer outra exceção** (certificado não decripta, erro de banco, etc.) → continua exatamente como hoje (`status: 'erro'`). Contingência é estritamente sobre "não consegui falar com a SEFAZ", nunca um catch-all.

### 2. Cupom de contingência (novo módulo, `lib/fiscal/pdfContingencia.ts`)

PDF próprio, gerado com `pdfkit` (já é dependência transitiva de `nfe-danfe-pdf`, mesmo padrão de `coletarPdfKitDoc` em `lib/fiscal/pdf.ts`) — layout estreito (mesma largura usada hoje pro cupom normal), contendo:

- Cabeçalho da loja (razão social, CNPJ, endereço) — mesmos dados já usados no cupom normal.
- Aviso obrigatório, em destaque: **"EMITIDO EM CONTINGÊNCIA — DOCUMENTO SEM VALIDAÇÃO DA SEFAZ NO MOMENTO DA EMISSÃO"** + data/hora.
- Itens, valores, forma de pagamento — mesmos dados já calculados hoje pra montar o XML (`ItemNota[]`/`PagamentoNota[]`).
- Chave de acesso (44 dígitos, formatada em blocos de 4) — já existe no momento da emissão, mesmo sem protocolo.
- **Sem** número de protocolo, sem QR Code de consulta-autorizada (o QR normal depende do CSC pra gerar hash — sem transmissão bem-sucedida esse hash nunca foi calculado). Em vez disso, um texto: "Consulte a autorização desta nota, quando disponível, pela chave de acesso em [URL de consulta pública da SEFAZ do estado]".

> **Correção pós-implementação:** a parte do "sem QR Code" está **desatualizada**. A NT 2015/002 define uma fórmula OFF-LINE de QR Code (distinta da online) que não depende de protocolo — implementada na Task 5.5 em `montarQrCodeOffline` (`lib/fiscal/qrcode.ts`) e validada contra a SEFAZ homologação (XML de contingência com `<infNFeSupl>` offline autorizado, cStat=100). Hoje o QR offline vai **tanto no XML de contingência** (obrigatório: `<infNFeSupl>` é exigido pro modelo 65 em qualquer `tpEmis`, e sem ele a SEFAZ rejeita por schema — comprovado com controle negativo, cStat=225) **quanto no cupom de contingência impresso** pro cliente. Continua verdade só a parte do protocolo: esse de fato não existe até a retransmissão autorizar.

`gerarPdfNota` (`lib/fiscal/pdf.ts`) ganha um branch: se a nota for de contingência (`status === 'contingencia'`), chama este módulo novo em vez de `nfe-danfe-pdf`.

**Impressão em 2 vias:** o mesmo ponto do código que hoje chama `window.open(nota.pdfUrl, '_blank')` uma vez (`abrirCupomFiscalQuandoSair`, `components/modules/StoreModule.tsx`) passa a, quando `nota.status === 'contingencia'`, abrir/imprimir o PDF duas vezes em sequência (mesmo texto "1ª via" / "2ª via" no rodapé de cada cópia, pra distinguir visualmente cliente vs. estabelecimento).

### 3. Retransmissão em background

Novo módulo `lib/fiscal/retransmissao.ts`, iniciado uma vez no boot do servidor (via `instrumentation.ts` do Next.js — hook oficial que roda uma vez quando o processo sobe, já usado por projetos Next 15+/16 pra esse tipo de tarefa de background; **não** existe hoje neste projeto, precisa ser criado):

- A cada **2 minutos** (`setInterval`), busca `fiscal_notas` com `status = 'contingencia'` de TODAS as lojas (não é uma rota HTTP por loja — é um job único do processo).
- Pra cada uma: pega o XML assinado já salvo, chama `transmitirNota` de novo (mesmíssima função usada na emissão normal).
  - Sucesso (`cStat === '100'`): segue exatamente a Fase 2 já existente (monta `nfeProc`, gera o PDF OFICIAL agora sim via `nfe-danfe-pdf` — já tem protocolo —, sobe pro Storage, atualiza a linha pra `status: 'autorizada'` com `chave_acesso`/`numero`/`protocolo`/`pdf_path` reais). O PDF de contingência gerado no momento da venda **não é substituído** (já foi entregue ao cliente em papel) — o PDF oficial fica disponível em Administração → Notas Fiscais como o documento definitivo.
  - Rejeição de negócio (cStat presente, ≠ 100): vira `status: 'rejeitada'` — mesmo comportamento de uma rejeição normal. (Caso raro: a nota foi impressa em papel pro cliente mas a SEFAZ rejeitou depois — fora do escopo deste design resolver retroativamente; fica registrado pro lojista ver e agir manualmente, ex. reemitir com correção.)
  - Erro de transporte de novo (ainda sem internet): não faz nada, tenta de novo no próximo ciclo.
- Idempotência: como o XML já foi assinado e tem uma chave de acesso fixa, reenviá-lo várias vezes é seguro — a SEFAZ responde com o mesmo protocolo se a chave já foi processada (comportamento padrão do webservice de autorização), então não há risco de duplicar.

> **Correção pós-implementação:** esta premissa de idempotência é **FALSA** — refutada empiricamente na Task 7, contra a SEFAZ homologação (2026-09-16). Reenviar uma chave JÁ autorizada **não** devolve o protocolo existente: devolve `cStat=204 "Duplicidade de NF-e"`, uma rejeição de NEGÓCIO. Retransmitir não é seguro por si só; a segurança vem do código: (a) `cicloEmExecucao` impede dois ciclos simultâneos no mesmo processo, e (b) o UPDATE de rejeição em `lib/fiscal/retransmissao.ts` leva `.eq('status','contingencia')` no WHERE, condição atômica no Postgres que impede uma 204 atrasada de sobrescrever pra `'rejeitada'` uma linha já promovida a `'autorizada'`.
>
> **Correção pós-implementação (rejeição de negócio):** o item acima sobre `cStat` presente ≠ 100 virar `'rejeitada'` foi restringido na revisão final de branch. Os códigos de **indisponibilidade da SEFAZ** (`105`, `106`, `108`, `109` — serviço paralisado/lote em processamento) chegam como `cStat` presente mas **não** são recusa do documento; hoje o predicado compartilhado `ehSefazIndisponivel` (`lib/fiscal/soap.ts`) os exclui do caminho de rejeição, tanto na retransmissão (a linha fica em `'contingencia'` pro próximo ciclo) quanto na emissão (caem pra contingência em vez de `'rejeitada'`). Além disso, ao marcar `'rejeitada'` a retransmissão agora **libera** os `order_items` daquela nota (`fiscal_nota_id = null`), senão a venda ficaria permanentemente fora de qualquer emissão futura.

### 4. Alerta no painel

`FiscalNotasView` (Administração → Notas Fiscais) ganha um banner, visível quando existir pelo menos uma nota `status='contingencia'` daquela loja:

- "N nota(s) em contingência aguardando confirmação da SEFAZ."
- Se alguma tiver `created_at` há mais de 2 horas: destaque mais forte ("X nota(s) pendente(s) há mais de 2h — verifique a conexão com a SEFAZ").
- Nunca bloqueia nada, é só informativo.

## Modelo de dados (nova migration)

```sql
alter table fiscal_notas drop constraint fiscal_notas_status_check;
alter table fiscal_notas add constraint fiscal_notas_status_check
  check (status in ('pendente','autorizada','rejeitada','erro','contingencia'));

-- XML assinado completo (com tpEmis=9), guardado no momento da emissão em
-- contingência — é o que a retransmissão em background reenvia tal e qual,
-- sem remontar nada. Nulo pra toda nota que nunca passou por contingência.
alter table fiscal_notas add column if not exists xml_contingencia text;
```

## Testes / verificação (homologação, `ambiente=homologacao` sempre)

- Emissão normal (feliz): confirmar que **nada muda** — mesmo fluxo de sempre, `tpEmis=1`.
- Simular falha de rede: apontar `resolverEndpoint` pra um host inexistente temporariamente (só em teste) e confirmar que a nota vira `contingencia`, o PDF de contingência é gerado e abre/imprime 2x.
- Restaurar o endpoint real e confirmar que o job de background pega a nota em até 2 minutos e ela vira `autorizada` com protocolo real.
- Confirmar que uma rejeição de negócio real (ex. forçar `cStat=899` como no bug da cortesia) continua caindo em `rejeitada`, nunca em `contingencia`.
- Confirmar o alerta aparecendo/sumindo no painel conforme o estado muda.

## Fora de escopo (não decidido, não implementar sem novo pedido)

- Reconciliação manual de uma nota que ficou `contingencia` e depois veio `rejeitada` da SEFAZ (cliente já saiu com o cupom em papel).
- EPEC ou outras formas de contingência de NF-e modelo 55 (este design cobre só NFC-e modelo 65, que é o único caminho real de emissão automática hoje).
