-- 148: (substituída) pedido de mesa que entra numa mesa LIVRE reabre a mesa.
-- A primeira versão era um gatilho AFTER INSERT em orders. A revisão de segurança (04/10) achou dois problemas:
-- deadlock entre o lock do FK do insert e o FOR UPDATE do gatilho em pedidos simultâneos, e mesa ocupada sem PIN
-- quando um CLIENTE (QR público) pedia numa mesa livre. A lógica agora está dentro de create_order_secure
-- (migration 153), só para pedidos de garçom e sem lock prévio. Este arquivo só garante que o gatilho antigo
-- não exista (idempotente, também em bancos onde a versão antiga tenha sido aplicada).
DROP TRIGGER IF EXISTS trg_reabrir_mesa_livre ON public.orders;
DROP FUNCTION IF EXISTS public.reabrir_mesa_livre_ao_receber_pedido();
NOTIFY pgrst, 'reload schema';
