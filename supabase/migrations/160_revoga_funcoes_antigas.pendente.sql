-- 160 (PENDENTE, NÃO APLICAR AINDA): fecha o caminho antigo das ações sensíveis.
--
-- A extensão é `.pendente.sql` DE PROPÓSITO: nenhum fluxo roda este arquivo sozinho (scripts/aplicar-migration.mjs só aplica o arquivo que
-- alguém passar pelo nome). Ele só vira migration de verdade quando for renomeado para `160_revoga_funcoes_antigas.sql` (ajuste o número se já houver 160).
--
-- Por quê: a migration 159 criou cancel_order_item_v2 / move_table_v2 / transfer_items_v2, que conferem no SERVIDOR se o operador pode
-- (gerente, ou caixa com `trocas`; garçom nunca). Mas as funções antigas continuam executáveis pela chave anônima: quem chamar
-- `cancel_order_item_secure` & cia direto (ou um app antigo) contorna a regra. O portão de deploy já aponta isso como ESPERADO.
--
-- QUANDO aplicar (todas as condições):
--   1. O app novo (que só chama as *_v2) está em produção em TODAS as lojas: site/PWA (deploy.sh), desktop Windows (updater) e APK Android
--      das maquininhas. App antigo que ainda chame uma função revogada passa a receber "permission denied" ao trocar mesa, mover ou cancelar item.
--   2. Com a loja fechada (sem mesa em atendimento), para não pegar um aparelho no meio do turno.
--   3. Conferido no banco que ninguém chama as antigas: `select calls from pg_stat_user_functions where funcname in
--      ('cancel_order_item_secure','move_table_secure','transfer_items_secure','cancel_pending_table_items_secure')` (precisa de track_functions=all) e
--      `grep -rn "_secure'" lib | grep -E "cancel_order_item|move_table|transfer_items|cancel_pending"` sem ocorrência além de api-mock.
--      Observação: `cancelPendingTableItems` (lib/api.ts) chama a antiga `cancel_pending_table_items_secure` mas NÃO é usada por nenhuma tela hoje
--      (código morto); se alguém passar a usá-la, crie antes a v2 dela.
--   4. Depois de aplicar, rodar `scripts/e2e/portao-deploy.sh`: o passo "RPCs antigas direto" deixa de ser ESPERADO e vira PASSOU.
--
-- As v2 são security definer (donas = postgres) e chamam as antigas como dono, então continuam funcionando depois do revoke.
-- `revoke ... from public` também: função nova no Postgres nasce com execute para PUBLIC, e anon herda de PUBLIC.

begin;

revoke execute on function public.cancel_order_item_secure(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.move_table_secure(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.transfer_items_secure(uuid, uuid[], uuid, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.cancel_pending_table_items_secure(uuid) from public, anon, authenticated;

commit;

-- Desfazer (se um app antigo quebrar e for preciso reabrir na hora):
--   grant execute on function public.cancel_order_item_secure(uuid, uuid, text, text) to anon, authenticated;
--   grant execute on function public.move_table_secure(uuid, uuid) to anon, authenticated;
--   grant execute on function public.transfer_items_secure(uuid, uuid[], uuid, uuid, text, uuid) to anon, authenticated;
--   grant execute on function public.cancel_pending_table_items_secure(uuid) to anon, authenticated;
