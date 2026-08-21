-- Imagem de capa (hero) do cardapio, pedido explicito da reuniao de
-- 2026-08-19: "dentro da administracao da loja, o cara vai poder alterar
-- ali a imagem de fundo, ou o logo". `logo_url` ja existia; capa nao.
-- Mesmo padrao de `logo_url`: URL do Cloudinary, nullable, sem RLS propria
-- (stores ja e' legivel publicamente, e' o cardapio).
alter table stores add column if not exists cover_url text;
