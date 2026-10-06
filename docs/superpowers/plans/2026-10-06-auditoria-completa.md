# Auditoria completa de funcionários + relatório diário — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** registrar TODA ação de garçom, caixa e gerente (quem, quando, o quê, antes/depois) e mandar ao Ramon, todo dia às 00:00, um relatório por login.

**Architecture:** o app passa a mandar em TODA requisição ao Supabase o cabeçalho `X-NTB-Actor` (id, nome e papel de quem está logado). Triggers no Postgres leem esse cabeçalho (`current_setting('request.headers')`) e gravam cada INSERT/UPDATE/DELETE das tabelas de operação em `staff_audit_log` — por isso nenhuma ação escapa, nem as que escrevem direto na tabela. Ações que não mudam linha (login, logout, reimpressão, exportação, senha errada) são gravadas pelo app via RPC `log_staff_action_secure`. Rotas de servidor (`/api/fiscal/*`, `/api/orders/*`) recebem o ator no corpo e gravam com service role. Um job às 00:00 (America/Sao_Paulo) monta o relatório do dia anterior e envia pelo WhatsApp (Evolution, mesma máquina).

**Tech Stack:** Next.js 16, Supabase self-hosted (Postgres/PostgREST), pdfkit (já usado), Evolution API.

**Spec:** pedido do usuário em 06/10/2026 ("TUDO MESMO registrado"); inventário de ações em `docs/superpowers/plans/2026-10-06-auditoria-completa.md` (seção Inventário).

## Global Constraints

- Nada de log pode derrubar ou atrasar uma venda: gravação de auditoria nunca bloqueia a ação (falha vira `console.error` e fila de reenvio).
- Loja aberta: migration só aditiva; deploy do app só pelo portão (`scripts/e2e/portao-deploy.sh` PASSOU).
- Relatório vai para o cliente: o primeiro é mostrado ao usuário antes de ligar o envio automático (`AUDIT_REPORT_SEND=0` por padrão).
- Fuso do relatório: America/Sao_Paulo; "dia" = 00:00–23:59 de Brasília.
- Limite conhecido, escrito no relatório: o app não tem sessão no servidor; o ator vem do cliente (um uuid forjado passaria). Não é inventado nada além disso.

## Review Focus

- Ator ausente (conta universal, modo Aberto, requisição sem login): gravar "(sem login)" com origem, nunca descartar o evento.
- Ação offline reenviada depois: usar o horário da ação, não do reenvio.
- Volume: tabelas quentes (`orders`, `order_items`, `print_jobs`) — o trigger não pode ficar lento; só colunas relevantes no `details`.
- Mesma ação gravada duas vezes (trigger + RPC do app): o app NÃO grava o que o trigger já cobre.
- Relatório com 0 eventos de um login, ou loja que não abriu: mensagem curta, nunca erro.

## Inventário (resumo do mapeamento de 06/10)

Já gravam autor: cancelar item (`item_cancelado`), item transferido, estorno de pagamento, taxa editada/removida, ponto (`operator_checkins`), turno (`cash_shifts`).
Sem autor hoje: login/logout/senha errada, reimpressões (todas), trocar/bloquear/abrir mesa, enviar para cozinha, status do KDS, prioridade, esgotar produto, receber pagamento (só em `payment_details`), taxa de serviço ligar/desligar, limpar histórico de vendas, cancelar/reemitir/exportar nota, abrir/fechar turno e sangria/suprimento, produtos/preços/categorias, usuários e permissões, configurações da loja e impressoras, cupons, preço por horário, reservas, planta de mesas, chamar garçom/pedir conta.

## File Structure

- Create `supabase/migrations/163_auditoria_funcionarios.sql` — tabela, função de ator, triggers, RPCs de gravação e de leitura.
- Create `lib/auditoria.ts` — `registrarAcao()`, `definirAtor()`, fila de reenvio.
- Modify `lib/supabaseClient.ts` — cabeçalho `X-NTB-Actor` em toda requisição.
- Modify `components/modules/StoreModule.tsx` e outros — chamadas `registrarAcao` nas ações sem mudança de linha.
- Create `lib/relatorioAuditoria.ts` + `app/api/relatorios/auditoria-diaria/route.ts` — montagem do relatório (texto + PDF).
- Modify `instrumentation.ts` — agendamento 00:00.
- Tests em `scripts/testes/auditoria*.test.ts`.

## Tasks

### Task 1: Tabela, ator e triggers (banco)
- [ ] Migration 163: `staff_audit_log(id, store_id, occurred_at, actor_user_id, actor_name, actor_role, action, entity, entity_id, table_label, summary, details jsonb, origin)`; sem policy de SELECT; índice `(store_id, occurred_at)`.
- [ ] `ntb_actor()` lê `current_setting('request.headers', true)::json->>'x-ntb-actor'` (base64 JSON) e devolve id/nome/papel; vazio = "(sem login)".
- [ ] Trigger genérico `ntb_audit_trigger()` em: `orders`, `order_items`, `tables`, `table_sessions`, `products`, `categories`, `product_option_groups`, `product_options`, `store_users`, `stores`, `printer_configs`, `print_sectors`, `discount_coupons`, `price_schedules`, `fiscal_notas`, `cash_shifts`, `cash_movements`, `table_reservations`, `store_fiscal_config`. Grava só colunas que mudaram (antes → depois) e um `summary` em português por tabela/operação.
- [ ] RPC `log_staff_action_secure(store, action, entity, entity_id, summary, details, occurred_at)` (security definer) para ações sem linha.
- [ ] RPC `fetch_staff_audit_secure(store, de, ate, ator)` para a tela do gerente e para o relatório.
- [ ] Teste no banco da loja ZZ: toda operação gera linha com ator; sem cabeçalho gera "(sem login)".

### Task 2: Cabeçalho de ator no app
- [ ] `lib/auditoria.ts`: `definirAtor(user|null)`; chamado no login, restauração de sessão e logout.
- [ ] `lib/supabaseClient.ts`: `fetchComFalhaRapida` injeta `X-NTB-Actor`; teste unitário: toda requisição carrega o cabeçalho, ator trocado muda o cabeçalho.

### Task 3: Ações sem linha (app → `registrarAcao`)
- [ ] Login (sucesso/falha/bloqueio), logout, senha trocada; reimpressões (comprovante, pré-conta, comanda, cupom fiscal, fechamento, "Reenviar" da fila); exportar notas, ver PDF; pausar/retomar impressão; abrir "modo Aberto"; confirmar senha do modo Aberto.
- [ ] Rotas de servidor: `/api/fiscal/cancelar|emitir(reemissão)|exportar`, `/api/orders/pagamento-balcao`, limpar histórico de vendas — recebem `actor` no corpo e gravam com service role.
- [ ] Fila offline: grava com o horário da ação.

### Task 4: Relatório diário
- [ ] `lib/relatorioAuditoria.ts`: agrupa por login, ordem de horário; resumo no topo (contagens) e bloco "Atenção" (cancelamentos, reimpressões, taxa/desconto editado, troca de mesa depois de pago, limpar histórico, nota cancelada, senha errada).
- [ ] PDF completo + texto curto de WhatsApp; teste com dados fictícios.
- [ ] Agendamento 00:00 (instrumentation) com trava para não enviar duas vezes; `AUDIT_REPORT_SEND` desligado por padrão; envia ao Ramon pela Evolution.

### Task 5: Tela do gerente
- [ ] Administração → Vendas → "Auditoria": lista filtrável por login/data/ação (usa `fetch_staff_audit_secure`).

### Task 6: Verificação ponta a ponta
- [ ] Na loja ZZ: login, lançar item, mover mesa, cancelar, reimprimir, receber, cancelar nota → todas aparecem no relatório com o ator certo; portão PASSOU; deploy; relatório do dia mostrado ao usuário antes de ligar o envio.
