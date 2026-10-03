# Plano — próximas features do Norte Vendas (2026-10-04)

Origem: pesquisa de mercado (Toast, Lightspeed, Simphony, SevenRooms, MarketMan, 7shifts, Saipos e outros) filtrada
pelo que o Sertão realmente precisa (restaurante de praia, ~200 mesas, vários caixas e garçons, pizzaria + bar +
cozinha, NFC-e direta, Omie). Descartados pelo dono: Pix na mesa, iFood, fidelidade, ranking de garçom, fila de espera.
Pendente de incorporar: resultado da pesquisa de PDVs brasileiros (ainda em andamento quando este plano foi escrito).

## Ordem de execução

| # | Feature | Esforço | Por quê | Depende de |
|---|---|---|---|---|
| 1 | Relatório de exceções por operador | M | Protege dinheiro; dado já existe | nada (usa auditoria do caixa, 063/074) |
| 2 | Botão "Esgotado" em tempo real | P | Evita lançar prato que acabou | `products.available` já existe |
| 3 | Alergênicos no produto + destaque na comanda | M | Segurança do cliente (frutos do mar) | campo novo + ticket (`lib/print.ts`) |
| 4 | Preço por horário (happy hour automático) | M | Bar do Sertão; hoje promo é fixo | `promo_price`, `lib/schedule.ts` |
| 5 | Permissões granulares (preço, desconto, item aberto) | P | Estende "trocas" (03/10) | `lib/storeModules.ts` |
| 6 | Compras: pedido sugerido + recebimento no celular | G | Casa com o estoque/Omie | ntb-estoque (já tem "repor") |
| 7 | CMV teórico x real + desperdício com motivo | G | Margem real por prato | ficha técnica no estoque |

Itens 1–4 cabem em sequência curta; 5 entra junto do 1; 6–7 só depois, em projeto próprio.

## 1. Relatório de exceções por operador (M)

**O que é:** tela em Administração → "Exceções" com, por turno/dia e por operador: itens cancelados (e valor), itens
apagados antes de enviar à cozinha, taxa de serviço removida/editada, descontos e cupons, estornos, contas
reabertas, notas fiscais canceladas, sangrias grandes. Limite configurável por loja acende alerta no painel.

**Dados já existentes:** eventos de auditoria do caixa (`item_cancelado`, `sangria_grande`, `tolerancia_excedida`,
estorno de balcão — migrations 063/074; `fetchCashShiftAudit`), `order_items.status='canceled'` com
`added_by_name`, `tables.service_fee_removed`, `coupon_usages`, `fiscal_notas.status='cancelada'`.

**Falta:** registrar quem cancelou/apagou item pendente (hoje só alguns caminhos auditam), consulta agregada por
operador (RPC `fetch_exceptions_report_secure`), tela e limiar (`stores.config.exceptions_thresholds`).

**Pronto quando:** dado um dia com cancelamentos e estornos de teste na loja ZZ, o relatório lista cada ocorrência
com operador, hora, valor e motivo, e o total por operador bate com o banco.

## 2. Esgotado em tempo real (P)

**O que é:** gerente/caixa marca o prato como esgotado em dois toques (no lançamento do garçom e na lista do
cardápio); some do lançamento de todos os aparelhos e do cardápio do cliente na hora; volta com um toque.
**Falta:** atalho na UI do garçom, RPC com permissão `menu`, assinatura realtime já usada em `products`.
**Pronto quando:** marcar em um aparelho e o item sumir em outro em menos de 3 s, sem recarregar.

## 3. Alergênicos (M)

**O que é:** tags de alergênico por produto (glúten, lactose, frutos do mar, amendoim, ovo), exibidas no cardápio
e em destaque na comanda impressa da cozinha. **Falta:** coluna `products.allergens text[]`, edição no cadastro,
bloco "ALERGIA" no ticket (`lib/print.ts`), filtro opcional no cardápio.
**Pronto quando:** pedido com produto alergênico imprime a linha em destaque na estação certa.

## 4. Preço por horário (M)

**O que é:** regra "produto/categoria X custa R$ Y de dd/hh a dd/hh" (happy hour). O servidor cobra o preço vigente
(`create_order_secure`), nunca o do cliente. **Falta:** tabela `price_schedules`, resolução de preço no servidor e
no cálculo local (`getEffectivePrice`), editor simples no cadastro.
**Pronto quando:** o mesmo produto sai com preços diferentes dentro e fora da janela, e o total do pedido bate.

## 5. Permissões granulares (P)

Seguir o padrão de `trocas` (03/10): `desconto`, `alterar_preco`, `item_aberto`, comparação estrita
(`=== true`), gerente/dono sempre podem, checkbox no cadastro da equipe.

## 6 e 7. Compras e CMV (G, projeto próprio)

Pedido sugerido ao fornecedor (par/mínimo), recebimento conferido no celular, alerta de variação de preço do
fornecedor, CMV teórico x real e desperdício com motivo. Parte no ntb-estoque. Só após 1–5.

## Regras de execução

- Cada item: teste unitário primeiro quando houver lógica pura; verificação na loja ZZ Laboratório, nunca no Sertão.
- Migrations aditivas; aplicar e fazer deploy só fora do horário de serviço.
- Qualquer mudança que o garçom veja: screenshot de conferência antes de entregar.
