-- Cardapio por horario/turno: categoria inteira soh aparece numa janela
-- de horario e/ou dias da semana (ex: "Cafe da Manha" das 7h as 11h).
-- Enforcement e' so client-side (ver AGENTS.md, mesmo principio do
-- required/min/max de adicionais) -- nao ha valor financeiro em jogo.
-- NULL em qualquer um dos 3 campos = sempre disponivel (default,
-- compatibilidade com todas as categorias existentes).

alter table categories add column if not exists available_from time;
alter table categories add column if not exists available_until time;
-- 0=domingo .. 6=sabado. NULL = todos os dias.
alter table categories add column if not exists available_days int[];
