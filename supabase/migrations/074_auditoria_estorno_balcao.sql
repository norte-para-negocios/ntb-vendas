-- Estorno de pagamento de balcão na trilha de auditoria (2026-09-13, fix
-- round 1 da Task 5 do plano correcoes-revisao-independente).
--
-- `cash_shift_audit_events` (migration 063, estendida pela 068) já registra
-- 'item_cancelado', 'sangria_grande' e 'tolerancia_excedida'. O estorno de
-- pagamento de balcão — que apaga dinheiro JÁ RECEBIDO do esperado do turno,
-- sem deixar nada pra trás — é mais grave que os três e era o único caminho
-- destrutivo do módulo Caixa sem evento nenhum: não dava pra saber quem
-- estornou, quando, nem de qual pedido. Cobrar, estornar e ficar com o
-- dinheiro não deixava pista.
--
-- Só o CHECK muda. Nenhuma coluna nova, nenhuma function nova: quem grava é
-- app/api/orders/pagamento-balcao (service role, ver lá), e quem lê é a
-- `fetch_cash_shift_audit_secure` que já existe (migration 063) — a aba
-- "Auditoria" do Caixa passa a mostrar o evento novo sem UI nova.
--
-- Mesmo padrão da migration 068 pra estender este mesmo CHECK (drop da
-- constraint pelo nome + recriar com o valor novo na lista).
alter table cash_shift_audit_events drop constraint if exists cash_shift_audit_events_event_type_check;
alter table cash_shift_audit_events add constraint cash_shift_audit_events_event_type_check
  check (event_type in ('item_cancelado', 'sangria_grande', 'tolerancia_excedida', 'pagamento_estornado'));

notify pgrst, 'reload schema';
