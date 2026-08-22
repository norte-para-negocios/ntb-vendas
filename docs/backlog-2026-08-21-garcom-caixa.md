# Backlog NTB Vendas — pedidos do usuário (2026-08-21, lista em aberto)

> Lista sendo enviada aos poucos pelo usuário. **Não executar até ele fechar a lista** —
> a ideia é agrupar o que faz sentido junto em vez de mexer item por item.

## 1. Jurisdição de mesas por garçom

Ao entrar em Gestão de Mesas, o garçom só enxerga/atende as mesas sob a
jurisdição dele. O lojista escolhe quais mesas cada garçom atende — ou marca
"todas as mesas".

**Notas técnicas (levantadas, não decididas):**
- Precisa de um vínculo novo `store_user` ↔ `tables` (tabela de junção ou
  array de ids). Hoje não existe nada parecido.
- Ponto em aberto pro usuário: mesa fora da jurisdição **some da tela** ou
  aparece bloqueada/somente leitura? Muda a UI e o modelo mental.
- Ponto em aberto: e a mesa sem garçom atribuído — fica visível pra todos?

## 2. Garçom só acessa Gestão de Mesa

Nada de Cozinha, Bar, Balcão, Cardápio ou Administração.

**Nota técnica:** o sistema de permissão por usuário **já existe**
(`tables`/`counter`/`kitchen`/`bar`/`menu`/`admin`, ver `canAccess` em
`StoreModule.tsx` e a tela de gestão de usuários). Então isso é provavelmente
configuração + talvez um cargo "Garçom" com esse preset, não feature nova.
O que é feature nova é o Caixa entrar nessa lista de permissões (item 3).

## 3. Módulo Caixa (novo)

O garçom **não** finaliza mais a venda. O fluxo passa a ser:
- Garçom: **pedir/receber a conta** (encerra o consumo da mesa)
- **Caixa**: recebe o pagamento, calcula troco, finaliza a venda

**⚠️ Consequência crítica já identificada — não pode ficar pra trás:**
hoje o fechamento da mesa (`closeTableSession` em `lib/api.ts`) é o gatilho de
DUAS automações:
1. **Emissão fiscal** (`/api/fiscal/emitir` — NFC-e/NF-e, conforme
   `store_fiscal_config.modelo_emissao_automatica`)
2. **Ordem de Produção no NTB Estoque** (`triggerOrdemProducao` →
   `/api/integracao/ordem-producao`, que também faz o dual-write do histórico
   pro Contabo)

Se "finalizar" migra pro Caixa, **os dois gatilhos migram junto** e o Caixa
vira o ponto de emissão da nota. Isso mexe exatamente no caminho fiscal
validado em 2026-08-06 (NFC-e e NF-e autorizadas em homologação) — precisa ser
retestado depois da mudança.

**Ponto em aberto pro usuário:** a Ordem de Produção deve disparar no momento
em que o garçom pede a conta (consumo confirmado) ou só quando o Caixa
recebe o pagamento? São momentos diferentes e a baixa de estoque muda de hora.

## 4. Detalhamento do Caixa e do fluxo da conta (2ª mensagem do usuário)

- **Caixa tem acesso a tudo que o garçom tem** — é superconjunto, não um
  papel paralelo. (Permissão: Caixa = permissões do garçom + finalizar venda.)
- **Caixa finaliza a compra.** Confirma o item 3.
- **Garçom pode pedir a conta**, e a mesa passa a mostrar **"pediu conta"** —
  exatamente o mesmo estado que já acontece quando o CLIENTE pede a conta.
  Ou seja: um estado só, duas origens.
  - *Nota técnica:* esse estado já existe — `tables.status = 'waiting_bill'`
    (e `waiter_requested` pro chamado de garçom). A ação do garçom deve
    setar o mesmo estado que o cliente seta hoje, não um novo.
- **Quem fecha a conta é o Caixa.** (Só o Caixa.)
- **Caixa pode adicionar pedido. Garçom também** — os dois lançam item na
  comanda.
- **Garçom pode ver a comanda e mandar imprimir — e sai no CAIXA.**

**⚠️ Este último item não tem mecanismo hoje.** A impressão atual
(`lib/print.ts`) é `window.open()` + `window.print()` — ou seja, imprime **no
aparelho de quem clicou**. "Garçom manda imprimir do celular dele e sai na
impressora do caixa" exige algo que não existe no projeto:
- uma fila de impressão que a estação do caixa fica escutando e imprime, ou
- uma impressora de rede/ESC-POS que o servidor comanda direto.

É o mesmo problema que ficou em aberto na reunião de 2026-08-19 ("impressão
automática na cozinha"), agora aparecendo de novo pelo lado do caixa. Vale
resolver os dois com o mesmo mecanismo, e é o item desta lista que precisa de
desenho próprio antes de virar código.

## 5. Tela de pagamento do Caixa — PDV de verdade (3ª mensagem do usuário)

Quando o Caixa, dentro da Gestão de Mesas, clica em finalizar/receber, deve
abrir uma **janela grande sobreposta à tela** (não o fluxo simples de hoje),
com opções ricas de pagamento:
- Dinheiro
- **Dois (ou mais) métodos de pagamento na mesma conta** (pagamento dividido
  por forma, não por pessoa)
- Cartão de crédito **com escolha da bandeira**
- "e etc tudo desse tipo de coisa" — ou seja, o conjunto que um PDV real tem

**O que já existe hoje (levantado, não é preciso reconstruir):**
- `PAYMENT_METHOD_LABELS` (`lib/labels.ts`): `CREDIT`, `DEBIT`, `PIX`, `CASH`,
  `COURTESY`, `MULTIPLE`. Já existe a noção de "Dividido" (`MULTIPLE`).
- `orders.payment_method` (text) **e `orders.payment_details` (jsonb)** — a
  coluna jsonb já está lá, então dá pra guardar a composição do pagamento
  (quanto em cada forma, bandeira, autorização) sem migration nova. Conferir
  o que ela guarda hoje antes de assumir.
- Cálculo de troco já é centralizado em `lib/calc.ts` (não reescrever inline).
- `BillSplitter` já existe, mas resolve **divisão por pessoa**, que é outra
  coisa — não confundir com divisão por forma de pagamento.

**Pontos em aberto pro usuário:**
- Bandeira: lista fixa (Visa/Master/Elo/Amex/Hiper...) ou texto livre?
- Precisa registrar nº de autorização / NSU / maquininha, ou só a forma?
- O pagamento dividido por forma precisa conviver com o `BillSplitter`
  (divisão por pessoa) na mesma conta, ou são caminhos alternativos?
- Isso tem efeito fiscal: a NFC-e leva o(s) meio(s) de pagamento no XML
  (grupo `pag`). Hoje o pipeline manda uma forma só. Pagamento dividido
  precisa refletir no XML — senão a nota sai divergente do recebido.

## 6. PIN da mesa rotativo (4ª mensagem)

O PIN da mesa tem que **mudar toda vez que a mesa fecha e abre** — não pode
ser fixo por mesa como hoje.

*Nota técnica:* hoje o PIN vive em `tables.pin` e é validado dentro de
`open_table_session` (function `security definer`, com rate-limit de 5
tentativas / 5 min em `pin_attempts`/`pin_locked_until`). Rotacionar =
gerar PIN novo no fecha ou no abre da sessão, dentro da própria function.
Já existe `table_sessions` (1 linha por ciclo abre→fecha), que é o lugar
natural pra amarrar isso. Cuidado: o PIN é revelado ao anfitrião na tela do
cliente — rotacionar no momento errado derruba a sessão de quem está com a
mesa aberta.

## 7. Fluxo simplificado — SÓ no Sertão (4ª mensagem, enfático)

No Sertão especificamente:
- **Não vai ter Bar nem Cozinha com acompanhamento de pedidos** (sem KDS).
- O pedido **vai direto para impressão na cozinha** (ou bar, conforme o
  destino do item).
- **A conta imprime no caixa.**
- **Acaba o fluxo de status** (aceitar → preparando → pronto → entregue). Nada
  de ficar marcando etapa: o pedido sai direto pro seu destino.
- "Receber conta" dispara a impressão direta no caixa.

⚠️ **O usuário foi enfático: isso é SÓ no Sertão.** As outras lojas mantêm o
fluxo com KDS e acompanhamento de status.

## 8. Loja configurável por módulos, na criação (4ª mensagem — a generalização)

Em vez de tratar o Sertão como exceção no código, o usuário propôs o certo:
**na criação da loja, escolher quais módulos/comportamentos ela tem** —
se tem bar, se o fluxo é direto (sem acompanhamento) ou com KDS, e por aí.
Ou seja, criar **variações/perfis de loja** na tela de cadastro.

*Nota técnica:* isso encaixa em algo que **já existe** — `stores.config`
(jsonb) já guarda flags por loja (`use_pin`, `allow_client_open`,
`require_pin_for_open`, `charge_service_fee`, `service_fee_rate`,
`note_suggestions`, `show_bestsellers`). Flags novas de módulo cabem ali sem
migration. O trabalho real é: (a) a UI de criação/edição de loja expor isso,
(b) o `canAccess`/roteamento de abas respeitar, (c) o fluxo de pedido
respeitar o modo "direto".

**Esta é a forma certa de entregar o item 7** — não com `if (loja === 'sertão')`.

## 9. Relatório de notas fiscais com XML, por período (5ª mensagem)

Na aba Notas Fiscais, poder **baixar um relatório do período que o usuário
escolher** (semanal, mensal, ou qualquer intervalo) com **todas as notas**,
data certa, todas as informações da nota, e **o XML em destaque**.

*Esclarecimento de nomenclatura:* o número que aparece no cupom impresso
(`2926 0839 9127 1700 0145 6500 1000 0005 0714 9158 1063`, do print que o
usuário mandou) é a **chave de acesso** — 44 dígitos que identificam a nota.
O **XML** é o arquivo completo do documento fiscal. São coisas diferentes e o
relatório provavelmente quer as duas.

**Boa notícia — quase tudo já é guardado.** `fiscal_notas` já tem:
`chave_acesso`, `numero`, `serie`, `protocolo`, `modelo`, `ambiente`,
`status`, `valor_total`, `motivo_erro`, `created_at`, **`xml_path`** e
**`pdf_path`** (os arquivos ficam no Storage; já existe a rota
`/api/fiscal/pdf-url`). Confirmado ao vivo: as 6 notas autorizadas do Sertão
têm XML e PDF salvos.

Então o trabalho é: filtro de período + montar o pacote (provavelmente um ZIP
com os XMLs + uma planilha/CSV com os campos), não capturar dado novo.

**Ponto em aberto:** o contador normalmente quer os XMLs em lote (ZIP) —
confirmar se é isso ou um PDF/planilha com o XML embutido/legível.

## 10. Melhorar os relatórios de histórico de vendas (6ª mensagem)

"Melhorar todos os relatórios de histórico de vendas e esse tipo de coisa."
Pedido amplo, sem detalhe ainda — **precisa de conversa própria** pra saber o
que está faltando hoje (colunas? filtros? agrupamentos? exportação?).

## 11. Modal de novo pedido ocupando a tela inteira (7ª mensagem)

Quando o garçom OU o caixa cria um pedido novo, o modal parece "uma
janelinha de celular". Deve ocupar **pelo menos 75% da tela**, sem cobrir
100% — mantendo a sensação de camada sobreposta.

*Nota técnica:* o `Modal` compartilhado (`components/ui.tsx`) é
`w-full max-w-md` = **448px fixos**, independente do tamanho da tela. Foi
desenhado pro cardápio do cliente (celular) e reaproveitado no painel do
lojista, que roda em desktop/tablet no salão. A correção é dar ao `Modal` uma
variante de largura maior (ou responsiva) e usá-la nos fluxos do painel —
**sem mexer no cardápio do cliente**, onde 448px está certo.

Relacionado à pendência já registrada de que o menu do garçom
(`StoreTableMenu`/`StoreProductModal`) ficou visualmente divergente do
cardápio do cliente depois do redesign — vale tratar junto.

## 12. Sistema rodando na maquininha de cartão (8ª mensagem) — PESQUISADO

Pedido: garçom fazer pedido pela maquininha.

**Pesquisa feita em 2026-08-21. Conclusão: para rodar DENTRO da maquininha,
tem que virar app Android nativo. Não há atalho.**

- Todas as smart POS do mercado (Cielo LIO, Stone, PagBank Moderninha Smart,
  Mercado Pago Point Smart, GetNet PAX) rodam **Android** e aceitam app de
  terceiro. *(Na reunião de 2026-08-19 alguém disse que a maquininha "deve ser
  iOS" — está errado.)*
- Cada adquirente tem **loja e homologação próprias** (ex.: Cielo Store via
  Dev Console, com apps públicos e privados). Publicar numa **não** vale pras
  outras.
- ⚠️ **A Cielo NÃO permite WebView na Cielo Smart nova** — ou seja, embrulhar
  o app web num container está fora. A recomendação deles é integração por
  **deep link**.
- A Cielo oferece um emulador pra desenvolver sem ter o hardware.

**Recomendação registrada:** deep link para PAGAMENTO agora (encaixa
exatamente no módulo Caixa, item 5 — a tela de pagamento dispara a cobrança na
maquininha e recebe de volta aprovação/bandeira/NSU, que alimentam a nota),
e app nativo só depois que houver lojas rodando — começando por UMA adquirente,
a mais usada pelos clientes, não as cinco.

**Meio-termo a testar de graça na visita à loja:** abrir o cardápio no
**navegador da própria maquininha**. Se o garçom conseguir trabalhar assim,
valida a ideia sem gastar nada. Falta saber **qual é a maquininha do Sertão**
(Cielo / Stone / PagBank / Mercado Pago / GetNet) — o modelo muda o que é
possível.

**Valor estratégico anotado:** a Cielo Store é um marketplace dentro da
maquininha com 250+ apps homologados. Estar lá é **canal de distribuição**
para restaurantes que já têm o terminal — relevante pro plano de vender o
NTB Vendas para outras lojas.

## 13. Controle de emissão de nota por venda (9ª mensagem)

Pedido: o lojista poder escolher, na venda, se emite nota fiscal ou não.

*Nota técnica:* a capacidade já existe **por loja** —
`store_fiscal_config.modelo_emissao_automatica` aceita `'nenhuma'`. O pedido é
granularidade **por venda**, o que é uma mudança pequena.

**⚠️ Registro necessário sobre a justificativa.** O usuário motivou o pedido
como forma de "evitar imposto". Deixar de emitir nota de venda realmente
ocorrida é **sonegação** (Lei 8.137/90), com responsabilidade do lojista — e
risco para a Norte Para Negócios, que vende o sistema: um recurso cuja
finalidade declarada seja essa serve de prova. Agrava que o sistema deixa
rastro da venda mesmo sem nota (pedido no banco, baixa de estoque via Ordem de
Produção, histórico replicado no Contabo).

**Portanto: o recurso fica registrado como "controle de emissão por venda",
pelos usos legítimos abaixo, e NÃO deve ser descrito — no produto ou na
documentação ao cliente — como forma de reduzir imposto.**

Usos legítimos:
- Loja em plano sem módulo fiscal contratado (foi o que o Ramon descreveu na
  reunião de 2026-08-19)
- Loja que emite por outro sistema e usa o NTB só para operação
- Consumo interno / cortesia / cancelamento (já existe forma de pagamento
  "Cortesia")
- Contingência: SEFAZ fora do ar, emitir depois

*Alternativa recomendada, que dá o mesmo resultado comercial sem risco:* plano
sem módulo fiscal — a loja não emite porque não contratou, não porque escondeu
venda.

## 14. Deixar a taxa de 10% explícita (10ª mensagem)

Deixar claro na venda que a taxa de serviço está (ou não está) sendo cobrada.

*Direção correta também juridicamente:* a taxa de serviço é **opcional para o
consumidor** e precisa estar informada antes do pedido, não aparecer só na
conta. Deixar explícito protege o lojista.

Onde precisa ficar explícito (verificar cada um):
- **Cardápio do cliente**: já existe — `heroMetaParts` mostra
  "Taxa de serviço X%" no cartão da loja, mas **só quando
  `charge_service_fee` está ligado**. Como o Sertão está com a taxa desligada
  (ver achado abaixo), hoje não aparece nada lá.
- **Comanda / conta** exibida ao cliente e ao garçom
- **Comprovante impresso** (`printBillReceipt`)
- **Tela de pagamento do Caixa** (item 5)
- Deixar visível também quando **não** está sendo cobrada, para não gerar
  dúvida

*Já existe e deve ser preservado:* a possibilidade de **remover a taxa de uma
mesa específica** (`service_fee_removed` / `removedServiceFees`) — é o direito
do cliente de não pagar, e está correto.

**Achado relacionado (levantado ao vivo em 2026-08-21):** das 7 lojas ativas,
6 estão com a taxa **ligada** e o Sertão é a **única desligada** (a chave
`charge_service_fee` nem existe na config dele, e o código lê ausência como
"não cobrar"). Como o Sertão vira dia 1º, confirmar com o Ramon se é
intencional. O mecanismo em si está correto: 10% padrão, percentual
configurável por loja, cálculo centralizado em `lib/calc.ts`.

## 15. Relatório do Sertão — margem alvo 80% (11ª mensagem)

O usuário vai mandar um **arquivo de base** com o formato do relatório.
Parâmetro já informado: **margem alvo = 80%**.

**Aguardando o arquivo antes de qualquer desenho** — o usuário disse
explicitamente que o formato fica claro ao ver o relatório. Não presumir
estrutura, fonte de dado nem periodicidade antes disso.

*Contexto possivelmente relacionado (verificar quando o arquivo chegar):* o
NTB Estoque já tem relatório de margem por produto (`relatorio-margem`), com
CMC ponderado por saldo e snapshot diário — se a margem alvo de 80% for sobre
custo de insumo, o dado pode já existir daquele lado, e o relatório aqui seria
o cruzamento venda × custo. Não assumir; confirmar com o arquivo.

## 16. Botão "sair da mesa" no cardápio do cliente (12ª mensagem)

O usuário questionou: o cliente não deveria conseguir sair da mesa tendo
pedido não pago — e talvez o botão nem devesse existir.

**Investigado — o problema é maior que o relatado.** `handleLogout(false)`
(`ClientModule.tsx:2548`) **não fecha a mesa nem a conta**: só limpa a sessão
local (localStorage + estado). A própria confirmação diz *"Se você for o
anfitrião, a mesa continuará aberta."*

Três problemas distintos:
1. **O rótulo engana.** Não é "sair da mesa", é "sair deste aparelho". A conta
   segue aberta no salão e o cliente pode não entender isso.
2. **Perde o acompanhamento dos próprios pedidos.** O logout faz
   `setMesaOrderIds([])` e `setTrackedOrderId(null)` — o cliente deixa de ver
   o que pediu, mesmo continuando a dever. Para voltar precisa do PIN de novo
   (e o PIN vai passar a rodar a cada abertura, item 6 — conferir a interação).
3. **Fica disponível com pedido em aberto**, que é a queixa original.

**Pontos em aberto pro usuário:**
- Com pedido não pago, o botão some, fica bloqueado, ou vira **"pedir a
  conta"** (que é a ação que o cliente realmente quer nesse momento)?
- Sem nenhum pedido, sair é legítimo (cliente entrou na mesa errada) — manter?
- E o anfitrião: se ele sair, a mesa continua aberta para os outros? Hoje sim.

---

## 🐛 BUG CONFIRMADO — impressão nunca funcionou (comanda E relatório)

**Causa raiz encontrada e reproduzida no navegador.** `lib/print.ts` abre a
janela de impressão assim, em DOIS lugares (linha 44, térmica; linha 177,
relatório A4):

```js
const printWindow = window.open('', '_blank', 'width=300,height=500,noopener');
if (!printWindow) return;
```

`noopener` faz `window.open()` retornar **`null`** por especificação (é o que
corta o vínculo com a janela criada). Logo a linha seguinte **sai da função em
silêncio** — sem imprimir, sem erro, sem aviso. Reproduzido ao vivo: com
`noopener` → `null`; sem → janela abre normal.

Isso explica exatamente o relato do usuário: **nem comanda, nem relatório**.

**A correção não é só apagar a palavra.** O `noopener` foi posto por segurança:
os documentos são montados com `document.write()` e o campo de observação é
texto livre do cliente — sem isolamento havia risco real de XSS (já documentado
no AGENTS.md). A saída é imprimir por `iframe` oculto ou `Blob URL`, mantendo o
isolamento e voltando a imprimir.

**Prioridade alta:** é pré-requisito de tudo que envolve papel no Sertão
(itens 4 e 7), e hoje bloqueia o uso normal das outras 6 lojas.

---

## 🔴 ACHADO CRÍTICO — o Sertão NÃO consegue emitir nota em produção

Levantado ao vivo em `fiscal_notas` (2026-08-21):

- **Homologação: funcionando.** 6 notas autorizadas, série 1, nº 502 a 507,
  a última em 21/08 23:11 (R$187,60) — é a do print que o usuário mandou.
- **Produção: 3 tentativas, 3 falhas.** 13/08 (R$196,50 ×2) e 16/08
  (R$719,60), todas com o mesmo motivo:
  **"CSC/CSCID não configurado pro ambiente produção"**.

Ou seja, hoje o Sertão só emite em ambiente de teste. Para emitir de verdade
falta cadastrar o **CSC de produção** (gerado no painel da SEFAZ-BA e
preenchido na config fiscal da loja). **Não é código** — é cadastro — mas é
bloqueante para 1º de setembro.

Histórico geral da tabela: 13 autorizadas, 4 erro, 2 rejeitadas. As 2
rejeitadas são antigas (10-11/08, `cStat=225` falha de schema) e não voltaram
a acontecer depois das correções de 2026-08-06.

---

## ⚠️ RISCO DE CRONOGRAMA — ler antes de planejar qualquer coisa

O fluxo que o Sertão vai usar no dia **1º de setembro** depende inteiramente de
**impressão remota** (pedido sai na cozinha, conta sai no caixa, disparados do
aparelho do garçom). **Esse mecanismo não existe no projeto.** A impressão de
hoje (`lib/print.ts`) é `window.open()` + `window.print()`, que imprime no
aparelho de quem clicou.

Ou seja: tirar o acompanhamento de status (item 7) **remove** o mecanismo pelo
qual a cozinha fica sabendo do pedido hoje (a tela do KDS), e o substituto —
a impressora — ainda não foi construído nem desenhado. Se a impressão remota
não estiver pronta e testada na loja, o Sertão fica sem nenhum caminho do
pedido até a cozinha.

Isso já apareceu 3 vezes (reunião 2026-08-19, item 4 desta lista, e agora aqui)
e é o item de maior risco da lista inteira. Precisa de decisão de mecanismo
(fila que a estação escuta × impressora de rede/ESC-POS) e de teste com a
impressora real da loja, não só em código.

---

## Pendências anteriores ainda abertas (não relacionadas a esta lista)

- **Foto**: 0 de 1109 produtos com foto; loja sem capa e sem logo. Nada de
  código destrava — é conteúdo. É o que mais separa o cardápio do print do
  iFood hoje.
- **Endereço sem acento** no cadastro fiscal ("MATA DE SAO JOAO" → sai
  "Mata de Sao Joao" no cardápio). Correção é 1 comando, mas é **dado
  fiscal do emitente** (vai na NF-e) — aguardando ok explícito do usuário.
- **`R$ 44.90` → `R$ 44,90`**: corrigido só no cardápio do cliente
  (20 ocorrências). Faltam ~63 no resto do app (impressão, dashboard, CSV,
  painel do lojista).
- **`cProd`/NCM na nota fiscal de produto com variação de tamanho**: sai
  sempre o código/NCM da variação mais barata, não a realmente vendida.
  Pré-existente, ficou visível com o redesign. Precisa de decisão de produto
  com o Ramon antes de mexer.
- **Menu do garçom** (`StoreTableMenu`/`StoreProductModal`) ficou visualmente
  divergente do cardápio do cliente depois do redesign.
- **Impressão automática na cozinha/bar** (reunião 2026-08-19): não existe
  nenhum código de impressora hoje; desenho não fechou na reunião.
