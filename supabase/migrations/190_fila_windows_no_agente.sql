-- 190 — Fila do Windows do computador da impressão (02/11/2026, ODARA). O sistema só via até entregar ao Windows; a
-- demora e a fila cheia ficavam invisíveis sem acesso ao computador. Aditiva. Cada computador grava a sua.
alter table public.app_instances add column if not exists fila_windows jsonb;
alter table public.app_instances add column if not exists fila_windows_em timestamptz;
