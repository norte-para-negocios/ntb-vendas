-- Categoria só da equipe (garçom/caixa lançam; o cliente do QR não vê). Ex.: Embalagens.
alter table categories add column if not exists staff_only boolean not null default false;
