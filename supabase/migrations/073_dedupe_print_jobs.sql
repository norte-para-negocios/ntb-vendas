-- Dedupe server-side de trabalho de impressão (achado de revisão
-- independente, 2026-09-13). O dedupe existente vive no localStorage de
-- CADA aparelho (CaixaPrintStation.printedIds), então dois computadores com
-- o app aberto na mesma loja criam DOIS print_jobs para o mesmo item — e a
-- reserva atômica do motor de impressão não resolve isso, porque são jobs
-- diferentes, cada um legitimamente reservado por uma máquina.
-- Chave opcional: job sem `dedupe_key` (teste manual, comprovante avulso)
-- continua podendo repetir à vontade.
alter table print_jobs add column if not exists dedupe_key text;

create unique index if not exists print_jobs_dedupe_key_uniq
  on print_jobs (store_id, dedupe_key)
  where dedupe_key is not null;
